const puppeteer = require('puppeteer-core');
const path = require('path');

// =============================================================================
// 🗺️ MAPA CENTRALIZADO DE SELETORES - FORMULÁRIO SALIC
// =============================================================================
// Quando tiver os documentos de teste, basta substituir os valores 'TODO_SELETOR_*'
// pelos seletores CSS reais encontrados no portal.
//
// Convenção:
//   - Prefixo 'TODO_SELETOR_' = ainda não mapeado (vai lançar erro claro se tentar usar)
//   - Valor real (ex: '#cnpj_fornecedor') = mapeado e pronto para uso
// =============================================================================

const SELECTORS = {
    // --- TELA DE LOGIN ---
    login: {
        inputUsuario:   '#Login',
        inputSenha:     '#Senha',
        btnSubmit:      'button[type="submit"]',
    },

    // --- TELA DE LISTAGEM DE PROJETOS ---
    listagem: {
        inputBusca:     'input[aria-label="Buscar"]',
        linkPronac:     (pronac) => `table tbody tr td a ::-p-text(${pronac})`,
    },

    // --- TELA DE DETALHES DO PROJETO (Side Nav) ---
    detalhesProjeto: {
        btnComprovacao: 'li.bold > a > span', // Filtrado por texto 'Comprovação Financeira'
    },

    // --- TELA DE COMPROVAÇÃO FINANCEIRA (Tabela de Rubricas) ---
    comprovacao: {
        tabelaRubricas:     'tr',
        btnInserirRubrica:  'button[title*="Inserir"], .btn-inserir, .fa-plus',
    },

    // --- FORMULÁRIO DE INSERÇÃO DE DESPESA ---
    // 🎯 ESTES SÃO OS SELETORES QUE VOCÊ VAI PREENCHER COM OS TESTES
    formulario: {
        // Dados do Fornecedor
        cnpjFornecedor:     'TODO_SELETOR_CNPJ_FORNECEDOR',      // Ex: '#cnpj_fornecedor' ou 'input[name="cnpj"]'
        nomeFornecedor:     'TODO_SELETOR_NOME_FORNECEDOR',       // Se houver campo de razão social
        
        // Dados da Nota Fiscal
        numeroNF:           'TODO_SELETOR_NUMERO_NF',             // Ex: '#numero_nota', 'input[name="nrComprovante"]'
        serieNF:            'TODO_SELETOR_SERIE_NF',              // Se houver campo de série
        dataEmissao:        'TODO_SELETOR_DATA_EMISSAO',          // Ex: '#data_emissao', 'input[name="dtEmissao"]'
        
        // Valores
        valorUnitario:      'TODO_SELETOR_VALOR_UNITARIO',        // Se separar unitário
        quantidade:         'TODO_SELETOR_QUANTIDADE',             // Se houver campo de quantidade
        valorTotal:         'TODO_SELETOR_VALOR_TOTAL',           // Ex: '#valor_total', 'input[name="vlComprovacao"]'
        
        // Tipo de Documento / Comprovação
        tipoDocumento:      'TODO_SELETOR_TIPO_DOCUMENTO',        // Dropdown: NF, Recibo, Fatura etc.
        tipoComprovante:    'TODO_SELETOR_TIPO_COMPROVANTE',      // Se houver segundo dropdown
        
        // Upload de Arquivos
        inputUploadNF:      'TODO_SELETOR_UPLOAD_NF',             // Ex: 'input[type="file"]#arquivo_nf'
        inputUploadComp:    'TODO_SELETOR_UPLOAD_COMPROVANTE',    // Ex: 'input[type="file"]#arquivo_comprovante'
        
        // Campos Opcionais (descomentar e mapear se existirem no formulário)
        // descricao:       'TODO_SELETOR_DESCRICAO',
        // observacao:      'TODO_SELETOR_OBSERVACAO',
        // dataPagamento:   'TODO_SELETOR_DATA_PAGAMENTO',
        // tipoPagamento:   'TODO_SELETOR_TIPO_PAGAMENTO',       // PIX, TED, Boleto etc.
        
        // Botões de Ação
        btnSalvar:          'TODO_SELETOR_BTN_SALVAR',            // Ex: '#btnSalvar', 'button[type="submit"]'
        btnCancelar:        'TODO_SELETOR_BTN_CANCELAR',
    },

    // --- TELA DE CONFIRMAÇÃO / PROTOCOLO ---
    confirmacao: {
        msgSucesso:         'TODO_SELETOR_MSG_SUCESSO',           // Elemento que aparece após salvar
        numeroProtocolo:    'TODO_SELETOR_NUMERO_PROTOCOLO',      // Onde pegar o protocolo gerado
    },
};

// =============================================================================
// 🛠️ FUNÇÕES AUXILIARES DE FORMULÁRIO
// =============================================================================

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Verifica se um seletor já foi mapeado (não é mais TODO)
 */
function isMapeado(selector) {
    return selector && !selector.startsWith('TODO_SELETOR_');
}

/**
 * Limpa um campo e digita o valor, com retry
 * @param {Page} page - Puppeteer page ou frame
 * @param {string} selector - Seletor CSS do campo
 * @param {string} value - Valor a digitar
 * @param {string} fieldName - Nome amigável para log
 */
async function safeType(page, selector, value, fieldName) {
    if (!isMapeado(selector)) {
        console.log(`[FORM] ⏭️  Campo "${fieldName}" ainda não mapeado (${selector}). Pulando.`);
        return false;
    }
    if (!value && value !== 0) {
        console.log(`[FORM] ⏭️  Campo "${fieldName}" sem valor fornecido. Pulando.`);
        return false;
    }

    const strValue = String(value);
    try {
        await page.waitForSelector(selector, { timeout: 10000 });
        // Limpa o campo antes de digitar
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(selector, strValue, { delay: 30 });
        console.log(`[FORM] ✅ "${fieldName}" preenchido: ${strValue.substring(0, 20)}${strValue.length > 20 ? '...' : ''}`);
        return true;
    } catch (err) {
        console.error(`[FORM] ❌ Erro ao preencher "${fieldName}" (${selector}):`, err.message);
        throw new Error(`Falha ao preencher campo "${fieldName}": ${err.message}`);
    }
}

/**
 * Seleciona uma opção em um dropdown <select>
 * @param {Page} page - Puppeteer page ou frame
 * @param {string} selector - Seletor CSS do <select>
 * @param {string} value - Valor da opção (value ou texto visível)
 * @param {string} fieldName - Nome amigável para log
 */
async function safeSelect(page, selector, value, fieldName) {
    if (!isMapeado(selector)) {
        console.log(`[FORM] ⏭️  Dropdown "${fieldName}" ainda não mapeado. Pulando.`);
        return false;
    }
    if (!value) {
        console.log(`[FORM] ⏭️  Dropdown "${fieldName}" sem valor fornecido. Pulando.`);
        return false;
    }

    try {
        await page.waitForSelector(selector, { timeout: 10000 });
        // Tenta primeiro por value, depois por texto visível
        const selected = await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            
            // Tenta match por value
            const optByValue = Array.from(el.options).find(o => o.value === val);
            if (optByValue) { el.value = optByValue.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
            
            // Tenta match por texto
            const optByText = Array.from(el.options).find(o => o.text.trim().toLowerCase().includes(val.toLowerCase()));
            if (optByText) { el.value = optByText.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
            
            return false;
        }, selector, value);

        if (selected) {
            console.log(`[FORM] ✅ Dropdown "${fieldName}" selecionado: ${value}`);
        } else {
            console.warn(`[FORM] ⚠️  Dropdown "${fieldName}": opção "${value}" não encontrada.`);
        }
        return selected;
    } catch (err) {
        console.error(`[FORM] ❌ Erro no dropdown "${fieldName}":`, err.message);
        throw new Error(`Falha ao selecionar dropdown "${fieldName}": ${err.message}`);
    }
}

/**
 * Faz upload de arquivo via input[type=file]
 * @param {Page} page - Puppeteer page ou frame
 * @param {string} selector - Seletor do input file
 * @param {string} filePath - Caminho absoluto do arquivo
 * @param {string} fieldName - Nome amigável para log
 */
async function safeUpload(page, selector, filePath, fieldName) {
    if (!isMapeado(selector)) {
        console.log(`[FORM] ⏭️  Upload "${fieldName}" ainda não mapeado. Pulando.`);
        return false;
    }
    if (!filePath) {
        console.log(`[FORM] ⏭️  Upload "${fieldName}" sem caminho de arquivo. Pulando.`);
        return false;
    }

    try {
        await page.waitForSelector(selector, { timeout: 10000 });
        const inputUpload = await page.$(selector);
        await inputUpload.uploadFile(filePath);
        console.log(`[FORM] ✅ Upload "${fieldName}" realizado: ${path.basename(filePath)}`);
        await wait(1500); // Espera processamento do upload
        return true;
    } catch (err) {
        console.error(`[FORM] ❌ Erro no upload "${fieldName}":`, err.message);
        throw new Error(`Falha no upload "${fieldName}": ${err.message}`);
    }
}

/**
 * Formata valor monetário para o padrão brasileiro (1.234,56)
 */
function formatarMoeda(valor) {
    if (!valor && valor !== 0) return '';
    const num = typeof valor === 'string' ? parseFloat(valor.replace(/[^\d.,\-]/g, '').replace(',', '.')) : valor;
    if (isNaN(num)) return String(valor);
    return num.toFixed(2).replace('.', ',');
}

/**
 * Formata data para DD/MM/AAAA
 */
function formatarData(data) {
    if (!data) return '';
    // Se já está no formato DD/MM/AAAA, retorna
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(data)) return data;
    // Se é ISO (YYYY-MM-DD)
    const match = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return data;
}

// =============================================================================
// 🚀 FUNÇÃO PRINCIPAL
// =============================================================================

/**
 * Script de Inserção de Comprovação Financeira no SALIC
 * @param {Object} config - Objeto com credenciais e dados da despesa
 * @param {string} config.usuario - CPF/login do SALIC
 * @param {string} config.senha - Senha do SALIC
 * @param {string} config.pronac - Número do PRONAC
 * @param {string} config.rubricaNome - Nome da rubrica para localizar na tabela
 * @param {Object} config.documento - Dados da despesa/NF
 * @param {string} config.documento.cnpj_fornecedor - CNPJ do fornecedor
 * @param {string} config.documento.valor - Valor total da NF
 * @param {string} config.documento.numero - Número da NF
 * @param {string} config.documento.data_emissao - Data de emissão (ISO ou DD/MM/AAAA)
 * @param {string} config.documento.nf_path - Caminho local do PDF da NF (para upload)
 * @param {string} config.documento.comprovante_path - Caminho local do comprovante (para upload)
 * @param {string} [config.browserWSEndpoint] - Endpoint do browser remoto (Browserless/Airtop)
 */
async function executarInsercaoSalic(config) {
    const { usuario, senha, pronac, rubricaNome, documento } = config;

    const browser = config.browserWSEndpoint
        ? await puppeteer.connect({ browserWSEndpoint: config.browserWSEndpoint })
        : await puppeteer.launch({
            executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: false,
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

        // =====================================================================
        // FASE 1: LOGIN
        // =====================================================================
        await page.goto('http://salic.cultura.gov.br', { waitUntil: 'networkidle2' });

        await page.waitForSelector(SELECTORS.login.inputUsuario);
        await page.type(SELECTORS.login.inputUsuario, usuario);
        await page.type(SELECTORS.login.inputSenha, senha);
        await page.click(SELECTORS.login.btnSubmit);
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // =====================================================================
        // FASE 2: NAVEGAR ATÉ A LISTAGEM E BUSCAR PRONAC
        // =====================================================================
        console.log(`[SALIC] Navegando para a lista de projetos...`);
        await page.goto('https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente', {
            waitUntil: 'networkidle2'
        });

        await page.waitForSelector(SELECTORS.listagem.inputBusca);
        console.log('[SALIC] Buscando projeto:', pronac);
        await page.type(SELECTORS.listagem.inputBusca, pronac);

        await wait(3000);

        console.log('[SALIC] Clicando no PRONAC para abrir detalhes...');
        const linkSelector = SELECTORS.listagem.linkPronac(pronac);

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

        // =====================================================================
        // FASE 3: GERENCIAR NOVA ABA + NAVEGAR ATÉ COMPROVAÇÃO FINANCEIRA
        // =====================================================================
        console.log('[SALIC] Aguardando abertura da página de detalhes...');
        const newTarget = await browser.waitForTarget(target => target.opener() === page.target(), { timeout: 15000 });
        targetPage = await newTarget.page();
        await targetPage.bringToFront();
        await targetPage.setViewport({ width: 1280, height: 800 });

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

        // =====================================================================
        // FASE 4: AGUARDAR TELA DE COMPROVAÇÃO E ENCONTRAR RUBRICA
        // =====================================================================
        console.log('[SALIC] Aguardando carregamento da tela de Comprovação...');

        try {
            await targetPage.waitForFunction(() => {
                const h1 = document.querySelector('h1');
                const table = document.querySelector('table');
                return (h1 && h1.innerText.includes('Comprovação')) || (table && document.body.innerText.includes('Rubrica'));
            }, { timeout: 45000 });
            console.log('[SALIC] Tela de Comprovação detectada!');
        } catch (e) {
            console.log('[SALIC] Aviso: Timeout na detecção automática. Tentando prosseguir...');
        }

        await wait(2000);

        console.log(`[SALIC] Localizando a rubrica: ${rubricaNome}`);
        const resultInsercao = await targetPage.evaluate((nome, btnSelector) => {
            const rows = Array.from(document.querySelectorAll('tr'));
            const row = rows.find(r => r.innerText.includes(nome));
            if (row) {
                const btn = row.querySelector(btnSelector);
                if (btn) {
                    btn.click();
                    return { success: true };
                }
            }
            return { success: false, error: 'Rubrica não encontrada ou sem botão de inserção' };
        }, rubricaNome, SELECTORS.comprovacao.btnInserirRubrica);

        if (!resultInsercao.success) throw new Error(resultInsercao.error);

        // =====================================================================
        // FASE 5: PREENCHER FORMULÁRIO DE INSERÇÃO DE DESPESA
        // =====================================================================
        console.log('[SALIC] ============================================');
        console.log('[SALIC] 📝 FORMULÁRIO DE INSERÇÃO - Início');
        console.log('[SALIC] ============================================');

        await wait(3000); // Aguarda o modal/formulário renderizar completamente

        const S = SELECTORS.formulario;

        // --- 5.1: Dados do Fornecedor ---
        console.log('[SALIC] [1/6] Preenchendo dados do fornecedor...');
        await safeType(targetPage, S.cnpjFornecedor, documento.cnpj_fornecedor, 'CNPJ Fornecedor');
        await wait(1000); // Espera possível auto-complete do CNPJ no portal
        await safeType(targetPage, S.nomeFornecedor, documento.nome_fornecedor, 'Nome/Razão Social');

        // --- 5.2: Dados da Nota Fiscal ---
        console.log('[SALIC] [2/6] Preenchendo dados da Nota Fiscal...');
        await safeType(targetPage, S.numeroNF, documento.numero, 'Número da NF');
        await safeType(targetPage, S.serieNF, documento.serie, 'Série da NF');
        await safeType(targetPage, S.dataEmissao, formatarData(documento.data_emissao), 'Data de Emissão');

        // --- 5.3: Valores ---
        console.log('[SALIC] [3/6] Preenchendo valores...');
        await safeType(targetPage, S.valorUnitario, formatarMoeda(documento.valor_unitario), 'Valor Unitário');
        await safeType(targetPage, S.quantidade, documento.quantidade, 'Quantidade');
        await safeType(targetPage, S.valorTotal, formatarMoeda(documento.valor), 'Valor Total');

        // --- 5.4: Dropdowns / Tipo de Documento ---
        console.log('[SALIC] [4/6] Selecionando tipos de documento...');
        await safeSelect(targetPage, S.tipoDocumento, documento.tipo_documento, 'Tipo de Documento');
        await safeSelect(targetPage, S.tipoComprovante, documento.tipo_comprovante, 'Tipo de Comprovante');

        // --- 5.5: Upload de Arquivos ---
        console.log('[SALIC] [5/6] Realizando uploads...');
        await safeUpload(targetPage, S.inputUploadNF, documento.nf_path, 'Nota Fiscal (PDF)');
        await safeUpload(targetPage, S.inputUploadComp, documento.comprovante_path, 'Comprovante Pagamento');

        // --- 5.6: Submissão ---
        console.log('[SALIC] [6/6] Submetendo formulário...');
        if (isMapeado(S.btnSalvar)) {
            await targetPage.waitForSelector(S.btnSalvar, { timeout: 5000 });
            await targetPage.click(S.btnSalvar);
            console.log('[SALIC] ✅ Botão Salvar clicado!');
        } else {
            console.log('[SALIC] ⚠️  Botão Salvar não mapeado. Formulário NÃO foi submetido.');
            return {
                sucesso: true,
                parcial: true,
                mensagem: 'Formulário preenchido mas NÃO submetido (btnSalvar não mapeado).',
            };
        }

        // =====================================================================
        // FASE 6: CAPTURA DE PROTOCOLO / CONFIRMAÇÃO
        // =====================================================================
        console.log('[SALIC] Aguardando confirmação de envio...');
        await wait(5000); // Espera pós-submit

        let protocolo = null;

        if (isMapeado(SELECTORS.confirmacao.numeroProtocolo)) {
            try {
                await targetPage.waitForSelector(SELECTORS.confirmacao.numeroProtocolo, { timeout: 15000 });
                protocolo = await targetPage.$eval(SELECTORS.confirmacao.numeroProtocolo, el => el.innerText.trim());
                console.log(`[SALIC] 🎉 Protocolo capturado: ${protocolo}`);
            } catch (e) {
                console.warn('[SALIC] ⚠️  Não conseguiu capturar o protocolo:', e.message);
            }
        } else {
            console.log('[SALIC] ⚠️  Seletor de protocolo não mapeado. Tentando screenshot...');
        }

        // Screenshot de confirmação (sempre tira, para evidência)
        const screenshotName = `sucesso_salic_${Date.now()}.png`;
        await targetPage.screenshot({ path: screenshotName, fullPage: true }).catch(() => {});
        console.log(`[SALIC] 📸 Screenshot de confirmação salva: ${screenshotName}`);

        console.log('[SALIC] ============================================');
        console.log('[SALIC] ✅ INSERÇÃO CONCLUÍDA COM SUCESSO');
        console.log('[SALIC] ============================================');

        return {
            sucesso: true,
            protocolo: protocolo,
            screenshot: screenshotName,
            mensagem: protocolo
                ? `Inserção concluída. Protocolo: ${protocolo}`
                : 'Inserção concluída (protocolo não capturado - verificar screenshot).',
        };

    } catch (error) {
        console.error('[SALIC] ❌ ERRO DURANTE A EXECUÇÃO:', error.message);
        if (targetPage) {
            const fileName = `erro_salic_${Date.now()}.png`;
            await targetPage.screenshot({ path: fileName, fullPage: true }).catch(() => {});
            console.log(`[SALIC] 📸 Screenshot de erro salva: ${fileName}`);
        }
        return { sucesso: false, erro: error.message };
    } finally {
        if (!config.browserWSEndpoint && browser) {
            await browser.close();
        }
    }
}

module.exports = { executarInsercaoSalic };

// =============================================================================
// 🧪 ÁREA DE TESTE (Rodar direto: node salic_insertion.cjs)
// =============================================================================
if (require.main === module) {
    (async () => {
        // Substitua pelos seus dados de teste:
        const resultado = await executarInsercaoSalic({
            usuario: '91685010644',
            senha: '916850',
            pronac: '248870',
            rubricaNome: 'NOME-DA-RUBRICA-AQUI',
            documento: {
                cnpj_fornecedor: '12.345.678/0001-99',
                nome_fornecedor: 'Empresa Teste LTDA',
                numero: '001234',
                serie: '1',
                data_emissao: '2026-04-10',
                valor: '1500.00',
                valor_unitario: '1500.00',
                quantidade: '1',
                tipo_documento: 'Nota Fiscal',
                tipo_comprovante: 'Transferência Bancária',
                nf_path: 'C:\\caminho\\para\\nota_fiscal.pdf',
                comprovante_path: 'C:\\caminho\\para\\comprovante.pdf',
            }
        });

        console.log('\n[RESULTADO FINAL]:', JSON.stringify(resultado, null, 2));
    })();
}