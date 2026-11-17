// Testes do #200 e do #201 na fila de Documentos em Lote.
//  #200: a rubrica escolhida numa linha não some quando outra linha é excluída/processada (render
//        remonta a tabela a partir do banco, que ainda não tem a rubrica).
//  #201: depois de escolher, o campo começa pela rubrica numerada (não pelo produto) e o texto
//        continua sendo resolvido para a rubrica certa.
// Funções recortadas do app.js de verdade. Uso: node teste-lote-rubricas.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio);
    assert.ok(i >= 0, 'nao encontrado no app.js: ' + inicio);
    const j = SRC.indexOf(fecho, i);
    assert.ok(j > i, 'fim nao encontrado para: ' + inicio);
    return SRC.slice(i, j + fecho.length);
}
const F = '\n}\n';
const CODIGO = [
    bloco('function parseValorBR(', F),
    bloco('function partesRotuloRubrica(', F),
    bloco('function rotuloRubricaSemValor(', F),
    bloco('function rotuloRubricaCampo(', F),
    bloco('function rotuloRubrica(', F),
    bloco('function resolverRubricaPorRotulo(', F),
    bloco('function lembrarRubricaDigitadaLote(', F),
    bloco('const STATUS_LOTE_PROCESSANDO', ';\n'),
    bloco('async function fetchUploadLoteQueue(', F),
    bloco('const UploadLoteView = () => {', '\n};\n')
].join('\n');

const RUBRICAS = [
    { id: 'r1', rubrica_id: 65, nome: 'Assistente de Produção', produto: 'CURSO/OFICINA/CAPACITAÇÃO - ARTES CÊNICAS', valor_aprovado: '3000' },
    { id: 'r2', rubrica_id: 9, nome: 'Assistente de Produção', produto: 'FESTIVAL, BIENAL, FESTA OU FEIRA', valor_aprovado: '80000' },
    { id: 'r3', rubrica_id: 10, nome: 'Cenografia', produto: '', valor_aprovado: null }
];

function montar(filaInicial) {
    let banco = filaInicial.map(d => ({ ...d }));
    const ctx = {
        console: { log() { }, error() { }, warn() { } },
        state: {
            user: { id: 'u1' }, filters: { project: 'p1' }, projects: [{ id: 'p1', pronac: '1', nome: 'P' }],
            rubricas_disponiveis: RUBRICAS, uploadLoteQueue: [], uploadLoteProgresso: { ativo: false }, uploadLoteFalhas: {},
            uploadLoteProcessandoFora: {}, uploadArquivosProgresso: null, loteExtratoVinculado: null, loading: false
        },
        estaTravado: () => false,
        supabaseClient: {
            from: () => {
                const api = { select: () => api, eq: () => api, in: () => api, is: () => api, order: () => api,
                    then: (res, rej) => Promise.resolve({ data: banco.map(d => ({ ...d })), error: null }).then(res, rej) };
                return api;
            }
        },
        Sidebar: () => '', planilhaOrcamentariaBtn: () => '', renderSaldoBadgeHtml: () => '', avisoExtratosPausadosHtml: () => '',
        escAttr: (x) => String(x == null ? '' : x).replace(/"/g, '&quot;'),
        estadoLinhaLote: () => null, linhaLoteTravada: () => false, seloLoteHtml: () => '', segundosLoteAtual: () => 0,
        segmentosLoteHtml: () => '', conteudoUploadArquivosHtml: () => ''
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + '\n;Object.assign(this, { UploadLoteView, fetchUploadLoteQueue, lembrarRubricaDigitadaLote, resolverRubricaPorRotulo, rotuloRubricaCampo, rotuloRubrica });', ctx);
    return { ctx, tirarDoBanco: (id) => { banco = banco.filter(d => d.id !== id); } };
}
const valorDoCampo = (html, id) => {
    const m = new RegExp(`id="lote-rubrica-${id}"[^>]*value="([^"]*)"`).exec(html);
    return m ? m[1].replace(/&quot;/g, '"') : null;
};
const doc = (id) => ({ id, name: id + '.pdf', size: '1 MB', file_path: 'x/' + id, project_id: 'p1', status: 'aguardando_rubrica', rubrica: null, rubrica_id_fk: null });

const casos = [];
const caso = (n, f) => casos.push({ n, f });

caso('#201: o campo comeca pela rubrica numerada e termina com produto e valor', () => {
    const { ctx } = montar([]);
    const t = ctx.rotuloRubricaCampo(RUBRICAS[0]);
    assert.ok(t.startsWith('65 - Assistente de Produção'), t);
    assert.ok(t.includes('CURSO/OFICINA'));
    assert.ok(t.includes('3.000,00'));
    assert.strictEqual(ctx.rotuloRubricaCampo(RUBRICAS[2]), '10 - Cenografia');
});

caso('#201: o texto do campo resolve para a rubrica certa, mesmo com nome repetido em outro produto', () => {
    const { ctx } = montar([]);
    for (const r of RUBRICAS) {
        assert.strictEqual(ctx.resolverRubricaPorRotulo(ctx.rotuloRubricaCampo(r), RUBRICAS).id, r.id);
        assert.strictEqual(ctx.resolverRubricaPorRotulo(ctx.rotuloRubrica(r), RUBRICAS).id, r.id, 'rotulo antigo continua valendo');
    }
    assert.strictEqual(ctx.resolverRubricaPorRotulo('Assistente de Produção', RUBRICAS), null, 'nome sozinho e ambiguo');
});

caso('#201: linha com rubrica ja gravada mostra o texto novo no campo', async () => {
    const { ctx } = montar([{ ...doc('a'), rubrica_id_fk: 'r2' }]);
    await ctx.fetchUploadLoteQueue();
    assert.ok(valorDoCampo(ctx.UploadLoteView(), 'a').startsWith('9 - Assistente de Produção'));
});

caso('#200: excluir uma linha mantem a rubrica escolhida nas outras', async () => {
    const { ctx, tirarDoBanco } = montar([doc('a'), doc('b'), doc('c')]);
    await ctx.fetchUploadLoteQueue();
    ctx.lembrarRubricaDigitadaLote({ id: 'lote-rubrica-a', value: ctx.rotuloRubricaCampo(RUBRICAS[0]) });
    ctx.lembrarRubricaDigitadaLote({ id: 'lote-rubrica-c', value: ctx.rotuloRubricaCampo(RUBRICAS[2]) });
    tirarDoBanco('b');
    await ctx.fetchUploadLoteQueue();
    const html = ctx.UploadLoteView();
    assert.strictEqual(valorDoCampo(html, 'a'), ctx.rotuloRubricaCampo(RUBRICAS[0]));
    assert.strictEqual(valorDoCampo(html, 'c'), '10 - Cenografia');
    assert.strictEqual(valorDoCampo(html, 'b'), null);
});

caso('#200: documento que sai da fila deixa de ter rubrica guardada', async () => {
    const { ctx, tirarDoBanco } = montar([doc('a'), doc('b')]);
    await ctx.fetchUploadLoteQueue();
    ctx.lembrarRubricaDigitadaLote({ id: 'lote-rubrica-a', value: 'x' });
    ctx.lembrarRubricaDigitadaLote({ id: 'lote-rubrica-b', value: 'y' });
    tirarDoBanco('a');
    await ctx.fetchUploadLoteQueue();
    assert.deepStrictEqual(Object.keys(ctx.state.loteRubricasDigitadas), ['b']);
});

caso('#200: campo apagado pelo usuario continua vazio depois do render', async () => {
    const { ctx } = montar([{ ...doc('a'), rubrica_id_fk: 'r1' }]);
    await ctx.fetchUploadLoteQueue();
    ctx.lembrarRubricaDigitadaLote({ id: 'lote-rubrica-a', value: '' });
    assert.strictEqual(valorDoCampo(ctx.UploadLoteView(), 'a'), '');
});

caso('outros campos de rubrica (fora do lote) nao sao guardados', () => {
    const { ctx } = montar([]);
    ctx.lembrarRubricaDigitadaLote({ id: 'rubrica-input', value: 'x' });
    ctx.lembrarRubricaDigitadaLote({ id: 'vincular-rubrica-input', value: 'x' });
    assert.ok(!ctx.state.loteRubricasDigitadas || Object.keys(ctx.state.loteRubricasDigitadas).length === 0);
});

caso('#194: a tela diz quando pode sair', async () => {
    const { ctx } = montar([doc('a')]);
    await ctx.fetchUploadLoteQueue();
    let html = ctx.UploadLoteView();
    assert.ok(html.includes('Quando posso sair desta tela?'));
    ctx.state.loteEnvioConcluido = { qtd: 3 };
    html = ctx.UploadLoteView();
    assert.ok(html.includes('3 documento(s) enviados para processamento. Você já pode sair desta tela.'));
    ctx.state.uploadLoteProgresso = { ativo: true, ids: ['a'], enviados: [], total: 1, atual: 'a' };
    html = ctx.UploadLoteView();
    assert.ok(!html.includes('Você já pode sair desta tela.'), 'durante o envio nao diz que pode sair');
    assert.ok(html.includes('Não feche esta aba até o último documento ser enviado.'));
});

(async () => {
    let ok = 0, falhas = 0;
    for (const c of casos) {
        try { await c.f(); ok++; } catch (e) { falhas++; console.log('FALHOU: ' + c.n + '\n   ' + e.message); }
    }
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
