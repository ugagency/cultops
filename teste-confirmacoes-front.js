// Testes das ocorrencias #129 e #131 do app.js, sem navegador e sem rede.
// As funcoes sao recortadas do codigo-fonte do app.js e rodam em um contexto com Supabase, fetch
// e tela falsos; o modal de confirmacao e o de verdade (showConfirmModal, cancelar e confirmar).
//  #131: as 7 acoes manuais so executam o efeito depois de confirmar; cancelar nao altera nada.
//  #129: a barra do extrato deixa de dizer "Enviando" quando o upload termina.
// Uso: node teste-confirmacoes-front.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ErrosRpa = require('./erros-rpa.js');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// Recorta um bloco do app.js: do marcador inicial ate o primeiro fecho da coluna zero.
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
    bloco('const STATUS_MAP = {', FIM_WINDOW),
    bloco('function rotuloStatusLegivel(', FIM_FUNCAO),
    bloco('function parseValorBR(', FIM_FUNCAO),
    bloco('function fmtBRLM1(', FIM_FUNCAO),
    bloco('window.showConfirmModal = function', FIM_WINDOW),
    bloco('window.__confirmModalMotivo = function', FIM_WINDOW),
    bloco('window.closeConfirmModal = function', FIM_WINDOW),
    bloco('window.__execConfirmModal = function', FIM_WINDOW),
    bloco('window.handleConsolidarGuiaM2 = async function', FIM_WINDOW),
    bloco('window.handleIgnorarGuiaDuplicadaM2 = async function', FIM_WINDOW),
    bloco('window.handleInformarPagamentoManual = async function', FIM_WINDOW),
    bloco('window.handleRejeitarNotaFornecedor = async function', FIM_WINDOW),
    bloco('window.handleMarcarDuplicidadeRevisada = async function', FIM_WINDOW),
    bloco('window.handleVincularRubrica = async function', FIM_WINDOW),
    bloco('async function executarVinculoRubricaImpl(', FIM_FUNCAO),
    bloco('window.handleEnviarSalic = async function', FIM_WINDOW),
    bloco('async function executarEnvioSalic(', FIM_FUNCAO),
    bloco('window.handleTentarNovamenteErroRpa = function', FIM_WINDOW),
    bloco('window.handleUploadExtrato = async function', FIM_WINDOW)
].join('\n');

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

// Supabase falso: cada operacao vira uma linha de log; update/insert/upsert/rpc contam como escrita.
function criarAmbiente(opcoes = {}) {
    const log = [];
    const rpcs = [];
    const chamadasFetch = [];
    const toasts = [];
    const estadoNoFetchDoWebhook = [];
    const contexto = { renders: 0 };

    const tabela = (nome) => {
        const op = { tabela: nome, acao: null, dados: null, filtros: [] };
        const api = {
            insert(d) { op.acao = 'insert'; op.dados = d; return api; },
            update(d) { op.acao = 'update'; op.dados = d; return api; },
            upsert(d) { op.acao = 'upsert'; op.dados = d; return api; },
            select() { if (!op.acao) op.acao = 'select'; return api; },
            eq(c, v) { op.filtros.push([c, v]); return api; },
            in(c, v) { op.filtros.push([c, v]); return api; },
            is(c, v) { op.filtros.push([c, v]); return api; },
            single() { return api; },
            maybeSingle() { return api; },
            then(res, rej) {
                log.push(op);
                const falha = opcoes.falhaUpdate && op.acao === 'update' && op.dados && op.dados.status === 'aguardando_conciliacao_bancaria';
                const data = nome === 'extratos' ? { id: 'ext-1' } : null;
                return Promise.resolve({ data, error: falha ? { message: 'falha' } : null }).then(res, rej);
            }
        };
        return api;
    };
    const supabaseClient = {
        from: tabela,
        rpc(nome, args) { rpcs.push({ nome, args }); return Promise.resolve({ data: nome === 'has_external_credential' ? true : { ok: true }, error: null }); },
        storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
        auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) }
    };

    const window = { ErrosRpa, prestaiErroAmigavel: (e) => 'erro: ' + e.message, prestaiN8nErro: (s) => new Error('n8n ' + s), showToast: null };
    const state = {
        user: { id: 'u1' }, loading: false, confirmModal: null, documents: [],
        currentDocument: null, currentComprovante: null, guiaDuplicataM2: null,
        isUploadingExtrato: false, isConciliandoExtrato: false, uploadConcluidoExtrato: false,
        justificativaSalicRascunho: null
    };
    const ctx = {
        window, state, supabaseClient, console: { log() { }, error() { }, warn() { } },
        CONFIG: { N8N_WEBHOOK_RECONCILIATION_URL: opcoes.semWebhook ? '' : 'http://n8n.local/webhook', SALIC_API_URL: '/api/salic/inserir' },
        document: { getElementById: (id) => (opcoes.campos ? opcoes.campos[id] : null) },
        render: () => { contexto.renders++; },
        showToast: (msg, tipo) => { toasts.push({ msg, tipo }); },
        setTimeout: () => 0,
        urlAssinadaParaWebhook: async () => 'http://arquivo',
        fetch: async (url, init) => {
            chamadasFetch.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
            if (String(url).includes('n8n.local')) {
                estadoNoFetchDoWebhook.push({ upload: state.isUploadingExtrato, conciliando: state.isConciliandoExtrato });
                if (opcoes.webhookFalha) return { ok: false, status: 500, statusText: 'x', json: async () => ({}) };
            }
            return { ok: true, status: 200, json: async () => ({ success: true }) };
        },
        window_location: {},
        userIsGestorOrAbove: () => true,
        userPodeResolverPagamento: () => true,
        separarNotasSemPagamento: async () => ({ liberados: [{}], bloqueados: [] }),
        salvarJustificativaSalic: async () => { log.push({ tabela: 'documents', acao: 'update', dados: { justificativa_salic: 'x' }, filtros: [] }); },
        rubricaExigeJustificativaSalic: () => false,
        isSaldoRubricasHabilitado: async () => !!opcoes.saldoLigado,
        resolverRubricaPorRotulo: () => ({ id: 'rub-1', nome: 'Hospedagem' }),
        fetchDocumentDetails: async () => { },
        atualizarNotaAposPagamento: async () => { },
        agendarRefreshDocumento: () => { },
        mensagemErroRpc: (e) => e.message,
        escAttr: (x) => String(x)
    };
    ctx.window.showToast = ctx.showToast;
    ctx.window.location = { href: '' };
    vm.createContext(ctx);
    vm.runInContext(CODIGO, ctx);
    return { ctx, state, window, log, rpcs, chamadasFetch, toasts, estadoNoFetchDoWebhook, contexto };
}

const enviosAoRobo = (amb) => amb.chamadasFetch.filter(c => String(c.url).includes('salic/inserir'));
const escritas = (amb) => amb.log.filter(o => ['insert', 'update', 'upsert'].includes(o.acao)).length + amb.rpcs.filter(r => r.nome !== 'has_external_credential').length;
async function confirmar(amb, motivo) {
    if (motivo !== undefined && amb.state.confirmModal) amb.window.__confirmModalMotivo(motivo);
    amb.window.__execConfirmModal();
    await tick();
}
async function cancelar(amb) { amb.window.closeConfirmModal(); await tick(); }
const textoModal = (amb) => {
    const m = amb.state.confirmModal;
    assert.ok(m, 'nenhum modal aberto');
    return m.title + '\n' + m.message;
};

const deepEq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const nota = (extra = {}) => ({ id: 'n1', project_id: 'p1', status: 'divergencia_valor', numero_nf: '4821', nome_emissor: 'Grafica Aurora', valor: 1500.5, cnpj_emissor: '1', data_emissao: '2026-01-01', ...extra });

(async () => {
    // ---------------------------------------------------------------- #131
    await teste('1. informar pagamento: validacoes continuam antes do modal; modal mostra data, transacao e valor', async () => {
        const campos = (extra = {}) => {
            const v = { 'pgto-data': '2026-03-09', 'pgto-nr': 'TX123', 'pgto-nr-conf': 'TX123', 'pgto-valor': '1.500,50', 'pgto-just': 'pagamento conferido no app do banco', ...extra };
            return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, { value: val }]));
        };
        // validacao falha: nenhum modal
        let amb = criarAmbiente({ campos: campos({ 'pgto-nr-conf': 'OUTRO' }) });
        await amb.window.handleInformarPagamentoManual('n1');
        assert.strictEqual(amb.state.confirmModal, null);
        assert.ok(amb.toasts.length === 1 && amb.toasts[0].tipo === 'error');
        amb = criarAmbiente({ campos: campos({ 'pgto-just': 'curta' }) });
        await amb.window.handleInformarPagamentoManual('n1');
        assert.strictEqual(amb.state.confirmModal, null);

        // validacoes ok: modal, sem RPC
        amb = criarAmbiente({ campos: campos() });
        amb.state.currentDocument = nota();
        await amb.window.handleInformarPagamentoManual('n1');
        const t = textoModal(amb);
        assert.ok(t.includes('09/03/2026') && t.includes('TX123') && /1\.500,50/.test(t), t);
        assert.ok(t.includes('sem conferência com o extrato'), t);
        assert.ok(t.includes('Divergência') || t.includes(ctxRotulo(amb, 'divergencia_valor')), 'status em rotulo legivel: ' + t);
        assert.ok(!t.includes('divergencia_valor'), 'nao mostra o codigo cru');
        assert.strictEqual(escritas(amb), 0, 'nada gravado antes de confirmar');
        assert.strictEqual(amb.state.loading, false);

        // cancelar: nada acontece
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        assert.strictEqual(amb.state.loading, false);
        assert.strictEqual(amb.state.confirmModal, null);

        // confirmar: RPC com os mesmos parametros
        await amb.window.handleInformarPagamentoManual('n1');
        await confirmar(amb);
        assert.strictEqual(amb.rpcs.length, 1);
        deepEq(amb.rpcs[0], { nome: 'informar_pagamento_manual', args: { p_document_id: 'n1', p_data: '2026-03-09', p_nr_transacao: 'TX123', p_valor: 1500.5, p_justificativa: 'pagamento conferido no app do banco' } });
        assert.strictEqual(amb.state.loading, false);
    });

    function ctxRotulo(amb, status) { return vm.runInContext(`rotuloStatusLegivel(${JSON.stringify(status)})`, amb.ctx); }

    await teste('2. vincular rubrica: sem saldo insuficiente aparece um modal; com saldo insuficiente, so o de saldo (nunca dois)', async () => {
        // saldo desligado: modal novo
        const campoRubrica = { 'vincular-rubrica-input': { value: 'Hospedagem' } };
        let amb = criarAmbiente({ campos: campoRubrica });
        amb.state.currentDocument = nota({ status: 'bloqueado_conformidade' });
        await amb.window.handleVincularRubrica('n1', 'p1', 1500.5);
        let t = textoModal(amb);
        assert.strictEqual(amb.state.confirmModal.title, 'Vincular rubrica');
        assert.ok(t.includes('Hospedagem') && /1\.500,50/.test(t), t);
        assert.ok(t.includes('Bloqueado') && t.includes('Em Processamento'), 'status atual e novo em rotulo legivel: ' + t);
        assert.ok(!/bloqueado_conformidade|processing_ocr/.test(t));
        assert.strictEqual(escritas(amb), 0);
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        assert.strictEqual(amb.state.loading, false);
        await amb.window.handleVincularRubrica('n1', 'p1', 1500.5);
        await confirmar(amb);
        const grava = amb.log.filter(o => ['upsert', 'update'].includes(o.acao));
        deepEq(grava.map(o => o.tabela), ['despesas', 'documents']);
        assert.strictEqual(grava[1].dados.status, 'processing_ocr');
        assert.strictEqual(amb.state.loading, false);

        // saldo ligado e insuficiente: o modal de saldo e o unico, e traz o resumo
        amb = criarAmbiente({ saldoLigado: true, campos: campoRubrica });
        amb.state.currentDocument = nota({ status: 'bloqueado_conformidade' });
        let modais = 0;
        const original = amb.window.showConfirmModal;
        amb.window.showConfirmModal = (o) => { modais++; return original(o); };
        amb.ctx.supabaseClient.from = ((orig) => (nome) => {
            if (nome === 'v_saldo_rubricas') {
                const a = { select: () => a, eq: () => a, maybeSingle: async () => ({ data: { disponivel_projetado: '100', disponivel_oficial: '100' } }) };
                return a;
            }
            return orig(nome);
        })(amb.ctx.supabaseClient.from);
        await amb.window.handleVincularRubrica('n1', 'p1', 1500.5);
        assert.strictEqual(modais, 1, 'um unico modal');
        t = textoModal(amb);
        assert.strictEqual(amb.state.confirmModal.title, 'Saldo insuficiente na rubrica');
        assert.ok(t.includes('Hospedagem') && t.includes('Em Processamento'), t);
        assert.strictEqual(escritas(amb), 0);
        await confirmar(amb);
        assert.strictEqual(modais, 1, 'confirmar o de saldo nao abre outro');
        assert.ok(escritas(amb) >= 2);

        // saldo ligado e suficiente: modal novo
        amb = criarAmbiente({ saldoLigado: true, campos: campoRubrica });
        amb.state.currentDocument = nota({ status: 'bloqueado_conformidade' });
        amb.ctx.supabaseClient.from = ((orig) => (nome) => {
            if (nome === 'v_saldo_rubricas') {
                const a = { select: () => a, eq: () => a, maybeSingle: async () => ({ data: { disponivel_projetado: '99999', disponivel_oficial: '99999' } }) };
                return a;
            }
            return orig(nome);
        })(amb.ctx.supabaseClient.from);
        await amb.window.handleVincularRubrica('n1', 'p1', 1500.5);
        assert.strictEqual(amb.state.confirmModal.title, 'Vincular rubrica');
    });

    await teste('2b. vincular rubrica: entrada invalida continua recusada antes de qualquer modal', async () => {
        let amb = criarAmbiente({ campos: {} });
        amb.ctx.document.getElementById = () => ({ value: '' });
        await amb.window.handleVincularRubrica('n1', 'p1', 10);
        assert.strictEqual(amb.state.confirmModal, null);
        assert.strictEqual(escritas(amb), 0);
    });

    await teste('3. rejeitar nota do fornecedor: sem prompt nativo, motivo minimo 10, status atual e novo, motivo gravado como esta', async () => {
        assert.ok(!/[^.\w]prompt\(/.test(bloco('window.handleRejeitarNotaFornecedor = async function', FIM_WINDOW)), 'prompt() nativo removido');
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'aguardando_aprovacao_fornecedor' });
        await amb.window.handleRejeitarNotaFornecedor('n1');
        const m = amb.state.confirmModal;
        assert.strictEqual(m.motivoMinimo, 10);
        assert.strictEqual(m.variant, 'danger');
        const t = textoModal(amb);
        assert.ok(t.includes('Aguardando aprovação') && t.includes('Rejeitada'), t);
        assert.ok(!/aguardando_aprovacao_fornecedor|rejeitado_fornecedor/.test(t));
        assert.strictEqual(escritas(amb), 0);
        // motivo curto: confirmar nao faz nada
        await confirmar(amb, 'curto');
        assert.strictEqual(escritas(amb), 0);
        assert.ok(amb.state.confirmModal, 'modal continua aberto');
        // cancelar
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        // confirmar com motivo valido (com espacos nas pontas)
        await amb.window.handleRejeitarNotaFornecedor('n1');
        await confirmar(amb, '  CNPJ da nota nao confere com o contrato  ');
        const up = amb.log.find(o => o.acao === 'update');
        deepEq(up.dados, { status: 'rejeitado_fornecedor', motivo_rejeicao_fornecedor: 'CNPJ da nota nao confere com o contrato' });
        deepEq(up.filtros, [['id', 'n1']]);
    });

    await teste('3b. rejeitar: sem permissao nao abre modal', async () => {
        const amb = criarAmbiente();
        amb.ctx.userIsGestorOrAbove = () => false;
        await amb.window.handleRejeitarNotaFornecedor('n1');
        assert.strictEqual(amb.state.confirmModal, null);
    });

    await teste('4. duplicidade revisada: explica o efeito; so grava depois de confirmar', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota();
        amb.state.documents = [nota()];
        await amb.window.handleMarcarDuplicidadeRevisada('n1');
        const t = textoModal(amb);
        assert.ok(/revisada/.test(t) && /pendências/.test(t) && /histórico/.test(t), t);
        assert.strictEqual(escritas(amb), 0);
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        assert.ok(!amb.state.currentDocument.duplicidade_revisada);
        await amb.window.handleMarcarDuplicidadeRevisada('n1');
        await confirmar(amb);
        deepEq(amb.log.find(o => o.acao === 'update').dados, { duplicidade_revisada: true });
        assert.strictEqual(amb.state.currentDocument.duplicidade_revisada, true);
        assert.strictEqual(amb.state.documents[0].duplicidade_revisada, true);
    });

    await teste('5. consolidar guias M2: texto do que o endpoint faz; cancelar nao chama o servidor nem trava a tela', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota();
        amb.state.guiaDuplicataM2 = { id: 'g-m2', competencia: '2026-02' };
        await amb.window.handleConsolidarGuiaM2('g-m2');
        const t = textoModal(amb);
        assert.ok(t.includes('marcada como paga') && t.includes('2026-02') && /apagada/.test(t) && /auditoria/.test(t), t);
        assert.strictEqual(amb.chamadasFetch.length, 0);
        assert.strictEqual(amb.state.loading, false);
        await cancelar(amb);
        assert.strictEqual(amb.chamadasFetch.length, 0);
        assert.strictEqual(amb.state.loading, false);
        assert.ok(amb.state.guiaDuplicataM2, 'o banner continua para decidir depois');
        await amb.window.handleConsolidarGuiaM2('g-m2');
        await confirmar(amb);
        assert.strictEqual(amb.chamadasFetch.length, 1);
        assert.strictEqual(amb.chamadasFetch[0].url, '/api/m2/impostos/consolidar-duplicata');
        deepEq(amb.chamadasFetch[0].body, { tax_guide_id_antiga: 'g-m2', document_id: 'n1' });
        assert.strictEqual(amb.state.loading, false);
        assert.strictEqual(amb.state.guiaDuplicataM2, null);
    });

    await teste('6. ignorar guia duplicada: o banner so some e a decisao so grava depois de confirmar', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota();
        amb.state.guiaDuplicataM2 = { id: 'g-m2' };
        await amb.window.handleIgnorarGuiaDuplicadaM2('g-m2');
        assert.ok(/duas guias/.test(textoModal(amb)) && /registrada/.test(textoModal(amb)));
        assert.ok(amb.state.guiaDuplicataM2, 'banner ainda na tela');
        assert.strictEqual(amb.chamadasFetch.length, 0);
        await cancelar(amb);
        assert.ok(amb.state.guiaDuplicataM2, 'cancelar mantem o banner');
        assert.strictEqual(amb.chamadasFetch.length, 0);
        await amb.window.handleIgnorarGuiaDuplicadaM2('g-m2');
        await confirmar(amb);
        assert.strictEqual(amb.state.guiaDuplicataM2, null);
        assert.strictEqual(amb.chamadasFetch.length, 1);
        assert.strictEqual(amb.chamadasFetch[0].url, '/api/m2/impostos/ignorar-duplicata');
        deepEq(amb.chamadasFetch[0].body, { document_id: 'n1', tax_guide_id: 'g-m2' });
    });

    await teste('7. enviar ao SALIC: modal depois das validacoes, com numero, fornecedor, valor e status; nada roda antes de confirmar', async () => {
        // validacao falha (campo faltando): sem modal
        let amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'liberado_rpa_airtop', numero_nf: '' });
        await amb.window.handleEnviarSalic('n1');
        assert.strictEqual(amb.state.confirmModal, null);
        assert.strictEqual(escritas(amb), 0);
        // pagamento nao identificado: sem modal
        amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'liberado_rpa_airtop' });
        amb.ctx.separarNotasSemPagamento = async () => ({ liberados: [], bloqueados: ['n1'] });
        await amb.window.handleEnviarSalic('n1');
        assert.strictEqual(amb.state.confirmModal, null);
        // justificativa obrigatoria ausente: sem modal
        amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'liberado_rpa_airtop' });
        amb.ctx.rubricaExigeJustificativaSalic = () => true;
        await amb.window.handleEnviarSalic('n1');
        assert.strictEqual(amb.state.confirmModal, null);

        // tudo certo: modal, e nada de justificativa gravada, isSalicRunning ou chamada ao robo
        amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'liberado_rpa_airtop' });
        await amb.window.handleEnviarSalic('n1');
        const t = textoModal(amb);
        assert.ok(t.includes('4821') && t.includes('Grafica Aurora') && /1\.500,50/.test(t), t);
        assert.ok(t.includes('Pronto para envio') && t.includes('Enviado ao SALIC') && t.includes('Erro no Envio'), t);
        assert.ok(!/liberado_rpa_airtop|enviado_salic|erro_rpa/.test(t), 'sem codigo cru');
        assert.strictEqual(escritas(amb), 0);
        assert.ok(!amb.state.isSalicRunning && !amb.state.loading);
        assert.strictEqual(enviosAoRobo(amb).length, 0);
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        assert.strictEqual(enviosAoRobo(amb).length, 0);
        assert.ok(!amb.state.isSalicRunning && !amb.state.loading);

        await amb.window.handleEnviarSalic('n1');
        await confirmar(amb);
        assert.strictEqual(enviosAoRobo(amb).length, 1);
        deepEq(enviosAoRobo(amb)[0].body, { documentId: 'n1' });
        assert.strictEqual(amb.state.loading, false);
        assert.strictEqual(amb.state.isSalicRunning, false);
    });

    await teste('7b. enviar ao SALIC: com confirmado=true (Tentar novamente com aviso proprio) nao abre segundo modal', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'erro_rpa', just_erro: '[TEMPO_ESGOTADO_SALVAMENTO] demorou' });
        await amb.window.handleEnviarSalic('n1', { confirmado: true });
        assert.strictEqual(amb.state.confirmModal, null);
        assert.strictEqual(enviosAoRobo(amb).length, 1);

        // pelo caminho real: o aviso do codigo e o unico modal; confirmar envia direto
        const amb2 = criarAmbiente();
        amb2.state.currentDocument = nota({ status: 'erro_rpa', just_erro: '[TEMPO_ESGOTADO_SALVAMENTO] demorou' });
        amb2.window.handleTentarNovamenteErroRpa('n1');
        assert.ok(amb2.state.confirmModal);
        await confirmar(amb2);
        assert.strictEqual(amb2.state.confirmModal, null, 'nenhum segundo modal');
        assert.strictEqual(enviosAoRobo(amb2).length, 1);

        // codigo sem aviso proprio: o modal do envio e o unico
        const amb3 = criarAmbiente();
        amb3.state.currentDocument = nota({ status: 'erro_rpa', just_erro: '[LOGIN_SALIC_RECUSADO] x' });
        amb3.ctx.window.ErrosRpa = { ...ErrosRpa, permiteReenviar: () => true };
        amb3.window.handleTentarNovamenteErroRpa('n1');
        await tick();
        assert.ok(amb3.state.confirmModal && amb3.state.confirmModal.title === 'Enviar ao SALIC');
    });

    await teste('as 4 acoes que ja tinham confirmacao continuam como estavam', () => {
        for (const f of ['handleForcarAvanco', 'handleConfirmarLancamentoNota', 'handleReprocessarDocumentoTravado', 'handleAprovarNotaFornecedor']) {
            const corpo = bloco('window.' + f + ' = ', FIM_WINDOW);
            assert.ok(corpo.includes('showConfirmModal'), f);
        }
        const antes = require('child_process').execSync('git show origin/main:app.js', { cwd: __dirname, maxBuffer: 1 << 28 }).toString().replace(/\r\n/g, '\n');
        // handleForcarAvanco mudou de proposito no #125 (anexa o motivo original ao texto de override); continua
        // com a confirmacao (conferida acima) e o texto novo e coberto por teste-avancar-motivo-original.js.
        for (const f of ['handleConfirmarLancamentoNota', 'handleReprocessarDocumentoTravado', 'handleAprovarNotaFornecedor']) {
            const ini = 'window.' + f + ' = ';
            const a = antes.indexOf(ini);
            const b = SRC.indexOf(ini);
            assert.strictEqual(antes.slice(a, antes.indexOf(FIM_WINDOW, a)), SRC.slice(b, SRC.indexOf(FIM_WINDOW, b)), f + ' foi alterada');
        }
    });

    // ---------------------------------------------------------------- #129
    const arquivo = { name: 'extrato.ofx' };
    await teste('#129: a barra deixa de ser "Enviando" antes do webhook e a flag nova cai no fim (primeiro envio)', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'aguardando_conciliacao_bancaria' });
        await amb.window.handleUploadExtrato(arquivo, 'p1', 'n1', '', false);
        deepEq(amb.estadoNoFetchDoWebhook, [{ upload: false, conciliando: true }], 'ao chamar o webhook: nao esta mais enviando, esta conciliando');
        assert.strictEqual(amb.state.isUploadingExtrato, false);
        assert.strictEqual(amb.state.isConciliandoExtrato, false);
        assert.strictEqual(amb.state.loading, false);
        assert.strictEqual(amb.state.uploadConcluidoExtrato, true, 'estado final como antes');
        assert.strictEqual(amb.toasts.filter(t => t.tipo === 'success').length, 1);
    });

    await teste('#129: o render() acontece entre o fim do envio e o webhook', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'aguardando_conciliacao_bancaria' });
        const instantaneos = [];
        amb.ctx.render = () => instantaneos.push({ up: amb.state.isUploadingExtrato, conc: amb.state.isConciliandoExtrato, fetchs: amb.chamadasFetch.filter(c => String(c.url).includes('n8n.local')).length });
        await amb.window.handleUploadExtrato(arquivo, 'p1', 'n1', '', false);
        deepEq(instantaneos[0], { up: true, conc: false, fetchs: 0 }, 'inicio: enviando');
        deepEq(instantaneos[1], { up: false, conc: true, fetchs: 0 }, 'antes do webhook: conciliando');
        deepEq(instantaneos[instantaneos.length - 1], { up: false, conc: false, fetchs: 1 }, 'fim: tudo zerado');
    });

    await teste('#129: substituicao com erro do webhook devolve status e just_erro originais e a barra some', async () => {
        const amb = criarAmbiente({ webhookFalha: true });
        amb.state.currentDocument = nota({ status: 'divergencia_valor', just_erro: 'Valor diverge' });
        await amb.window.handleUploadExtrato(arquivo, 'p1', 'n1', '', true);
        deepEq(amb.estadoNoFetchDoWebhook, [{ upload: false, conciliando: true }]);
        assert.strictEqual(amb.state.isConciliandoExtrato, false);
        assert.strictEqual(amb.state.isUploadingExtrato, false);
        assert.strictEqual(amb.state.loading, false);
        const updates = amb.log.filter(o => o.tabela === 'documents' && o.acao === 'update').map(o => o.dados);
        deepEq(updates, [
            { status: 'aguardando_conciliacao_bancaria', just_erro: null },
            { status: 'divergencia_valor', just_erro: 'Valor diverge' }
        ]);
        assert.strictEqual(amb.state.currentDocument.status, 'divergencia_valor');
        assert.ok(amb.toasts.some(t => t.tipo === 'error'));
        assert.strictEqual(amb.state.uploadConcluidoExtrato, false);
    });

    await teste('#129: erro antes do webhook (Storage) nunca liga "Conciliando"', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ status: 'aguardando_conciliacao_bancaria' });
        amb.ctx.supabaseClient.storage = { from: () => ({ upload: async () => ({ error: new Error('storage') }) }) };
        const vistos = [];
        amb.ctx.render = () => vistos.push(amb.state.isConciliandoExtrato);
        await amb.window.handleUploadExtrato(arquivo, 'p1', 'n1', '', false);
        assert.ok(vistos.every(v => v === false));
        assert.strictEqual(amb.state.isUploadingExtrato, false);
    });

    await teste('#129: sem webhook configurado nao passa por "Conciliando"', async () => {
        const amb = criarAmbiente({ semWebhook: true });
        amb.state.currentDocument = nota({ status: 'aguardando_conciliacao_bancaria' });
        const vistos = [];
        amb.ctx.render = () => vistos.push(amb.state.isConciliandoExtrato);
        await amb.window.handleUploadExtrato(arquivo, 'p1', 'n1', '', false);
        assert.ok(vistos.every(v => v === false));
    });

    await teste('#129: tela e demais leitores de isUploadingExtrato (conferidos no codigo-fonte)', () => {
        const texto = 'Extrato enviado. Conciliando com o extrato, isso pode levar alguns instantes...';
        assert.strictEqual(SRC.split(texto).length - 1, 1, 'o texto existe uma vez e e reutilizado nos dois quadros');
        // quadro do primeiro envio e da substituicao com o status ja reiniciado
        assert.ok(/if \(state\.isConciliandoExtrato\) \{\n\s+extratoBoxHtml = barraConciliandoExtratoHtml;\n\s+\} else if \(state\.isUploadingExtrato\)/.test(SRC));
        // quadro de divergencia: a barra substitui o botao Substituir Extrato
        assert.ok(/\$\{state\.isConciliandoExtrato \? barraConciliandoExtratoHtml : state\.isUploadingExtrato \?/.test(SRC));
        // segundo envio fica bloqueado no atalho "Subir o extrato correto"
        assert.ok(/!state\.isUploadingExtrato && !state\.isConciliandoExtrato && !state\.uploadConcluidoExtrato/.test(SRC));
        // assinatura que decide se o refresh redesenha, e troca de documento
        assert.ok(/!!state\.isUploadingExtrato, !!state\.isConciliandoExtrato,/.test(SRC));
        assert.ok(/state\.isUploadingExtrato = false;\n\s+state\.isConciliandoExtrato = false;\n\s+state\.mostrarUploadManualExtrato = false;/.test(SRC));
        // so um lugar liga a flag
        assert.strictEqual(SRC.split('state.isConciliandoExtrato = true;').length - 1, 1);
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
