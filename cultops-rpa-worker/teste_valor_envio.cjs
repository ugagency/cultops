// Testes do valor e da data enviados ao SALIC (ocorrência #120) — funcoes puras do server.js,
// nao acessam o SALIC nem o Supabase.
// Rodar: node teste_valor_envio.cjs
// As variaveis de ambiente recebem valores ficticios antes de carregar o server.js (o dotenv
// nao sobrescreve o que ja existe), entao as chaves do .env nunca sao usadas.
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'http://supabase.invalido';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-ficticia';
const { calcularValorEnvio, resolverDataPagamento } = require('./server.js');

let falhas = 0;
function caso(nome, fn) {
    const log = console.log;
    console.log = () => { };
    try { fn(); log('ok   -', nome); }
    catch (e) { falhas++; log('FALHA -', nome, '\n      ', e.message); }
    finally { console.log = log; }
}

const DOC = 'doc-39405';
const nota = (extra = {}) => ({ id: DOC, valor: 18000, valor_pago: null, ...extra });
// Lançamento de débito como vem do extrato (valor negativo), no formato da consulta do server.
const lanc = (extra = {}) => ({ extrato_id: 'e1', fitid: '93.001', valor: -16893, data_lancamento: '2026-09-30', document_id: DOC, ...extra });

caso('valor_pago preenchido: usa valor_pago', () => {
    const r = calcularValorEnvio(nota({ valor_pago: 17500 }), [lanc()], []);
    assert.deepEqual(r, { valor: 17500, origem: 'valor_pago' });
});

caso('valor_pago preenchido vale mesmo com o lançamento dividido entre notas', () => {
    const r = calcularValorEnvio(nota({ valor_pago: 9000 }), [lanc()], [lanc(), lanc({ document_id: 'outra-nota' })]);
    assert.deepEqual(r, { valor: 9000, origem: 'valor_pago' });
});

caso('lançamento exclusivo: usa |valor| do lançamento (NF 39405 -> 16.893,00)', () => {
    const r = calcularValorEnvio(nota(), [lanc()], [lanc()]);
    assert.deepEqual(r, { valor: 16893, origem: 'lancamento' });
});

caso('lançamento dividido entre 2 notas: "Valor pago não determinado"', () => {
    assert.throws(() => calcularValorEnvio(nota(), [lanc()], [lanc(), lanc({ document_id: 'outra-nota' })]),
        /^Error: \[LANCAMENTO_DIVIDIDO\] Valor pago não determinado: o lançamento 93\.001 está conciliado com 2 documentos/);
});

caso('lançamento duplicado do mesmo documento (mesmo fitid, valor e data): conta uma vez', () => {
    // duas linhas iguais no mesmo extrato, ambas conciliadas com esta nota
    const r = calcularValorEnvio(nota(), [lanc(), lanc()], [lanc(), lanc()]);
    assert.deepEqual(r, { valor: 16893, origem: 'lancamento' });
});

caso('lançamento duplicado em outro extrato, conciliado com a mesma nota: conta uma vez', () => {
    const r = calcularValorEnvio(nota(), [lanc(), lanc({ extrato_id: 'e2' })], [lanc()]);
    assert.deepEqual(r, { valor: 16893, origem: 'lancamento' });
});

caso('valor pago maior que a nota: erro', () => {
    assert.throws(() => calcularValorEnvio(nota({ valor_pago: 18000.02 }), [lanc()], []),
        /Valor pago \(R\$ 18000\.02, origem: valor_pago\) maior que o valor da nota \(R\$ 18000\.00\)/);
    // vindo do lançamento, acima da nota tambem e erro
    assert.throws(() => calcularValorEnvio(nota({ valor: 16000 }), [lanc()], [lanc()]),
        /Valor pago \(R\$ 16893\.00, origem: lancamento\) maior que o valor da nota \(R\$ 16000\.00\)/);
});

// ── valor vindo do lançamento (8b): sem faixa minima, so o teto da nota ──
caso('lançamento 821,70 vs nota 16.850,58 -> aceito com origem lancamento', () => {
    assert.deepEqual(calcularValorEnvio(nota({ valor: 16850.58 }), [lanc({ valor: -821.70 })], [lanc({ valor: -821.70 })]),
        { valor: 821.7, origem: 'lancamento' });
});

caso('lançamento 6.600,00 vs nota 4.000,00 -> erro (acima da nota)', () => {
    assert.throws(() => calcularValorEnvio(nota({ valor: 4000 }), [lanc({ valor: -6600 })], [lanc({ valor: -6600 })]),
        /^Error: \[VALOR_MAIOR_QUE_NOTA\] Valor pago \(R\$ 6600\.00, origem: lancamento\) maior que o valor da nota \(R\$ 4000\.00\)/);
});

caso('lançamento 16.893,00 vs nota 18.000,00 -> aceito', () => {
    assert.deepEqual(calcularValorEnvio(nota({ valor: 18000 }), [lanc()], [lanc()]), { valor: 16893, origem: 'lancamento' });
});

caso('lançamento igual a nota + 1 centavo: aceito; + 2 centavos: erro', () => {
    assert.equal(calcularValorEnvio(nota({ valor: 10000 }), [lanc({ valor: -10000.01 })], []).valor, 10000.01);
    assert.throws(() => calcularValorEnvio(nota({ valor: 10000 }), [lanc({ valor: -10000.02 })], []), /maior que o valor da nota/);
});

caso('valor pago igual a nota + 1 centavo: aceito (tolerancia)', () => {
    assert.equal(calcularValorEnvio(nota({ valor_pago: 18000.01 }), [lanc()], []).valor, 18000.01);
});

caso('sem lançamento e sem valor_pago: "Valor pago não determinado"', () => {
    assert.throws(() => calcularValorEnvio(nota(), [], []), /^Error: \[VALOR_PAGO_INDETERMINADO\] Valor pago não determinado/);
    assert.throws(() => calcularValorEnvio(nota(), null, null), /^Error: \[VALOR_PAGO_INDETERMINADO\] Valor pago não determinado/);
});

// ── data do pagamento: (1) lançamento conciliado, (2) documents.data_pagamento, (3) erro ──
caso('data: lançamento conciliado (sem data_pagamento no documento) usa a data dele', () => {
    assert.equal(resolverDataPagamento(lanc(), nota({ data_emissao: '2026-09-01' })), '2026-09-30');
});

caso('data: só documents.data_pagamento preenchida (sem lançamento) usa essa data e loga a origem', () => {
    const linhas = [];
    const log = console.log;
    console.log = (...a) => linhas.push(a.join(' '));
    try {
        assert.equal(resolverDataPagamento(undefined, nota({ data_pagamento: '2026-09-15', data_emissao: '2026-09-01' })), '2026-09-15');
        assert.equal(resolverDataPagamento({ fitid: '93.001', data_lancamento: null }, nota({ data_pagamento: '2026-09-15' })), '2026-09-15');
    } finally { console.log = log; }
    assert.ok(linhas.every(l => l.includes('fonte: documents.data_pagamento')), linhas.join(' | '));
});

caso('data: nenhuma das duas -> erro [DATA_PAGAMENTO_SEM_LANCAMENTO], sem cair para data_emissao', () => {
    const doc = nota({ data_pagamento: null, data_emissao: '2026-09-01' });
    for (const lancamento of [undefined, null, { fitid: '93.001', data_lancamento: null }]) {
        assert.throws(() => resolverDataPagamento(lancamento, doc), (e) => {
            assert.match(e.message, /^\[DATA_PAGAMENTO_SEM_LANCAMENTO\] Documento .* sem lançamento bancário conciliado e sem data de pagamento informada/);
            return e.codigo === 'DATA_PAGAMENTO_SEM_LANCAMENTO';
        });
    }
    assert.throws(() => resolverDataPagamento(undefined, nota({ data_pagamento: '', data_emissao: '2026-09-01' })), /DATA_PAGAMENTO_SEM_LANCAMENTO/);
});

caso('data: as duas divergentes -> usa a do lançamento', () => {
    assert.equal(resolverDataPagamento(lanc({ data_lancamento: '2026-09-30' }), nota({ data_pagamento: '2026-09-15', data_emissao: '2026-09-01' })), '2026-09-30');
});

caso('dois lançamentos distintos na mesma nota e valor_pago vazio: erro (o valor de um não é o pago)', () => {
    assert.throws(() => calcularValorEnvio(nota(), [lanc(), lanc({ fitid: '94.002', valor: -1107, data_lancamento: '2026-10-05' })], [lanc()]),
        /Valor pago não determinado: valor_pago vazio e 2 lançamentos conciliados distintos/);
});

caso('valor_pago zero: erro', () => {
    assert.throws(() => calcularValorEnvio(nota({ valor_pago: 0 }), [lanc()], []), /Valor pago não determinado: valor inválido/);
});

console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
process.exitCode = falhas === 0 ? 0 : 1;
