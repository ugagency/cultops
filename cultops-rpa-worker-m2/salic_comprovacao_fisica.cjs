const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

async function executarComprovacaoFisica(config) {
    const { usuario, senha, pronac, rubricaNome, rubricaValorAprovado, evidencia } = config;

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

        // Helper: clica em item do menu/sidenav por trecho de texto (tolerante a acentos)
        async function clicarItem(pageRef, textoParc) {
            let clicou = false;
            for (let i = 0; i < 15; i++) {
                if (i === 0) {
                    const menuItems = await pageRef.evaluate(() =>
                        Array.from(document.querySelectorAll('a'))
                            .map(a => a.textContent.trim())
                            .filter(t => t.length > 2 && t.length < 60)
                            .slice(0, 30)
                    );
                    console.log('[SALIC M2] Menu items:', JSON.stringify(menuItems));
                }
                clicou = await pageRef.evaluate((txt) => {
                    const els = Array.from(document.querySelectorAll('a, li, span, button'));
                    for (const el of els) {
                        if (el.textContent.includes(txt)) {
                            const link = el.tagName === 'A' ? el : el.closest('a') || el;
                            link.click();
                            return true;
                        }
                    }
                    return false;
                }, textoParc);
                if (clicou) { console.log(`[SALIC M2] Item "${textoParc}" clicado.`); break; }
                await wait(2000);
            }
            if (!clicou) throw new Error(`Item contendo "${textoParc}" não encontrado no menu.`);
            await wait(2000);
        }

        // Helper: preenche campo Materialize (dispara todos os eventos necessários)
        async function setMaterializeField(pageRef, selector, value) {
            await pageRef.evaluate((sel, val) => {
                const el = document.querySelector(sel);
                if (!el) { console.warn('[RPA] Campo não encontrado:', sel); return; }
                el.focus();
                el.dispatchEvent(new Event('focus', { bubbles: true }));
                el.value = '';
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('keyup', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                const label = document.querySelector(`label[for="${el.id}"]`);
                if (label) label.classList.add('active');
                console.log('[RPA] Campo preenchido:', sel, '=', val);
            }, selector, value);
        }

        // Helper: seleciona opção em <select> Materialize
        async function setMaterializeSelect(pageRef, selector, value) {
            await pageRef.evaluate((sel, val) => {
                const el = document.querySelector(sel);
                if (!el) { console.warn('[RPA] Select não encontrado:', sel); return; }
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof M !== 'undefined' && M.FormSelect) M.FormSelect.init(el);
                else if (typeof $ !== 'undefined') $(el).material_select?.();
                console.log('[RPA] Select definido:', sel, '=', val);
            }, selector, value);
        }

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

        // PASSO 5: Status não cadastrado
        console.log('[SALIC M2] Selecionando "não cadastrado"...');
        await clicarItem(page, 'ão cadastrado');

        // PASSO 6: Comprovante de Execução
        console.log('[SALIC M2] Clicando em Comprovante de Execução...');
        await clicarItem(page, 'omprovante de Execução');

        // PASSO 7: Selecionar rubrica (fuzzy/Dice — igual M1)
        console.log(`[SALIC M2] Localizando rubrica: ${rubricaNome}`);
        const resultadoMatch = await page.evaluate((nome, valorAprovado) => {
            const norm = (s) => String(s || '')
                .replace(/^\d+\s*-\s*/, '')
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-zA-Z0-9 ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

            const tokensDe = (s) => norm(s).split(' ').filter(t => t.length >= 3);

            const dice = (a, b) => {
                if (!a || !b) return 0;
                if (a === b) return 1;
                const bigramas = (s) => {
                    const out = new Map();
                    for (let i = 0; i < s.length - 1; i++) {
                        const bg = s.slice(i, i + 2);
                        out.set(bg, (out.get(bg) || 0) + 1);
                    }
                    return out;
                };
                const ba = bigramas(a), bb = bigramas(b);
                let inter = 0, totalA = 0, totalB = 0;
                ba.forEach(v => totalA += v);
                bb.forEach(v => totalB += v);
                ba.forEach((v, k) => { if (bb.has(k)) inter += Math.min(v, bb.get(k)); });
                if (totalA + totalB === 0) return 0;
                return (2 * inter) / (totalA + totalB);
            };

            const rows = Array.from(document.querySelectorAll('table.bordered tbody tr, table tbody tr'));
            const nomeNorm = norm(nome);
            const tokensProcurados = tokensDe(nome);

            const candidatos = [];
            for (const row of rows) {
                const colunas = row.querySelectorAll('td');
                if (colunas.length < 2) continue;
                const btn = row.querySelector('a, button');
                if (!btn) continue;
                candidatos.push({
                    btn,
                    colunas,
                    nomeOriginal: colunas[0].innerText,
                    nomeNorm: norm(colunas[0].innerText),
                });
            }

            const nomeCompativel = (cNorm) => {
                if (cNorm === nomeNorm) return true;
                if (cNorm.includes(nomeNorm) || nomeNorm.includes(cNorm)) return true;
                if (tokensProcurados.length > 0 && tokensProcurados.every(t => cNorm.includes(t))) return true;
                return false;
            };

            if (valorAprovado) {
                for (const c of candidatos) {
                    if (!nomeCompativel(c.nomeNorm)) continue;
                    const strAprovado = c.colunas[1]?.innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                    if (strAprovado && Math.abs(parseFloat(strAprovado) - parseFloat(valorAprovado)) < 0.01) {
                        c.btn.scrollIntoView({ block: 'center' });
                        c.btn.click();
                        return { found: true, matchType: 'valor_aprovado', nomeTabela: c.nomeOriginal };
                    }
                }
            }

            for (const c of candidatos) {
                if (c.nomeNorm === nomeNorm) {
                    c.btn.scrollIntoView({ block: 'center' });
                    c.btn.click();
                    return { found: true, matchType: 'exato_normalizado', nomeTabela: c.nomeOriginal };
                }
            }

            for (const c of candidatos) {
                if (c.nomeNorm.includes(nomeNorm) || nomeNorm.includes(c.nomeNorm)) {
                    c.btn.scrollIntoView({ block: 'center' });
                    c.btn.click();
                    return { found: true, matchType: 'substring_normalizada', nomeTabela: c.nomeOriginal };
                }
            }

            if (tokensProcurados.length > 0) {
                for (const c of candidatos) {
                    if (tokensProcurados.every(t => c.nomeNorm.includes(t))) {
                        c.btn.scrollIntoView({ block: 'center' });
                        c.btn.click();
                        return { found: true, matchType: 'tokens', nomeTabela: c.nomeOriginal };
                    }
                }
            }

            let melhor = { score: 0 };
            for (const c of candidatos) {
                const s = dice(nomeNorm, c.nomeNorm);
                if (s > melhor.score) melhor = { c, score: s, nomeTabela: c.nomeOriginal };
            }
            if (melhor.score >= 0.85) {
                melhor.c.btn.scrollIntoView({ block: 'center' });
                melhor.c.btn.click();
                return { found: true, matchType: 'fuzzy', score: melhor.score, nomeTabela: melhor.nomeTabela };
            }

            return {
                found: false,
                candidatos: candidatos.map(c => c.nomeOriginal),
                melhorScore: melhor.score,
                melhorNome: melhor.nomeTabela
            };
        }, rubricaNome, rubricaValorAprovado);

        if (!resultadoMatch.found) {
            if (resultadoMatch.candidatos) {
                console.log(`[SALIC M2] Rubricas disponíveis (${resultadoMatch.candidatos.length}):`,
                    JSON.stringify(resultadoMatch.candidatos));
                if (resultadoMatch.melhorNome)
                    console.log(`[SALIC M2] Mais próxima: "${resultadoMatch.melhorNome}" (score ${resultadoMatch.melhorScore?.toFixed(2)}) — abaixo do limiar 0.85`);
            }
            throw new Error(`Rubrica "${rubricaNome}" não encontrada na lista de Comprovação Física.`);
        }
        console.log(`[SALIC M2] Rubrica casada (${resultadoMatch.matchType}): "${resultadoMatch.nomeTabela}"`);
        await wait(2000);

        // PASSO 8: Botão flutuante (+) — SEMPRE via page.evaluate(), NUNCA page.click()
        console.log('[SALIC M2] Clicando no botão flutuante (+)...');
        await page.evaluate(() => {
            const seletores = [
                '.fixed-action-btn a.btn-floating',
                'a.btn-floating i.fa-plus',
                'a[title*="Inserir"]',
                'a[title*="Novo"]'
            ];
            for (const sel of seletores) {
                const el = document.querySelector(sel);
                if (el) {
                    el.scrollIntoView({ block: 'center' });
                    el.click();
                    return;
                }
            }
            // Fallback: remove overlay e tenta clicar
            document.querySelector('.fixed-action-btn')?.remove();
            document.querySelector('a.btn-floating')?.click();
        });
        await wait(2000);

        // PASSO 9: Upload do arquivo
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

        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.uploadFile(localPath);
            console.log('[SALIC M2] Upload realizado.');
        } else {
            throw new Error('Campo input[type="file"] não encontrado no formulário.');
        }
        await wait(1000);

        // PASSO 10: Preencher observação/descrição se existir
        if (evidencia.descricao) {
            console.log('[SALIC M2] Preenchendo descrição/observação...');
            await page.evaluate((desc) => {
                const campos = document.querySelectorAll('textarea, input[type="text"]');
                for (const el of campos) {
                    const lbl = document.querySelector(`label[for="${el.id}"]`);
                    if (lbl && (
                        lbl.textContent.includes('escrição') ||
                        lbl.textContent.includes('bservação') ||
                        lbl.textContent.includes('bservacao')
                    )) {
                        el.value = desc;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }, evidencia.descricao);
            await wait(500);
        }

        // Auditoria dos campos antes de salvar
        const estadoCampos = await page.evaluate(() => {
            const campos = document.querySelectorAll('input:not([type="file"]):not([type="hidden"]), textarea, select');
            const resultado = {};
            campos.forEach(el => {
                const chave = el.id || el.name;
                if (chave) resultado[chave] = el.value || '(vazio)';
            });
            return resultado;
        });
        console.log('[SALIC M2] AUDITORIA - campos antes de salvar:', JSON.stringify(estadoCampos, null, 2));

        // PASSO 11: Salvar
        console.log('[SALIC M2] Clicando em Salvar...');
        const salvarClicado = await page.evaluate(() => {
            const btns = document.querySelectorAll('button.btn, button[type="submit"], input[type="submit"]');
            for (let b of btns) {
                const texto = (b.innerText || b.value || '').toLowerCase();
                if (texto.includes('salvar') || texto.includes('gravar') || texto.includes('enviar')) {
                    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return texto;
                }
            }
            const form = document.querySelector('form');
            if (form) {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return 'form-submit';
            }
            return null;
        });

        if (!salvarClicado) {
            console.warn('[SALIC M2] Nenhum botão salvar via evaluate. Tentando via Puppeteer...');
            try {
                const btnSalvar = await page.$('button.btn:not(.btn-floating)');
                if (btnSalvar) await btnSalvar.click();
            } catch (e) {
                console.error('[SALIC M2] Falha ao clicar via Puppeteer:', e.message);
            }
        } else {
            console.log(`[SALIC M2] Botão Salvar acionado via: "${salvarClicado}"`);
        }

        // PASSO 12: Verificação pós-save
        console.log('[SALIC M2] Aguardando resposta do servidor...');
        await wait(6000);

        const resultadoSalvamento = await page.evaluate(() => {
            const body = document.body.innerText.toLowerCase();
            const toasts = Array.from(document.querySelectorAll('.toast, .toast-content, .alert, .notification, .card-panel'));
            const toastTexts = toasts.map(t => t.innerText.trim()).filter(Boolean);
            const modal = document.querySelector('#modal1, .modal.open');
            const modalAberto = modal && (modal.classList.contains('open') || modal.style.display !== 'none');
            const errosValidacao = Array.from(document.querySelectorAll('.invalid, .error, .red-text, .helper-text[data-error]'))
                .map(e => e.innerText || e.getAttribute('data-error'))
                .filter(Boolean);
            return {
                modalAberto,
                toastTexts,
                errosValidacao,
                contemSucesso: body.includes('sucesso') || body.includes('salvo') || body.includes('gravado') || body.includes('inserido'),
                contemErro: body.includes('erro') || body.includes('falha') || body.includes('inválid') || body.includes('obrigatório'),
            };
        });

        console.log('[SALIC M2] RESULTADO PÓS-SAVE:', JSON.stringify(resultadoSalvamento, null, 2));

        const screenshotPath = path.join(os.tmpdir(), `salic_m2_resultado_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        console.log(`[SALIC M2] Screenshot salvo: ${screenshotPath}`);

        if (resultadoSalvamento.errosValidacao.length > 0) {
            const erroMsg = `Erros de validação no formulário: ${resultadoSalvamento.errosValidacao.join(', ')}`;
            console.error(`[SALIC M2] FALHA: ${erroMsg}`);
            return { sucesso: false, erro: erroMsg };
        }

        if (resultadoSalvamento.modalAberto && resultadoSalvamento.contemErro) {
            return { sucesso: false, erro: `Modal ainda aberto com erros. Toasts: ${resultadoSalvamento.toastTexts.join('; ')}` };
        }

        if (!resultadoSalvamento.modalAberto || resultadoSalvamento.contemSucesso) {
            console.log('[SALIC M2] ✓ Comprovação física inserida com sucesso!');
            return { sucesso: true, mensagem: 'Comprovação física inserida com sucesso!' };
        }

        return {
            sucesso: false,
            erro: 'Resultado ambíguo — verificar manualmente no SALIC.',
            toasts: resultadoSalvamento.toastTexts
        };

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
