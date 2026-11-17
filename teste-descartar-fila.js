// Teste do #199: POST /api/documentos/descartar-fila. Arquivo que só está na fila do lote
// (aguardando_rubrica, sem leitura, sem extrato, sem despesa, sem comprovante filho) é apagado de
// verdade (linha e PDF) e registrado no audit_log. Qualquer outro caso é recusado e nada é apagado.
// server.js de verdade, Supabase falso em memória. Uso: node teste-descartar-fila.js
const assert = require('assert');
const http = require('http');
const { criarFetchFalso } = require('./teste-banco-falso.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = U(900), ORG2 = U(901), PROJ = U(10), PROJ_ORG2 = U(12);
const DONO = U(1), OUTRO = U(2), ADMIN = U(3);

let db;
let removidosStorage;
function zerar() {
    removidosStorage = [];
    const d = (n, extra) => ({
        id: U(100 + n), name: 'n' + n + '.pdf', file_path: `${PROJ}/x/n${n}.pdf`, project_id: PROJ, organization_id: ORG,
        user_id: DONO, status: 'aguardando_rubrica', excluido_em: null, json_extraido: null, extrato_origem_id: null,
        nf_vinculada_id: null, ...extra
    });
    db = {
        projects: [{ id: PROJ, organization_id: ORG }, { id: PROJ_ORG2, organization_id: ORG2 }],
        documents: [
            d(1),
            d(2, { status: 'processing_ocr' }),
            d(3, { json_extraido: { numero_nota: '1' } }),
            d(4, { extrato_origem_id: U(50) }),
            d(5),                                   // tem despesa
            d(6),                                   // tem comprovante filho (doc 7)
            d(7, { nf_vinculada_id: U(106), status: 'concluido' }),
            d(8, { excluido_em: '2026-11-01T00:00:00Z' }),
            d(9, { project_id: PROJ_ORG2, organization_id: ORG2 }),
            d(10, { user_id: OUTRO })
        ],
        despesas: [{ id: U(70), document_id: U(105) }],
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
    storage: (metodo, caminho, corpo) => {
        if (metodo === 'DELETE' && caminho === '/storage/v1/object/documentos') {
            removidosStorage.push(...(corpo.prefixes || []));
            return { status: 200, corpo: (corpo.prefixes || []).map(name => ({ name })) };
        }
        return { status: 404, corpo: { message: 'nao suportado' } };
    }
});
global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('http://fake.local')) return fetchFalso(u, init);
    throw new Error('chamada externa inesperada: ' + u);
};

const app = require('./server.js');
function chamar(porta, token, corpo) {
    return new Promise((resolve, reject) => {
        const dados = JSON.stringify(corpo);
        const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/documentos/descartar-fila', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), Authorization: 'Bearer ' + token } }, (res) => {
            let t = '';
            res.on('data', c => { t += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: t ? JSON.parse(t) : null }));
        });
        req.on('error', reject);
        req.end(dados);
    });
}
const existe = (n) => db.documents.some(d => d.id === U(100 + n));
const resultado = (r, n) => (r.corpo.itens.find(i => i.id === U(100 + n)) || {}).resultado;

(async () => {
    const servidor = http.createServer(app);
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    const porta = servidor.address().port;
    let ok = 0, falhas = 0;
    const teste = async (nome, fn) => {
        zerar();
        try { await fn(); ok++; } catch (e) { falhas++; console.log('FALHOU: ' + nome + '\n   ' + e.message); }
    };

    await teste('arquivo so na fila: apaga a linha e o PDF e registra no audit_log', async () => {
        const r = await chamar(porta, 'tok-dono', { document_ids: [U(101)] });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(resultado(r, 1), 'descartado');
        assert.ok(!existe(1));
        assert.deepStrictEqual(removidosStorage, [`${PROJ}/x/n1.pdf`]);
        assert.strictEqual(db.audit_log.length, 1);
        assert.strictEqual(db.audit_log[0].origem, 'descartar_fila_lote');
        assert.strictEqual(db.audit_log[0].alterado_por, DONO);
    });

    await teste('documento com qualquer andamento e recusado e nada e apagado', async () => {
        const r = await chamar(porta, 'tok-dono', { document_ids: [2, 3, 4, 5, 6, 8].map(n => U(100 + n)) });
        assert.strictEqual(r.status, 200);
        for (const n of [2, 3, 4, 5, 6, 8]) {
            assert.strictEqual(resultado(r, n), 'recusado', 'doc ' + n);
            assert.ok(existe(n), 'doc ' + n + ' continua');
        }
        assert.deepStrictEqual(removidosStorage, []);
        assert.strictEqual(db.audit_log.length, 0);
    });

    await teste('outra organizacao: responde como inexistente', async () => {
        const r = await chamar(porta, 'tok-dono', { document_ids: [U(109)] });
        assert.strictEqual(resultado(r, 9), 'recusado');
        assert.ok(existe(9));
    });

    await teste('arquivo de outro usuario: operador nao descarta, admin descarta', async () => {
        let r = await chamar(porta, 'tok-dono', { document_ids: [U(110)] });
        assert.strictEqual(resultado(r, 10), 'recusado');
        assert.ok(existe(10));
        r = await chamar(porta, 'tok-admin', { document_ids: [U(110)] });
        assert.strictEqual(resultado(r, 10), 'descartado');
        assert.ok(!existe(10));
    });

    await teste('pedido invalido: 400', async () => {
        const r = await chamar(porta, 'tok-dono', { document_ids: ['nao-e-uuid'] });
        assert.strictEqual(r.status, 400);
    });

    servidor.close();
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
