// Testes unitários da leitura do just_erro do robô SALIC (erros-rpa.js).
// Sem banco, sem rede e sem DOM.
// Uso: node teste-erros-rpa.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const E = require('./erros-rpa.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const CODIGOS = [
    'RUBRICA_NAO_VINCULADA', 'RUBRICA_INEXISTENTE', 'RUBRICA_NAO_ENCONTRADA_SALIC', 'RUBRICA_TELA_DIVERGENTE',
    'VALOR_PAGO_INDETERMINADO', 'LANCAMENTO_DIVIDIDO', 'VALOR_MAIOR_QUE_NOTA', 'DATA_PAGAMENTO_SEM_LANCAMENTO',
    'DADOS_OBRIGATORIOS_FALTANDO', 'CREDENCIAL_SALIC_AUSENTE', 'ARQUIVO_NF_INDISPONIVEL',
    'FORNECEDOR_NAO_ENCONTRADO_SALIC', 'LOGIN_SALIC_RECUSADO', 'TEMPO_ESGOTADO_SALVAMENTO', 'ERRO_RPA_GENERICO'
];

teste('o mapa tem exatamente os 15 códigos combinados, completos', () => {
    assert.deepStrictEqual(Object.keys(E.MAPA).sort(), [...CODIGOS].sort());
    for (const c of CODIGOS) {
        const i = E.MAPA[c];
        assert.ok(i.titulo && i.explicacao && i.acao && i.acao.orientacao, c + ' sem texto');
        assert.strictEqual(typeof i.permiteReenviar, 'boolean', c);
        if (i.acao.tipo) assert.ok(i.acao.rotulo, c + ' com tipo de ação e sem rótulo do botão');
    }
});

teste('cada código com prefixo é reconhecido', () => {
    for (const c of CODIGOS) {
        const e = E.interpretar('[' + c + '] algum detalhe');
        assert.strictEqual(e.codigo, c);
        assert.strictEqual(e.conhecido, true);
        assert.strictEqual(e.detalhe, 'algum detalhe');
    }
});

teste('reenvio: só onde adianta reenviar', () => {
    const sim = ['VALOR_PAGO_INDETERMINADO', 'LANCAMENTO_DIVIDIDO', 'DATA_PAGAMENTO_SEM_LANCAMENTO', 'VALOR_MAIOR_QUE_NOTA', 'DADOS_OBRIGATORIOS_FALTANDO',
        'CREDENCIAL_SALIC_AUSENTE', 'FORNECEDOR_NAO_ENCONTRADO_SALIC', 'TEMPO_ESGOTADO_SALVAMENTO', 'ERRO_RPA_GENERICO'];
    for (const c of CODIGOS) assert.strictEqual(E.permiteReenviar('[' + c + '] x'), sim.includes(c), c);
});

teste('lote: igual ao reenvio, exceto o erro que exige conferir no SALIC antes', () => {
    for (const c of CODIGOS) {
        const esperado = E.permiteReenviar('[' + c + '] x') && c !== 'TEMPO_ESGOTADO_SALVAMENTO';
        assert.strictEqual(E.permiteReenviarEmLote('[' + c + '] x'), esperado, c);
    }
    assert.strictEqual(E.permiteReenviarEmLote('sem prefixo'), false);
});

teste('sem prefixo, vazio, nulo ou código desconhecido: texto cru e sem reenvio', () => {
    for (const t of ['Timeout navegando', '', null, undefined, '[CODIGO_NOVO] algo', '[OUTRO] x']) {
        const e = E.interpretar(t);
        assert.strictEqual(e.conhecido, false, String(t));
        assert.strictEqual(e.codigo, null, String(t));
        assert.strictEqual(E.permiteReenviar(t), false, String(t));
        assert.strictEqual(e.bruto, t == null ? '' : String(t));
    }
});

teste('[OVERRIDE] e [AUTO] não são código de erro', () => {
    for (const t of ['[OVERRIDE] Gestor forçou avanço manualmente', '[AUTO] OCR excedeu 5 minutos']) {
        const e = E.interpretar(t);
        assert.strictEqual(e.codigo, null);
        assert.strictEqual(e.conhecido, false);
        assert.strictEqual(E.permiteReenviar(t), false);
        assert.strictEqual(E.pedeInformarPagamento(t), false);
        assert.strictEqual(E.permiteCorrigirRubrica(t), false);
    }
});

teste('código só vale no início do texto', () => {
    assert.strictEqual(E.interpretar('falha: [ERRO_RPA_GENERICO] x').conhecido, false);
});

teste('código em minúsculas é reconhecido; espaços antes do prefixo são ignorados', () => {
    assert.strictEqual(E.interpretar('  [erro_rpa_generico] x').codigo, 'ERRO_RPA_GENERICO');
});

teste('formulário de pagamento só para os 4 códigos de pagamento', () => {
    const quatro = ['VALOR_PAGO_INDETERMINADO', 'LANCAMENTO_DIVIDIDO', 'DATA_PAGAMENTO_SEM_LANCAMENTO', 'VALOR_MAIOR_QUE_NOTA'];
    for (const c of CODIGOS) assert.strictEqual(E.pedeInformarPagamento('[' + c + '] x'), quatro.includes(c), c);
    assert.strictEqual(E.pedeInformarPagamento('sem prefixo'), false);
});

teste('campo de vínculo de rubrica só para RUBRICA_NAO_VINCULADA e RUBRICA_INEXISTENTE', () => {
    const dois = ['RUBRICA_NAO_VINCULADA', 'RUBRICA_INEXISTENTE'];
    for (const c of CODIGOS) assert.strictEqual(E.permiteCorrigirRubrica('[' + c + '] x'), dois.includes(c), c);
});

teste('DATA_PAGAMENTO_SEM_LANCAMENTO: título e explicação combinados', () => {
    const i = E.MAPA.DATA_PAGAMENTO_SEM_LANCAMENTO;
    assert.strictEqual(i.titulo, 'Data do pagamento não encontrada');
    assert.strictEqual(i.explicacao, 'O robô não encontrou o lançamento do extrato conciliado com esta nota, e a nota também não tem data de pagamento informada.');
});

teste('VALOR_MAIOR_QUE_NOTA: informar pagamento, orientação combinada e reenvio liberado', () => {
    const i = E.MAPA.VALOR_MAIOR_QUE_NOTA;
    assert.strictEqual(i.acao.tipo, 'informar_pagamento');
    assert.strictEqual(i.acao.orientacao, 'Se o valor pago foi digitado errado, corrija no formulário desta tela. Se o lançamento do extrato é de outro pagamento, revise a conciliação. Depois use Tentar Novamente.');
    assert.strictEqual(i.permiteReenviar, true);
    assert.ok(E.CODIGOS_INFORMAR_PAGAMENTO.includes('VALOR_MAIOR_QUE_NOTA'));
});

teste('RUBRICA_NAO_ENCONTRADA_SALIC e RUBRICA_TELA_DIVERGENTE: só informar, sem ação de tela', () => {
    for (const c of ['RUBRICA_NAO_ENCONTRADA_SALIC', 'RUBRICA_TELA_DIVERGENTE']) {
        assert.strictEqual(E.MAPA[c].acao.tipo, null);
        assert.ok(/suporte/i.test(E.MAPA[c].acao.orientacao));
        assert.strictEqual(E.MAPA[c].permiteReenviar, false);
    }
});

teste('TEMPO_ESGOTADO_SALVAMENTO manda conferir no SALIC antes de reenviar', () => {
    const i = E.MAPA.TEMPO_ESGOTADO_SALVAMENTO;
    assert.ok(/SALIC/.test(i.acao.orientacao) && /antes de reenviar/i.test(i.acao.orientacao));
    assert.ok(i.confirmarAntesDeReenviar);
    assert.strictEqual(E.MAPA.ERRO_RPA_GENERICO.confirmarAntesDeReenviar, undefined);
});

const BASE = '[RUBRICA_NAO_ENCONTRADA_SALIC] Rubrica nao encontrada na tela do SALIC (R$ 1.200,00): ';

teste('candidatas: nome e valor repetidos, com lista e (+N)', () => {
    const e = E.interpretar(BASE + '2 linhas com o mesmo nome e o mesmo valor aprovado na pagina. Candidatas: Cachê artístico (aprovado 240000.00 | produto: Show); Cachê artístico (aprovado 240000.00 | produto: Oficina) (+3)');
    assert.strictEqual(e.candidatas.motivo, 'nome_e_valor_repetidos');
    assert.deepStrictEqual(e.candidatas.itens, [
        'Cachê artístico (aprovado 240000.00 | produto: Show)',
        'Cachê artístico (aprovado 240000.00 | produto: Oficina)'
    ]);
    assert.strictEqual(e.candidatas.restantes, 3);
});

teste('candidatas: valor aprovado diferente', () => {
    const e = E.interpretar(BASE + 'nome encontrado, mas nenhuma linha com valor aprovado 1500.00. Candidatas: Divulgação (aprovado 900.00)');
    assert.strictEqual(e.candidatas.motivo, 'valor_aprovado_diferente');
    assert.deepStrictEqual(e.candidatas.itens, ['Divulgação (aprovado 900.00)']);
    assert.strictEqual(e.candidatas.restantes, 0);
});

teste('candidatas: sem valor aprovado para conferir', () => {
    const e = E.interpretar(BASE + 'nome encontrado, mas sem valor aprovado da rubrica para conferir. Candidatas: Divulgação (aprovado 900.00); Outra');
    assert.strictEqual(e.candidatas.motivo, 'sem_valor_para_conferir');
    assert.strictEqual(e.candidatas.itens.length, 2);
});

teste('candidatas: "nenhuma linha com o nome exato" não mostra lista', () => {
    const e = E.interpretar(BASE + 'nenhuma linha com o nome exato. Candidatas: Linha 1; Linha 2; Linha 3');
    assert.strictEqual(e.candidatas.motivo, 'nome_exato_ausente');
    assert.deepStrictEqual(e.candidatas.itens, []);
});

teste('candidatas: motivo com acento ou maiúsculas é reconhecido', () => {
    const e = E.interpretar(BASE + '2 linhas com o mesmo nome e o mesmo valor aprovado na página. Candidatas: A (aprovado 1.00)');
    assert.strictEqual(e.candidatas.motivo, 'nome_e_valor_repetidos');
});

teste('candidatas: no máximo 20 itens e motivo desconhecido não mostra lista', () => {
    const muitos = Array.from({ length: 25 }, (_, i) => 'R' + i + ' (aprovado 1.00)').join('; ');
    const e = E.interpretar(BASE + 'nome encontrado, mas sem valor aprovado da rubrica para conferir. Candidatas: ' + muitos);
    assert.strictEqual(e.candidatas.itens.length, 20);
    const d = E.interpretar(BASE + 'motivo que ninguém previu. Candidatas: A; B');
    assert.strictEqual(d.candidatas.motivo, null);
    assert.deepStrictEqual(d.candidatas.itens, []);
});

teste('candidatas: sem o trecho "Candidatas:" a lista é vazia; outros códigos não têm candidatas', () => {
    const e = E.interpretar(BASE + '2 linhas com o mesmo nome e o mesmo valor aprovado na pagina.');
    assert.deepStrictEqual(e.candidatas.itens, []);
    assert.strictEqual(E.interpretar('[LANCAMENTO_DIVIDIDO] x').candidatas, null);
});

teste('envio 404: aviso de documento não encontrado ou de outra organização', () => {
    const a = E.avisoEnvio(404, { error: 'qualquer' });
    assert.strictEqual(a.tipo, 'warning');
    assert.ok(/não encontrado ou de outra organização/.test(a.mensagem));
});

teste('envio 500: aviso, com o motivo quando o corpo traz código conhecido', () => {
    const a = E.avisoEnvio(500, { error: '[LOGIN_SALIC_RECUSADO] x' });
    assert.strictEqual(a.tipo, 'warning');
    assert.strictEqual(a.mensagem, 'O envio não foi concluído. Motivo: O SALIC recusou o login. Abra os detalhes da nota para ver o que foi registrado antes de tentar de novo.');
    const b = E.avisoEnvio(500, null);
    assert.strictEqual(b.tipo, 'warning');
    assert.strictEqual(b.mensagem, 'O envio não foi concluído. Abra os detalhes da nota para ver o que foi registrado antes de tentar de novo.');
    assert.ok(!/servidor do robô/.test(a.mensagem + b.mensagem));
});

teste('envio 429 e demais status não ganham tratamento novo', () => {
    for (const s of [400, 401, 403, 429, 502, 503]) assert.strictEqual(E.avisoEnvio(s, {}), null, String(s));
});

// Quadro de erro da tela de detalhes (mora no app.js): extraído do código-fonte para testar o
// HTML gerado. Texto de just_erro e candidatas é dado de fora: nenhuma marcação pode sobrar.
function carregarQuadroDoApp() {
    const src = fs.readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
    const recorta = (ini, fim) => {
        const i = src.indexOf(ini);
        const j = src.indexOf(fim, i);
        assert.ok(i >= 0 && j > i, 'trecho não encontrado no app.js: ' + ini);
        return src.slice(i, j);
    };
    const codigo = recorta('function escHtml(', '// "PRODUTO') + recorta('function blocoErroRpaHtml(', '// Botão de ação do quadro de erro');
    const ctx = { window: { ErrosRpa: E } };
    vm.createContext(ctx);
    vm.runInContext(codigo + ';this.escHtml = escHtml; this.quadro = blocoErroRpaHtml;', ctx);
    return ctx;
}
const APP = carregarQuadroDoApp();
const CTX_QUADRO = { blocoJustificativaSalic: '', faltaDadoObrigatorioSalic: false, estiloBotaoEnvioBloqueado: '', atributosBotaoEnvioJustificativa: '' };
const so_tags_do_quadro = (html) => (html.match(/<[^>]*>?/g) || []).every(t => /^<\/?(div|p|ul|li|button|details|summary)[ >]/.test(t));

teste('escHtml escapa & < > " e apóstrofo', () => {
    assert.strictEqual(APP.escHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    assert.strictEqual(APP.escHtml(null), '');
});

teste('quadro: just_erro com <img onerror> não vira HTML (código desconhecido e conhecido)', () => {
    const ataque = '<img src=x onerror=alert(1)>';
    for (const t of [ataque, '[ERRO_RPA_GENERICO] ' + ataque, '[CODIGO_NOVO] ' + ataque, "a'b \"c\" " + ataque]) {
        const h = APP.quadro({ id: 'd1', just_erro: t }, CTX_QUADRO);
        assert.ok(!h.includes('<img'), t);
        assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'), t);
        assert.ok(so_tags_do_quadro(h), 'sobrou marcação: ' + t);
    }
});

teste('quadro: candidata com <b>x</b> e apóstrofo não vira HTML', () => {
    const t = '[RUBRICA_NAO_ENCONTRADA_SALIC] Rubrica nao encontrada (R$ 1): 2 linhas com o mesmo nome e o mesmo valor aprovado na pagina. Candidatas: <b>x</b> (aprovado 1.00 | produto: D\'Arte); <script>alert(1)</script> (+2)';
    const h = APP.quadro({ id: 'd1', just_erro: t }, CTX_QUADRO);
    assert.ok(!h.includes('<b>') && !h.includes('<script'));
    assert.ok(h.includes('<li>&lt;b&gt;x&lt;/b&gt; (aprovado 1.00 | produto: D&#39;Arte)</li>'));
    assert.ok(so_tags_do_quadro(h));
});

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
