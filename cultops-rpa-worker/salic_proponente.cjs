const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── BUSCA DE PRONAC ENTRE MÚLTIPLOS PROPONENTES ──────────────────────────
//
// Até esta mudança, os dois robôs (captura e inserção) buscavam o PRONAC
// só na lista de projetos do proponente que vem selecionado por padrão na
// tela /projeto/#/listar-projetos-proponente. Isso nunca foi problema
// porque toda conta logada só tinha um proponente vinculado. Em produção
// (30/09/2026), a conta da Animus CPFL/Veritah mostrou-se vinculada a DOIS
// proponentes ("[22.713.288/0001-84] - ARTE SERRINHA..." e
// "[07.864.437/0001-12] - VERITAH..."), e os PRONACs 248504/245085
// pertencem ao segundo — o robô falhava com "Link do PRONAC nao
// encontrado na tabela" porque nunca trocava o proponente selecionado.
//
// Solução: localizarPronac() percorre TODOS os proponentes do combobox em
// sequência até achar o PRONAC. Um PRONAC só existe sob um proponente, o
// resultado é único — não precisa casar por nome, só parar no primeiro
// que contiver o link.
//
// Seletores (Vuetify 1.x, vindos da inspeção do HTML real do SALIC em
// 30/09/2026): combobox "Proponentes" é input[aria-label="Proponentes"],
// abre o menu pelo container .v-select__slot; itens do menu são
// .v-list__tile__title, no formato "[CNPJ] - NOME"; a tabela de projetos
// fica em #planilha table tbody, com links a[title="Visualizar Projeto"].
// NÃO FORAM TESTADOS contra o SALIC vivo até este commit — validar
// primeiro com o robô de captura (leitura), nunca com o de inserção. Ver
// instruções de teste no fim deste arquivo.
//
// TODO: o filtro "Mecanismo" (Mecenato/FNC/Recurso do Tesouro, mesma tela)
// tem o mesmo risco em tese — um PRONAC pode estar sob um mecanismo
// diferente do selecionado por padrão. Fora de escopo por decisão
// explícita nesta mudança. Custo estimado pra tratar: baixo — mesma
// técnica de localizarPronac, com um segundo loop aninhado (proponente x
// mecanismo); só compensa implementar se aparecer um caso real.

const RE_PROPONENTE = /^\[[^\]]+\]\s*-\s*.+/;

/**
 * Abre o combobox "Proponentes" e lê os itens do menu que batem o formato
 * "[CNPJ] - NOME" (filtra os demais itens — a mesma tela tem outros
 * comboboxes, como "Mecanismo" e linhas-por-página). Fecha o menu ao
 * final (Escape), do jeito que a tela esperava estar antes de abrir.
 */
async function listarProponentes(page) {
    await page.waitForSelector('input[aria-label="Proponentes"]', { timeout: 15000 });
    await _abrirComboProponentes(page);

    let itens = [];
    for (let i = 0; i < 10; i++) {
        itens = await page.evaluate((padrao) => {
            const re = new RegExp(padrao);
            return Array.from(document.querySelectorAll('.v-list__tile__title'))
                .filter(el => el.getClientRects().length > 0)
                .map(el => el.textContent.trim())
                .filter(t => re.test(t));
        }, RE_PROPONENTE.source);
        if (itens.length > 0) break;
        await wait(500);
    }

    await page.keyboard.press('Escape');
    await wait(300);
    return itens;
}

async function _abrirComboProponentes(page) {
    await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Proponentes"]');
        const slot = input && input.closest('.v-select__slot');
        (slot || input).click();
    });
    await wait(500);
}

/**
 * Seleciona um proponente pelo título exato (como devolvido por
 * listarProponentes) e espera a tabela de projetos recarregar.
 */
async function selecionarProponente(page, titulo) {
    await _abrirComboProponentes(page);

    const clicou = await page.evaluate((alvo) => {
        const item = Array.from(document.querySelectorAll('.v-list__tile__title'))
            .find(el => el.getClientRects().length > 0 && el.textContent.trim() === alvo);
        if (!item) return false;
        const tile = item.closest('.v-list__tile') || item;
        tile.click();
        return true;
    }, titulo);

    if (!clicou) throw new Error(`Proponente "${titulo}" nao encontrado no menu (#salic-proponente).`);

    await aguardarTabelaEstavel(page);
}

/**
 * Espera o conteúdo do tbody parar de mudar por pelo menos dois ciclos de
 * 500ms seguidos, com timeout de 20s. Não confia em classe de loading
 * (não verificamos se existe uma confiável nesta tela) — só no conteúdo
 * em si ter parado de mudar. Não lança erro em timeout: quem chama ainda
 * pode tentar ler a tabela, só com mais risco de pegar ela a meio caminho
 * do recarregamento.
 */
async function aguardarTabelaEstavel(page, timeoutMs = 20000) {
    const inicio = Date.now();
    let anterior = null;
    let ciclosIguais = 0;
    while (Date.now() - inicio < timeoutMs) {
        const atual = await page.evaluate(() => {
            const tbody = document.querySelector('#planilha table tbody') || document.querySelector('table tbody');
            return tbody ? tbody.innerText : null;
        });
        if (atual !== null && atual === anterior) {
            ciclosIguais++;
            if (ciclosIguais >= 2) return;
        } else {
            ciclosIguais = 0;
        }
        anterior = atual;
        await wait(500);
    }
}

/**
 * Procura, na tabela ATUAL (do proponente selecionado no momento), o link
 * do PRONAC. Tenta primeiro o seletor mais específico
 * (a[title="Visualizar Projeto"], da inspeção do DOM real) e cai pro
 * padrão genérico que os dois robôs já usavam antes desta mudança
 * (table tbody tr td a) se não achar nada — não regride o que já
 * funcionava caso o atributo title não esteja presente em algum caso.
 */
async function acharLinkPronac(page, pronac) {
    return await page.evaluate((p) => {
        const porTitle = Array.from(document.querySelectorAll('a[title="Visualizar Projeto"]'))
            .find(a => a.innerText.includes(p));
        if (porTitle) return porTitle.href;
        const generico = Array.from(document.querySelectorAll('table tbody tr td a'))
            .find(a => a.innerText.includes(p));
        return generico ? generico.href : null;
    }, pronac);
}

/**
 * Percorre todos os proponentes do combobox até achar o PRONAC, usando em
 * cada um o campo de busca (input[aria-label="Buscar"]) que os robôs já
 * usavam — só que agora refeito a cada troca de proponente. Devolve o
 * primeiro proponente em que o link aparecer; um PRONAC só existe sob um
 * proponente, então não há ambiguidade a resolver.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} pronac
 * @param {(msg: string) => void} [log] - por padrão console.log; os dois
 *   robôs passam seu próprio prefixo de log ([SALIC-CAPTURA]/[SALIC]).
 * @returns {Promise<{href: string, proponente: string}>}
 */
async function localizarPronac(page, pronac, log = console.log) {
    const proponentes = await listarProponentes(page);
    if (proponentes.length === 0) {
        throw new Error('Nenhum proponente encontrado no combobox "Proponentes".');
    }
    log(`[SALIC-PRONAC] Proponentes disponiveis: ${JSON.stringify(proponentes)}`);

    const tentados = [];
    for (const proponente of proponentes) {
        await selecionarProponente(page, proponente);

        const busca = await page.$('input[aria-label="Buscar"]');
        if (busca) {
            await busca.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await busca.type(pronac);
            await wait(3000);
        }

        const href = await acharLinkPronac(page, pronac);
        const totalProjetos = await page.evaluate(() => {
            const tbody = document.querySelector('#planilha table tbody') || document.querySelector('table tbody');
            return tbody ? tbody.querySelectorAll('tr').length : 0;
        });
        tentados.push({ proponente, totalProjetos });
        log(`[SALIC-PRONAC] Proponente "${proponente}": ${totalProjetos} projeto(s) visiveis apos busca.`);

        if (href) {
            log(`[SALIC-PRONAC] PRONAC ${pronac} encontrado em "${proponente}".`);
            return { href, proponente };
        }
    }

    throw new Error(
        `PRONAC ${pronac} nao encontrado em nenhum dos ${proponentes.length} proponente(s) tentados: ` +
        JSON.stringify(tentados)
    );
}

/**
 * Mascara um CPF (só dígitos) pra log — nunca imprimir o CPF completo.
 * "26712345622" -> "267***22".
 */
function mascararCpf(cpf) {
    const digitos = String(cpf || '').replace(/\D/g, '');
    if (digitos.length < 6) return '***';
    return `${digitos.slice(0, 3)}***${digitos.slice(-2)}`;
}

module.exports = {
    listarProponentes,
    selecionarProponente,
    acharLinkPronac,
    localizarPronac,
    aguardarTabelaEstavel,
    mascararCpf
};
