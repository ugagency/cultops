// Teste do #202: fila de OCR dos Documentos em Lote no servidor.
//  - fila-ocr-lote.js: validação do pedido e dos documentos, vagas, coluna ausente.
//  - POST /api/lote/processar: grava rubrica e ocr_fila_em só de quem pode; sem a coluna, 503.
//  - POST /api/m1/cron-ocr-lote: respeita o limite de documentos em OCR, reserva antes de enviar,
//    passa para processing_ocr, chama o n8n e registra o evento.
//  - Navegador (enfileirarLoteNoServidor): marca "Na fila do servidor" e cai no envio antigo com 503.
// server.js de verdade, Supabase falso em memória. Uso: node teste-fila-ocr-lote.js
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarFetchFalso } = require('./teste-banco-falso.js');
const F = require('./fila-ocr-lote.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';
process.env.CRON_SECRET = 'segredo-teste';

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = U(900), ORG2 = U(901), PROJ = U(10), PROJ2 = U(11), PROJ_ORG2 = U(12);
const DONO = U(1), OUTRO = U(2), ADMIN = U(3);
const RUB = U(60), RUB_P2 = U(61), RUB_INATIVA = U(62), EXTRATO = U(50);

let ok = 0;
async function caso(nome, fn) { await fn(); ok++; console.log('ok -', nome); }

let db, webhooks, semColuna;
function zerar() {
    webhooks = [];
    semColuna = false;
    const d = (n, extra) => ({
        id: U(100 + n), name: 'n' + n + '.pdf', file_path: `${PROJ}/x/n${n}.pdf`, project_id: PROJ, organization_id: ORG,
        user_id: DONO, status: 'aguardando_rubrica', excluido_em: null, ocr_fila_em: null, rubrica: null, rubrica_id_fk: null,
        extrato_origem_id: null, updated_at: '2026-11-01T00:00:00Z', ...extra
    });
    db = {
        projects: [{ id: PROJ, organization_id: ORG }, { id: PROJ2, organization_id: ORG }, { id: PROJ_ORG2, organization_id: ORG2 }],
        rubricas: [
            { id: RUB, project_id: PROJ, nome: 'Custos de Administração', ativa: true },
            { id: RUB_P2, project_id: PROJ2, nome: 'Outra', ativa: true },
            { id: RUB_INATIVA, project_id: PROJ, nome: 'Velha', ativa: false }
        ],
        extratos: [{ id: EXTRATO, project_id: PROJ, organization_id: ORG }],
        documents: [
            d(1), d(2), d(3),
            d(4, { status: 'processing_ocr' }),
            d(5, { user_id: OUTRO }),
            d(6, { project_id: PROJ_ORG2, organization_id: ORG2 }),
            d(7, { excluido_em: '2026-11-01T00:00:00Z' }),
            d(8, { ocr_fila_em: '2026-11-01T00:00:00Z' }),
            d(9, { project_id: PROJ2 })
        ],
        processamento_eventos: [],
        audit_log: []
    };
}
const USUARIOS = {
    'tok-dono': { id: DONO, app_metadata: { role: 'operador', org_id: ORG } },
    'tok-outro': { id: OUTRO, app_metadata: { role: 'operador', org_id: ORG } },
    'tok-admin': { id: ADMIN, app_metadata: { role: 'admin', org_id: ORG } }
};
const fetchFalso = criarFetchFalso({
    obterDb: () => db, usuarios: USUARIOS,
    webhook: (url, corpo) => { webhooks.push({ url, corpo }); return new Response('{}', { status: 200 }); },
    storage: (metodo, caminho) => {
        if (metodo === 'POST' && caminho.startsWith('/storage/v1/object/sign/documentos/')) {
            return { status: 200, corpo: { signedURL: '/object/sign/documentos/x?token=t' } };
        }
        return { status: 404, corpo: { message: 'nao suportado' } };
    }
});
global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (semColuna && u.startsWith('http://fake.local/rest/v1/documents') && /ocr_fila_em/.test(decodeURIComponent(u))) {
        return new Response(JSON.stringify({ code: '42703', message: 'column documents.ocr_fila_em does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.startsWith('http://fake.local')) return fetchFalso(u, init);
    return fetchFalso(u, init);   // webhook do n8n (host externo) cai no handler "webhook"
};

const app = require('./server.js');
function chamar(porta, rota, { token = null, cron = null, corpo = {} } = {}) {
    return new Promise((resolve, reject) => {
        const dados = JSON.stringify(corpo);
        const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (cron) headers['x-cron-secret'] = cron;
        const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: 'POST', headers }, (res) => {
            let t = '';
            res.on('data', c => { t += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: t ? JSON.parse(t) : null }));
        });
        req.on('error', reject);
        req.end(dados);
    });
}
const doc = (n) => db.documents.find(x => x.id === U(100 + n));

(async () => {
    // ---- regras puras ----
    await caso('pedido: exige UUIDs, tira repetidos, limita o tamanho', () => {
        assert.strictEqual(F.itensDoPedido([]), null);
        assert.strictEqual(F.itensDoPedido([{ document_id: 'x', rubrica_id: RUB }]), null);
        assert.deepStrictEqual(F.itensDoPedido([{ document_id: U(101), rubrica_id: RUB }, { document_id: U(101), rubrica_id: RUB }]), [{ document_id: U(101), rubrica_id: RUB }]);
        assert.strictEqual(F.itensDoPedido(Array.from({ length: F.MAX_ITENS + 1 }, (_, i) => ({ document_id: U(1000 + i), rubrica_id: RUB }))), null);
    });
    await caso('vagas e coluna ausente', () => {
        assert.strictEqual(F.vagas(0), F.PARALELO);
        assert.strictEqual(F.vagas(F.PARALELO + 2), 0);
        assert.ok(F.colunaFilaAusente({ code: '42703', message: 'x' }));
        assert.ok(F.colunaFilaAusente({ message: "Could not find the 'ocr_fila_em' column of 'documents'" }));
        assert.ok(!F.colunaFilaAusente({ code: '23505', message: 'duplicada' }));
    });

    const servidor = app.listen(0);
    const porta = servidor.address().port;
    try {
        // ---- POST /api/lote/processar ----
        await caso('processar: grava rubrica e entra na fila sem chamar o n8n', async () => {
            zerar();
            const r = await chamar(porta, '/api/lote/processar', { token: 'tok-dono', corpo: { itens: [{ document_id: U(101), rubrica_id: RUB }, { document_id: U(102), rubrica_id: RUB }], extrato_id: EXTRATO } });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.corpo.enfileirados, 2);
            assert.strictEqual(doc(1).status, 'aguardando_rubrica');
            assert.ok(doc(1).ocr_fila_em);
            assert.strictEqual(doc(1).rubrica_id_fk, RUB);
            assert.strictEqual(doc(1).rubrica, 'Custos de Administração');
            assert.strictEqual(doc(1).extrato_origem_id, EXTRATO);
            assert.strictEqual(webhooks.length, 0);
        });
        await caso('processar: extrato de outro projeto não é carimbado', async () => {
            zerar();
            await chamar(porta, '/api/lote/processar', { token: 'tok-dono', corpo: { itens: [{ document_id: U(109), rubrica_id: RUB_P2 }], extrato_id: EXTRATO } });
            assert.ok(doc(9).ocr_fila_em);
            assert.strictEqual(doc(9).extrato_origem_id, null);
        });
        await caso('processar: recusas não gravam nada', async () => {
            zerar();
            const itens = [
                { document_id: U(104), rubrica_id: RUB },          // já em processamento
                { document_id: U(105), rubrica_id: RUB },          // de outro usuário
                { document_id: U(106), rubrica_id: RUB },          // outra organização
                { document_id: U(107), rubrica_id: RUB },          // excluído
                { document_id: U(108), rubrica_id: RUB },          // já na fila
                { document_id: U(109), rubrica_id: RUB },          // rubrica de outro projeto
                { document_id: U(103), rubrica_id: RUB_INATIVA },  // rubrica inativa
                { document_id: U(199), rubrica_id: RUB }           // não existe
            ];
            const r = await chamar(porta, '/api/lote/processar', { token: 'tok-dono', corpo: { itens } });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.corpo.enfileirados, 0);
            assert.ok(r.corpo.itens.every(i => i.resultado === 'recusado' && i.motivo));
            assert.ok(!doc(5).ocr_fila_em && !doc(9).ocr_fila_em && !doc(3).ocr_fila_em);
            assert.strictEqual(doc(6).rubrica_id_fk, null);
        });
        await caso('processar: admin pode processar arquivo de outro usuário', async () => {
            zerar();
            const r = await chamar(porta, '/api/lote/processar', { token: 'tok-admin', corpo: { itens: [{ document_id: U(105), rubrica_id: RUB }] } });
            assert.strictEqual(r.corpo.enfileirados, 1);
        });
        await caso('processar: sem token, 401; pedido inválido, 400', async () => {
            zerar();
            assert.strictEqual((await chamar(porta, '/api/lote/processar', { corpo: { itens: [] } })).status, 401);
            assert.strictEqual((await chamar(porta, '/api/lote/processar', { token: 'tok-dono', corpo: { itens: [] } })).status, 400);
        });
        await caso('processar: sem a coluna (migration não aplicada), 503 FILA_INDISPONIVEL e nada gravado', async () => {
            zerar();
            semColuna = true;
            const r = await chamar(porta, '/api/lote/processar', { token: 'tok-dono', corpo: { itens: [{ document_id: U(101), rubrica_id: RUB }] } });
            assert.strictEqual(r.status, 503);
            assert.strictEqual(r.corpo.codigo, 'FILA_INDISPONIVEL');
            assert.strictEqual(doc(1).rubrica_id_fk, null);
        });

        // ---- POST /api/m1/cron-ocr-lote ----
        await caso('cron: sem o segredo, 401', async () => {
            zerar();
            assert.strictEqual((await chamar(porta, '/api/m1/cron-ocr-lote', { cron: 'errado' })).status, 401);
        });
        await caso('cron: respeita o limite de documentos em OCR e envia na ordem da fila', async () => {
            zerar();
            const agora = new Date().toISOString();
            doc(4).updated_at = agora;   // 1 documento já em OCR agora
            [1, 2, 3].forEach((n, i) => { doc(n).ocr_fila_em = `2026-11-20T10:00:0${i}Z`; doc(n).rubrica_id_fk = RUB; });
            doc(8).excluido_em = '2026-11-01T00:00:00Z';   // excluído na fila: nunca sai
            const r = await chamar(porta, '/api/m1/cron-ocr-lote', { cron: 'segredo-teste' });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.corpo.disparados, F.PARALELO - 1);
            const enviados = [1, 2, 3].filter(n => doc(n).status === 'processing_ocr');
            assert.strictEqual(enviados.length, F.PARALELO - 1);
            enviados.forEach(n => assert.strictEqual(doc(n).ocr_fila_em, null));
            assert.strictEqual(webhooks.length, F.PARALELO - 1);
            assert.ok(webhooks.every(w => /cultops-ocr$/.test(w.url) && w.corpo.bucket === 'documentos' && w.corpo.user_id === DONO && w.corpo.file_url));
            assert.strictEqual(db.processamento_eventos.filter(e => e.acao === 'ocr_lote' && e.ok === true).length, F.PARALELO - 1);
            assert.strictEqual(doc(8).status, 'aguardando_rubrica');

            // n8n termina os que estavam em OCR: a próxima rodada envia o que sobrou
            [1, 2, 3, 4].forEach(n => { if (doc(n).status === 'processing_ocr') doc(n).status = 'aguardando_conformidade'; });
            const r2 = await chamar(porta, '/api/m1/cron-ocr-lote', { cron: 'segredo-teste' });
            assert.strictEqual(r2.corpo.disparados, 1);
            assert.ok([1, 2, 3].every(n => doc(n).status !== 'aguardando_rubrica'));
            assert.strictEqual(doc(8).status, 'aguardando_rubrica');
        });
        await caso('cron: fila vazia não chama ninguém; sem a coluna, ignora', async () => {
            zerar();
            doc(8).ocr_fila_em = null;
            const r = await chamar(porta, '/api/m1/cron-ocr-lote', { cron: 'segredo-teste' });
            assert.strictEqual(r.corpo.disparados, 0);
            assert.strictEqual(webhooks.length, 0);
            semColuna = true;
            const r2 = await chamar(porta, '/api/m1/cron-ocr-lote', { cron: 'segredo-teste' });
            assert.strictEqual(r2.status, 200);
            assert.ok(/migration_202/.test(r2.corpo.ignorado));
        });
        await caso('cron: falha do n8n fica registrada e a nota segue em processing_ocr', async () => {
            zerar();
            doc(8).ocr_fila_em = null;
            doc(1).ocr_fila_em = '2026-11-20T10:00:00Z';
            const antes = global.fetch;
            global.fetch = async (url, init) => (String(url).includes('cultops-ocr') ? new Response('erro', { status: 500 }) : antes(url, init));
            try {
                const r = await chamar(porta, '/api/m1/cron-ocr-lote', { cron: 'segredo-teste' });
                assert.strictEqual(r.corpo.falhas, 1);
                assert.strictEqual(doc(1).status, 'processing_ocr');
                assert.ok(db.processamento_eventos.some(e => e.acao === 'ocr_lote' && e.ok === false && e.http_status === 500));
            } finally { global.fetch = antes; }
        });
    } finally {
        servidor.close();
    }

    // ---- navegador ----
    const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
    function bloco(inicio, fecho) {
        const i = SRC.indexOf(inicio); assert.ok(i >= 0, inicio);
        const j = SRC.indexOf(fecho, i); assert.ok(j > i, inicio);
        return SRC.slice(i, j + fecho.length);
    }
    const CODIGO = [
        bloco('async function enfileirarLoteNoServidor(', '\n}\n'),
        bloco('function estadoLinhaLote(', '\n}\n'),
        bloco('function linhaLoteTravada(', '\n}\n'),
    ].join('\n');
    function navegador(resposta) {
        const log = { toasts: [], pedidos: [], fetchFila: 0 };
        const ctx = {
            state: { loading: false, uploadLoteQueue: [{ id: 'a', name: 'a.pdf' }, { id: 'b', name: 'b.pdf' }], loteExtratoVinculado: { id: 'ex1' }, uploadLoteProgresso: {} },
            render() { },
            showToast: (m, t) => log.toasts.push({ m, t }),
            fetchUploadLoteQueue: async () => { log.fetchFila++; },
            fetchApiAutenticado: async (url, op) => { log.pedidos.push({ url, corpo: JSON.parse(op.body) }); return { ok: resposta.status === 200, status: resposta.status, json: async () => resposta.corpo }; },
        };
        vm.createContext(ctx);
        vm.runInContext(CODIGO, ctx);
        return { ctx, log };
    }
    const itens = [{ doc: { id: 'a' }, rubricaIdFk: 'r1' }, { doc: { id: 'b' }, rubricaIdFk: 'r2' }];

    await caso('navegador: na fila do servidor, linha travada e mensagem de que pode sair', async () => {
        const { ctx, log } = navegador({ status: 200, corpo: { ok: true, itens: [{ id: 'a', resultado: 'enfileirado' }, { id: 'b', resultado: 'recusado', motivo: 'O documento já foi enviado para processamento.' }] } });
        const r = await ctx.enfileirarLoteNoServidor(itens);
        assert.strictEqual(r.indisponivel, false);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(log.pedidos[0].corpo)), { itens: [{ document_id: 'a', rubrica_id: 'r1' }, { document_id: 'b', rubrica_id: 'r2' }], extrato_id: 'ex1' });
        assert.strictEqual(ctx.estadoLinhaLote('a'), 'na_fila');
        assert.ok(ctx.linhaLoteTravada('a'));
        assert.ok(!ctx.linhaLoteTravada('b'));
        assert.strictEqual(ctx.state.loteEnvioConcluido.servidor, true);
        assert.ok(log.toasts.some(t => /pode sair/.test(t.m)));
        assert.ok(log.toasts.some(t => t.t === 'error' && /b\.pdf/.test(t.m)));
        assert.strictEqual(log.fetchFila, 1);
        assert.strictEqual(ctx.state.loading, false);
    });
    await caso('navegador: 503 FILA_INDISPONIVEL devolve indisponivel para usar o envio antigo', async () => {
        const { ctx, log } = navegador({ status: 503, corpo: { codigo: 'FILA_INDISPONIVEL' } });
        const r = await ctx.enfileirarLoteNoServidor(itens);
        assert.strictEqual(r.indisponivel, true);
        assert.strictEqual(log.toasts.length, 0);
    });
    await caso('navegador: outro erro avisa e não cai no envio antigo', async () => {
        const { ctx, log } = navegador({ status: 500, corpo: { error: 'falhou' } });
        const r = await ctx.enfileirarLoteNoServidor(itens);
        assert.strictEqual(r.indisponivel, false);
        assert.ok(log.toasts.some(t => t.t === 'error'));
    });

    console.log(`\n${ok} casos ok`);
    process.exit(0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
