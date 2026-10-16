const fs = require('fs');
const puppeteerPadrao = require('puppeteer');
const { mascararCpf } = require('./salic_proponente.cjs');

// ── VALIDAÇÃO DE CREDENCIAL SALIC (ocorrência #64) ───────────────────────────────────
//
// Até aqui o CPF e a senha do SALIC eram salvos sem teste e só falhavam no primeiro
// envio. Este módulo abre o SALIC, faz SÓ o login (mesmo fluxo do robô de inserção:
// #Login, #Senha e o botão ENTRAR, nunca o Gov.br) e para: sem listar projetos, sem
// PRONAC, sem documento. Resultado:
//   'ok'            saiu da tela de login E há indício de sessão (link de sair etc.)
//   'invalida'      depois do clique e da espera a página continuou em /autenticacao/ ou
//                   exibe mensagem explícita de credencial inválida
//   'indeterminada' qualquer outra coisa: timeout, erro de rede, página inesperada,
//                   exceção. Falha técnica NUNCA vira 'invalida'.
// Nunca registra a senha nem o CPF inteiro (mascararCpf).

const URL_LOGIN = 'http://salic.cultura.gov.br';
const URL_AUTENTICACAO = /\/autenticacao\//i;

// Mesmos termos do robô de inserção para recusa explícita, menos "tente novamente",
// que também aparece em avisos técnicos e não prova credencial errada.
const TERMOS_CREDENCIAL_INVALIDA = [
    'senha inválida', 'senha invalida', 'usuário não encontrado', 'usuario nao encontrado',
    'login incorreto', 'dados inválidos'
];

const pausa = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Mesmas opções de lançamento do robô de inserção (salic_insertion.cjs), copiadas porque
// aquele arquivo não pode ser alterado e não as exporta.
function opcoesDeLancamento() {
    const isWindows = process.platform === 'win32';
    const launchOptions = {
        headless: isWindows ? false : 'new',
        slowMo: isWindows ? 50 : 0,
        ignoreHTTPSErrors: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
    };
    if (isWindows) {
        launchOptions.executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
        const caminhos = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
        for (const p of caminhos) {
            if (fs.existsSync(p)) { launchOptions.executablePath = p; break; }
        }
    }
    return launchOptions;
}

// Lê a tela depois do clique em ENTRAR. Devolve null se a página está trocando (contexto
// destruído): o polling segue e tenta de novo.
async function lerTelaPosLogin(page) {
    try {
        return await page.evaluate((termos) => {
            if (!document.body) return { url: window.location.href, corpoVazio: true, temErro: false, temSessao: false };
            const texto = (document.body.innerText || '').toLowerCase();
            return {
                url: window.location.href,
                corpoVazio: texto.length === 0,
                temErro: termos.some(t => texto.includes(t)),
                temSessao: !!document.querySelector('a[href*="sair"], a[href*="logout"], .user-info, .usuario, .nav-wrapper .brand-logo')
            };
        }, TERMOS_CREDENCIAL_INVALIDA);
    } catch (e) {
        return null;
    }
}

// Decisão a partir da leitura. null = ainda sem conclusão (continua esperando).
function classificarTela(tela) {
    if (!tela) return null;
    const naTelaDeLogin = URL_AUTENTICACAO.test(tela.url || '');
    if (tela.temErro) return { status: 'invalida', motivo: 'O SALIC recusou o login com mensagem de credencial inválida.' };
    if (!naTelaDeLogin && tela.temSessao) return { status: 'ok', motivo: 'Login aceito pelo SALIC.' };
    return null;
}

// Fecha o navegador sem segurar a resposta: se o close demorar (ex.: requisição pendurada),
// derruba o processo depois do limite.
async function fecharNavegador(browser, limiteMs = 3000) {
    try {
        await Promise.race([browser.close(), pausa(limiteMs).then(() => { throw new Error('fechamento lento'); })]);
    } catch (e) {
        try { const proc = browser.process && browser.process(); if (proc) proc.kill('SIGKILL'); } catch (e2) { }
    }
}

async function sairDoSalic(page) {
    try {
        await page.evaluate(() => {
            const link = document.querySelector('a[href*="sair"], a[href*="logout"]');
            if (link) link.click();
        });
        await pausa(1500);
    } catch (e) { /* o navegador fecha logo depois; sair é só boa educação com o SALIC */ }
}

async function fluxoDeLogin(page, usuario, senha, t, log) {
    await page.goto(t.urlLogin, { waitUntil: 'domcontentloaded', timeout: t.gotoMs });
    try {
        await page.waitForSelector('#Login', { timeout: t.loginMs });
    } catch (e) {
        return { status: 'indeterminada', motivo: 'A tela de login do SALIC não carregou.' };
    }
    await page.type('#Login', usuario, { delay: t.digitacaoMs });
    await pausa(t.pausaMs);
    await page.type('#Senha', senha, { delay: t.digitacaoMs });
    await pausa(t.pausaMs);

    // Clica no botão ENTRAR (e não no Gov.br), como o robô de inserção.
    let clicou;
    try {
        clicou = await page.evaluate(() => {
            const btnEntrar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toUpperCase() === 'ENTRAR');
            const alvo = btnEntrar || document.querySelector('button[type="submit"]');
            if (!alvo) return false;
            alvo.click();
            return true;
        });
    } catch (e) {
        // O clique navega a página: se o SALIC responder antes de o evaluate devolver, o
        // contexto é destruído. Isso é o clique funcionando, não uma falha.
        if (!/context was destroyed|navigation/i.test(String(e && e.message))) throw e;
        clicou = true;
    }
    if (!clicou) return { status: 'indeterminada', motivo: 'O botão ENTRAR não foi encontrado na tela do SALIC.' };
    log('[SALIC-VALIDAR] Botao Entrar clicado, aguardando o SALIC.');

    // Polling até o prazo: conclui assim que há recusa explícita ou sessão confirmada.
    const inicio = Date.now();
    let ultima = null;
    for (; ;) {
        const tela = await lerTelaPosLogin(page);
        if (tela) ultima = tela;
        const decisao = classificarTela(tela);
        if (decisao) return decisao;
        if (Date.now() - inicio >= t.esperaLoginMs) break;
        await pausa(t.intervaloMs);
    }

    // Prazo esgotado sem sessão nem mensagem. Continuar na tela de autenticação com a página
    // renderizada é o sinal de recusa que o SALIC dá (ocorrência #58); qualquer outra coisa
    // (página em branco, tela inesperada, saiu do login sem sessão) é indeterminada.
    if (ultima && URL_AUTENTICACAO.test(ultima.url || '') && !ultima.corpoVazio) {
        return { status: 'invalida', motivo: 'A página continuou na tela de login depois de enviar a credencial.' };
    }
    if (ultima && !URL_AUTENTICACAO.test(ultima.url || '')) {
        return { status: 'indeterminada', motivo: 'Saiu da tela de login, mas sem indício de sessão.' };
    }
    return { status: 'indeterminada', motivo: 'Não foi possível ler a resposta do SALIC.' };
}

/**
 * @param {string} usuario CPF/login do SALIC
 * @param {string} senha
 * @param {object} [opcoes] só para testes: puppeteer, launchOptions, configurarPagina(page), tempos, log
 * @returns {Promise<{status: 'ok'|'invalida'|'indeterminada', motivo: string}>} nunca lança
 */
async function validarLoginSalic(usuario, senha, opcoes = {}) {
    const log = opcoes.log || ((m) => console.log(m));
    const t = {
        urlLogin: URL_LOGIN, totalMs: 90000, gotoMs: 30000, loginMs: 20000, esperaLoginMs: 20000,
        intervaloMs: 500, digitacaoMs: 50, pausaMs: 500, ...(opcoes.tempos || {})
    };
    if (typeof usuario !== 'string' || !usuario || typeof senha !== 'string' || !senha) {
        return { status: 'indeterminada', motivo: 'Credencial incompleta.' };
    }

    let browser = null;
    let temporizador = null;
    let encerrado = false;
    try {
        log(`[SALIC-VALIDAR] Validando login do usuario ${mascararCpf(usuario)}`);
        const puppeteer = opcoes.puppeteer || puppeteerPadrao;

        // Timeout global (inclui abrir o navegador): estourou, a resposta é "indeterminada" e o
        // navegador fecha no finally.
        const estouro = new Promise((resolve) => {
            temporizador = setTimeout(() => resolve({ status: 'indeterminada', motivo: 'O SALIC demorou demais para responder (tempo limite da validação).' }), t.totalMs);
        });
        const trabalho = (async () => {
            const aberto = await puppeteer.launch({ ...opcoesDeLancamento(), ...(opcoes.launchOptions || {}) });
            browser = aberto;
            // Se o tempo já estourou enquanto o navegador abria, não deixa instância órfã.
            if (encerrado) { try { await aberto.close(); } catch (e) { } throw new Error('cancelado'); }
            const page = await aberto.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 800 });
            if (opcoes.configurarPagina) await opcoes.configurarPagina(page);
            const r = await fluxoDeLogin(page, usuario, senha, t, log);
            if (r.status === 'ok') await sairDoSalic(page);
            return r;
        })();
        trabalho.catch(() => { }); // se o timeout vencer, o fechamento do navegador derruba o fluxo: sem rejeição solta
        const resultado = await Promise.race([trabalho, estouro]);

        log(`[SALIC-VALIDAR] Resultado para ${mascararCpf(usuario)}: ${resultado.status}`);
        return resultado;
    } catch (erro) {
        // Falha técnica (rede, navegador, página inesperada): nunca "invalida".
        log(`[SALIC-VALIDAR] Falha tecnica para ${mascararCpf(usuario)}: ${erro && erro.name ? erro.name : 'erro'}`);
        return { status: 'indeterminada', motivo: 'Não foi possível concluir o teste de login no SALIC.' };
    } finally {
        encerrado = true;
        if (temporizador) clearTimeout(temporizador);
        if (browser) await fecharNavegador(browser);
    }
}

// ── Trava de navegador e limite por usuário ──────────────────────────────────────────

/**
 * Controle de uso do navegador no processo. A validação é EXCLUSIVA: só começa se nenhum
 * envio, captura ou outra validação estiver rodando. Envio e captura continuam sem fila
 * entre si (como antes), mas se uma validação estiver em curso esperam ela terminar (no
 * máximo o timeout dela) em vez de abrir um segundo navegador.
 */
function criarControleDeNavegador() {
    let execucoes = 0;
    let validacao = null;
    return {
        ocupado() { return execucoes > 0 || validacao !== null; },
        // Envio/captura: marca o navegador como em uso durante fn.
        async executar(fn) {
            while (validacao) { try { await validacao; } catch (e) { } }
            execucoes++; // sem await entre o teste acima e este incremento
            try { return await fn(); } finally { execucoes--; }
        },
        // Validação: devolve { ocupado: true } sem rodar se algo estiver em uso. A trava é
        // liberada no finally, qualquer que seja o resultado.
        async tentarValidacao(fn) {
            if (execucoes > 0 || validacao !== null) return { ocupado: true };
            const execucao = Promise.resolve().then(fn);
            validacao = execucao;
            try {
                return { ocupado: false, resultado: await execucao };
            } finally {
                if (validacao === execucao) validacao = null;
            }
        }
    };
}

function lerLimiteDoAmbiente(env = process.env) {
    const inteiroPositivo = (v, padrao) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : padrao; };
    return {
        max: inteiroPositivo(env.SALIC_VALIDAR_MAX, 3),
        janelaMs: inteiroPositivo(env.SALIC_VALIDAR_JANELA_MIN, 15) * 60 * 1000
    };
}

// Limite por usuário, em memória: no máximo `max` validações por janela.
function criarLimitadorPorUsuario({ max, janelaMs, agora = () => Date.now() }) {
    const porUsuario = new Map();
    const recentes = (userId) => {
        const limite = agora() - janelaMs;
        const lista = (porUsuario.get(userId) || []).filter(ts => ts > limite);
        if (lista.length) porUsuario.set(userId, lista); else porUsuario.delete(userId);
        return lista;
    };
    return {
        consultar(userId) {
            const lista = recentes(userId);
            if (lista.length < max) return { ok: true };
            return { ok: false, tentarEm: Math.max(1, Math.ceil((lista[0] + janelaMs - agora()) / 1000)) };
        },
        registrar(userId) {
            const lista = recentes(userId);
            lista.push(agora());
            porUsuario.set(userId, lista);
        }
    };
}

// Handler da rota POST /api/salic/validar-credencial (depois do middleware de autenticação,
// que preenche req.userId). Não loga o corpo.
function criarHandlerValidarCredencial({ controle, limitador, validar = validarLoginSalic, log = (m) => console.log(m) }) {
    return async (req, res) => {
        const corpo = req.body || {};
        const { usuario, senha } = corpo;
        if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario.trim() || !senha
            || usuario.length > 64 || senha.length > 64) {
            return res.status(400).json({ error: 'Informe usuario e senha (texto, até 64 caracteres cada).' });
        }

        const limite = limitador.consultar(req.userId);
        if (!limite.ok) return res.status(429).json({ status: 'limite', tentarEm: limite.tentarEm });
        if (controle.ocupado()) return res.status(429).json({ status: 'ocupado' });

        // Daqui até tentarValidacao não há await: a checagem e a trava são atômicas.
        limitador.registrar(req.userId);
        try {
            const execucao = await controle.tentarValidacao(() => validar(usuario, senha));
            if (execucao.ocupado) return res.status(429).json({ status: 'ocupado' });
            const { status, motivo } = execucao.resultado;
            return res.json({ status, motivo });
        } catch (erro) {
            log(`[SALIC-VALIDAR] Erro inesperado na rota: ${erro && erro.name ? erro.name : 'erro'}`);
            return res.json({ status: 'indeterminada', motivo: 'Não foi possível concluir o teste de login no SALIC.' });
        }
    };
}

module.exports = {
    validarLoginSalic,
    classificarTela,
    criarControleDeNavegador,
    criarLimitadorPorUsuario,
    lerLimiteDoAmbiente,
    criarHandlerValidarCredencial
};
