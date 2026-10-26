// Testes unitários do filtro dos lançamentos candidatos (#103) e da identidade/deduplicação do
// lançamento (#124). Sem banco e sem rede.
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

// ---- Identidade do lançamento e deduplicação (#124) ----
let seq = 0;
const lanc = (extra) => ({ id: 'l' + (++seq), extrato_id: 'E1', project_id: 'P1', fitid: '90306', valor: -190.95, data_lancamento: '2026-09-03', memo: 'Pagto fornecedor', status_conciliacao: 'pendente', document_id: null, ...extra });

teste('chave: valor absoluto com 2 casas, formatos de valor e sinal', () => {
    const k = C.chaveLancamento(lanc({ valor: -190.95 }));
    assert.strictEqual(C.chaveLancamento(lanc({ valor: 190.95 })), k, 'sinal não conta');
    assert.strictEqual(C.chaveLancamento(lanc({ valor: '190.95' })), k);
    assert.strictEqual(C.chaveLancamento(lanc({ valor: '-190,95' })), k);
    assert.strictEqual(C.chaveLancamento(lanc({ valor: 190.9500001 })), k);
    assert.strictEqual(C.valorAbsoluto('1.234,56'), '1234.56');
    assert.strictEqual(C.valorAbsoluto(null), '');
    assert.strictEqual(C.valorAbsoluto('abc'), '');
});

teste('chave: extrato diferente com o mesmo lançamento tem a mesma chave', () => {
    assert.strictEqual(C.chaveLancamento(lanc({ extrato_id: 'E1' })), C.chaveLancamento(lanc({ extrato_id: 'E2' })));
});

teste('chave: projeto, fitid, data e valor diferentes dão chaves diferentes', () => {
    const base = C.chaveLancamento(lanc({}));
    assert.notStrictEqual(C.chaveLancamento(lanc({ project_id: 'P2' })), base);
    assert.notStrictEqual(C.chaveLancamento(lanc({ fitid: '90307' })), base);
    assert.notStrictEqual(C.chaveLancamento(lanc({ data_lancamento: '2026-09-04' })), base);
    assert.notStrictEqual(C.chaveLancamento(lanc({ valor: -190.96 })), base);
});

teste('o número do documento sozinho não é chave: Resgate Automático 1.972 em 19/02 e 20/02', () => {
    const a = lanc({ fitid: '1972', data_lancamento: '2026-02-19', valor: 253845.43, memo: 'Resgate Automático' });
    const b = lanc({ fitid: '1972', data_lancamento: '2026-02-20', valor: 99304.75, memo: 'Resgate Automático' });
    assert.notStrictEqual(C.chaveLancamento(a), C.chaveLancamento(b));
    assert.strictEqual(C.deduplicar([a, b], 'N1').length, 2);
    // mesmo número e mesma data, valores diferentes: também são dois
    const c = lanc({ fitid: '1972', data_lancamento: '2026-02-19', valor: 10 });
    assert.strictEqual(C.deduplicar([a, c], 'N1').length, 2);
});

teste('sem fitid: chave pela data, valor e histórico (memo sem acento, caixa e espaços extras)', () => {
    const a = lanc({ fitid: null, memo: 'Tarifa  Pacote' });
    const b = lanc({ fitid: '', memo: 'tarifa pacote' });
    const c = lanc({ fitid: null, memo: 'Outra coisa' });
    assert.strictEqual(C.chaveLancamento(a), C.chaveLancamento(b));
    assert.notStrictEqual(C.chaveLancamento(a), C.chaveLancamento(c));
    const comAcento = lanc({ fitid: null, memo: 'Tarifa Pacote Serviço' });
    const semAcento = lanc({ fitid: null, memo: 'tarifa pacote servico' });
    assert.strictEqual(C.chaveLancamento(comAcento), C.chaveLancamento(semAcento));
    // com e sem fitid nunca colidem
    assert.notStrictEqual(C.chaveLancamento(lanc({ fitid: '1' })), C.chaveLancamento(lanc({ fitid: null })));
});

teste('deduplicar: caso real, 8 cópias da operação 90.306 (1 conciliada, 7 pendentes) viram 1, a conciliada', () => {
    const copias = Array.from({ length: 8 }, (_, i) => lanc({ id: 'c' + i }));
    copias[3] = { ...copias[3], document_id: 'N7', status_conciliacao: 'conciliado' };
    const r = C.deduplicar(copias, 'N1');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, 'c3');
});

teste('deduplicar: representante é a ligada a esta nota, depois a ligada a qualquer nota, depois a primeira', () => {
    const livre1 = lanc({ id: 'a' }), livre2 = lanc({ id: 'b' });
    const deOutra = lanc({ id: 'c', document_id: 'N9' });
    const conciliadaSemDoc = lanc({ id: 'd', status_conciliacao: 'conciliado' });
    const destaNota = lanc({ id: 'e', document_id: 'N1' });
    assert.strictEqual(C.deduplicar([livre1, livre2], 'N1')[0].id, 'a');
    assert.strictEqual(C.deduplicar([livre1, deOutra, livre2], 'N1')[0].id, 'c');
    assert.strictEqual(C.deduplicar([livre1, conciliadaSemDoc], 'N1')[0].id, 'd');
    assert.strictEqual(C.deduplicar([livre1, deOutra, destaNota], 'N1')[0].id, 'e');
    assert.strictEqual(C.deduplicar([deOutra, destaNota], 'N1')[0].id, 'e', 'a desta nota vence a de outra');
});

teste('deduplicar: mantém a ordem de primeira aparição e aceita lista vazia ou ausente', () => {
    const x = lanc({ fitid: 'X', id: 'x1' }), y = lanc({ fitid: 'Y', id: 'y1' });
    const x2 = lanc({ fitid: 'X', id: 'x2', document_id: 'N2' });
    assert.deepStrictEqual(C.deduplicar([x, y, x2], 'N1').map(l => l.id), ['x2', 'y1']);
    assert.deepStrictEqual(C.deduplicar([], 'N1'), []);
    assert.deepStrictEqual(C.deduplicar(null, 'N1'), []);
});

teste('535 linhas e 76 distintas: a listagem do extrato volta a ter 76', () => {
    const linhas = [];
    for (let i = 0; i < 535; i++) linhas.push(lanc({ fitid: 'F' + (i % 76), valor: 10 + (i % 76) }));
    assert.strictEqual(C.deduplicar(linhas, 'N1').length, 76);
});

teste('chavesUsadas: conta linha conciliada (mesmo sem nota) ou ligada a OUTRA nota, de qualquer extrato', () => {
    const deOutraNoutroExtrato = lanc({ extrato_id: 'E2', document_id: 'N9' });
    const destaNota = lanc({ fitid: 'Z', document_id: 'N1' });
    const livre = lanc({ fitid: 'W' });
    const conciliadaSemDoc = lanc({ fitid: 'V', status_conciliacao: 'conciliado', document_id: null });
    const usadas = C.chavesUsadas([deOutraNoutroExtrato, destaNota, livre, conciliadaSemDoc], 'N1');
    assert.strictEqual(usadas.size, 2);
    assert.ok(usadas.has(C.chaveLancamento(deOutraNoutroExtrato)));
    assert.ok(usadas.has(C.chaveLancamento(conciliadaSemDoc)), 'conciliado sem document_id já foi consumido');
    assert.ok(!usadas.has(C.chaveLancamento(destaNota)));
    assert.ok(!usadas.has(C.chaveLancamento(livre)));
});

teste('chavesUsadas: linha com document_id igual ao da nota aberta nunca bloqueia, nem conciliada', () => {
    const minha = lanc({ fitid: 'M', document_id: 'N1', status_conciliacao: 'conciliado' });
    assert.strictEqual(C.chavesUsadas([minha], 'N1').size, 0);
    assert.strictEqual(C.bloqueia(minha, 'N1'), false);
    // para outra nota, a mesma linha bloqueia
    assert.strictEqual(C.bloqueia(minha, 'N2'), true);
    // sem docId (nota desconhecida), qualquer linha consumida bloqueia
    assert.strictEqual(C.bloqueia(minha, null), true);
    assert.strictEqual(C.bloqueia(lanc({}), 'N1'), false, 'linha pendente e livre não bloqueia');
    assert.strictEqual(C.bloqueia(null, 'N1'), false);
});

teste('conciliado sem document_id: as cópias pendentes do mesmo lançamento não aparecem como livres', () => {
    const pendentes = Array.from({ length: 3 }, (_, i) => lanc({ id: 'p' + i }));
    const consumidaSemNota = lanc({ id: 'c', extrato_id: 'E2', status_conciliacao: 'conciliado', document_id: null });
    assert.deepStrictEqual(C.selecionarCandidatos(pendentes, [consumidaSemNota], 'N1'), []);
    // dentro das próprias candidatas também
    assert.deepStrictEqual(C.selecionarCandidatos([...pendentes, { ...pendentes[0], id: 'c2', status_conciliacao: 'conciliado' }], [], 'N1'), []);
    // e um lançamento de outra chave continua livre
    const outro = lanc({ id: 'o', fitid: 'OUTRO' });
    assert.deepStrictEqual(C.selecionarCandidatos([...pendentes, outro], [consumidaSemNota], 'N1').map(l => l.id), ['o']);
});

// ---- Conciliação automática de nota de lote (conciliarNotaAutoLote) ----
const notaLote = (extra) => ({ id: 'N1', valor: '190.95', data_pagamento: null, autenticacao_bancaria: null, ...extra });
const decidir = (nota, pendentes, consumidas = []) => {
    const { metodo, achados } = C.acharCompativeis(nota, pendentes);
    return C.decidirLancamento({ nota, metodo, achados, consumidas });
};

teste('auto-lote: 8 cópias pendentes do mesmo lançamento concilia com UMA (a de menor id), sem "múltiplos"', () => {
    const copias = Array.from({ length: 8 }, (_, i) => lanc({ id: 'c' + (7 - i) }));
    const r = decidir(notaLote(), copias);
    assert.strictEqual(r.lancamento.id, 'c0');
    assert.strictEqual(r.metodo, 'valor+data');
});

teste('auto-lote: lançamento já consumido em outro extrato (ligado ou conciliado sem nota) não é casado', () => {
    const pendentes = [lanc({ id: 'a' }), lanc({ id: 'b' })];
    for (const consumida of [
        lanc({ id: 'x', extrato_id: 'E2', document_id: 'N9', status_conciliacao: 'conciliado' }),
        lanc({ id: 'y', extrato_id: 'E2', document_id: null, status_conciliacao: 'conciliado' }),
        lanc({ id: 'z', extrato_id: 'E2', document_id: 'N9', status_conciliacao: 'pendente' })
    ]) {
        const r = decidir(notaLote(), pendentes, [consumida]);
        assert.strictEqual(r.lancamento, null);
        assert.strictEqual(r.motivo, 'lançamento já conciliado por outra nota');
    }
});

teste('auto-lote: dois lançamentos DIFERENTES compatíveis continuam ambíguos e não casam sozinhos', () => {
    const r = decidir(notaLote(), [lanc({ id: 'a', fitid: 'A' }), lanc({ id: 'b', fitid: 'B' })]);
    assert.strictEqual(r.lancamento, null);
    assert.strictEqual(r.motivo, 'múltiplos lançamentos compatíveis, revisar manualmente');
});

teste('auto-lote: um lançamento usado e outro livre de mesmo valor: casa o livre', () => {
    const r = decidir(notaLote(), [lanc({ id: 'a', fitid: 'A' }), lanc({ id: 'b', fitid: 'B' })],
        [lanc({ id: 'x', fitid: 'A', extrato_id: 'E2', document_id: 'N9' })]);
    assert.strictEqual(r.lancamento.id, 'b');
});

teste('auto-lote: critério fitid = autenticação bancária tem prioridade e não cai no valor+data', () => {
    const nota = notaLote({ autenticacao_bancaria: ' F-77 ' });
    const pendentes = [lanc({ id: 'a', fitid: 'f-77', valor: -500 }), lanc({ id: 'b', fitid: 'OUTRO', valor: -190.95 })];
    const r = decidir(nota, pendentes);
    assert.strictEqual(r.metodo, 'fitid');
    assert.strictEqual(r.lancamento.id, 'a');
    // o lançamento do fitid está usado: não cai para o de mesmo valor
    const usado = decidir(nota, pendentes, [lanc({ id: 'x', fitid: 'f-77', valor: -500, extrato_id: 'E2', document_id: 'N9' })]);
    assert.strictEqual(usado.lancamento, null);
    assert.strictEqual(usado.motivo, 'lançamento já conciliado por outra nota');
    // fitid sem correspondência: segue para valor+data
    assert.strictEqual(decidir(notaLote({ autenticacao_bancaria: 'nao-existe' }), pendentes).metodo, 'valor+data');
});

teste('auto-lote: valor +-0,01 e data +-3 dias; sem compatível devolve o motivo', () => {
    const nota = notaLote({ data_pagamento: '2026-09-03' });
    const dentro = lanc({ id: 'a', data_lancamento: '2026-09-06', valor: -190.95 });
    const fora = lanc({ id: 'b', data_lancamento: '2026-09-07', fitid: 'B' });
    assert.strictEqual(decidir(nota, [dentro, fora]).lancamento.id, 'a');
    const r = decidir(nota, [fora]);
    assert.strictEqual(r.lancamento, null);
    assert.strictEqual(r.motivo, 'nenhum lançamento compatível');
    assert.strictEqual(decidir(nota, []).motivo, 'nenhum lançamento compatível');
});

teste('risco real: uma cópia ligada a outra nota e as demais pendentes não aparecem como livres', () => {
    // 7 pendentes no extrato E1 (passaram pelos filtros) e 1 cópia ligada à nota N7 em OUTRO extrato
    const pendentes = Array.from({ length: 7 }, (_, i) => lanc({ id: 'p' + i }));
    const ligadaOutroExtrato = lanc({ id: 'lig', extrato_id: 'E2', document_id: 'N7', status_conciliacao: 'conciliado' });
    assert.deepStrictEqual(C.selecionarCandidatos(pendentes, [ligadaOutroExtrato], 'N1'), []);
    // a mesma cópia ligada dentro das candidatas (mesmo extrato) também tira o lançamento
    assert.deepStrictEqual(C.selecionarCandidatos([...pendentes, { ...pendentes[0], id: 'lig2', document_id: 'N7' }], [], 'N1'), []);
});

teste('selecionarCandidatos: lançamento livre aparece uma vez; o ligado a esta nota continua oferecido', () => {
    const livres = [lanc({ id: 'a' }), lanc({ id: 'b' }), lanc({ id: 'c' })];
    assert.deepStrictEqual(C.selecionarCandidatos(livres, [], 'N1').map(l => l.id), ['a']);
    const destaNota = lanc({ id: 'mine', document_id: 'N1' });
    assert.deepStrictEqual(C.selecionarCandidatos([...livres, destaNota], [destaNota], 'N1').map(l => l.id), ['mine']);
});

teste('selecionarCandidatos: lançamentos diferentes de mesmo valor continuam todos como candidatos', () => {
    const a = lanc({ id: 'a', fitid: 'A' }), b = lanc({ id: 'b', fitid: 'B' });
    const ligadaOutraChave = lanc({ id: 'x', fitid: 'C', document_id: 'N9' });
    assert.deepStrictEqual(C.selecionarCandidatos([a, b], [ligadaOutraChave], 'N1').map(l => l.id), ['a', 'b']);
});

teste('selecionarCandidatos: entradas ausentes não quebram', () => {
    assert.deepStrictEqual(C.selecionarCandidatos(null, null, 'N1'), []);
    assert.deepStrictEqual(C.selecionarCandidatos([], undefined, 'N1'), []);
});

console.log(`${ok} testes ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
