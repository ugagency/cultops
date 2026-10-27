// Teste do front da ocorrencia #127 (extrato de outro projeto pausado pela fila), sem navegador e sem
// rede: as funcoes sao recortadas do app.js e rodam em um contexto com Supabase, fetch e tela falsos.
//  - aviso no topo da lista de Documentos e da tela de lote, com quantidade de notas, motivo e botao;
//  - selo "Extrato de outro projeto" no lugar de "Na fila de conciliacao" (so com a informacao do servidor);
//  - botao abre a janela Vincular extrato com as notas presas ja selecionadas e a reconferencia marcada;
//  - depois de vincular, o aviso e recarregado; falha da consulta mantem o comportamento de antes.
// Uso: node teste-extrato-pausado-front.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const V = require('./vinculo-extrato.js');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function recorta(ini, fim) {
    const i = SRC.indexOf(ini);
    const j = SRC.indexOf(fim, i);
    assert.ok(i >= 0 && j > i, 'trecho nao encontrado no app.js: ' + ini);
    return SRC.slice(i, j);
}

const CODIGO = recorta('function escHtml(', '// "PRODUTO')
    + recorta('function userPodeVincularExtrato', 'window.handleAbrirVincularExtrato')
    + recorta('async function abrirJanelaVincular', 'const VincularExtratoModal')
    + recorta('const VincularExtratoModal', 'window.handleSelectAllDashboardDocs')
    + recorta('window.vincularExtratoConfirmar = ', 'const VincularExtratoModal');

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const deepEq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

const PROJ = 'proj-1';
const EXT_RUIM = 'ext-ruim';
const nota = (extra) => ({ id: 'n1', nome: 'nota1.pdf', numero_nf: '4001', nome_emissor: 'Fornecedor SA', valor: 100, data_emissao: '2026-09-02', status: 'aguardando_conciliacao_bancaria', ...extra });
const EXTRATO_PAUSADO = (extra = {}) => ({
    id: EXT_RUIM, nome: 'Extrato_Errado.ofx', enviado_em: '2026-09-05T15:00:00Z', pausado_em: '2026-09-12T10:00:00Z',
    motivo: 'Extrato de outro projeto: o PRONAC do extrato (111111) não confere com o do projeto (222222).',
    notas: [nota({ id: 'n1', status: 'divergencia_beneficiario' }), nota({ id: 'n2', nome: 'nota2.pdf', numero_nf: '4002' }), nota({ id: 'n3', nome: 'nota3.pdf', numero_nf: '4003' })],
    ...extra
});

function criarAmbiente(opcoes = {}) {
    const chamadas = { fetch: [], extratosSelect: [], renders: 0, fetchDocuments: 0, toasts: [] };
    const ctx = {
        window: { VinculoExtrato: V },
        state: { documents: [], projects: [{ id: PROJ, pronac: '251234' }], extratosPausados: opcoes.pausados || {}, vincularExtrato: null, user: { id: 'u1' }, filters: { project: PROJ } },
        getUserRole: () => opcoes.role || 'gestor',
        STATUS_MAP: { divergencia_beneficiario: { label: 'Divergência de Beneficiário' }, aguardando_conciliacao_bancaria: { label: 'Falta Conciliação' } },
        fmtValorExtrato: (v) => 'R$ ' + Number(v).toFixed(2),
        fmtDataExtrato: (d) => (d ? String(d) : '---'),
        render: () => { chamadas.renders++; },
        showToast: (m, t) => chamadas.toasts.push({ m, t }),
        fetchDocuments: async () => { chamadas.fetchDocuments++; },
        console: { log() { }, error() { }, warn() { } },
        encodeURIComponent,
        supabaseClient: {
            auth: { getSession: async () => ({ data: { session: opcoes.semSessao ? null : { access_token: 'tok' } } }) },
            from: () => {
                const api = {
                    select() { return api; }, eq(c, v) { chamadas.extratosSelect.push([c, v]); return api; }, order() { return api; }, limit() { return api; },
                    then(res, rej) { return Promise.resolve({ data: opcoes.extratosDoProjeto || [{ id: 'ext-bom', file_path: 'p/u/Extrato_Certo.ofx', formato: 'ofx', status: 'processado', created_at: '2026-09-10T15:00:00Z' }, { id: EXT_RUIM, file_path: 'p/u/Extrato_Errado.ofx', formato: 'ofx', status: 'processado', created_at: '2026-09-05T15:00:00Z' }], error: null }).then(res, rej); }
                };
                return api;
            }
        },
        fetch: async (url, init) => {
            chamadas.fetch.push({ url, init });
            if (url.includes('extratos-pausados')) {
                if (opcoes.consultaFalha) return { ok: false, status: 500, json: async () => ({}) };
                return { ok: true, status: 200, json: async () => (opcoes.respostaConsulta || { ok: true, extratos: [] }) };
            }
            return { ok: true, status: 200, json: async () => ({ ok: true, resumo: { vinculadas: 3, puladas: 0, recusadas: 0 }, itens: [] }) };
        }
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + ';Object.assign(this, { aviso: avisoExtratosPausadosHtml, selo: seloExtratoHtml, modal: VincularExtratoModal, carregar: carregarExtratosPausados, ids: idsExtratosPausados, lista: extratosVincularListaHtml });', ctx);
    return { ctx, chamadas };
}

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

(async () => {
    await teste('aviso: texto com nome, data, quantidade de notas, motivo resumido e o botao', () => {
        const { ctx } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO()] } });
        const h = ctx.aviso(PROJ).replace(/\s+/g, ' ');
        assert.ok(h.includes('O extrato Extrato_Errado.ofx, enviado em'), h);
        assert.ok(h.includes('05/09/2026') || h.includes('4/09/2026') || /enviado em \d\d\/\d\d\/2026/.test(h));
        assert.ok(h.includes('é de outro projeto. 3 notas estão paradas aguardando o extrato correto.'));
        assert.ok(h.includes('Motivo: Extrato de outro projeto: o PRONAC do extrato (111111)'));
        assert.ok(h.includes('Vincular o extrato correto') && h.includes("handleVincularExtratoPausado('" + EXT_RUIM + "')"));
        assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(h) && !h.includes('data-lucide'), 'sem icones nem emojis');
    });

    await teste('aviso: singular com uma nota; motivo longo e cortado; texto do servidor nao vira HTML', () => {
        const longo = 'Extrato de outro projeto: ' + 'x'.repeat(400);
        let { ctx } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO({ notas: [nota()], motivo: longo })] } });
        let h = ctx.aviso(PROJ).replace(/\s+/g, ' ');
        assert.ok(h.includes('1 nota está parada aguardando o extrato correto.'));
        const m = /Motivo: ([^<]*)</.exec(h)[1];
        assert.ok(m.length <= 160 && m.endsWith('...'), String(m.length));
        ({ ctx } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO({ nome: '<img src=x onerror=alert(1)>.ofx', motivo: '<script>alert(1)</script>' })] } }));
        h = ctx.aviso(PROJ);
        assert.ok(!h.includes('<img') && !h.includes('<script'));
        assert.ok(h.includes('&lt;img'));
    });

    await teste('aviso: um quadro por extrato pausado; sem projeto, sem dados ou sem permissao nao mostra nada', () => {
        const dois = [EXTRATO_PAUSADO(), EXTRATO_PAUSADO({ id: 'ext-2', nome: 'Outro.ofx', notas: [nota({ id: 'n9' })] })];
        let { ctx } = criarAmbiente({ pausados: { [PROJ]: dois } });
        assert.strictEqual((ctx.aviso(PROJ).match(/Vincular o extrato correto/g) || []).length, 2);
        assert.strictEqual(ctx.aviso(''), '');
        assert.strictEqual(ctx.aviso(null), '');
        assert.strictEqual(ctx.aviso('outro-projeto'), '');
        ({ ctx } = criarAmbiente({ pausados: {} }));
        assert.strictEqual(ctx.aviso(PROJ), '');
        ({ ctx } = criarAmbiente({ pausados: { [PROJ]: [] } }));
        assert.strictEqual(ctx.aviso(PROJ), '');
        ({ ctx } = criarAmbiente({ pausados: { [PROJ]: dois }, role: 'fornecedor' }));
        assert.strictEqual(ctx.aviso(PROJ), '', 'fornecedor nao ve o aviso');
    });

    await teste('selo: "Extrato de outro projeto" em vez de "Na fila de conciliacao" com a informacao do servidor; sem ela, como antes', () => {
        const doc = { id: 'n2', status: 'aguardando_conciliacao_bancaria', extrato_origem_id: EXT_RUIM };
        let { ctx } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO()] } });
        let h = ctx.selo(doc);
        assert.ok(h.includes('Extrato de outro projeto') && !h.includes('Na fila de conciliação'));
        assert.ok(h.includes('status-error'));
        // a nota que disparou a pausa (divergencia) tambem recebe o selo
        assert.ok(ctx.selo({ ...doc, status: 'divergencia_beneficiario' }).includes('Extrato de outro projeto'));
        // nota de outro extrato continua na fila
        assert.ok(ctx.selo({ ...doc, extrato_origem_id: 'ext-bom' }).includes('Na fila de conciliação'));
        // sem a informacao (nada carregado), o selo e o de sempre
        ({ ctx } = criarAmbiente({ pausados: {} }));
        h = ctx.selo(doc);
        assert.ok(h.includes('Na fila de conciliação') && !h.includes('outro projeto'));
        assert.strictEqual(ctx.selo({ ...doc, status: 'divergencia_beneficiario' }), '');
    });

    await teste('botao: abre a janela Vincular extrato com as notas presas selecionadas e a reconferencia marcada', async () => {
        const { ctx, chamadas } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO()] } });
        await ctx.window.handleVincularExtratoPausado(EXT_RUIM);
        const v = ctx.state.vincularExtrato;
        assert.ok(v, 'a janela abriu');
        assert.strictEqual(v.projectId, PROJ);
        deepEq(v.docIds, ['n1', 'n2', 'n3']);
        assert.strictEqual(v.incluirDivergencias, true, 'a nota que disparou a pausa esta em divergencia');
        assert.strictEqual(v.carregando, false);
        assert.deepStrictEqual(chamadas.extratosSelect.find(([c]) => c === 'project_id'), ['project_id', PROJ]);
        // a janela mostra as notas mesmo sem elas estarem em state.documents (tela de lote)
        assert.strictEqual(ctx.state.documents.length, 0);
        const h = ctx.modal();
        assert.ok(h.includes('Vincular extrato a 3 notas'));
        for (const numero of ['4001', '4002', '4003']) assert.ok(h.includes(numero), numero);
        assert.ok(/type="checkbox" checked/.test(h), 'reconferencia marcada');
        assert.ok(h.includes('extrato vinculado e de outro projeto'));
    });

    await teste('botao: sem nota em divergencia a reconferencia nao vem marcada; extrato desconhecido nao faz nada', async () => {
        const { ctx } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO({ notas: [nota({ id: 'n2' })] })] } });
        await ctx.window.handleVincularExtratoPausado(EXT_RUIM);
        assert.strictEqual(ctx.state.vincularExtrato.incluirDivergencias, false);
        ctx.state.vincularExtrato = null;
        await ctx.window.handleVincularExtratoPausado('nao-existe');
        assert.strictEqual(ctx.state.vincularExtrato, null);
    });

    await teste('botao: perfil sem permissao nao abre a janela', async () => {
        const { ctx, chamadas } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO()] }, role: 'fornecedor' });
        await ctx.window.handleVincularExtratoPausado(EXT_RUIM);
        assert.strictEqual(ctx.state.vincularExtrato, null);
        assert.strictEqual(chamadas.toasts.length, 1);
    });

    await teste('janela: o extrato pausado aparece na lista mas nao pode ser escolhido; o certo pode', async () => {
        const { ctx } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO()] } });
        await ctx.window.handleVincularExtratoPausado(EXT_RUIM);
        const h = ctx.modal().replace(/\s+/g, ' ');
        assert.ok(h.includes('extrato de outro projeto (pausado)'));
        const radioRuim = new RegExp("<input type=\"radio\"[^>]*vincularExtratoEscolher\\('" + EXT_RUIM + "'\\)\\)?\"?[^>]*>").exec(h)[0];
        const radioBom = /<input type="radio"[^>]*vincularExtratoEscolher\('ext-bom'\)"[^>]*>/.exec(h)[0];
        assert.ok(/disabled/.test(radioRuim) && !/disabled/.test(radioBom));
    });

    await teste('depois de vincular com sucesso o aviso e recarregado e some', async () => {
        const { ctx, chamadas } = criarAmbiente({ pausados: { [PROJ]: [EXTRATO_PAUSADO()] }, respostaConsulta: { ok: true, extratos: [] } });
        await ctx.window.handleVincularExtratoPausado(EXT_RUIM);
        ctx.window.vincularExtratoEscolher('ext-bom');
        await ctx.window.vincularExtratoConfirmar();
        const post = chamadas.fetch.find(c => c.url.includes('vincular-extrato'));
        deepEq(JSON.parse(post.init.body), { extrato_id: 'ext-bom', document_ids: ['n1', 'n2', 'n3'], incluir_divergencias: true });
        assert.strictEqual(chamadas.fetchDocuments, 1);
        const consulta = chamadas.fetch.find(c => c.url.includes('extratos-pausados'));
        assert.ok(consulta && consulta.url.endsWith('?project_id=' + PROJ), 'recarregou os pausados do projeto');
        assert.strictEqual(consulta.init.headers.Authorization, 'Bearer tok');
        assert.deepStrictEqual(ctx.state.extratosPausados[PROJ], []);
        assert.strictEqual(ctx.aviso(PROJ), '');
    });

    await teste('carregar: guarda por projeto, mantem o que ja havia se a consulta falha, e nao consulta sem projeto ou sem permissao', async () => {
        let { ctx, chamadas } = criarAmbiente({ respostaConsulta: { ok: true, extratos: [EXTRATO_PAUSADO()] }, pausados: { outro: [EXTRATO_PAUSADO({ id: 'x' })] } });
        await ctx.carregar(PROJ);
        assert.strictEqual(ctx.state.extratosPausados[PROJ].length, 1);
        assert.strictEqual(ctx.state.extratosPausados.outro.length, 1, 'os outros projetos ficam');
        ({ ctx, chamadas } = criarAmbiente({ consultaFalha: true, pausados: { [PROJ]: [EXTRATO_PAUSADO()] } }));
        await ctx.carregar(PROJ);
        assert.strictEqual(ctx.state.extratosPausados[PROJ].length, 1, 'falha mantem o anterior');
        ({ ctx, chamadas } = criarAmbiente({}));
        await ctx.carregar('');
        await ctx.carregar(null);
        assert.strictEqual(chamadas.fetch.length, 0);
        ({ ctx, chamadas } = criarAmbiente({ role: 'fornecedor' }));
        await ctx.carregar(PROJ);
        assert.strictEqual(chamadas.fetch.length, 0, 'fornecedor nao consulta');
        ({ ctx, chamadas } = criarAmbiente({ semSessao: true }));
        await ctx.carregar(PROJ);
        assert.strictEqual(chamadas.fetch.length, 0);
    });

    await teste('telas e ganchos (codigo-fonte): aviso na lista de Documentos e na de lote; carga ao entrar, trocar de projeto e abrir a nota', () => {
        const dash = recorta('const DashboardView = () => {', '\n};\n');
        assert.ok(dash.includes('${avisoExtratosPausadosHtml(state.filters.project)}'));
        assert.ok(dash.indexOf('avisoExtratosPausadosHtml') < dash.indexOf('class="metrics-grid"'), 'no topo, antes dos cartoes');
        const lote = recorta('const UploadLoteView = () => {', '\n};\n');
        assert.ok(lote.includes('${avisoExtratosPausadosHtml(projetoSelecionado)}'));
        assert.ok(/await fetchDocuments\(\);\n\s+await carregarExtratosPausados\(state\.filters\.project\);/.test(SRC), 'ao voltar ao dashboard');
        assert.ok(/if \(key === 'project'\) await carregarExtratosPausados\(state\.filters\.project\);/.test(SRC), 'ao trocar de projeto');
        assert.ok(/carregarExtratosPausados\(projectId\),\n\s+\]\);\n\s+render\(\);/.test(SRC), 'ao trocar de projeto no lote');
        assert.ok(/carregarExtratosPausados\(state\.filters\.project\),\n\s+\]\);/.test(SRC), 'ao entrar no lote');
        assert.ok(/garantirExtratosPausadosDaNota\(id\);\n\s+const outroDocumento/.test(SRC), 'ao abrir a nota');
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
