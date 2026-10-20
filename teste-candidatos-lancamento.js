// Testes unitários do filtro dos lançamentos candidatos (#103). Sem banco e sem rede.
// Uso: node teste-candidatos-lancamento.js
const assert = require('assert');
const C = require('./candidatos-lancamento.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

teste('constantes das janelas', () => {
    assert.strictEqual(C.JANELA_PAGAMENTO_DIAS, 7);
    assert.strictEqual(C.JANELA_EMISSAO_ANTES_DIAS, 3);
    assert.strictEqual(C.JANELA_EMISSAO_DEPOIS_DIAS, 60);
});

teste('com extrato conferido: filtra pelo extrato, sem janela, mesmo com datas', () => {
    const f = C.montarFiltroCandidatos({ extrato_conferido_id: 'E1', data_pagamento: '2026-08-04', data_emissao: '2026-07-30' }, false);
    assert.deepStrictEqual(f, { extrato_id: 'E1', data_de: null, data_ate: null, escopo: 'extrato' });
});

teste('sem extrato, com data_pagamento: janela de -7 a +7 dias', () => {
    const f = C.montarFiltroCandidatos({ extrato_conferido_id: null, data_pagamento: '2026-08-04', data_emissao: '2026-07-30' }, false);
    assert.deepStrictEqual(f, { extrato_id: null, data_de: '2026-07-28', data_ate: '2026-08-11', escopo: 'janela' });
});

teste('sem extrato, so com emissao: janela de -3 a +60 dias', () => {
    const f = C.montarFiltroCandidatos({ data_pagamento: null, data_emissao: '2026-07-30' }, false);
    assert.deepStrictEqual(f, { extrato_id: null, data_de: '2026-07-27', data_ate: '2026-09-28', escopo: 'janela' });
});

teste('sem extrato e sem nenhuma data: sem janela', () => {
    const f = C.montarFiltroCandidatos({ extrato_conferido_id: null, data_pagamento: null, data_emissao: null }, false);
    assert.deepStrictEqual(f, { extrato_id: null, data_de: null, data_ate: null, escopo: 'projeto' });
});

teste('flag de ampliar tira o filtro de extrato e a janela', () => {
    const comExtrato = C.montarFiltroCandidatos({ extrato_conferido_id: 'E1' }, true);
    const comJanela = C.montarFiltroCandidatos({ data_pagamento: '2026-08-04' }, true);
    const esperado = { extrato_id: null, data_de: null, data_ate: null, escopo: 'projeto' };
    assert.deepStrictEqual(comExtrato, esperado);
    assert.deepStrictEqual(comJanela, esperado);
});

teste('virada de mes, de ano e ano bissexto', () => {
    assert.strictEqual(C.somarDias('2026-12-30', 5), '2027-01-04');
    assert.strictEqual(C.somarDias('2026-01-03', -7), '2025-12-27');
    assert.strictEqual(C.somarDias('2028-02-28', 2), '2028-03-01');
});

teste('data fora do padrao e tratada como ausente', () => {
    const f = C.montarFiltroCandidatos({ data_pagamento: 'lixo', data_emissao: '' }, false);
    assert.strictEqual(f.escopo, 'projeto');
    assert.strictEqual(C.dataValida('2026-08-04T00:00:00+00:00'), '2026-08-04');
});

teste('doc ausente nao quebra', () => {
    assert.strictEqual(C.montarFiltroCandidatos(null, false).escopo, 'projeto');
});

console.log(`${ok} testes ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
