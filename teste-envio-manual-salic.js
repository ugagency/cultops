// Teste do #184: nota com falha no envio ao SALIC (erro_rpa).
//  - "Continuar por conta e risco" não devolve mais a nota para a fila do robô (liberado_rpa_airtop).
//  - "Registrar envio manual" exige a confirmação marcada e chama registrar_envio_manual_salic.
//  - Selo "Envio manual" só aparece na nota marcada.
//  - A migration tem a função com as travas (admin, organização, só erro_rpa, não excluída).
// Funções recortadas do app.js. Uso: node teste-envio-manual-salic.js
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
    bloco('function seloEnvioManualHtml(', '\n}\n'),
    bloco('function envioManualSalicHtml(', '\n}\n'),
    bloco('window.handleRegistrarEnvioManualSalic = async function', '\n};\n'),
    bloco('window.handleForcarAvanco = async function', '\n};\n')
].join('\n');

function montar({ role = 'admin', marcado = true, protocolo = '', rpcErro = null } = {}) {
    const log = { rpc: [], toasts: [], updates: [], detalhes: 0 };
    const ctx = {
        console: { log() { }, error() { }, warn() { } },
        state: { loading: false, confirmModal: null, currentDocument: null },
        userCanDelete: () => role === 'admin',
        showToast: (m, t) => log.toasts.push({ m, t }),
        render: () => { },
        fetchDocumentDetails: async () => { log.detalhes++; },
        document: {
            getElementById: (id) => {
                if (id.startsWith('envio-manual-confirmo-')) return { checked: marcado };
                if (id.startsWith('envio-manual-protocolo-')) return { value: protocolo };
                return null;
            }
        },
        supabaseClient: {
            rpc: async (nome, args) => { log.rpc.push({ nome, args }); return { error: rpcErro }; },
            from: () => ({ update: (d) => { log.updates.push(d); return { eq: async () => ({ error: null }) }; } })
        },
        window: {}
    };
    ctx.window.showToast = ctx.showToast;
    ctx.window.showConfirmModal = (c) => { ctx.state.confirmModal = c; };
    vm.createContext(ctx);
    vm.runInContext(CODIGO + '\n;Object.assign(this, { seloEnvioManualHtml, envioManualSalicHtml });', ctx);
    return { ctx, log };
}

const casos = [];
const caso = (n, f) => casos.push({ n, f });

caso('conta e risco em erro_rpa nao devolve a nota para a fila do robo', async () => {
    const { ctx, log } = montar();
    await ctx.window.handleForcarAvanco('d1', 'erro_rpa');
    assert.strictEqual(ctx.state.confirmModal, null);
    assert.deepStrictEqual(log.updates, []);
    assert.ok(log.toasts.some(t => t.t === 'error'));
    assert.ok(!SRC.includes("'erro_rpa': 'liberado_rpa_airtop'"));
});

caso('sem a confirmacao marcada nao registra', async () => {
    const { ctx, log } = montar({ marcado: false });
    await ctx.window.handleRegistrarEnvioManualSalic('d1');
    assert.strictEqual(ctx.state.confirmModal, null);
    assert.deepStrictEqual(log.rpc, []);
});

caso('confirmado: chama a funcao do banco com o protocolo e recarrega a nota', async () => {
    const { ctx, log } = montar({ protocolo: ' 12345 ' });
    await ctx.window.handleRegistrarEnvioManualSalic('d1');
    assert.ok(ctx.state.confirmModal.message.includes('12345'));
    await ctx.state.confirmModal.onConfirm();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(log.rpc)), [{ nome: 'registrar_envio_manual_salic', args: { p_document_id: 'd1', p_protocolo: '12345', p_motivo: null } }]);
    assert.strictEqual(log.detalhes, 1);
    assert.ok(log.toasts.some(t => t.t === 'success'));
});

caso('erro do banco aparece e a nota nao e recarregada como sucesso', async () => {
    const { ctx, log } = montar({ rpcErro: { message: 'Só nota com falha no envio ao SALIC pode ser marcada' } });
    await ctx.window.handleRegistrarEnvioManualSalic('d1');
    await ctx.state.confirmModal.onConfirm();
    assert.ok(log.toasts.some(t => t.t === 'error'));
    assert.strictEqual(log.detalhes, 0);
});

caso('so administrador registra', async () => {
    const { ctx, log } = montar({ role: 'gestor' });
    await ctx.window.handleRegistrarEnvioManualSalic('d1');
    assert.strictEqual(ctx.state.confirmModal, null);
    assert.deepStrictEqual(log.rpc, []);
});

caso('selo e quadro', () => {
    const { ctx } = montar();
    assert.strictEqual(ctx.seloEnvioManualHtml({ envio_salic_manual: false }), '');
    assert.ok(ctx.seloEnvioManualHtml({ envio_salic_manual: true, envio_salic_manual_em: '2026-11-17T12:00:00Z' }).includes('Envio manual'));
    const q = ctx.envioManualSalicHtml({ id: 'd1' });
    assert.ok(q.includes('Lançar manualmente no SALIC'));
    assert.ok(q.includes('envio-manual-confirmo-d1'));
});

caso('migration: travas da funcao', () => {
    const sql = fs.readFileSync(path.join(__dirname, 'migration_184_envio_manual_salic.sql'), 'utf8');
    assert.ok(sql.includes("has_any_role('admin')"));
    assert.ok(sql.includes('current_user_org_id()'));
    assert.ok(sql.includes("d.status <> 'erro_rpa'"));
    assert.ok(sql.includes('d.excluido_em IS NOT NULL'));
    assert.ok(sql.includes("status = 'enviado_salic'"));
    assert.ok(!/liberado_rpa_airtop/.test(sql.split('CREATE OR REPLACE FUNCTION')[1].split('$function$;')[0]));
    assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.registrar_envio_manual_salic(uuid, text, text) TO authenticated'));
});

(async () => {
    let ok = 0, falhas = 0;
    for (const c of casos) {
        try { await c.f(); ok++; } catch (e) { falhas++; console.log('FALHOU: ' + c.n + '\n   ' + e.message); }
    }
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
