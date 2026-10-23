const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const { localizarPronac, mascararCpf } = require('./salic_proponente.cjs');
const { exigirSaidaDoLogin, conferirPronacNaTela, aguardarFimDoSalvamento } = require('./salic_verificacoes.cjs');

// tpDocumento values descobertos no SALIC:
//   '1' = Cupom Fiscal
//   '2' = Guia de Recolhimento
//   '3' = Nota Fiscal/Fatura
//   '4' = Recibo de Pagamento
//   '5' = RPA
const TP_DOCUMENTO_RECIBO = '4';

// Helper: dispara TODOS os eventos que o Materialize CSS precisa para reconhecer um campo
// (movido para o escopo do módulo, sem alteração, para poder ser testado com HTML fixo).
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

// #dsJustificativa: o SALIC exige justificativa para aceitar comprovante em rubrica
// excedida (documents.justificativa_salic, gravada pela tela antes do envio).
// Sem justificativa o campo continua vazio, como antes. Com justificativa, confere
// o valor lido de volta e LANCA erro se o campo faltar ou divergir: enviar sem a
// justificativa faria o SALIC recusar o comprovante.
async function preencherJustificativaSalic(pageRef, justificativa, log = console.log) {
    const texto = (justificativa || '').toString().trim();
    if (!texto) {
        log('[SALIC] Justificativa: campo opcional, deixado vazio (não preenchido).');
        return false;
    }

    await setMaterializeField(pageRef, '#dsJustificativa', texto);

    const lido = await pageRef.evaluate(() => {
        const el = document.querySelector('#dsJustificativa');
        return el ? el.value : null;
    });
    // O textarea normaliza quebras de linha para \n ao receber o valor.
    const normalizar = (s) => String(s).replace(/\r\n?/g, '\n');
    if (lido === null) {
        throw new Error('Justificativa fornecida mas o campo #dsJustificativa não foi preenchido (campo não encontrado).');
    }
    if (normalizar(lido) !== normalizar(texto)) {
        throw new Error(`Justificativa fornecida mas o campo #dsJustificativa não foi preenchido (valor lido com ${lido.length} caracteres, esperado ${texto.length}).`);
    }
    log(`[SALIC] Justificativa preenchida e conferida (${texto.length} caracteres).`);
    return true;
}

// ── Busca do fornecedor por CNPJ/CPF (lupa do modal de inserção) ─────────────────
//
// Ocorrência #78: a busca esperava 5s fixos e, se o nome não aparecia, mais 6s
// fixos antes de abortar. A mesma NFS (CNPJ existente no SALIC) falhou às 18:47 UTC e
// passou às 20:40 UTC do mesmo dia: a resposta do SALIC é intermitente e às vezes
// demora mais que a espera fixa. Agora cada tentativa faz polling a cada 500ms por
// até 20s e devolve assim que o nome aparece; são até 3 tentativas e, no máximo, 60s
// por documento nessa etapa.

const SELETORES_NOME_FORNECEDOR = ['#Descricao', '#nmFornecedor', '#razaoSocial', 'input[name="Descricao"]'];
const pausaSalic = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function lerNomeFornecedorSalic(pageRef) {
    try {
        return await pageRef.evaluate((seletores) => {
            for (const sel of seletores) {
                const el = document.querySelector(sel);
                if (el && el.value) return el.value;
            }
            return null;
        }, SELETORES_NOME_FORNECEDOR);
    } catch (e) {
        return null; // erro de leitura (página trocando) não conclui nem aborta: o polling segue
    }
}

// Texto visível do #modal1 (innerText ignora o que está oculto) e valor de #CNPJCPF.
async function lerModalSalic(pageRef) {
    try {
        return await pageRef.evaluate(() => {
            const modal = document.querySelector('#modal1');
            const campo = document.querySelector('#CNPJCPF');
            return {
                texto: modal ? String(modal.innerText || '').replace(/\s+/g, ' ').trim() : '',
                cnpjcpf: campo ? campo.value : null
            };
        });
    } catch (e) {
        return { texto: '', cnpjcpf: null };
    }
}

async function clicarLupaSalic(pageRef) {
    await pageRef.evaluate(() => {
        const modal = document.querySelector('#modal1');
        const container = modal || document;
        const btns = container.querySelectorAll('button.btn i.material-icons');
        for (const i of btns) {
            if (i.innerText.trim() === 'search') { i.parentElement.click(); break; }
        }
    });
}

// Quantas vezes o texto traz uma mensagem de fornecedor inexistente. Sem acento e em
// minúsculas; só conta termos de "não encontrado/inexistente/não cadastrado". O chamador
// compara com o texto de ANTES da busca, para que um aviso fixo do modal não seja
// confundido com a resposta da busca.
function contarIndiciosFornecedorInexistente(texto) {
    const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const achados = t.match(/nao encontrad[oa]|inexistente|nao cadastrad[oa]/g);
    return achados ? achados.length : 0;
}

async function aguardarNomeFornecedorSalic(pageRef, { timeoutMs = 20000, intervaloMs = 500 } = {}) {
    const inicio = Date.now();
    for (; ;) {
        const nome = await lerNomeFornecedorSalic(pageRef);
        const ms = Date.now() - inicio;
        if (nome) return { nome, ms };
        if (ms >= timeoutMs) return { nome: null, ms };
        await pausaSalic(Math.max(1, Math.min(intervaloMs, timeoutMs - ms)));
    }
}

/**
 * Espera o nome do fornecedor depois do clique na lupa (já feito pelo chamador) e, se não
 * vier, refaz a busca (limpa o campo, digita de novo, clica na lupa) até 3 tentativas,
 * respeitando o limite total. Devolve o nome ou LANÇA erro:
 *  (a) o modal passou a exibir uma mensagem explícita de "não encontrado": o fornecedor
 *      não está no SALIC;
 *  (b) nada voltou dentro do tempo: pode não estar cadastrado ou o SALIC não ter respondido.
 */
async function buscarFornecedorSalic(pageRef, {
    documentoSoNumeros, tipoPessoaLabel, docFornecedor, textoModalBase = '',
    tentativasMax = 3, timeoutTentativaMs = 20000, limiteTotalMs = 60000, intervaloMs = 500,
    margemMinimaMs = 5000, atrasoDigitacaoMs = 100, estabilizacaoMs = 1000, log = console.log
}) {
    const inicio = Date.now();
    const prazo = inicio + limiteTotalMs;
    // Referência: texto do modal antes da busca. Vale para todas as tentativas (uma mensagem que
    // ficou na tela depois da 1a continua sendo resposta da busca, não aviso fixo).
    const base = textoModalBase || '';
    let ultimoModal = { texto: '', cnpjcpf: null };
    let mensagemExplicita = false;
    let tentativasFeitas = 0;

    for (let t = 1; t <= tentativasMax; t++) {
        if (t > 1) {
            if (prazo - Date.now() < margemMinimaMs) {
                log(`[SALIC] Busca do fornecedor: sem tempo para a ${t}a tentativa (limite de ${Math.round(limiteTotalMs / 1000)}s).`);
                break;
            }
            log(`[SALIC] FALLBACK: Fornecedor nao encontrado. Re-tentando busca (${t}a tentativa)...`);
            const docRetry = await pageRef.$('#CNPJCPF');
            if (docRetry) {
                await docRetry.click({ clickCount: 3 });
                await docRetry.press('Backspace');
                await pausaSalic(500);
                await docRetry.type(documentoSoNumeros, { delay: atrasoDigitacaoMs });
                await pausaSalic(500);
            }
            await clicarLupaSalic(pageRef);
        }
        tentativasFeitas = t;
        const { nome, ms } = await aguardarNomeFornecedorSalic(pageRef, {
            timeoutMs: Math.max(0, Math.min(timeoutTentativaMs, prazo - Date.now())), intervaloMs
        });
        let motivoNaoDetectado = `apos ${ms}ms`;
        if (nome) {
            // Estabilização: o nome pode aparecer e ser limpo logo em seguida (re-render do
            // modal). Espera um instante e lê de novo; vale o valor lido por último.
            await pausaSalic(estabilizacaoMs);
            const nomeFinal = await lerNomeFornecedorSalic(pageRef);
            if (nomeFinal) {
                log(`[SALIC] Fornecedor encontrado${t > 1 ? ` na ${t}a tentativa` : ''} (total ${Date.now() - inicio}ms)${nomeFinal !== nome ? ' [o valor mudou na estabilizacao; usando o ultimo lido]' : ''}: ${nomeFinal}`);
                return nomeFinal;
            }
            motivoNaoDetectado = `(o nome apareceu e foi apagado em ${estabilizacaoMs}ms)`;
        }
        ultimoModal = await lerModalSalic(pageRef);
        mensagemExplicita = contarIndiciosFornecedorInexistente(ultimoModal.texto) > contarIndiciosFornecedorInexistente(base);
        log(`[SALIC] Fornecedor: NAO DETECTADO ${motivoNaoDetectado} na ${t}a tentativa (verifique ${tipoPessoaLabel})`);
    }

    // Diagnóstico da falha final: texto visível do modal (500 caracteres) e o valor lido de
    // #CNPJCPF (CPF mascarado). Nunca senha, token ou o login do usuário SALIC.
    const docLido = ultimoModal.cnpjcpf == null ? null
        : (String(ultimoModal.cnpjcpf).replace(/\D/g, '').length === 11 ? mascararCpf(ultimoModal.cnpjcpf) : ultimoModal.cnpjcpf);
    log(`[SALIC] DIAGNOSTICO busca de fornecedor: #CNPJCPF=${JSON.stringify(docLido)} | #modal1=${JSON.stringify(ultimoModal.texto.slice(0, 500))}`);

    if (mensagemExplicita) {
        throw new Error(`Fornecedor com ${tipoPessoaLabel} ${docFornecedor} nao encontrado no SALIC (o SALIC respondeu que ele nao esta cadastrado). Cadastre manualmente no SALIC antes de executar o Robô.`);
    }
    throw new Error(`Fornecedor com ${tipoPessoaLabel} ${docFornecedor} nao localizado no SALIC dentro do prazo (${tentativasFeitas} tentativas em ${Math.round((Date.now() - inicio) / 1000)}s). Confira se esta cadastrado no SALIC; se estiver, reenvie o documento mais tarde.`);
}

/**
 * Script de Inserção de Comprovação Financeira no SALIC
 * @param {Object} config - Objeto com credenciais e dados da despesa
 */
async function executarInsercaoSalic(config) {
    const { usuario, senha, pronac, rubricaNome, documento } = config;

    // CHG-13 (rev): tipo do documento via documents.recibo (text: 'yes' = Recibo;
    // 'no'/outro/null = Nota Fiscal). É preciso comparar o VALOR — qualquer string
    // não-vazia (incl. "no") é truthy, então não dá para usar só a presença do campo.
    const isRecibo = String(documento.recibo || '').trim().toLowerCase() === 'yes';
    console.log(`[SALIC] recibo: "${documento.recibo}" | isRecibo: ${isRecibo}`);

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
                // Qualquer outra resposta que não seja 200 (ex.: 400/403/404 de URL assinada
                // expirada ou arquivo ausente) NÃO pode virar "PDF" gravado em disco. A mensagem
                // não inclui a URL.
                if (response.statusCode !== 200) {
                    response.resume();
                    file.close();
                    fs.unlink(dest, () => { });
                    return reject(new Error(`Falha no download (HTTP ${response.statusCode})`));
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', err => {
                fs.unlink(dest, () => { });
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
        try { await browser.close(); } catch (e) { }
    }, 240000);

    let targetPage;
    let page;
    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`[SALIC] Iniciando login para o usuario: ${mascararCpf(usuario)} (Tipo: ${typeof usuario})`);
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
        await page.waitForFunction(() => document.body && document.body.innerText.length > 0, { timeout: 15000 }).catch(() => { });
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
        // O SALIC pode recusar o login sem mostrar mensagem: a página só
        // fica em /autenticacao/. Sem isto o erro aparecia como timeout em
        // "Proponentes" (ocorrência #58, 13/10/2026).
        await exigirSaidaDoLogin(page, mascararCpf(usuario));

        console.log(`[SALIC] Navegando para a lista de projetos...`);
        // 2. IR PARA A LISTAGEM
        await page.goto('https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente', {
            waitUntil: 'domcontentloaded', timeout: 60000
        });

        console.log('[SALIC] Buscando projeto:', pronac);
        // Um PRONAC só existe sob um proponente — percorre todos os
        // proponentes do combobox até achar (ver salic_proponente.cjs).
        // Se não achar em nenhum, localizarPronac lança e a inserção para
        // aqui, sem tentar gravar nada.
        const { href: urlProjeto, proponente } = await localizarPronac(
            page, pronac, (msg) => console.log(msg)
        );
        console.log(`[SALIC] PRONAC encontrado sob o proponente: ${proponente}`);

        console.log('[SALIC] Navegando para os detalhes do projeto na mesma aba...');
        await page.goto(urlProjeto, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // A partir de agora, o targetPage é a própria página (não abrimos nova aba)
        targetPage = page;

        // ── CONFERÊNCIA OBRIGATÓRIA ANTES DE QUALQUER GRAVAÇÃO ──────────
        // Robô de ESCRITA: mesmo já tendo achado o link pelo proponente
        // certo, confirma que o PRONAC esperado aparece na própria tela
        // do projeto antes de prosseguir. Se não bater, aborta sem tentar
        // inserir nada. Palavra inteira (\b...\b), não includes() — um
        // "includes" bateria também dentro de "1248504" ou "2485040".
        // Espera a SPA renderizar (até 20s): rodar logo após o goto
        // abortava com a tela ainda vazia (ocorrência #58, 14/10/2026).
        // Célula PRONAC primeiro, texto da página como fallback — ver
        // salic_verificacoes.cjs.
        console.log(`[SALIC] Conferindo PRONAC na tela do projeto (proponente "${proponente}")...`);
        await conferirPronacNaTela(targetPage, pronac, { log: (msg) => console.log(msg) });

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
        console.log(`[SALIC] Localizando a rubrica: ${rubricaNome}` + (config.rubricaProduto ? ` | Produto: ${config.rubricaProduto}` : ''));
        const resultadoMatch = await targetPage.evaluate(
            (nome, produto, valorAprovado, valorNota) => {

            // ── utilidades ────────────────────────────────────────────────────
            const norm = (s) => String(s || '')
                .replace(/^\d+\s*-\s*/, '')
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-zA-Z0-9 ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

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

            const nomeCompativel = (cNorm, nomeNorm, tokensProcurados) => {
                if (cNorm === nomeNorm) return true;
                if (cNorm.includes(nomeNorm) || nomeNorm.includes(cNorm)) return true;
                if (tokensProcurados.length > 0 && tokensProcurados.every(t => cNorm.includes(t))) return true;
                return false;
            };

            // ── coleta candidatos de um conjunto de linhas <tr> ───────────────
            const coletarCandidatos = (rows) => {
                const candidatos = [];
                for (const row of rows) {
                    const colunas = row.querySelectorAll('td');
                    if (colunas.length < 5) continue;
                    const btn = row.querySelector('a[title="Comprovar item"]');
                    if (!btn) continue;
                    candidatos.push({
                        btn,
                        nomeOriginal: colunas[0].innerText.trim(),
                        nomeNorm: norm(colunas[0].innerText),
                        strAprovado: colunas[1].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim(),
                        strSaldo: colunas[3].innerText.replace('R$', '').replace(/\./g, '').replace(',', '.').trim(),
                    });
                }
                return candidatos;
            };

            // ── match em cascata dentro de um conjunto de candidatos ───────────
            const matchCandidatos = (candidatos, nomeNorm, tokensProcurados, valorAprovado, valorNota) => {
                // 1. valor_aprovado exato + nome compativel
                if (valorAprovado) {
                    const porValor = candidatos.filter(c =>
                        nomeCompativel(c.nomeNorm, nomeNorm, tokensProcurados) &&
                        Math.abs(parseFloat(c.strAprovado) - parseFloat(valorAprovado)) < 0.01
                    );
                    if (porValor.length === 1)
                        return { link: porValor[0].btn.href, matchType: 'valor_aprovado', score: 1, nomeTabela: porValor[0].nomeOriginal };
                    if (porValor.length > 1)
                        return { link: null, erro_ambiguidade: true, candidatos: porValor.map(c => c.nomeOriginal) };
                }

                // 2. exato normalizado
                const exatos = candidatos.filter(c => c.nomeNorm === nomeNorm);
                if (exatos.length === 1)
                    return { link: exatos[0].btn.href, matchType: 'exato_normalizado', score: 1, nomeTabela: exatos[0].nomeOriginal };
                if (exatos.length > 1)
                    return { link: null, erro_ambiguidade: true, candidatos: exatos.map(c => c.nomeOriginal) };

                // 3. substring normalizada
                const substrings = candidatos.filter(c =>
                    c.nomeNorm.includes(nomeNorm) || nomeNorm.includes(c.nomeNorm)
                );
                if (substrings.length === 1)
                    return { link: substrings[0].btn.href, matchType: 'substring_normalizada', score: 0.95, nomeTabela: substrings[0].nomeOriginal };
                if (substrings.length > 1)
                    return { link: null, erro_ambiguidade: true, candidatos: substrings.map(c => c.nomeOriginal) };

                // 4. todos os tokens presentes
                if (tokensProcurados.length > 0) {
                    const porTokens = candidatos.filter(c =>
                        tokensProcurados.every(t => c.nomeNorm.includes(t))
                    );
                    if (porTokens.length === 1)
                        return { link: porTokens[0].btn.href, matchType: 'tokens', score: 0.9, nomeTabela: porTokens[0].nomeOriginal };
                    if (porTokens.length > 1)
                        return { link: null, erro_ambiguidade: true, candidatos: porTokens.map(c => c.nomeOriginal) };
                }

                // 5. fuzzy Dice >= 0.85
                let melhor = { score: 0 };
                for (const c of candidatos) {
                    const s = dice(nomeNorm, c.nomeNorm);
                    if (s > melhor.score) melhor = { link: c.btn.href, matchType: 'fuzzy', score: s, nomeTabela: c.nomeOriginal };
                }
                if (melhor.score >= 0.85) return melhor;

                // 6. saldo suficiente (fallback comportamento anterior)
                for (const c of candidatos) {
                    if (parseFloat(c.strSaldo) >= parseFloat(valorNota)) {
                        return { link: c.btn.href, matchType: 'saldo_suficiente', score: 0, nomeTabela: c.nomeOriginal };
                    }
                }

                return null;
            };

            // ── logica principal ──────────────────────────────────────────────
            const nomeNorm = norm(nome);
            const tokensProcurados = nomeNorm.split(' ').filter(t => t.length >= 3);
            const produtoNorm = norm(produto);

            // PASSO 1: busca hierarquica por produto (so se rubricaProduto foi informado)
            if (produto && produtoNorm) {
                const blocos = Array.from(document.querySelectorAll('.collapsible-header.green-text'));

                let blocoAlvo = null;
                let melhorScoreProduto = 0;
                for (const bloco of blocos) {
                    const textoBloco = norm(bloco.innerText);
                    if (textoBloco === produtoNorm) { blocoAlvo = bloco; break; }
                    if (textoBloco.includes(produtoNorm) || produtoNorm.includes(textoBloco)) { blocoAlvo = bloco; break; }
                    const s = dice(produtoNorm, textoBloco);
                    if (s > melhorScoreProduto && s >= 0.80) { melhorScoreProduto = s; blocoAlvo = bloco; }
                }

                if (blocoAlvo) {
                    const corpo = blocoAlvo.closest('li')?.querySelector('.collapsible-body');
                    const rows = corpo
                        ? Array.from(corpo.querySelectorAll('table.bordered tbody tr'))
                        : [];

                    if (rows.length > 0) {
                        const candidatos = coletarCandidatos(rows);
                        const resultado = matchCandidatos(candidatos, nomeNorm, tokensProcurados, valorAprovado, valorNota);
                        if (resultado) {
                            return { ...resultado, scopeProduto: blocoAlvo.innerText.trim() };
                        }
                        console.warn(`[SALIC] Produto "${blocoAlvo.innerText.trim()}" encontrado mas rubrica "${nome}" nao localizada dentro. Tentando busca flat.`);
                    }
                } else {
                    console.warn(`[SALIC] Produto "${produto}" nao encontrado nos cabecalhos da pagina. Tentando busca flat.`);
                }
            }

            // PASSO 2: fallback flat (preserva projetos sem produto)
            const todasRows = Array.from(document.querySelectorAll('table.bordered tbody tr'));
            const todosCandidatos = coletarCandidatos(todasRows);
            const resultadoFlat = matchCandidatos(todosCandidatos, nomeNorm, tokensProcurados, valorAprovado, valorNota);

            if (resultadoFlat) return { ...resultadoFlat, scopeProduto: 'flat_fallback' };

            // Nada encontrado
            return { link: null, candidatos: todosCandidatos.map(c => c.nomeOriginal), melhorScore: 0 };

        }, rubricaNome, config.rubricaProduto || null, config.rubricaValorAprovado, documento.valor);

        if (resultadoMatch?.erro_ambiguidade) {
            throw new Error(
                `Ambiguidade de rubrica: "${rubricaNome}" encontrada ${resultadoMatch.candidatos.length}x ` +
                `no produto "${config.rubricaProduto}". Intervencao manual necessaria no SALIC.`
            );
        }

        if (!resultadoMatch || !resultadoMatch.link) {
            console.log('[SALIC] Rubrica nao localizada automaticamente. Sugestao: validar manualmente no painel do SALIC.');
            if (resultadoMatch && resultadoMatch.candidatos) {
                console.log(`[SALIC] Rubricas disponiveis na tela (${resultadoMatch.candidatos.length}):`);
                resultadoMatch.candidatos.forEach((n, i) => console.log(`  [${i + 1}] ${n}`));
                if (resultadoMatch.melhorNome) {
                    console.log(`[SALIC] Mais proxima: "${resultadoMatch.melhorNome}" (score ${resultadoMatch.melhorScore.toFixed(2)}) - abaixo do limiar de 0.85.`);
                }
            }
            throw new Error('Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro")');
        }

        if (resultadoMatch.matchType === 'fuzzy') {
            console.log(`[SALIC] Match fuzzy aceito: procurado "${rubricaNome}" ~ tabela "${resultadoMatch.nomeTabela}" (score ${resultadoMatch.score.toFixed(2)})`);
        } else if (resultadoMatch.matchType === 'saldo_suficiente') {
            console.log(`[SALIC] Match por saldo suficiente: "${resultadoMatch.nomeTabela}" (sem match de nome - validar manualmente se necessario).`);
        } else {
            console.log(`[SALIC] Rubrica casada via ${resultadoMatch.matchType}: "${resultadoMatch.nomeTabela}"`);
        }

        console.log(`[SALIC] Sinal de dinheiro encontrado! Redirecionando...`);
        await targetPage.goto(resultadoMatch.link, { waitUntil: 'domcontentloaded', timeout: 60000 });

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

        // Texto do modal ANTES da busca: referência para distinguir uma mensagem nova de
        // "não encontrado" de um aviso fixo do modal (ver buscarFornecedorSalic).
        const modalAntesDaBusca = await lerModalSalic(targetPage);

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
        // Polling no lugar das esperas fixas de 5s/6s: ver buscarFornecedorSalic (até 3
        // tentativas, no máximo 60s). Lança erro se o fornecedor não aparecer.
        await buscarFornecedorSalic(targetPage, {
            documentoSoNumeros,
            tipoPessoaLabel,
            docFornecedor: documento.cnpj_fornecedor,
            textoModalBase: modalAntesDaBusca.texto
        });

        // 3. Formatar data (De YYYY-MM-DD para DD/MM/YYYY)
        let dataFormatada = documento.data_emissao;
        if (dataFormatada && dataFormatada.includes('-')) {
            const parts = dataFormatada.split('-');
            dataFormatada = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }

        // Bug #2: a Data do Pagamento é distinta da Data de Emissão — vem do
        // lançamento bancário conciliado (data do débito). Fallback para a emissão
        // por compatibilidade caso o payload não traga data_pagamento.
        let dataPagamentoFormatada = documento.data_pagamento || documento.data_emissao;
        if (dataPagamentoFormatada && dataPagamentoFormatada.includes('-')) {
            const partsPg = dataPagamentoFormatada.split('-');
            dataPagamentoFormatada = `${partsPg[2]}/${partsPg[1]}/${partsPg[0]}`;
        }
        console.log(`[SALIC] Data de Emissao: ${dataFormatada} | Data de Pagamento: ${dataPagamentoFormatada}`);

        // 4. Converter valor para centavos (mascara de moeda do SALIC trata digitos como centavos)
        //    Ex: R$4.100,00 -> digitar "410000" -> mascara exibe "4.100,00"
        //    Ex: R$14.600,00 -> digitar "1460000" -> mascara exibe "14.600,00"
        const valorNum = parseFloat(documento.valor);
        const valorEmCentavos = String(Math.round(valorNum * 100));
        console.log(`[SALIC] Valor: R$ ${documento.valor} -> centavos para digitar: ${valorEmCentavos}`);

        // 5. Preenche Dados do Comprovante com eventos Materialize
        // CHG-13: Recibo usa '4' (Recibo de Pagamento); NF usa '3' (Nota Fiscal/Fatura).
        // Guia de Recolhimento usa '2' — sinalizada por documento.numero_guia (json_extraido.guia).
        const isGuia = !!(documento.numero_guia && String(documento.numero_guia).trim());
        const tpDocumentoValue = isGuia ? '2' : (isRecibo ? TP_DOCUMENTO_RECIBO : '3');
        await setMaterializeSelect(targetPage, '#tpDocumento', tpDocumentoValue);
        console.log(`[SALIC] Tipo de documento definido: ${tpDocumentoValue} (${isGuia ? 'Guia de Recolhimento' : (isRecibo ? 'Recibo' : 'Nota Fiscal/Fatura')})`);
        await wait(500);

        await setMaterializeField(targetPage, '#dataEmissao', dataFormatada);
        await wait(300);

        // CHG-13 (corrigido): igual para Recibo e NF — sempre o numero do documento.
        // Guia usa numero_guia — mais confiável que numero (pode carregar resíduo do bug antigo em docs não reprocessados).
        const numeroComprovante = isGuia ? String(documento.numero_guia) : String(documento.numero || '');
        await setMaterializeField(targetPage, '#nrComprovante', numeroComprovante);
        console.log(`[SALIC] #nrComprovante: ${numeroComprovante}${isGuia ? ' (numero_guia)' : ''}`);
        await wait(300);

        // 6. Upload do Arquivo (PDF)
        if (documento.nf_url) {
            console.log('[SALIC] Baixando arquivo da Nota Fiscal.');
            const localFilePath = path.join(os.tmpdir(), `nf_${Date.now()}.pdf`);
            await downloadFile(documento.nf_url, localFilePath);

            // FALLBACK: Verifica se o PDF foi baixado corretamente
            const fileStats = fs.statSync(localFilePath);
            if (!fileStats || fileStats.size < 100) {
                console.warn('[SALIC] FALLBACK: PDF com tamanho suspeito. Tentando download novamente...');
                await downloadFile(documento.nf_url, localFilePath);
                const retryStats = fs.statSync(localFilePath);
                if (!retryStats || retryStats.size < 100) {
                    throw new Error(`PDF da NF baixado com tamanho invalido (${retryStats?.size || 0} bytes).`);
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
        await setMaterializeField(targetPage, '#dtPagamento', dataPagamentoFormatada);
        await wait(300);

        // Bug #1 (rev): numero_extrato JA chega formatado do server.js
        // (formatarNrDocPagamento — trata TED do BB extraindo a conta destino).
        // Aqui NAO reformatamos para evitar dupla formatacao. Fallback: se ausente,
        // usa o numero do documento aplicando a MESMA regra (>=13 digitos -> conta destino).
        let nrDocPagamento = String(documento.numero_extrato || '');
        if (!nrDocPagamento) {
            const digFallback = String(documento.numero || '').replace(/\D/g, '');
            nrDocPagamento = (digFallback.length >= 13 ? digFallback.slice(-6) : digFallback).padStart(10, '0');
            console.warn('[SALIC] AVISO: numero_extrato (fitid) ausente. Usando numero como fallback.');
        }
        await setMaterializeField(targetPage, '#nrDocumentoDePagamento', nrDocPagamento);
        console.log(`[SALIC] #nrDocumentoDePagamento: ${nrDocPagamento}`);
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

        // #dsJustificativa é opcional no formulário do SALIC: fica vazio, a não ser
        // que o documento traga justificativa (rubrica excedida) — ver preencherJustificativaSalic.
        await preencherJustificativaSalic(targetPage, documento.justificativa_salic);

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
            } catch (e) {
                console.error('[SALIC] Falha ao clicar via Puppeteer:', e.message);
            }
        } else {
            console.log(`[SALIC] Botao Salvar acionado via: "${salvarClicado}"`);
        }

        // 9. VERIFICACAO POS-SAVE: Aguarda e analisa o resultado
        console.log('[SALIC] Aguardando resposta do servidor apos salvar...');
        // Espera ativa pelo aviso "Salvando Comprovacao Financeira" (antes: 6s
        // fixos, que liam o estado com o modal ainda aberto). Ver
        // salic_verificacoes.cjs.
        const fimSalvamento = await aguardarFimDoSalvamento(targetPage, { log: (msg) => console.log(msg) });
        if (!fimSalvamento.concluido) {
            // Nao e "resultado ambiguo" e nao reenvia: o comprovante pode ja
            // ter sido gravado no SALIC.
            return {
                sucesso: false,
                erro: 'Tempo esgotado (60s) aguardando o SALIC concluir o salvamento. ' +
                    'O comprovante pode ter sido gravado: conferir no SALIC antes de reenviar.'
            };
        }
        await wait(1000); // deixa a tela assentar antes de ler o estado

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
        await targetPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
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
        } catch (e) { }
        return { sucesso: false, erro: error.message };
    } finally {
        clearTimeout(globalTimeoutHandle);
        if (browser) await browser.close();
    }
}

module.exports = { executarInsercaoSalic, preencherJustificativaSalic, buscarFornecedorSalic, contarIndiciosFornecedorInexistente };

// --- AREA DE TESTE (Para rodar direto no terminal) ---
if (require.main === module) {
    (async () => {
        // Substitua pelos seus dados de teste:
        await executarInsercaoSalic({
            usuario: '00000000',
            senha: '00000000000',
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
