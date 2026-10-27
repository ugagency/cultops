// Teste do #132: saldo da rubrica em duas partes (SALIC oficial e em transito no PrestAi), sem travas.
// Sem navegador e sem rede: as funcoes sao recortadas do app.js e rodam em um contexto com Supabase,
// n8n e tela falsos.
//  - rubricaExigeJustificativaSalic: aguardando_d3 igual a liberado_rpa_airtop; demais status comparam o valor que
//    o robo vai lancar (valor_pago, senao valor) com disponivel_projetado;
//  - exibicao: disponivel no SALIC com "Atualizado em", liberadas e em conferencia em linhas separadas, projecao em
//    texto secundario e o aviso de transito acima do disponivel;
//  - sem travas: o modal de vinculo e a confirmacao do lote viram aviso (sem variant danger), o fluxo segue;
//  - captura pos-lote: uma chamada por projeto, em sequencia, nunca com projectId vazio.
// Uso: node teste-saldo-transito.js
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
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

const CODIGO_SALDO = [
    bloco('function classificarStatusSaldoM1(', FIM_F),
    bloco('function fmtBRLM1(', FIM_F),
    bloco("const MSG_TRANSITO_ACIMA_OFICIAL = ", ';\n'),
    bloco('function dataHoraCurtaSaldo(', FIM_F),
    bloco('function saldoTransitoAcimaDoOficial(', FIM_F),
    bloco('function renderSaldoDetalhesHtml(', FIM_F),
    bloco('function renderSaldoBadgeHtml(', FIM_F),
    bloco('function _estiloSaldoDestaque(', FIM_F),
    bloco('function renderSaldoBadgeDestaque(', FIM_F),
    bloco('function rubricaExigeJustificativaSalic(', FIM_F)
].join('\n');

function ambienteSaldo(saldoPorRubrica) {
    const ctx = { state: { saldoRubricasHabilitado: true, saldoRubricas: saldoPorRubrica } };
    vm.createContext(ctx);
    vm.runInContext(CODIGO_SALDO + ';this.exige = rubricaExigeJustificativaSalic; this.badge = renderSaldoBadgeHtml; this.destaque = renderSaldoBadgeDestaque; this.transitoAcima = saldoTransitoAcimaDoOficial;', ctx);
    return ctx;
}
const saldo = (extra = {}) => ({
    rubrica_id: 'r1', valor_aprovado: 10000, executado_salic: 2000, disponivel_oficial: 8000, disponivel_projetado: 6000,
    em_transito: 1500, em_transito_qtd: 2, em_conferencia: 500, em_conferencia_qtd: 3, ultima_captura_em: '2026-10-20T14:35:00', ...extra
});

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

(async () => {
    // ---------------- Justificativa SALIC ----------------
    await teste('justificativa: aguardando_d3 igual a liberado_rpa_airtop (so olha a projecao, sem somar o valor da nota de novo)', () => {
        const positivo = ambienteSaldo({ r1: saldo({ disponivel_projetado: 50 }) });
        // a nota de 5000 ja esta dentro de em_transito: com projecao positiva nao exige, mesmo valor > projecao
        assert.strictEqual(positivo.exige({ status: 'aguardando_d3', rubrica_id_fk: 'r1', valor: 5000 }), false);
        assert.strictEqual(positivo.exige({ status: 'liberado_rpa_airtop', rubrica_id_fk: 'r1', valor: 5000 }), false);
        const negativo = ambienteSaldo({ r1: saldo({ disponivel_projetado: -100 }) });
        assert.strictEqual(negativo.exige({ status: 'aguardando_d3', rubrica_id_fk: 'r1', valor: 1 }), true);
        assert.strictEqual(negativo.exige({ status: 'liberado_rpa_airtop', rubrica_id_fk: 'r1', valor: 1 }), true);
    });

    await teste('justificativa: liberado com projecao negativa exige; zero e ruido de centavo nao exigem', () => {
        const c = ambienteSaldo({ r1: saldo({ disponivel_projetado: -0.5 }) });
        assert.strictEqual(c.exige({ status: 'liberado_rpa_airtop', rubrica_id_fk: 'r1', valor: 10 }), true);
        const limite = ambienteSaldo({ r1: saldo({ disponivel_projetado: -0.005 }) });
        assert.strictEqual(limite.exige({ status: 'liberado_rpa_airtop', rubrica_id_fk: 'r1', valor: 10 }), false);
        const zero = ambienteSaldo({ r1: saldo({ disponivel_projetado: 0 }) });
        assert.strictEqual(zero.exige({ status: 'aguardando_d3', rubrica_id_fk: 'r1', valor: 10 }), false);
    });

    await teste('justificativa: erro_rpa compara valor_pago (se preenchido) com a projecao', () => {
        const c = ambienteSaldo({ r1: saldo({ disponivel_projetado: 1000 }) });
        // valor_pago menor que o disponivel nao exige, mesmo com o valor da nota maior
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 5000, valor_pago: 800 }), false);
        // valor_pago maior exige, mesmo com o valor da nota menor
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 500, valor_pago: 1200 }), true);
        // sem valor_pago (nulo ou vazio) vale o valor da nota
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 1200, valor_pago: null }), true);
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 900, valor_pago: '' }), false);
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 1200 }), true);
        // igual a projecao (dentro da tolerancia) nao exige
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 1000, valor_pago: 1000.005 }), false);
    });

    await teste('justificativa: sem dado suficiente nao exige (flag desligada, sem rubrica, sem projecao, sem valor)', () => {
        const c = ambienteSaldo({ r1: saldo() });
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: null, valor: 99999 }), false);
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'outra', valor: 99999 }), false);
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1' }), false);
        const semProjecao = ambienteSaldo({ r1: saldo({ disponivel_projetado: null }) });
        assert.strictEqual(semProjecao.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 99999 }), false);
        c.state.saldoRubricasHabilitado = false;
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 99999 }), false);
    });

    await teste('justificativa: rubrica excedida (SALIC acima do aprovado) continua exigindo em qualquer status', () => {
        const c = ambienteSaldo({ r1: saldo({ executado_salic: 11000, disponivel_projetado: 500 }) });
        assert.strictEqual(c.exige({ status: 'aguardando_d3', rubrica_id_fk: 'r1', valor: 1 }), true);
        assert.strictEqual(c.exige({ status: 'erro_rpa', rubrica_id_fk: 'r1', valor: 1 }), true);
    });

    // ---------------- Exibicao ----------------
    await teste('exibicao: badge mostra SALIC com data, liberadas e em conferencia em linhas separadas, projecao secundaria', () => {
        const c = ambienteSaldo({ r1: saldo() });
        const html = c.badge('r1');
        assert.ok(/Disponível no SALIC: <strong[^>]*>[^<]*8\.000,00/.test(html), html);
        assert.ok(html.includes('Atualizado em 20/10 14:35'), 'data da captura');
        assert.ok(/Liberadas aguardando envio: [^<]*1\.500,00 \(2\)/.test(html), html);
        assert.ok(/Em conferência: [^<]*500,00 \(3\)/.test(html), html);
        assert.ok(/Projeção PrestAí: [^<]*6\.000,00/.test(html), html);
        // linhas separadas: cada uma no seu proprio bloco
        const linhasLib = html.split('Liberadas aguardando envio').length - 1;
        assert.strictEqual(linhasLib, 1);
        assert.ok(html.indexOf('Liberadas aguardando envio') < html.indexOf('Em conferência') && html.indexOf('Em conferência') < html.indexOf('Projeção PrestAí'));
        assert.ok(!html.includes('Disponível projetado'), 'rotulo antigo sumiu');
    });

    await teste('exibicao: destaque usa as mesmas linhas e os rotulos Atencao/Excedida continuam so visuais', () => {
        const c = ambienteSaldo({ r1: saldo({ disponivel_projetado: 100, valor_aprovado: 10000 }) });
        const html = c.destaque('r1');
        assert.ok(html.includes('Saldo da rubrica: Atenção'), html);
        assert.ok(html.includes('Disponível no SALIC') && html.includes('Liberadas aguardando envio') && html.includes('Em conferência') && html.includes('Projeção PrestAí'));
        const excedida = ambienteSaldo({ r1: saldo({ executado_salic: 11000 }) });
        assert.ok(excedida.destaque('r1').includes('Saldo da rubrica: Excedida'));
    });

    await teste('exibicao: aviso so quando liberadas + em conferencia somam mais que o disponivel no SALIC', () => {
        const AVISO = 'As notas em trânsito somam mais que o disponível no SALIC.';
        // 1500 + 500 = 2000 < 8000: sem aviso
        assert.ok(!ambienteSaldo({ r1: saldo() }).badge('r1').includes(AVISO));
        // 1500 + 500 = 2000 > 1900: aviso
        const c = ambienteSaldo({ r1: saldo({ disponivel_oficial: 1900 }) });
        assert.ok(c.badge('r1').includes(AVISO));
        assert.ok(c.destaque('r1').includes(AVISO));
        // so em conferencia tambem entra na soma
        assert.strictEqual(c.transitoAcima(saldo({ em_transito: 0, em_conferencia: 2500, disponivel_oficial: 2000 })), true);
        // igual nao avisa; sem nada em transito nao avisa nem com oficial negativo; sem captura nao avisa
        assert.strictEqual(c.transitoAcima(saldo({ disponivel_oficial: 2000 })), false);
        assert.strictEqual(c.transitoAcima(saldo({ em_transito: 0, em_conferencia: 0, disponivel_oficial: -50 })), false);
        assert.strictEqual(c.transitoAcima(saldo({ disponivel_oficial: null })), false);
    });

    await teste('exibicao: rubrica sem registro ou sem captura mostra indisponivel, sem quebrar', () => {
        const c = ambienteSaldo({});
        const html = c.badge('r1');
        assert.ok(html.includes('Sem captura SALIC') && html.includes('Disponível no SALIC'), html);
        assert.ok(!html.includes('Liberadas aguardando envio'));
        const semCaptura = ambienteSaldo({ r1: saldo({ disponivel_oficial: null, disponivel_projetado: null, ultima_captura_em: null, em_transito: 0, em_conferencia: 0, em_transito_qtd: 0, em_conferencia_qtd: 0 }) });
        const h2 = semCaptura.badge('r1');
        assert.ok(h2.includes('Sem captura SALIC') && !h2.includes('Atualizado em') && h2.includes('(0)'), h2);
        // flag desligada: nada
        c.state.saldoRubricasHabilitado = false;
        assert.strictEqual(c.badge('r1'), '');
    });

    // ---------------- Sem travas: modal de vinculo ----------------
    const CODIGO_VINCULO = [
        bloco('const STATUS_MAP = {', FIM_W),
        bloco('function rotuloStatusLegivel(', FIM_F),
        bloco('function bloqueioPorRubricaNaoInformada(', FIM_F),
        bloco('window.showConfirmModal = function', FIM_W),
        bloco('window.closeConfirmModal = function', FIM_W),
        bloco('window.__execConfirmModal = function', FIM_W),
        bloco('function rubricaEscolhidaIgualAtual(', FIM_F),
        'const MSG_MESMA_RUBRICA_BLOQUEIO = ' + bloco('const MSG_MESMA_RUBRICA_BLOQUEIO = ', ';\n').slice('const MSG_MESMA_RUBRICA_BLOQUEIO = '.length),
        bloco('window.handleVincularRubrica = async function', FIM_W),
        bloco('async function executarVinculoRubricaImpl(', FIM_F)
    ].join('\n');

    function ambienteVinculo({ saldoInfo, valor = 3000 }) {
        const log = { escritas: [], n8n: [], toasts: [] };
        const nota = { id: 'n1', project_id: 'p1', cnpj_emissor: '1', status: 'erro_rpa', rubrica_id_fk: null, just_erro: null, valor };
        const state = { loading: false, confirmModal: null, currentDocument: nota, documents: [], rubricas_disponiveis: [{ id: 'rub-a', nome: 'Hospedagem' }], user: { app_metadata: { role: 'gestor' } } };
        const ctx = {
            state, console: { log() { }, error() { }, warn() { } },
            window: {}, CONFIG: { N8N_WEBHOOK_VALIDATION_URL: 'http://n8n.local/validacao' },
            document: { getElementById: (id) => (id === 'vincular-rubrica-input' ? { value: 'Hospedagem' } : null) },
            render() { }, showToast: (m, t) => log.toasts.push({ m, t }),
            userIsGestorOrAbove: () => true,
            isSaldoRubricasHabilitado: async () => true,
            resolverRubricaPorRotulo: (txt, lista) => lista.find(r => r.nome === txt) || null,
            fmtBRLM1: (v) => 'R$ ' + Number(v).toFixed(2),
            fetchDocumentDetails: async () => { },
            fetch: async (url) => { log.n8n.push(url); return { status: 200 }; },
            supabaseClient: {
                from: (tabela) => {
                    const api = {
                        select() { return api; },
                        upsert(d) { log.escritas.push({ tabela, acao: 'upsert', d }); return api; },
                        update(d) { log.escritas.push({ tabela, acao: 'update', d }); return api; },
                        eq() { return api; },
                        maybeSingle() { return Promise.resolve({ data: tabela === 'v_saldo_rubricas' ? saldoInfo : null, error: null }); },
                        then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); }
                    };
                    return api;
                }
            }
        };
        vm.createContext(ctx);
        vm.runInContext(CODIGO_VINCULO, ctx);
        ctx.window.showToast = ctx.showToast;
        return { ctx, state, log };
    }

    await teste('vinculo: saldo estourado vira aviso (sem variant danger, botao "Vincular rubrica", um unico modal) e o vinculo segue', async () => {
        const { ctx, state, log } = ambienteVinculo({
            saldoInfo: { disponivel_oficial: 9000, disponivel_projetado: 1000, em_transito: 2500, em_conferencia: 700 }, valor: 3000
        });
        await ctx.window.handleVincularRubrica('n1', 'p1', 3000);
        const m = state.confirmModal;
        assert.ok(m, 'mostra o aviso');
        assert.strictEqual(m.title, 'Saldo insuficiente na rubrica');
        assert.notStrictEqual(m.variant, 'danger');
        assert.strictEqual(m.confirmLabel, 'Vincular rubrica');
        assert.ok(m.message.includes('Disponível no SALIC: R$ 9.000'), m.message);
        assert.ok(m.message.includes('projeção PrestAí (R$ 1.000)'), m.message);
        assert.ok(m.message.includes('liberadas aguardando envio R$ 2.500') && m.message.includes('em conferência R$ 700'), m.message);
        assert.ok(m.message.includes('Justificativa SALIC'));
        assert.deepStrictEqual(log.escritas, [], 'nada antes de confirmar');
        ctx.window.__execConfirmModal();
        await tick();
        assert.ok(log.escritas.some(e => e.tabela === 'despesas' && e.acao === 'upsert'), 'vincula');
        assert.ok(log.escritas.some(e => e.tabela === 'documents' && e.d.rubrica_id_fk === 'rub-a'));
        assert.strictEqual(log.n8n.length, 1);
    });

    await teste('vinculo: saldo suficiente mostra so a confirmacao normal', async () => {
        const { ctx, state } = ambienteVinculo({ saldoInfo: { disponivel_oficial: 9000, disponivel_projetado: 8000 }, valor: 3000 });
        await ctx.window.handleVincularRubrica('n1', 'p1', 3000);
        assert.strictEqual(state.confirmModal.title, 'Vincular rubrica');
    });

    // ---------------- Sem travas: lote ----------------
    const CODIGO_LOTE = [
        bloco('window.showConfirmModal = function', FIM_W),
        bloco('window.closeConfirmModal = function', FIM_W),
        bloco('window.__execConfirmModal = function', FIM_W),
        bloco('function extratoOrigemPara(', FIM_F),
        bloco('window.handleProcessarTodosLote = async function', FIM_W)
    ].join('\n');

    async function lote(saldos) {
        const updates = [];
        const state = {
            user: { id: 'u' }, loading: false, confirmModal: null, filters: { project: 'p1' }, projects: [], loteExtratoVinculado: null,
            rubricas_disponiveis: [{ id: 'rub-1', nome: 'Hospedagem' }], uploadLoteProgresso: { ativo: false, total: 0, feitos: 0, falhas: 0 },
            uploadLoteQueue: [{ id: 'a', name: 'a.pdf', file_path: 'p1/a.pdf', project_id: 'p1', valor: 3000 }]
        };
        const ctx = {
            state, console: { log() { }, error() { }, warn() { } }, window: {},
            document: { getElementById: () => ({ value: 'Hospedagem' }) },
            render() { }, showToast() { }, resolverRubricaPorRotulo: (t, l) => l.find(r => r.nome === t) || null,
            isSaldoRubricasHabilitado: async () => true, dispararOcr: async () => { }, fetchUploadLoteQueue: async () => { },
            supabaseClient: {
                from: (tabela) => {
                    const api = {
                        select() { return api; }, in() { return Promise.resolve({ data: saldos, error: null }); },
                        update(d) { updates.push({ tabela, d }); return api; }, eq() { return Promise.resolve({ error: null }); }
                    };
                    return api;
                }
            }
        };
        ctx.window.showToast = ctx.showToast;
        vm.createContext(ctx);
        vm.runInContext(CODIGO_LOTE, ctx);
        await ctx.window.handleProcessarTodosLote();
        return { ctx, state, updates };
    }

    await teste('lote: rubrica que estoura vira aviso (sem variant danger, botao "Processar") e o lote segue ao confirmar', async () => {
        const { ctx, state, updates } = await lote([{ rubrica_id: 'rub-1', nome: 'Hospedagem', disponivel_oficial: 9000, disponivel_projetado: 1000 }]);
        const m = state.confirmModal;
        assert.ok(m, 'mostra a confirmacao');
        assert.notStrictEqual(m.variant, 'danger');
        assert.strictEqual(m.confirmLabel, 'Processar');
        assert.ok(m.message.includes('disponível no SALIC R$ 9.000') && m.message.includes('projeção PrestAí R$ 1.000'), m.message);
        assert.ok(m.message.includes('Justificativa SALIC'));
        ctx.window.__execConfirmModal();
        await tick();
        assert.strictEqual(updates.length, 1, 'o documento foi processado');
        assert.strictEqual(updates[0].d.status, 'processing_ocr');
    });

    await teste('lote: sem estouro nao ha aviso de saldo', async () => {
        const { state } = await lote([{ rubrica_id: 'rub-1', nome: 'Hospedagem', disponivel_oficial: 9000, disponivel_projetado: 8000 }]);
        assert.strictEqual(state.confirmModal.confirmLabel, 'Processar');
        assert.ok(!state.confirmModal.message.includes('projeção'), state.confirmModal.message);
    });

    // ---------------- Captura pos-lote ----------------
    const CODIGO_CAPTURA = [
        bloco('async function projetosDosItensEnviados(', FIM_F),
        bloco('async function capturarSaldoPosLote(', FIM_F)
    ].join('\n');

    function ambienteCaptura({ documentos = [], banco = [], falhaNoProjeto = null } = {}) {
        const chamadas = [];
        let emAndamento = 0, maximo = 0;
        const ctx = {
            state: { documents: documentos, filters: { project: '' } }, console: { log() { }, error() { }, warn() { } },
            supabaseClient: {
                auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
                from: () => ({ select: () => ({ in: async (_c, ids) => ({ data: banco.filter(b => ids.includes(b.id)), error: null }) }) })
            },
            fetch: async (url, init) => {
                const body = JSON.parse(init.body);
                chamadas.push({ url, projectId: body.projectId, auth: init.headers.Authorization });
                emAndamento++; maximo = Math.max(maximo, emAndamento);
                await new Promise(r => setTimeout(r, 5));
                emAndamento--;
                if (body.projectId === falhaNoProjeto) throw new Error('worker fora do ar');
                return { ok: true };
            }
        };
        vm.createContext(ctx);
        vm.runInContext(CODIGO_CAPTURA + ';this.capturar = capturarSaldoPosLote;', ctx);
        return { ctx, chamadas, maximo: () => maximo };
    }

    await teste('captura pos-lote: itens de dois projetos geram duas chamadas, uma por project_id, em sequencia', async () => {
        const { ctx, chamadas, maximo } = ambienteCaptura();
        await ctx.capturar([
            { id: 'a', projectId: 'p1' }, { id: 'b', projectId: 'p2' }, { id: 'c', projectId: 'p1' }
        ]);
        assert.deepStrictEqual(chamadas.map(c => c.projectId), ['p1', 'p2']);
        assert.ok(chamadas.every(c => c.url === '/api/saldo-salic/capturar' && c.auth === 'Bearer tok'));
        assert.strictEqual(maximo(), 1, 'nunca duas capturas ao mesmo tempo');
    });

    await teste('captura pos-lote: filtro vazio nao gera chamada com projectId vazio (o projeto vem dos itens)', async () => {
        const { ctx, chamadas } = ambienteCaptura();
        assert.strictEqual(ctx.state.filters.project, '');
        await ctx.capturar([{ id: 'a', projectId: 'p1' }]);
        assert.deepStrictEqual(chamadas.map(c => c.projectId), ['p1']);
        assert.ok(chamadas.every(c => c.projectId));
    });

    await teste('captura pos-lote: sem projeto conhecido em nenhum item nao chama o servidor', async () => {
        const { ctx, chamadas } = ambienteCaptura();
        await ctx.capturar([{ id: 'x', projectId: null }, { id: 'y', projectId: '' }]);
        assert.deepStrictEqual(chamadas, []);
        await ctx.capturar([]);
        assert.deepStrictEqual(chamadas, []);
    });

    await teste('captura pos-lote: fila antiga (sem projectId) usa o documento da lista e, se faltar, o banco', async () => {
        const { ctx, chamadas } = ambienteCaptura({
            documentos: [{ id: 'a', project_id: 'p1' }],
            banco: [{ id: 'b', project_id: 'p2' }, { id: 'c', project_id: 'p2' }]
        });
        await ctx.capturar([{ id: 'a', project: 'rotulo' }, { id: 'b', project: 'rotulo' }, { id: 'c', project: 'rotulo' }]);
        assert.deepStrictEqual(chamadas.map(c => c.projectId).sort(), ['p1', 'p2']);
    });

    await teste('captura pos-lote: falha em um projeto nao impede a captura do seguinte', async () => {
        const { ctx, chamadas } = ambienteCaptura({ falhaNoProjeto: 'p1' });
        await ctx.capturar([{ id: 'a', projectId: 'p1' }, { id: 'b', projectId: 'p2' }]);
        assert.deepStrictEqual(chamadas.map(c => c.projectId), ['p1', 'p2']);
    });

    // processarFilaSalic de verdade: dois projetos, filtro em "Todos os projetos"
    await teste('processarFilaSalic: ao fim do lote dispara uma captura por projeto enviado com sucesso (filtro vazio)', async () => {
        const capturas = [];
        const state = {
            salicLoteRunning: true, salicLoteCancelled: false, filters: { project: '' }, documents: [],
            salicLoteProgress: { current: 0, total: 4 },
            salicLoteQueue: [
                { id: 'a', name: 'a', project: 'x', projectId: 'p1', status: 'pending', error: null },
                { id: 'b', name: 'b', project: 'y', projectId: 'p2', status: 'pending', error: null },
                { id: 'c', name: 'c', project: 'x', projectId: 'p1', status: 'pending', error: null },
                { id: 'd', name: 'd', project: 'z', projectId: 'p3', status: 'pending', error: null }
            ]
        };
        const ctx = {
            state, console: { log() { }, error() { }, warn() { } },
            window: { location: { origin: 'http://app' }, ErrosRpa: { avisoEnvio: () => null } },
            CONFIG: { SALIC_API_URL: '/api/salic/inserir' },
            setTimeout: (fn) => { fn(); return 0; },
            separarNotasSemPagamento: async (itens) => ({ liberados: itens, bloqueados: [] }),
            MSG_INFORME_PAGAMENTO: 'x', salvarFilaSalic() { }, render() { }, showToast() { },
            supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
            fetch: async (url, init) => {
                const body = JSON.parse(init.body);
                if (url.endsWith('/api/saldo-salic/capturar')) { capturas.push(body.projectId); return { ok: true, json: async () => ({}) }; }
                // o envio do item d falha: o projeto p3 nao deve ser capturado
                if (body.documentId === 'd') return { ok: false, status: 500, json: async () => ({ error: 'falhou' }) };
                return { ok: true, json: async () => ({ success: true }) };
            }
        };
        vm.createContext(ctx);
        vm.runInContext([
            bloco('async function processarFilaSalic(', FIM_F),
            bloco('async function projetosDosItensEnviados(', FIM_F),
            bloco('async function capturarSaldoPosLote(', FIM_F)
        ].join('\n') + ';this.processar = processarFilaSalic;', ctx);
        await ctx.processar();
        await tick();
        assert.deepStrictEqual(capturas, ['p1', 'p2'], 'uma por projeto com sucesso, nenhuma vazia');
    });

    await teste('fila do lote guarda o id do projeto e a captura nao usa mais o filtro da tela (codigo-fonte)', () => {
        assert.ok(SRC.includes('data-project-id="${doc.project_id'), 'checkbox traz o project_id');
        assert.ok(/projectId: chk\.getAttribute\('data-project-id'\)/.test(SRC), 'fila guarda o project_id');
        const fim = bloco('async function processarFilaSalic(', FIM_F);
        assert.ok(!fim.includes('projectId: state.filters.project'), 'processarFilaSalic nao manda mais o filtro da tela');
        assert.ok(fim.includes('capturarSaldoPosLote('));
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
