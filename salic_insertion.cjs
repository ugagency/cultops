const puppeteer = require('puppeteer');

/**
 * Script de Inserção de Comprovação Financeira no SALIC
 * @param {Object} config - Objeto com credenciais e dados da despesa
 */
async function executarInsercaoSalic(config) {
    const { usuario, senha, pronac, rubricaNome, documento } = config;
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const browser = config.browserWSEndpoint
        ? await puppeteer.connect({ browserWSEndpoint: config.browserWSEndpoint })
        : await puppeteer.launch({
            headless: false, // Mantenha false para acompanhar o robô no Windows
            slowMo: 50,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

    let targetPage;
    try {
        const page = config.browserWSEndpoint ? (await browser.pages())[0] : await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`[SALIC] Iniciando login para o usuário: ${usuario} (Tipo: ${typeof usuario})`);
        console.log(`[SALIC] Tipo da Senha recebida: ${typeof senha}`);

        if (!usuario || typeof usuario !== 'string') {
            throw new Error(`Usuário inválido ou não informado (Tipo: ${typeof usuario})`);
        }
        if (!senha || typeof senha !== 'string') {
            throw new Error(`Senha inválida ou não informada (Tipo: ${typeof senha})`);
        }

        // 1. LOGIN
        await page.goto('http://salic.cultura.gov.br', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#Login');
        await page.type('#Login', usuario);
        await page.type('#Senha', senha);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        console.log(`[SALIC] Navegando para a lista de projetos...`);
        // 2. IR PARA A LISTAGEM
        await page.goto('https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente', {
            waitUntil: 'networkidle2'
        });

        // Aguarda e clica no campo de busca
        await page.waitForSelector('input[aria-label="Buscar"]');
        console.log('[SALIC] Buscando projeto:', pronac);
        await page.type('input[aria-label="Buscar"]', pronac);

        await wait(3000); // Espera a busca processar

        console.log('[SALIC] Clicando no PRONAC para abrir detalhes...');
        // Tenta encontrar o link que contém o número do PRONAC
        const linkSelector = `table tbody tr td a ::-p-text(${pronac})`;

        try {
            await page.waitForSelector(linkSelector, { timeout: 10000 });
            await page.click(linkSelector);
        } catch (e) {
            console.log('[SALIC] Tentativa alternativa de clique no link...');
            await page.evaluate((p) => {
                const target = Array.from(document.querySelectorAll('table tbody tr td a')).find(a => a.innerText.includes(p));
                if (target) target.click();
            }, pronac);
        }

        // --- Gerenciamento da Nova Aba ---
        console.log('[SALIC] Aguardando abertura da página de detalhes...');
        const newTarget = await browser.waitForTarget(target => target.opener() === page.target(), { timeout: 15000 });
        const targetPage = await newTarget.page();
        await targetPage.bringToFront();
        await targetPage.setViewport({ width: 1280, height: 800 });

        // Função auxiliar para achar o botão nos frames/side-nav
        async function encontrarBotaoNoSidenav(p) {
            return await p.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('li.bold > a > span'));
                for (const span of spans) {
                    if (span.textContent.trim().includes('Comprovação Financeira')) {
                        const link = span.closest('a');
                        if (link) { link.click(); return true; }
                    }
                }
                return false;
            });
        }

        // --- Abrir Comprovação Financeira ---
        console.log('[SALIC] Acessando aba Comprovação Financeira...');
        let clicou = false;
        for (let i = 0; i < 15; i++) {
            clicou = await encontrarBotaoNoSidenav(targetPage);
            if (!clicou) {
                const frames = targetPage.frames();
                for (const frame of frames) {
                    clicou = await encontrarBotaoNoSidenav(frame);
                    if (clicou) break;
                }
            }
            if (clicou) { console.log('[SALIC] Botão clicado!'); break; }
            await wait(2000);
        }

        if (!clicou) throw new Error('Não consegui encontrar o botão Comprovação Financeira.');

        // 3. Aguarda o título específico da página de Comprovação
        console.log('[SALIC] Botão acionado. Aguardando carregamento da tela de Comprovação...');

        // 3. Aguarda qualquer sinal de que a página de Comprovação carregou
        // Usamos uma combinação de H1 e a presença de tabelas para ser mais robusto
        try {
            await targetPage.waitForFunction(() => {
                const h1 = document.querySelector('h1');
                const table = document.querySelector('table');
                return (h1 && h1.innerText.includes('Comprovação')) || (table && document.body.innerText.includes('Rubrica'));
            }, { timeout: 45000 });
            console.log('[SALIC] Tela de Comprovação detectada!');
        } catch (e) {
            console.log('[SALIC] Aviso: Timeout na detecção automática. Tentando prosseguir com busca da rubrica...');
        }

        await wait(2000); // Garante que a tabela dinâmica se estabilizou

        // --- FLUXO DE INSERÇÃO ---
        console.log(`[SALIC] Localizando a rubrica: ${rubricaNome}`);
        const resultInsercao = await targetPage.evaluate((nome) => {
            const rows = Array.from(document.querySelectorAll('tr'));
            const row = rows.find(r => r.innerText.includes(nome));
            if (row) {
                // Procura o botão de ação (ícone de + ou texto Inserir)
                const btn = row.querySelector('button[title*="Inserir"], .btn-inserir, .fa-plus');
                if (btn) {
                    btn.click();
                    return { success: true };
                }
            }
            return { success: false, error: 'Rubrica não encontrada ou sem botão de inserção' };
        }, rubricaNome);

        if (!resultInsercao.success) throw new Error(resultInsercao.error);

        console.log('[SALIC] Formulário de inserção aberto! Preenchendo dados...');
        // IMPORTANTE: Aqui entram os seletores reais do formulário que você mapeará
        // Ex:
        // await targetPage.waitForSelector('#cnpj_fornecedor');
        // await targetPage.type('#cnpj_fornecedor', documento.cnpj);

        return { sucesso: true, mensagem: 'Chegamos ao formulário de inserção!' };

    } catch (error) {
        console.error('[SALIC] ERRO DURANTE A EXECUÇÃO:', error.message);
        if (targetPage) {
            const fileName = `erro_salic_${Date.now()}.png`;
            await targetPage.screenshot({ path: fileName }).catch(() => { });
        }
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { executarInsercaoSalic };

// --- ÁREA DE TESTE (Para rodar direto no terminal) ---
if (require.main === module) {
    (async () => {
        // Substitua pelos seus dados de teste:
        await executarInsercaoSalic({
            usuario: '91685010644',
            senha: '916850',
            pronac: '248870',
            rubricaNome: 'NOME-DA-RUBRICA-AQUI',
            documento: {
                cnpj: '...',
                valor: '...',
                nf_path: '...',
                comprovante_path: '...'
            }
        });
    })();
}