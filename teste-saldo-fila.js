// Testes unitários da fila de conferência do saldo SALIC (#104). Sem banco e sem rede.
// Uso: node teste-saldo-fila.js
const assert = require('assert');
const F = require('./modulo2/saldo-fila.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const T = ['2026-10-15T18:00:00.000+00:00', '2026-10-15T19:00:00.000+00:00', '2026-10-15T20:00:00.000+00:00', '2026-10-15T20:19:40.576+00:00'];
const linha = (id, status, concluida) => ({ id, vl_executado: 100, saldo_salic_capturas: { status, concluida_em: concluida } });

// MAR: 4 capturas x 3 linhas ainda sem rubrica
const mar = [];
T.forEach((t, i) => ['a', 'b', 'c'].forEach(n => mar.push(linha(`${n}${i}`, 'sucesso', t))));

teste('4 capturas x 3 linhas: so as 3 da ultima aparecem', () => {
    const r = F.filtrarFilaUltimaCaptura(mar, T[3]);
    assert.strictEqual(mar.length, 12);
    assert.deepStrictEqual(r.map(l => l.id), ['a3', 'b3', 'c3']);
});

teste('instante igual em formatos diferentes (Z, +00:00, +00) conta como a mesma captura', () => {
    const l = [linha('x', 'sucesso', '2026-10-15 20:19:40.576+00'), linha('y', 'sucesso', '2026-10-15T20:19:40.576Z')];
    assert.strictEqual(F.filtrarFilaUltimaCaptura(l, '2026-10-15T20:19:40.576+00:00').length, 2);
});

teste('sem captura bem-sucedida (ultima_captura_em nula): fila vazia', () => {
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura(mar, null), []);
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura(mar, undefined), []);
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura(mar, ''), []);
});

teste('ultima captura sem linhas na fila: fila vazia, nao cai para captura mais velha', () => {
    const velhas = mar.filter(l => !l.id.endsWith('3'));
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura(velhas, T[3]), []);
});

teste('linha de captura com erro nao entra mesmo com o mesmo instante', () => {
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura([linha('e', 'erro', T[3])], T[3]), []);
});

teste('captura embutida como lista de um item e linha sem captura', () => {
    const l = [{ id: 'l1', saldo_salic_capturas: [{ status: 'sucesso', concluida_em: T[3] }] }, { id: 'l2' }, null];
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura(l, T[3]).map(x => x.id), ['l1']);
});

teste('entrada vazia ou nula', () => {
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura([], T[0]), []);
    assert.deepStrictEqual(F.filtrarFilaUltimaCaptura(null, T[0]), []);
});

teste('soma do resumo: 3 linhas de R$ 24.815,67 somam R$ 74.447,01', () => {
    const l = ['a', 'b', 'c'].map(id => ({ id, vl_executado: 24815.67, saldo_salic_capturas: { status: 'sucesso', concluida_em: T[3] } }));
    const soma = F.filtrarFilaUltimaCaptura(l, T[3]).reduce((s, x) => s + Number(x.vl_executado), 0);
    assert.strictEqual(soma.toFixed(2), '74447.01');
});

teste('ultimaCapturaEmDoProjeto: maior instante entre as rubricas, ou null', () => {
    assert.strictEqual(F.ultimaCapturaEmDoProjeto([{ ultima_captura_em: T[0] }, { ultima_captura_em: T[3] }, { ultima_captura_em: null }]), new Date(T[3]).toISOString());
    assert.strictEqual(F.ultimaCapturaEmDoProjeto([{ ultima_captura_em: null }]), null);
    assert.strictEqual(F.ultimaCapturaEmDoProjeto([]), null);
    assert.strictEqual(F.ultimaCapturaEmDoProjeto(null), null);
});

console.log(`${ok} testes ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
