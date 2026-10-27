// Teste da ocorrencia #127 no servidor, com um Supabase falso em memoria: carrega o server.js de
// verdade e chama as rotas por HTTP.
//  - GET /api/conciliacao/extratos-pausados: perfil, organizacao, projeto de outra organizacao, analista
//    so com as notas dele, extrato sem nota presa, texto do motivo;
//  - POST /api/conciliacao/vincular-extrato: nota presa a extrato pausado e revinculada (inclusive a que
//    disparou a pausa), a presa a extrato NAO pausado continua pulada, auditoria do extrato anterior;
//  - nada vai ao n8n.
// Uso: node teste-extratos-pausados-rota.js
const assert = require('assert');
const http = require('http');
const { criarFetchFalso } = require('./teste-banco-falso.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = U(900), ORG2 = U(901);
const PROJ = U(10), PROJ_ORG2 = U(12), PROJ_SEM = U(13);
const EXT_RUIM = U(20), EXT_BOM = U(21), EXT_NAO_PAUSADO = U(22), EXT_PAUSADO_SEM_NOTA = U(23), EXT_ORG2 = U(24);
const GESTOR = U(1), ANALISTA = U(2), OUTRO = U(3), FORNECEDOR = U(4);
const MENSAGEM = 'Extrato de outro projeto: o PRONAC do extrato (111111) não confere com o do projeto (222222).';

let db;
const chamadasExternas = [];
function zerarBanco() {
    const nota = (n, extra) => ({
        id: U(100 + n), name: 'nota' + n + '.pdf', numero_nf: String(4000 + n), nome_emissor: 'Fornecedor ' + n, valor: 100 * n,
        data_emissao: '2026-09-0' + (n % 9 + 1), project_id: PROJ, user_id: GESTOR, tipo_documento: 'nf',
        status: 'aguardando_conciliacao_bancaria', extrato_origem_id: EXT_RUIM, just_erro: null, ...extra
    });
    db = {
        projects: [
            { id: PROJ, organization_id: ORG }, { id: PROJ_ORG2, organization_id: ORG2 }, { id: PROJ_SEM, organization_id: ORG }
        ],
        extratos: [
            { id: EXT_RUIM, project_id: PROJ, organization_id: ORG, status: 'processado', file_path: 'p/u/Extrato_Errado.ofx', created_at: '2026-09-05T15:00:00Z' },
            { id: EXT_BOM, project_id: PROJ, organization_id: ORG, status: 'processado', file_path: 'p/u/Extrato_Certo.ofx', created_at: '2026-09-10T15:00:00Z' },
            { id: EXT_NAO_PAUSADO, project_id: PROJ, organization_id: ORG, status: 'processado', file_path: 'p/u/outro.ofx', created_at: '2026-09-11T15:00:00Z' },
            { id: EXT_PAUSADO_SEM_NOTA, project_id: PROJ, organization_id: ORG, status: 'processado', file_path: 'p/u/velho.ofx', created_at: '2026-08-01T15:00:00Z' },
            { id: EXT_ORG2, project_id: PROJ_ORG2, organization_id: ORG2, status: 'processado', file_path: 'p/u/org2.ofx', created_at: '2026-09-01T15:00:00Z' }
        ],
        documents: [
            nota(1, { status: 'divergencia_beneficiario', just_erro: MENSAGEM }), // a que disparou a pausa
            nota(2), // na fila, presa
            nota(3, { user_id: ANALISTA }), // presa, do analista
            nota(4, { user_id: OUTRO, status: 'aguardando_comprovante' }), // presa, de outro usuario
            nota(5, { status: 'liberado_rpa_airtop' }), // ja passou da conciliacao
            nota(6, { tipo_documento: 'comprovante' }), // comprovante nao entra
            nota(7, { extrato_origem_id: EXT_NAO_PAUSADO }), // extrato nao pausado
            nota(8, { extrato_origem_id: null }), // sem extrato
            nota(9, { extrato_origem_id: EXT_PAUSADO_SEM_NOTA, status: 'concluido' }), // pausado, mas a nota ja passou
            nota(10, { project_id: PROJ_ORG2, extrato_origem_id: EXT_ORG2 }) // outra organizacao
        ],
        processamento_eventos: [
            { id: 'ev1', entidade: 'extratos', registro_id: EXT_RUIM, acao: 'conciliacao_extrato_pausado', criado_em: '2026-09-12T10:00:00Z', detalhe: 'nota ' + U(101) + ': ' + MENSAGEM },
            { id: 'ev2', entidade: 'extratos', registro_id: EXT_PAUSADO_SEM_NOTA, acao: 'conciliacao_extrato_pausado', criado_em: '2026-08-02T10:00:00Z', detalhe: 'nota ' + U(109) + ': ' + MENSAGEM },
            { id: 'ev3', entidade: 'extratos', registro_id: EXT_ORG2, acao: 'conciliacao_extrato_pausado', criado_em: '2026-09-12T11:00:00Z', detalhe: 'nota x: ' + MENSAGEM },
            { id: 'ev4', entidade: 'documents', registro_id: U(102), acao: 'conciliacao_auto_lote_inicio', criado_em: '2026-09-12T09:00:00Z', detalhe: null }
        ],
        audit_log: []
    };
}

const USUARIOS = {
    'tok-gestor': { id: GESTOR, app_metadata: { role: 'gestor', org_id: ORG } },
    'tok-analista': { id: ANALISTA, app_metadata: { role: 'analista', org_id: ORG } },
    'tok-admin': { id: U(5), app_metadata: { role: 'admin', org_id: ORG } },
    'tok-fornecedor': { id: FORNECEDOR, app_metadata: { role: 'fornecedor', org_id: ORG } },
    'tok-sem-org': { id: GESTOR, app_metadata: { role: 'gestor' } },
    'tok-gestor-org2': { id: U(6), app_metadata: { role: 'gestor', org_id: ORG2 } }
};

const fetchFalso = criarFetchFalso({ obterDb: () => db, usuarios: USUARIOS });
global.fetch = async (url, init) => {
    if (String(url).startsWith('http://fake.local')) return fetchFalso(String(url), init);
    chamadasExternas.push(String(url));
    throw new Error('chamada externa inesperada: ' + url);
};

const app = require('./server.js');
let ok = 0, falhas = 0;
async function teste(nome, fn) {
    zerarBanco();
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

function chamar(porta, metodo, caminho, token, corpo) {
    return new Promise((resolve, reject) => {
        const dados = corpo ? JSON.stringify(corpo) : null;
        const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo,
            headers: { ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
            let texto = '';
            res.on('data', c => { texto += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: texto ? JSON.parse(texto) : null }));
        });
        req.on('error', reject);
        req.end(dados || undefined);
    });
}

const nota = (n) => db.documents.find(d => d.id === U(100 + n));
const ids = (...ns) => ns.map(n => U(100 + n));

(async () => {
    const servidor = http.createServer(app);
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const porta = servidor.address().port;
    const pausados = (token, projeto = PROJ) => chamar(porta, 'GET', '/api/conciliacao/extratos-pausados' + (projeto === null ? '' : '?project_id=' + projeto), token);
    const vincular = (token, corpo) => chamar(porta, 'POST', '/api/conciliacao/vincular-extrato', token, corpo);

    // ---------------------------------------------------------------- GET
    await teste('GET: sem token 401; fornecedor 403; sem organizacao 403; sem projeto ou projeto invalido 400', async () => {
        assert.strictEqual((await pausados(null)).status, 401);
        assert.strictEqual((await pausados('tok-fornecedor')).status, 403);
        assert.strictEqual((await pausados('tok-sem-org')).status, 403);
        assert.strictEqual((await pausados('tok-gestor', null)).status, 400);
        assert.strictEqual((await pausados('tok-gestor', 'nao-e-uuid')).status, 400);
    });

    await teste('GET: projeto de outra organizacao ou inexistente e recusado com 404 (e nada vaza)', async () => {
        const r = await pausados('tok-gestor', PROJ_ORG2);
        assert.strictEqual(r.status, 404);
        assert.ok(!JSON.stringify(r.corpo).includes(EXT_ORG2));
        assert.strictEqual((await pausados('tok-gestor', U(999))).status, 404);
        // e o inverso: o gestor da outra organizacao nao enxerga o projeto da primeira
        assert.strictEqual((await pausados('tok-gestor-org2', PROJ)).status, 404);
        // o gestor da outra organizacao ve o que e dele
        const dele = await pausados('tok-gestor-org2', PROJ_ORG2);
        assert.strictEqual(dele.status, 200);
        assert.deepStrictEqual(dele.corpo.extratos.map(e => e.id), [EXT_ORG2]);
    });

    await teste('GET gestor e admin: extrato pausado com nome, datas, motivo e as notas presas (sem o que nao esta preso)', async () => {
        for (const token of ['tok-gestor', 'tok-admin']) {
            const r = await pausados(token);
            assert.strictEqual(r.status, 200, token);
            assert.strictEqual(r.corpo.project_id, PROJ);
            assert.deepStrictEqual(r.corpo.extratos.map(e => e.id), [EXT_RUIM], 'so o extrato pausado que ainda tem nota presa');
            const e = r.corpo.extratos[0];
            assert.strictEqual(e.nome, 'Extrato_Errado.ofx');
            assert.strictEqual(e.enviado_em, '2026-09-05T15:00:00Z');
            assert.strictEqual(e.pausado_em, '2026-09-12T10:00:00Z');
            assert.strictEqual(e.motivo, MENSAGEM, 'sem o prefixo "nota <id>:"');
            assert.deepStrictEqual(e.notas.map(n => n.id).sort(), ids(1, 2, 3, 4).sort(), 'divergencia, fila e comprovante; sem concluida, comprovante-documento, outro extrato ou sem extrato');
            const n1 = e.notas.find(n => n.id === U(101));
            assert.deepStrictEqual(n1, { id: U(101), nome: 'nota1.pdf', numero_nf: '4001', nome_emissor: 'Fornecedor 1', valor: 100, data_emissao: '2026-09-02', status: 'divergencia_beneficiario' });
            assert.ok(!JSON.stringify(r.corpo).includes('just_erro'), 'o texto do erro da nota nao e devolvido por nota');
        }
    });

    await teste('GET analista: so as notas dele; sem nota dele, o extrato nem aparece', async () => {
        const r = await pausados('tok-analista');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo.extratos.map(e => e.notas.map(n => n.id)), [ids(3)]);
        // o analista sem nenhuma nota presa
        nota(3).user_id = GESTOR;
        const vazio = await pausados('tok-analista');
        assert.deepStrictEqual(vazio.corpo.extratos, []);
    });

    await teste('GET: sem evento de pausa, ou pausa sem nota presa, devolve lista vazia; projeto sem extratos tambem', async () => {
        db.processamento_eventos = db.processamento_eventos.filter(e => e.acao !== 'conciliacao_extrato_pausado');
        assert.deepStrictEqual((await pausados('tok-gestor')).corpo.extratos, []);
        zerarBanco();
        db.documents.forEach(d => { d.status = 'concluido'; });
        assert.deepStrictEqual((await pausados('tok-gestor')).corpo.extratos, []);
        assert.deepStrictEqual((await pausados('tok-gestor', PROJ_SEM)).corpo.extratos, []);
    });

    await teste('GET: depois que as notas trocam de extrato, o aviso some (pausa e do extrato, nao da nota)', async () => {
        db.documents.forEach(d => { if (d.extrato_origem_id === EXT_RUIM) d.extrato_origem_id = EXT_BOM; });
        assert.deepStrictEqual((await pausados('tok-gestor')).corpo.extratos, []);
    });

    await teste('GET: nao chama o n8n nem grava nada', async () => {
        const antes = JSON.stringify(db);
        await pausados('tok-gestor');
        assert.strictEqual(JSON.stringify(db), antes);
        assert.deepStrictEqual(chamadasExternas, []);
    });

    // ---------------------------------------------------------------- POST (revinculacao)
    await teste('vincular: notas presas ao extrato pausado, inclusive a que disparou a pausa, sao revinculadas', async () => {
        const r = await vincular('tok-gestor', { extrato_id: EXT_BOM, document_ids: ids(1, 2, 3, 4), incluir_divergencias: true });
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo.resumo, { vinculadas: 4, puladas: 0, recusadas: 0 });
        for (const i of r.corpo.itens) assert.strictEqual(i.motivo, 'Vinculada; substitui o extrato de outro projeto.', i.id);
        for (const n of [1, 2, 3, 4]) assert.strictEqual(nota(n).extrato_origem_id, EXT_BOM, 'nota' + n);
        // a que disparou a pausa volta para a conciliacao e perde o alerta
        assert.strictEqual(nota(1).status, 'aguardando_conciliacao_bancaria');
        assert.strictEqual(nota(1).just_erro, null);
        assert.strictEqual(nota(4).status, 'aguardando_comprovante', 'as demais mantem o status');
        // auditoria com o extrato anterior e o novo
        const aud = db.audit_log.filter(a => a.campo === 'extrato_origem_id');
        assert.strictEqual(aud.length, 4);
        assert.ok(aud.every(a => a.valor_anterior === EXT_RUIM && a.valor_novo === EXT_BOM && a.origem === 'vincular_extrato'));
        // depois disso o aviso some
        assert.deepStrictEqual((await pausados('tok-gestor')).corpo.extratos, []);
        assert.deepStrictEqual(chamadasExternas, []);
    });

    await teste('vincular: a nota que disparou a pausa continua pulada sem a confirmacao de divergencia', async () => {
        const r = await vincular('tok-gestor', { extrato_id: EXT_BOM, document_ids: ids(1, 2), incluir_divergencias: false });
        assert.deepStrictEqual(r.corpo.resumo, { vinculadas: 1, puladas: 1, recusadas: 0 });
        assert.strictEqual(r.corpo.itens[0].resultado, 'pulada');
        assert.strictEqual(nota(1).extrato_origem_id, EXT_RUIM);
        assert.strictEqual(nota(2).extrato_origem_id, EXT_BOM);
    });

    await teste('vincular: nota presa a extrato que NAO esta pausado continua pulada como hoje', async () => {
        const r = await vincular('tok-gestor', { extrato_id: EXT_BOM, document_ids: ids(7), incluir_divergencias: true });
        assert.deepStrictEqual(r.corpo.resumo, { vinculadas: 0, puladas: 1, recusadas: 0 });
        assert.strictEqual(r.corpo.itens[0].motivo, 'Já vinculada a outro extrato.');
        assert.strictEqual(nota(7).extrato_origem_id, EXT_NAO_PAUSADO);
        assert.strictEqual(db.audit_log.length, 0);
    });

    await teste('vincular: sem nenhum evento de pausa tudo se comporta como antes (pulada)', async () => {
        db.processamento_eventos = db.processamento_eventos.filter(e => e.acao !== 'conciliacao_extrato_pausado');
        const r = await vincular('tok-gestor', { extrato_id: EXT_BOM, document_ids: ids(1, 2), incluir_divergencias: true });
        assert.deepStrictEqual(r.corpo.resumo, { vinculadas: 0, puladas: 2, recusadas: 0 });
    });

    await teste('vincular: o analista so revincula as notas dele, mesmo com o extrato pausado', async () => {
        const r = await vincular('tok-analista', { extrato_id: EXT_BOM, document_ids: ids(2, 3), incluir_divergencias: true });
        assert.deepStrictEqual(r.corpo.itens.map(i => [i.resultado]), [['recusada'], ['vinculada']]);
        assert.strictEqual(nota(2).extrato_origem_id, EXT_RUIM);
        assert.strictEqual(nota(3).extrato_origem_id, EXT_BOM);
    });

    servidor.close();
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
