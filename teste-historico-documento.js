// Teste do #209: histórico completo do documento.
//  Parte 1 - GET /api/documentos/:id/historico (server.js de verdade, Supabase falso): todas as linhas
//            do audit_log do documento, em ordem, com o e-mail de quem fez; organização e perfil conferidos.
//  Parte 2 - texto de cada linha na tela (funções recortadas do app.js).
// Uso: node teste-historico-documento.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { criarFetchFalso } = require('./teste-banco-falso.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = U(900), ORG2 = U(901), PROJ = U(10), DOC = U(100), DOC_ANALISTA = U(101);
const GESTOR = U(1), ANALISTA = U(2), OUTRA_ORG = U(3), FORNECEDOR = U(4);
let db;
function zerar() {
    db = {
        projects: [{ id: PROJ, organization_id: ORG }],
        documents: [
            { id: DOC, project_id: PROJ, organization_id: ORG, user_id: GESTOR },
            { id: DOC_ANALISTA, project_id: PROJ, organization_id: ORG, user_id: ANALISTA }
        ],
        audit_log: [
            { tabela: 'documents', registro_id: DOC, campo: 'status', valor_anterior: 'aguardando_conciliacao_bancaria', valor_novo: 'divergencia_beneficiario', origem: 'sistema:nao_declarado', alterado_por: null, created_at: '2026-11-02T10:00:00Z' },
            { tabela: 'documents', registro_id: DOC, campo: '__insert', valor_anterior: null, valor_novo: 'criado', origem: 'ui', alterado_por: GESTOR, created_at: '2026-11-01T10:00:00Z' },
            { tabela: 'documents', registro_id: DOC, campo: 'valor_pago', valor_anterior: null, valor_novo: '150.5', origem: 'ui', alterado_por: GESTOR, motivo: 'pago em dinheiro', created_at: '2026-11-03T10:00:00Z' },
            { tabela: 'documents', registro_id: DOC_ANALISTA, campo: 'status', valor_anterior: 'a', valor_novo: 'b', origem: 'ui', alterado_por: ANALISTA, created_at: '2026-11-03T10:00:00Z' }
        ]
    };
}
const USUARIOS = {
    'tok-gestor': { id: GESTOR, email: 'gestor@org.com', app_metadata: { role: 'gestor', org_id: ORG } },
    'tok-analista': { id: ANALISTA, email: 'analista@org.com', app_metadata: { role: 'analista', org_id: ORG } },
    'tok-org2': { id: OUTRA_ORG, email: 'x@org2.com', app_metadata: { role: 'admin', org_id: ORG2 } },
    'tok-fornecedor': { id: FORNECEDOR, app_metadata: { role: 'fornecedor', org_id: ORG } }
};
const fetchFalso = criarFetchFalso({ obterDb: () => db, usuarios: USUARIOS });
global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('http://fake.local')) return fetchFalso(u, init);
    throw new Error('chamada externa inesperada: ' + u);
};
const app = require('./server.js');
const get = (porta, caminho, token) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: 'GET', headers: { Authorization: 'Bearer ' + token } }, (res) => {
        let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, corpo: t ? JSON.parse(t) : null }));
    });
    req.on('error', reject); req.end();
});

// Parte 2: recortes do app.js
const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio); assert.ok(i >= 0, inicio);
    const j = SRC.indexOf(fecho, i); assert.ok(j > i, inicio);
    return SRC.slice(i, j + fecho.length);
}
const ctxFront = {
    state: { rubricas_disponiveis: [{ id: 'r1', rubrica_id: 65, nome: 'Assistente', produto: 'CURSO' }] },
    STATUS_MAP: { divergencia_beneficiario: { label: 'Divergência de beneficiário' }, aguardando_d3: { label: 'Aguardando D-3' } }
};
vm.createContext(ctxFront);
vm.runInContext([
    bloco('function partesRotuloRubrica(', '\n}\n'),
    bloco('function rotuloRubricaSemValor(', '\n}\n'),
    bloco('const CAMPOS_HISTORICO_DOC = {', '\n};\n'),
    bloco('function valorHistoricoDoc(', '\n}\n'),
    bloco('function textoLinhaHistoricoDoc(', '\n}\n')
].join('\n') + '\n;this.textoLinhaHistoricoDoc = textoLinhaHistoricoDoc;', ctxFront);
const T = ctxFront.textoLinhaHistoricoDoc;

(async () => {
    const servidor = http.createServer(app);
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    const porta = servidor.address().port;
    let ok = 0, falhas = 0;
    const teste = async (nome, fn) => { zerar(); try { await fn(); ok++; } catch (e) { falhas++; console.log('FALHOU: ' + nome + '\n   ' + e.message); } };

    await teste('rota: todas as linhas do documento, em ordem, com e-mail de quem fez', async () => {
        const r = await get(porta, `/api/documentos/${DOC}/historico`, 'tok-gestor');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo.historico.map(l => l.campo), ['__insert', 'status', 'valor_pago']);
        assert.strictEqual(r.corpo.historico[0].por.email, 'gestor@org.com');
        assert.strictEqual(r.corpo.historico[1].por, null);
        assert.strictEqual(r.corpo.historico[2].motivo, 'pago em dinheiro');
    });
    await teste('rota: outra organização e fornecedor não veem', async () => {
        assert.strictEqual((await get(porta, `/api/documentos/${DOC}/historico`, 'tok-org2')).status, 404);
        assert.strictEqual((await get(porta, `/api/documentos/${DOC}/historico`, 'tok-fornecedor')).status, 403);
    });
    await teste('rota: analista só vê documento que enviou', async () => {
        assert.strictEqual((await get(porta, `/api/documentos/${DOC}/historico`, 'tok-analista')).status, 404);
        assert.strictEqual((await get(porta, `/api/documentos/${DOC_ANALISTA}/historico`, 'tok-analista')).status, 200);
    });
    await teste('rota: id inválido', async () => {
        assert.strictEqual((await get(porta, '/api/documentos/abc/historico', 'tok-gestor')).status, 400);
    });

    await teste('tela: textos das linhas', async () => {
        assert.strictEqual(T({ campo: 'status', de: 'divergencia_beneficiario', para: 'aguardando_d3' }), 'Status: Divergência de beneficiário → Aguardando D-3');
        assert.strictEqual(T({ campo: 'valor_pago', de: null, para: '150.5' }), 'Valor pago: R$ 150,50');
        assert.strictEqual(T({ campo: 'data_pagamento', de: '2026-10-01', para: '2026-10-02' }), 'Data do pagamento: 01/10/2026 → 02/10/2026');
        assert.strictEqual(T({ campo: 'rubrica_id_fk', de: null, para: 'r1' }), 'Rubrica: CURSO · 65 - Assistente');
        assert.strictEqual(T({ campo: 'rubrica_id_fk', de: 'r1', para: 'rx' }), 'Rubrica: CURSO · 65 - Assistente → outra rubrica');
        assert.strictEqual(T({ campo: 'excluido_em', de: null, para: '2026-11-01' }), 'Documento excluído');
        assert.strictEqual(T({ campo: 'excluido_em', de: '2026-11-01', para: null }), 'Documento restaurado');
        assert.strictEqual(T({ campo: '__insert', de: null, para: 'criado' }), 'Documento enviado');
        assert.strictEqual(T({ campo: 'numero_nf', de: '1', para: null }), 'Número da nota: removido (era 1)');
        assert.strictEqual(T({ campo: 'campo_novo', de: 'a', para: 'b' }), 'campo novo: a → b');
    });

    servidor.close();
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
