// Teste da exclusao logica de documentos (ocorrencia achada ao investigar o #122): excluir so oculta
// (documents.excluido_em/excluido_por), nunca apaga do Storage nem do banco.
//  Parte 1 - servidor (server.js de verdade, Supabase falso em memoria, chamado por HTTP):
//    POST /api/documentos/ocultar e /restaurar, GET /api/documentos/excluidos e /:id/exclusao:
//    perfil (so admin oculta e restaura; gestor e analista leem o aviso), organizacao, auditoria, nada apagado; filtro nas listagens do servidor.
//  Parte 2 - front (funcoes recortadas do app.js, tela e Supabase falsos):
//    os tres botoes de excluir nao chamam storage.remove nem delete(); listagens excluem os ocultos;
//    restaurar; nota oculta aberta direto mostra o aviso; sem permissao nao ha aba Excluidos nem Restaurar.
// Uso: node teste-exclusao-documentos.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { criarFetchFalso } = require('./teste-banco-falso.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = U(900), ORG2 = U(901);
const PROJ = U(10), PROJ2 = U(11), PROJ_ORG2 = U(12);
const ADMIN = U(1), GESTOR = U(2), ANALISTA = U(3), OUTRO = U(4), FORNECEDOR = U(5), ADMIN_ORG2 = U(6);

let db;
const requisicoes = [];
function zerarBanco() {
    const doc = (n, extra) => ({
        id: U(100 + n), name: 'doc' + n + '.pdf', file_path: 'p/u/doc' + n + '.pdf', project_id: PROJ, organization_id: ORG,
        user_id: GESTOR, tipo_documento: 'nf', status: 'aguardando_conciliacao_bancaria', extrato_origem_id: null,
        excluido_em: null, excluido_por: null, updated_at: '2026-01-01T00:00:00Z', ...extra
    });
    db = {
        projects: [
            { id: PROJ, organization_id: ORG, pronac: '251234', nome: 'Projeto A' },
            { id: PROJ2, organization_id: ORG, pronac: '259999', nome: 'Projeto B' },
            { id: PROJ_ORG2, organization_id: ORG2, pronac: '111111', nome: 'Outra org' }
        ],
        documents: [
            doc(1), doc(2), doc(3, { user_id: ANALISTA }),
            doc(4, { excluido_em: '2026-10-20T13:00:00Z', excluido_por: ADMIN }),
            doc(5, { project_id: PROJ2, excluido_em: '2026-10-21T13:00:00Z', excluido_por: GESTOR }),
            doc(6, { project_id: PROJ_ORG2, organization_id: ORG2 }),
            doc(7, { project_id: PROJ_ORG2, organization_id: ORG2, excluido_em: '2026-10-22T13:00:00Z', excluido_por: ADMIN_ORG2 }),
            doc(8, { extrato_origem_id: U(20), updated_at: '2020-01-01T00:00:00Z' }),
            doc(9, { extrato_origem_id: U(20), updated_at: '2020-01-01T00:00:00Z', excluido_em: '2026-10-22T13:00:00Z', excluido_por: ADMIN })
        ],
        extratos: [{ id: U(20), project_id: PROJ, organization_id: ORG, status: 'processado', file_path: 'p/u/ext.ofx' }],
        processamento_eventos: [],
        audit_log: []
    };
}

const USUARIOS = {
    'tok-admin': { id: ADMIN, email: 'admin@org.com', app_metadata: { role: 'admin', org_id: ORG } },
    'tok-gestor': { id: GESTOR, email: 'gestor@org.com', app_metadata: { role: 'gestor', org_id: ORG } },
    'tok-analista': { id: ANALISTA, email: 'analista@org.com', app_metadata: { role: 'analista', org_id: ORG } },
    'tok-fornecedor': { id: FORNECEDOR, app_metadata: { role: 'fornecedor', org_id: ORG } },
    'tok-sem-org': { id: ADMIN, app_metadata: { role: 'admin' } },
    'tok-admin-org2': { id: ADMIN_ORG2, email: 'admin@org2.com', app_metadata: { role: 'admin', org_id: ORG2 } }
};

const fetchFalso = criarFetchFalso({ obterDb: () => db, usuarios: USUARIOS });
global.fetch = async (url, init = {}) => {
    const u = String(url);
    requisicoes.push({ url: u, metodo: (init.method || 'GET').toUpperCase() });
    if (u.startsWith('http://fake.local')) return fetchFalso(u, init);
    throw new Error('chamada externa inesperada: ' + u);
};
process.env.CRON_SECRET = 'segredo';

const app = require('./server.js');
let ok = 0, falhas = 0;
async function teste(nome, fn) {
    zerarBanco();
    requisicoes.length = 0;
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

function chamar(porta, metodo, caminho, token, corpo, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const dados = corpo ? JSON.stringify(corpo) : null;
        const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo,
            headers: { ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extraHeaders } }, (res) => {
            let texto = '';
            res.on('data', c => { texto += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: texto ? JSON.parse(texto) : null }));
        });
        req.on('error', reject);
        req.end(dados || undefined);
    });
}

const doc = (n) => db.documents.find(d => d.id === U(100 + n));
const ids = (...ns) => ns.map(n => U(100 + n));
const nadaApagado = () => {
    assert.ok(!requisicoes.some(r => r.metodo === 'DELETE'), 'nenhum DELETE no banco nem no Storage');
    assert.ok(!requisicoes.some(r => r.url.includes('/storage/')), 'nada no Storage');
};

// ---------------------------------------------------------------- front (recortes do app.js)
const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio);
    assert.ok(i >= 0, 'nao encontrado no app.js: ' + inicio);
    const j = SRC.indexOf(fecho, i);
    assert.ok(j > i, 'fim nao encontrado para: ' + inicio);
    return SRC.slice(i, j + fecho.length);
}
const FIM_W = '\n};\n', FIM_F = '\n}\n';
const CODIGO_FRONT = [
    bloco('window.showConfirmModal = function', FIM_W),
    bloco('window.closeConfirmModal = function', FIM_W),
    bloco('window.__execConfirmModal = function', FIM_W),
    bloco('function escHtml(', FIM_F),
    bloco('function getUserRole(', FIM_F),
    bloco('function userCanDelete(', FIM_F),
    bloco('window.handleDeleteDocument = async function', FIM_W),
    bloco('async function alterarExclusaoDocumentos(', FIM_F),
    bloco('async function fetchDocumentosExcluidos(', FIM_F),
    bloco('window.handleRestaurarDocumento = async function', FIM_W),
    bloco('async function carregarInfoExclusao(', FIM_F),
    bloco('function fmtDataHoraExclusao(', FIM_F),
    bloco('function quemExcluiu(', FIM_F),
    bloco('function DocumentoExcluidoView(', FIM_F),
    bloco('const DocumentosExcluidosView = () => {', FIM_W),
    bloco('window.handleDeleteSelectedDocuments = async function', FIM_W),
    bloco('window.handleExcluirLoteItem = async function', FIM_W),
    bloco('async function fetchUploadLoteQueue(', FIM_F),
    bloco('const DetailsView = () => {', '\n    const steps = [').slice(0, -'\n    const steps = ['.length)
        + '\n    return "TELA NORMAL";\n};\n'
].join('\n');

const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

// Supabase do navegador falso: a tabela documents aplica eq/is como o PostgREST; storage e delete so registram.
function criarFront({ role = 'admin', userId = ADMIN, respostaServidor = null, documentos = null, checkboxes = [] } = {}) {
    const log = { storageRemove: [], deletes: [], updates: [], posts: [], gets: [], toasts: [], renders: 0, fetchDocuments: 0 };
    const tabela = documentos || [];
    const supabaseClient = {
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
        storage: { from: () => ({ remove: async (lista) => { log.storageRemove.push(lista); return { error: null }; } }) },
        from: (nome) => {
            const filtros = [];
            const op = { acao: 'select' };
            const api = {
                select() { return api; }, order() { return api; },
                eq(c, v) { filtros.push(r => r[c] === v); return api; },
                is(c, v) { filtros.push(r => (v === null ? r[c] == null : r[c] === v)); return api; },
                delete() { op.acao = 'delete'; log.deletes.push(nome); return api; },
                update(d) { op.acao = 'update'; log.updates.push({ nome, d }); return api; },
                then(res, rej) { return Promise.resolve({ data: tabela.filter(r => filtros.every(f => f(r))), error: null }).then(res, rej); }
            };
            return api;
        }
    };
    const state = {
        user: { id: userId, app_metadata: { role } }, loading: false, confirmModal: null, currentView: 'dashboard',
        currentDocument: null, documents: [], projects: [{ id: PROJ, pronac: '251234', nome: 'Projeto A' }],
        filters: { project: '' }, documentosExcluidos: { carregando: false, lista: [], erro: null }, exclusaoDocumento: null, uploadLoteQueue: []
    };
    const ctx = {
        state, supabaseClient, console: { log() { }, error() { }, warn() { } }, encodeURIComponent,
        window: {},
        render: () => { log.renders++; },
        showToast: (m, t) => log.toasts.push({ m, t }),
        Sidebar: () => '',
        caminhoStorage: (p) => p,
        fetchDocuments: async () => { log.fetchDocuments++; },
        fetchDocumentDetails: async () => { },
        document: { querySelectorAll: () => checkboxes.map(id => ({ getAttribute: (a) => (a === 'data-id' ? id : 'p/u/' + id + '.pdf') })) },
        fetch: async (url, init = {}) => {
            if ((init.method || 'GET') === 'POST') {
                const corpo = JSON.parse(init.body);
                log.posts.push({ url, corpo });
                const r = respostaServidor ? respostaServidor(url, corpo) : { ok: true, alterados: corpo.document_ids.length, itens: corpo.document_ids.map(id => ({ id, resultado: url.endsWith('restaurar') ? 'restaurado' : 'ocultado' })) };
                return { ok: true, status: 200, json: async () => r };
            }
            log.gets.push(url);
            if (url.includes('/exclusao')) return { ok: true, status: 200, json: async () => ({ ok: true, excluido_em: '2026-10-20T13:00:00Z', excluido_por: { id: GESTOR, email: 'gestor@org.com' } }) };
            return { ok: true, status: 200, json: async () => ({ ok: true, documentos: [{ id: U(104), name: 'doc4.pdf', project: { id: PROJ, pronac: '251234', nome: 'Projeto A' }, excluido_em: '2026-10-20T13:00:00Z', excluido_por: { id: GESTOR, email: 'gestor@org.com' } }] }) };
        }
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO_FRONT + '\n;Object.assign(this, { DetailsView, DocumentosExcluidosView, fetchUploadLoteQueue, fetchDocumentosExcluidos });', ctx);
    ctx.window.showToast = ctx.showToast;
    return { ctx, state, log };
}

(async () => {
    const servidor = http.createServer(app);
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const porta = servidor.address().port;
    const post = (rota, token, corpo) => chamar(porta, 'POST', rota, token, corpo);
    const get = (rota, token) => chamar(porta, 'GET', rota, token);

    // ======================================================== servidor
    await teste('ocultar: grava excluido_em/excluido_por, audita e nao apaga nada (linha e arquivo continuam)', async () => {
        const r = await post('/api/documentos/ocultar', 'tok-admin', { document_ids: ids(1, 2) });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.alterados, 2);
        assert.deepStrictEqual(r.corpo.itens.map(i => i.resultado), ['ocultado', 'ocultado']);
        for (const n of [1, 2]) {
            assert.ok(doc(n), 'a linha continua no banco');
            assert.ok(doc(n).excluido_em, 'excluido_em preenchido');
            assert.strictEqual(doc(n).excluido_por, ADMIN);
            assert.strictEqual(doc(n).file_path, 'p/u/doc' + n + '.pdf', 'o caminho do arquivo nao muda');
            assert.strictEqual(doc(n).status, 'aguardando_conciliacao_bancaria', 'o status nao muda');
        }
        assert.strictEqual(db.documents.length, 9);
        const aud = db.audit_log;
        assert.strictEqual(aud.length, 2);
        assert.ok(aud.every(a => a.tabela === 'documents' && a.campo === 'excluido_em' && a.valor_anterior === null && a.valor_novo && a.alterado_por === ADMIN && a.origem === 'ocultar_documento'));
        nadaApagado();
    });

    await teste('ocultar: so admin (igual a tela); gestor, analista (ate no proprio documento), fornecedor e sem organizacao recebem 403', async () => {
        assert.strictEqual((await post('/api/documentos/ocultar', null, { document_ids: ids(1) })).status, 401);
        assert.strictEqual((await post('/api/documentos/ocultar', 'tok-fornecedor', { document_ids: ids(1) })).status, 403);
        assert.strictEqual((await post('/api/documentos/ocultar', 'tok-sem-org', { document_ids: ids(1) })).status, 403);
        const gestor = await post('/api/documentos/ocultar', 'tok-gestor', { document_ids: ids(1, 2) });
        assert.strictEqual(gestor.status, 403);
        assert.strictEqual(gestor.corpo.error, 'Apenas administradores podem excluir documentos.');
        const analistaProprio = await post('/api/documentos/ocultar', 'tok-analista', { document_ids: ids(3) });
        assert.strictEqual(analistaProprio.status, 403, 'nem o documento que o proprio analista enviou');
        assert.strictEqual(analistaProprio.corpo.error, 'Apenas administradores podem excluir documentos.');
        assert.strictEqual(doc(1).excluido_em, null);
        assert.strictEqual(doc(2).excluido_em, null);
        assert.strictEqual(doc(3).excluido_em, null);
        assert.strictEqual(db.audit_log.length, 0);
        // admin continua ocultando
        assert.strictEqual((await post('/api/documentos/ocultar', 'tok-admin', { document_ids: [] })).status, 400);
        assert.strictEqual((await post('/api/documentos/ocultar', 'tok-admin', { document_ids: ['nao-uuid'] })).status, 400);
        const admin = await post('/api/documentos/ocultar', 'tok-admin', { document_ids: ids(1, 3) });
        assert.deepStrictEqual(admin.corpo.itens.map(i => i.resultado), ['ocultado', 'ocultado']);
        assert.ok(doc(1).excluido_em && doc(3).excluido_em);
    });

    await teste('ocultar: outra organizacao e inexistente dao a mesma resposta (nao encontrado)', async () => {
        const outraOrg = await post('/api/documentos/ocultar', 'tok-admin', { document_ids: ids(6, 99) });
        assert.deepStrictEqual(outraOrg.corpo.itens.map(i => [i.resultado, i.motivo]), [['recusado', 'Documento não encontrado.'], ['recusado', 'Documento não encontrado.']]);
        assert.strictEqual(doc(6).excluido_em, null);
    });

    await teste('ocultar: ja oculto e ignorado (sem nova auditoria)', async () => {
        const r = await post('/api/documentos/ocultar', 'tok-admin', { document_ids: ids(4) });
        assert.deepStrictEqual(r.corpo.itens.map(i => i.resultado), ['ignorado']);
        assert.strictEqual(doc(4).excluido_por, ADMIN);
        assert.strictEqual(db.audit_log.length, 0);
    });

    await teste('restaurar: so admin; limpa as duas colunas, audita e o documento volta', async () => {
        assert.strictEqual((await post('/api/documentos/restaurar', 'tok-gestor', { document_ids: ids(4) })).status, 403);
        assert.strictEqual((await post('/api/documentos/restaurar', 'tok-analista', { document_ids: ids(4) })).status, 403);
        const r = await post('/api/documentos/restaurar', 'tok-admin', { document_ids: ids(4, 1) });
        assert.deepStrictEqual(r.corpo.itens.map(i => i.resultado), ['restaurado', 'ignorado']);
        assert.strictEqual(doc(4).excluido_em, null);
        assert.strictEqual(doc(4).excluido_por, null);
        assert.deepStrictEqual(db.audit_log.map(a => [a.origem, a.valor_anterior, a.valor_novo]), [['restaurar_documento', '2026-10-20T13:00:00Z', null]]);
        // outra organizacao nao restaura
        const outra = await post('/api/documentos/restaurar', 'tok-admin', { document_ids: ids(7) });
        assert.strictEqual(outra.corpo.itens[0].resultado, 'recusado');
        assert.ok(doc(7).excluido_em);
        nadaApagado();
    });

    await teste('excluidos: so admin; lista os ocultos da organizacao com projeto, quem e quando; filtro por projeto', async () => {
        assert.strictEqual((await get('/api/documentos/excluidos', 'tok-gestor')).status, 403);
        assert.strictEqual((await get('/api/documentos/excluidos', 'tok-analista')).status, 403);
        const r = await get('/api/documentos/excluidos', 'tok-admin');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo.documentos.map(d => d.id).sort(), ids(4, 5, 9).sort(), 'so ocultos e so da organizacao');
        const d5 = r.corpo.documentos.find(d => d.id === U(105));
        assert.deepStrictEqual(d5.project, { id: PROJ2, pronac: '259999', nome: 'Projeto B' });
        assert.deepStrictEqual(d5.excluido_por, { id: GESTOR, email: 'gestor@org.com' });
        assert.strictEqual(d5.excluido_em, '2026-10-21T13:00:00Z');
        const porProjeto = await get('/api/documentos/excluidos?project_id=' + PROJ, 'tok-admin');
        assert.deepStrictEqual(porProjeto.corpo.documentos.map(d => d.id).sort(), ids(4, 9).sort());
        assert.strictEqual((await get('/api/documentos/excluidos?project_id=' + PROJ_ORG2, 'tok-admin')).status, 404);
        assert.strictEqual((await get('/api/documentos/excluidos?project_id=x', 'tok-admin')).status, 400);
    });

    await teste('exclusao/:id: quem e quando; outra organizacao e analista com nota de outro recebem 404', async () => {
        const r = await get('/api/documentos/' + U(104) + '/exclusao', 'tok-gestor');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo, { ok: true, excluido_em: '2026-10-20T13:00:00Z', excluido_por: { id: ADMIN, email: 'admin@org.com' } });
        const normal = await get('/api/documentos/' + U(101) + '/exclusao', 'tok-gestor');
        assert.deepStrictEqual([normal.corpo.excluido_em, normal.corpo.excluido_por], [null, null]);
        assert.strictEqual((await get('/api/documentos/' + U(107) + '/exclusao', 'tok-admin')).status, 404);
        assert.strictEqual((await get('/api/documentos/' + U(104) + '/exclusao', 'tok-analista')).status, 404);
        assert.strictEqual((await get('/api/documentos/' + U(104) + '/exclusao', 'tok-fornecedor')).status, 403);
        // gestor e analista continuam lendo o aviso (analista so nas notas que enviou)
        for (const token of ['tok-gestor', 'tok-admin']) assert.strictEqual((await get('/api/documentos/' + U(104) + '/exclusao', token)).status, 200, token);
        doc(4).user_id = ANALISTA;
        const doAnalista = await get('/api/documentos/' + U(104) + '/exclusao', 'tok-analista');
        assert.strictEqual(doAnalista.status, 200);
        assert.deepStrictEqual(doAnalista.corpo.excluido_por, { id: ADMIN, email: 'admin@org.com' });
    });

    await teste('servidor: a fila de conciliacao e a vincular-extrato deixam de fora os ocultos', async () => {
        // cron: so a nota 8 (a 9 e oculta) e candidata
        const cron = await chamar(porta, 'POST', '/api/m1/cron-conciliacao-lote', null, null, { 'x-cron-secret': 'segredo' });
        assert.strictEqual(cron.status, 200);
        const cronUrl = requisicoes.find(x => x.url.includes('/rest/v1/documents') && x.url.includes('extrato_origem_id=not.is.null'));
        assert.ok(cronUrl && cronUrl.url.includes('excluido_em=is.null'), 'a consulta da fila filtra os ocultos');
        // vincular-extrato: nota oculta vira "Nota nao encontrada."
        const v = await post('/api/conciliacao/vincular-extrato', 'tok-admin', { extrato_id: U(20), document_ids: ids(4, 1) });
        assert.strictEqual(v.status, 200);
        assert.deepStrictEqual(v.corpo.itens.map(i => [i.resultado, i.motivo]), [['recusada', 'Nota não encontrada.'], ['vinculada', 'Vinculada; entra na fila de conciliação.']]);
        assert.strictEqual(doc(4).extrato_origem_id, null);
    });

    servidor.close();

    // ======================================================== front
    await teste('front: excluir um documento nao chama storage.remove nem delete; chama a rota de ocultar', async () => {
        const { ctx, state, log } = criarFront();
        await ctx.window.handleDeleteDocument(U(101), 'p/u/doc1.pdf');
        assert.ok(state.confirmModal, 'continua pedindo confirmacao');
        assert.ok(!/não pode ser desfeita/.test(state.confirmModal.message), 'sem "nao pode ser desfeita"');
        assert.ok(/restaurado/.test(state.confirmModal.message));
        assert.strictEqual(log.posts.length, 0, 'nada antes de confirmar');
        ctx.window.__execConfirmModal();
        await tick();
        assert.deepStrictEqual(log.storageRemove, []);
        assert.deepStrictEqual(log.deletes, []);
        assert.deepStrictEqual(log.posts.map(p => [p.url, p.corpo]), [['/api/documentos/ocultar', { document_ids: [U(101)] }]]);
        assert.strictEqual(log.fetchDocuments, 1);
        assert.strictEqual(state.loading, false);
        assert.ok(log.toasts.some(t => t.t === 'success'));
    });

    await teste('front: excluir em lote (tela normal) e na fila de upload em lote tambem so ocultam', async () => {
        let { ctx, state, log } = criarFront({ checkboxes: [U(101), U(102), U(101)] });
        await ctx.window.handleDeleteSelectedDocuments();
        assert.ok(!/não pode ser desfeita/.test(state.confirmModal.message));
        assert.ok(state.confirmModal.message.includes('os 2 documentos'));
        ctx.window.__execConfirmModal();
        await tick();
        assert.deepStrictEqual(log.storageRemove, []);
        assert.deepStrictEqual(log.deletes, []);
        assert.deepStrictEqual(log.posts.map(p => p.corpo.document_ids), [[U(101), U(102)]], 'cada id uma vez');

        ({ ctx, state, log } = criarFront({ role: 'analista', userId: ANALISTA }));
        await ctx.window.handleExcluirLoteItem(U(103), 'p/u/doc3.pdf');
        assert.ok(!/não pode ser desfeita/.test(state.confirmModal.message));
        ctx.window.__execConfirmModal();
        await tick();
        assert.deepStrictEqual(log.storageRemove, []);
        assert.deepStrictEqual(log.deletes, []);
        assert.deepStrictEqual(log.posts.map(p => [p.url, p.corpo]), [['/api/documentos/ocultar', { document_ids: [U(103)] }]]);
    });

    await teste('front: cancelar nao oculta; servidor recusando mostra o motivo', async () => {
        let { ctx, state, log } = criarFront();
        await ctx.window.handleDeleteDocument(U(101), 'x');
        ctx.window.closeConfirmModal();
        await tick();
        assert.strictEqual(log.posts.length, 0);
        ({ ctx, state, log } = criarFront({ respostaServidor: () => ({ ok: true, alterados: 0, itens: [{ id: U(101), resultado: 'recusado', motivo: 'Documento não encontrado.' }] }) }));
        await ctx.window.handleDeleteDocument(U(101), 'x');
        ctx.window.__execConfirmModal();
        await tick();
        assert.ok(log.toasts.some(t => t.t === 'error' && t.m === 'Documento não encontrado.'));
    });

    await teste('front: a fila de lote nao mostra o arquivo oculto (filtro aplicado na consulta)', async () => {
        const docs = [
            { id: 'a', user_id: ADMIN, status: 'aguardando_rubrica', excluido_em: null },
            { id: 'b', user_id: ADMIN, status: 'aguardando_rubrica', excluido_em: '2026-10-20T13:00:00Z' }
        ];
        const { ctx, state } = criarFront({ documentos: docs });
        await ctx.fetchUploadLoteQueue();
        assert.deepStrictEqual(state.uploadLoteQueue.map(d => d.id), ['a']);
    });

    await teste('front: listagens normais filtram os ocultos (codigo-fonte)', () => {
        const casos = [
            ['async function fetchDocuments()', "select('*').is('excluido_em', null)"],
            ['async function fetchSolicitanteDashboard()', ".is('excluido_em', null)"],
            ['async function fetchUploadLoteQueue()', ".is('excluido_em', null)"],
            ['async function fetchProjects()', ".is('excluido_em', null)"],
            ['async function generateLaudoExcel(projectId)', ".is('excluido_em', null)"],
            ['async function executarEnvioSalic(', ".in('status', ['liberado_rpa_airtop', 'enviado_salic', 'concluido']).is('excluido_em', null)"]
        ];
        for (const [inicio, trecho] of casos) assert.ok(bloco(inicio, FIM_F).includes(trecho), inicio);
        assert.ok(/\.eq\('nf_vinculada_id', id\)\n\s+\.is\('excluido_em', null\)/.test(SRC), 'comprovante do detalhe');
        assert.ok(/state\.filters\.project\)\.in\('status', \['liberado_rpa_airtop', 'enviado_salic', 'concluido'\]\)\.is\('excluido_em', null\)/.test(SRC), 'IN 23 do navigate');
        // nenhum delete em documents e nenhum storage.remove fora do upload que falhou ao gravar a linha
        assert.ok(!/from\('documents'\)\s*\.delete\(\)/.test(SRC), 'nenhum delete em documents');
        assert.strictEqual((SRC.match(/\.storage\.from\('documentos'\)\.remove\(|\.from\('documentos'\)\s*\.remove\(/g) || []).length, 1, 'so a limpeza do arquivo orfao no upload que falhou');
        // realtime: documento ocultado por outra pessoa sai da lista
        assert.ok(/if \(payload\.new\.excluido_em\) \{\n\s+const estava/.test(SRC));
    });

    await teste('front: restaurar chama a rota e recarrega a aba; sem permissao nao restaura', async () => {
        let { ctx, state, log } = criarFront();
        state.currentView = 'documentos_excluidos';
        await ctx.window.handleRestaurarDocumento(U(104));
        assert.deepStrictEqual(log.posts.map(p => [p.url, p.corpo]), [['/api/documentos/restaurar', { document_ids: [U(104)] }]]);
        assert.ok(log.gets.some(u => u.startsWith('/api/documentos/excluidos')), 'recarrega a lista de excluidos');
        assert.strictEqual(log.fetchDocuments, 1, 'e a lista normal');
        assert.strictEqual(state.loading, false);
        ({ ctx, state, log } = criarFront({ role: 'gestor', userId: GESTOR }));
        await ctx.window.handleRestaurarDocumento(U(104));
        assert.strictEqual(log.posts.length, 0);
    });

    await teste('front: aba Excluidos mostra nome, projeto, quem e quando, com Restaurar; sem permissao nao mostra', async () => {
        let { ctx, state } = criarFront();
        await ctx.fetchDocumentosExcluidos();
        let h = ctx.DocumentosExcluidosView();
        assert.ok(h.includes('doc4.pdf') && h.includes('251234 - Projeto A') && h.includes('gestor@org.com') && h.includes('20/10/2026'));
        assert.ok(h.includes("handleRestaurarDocumento('" + U(104) + "')"));
        ({ ctx, state } = criarFront({ role: 'gestor', userId: GESTOR }));
        state.documentosExcluidos.lista = [{ id: U(104), name: 'doc4.pdf' }];
        h = ctx.DocumentosExcluidosView();
        assert.ok(!h.includes('Restaurar') && !h.includes('doc4.pdf'));
        // botao da aba so para quem pode excluir; navegar so carrega para quem pode
        assert.ok(SRC.includes("${userCanDelete() ? `<button class=\"btn btn-secondary\" id=\"btn-documentos-excluidos\""));
        assert.ok(/view === 'documentos_excluidos'\) \{\n\s+if \(userCanDelete\(\)\)/.test(SRC));
    });

    await teste('front: nota oculta aberta direto mostra o aviso com quem e quando; Restaurar so para quem pode', async () => {
        let { ctx, state, log } = criarFront();
        state.currentView = 'details';
        state.currentDocument = { id: U(104), name: 'doc4.pdf', excluido_em: '2026-10-20T13:00:00Z', excluido_por: GESTOR };
        let h = ctx.DetailsView();
        assert.ok(h.includes('Este documento foi excluído (ocultado).'));
        assert.ok(h.includes('20/10/2026'));
        assert.ok(h.includes('Excluído por um usuário da organização'), 'antes de saber o e-mail');
        assert.ok(h.includes('Restaurar'));
        // o e-mail chega do servidor
        vm.runInContext('carregarInfoExclusao(state.currentDocument.id)', ctx);
        await tick();
        h = ctx.DetailsView();
        assert.ok(h.includes('Excluído por gestor@org.com'), h);
        // quem excluiu foi o proprio usuario
        state.currentDocument.excluido_por = ADMIN;
        assert.ok(ctx.DetailsView().includes('Excluído por você'));
        // documento normal continua com a tela normal
        state.currentDocument = { id: U(101), excluido_em: null };
        assert.strictEqual(ctx.DetailsView(), 'TELA NORMAL');
        // sem permissao: aviso sem Restaurar
        ({ ctx, state } = criarFront({ role: 'analista', userId: ANALISTA }));
        state.currentDocument = { id: U(104), name: 'doc4.pdf', excluido_em: '2026-10-20T13:00:00Z', excluido_por: GESTOR };
        h = ctx.DetailsView();
        assert.ok(h.includes('Este documento foi excluído (ocultado).') && !h.includes('Restaurar'));
        assert.ok(h.includes('um administrador pode restaurá-lo'));
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
