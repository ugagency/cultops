// Testes de salic_validar_login.cjs — nao acessam o SALIC.
// Rodar: node teste_validar_login.cjs
// Parte 1 (logica pura): limite por usuario, controle de navegador e handler da rota.
// Parte 2 (navegador): um "SALIC" falso servido pela interceptacao de requisicoes do
// puppeteer (nada sai para a rede); so roda se o puppeteer abrir um Chrome/Chromium local
// (CHROME_PATH), senao e pulada.
const assert = require('node:assert/strict');
const {
    validarLoginSalic, classificarTela, criarControleDeNavegador, criarLimitadorPorUsuario,
    lerLimiteDoAmbiente, criarHandlerValidarCredencial
} = require('./salic_validar_login.cjs');

let falhas = 0;
async function caso(nome, fn) {
    try { await fn(); console.log('ok   -', nome); }
    catch (e) { falhas++; console.log('FALHA -', nome, '\n      ', e.message); }
}
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function resFalso() {
    const res = { codigo: 200, corpo: null };
    res.status = (c) => { res.codigo = c; return res; };
    res.json = (b) => { res.corpo = b; return res; };
    return res;
}

(async () => {
    // ── limite por usuario ──
    await caso('limite: 3 por janela, a 4a vem com tentarEm em segundos', () => {
        let agora = 1000000;
        const l = criarLimitadorPorUsuario({ max: 3, janelaMs: 15 * 60 * 1000, agora: () => agora });
        for (let i = 0; i < 3; i++) { assert.equal(l.consultar('u1').ok, true); l.registrar('u1'); agora += 1000; }
        const r = l.consultar('u1');
        assert.equal(r.ok, false);
        assert.equal(r.tentarEm, 15 * 60 - 3, 'faltam 897s para a 1a tentativa sair da janela');
    });
    await caso('limite: a janela anda (a tentativa mais antiga expira) e usuarios sao independentes', () => {
        let agora = 0;
        const l = criarLimitadorPorUsuario({ max: 2, janelaMs: 60000, agora: () => agora });
        l.registrar('a'); agora = 10000; l.registrar('a');
        assert.equal(l.consultar('a').ok, false);
        assert.equal(l.consultar('b').ok, true);
        agora = 60001;
        assert.equal(l.consultar('a').ok, true, 'a 1a saiu da janela');
        l.registrar('a');
        assert.equal(l.consultar('a').ok, false);
    });
    await caso('limite: consultar nao consome tentativa', () => {
        const l = criarLimitadorPorUsuario({ max: 1, janelaMs: 60000 });
        for (let i = 0; i < 5; i++) assert.equal(l.consultar('x').ok, true);
    });
    await caso('ambiente: padroes 3 / 15 min e leitura de SALIC_VALIDAR_MAX / SALIC_VALIDAR_JANELA_MIN', () => {
        assert.deepEqual(lerLimiteDoAmbiente({}), { max: 3, janelaMs: 15 * 60000 });
        assert.deepEqual(lerLimiteDoAmbiente({ SALIC_VALIDAR_MAX: '5', SALIC_VALIDAR_JANELA_MIN: '2' }), { max: 5, janelaMs: 2 * 60000 });
        assert.deepEqual(lerLimiteDoAmbiente({ SALIC_VALIDAR_MAX: 'abc', SALIC_VALIDAR_JANELA_MIN: '0' }), { max: 3, janelaMs: 15 * 60000 }, 'valor invalido volta ao padrao');
        assert.deepEqual(lerLimiteDoAmbiente({ SALIC_VALIDAR_MAX: '-4' }), { max: 3, janelaMs: 15 * 60000 });
    });

    // ── controle de navegador ──
    await caso('controle: validacao so roda com tudo livre; ocupado durante envio/captura', async () => {
        const c = criarControleDeNavegador();
        let liberar; const longa = new Promise(r => { liberar = r; });
        const envio = c.executar(() => longa);
        await esperar(10);
        assert.equal(c.ocupado(), true);
        const r = await c.tentarValidacao(async () => 'x');
        assert.deepEqual(r, { ocupado: true });
        liberar(); await envio;
        assert.equal(c.ocupado(), false);
        assert.deepEqual(await c.tentarValidacao(async () => 'ok'), { ocupado: false, resultado: 'ok' });
    });
    await caso('controle: segunda validacao simultanea e recusada; envio espera a validacao terminar', async () => {
        const c = criarControleDeNavegador();
        let liberar; const longa = new Promise(r => { liberar = r; });
        const v1 = c.tentarValidacao(() => longa);
        await esperar(10);
        assert.deepEqual(await c.tentarValidacao(async () => 'x'), { ocupado: true });
        const ordem = [];
        const envio = c.executar(async () => { ordem.push('envio'); });
        await esperar(30);
        assert.deepEqual(ordem, [], 'o envio ainda espera a validacao');
        ordem.push('validacao terminou'); liberar(); await v1; await envio;
        assert.deepEqual(ordem, ['validacao terminou', 'envio']);
    });
    await caso('controle: a trava e liberada quando a validacao ou o envio falham', async () => {
        const c = criarControleDeNavegador();
        await assert.rejects(c.tentarValidacao(async () => { throw new Error('boom'); }), /boom/);
        assert.equal(c.ocupado(), false);
        await assert.rejects(c.executar(async () => { throw new Error('boom2'); }), /boom2/);
        assert.equal(c.ocupado(), false);
        assert.deepEqual(await c.tentarValidacao(async () => 1), { ocupado: false, resultado: 1 });
    });
    await caso('controle: envios continuam sem fila entre si (comportamento de antes)', async () => {
        const c = criarControleDeNavegador();
        let simultaneos = 0, pico = 0;
        const um = () => c.executar(async () => { simultaneos++; pico = Math.max(pico, simultaneos); await esperar(30); simultaneos--; });
        await Promise.all([um(), um()]);
        assert.equal(pico, 2);
    });

    // ── handler da rota ──
    const montar = (extra = {}) => {
        const controle = criarControleDeNavegador();
        const limitador = criarLimitadorPorUsuario({ max: 3, janelaMs: 900000 });
        const linhas = [];
        const validar = extra.validar || (async () => ({ status: 'ok', motivo: 'Login aceito pelo SALIC.' }));
        return { controle, limitador, linhas, handler: criarHandlerValidarCredencial({ controle, limitador, validar, log: (m) => linhas.push(m) }) };
    };
    const chamar = async (h, corpo, userId = 'u1') => { const res = resFalso(); await h.handler({ body: corpo, userId }, res); return res; };

    await caso('rota: corpo invalido (tipo, vazio, mais de 64 caracteres) responde 400 e nao gasta tentativa', async () => {
        const h = montar();
        for (const corpo of [undefined, {}, { usuario: 1, senha: 'a' }, { usuario: '123', senha: null }, { usuario: '  ', senha: 'x' }, { usuario: '123', senha: '' },
            { usuario: 'a'.repeat(65), senha: 'x' }, { usuario: '123', senha: 'x'.repeat(65) }]) {
            const r = await chamar(h, corpo);
            assert.equal(r.codigo, 400, JSON.stringify(corpo));
        }
        assert.equal(h.limitador.consultar('u1').ok, true);
        assert.ok((await chamar(h, { usuario: 'a'.repeat(64), senha: 'x'.repeat(64) })).codigo === 200, '64 caracteres e aceito');
    });
    await caso('rota: ok, invalida e indeterminada voltam como 200 com status e motivo', async () => {
        for (const st of ['ok', 'invalida', 'indeterminada']) {
            const h = montar({ validar: async () => ({ status: st, motivo: 'm-' + st }) });
            const r = await chamar(h, { usuario: '12345678909', senha: 'segredo' });
            assert.equal(r.codigo, 200);
            assert.deepEqual(r.corpo, { status: st, motivo: 'm-' + st });
        }
    });
    await caso('rota: 4a validacao em 15 min responde 429 limite com tentarEm', async () => {
        const h = montar();
        for (let i = 0; i < 3; i++) assert.equal((await chamar(h, { usuario: '1', senha: '2' })).codigo, 200);
        const r = await chamar(h, { usuario: '1', senha: '2' });
        assert.equal(r.codigo, 429);
        assert.equal(r.corpo.status, 'limite');
        assert.ok(r.corpo.tentarEm > 0 && r.corpo.tentarEm <= 900, 'tentarEm=' + r.corpo.tentarEm);
        assert.equal((await chamar(h, { usuario: '1', senha: '2' }, 'outro')).codigo, 200, 'outro usuario nao e afetado');
    });
    await caso('rota: ocupado (envio em andamento) responde 429 ocupado e nao consome a cota', async () => {
        const h = montar();
        let liberar; const longa = new Promise(r => { liberar = r; });
        const envio = h.controle.executar(() => longa);
        await esperar(10);
        for (let i = 0; i < 5; i++) {
            const r = await chamar(h, { usuario: '1', senha: '2' });
            assert.equal(r.codigo, 429); assert.deepEqual(r.corpo, { status: 'ocupado' });
        }
        liberar(); await envio;
        assert.equal((await chamar(h, { usuario: '1', senha: '2' })).codigo, 200, 'a cota nao foi gasta pelas respostas "ocupado"');
    });
    await caso('rota: duas validacoes ao mesmo tempo: a segunda recebe ocupado', async () => {
        let liberar; const longa = new Promise(r => { liberar = r; });
        const h = montar({ validar: () => longa.then(() => ({ status: 'ok', motivo: 'x' })) });
        const p1 = chamar(h, { usuario: '1', senha: '2' }, 'a');
        await esperar(10);
        const r2 = await chamar(h, { usuario: '3', senha: '4' }, 'b');
        assert.equal(r2.codigo, 429); assert.deepEqual(r2.corpo, { status: 'ocupado' });
        liberar(); assert.equal((await p1).codigo, 200);
    });
    await caso('rota: se o validador lancar, responde indeterminada e libera a trava', async () => {
        const h = montar({ validar: async () => { throw new Error('quebrou'); } });
        const r = await chamar(h, { usuario: '1', senha: '2' });
        assert.equal(r.codigo, 200); assert.equal(r.corpo.status, 'indeterminada');
        assert.equal(h.controle.ocupado(), false);
        assert.ok(!r.corpo.motivo.includes('quebrou'));
    });
    await caso('rota: o log nao contem senha nem o corpo', async () => {
        const h = montar();
        await chamar(h, { usuario: '12345678909', senha: 'SenhaMuitoSecreta' });
        assert.ok(h.linhas.every(l => !l.includes('SenhaMuitoSecreta') && !l.includes('12345678909')));
    });
    await caso('classificarTela: so e ok com sessao fora de /autenticacao/; mensagem explicita e invalida; resto e null', () => {
        assert.equal(classificarTela({ url: 'http://x/comunicados-proponente/', temSessao: true, temErro: false }).status, 'ok');
        assert.equal(classificarTela({ url: 'http://x/autenticacao/index/index', temSessao: true, temErro: false }), null, 'sessao na tela de login nao basta');
        assert.equal(classificarTela({ url: 'http://x/comunicados-proponente/', temSessao: false, temErro: false }), null);
        assert.equal(classificarTela({ url: 'http://x/autenticacao/index/index', temSessao: false, temErro: true }).status, 'invalida');
        assert.equal(classificarTela(null), null);
    });

    // ── navegador, com um SALIC falso ──
    let puppeteer;
    try { puppeteer = require('puppeteer'); } catch (e) { }
    if (!puppeteer) { console.log('pulado - puppeteer nao instalado (use NODE_PATH)'); }
    else {
        const lancamento = { headless: 'new', slowMo: 0, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] };
        const TEMPOS = { totalMs: 8000, gotoMs: 3000, loginMs: 1500, esperaLoginMs: 2000, intervaloMs: 100, digitacaoMs: 0, pausaMs: 20 };
        const FORM = (msg = '', botao = 'ENTRAR', destino = '/autenticacao/index/index') => `<html><body>
            <h1>SALIC</h1>${msg ? `<p class="erro">${msg}</p>` : ''}
            <input id="Login"><input id="Senha" type="password">
            <button type="button" onclick="location.href='${destino}'">${botao}</button>
            <button type="button">Gov.br</button></body></html>`;
        const HOME = '<html><body><div class="nav-wrapper"><a class="brand-logo">SALIC</a></div><a href="/autenticacao/sair">Sair</a><p>Bem-vindo</p></body></html>';

        // cenario: { raiz: html da pagina inicial, rotas: { '/caminho': html }, abortarRaiz, segurarRaiz }
        async function rodar(cenario, usuario = '12345678909', senha = 'SenhaSecreta#1', extra = {}) {
            const linhas = []; const pedidos = []; let browserRef = null;
            const envolto = { launch: async (o) => { browserRef = await puppeteer.launch(o); return browserRef; } };
            const resultado = await validarLoginSalic(usuario, senha, {
                puppeteer: envolto, launchOptions: lancamento, tempos: { ...TEMPOS, ...(extra.tempos || {}) }, log: (m) => linhas.push(m),
                configurarPagina: async (page) => {
                    await page.setRequestInterception(true);
                    page.on('request', async (req) => {
                        const u = new URL(req.url());
                        if (u.hostname !== 'salic.cultura.gov.br') return req.abort();
                        pedidos.push(u.pathname);
                        if (u.pathname === '/') {
                            if (cenario.abortarRaiz) return req.abort();
                            if (cenario.segurarRaiz) return; // nunca responde
                            return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: cenario.raiz });
                        }
                        const corpo = (cenario.rotas || {})[u.pathname];
                        return req.respond({ status: corpo ? 200 : 404, contentType: 'text/html; charset=utf-8', body: corpo || '<p>404</p>' });
                    });
                }
            });
            await esperar(50);
            return { resultado, linhas, pedidos, desconectado: browserRef ? !browserRef.isConnected() : null };
        }
        const semSegredos = (r) => r.linhas.every(l => !l.includes('SenhaSecreta#1') && !l.includes('12345678909'));

        await caso('login aceito: sai da tela de login, ha sessao -> ok; clica em Sair e fecha o navegador', async () => {
            const r = await rodar({ raiz: FORM('', 'ENTRAR', '/comunicados-proponente/home'), rotas: { '/comunicados-proponente/home': HOME, '/autenticacao/sair': FORM() } });
            assert.equal(r.resultado.status, 'ok');
            assert.ok(r.pedidos.includes('/autenticacao/sair'), 'clicou em Sair: ' + r.pedidos);
            assert.equal(r.desconectado, true, 'navegador fechado');
            assert.ok(semSegredos(r), 'sem senha/CPF inteiro no log');
        });
        await caso('mensagem explicita de senha invalida -> invalida', async () => {
            const r = await rodar({ raiz: FORM('', 'ENTRAR', '/autenticacao/index/index'), rotas: { '/autenticacao/index/index': FORM('Senha inválida') } });
            assert.equal(r.resultado.status, 'invalida');
            assert.match(r.resultado.motivo, /mensagem/);
            assert.equal(r.desconectado, true);
        });
        await caso('continuou na tela de login sem mensagem -> invalida (apos a espera)', async () => {
            const r = await rodar({ raiz: FORM('', 'ENTRAR', '/autenticacao/index/index'), rotas: { '/autenticacao/index/index': FORM() } });
            assert.equal(r.resultado.status, 'invalida');
            assert.match(r.resultado.motivo, /continuou na tela de login/);
            assert.ok(semSegredos(r));
        });
        await caso('"tente novamente" sozinho nao prova credencial errada (continua so pela URL)', async () => {
            const r = await rodar({ raiz: FORM('', 'ENTRAR', '/comunicados-proponente/home'), rotas: { '/comunicados-proponente/home': '<html><body><p>Serviço indisponível, tente novamente mais tarde.</p></body></html>' } });
            assert.equal(r.resultado.status, 'indeterminada');
        });
        await caso('saiu da tela de login mas sem indicio de sessao -> indeterminada', async () => {
            const r = await rodar({ raiz: FORM('', 'ENTRAR', '/outra/pagina'), rotas: { '/outra/pagina': '<html><body><p>Pagina inesperada</p></body></html>' } });
            assert.equal(r.resultado.status, 'indeterminada');
            assert.match(r.resultado.motivo, /sem indício de sessão/);
        });
        await caso('erro de rede ao abrir o SALIC -> indeterminada (nunca invalida)', async () => {
            const r = await rodar({ abortarRaiz: true });
            assert.equal(r.resultado.status, 'indeterminada');
            assert.equal(r.desconectado, true);
        });
        await caso('tela de login nao carrega o campo #Login -> indeterminada', async () => {
            const r = await rodar({ raiz: '<html><body><p>manutencao</p></body></html>' });
            assert.equal(r.resultado.status, 'indeterminada');
        });
        await caso('botao ENTRAR ausente -> indeterminada', async () => {
            const r = await rodar({ raiz: '<html><body><input id="Login"><input id="Senha"></body></html>' });
            assert.equal(r.resultado.status, 'indeterminada');
            assert.match(r.resultado.motivo, /ENTRAR/);
        });
        await caso('SALIC que nao responde: timeout global -> indeterminada, navegador fechado', async () => {
            const inicio = Date.now();
            const r = await rodar({ segurarRaiz: true }, '12345678909', 'SenhaSecreta#1', { tempos: { totalMs: 1500, gotoMs: 20000 } });
            assert.equal(r.resultado.status, 'indeterminada');
            assert.match(r.resultado.motivo, /tempo limite/);
            assert.ok(Date.now() - inicio < 7500, 'levou ' + (Date.now() - inicio) + 'ms');
            assert.equal(r.desconectado, true);
        });
        await caso('credencial incompleta nao abre navegador', async () => {
            let abriu = false;
            const r = await validarLoginSalic('', 'x', { puppeteer: { launch: async () => { abriu = true; } }, log: () => { } });
            assert.equal(r.status, 'indeterminada'); assert.equal(abriu, false);
        });
        await caso('o navegador nao abre (ex.: Chrome ausente) -> indeterminada, sem lancar', async () => {
            const r = await validarLoginSalic('123', 'x', { puppeteer: { launch: async () => { throw new Error('sem chrome'); } }, log: () => { } });
            assert.equal(r.status, 'indeterminada');
            assert.ok(!r.motivo.includes('sem chrome'));
        });
    }

    console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
})();
