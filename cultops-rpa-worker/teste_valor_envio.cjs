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
        /^Error: Valor pago não determinado: o lançamento 93\.001 está conciliado com 2 documentos/);
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
    assert.throws(() => calcularValorEnvio(nota({ valor: 16000 }), [lanc()], [lanc()]),
        /Valor pago \(R\$ 16893\.00, origem: lancamento\) maior que o valor da nota \(R\$ 16000\.00\)/);
});

caso('valor pago igual a nota + 1 centavo: aceito (tolerancia)', () => {
    assert.equal(calcularValorEnvio(nota({ valor_pago: 18000.01 }), [lanc()], []).valor, 18000.01);
});

caso('sem lançamento e sem valor_pago: "Valor pago não determinado"', () => {
    assert.throws(() => calcularValorEnvio(nota(), [], []), /^Error: Valor pago não determinado/);
    assert.throws(() => calcularValorEnvio(nota(), null, null), /^Error: Valor pago não determinado/);
});

caso('sem lançamento: a data do pagamento lança erro (sem cair para data_pagamento/data_emissao)', () => {
    const doc = nota({ data_pagamento: '2026-09-15', data_emissao: '2026-09-01' });
    assert.throws(() => resolverDataPagamento(undefined, doc), /sem lançamento bancário conciliado/);
    assert.throws(() => resolverDataPagamento({ fitid: '93.001', data_lancamento: null }, doc), /sem lançamento bancário conciliado/);
});

caso('com lançamento: a data do pagamento é a do lançamento', () => {
    assert.equal(resolverDataPagamento(lanc(), nota({ data_emissao: '2026-09-01' })), '2026-09-30');
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
