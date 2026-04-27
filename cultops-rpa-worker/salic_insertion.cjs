const puppeteer = require('puppeteer-core');
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

    // Detecta ambiente: Railway (Linux) = headless | Windows local = visível
    const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    const launchOptions = {
        headless: isProduction ? 'new' : false,
        slowMo: isProduction ? 0 : 50,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ]
    };

    // No Windows local, usa o Chrome instalado
    if (!isProduction && process.platform === 'win32') {
        launchOptions.executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }

    // No Railway (Linux), usa o Chromium do sistema instalado pelo Dockerfile
    if (isProduction && process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    console.log('[SALIC] Ambiente:', isProduction ? 'RAILWAY' : 'LOCAL');
    const browser = await puppeteer.launch(launchOptions);

    let targetPage;
    try {
        const page = await browser.newPage();
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
            }, { timeout: 10000 });
            console.log('[SALIC] Tela de Comprovação detectada!');
        } catch (e) {
            console.log('[SALIC] Aviso: Timeout na detecção automática. Tentando prosseguir com busca da rubrica...');
        }

        await wait(2000); // Garante que a tabela dinâmica se estabilizou

        // --- FLUXO DE INSERÇÃO ---
        console.log(`[SALIC] Localizando a rubrica: ${rubricaNome}`);
        const linkComprovacao = await targetPage.evaluate((nome, valorAprovado, valorNota) => {
            // Busca todas as linhas das tabelas
            const rows = Array.from(document.querySelectorAll('table.bordered tbody tr'));
            
            // Limpa o nome (ex: "14 - Passagens Aéreas" -> "passagens aéreas")
            const nomeLimpo = nome.replace(/^\d+\s*-\s*/, '').trim().toLowerCase();
            
            for (const row of rows) {
                const colunas = row.querySelectorAll('td');
                // A tabela do SALIC tem 5 colunas: Nome, Aprovado, Comprovado, A Comprovar, Botões
                if (colunas.length >= 5) {
                    const nomeTabela = colunas[0].innerText.toLowerCase();
                    
                    if (nomeTabela.includes(nomeLimpo)) {
                        // Lógica A: Se o DB mandou o Valor Aprovado Total, cruzamos com a Coluna 1
                        if (valorAprovado) {
                            const strTotal = colunas[1].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                            if (Math.abs(parseFloat(strTotal) - parseFloat(valorAprovado)) < 0.01) {
                                const btn = row.querySelector('a[title="Comprovar item"]');
                                if (btn) return btn.href;
                            }
                        } else {
                            // Lógica B: Se não temos o total, cruzamos com a Coluna 3 (Saldo / A Comprovar)
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
            throw new Error('Rubrica não encontrada ou sem link de comprovação ("sinal de dinheiro")');
        }

        console.log(`[SALIC] Sinal de dinheiro encontrado! Redirecionando...`);
        await targetPage.goto(linkComprovacao, { waitUntil: 'networkidle2' });

        console.log('[SALIC] Tela da rubrica carregada! Procurando botão flutuante (+)...');
        await wait(2000); // Aguarda renderização do Materialize

        await targetPage.evaluate(() => {
            // No Materialize, botões flutuantes costumam ter a classe .btn-floating
            const fab = document.querySelector('.fixed-action-btn a.btn-floating, a.btn-floating i.fa-plus, a[title*="Inserir"]');
            if (fab) {
                fab.click();
            } else {
                console.log("Botão flutuante não achado automaticamente, tente achar pelo F12");
            }
        });

        console.log('[SALIC] Botão (+) clicado. Formulário de inserção aberto! Preenchendo dados...');
        await targetPage.waitForSelector('#modal1.open', { timeout: 10000 });
        await wait(1000); // Aguarda animação de abertura do modal

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
                console.log('[SALIC] Upload do arquivo realizado no formulário.');
            }
        }

        // 6. Dados de Pagamento
        await targetPage.select('#tpFormaDePagamento', '2'); // Transferência Bancária
        await targetPage.type('#dtPagamento', dataFormatada); // Assume a mesma data por padrão
        await targetPage.type('#nrDocumentoDePagamento', String(documento.numero));
        await targetPage.type('#vlComprovado', String(documento.valor));
        await targetPage.type('#dsJustificativa', 'Inserção automatizada via Sistema Cultops');

        console.log('[SALIC] Formulário preenchido! Clicando em Salvar...');
        
        // 7. Clicar no botão Salvar
        await targetPage.evaluate(() => {
            const btns = document.querySelectorAll('button.btn');
            for(let b of btns) {
                if(b.innerText.toLowerCase().includes('salvar')) {
                    b.click();
                    break;
                }
            }
        });

        // Aguarda um momento após salvar para garantir o envio
        await wait(3000);

        return { sucesso: true, mensagem: 'Formulário preenchido e salvo com sucesso!' };

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
            usuario: '24454621187',
            senha: 'artecidadania',
            pronac: '258740',
            rubricaNome: 'Passagens Aéreas',
            documento: {
                cnpj: '...',
                valor: '...',
                nf_path: '...',
                comprovante_path: '...'
            }
        });
    })();
}