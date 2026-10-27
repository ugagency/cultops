// Teste do ajuste 1 do #125: o avanco manual nao apaga o motivo do bloqueio.
//  - servidor: POST /api/suporte/documentos/:id/avancar (server.js de verdade, Supabase falso, HTTP): o texto de
//    "[OVERRIDE SUPORTE]" ganha " Motivo original: <just_erro anterior>"; sem just_erro nao ganha; acima de
//    600 caracteres e cortado; a auditoria e o .eq('status') continuam;
//  - front: textoOverrideComMotivo e handleForcarAvanco (recortados do app.js).
// Uso: node teste-avancar-motivo-original.js
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
const DOC = U(101);
let db;
const patches = [];
function zerarBanco(extra = {}) {
    db = {
        documents: [{ id: DOC, status: 'bloqueado_conformidade', tipo_documento: 'nf', cnpj_emissor: '1', extrato_origem_id: null, project_id: U(10), just_erro: null, ...extra }],
        audit_log: [], processamento_eventos: []
    };
    patches.length = 0;
}
const USUARIOS = {
    'tok-suporte': { id: U(1), app_metadata: { role: 'admin', org_id: U(900), is_suporte: true } },
    'tok-comum': { id: U(2), app_metadata: { role: 'admin', org_id: U(900) } }
};
const fetchFalso = criarFetchFalso({
    obterDb: () => db, usuarios: USUARIOS,
    antesDoPatch: (linhas, filtros, nomeTabela) => { patches.push({ tabela: nomeTabela, filtros }); }
});
global.fetch = async (url, init) => {
    if (String(url).startsWith('http://fake.local')) return fetchFalso(String(url), init);
    throw new Error('chamada externa inesperada: ' + url);
};
const app = require('./server.js');

function avancar(porta, token, motivo = 'ocorrencia 125 teste') {
    return new Promise((resolve, reject) => {
        const dados = JSON.stringify({ motivo });
        const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/suporte/documentos/' + DOC + '/avancar', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), Authorization: 'Bearer ' + token } }, (res) => {
            let t = '';
            res.on('data', c => { t += c; });
            res.on('end', () => resolve({ status: res.statusCode, corpo: t ? JSON.parse(t) : null }));
        });
        req.on('error', reject);
        req.end(dados);
    });
}

let ok = 0, falhas = 0;
async function teste(nome, fn) {
    try { await fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio);
    assert.ok(i >= 0, inicio);
    const j = SRC.indexOf(fecho, i);
    assert.ok(j > i, inicio);
    return SRC.slice(i, j + fecho.length);
}
const ctxFront = {};
vm.createContext(ctxFront);
vm.runInContext(bloco('const LIMITE_MOTIVO_ORIGINAL = 600;', '\n}\n') + ';this.texto = textoOverrideComMotivo;', ctxFront);

(async () => {
    const servidor = http.createServer(app);
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    const porta = servidor.address().port;

    await teste('servidor: com just_erro anterior o texto gravado traz o override e " Motivo original: " com o texto anterior', async () => {
        zerarBanco({ just_erro: 'A rubrica "Hospedagem" nao e compativel com o CNAE do emissor.' });
        const r = await avancar(porta, 'tok-suporte');
        assert.strictEqual(r.status, 200);
        const gravado = db.documents[0].just_erro;
        assert.ok(gravado.startsWith('[OVERRIDE SUPORTE] Suporte avançou manualmente de "bloqueado_conformidade"'), gravado);
        assert.ok(gravado.includes(' Motivo original: A rubrica "Hospedagem" nao e compativel com o CNAE do emissor.'), gravado);
        assert.ok(gravado.endsWith('do emissor.'));
        assert.strictEqual(db.documents[0].status, 'aguardando_comprovante');
    });

    await teste('servidor: sem just_erro (nulo, vazio ou so espacos) o texto nao tem a frase', async () => {
        for (const valor of [null, '', '   ']) {
            zerarBanco({ just_erro: valor });
            const r = await avancar(porta, 'tok-suporte');
            assert.strictEqual(r.status, 200);
            const gravado = db.documents[0].just_erro;
            assert.ok(gravado.startsWith('[OVERRIDE SUPORTE]') && !gravado.includes('Motivo original'), JSON.stringify(valor) + ' -> ' + gravado);
            assert.ok(gravado.endsWith('.'));
        }
    });

    await teste('servidor: just_erro acima de 600 caracteres e cortado com reticencias', async () => {
        const longo = 'x'.repeat(2000);
        zerarBanco({ just_erro: longo });
        await avancar(porta, 'tok-suporte');
        const gravado = db.documents[0].just_erro;
        const anexo = gravado.slice(gravado.indexOf(' Motivo original: ') + ' Motivo original: '.length);
        assert.strictEqual(anexo.length, 600);
        assert.ok(anexo.endsWith('...'));
        assert.ok(!gravado.includes('x'.repeat(601)));
        // exatamente 600: sem corte
        zerarBanco({ just_erro: 'y'.repeat(600) });
        await avancar(porta, 'tok-suporte');
        assert.ok(db.documents[0].just_erro.endsWith('y'.repeat(600)) && !db.documents[0].just_erro.endsWith('...'));
    });

    await teste('servidor: o resto da rota continua (so suporte, .eq(status) no update, auditoria)', async () => {
        zerarBanco({ just_erro: 'motivo' });
        assert.strictEqual((await avancar(porta, 'tok-comum')).status, 403);
        assert.strictEqual(db.documents[0].status, 'bloqueado_conformidade');
        const r = await avancar(porta, 'tok-suporte');
        assert.strictEqual(r.status, 200);
        const patch = patches.find(p => p.tabela === 'documents');
        assert.ok(patch.filtros.some(([c, e]) => c === 'status' && e === 'eq.bloqueado_conformidade'), 'update com .eq(status)');
        assert.strictEqual(db.audit_log.length, 1);
        assert.strictEqual(db.audit_log[0].campo, 'avanco_forcado_por_suporte');
        assert.strictEqual(db.audit_log[0].valor_anterior, 'bloqueado_conformidade');
    });

    servidor.close();

    await teste('front: textoOverrideComMotivo (com motivo, sem motivo, corte em 600)', () => {
        const base = '[OVERRIDE] Gestor forçou avanço.';
        assert.strictEqual(ctxFront.texto(base, 'Rubrica recusada'), base + ' Motivo original: Rubrica recusada');
        for (const v of [null, undefined, '', '  ']) assert.strictEqual(ctxFront.texto(base, v), base);
        const longo = ctxFront.texto(base, 'z'.repeat(1000));
        const anexo = longo.slice((base + ' Motivo original: ').length);
        assert.strictEqual(anexo.length, 600);
        assert.ok(anexo.endsWith('...'));
    });

    // handleForcarAvanco com o modal real: o just_erro gravado traz o motivo do documento aberto
    async function forcar({ docAberto, bancoJustErro }) {
        const gravado = [];
        const ctx = {
            window: {}, console: { log() { }, error() { }, warn() { } },
            state: { loading: false, confirmModal: null, currentDocument: docAberto, user: { id: 'u' }, documents: [] },
            CONFIG: { N8N_WEBHOOK_VALIDATION_URL: '' }, fetch: async () => ({}),
            render() { }, showToast() { }, userCanDelete: () => true,
            carregarDatasLancamento: async () => new Map(), notaTemPagamento: () => true, MSG_INFORME_PAGAMENTO: 'x',
            fetchDocuments: async () => { }, fetchDocumentDetails: async () => { }, navigate() { },
            supabaseClient: { from: () => {
                const op = {};
                const api = {
                    select() { return api; }, update(d) { op.d = d; gravado.push(d); return api; }, eq() { return api; },
                    maybeSingle() { return Promise.resolve({ data: { just_erro: bancoJustErro }, error: null }); },
                    then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); }
                };
                return api;
            } }
        };
        ctx.window.showToast = () => { };
        vm.createContext(ctx);
        const codigo = [
            bloco('window.showConfirmModal = function', '\n};\n'), bloco('window.closeConfirmModal = function', '\n};\n'),
            bloco('window.__execConfirmModal = function', '\n};\n'),
            bloco('const LIMITE_MOTIVO_ORIGINAL = 600;', '\n}\n'),
            bloco('window.handleForcarAvanco = async function', '\n};\n')
        ].join('\n');
        vm.runInContext(codigo, ctx);
        await ctx.window.handleForcarAvanco(DOC, 'bloqueado_conformidade');
        assert.ok(ctx.state.confirmModal, 'pede confirmacao');
        ctx.window.__execConfirmModal();
        for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
        return gravado.find(g => g.status);
    }

    await teste('front: handleForcarAvanco grava o override com o motivo original do documento aberto', async () => {
        const g = await forcar({ docAberto: { id: DOC, just_erro: 'CNAE incompativel com a rubrica' }, bancoJustErro: 'nao usado' });
        assert.strictEqual(g.status, 'aguardando_comprovante');
        assert.ok(g.just_erro.startsWith('[OVERRIDE] Gestor forçou avanço manualmente a partir do status "bloqueado_conformidade"'));
        assert.ok(g.just_erro.endsWith(' Motivo original: CNAE incompativel com a rubrica'), g.just_erro);
    });

    await teste('front: sem just_erro anterior, o texto e o de hoje; sem o documento aberto, le o motivo do banco', async () => {
        let g = await forcar({ docAberto: { id: DOC, just_erro: null }, bancoJustErro: 'x' });
        assert.ok(!g.just_erro.includes('Motivo original'));
        g = await forcar({ docAberto: null, bancoJustErro: 'Motivo vindo do banco' });
        assert.ok(g.just_erro.endsWith(' Motivo original: Motivo vindo do banco'), g.just_erro);
        g = await forcar({ docAberto: { id: 'outro', just_erro: 'de outra nota' }, bancoJustErro: null });
        assert.ok(!g.just_erro.includes('Motivo original'), 'nao usa o motivo de outro documento');
    });

    console.log(`${ok} ok, ${falhas} falha(s)`);
    process.exit(falhas ? 1 : 0);
})();
