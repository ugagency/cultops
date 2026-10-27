// Teste da rota POST /api/conciliacao/vincular-extrato com um Supabase falso em memória: carrega o
// server.js de verdade, troca o fetch global por um banco de mentira (REST do Supabase e auth) e
// chama a rota por HTTP. Confere perfil, organização, projeto, nota já vinculada, analista com nota
// de outro usuário, divergência com e sem confirmação, auditoria e que nada vai ao n8n.
// Uso: node teste-vinculo-extrato-rota.js
const assert = require('assert');
const http = require('http');
const { criarFetchFalso } = require('./teste-banco-falso.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1'; // o server.js não abre porta sozinho

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = U(900), ORG2 = U(901);
const PROJ = U(10), PROJ2 = U(11), PROJ_ORG2 = U(12);
const EXTRATO = U(20), EXTRATO_OUTRA_ORG = U(21), EXTRATO_OUTRO_PROJ = U(22), EXTRATO_ERRO = U(23), EXTRATO_B = U(24);
const GESTOR = U(1), ANALISTA = U(2), OUTRO = U(3), FORNECEDOR = U(4);

let db;
const chamadasExternas = [];
function zerarBanco() {
    const nota = (n, extra) => ({
        id: U(100 + n), name: 'nota' + n + '.pdf', project_id: PROJ, user_id: GESTOR, tipo_documento: 'nf',
        status: 'aguardando_conciliacao_bancaria', extrato_origem_id: null, just_erro: null, ...extra
    });
    db = {
        projects: [
            { id: PROJ, organization_id: ORG }, { id: PROJ2, organization_id: ORG }, { id: PROJ_ORG2, organization_id: ORG2 }
        ],
        extratos: [
            { id: EXTRATO, project_id: PROJ, organization_id: ORG, status: 'pendente' },
            { id: EXTRATO_B, project_id: PROJ, organization_id: ORG, status: 'processado' },
            { id: EXTRATO_OUTRA_ORG, project_id: PROJ_ORG2, organization_id: ORG2, status: 'pendente' },
            { id: EXTRATO_OUTRO_PROJ, project_id: PROJ2, organization_id: ORG, status: 'pendente' },
            { id: EXTRATO_ERRO, project_id: PROJ, organization_id: ORG, status: 'erro' }
        ],
        documents: [
            nota(1), // livre
            nota(2, { user_id: ANALISTA }), // do analista
            nota(3, { user_id: OUTRO }), // de outro usuário
            nota(4, { extrato_origem_id: EXTRATO_B }), // já vinculada a outro extrato
            nota(5, { extrato_origem_id: EXTRATO }), // já vinculada a este extrato
            nota(6, { status: 'divergencia_valor', just_erro: 'Extrato de outro projeto' }),
            nota(7, { status: 'divergencia_beneficiario', just_erro: 'Pagamento nao localizado' }),
            nota(8, { project_id: PROJ2 }), // outro projeto
            nota(9, { project_id: PROJ_ORG2, user_id: OUTRO }), // outra organização
            nota(10, { status: 'enviado_salic' }),
            nota(11, { tipo_documento: 'comprovante' }),
            nota(12, { status: 'processing_ocr' }),
            nota(13, { status: 'aguardando_rubrica', user_id: ANALISTA })
        ],
        audit_log: [],
        processamento_eventos: []
    };
}

const USUARIOS = {
    'tok-gestor': { id: GESTOR, app_metadata: { role: 'gestor', org_id: ORG } },
    'tok-analista': { id: ANALISTA, app_metadata: { role: 'analista', org_id: ORG } },
    'tok-admin': { id: U(5), app_metadata: { role: 'admin', org_id: ORG } },
    'tok-fornecedor': { id: FORNECEDOR, app_metadata: { role: 'fornecedor', org_id: ORG } },
    'tok-sem-org': { id: GESTOR, app_metadata: { role: 'gestor' } }
};

let antesDoPatch = null;
const fetchFalso = criarFetchFalso({
    obterDb: () => db, usuarios: USUARIOS,
    antesDoPatch: (tabela, filtros, nome) => { if (antesDoPatch) antesDoPatch(tabela, filtros, nome); }
});

const fetchReal = global.fetch;
global.fetch = async (url, init) => {
    if (String(url).startsWith('http://fake.local')) return fetchFalso(String(url), init);
    chamadasExternas.push(String(url)); // qualquer saída para fora do banco falso (n8n, por exemplo)
    throw new Error('chamada externa inesperada: ' + url);
};

const app = require('./server.js');
let ok = 0, falhas = 0;
async function teste(nome, fn) {
    zerarBanco();
    antesDoPatch = null;
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

function chamar(porta, token, corpo) {
    return new Promise((resolve, reject) => {
        const dados = JSON.stringify(corpo);
        const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/conciliacao/vincular-extrato', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
            let texto = '';
            res.on('data', c => { texto += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: texto ? JSON.parse(texto) : null }));
        });
        req.on('error', reject);
        req.end(dados);
    });
}

const nota = (id) => db.documents.find(d => d.id === U(100 + id));
const ids = (...ns) => ns.map(n => U(100 + n));
const resultadoDe = (r, n) => r.corpo.itens.find(i => i.id === U(100 + n));

(async () => {
    const servidor = http.createServer(app);
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const porta = servidor.address().port;
    const post = (token, corpo) => chamar(porta, token, corpo);

    await teste('sem token: 401', async () => {
        assert.strictEqual((await post(null, { extrato_id: EXTRATO, document_ids: ids(1) })).status, 401);
    });

    await teste('perfil: fornecedor recebe 403 e nada é gravado', async () => {
        const r = await post('tok-fornecedor', { extrato_id: EXTRATO, document_ids: ids(1) });
        assert.strictEqual(r.status, 403);
        assert.strictEqual(nota(1).extrato_origem_id, null);
    });

    await teste('perfil: admin, gestor e analista podem', async () => {
        for (const [token, n] of [['tok-admin', 1], ['tok-gestor', 12], ['tok-analista', 2]]) {
            const r = await post(token, { extrato_id: EXTRATO, document_ids: ids(n) });
            assert.strictEqual(r.status, 200, token);
            assert.strictEqual(resultadoDe(r, n).resultado, 'vinculada', token);
        }
    });

    await teste('organização vem do JWT: sem org_id no token, 403; org do corpo é ignorada', async () => {
        assert.strictEqual((await post('tok-sem-org', { extrato_id: EXTRATO, document_ids: ids(1) })).status, 403);
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(1), organization_id: ORG2, project_id: PROJ_ORG2 });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(nota(1).extrato_origem_id, EXTRATO);
    });

    await teste('extrato de outra organização: 404, nada gravado', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO_OUTRA_ORG, document_ids: ids(1) });
        assert.strictEqual(r.status, 404);
        assert.strictEqual(nota(1).extrato_origem_id, null);
    });

    await teste('extrato com erro de leitura: 409; extrato inexistente: 404; ids inválidos: 400', async () => {
        assert.strictEqual((await post('tok-gestor', { extrato_id: EXTRATO_ERRO, document_ids: ids(1) })).status, 409);
        assert.strictEqual((await post('tok-gestor', { extrato_id: U(999), document_ids: ids(1) })).status, 404);
        assert.strictEqual((await post('tok-gestor', { extrato_id: 'x', document_ids: ids(1) })).status, 400);
        assert.strictEqual((await post('tok-gestor', { extrato_id: EXTRATO, document_ids: [] })).status, 400);
        assert.strictEqual((await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ['nao-uuid'] })).status, 400);
    });

    await teste('nota de outra organização e nota inexistente: recusadas, sem tocar nos dados', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: [...ids(9), U(777)] });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(resultadoDe(r, 9).resultado, 'recusada');
        assert.strictEqual(r.corpo.itens[1].resultado, 'recusada');
        assert.strictEqual(nota(9).extrato_origem_id, null);
    });

    await teste('projeto diferente: recusada', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(8) });
        assert.strictEqual(resultadoDe(r, 8).resultado, 'recusada');
        assert.strictEqual(nota(8).extrato_origem_id, null);
        // e extrato de outro projeto da mesma organização: as notas do projeto original são recusadas
        const r2 = await post('tok-gestor', { extrato_id: EXTRATO_OUTRO_PROJ, document_ids: ids(1) });
        assert.strictEqual(resultadoDe(r2, 1).resultado, 'recusada');
    });

    await teste('nota já vinculada: a outro extrato é pulada (e continua como estava); ao mesmo extrato também', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(4, 5) });
        assert.strictEqual(resultadoDe(r, 4).resultado, 'pulada');
        assert.ok(/outro extrato/.test(resultadoDe(r, 4).motivo));
        assert.strictEqual(nota(4).extrato_origem_id, EXTRATO_B);
        assert.strictEqual(resultadoDe(r, 5).resultado, 'pulada');
        assert.deepStrictEqual(db.audit_log, []);
    });

    await teste('analista: só as notas dele; as de outro usuário são recusadas', async () => {
        const r = await post('tok-analista', { extrato_id: EXTRATO, document_ids: ids(2, 3, 13) });
        assert.strictEqual(resultadoDe(r, 2).resultado, 'vinculada');
        assert.strictEqual(resultadoDe(r, 13).resultado, 'vinculada');
        assert.strictEqual(resultadoDe(r, 3).resultado, 'recusada');
        assert.strictEqual(nota(3).extrato_origem_id, null);
        assert.strictEqual(nota(2).extrato_origem_id, EXTRATO);
        // o gestor vincula a de outro usuário
        const g = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(3) });
        assert.strictEqual(resultadoDe(g, 3).resultado, 'vinculada');
    });

    await teste('divergência SEM confirmação: pulada, status e erro intactos', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(6, 7), incluir_divergencias: false });
        assert.strictEqual(resultadoDe(r, 6).resultado, 'pulada');
        assert.strictEqual(resultadoDe(r, 7).resultado, 'pulada');
        assert.strictEqual(nota(6).status, 'divergencia_valor');
        assert.strictEqual(nota(6).just_erro, 'Extrato de outro projeto');
        assert.strictEqual(nota(6).extrato_origem_id, null);
        // valor que não é booleano true também não confirma
        const r2 = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(6), incluir_divergencias: 'true' });
        assert.strictEqual(resultadoDe(r2, 6).resultado, 'pulada');
    });

    await teste('divergência COM confirmação: vincula, volta para a conciliação e limpa o erro', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(6, 7), incluir_divergencias: true });
        for (const n of [6, 7]) {
            assert.strictEqual(resultadoDe(r, n).resultado, 'vinculada');
            assert.strictEqual(nota(n).status, 'aguardando_conciliacao_bancaria');
            assert.strictEqual(nota(n).just_erro, null);
            assert.strictEqual(nota(n).extrato_origem_id, EXTRATO);
        }
    });

    await teste('status que já passou da conciliação e tipo que não concilia: recusados', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(10, 11) });
        assert.strictEqual(resultadoDe(r, 10).resultado, 'recusada');
        assert.strictEqual(resultadoDe(r, 11).resultado, 'recusada');
        assert.strictEqual(nota(10).extrato_origem_id, null);
    });

    await teste('auditoria: uma linha por nota vinculada (extrato_origem_id) e uma de status na divergência, origem vincular_extrato', async () => {
        await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(1, 6, 4), incluir_divergencias: true });
        const doExtrato = db.audit_log.filter(a => a.campo === 'extrato_origem_id');
        assert.deepStrictEqual(doExtrato.map(a => a.registro_id).sort(), ids(1, 6).sort());
        for (const a of doExtrato) {
            assert.strictEqual(a.tabela, 'documents');
            assert.strictEqual(a.valor_anterior, null);
            assert.strictEqual(a.valor_novo, EXTRATO);
            assert.strictEqual(a.alterado_por, GESTOR);
            assert.strictEqual(a.origem, 'vincular_extrato');
        }
        const status = db.audit_log.filter(a => a.campo === 'status');
        assert.strictEqual(status.length, 1);
        assert.strictEqual(status[0].registro_id, U(106));
        assert.deepStrictEqual([status[0].valor_anterior, status[0].valor_novo], ['divergencia_valor', 'aguardando_conciliacao_bancaria']);
        assert.strictEqual(db.audit_log.some(a => a.registro_id === U(104)), false, 'nota pulada não é auditada');
    });

    await teste('resposta: lista por nota na ordem pedida, com resumo', async () => {
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(1, 4, 8, 10) });
        assert.deepStrictEqual(r.corpo.itens.map(i => i.resultado), ['vinculada', 'pulada', 'recusada', 'recusada']);
        assert.deepStrictEqual(r.corpo.resumo, { vinculadas: 1, puladas: 1, recusadas: 2 });
        assert.strictEqual(r.corpo.itens[0].nome, 'nota1.pdf');
        assert.ok(r.corpo.itens.every(i => typeof i.motivo === 'string' && i.motivo.length > 0));
    });

    await teste('nota que mudou entre a leitura e a gravação não é sobrescrita (pulada)', async () => {
        antesDoPatch = (tabela) => { const n = tabela.find(l => l.id === U(101)); if (n) n.status = 'enviado_salic'; };
        const r = await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(1) });
        assert.strictEqual(resultadoDe(r, 1).resultado, 'pulada');
        assert.strictEqual(nota(1).extrato_origem_id, null);
        assert.deepStrictEqual(db.audit_log, []);
    });

    await teste('não chama o n8n nem nenhum serviço externo', async () => {
        await post('tok-gestor', { extrato_id: EXTRATO, document_ids: ids(1, 2, 6, 12), incluir_divergencias: true });
        assert.deepStrictEqual(chamadasExternas, []);
    });

    servidor.close();
    global.fetch = fetchReal;
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
