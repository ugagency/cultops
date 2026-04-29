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

    // FALLBACK: Timeout global de seguranca (4 minutos) para evitar browser zumbi
    const globalTimeoutHandle = setTimeout(async () => {
        console.error('[SALIC] TIMEOUT GLOBAL: Execucao excedeu 4 minutos. Fechando browser...');
        try { await browser.close(); } catch(e) {}
    }, 240000);

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

        // FALLBACK: Verifica se o login foi bem-sucedido antes de prosseguir
        // Aguarda a pagina estabilizar (o SALIC redireciona apos login, document.body pode ser null)
        await page.waitForFunction(() => document.body && document.body.innerText.length > 0, { timeout: 15000 }).catch(() => {});
        await wait(1000);

        const loginCheck = await page.evaluate(() => {
            if (!document.body) return { temErro: false, temSessao: false, url: window.location.href, bodyNull: true };
            const body = (document.body.innerText || '').toLowerCase();
            const temErro = body.includes('senha inválida') || body.includes('senha invalida') ||
                body.includes('usuário não encontrado') || body.includes('usuario nao encontrado') ||
                body.includes('login incorreto') || body.includes('dados inválidos') || body.includes('tente novamente');
            const temSessao = !!document.querySelector('a[href*="sair"], a[href*="logout"], .user-info, .usuario, .nav-wrapper .brand-logo');
            return { temErro, temSessao, url: window.location.href, bodyNull: false };
        });
        console.log('[SALIC] Verificacao pos-login:', JSON.stringify(loginCheck));
        if (loginCheck.temErro) {
            throw new Error('Falha no login SALIC: credenciais invalidas ou usuario bloqueado.');
        }

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
            const rows = Array.from(document.querySelectorAll('table.bordered tbody tr'));
            
            // Limpa o nome (ex: "147 - Passagens Aereas (...)" -> "passagens aereas")
            const nomeLimpo = nome.replace(/^\d+\s*-\s*/, '').replace(/\(.*\)/, '').trim().toLowerCase();
            
            let fallbackPorSaldo = null;
            
            for (const row of rows) {
                const colunas = row.querySelectorAll('td');
                if (colunas.length >= 5) {
                    const nomeTabela = colunas[0].innerText.toLowerCase();
                    
                    if (nomeTabela.includes(nomeLimpo)) {
                        const btn = row.querySelector('a[title="Comprovar item"]');
                        if (!btn) continue;
                        
                        // PRIORIDADE 1: Match exato pelo Valor Aprovado (Coluna 1) com o valor do DB
                        if (valorAprovado) {
                            const strAprovado = colunas[1].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                            if (Math.abs(parseFloat(strAprovado) - parseFloat(valorAprovado)) < 0.01) {
                                return btn.href; // Match perfeito, retorna imediatamente
                            }
                        }
                        
                        // FALLBACK: Guarda a primeira rubrica com saldo suficiente (Coluna 3 >= valor da nota)
                        if (!fallbackPorSaldo) {
                            const strSaldo = colunas[3].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                            if (parseFloat(strSaldo) >= parseFloat(valorNota)) {
                                fallbackPorSaldo = btn.href;
                            }
                        }
                    }
                }
            }
            return fallbackPorSaldo; // Retorna o fallback se nao encontrou match exato
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
        await wait(1500); // Aguarda animacao de abertura do modal

        // Helper: dispara TODOS os eventos que o Materialize CSS precisa para reconhecer um campo
        async function setMaterializeField(pageRef, selector, value) {
            await pageRef.evaluate((sel, val) => {
                const el = document.querySelector(sel);
                if (!el) { console.warn('[RPA] Campo nao encontrado:', sel); return; }
                
                // Foca o campo (ativa o label do Materialize)
                el.focus();
                el.dispatchEvent(new Event('focus', { bubbles: true }));
                
                // Limpa valor anterior
                el.value = '';
                
                // Define o novo valor
                el.value = val;
                
                // Dispara toda a cadeia de eventos que o Materialize/jQuery escutam
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('keyup', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                
                // Ativa o label do Materialize (evita sobreposicao de texto)
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) label.classList.add('active');
                
                console.log('[RPA] Campo preenchido:', sel, '=', val);
            }, selector, value);
        }

        // Helper: seleciona opcao em <select> compativel com Materialize
        async function setMaterializeSelect(pageRef, selector, value) {
            await pageRef.evaluate((sel, val) => {
                const el = document.querySelector(sel);
                if (!el) { console.warn('[RPA] Select nao encontrado:', sel); return; }
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Se for Materialize com select customizado, atualiza visualmente
                if (typeof M !== 'undefined' && M.FormSelect) {
                    M.FormSelect.init(el);
                } else if (typeof $ !== 'undefined') {
                    $(el).material_select?.();
                }
                console.log('[RPA] Select definido:', sel, '=', val);
            }, selector, value);
        }

        // 1. Detecta tipo de pessoa pelo numero de digitos (CPF=11 / CNPJ=14)
        //    No SALIC: tipoPessoa value="1" = CPF (Fisica) | value="2" = CNPJ (Juridica)
        const documentoSoNumeros = String(documento.cnpj_fornecedor || '').replace(/\D/g, '');
        const isCPF = documentoSoNumeros.length === 11;
        const tipoPessoaValue = isCPF ? '1' : '2';
        const tipoPessoaLabel = isCPF ? 'CPF' : 'CNPJ';
        console.log(`[SALIC] Tipo de pessoa detectado: ${tipoPessoaLabel} (${documentoSoNumeros.length} digitos)`);

        await targetPage.evaluate((tpValue, tpLabel) => {
            const radio = document.querySelector(`input[name="tipoPessoa"][value="${tpValue}"]`);
            if (radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.dispatchEvent(new Event('click', { bubbles: true }));
                // Tambem clica no label (Materialize usa labels clicaveis)
                if (radio.nextElementSibling) radio.nextElementSibling.click();
                console.log(`[RPA] Tipo Pessoa ${tpLabel} selecionado`);
            }
        }, tipoPessoaValue, tipoPessoaLabel);
        await wait(1500); // Espera a mascara aplicar

        // 2. O <input> do documento NAO tem atributo id no HTML do SALIC!
        //    Precisamos encontrar pelo label e injetar o id para o Puppeteer conseguir achar.
        console.log(`[SALIC] Preenchendo ${tipoPessoaLabel}: ${documento.cnpj_fornecedor}`);
        
        await targetPage.evaluate((isCPF) => {
            // Encontra o input pela relacao com o label (previousElementSibling)
            const label = document.querySelector('label[for="CNPJCPF"]');
            if (label && label.previousElementSibling && label.previousElementSibling.tagName === 'INPUT') {
                label.previousElementSibling.id = 'CNPJCPF';
                console.log('[RPA] ID "CNPJCPF" injetado no input. Mask atual:', label.previousElementSibling.getAttribute('data-mask'));
            } else {
                console.warn('[RPA] AVISO: Nao encontrou input do documento pelo label!');
                // Fallback: tenta encontrar pelo data-mask compativel
                // CPF: ###.###.###-## | CNPJ: ##.###.###/####-##
                const inputs = document.querySelectorAll('#modal1 input[data-mask]');
                for (const inp of inputs) {
                    const mask = inp.getAttribute('data-mask') || '';
                    const matchCNPJ = mask.includes('/');
                    const matchCPF = !mask.includes('/') && mask.includes('###.###.###');
                    if ((isCPF && matchCPF) || (!isCPF && matchCNPJ)) {
                        inp.id = 'CNPJCPF';
                        console.log('[RPA] ID "CNPJCPF" injetado via fallback (data-mask):', mask);
                        break;
                    }
                }
            }
        }, isCPF);
        await wait(500);

        // Agora o input tem id, podemos usar o Puppeteer normalmente
        const docInput = await targetPage.$('#CNPJCPF');
        if (docInput) {
            await docInput.click({ clickCount: 3 }); // Seleciona tudo
            await docInput.press('Backspace');
            await wait(300);
            // Digita somente os numeros do documento (a mascara formata sozinha)
            await docInput.type(documentoSoNumeros, { delay: 100 });
            console.log(`[SALIC] ${tipoPessoaLabel} digitado no campo`);

            // Verifica o que ficou no campo apos a mascara formatar
            const docPreenchido = await targetPage.evaluate(() => {
                const el = document.querySelector('#CNPJCPF');
                return el ? el.value : null;
            });
            console.log(`[SALIC] ${tipoPessoaLabel} no campo apos mascara: ${docPreenchido}`);
        } else {
            console.error(`[SALIC] ERRO CRITICO: Input do ${tipoPessoaLabel} nao encontrado mesmo apos injecao de ID!`);
            // Ultima tentativa: digita via evaluate diretamente
            await targetPage.evaluate((doc, label) => {
                const lbl = document.querySelector('label[for="CNPJCPF"]');
                const input = lbl ? lbl.previousElementSibling : null;
                if (input) {
                    input.value = doc;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('blur', { bubbles: true }));
                    console.log(`[RPA] ${label} inserido via fallback direto`);
                }
            }, documentoSoNumeros, tipoPessoaLabel);
        }
        await wait(500);

        // Clica na Lupa para buscar o fornecedor
        await targetPage.evaluate(() => {
            // Busca todos os botoes com icone search dentro do modal
            const modal = document.querySelector('#modal1');
            const container = modal || document;
            const btns = container.querySelectorAll('button.btn i.material-icons');
            for (let i of btns) { 
                if (i.innerText.trim() === 'search') {
                    i.parentElement.click();
                    console.log('[RPA] Botao buscar (lupa) clicado');
                    break;
                }
            }
        });
        console.log(`[SALIC] Buscando fornecedor pelo ${tipoPessoaLabel}...`);
        await wait(5000); // Espera mais para a busca do fornecedor completar no servidor

        // Verifica se o fornecedor foi encontrado
        const fornecedorEncontrado = await targetPage.evaluate(() => {
            // Tenta varios seletores possiveis para o nome do fornecedor
            const candidatos = ['#Descricao', '#nmFornecedor', '#razaoSocial', 'input[name="Descricao"]'];
            for (const sel of candidatos) {
                const el = document.querySelector(sel);
                if (el && el.value) return el.value;
            }
            return null;
        });
        console.log(`[SALIC] Fornecedor encontrado: ${fornecedorEncontrado || `NAO DETECTADO (verifique ${tipoPessoaLabel})`}`);

        // FALLBACK: Se fornecedor nao foi encontrado, tenta nova busca antes de abortar
        if (!fornecedorEncontrado) {
            console.warn('[SALIC] FALLBACK: Fornecedor nao encontrado. Re-tentando busca...');
            const docRetry = await targetPage.$('#CNPJCPF');
            if (docRetry) {
                await docRetry.click({ clickCount: 3 });
                await docRetry.press('Backspace');
                await wait(500);
                await docRetry.type(documentoSoNumeros, { delay: 100 });
                await wait(500);
            }
            await targetPage.evaluate(() => {
                const modal = document.querySelector('#modal1');
                const container = modal || document;
                const btns = container.querySelectorAll('button.btn i.material-icons');
                for (let i of btns) {
                    if (i.innerText.trim() === 'search') { i.parentElement.click(); break; }
                }
            });
            await wait(6000);
            const fornecedorRetry = await targetPage.evaluate(() => {
                const candidatos = ['#Descricao', '#nmFornecedor', '#razaoSocial', 'input[name="Descricao"]'];
                for (const sel of candidatos) {
                    const el = document.querySelector(sel);
                    if (el && el.value) return el.value;
                }
                return null;
            });
            if (!fornecedorRetry) {
                throw new Error(`Fornecedor com ${tipoPessoaLabel} ${documento.cnpj_fornecedor} nao encontrado no SALIC apos 2 tentativas.`);
            }
            console.log(`[SALIC] Fornecedor encontrado na 2a tentativa: ${fornecedorRetry}`);
        }

        // 3. Formatar data (De YYYY-MM-DD para DD/MM/YYYY)
        let dataFormatada = documento.data_emissao;
        if (dataFormatada && dataFormatada.includes('-')) {
            const parts = dataFormatada.split('-');
            dataFormatada = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        console.log(`[SALIC] Data formatada: ${dataFormatada}`);

        // 4. Converter valor para centavos (mascara de moeda do SALIC trata digitos como centavos)
        //    Ex: R$4.100,00 -> digitar "410000" -> mascara exibe "4.100,00"
        //    Ex: R$14.600,00 -> digitar "1460000" -> mascara exibe "14.600,00"
        const valorNum = parseFloat(documento.valor);
        const valorEmCentavos = String(Math.round(valorNum * 100));
        console.log(`[SALIC] Valor: R$ ${documento.valor} -> centavos para digitar: ${valorEmCentavos}`);

        // 5. Preenche Dados do Comprovante com eventos Materialize
        await setMaterializeSelect(targetPage, '#tpDocumento', '3'); // Nota Fiscal/Fatura
        await wait(500);
        await setMaterializeField(targetPage, '#dataEmissao', dataFormatada);
        await wait(300);
        await setMaterializeField(targetPage, '#nrComprovante', String(documento.numero));
        await wait(300);

        // 6. Upload do Arquivo (PDF)
        if (documento.nf_url) {
            console.log('[SALIC] Baixando arquivo da Nota Fiscal: ', documento.nf_url);
            const localFilePath = path.join(os.tmpdir(), `nf_${Date.now()}.pdf`);
            await downloadFile(documento.nf_url, localFilePath);

            // FALLBACK: Verifica se o PDF foi baixado corretamente
            const fileStats = fs.statSync(localFilePath);
            if (!fileStats || fileStats.size < 100) {
                console.warn('[SALIC] FALLBACK: PDF com tamanho suspeito. Tentando download novamente...');
                await downloadFile(documento.nf_url, localFilePath);
                const retryStats = fs.statSync(localFilePath);
                if (!retryStats || retryStats.size < 100) {
                    throw new Error(`PDF da NF baixado com tamanho invalido (${retryStats?.size || 0} bytes). URL: ${documento.nf_url}`);
                }
            }
            console.log(`[SALIC] PDF baixado com sucesso: ${fileStats.size} bytes`);
            
            const fileInput = await targetPage.$('#arquivo');
            if (fileInput) {
                await fileInput.uploadFile(localFilePath);
                console.log('[SALIC] Upload do arquivo realizado no formulario.');
            } else {
                throw new Error('Campo de upload do arquivo (#arquivo) nao encontrado no formulario. Layout do SALIC pode ter mudado.');
            }
        }

        // 7. Dados de Pagamento com eventos Materialize
        await setMaterializeSelect(targetPage, '#tpFormaDePagamento', '2'); // Transferencia Bancaria
        await wait(500);
        await setMaterializeField(targetPage, '#dtPagamento', dataFormatada);
        await wait(300);
        await setMaterializeField(targetPage, '#nrDocumentoDePagamento', String(documento.numero));
        await wait(300);

        // 8. Valor: digitar caractere por caractere para a mascara de moeda funcionar
        const vlInput = await targetPage.$('#vlComprovado');
        if (vlInput) {
            await vlInput.click({ clickCount: 3 });
            await vlInput.press('Backspace');
            await wait(200);
            await vlInput.type(valorEmCentavos, { delay: 60 });
            // Verifica o que a mascara exibiu
            const valorExibido = await targetPage.evaluate(() => {
                const el = document.querySelector('#vlComprovado');
                return el ? el.value : null;
            });
            console.log(`[SALIC] Valor exibido no campo apos mascara: ${valorExibido}`);

            // FALLBACK: Valida se o valor exibido pela mascara corresponde ao esperado
            if (valorExibido) {
                const valorExibidoNum = parseFloat(valorExibido.replace(/[R$\s.]/g, '').replace(',', '.'));
                if (!isNaN(valorExibidoNum) && Math.abs(valorExibidoNum - valorNum) > 0.01) {
                    console.warn(`[SALIC] FALLBACK: Valor divergente! Esperado: ${valorNum}, Exibido: ${valorExibidoNum}. Tentando corrigir...`);
                    await vlInput.click({ clickCount: 3 });
                    await vlInput.press('Backspace');
                    await wait(300);
                    await vlInput.type(valorEmCentavos, { delay: 80 });
                    await wait(300);
                    const valorCorrigido = await targetPage.evaluate(() => {
                        const el = document.querySelector('#vlComprovado');
                        return el ? el.value : null;
                    });
                    const valorCorrigidoNum = parseFloat((valorCorrigido || '').replace(/[R$\s.]/g, '').replace(',', '.'));
                    if (!isNaN(valorCorrigidoNum) && Math.abs(valorCorrigidoNum - valorNum) > 0.01) {
                        throw new Error(`Valor no campo (${valorCorrigido}) diverge do esperado (R$ ${valorNum}) mesmo apos correcao.`);
                    }
                    console.log(`[SALIC] Valor corrigido com sucesso: ${valorCorrigido}`);
                }
            }
        } else {
            console.error('[SALIC] ERRO: Campo #vlComprovado nao encontrado!');
        }
        await wait(300);

        await setMaterializeField(targetPage, '#dsJustificativa', 'Insercao automatizada via Sistema Cultops');
        await wait(300);

        // Log de auditoria: mostra o estado de todos os campos antes de salvar
        const estadoCampos = await targetPage.evaluate(() => {
            const campos = ['#tpDocumento', '#dataEmissao', '#nrComprovante', '#tpFormaDePagamento', '#dtPagamento', '#nrDocumentoDePagamento', '#vlComprovado', '#dsJustificativa', '#CNPJCPF'];
            const resultado = {};
            for (const sel of campos) {
                const el = document.querySelector(sel);
                resultado[sel] = el ? (el.value || '(vazio)') : '(NAO ENCONTRADO)';
            }
            return resultado;
        });
        console.log('[SALIC] AUDITORIA - Estado dos campos antes de salvar:', JSON.stringify(estadoCampos, null, 2));

        console.log('[SALIC] Formulario preenchido! Clicando em Salvar...');
        
        // 8. Clicar no botao Salvar - multiplas estrategias
        const salvarClicado = await targetPage.evaluate(() => {
            // Estrategia 1: Busca por texto "salvar" em botoes
            const btns = document.querySelectorAll('button.btn, button[type="submit"], input[type="submit"]');
            for (let b of btns) {
                const texto = (b.innerText || b.value || '').toLowerCase();
                if (texto.includes('salvar') || texto.includes('gravar') || texto.includes('enviar')) {
                    console.log('[RPA] Botao encontrado:', texto);
                    // Dispara mousedown + mouseup + click (simula interacao real)
                    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return texto;
                }
            }
            
            // Estrategia 2: Submete o form diretamente
            const form = document.querySelector('#modal1 form, #formComprovante, form');
            if (form) {
                console.log('[RPA] Submetendo form diretamente');
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return 'form-submit';
            }
            
            return null;
        });

        if (!salvarClicado) {
            // Ultima tentativa: busca e clica via Puppeteer nativo
            console.warn('[SALIC] AVISO: Nenhum botao salvar encontrado via evaluate. Tentando via Puppeteer...');
            try {
                const btnSalvar = await targetPage.$('button.btn:not(.btn-floating)');
                if (btnSalvar) await btnSalvar.click();
            } catch(e) {
                console.error('[SALIC] Falha ao clicar via Puppeteer:', e.message);
            }
        } else {
            console.log(`[SALIC] Botao Salvar acionado via: "${salvarClicado}"`);
        }

        // 9. VERIFICACAO POS-SAVE: Aguarda e analisa o resultado
        console.log('[SALIC] Aguardando resposta do servidor apos salvar...');
        await wait(6000); // Espera generosa para o servidor processar

        // Checa mensagens de sucesso ou erro na pagina
        const resultadoSalvamento = await targetPage.evaluate(() => {
            const body = document.body.innerText.toLowerCase();
            const toasts = Array.from(document.querySelectorAll('.toast, .toast-content, .alert, .notification, .card-panel'));
            const toastTexts = toasts.map(t => t.innerText.trim()).filter(Boolean);
            
            // Verifica se o modal fechou (sinal de sucesso no Materialize)
            const modal = document.querySelector('#modal1');
            const modalAberto = modal && (modal.classList.contains('open') || modal.style.display !== 'none');
            
            // Verifica erros de validacao dentro do modal
            const errosValidacao = Array.from(document.querySelectorAll('.invalid, .error, .red-text, .helper-text[data-error]'))
                .map(e => e.innerText || e.getAttribute('data-error'))
                .filter(Boolean);
            
            return {
                modalAberto,
                toastTexts,
                errosValidacao,
                contemSucesso: body.includes('sucesso') || body.includes('salvo') || body.includes('gravado') || body.includes('inserido'),
                contemErro: body.includes('erro') || body.includes('falha') || body.includes('inválid') || body.includes('obrigatório'),
                tituloAtual: document.title,
                urlAtual: window.location.href
            };
        });

        console.log('[SALIC] RESULTADO POS-SAVE:', JSON.stringify(resultadoSalvamento, null, 2));

        // Tira screenshot do estado final para debug
        const screenshotPath = `salic_resultado_${Date.now()}.png`;
        await targetPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        console.log(`[SALIC] Screenshot salvo: ${screenshotPath}`);

        // Analisa o resultado
        if (resultadoSalvamento.errosValidacao.length > 0) {
            const erroMsg = `Erros de validacao no formulario: ${resultadoSalvamento.errosValidacao.join(', ')}`;
            console.error(`[SALIC] FALHA: ${erroMsg}`);
            return { sucesso: false, erro: erroMsg };
        }

        if (resultadoSalvamento.modalAberto && resultadoSalvamento.contemErro) {
            return { sucesso: false, erro: `Modal ainda aberto com possiveis erros. Toasts: ${resultadoSalvamento.toastTexts.join('; ')}` };
        }

        // Se o modal fechou, provavelmente salvou
        if (!resultadoSalvamento.modalAberto || resultadoSalvamento.contemSucesso) {
            console.log('[SALIC] ✓ Insercao aparenta ter sido bem-sucedida (modal fechou ou mensagem de sucesso detectada)');
            return { sucesso: true, mensagem: 'Comprovacao financeira inserida com sucesso!' };
        }

        // FALLBACK: Resultado ambiguo - verifica diretamente na tabela se a insercao foi registrada
        console.warn('[SALIC] AVISO: Resultado ambiguo. Verificando na tabela de comprovacoes...');
        await wait(3000);

        try {
            await targetPage.goto(linkComprovacao, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await wait(3000);

            const insercaoConfirmada = await targetPage.evaluate((doc, valor) => {
                const rows = Array.from(document.querySelectorAll('table tbody tr'));
                const docLimpo = doc.replace(/\D/g, '');
                for (const row of rows) {
                    const texto = row.innerText;
                    if (texto.includes(docLimpo) || texto.includes(doc)) {
                        const cells = row.querySelectorAll('td');
                        for (const cell of cells) {
                            const cellText = cell.innerText.replace(/[R$\s.]/g, '').replace(',', '.');
                            const cellVal = parseFloat(cellText);
                            if (!isNaN(cellVal) && Math.abs(cellVal - parseFloat(valor)) < 0.01) {
                                return true;
                            }
                        }
                    }
                }
                return false;
            }, documento.cnpj_fornecedor, documento.valor);

            if (insercaoConfirmada) {
                console.log('[SALIC] ✓ VERIFICACAO POS-AMBIGUO: Insercao CONFIRMADA na tabela!');
                return { sucesso: true, mensagem: 'Comprovacao financeira inserida e verificada com sucesso (confirmada via tabela)!' };
            } else {
                console.warn('[SALIC] ✗ VERIFICACAO POS-AMBIGUO: Insercao NAO encontrada na tabela.');
                return { sucesso: false, erro: 'Insercao nao confirmada na tabela de comprovacoes apos envio. Verificar manualmente no SALIC.', toasts: resultadoSalvamento.toastTexts };
            }
        } catch (verifyError) {
            console.error('[SALIC] Erro durante verificacao pos-ambiguo:', verifyError.message);
            return { sucesso: false, erro: 'Resultado ambiguo e falha na verificacao automatica. Verificar manualmente.', toasts: resultadoSalvamento.toastTexts };
        }

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
        clearTimeout(globalTimeoutHandle);
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