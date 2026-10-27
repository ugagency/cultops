// Testes do envio ao SALIC no server.js (executarEnvioSalic) — nao acessam o SALIC nem o Supabase.
// Rodar: node teste_envio_salic.cjs
// O Supabase e o worker (salic_insertion.cjs) sao trocados por falsos no cache do require
// ANTES de carregar o server.js. As variaveis de ambiente recebem valores ficticios antes do
// dotenv (que nao sobrescreve o que ja existe), entao as chaves do .env nunca sao usadas.
const assert = require('node:assert/strict');
const Module = require('module');

process.env.SUPABASE_URL = 'http://supabase.invalido';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-ficticia';

function injetar(caminho, exportsFalso) {
    const id = require.resolve(caminho);
    const m = new Module(id);
    m.filename = id;
    m.loaded = true;
    m.exports = exportsFalso;
    require.cache[id] = m;
}

// Supabase falso: devolve as linhas de `dados` filtradas pelos .eq() e registra toda escrita.
let dados = {};
let escritas = [];
function from(tabela) {
    const q = { op: 'select', payload: null, filtros: [] };
    const resolver = (lista) => {
        if (q.op !== 'select') {
            escritas.push({ tabela, op: q.op, payload: q.payload, filtros: q.filtros });
            return { data: null, error: null };
        }
        if (errosPorTabela[tabela]) return { data: null, error: { message: 'falha simulada' } };
        const linhas = (dados[tabela] || []).filter(l => q.filtros.every(([c, v]) => l[c] === v));
        if (lista) return { data: linhas, error: null };
        return linhas[0] ? { data: linhas[0], error: null } : { data: null, error: { message: 'nenhuma linha' } };
    };
    const b = {
        select() { return b; }, order() { return b; }, limit() { return b; }, ilike() { return b; },
        eq(c, v) { q.filtros.push([c, v]); return b; },
        update(p) { q.op = 'update'; q.payload = p; return b; },
        insert(p) { q.op = 'insert'; q.payload = p; return b; },
        single() { return Promise.resolve(resolver(false)); },
        maybeSingle() { const r = resolver(false); return Promise.resolve(r.data || errosPorTabela[tabela] ? r : { data: null, error: null }); },
        then(ok, erro) { return Promise.resolve(resolver(true)).then(ok, erro); },
    };
    return b;
}
const supabaseFalso = {
    from,
    storage: { from: () => ({ createSignedUrl: async () => { chamadasStorage++; if (storageFalha) return { data: null, error: { message: 'falha simulada' } }; return ({ data: { signedUrl: 'https://storage.exemplo/nf.pdf?token=x' }, error: null }); } }) },
    auth: { getUser: async () => ({ data: null, error: { message: 'nao usado' } }) },
    rpc: async () => ({ data: [], error: null }),
};
injetar('@supabase/supabase-js', { createClient: () => supabaseFalso });

// Worker falso: guarda o config recebido e devolve o resultado combinado em cada caso.
let chamadasStorage = 0;
let storageFalha = false;
let errosPorTabela = {};
let configRecebido = null;
let resultadoWorker = null;
injetar('./salic_insertion.cjs', {
    executarInsercaoSalic: async (config) => { configRecebido = config; return resultadoWorker; },
});

const { executarEnvioSalic, criarHandlerDryRun } = require('./server.js');
const { criarLimitadorPorUsuario } = require('./salic_validar_login.cjs');

const DOC_ID = 'd1d3e0de-0000-0000-0000-000000000001';
const RUBRICA_ID = '27f49b2b-0000-0000-0000-000000000001';
function cenario({ doc = {}, lancamentos } = {}) {
    dados = {
        decrypted_external_credentials: [{ user_id: 'u1', service_name: 'salic', identifier: '12345678909', secret_plain: 'senha' }],
        // vinculo usuario-organizacao; uMulti esta em duas organizacoes; uSemVinculo nao tem linha
        organization_users: [
            { user_id: 'u1', organization_id: 'orgA', role: 'admin' }, { user_id: 'u2', organization_id: 'orgA', role: 'membro' },
            { user_id: 'uB', organization_id: 'orgB', role: 'admin' }, { user_id: 'uC', organization_id: 'orgC', role: 'admin' },
            { user_id: 'uMulti', organization_id: 'orgA', role: 'membro' }, { user_id: 'uMulti', organization_id: 'orgB', role: 'membro' },
        ],
        documents: [{
            id: DOC_ID, project_id: 'p1', organization_id: 'orgA', name: 'NF 39405.pdf', projects: { pronac: '256578' },
            rubrica: '46 - advogado', rubrica_id_fk: RUBRICA_ID,
            cnpj_emissor: '01.234.567/0001-89', nome_emissor: 'CESNIK', valor: 18000, valor_pago: null,
            data_emissao: '2026-09-01', data_pagamento: null, numero_nf: '00039405', fitid: '93.001',
            file_path: 'nf.pdf', recibo: 'no', json_extraido: null, justificativa_salic: null, ...doc,
        }],
        rubricas: [{ id: RUBRICA_ID, nome: 'Advogado(a)', etapa: '9 - Assessoria', valor_aprovado: 240000, rubrica_id: 46, produto: 'Administração do Projeto' }],
        extratos_lancamentos: lancamentos || [
            { document_id: DOC_ID, extrato_id: 'e1', fitid: '93.001', valor: -16893, data_lancamento: '2026-09-30', memo: 'Pix', status_conciliacao: 'conciliado', project_id: 'p1' },
        ],
        despesas: [],
    };
    escritas = [];
    configRecebido = null;
    chamadasStorage = 0;
    storageFalha = false;
    errosPorTabela = {};
}
async function enviar(opcoes) {
    const res = { codigo: 200, corpo: null, status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; } };
    await executarEnvioSalic({ body: { documentId: DOC_ID }, userId: 'u1' }, res, opcoes);
    return res;
}
const escritasEm = (tabela) => escritas.filter(e => e.tabela === tabela);

let falhas = 0;

(async () => {
    // Silencia o log do server durante cada caso (o resultado aparece pelas linhas ok/FALHA).
    const consoleOriginal = { log: console.log, warn: console.warn, error: console.error };
    const okLog = consoleOriginal.log;
    const caso = async (nome, fn) => {
        console.log = console.warn = console.error = () => { };
        try { await fn(); okLog('ok   -', nome); }
        catch (e) { falhas++; okLog('FALHA -', nome, '\n      ', e.message); }
        finally { Object.assign(console, consoleOriginal); }
    };

    await caso('dry-run com sucesso: nao grava em documents nem em despesas', async () => {
        cenario();
        resultadoWorker = { sucesso: true, dryRun: true, screenshot: 'x.png', auditoria: {}, matchType: 'valor_aprovado', rubricaCasada: 'Advogado(a)' };
        const r = await enviar({ dryRun: true });
        assert.equal(r.codigo, 200);
        assert.equal(r.corpo.dryRun, true);
        assert.equal(configRecebido.dryRun, true);
        assert.deepEqual(escritasEm('documents'), []);
        assert.deepEqual(escritasEm('despesas'), []);
    });

    await caso('dry-run com erro do worker: nao grava erro_rpa/just_erro', async () => {
        cenario();
        resultadoWorker = { sucesso: false, erro: 'Rubrica da tela ("X") diverge da rubrica esperada ("Advogado(a)")' };
        const r = await enviar({ dryRun: true });
        assert.equal(r.codigo, 500);
        assert.match(r.corpo.error, /diverge/);
        assert.deepEqual(escritasEm('documents'), []);
        assert.deepEqual(escritasEm('despesas'), []);
    });

    await caso('dry-run com erro antes do worker (sem rubrica_id_fk): nao grava nada', async () => {
        cenario({ doc: { rubrica_id_fk: null } });
        const r = await enviar({ dryRun: true });
        assert.equal(r.codigo, 500);
        assert.deepEqual(escritas, []);
    });

    await caso('sem rubrica_id_fk: erro e o worker nao e chamado (sem busca por prefixo ou por nome)', async () => {
        cenario({ doc: { rubrica_id_fk: null } });
        resultadoWorker = { sucesso: true };
        const r = await enviar();
        assert.equal(r.codigo, 500);
        assert.match(r.corpo.error, /sem rubrica vinculada \(rubrica_id_fk vazio\)/);
        assert.equal(configRecebido, null);
        // fora do dry-run o erro continua sendo gravado no documento, como antes
        assert.equal(escritasEm('documents')[0].payload.status, 'erro_rpa');
    });

    await caso('rubrica_id_fk apontando para rubrica inexistente: erro', async () => {
        cenario({ doc: { rubrica_id_fk: 'nao-existe' } });
        const r = await enviar();
        assert.equal(r.codigo, 500);
        assert.match(r.corpo.error, /Rubrica não encontrada/);
        assert.equal(configRecebido, null);
    });

    await caso('rubricaNome vem de rubricas.nome, nao do texto livre documents.rubrica', async () => {
        cenario({ doc: { rubrica: '46 - advogado' } });
        resultadoWorker = { sucesso: true, dryRun: true };
        await enviar({ dryRun: true });
        assert.equal(configRecebido.rubricaNome, 'Advogado(a)');
        assert.equal(configRecebido.rubricaProduto, 'Administração do Projeto');
        assert.equal(configRecebido.rubricaValorAprovado, 240000);
    });

    await caso('envio normal com sucesso: continua gravando status e data_salic; dryRun desligado', async () => {
        cenario();
        resultadoWorker = { sucesso: true };
        const r = await enviar();
        assert.equal(r.codigo, 200);
        assert.equal(configRecebido.dryRun, false);
        assert.equal(escritasEm('documents')[0].payload.status, 'enviado_salic');
        assert.ok(escritasEm('despesas')[0].payload.data_salic);
    });

    // ── ocorrência #120: valor e data que chegam ao worker ──
    const LANC_39405 = (extra = {}) => ({ document_id: DOC_ID, extrato_id: 'e1', fitid: '93.001', valor: -16893, data_lancamento: '2026-09-30', memo: 'Pix', status_conciliacao: 'conciliado', project_id: 'p1', ...extra });

    await caso('NF 39405: worker recebe 16.893,00 (lançamento) e a data do Pix, nao os 18.000,00 da nota', async () => {
        // a mesma linha importada de novo em outro extrato, pendente e sem documento, nao atrapalha
        cenario({ lancamentos: [LANC_39405(), LANC_39405({ extrato_id: 'e2', status_conciliacao: 'pendente', document_id: null })] });
        resultadoWorker = { sucesso: true, dryRun: true };
        const r = await enviar({ dryRun: true });
        assert.equal(r.codigo, 200);
        assert.equal(configRecebido.documento.valor, 16893);
        assert.equal(configRecebido.documento.data_pagamento, '2026-09-30');
    });

    await caso('valor_pago preenchido: worker recebe valor_pago', async () => {
        cenario({ doc: { valor_pago: 17000 } });
        resultadoWorker = { sucesso: true, dryRun: true };
        await enviar({ dryRun: true });
        assert.equal(configRecebido.documento.valor, 17000);
    });

    await caso('lançamento dividido com outra nota: erro e o worker nao e chamado', async () => {
        cenario({ lancamentos: [LANC_39405(), LANC_39405({ document_id: 'outra-nota' })] });
        resultadoWorker = { sucesso: true };
        const r = await enviar();
        assert.equal(r.codigo, 500);
        assert.match(r.corpo.error, /^\[LANCAMENTO_DIVIDIDO\] Valor pago não determinado/);
        assert.equal(configRecebido, null);
    });

    await caso('sem lançamento e sem data_pagamento: erro (sem cair para data_emissao) e o worker nao e chamado', async () => {
        cenario({ doc: { valor_pago: 17000, data_pagamento: null }, lancamentos: [] });
        resultadoWorker = { sucesso: true };
        const r = await enviar();
        assert.equal(r.codigo, 500);
        assert.match(r.corpo.error, /^\[DATA_PAGAMENTO_SEM_LANCAMENTO\] .*sem lançamento bancário conciliado e sem data de pagamento informada/);
        assert.equal(configRecebido, null);
    });

    await caso('sem lançamento, com data_pagamento do pagamento manual (e valor_pago): worker recebe essa data', async () => {
        cenario({ doc: { valor_pago: 17000, data_pagamento: '2026-09-15' }, lancamentos: [] });
        resultadoWorker = { sucesso: true, dryRun: true };
        const r = await enviar({ dryRun: true });
        assert.equal(r.codigo, 200);
        assert.equal(configRecebido.documento.data_pagamento, '2026-09-15');
        assert.equal(configRecebido.documento.valor, 17000);
        assert.equal(r.corpo.dataPagamento, '2026-09-15');
    });

    await caso('lançamento e data_pagamento divergentes: worker recebe a data do lançamento', async () => {
        cenario({ doc: { data_pagamento: '2026-09-15' } });   // lançamento padrao: 2026-09-30
        resultadoWorker = { sucesso: true, dryRun: true };
        await enviar({ dryRun: true });
        assert.equal(configRecebido.documento.data_pagamento, '2026-09-30');
    });

    await caso('sem lançamento, com data_pagamento mas sem valor_pago: [VALOR_PAGO_INDETERMINADO] (sem quebrar por falta do lançamento)', async () => {
        cenario({ doc: { valor_pago: null, data_pagamento: '2026-09-15' }, lancamentos: [] });
        resultadoWorker = { sucesso: true };
        const r = await enviar();
        assert.equal(r.codigo, 500);
        assert.equal(r.corpo.codigo, 'VALOR_PAGO_INDETERMINADO');
        assert.match(r.corpo.error, /^\[VALOR_PAGO_INDETERMINADO\] Valor pago não determinado: valor_pago vazio e nenhum lançamento/);
        assert.equal(configRecebido, null);
    });

    // ── rota POST /api/salic/dry-run (handler criado por criarHandlerDryRun) ──
    const rodarDryRun = async (handler, corpo = { documentId: DOC_ID }, userId = 'u1') => {
        const res = { codigo: 200, corpo: null, status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; } };
        await handler({ body: corpo, userId }, res);
        return res;
    };
    const relogio = (inicio = 0) => { const r = { t: inicio, agora: () => r.t }; return r; };
    const novoHandler = (max = 3, rel = relogio()) => criarHandlerDryRun({
        limitador: criarLimitadorPorUsuario({ max, janelaMs: 15 * 60 * 1000, agora: rel.agora })
    });
    const RESULTADO_DRY = { sucesso: true, dryRun: true, screenshot: null, auditoria: { '#vlComprovado': '16.893,00' }, matchType: 'flat_nome_e_valor_aprovado', rubricaCasada: 'Advogado(a)' };

    await caso('dry-run: dryRun fixo na rota (ignora dryRun do body), sem PDF e sem URL assinada', async () => {
        cenario();
        resultadoWorker = RESULTADO_DRY;
        const r = await rodarDryRun(novoHandler(), { documentId: DOC_ID, dryRun: false });
        assert.equal(r.codigo, 200);
        assert.equal(configRecebido.dryRun, true);
        assert.equal(configRecebido.documento.nf_url, null);
        assert.equal(chamadasStorage, 0, 'nao toca o Storage');
    });

    await caso('dry-run: resposta traz so a AUDITORIA em JSON, sem screenshot', async () => {
        cenario();
        resultadoWorker = { ...RESULTADO_DRY, screenshot: 'nao-deve-sair.png' };
        const r = await rodarDryRun(novoHandler());
        assert.equal(r.corpo.success, true);
        assert.equal(r.corpo.dryRun, true);
        assert.equal(r.corpo.pdfAnexado, false);
        assert.deepEqual(r.corpo.auditoria, { '#vlComprovado': '16.893,00' });
        assert.equal(r.corpo.valor, 16893);
        assert.equal(r.corpo.dataPagamento, '2026-09-30');
        assert.equal('screenshot' in r.corpo, false);
    });

    await caso('dry-run: nunca grava em nenhuma tabela (documents, despesas, rpa_execucoes), em sucesso ou erro', async () => {
        cenario();
        resultadoWorker = RESULTADO_DRY;
        await rodarDryRun(novoHandler());
        assert.deepEqual(escritas, [], 'sucesso');
        cenario();
        resultadoWorker = { sucesso: false, erro: 'Rubrica da tela ("X") diverge da rubrica esperada ("Advogado(a)")' };
        const r = await rodarDryRun(novoHandler());
        assert.equal(r.codigo, 500);
        assert.deepEqual(escritas, [], 'erro do worker');
        cenario({ lancamentos: [] });
        await rodarDryRun(novoHandler());
        assert.deepEqual(escritas, [], 'erro antes do worker');
    });

    await caso('dry-run: limite por usuario (3 por 15 min) responde 429 com tentarEm e nao chama o worker', async () => {
        cenario();
        resultadoWorker = RESULTADO_DRY;
        const rel = relogio(1000000);
        const handler = novoHandler(3, rel);
        for (let i = 0; i < 3; i++) assert.equal((await rodarDryRun(handler)).codigo, 200);
        configRecebido = null;
        rel.t += 60 * 1000;
        const r = await rodarDryRun(handler);
        assert.equal(r.codigo, 429);
        assert.equal(r.corpo.status, 'limite');
        assert.equal(r.corpo.tentarEm, 14 * 60);
        assert.equal(configRecebido, null);
    });

    await caso('dry-run: outro usuario nao e afetado e a cota volta depois da janela', async () => {
        cenario();
        resultadoWorker = RESULTADO_DRY;
        const rel = relogio(1000000);
        const handler = novoHandler(3, rel);
        dados.decrypted_external_credentials.push({ user_id: 'u2', service_name: 'salic', identifier: '98765432100', secret_plain: 'senha2' });
        for (let i = 0; i < 3; i++) await rodarDryRun(handler);
        assert.equal((await rodarDryRun(handler)).codigo, 429);
        assert.equal((await rodarDryRun(handler, undefined, 'u2')).codigo, 200);
        rel.t += 15 * 60 * 1000 + 1;
        assert.equal((await rodarDryRun(handler)).codigo, 200);
    });

    await caso('dry-run: sem documentId responde 400 e nao gasta cota', async () => {
        cenario();
        resultadoWorker = RESULTADO_DRY;
        const handler = novoHandler(1);
        assert.equal((await rodarDryRun(handler, {})).codigo, 400);
        assert.equal((await rodarDryRun(handler)).codigo, 200);
    });

    // ── isolamento por organização (/api/salic/inserir e /api/salic/dry-run) ──
    const enviarComo = async (userId, opcoes, documentId = DOC_ID) => {
        const res = { codigo: 200, corpo: null, status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; } };
        await executarEnvioSalic({ body: { documentId }, userId }, res, opcoes);
        return res;
    };
    const NAO_ENCONTRADO = { error: 'Documento não encontrado.' };

    await caso('org: usuario da organizacao A pedindo documento da B recebe 404 e nada e atualizado em documents', async () => {
        cenario({ doc: { organization_id: 'orgB' } });   // documento da B, usuario u1 e da A
        resultadoWorker = { sucesso: true };
        const r = await enviarComo('u1');
        assert.equal(r.codigo, 404);
        assert.deepEqual(r.corpo, NAO_ENCONTRADO);
        assert.deepEqual(escritas, [], 'nenhuma escrita em nenhuma tabela');
        assert.equal(escritasEm('documents').length, 0);
        assert.equal(configRecebido, null, 'o worker nao e chamado');
    });

    await caso('org: o mesmo vale no dry-run (rota /api/salic/dry-run)', async () => {
        cenario({ doc: { organization_id: 'orgB' } });
        resultadoWorker = RESULTADO_DRY;
        const r = await rodarDryRun(novoHandler());
        assert.equal(r.codigo, 404);
        assert.deepEqual(r.corpo, NAO_ENCONTRADO);
        assert.deepEqual(escritas, []);
        assert.equal(configRecebido, null);
    });

    await caso('org: documento inexistente responde igual ao de outra organizacao (nao revela que existe)', async () => {
        cenario();
        const inexistente = await enviarComo('u1', undefined, 'nao-existe');
        cenario({ doc: { organization_id: 'orgB' } });
        const deOutraOrg = await enviarComo('u1');
        assert.equal(inexistente.codigo, 404);
        assert.deepEqual(inexistente.corpo, deOutraOrg.corpo);
        assert.equal(inexistente.codigo, deOutraOrg.codigo);
    });

    await caso('org: usuario da B tambem nao alcanca documento da A', async () => {
        cenario();   // documento da A
        resultadoWorker = { sucesso: true };
        const r = await enviarComo('uB');
        assert.equal(r.codigo, 404);
        assert.deepEqual(escritas, []);
    });

    await caso('org: usuario sem linha em organization_users recebe 404 (falha fechado)', async () => {
        for (const uid of ['uSemVinculo']) {
            cenario();
            const r = await enviarComo(uid);
            assert.equal(r.codigo, 404, uid);
            assert.deepEqual(escritas, [], uid);
        }
    });

    await caso('excluido: documento com excluido_em recebe 404 igual ao de outra organizacao e nada e gravado', async () => {
        cenario({ doc: { excluido_em: '2026-10-20T13:00:00Z', excluido_por: 'u2' } });
        resultadoWorker = { sucesso: true, protocolo: 'P-1' };
        const r = await enviarComo('u1');
        assert.equal(r.codigo, 404);
        assert.deepEqual(r.corpo, NAO_ENCONTRADO, 'mesma resposta, sem revelar que existe nem que foi ocultado');
        assert.deepEqual(escritas, [], 'nada em documents nem em despesas');
        assert.equal(configRecebido, null, 'o worker nao e chamado');
        assert.equal(chamadasStorage, 0, 'nem a URL do arquivo e assinada');
        cenario({ doc: { organization_id: 'orgB' } });
        const deOutraOrg = await enviarComo('u1');
        assert.equal(r.codigo, deOutraOrg.codigo);
        assert.deepEqual(r.corpo, deOutraOrg.corpo);
    });

    await caso('excluido: o mesmo vale no dry-run', async () => {
        cenario({ doc: { excluido_em: '2026-10-20T13:00:00Z' } });
        resultadoWorker = RESULTADO_DRY;
        const r = await rodarDryRun(novoHandler());
        assert.equal(r.codigo, 404);
        assert.deepEqual(r.corpo, NAO_ENCONTRADO);
        assert.deepEqual(escritas, []);
        assert.equal(configRecebido, null);
    });

    await caso('excluido: documento com excluido_em null continua sendo enviado como antes', async () => {
        cenario({ doc: { excluido_em: null, excluido_por: null } });
        resultadoWorker = { sucesso: true, protocolo: 'P-2' };
        const r = await enviarComo('u1');
        assert.equal(r.codigo, 200);
        assert.ok(configRecebido, 'o worker e chamado');
        assert.ok(escritasEm('documents').some(e => e.payload && e.payload.status === 'enviado_salic'));
    });

    await caso('org: documento sem organization_id recebe 404 (falha fechado)', async () => {
        cenario({ doc: { organization_id: null } });
        const r = await enviarComo('u1');
        assert.equal(r.codigo, 404);
        assert.deepEqual(escritas, []);
    });

    await caso('org: erro ao consultar organization_users: 500 generico, sem gravar e sem revelar o documento', async () => {
        cenario();
        errosPorTabela = { organization_users: true };
        const r = await enviarComo('u1');
        assert.equal(r.codigo, 500);
        assert.deepEqual(r.corpo, { error: '[ERRO_RPA_GENERICO] Não foi possível validar o acesso ao documento.', codigo: 'ERRO_RPA_GENERICO' });
        assert.deepEqual(escritas, []);
    });

    await caso('org: usuario em duas organizacoes acessa documento de qualquer uma delas', async () => {
        for (const org of ['orgA', 'orgB']) {
            cenario({ doc: { organization_id: org } });
            dados.decrypted_external_credentials.push({ user_id: 'uMulti', service_name: 'salic', identifier: '11122233344', secret_plain: 'senha3' });
            resultadoWorker = { sucesso: true };
            const r = await enviarComo('uMulti');
            assert.equal(r.codigo, 200, org);
            assert.equal(escritasEm('documents')[0].payload.status, 'enviado_salic', org);
        }
    });

    await caso('org: usuario de outra organizacao (C) recebe 404 para documento da A e da B, igual a inexistente', async () => {
        for (const org of ['orgA', 'orgB']) {
            cenario({ doc: { organization_id: org } });
            const r = await enviarComo('uC');
            assert.equal(r.codigo, 404, org);
            assert.deepEqual(r.corpo, NAO_ENCONTRADO, org);
            assert.deepEqual(escritas, [], org);
        }
    });

    await caso('org: mesma organizacao segue normal (sucesso grava status) e erro depois da checagem ainda grava erro_rpa', async () => {
        cenario();
        resultadoWorker = { sucesso: true };
        assert.equal((await enviarComo('u1')).codigo, 200);
        assert.equal(escritasEm('documents')[0].payload.status, 'enviado_salic');
        cenario({ doc: { rubrica_id_fk: null } });
        assert.equal((await enviarComo('u1')).codigo, 500);
        assert.equal(escritasEm('documents')[0].payload.status, 'erro_rpa');
    });

    // ── códigos de erro em documents.just_erro e na resposta 500 ──
    // Um caso por código. just_erro e error são o mesmo texto "[CODIGO] mensagem", com um único
    // prefixo, o texto original logo depois dele, e o código também em resposta.codigo.
    const erroGravado = () => escritasEm('documents').find(e => e.payload.just_erro !== undefined)?.payload.just_erro;
    const esperarCodigo = async (rotulo, codigo, textoOriginal, preparar) => {
        cenario();
        resultadoWorker = { sucesso: true };
        preparar();
        const r = await enviarComo('u1');
        assert.equal(r.codigo, 500, rotulo);
        assert.equal(r.corpo.codigo, codigo, `${rotulo}: codigo da resposta`);
        assert.ok(r.corpo.error.startsWith(`[${codigo}] `), `${rotulo}: prefixo [${codigo}] em "${r.corpo.error}"`);
        assert.equal((r.corpo.error.match(/\[[A-Z_]+\] /g) || []).length, 1, `${rotulo}: prefixo unico`);
        assert.match(r.corpo.error.slice(codigo.length + 3), textoOriginal, `${rotulo}: texto original preservado`);
        assert.equal(erroGravado(), r.corpo.error, `${rotulo}: just_erro igual a resposta`);
        assert.equal(escritasEm('documents')[0].payload.status, 'erro_rpa');
    };
    const LANC_ERRO = (extra = {}) => ({ document_id: DOC_ID, extrato_id: 'e1', fitid: '93.001', valor: -16893, data_lancamento: '2026-09-30', memo: 'Pix', status_conciliacao: 'conciliado', project_id: 'p1', ...extra });

    await caso('codigo RUBRICA_NAO_VINCULADA', () => esperarCodigo('rubrica nao vinculada', 'RUBRICA_NAO_VINCULADA',
        /^Documento .* sem rubrica vinculada \(rubrica_id_fk vazio\)/, () => { dados.documents[0].rubrica_id_fk = null; }));
    await caso('codigo RUBRICA_INEXISTENTE', () => esperarCodigo('rubrica inexistente', 'RUBRICA_INEXISTENTE',
        /^Rubrica não encontrada para documento .* \| rubrica_id_fk: nao-existe$/, () => { dados.documents[0].rubrica_id_fk = 'nao-existe'; }));
    await caso('codigo VALOR_PAGO_INDETERMINADO (sem lançamento, dois lançamentos distintos, valor inválido)', async () => {
        await esperarCodigo('dois lancamentos distintos', 'VALOR_PAGO_INDETERMINADO', /^Valor pago não determinado: valor_pago vazio e 2 lançamentos conciliados distintos/,
            () => { dados.extratos_lancamentos = [LANC_ERRO(), LANC_ERRO({ fitid: '94.002', valor: -100, data_lancamento: '2026-10-05' })]; });
        await esperarCodigo('valor_pago zero', 'VALOR_PAGO_INDETERMINADO', /^Valor pago não determinado: valor inválido \(valor_pago\)/,
            () => { dados.documents[0].valor_pago = 0; });
    });
    await caso('codigo LANCAMENTO_DIVIDIDO', () => esperarCodigo('lancamento dividido', 'LANCAMENTO_DIVIDIDO',
        /^Valor pago não determinado: o lançamento 93\.001 está conciliado com 2 documentos/,
        () => { dados.extratos_lancamentos = [LANC_ERRO(), LANC_ERRO({ document_id: 'outra-nota' })]; }));
    await caso('codigo VALOR_MAIOR_QUE_NOTA', () => esperarCodigo('valor maior que a nota', 'VALOR_MAIOR_QUE_NOTA',
        /^Valor pago \(R\$ 19000\.00, origem: valor_pago\) maior que o valor da nota \(R\$ 18000\.00\)/,
        () => { dados.documents[0].valor_pago = 19000; }));
    await caso('codigo DATA_PAGAMENTO_SEM_LANCAMENTO', () => esperarCodigo('sem lancamento', 'DATA_PAGAMENTO_SEM_LANCAMENTO',
        /^Documento .* sem lançamento bancário conciliado e sem data de pagamento informada: data do pagamento não determinada/,
        () => { dados.extratos_lancamentos = []; }));
    await caso('codigo DADOS_OBRIGATORIOS_FALTANDO', () => esperarCodigo('dados faltando', 'DADOS_OBRIGATORIOS_FALTANDO',
        /^Faltam dados obrigatórios para enviar ao SALIC: CNPJ\/CPF\.$/, () => { dados.documents[0].cnpj_emissor = null; }));
    await caso('codigo CREDENCIAL_SALIC_AUSENTE', () => esperarCodigo('sem credencial', 'CREDENCIAL_SALIC_AUSENTE',
        /^Credenciais SALIC não encontradas para este usuário no Supabase\.$/, () => { dados.decrypted_external_credentials = []; }));
    await caso('codigo ARQUIVO_NF_INDISPONIVEL', () => esperarCodigo('arquivo da NF', 'ARQUIVO_NF_INDISPONIVEL',
        /^Não foi possível gerar URL do arquivo da NF\.$/, () => { storageFalha = true; }));

    // Erros que o worker devolve em resultado.erro já vêm prefixados: o server grava igual, sem duplicar.
    for (const [codigo, texto] of [
        ['RUBRICA_NAO_ENCONTRADA_SALIC', 'Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro"): nenhuma linha com o nome exato'],
        ['RUBRICA_TELA_DIVERGENTE', 'Rubrica da tela ("X") diverge da rubrica esperada ("Advogado(a)"). Nada foi inserido.'],
        ['FORNECEDOR_NAO_ENCONTRADO_SALIC', 'Fornecedor com CNPJ 03281691000137 nao encontrado no SALIC (o SALIC respondeu que ele nao esta cadastrado).'],
        ['LOGIN_SALIC_RECUSADO', 'Falha no login SALIC: credenciais invalidas ou usuario bloqueado.'],
        ['TEMPO_ESGOTADO_SALVAMENTO', 'Tempo esgotado (60s) aguardando o SALIC concluir o salvamento. O comprovante pode ter sido gravado.'],
    ]) {
        await caso(`codigo ${codigo}: erro do worker preservado pelo server, sem duplicar o prefixo`, async () => {
            cenario();
            resultadoWorker = { sucesso: false, erro: `[${codigo}] ${texto}` };
            const r = await enviarComo('u1');
            assert.equal(r.codigo, 500);
            assert.equal(r.corpo.error, `[${codigo}] ${texto}`);
            assert.equal(r.corpo.codigo, codigo);
            assert.equal(erroGravado(), `[${codigo}] ${texto}`);
            assert.equal((erroGravado().match(/\[[A-Z_]+\] /g) || []).length, 1);
        });
    }

    await caso('codigo ERRO_RPA_GENERICO: erro sem código do worker e erro inesperado do server ganham o prefixo genérico', async () => {
        cenario();
        resultadoWorker = { sucesso: false, erro: 'Modal ainda aberto com possiveis erros. Toasts: x' };
        let r = await enviarComo('u1');
        assert.equal(r.corpo.error, '[ERRO_RPA_GENERICO] Modal ainda aberto com possiveis erros. Toasts: x');
        assert.equal(r.corpo.codigo, 'ERRO_RPA_GENERICO');
        assert.equal(erroGravado(), r.corpo.error);
        cenario({ lancamentos: [LANC_ERRO()] });
        errosPorTabela = { extratos_lancamentos: true };
        r = await enviarComo('u1');
        assert.match(r.corpo.error, /^\[ERRO_RPA_GENERICO\] Falha ao consultar o lançamento conciliado: /);
        assert.equal(r.corpo.codigo, 'ERRO_RPA_GENERICO');
    });

    await caso('dry-run: 500 tambem traz codigo e nao grava nada', async () => {
        cenario({ lancamentos: [] });
        const r = await rodarDryRun(novoHandler());
        assert.equal(r.codigo, 500);
        assert.equal(r.corpo.codigo, 'DATA_PAGAMENTO_SEM_LANCAMENTO');
        assert.ok(r.corpo.error.startsWith('[DATA_PAGAMENTO_SEM_LANCAMENTO] '));
        assert.deepEqual(escritas, []);
    });

    await caso('respostas que nao sao erro do robô continuam sem codigo (404 e 400)', async () => {
        cenario({ doc: { organization_id: 'orgB' } });
        const r404 = await enviarComo('u1');
        assert.deepEqual(r404.corpo, { error: 'Documento não encontrado.' });
        const r400 = await enviarComo('u1', undefined, '');
        assert.equal(r400.codigo, 400);
        assert.equal('codigo' in r400.corpo, false);
    });

    okLog(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
})();
