const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

async function executarComprovacaoFisica(config) {
    const { usuario, senha, pronac, evidencia } = config;

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, response => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
        });
    }

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

    console.log('[SALIC M2] Plataforma:', process.platform, '| Chrome:', launchOptions.executablePath || 'bundled');
    const browser = await puppeteer.launch(launchOptions);

    const globalTimeoutHandle = setTimeout(async () => {
        console.error('[SALIC M2] TIMEOUT GLOBAL: Execução excedeu 4 minutos. Fechando browser...');
        try { await browser.close(); } catch (e) {}
    }, 240000);

    let page;
    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        if (!usuario || typeof usuario !== 'string')
            throw new Error(`Usuário inválido ou não informado (tipo: ${typeof usuario})`);
        if (!senha || typeof senha !== 'string')
            throw new Error(`Senha inválida ou não informada (tipo: ${typeof senha})`);

        // PASSO 1: Login
        console.log(`[SALIC M2] Iniciando login: ${usuario}`);
        await page.goto('http://salic.cultura.gov.br', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#Login', { timeout: 30000 });
        await page.type('#Login', usuario, { delay: 50 });
        await wait(500);
        await page.type('#Senha', senha, { delay: 50 });
        await wait(500);

        await page.evaluate(() => {
            const botoes = Array.from(document.querySelectorAll('button'));
            const btnEntrar = botoes.find(b => b.innerText.trim().toUpperCase() === 'ENTRAR');
            if (btnEntrar) btnEntrar.click();
            else document.querySelector('button[type="submit"]').click();
        });

        console.log('[SALIC M2] Botão Entrar clicado... aguardando servidor.');
        await wait(8000);
        await page.waitForFunction(
            () => document.body && document.body.innerText.length > 0,
            { timeout: 15000 }
        ).catch(() => {});
        await wait(1000);

        const loginCheck = await page.evaluate(() => {
            if (!document.body) return { temErro: false };
            const body = (document.body.innerText || '').toLowerCase();
            const temErro = body.includes('senha inválida') || body.includes('senha invalida') ||
                body.includes('usuário não encontrado') || body.includes('usuario nao encontrado') ||
                body.includes('login incorreto') || body.includes('dados inválidos') || body.includes('tente novamente');
            return { temErro };
        });
        console.log('[SALIC M2] Verificação pós-login:', JSON.stringify(loginCheck));
        if (loginCheck.temErro) throw new Error('Falha no login SALIC: credenciais inválidas ou usuário bloqueado.');

        // PASSO 2: Navegar ao projeto por PRONAC
        console.log('[SALIC M2] Navegando para lista de projetos...');
        await page.goto('https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente', {
            waitUntil: 'domcontentloaded', timeout: 60000
        });
        await page.waitForSelector('input[aria-label="Buscar"]');
        console.log('[SALIC M2] Buscando PRONAC:', pronac);
        await page.type('input[aria-label="Buscar"]', pronac);
        await wait(3000);

        const urlProjeto = await page.evaluate((p) => {
            const links = Array.from(document.querySelectorAll('table tbody tr td a'));
            const alvo = links.find(a => a.innerText.includes(p));
            return alvo ? alvo.href : null;
        }, pronac);

        if (!urlProjeto) throw new Error('Link do PRONAC não encontrado na tabela.');

        console.log('[SALIC M2] Navegando para o projeto...');
        await page.goto(urlProjeto, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await wait(3000);

        // PASSO 3: Menu → Comprovação Física (collapsible-header Materialize)
        console.log('[SALIC M2] Acessando Comprovação Física...');
        await page.evaluate(() => {
            const spans = Array.from(
                document.querySelectorAll('li.bold a.collapsible-header span')
            );
            const span = spans.find(s => s.textContent.trim() === 'Comprovação Física');
            if (span) {
                span.closest('a.collapsible-header').click();
                console.log('[RPA] Comprovação Física clicada');
            } else {
                console.warn('[RPA] Comprovação Física não encontrada');
            }
        });
        await wait(1500);

        // PASSO 4: Relatório Trimestral (link dentro do collapsible-body expandido)
        console.log('[SALIC M2] Clicando em Relatório Trimestral...');
        await page.evaluate(() => {
            const links = Array.from(
                document.querySelectorAll('div.collapsible-body a[title="Ir para"]')
            );
            const link = links.find(a => a.textContent.trim() === 'Relatório Trimestral');
            if (link) {
                link.click();
                console.log('[RPA] Relatório Trimestral clicado');
            } else {
                console.warn('[RPA] Relatório Trimestral não encontrado');
            }
        });
        await wait(2000);

        // PASSO 5: Clicar em "Não cadastrado" (link em td da tabela de status)
        console.log('[SALIC M2] Selecionando "Não cadastrado"...');
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('td a'));
            const link = links.find(a =>
                a.textContent.trim().toLowerCase().includes('ão cadastrado')
            );
            if (link) {
                link.click();
                console.log('[RPA] Não cadastrado clicado');
            } else {
                console.warn('[RPA] Status "Não cadastrado" não encontrado');
            }
        });
        await wait(2000);

        // PASSO 6: Clicar em "Comprovantes de Execução" (menu lateral da tela Etapas de Trabalho)
        console.log('[SALIC M2] Clicando em Comprovantes de Execução...');
        await page.evaluate(() => {
            const link = document.querySelector('a[title="Comprovantes de Execução"]');
            if (link) {
                link.click();
                console.log('[RPA] Comprovantes de Execução clicado');
            } else {
                console.warn('[RPA] Link "Comprovantes de Execução" não encontrado');
            }
        });
        await wait(2000);

        // PASSO 7: Mapear tipo de comprovante (22=Fotos, 23=Vídeos, 24=Arquivo)
        // O formulário desta tela não tem campo de rubrica — apenas tipo, arquivo e observações.
        function mapearTipoComprovante(tipoEvidencia) {
            const mapa = {
                'foto_evento':      '22',
                'peca_marketing':   '22',
                'relatorio_objeto': '24',
                'outros':           '24'
            };
            return mapa[tipoEvidencia] || '24';
        }
        const tipoValue = mapearTipoComprovante(evidencia.tipo);
        console.log(`[SALIC M2] Tipo de comprovante: ${tipoValue} (evidencia.tipo="${evidencia.tipo}")`);

        // PASSO 8: Preencher o formulário (jQuery UI — sem botão flutuante)
        // 8a. Selecionar tipo de comprovante
        await page.select('select[name="tipoDocumento"]', tipoValue);
        console.log('[SALIC M2] select[name="tipoDocumento"] =', tipoValue);
        await wait(500);

        // 8b. Download e upload do arquivo
        console.log(`[SALIC M2] Baixando arquivo: ${evidencia.file_name}`);
        const localPath = path.join(os.tmpdir(), `ev_${Date.now()}_${evidencia.file_name}`);
        await downloadFile(evidencia.file_url, localPath);

        const fileStats = fs.statSync(localPath);
        if (!fileStats || fileStats.size < 100) {
            console.warn('[SALIC M2] Arquivo com tamanho suspeito. Re-tentando download...');
            await downloadFile(evidencia.file_url, localPath);
            const retryStats = fs.statSync(localPath);
            if (!retryStats || retryStats.size < 100)
                throw new Error(`Arquivo baixado inválido (${retryStats?.size || 0} bytes).`);
        }
        console.log(`[SALIC M2] Arquivo baixado: ${fileStats.size} bytes`);

        const fileInput = await page.$('input[type="file"][name="arquivo"]');
        if (!fileInput) throw new Error('Campo input[type="file"][name="arquivo"] não encontrado.');
        await fileInput.uploadFile(localPath);
        console.log('[SALIC M2] Arquivo carregado:', localPath);
        await wait(500);

        // 8c. Preencher observações (campo obrigatório — fallback se descricao vazia)
        const observacoes = evidencia.descricao ||
            `Comprovante de execução — ${evidencia.file_name} — enviado via PrestAI`;

        await page.evaluate((obs) => {
            const textarea = document.querySelector('textarea[name="observacoes"]');
            if (textarea) {
                textarea.value = obs;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
                const label = document.querySelector(`label[for="${textarea.id}"]`);
                if (label) label.classList.add('active');
                console.log('[RPA] Observações preenchidas');
            } else {
                console.warn('[RPA] textarea[name="observacoes"] não encontrado');
            }
        }, observacoes);
        await wait(300);

        // PASSO 9: Log de auditoria pré-save
        const estadoCampos = await page.evaluate(() => ({
            tipoDocumento: document.querySelector('select[name="tipoDocumento"]')?.value || '(vazio)',
            arquivo:       document.querySelector('input[name="arquivo"]')?.value || '(vazio)',
            observacoes:   document.querySelector('textarea[name="observacoes"]')?.value?.substring(0, 100) || '(vazio)'
        }));
        console.log('[SALIC M2] PRÉ-SAVE:', JSON.stringify(estadoCampos));

        // PASSO 10: Clicar em Salvar via #btn_salvar
        // Deixa o jQuery fazer a validação de .obrigatorio antes de submeter
        console.log('[SALIC M2] Clicando em #btn_salvar...');
        await page.evaluate(() => {
            const btn = document.querySelector('#btn_salvar');
            if (btn) {
                btn.click();
                console.log('[RPA] #btn_salvar clicado');
            } else {
                // Fallback: submit direto do form
                const form = document.querySelector('#formCadastroComprovante');
                if (form) { form.submit(); console.warn('[RPA] Fallback: form submetido diretamente'); }
                else console.warn('[RPA] #btn_salvar e #formCadastroComprovante não encontrados');
            }
        });
        console.log('[SALIC M2] Aguardando resposta do servidor...');
        await wait(6000);

        // PASSO 11: Verificação pós-save — jQuery UI dialog (não Materialize)
        const resultado = await page.evaluate(() => {
            const body = document.body.innerText.toLowerCase();
            const dialog = document.querySelector('.ui-dialog:not([style*="display: none"])');
            const dialogTexto = dialog ? dialog.innerText.trim() : null;
            const tabela = document.querySelector('table.tabela:last-of-type tbody');
            const linhasNaTabela = tabela ? tabela.querySelectorAll('tr').length : 0;
            return {
                dialogAberto:    !!dialog,
                dialogTexto,
                linhasNaTabela,
                contemSucesso: body.includes('sucesso') || body.includes('cadastrado') || body.includes('salvo'),
                contemErro:    body.includes('erro') || body.includes('obrigatório') || body.includes('inválid'),
                urlAtual:      window.location.href
            };
        });
        console.log('[SALIC M2] PÓS-SAVE:', JSON.stringify(resultado));

        if (resultado.dialogAberto && resultado.dialogTexto?.toLowerCase().includes('obrig')) {
            throw new Error(
                'SALIC bloqueou: campos obrigatórios não preenchidos. Dialog: ' + resultado.dialogTexto
            );
        }

        if (resultado.contemErro) {
            throw new Error('SALIC retornou erro: ' + (resultado.dialogTexto || 'verificar log'));
        }

        // PASSO 12: Screenshot e retorno
        const screenshotPath = path.join(os.tmpdir(), `salic_m2_resultado_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        console.log(`[SALIC M2] Screenshot salvo: ${screenshotPath}`);

        // Fecha dialog de sucesso se aberto
        await page.evaluate(() => {
            const btnOk = document.querySelector('.ui-dialog-buttonset button');
            if (btnOk) btnOk.click();
        });

        console.log('[SALIC M2] ✓ Comprovante de execução cadastrado com sucesso!');
        return { sucesso: true, mensagem: 'Comprovante de execução cadastrado com sucesso!' };

    } catch (error) {
        console.error('[SALIC M2] ERRO:', error.message);
        try {
            if (page) {
                const html = await page.evaluate(() => document.body?.innerText.substring(0, 500));
                console.error('[SALIC M2] Conteúdo da página no erro:', html);
                const errPath = path.join(os.tmpdir(), `erro_salic_m2_${Date.now()}.png`);
                await page.screenshot({ path: errPath }).catch(() => {});
            }
        } catch (e) {}
        return { sucesso: false, erro: error.message };
    } finally {
        clearTimeout(globalTimeoutHandle);
        if (browser) await browser.close();
    }
}

module.exports = { executarComprovacaoFisica };
