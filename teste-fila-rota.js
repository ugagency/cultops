// Teste da fila de conciliação (POST /api/m1/cron-conciliacao-lote) com Supabase e n8n falsos em
// memória: carrega o server.js de verdade e chama o cron por HTTP. Confere a pausa por extrato de
// outro projeto (5 notas do mesmo extrato, a primeira volta com o PRONAC divergente: nenhuma outra
// é enviada), que a pausa continua nas rodadas seguintes e que ela termina quando as notas passam
// a apontar para outro extrato. Duas das provas levam alguns segundos: o espaçamento de 6 s da fila é real.
// Uso: node teste-fila-rota.js
const assert = require('assert');
const http = require('http');
const { criarFetchFalso } = require('./teste-banco-falso.js');

process.env.SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
process.env.SUPABASE_ANON_KEY = 'chave-falsa';
process.env.CRON_SECRET = 'segredo-de-teste';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PROJ = U(10);
const EXTRATO_RUIM = U(20), EXTRATO_BOM = U(21);
const MENSAGEM_PRONAC = 'Extrato de outro projeto: o PRONAC do extrato (111111) não confere com o do projeto (222222).';

let db;
let enviosAoN8n;
let respostaDoN8n;

function zerarBanco(qtdNotas, extratoDasNotas = EXTRATO_RUIM) {
    const antigo = new Date(Date.now() - 120000).toISOString();
    db = {
        extratos: [
            { id: EXTRATO_RUIM, project_id: PROJ, file_path: 'p/ruim.ofx' },
            { id: EXTRATO_BOM, project_id: PROJ, file_path: 'p/bom.ofx' }
        ],
        documents: Array.from({ length: qtdNotas }, (_, i) => ({
            id: U(100 + i), project_id: PROJ, status: 'aguardando_conciliacao_bancaria',
            extrato_origem_id: extratoDasNotas, updated_at: antigo, just_erro: null
        })),
        processamento_eventos: []
    };
    enviosAoN8n = [];
}

// O n8n falso: devolve a nota como o workflow de verdade faria e responde 200 só no fim.
const fetchFalso = criarFetchFalso({
    obterDb: () => db,
    usuarios: {},
    webhook: async (url, corpo) => {
        enviosAoN8n.push({ url, nf_id: corpo.nf_id, extrato_id: corpo.extrato_id });
        const nota = db.documents.find(d => d.id === corpo.nf_id);
        const r = respostaDoN8n(nota, corpo);
        Object.assign(nota, r.mudancas, { updated_at: new Date().toISOString() });
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
});
global.fetch = async (url, init) => fetchFalso(String(url), init);

const app = require('./server.js');
let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

function rodarCron(porta, segredo = process.env.CRON_SECRET) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/m1/cron-conciliacao-lote', method: 'POST',
            headers: { 'x-cron-secret': segredo, 'Content-Length': 0 } }, (res) => {
            let texto = '';
            res.on('data', c => { texto += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: texto ? JSON.parse(texto) : null }));
        });
        req.on('error', reject);
        req.end();
    });
}

(async () => {
    const servidor = http.createServer(app);
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const porta = servidor.address().port;

    await teste('segredo errado: 401 e nada é enviado', async () => {
        zerarBanco(2);
        respostaDoN8n = () => assert.fail('não deveria chamar o n8n');
        assert.strictEqual((await rodarCron(porta, 'errado')).status, 401);
        assert.strictEqual(enviosAoN8n.length, 0);
    });

    await teste('pausa: 5 notas do mesmo extrato, a primeira volta com PRONAC divergente: só ela é enviada', async () => {
        zerarBanco(5);
        const primeira = U(100);
        respostaDoN8n = (nota) => nota.id === primeira
            ? { mudancas: { status: 'divergencia_beneficiario', just_erro: MENSAGEM_PRONAC } }
            : { mudancas: { status: 'aguardando_d3' } };
        const r = await rodarCron(porta);
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(enviosAoN8n.map(e => e.nf_id), [primeira], 'nenhuma outra nota foi ao n8n');
        // o evento de pausa guarda o id do EXTRATO
        const pausas = db.processamento_eventos.filter(e => e.acao === 'conciliacao_extrato_pausado');
        assert.strictEqual(pausas.length, 1);
        assert.strictEqual(pausas[0].registro_id, EXTRATO_RUIM);
        assert.strictEqual(pausas[0].entidade, 'extratos');
        assert.strictEqual(r.corpo.disparadas, 1);
        assert.strictEqual(r.corpo.puladas_por_pausa, 4);
        assert.strictEqual(r.corpo.extratos_pausados, 1);
        // as outras notas continuam na fila, intactas
        assert.strictEqual(db.documents.filter(d => d.status === 'aguardando_conciliacao_bancaria').length, 4);
    });

    await teste('pausa continua nas rodadas seguintes: o extrato pausado não recebe mais nenhuma nota', async () => {
        // estado deixado pelo teste anterior: 4 notas na fila e o evento de pausa gravado
        enviosAoN8n = [];
        respostaDoN8n = () => assert.fail('extrato pausado não pode receber notas');
        const r = await rodarCron(porta);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(enviosAoN8n.length, 0);
        assert.strictEqual(r.corpo.disparadas, 0);
        assert.strictEqual(r.corpo.puladas_por_pausa, 4);
        assert.strictEqual(r.corpo.aguardando_na_fila, 4, 'as notas seguem aguardando, para quando o extrato for trocado');
    });

    await teste('a pausa termina quando o extrato é trocado nas notas: elas voltam a ser enviadas (com 6 s entre elas)', async () => {
        // as 4 notas aguardando passam a apontar para outro extrato; só 2 delas, para a prova levar ~6 s
        const aguardando = db.documents.filter(d => d.status === 'aguardando_conciliacao_bancaria').slice(0, 2);
        const antigo = new Date(Date.now() - 120000).toISOString();
        db.documents = aguardando; // as demais saem da cena
        aguardando.forEach(d => { d.extrato_origem_id = EXTRATO_BOM; d.updated_at = antigo; });
        enviosAoN8n = [];
        respostaDoN8n = () => ({ mudancas: { status: 'aguardando_d3' } });
        const t0 = Date.now();
        const r = await rodarCron(porta);
        const duracao = Date.now() - t0;
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(enviosAoN8n.map(e => e.extrato_id), [EXTRATO_BOM, EXTRATO_BOM]);
        assert.strictEqual(r.corpo.disparadas, 2);
        assert.strictEqual(r.corpo.puladas_por_pausa, 0);
        assert.ok(duracao >= 5900, 'o segundo envio espera 6 s do início do primeiro (levou ' + duracao + ' ms)');
        assert.strictEqual(db.processamento_eventos.filter(e => e.acao === 'conciliacao_extrato_pausado').length, 1, 'não há nova pausa');
    });

    await teste('mensagem de PRONAC só pausa quando começa com "Extrato de outro projeto"', async () => {
        zerarBanco(3);
        respostaDoN8n = () => ({ mudancas: { status: 'divergencia_valor', just_erro: 'Há 2 lançamentos que atendem às regras' } });
        const r = await rodarCron(porta);
        assert.strictEqual(r.corpo.extratos_pausados, 0);
        assert.strictEqual(db.processamento_eventos.filter(e => e.acao === 'conciliacao_extrato_pausado').length, 0);
    });

    servidor.close();
    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
