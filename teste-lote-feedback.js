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
    bloco('const MINUTOS_TRAVADO =', ';\n'),
    bloco('const STATUS_INTERMEDIARIOS_TRAVAVEIS =', ';\n'),
    bloco('function estaTravado(', FIM_FUNCAO),
    bloco('function minutosParadoDoc(', FIM_FUNCAO),
    bloco('const STATUS_LOTE_PROCESSANDO =', ';\n'),
    bloco('function removerLinhaLoteNoDom(', FIM_FUNCAO),
    bloco('function estadoLinhaLote(', FIM_FUNCAO),
    bloco('const SELOS_LOTE = {', '\n};\n'),
    bloco('function seloLoteHtml(', FIM_FUNCAO),
    bloco('function segundosLoteAtual(', FIM_FUNCAO),
    bloco('let _loteContadorTimer = null;', ' = null;'),
    bloco('function pararContadorLote(', FIM_FUNCAO),
    bloco('function atualizarSegundosLote(', FIM_FUNCAO),
    bloco('function definirAtualLote(', FIM_FUNCAO),
    bloco('function avisarSaidaDuranteEnvioLote(', FIM_FUNCAO),
    bloco('function segmentosLoteHtml(', FIM_FUNCAO),
    bloco('function conteudoUploadArquivosHtml(', FIM_FUNCAO),
    bloco('function atualizarProgressoUploadLoteNoDom(', FIM_FUNCAO),
    bloco('window.handleLoteFilesSelected = async function', FIM_WINDOW),
    bloco('function linhaLoteTravada(', FIM_FUNCAO),
    bloco('function atualizarLinhaLoteNoDom(', FIM_FUNCAO),
    bloco('function registrarMudancaDocumentoNoLote(', FIM_FUNCAO),
    // a leitura de verdade, com outro nome: o ambiente ja tem um fetchUploadLoteQueue falso (o "banco")
    bloco('async function fetchUploadLoteQueue(', FIM_FUNCAO).replace('async function fetchUploadLoteQueue(', 'async function fetchUploadLoteQueueReal('),
    bloco('const UploadLoteView = () => {', '\n};\n'),
    bloco('function extratoOrigemPara(', FIM_FUNCAO),
    bloco('window.handleProcessarLoteItem = async function', FIM_WINDOW),
    bloco('window.handleProcessarTodosLote = async function', FIM_WINDOW)
].join('\n');

// estado de cada segmento da barra segmentada do quadro, na ordem do lote
const segmentos = (html) => [...html.matchAll(/class="lote-seg lote-seg-([a-z]+)"/g)].map(m => m[1]);
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const deepEq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

const RUBRICAS = [{ id: 'rub-1', nome: 'Hospedagem' }, { id: 'rub-2', nome: 'Transporte' }];
const DIGITADO = { a: 'Hospedagem', b: 'Transporte', c: 'Hospedagem', d: '' };

// opcoes: falhaEm (ids cujo update falha), ocrLanca (ids cujo dispararOcr lanca), fetchLanca, semDigitar (ids sem texto)
function criarAmbiente(opcoes = {}) {
    const fila = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `nota-${id}.pdf`, file_path: `p1/${id}.pdf`, project_id: 'p1', size: '10 KB', valor: 100, rubrica: null, rubrica_id_fk: null, status: 'aguardando_rubrica' }));
    const updates = [];
    const toasts = [];
    const renders = [];
    const ocr = { chamadas: [], emAndamento: 0, maximo: 0 };
    const saida = [];
    const timers = [];
    const falhaEm = new Set(opcoes.falhaEm || []);
    const ocrLanca = new Set(opcoes.ocrLanca || []);
    const idsNoBanco = new Set(fila.map(d => d.id));

    const state = {
        user: { id: 'u1' }, loading: false, confirmModal: null,
        uploadLoteQueue: fila, rubricas_disponiveis: RUBRICAS, projects: [{ id: 'p1', pronac: '123', nome: 'Projeto' }],
        filters: { project: 'p1' }, loteExtratoVinculado: null,
        uploadLoteProgresso: { ativo: false, total: 0, feitos: 0, falhas: 0, atual: null, atualDesde: null, ids: [], enviados: [], rubricas: {} },
        uploadLoteFalhas: {}, uploadLoteProcessandoFora: {}, uploadArquivosProgresso: null, currentView: 'upload_lote'
    };
    const ctx = {
        state, console: { log() { }, error() { }, warn() { } },
        window: {
            showToast: (m, t) => toasts.push({ m, t }),
            addEventListener: (tipo, fn) => saida.push({ acao: 'add', tipo, fn }),
            removeEventListener: (tipo, fn) => saida.push({ acao: 'remove', tipo, fn })
        },
        // intervalos falsos: cada setInterval vira um registro que o teste dispara na mao
        setInterval: (fn, ms) => { const t = { fn, ms, ativo: true }; timers.push(t); return t; },
        clearInterval: (t) => { if (t) t.ativo = false; },
        showToast: (m, t) => toasts.push({ m, t }),
        supabaseClient: {
            from: () => {
                const op = { dados: null, id: null, leitura: false, statusIn: null };
                const api = {
                    update(d) { op.dados = d; return api; },
                    select() { op.leitura = true; return api; },
                    is() { return api; },
                    in(c, v) { if (c === 'status') op.statusIn = v; return api; },
                    order() { return api; },
                    eq(c, v) { op.id = v; return api; },
                    then(res, rej) {
                        // leitura da fila (fetchUploadLoteQueueReal): o banco nao tem a rubrica digitada
                        if (op.leitura) {
                            let linhas = fila.filter(d => idsNoBanco.has(d.id)).map(d => ({ ...d, rubrica: null, rubrica_id_fk: null }));
                            linhas = linhas.concat(opcoes.extrasNoBanco || []);
                            if (op.statusIn) linhas = linhas.filter(d => op.statusIn.includes(d.status));
                            return Promise.resolve({ data: linhas, error: null }).then(res, rej);
                        }
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
            if (opcoes.aoDisparar) await opcoes.aoDisparar(id, ctx);
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
        Sidebar: () => '', planilhaOrcamentariaBtn: () => '', renderSaldoBadgeHtml: () => '', avisoExtratosPausadosHtml: () => '',
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
    return { ctx, state, window: ctx.window, updates, toasts, renders, ocr, idsNoBanco, falhaEm, saida, timers };
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
        assert.ok(primeiro.html.includes('Enviando documento 1 de 3'));
        await p;
    });

    await teste('o progresso avanca a cada documento e cada nota enviada sai da lista na hora', async () => {
        const amb = criarAmbiente();
        await abrirEConfirmar(amb);
        const doLoop = amb.renders.filter(r => r.progresso.ativo);
        deepEq(doLoop.map(r => r.progresso.feitos), [0, 1, 2, 3]);
        deepEq(doLoop.map(r => r.fila.map(d => d.id).join('')), ['abcd', 'bcd', 'cd', 'd']);
        // "Enviando documento X de N" acompanha o documento atual; depois do ultimo vira "Finalizando"
        assert.ok(doLoop[0].html.includes('Enviando documento 1 de 3') && doLoop[1].html.includes('Enviando documento 2 de 3') && doLoop[2].html.includes('Enviando documento 3 de 3'));
        assert.ok(doLoop[3].html.includes('Finalizando o envio'));
        assert.ok(doLoop[0].html.includes('Concluídos: 0.') && doLoop[1].html.includes('Concluídos: 1.') && doLoop[3].html.includes('Concluídos: 3.'));
        assert.ok(!doLoop[3].html.includes('Com falha'), 'sem falhas nao aparece "Com falha"');
        // barra proporcional
        deepEq(segmentos(doLoop[0].html), ['atual', 'espera', 'espera']);
        deepEq(segmentos(doLoop[1].html), ['ok', 'atual', 'espera']);
        deepEq(segmentos(doLoop[2].html), ['ok', 'ok', 'atual']);
        deepEq(segmentos(doLoop[3].html), ['ok', 'ok', 'ok']);
        // fim: quadro some, botao volta, sobra so a nota sem rubrica
        const ultimo = amb.renders[amb.renders.length - 1];
        assert.strictEqual(ultimo.progresso.ativo, false);
        assert.strictEqual(ultimo.loading, false);
        assert.ok(!ultimo.html.includes('Enviando documento'));
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
        assert.ok(doLoop[2].html.includes('Enviando documento 3 de 3') && doLoop[2].html.includes('Concluídos: 1. Com falha: 1.'));
        deepEq(segmentos(doLoop[2].html), ['ok', 'falha', 'atual']);
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
        assert.ok(amb.renders.some(r => r.html.includes('Concluídos: 2. Com falha: 1.')));
    });

    await teste('o estado de progresso e desligado mesmo com excecao fora do loop (fetch final quebra)', async () => {
        const amb = criarAmbiente({ fetchLanca: true });
        await assert.rejects(() => abrirEConfirmar(amb), /fetch quebrou/);
        assert.strictEqual(amb.state.uploadLoteProgresso.ativo, false);
        assert.strictEqual(amb.state.loading, false);
        const ultimo = amb.renders[amb.renders.length - 1];
        assert.strictEqual(ultimo.progresso.ativo, false);
        assert.ok(!ultimo.html.includes('Enviando documento'));
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

    // ---- #153: estado visivel por linha ----
    // texto do selo de cada linha (vazio = sem selo), lido do HTML da tela
    const selos = (html) => Object.fromEntries([...html.matchAll(/<td id="lote-selo-([^"]+)">(.*?)<\/td>/g)]
        .map(m => [m[1], m[2].replace(/<[^>]+>/g, '').replace(/ \d+s$/, '')]));

    await teste('selos: Aguardando envio, Subindo e Falhou nas linhas certas; linha enviada sai da lista', async () => {
        const amb = criarAmbiente({ falhaEm: ['b'] });
        await abrirEConfirmar(amb);
        const doLoop = amb.renders.filter(r => r.progresso.ativo);
        // antes do primeiro envio: a sobe, b e c aguardam, d (sem rubrica) nao e da selecao
        deepEq(selos(doLoop[0].html), { a: 'Subindo...', b: 'Aguardando envio', c: 'Aguardando envio', d: '' });
        // a saiu da lista; b sobe
        deepEq(selos(doLoop[1].html), { b: 'Subindo...', c: 'Aguardando envio', d: '' });
        assert.ok(!doLoop[1].html.includes('id="lote-linha-a"'), 'linha enviada sai da lista');
        // b falhou: fica na lista com selo de falha e c sobe
        deepEq(selos(doLoop[2].html), { b: 'Falhou, tente de novo', c: 'Subindo...', d: '' });
        // depois do envio: so a falha segue com selo; o botao e os campos voltam ao normal
        const ultimo = amb.renders[amb.renders.length - 1];
        assert.strictEqual(ultimo.progresso.ativo, false);
        deepEq(selos(ultimo.html), { b: 'Falhou, tente de novo', d: '' });
        assert.ok(!/handleProcessarLoteItem\('b'\)" disabled/.test(ultimo.html));
        assert.ok(!/id="lote-rubrica-b"[^>]*disabled/.test(ultimo.html));
        assert.ok(/id="lote-rubrica-b"[^>]*value="Transporte"/.test(ultimo.html), 'rubrica digitada devolvida');
        // classes dos selos, sem icones
        assert.ok(doLoop[2].html.includes('<span class="badge status-error">Falhou, tente de novo</span>'));
        assert.ok(doLoop[0].html.includes('<span class="badge status-pending">Aguardando envio</span>'));
    });

    await teste('selos: enquanto enviando, campos e botoes de TODAS as linhas seguem desabilitados', async () => {
        const amb = criarAmbiente({ falhaEm: ['b'] });
        await abrirEConfirmar(amb);
        for (const r of amb.renders.filter(x => x.progresso.ativo)) {
            for (const id of r.fila.map(d => d.id)) {
                assert.ok(new RegExp(`id="lote-rubrica-${id}"[^>]*disabled`).test(r.html), 'campo ' + id);
                assert.ok(new RegExp(`handleProcessarLoteItem\\('${id}'\\)" disabled`).test(r.html), 'botao ' + id);
            }
        }
    });

    await teste('selos: novo lote limpa o selo de falha de quem entra de novo e o quadro explica que nao precisa subir de novo', async () => {
        const amb = criarAmbiente({ falhaEm: ['b'] });
        await abrirEConfirmar(amb);
        assert.strictEqual(amb.state.uploadLoteFalhas.b, true);
        const durante = amb.renders.find(r => r.progresso.ativo).html;
        assert.ok(durante.includes('Mantenha esta página aberta até terminar'));
        assert.ok(durante.includes('continuam na fila e podem ser processados de novo'));
        assert.ok(!durante.includes('continua mesmo se a tela parecer parada'), 'texto antigo, que induzia a erro, saiu');
        // segunda tentativa, agora sem falha: o selo some junto com a linha
        amb.ctx.document = { getElementById: (id) => { const m = /^lote-rubrica-(.+)$/.exec(id); return m && m[1] === 'b' ? { value: 'Transporte' } : null; } };
        amb.falhaEm.delete('b');
        const falhaB = amb.updates.length;
        await abrirEConfirmar(amb);
        assert.ok(amb.updates.length > falhaB);
        deepEq(amb.state.uploadLoteFalhas, {}, 'falha antiga limpa ao reenviar');
    });

    await teste('recarregamento da fila durante o envio preserva rubrica das linhas pendentes e nao traz de volta a ja enviada', async () => {
        let leitura = null;
        const amb = criarAmbiente({
            aoDisparar: async (id, ctx) => {
                // navegar para outra tela e voltar chama fetchUploadLoteQueue no meio do envio
                if (id === 'a') {
                    await ctx.fetchUploadLoteQueueReal();
                    leitura = ctx.state.uploadLoteQueue.map(d => ({ id: d.id, rubrica: d.rubrica, rubrica_id_fk: d.rubrica_id_fk }));
                }
            }
        });
        await abrirEConfirmar(amb);
        const por = Object.fromEntries(leitura.map(d => [d.id, d]));
        // o banco devolveu todas sem rubrica; as pendentes da selecao (b, c) voltam com a digitada
        assert.strictEqual(por.b.rubrica_id_fk, 'rub-2'); assert.strictEqual(por.b.rubrica, 'Transporte');
        assert.strictEqual(por.c.rubrica_id_fk, 'rub-1'); assert.strictEqual(por.c.rubrica, 'Hospedagem');
        // e a que nao era da selecao segue como o banco mandou
        assert.strictEqual(por.d.rubrica, null); assert.strictEqual(por.d.rubrica_id_fk, null);
        // o lote terminou normalmente
        deepEq(amb.ocr.chamadas, ['a', 'b', 'c']);
        assert.strictEqual(amb.updates.length, 3);
    });

    await teste('leitura da fila: quem ja foi enviado nao volta mesmo que a leitura o traga; fora do envio nada muda', async () => {
        const amb = criarAmbiente();
        amb.state.uploadLoteProgresso = {
            ativo: true, total: 3, feitos: 1, falhas: 0, atual: 'b', ids: ['a', 'b', 'c'], enviados: ['a'],
            rubricas: { a: { rubrica: 'Hospedagem', rubrica_id_fk: 'rub-1' }, b: { rubrica: 'Transporte', rubrica_id_fk: 'rub-2' }, c: { rubrica: 'Hospedagem', rubrica_id_fk: 'rub-1' } }
        };
        await amb.ctx.fetchUploadLoteQueueReal(); // o "banco" ainda tem as 4, como numa leitura iniciada antes da gravacao do a
        deepEq(amb.state.uploadLoteQueue.map(d => [d.id, d.rubrica_id_fk]), [['b', 'rub-2'], ['c', 'rub-1'], ['d', null]]);
        // sem envio ativo: o banco manda
        amb.state.uploadLoteProgresso = { ativo: false, total: 0, feitos: 0, falhas: 0, atual: null, ids: [], enviados: [], rubricas: {} };
        await amb.ctx.fetchUploadLoteQueueReal();
        deepEq(amb.state.uploadLoteQueue.map(d => [d.id, d.rubrica_id_fk]), [['a', null], ['b', null], ['c', null], ['d', null]]);
    });

    // ---- #153: outra aba/dispositivo do mesmo login processando (tempo real, sem banco novo) ----
    function domFalso(amb) {
        const nos = {};
        for (const id of ['a', 'b', 'c', 'd']) {
            nos[id] = {
                selo: { innerHTML: '' },
                controles: [{ tagName: 'INPUT', disabled: false }, { tagName: 'BUTTON', disabled: false }, { tagName: 'BUTTON', disabled: false }]
            };
        }
        amb.ctx.document = {
            getElementById: (id) => {
                let m = /^lote-linha-(.+)$/.exec(id);
                if (m) return { querySelectorAll: () => nos[m[1]].controles };
                m = /^lote-selo-(.+)$/.exec(id);
                if (m) return nos[m[1]].selo;
                m = /^lote-rubrica-(.+)$/.exec(id);
                return m ? { value: DIGITADO[m[1]] || '' } : null;
            }
        };
        return nos;
    }

    await teste('tempo real: documento da fila que saiu de aguardando_rubrica fora deste envio mostra Processando e trava a linha', async () => {
        const amb = criarAmbiente();
        const nos = domFalso(amb);
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'processing_ocr' });
        assert.strictEqual(amb.state.uploadLoteProcessandoFora.a, true);
        assert.strictEqual(nos.a.selo.innerHTML, '<span class="badge status-completed">Processando</span>');
        assert.ok(nos.a.controles.every(c => c.disabled), 'campo e botoes da linha travados');
        assert.ok(nos.b.controles.every(c => !c.disabled), 'outras linhas intactas');
        // a tela redesenhada mantem o selo e a trava so nessa linha
        const html = amb.ctx.UploadLoteView();
        deepEq(selos(html), { a: 'Processando', b: '', c: '', d: '' });
        assert.ok(/id="lote-rubrica-a"[^>]*disabled/.test(html) && !/id="lote-rubrica-b"[^>]*disabled/.test(html));
        assert.ok(/handleProcessarLoteItem\('a'\)" disabled/.test(html) && !/handleProcessarLoteItem\('b'\)" disabled/.test(html));
        // voltou para aguardando_rubrica: destrava
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'aguardando_rubrica' });
        deepEq(amb.state.uploadLoteProcessandoFora, {});
        assert.strictEqual(nos.a.selo.innerHTML, '');
        assert.ok(nos.a.controles.every(c => !c.disabled));
    });

    await teste('tempo real: ignora outra tela, documento fora da fila, documento oculto e as linhas deste proprio envio', async () => {
        const amb = criarAmbiente();
        domFalso(amb);
        amb.state.currentView = 'dashboard';
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'processing_ocr' });
        amb.state.currentView = 'upload_lote';
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'zzz', status: 'processing_ocr' });
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'processing_ocr', excluido_em: '2026-11-01' });
        amb.ctx.registrarMudancaDocumentoNoLote(null);
        amb.state.uploadLoteProgresso = { ativo: true, total: 2, feitos: 0, falhas: 0, atual: 'a', ids: ['a', 'b'], enviados: [], rubricas: {} };
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'processing_ocr' }); // o proprio envio gravando
        deepEq(amb.state.uploadLoteProcessandoFora, {});
        // mas uma linha fora da selecao deste envio, sim
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'd', status: 'processing_ocr' });
        assert.strictEqual(amb.state.uploadLoteProcessandoFora.d, true);
    });

    await teste('tempo real: "Processar todos" nao reenvia o documento que outra aba ja esta processando', async () => {
        const amb = criarAmbiente();
        domFalso(amb);
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'processing_ocr' });
        const modal = await abrirModal(amb);
        assert.ok(modal.message.startsWith('Processar 2 documento(s)?'), modal.message);
        await modal.onConfirm();
        deepEq(amb.updates.map(u => u.id), ['b', 'c']);
        deepEq(amb.ocr.chamadas, ['b', 'c']);
    });

    // ---- #153: status vindo do servidor ao reabrir a tela, e saida da tela durante o envio dos arquivos ----
    const minutosAtras = (m) => new Date(Date.now() - m * 60000).toISOString();
    const seloDe = (html, id) => (new RegExp(`<td id="lote-selo-${id}">(?:<span class="badge [a-z-]+">)?([^<]*)`).exec(html) || [])[1];

    await teste('reabrir a tela: nota ja enviada e em processamento no servidor aparece como Processando e travada; parada ha mais de 30 min e as que seguiram adiante ficam fora', async () => {
        const amb = criarAmbiente({
            extrasNoBanco: [
                { id: 'x1', name: 'enviada-1.pdf', file_path: 'p1/x1.pdf', project_id: 'p1', status: 'processing_ocr', updated_at: minutosAtras(2) },
                { id: 'x2', name: 'enviada-2.pdf', file_path: 'p1/x2.pdf', project_id: 'p1', status: 'aguardando_conformidade', updated_at: minutosAtras(5) },
                { id: 'x3', name: 'travada.pdf', file_path: 'p1/x3.pdf', project_id: 'p1', status: 'processing_ocr', updated_at: minutosAtras(90) },
                { id: 'x4', name: 'adiante.pdf', file_path: 'p1/x4.pdf', project_id: 'p1', status: 'aguardando_d3', updated_at: minutosAtras(1) }
            ]
        });
        await amb.ctx.fetchUploadLoteQueueReal();
        deepEq(amb.state.uploadLoteQueue.map(d => d.id), ['a', 'b', 'c', 'd', 'x1', 'x2']);
        deepEq(amb.state.uploadLoteProcessandoFora, { x1: true, x2: true });
        const html = amb.ctx.UploadLoteView();
        assert.strictEqual(seloDe(html, 'x1'), 'Processando');
        assert.strictEqual(seloDe(html, 'x2'), 'Processando');
        assert.strictEqual(seloDe(html, 'a'), '');
        assert.ok(/handleProcessarLoteItem\('x1'\)" disabled/.test(html) && !/handleProcessarLoteItem\('a'\)" disabled/.test(html), 'botao Processar da linha travado so nas processando');
        assert.ok(html.includes('2. Fila de documentos (6)'));
    });

    await teste('fim do "Processar todos": as notas recem-enviadas ja aparecem como Processando, sem esperar outra leitura', async () => {
        const amb = criarAmbiente({
            extrasNoBanco: [
                { id: 'a', name: 'nota-a.pdf', file_path: 'p1/a.pdf', project_id: 'p1', status: 'processing_ocr', updated_at: minutosAtras(0) }
            ]
        });
        amb.state.uploadLoteProgresso = {
            ativo: true, total: 1, feitos: 1, falhas: 0, atual: null, ids: ['a'], enviados: ['a'],
            rubricas: { a: { rubrica: 'Hospedagem', rubrica_id_fk: 'rub-1' } }
        };
        amb.idsNoBanco.delete('a'); // 'a' ja saiu de aguardando_rubrica
        await amb.ctx.fetchUploadLoteQueueReal();
        assert.ok(amb.state.uploadLoteQueue.some(d => d.id === 'a'), 'a enviada continua visivel');
        assert.strictEqual(amb.state.uploadLoteProcessandoFora.a, true);
    });

    await teste('tempo real: nota que seguiu adiante no fluxo sai da fila (linha e contador), sem render', async () => {
        const amb = criarAmbiente();
        let removida = false; const titulo = { textContent: '' };
        amb.ctx.document = { getElementById: (id) => id === 'lote-linha-b' ? { remove() { removida = true; }, querySelectorAll: () => [] } : (id === 'lote-fila-titulo' ? titulo : null) };
        const renders = amb.renders.length;
        amb.state.uploadLoteProcessandoFora = { b: true };
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'b', status: 'aguardando_d3' });
        assert.strictEqual(removida, true);
        deepEq(amb.state.uploadLoteQueue.map(d => d.id), ['a', 'c', 'd']);
        deepEq(amb.state.uploadLoteProcessandoFora, {});
        assert.strictEqual(titulo.textContent, '2. Fila de documentos (3)');
        assert.strictEqual(amb.renders.length, renders, 'nenhum render()');
        // validating continua sendo processamento: nao sai da fila
        amb.ctx.registrarMudancaDocumentoNoLote({ id: 'a', status: 'validating' });
        assert.ok(amb.state.uploadLoteQueue.some(d => d.id === 'a'));
        assert.strictEqual(amb.state.uploadLoteProcessandoFora.a, true);
    });

    await teste('envio dos arquivos: confirmacao de saida enquanto sobem e removida ao fim, inclusive com falha; mensagem nova na tela', async () => {
        const amb = criarAmbiente();
        amb.ctx.document = { getElementById: (id) => id === 'lote-project-selector' ? { value: 'p1' } : null };
        let noMeio = null;
        amb.ctx.subirParaStorage = async (file) => { noMeio = noMeio || amb.saida.map(x => x.acao); if (file.name === '2.pdf') throw new Error('rede'); return { id: file.name }; };
        await amb.window.handleLoteFilesSelected([{ name: '1.pdf' }, { name: '2.pdf' }]);
        deepEq(noMeio, ['add'], 'registrado antes de enviar');
        deepEq(amb.saida.map(x => x.acao + ':' + x.tipo), ['add:beforeunload', 'remove:beforeunload']);
        assert.strictEqual(amb.saida[0].fn, amb.saida[1].fn);
        const html = amb.ctx.conteudoUploadArquivosHtml({ total: 2, concluidos: 1, falhas: 1, estados: ['ok', 'falha'] });
        assert.ok(html.includes('Mantenha esta página aberta até terminar o envio dos arquivos'));
    });

    await teste('mensagem do envio em lote: manter aberta ate terminar o envio, depois pode sair e o processamento continua', async () => {
        const amb = criarAmbiente();
        let durante = '';
        amb.ctx.dispararOcr = async (id) => { if (id === 'a') durante = amb.ctx.UploadLoteView(); };
        await abrirEConfirmar(amb);
        assert.ok(durante.includes('Mantenha esta página aberta até terminar o envio.'));
        assert.ok(durante.includes('você pode sair: o processamento continua no servidor'));
    });

    // ---- #153 (interatividade): barra segmentada, contador por documento, aviso de saida, upload por arquivo ----
    await teste('quadro: role=status/aria-live e barra segmentada sem percentual; falha e concluido nas cores certas', async () => {
        const amb = criarAmbiente({ falhaEm: ['a'] });
        await abrirEConfirmar(amb);
        const doLoop = amb.renders.filter(r => r.progresso.ativo);
        assert.ok(/id="lote-progresso-envio" role="status" aria-live="polite"/.test(doLoop[0].html));
        const quadro = doLoop[0].html.slice(doLoop[0].html.indexOf('id="lote-progresso-envio"'), doLoop[0].html.indexOf('Mantenha esta'));
        assert.ok(!quadro.includes('salic-progress-fill') && !/width:\s*\d+%/.test(quadro) && !/\d+\s*%/.test(quadro), 'sem percentual falso');
        deepEq(segmentos(doLoop[1].html), ['falha', 'atual', 'espera']);
        assert.ok(doLoop[1].html.includes('Enviando documento 2 de 3') && doLoop[1].html.includes('Concluídos: 0. Com falha: 1.'));
    });

    await teste('linha atual: selo Subindo com segundos e barra fina; so ela, e nunca em render do fim', async () => {
        const amb = criarAmbiente();
        await abrirEConfirmar(amb);
        const durante = amb.renders.filter(r => r.progresso.ativo);
        for (const r of durante.slice(0, 3)) {
            assert.strictEqual((r.html.match(/lote-barra-indet/g) || []).length, 1, 'uma barra, so na linha atual');
            const atual = r.progresso.atual;
            assert.ok(new RegExp(`<td id="lote-selo-${atual}"><span class="badge status-completed">Subindo\\.\\.\\. <span id="lote-segundos-${atual}">\\d+s</span></span><div class="lote-barra-indet"`).test(r.html), 'selo da linha ' + atual);
        }
        const ultimo = amb.renders[amb.renders.length - 1];
        assert.ok(!ultimo.html.includes('lote-barra-indet') && !ultimo.html.includes('lote-segundos-'));
    });

    await teste('contador: um intervalo por documento, atualiza so o texto dos segundos (sem render) e tudo para no fim', async () => {
        const amb = criarAmbiente();
        // dispararOcr(a) so termina depois dos ticks
        let liberar; const trava = new Promise(r => { liberar = r; });
        amb.ctx.dispararOcr = async (id) => { if (id === 'a') await trava; };
        const modal = await abrirModal(amb);
        const p = modal.onConfirm();
        await tick();
        assert.strictEqual(amb.timers.length, 1);
        assert.strictEqual(amb.timers[0].ms, 1000);
        assert.ok(amb.timers[0].ativo);
        // o tick troca so o texto do elemento, sem render()
        const el = { textContent: '0s' };
        amb.ctx.document = { getElementById: (id) => id === 'lote-segundos-a' ? el : null };
        const rendersAntes = amb.renders.length;
        amb.state.uploadLoteProgresso.atualDesde = Date.now() - 12500;
        amb.timers[0].fn();
        assert.strictEqual(el.textContent, '12s');
        assert.strictEqual(amb.renders.length, rendersAntes, 'nenhum render()');
        liberar();
        await p;
        // um intervalo por documento enviado; o de cada documento para quando ele termina; nenhum sobra
        assert.strictEqual(amb.timers.length, 3);
        assert.ok(amb.timers.every(t => !t.ativo), 'todos parados no fim do lote');
        assert.strictEqual(amb.state.uploadLoteProgresso.atualDesde, null);
    });

    await teste('contador: parado tambem quando o lote termina com excecao', async () => {
        const amb = criarAmbiente({ fetchLanca: true });
        await assert.rejects(() => abrirEConfirmar(amb), /fetch quebrou/);
        assert.ok(amb.timers.length >= 1 && amb.timers.every(t => !t.ativo));
    });

    await teste('beforeunload: registrado durante o envio e removido no fim, inclusive com excecao', async () => {
        let amb = criarAmbiente();
        let noMeio = null;
        amb.ctx.dispararOcr = async (id) => { if (id === 'b') noMeio = amb.saida.map(s => s.acao); };
        await abrirEConfirmar(amb);
        deepEq(noMeio, ['add'], 'registrado e ainda nao removido no meio do envio');
        deepEq(amb.saida.map(s => s.acao + ':' + s.tipo), ['add:beforeunload', 'remove:beforeunload']);
        assert.strictEqual(amb.saida[0].fn, amb.saida[1].fn, 'remove o mesmo listener que registrou');
        // o listener pede confirmacao de verdade
        const ev = { preventDefault() { this.parou = true; }, returnValue: undefined };
        amb.saida[0].fn(ev);
        assert.strictEqual(ev.parou, true); assert.strictEqual(ev.returnValue, '');
        amb = criarAmbiente({ fetchLanca: true });
        await assert.rejects(() => abrirEConfirmar(amb), /fetch quebrou/);
        deepEq(amb.saida.map(s => s.acao), ['add', 'remove']);
        // cancelar o modal nao registra nada
        amb = criarAmbiente();
        await amb.window.handleProcessarTodosLote();
        amb.window.closeConfirmModal();
        deepEq(amb.saida, []);
    });

    await teste('estilo: quadro sticky abaixo de modais e sidebar mobile, fundo opaco, e reduced-motion sem animacao', async () => {
        const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
        const ini = css.indexOf('.lote-progresso-envio {');
        const regra = css.slice(ini, css.indexOf('}', ini));
        assert.ok(/position:\s*sticky/.test(regra) && /background:\s*var\(--bg-card/.test(regra));
        const z = Number((/z-index:\s*(\d+)/.exec(regra) || [])[1]);
        assert.ok(z > 0 && z < 100, 'z-index ' + z + ' abaixo de sidebar (100), overlay/menu mobile (998/1000) e modais (2000)');
        const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n    .lote-seg-atual'));
        assert.ok(rm.includes('animation: none') && rm.includes('.lote-barra-indet { display: none; }'));
        const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        assert.ok(/style\.css\?v=1\.0\.21/.test(idx) && /app\.js\?v=1\.0\.\d+/.test(idx));
    });

    // upload dos PDFs para a fila: progresso por arquivo sem render() a cada termino
    await teste('upload dos PDFs: X de N e barra segmentada por arquivo, atualizados sem render()', async () => {
        const amb = criarAmbiente();
        const caixa = { innerHTML: '' };
        amb.ctx.document = { getElementById: (id) => id === 'lote-project-selector' ? { value: 'p1' } : (id === 'lote-progresso-upload' ? caixa : null) };
        const resolvedores = [];
        amb.ctx.subirParaStorage = (file) => new Promise((res, rej) => resolvedores.push({ res, rej, file }));
        const p = amb.window.handleLoteFilesSelected([{ name: '1.pdf' }, { name: '2.pdf' }, { name: '3.pdf' }]);
        await tick();
        const inicial = amb.renders[amb.renders.length - 1];
        assert.ok(inicial.html.includes('id="lote-progresso-upload" role="status" aria-live="polite"'));
        assert.ok(inicial.html.includes('Enviando arquivos para a fila: 0 de 3'));
        deepEq(segmentos(inicial.html), ['atual', 'atual', 'atual']);
        const rendersAntes = amb.renders.length;
        resolvedores[1].res({ id: 'x' });
        await tick();
        assert.ok(caixa.innerHTML.includes('1 de 3') && caixa.innerHTML.includes('Concluídos: 1.'));
        deepEq(segmentos(caixa.innerHTML), ['atual', 'ok', 'atual']);
        resolvedores[0].rej(new Error('quebrou'));
        await tick();
        assert.ok(caixa.innerHTML.includes('2 de 3') && caixa.innerHTML.includes('Concluídos: 1. Com falha: 1.'));
        deepEq(segmentos(caixa.innerHTML), ['falha', 'ok', 'atual']);
        assert.strictEqual(amb.renders.length, rendersAntes, 'termino de cada arquivo nao redesenha a tela');
        resolvedores[2].res({ id: 'y' });
        await p;
        assert.strictEqual(amb.state.uploadArquivosProgresso, null);
        assert.strictEqual(amb.state.loading, false);
        assert.ok(!amb.renders[amb.renders.length - 1].html.includes('lote-progresso-upload'));
        assert.ok(amb.toasts.some(t => t.m.startsWith('2 arquivo(s) adicionado(s)')));
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
