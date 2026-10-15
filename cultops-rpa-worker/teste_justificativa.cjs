// Testes do preenchimento de #dsJustificativa (preencherJustificativaSalic) — nao acessam o SALIC.
// Rodar: node teste_justificativa.cjs
// Usa HTML fixo (page.setContent) e so roda se o puppeteer conseguir abrir um
// Chrome/Chromium local (CHROME_PATH); senao e pulado.
const assert = require('node:assert/strict');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { }

let falhas = 0;
async function caso(nome, fn) {
    try { await fn(); console.log('ok   -', nome); }
    catch (e) { falhas++; console.log('FALHA -', nome, '\n      ', e.message); }
}

// Trecho real do formulario do SALIC (textarea Materialize, sem maxlength nem required).
const HTML_COM_CAMPO = `<fieldset><legend>Justificativa</legend><div class="row"><div class="input-field col s12">
<textarea rows="15" name="dsJustificativa" id="dsJustificativa" class="materialize-textarea"></textarea>
<label for="dsJustificativa">Justificativa</label></div></div></fieldset>`;
const HTML_SEM_CAMPO = '<fieldset><legend>Justificativa</legend><div class="row"></div></fieldset>';

(async () => {
    if (!puppeteer) { console.log('pulado - puppeteer nao instalado (use NODE_PATH)'); return; }
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.CHROME_PATH || undefined,
            args: ['--no-sandbox']
        });
    } catch (e) { console.log('pulado - navegador nao abriu:', e.message); return; }

    const { preencherJustificativaSalic } = require('./salic_insertion.cjs');
    const page = await browser.newPage();
    const silencioso = () => { };
    const lerCampo = () => page.evaluate(() => {
        const el = document.querySelector('#dsJustificativa');
        const label = document.querySelector('label[for="dsJustificativa"]');
        return el ? { valor: el.value, labelAtivo: !!(label && label.classList.contains('active')) } : null;
    });
    // Marca no proprio documento cada evento que o Materialize/jQuery escutam.
    const espiarEventos = () => page.evaluate(() => {
        window.__eventos = [];
        const el = document.querySelector('#dsJustificativa');
        for (const t of ['focus', 'input', 'change', 'keyup', 'blur']) el.addEventListener(t, () => window.__eventos.push(t));
    });

    await caso('com justificativa: campo preenchido, label ativo e eventos disparados', async () => {
        await page.setContent(HTML_COM_CAMPO);
        await espiarEventos();
        const r = await preencherJustificativaSalic(page, 'Rubrica excedida por reajuste de cache.', silencioso);
        assert.equal(r, true);
        const c = await lerCampo();
        assert.equal(c.valor, 'Rubrica excedida por reajuste de cache.');
        assert.equal(c.labelAtivo, true);
        const ev = await page.evaluate(() => window.__eventos);
        for (const t of ['focus', 'input', 'change', 'keyup', 'blur']) assert.ok(ev.includes(t), 'evento ' + t);
    });

    await caso('com justificativa longa e quebras de linha: nao trunca', async () => {
        await page.setContent(HTML_COM_CAMPO);
        const texto = ('Linha de justificativa com acentuacao: ação, não, é.\n').repeat(60).trim();
        assert.ok(texto.length > 3000);
        await preencherJustificativaSalic(page, texto, silencioso);
        const c = await lerCampo();
        assert.equal(c.valor, texto);
    });

    await caso('com quebra CRLF: confere apos a normalizacao do textarea', async () => {
        await page.setContent(HTML_COM_CAMPO);
        assert.equal(await preencherJustificativaSalic(page, 'primeira\r\nsegunda', silencioso), true);
        assert.equal((await lerCampo()).valor, 'primeira\nsegunda');
    });

    await caso('espacos nas pontas sao aparados antes de preencher', async () => {
        await page.setContent(HTML_COM_CAMPO);
        await preencherJustificativaSalic(page, '   texto   \n', silencioso);
        assert.equal((await lerCampo()).valor, 'texto');
    });

    for (const [rotulo, valor] of [['null', null], ['undefined', undefined], ['vazia', ''], ['so espacos', '   \n ']]) {
        await caso(`sem justificativa (${rotulo}): campo continua vazio e nada e disparado`, async () => {
            await page.setContent(HTML_COM_CAMPO);
            await espiarEventos();
            const linhas = [];
            const r = await preencherJustificativaSalic(page, valor, (m) => linhas.push(m));
            assert.equal(r, false);
            const c = await lerCampo();
            assert.equal(c.valor, '');
            assert.equal(c.labelAtivo, false);
            assert.deepEqual(await page.evaluate(() => window.__eventos), []);
            assert.ok(linhas.some(l => l.includes('deixado vazio')), 'log do campo vazio mantido');
        });
    }

    await caso('campo ausente com justificativa: lanca erro claro', async () => {
        await page.setContent(HTML_SEM_CAMPO);
        await assert.rejects(
            preencherJustificativaSalic(page, 'texto', silencioso),
            /Justificativa fornecida mas o campo #dsJustificativa não foi preenchido/
        );
    });

    await caso('campo ausente sem justificativa: segue sem erro', async () => {
        await page.setContent(HTML_SEM_CAMPO);
        assert.equal(await preencherJustificativaSalic(page, null, silencioso), false);
    });

    await caso('valor lido diverge (pagina corta o texto): lanca erro claro', async () => {
        await page.setContent(HTML_COM_CAMPO);
        // Simula uma pagina que limita o campo a 10 caracteres ao receber o evento input.
        await page.evaluate(() => {
            const el = document.querySelector('#dsJustificativa');
            el.addEventListener('input', () => { el.value = el.value.slice(0, 10); });
        });
        await assert.rejects(
            preencherJustificativaSalic(page, 'texto bem maior que dez caracteres', silencioso),
            /Justificativa fornecida mas o campo #dsJustificativa não foi preenchido \(valor lido com 10 caracteres, esperado 34\)/
        );
    });

    await browser.close();
    console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
})();
