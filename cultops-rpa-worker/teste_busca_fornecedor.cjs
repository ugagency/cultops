// Testes da busca de fornecedor por CNPJ/CPF (buscarFornecedorSalic) — nao acessam o SALIC.
// Rodar: node teste_busca_fornecedor.cjs
// Usa HTML fixo (page.setContent) com um "SALIC" simulado por timers: a lupa dispara, apos um
// atraso configuravel, o preenchimento do nome ou uma mensagem. So roda se o puppeteer
// conseguir abrir um Chrome/Chromium local (CHROME_PATH); senao e pulado.
const assert = require('node:assert/strict');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { }

let falhas = 0;
async function caso(nome, fn) {
    try { await fn(); console.log('ok   -', nome); }
    catch (e) { falhas++; console.log('FALHA -', nome, '\n      ', e.message); }
}

// Tempos curtos nos testes; o comportamento e o mesmo com os padroes (500ms/20s/60s).
const TEMPOS = { intervaloMs: 100, timeoutTentativaMs: 1500, limiteTotalMs: 4500, margemMinimaMs: 600, atrasoDigitacaoMs: 5 };

// Modal parecido com o do SALIC: campo do documento (id CNPJCPF), lupa e campo do nome.
// A lupa conta cliques em window.__cliques e responde conforme window.__roteiro:
//   roteiro[n] = { apos: ms, nome: 'RAZAO' } | { apos: ms, mensagem: 'texto' } | null (nao responde)
function pagina({ avisoFixo = '', textoExtra = '', valorDoc = '' } = {}) {
    return `<div id="modal1" class="modal open">
        <p>Cadastrar novo comprovante</p>
        ${avisoFixo ? `<p id="aviso-fixo">${avisoFixo}</p>` : ''}
        <input id="CNPJCPF" type="text" value="${valorDoc}">
        <button class="btn" id="lupa"><i class="material-icons">search</i></button>
        <input id="Descricao" type="text" value="">
        <div id="msg" style="display:none"></div>
        <div id="oculto" style="display:none">nao encontrado (texto oculto)</div>
        ${textoExtra}
    </div>`;
}
async function montar(page, html, roteiro) {
    await page.setContent(html);
    await page.evaluate((roteiro) => {
        window.__cliques = 0; window.__roteiro = roteiro;
        document.querySelector('#lupa').addEventListener('click', () => {
            const r = window.__roteiro[window.__cliques++];
            if (!r) return;
            setTimeout(() => {
                if (r.nome) document.querySelector('#Descricao').value = r.nome;
                if (r.mensagem) { const m = document.querySelector('#msg'); m.textContent = r.mensagem; m.style.display = 'block'; }
            }, r.apos);
        });
    }, roteiro);
}
const clicar = (page) => page.evaluate(() => document.querySelector('#lupa').click());
const cliques = (page) => page.evaluate(() => window.__cliques);

(async () => {
    if (!puppeteer) { console.log('pulado - puppeteer nao instalado (use NODE_PATH)'); return; }
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
    } catch (e) { console.log('pulado - navegador nao abriu:', e.message); return; }

    const { buscarFornecedorSalic, contarIndiciosFornecedorInexistente } = require('./salic_insertion.cjs');
    const page = await browser.newPage();
    const base = { documentoSoNumeros: '03281691000137', tipoPessoaLabel: 'CNPJ', docFornecedor: '03281691000137', ...TEMPOS };
    const buscar = async (extra = {}) => {
        const linhas = [];
        const inicio = Date.now();
        try {
            const nome = await buscarFornecedorSalic(page, { ...base, log: (m) => linhas.push(m), ...extra });
            return { nome, linhas, ms: Date.now() - inicio };
        } catch (erro) {
            return { erro, linhas, ms: Date.now() - inicio };
        }
    };

    // ── contagem de termos ──
    await caso('termos: so conta "nao encontrado", "inexistente" e "nao cadastrado" (sem acento, qualquer caixa)', () => {
        assert.equal(contarIndiciosFornecedorInexistente('Fornecedor não encontrado.'), 1);
        assert.equal(contarIndiciosFornecedorInexistente('FORNECEDOR INEXISTENTE'), 1);
        assert.equal(contarIndiciosFornecedorInexistente('Fornecedor nao cadastrado no sistema'), 1);
        assert.equal(contarIndiciosFornecedorInexistente('Fornecedor cadastrado: ACME'), 0);
        assert.equal(contarIndiciosFornecedorInexistente(''), 0);
        assert.equal(contarIndiciosFornecedorInexistente(null), 0);
    });

    // ── polling: devolve assim que o nome aparece ──
    await caso('nome aparece em 0,6s: devolve logo (nao espera 5s fixos) e clica a lupa uma vez', async () => {
        await montar(page, pagina(), [{ apos: 600, nome: 'EMPRESA ACME LTDA' }]);
        await clicar(page); // o clique do chamador
        const r = await buscar();
        assert.equal(r.nome, 'EMPRESA ACME LTDA');
        assert.ok(r.ms >= 500 && r.ms < 1300, 'devolveu em ' + r.ms + 'ms');
        assert.equal(await cliques(page), 1);
    });

    await caso('nome ja presente: devolve imediatamente', async () => {
        await montar(page, pagina(), [{ apos: 0, nome: 'JA PREENCHIDO' }]);
        await clicar(page); await new Promise(r => setTimeout(r, 100));
        const r = await buscar();
        assert.equal(r.nome, 'JA PREENCHIDO');
        assert.ok(r.ms < 400, 'devolveu em ' + r.ms + 'ms');
    });

    await caso('outros seletores de nome tambem valem (#nmFornecedor)', async () => {
        await montar(page, pagina({ textoExtra: '<input id="nmFornecedor" value="">' }), [{ apos: 300 }]);
        await clicar(page);
        await page.evaluate(() => setTimeout(() => { document.querySelector('#nmFornecedor').value = 'VIA NMFORNECEDOR'; }, 400));
        const r = await buscar();
        assert.equal(r.nome, 'VIA NMFORNECEDOR');
    });

    // ── tentativas ──
    await caso('1a tentativa sem resposta, 2a responde: refaz a busca (redigita e clica) e encontra', async () => {
        await montar(page, pagina({ valorDoc: '99' }), [null, { apos: 300, nome: 'NA SEGUNDA' }]);
        await clicar(page);
        const r = await buscar();
        assert.equal(r.nome, 'NA SEGUNDA');
        assert.equal(await cliques(page), 2);
        assert.equal(await page.evaluate(() => document.querySelector('#CNPJCPF').value), '03281691000137', 'campo redigitado');
        assert.ok(r.linhas.some(l => l.includes('2a tentativa')), 'log da 2a tentativa');
        assert.ok(r.ms >= TEMPOS.timeoutTentativaMs && r.ms < TEMPOS.timeoutTentativaMs + 2500, 'levou ' + r.ms + 'ms');
    });

    await caso('so a 3a tentativa responde: encontra (3 cliques no total)', async () => {
        await montar(page, pagina(), [null, null, { apos: 200, nome: 'NA TERCEIRA' }]);
        await clicar(page);
        const r = await buscar({ limiteTotalMs: 8000 });
        assert.equal(r.nome, 'NA TERCEIRA');
        assert.equal(await cliques(page), 3);
        assert.ok(r.linhas.some(l => l.includes('3a tentativa')), 'log da 3a tentativa');
    });

    // ── falha (b): nao respondeu a tempo ──
    await caso('nunca responde: 3 tentativas, dentro do limite total, erro "nao respondeu a tempo" (vale reenviar)', async () => {
        await montar(page, pagina({ valorDoc: '03.281.691/0001-37' }), [null, null, null, null]);
        await clicar(page);
        const r = await buscar();
        assert.ok(r.erro, 'deveria lancar');
        assert.match(r.erro.message, /nao respondeu a tempo/);
        assert.match(r.erro.message, /vale reenviar/);
        assert.doesNotMatch(r.erro.message, /Cadastre manualmente/);
        assert.match(r.erro.message, /CNPJ 03281691000137/);
        assert.ok(await cliques(page) <= 3, 'no maximo 3 cliques');
        assert.ok(r.ms <= TEMPOS.limiteTotalMs + 500, 'total de ' + r.ms + 'ms acima do limite de ' + TEMPOS.limiteTotalMs + 'ms');
    });

    await caso('limite total curto: nao comeca tentativa sem margem e avisa no log', async () => {
        await montar(page, pagina(), [null, null, null]);
        await clicar(page);
        const r = await buscar({ limiteTotalMs: 3600, timeoutTentativaMs: 1500, margemMinimaMs: 1000 });
        assert.match(r.erro.message, /nao respondeu a tempo/);
        assert.equal(await cliques(page), 2, 'a 3a tentativa nao cabe no limite');
        assert.ok(r.linhas.some(l => l.includes('sem tempo para a 3a tentativa')), 'log do corte');
        assert.ok(r.ms <= 3600 + 500, 'total de ' + r.ms + 'ms');
    });

    // ── falha (a): mensagem explicita ──
    await caso('modal mostra "Fornecedor nao encontrado": erro (a) com "Cadastre manualmente"', async () => {
        await montar(page, pagina(), [{ apos: 200, mensagem: 'Fornecedor não encontrado.' }, { apos: 200, mensagem: 'Fornecedor não encontrado.' }, { apos: 200, mensagem: 'Fornecedor não encontrado.' }]);
        await clicar(page);
        const r = await buscar();
        assert.match(r.erro.message, /nao encontrado no SALIC/);
        assert.match(r.erro.message, /Cadastre manualmente/);
        assert.doesNotMatch(r.erro.message, /nao respondeu a tempo/);
    });

    await caso('aviso FIXO do modal com o termo ("nao cadastrado") nao conta como resposta da busca: erro (b)', async () => {
        await montar(page, pagina({ avisoFixo: 'Fornecedor não cadastrado? Procure o administrador.' }), [null, null, null]);
        await clicar(page);
        const base0 = await page.evaluate(() => document.querySelector('#modal1').innerText.replace(/\s+/g, ' ').trim());
        const r = await buscar({ textoModalBase: base0 });
        assert.match(r.erro.message, /nao respondeu a tempo/);
    });

    await caso('texto OCULTO com o termo nao conta (innerText so le o visivel)', async () => {
        await montar(page, pagina(), [null, null, null]);
        await clicar(page);
        const r = await buscar();
        assert.match(r.erro.message, /nao respondeu a tempo/);
    });

    // ── diagnostico da falha final ──
    await caso('falha final: log traz o texto do modal (ate 500 caracteres) e o valor de #CNPJCPF', async () => {
        await montar(page, pagina({ textoExtra: '<p>' + 'x'.repeat(2000) + '</p>', valorDoc: '03.281.691/0001-37' }), [null, null, null]);
        await clicar(page);
        const r = await buscar({ limiteTotalMs: 9000 });
        const diag = r.linhas.find(l => l.includes('DIAGNOSTICO busca de fornecedor'));
        assert.ok(diag, 'log de diagnostico presente');
        assert.ok(diag.includes('#CNPJCPF="03281691000137"'), 'valor de #CNPJCPF: ' + diag.slice(0, 120));
        const modal = JSON.parse(diag.split('#modal1=')[1]);
        assert.ok(modal.length <= 500 && modal.length === 500, 'texto truncado em 500 (veio com ' + modal.length + ')');
        assert.ok(modal.includes('Cadastrar novo comprovante'));
    });

    await caso('falha final com CPF no campo: o log mascara o CPF (nao grava o numero inteiro)', async () => {
        await montar(page, pagina({ valorDoc: '123.456.789-09' }), [null, null, null]);
        await clicar(page);
        const r = await buscar({ documentoSoNumeros: '12345678909', tipoPessoaLabel: 'CPF', docFornecedor: '12345678909' });
        const diag = r.linhas.find(l => l.includes('DIAGNOSTICO'));
        assert.ok(diag.includes('"123***09"'), diag);
        assert.ok(!diag.includes('123.456.789-09') && !diag.includes('12345678909'), 'CPF inteiro no log de diagnostico');
    });

    await caso('sucesso nao emite o log de diagnostico', async () => {
        await montar(page, pagina(), [{ apos: 200, nome: 'OK' }]);
        await clicar(page);
        const r = await buscar();
        assert.ok(!r.linhas.some(l => l.includes('DIAGNOSTICO')));
    });

    await caso('erro ao ler a pagina durante o polling nao aborta nem conclui por engano', async () => {
        await montar(page, pagina(), [{ apos: 900, nome: 'DEPOIS' }]);
        await clicar(page);
        const original = page.evaluate.bind(page);
        let falhasSimuladas = 0;
        page.evaluate = async (...args) => { if (falhasSimuladas < 2) { falhasSimuladas++; throw new Error('Execution context was destroyed'); } return original(...args); };
        try {
            const r = await buscar();
            assert.equal(r.nome, 'DEPOIS');
        } finally { page.evaluate = original; }
    });

    await browser.close();
    console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
})();
