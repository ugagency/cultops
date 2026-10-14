const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── VERIFICAÇÕES DE SEGURANÇA DOS ROBÔS SALIC ────────────────────────────
//
// Separado dos robôs para dar para testar sem abrir o SALIC (ver
// teste_verificacoes.cjs): as funções puras recebem texto/URL, e a parte
// que lê o DOM roda em qualquer página, inclusive um HTML fixo.

// ── 1. LOGIN RECUSADO ────────────────────────────────────────────────────
//
// Ocorrência #58 (13/10/2026): o login falhou, a página ficou em
// /autenticacao/index/index e o SALIC não mostrou mensagem de erro. Como a
// checagem só procurava texto de erro, o robô seguiu e estourou 15s depois
// em input[aria-label="Proponentes"], escondendo a causa real. Nos logs, o
// login aceito sempre sai de /autenticacao/ (vai para
// /comunicados-proponente/...); o recusado fica nela.

function urlIndicaLoginRecusado(url) {
    return /\/autenticacao\//i.test(String(url || ''));
}

/**
 * Depois do clique em ENTRAR (e da espera que os robôs já fazem), dá uma
 * folga curta para o redirecionamento sair de /autenticacao/. Se ainda
 * estiver lá, o login foi recusado: lança erro claro em vez de deixar o
 * robô seguir até um timeout enganoso.
 */
async function exigirSaidaDoLogin(page, usuarioMascarado, folgaMs = 7000) {
    await page.waitForFunction(
        () => !/\/autenticacao\//i.test(window.location.href),
        { timeout: folgaMs }
    ).catch(() => { });
    const url = page.url();
    if (urlIndicaLoginRecusado(url)) {
        throw new Error(
            `Falha no login SALIC: a pagina continuou na tela de login (${url}) ` +
            `para o usuario ${usuarioMascarado}. Confira CPF e senha da credencial SALIC.`
        );
    }
}

// ── 2. CONFERÊNCIA DO PRONAC NA TELA DO PROJETO ──────────────────────────
//
// Proteção contra gravar no projeto errado: antes de qualquer escrita, o
// PRONAC esperado tem de aparecer na tela de detalhe aberta.
//
// Ocorrência #58 (14/10/2026): a conferência rodava logo após
// page.goto(..., domcontentloaded). A tela de detalhe é Vue/Vuetify montada
// no cliente, e a URL do projeto é uma rota com # da mesma SPA da listagem —
// o goto volta antes de a tabela existir. Agora espera com polling.
//
// Onde procurar (HTML real de uma tela de detalhe, PRONAC de 6 dígitos):
// primeira table.tabela de "#dados-projeto #conteudo", cabeçalho
// "PRONAC | Nome do Projeto", PRONAC como texto na 1ª célula da linha de
// dados. O atributo id-pronac do #conteudo é ID INTERNO, não o PRONAC —
// não usar. Só uma amostra confirmou o seletor, então há fallback para o
// texto da página inteira.
//
// O fallback NÃO vale enquanto a tela ainda for a da listagem (pela URL ou
// pelos links da tabela de projetos): a listagem filtrada também mostra o
// PRONAC, e aceitar o texto dela seria conferir a tela errada.

function regexPronac(pronac) {
    const escapado = String(pronac).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapado}\\b`);
}

/**
 * Lê da página o que a conferência precisa. Roda dentro do navegador
 * (page.evaluate), por isso não usa nada de fora da função.
 */
function lerTelaProjeto() {
    const url = window.location.href;
    if (!document.body) return { url, celulas: null, temListagem: false, textoPagina: '' };

    let celulas = null;
    const tabela = document.querySelector('#dados-projeto #conteudo table.tabela');
    if (tabela) {
        const linhas = Array.from(tabela.querySelectorAll('tr'));
        const cab = linhas[0] && linhas[0].cells[0]
            ? linhas[0].cells[0].textContent.replace(/\s+/g, ' ').trim().toUpperCase()
            : '';
        if (cab === 'PRONAC') {
            celulas = linhas.slice(1)
                .map(tr => tr.cells[0] ? tr.cells[0].textContent.replace(/\s+/g, ' ').trim() : '')
                .filter(Boolean);
        }
    }
    // Link da tabela da listagem (ver salic_proponente.cjs): se ainda está no
    // DOM, a tela da listagem não foi trocada, mesmo que a URL já tenha mudado.
    const temListagem = !!document.querySelector('a[title="Visualizar Projeto"]');
    return { url, celulas, temListagem, textoPagina: document.body.innerText || '' };
}

/**
 * Decide a partir do que foi lido. Puro, testável.
 * @returns {{ok: boolean, via: 'celula'|'pagina'|null}}
 */
function avaliarConferencia(leitura, pronac) {
    const re = regexPronac(pronac);
    if (leitura.celulas && leitura.celulas.some(t => re.test(t))) {
        return { ok: true, via: 'celula' };
    }
    // Célula achada e com outro valor: é o projeto errado (ou ainda o
    // placeholder do render). Não cai no fallback — continua esperando.
    if (leitura.celulas && leitura.celulas.length > 0) {
        return { ok: false, via: null };
    }
    const aindaNaListagem = /listar-projetos/i.test(leitura.url || '') || !!leitura.temListagem;
    if (!aindaNaListagem && re.test(leitura.textoPagina || '')) {
        return { ok: true, via: 'pagina' };
    }
    return { ok: false, via: null };
}

/**
 * Espera a tela do projeto renderizar e confere o PRONAC (até timeoutMs,
 * um ciclo por intervaloMs). Se não conferir, registra URL e trecho do
 * texto visível e lança erro — nada é gravado.
 */
async function conferirPronacNaTela(page, pronac, { timeoutMs = 20000, intervaloMs = 1000, log = console.log } = {}) {
    const inicio = Date.now();
    let leitura = { url: page.url(), celulas: null, textoPagina: '' };
    while (true) {
        leitura = await page.evaluate(lerTelaProjeto).catch(() => leitura);
        const r = avaliarConferencia(leitura, pronac);
        if (r.ok) {
            log(`[SALIC] PRONAC ${pronac} confirmado na tela do projeto (via ${r.via}, ${Date.now() - inicio}ms).`);
            return r;
        }
        if (Date.now() - inicio >= timeoutMs) break;
        await wait(intervaloMs);
    }
    const trecho = (leitura.textoPagina || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    log(`[SALIC] Conferencia do PRONAC falhou | url: ${leitura.url} | celulas PRONAC: ${JSON.stringify(leitura.celulas)} | texto: "${trecho}"`);
    throw new Error(
        `Abortando insercao: PRONAC ${pronac} nao apareceu na tela do projeto em ${Math.round(timeoutMs / 1000)}s ` +
        `(url: ${leitura.url}). Nada foi gravado no SALIC.`
    );
}

module.exports = {
    urlIndicaLoginRecusado,
    exigirSaidaDoLogin,
    regexPronac,
    lerTelaProjeto,
    avaliarConferencia,
    conferirPronacNaTela
};
