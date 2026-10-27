// Teste da ocorrencia #121 do app.js (Documentos em Lote: "Processar todos"), sem navegador e sem rede.
// As funcoes sao recortadas do codigo-fonte do app.js e rodam em um contexto com Supabase, n8n e tela
// falsos; o modal de confirmacao e o de verdade. Cobre:
//  - as rubricas digitadas sao copiadas para state.uploadLoteQueue antes do primeiro render;
//  - state.uploadLoteProgresso avanca a cada documento e o quadro "X de N" aparece na tela;
//  - cada documento enviado sai da lista na hora; quem falha fica, com a rubrica, e nao barra os seguintes;
//  - o progresso e desligado ao fim, mesmo com excecao; cancelar o modal nao altera nada;
//  - durante o envio Processar, rubricas, exclusao e novos uploads ficam desabilitados.
// Uso: node teste-lote-feedback.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio);
    assert.ok(i >= 0, 'nao encontrado no app.js: ' + inicio);
    const j = SRC.indexOf(fecho, i);
    assert.ok(j > i, 'fim nao encontrado para: ' + inicio);
    return SRC.slice(i, j + fecho.length);
}
const FIM_WINDOW = '\n};\n';
const FIM_FUNCAO = '\n}\n';

const CODIGO = [
    bloco('window.showConfirmModal = function', FIM_WINDOW),
    bloco('window.closeConfirmModal = function', FIM_WINDOW),
    bloco('window.__execConfirmModal = function', FIM_WINDOW),
    bloco('const UploadLoteView = () => {', '\n};\n'),
    bloco('function extratoOrigemPara(', FIM_FUNCAO),
    bloco('window.handleProcessarLoteItem = async function', FIM_WINDOW),
    bloco('window.handleProcessarTodosLote = async function', FIM_WINDOW)
].join('\n');

const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const deepEq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

const RUBRICAS = [{ id: 'rub-1', nome: 'Hospedagem' }, { id: 'rub-2', nome: 'Transporte' }];
const DIGITADO = { a: 'Hospedagem', b: 'Transporte', c: 'Hospedagem', d: '' };

// opcoes: falhaEm (ids cujo update falha), ocrLanca (ids cujo dispararOcr lanca), fetchLanca, semDigitar (ids sem texto)
function criarAmbiente(opcoes = {}) {
    const fila = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `nota-${id}.pdf`, file_path: `p1/${id}.pdf`, project_id: 'p1', size: '10 KB', valor: 100, rubrica: null, rubrica_id_fk: null }));
    const updates = [];
    const toasts = [];
    const renders = [];
    const ocr = { chamadas: [], emAndamento: 0, maximo: 0 };
    const falhaEm = new Set(opcoes.falhaEm || []);
    const ocrLanca = new Set(opcoes.ocrLanca || []);
    const idsNoBanco = new Set(fila.map(d => d.id));

    const state = {
        user: { id: 'u1' }, loading: false, confirmModal: null,
        uploadLoteQueue: fila, rubricas_disponiveis: RUBRICAS, projects: [{ id: 'p1', pronac: '123', nome: 'Projeto' }],
        filters: { project: 'p1' }, loteExtratoVinculado: null,
        uploadLoteProgresso: { ativo: false, total: 0, feitos: 0, falhas: 0 }
    };
    const ctx = {
        state, console: { log() { }, error() { }, warn() { } },
        window: { showToast: (m, t) => toasts.push({ m, t }) },
        showToast: (m, t) => toasts.push({ m, t }),
        supabaseClient: {
            from: () => {
                const op = { dados: null, id: null };
                const api = {
                    update(d) { op.dados = d; return api; },
                    eq(c, v) { op.id = v; return api; },
                    then(res, rej) {
                        updates.push({ id: op.id, dados: op.dados });
                        const erro = falhaEm.has(op.id) ? { message: 'falha ao gravar' } : null;
                        if (!erro) idsNoBanco.delete(op.id);
                        return Promise.resolve({ error: erro }).then(res, rej);
                    }
                };
                return api;
            }
        },
        isSaldoRubricasHabilitado: async () => false,
        resolverRubricaPorRotulo: (txt, lista) => lista.find(r => r.nome === txt) || null,
        document: { getElementById: (id) => { const m = /^lote-rubrica-(.+)$/.exec(id); const v = m && (opcoes.digitado || DIGITADO)[m[1]]; return m ? { value: v === undefined ? '' : v } : null; } },
        dispararOcr: async (id) => {
            ocr.chamadas.push(id);
            ocr.emAndamento++; ocr.maximo = Math.max(ocr.maximo, ocr.emAndamento);
            await tick();
            ocr.emAndamento--;
            if (ocrLanca.has(id)) throw new Error('falha no disparo');
        },
        // o "banco": quem foi gravado como processing_ocr nao volta; quem falhou volta sem a rubrica
        fetchUploadLoteQueue: async () => {
            if (opcoes.fetchLanca) throw new Error('fetch quebrou');
            state.uploadLoteQueue = fila.filter(d => idsNoBanco.has(d.id)).map(d => ({ id: d.id, name: d.name, file_path: d.file_path, project_id: d.project_id, size: d.size, valor: d.valor, rubrica: null, rubrica_id_fk: null }));
        },
        // stubs da tela
        Sidebar: () => '', planilhaOrcamentariaBtn: () => '', renderSaldoBadgeHtml: () => '',
        rotuloRubrica: (r) => r.nome, escAttr: (x) => String(x == null ? '' : x)
    };
    ctx.render = () => {
        renders.push({
            progresso: JSON.parse(JSON.stringify(state.uploadLoteProgresso)),
            loading: state.loading,
            fila: state.uploadLoteQueue.map(d => ({ id: d.id, rubrica: d.rubrica, rubrica_id_fk: d.rubrica_id_fk })),
            modal: !!state.confirmModal,
            html: ctx.UploadLoteView()
        });
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + '\n;this.UploadLoteView = UploadLoteView;', ctx);
    ctx.window.showToast = ctx.showToast;
    return { ctx, state, window: ctx.window, updates, toasts, renders, ocr, idsNoBanco };
}

// Abre o modal pelo handler de verdade e devolve a promise do onConfirm, sem o render que fecha o modal.
async function abrirModal(amb) {
    await amb.window.handleProcessarTodosLote();
    const modal = amb.state.confirmModal;
    assert.ok(modal, 'o modal de confirmacao devia abrir');
    amb.state.confirmModal = null;
    amb.renders.length = 0;
    return modal;
}
const abrirEConfirmar = async (amb) => (await abrirModal(amb)).onConfirm();

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

(async () => {
    await teste('cancelar o modal nao altera nada', async () => {
        const amb = criarAmbiente();
        const antes = JSON.stringify(amb.state.uploadLoteQueue);
        await amb.window.handleProcessarTodosLote();
        assert.ok(amb.state.confirmModal);
        amb.window.closeConfirmModal();
        await tick();
        assert.strictEqual(JSON.stringify(amb.state.uploadLoteQueue), antes);
        assert.strictEqual(amb.state.uploadLoteProgresso.ativo, false);
        assert.strictEqual(amb.state.loading, false);
        assert.strictEqual(amb.updates.length, 0);
        assert.strictEqual(amb.ocr.chamadas.length, 0);
    });

    await teste('validacoes iniciais continuam antes do modal (sem rubrica, rubrica invalida)', async () => {
        let amb = criarAmbiente({ digitado: {} });
        await amb.window.handleProcessarTodosLote();
        assert.strictEqual(amb.state.confirmModal, null);
        assert.ok(amb.toasts[0].m.includes('Preencha a rubrica'));
        amb = criarAmbiente({ digitado: { a: 'Inexistente' } });
        await amb.window.handleProcessarTodosLote();
        assert.strictEqual(amb.state.confirmModal, null);
        assert.ok(amb.toasts[0].m.includes('não encontrada ou ambígua'));
        assert.strictEqual(amb.state.uploadLoteProgresso.ativo, false);
    });

    await teste('a rubrica digitada e copiada para a fila ANTES do primeiro render; item sem rubrica fica como estava', async () => {
        const amb = criarAmbiente();
        const modal = await abrirModal(amb);
        const p = modal.onConfirm();
        // o primeiro render de dentro do onConfirm ja aconteceu de forma sincrona
        const primeiro = amb.renders[0];
        assert.ok(primeiro, 'o onConfirm redesenha antes do primeiro await');
        const por = Object.fromEntries(primeiro.fila.map(d => [d.id, d]));
        assert.strictEqual(por.a.rubrica_id_fk, 'rub-1'); assert.strictEqual(por.a.rubrica, 'Hospedagem');
        assert.strictEqual(por.b.rubrica_id_fk, 'rub-2'); assert.strictEqual(por.b.rubrica, 'Transporte');
        assert.strictEqual(por.c.rubrica_id_fk, 'rub-1');
        assert.strictEqual(por.d.rubrica, null); assert.strictEqual(por.d.rubrica_id_fk, null);
        // e a tela desse primeiro render mostra as rubricas nos campos
        for (const id of ['a', 'b', 'c']) assert.ok(new RegExp(`id="lote-rubrica-${id}"[^>]*value="${DIGITADO[id]}"`).test(primeiro.html), 'campo ' + id);
        assert.ok(/id="lote-rubrica-d"[^>]*value=""/.test(primeiro.html));
        assert.strictEqual(primeiro.progresso.ativo, true);
        assert.strictEqual(primeiro.progresso.total, 3);
        assert.ok(primeiro.html.includes('Enviando documentos para processamento: 0 de 3'));
        await p;
    });

    await teste('o progresso avanca a cada documento e cada nota enviada sai da lista na hora', async () => {
        const amb = criarAmbiente();
        await abrirEConfirmar(amb);
        const doLoop = amb.renders.filter(r => r.progresso.ativo);
        deepEq(doLoop.map(r => r.progresso.feitos), [0, 1, 2, 3]);
        deepEq(doLoop.map(r => r.fila.map(d => d.id).join('')), ['abcd', 'bcd', 'cd', 'd']);
        assert.ok(doLoop[1].html.includes('1 de 3') && doLoop[2].html.includes('2 de 3') && doLoop[3].html.includes('3 de 3'));
        assert.ok(!doLoop[3].html.includes('com falha'), 'sem falhas nao aparece "com falha"');
        // barra proporcional
        assert.ok(doLoop[0].html.includes('width: 0%') && doLoop[1].html.includes('width: 33%') && doLoop[2].html.includes('width: 67%') && doLoop[3].html.includes('width: 100%'));
        // fim: quadro some, botao volta, sobra so a nota sem rubrica
        const ultimo = amb.renders[amb.renders.length - 1];
        assert.strictEqual(ultimo.progresso.ativo, false);
        assert.strictEqual(ultimo.loading, false);
        assert.ok(!ultimo.html.includes('Enviando documentos para processamento'));
        assert.ok(/onclick="window.handleProcessarTodosLote\(\)" (?!disabled)/.test(ultimo.html));
        deepEq(ultimo.fila.map(d => d.id), ['d']);
        assert.ok(amb.toasts.some(t => t.t === 'success' && t.m.startsWith('3 documento(s) enviados')));
    });

    await teste('a gravacao por documento e o disparo ao OCR ficam como antes (um por vez, mesmos campos)', async () => {
        const amb = criarAmbiente();
        amb.state.loteExtratoVinculado = { id: 'ext-9', nome: 'e.ofx', projectId: 'p1' };
        await abrirEConfirmar(amb);
        deepEq(amb.updates, [
            { id: 'a', dados: { rubrica: 'Hospedagem', rubrica_id_fk: 'rub-1', status: 'processing_ocr', extrato_origem_id: 'ext-9' } },
            { id: 'b', dados: { rubrica: 'Transporte', rubrica_id_fk: 'rub-2', status: 'processing_ocr', extrato_origem_id: 'ext-9' } },
            { id: 'c', dados: { rubrica: 'Hospedagem', rubrica_id_fk: 'rub-1', status: 'processing_ocr', extrato_origem_id: 'ext-9' } }
        ]);
        deepEq(amb.ocr.chamadas, ['a', 'b', 'c']);
        assert.strictEqual(amb.ocr.maximo, 1, 'nunca dois disparos ao mesmo tempo');
    });

    await teste('falha de um item nao impede os seguintes; ele fica na fila com a rubrica e o quadro conta a falha', async () => {
        const amb = criarAmbiente({ falhaEm: ['b'] });
        await abrirEConfirmar(amb);
        deepEq(amb.ocr.chamadas, ['a', 'c'], 'o c foi processado apesar da falha do b');
        const doLoop = amb.renders.filter(r => r.progresso.ativo);
        deepEq(doLoop.map(r => r.progresso.feitos), [0, 1, 2, 3]);
        deepEq(doLoop.map(r => r.progresso.falhas), [0, 0, 1, 1]);
        assert.ok(doLoop[2].html.includes('2 de 3 (1 com falha)'));
        deepEq(doLoop[2].fila.map(d => d.id), ['b', 'c', 'd'], 'o b nao sai da lista');
        // depois do fetch final (que traz o banco, sem a rubrica) o b continua com a rubrica digitada
        const ultimo = amb.renders[amb.renders.length - 1];
        deepEq(ultimo.fila.map(d => d.id), ['b', 'd']);
        const b = ultimo.fila.find(d => d.id === 'b');
        assert.strictEqual(b.rubrica, 'Transporte'); assert.strictEqual(b.rubrica_id_fk, 'rub-2');
        assert.ok(/id="lote-rubrica-b"[^>]*value="Transporte"/.test(ultimo.html));
        assert.ok(amb.toasts.some(t => t.t === 'success' && t.m.startsWith('2 documento(s) enviados')));
        assert.ok(amb.toasts.some(t => t.t === 'error' && t.m === '1 falharam.'));
    });

    await teste('excecao no disparo ao OCR tambem conta como falha de um item e o lote segue', async () => {
        const amb = criarAmbiente({ ocrLanca: ['a'] });
        await abrirEConfirmar(amb);
        deepEq(amb.ocr.chamadas, ['a', 'b', 'c']);
        assert.strictEqual(amb.state.uploadLoteProgresso.ativo, false);
        assert.ok(amb.renders.some(r => r.html.includes('3 de 3 (1 com falha)')));
    });

    await teste('o estado de progresso e desligado mesmo com excecao fora do loop (fetch final quebra)', async () => {
        const amb = criarAmbiente({ fetchLanca: true });
        await assert.rejects(() => abrirEConfirmar(amb), /fetch quebrou/);
        assert.strictEqual(amb.state.uploadLoteProgresso.ativo, false);
        assert.strictEqual(amb.state.loading, false);
        const ultimo = amb.renders[amb.renders.length - 1];
        assert.strictEqual(ultimo.progresso.ativo, false);
        assert.ok(!ultimo.html.includes('Enviando documentos para processamento'));
    });

    await teste('o estado de progresso e desligado se o render quebrar no meio do loop', async () => {
        const amb = criarAmbiente();
        let n = 0;
        const renderOriginal = amb.ctx.render;
        amb.ctx.render = () => { n++; if (n === 3) throw new Error('render quebrou'); renderOriginal(); };
        await assert.rejects(() => abrirEConfirmar(amb), /render quebrou/);
        assert.strictEqual(amb.state.uploadLoteProgresso.ativo, false);
        assert.strictEqual(amb.state.loading, false);
    });

    await teste('durante o envio Processar, rubricas, exclusao, upload e troca de projeto ficam desabilitados', async () => {
        const amb = criarAmbiente();
        await abrirEConfirmar(amb);
        const durante = amb.renders.find(r => r.progresso.ativo && r.progresso.feitos === 1).html;
        assert.ok(/onclick="window.handleProcessarTodosLote\(\)" disabled/.test(durante), 'botao Processar todos');
        assert.ok(/handleProcessarLoteItem\('b'\)" disabled/.test(durante), 'botao Processar da linha');
        assert.ok(/id="lote-rubrica-b"[^>]*disabled/.test(durante), 'campo de rubrica');
        assert.ok(/handleExcluirLoteItem\('b'[^>]*disabled/.test(durante), 'excluir');
        assert.ok(/<div class="upload-area" style="opacity: 0.5; pointer-events: none;" aria-disabled="true">/.test(durante), 'area de novos arquivos sem onclick');
        assert.ok(/id="lote-file-input"[^>]*disabled/.test(durante), 'input de arquivos');
        assert.ok(/id="lote-project-selector"[^>]*disabled/.test(durante), 'seletor de projeto');
        assert.ok(!durante.includes('Enviando arquivos para a fila, aguarde'), 'nao mistura com o aviso do upload de arquivos');
        // fora do envio tudo volta ao normal
        const depois = amb.ctx.UploadLoteView();
        assert.ok(!/handleProcessarLoteItem\('d'\)" disabled/.test(depois));
        assert.ok(!/id="lote-rubrica-d"[^>]*disabled/.test(depois));
        assert.ok(/onclick="if\(document.getElementById\('lote-project-selector'\)/.test(depois));
    });

    await teste('segundo clique durante o envio e ignorado (nao abre outro lote nem modal)', async () => {
        const amb = criarAmbiente();
        const modal = await abrirModal(amb);
        const p = modal.onConfirm();
        await amb.window.handleProcessarTodosLote();
        assert.strictEqual(amb.state.confirmModal, null);
        await amb.window.handleProcessarLoteItem('d');
        assert.strictEqual(amb.toasts.length, 0);
        await p;
        assert.strictEqual(amb.updates.length, 3);
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
