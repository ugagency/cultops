const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

/**
 * Script de Inserção de Comprovação Financeira no SALIC
 * @param {Object} config - Objeto com credenciais e dados da despesa
 */
async function executarInsercaoSalic(config) {
    const { usuario, senha, pronac, rubricaNome, documento } = config;

    // Helper para pausas
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Helper para baixar o PDF do Supabase para o Railway
    function downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, response => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', err => {
                fs.unlink(dest, () => {});
                reject(err);
            });
        });
    }

    // Detecta ambiente pela plataforma: se NAO e Windows, e Railway/Linux
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
        // Windows local: usa o Chrome instalado na maquina
        launchOptions.executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
        // Linux/Railway: tenta achar o Chromium do sistema (instalado pelo Dockerfile)
        const chromiumPaths = [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome'
        ].filter(Boolean);

        for (const p of chromiumPaths) {
            if (fs.existsSync(p)) {
                launchOptions.executablePath = p;
                break;
            }
        }
    }

    console.log('[SALIC] Plataforma:', process.platform, '| Chrome:', launchOptions.executablePath || 'bundled');
    const browser = await puppeteer.launch(launchOptions);

    let targetPage;
    let page;
    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`[SALIC] Iniciando login para o usuario: ${usuario} (Tipo: ${typeof usuario})`);
        console.log(`[SALIC] Tipo da Senha recebida: ${typeof senha}`);

        if (!usuario || typeof usuario !== 'string') {
            throw new Error(`Usuario invalido ou nao informado (Tipo: ${typeof usuario})`);
        }
        if (!senha || typeof senha !== 'string') {
            throw new Error(`Senha invalida ou nao informada (Tipo: ${typeof senha})`);
        }

        // 1. LOGIN
        await page.goto('http://salic.cultura.gov.br', { waitUntil: 'domcontentloaded', timeout: 60000 });

        await page.waitForSelector('#Login', { timeout: 30000 });
        await page.type('#Login', usuario, { delay: 50 });
        await wait(500);
        await page.type('#Senha', senha, { delay: 50 });
        await wait(500);
        
        // Clica especificamente no botão "ENTRAR" e não no Gov.br
        await page.evaluate(() => {
            const botoes = Array.from(document.querySelectorAll('button'));
            const btnEntrar = botoes.find(b => b.innerText.trim().toUpperCase() === 'ENTRAR');
            if (btnEntrar) {
                btnEntrar.click();
            } else {
                // Tenta o antigo form submission se não achar o botão por texto
                document.querySelector('button[type="submit"]').click();
            }
        });
        
        console.log('[SALIC] Botão Entrar clicado... aguardando processamento do servidor.');
        // Aguarda 8 segundos para garantir que o SALIC processe o login e crie a sessão
        await wait(8000);

        console.log(`[SALIC] Navegando para a lista de projetos...`);
        // 2. IR PARA A LISTAGEM
        await page.goto('https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente', {
            waitUntil: 'domcontentloaded', timeout: 60000
        });

        // Aguarda e clica no campo de busca
        await page.waitForSelector('input[aria-label="Buscar"]');
        console.log('[SALIC] Buscando projeto:', pronac);
        await page.type('input[aria-label="Buscar"]', pronac);

        await wait(3000); // Espera a busca processar

        console.log('[SALIC] Clicando no PRONAC para abrir detalhes...');
        console.log('[SALIC] Extraindo o link do PRONAC...');
        const urlProjeto = await page.evaluate((p) => {
            const links = Array.from(document.querySelectorAll('table tbody tr td a'));
            const alvo = links.find(a => a.innerText.includes(p));
            return alvo ? alvo.href : null;
        }, pronac);

        if (!urlProjeto) throw new Error('Link do PRONAC nao encontrado na tabela.');
        
        console.log('[SALIC] Navegando para os detalhes do projeto na mesma aba...');
        await page.goto(urlProjeto, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // A partir de agora, o targetPage é a própria página (não abrimos nova aba)
        targetPage = page;

        // Funcao auxiliar para achar o botao nos frames/side-nav
        async function encontrarBotaoNoSidenav(p) {
            return await p.evaluate(() => {
                // Busca por qualquer elemento que contenha "omprova" (match parcial que funciona com ou sem acento)
                const allElements = Array.from(document.querySelectorAll('a, span, li'));
                for (const el of allElements) {
                    const text = el.textContent.trim().toLowerCase();
                    if (text.includes('omprova') && text.includes('financeira')) {
                        const link = el.tagName === 'A' ? el : el.closest('a');
                        if (link) { link.click(); return true; }
                    }
                }
                return false;
            });
        }

        // --- Abrir Comprovacao Financeira ---
        console.log('[SALIC] Acessando aba Comprovacao Financeira...');
        
        // Espera a sidebar carregar (pode demorar em SPAs)
        await wait(3000);
        
        let clicou = false;
        for (let i = 0; i < 15; i++) {
            // Log dos itens do menu para debug
            if (i === 0) {
                const menuItems = await targetPage.evaluate(() => {
                    return Array.from(document.querySelectorAll('a')).map(a => a.textContent.trim()).filter(t => t.length > 2 && t.length < 50).slice(0, 20);
                });
                console.log('[SALIC] Itens de menu encontrados:', JSON.stringify(menuItems));
            }
            
            clicou = await encontrarBotaoNoSidenav(targetPage);
            if (!clicou) {
                const frames = targetPage.frames();
                for (const frame of frames) {
                    clicou = await encontrarBotaoNoSidenav(frame);
                    if (clicou) break;
                }
            }
            if (clicou) { console.log('[SALIC] Botao clicado!'); break; }
            await wait(2000);
        }

        if (!clicou) throw new Error('Nao consegui encontrar o botao Comprovacao Financeira.');

        // 3. Aguarda o titulo especifico da pagina de Comprovacao
        console.log('[SALIC] Botao acionado. Aguardando carregamento da tela de Comprovacao...');

        try {
            await targetPage.waitForFunction(() => {
                const h1 = document.querySelector('h1');
                const table = document.querySelector('table');
                return (h1 && h1.innerText.includes('Comprovacao')) || (table && document.body.innerText.includes('Rubrica'));
            }, { timeout: 10000 });
            console.log('[SALIC] Tela de Comprovacao detectada!');
        } catch (e) {
            console.log('[SALIC] Aviso: Timeout na deteccao automatica. Tentando prosseguir com busca da rubrica...');
        }

        await wait(2000); // Garante que a tabela dinamica se estabilizou

        // --- FLUXO DE INSERCAO ---
        console.log(`[SALIC] Localizando a rubrica: ${rubricaNome}`);
        const linkComprovacao = await targetPage.evaluate((nome, valorAprovado, valorNota) => {
            // Busca todas as linhas das tabelas
            const rows = Array.from(document.querySelectorAll('table.bordered tbody tr'));
            
            // Limpa o nome (ex: "14 - Passagens Aereas" -> "passagens aereas")
            const nomeLimpo = nome.replace(/^\d+\s*-\s*/, '').trim().toLowerCase();
            
            for (const row of rows) {
                const colunas = row.querySelectorAll('td');
                // A tabela do SALIC tem 5 colunas: Nome, Aprovado, Comprovado, A Comprovar, Botoes
                if (colunas.length >= 5) {
                    const nomeTabela = colunas[0].innerText.toLowerCase();
                    
                    if (nomeTabela.includes(nomeLimpo)) {
                        // Logica A: Se o DB mandou o Valor Aprovado Total, cruzamos com a Coluna 1
                        if (valorAprovado) {
                            const strTotal = colunas[1].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                            if (Math.abs(parseFloat(strTotal) - parseFloat(valorAprovado)) < 0.01) {
                                const btn = row.querySelector('a[title="Comprovar item"]');
                                if (btn) return btn.href;
                            }
                        } else {
                            // Logica B: Se nao temos o total, cruzamos com a Coluna 3 (Saldo / A Comprovar)
                            const strSaldo = colunas[3].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                            if (parseFloat(strSaldo) >= parseFloat(valorNota)) {
                                const btn = row.querySelector('a[title="Comprovar item"]');
                                if (btn) return btn.href;
                            }
                        }
                    }
                }
            }
            return null;
        }, rubricaNome, config.rubricaValorAprovado, documento.valor);

        if (!linkComprovacao) {
            throw new Error('Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro")');
        }

        console.log(`[SALIC] Sinal de dinheiro encontrado! Redirecionando...`);
        await targetPage.goto(linkComprovacao, { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('[SALIC] Tela da rubrica carregada! Procurando botao flutuante (+)...');
        await wait(2000); // Aguarda renderizacao do Materialize

        await targetPage.evaluate(() => {
            // No Materialize, botoes flutuantes costumam ter a classe .btn-floating
            const fab = document.querySelector('.fixed-action-btn a.btn-floating, a.btn-floating i.fa-plus, a[title*="Inserir"]');
            if (fab) {
                fab.click();
            } else {
                console.log("Botao flutuante nao achado automaticamente, tente achar pelo F12");
            }
        });

        console.log('[SALIC] Botao (+) clicado. Formulario de insercao aberto! Preenchendo dados...');
        await targetPage.waitForSelector('#modal1.open', { timeout: 10000 });
        await wait(1000); // Aguarda animacao de abertura do modal

        // 1. Seleciona Tipo Pessoa (CNPJ = 2)
        await targetPage.evaluate(() => {
            const radioCNPJ = document.querySelector('input[name="tipoPessoa"][value="2"]');
            if (radioCNPJ && radioCNPJ.nextElementSibling) radioCNPJ.nextElementSibling.click();
        });
        await wait(500);

        // 2. Preenche o CNPJ e clica na Lupa
        await targetPage.evaluate((cnpj) => {
             const label = document.querySelector('label[for="CNPJCPF"]');
             if (label && label.previousElementSibling) {
                 label.previousElementSibling.value = cnpj;
                 label.previousElementSibling.dispatchEvent(new Event('input', { bubbles: true }));
             }
        }, documento.cnpj_fornecedor);

        await targetPage.evaluate(() => {
            const btns = document.querySelectorAll('button.btn i.material-icons');
            for(let i of btns) { 
                if(i.innerText === 'search') i.parentElement.click(); 
            }
        });
        console.log('[SALIC] Buscando fornecedor pelo CNPJ...');
        await wait(3000);

        // 3. Formatar data (De YYYY-MM-DD para DD/MM/YYYY)
        let dataFormatada = documento.data_emissao;
        if (dataFormatada && dataFormatada.includes('-')) {
            const parts = dataFormatada.split('-');
            dataFormatada = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }

        // 4. Preenche Dados do Comprovante
        await targetPage.select('#tpDocumento', '3'); // Nota Fiscal/Fatura
        await targetPage.type('#dataEmissao', dataFormatada);
        await targetPage.type('#nrComprovante', String(documento.numero));

        // 5. Upload do Arquivo (PDF)
        if (documento.nf_url) {
            console.log('[SALIC] Baixando arquivo da Nota Fiscal: ', documento.nf_url);
            const localFilePath = path.join(os.tmpdir(), `nf_${Date.now()}.pdf`);
            await downloadFile(documento.nf_url, localFilePath);
            
            const fileInput = await targetPage.$('#arquivo');
            if (fileInput) {
                await fileInput.uploadFile(localFilePath);
                console.log('[SALIC] Upload do arquivo realizado no formulario.');
            }
        }

        // 6. Dados de Pagamento
        await targetPage.select('#tpFormaDePagamento', '2'); // Transferencia Bancaria
        await targetPage.type('#dtPagamento', dataFormatada); // Assume a mesma data por padrao
        await targetPage.type('#nrDocumentoDePagamento', String(documento.numero));
        await targetPage.type('#vlComprovado', String(documento.valor));
        await targetPage.type('#dsJustificativa', 'Insercao automatizada via Sistema Cultops');

        console.log('[SALIC] Formulario preenchido! Clicando em Salvar...');
        
        // 7. Clicar no botao Salvar
        await targetPage.evaluate(() => {
            const btns = document.querySelectorAll('button.btn');
            for(let b of btns) {
                if(b.innerText.toLowerCase().includes('salvar')) {
                    b.click();
                    break;
                }
            }
        });

        // Aguarda um momento apos salvar para garantir o envio
        await wait(3000);

        return { sucesso: true, mensagem: 'Formulario preenchido e salvo com sucesso!' };

    } catch (error) {
        console.error('[SALIC] ERRO DURANTE A EXECUÇÃO:', error.message);
        try {
            // Tenta pegar o HTML da página para debugar se fomos bloqueados (ex: Cloudflare)
            const erroPage = targetPage || page;
            if (erroPage) {
                const html = await erroPage.evaluate(() => document.body.innerText.substring(0, 500));
                console.error('[SALIC] Conteúdo da página no momento do erro:', html);
                const fileName = `erro_salic_${Date.now()}.png`;
                await erroPage.screenshot({ path: fileName }).catch(() => { });
            }
        } catch(e) {}
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { executarInsercaoSalic };

// --- AREA DE TESTE (Para rodar direto no terminal) ---
if (require.main === module) {
    (async () => {
        // Substitua pelos seus dados de teste:
        await executarInsercaoSalic({
            usuario: '24454621187',
            senha: 'artecidadania',
            pronac: '258740',
            rubricaNome: 'Passagens Aereas',
            documento: {
                cnpj_fornecedor: '...',
                valor: '...',
                numero: '...',
                data_emissao: '2026-03-17',
                nf_url: ''
            }
        });
    })();
}