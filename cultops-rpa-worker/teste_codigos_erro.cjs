// Testes dos códigos de erro "[CODIGO] mensagem" (codigos_erro.cjs e erros do worker) — nao acessam
// o SALIC nem o Supabase. Os códigos do server.js (just_erro e resposta 500) ficam em
// teste_envio_salic.cjs.
// Rodar: node teste_codigos_erro.cjs
// Parte 1: funcoes puras. Parte 2: erros do worker na origem (HTML fixo / interceptacao de
// requisicoes), so se o puppeteer conseguir abrir um Chrome/Chromium local (CHROME_PATH).
const assert = require('node:assert/strict');
const {
    CODIGOS, comCodigo, garantirCodigo, extrairCodigo, erroComCodigo
} = require('./codigos_erro.cjs');
const {
    conferirRubricaDaTela, exigirRubricaCasada, ERRO_TEMPO_ESGOTADO_SALVAMENTO, buscarFornecedorSalic, executarInsercaoSalic
} = require('./salic_insertion.cjs');
const { exigirSaidaDoLogin } = require('./salic_verificacoes.cjs');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { }

let falhas = 0;
async function caso(nome, fn) {
    try { await fn(); console.log('ok   -', nome); }
    catch (e) { falhas++; console.log('FALHA -', nome, '\n      ', e.message); }
}
const unico = (texto) => (texto.match(/\[[A-Z][A-Z0-9_]*\] /g) || []).length === 1;

(async () => {
    // ── Parte 1: funcoes puras ──
    await caso('lista tem exatamente os 14 codigos pedidos mais ERRO_RPA_GENERICO', () => {
        assert.deepEqual([...CODIGOS].sort(), [
            'ARQUIVO_NF_INDISPONIVEL', 'CREDENCIAL_SALIC_AUSENTE', 'DADOS_OBRIGATORIOS_FALTANDO', 'DATA_PAGAMENTO_SEM_LANCAMENTO',
            'ERRO_RPA_GENERICO', 'FORNECEDOR_NAO_ENCONTRADO_SALIC', 'LANCAMENTO_DIVIDIDO', 'LOGIN_SALIC_RECUSADO',
            'RUBRICA_INEXISTENTE', 'RUBRICA_NAO_ENCONTRADA_SALIC', 'RUBRICA_NAO_VINCULADA', 'RUBRICA_TELA_DIVERGENTE',
            'TEMPO_ESGOTADO_SALVAMENTO', 'VALOR_MAIOR_QUE_NOTA', 'VALOR_PAGO_INDETERMINADO',
        ].sort());
    });

    await caso('comCodigo: prefixo "[CODIGO] " e texto original intacto', () => {
        assert.equal(comCodigo('RUBRICA_INEXISTENTE', 'Rubrica não encontrada: x "y" (z)'), '[RUBRICA_INEXISTENTE] Rubrica não encontrada: x "y" (z)');
    });

    await caso('prefixo unico: mensagem ja prefixada nao ganha um segundo (nem trocando o codigo)', () => {
        const ja = '[LOGIN_SALIC_RECUSADO] Falha no login SALIC.';
        assert.equal(comCodigo('LOGIN_SALIC_RECUSADO', ja), ja);
        assert.equal(comCodigo('ERRO_RPA_GENERICO', ja), ja);
        assert.equal(garantirCodigo(ja), ja);
        assert.equal(garantirCodigo(garantirCodigo('x')), '[ERRO_RPA_GENERICO] x');
    });

    await caso('garantirCodigo: sem codigo vira ERRO_RPA_GENERICO; texto entre colchetes que nao e codigo conhecido ganha o prefixo', () => {
        assert.equal(garantirCodigo('Falha qualquer'), '[ERRO_RPA_GENERICO] Falha qualquer');
        assert.equal(garantirCodigo('[SALIC] Falha'), '[ERRO_RPA_GENERICO] [SALIC] Falha');
        assert.equal(garantirCodigo('[CODIGO_QUE_NAO_EXISTE] Falha'), '[ERRO_RPA_GENERICO] [CODIGO_QUE_NAO_EXISTE] Falha');
        assert.equal(garantirCodigo(''), '[ERRO_RPA_GENERICO] ');
        assert.equal(garantirCodigo(undefined), '[ERRO_RPA_GENERICO] ');
    });

    await caso('extrairCodigo: le o prefixo; sem prefixo (ou desconhecido) e ERRO_RPA_GENERICO', () => {
        assert.equal(extrairCodigo('[VALOR_MAIOR_QUE_NOTA] x'), 'VALOR_MAIOR_QUE_NOTA');
        assert.equal(extrairCodigo('x'), 'ERRO_RPA_GENERICO');
        assert.equal(extrairCodigo('[FOO] x'), 'ERRO_RPA_GENERICO');
        assert.equal(extrairCodigo(null), 'ERRO_RPA_GENERICO');
    });

    await caso('comCodigo com codigo desconhecido e erro de programacao', () => {
        assert.throws(() => comCodigo('NAO_EXISTE', 'x'), /Codigo de erro desconhecido: NAO_EXISTE/);
    });

    await caso('erroComCodigo: Error com a mensagem prefixada e error.codigo', () => {
        const e = erroComCodigo('RUBRICA_NAO_VINCULADA', 'sem rubrica');
        assert.ok(e instanceof Error);
        assert.equal(e.message, '[RUBRICA_NAO_VINCULADA] sem rubrica');
        assert.equal(e.codigo, 'RUBRICA_NAO_VINCULADA');
    });

    // ── erros do worker, na origem (sem navegador) ──
    await caso('RUBRICA_TELA_DIVERGENTE: nome diferente na tela', () => {
        assert.throws(() => conferirRubricaDaTela('Custos de acessibilidade', 'Advogado(a)'), (e) => {
            assert.equal(e.message, '[RUBRICA_TELA_DIVERGENTE] Rubrica da tela ("Custos de acessibilidade") diverge da rubrica esperada ("Advogado(a)"). Nada foi inserido.');
            return unico(e.message);
        });
    });

    await caso('RUBRICA_TELA_DIVERGENTE: nome ilegivel na tela', () => {
        assert.throws(() => conferirRubricaDaTela(null, 'Advogado(a)'), (e) => {
            assert.equal(e.message, '[RUBRICA_TELA_DIVERGENTE] Nao consegui ler o nome da rubrica na tela de comprovacao (esperado "Advogado(a)"). Nada foi inserido.');
            return unico(e.message);
        });
    });

    await caso('RUBRICA_NAO_ENCONTRADA_SALIC: nenhuma linha casou (texto original e logs preservados)', () => {
        const logs = [];
        assert.throws(() => exigirRubricaCasada({ link: null, motivo: 'nenhuma linha com o nome exato', candidatos: ['A (aprovado 1 | produto: P)'] }, 'Advogado(a)', 'P', (m) => logs.push(m)), (e) => {
            assert.equal(e.message, '[RUBRICA_NAO_ENCONTRADA_SALIC] Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro"): nenhuma linha com o nome exato. Candidatas: A (aprovado 1 | produto: P)');
            return unico(e.message);
        });
        assert.equal(logs[0], '[SALIC] Rubrica nao localizada automaticamente. Sugestao: validar manualmente no painel do SALIC.');
        assert.equal(logs[1], '[SALIC] Rubricas disponiveis na tela (1):');
    });

    await caso('RUBRICA_NAO_ENCONTRADA_SALIC: ambiguidade e resultado vazio', () => {
        assert.throws(() => exigirRubricaCasada({ erro_ambiguidade: true, candidatos: ['a', 'b'] }, 'Assistentes', 'Produto X', () => { }), (e) =>
            e.message === '[RUBRICA_NAO_ENCONTRADA_SALIC] Ambiguidade de rubrica: "Assistentes" encontrada 2x no produto "Produto X". Intervencao manual necessaria no SALIC.');
        assert.throws(() => exigirRubricaCasada(null, 'X', null, () => { }), (e) =>
            e.message === '[RUBRICA_NAO_ENCONTRADA_SALIC] Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro")');
    });

    await caso('exigirRubricaCasada: com link nao lanca', () => {
        exigirRubricaCasada({ link: 'https://salic.exemplo/x', matchType: 'exato_normalizado' }, 'X', null, () => { });
    });

    await caso('TEMPO_ESGOTADO_SALVAMENTO: texto original preservado, prefixo unico', () => {
        assert.equal(ERRO_TEMPO_ESGOTADO_SALVAMENTO,
            '[TEMPO_ESGOTADO_SALVAMENTO] Tempo esgotado (60s) aguardando o SALIC concluir o salvamento. O comprovante pode ter sido gravado: conferir no SALIC antes de reenviar.');
        assert.ok(unico(ERRO_TEMPO_ESGOTADO_SALVAMENTO));
    });

    // ── Parte 2: navegador local ──
    if (!puppeteer) { console.log('pulado - parte 2: puppeteer nao instalado (use NODE_PATH)'); return fim(); }
    // So no teste local: --single-process fecha o Chrome no Windows; producao (Linux) nao e alterada.
    const launchOriginal = puppeteer.launch.bind(puppeteer);
    puppeteer.launch = (o = {}) => launchOriginal({ ...o, headless: 'new', slowMo: 0, args: (o.args || []).filter(a => a !== '--single-process') });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
    } catch (e) { console.log('pulado - parte 2: navegador nao abriu:', e.message); return fim(); }
    const page = await browser.newPage();

    const MODAL = (mensagem) => `<div id="modal1" class="modal open"><p>Cadastrar novo comprovante</p>
        <input id="CNPJCPF" type="text" value=""><button class="btn" id="lupa"><i class="material-icons">search</i></button>
        <input id="Descricao" type="text" value=""><div id="msg">${mensagem}</div></div>`;
    const TEMPOS = { documentoSoNumeros: '03281691000137', tipoPessoaLabel: 'CNPJ', docFornecedor: '03281691000137', tentativasMax: 1, timeoutTentativaMs: 300, limiteTotalMs: 600, intervaloMs: 100, estabilizacaoMs: 50, atrasoDigitacaoMs: 1, log: () => { } };

    await caso('FORNECEDOR_NAO_ENCONTRADO_SALIC: o SALIC respondeu que nao esta cadastrado', async () => {
        await page.setContent(MODAL(''));
        await page.evaluate(() => { document.querySelector('#msg').textContent = 'Fornecedor nao encontrado'; });
        await assert.rejects(buscarFornecedorSalic(page, { ...TEMPOS, textoModalBase: '' }), (e) => {
            assert.match(e.message, /^\[FORNECEDOR_NAO_ENCONTRADO_SALIC\] Fornecedor com CNPJ 03281691000137 nao encontrado no SALIC \(o SALIC respondeu que ele nao esta cadastrado\)\. Cadastre manualmente/);
            return unico(e.message);
        });
    });

    await caso('FORNECEDOR_NAO_ENCONTRADO_SALIC: nada voltou dentro do prazo', async () => {
        await page.setContent(MODAL(''));
        await assert.rejects(buscarFornecedorSalic(page, { ...TEMPOS, textoModalBase: '' }), (e) => {
            assert.match(e.message, /^\[FORNECEDOR_NAO_ENCONTRADO_SALIC\] Fornecedor com CNPJ 03281691000137 nao localizado no SALIC dentro do prazo \(1 tentativas em \d+s\)\. Confira se esta cadastrado/);
            return unico(e.message);
        });
    });

    await caso('LOGIN_SALIC_RECUSADO: pagina parada em /autenticacao/ (CPF mascarado e texto original preservados)', async () => {
        const pageLogin = await browser.newPage();
        await pageLogin.setRequestInterception(true);
        pageLogin.on('request', (req) => req.respond({ status: 200, contentType: 'text/html', body: '<p>tela</p>' }));
        await pageLogin.goto('https://salic.invalido/autenticacao/index/index');
        await assert.rejects(exigirSaidaDoLogin(pageLogin, '896***97', 500), (e) => {
            assert.match(e.message, /^\[LOGIN_SALIC_RECUSADO\] Falha no login SALIC: a pagina continuou na tela de login \(https:\/\/salic\.invalido\/autenticacao\/index\/index\) para o usuario 896\*\*\*97\. Confira CPF e senha da credencial SALIC\.$/);
            return unico(e.message);
        });
        await pageLogin.close();
    });

    await caso('CREDENCIAL_SALIC_AUSENTE: executarInsercaoSalic devolve resultado.erro prefixado (sem acessar o SALIC)', async () => {
        const base = { pronac: '256578', rubricaNome: 'Advogado(a)', documento: {}, dryRun: true };
        const semUsuario = await executarInsercaoSalic({ ...base, usuario: undefined, senha: 'x' });
        assert.equal(semUsuario.sucesso, false);
        assert.equal(semUsuario.erro, '[CREDENCIAL_SALIC_AUSENTE] Usuario invalido ou nao informado (Tipo: undefined)');
        const semSenha = await executarInsercaoSalic({ ...base, usuario: '12345678909', senha: null });
        assert.equal(semSenha.erro, '[CREDENCIAL_SALIC_AUSENTE] Senha invalida ou nao informada (Tipo: object)');
    });

    await caso('ERRO_RPA_GENERICO: erro do worker sem codigo definido ganha o prefixo generico no proprio worker', async () => {
        // Navegador real, mas o page.goto falha por conta propria: nada sai para a rede e o erro
        // (sem codigo) cai no catch do worker.
        const anterior = puppeteer.launch;
        puppeteer.launch = async (o) => {
            const b = await anterior(o);
            const novaPagina = b.newPage.bind(b);
            b.newPage = async () => { const p = await novaPagina(); p.goto = async () => { throw new Error('Falha simulada de navegacao'); }; return p; };
            return b;
        };
        try {
            const r = await executarInsercaoSalic({ usuario: '12345678909', senha: 'x', pronac: '1', rubricaNome: 'R', documento: {}, dryRun: true });
            assert.equal(r.sucesso, false);
            assert.equal(r.erro, '[ERRO_RPA_GENERICO] Falha simulada de navegacao');
            assert.ok(unico(r.erro));
        } finally { puppeteer.launch = anterior; }
    });

    await browser.close();
    fim();
})();

function fim() {
    console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
}
