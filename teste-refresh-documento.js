// Testes unitários do agrupamento da atualização silenciosa e da assinatura da tela (#101).
// Sem banco, sem rede e sem relógio real: o agendador é simulado.
// Uso: node teste-refresh-documento.js
const assert = require('assert');
const { ESPERA_REFRESH_MS, criarAgrupador, assinaturaDetalhes } = require('./refresh-documento.js');

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

// Relógio simulado: avançar(ms) dispara os timers vencidos, na ordem.
function relogioFalso() {
    let agora = 0, seq = 0;
    const timers = new Map();
    return {
        agendarTimer(fn, ms) { const id = ++seq; timers.set(id, { fn, em: agora + ms }); return id; },
        cancelarTimer(id) { timers.delete(id); },
        async avancar(ms) {
            const alvo = agora + ms;
            for (;;) {
                const vencidos = [...timers.entries()].filter(([, t]) => t.em <= alvo).sort((a, b) => a[1].em - b[1].em);
                if (vencidos.length === 0) break;
                const [id, t] = vencidos[0];
                timers.delete(id);
                agora = t.em;
                t.fn();
                await Promise.resolve();
            }
            agora = alvo;
            await new Promise(r => setImmediate(r));
        },
        pendentes: () => timers.size
    };
}

// Executor controlável: cada chamada fica aberta até liberar().
function executorManual() {
    const chamadas = [];
    const executar = (id, opcoes) => new Promise(resolver => chamadas.push({ id, opcoes, resolver }));
    return { executar, chamadas, liberar: (i = chamadas.length - 1) => chamadas[i].resolver() };
}

(async () => {
    await teste('constante de espera e de 400 ms', () => assert.strictEqual(ESPERA_REFRESH_MS, 400));

    await teste('dois eventos em 50 ms geram um unico fetch', async () => {
        const rel = relogioFalso();
        const ex = executorManual();
        const g = criarAgrupador({ executar: ex.executar, agendarTimer: rel.agendarTimer, cancelarTimer: rel.cancelarTimer });
        g.agendar('A');
        await rel.avancar(50);
        g.agendar('A');
        await rel.avancar(399);
        assert.strictEqual(ex.chamadas.length, 0, 'nao pode disparar antes de 400 ms do ultimo evento');
        await rel.avancar(1);
        assert.strictEqual(ex.chamadas.length, 1);
        ex.liberar();
        await rel.avancar(1000);
        assert.strictEqual(ex.chamadas.length, 1, 'nenhum fetch extra depois');
    });

    await teste('um evento durante um fetch gera exatamente uma repeticao, sem paralelo', async () => {
        const rel = relogioFalso();
        const ex = executorManual();
        const g = criarAgrupador({ executar: ex.executar, agendarTimer: rel.agendarTimer, cancelarTimer: rel.cancelarTimer });
        g.agendar('A');
        await rel.avancar(400);
        assert.strictEqual(ex.chamadas.length, 1);
        // tres eventos enquanto o primeiro fetch esta aberto
        g.agendar('A'); g.agendar('A'); g.agendar('A');
        await rel.avancar(2000);
        assert.strictEqual(ex.chamadas.length, 1, 'nao pode iniciar um segundo fetch em paralelo');
        ex.liberar(0);
        await rel.avancar(0);
        assert.strictEqual(ex.chamadas.length, 2, 'uma repeticao ao terminar');
        ex.liberar(1);
        await rel.avancar(5000);
        assert.strictEqual(ex.chamadas.length, 2, 'so uma repeticao');
    });

    await teste('documentos diferentes nao se bloqueiam', async () => {
        const rel = relogioFalso();
        const ex = executorManual();
        const g = criarAgrupador({ executar: ex.executar, agendarTimer: rel.agendarTimer, cancelarTimer: rel.cancelarTimer });
        g.agendar('A'); g.agendar('B');
        await rel.avancar(400);
        assert.deepStrictEqual(ex.chamadas.map(c => c.id).sort(), ['A', 'B']);
    });

    await teste('forcar vale uma vez e a promise resolve ao fim da execucao que cobre o pedido', async () => {
        const rel = relogioFalso();
        const ex = executorManual();
        const g = criarAgrupador({ executar: ex.executar, agendarTimer: rel.agendarTimer, cancelarTimer: rel.cancelarTimer });
        let concluiu = false;
        g.agendar('A').then(() => { concluiu = true; });
        g.agendar('A', { forcar: true });
        await rel.avancar(400);
        assert.strictEqual(ex.chamadas[0].opcoes.forcar, true);
        assert.strictEqual(concluiu, false);
        // evento durante o fetch: a repeticao nao herda o forcar
        g.agendar('A');
        ex.liberar(0);
        await rel.avancar(0);
        assert.strictEqual(concluiu, true);
        assert.strictEqual(ex.chamadas[1].opcoes.forcar, false);
        ex.liberar(1);
    });

    await teste('erro no executor nao trava o documento', async () => {
        const rel = relogioFalso();
        let n = 0;
        const erros = [];
        const g = criarAgrupador({
            executar: async () => { n++; if (n === 1) throw new Error('falhou'); },
            agendarTimer: rel.agendarTimer, cancelarTimer: rel.cancelarTimer, aoErro: e => erros.push(e.message)
        });
        g.agendar('A');
        await rel.avancar(400);
        g.agendar('A');
        await rel.avancar(400);
        assert.strictEqual(n, 2);
        assert.deepStrictEqual(erros, ['falhou']);
    });

    const base = () => ({
        doc: { id: 'D1', status: 'divergencia_valor', updated_at: '2026-10-19T10:00:00Z', fitid: null, data_pagamento: null, valor_pago: null, extrato_conferido_id: 'E1' },
        candidatos: [{ id: 'L1' }, { id: 'L2' }],
        extratoId: 'E1', qtdLancamentos: 0, lancamentoDaNotaId: null, origemPagamento: null,
        flags: [false, false, false]
    });

    await teste('assinatura igual nao muda (nao gera render)', () => {
        assert.strictEqual(assinaturaDetalhes(base()), assinaturaDetalhes(base()));
    });

    await teste('assinatura muda com status, updated_at, pagamento, extrato e candidatos', () => {
        const ref = assinaturaDetalhes(base());
        const variacoes = [
            s => { s.doc.status = 'aguardando_d3'; },
            s => { s.doc.updated_at = '2026-10-19T10:00:01Z'; },
            s => { s.doc.fitid = '71.301'; },
            s => { s.doc.data_pagamento = '2026-08-04'; },
            s => { s.doc.valor_pago = 3490.69; },
            s => { s.doc.extrato_conferido_id = 'E2'; },
            s => { s.candidatos = [{ id: 'L1' }]; },
            s => { s.candidatos = [{ id: 'L1' }, { id: 'L3' }]; },
            s => { s.extratoId = 'E2'; },
            s => { s.qtdLancamentos = 12; },
            s => { s.flags = [false, true, false]; }
        ];
        variacoes.forEach((mudar, i) => {
            const s = base();
            mudar(s);
            assert.notStrictEqual(assinaturaDetalhes(s), ref, 'variacao ' + i + ' deveria mudar a assinatura');
        });
    });

    console.log(`${ok} testes ok, ${falhas} falhas`);
    process.exit(falhas ? 1 : 0);
})();
