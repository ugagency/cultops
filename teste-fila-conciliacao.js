// Testes da fila de conciliação das notas de lote (fila-conciliacao.js): elegibilidade, ordem,
// marcadores, espaçamento e orçamento. Sem banco, sem rede e sem relógio real: o tempo é
// simulado. Uso: node teste-fila-conciliacao.js
const assert = require('assert');
const F = require('./fila-conciliacao.js');

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const T0 = Date.parse('2026-10-26T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const nota = (id, extrato, atras, status = 'aguardando_conciliacao_bancaria') =>
    ({ id, extrato_origem_id: extrato, status, project_id: 'p1', updated_at: iso(T0 - atras) });

// Relógio simulado: dormir() avança o tempo; enviar() de cada teste também.
function relogio() {
    const r = { t: T0, agora: () => r.t, dormir: async (ms) => { r.t += ms; } };
    return r;
}

// Simula N notas do mesmo extrato, cada envio durando `duracaoMs`. Registra início, fim e
// quantos envios estão abertos ao mesmo tempo (a espera por uma microtarefa dá chance a um
// laço paralelo de se sobrepor; o laço correto nunca passa de 1).
async function simular({ n, duracaoMs, orcamentoMs = F.ORCAMENTO_MS, extrato = 'ext-1' }) {
    const rel = relogio();
    const itens = Array.from({ length: n }, (_, i) => nota('n' + (i + 1), extrato, 120000 - i * 1000));
    let abertos = 0, maxAbertos = 0;
    const linhas = [];
    const enviar = async (item) => {
        abertos++; maxAbertos = Math.max(maxAbertos, abertos);
        const ini = rel.t;
        await Promise.resolve();
        rel.t += duracaoMs;
        await Promise.resolve();
        linhas.push({ id: item.id, inicio: (ini - T0) / 1000, fim: (rel.t - T0) / 1000 });
        abertos--;
        return { enviado: true, ok: true };
    };
    const r = await F.executarFila({ itens, enviar, agora: rel.agora, dormir: rel.dormir, orcamentoMs });
    return { ...r, linhas, maxAbertos };
}

const tabela = (linhas) => linhas.map(l => `${l.id}: inicia em ${l.inicio}s, termina em ${l.fim}s`).join(' | ');

(async () => {
    await teste('constantes: intervalo de 6 s, carência padrão de 30 s, orçamento de 100 s', () => {
        assert.strictEqual(F.INTERVALO_MS, 6000);
        assert.strictEqual(F.CARENCIA_PADRAO_MS, 30000);
        assert.strictEqual(F.ORCAMENTO_MS, 100000);
    });

    await teste('carência por variável de ambiente: valor válido, ausente, inválido e negativo', () => {
        assert.strictEqual(F.lerCarenciaMs('45000'), 45000);
        assert.strictEqual(F.lerCarenciaMs('0'), 0);
        for (const v of [undefined, null, '', '  ', 'abc', '-5', 'NaN', 'Infinity']) assert.strictEqual(F.lerCarenciaMs(v), 30000, String(v));
        assert.strictEqual(F.lerCarenciaMs('abc', 1234), 1234);
    });

    await teste('esperaProximoEnvio: conta do início do anterior, nunca negativa', () => {
        const e = (inicioAnteriorMs, agoraMs) => F.esperaProximoEnvio({ inicioAnteriorMs, agoraMs });
        assert.strictEqual(e(null, 1000), 0);
        assert.strictEqual(e(1000, 1000), 6000);
        assert.strictEqual(e(1000, 3000), 4000);
        assert.strictEqual(e(1000, 7000), 0);
        assert.strictEqual(e(1000, 7001), 0);
        assert.strictEqual(e(1000, 21000), 0);
    });

    await teste('cabeNaRodada: o início previsto precisa estar dentro do orçamento', () => {
        assert.strictEqual(F.cabeNaRodada({ inicioRodadaMs: 0, inicioPrevistoMs: 100000 }), true);
        assert.strictEqual(F.cabeNaRodada({ inicioRodadaMs: 0, inicioPrevistoMs: 100001 }), false);
        assert.strictEqual(F.cabeNaRodada({ inicioRodadaMs: 5000, inicioPrevistoMs: 105000 }), true);
    });

    await teste('elegibilidade: status, extrato de origem e carência', () => {
        const notas = [
            nota('ok1', 'e1', 60000),
            nota('sem-extrato', null, 60000),
            nota('status-errado', 'e1', 60000, 'aguardando_d3'),
            nota('recente', 'e1', 10000),
            nota('borda', 'e1', 30000),
            nota('ok2', 'e1', 31000, 'aguardando_comprovante')
        ];
        const ids = F.elegiveis(notas, { agoraMs: T0, carenciaMs: 30000 }).map(n => n.id);
        assert.deepStrictEqual(ids.sort(), ['ok1', 'ok2'].sort());
        // carência maior deixa de fora quem ainda não a cumpriu
        assert.deepStrictEqual(F.elegiveis(notas, { agoraMs: T0, carenciaMs: 45000 }).map(n => n.id), ['ok1']);
        // carência zero libera todas as de status e extrato válidos (continuam fora a de status
        // errado e a sem extrato)
        assert.deepStrictEqual(F.elegiveis(notas, { agoraMs: T0, carenciaMs: 0 }).map(n => n.id).sort(), ['borda', 'ok1', 'ok2', 'recente']);
    });

    await teste('ordem: por extrato e, dentro dele, da mais antiga para a mais nova; empate por id', () => {
        const notas = [
            nota('c', 'e2', 50000), nota('b', 'e1', 50000), nota('a', 'e1', 50000),
            nota('novo', 'e1', 40000), nota('velho', 'e1', 90000), nota('z', 'e2', 80000)
        ];
        const ids = F.elegiveis(notas, { agoraMs: T0, carenciaMs: 30000 }).map(n => n.id);
        assert.deepStrictEqual(ids, ['velho', 'a', 'b', 'novo', 'z', 'c']);
    });

    await teste('marcadores: a nota é tentada uma vez por chegada ao status', () => {
        const n = nota('n1', 'e1', 120000);
        const marcaDepois = { registro_id: 'n1', acao: F.ACAO_INICIO, criado_em: iso(T0 - 60000) };
        const marcaAntes = { registro_id: 'n1', acao: F.ACAO_INICIO, criado_em: iso(T0 - 200000) };
        const outraNota = { registro_id: 'n9', acao: F.ACAO_INICIO, criado_em: iso(T0 - 60000) };
        const outraAcao = { registro_id: 'n1', acao: F.ACAO_FIM, criado_em: iso(T0 - 60000) };
        assert.strictEqual(F.pendentes([n], []).length, 1);
        assert.strictEqual(F.pendentes([n], [marcaDepois]).length, 0);
        assert.strictEqual(F.pendentes([n], [marcaAntes]).length, 1, 'marcador de uma chegada anterior não vale');
        assert.strictEqual(F.pendentes([n], [outraNota, outraAcao]).length, 1);
    });

    await teste('extrato ocupado: marcador recente sem evento de fim bloqueia o extrato', () => {
        const a = nota('a', 'e1', 300000), b = nota('b', 'e1', 290000), c = nota('c', 'e2', 290000);
        const inicio = (id, atras) => ({ registro_id: id, acao: F.ACAO_INICIO, criado_em: iso(T0 - atras) });
        const fim = (id, atras) => ({ registro_id: id, acao: F.ACAO_FIM, criado_em: iso(T0 - atras) });
        const ocupados = (eventos, agoraMs = T0) => F.extratosOcupados([a, b, c], eventos, { agoraMs });
        assert.deepStrictEqual([...ocupados([inicio('a', 20000)])], ['e1']);
        assert.deepStrictEqual([...ocupados([inicio('a', 20000), fim('a', 5000)])], [], 'com evento de fim, livre');
        assert.deepStrictEqual([...ocupados([inicio('a', 250000)])], [], 'passada a janela, livre');
        assert.deepStrictEqual([...ocupados([inicio('a', 199000)])], ['e1'], 'ainda dentro da janela');
        assert.deepStrictEqual([...ocupados([inicio('c', 20000)])], ['e2'], 'só o extrato da nota em andamento');
        assert.deepStrictEqual([...ocupados([])], []);
    });

    await teste('simulação: 5 notas do mesmo extrato, envios de 2 s', async () => {
        const r = await simular({ n: 5, duracaoMs: 2000 });
        console.log('  2 s  -> ' + tabela(r.linhas));
        assert.strictEqual(r.resultados.length, 5);
        assert.strictEqual(r.naoProcessados.length, 0);
        assert.strictEqual(r.maxAbertos, 1, 'nunca duas em paralelo');
        assert.deepStrictEqual(r.linhas.map(l => l.inicio), [0, 6, 12, 18, 24]);
        for (let i = 1; i < r.linhas.length; i++) {
            assert.ok(r.linhas[i].inicio - r.linhas[i - 1].inicio >= 6, 'espaçamento mínimo de 6 s entre inícios');
            assert.ok(r.linhas[i].inicio >= r.linhas[i - 1].fim, 'a próxima só sai depois que a anterior termina');
        }
    });

    await teste('simulação: 5 notas do mesmo extrato, envios de 20 s', async () => {
        const r = await simular({ n: 5, duracaoMs: 20000 });
        console.log('  20 s -> ' + tabela(r.linhas));
        assert.strictEqual(r.resultados.length, 5);
        assert.strictEqual(r.maxAbertos, 1, 'nunca duas em paralelo');
        // anterior demorou mais que 6 s: a próxima sai logo em seguida, sem espera extra
        assert.deepStrictEqual(r.linhas.map(l => l.inicio), [0, 20, 40, 60, 80]);
        for (let i = 1; i < r.linhas.length; i++) {
            assert.ok(r.linhas[i].inicio - r.linhas[i - 1].inicio >= 6);
            assert.strictEqual(r.linhas[i].inicio, r.linhas[i - 1].fim, 'sem espera quando o anterior passou de 6 s');
        }
    });

    await teste('orçamento: o que não cabe na rodada volta como não processado', async () => {
        const r = await simular({ n: 5, duracaoMs: 30000 });
        console.log('  30 s -> ' + tabela(r.linhas) + ` | ficam para a próxima rodada: ${r.naoProcessados.map(n => n.id).join(', ')}`);
        assert.deepStrictEqual(r.linhas.map(l => l.inicio), [0, 30, 60, 90]);
        assert.deepStrictEqual(r.naoProcessados.map(n => n.id), ['n5']);
        assert.strictEqual(r.maxAbertos, 1);
    });

    await teste('orçamento: a espera de 6 s também conta para decidir se a próxima cabe', async () => {
        // envios de 1 s, orçamento de 20 s: inícios em 0, 6, 12, 18; o de 24 s não cabe
        const r = await simular({ n: 6, duracaoMs: 1000, orcamentoMs: 20000 });
        assert.deepStrictEqual(r.linhas.map(l => l.inicio), [0, 6, 12, 18]);
        assert.strictEqual(r.naoProcessados.length, 2);
    });

    await teste('uma falha não interrompe as demais e o espaçamento continua valendo', async () => {
        const rel = relogio();
        const itens = [nota('n1', 'e1', 120000), nota('n2', 'e1', 119000), nota('n3', 'e1', 118000)];
        const inicios = [];
        const enviar = async (item) => {
            inicios.push((rel.t - T0) / 1000);
            rel.t += 1000;
            if (item.id === 'n2') throw new Error('n8n fora do ar');
            return { enviado: true, ok: true };
        };
        const r = await F.executarFila({ itens, enviar, agora: rel.agora, dormir: rel.dormir });
        assert.deepStrictEqual(r.resultados.map(x => [x.item.id, x.ok]), [['n1', true], ['n2', false], ['n3', true]]);
        assert.strictEqual(r.resultados[1].erro, 'n8n fora do ar');
        assert.deepStrictEqual(inicios, [0, 6, 12]);
    });

    await teste('envio com ok=false (resposta de erro) também segue para a próxima', async () => {
        const rel = relogio();
        const itens = [nota('n1', 'e1', 120000), nota('n2', 'e1', 119000)];
        const enviar = async (item) => { rel.t += 500; return { enviado: true, ok: item.id !== 'n1' }; };
        const r = await F.executarFila({ itens, enviar, agora: rel.agora, dormir: rel.dormir });
        assert.deepStrictEqual(r.resultados.map(x => x.ok), [false, true]);
    });

    await teste('extrato sem arquivo: registra e segue, sem gastar o espaçamento', async () => {
        const rel = relogio();
        const itens = [nota('n1', 'e1', 120000), nota('n2', 'e1', 119000), nota('n3', 'e1', 118000)];
        const inicios = [];
        const enviar = async (item) => {
            inicios.push([item.id, (rel.t - T0) / 1000]);
            rel.t += 1000;
            return item.id === 'n2' ? { enviado: false, ok: false } : { enviado: true, ok: true };
        };
        const r = await F.executarFila({ itens, enviar, agora: rel.agora, dormir: rel.dormir });
        assert.strictEqual(r.resultados.length, 3);
        // n2 não foi mandada ao webhook: n3 conta o intervalo a partir do início de n1 (0 s)
        assert.deepStrictEqual(inicios, [['n1', 0], ['n2', 6], ['n3', 7]]);
    });

    await teste('fila vazia não faz nada', async () => {
        const rel = relogio();
        const r = await F.executarFila({ itens: [], enviar: async () => assert.fail('não deveria enviar'), agora: rel.agora, dormir: rel.dormir });
        assert.deepStrictEqual([r.resultados.length, r.naoProcessados.length], [0, 0]);
    });

    await teste('extratoDeOutroProjeto: reconhece a mensagem do n8n (com ou sem acento, caixa e espaço)', () => {
        assert.strictEqual(F.extratoDeOutroProjeto('Extrato de outro projeto: o PRONAC do extrato não confere'), true);
        assert.strictEqual(F.extratoDeOutroProjeto('  EXTRATO DE OUTRO PROJETO'), true);
        assert.strictEqual(F.extratoDeOutroProjeto('Há 2 lançamentos que atendem às regras'), false);
        assert.strictEqual(F.extratoDeOutroProjeto('Divergência: extrato de outro projeto'), false, 'tem que começar com a mensagem');
        assert.strictEqual(F.extratoDeOutroProjeto(null), false);
        assert.strictEqual(F.extratoDeOutroProjeto(''), false);
    });

    await teste('extratosPausados: só eventos de pausa, pelo id do extrato', () => {
        const eventos = [
            { registro_id: 'ext-A', acao: F.ACAO_PAUSA },
            { registro_id: 'n1', acao: F.ACAO_INICIO },
            { registro_id: 'ext-B', acao: F.ACAO_FIM },
            { registro_id: null, acao: F.ACAO_PAUSA }
        ];
        assert.deepStrictEqual([...F.extratosPausados(eventos)], ['ext-A']);
        assert.strictEqual(F.extratosPausados(null).size, 0);
        assert.strictEqual(F.ACAO_PAUSA, 'conciliacao_extrato_pausado');
    });

    await teste('pausa: 5 notas do mesmo extrato, a primeira volta com PRONAC divergente: nenhuma outra é enviada', async () => {
        const rel = relogio();
        const itens = Array.from({ length: 5 }, (_, i) => nota('n' + (i + 1), 'ext-ruim', 120000 - i * 1000));
        const pausados = new Set();
        const enviadas = [];
        const enviar = async (item) => {
            enviadas.push(item.id);
            rel.t += 2000;
            // o n8n devolveu a nota com a mensagem de PRONAC divergente
            if (F.extratoDeOutroProjeto('Extrato de outro projeto: PRONAC 111 diferente de 222')) pausados.add(item.extrato_origem_id);
            return { enviado: true, ok: true };
        };
        const r = await F.executarFila({ itens, enviar, agora: rel.agora, dormir: rel.dormir, pular: (item) => pausados.has(item.extrato_origem_id) });
        assert.deepStrictEqual(enviadas, ['n1']);
        assert.deepStrictEqual(r.puladas.map(n => n.id), ['n2', 'n3', 'n4', 'n5']);
        assert.strictEqual(r.resultados.length, 1);
        assert.strictEqual(r.naoProcessados.length, 0);
    });

    await teste('pausa: só o extrato pausado para; as notas de outros extratos seguem, com o espaçamento de 6 s', async () => {
        const rel = relogio();
        const itens = [
            nota('a1', 'ext-A', 120000), nota('a2', 'ext-A', 119000), nota('a3', 'ext-A', 118000),
            nota('b1', 'ext-B', 117000), nota('b2', 'ext-B', 116000)
        ];
        const pausados = new Set();
        const inicios = [];
        const enviar = async (item) => {
            inicios.push([item.id, (rel.t - T0) / 1000]);
            rel.t += 2000;
            if (item.id === 'a1') pausados.add('ext-A');
            return { enviado: true, ok: true };
        };
        const r = await F.executarFila({ itens, enviar, agora: rel.agora, dormir: rel.dormir, pular: (item) => pausados.has(item.extrato_origem_id) });
        assert.deepStrictEqual(inicios, [['a1', 0], ['b1', 6], ['b2', 12]]);
        assert.deepStrictEqual(r.puladas.map(n => n.id), ['a2', 'a3']);
    });

    await teste('pausa de rodadas anteriores: extrato já pausado não recebe nenhuma nota', async () => {
        const rel = relogio();
        const pausados = F.extratosPausados([{ registro_id: 'ext-A', acao: F.ACAO_PAUSA }]);
        const itens = [nota('a1', 'ext-A', 120000), nota('a2', 'ext-A', 119000)];
        const r = await F.executarFila({
            itens, enviar: async () => assert.fail('não deveria enviar'),
            agora: rel.agora, dormir: rel.dormir, pular: (item) => pausados.has(item.extrato_origem_id)
        });
        assert.strictEqual(r.resultados.length, 0);
        assert.strictEqual(r.puladas.length, 2);
    });

    await teste('pausa termina com a troca do extrato: a nota que passa a apontar para outro extrato volta a ser enviada', async () => {
        const rel = relogio();
        const pausados = F.extratosPausados([{ registro_id: 'ext-ruim', acao: F.ACAO_PAUSA }]);
        const trocada = nota('n1', 'ext-bom', 120000); // antes apontava para ext-ruim
        const enviadas = [];
        const r = await F.executarFila({
            itens: [trocada], enviar: async (i) => { enviadas.push(i.id); rel.t += 1000; return { enviado: true, ok: true }; },
            agora: rel.agora, dormir: rel.dormir, pular: (item) => pausados.has(item.extrato_origem_id)
        });
        assert.deepStrictEqual(enviadas, ['n1']);
        assert.strictEqual(r.puladas.length, 0);
    });

    await teste('notas puladas por pausa não gastam espera nem orçamento', async () => {
        const rel = relogio();
        const pausados = new Set(['ext-A']);
        const itens = [...Array.from({ length: 30 }, (_, i) => nota('a' + i, 'ext-A', 120000)), nota('b1', 'ext-B', 100000)];
        const r = await F.executarFila({
            itens, enviar: async () => { rel.t += 1000; return { enviado: true, ok: true }; },
            agora: rel.agora, dormir: rel.dormir, pular: (item) => pausados.has(item.extrato_origem_id)
        });
        assert.strictEqual(r.resultados.length, 1);
        assert.strictEqual(r.resultados[0].inicioMs, T0, 'a nota de outro extrato sai de imediato');
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
