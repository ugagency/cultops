// Teste do #195: prévia do que o robô grava no SALIC.
//  - previa-salic.js reproduz as regras do robô (casos copiados de cultops-rpa-worker/teste_valor_envio.cjs
//    e dos comentários de formatarNrDocPagamento e do tpDocumento em salic_insertion.cjs).
//  - O quadro no detalhe: aparece só nos status antes do envio, lista pendências, botão de simular
//    só para gestor/admin, resposta do dry-run vira texto de tela.
// Uso: node teste-previa-salic.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('./previa-salic.js');

let ok = 0;
function caso(nome, fn) { fn(); ok++; console.log('ok -', nome); }

// ---- regras (iguais às do robô) ----
const DOC = 'doc-39405';
const nota = (extra = {}) => ({ id: DOC, valor: 18000, valor_pago: null, ...extra });
const lanc = (extra = {}) => ({ extrato_id: 'e1', fitid: '93.001', valor: -16893, data_lancamento: '2026-09-30', document_id: DOC, ...extra });

caso('valor: usa valor_pago quando preenchido', () => {
    assert.deepStrictEqual(P.calcularValorEnvio(nota({ valor_pago: 17500 }), [lanc()], []), { valor: 17500, origem: 'valor_pago' });
});
caso('valor: valor_pago vale mesmo com lançamento dividido', () => {
    assert.deepStrictEqual(P.calcularValorEnvio(nota({ valor_pago: 9000 }), [lanc()], [lanc(), lanc({ document_id: 'outra' })]), { valor: 9000, origem: 'valor_pago' });
});
caso('valor: lançamento exclusivo usa |valor| (NF 39405 -> 16.893,00)', () => {
    assert.deepStrictEqual(P.calcularValorEnvio(nota(), [lanc()], [lanc()]), { valor: 16893, origem: 'lancamento' });
});
caso('valor: lançamento dividido entre 2 notas é pendência', () => {
    assert.strictEqual(P.calcularValorEnvio(nota(), [lanc()], [lanc(), lanc({ document_id: 'outra' })]).erro, 'LANCAMENTO_DIVIDIDO');
});
caso('valor: linhas duplicadas do mesmo lançamento contam uma vez', () => {
    assert.deepStrictEqual(P.calcularValorEnvio(nota(), [lanc(), lanc()], [lanc(), lanc()]), { valor: 16893, origem: 'lancamento' });
    assert.deepStrictEqual(P.calcularValorEnvio(nota(), [lanc(), lanc({ extrato_id: 'e2' })], [lanc()]), { valor: 16893, origem: 'lancamento' });
});
caso('valor: maior que a nota é pendência', () => {
    assert.strictEqual(P.calcularValorEnvio(nota({ valor_pago: 18000.02 }), [lanc()], []).erro, 'VALOR_MAIOR_QUE_NOTA');
    assert.ok(!P.calcularValorEnvio(nota({ valor_pago: 18000.01 }), [], []).erro);
});
caso('valor: sem valor pago e sem lançamento é pendência', () => {
    assert.strictEqual(P.calcularValorEnvio(nota(), [], []).erro, 'VALOR_PAGO_INDETERMINADO');
    assert.strictEqual(P.calcularValorEnvio(nota(), [lanc(), lanc({ fitid: '93.002' })], []).erro, 'VALOR_PAGO_INDETERMINADO');
});
caso('data do pagamento: lançamento, depois a informada, senão pendência', () => {
    assert.deepStrictEqual(P.resolverDataPagamento(lanc(), { data_pagamento: '2026-01-01' }), { data: '2026-09-30', origem: 'lancamento' });
    assert.deepStrictEqual(P.resolverDataPagamento(null, { data_pagamento: '2026-01-01' }), { data: '2026-01-01', origem: 'informada' });
    assert.strictEqual(P.resolverDataPagamento(null, {}).erro, 'DATA_PAGAMENTO_SEM_LANCAMENTO');
});
caso('nº do documento de pagamento (casos do robô)', () => {
    assert.strictEqual(P.formatarNrDocPagamento('551.614.000.114.014'), '0000114014');
    assert.strictEqual(P.formatarNrDocPagamento('42.001'), '0000042001');
    assert.strictEqual(P.formatarNrDocPagamento('42.205'), '0000042205');
    assert.strictEqual(P.formatarNrDocPagamento(''), '');
});
caso('tipo de documento: guia, recibo ou nota fiscal', () => {
    assert.strictEqual(P.tipoDocumento({ json_extraido: { guia: { numero_guia: '123' } }, recibo: 'yes' }).codigo, '2');
    assert.strictEqual(P.tipoDocumento({ json_extraido: { guia: { numero_guia: '  ' } }, recibo: 'YES' }).codigo, '4');
    assert.strictEqual(P.tipoDocumento({ recibo: 'no' }).codigo, '3');
    assert.strictEqual(P.tipoDocumento({}).rotulo, 'Nota Fiscal/Fatura');
    assert.strictEqual(P.numeroComprovante({ json_extraido: { guia: { numero_guia: 'G-9' } }, numero_nf: '1' }), 'G-9');
    assert.strictEqual(P.numeroComprovante({}), 'S/N');
});

const docCompleto = (extra = {}) => ({
    id: DOC, name: 'nf.pdf', cnpj_emissor: '09137136000112', nome_emissor: 'Fornecedor', valor: 18000, valor_pago: null,
    data_emissao: '2026-09-01', numero_nf: '00003536', rubrica_id_fk: 'r1', fitid: '551.614.000.114.014', ...extra
});
const rubrica = { nome: 'Custos de Administração', produto: 'Administração do Projeto', etapa: '8 - Custos Vinculados' };

caso('montar: nota completa, sem pendências', () => {
    const r = P.montar({ doc: docCompleto(), rubrica, lancamentos: [lanc()], lancamentosMesmoFitid: [lanc()] });
    assert.deepStrictEqual(r.pendencias, []);
    const campo = (c) => r.campos.find(x => x.campo === c);
    assert.strictEqual(campo('rubrica').valor, 'Custos de Administração');
    assert.strictEqual(campo('produto').valor, 'Administração do Projeto');
    assert.strictEqual(campo('tipo').valor, 'Nota Fiscal/Fatura (código 3)');
    assert.strictEqual(campo('numero').valor, '00003536');
    assert.strictEqual(campo('valor').valor, 16893);
    assert.strictEqual(campo('data_pagamento').valor, '2026-09-30');
    assert.strictEqual(campo('nr_doc_pagamento').valor, '0000114014');
    assert.strictEqual(campo('forma_pagamento').valor, 'Transferência Bancária');
});
caso('montar: sem fitid usa o documento_referencia do extrato; sem nada, o número da nota', () => {
    const a = P.montar({ doc: docCompleto({ fitid: null }), rubrica, lancamentos: [lanc()], documentoReferenciaExtrato: '42.001' });
    assert.strictEqual(a.campos.find(x => x.campo === 'nr_doc_pagamento').valor, '0000042001');
    const b = P.montar({ doc: docCompleto({ fitid: null }), rubrica, lancamentos: [lanc()] });
    assert.strictEqual(b.campos.find(x => x.campo === 'nr_doc_pagamento').valor, '0000003536');
});
caso('montar: pendências de rubrica, dados e pagamento', () => {
    const r = P.montar({ doc: docCompleto({ rubrica_id_fk: null, cnpj_emissor: '', numero_nf: '' }), rubrica: null, lancamentos: [] });
    const codigos = r.pendencias.map(x => x.codigo);
    assert.ok(codigos.includes('RUBRICA_NAO_VINCULADA'));
    assert.ok(codigos.includes('DADOS_OBRIGATORIOS_FALTANDO'));
    assert.ok(codigos.includes('DATA_PAGAMENTO_SEM_LANCAMENTO'));
    assert.ok(codigos.includes('VALOR_PAGO_INDETERMINADO'));
    const r2 = P.montar({ doc: docCompleto(), rubrica: null, lancamentos: [lanc()] });
    assert.ok(r2.pendencias.some(x => x.codigo === 'RUBRICA_INEXISTENTE'));
});
caso('montar: justificativa só aparece quando existe', () => {
    assert.ok(!P.montar({ doc: docCompleto(), rubrica, lancamentos: [lanc()] }).campos.some(x => x.campo === 'justificativa'));
    assert.ok(P.montar({ doc: docCompleto({ justificativa_salic: 'excedeu' }), rubrica, lancamentos: [lanc()] }).campos.some(x => x.campo === 'justificativa'));
});

// ---- tela ----
const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio); assert.ok(i >= 0, inicio);
    const j = SRC.indexOf(fecho, i); assert.ok(j > i, inicio);
    return SRC.slice(i, j + fecho.length);
}
const CODIGO = [
    bloco('const STATUS_SEM_PREVIA_SALIC', ';\n'),
    bloco('function mostraPreviaSalic(', '\n}\n'),
    bloco('function valorCampoPreviaHtml(', '\n}\n'),
    bloco('function resultadoSimulacaoSalicHtml(', '\n}\n'),
    bloco('function previaSalicHtml(', '\n}\n'),
    bloco('function textoResultadoSimulacao(', '\n}\n'),
    bloco('function urlDryRunSalic(', '\n}\n'),
].join('\n');

function montarTela({ role = 'gestor', previaSalic = null, url = 'https://worker.exemplo/api/salic/inserir' } = {}) {
    const ctx = {
        PreviaSalic: P,
        ErrosRpa: require('./erros-rpa.js'),
        MSG_SESSAO_EXPIRADA: 'Sua sessão expirou. Entre de novo para continuar.',
        CONFIG: { SALIC_API_URL: url },
        window: { location: { origin: 'https://prestai.exemplo' } },
        state: { previaSalic },
        userIsGestorOrAbove: () => ['admin', 'gestor'].includes(role),
        escAttr: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
        _laudoFmtDate: (d) => d.split('-').reverse().join('/'),
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + '\nthis.STATUS_SEM_PREVIA_SALIC = STATUS_SEM_PREVIA_SALIC;', ctx);
    return ctx;
}

caso('quadro só antes do envio, só para nota fiscal ativa', () => {
    const t = montarTela();
    assert.ok(t.mostraPreviaSalic({ status: 'liberado_rpa_airtop' }));
    assert.ok(t.mostraPreviaSalic({ status: 'erro_rpa' }));
    assert.ok(t.mostraPreviaSalic({ status: 'aguardando_d3', tipo_documento: 'nf' }));
    assert.ok(!t.mostraPreviaSalic({ status: 'enviado_salic' }));
    assert.ok(!t.mostraPreviaSalic({ status: 'erro_rpa', excluido_em: '2026-01-01' }));
    assert.ok(!t.mostraPreviaSalic({ status: 'erro_rpa', tipo_documento: 'comprovante' }));
});

caso('fechado: botão para abrir', () => {
    const html = montarTela().previaSalicHtml({ id: 'd1', status: 'erro_rpa', updated_at: 't1' });
    assert.ok(html.includes('abrirPreviaSalic(\'d1\')'));
});

caso('aberto: campos, pendências e simulação só para gestor', () => {
    const previa = P.montar({ doc: docCompleto({ rubrica_id_fk: null }), rubrica: null, lancamentos: [lanc()] });
    const estado = { docId: 'd1', updatedAt: 't1', aberto: true, carregando: false, previa, simulacao: null };
    const doc = { id: 'd1', status: 'erro_rpa', updated_at: 't1' };
    const gestor = montarTela({ previaSalic: estado }).previaSalicHtml(doc);
    assert.ok(gestor.includes('o robô não consegue enviar'));
    assert.ok(gestor.includes('não está ligada a uma rubrica'));
    assert.ok(gestor.includes('R$ 16.893,00'));
    assert.ok(gestor.includes('simularEnvioSalic'));
    const analista = montarTela({ role: 'analista', previaSalic: estado }).previaSalicHtml(doc);
    assert.ok(!analista.includes('simularEnvioSalic'));
});

caso('nota alterada depois de abrir: a prévia volta a ficar fechada', () => {
    const estado = { docId: 'd1', updatedAt: 't1', aberto: true, carregando: false, previa: { campos: [], pendencias: [] } };
    const html = montarTela({ previaSalic: estado }).previaSalicHtml({ id: 'd1', status: 'erro_rpa', updated_at: 't2' });
    assert.ok(html.includes('Ver o que será gravado'));
});

caso('resposta da simulação vira texto de tela', () => {
    const t = montarTela();
    assert.ok(t.textoResultadoSimulacao(200, { success: true, dryRun: true, rubricaCasada: 'X' }).resultado);
    assert.ok(t.textoResultadoSimulacao(429, { status: 'limite', tentarEm: 600 }).erro.includes('10 min'));
    assert.ok(t.textoResultadoSimulacao(429, { status: 'ocupado' }).erro.includes('ocupado'));
    const rubrica = t.textoResultadoSimulacao(500, { error: '[RUBRICA_NAO_ENCONTRADA_SALIC] Rubrica nao encontrada. Candidatas: A; B' }).erro;
    assert.ok(rubrica.includes('Candidatas: A; B'));
    assert.ok(t.textoResultadoSimulacao(500, null).erro.length > 0);
    const html = t.resultadoSimulacaoSalicHtml({ resultado: { rubricaCasada: 'Custos', auditoria: { '#vlComprovado': '16.893,00' } } });
    assert.ok(html.includes('Nada foi salvo') && html.includes('#vlComprovado'));
});

caso('URL da simulação derivada do envio', () => {
    assert.strictEqual(montarTela().urlDryRunSalic(), 'https://worker.exemplo/api/salic/dry-run');
    assert.strictEqual(montarTela({ url: '/api/salic/inserir' }).urlDryRunSalic(), 'https://prestai.exemplo/api/salic/dry-run');
    assert.strictEqual(montarTela({ url: '' }).urlDryRunSalic(), null);
});

console.log(`\n${ok} casos ok`);
