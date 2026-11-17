// Teste do #198 e do #195 na aba Documentos do painel de suporte (suporte.html).
//  #198: documento excluído (excluido_em) fica fora da lista e das contagens por padrão; o chip
//        "Excluídos (n)" mostra só eles, com coluna Ativo = Não e status "Excluído".
//  #195: comprovante de pagamento (tipo_documento = 'comprovante') diz de qual nota fiscal ele é.
// Recorta o trecho inline do suporte.html e roda com DOM falso. Uso: node teste-suporte-documentos.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'suporte.html'), 'utf8').replace(/\r\n/g, '\n');
const i = html.indexOf('        const DOC_TIPO_LABELS = {');
const j = html.indexOf('        async function abrirFicha(id) {');
assert.ok(i > 0 && j > i, 'trecho da aba Documentos não encontrado no suporte.html');
const TRECHO = html.slice(i, j);

const ID = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function montar(documentos) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { innerHTML: '' });
    const ctx = {
        console,
        document: { getElementById: el },
        window: {},
        esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        fmtMoney: (v) => 'R$ ' + v,
        fmtDate: (v) => String(v).slice(0, 10),
        paginar: (a) => a,
        renderControlesPaginacao: () => { },
        htmlStatus: (_e, s) => `[status:${s}]`,
        StatusCatalogo: { obter: (_e, s) => ({ rotulo: 'Rótulo ' + s }) },
        authFetch: async () => ({ documentos })
    };
    vm.createContext(ctx);
    vm.runInContext('let documentosData = []; let documentosPagina = 1;\n' + TRECHO +
        '\n;Object.assign(this, { fetchDocumentos, alternarDocumentosExcluidos, filtrarDocumentosPorStatus, get dados() { return documentosData; } });', ctx);
    return { ctx, els };
}

const DOCS = [
    { id: ID(1), name: 'nota1.pdf', tipo_documento: 'nf', status: 'aguardando_d3', valor: 100 },
    { id: ID(2), name: 'comp1.pdf', tipo_documento: 'comprovante', nf_vinculada_id: ID(1), status: 'concluido', valor: 100 },
    { id: ID(3), name: 'excluida.pdf', tipo_documento: 'nf', status: 'processing_ocr', excluido_em: '2026-11-10T12:00:00Z', valor: 50 },
    { id: ID(4), name: 'comp-solto.pdf', tipo_documento: 'comprovante', nf_vinculada_id: null, status: 'concluido', valor: 10 }
];

const casos = [];
const caso = (n, f) => casos.push({ n, f });

caso('#198: por padrão a lista e as contagens não incluem o excluído', async () => {
    const { ctx, els } = montar(DOCS);
    await ctx.fetchDocumentos('p');
    const tabela = els['documentos-tabela-wrap'].innerHTML;
    assert.ok(!tabela.includes('excluida.pdf'));
    assert.ok(tabela.includes('nota1.pdf'));
    const resumo = els['documentos-resumo-status'].innerHTML;
    assert.ok(resumo.includes('Todos (3)'), resumo);
    assert.ok(!resumo.includes('Rótulo processing_ocr'), 'o status do excluído não entra nas contagens');
    assert.ok(resumo.includes('Excluídos (1)'));
    assert.ok(tabela.includes('<th>Ativo</th>'));
});

caso('#198: o chip Excluídos mostra só os excluídos, com Ativo = Não e status Excluído', async () => {
    const { ctx, els } = montar(DOCS);
    await ctx.fetchDocumentos('p');
    ctx.alternarDocumentosExcluidos();
    const tabela = els['documentos-tabela-wrap'].innerHTML;
    assert.ok(tabela.includes('excluida.pdf'));
    assert.ok(!tabela.includes('nota1.pdf'));
    assert.ok(tabela.includes('excluído em 2026-11-10'));
    assert.ok(tabela.includes('<strong>Excluído</strong>'));
    assert.ok(tabela.includes('Antes da exclusão: Rótulo processing_ocr'));
    assert.ok(!tabela.includes('[status:processing_ocr]'), 'não mostra o status como se estivesse processando');
    assert.ok(els['documentos-resumo-status'].innerHTML.includes('Voltar aos ativos'));
    ctx.alternarDocumentosExcluidos();
    assert.ok(els['documentos-tabela-wrap'].innerHTML.includes('nota1.pdf'));
});

caso('#195: comprovante diz de qual nota fiscal é, com link para a ficha da nota', async () => {
    const { ctx, els } = montar(DOCS);
    await ctx.fetchDocumentos('p');
    const tabela = els['documentos-tabela-wrap'].innerHTML;
    assert.ok(tabela.includes('Comprovante de pagamento'));
    assert.ok(tabela.includes(`abrirFicha('${ID(1)}')`));
    assert.ok(tabela.includes('da NF <a'));
    assert.ok(tabela.includes('sem nota fiscal vinculada'), 'comprovante sem nota mãe é sinalizado');
    assert.ok(tabela.includes('Nota fiscal'), 'nota fiscal continua como Nota fiscal');
});

caso('nome de arquivo não vira HTML', async () => {
    const { ctx, els } = montar([
        { id: ID(1), name: '<img src=x>.pdf', tipo_documento: 'nf', status: 'concluido' },
        { id: ID(2), name: 'c.pdf', tipo_documento: 'comprovante', nf_vinculada_id: ID(1), status: 'concluido' }
    ]);
    await ctx.fetchDocumentos('p');
    assert.ok(!els['documentos-tabela-wrap'].innerHTML.includes('<img'));
});

(async () => {
    let ok = 0, falhas = 0;
    for (const c of casos) {
        try { await c.f(); ok++; } catch (e) { falhas++; console.log('FALHOU: ' + c.n + '\n   ' + e.message); }
    }
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
