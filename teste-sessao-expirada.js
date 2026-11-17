// Teste do #197: "Token inválido" ao abrir Documentos > Excluídos. O token devolvido por
// getSession() pode estar vencido; fetchApiAutenticado renova a sessão e tenta de novo uma vez.
// Funções recortadas do app.js de verdade, com Supabase e fetch falsos.
// Uso: node teste-sessao-expirada.js
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
const CODIGO = [
    bloco('const MSG_SESSAO_EXPIRADA', ';\n'),
    bloco('async function fetchApiAutenticado(', '\n}\n'),
    bloco('async function fetchDocumentosExcluidos(', '\n}\n')
].join('\n');

// tokensValidos: tokens que o servidor aceita. sessao: token do getSession. renovado: token do
// refreshSession (null = renovação falha).
function montar({ tokensValidos, sessao = 'velho', renovado = 'novo' }) {
    const log = { chamadas: [], refresh: 0 };
    const ctx = {
        console: { log() { }, error() { }, warn() { } },
        encodeURIComponent,
        state: { filters: { project: '' }, documentosExcluidos: null },
        supabaseClient: {
            auth: {
                getSession: async () => ({ data: { session: sessao ? { access_token: sessao } : null } }),
                refreshSession: async () => { log.refresh++; return { data: { session: renovado ? { access_token: renovado } : null } }; }
            }
        },
        fetch: async (url, init = {}) => {
            const token = String((init.headers || {}).Authorization || '').replace('Bearer ', '');
            log.chamadas.push({ url, token, metodo: init.method || 'GET' });
            if (!tokensValidos.includes(token)) return { ok: false, status: 401, json: async () => ({ error: 'Token inválido.' }) };
            return { ok: true, status: 200, json: async () => ({ ok: true, documentos: [{ id: 'd1' }] }) };
        }
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + '\n;Object.assign(this, { fetchApiAutenticado, fetchDocumentosExcluidos, MSG_SESSAO_EXPIRADA });', ctx);
    return { ctx, log };
}

const casos = [];
const caso = (nome, fn) => casos.push({ nome, fn });

caso('token valido: uma chamada, sem renovar', async () => {
    const { ctx, log } = montar({ tokensValidos: ['velho'] });
    await ctx.fetchDocumentosExcluidos();
    assert.strictEqual(log.chamadas.length, 1);
    assert.strictEqual(log.refresh, 0);
    assert.strictEqual(ctx.state.documentosExcluidos.erro, null);
    assert.strictEqual(ctx.state.documentosExcluidos.lista.length, 1);
});

caso('token vencido: renova a sessao e a lista carrega', async () => {
    const { ctx, log } = montar({ tokensValidos: ['novo'] });
    await ctx.fetchDocumentosExcluidos();
    assert.strictEqual(log.refresh, 1);
    assert.deepStrictEqual(log.chamadas.map(c => c.token), ['velho', 'novo']);
    assert.strictEqual(ctx.state.documentosExcluidos.erro, null);
    assert.strictEqual(ctx.state.documentosExcluidos.lista.length, 1);
});

caso('renovacao falha: mensagem de sessao expirada, nunca "Token inválido"', async () => {
    const { ctx, log } = montar({ tokensValidos: [], renovado: null });
    await ctx.fetchDocumentosExcluidos();
    assert.strictEqual(log.chamadas.length, 1);
    assert.strictEqual(ctx.state.documentosExcluidos.erro, ctx.MSG_SESSAO_EXPIRADA);
});

caso('token renovado tambem recusado: so uma nova tentativa e mensagem de sessao expirada', async () => {
    const { ctx, log } = montar({ tokensValidos: [] });
    await ctx.fetchDocumentosExcluidos();
    assert.strictEqual(log.chamadas.length, 2);
    assert.strictEqual(ctx.state.documentosExcluidos.erro, ctx.MSG_SESSAO_EXPIRADA);
});

caso('sem sessao: nao chama o servidor', async () => {
    const { ctx, log } = montar({ tokensValidos: ['velho'], sessao: null });
    await ctx.fetchDocumentosExcluidos();
    assert.strictEqual(log.chamadas.length, 0);
    assert.strictEqual(ctx.state.documentosExcluidos.erro, ctx.MSG_SESSAO_EXPIRADA);
});

caso('POST mantem metodo, corpo e cabecalhos na nova tentativa', async () => {
    const { ctx, log } = montar({ tokensValidos: ['novo'] });
    const r = await ctx.fetchApiAutenticado('/api/documentos/ocultar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(log.chamadas.map(c => c.metodo), ['POST', 'POST']);
});

(async () => {
    let ok = 0, falhas = 0;
    for (const c of casos) {
        try { await c.fn(); ok++; } catch (err) { falhas++; console.log('FALHOU: ' + c.nome + '\n   ' + err.message); }
    }
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
