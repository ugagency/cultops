// Teste do #193: valor bruto e líquido lidos pelo OCR, lado a lado no detalhe da nota.
//  - Identifica se o `valor` gravado é o bruto, o líquido ou nenhum dos dois.
//  - Nota sem retenção mostra só a linha "bruto e líquido iguais".
//  - Sem os dois valores no json_extraido, não mostra nada.
//  - Atalhos "Usar bruto" / "Usar líquido" preenchem o campo de edição.
// Funções recortadas do app.js. Uso: node teste-bruto-liquido.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio); assert.ok(i >= 0, inicio);
    const j = SRC.indexOf(fecho, i); assert.ok(j > i, inicio);
    return SRC.slice(i, j + fecho.length);
}
const CODIGO = [
    bloco('function parseValorBR(', '\n}\n'),
    bloco('function valoresBrutoLiquido(', '\n}\n'),
    bloco('function fmtReaisBL(', '\n}\n'),
    bloco('function blocoBrutoLiquidoHtml(', '\n}\n'),
    bloco('function atalhosBrutoLiquidoHtml(', '\n}\n'),
    bloco('window.usarValorNotaNaEdicao = function', '\n};\n'),
].join('\n');

const input = { value: '', eventos: 0, dispatchEvent() { this.eventos++; } };
const ctx = {
    window: {},
    Event: function (tipo) { this.type = tipo; },
    document: { getElementById: (id) => (id === 'edit-valor' ? input : null) },
};
vm.createContext(ctx);
vm.runInContext(CODIGO, ctx);

const nf = (bruto, liquido, retencoes) => ({ json_extraido: { nota_fiscal: { valor_bruto: bruto, valor_liquido: liquido, retencoes_total: retencoes } } });
let ok = 0;
function caso(nome, fn) { fn(); ok++; console.log('ok -', nome); }

caso('valor gravado igual ao líquido', () => {
    const v = ctx.valoresBrutoLiquido({ ...nf(2625, 2532.08, 92.92), valor: '2532.08' });
    assert.strictEqual(v.usado, 'liquido');
    assert.strictEqual(v.retencoes, 92.92);
    const html = ctx.blocoBrutoLiquidoHtml({ ...nf(2625, 2532.08, 92.92), valor: '2532.08' });
    assert.ok(html.includes('valor líquido'));
    assert.ok(html.includes('R$ 2.625,00') && html.includes('R$ 2.532,08') && html.includes('R$ 92,92'));
});

caso('valor gravado igual ao bruto', () => {
    const v = ctx.valoresBrutoLiquido({ ...nf(2625, 2532.08, 92.92), valor: 2625 });
    assert.strictEqual(v.usado, 'bruto');
    assert.ok(ctx.blocoBrutoLiquidoHtml({ ...nf(2625, 2532.08, 92.92), valor: 2625 }).includes('valor bruto'));
});

caso('valor que não bate com nenhum dos dois pede conferência', () => {
    const html = ctx.blocoBrutoLiquidoHtml({ ...nf(2625, 2532.08, 92.92), valor: 2600 });
    assert.ok(html.includes('não bate'));
});

caso('retenções calculadas quando o OCR não traz o total', () => {
    const v = ctx.valoresBrutoLiquido({ ...nf(1000, 850, null), valor: 850 });
    assert.strictEqual(v.retencoes, 150);
});

caso('sem retenção: uma linha só', () => {
    const html = ctx.blocoBrutoLiquidoHtml({ ...nf(500, 500, 0), valor: 500 });
    assert.ok(html.includes('Sem retenções'));
    assert.strictEqual(ctx.atalhosBrutoLiquidoHtml({ ...nf(500, 500, 0), valor: 500 }), '');
});

caso('sem bruto ou líquido no OCR: nada aparece', () => {
    assert.strictEqual(ctx.blocoBrutoLiquidoHtml({ json_extraido: { nota_fiscal: { valor_bruto: 100 } }, valor: 100 }), '');
    assert.strictEqual(ctx.blocoBrutoLiquidoHtml({ json_extraido: null, valor: 100 }), '');
    assert.strictEqual(ctx.blocoBrutoLiquidoHtml({ valor: 100 }), '');
});

caso('atalhos preenchem o campo de edição', () => {
    const html = ctx.atalhosBrutoLiquidoHtml({ ...nf(2625, 2532.08, 92.92), valor: 2625 });
    assert.ok(html.includes('usarValorNotaNaEdicao(2625.00)') && html.includes('usarValorNotaNaEdicao(2532.08)'));
    ctx.window.usarValorNotaNaEdicao(2532.08);
    assert.strictEqual(input.value, '2532.08');
    assert.strictEqual(input.eventos, 1);
});

console.log(`\n${ok} casos ok`);
