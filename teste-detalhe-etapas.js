// Testes da lógica das etapas da tela de detalhes (#130): detalhe-etapas.js, sem DOM.
// Rodar: node teste-detalhe-etapas.js
const assert = require('assert');
const E = require('./detalhe-etapas.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.log('FALHOU: ' + nome + '\n   ' + e.message); }
}

teste('fluxo normal: cada status cai na etapa de antes da tela nova', () => {
    const esperado = {
        uploaded: 0, processing_ocr: 1, aguardando_conformidade: 2, aguardando_comprovante: 3,
        aguardando_conciliacao_bancaria: 4, aguardando_d3: 5, liberado_rpa_airtop: 5, enviado_salic: 5, concluido: 5
    };
    for (const [status, etapa] of Object.entries(esperado)) {
        const r = E.etapaDoStatus(status);
        assert.strictEqual(r.atual, etapa, status);
        assert.strictEqual(r.erro, false, status);
    }
    assert.strictEqual(E.etapaDoStatus('enviado_salic').concluida, true);
    assert.strictEqual(E.etapaDoStatus('concluido').concluida, true);
    assert.strictEqual(E.etapaDoStatus('liberado_rpa_airtop').concluida, false);
});

teste('desvios que já existiam continuam na mesma etapa e com erro', () => {
    assert.deepStrictEqual(E.etapaDoStatus('revisao_manual'), { atual: 1, erro: true, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('bloqueado_conformidade'), { atual: 2, erro: true, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('divergencia_valor'), { atual: 4, erro: true, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('divergencia_beneficiario'), { atual: 4, erro: true, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('erro_rpa'), { atual: 5, erro: true, concluida: false });
});

teste('status que antes caíam na etapa 1 por falta de regra', () => {
    // aguardando_rubrica vem antes da leitura (a nota volta dele para processing_ocr)
    assert.deepStrictEqual(E.etapaDoStatus('aguardando_rubrica'), { atual: 0, erro: false, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('validating'), { atual: 1, erro: false, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('validated'), { atual: 2, erro: false, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('aguardando_aprovacao_fornecedor'), { atual: 2, erro: false, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus('rejeitado_fornecedor'), { atual: 2, erro: true, concluida: false });
});

teste('status desconhecido cai na etapa 0, como antes', () => {
    assert.deepStrictEqual(E.etapaDoStatus('status_que_nao_existe'), { atual: 0, erro: false, concluida: false });
    assert.deepStrictEqual(E.etapaDoStatus(undefined), { atual: 0, erro: false, concluida: false });
});

teste('etapa vista: escolha vale na mesma nota e no mesmo status', () => {
    const doc = { id: 'd1', status: 'aguardando_d3' };
    const escolhido = { docId: 'd1', status: 'aguardando_d3', vista: 2 };
    assert.deepStrictEqual(E.resolverVista(escolhido, doc), escolhido);
    assert.strictEqual(E.indiceVisto(escolhido, doc), 2);
});

teste('etapa vista: volta para a atual quando o status muda ou a nota é outra', () => {
    const escolhido = { docId: 'd1', status: 'aguardando_d3', vista: 2 };
    const mudou = E.resolverVista(escolhido, { id: 'd1', status: 'liberado_rpa_airtop' });
    assert.strictEqual(mudou.vista, null);
    assert.strictEqual(E.indiceVisto(mudou, { id: 'd1', status: 'liberado_rpa_airtop' }), 5);
    const outra = E.resolverVista(escolhido, { id: 'd2', status: 'aguardando_d3' });
    assert.strictEqual(outra.vista, null);
    assert.deepStrictEqual(E.resolverVista(null, null), { docId: null, status: null, vista: null });
});

teste('etapa vista: índice inválido mostra a etapa atual', () => {
    const doc = { id: 'd1', status: 'divergencia_valor' };
    assert.strictEqual(E.indiceVisto({ vista: 9 }, doc), 4);
    assert.strictEqual(E.indiceVisto({ vista: -1 }, doc), 4);
    assert.strictEqual(E.indiceVisto(null, doc), 4);
});

teste('histórico: agrupa por etapa do status de destino, em ordem cronológica', () => {
    const rot = (s) => ({ divergencia_beneficiario: 'Divergência', aguardando_d3: 'Em carência (D-3)', liberado_rpa_airtop: 'Pronto para envio' }[s] || s);
    const linhas = [
        { valor_anterior: 'aguardando_d3', valor_novo: 'liberado_rpa_airtop', origem: 'sistema:nao_declarado', motivo: null, created_at: '2026-11-03T22:05:47Z' },
        { valor_anterior: 'divergencia_beneficiario', valor_novo: 'aguardando_d3', origem: 'avancar_nota_apos_pagamento', motivo: 'Pago em outro extrato', created_at: '2026-11-03T21:22:13Z' },
        { valor_anterior: 'aguardando_conciliacao_bancaria', valor_novo: 'divergencia_beneficiario', origem: 'sistema:nao_declarado', motivo: null, created_at: '2026-11-03T21:20:31Z' }
    ];
    const h = E.historicoPorEtapa(linhas, rot);
    assert.strictEqual(h.length, 6);
    assert.strictEqual(h[4].length, 1);
    assert.strictEqual(h[4][0].texto, 'aguardando_conciliacao_bancaria → Divergência');
    assert.strictEqual(h[5].length, 2);
    assert.strictEqual(h[5][0].texto, 'Divergência → Em carência (D-3)');
    assert.strictEqual(h[5][0].origem, 'avanço após o pagamento');
    assert.strictEqual(h[5][0].motivo, 'Pago em outro extrato');
    assert.strictEqual(h[5][1].origem, 'automático');
});

teste('histórico: lista vazia, nula ou linha sem destino não quebra', () => {
    assert.deepStrictEqual(E.historicoPorEtapa(null).map(l => l.length), [0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(E.historicoPorEtapa([{ valor_novo: null }]).map(l => l.length), [0, 0, 0, 0, 0, 0]);
    const h = E.historicoPorEtapa([{ valor_anterior: null, valor_novo: 'uploaded', created_at: '2026-01-01' }]);
    assert.strictEqual(h[0][0].texto, 'Entrou em uploaded');
});

teste('origem desconhecida vira texto legível', () => {
    assert.strictEqual(E.rotuloOrigem('ui'), 'pela tela');
    assert.strictEqual(E.rotuloOrigem('sistema:reprocessar_ocr'), 'reprocessar ocr');
    assert.strictEqual(E.rotuloOrigem(null), '');
});

console.log(`${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
