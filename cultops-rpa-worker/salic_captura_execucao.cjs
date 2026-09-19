const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Captura read-only do relatório de Execução Física do SALIC.
 * CR-2026-001 Fase 1. Login e navegação por PRONAC reaproveitados de
 * salic_insertion.cjs (origem: linhas 112-183) — mesmo fluxo de
 * autenticação e busca de projeto. Daqui em diante o script SÓ navega
 * e lê o DOM: nenhum clique em botão de ação, conforme regra inviolável
 * do projeto (SALIC não tem homologação, todo teste é em produção).
 *
 * @param {Object} config - { usuario, senha, pronac }
 * @returns {Promise<{sucesso: boolean, linhas?: Array, erro?: string}>}
 */
async function capturarExecucaoSalic(config) {
    const { usuario, senha, pronac } = config;
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    if (!usuario || typeof usuario !== 'string') throw new Error(`Usuario invalido (Tipo: ${typeof usuario})`);
    if (!senha || typeof senha !== 'string') throw new Error(`Senha invalida (Tipo: ${typeof senha})`);
    if (!pronac) throw new Error('PRONAC nao informado.');

    const isWindows = process.platform === 'win32';
    const launchOptions = {
        headless: isWindows ? false : 'new',
        slowMo: isWindows ? 50 : 0,
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ]
    };

    if (isWindows) {
        launchOptions.executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
        const chromiumPaths = [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome'
        ].filter(Boolean);
        for (const p of chromiumPaths) {
            if (fs.existsSync(p)) { launchOptions.executablePath = p; break; }
        }
    }

    console.log('[SALIC-CAPTURA] Plataforma:', process.platform, '| Chrome:', launchOptions.executablePath || 'bundled');
    const browser = await puppeteer.launch(launchOptions);

    const globalTimeoutHandle = setTimeout(async () => {
        console.error('[SALIC-CAPTURA] TIMEOUT GLOBAL: Execucao excedeu 4 minutos. Fechando browser...');
        try { await browser.close(); } catch (e) { }
    }, 240000);

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        // ── LOGIN (origem: salic_insertion.cjs linhas 112-155) ──────────────
        console.log(`[SALIC-CAPTURA] Iniciando login para o usuario: ${usuario}`);
        await page.goto('http://salic.cultura.gov.br', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#Login', { timeout: 30000 });
        await page.type('#Login', usuario, { delay: 50 });
        await wait(500);
        await page.type('#Senha', senha, { delay: 50 });
        await wait(500);

        await page.evaluate(() => {
            const botoes = Array.from(document.querySelectorAll('button'));
            const btnEntrar = botoes.find(b => b.innerText.trim().toUpperCase() === 'ENTRAR');
            if (btnEntrar) {
                btnEntrar.click();
            } else {
                document.querySelector('button[type="submit"]').click();
            }
        });

        console.log('[SALIC-CAPTURA] Botão Entrar clicado... aguardando processamento do servidor.');
        await wait(8000);
        await page.waitForFunction(() => document.body && document.body.innerText.length > 0, { timeout: 15000 }).catch(() => { });
        await wait(1000);

        const loginCheck = await page.evaluate(() => {
            if (!document.body) return { temErro: false, url: window.location.href, bodyNull: true };
            const body = (document.body.innerText || '').toLowerCase();
            const temErro = body.includes('senha inválida') || body.includes('senha invalida') ||
                body.includes('usuário não encontrado') || body.includes('usuario nao encontrado') ||
                body.includes('login incorreto') || body.includes('dados inválidos') || body.includes('tente novamente');
            return { temErro, url: window.location.href, bodyNull: false };
        });
        console.log('[SALIC-CAPTURA] Verificacao pos-login:', JSON.stringify(loginCheck));
        if (loginCheck.temErro) {
            throw new Error('Falha no login SALIC: credenciais invalidas ou usuario bloqueado.');
        }

        // ── NAVEGAÇÃO POR PRONAC (origem: salic_insertion.cjs linhas 156-183) ──
        console.log('[SALIC-CAPTURA] Navegando para a lista de projetos...');
        await page.goto('https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente', {
            waitUntil: 'domcontentloaded', timeout: 60000
        });

        await page.waitForSelector('input[aria-label="Buscar"]');
        console.log('[SALIC-CAPTURA] Buscando projeto:', pronac);
        await page.type('input[aria-label="Buscar"]', pronac);
        await wait(3000);

        const urlProjeto = await page.evaluate((p) => {
            const links = Array.from(document.querySelectorAll('table tbody tr td a'));
            const alvo = links.find(a => a.innerText.includes(p));
            return alvo ? alvo.href : null;
        }, pronac);
        if (!urlProjeto) throw new Error('Link do PRONAC nao encontrado na tabela.');

        console.log('[SALIC-CAPTURA] Navegando para os detalhes do projeto...');
        await page.goto(urlProjeto, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // ── NAVEGAÇÃO ATÉ "EXECUÇÃO FÍSICA" (somente leitura, sem análogo em salic_insertion.cjs) ──
        // Sidebar "Avaliação de Resultados" -> "Relatório de Execução Financeira" -> aba "Execução Física"
        async function clicarPorTexto(p, ...trechosBusca) {
            return await p.evaluate((trechos) => {
                const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                const alvo = trechos.map(norm);
                const allElements = Array.from(document.querySelectorAll('a, span, li, div, button'));
                for (const el of allElements) {
                    const text = norm((el.textContent || '').trim());
                    if (text.length > 0 && text.length < 200 && alvo.every(t => text.includes(t))) {
                        const clicavel = el.tagName === 'A' || el.tagName === 'BUTTON' ? el : (el.closest('a, button') || el);
                        clicavel.click();
                        return true;
                    }
                }
                return false;
            }, trechosBusca);
        }

        async function tentarClicar(...trechos) {
            for (let i = 0; i < 15; i++) {
                let clicou = await clicarPorTexto(page, ...trechos);
                if (!clicou) {
                    for (const frame of page.frames()) {
                        clicou = await clicarPorTexto(frame, ...trechos);
                        if (clicou) break;
                    }
                }
                if (clicou) return true;
                await wait(2000);
            }
            return false;
        }

        console.log('[SALIC-CAPTURA] Abrindo "Avaliação de Resultados"...');
        if (!(await tentarClicar('avaliacao', 'resultados'))) {
            throw new Error('Nao encontrei o item "Avaliacao de Resultados" na sidebar.');
        }
        await wait(2000);

        console.log('[SALIC-CAPTURA] Abrindo "Relatório de Execução Financeira"...');
        if (!(await tentarClicar('relatorio', 'execucao financeira'))) {
            throw new Error('Nao encontrei "Relatorio de Execucao Financeira".');
        }
        await wait(2000);

        console.log('[SALIC-CAPTURA] Abrindo aba "Execução Física"...');
        if (!(await tentarClicar('execucao fisica'))) {
            throw new Error('Nao encontrei a aba "Execucao Fisica".');
        }
        await wait(2000);

        // Seletor "Todos" no paginador — precisa vir ANTES de ler, senão só
        // pega a primeira página. Único "clique" desta etapa é em um <select>
        // de paginação, não em botão de ação.
        console.log('[SALIC-CAPTURA] Selecionando "Todos" no paginador...');
        const selecionouTodos = await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const sel of selects) {
                const opts = Array.from(sel.options);
                const optTodos = opts.find(o => o.textContent.trim().toLowerCase() === 'todos');
                if (optTodos) {
                    sel.value = optTodos.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        });
        if (!selecionouTodos) {
            console.warn('[SALIC-CAPTURA] AVISO: nao encontrei seletor "Todos" — pode capturar so a primeira pagina.');
        }
        await wait(2500);

        // ── LEITURA DA TABELA (v-datatable) ─────────────────────────────────
        console.log('[SALIC-CAPTURA] Lendo tabela de execução física...');
        const leitura = await page.evaluate(() => {
            const tabelas = Array.from(document.querySelectorAll('table'));
            const tabela = tabelas.find(t => {
                const headerText = (t.querySelector('thead')?.innerText || '').toLowerCase();
                return headerText.includes('etapa') && headerText.includes('executado');
            });
            if (!tabela) return { erro: 'tabela de execução física não encontrada', linhas: [] };

            const linhas = Array.from(tabela.querySelectorAll('tbody tr'))
                .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
                .filter(cols => cols.length >= 9);

            return {
                erro: null,
                linhas: linhas.map(cols => ({
                    numero: cols[0] || null,
                    etapa: cols[1] || null,
                    item: cols[2] || null,
                    unidade: cols[3] || null,
                    qtde_programada_raw: cols[4] || null,
                    vl_programado_raw: cols[5] || null,
                    pct_executado_raw: cols[6] || null,
                    vl_executado_raw: cols[7] || null,
                    pct_a_executar_raw: cols[8] || null
                }))
            };
        });

        if (leitura.erro) throw new Error('Falha ao ler tabela de execução física: ' + leitura.erro);

        // Normaliza formato BR (1.234,56) para numeric
        const parseNumBR = (s) => {
            if (s == null) return null;
            const limpo = String(s).trim().replace(/[^\d.,-]/g, '');
            if (!limpo) return null;
            const n = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
            return isNaN(n) ? null : n;
        };

        const linhas = leitura.linhas.map(l => ({
            numero: l.numero,
            etapa: l.etapa,
            item: l.item,
            unidade: l.unidade,
            qtde_programada: parseNumBR(l.qtde_programada_raw),
            vl_programado: parseNumBR(l.vl_programado_raw),
            pct_executado: parseNumBR(l.pct_executado_raw),
            vl_executado: parseNumBR(l.vl_executado_raw),
            pct_a_executar: parseNumBR(l.pct_a_executar_raw)
        }));

        console.log(`[SALIC-CAPTURA] ${linhas.length} linha(s) capturada(s).`);
        clearTimeout(globalTimeoutHandle);
        await browser.close();
        return { sucesso: true, linhas };
    } catch (err) {
        clearTimeout(globalTimeoutHandle);
        console.error('[SALIC-CAPTURA] Erro:', err.message);
        try { await browser.close(); } catch (e) { }
        return { sucesso: false, erro: err.message };
    }
}

module.exports = { capturarExecucaoSalic };
