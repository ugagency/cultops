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
    bloco('function bloqueioPorRubricaNaoInformada(', FIM_FUNCAO),
    bloco('function rubricaEscolhidaIgualAtual(', FIM_FUNCAO),
    'const MSG_MESMA_RUBRICA_BLOQUEIO = "x";',
    bloco('const ROTULO_ERRO_OCR_MAX_TENTATIVAS', ';\n'),
    bloco('const PREFIXO_ERRO_OCR_TIMEOUT', ';\n'),
    bloco('function jsonExtraidoVazio(', FIM_FUNCAO),
    bloco('function podeLerDocumentoDeNovo(', FIM_FUNCAO),
    bloco('window.handleReprocessarDocumentoTravado = async function', FIM_WINDOW),
    bloco('window.handleVincularRubrica = async function', FIM_WINDOW),
    bloco('async function executarVinculoRubricaImpl(', FIM_FUNCAO),
    bloco('window.handleEnviarSalic = async function', FIM_WINDOW),
    bloco('async function executarEnvioSalic(', FIM_FUNCAO),
    bloco('window.handleTentarNovamenteErroRpa = function', FIM_WINDOW),
    bloco('window.handleUploadExtrato = async function', FIM_WINDOW),
    // #162
    bloco('const EXTRATO_LEITURA_INTERVALO_MS =', ';\n'),
    bloco('const EXTRATO_LEITURA_LIMITE_MS =', ';\n'),
    bloco('const MSG_EXTRATO_LENDO =', ';\n'),
    bloco('const MSG_EXTRATO_ERRO_LEITURA =', ';\n'),
    bloco('const MSG_EXTRATO_LEITURA_DEMORA =', ';\n'),
    bloco('let temporizadorExtratoEmLeitura =', ';\n'),
    bloco('function extratoEmLeituraDoDoc(', FIM_FUNCAO),
    bloco('function avisoLeituraExtratoHtml(', FIM_FUNCAO),
    bloco('function extratoLendoHtml(', FIM_FUNCAO),
    bloco('function pararAcompanhamentoExtrato(', FIM_FUNCAO),
    bloco('function iniciarAcompanhamentoExtrato(', FIM_FUNCAO),
    bloco('function agendarConsultaExtratoEmLeitura(', FIM_FUNCAO),
    bloco('async function devolverStatusOriginalDaSubstituicao(', FIM_FUNCAO),
    bloco('async function consultarExtratoEmLeitura(', FIM_FUNCAO),
    bloco('window.handleSubirExtratoCorreto = function', FIM_WINDOW),
    // #163 e #157
    bloco('const TOLERANCIA_VALOR_LANCAMENTO =', ';\n'),
    bloco('function fmtValorExtrato(', FIM_FUNCAO),
    bloco('function mensagemAmpliarBusca(', FIM_FUNCAO),
    bloco('function lancamentoForaDoPeriodo(', FIM_FUNCAO),
    bloco('window.handleAmpliarCandidatos = async function', FIM_WINDOW),
    bloco('window.handleConfirmarLancamentoNota = function', FIM_WINDOW),
    bloco('window.handleAtualizarSaldoSalic = function', FIM_WINDOW),
    bloco('async function executarAtualizarSaldoSalic(', FIM_FUNCAO),
    bloco('window.handleRemoverExtratoLote = function', FIM_WINDOW),
    bloco('async function executarRemoverExtratoLote(', FIM_FUNCAO),
    bloco('window.handleIniciarEnvioLote = async function', FIM_WINDOW),
    bloco('async function iniciarEnvioLoteConfirmado(', FIM_FUNCAO),
    bloco('window.salvarCamposManuais = async function', FIM_WINDOW),
    bloco('async function executarSalvarCamposManuais(', FIM_FUNCAO),
    bloco('function normalizarTextoAuditoria(', FIM_FUNCAO),
    bloco('function auditoriaListouLancamentosAceitos(', FIM_FUNCAO),
    bloco('function auditoriaRejeitouLancamentos(', FIM_FUNCAO),
    bloco('function lancamentosCitadosAuditoria(', FIM_FUNCAO),
    bloco('function lancamentosRecusadosAuditoria(', FIM_FUNCAO),
    bloco('function extrairLancamentosDoTexto(', FIM_FUNCAO),
    bloco('window.handleUsarLancamentoRecusado = function', FIM_WINDOW),
    bloco('function abrirFormularioComLancamento(', FIM_FUNCAO)
].join('\n');

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

// Supabase falso: cada operacao vira uma linha de log; update/insert/upsert/rpc contam como escrita.
function criarAmbiente(opcoes = {}) {
    const log = [];
    const rpcs = [];
    const chamadasFetch = [];
    const toasts = [];
    const estadoNoFetchDoWebhook = [];
    const contexto = { renders: 0, ocr: [], refresh: [] };
    // #162: relogio e temporizadores falsos; status do extrato que a consulta periodica enxerga
    const relogio = { t: 1700000000000, timers: [] };
    class DataFalsa extends Date { static now() { return relogio.t; } }
    const extratoStatus = { valor: 'pendente' };

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
                const data = nome === 'extratos' ? (op.acao === 'select' ? { status: extratoStatus.valor } : { id: 'ext-1' }) : null;
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
        CONFIG: { N8N_WEBHOOK_RECONCILIATION_URL: opcoes.semWebhook ? '' : 'http://n8n.local/webhook', N8N_WEBHOOK_VALIDATION_URL: 'http://validacao.local/wh', SALIC_API_URL: '/api/salic/inserir' },
        dispararOcr: async (id, caminho) => { contexto.ocr.push({ id, caminho }); },
        document: { getElementById: (id) => (opcoes.campos ? opcoes.campos[id] : null), querySelectorAll: () => opcoes.checks || [] },
        filtroCandidatosDaNota: () => ({ escopo: opcoes.escopo || 'extrato' }),
        fmtDataExtrato: (d) => (d ? String(d) : '---'),
        fetchSaldoRubricas: async () => { },
        atualizarSaldoEnvioLote: async () => { },
        salvarFilaSalic: () => { },
        processarFilaSalic: () => { contexto.fila = (contexto.fila || 0) + 1; },
        render: () => { contexto.renders++; },
        showToast: (msg, tipo) => { toasts.push({ msg, tipo }); },
        setTimeout: (fn, ms) => { relogio.timers.push({ fn, ms, ativo: true }); return relogio.timers.length; },
        clearTimeout: (id) => { if (relogio.timers[id - 1]) relogio.timers[id - 1].ativo = false; },
        Date: DataFalsa,
        urlAssinadaParaWebhook: async () => 'http://arquivo',
        caminhoStorageExtrato: (projectId, nome) => `${projectId}/uuid-teste/${nome}`,
        fetch: async (url, init) => {
            chamadasFetch.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
            if (String(url).includes('n8n.local')) {
                estadoNoFetchDoWebhook.push({ upload: state.isUploadingExtrato, conciliando: state.isConciliandoExtrato });
                if (opcoes.webhookRede) throw new TypeError('Failed to fetch');
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
        agendarRefreshDocumento: (id, op) => { contexto.refresh.push({ id, forcar: !!(op && op.forcar) }); },
        mensagemErroRpc: (e) => e.message,
        escAttr: (x) => String(x)
    };
    ctx.window.showToast = ctx.showToast;
    ctx.window.CandidatosLancamento = require('./candidatos-lancamento.js');
    ctx.window.location = { href: '' };
    vm.createContext(ctx);
    vm.runInContext(CODIGO, ctx);
    return { ctx, state, window, log, rpcs, chamadasFetch, toasts, estadoNoFetchDoWebhook, contexto, relogio, extratoStatus };
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
        assert.ok(t.includes('Bloqueado') && t.includes('Em Auditoria IA'), 'status atual e novo em rotulo legivel: ' + t);
        assert.ok(!/bloqueado_conformidade|processing_ocr/.test(t));
        assert.strictEqual(escritas(amb), 0);
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        assert.strictEqual(amb.state.loading, false);
        await amb.window.handleVincularRubrica('n1', 'p1', 1500.5);
        await confirmar(amb);
        const grava = amb.log.filter(o => ['upsert', 'update'].includes(o.acao));
        deepEq(grava.map(o => o.tabela), ['despesas', 'documents']);
        // #150: o OCR ja rodou; revalidar nao pode voltar para processing_ocr (colide com os crons de OCR travado)
        assert.strictEqual(grava[1].dados.status, 'aguardando_conformidade');
        assert.strictEqual(grava[1].dados.just_erro, null);
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
        assert.ok(t.includes('Hospedagem') && t.includes('Em Auditoria IA'), t);
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
        // handleReprocessarDocumentoTravado mudou de proposito no #150 (ramo da validacao); coberto nos testes #150 abaixo.
        // handleConfirmarLancamentoNota mudou de proposito no #163 (aviso de lancamento fora do periodo); coberto nos testes #163 abaixo.
        for (const f of ['handleAprovarNotaFornecedor']) {
            const ini = 'window.' + f + ' = ';
            const a = antes.indexOf(ini);
            const b = SRC.indexOf(ini);
            assert.strictEqual(antes.slice(a, antes.indexOf(FIM_WINDOW, a)), SRC.slice(b, SRC.indexOf(FIM_WINDOW, b)), f + ' foi alterada');
        }
    });

    // ---------------------------------------------------------------- #162
    const arquivoOfx = { name: 'extrato.ofx' };
    const docEmTela = (extra = {}) => ({ id: 'n1', status: 'aguardando_conciliacao_bancaria', just_erro: null, project_id: 'p1', ...extra });
    const preparar = (opcoes = {}, doc = docEmTela()) => {
        const amb = criarAmbiente(opcoes);
        amb.state.currentView = 'details';
        amb.state.currentDocument = doc;
        amb.state.documents = [doc];
        return amb;
    };
    const subiu = (amb, replace = false) => amb.window.handleUploadExtrato(arquivoOfx, 'p1', 'n1', '', replace);
    // so as consultas do acompanhamento (5 s); o setTimeout de 2,5 s do refresh pos-upload e outro assunto
    const timersAtivos = (amb) => amb.relogio.timers.filter(t => t.ativo && t.ms === 5000);
    const refreshForcado = (amb) => amb.contexto.refresh.filter(r => r.forcar);
    // avanca o relogio falso e roda os temporizadores pendentes (uma rodada de consulta por chamada)
    async function passar(amb, ms) {
        amb.relogio.t += ms;
        const pendentes = amb.relogio.timers.filter(t => t.ativo);
        pendentes.forEach(t => { t.ativo = false; });
        for (const t of pendentes) { await t.fn(); await tick(); }
    }

    await teste('#162: depois do insert a tela passa a acompanhar o extrato; ao sair de pendente encerra e atualiza o documento', async () => {
        const amb = preparar();
        await subiu(amb);
        deepEq({ doc: amb.state.extratoEmLeitura.docId, ext: amb.state.extratoEmLeitura.extratoId }, { doc: 'n1', ext: 'ext-1' });
        assert.strictEqual(timersAtivos(amb).length, 1);
        assert.strictEqual(timersAtivos(amb)[0].ms, 5000);
        await passar(amb, 5000);
        assert.ok(amb.state.extratoEmLeitura, 'ainda pendente: continua acompanhando');
        assert.strictEqual(timersAtivos(amb).length, 1);
        amb.extratoStatus.valor = 'processado';
        await passar(amb, 5000);
        assert.strictEqual(amb.state.extratoEmLeitura, null);
        assert.strictEqual(amb.state.avisoLeituraExtrato, null);
        deepEq(refreshForcado(amb), [{ id: 'n1', forcar: true }]);
        assert.strictEqual(timersAtivos(amb).length, 0);
    });

    await teste('#162: extrato com status erro mostra a mensagem de erro e libera o envio', async () => {
        const amb = preparar();
        await subiu(amb);
        amb.extratoStatus.valor = 'erro';
        await passar(amb, 5000);
        deepEq(amb.state.avisoLeituraExtrato, { docId: 'n1', tipo: 'erro' });
        assert.strictEqual(amb.state.extratoEmLeitura, null);
        deepEq(refreshForcado(amb), [{ id: 'n1', forcar: true }]);
        assert.ok(amb.ctx.avisoLeituraExtratoHtml({ id: 'n1' }).includes('Não foi possível ler este extrato. Envie o arquivo de novo ou informe o pagamento manualmente.'));
        assert.strictEqual(amb.ctx.avisoLeituraExtratoHtml({ id: 'outro' }), '');
    });

    await teste('#162: passou de 3 minutos pendente: mostra "A leitura esta demorando", libera o envio e atualiza', async () => {
        const amb = preparar();
        await subiu(amb);
        for (let i = 0; i < 35; i++) await passar(amb, 5000); // 175 s
        assert.ok(amb.state.extratoEmLeitura, 'antes dos 3 minutos continua acompanhando');
        await passar(amb, 5000); // 180 s
        assert.strictEqual(amb.state.extratoEmLeitura, null);
        deepEq(amb.state.avisoLeituraExtrato, { docId: 'n1', tipo: 'demora' });
        assert.ok(amb.ctx.avisoLeituraExtratoHtml({ id: 'n1' }).includes('A leitura está demorando. Você pode aguardar ou enviar outro arquivo.'));
        deepEq(refreshForcado(amb), [{ id: 'n1', forcar: true }]);
        // primeiro envio (nao e substituicao): nada a devolver
        assert.strictEqual(amb.log.filter(o => o.acao === 'update').length, 0);
    });

    await teste('#162: substituicao que estoura o tempo devolve o status original, mas so se o documento ainda estiver no status do envio', async () => {
        const original = docEmTela({ status: 'divergencia_beneficiario', just_erro: 'Beneficiario diferente' });
        const amb = preparar({}, original);
        await subiu(amb, true);
        deepEq(amb.log.filter(o => o.acao === 'update').map(o => o.dados), [{ status: 'aguardando_conciliacao_bancaria', just_erro: null }]);
        for (let i = 0; i < 36; i++) await passar(amb, 5000);
        const ups = amb.log.filter(o => o.acao === 'update');
        deepEq(ups.map(o => o.dados), [{ status: 'aguardando_conciliacao_bancaria', just_erro: null }, { status: 'divergencia_beneficiario', just_erro: 'Beneficiario diferente' }]);
        deepEq(ups[1].filtros, [['id', 'n1'], ['status', 'aguardando_conciliacao_bancaria']], 'so devolve se o status ainda for o do envio');
        assert.strictEqual(amb.state.currentDocument.status, 'divergencia_beneficiario');
    });

    await teste('#162: falha de rede no webhook com o extrato ja gravado nao e erro definitivo nem devolve o status antigo', async () => {
        const original = docEmTela({ status: 'divergencia_beneficiario', just_erro: 'Beneficiario diferente' });
        const amb = preparar({ webhookRede: true }, original);
        await subiu(amb, true);
        assert.ok(amb.state.extratoEmLeitura, 'continua acompanhando');
        assert.strictEqual(amb.toasts.filter(t => t.tipo === 'error').length, 0);
        assert.ok(amb.toasts.some(t => t.tipo === 'info'));
        // nenhum UPDATE de devolucao: so o do envio
        deepEq(amb.log.filter(o => o.acao === 'update').map(o => o.dados), [{ status: 'aguardando_conciliacao_bancaria', just_erro: null }]);
        assert.strictEqual(amb.state.currentDocument.status, 'aguardando_conciliacao_bancaria');
        assert.strictEqual(amb.state.isUploadingExtrato, false);
        assert.strictEqual(amb.state.isConciliandoExtrato, false);
        amb.extratoStatus.valor = 'processado';
        await passar(amb, 5000);
        assert.strictEqual(amb.state.extratoEmLeitura, null);
        assert.strictEqual(amb.log.filter(o => o.acao === 'update').length, 1, 'continua sem devolucao');
    });

    await teste('#162: resposta HTTP de erro do webhook continua sendo erro: para o acompanhamento e devolve o status', async () => {
        const original = docEmTela({ status: 'divergencia_beneficiario', just_erro: 'Beneficiario diferente' });
        const amb = preparar({ webhookFalha: true }, original);
        await subiu(amb, true);
        assert.strictEqual(amb.state.extratoEmLeitura, null);
        assert.strictEqual(timersAtivos(amb).length, 0);
        assert.ok(amb.toasts.some(t => t.tipo === 'error'));
        deepEq(amb.log.filter(o => o.acao === 'update').map(o => o.dados), [{ status: 'aguardando_conciliacao_bancaria', just_erro: null }, { status: 'divergencia_beneficiario', just_erro: 'Beneficiario diferente' }]);
    });

    await teste('#162: trocar de documento durante a leitura encerra o acompanhamento sem atualizar nada', async () => {
        const amb = preparar();
        await subiu(amb);
        amb.state.currentDocument = docEmTela({ id: 'outro' });
        amb.extratoStatus.valor = 'processado';
        await passar(amb, 5000);
        assert.strictEqual(amb.state.extratoEmLeitura, null);
        assert.strictEqual(refreshForcado(amb).length, 0);
        assert.strictEqual(timersAtivos(amb).length, 0);
    });

    await teste('#162: novo envio reinicia o acompanhamento e apaga o aviso anterior', async () => {
        const amb = preparar();
        await subiu(amb);
        amb.state.avisoLeituraExtrato = { docId: 'n1', tipo: 'demora' };
        const primeiro = timersAtivos(amb)[0];
        await subiu(amb);
        assert.strictEqual(primeiro.ativo, false, 'consulta antiga cancelada');
        assert.strictEqual(timersAtivos(amb).length, 1);
        assert.strictEqual(amb.state.avisoLeituraExtrato, null);
    });

    await teste('#162: a tela esconde os tres botoes de envio durante a leitura e mostra a mensagem', () => {
        const amb = criarAmbiente();
        amb.state.extratoEmLeitura = { docId: 'n1', extratoId: 'e1', desde: 0, original: null };
        assert.strictEqual(amb.ctx.extratoEmLeituraDoDoc({ id: 'n1' }), true);
        assert.strictEqual(amb.ctx.extratoEmLeituraDoDoc({ id: 'n2' }), false);
        assert.ok(amb.ctx.extratoLendoHtml().includes('Extrato recebido. Lendo e conciliando, pode levar cerca de 1 minuto. Não é preciso enviar de novo.'));
        // caixa do extrato e bloco de divergencia: o ramo da leitura vem antes do botao
        assert.ok(/else if \(extratoEmLeituraDoDoc\(doc\)\) \{\n[^\n]*\n\s*extratoBoxHtml = extratoLendoHtml\(\);/.test(SRC));
        assert.ok(SRC.includes(': extratoEmLeituraDoDoc(doc) ? extratoLendoHtml() :'));
        assert.ok(SRC.includes("${temSubstituir || extratoEmLeituraDoDoc(doc) ? '' : `<button"));
        // "Subir o extrato correto" tambem nao age durante a leitura
        const corpo = bloco('window.handleSubirExtratoCorreto = function', FIM_WINDOW);
        assert.ok(corpo.indexOf('state.extratoEmLeitura') > 0 && corpo.indexOf('state.extratoEmLeitura') < corpo.indexOf('mostrarUploadManualExtrato'));
        // tempos como constantes nomeadas
        assert.ok(SRC.includes('const EXTRATO_LEITURA_INTERVALO_MS = 5000;') && SRC.includes('const EXTRATO_LEITURA_LIMITE_MS = 3 * 60 * 1000;'));
    });

    await teste('#162: janela Vincular extrato mostra o arquivo enviado, troca o botao e diz que a conciliacao comeca em ate 1 minuto', () => {
        assert.ok(SRC.includes('v.enviadoNome = file.name;'));
        assert.ok(SRC.includes('Extrato enviado: ${escHtml(v.enviadoNome)}'));
        assert.ok(SRC.includes("v.enviadoNome ? 'Enviar outro extrato'"));
        assert.ok(SRC.includes('e começa em até 1 minuto.'));
        assert.ok(!SRC.includes('e começa em até alguns minutos.'));
    });

    // ---------------------------------------------------------------- #163
    const chk = (id, nome) => ({ getAttribute: (a) => ({ 'data-id': id, 'data-name': nome, 'data-project': 'P', 'data-project-id': 'p1' })[a] });

    await teste('#163: Procurar em outros extratos pede confirmacao com o criterio; cancelar nao amplia, confirmar amplia', async () => {
        const amb = criarAmbiente({ escopo: 'extrato' });
        amb.state.currentDocument = nota({ id: 'n1' });
        await amb.window.handleAmpliarCandidatos('n1');
        assert.strictEqual(amb.state.confirmModal.title, 'Procurar em outros extratos');
        const t = textoModal(amb);
        assert.ok(t.includes('sai do extrato conferido') && t.includes('R$ 0,02') && t.includes('nenhuma outra nota usou') && t.includes('um lançamento de outro mês'));
        await cancelar(amb);
        assert.strictEqual(amb.state.ampliarCandidatos, undefined);
        await amb.window.handleAmpliarCandidatos('n1');
        await confirmar(amb);
        deepEq(amb.state.ampliarCandidatos, { docId: 'n1', ativo: true });
    });

    await teste('#163: o texto da confirmacao muda quando a busca sai da janela de datas, e usa a tolerancia do codigo', async () => {
        const amb = criarAmbiente({ escopo: 'janela' });
        amb.state.currentDocument = nota({ id: 'n1' });
        await amb.window.handleAmpliarCandidatos('n1');
        assert.ok(textoModal(amb).includes('sai da janela de datas desta nota'));
        assert.ok(SRC.includes('fmtValorExtrato(TOLERANCIA_VALOR_LANCAMENTO)'), 'tolerancia nao repetida como numero');
    });

    await teste('#163: lancamento fora do periodo da nota recebe aviso na confirmacao da escolha; dentro do periodo, nao', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ id: 'n1', data_pagamento: '2026-10-10' });
        amb.state.candidatosLancamento = [
            { id: 'l-fora', valor: 100, data_lancamento: '2026-03-01', memo: 'PIX', fitid: 'F1' },
            { id: 'l-dentro', valor: 100, data_lancamento: '2026-10-12', memo: 'PIX', fitid: 'F2' }
        ];
        amb.window.handleConfirmarLancamentoNota('n1', 'l-fora');
        assert.ok(textoModal(amb).includes('Atenção: este lançamento está fora do período desta nota.'));
        await cancelar(amb);
        amb.window.handleConfirmarLancamentoNota('n1', 'l-dentro');
        assert.ok(!textoModal(amb).includes('fora do período'));
        await cancelar(amb);
        // nota sem data nenhuma: nunca avisa
        amb.state.currentDocument = nota({ id: 'n1', data_pagamento: null, data_emissao: null });
        amb.window.handleConfirmarLancamentoNota('n1', 'l-fora');
        assert.ok(!textoModal(amb).includes('fora do período'));
        assert.strictEqual(amb.log.filter(o => o.acao === 'update').length + amb.rpcs.length, 0);
    });

    await teste('#163: a tela rotula a busca ampliada e marca o cartao fora do periodo', () => {
        assert.ok(SRC.includes('Lançamentos de todos os extratos do projeto com o valor desta nota ('));
        assert.ok(SRC.includes('Fora do período desta nota</p>'));
        assert.ok(SRC.includes('buscaAmpliada = !!state.ampliarCandidatos?.ativo && state.ampliarCandidatos.docId === doc.id'));
    });

    await teste('#163: Atualizar saldo do SALIC: cancelar nao captura; confirmar captura uma vez', async () => {
        const amb = criarAmbiente();
        amb.state.filters = { project: 'p1' };
        amb.window.handleAtualizarSaldoSalic();
        assert.ok(textoModal(amb).includes('1 a 2 minutos'));
        await cancelar(amb);
        assert.strictEqual(amb.chamadasFetch.filter(c => String(c.url).includes('saldo-salic')).length, 0);
        amb.window.handleAtualizarSaldoSalic();
        await confirmar(amb);
        assert.strictEqual(amb.chamadasFetch.filter(c => String(c.url).includes('saldo-salic/capturar')).length, 1);
        assert.strictEqual(amb.state.saldoSalicAtualizando, false);
    });

    await teste('#163: Trocar o extrato do lote: cancelar mantem o vinculo; confirmar desmarca no banco e na tela', async () => {
        const amb = criarAmbiente();
        amb.state.loteExtratoVinculado = { id: 'e1', nome: 'x.ofx', projectId: 'p1' };
        amb.window.handleRemoverExtratoLote();
        assert.ok(textoModal(amb).includes('O arquivo não é apagado'));
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        assert.ok(amb.state.loteExtratoVinculado);
        amb.window.handleRemoverExtratoLote();
        await confirmar(amb);
        const up = amb.log.filter(o => o.acao === 'update');
        deepEq(up.map(o => [o.tabela, o.dados, o.filtros]), [['extratos', { vinculo_lote_ativo: false }, [['id', 'e1']]]]);
        assert.strictEqual(amb.state.loteExtratoVinculado, null);
    });

    await teste('#163: Iniciar envio em lote: sem selecao nao abre modal; cancelar nao envia; confirmar monta a fila e processa', async () => {
        const vazio = criarAmbiente({ checks: [] });
        await vazio.window.handleIniciarEnvioLote();
        assert.strictEqual(vazio.state.confirmModal, null);

        const amb = criarAmbiente({ checks: [chk('n1', 'NF 1'), chk('n2', 'NF 2')] });
        await amb.window.handleIniciarEnvioLote();
        assert.ok(textoModal(amb).includes('2 nota(s)'));
        await cancelar(amb);
        assert.strictEqual(amb.rpcs.length, 0, 'nao consultou credencial');
        assert.ok(!amb.contexto.fila);
        assert.ok(!amb.state.salicLoteRunning);
        await amb.window.handleIniciarEnvioLote();
        await confirmar(amb);
        assert.ok(amb.rpcs.some(r => r.nome === 'has_external_credential'));
        assert.strictEqual(amb.contexto.fila, 1);
        assert.strictEqual(amb.state.salicLoteRunning, true);
        assert.strictEqual(amb.state.salicLoteQueue.length, 2);
    });

    await teste('#163: Salvar campos manuais: validacao vem antes do modal; cancelar nao grava; confirmar grava', async () => {
        const invalido = criarAmbiente({ campos: { 'input-cnpj-emissor': { value: '123' } } });
        await invalido.window.salvarCamposManuais('n1');
        assert.strictEqual(invalido.state.confirmModal, null);
        assert.ok(invalido.toasts.some(t => t.tipo === 'error'));

        const amb = criarAmbiente({ campos: { 'input-nome-emissor': { value: 'Grafica Aurora' } } });
        await amb.window.salvarCamposManuais('n1');
        assert.ok(textoModal(amb).includes('Confira com o documento fiscal original'));
        await cancelar(amb);
        assert.strictEqual(escritas(amb), 0);
        await amb.window.salvarCamposManuais('n1');
        await confirmar(amb);
        const up = amb.log.filter(o => o.acao === 'update' && o.tabela === 'documents');
        deepEq(up.map(o => o.dados), [{ nome_emissor: 'Grafica Aurora' }]);
    });

    // ---------------------------------------------------------------- #157
    // O formato do just_erro vem do n8n e nao esta no repositorio: os textos abaixo seguem o padrao que o
    // parser ja conhecia ("R$ valor em dd/mm/aaaa (descricao, documento N)"). EXEMPLO A CONFIRMAR com uma
    // mensagem real de recusa da auditoria.
    const TEXTO_ACEITE = 'Há 2 lançamentos que atendem as regras: R$ 3.490,69 em 04/08/2026 (TED Transf.Eletr.Disponiv ACME LTDA, documento 80.405); R$ 3.490,69 em 06/08/2026 (PIX Enviado ACME LTDA, documento 12.001)';
    const TEXTO_RECUSA = 'Há saída com o valor da nota, mas ela não pode ser confirmada: R$ 1.200,00 em 10/10/2026 (PIX Enviado OUTRO FORNECEDOR, documento 555) pertence a outro beneficiário.';

    await teste('#157: extrairLancamentosDoTexto: dois lancamentos, descricao e numero do documento separados', () => {
        const itens = criarAmbiente().ctx.extrairLancamentosDoTexto(TEXTO_ACEITE);
        assert.strictEqual(itens.length, 2);
        deepEq(itens[0], { valor: 3490.69, valorTxt: '3.490,69', data: '2026-08-04', dataTxt: '04/08/2026', descricao: 'TED Transf.Eletr.Disponiv ACME LTDA', numeroDocumento: '80.405' });
        assert.strictEqual(itens[1].numeroDocumento, '12.001');
    });

    await teste('#157: mensagem de aceite vira citados e nunca recusados; rejeicao vira recusados e nunca citados', () => {
        const f = criarAmbiente().ctx;
        const aceite = { just_erro: TEXTO_ACEITE }, recusa = { just_erro: TEXTO_RECUSA };
        assert.strictEqual(f.lancamentosCitadosAuditoria(aceite).length, 2);
        assert.strictEqual(f.lancamentosRecusadosAuditoria(aceite).length, 0);
        assert.strictEqual(f.lancamentosCitadosAuditoria(recusa).length, 0);
        const rec = f.lancamentosRecusadosAuditoria(recusa);
        assert.strictEqual(rec.length, 1);
        assert.strictEqual(rec[0].valor, 1200);
        assert.strictEqual(rec[0].numeroDocumento, '555');
    });

    await teste('#157: rejeicao sem lancamento no padrao, texto vazio e nulo: nada e inventado', () => {
        const f = criarAmbiente().ctx;
        deepEq(f.lancamentosRecusadosAuditoria({ just_erro: 'Há saída com o valor da nota, mas ela não pode ser confirmada: motivo qualquer sem valores.' }), []);
        deepEq(f.lancamentosRecusadosAuditoria({ just_erro: '' }), []);
        deepEq(f.lancamentosRecusadosAuditoria({ just_erro: null }), []);
        deepEq(f.lancamentosRecusadosAuditoria(null), []);
        deepEq(f.extrairLancamentosDoTexto(''), []);
        deepEq(f.extrairLancamentosDoTexto(undefined), []);
        deepEq(f.extrairLancamentosDoTexto('R$ 10,00 em 40/13/2026 (x, documento 1)'), [], 'data impossivel');
    });

    await teste('#157: "Conferi, este e o pagamento": confirmacao danger; cancelar nao abre o formulario; confirmar preenche sem gravar', async () => {
        const amb = criarAmbiente();
        amb.state.currentDocument = nota({ id: 'n1', status: 'erro_rpa', just_erro: TEXTO_RECUSA });
        amb.window.handleUsarLancamentoRecusado(0);
        const m = amb.state.confirmModal;
        assert.strictEqual(m.variant, 'danger');
        assert.ok(m.message.startsWith('A auditoria não confirmou este lançamento. Confira no extrato o valor, a data e o beneficiário.'));
        assert.ok(m.message.endsWith('você registra a justificativa.'));
        await cancelar(amb);
        assert.ok(!amb.state.pagamentoManualRascunho && !amb.state.pagamentoManualAberto);
        amb.window.handleUsarLancamentoRecusado(0);
        await confirmar(amb);
        const r = amb.state.pagamentoManualRascunho;
        assert.strictEqual(r.data, '2026-10-10');
        assert.strictEqual(r.valor, '1200,00');
        assert.strictEqual(r.nr, '555');
        assert.strictEqual(r.nrConf, '');
        assert.strictEqual(r.justificativa, 'Lançamento recusado pela auditoria e conferido pelo usuário: PIX Enviado OUTRO FORNECEDOR');
        assert.strictEqual(amb.state.pagamentoManualAberto, true);
        assert.strictEqual(escritas(amb), 0, 'a gravacao continua so em handleInformarPagamentoManual');
        // mensagem que nao e de rejeicao: nada acontece
        const outro = criarAmbiente();
        outro.state.currentDocument = nota({ id: 'n1', just_erro: TEXTO_ACEITE });
        outro.window.handleUsarLancamentoRecusado(0);
        assert.strictEqual(outro.state.confirmModal, null);
    });

    await teste('#157: a tela mostra o rotulo, o botao e mantem a frase do Parecer; so no ramo de rejeicao', () => {
        const i = SRC.indexOf('A auditoria não confirmou nenhum lançamento como pagamento desta nota. Confira o motivo no Parecer da Análise.');
        assert.ok(i > 0);
        const depois = SRC.slice(i, i + 1800);
        assert.ok(depois.includes('Lançamentos recusados pela auditoria') && depois.includes('Conferi, este é o pagamento') && depois.includes('handleUsarLancamentoRecusado('));
        assert.ok(depois.includes('recusados.length > 0'));
        assert.ok(!SRC.includes('lançamento citado em rejeição não vira item'));
    });

    // ---------------------------------------------------------------- #150
    const docTravado = (status) => ({ id: 'n1', status, file_path: 'p1/n1.pdf', cnpj_emissor: '123', rubrica_id_fk: 'rub-1', rubrica: 'Hospedagem', just_erro: 'Nao foi possivel validar', updated_at: '2020-01-01T00:00:00Z' });
    const validacoes = (amb) => amb.chamadasFetch.filter(c => String(c.url).includes('validacao.local'));

    await teste('#150: reprocessar nota travada em aguardando_conformidade refaz a VALIDACAO sem trocar o status e sem OCR', async () => {
        const amb = criarAmbiente();
        amb.state.documents = [docTravado('aguardando_conformidade')];
        await amb.window.handleReprocessarDocumentoTravado('n1');
        await confirmar(amb);
        const gravacoes = amb.log.filter(o => o.acao === 'update');
        assert.strictEqual(gravacoes.length, 1);
        // so limpa o erro: o status nao e enviado (o trigger de updated_at renova a data no banco)
        deepEq(gravacoes[0].dados, { just_erro: null });
        deepEq(amb.contexto.ocr, [], 'nao refaz o OCR');
        assert.strictEqual(validacoes(amb).length, 1);
        assert.strictEqual(validacoes(amb)[0].body.document_id, 'n1');
        assert.strictEqual(validacoes(amb)[0].body.rubrica_id, 'rub-1');
        // atualizacao otimista coerente com o que foi gravado
        assert.strictEqual(amb.state.documents[0].status, 'aguardando_conformidade');
        assert.strictEqual(amb.state.documents[0].just_erro, null);
        assert.ok(new Date(amb.state.documents[0].updated_at) > new Date('2025-01-01'), 'updated_at renovado');
    });

    await teste('#150: reprocessar nota travada em processing_ocr continua refazendo o OCR (ramo nao tocado)', async () => {
        const amb = criarAmbiente();
        amb.state.documents = [docTravado('processing_ocr')];
        await amb.window.handleReprocessarDocumentoTravado('n1');
        await confirmar(amb);
        const gravacoes = amb.log.filter(o => o.acao === 'update');
        // #164: o contador de tentativas volta a 0 junto, senao o cron devolve a nota a revisao manual
        deepEq(gravacoes.map(g => g.dados), [{ status: 'processing_ocr', ocr_retry_count: 0, just_erro: null }]);
        deepEq(amb.contexto.ocr, [{ id: 'n1', caminho: 'p1/n1.pdf' }]);
        assert.strictEqual(validacoes(amb).length, 0);
        assert.strictEqual(amb.state.documents[0].status, 'processing_ocr');
    });

    // ---------------------------------------------------------------- #164
    const docRevisao = (extra = {}) => ({ id: 'n1', status: 'revisao_manual', tipo_documento: 'nf', file_path: 'p1/n1.pdf', just_erro: null, json_extraido: { valor: 10 }, updated_at: '2026-01-01T00:00:00Z', ...extra });

    await teste('#164: botao "Ler o documento de novo" aparece nos tres casos de OCR que nao concluiu', () => {
        const f = amb => amb.ctx.podeLerDocumentoDeNovo;
        const amb = criarAmbiente();
        const pode = f(amb);
        assert.strictEqual(pode(docRevisao({ just_erro: 'ocr_max_retries_exceeded' })), true, 'max tentativas');
        assert.strictEqual(pode(docRevisao({ just_erro: '[AUTO] OCR excedeu 5 minutos em processamento sem concluir — movido para revisão manual em 04/11/2026 10:00' })), true, 'timeout automatico');
        assert.strictEqual(pode(docRevisao({ json_extraido: null })), true, 'json nulo');
        assert.strictEqual(pode(docRevisao({ json_extraido: {} })), true, 'json vazio');
        assert.strictEqual(pode(docRevisao({ json_extraido: '' })), true, 'json texto vazio');
        assert.strictEqual(pode(docRevisao({ json_extraido: undefined, tipo_documento: null })), true, 'sem tipo conta como nf');
        assert.strictEqual(pode(docRevisao({ tipo_documento: 'comprovante', just_erro: 'ocr_max_retries_exceeded' })), true, 'comprovante');
    });

    await teste('#164: o botao NAO aparece em revisao manual com OCR concluido, em outro status ou outro tipo', () => {
        const pode = criarAmbiente().ctx.podeLerDocumentoDeNovo;
        assert.strictEqual(pode(docRevisao()), false, 'OCR concluido');
        assert.strictEqual(pode(docRevisao({ just_erro: 'Divergencia no valor' })), false, 'erro que nao e de OCR');
        assert.strictEqual(pode(docRevisao({ status: 'processing_ocr', json_extraido: null })), false, 'outro status');
        assert.strictEqual(pode(docRevisao({ tipo_documento: 'planilha_orcamentaria', json_extraido: null })), false, 'outro tipo');
        assert.strictEqual(pode(null), false);
    });

    await teste('#164: o card so e desenhado quando podeLerDocumentoDeNovo e o perfil pode gravar', () => {
        const i = SRC.indexOf('Ler o documento de novo\n');
        assert.ok(i > 0, 'botao no DetailsView');
        const antes = SRC.slice(Math.max(0, i - 1400), i);
        assert.ok(antes.includes("podeLerDocumentoDeNovo(doc) && ['admin', 'gestor', 'analista'].includes(getUserRole())"));
    });

    await teste('#164: confirmar zera o contador, volta a processing_ocr e dispara o OCR; cancelar nao grava nada', async () => {
        const amb = criarAmbiente();
        amb.state.documents = [docRevisao({ just_erro: 'ocr_max_retries_exceeded' })];
        await amb.window.handleReprocessarDocumentoTravado('n1');
        assert.strictEqual(amb.state.confirmModal.title, 'Ler o documento de novo');
        assert.ok(amb.state.confirmModal.message.includes('O que foi preenchido à mão nesta nota pode ser substituído pela nova leitura.'));
        await cancelar(amb);
        assert.strictEqual(amb.log.filter(o => o.acao === 'update').length, 0);
        deepEq(amb.contexto.ocr, []);
        await amb.window.handleReprocessarDocumentoTravado('n1');
        await confirmar(amb);
        deepEq(amb.log.filter(o => o.acao === 'update').map(g => g.dados), [{ status: 'processing_ocr', ocr_retry_count: 0, just_erro: null }]);
        deepEq(amb.contexto.ocr, [{ id: 'n1', caminho: 'p1/n1.pdf' }]);
        assert.strictEqual(amb.state.documents[0].status, 'processing_ocr');
    });

    await teste('#164: erro de digitacao "crednciais" corrigido', () => {
        assert.ok(!SRC.includes('crednciais'));
        assert.ok(SRC.includes('suas credenciais ou com sua conta Gov.br'));
    });

    await teste('#150: vincular rubrica grava aguardando_conformidade e chama a validacao com a rubrica nova', async () => {
        const amb = criarAmbiente({ campos: { 'vincular-rubrica-input': { value: 'Hospedagem' } } });
        amb.state.currentDocument = nota({ status: 'bloqueado_conformidade' });
        await amb.window.handleVincularRubrica('n1', 'p1', 1500.5);
        await confirmar(amb);
        const doc = amb.log.filter(o => o.acao === 'update' && o.tabela === 'documents');
        deepEq(doc.map(o => o.dados), [{ rubrica: 'Hospedagem', rubrica_id_fk: 'rub-1', status: 'aguardando_conformidade', just_erro: null }]);
        assert.strictEqual(validacoes(amb).length, 1);
        assert.strictEqual(validacoes(amb)[0].body.rubrica_id, 'rub-1');
        deepEq(amb.contexto.ocr, []);
    });

    await teste('#150: Parecer da Analise mostra a mensagem da validacao em aguardando_conformidade (so com just_erro)', async () => {
        const ini = SRC.indexOf('<h3 class="h2 mb-4">Parecer da Análise</h3>');
        assert.ok(ini > 0);
        const marca = '<p class="text-sm" style="line-height: 1.6; color: var(--text-primary);">';
        const abre = SRC.indexOf(marca, ini);
        const fecha = SRC.indexOf('</p>', abre);
        const corpo = SRC.slice(abre + marca.length, fecha);
        const parecer = vm.runInNewContext('(doc, window) => `' + corpo + '`', {});
        const win = { prestaiSuavizar: (t) => 'suave: ' + t };
        const MSG = 'Nao foi possivel validar o CNAE automaticamente. Use Reprocessar para tentar novamente.';
        const com = parecer({ status: 'aguardando_conformidade', just_erro: MSG }, win);
        assert.ok(com.includes('Atenção:') && com.includes('suave: ' + MSG), com);
        // sem just_erro: igual a hoje
        const sem = parecer({ status: 'aguardando_conformidade', just_erro: null }, win);
        assert.ok(!sem.includes('Atenção:') && sem.includes('Aguardando processamento da IA'), sem);
        // os casos que ja existiam seguem iguais
        for (const status of ['bloqueado_conformidade', 'divergencia_valor', 'revisao_manual']) {
            assert.ok(parecer({ status, just_erro: MSG }, win).includes('Atenção:'), status);
        }
        assert.ok(!parecer({ status: 'processing_ocr', just_erro: MSG }, win).includes('Atenção:'));
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
