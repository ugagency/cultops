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
        maybeSingle() { const r = resolver(false); return Promise.resolve(r.data ? r : { data: null, error: null }); },
        then(ok, erro) { return Promise.resolve(resolver(true)).then(ok, erro); },
    };
    return b;
}
const supabaseFalso = {
    from,
    storage: { from: () => ({ createSignedUrl: async () => { chamadasStorage++; return ({ data: { signedUrl: 'https://storage.exemplo/nf.pdf?token=x' }, error: null }); } }) },
    auth: { getUser: async () => ({ data: null, error: { message: 'nao usado' } }) },
    rpc: async () => ({ data: [], error: null }),
};
injetar('@supabase/supabase-js', { createClient: () => supabaseFalso });

// Worker falso: guarda o config recebido e devolve o resultado combinado em cada caso.
let chamadasStorage = 0;
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
        documents: [{
            id: DOC_ID, project_id: 'p1', name: 'NF 39405.pdf', projects: { pronac: '256578' },
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
        assert.match(r.corpo.error, /^Valor pago não determinado/);
        assert.equal(configRecebido, null);
    });

    await caso('sem lançamento conciliado: erro (sem cair para data_pagamento/data_emissao) e o worker nao e chamado', async () => {
        cenario({ doc: { valor_pago: 17000, data_pagamento: '2026-09-15' }, lancamentos: [] });
        resultadoWorker = { sucesso: true };
        const r = await enviar();
        assert.equal(r.codigo, 500);
        assert.match(r.corpo.error, /sem lançamento bancário conciliado/);
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

    okLog(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
})();
