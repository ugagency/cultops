// Teste do ajuste 2 do #125: em "Corrigir Vinculo", escolher a mesma rubrica que a auditoria acabou de recusar
// (nota em bloqueado_conformidade) nao grava nem revalida; so orienta. Sem navegador e sem rede: as funcoes sao
// recortadas do app.js e rodam em um contexto com Supabase, n8n e tela falsos.
//  - criterio puro rubricaEscolhidaIgualAtual(doc, rubricaId);
//  - handleVincularRubrica: nada gravado nem enviado ao n8n com a mesma rubrica; outra rubrica segue o fluxo de sempre;
//    nota sem rubrica e outros status nao entram na regra.
// Uso: node teste-bloqueio-mesma-rubrica.js
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
const FIM_W = '\n};\n', FIM_F = '\n}\n';
const CODIGO = [
    bloco('const STATUS_MAP = {', FIM_W),
    bloco('function rotuloStatusLegivel(', FIM_F),
    bloco('function bloqueioPorRubricaNaoInformada(', FIM_F),
    bloco('window.showConfirmModal = function', FIM_W),
    bloco('window.closeConfirmModal = function', FIM_W),
    bloco('window.__execConfirmModal = function', FIM_W),
    bloco('function rubricaEscolhidaIgualAtual(', FIM_F),
    "const MSG_MESMA_RUBRICA_BLOQUEIO = " + bloco("const MSG_MESMA_RUBRICA_BLOQUEIO = ", ';\n').slice("const MSG_MESMA_RUBRICA_BLOQUEIO = ".length),
    bloco('window.handleVincularRubrica = async function', FIM_W),
    bloco('async function executarVinculoRubricaImpl(', FIM_F)
].join('\n');

const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const RUB_A = 'rub-a', RUB_B = 'rub-b';
const RUBRICAS = [{ id: RUB_A, nome: 'Hospedagem' }, { id: RUB_B, nome: 'Transporte' }];
const doc = (extra = {}) => ({ id: 'n1', project_id: 'p1', cnpj_emissor: '1', status: 'bloqueado_conformidade', rubrica_id_fk: RUB_A, just_erro: 'A rubrica nao e compativel com o CNAE do emissor.', ...extra });

function criarAmbiente({ nota, escolhida = 'Hospedagem', bancoRubricaIdFk } = {}) {
    const log = { escritas: [], selects: [], n8n: [], toasts: [] };
    const state = { loading: false, confirmModal: null, currentDocument: nota, documents: [], rubricas_disponiveis: RUBRICAS, user: { app_metadata: { role: 'gestor' } } };
    const ctx = {
        state, console: { log() { }, error() { }, warn() { } },
        window: {}, CONFIG: { N8N_WEBHOOK_VALIDATION_URL: 'http://n8n.local/validacao' },
        document: { getElementById: (id) => (id === 'vincular-rubrica-input' ? { value: escolhida } : null) },
        render() { }, showToast: (m, t) => log.toasts.push({ m, t }),
        userIsGestorOrAbove: () => true,
        isSaldoRubricasHabilitado: async () => false,
        resolverRubricaPorRotulo: (txt, lista) => lista.find(r => r.nome === txt) || null,
        fmtBRLM1: (v) => 'R$ ' + Number(v).toFixed(2),
        fetchDocumentDetails: async () => { },
        fetch: async (url) => { log.n8n.push(url); return { status: 200 }; },
        supabaseClient: {
            from: (tabela) => {
                const op = { tabela, acao: 'select' };
                const api = {
                    select(c) { log.selects.push([tabela, c]); return api; },
                    upsert(d) { op.acao = 'upsert'; log.escritas.push({ tabela, acao: 'upsert', d }); return api; },
                    update(d) { op.acao = 'update'; log.escritas.push({ tabela, acao: 'update', d }); return api; },
                    eq() { return api; },
                    maybeSingle() { return Promise.resolve({ data: { rubrica_id_fk: bancoRubricaIdFk }, error: null }); },
                    then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); }
                };
                return api;
            }
        }
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + ';this.igual = rubricaEscolhidaIgualAtual;', ctx);
    ctx.window.showToast = ctx.showToast;
    return { ctx, state, log };
}

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

(async () => {
    const { ctx: c } = criarAmbiente({ nota: doc() });

    await teste('criterio: bloqueado_conformidade com a mesma rubrica -> verdadeiro; rubrica diferente -> falso', () => {
        assert.strictEqual(c.igual(doc(), RUB_A), true);
        assert.strictEqual(c.igual(doc(), RUB_B), false);
        assert.strictEqual(c.igual(doc(), null), false);
        assert.strictEqual(c.igual(null, RUB_A), false);
    });

    await teste('criterio: nota sem rubrica -> falso (inclusive a bloqueada por "Rubrica nao informada")', () => {
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: null }), RUB_A), false);
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: undefined }), RUB_A), false);
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: RUB_A, just_erro: 'Rubrica não informada — selecione manualmente.' }), RUB_A), false);
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: null, just_erro: 'Rubrica não informada — selecione manualmente.' }), RUB_A), false);
    });

    await teste('criterio: status diferente de bloqueado_conformidade -> falso (erro_rpa e os demais)', () => {
        for (const status of ['erro_rpa', 'processing_ocr', 'revisao_manual', 'aguardando_conformidade', 'divergencia_valor', 'aguardando_comprovante', 'liberado_rpa_airtop']) {
            assert.strictEqual(c.igual(doc({ status }), RUB_A), false, status);
        }
    });

    await teste('criterio: sem rubrica_id_fk vale a rubrica da linha de despesas (objeto ou lista)', () => {
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: null, despesas: { rubrica_id: RUB_A } }), RUB_A), true);
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: null, despesas: [{ rubrica_id: RUB_A }] }), RUB_A), true);
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: null, despesas: [{ rubrica_id: RUB_B }] }), RUB_A), false);
        assert.strictEqual(c.igual(doc({ rubrica_id_fk: null, despesas: [] }), RUB_A), false);
    });

    await teste('Corrigir Vinculo com a MESMA rubrica: orienta, nao grava e nao chama o n8n', async () => {
        const { ctx, state, log } = criarAmbiente({ nota: doc() });
        await ctx.window.handleVincularRubrica('n1', 'p1', 100);
        const m = state.confirmModal;
        assert.ok(m, 'mostra a orientacao');
        assert.strictEqual(m.title, 'Escolha outra rubrica');
        assert.strictEqual(m.message, 'Esta já é a rubrica da nota e a auditoria já a analisou. Escolha outra rubrica. Se a rubrica estiver correta, um administrador pode avançar a nota manualmente, informando o motivo.');
        assert.ok(m.variant === 'primary' && !/erro/i.test(m.title), 'tom de orientacao, nao de erro');
        assert.deepStrictEqual(log.escritas, [], 'nada gravado em despesas nem em documents');
        assert.deepStrictEqual(log.n8n, [], 'nada enviado ao n8n');
        assert.strictEqual(state.loading, false);
        // confirmar ("Entendi") tambem nao grava nada
        ctx.window.__execConfirmModal();
        await tick();
        assert.deepStrictEqual(log.escritas, []);
        assert.deepStrictEqual(log.n8n, []);
        assert.strictEqual(state.currentDocument.status, 'bloqueado_conformidade');
    });

    await teste('Corrigir Vinculo com OUTRA rubrica: segue o fluxo de sempre (confirmacao, upsert em despesas, documents, n8n)', async () => {
        const { ctx, state, log } = criarAmbiente({ nota: doc(), escolhida: 'Transporte' });
        await ctx.window.handleVincularRubrica('n1', 'p1', 100);
        assert.strictEqual(state.confirmModal.title, 'Vincular rubrica');
        assert.deepStrictEqual(log.escritas, [], 'nada antes de confirmar');
        ctx.window.__execConfirmModal();
        await tick();
        const despesa = log.escritas.find(e => e.tabela === 'despesas');
        assert.strictEqual(despesa.acao, 'upsert');
        assert.strictEqual(despesa.d.rubrica_id, RUB_B);
        const documento = log.escritas.find(e => e.tabela === 'documents');
        assert.deepStrictEqual({ r: documento.d.rubrica, id: documento.d.rubrica_id_fk, s: documento.d.status }, { r: 'Transporte', id: RUB_B, s: 'processing_ocr' });
        assert.strictEqual(log.n8n.length, 1);
    });

    await teste('Corrigir Vinculo: nota sem rubrica (bloqueio por "Rubrica nao informada") e outros status seguem o fluxo normal', async () => {
        for (const nota of [
            doc({ rubrica_id_fk: null, just_erro: 'Rubrica não informada — selecione manualmente.' }),
            doc({ status: 'erro_rpa' }),
            doc({ status: 'revisao_manual' })
        ]) {
            const { ctx, state, log } = criarAmbiente({ nota });
            await ctx.window.handleVincularRubrica('n1', 'p1', 100);
            assert.strictEqual(state.confirmModal.title, 'Vincular rubrica', nota.status + '/' + nota.rubrica_id_fk);
            ctx.window.__execConfirmModal();
            await tick();
            assert.ok(log.escritas.some(e => e.tabela === 'despesas'), 'grava como antes');
        }
    });

    await teste('Corrigir Vinculo: se o documento do state nao trouxe a rubrica, busca so esse campo no banco', async () => {
        const nota = doc();
        delete nota.rubrica_id_fk;
        const { ctx, state, log } = criarAmbiente({ nota, bancoRubricaIdFk: RUB_A });
        await ctx.window.handleVincularRubrica('n1', 'p1', 100);
        assert.deepStrictEqual(log.selects, [['documents', 'rubrica_id_fk']]);
        assert.strictEqual(state.confirmModal.title, 'Escolha outra rubrica');
        assert.deepStrictEqual(log.escritas, []);
        // o banco diz que a rubrica atual e outra: segue o fluxo
        const outro = criarAmbiente({ nota: (() => { const n = doc(); delete n.rubrica_id_fk; return n; })(), bancoRubricaIdFk: RUB_B });
        await outro.ctx.window.handleVincularRubrica('n1', 'p1', 100);
        assert.strictEqual(outro.state.confirmModal.title, 'Vincular rubrica');
    });

    await teste('o botao Corrigir Vinculo continua disponivel e a permissao de gestor segue valendo (codigo-fonte)', () => {
        assert.ok(/userIsGestorOrAbove\(\)\) \{\n\s+showToast\('Sem permissão para vincular rubrica\.', 'error'\)/.test(bloco('window.handleVincularRubrica = async function', FIM_W)));
        assert.ok(SRC.includes('window.handleVincularRubrica('), 'o botao ainda chama o handler');
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
