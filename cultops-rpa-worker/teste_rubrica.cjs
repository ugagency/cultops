// Testes da escolha e da conferência da rubrica (ocorrência #119) — nao acessam o SALIC.
// Rodar: node teste_rubrica.cjs
// Parte 1 (logica pura): normRubrica, conferirRubricaDaTela, logarLinhasVistas.
// Parte 2 (HTML fixo, page.setContent): localizarRubricaNaPagina e lerNomeRubricaNaTela. So
// roda se o puppeteer conseguir abrir um Chrome/Chromium local (CHROME_PATH); senao e pulada.
const assert = require('node:assert/strict');
const {
    localizarRubricaNaPagina, normRubrica, lerNomeRubricaNaTela, conferirRubricaDaTela, logarLinhasVistas, mensagemRubricaNaoEncontrada
} = require('./salic_insertion.cjs');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { }

let falhas = 0;
async function caso(nome, fn) {
    try { await fn(); console.log('ok   -', nome); }
    catch (e) { falhas++; console.log('FALHA -', nome, '\n      ', e.message); }
}

// Estrutura da tela de Comprovacao Financeira do SALIC: tabela-resumo (2 td por linha) e um
// bloco .collapsible-header.green-text por produto, com a UF/cidade aninhada e a tabela de itens.
const linha = (nome, aprovado, saldo, id) => `<tr><td>${nome}</td><td>R$ ${aprovado}</td><td>R$ 0,00</td><td>R$ ${saldo}</td>` +
    `<td>${id ? `<a title="Comprovar item" href="https://salic.exemplo/comprovar/${id}">$</a>` : ''}</td></tr>`;
const bloco = (produto, linhas) => `<li><div class="collapsible-header green-text"><i class="material-icons">perm_media</i>
${produto}</div>
<div class="collapsible-body"><ul class="collapsible"><li><div class="collapsible-header"><i class="material-icons">place</i>Rio de Janeiro</div>
<div class="collapsible-body"><table class="bordered"><tbody>${linhas.join('')}</tbody></table></div></li></ul></div></li>`;
const RESUMO = `<table class="bordered"><tbody><tr><td>Valor Aprovado</td><td>R$ 14.762.416,01</td></tr>
<tr><td>Valor a Comprovar</td><td>R$ 10.374.465,08</td></tr></tbody></table>`;
const telaComprovacao = (blocos) => `<html><body>${RESUMO}<ul class="collapsible">${blocos.join('')}</ul></body></html>`;

// Caso da NF 39208: no SALIC o bloco "Administração do Projeto" NAO tem "Advogado(a)"; tem
// "Custos de acessibilidade..." com saldo de sobra. O antigo passo 6 escolhia essa linha.
const BLOCO_ADMIN = bloco('Administração do Projeto', [
    linha('Custos de acessibilidade, comunicação e divulgação acessíveis', '1.686.048,00', '1.343.296,91', 'acessibilidade'),
    linha('Contador(a)', '120.000,00', '80.000,00', 'contador'),
    linha('Item sem saldo', '10.000,00', '0,00', null),                 // 5 td, sem botao
    '<tr><td>Linha curta</td><td>1</td><td>2</td><td>3</td></tr>',      // 4 td
]);
const BLOCO_PERIODICO = bloco('Periódico / Catálogo / Cartilha / Programa', [
    linha('Advogado(a)', '240.000,00', '200.000,00', 'advogado'),
    linha('Coordenação Editorial', '50.000,00', '50.000,00', 'editorial'),
]);

const COMPROVANTES = (item) => `<html><body>
<div class="page-title"><h1>Prestação de Contas: Comprovantes</h1></div>
<div class="card"><span class="card-title">Projeto: 256578 - Plano Anual de Atividades Museu de Arte do Rio - MAR 2026</span></div>
<div class="card-stacked">${item === null ? '' : `<div class="center-align card-title lighten-4">Item: ${item}</div>`}
<table><thead><tr><th>Produto</th><th>Etapa</th><th>Itens de Custo</th></tr></thead>
<tbody><tr><td>Administração do Projeto</td><td>Custos Vinculados</td><td>${item || ''}</td></tr></tbody></table></div>
</body></html>`;

(async () => {
    // ── Parte 1: logica pura ──
    await caso('normRubrica e a mesma norm() usada dentro de localizarRubricaNaPagina', () => {
        const fonte = localizarRubricaNaPagina.toString();
        const naPagina = fonte.match(/const norm = \(s\) => (String\(s \|\| ''\)[\s\S]*?\.toLowerCase\(\));/)[1].replace(/\s+/g, '');
        const noNode = normRubrica.toString().match(/return (String\(s \|\| ''\)[\s\S]*?\.toLowerCase\(\));/)[1].replace(/\s+/g, '');
        assert.equal(noNode, naPagina);
    });

    await caso('normRubrica: tira prefixo numerico, acento, pontuacao e caixa', () => {
        assert.equal(normRubrica('46 - Advogado(a)'), 'advogado a');
        assert.equal(normRubrica('Advogado(a)'), 'advogado a');
        assert.equal(normRubrica('Custos de acessibilidade, comunicação e divulgação acessíveis'),
            'custos de acessibilidade comunicacao e divulgacao acessiveis');
    });

    await caso('conferirRubricaDaTela: mesmo nome (apos norm) passa', () => {
        conferirRubricaDaTela('Advogado(a)', 'Advogado(a)');
        conferirRubricaDaTela('ADVOGADO (A)', '46 - Advogado(a)');
    });

    await caso('conferirRubricaDaTela: nome diferente lanca erro antes de abrir o modal', () => {
        assert.throws(() => conferirRubricaDaTela('Custos de acessibilidade, comunicação e divulgação acessíveis', 'Advogado(a)'),
            /Rubrica da tela \("Custos de acessibilidade, comunicação e divulgação acessíveis"\) diverge da rubrica esperada \("Advogado\(a\)"\)/);
    });

    await caso('conferirRubricaDaTela: parecido mas nao igual tambem e erro (sem tolerancia)', () => {
        assert.throws(() => conferirRubricaDaTela('Advogado(a) Tributarista', 'Advogado(a)'), /diverge/);
    });

    await caso('conferirRubricaDaTela: sem nome na tela lanca erro', () => {
        assert.throws(() => conferirRubricaDaTela(null, 'Advogado(a)'), /Nao consegui ler o nome da rubrica/);
    });

    await caso('logarLinhasVistas: loga candidatas e descartadas de cada escopo', () => {
        const linhas = [];
        logarLinhasVistas([{ escopo: 'flat', candidatas: [{ texto: 'A', tds: 5, comprovar: true }], descartadas: [{ texto: 'B', tds: 2, comprovar: false }] }], (m) => linhas.push(m));
        assert.deepEqual(linhas, [
            '[SALIC] Linhas vistas (escopo: flat): 1 candidata(s), 1 descartada(s)',
            '  [candidata 1] "A" | td=5 | comprovar=true',
            '  [descartada 1] "B" | td=2 | comprovar=false',
        ]);
    });

    // ── Parte 2: HTML fixo ──
    if (!puppeteer) { console.log('pulado - parte 2: puppeteer nao instalado (use NODE_PATH)'); return fim(); }
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
    } catch (e) { console.log('pulado - parte 2: navegador nao abriu:', e.message); return fim(); }
    const page = await browser.newPage();
    const localizar = (nome, produto, valorAprovado) => page.evaluate(localizarRubricaNaPagina, nome, produto, valorAprovado);

    await caso('NF 39208: rubrica ausente no bloco do produto NAO cai na linha com saldo', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 240000);
        assert.notEqual(r.link, 'https://salic.exemplo/comprovar/acessibilidade');
        assert.notEqual(r.matchType, 'saldo_suficiente');
        // segue para a busca flat e casa por nome exato + valor aprovado (linha unica)
        assert.equal(r.link, 'https://salic.exemplo/comprovar/advogado');
        assert.equal(r.matchType, 'flat_nome_e_valor_aprovado');
        assert.equal(r.scopeProduto, 'flat_fallback');
    });

    await caso('flat: Advogado(a) 240000 so em outro bloco de produto -> casa e informa o produto onde achou', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 240000);
        assert.equal(r.link, 'https://salic.exemplo/comprovar/advogado');
        assert.equal(r.produtoEncontrado, 'perm_media Periódico / Catálogo / Cartilha / Programa');
    });

    await caso('flat: duas linhas Advogado(a) com o mesmo aprovado em produtos diferentes -> erro', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN,
            bloco('Exposição Cultural / de Artes', [linha('Advogado(a)', '240.000,00', '240.000,00', 'advogado-expo')])]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 240000);
        assert.equal(r.link, null);
        assert.match(r.motivo, /2 linhas com o mesmo nome e o mesmo valor aprovado/);
        assert.deepEqual(r.candidatos, [
            'Advogado(a) (aprovado 240000.00 | produto: perm_media Periódico / Catálogo / Cartilha / Programa)',
            'Advogado(a) (aprovado 240000.00 | produto: perm_media Exposição Cultural / de Artes)',
        ]);
    });

    await caso('flat: Advogado(a) com aprovado diferente -> erro', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 250000);
        assert.equal(r.link, null);
        assert.match(r.motivo, /nenhuma linha com valor aprovado 250000/);
        assert.deepEqual(r.candidatos, ['Advogado(a) (aprovado 240000.00 | produto: perm_media Periódico / Catálogo / Cartilha / Programa)']);
    });

    await caso('flat: sem valor aprovado da rubrica -> erro (nao casa so pelo nome)', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', null, null);
        assert.equal(r.link, null);
        assert.match(r.motivo, /sem valor aprovado da rubrica/);
    });

    await caso('flat: nome so parecido (substring) com o mesmo aprovado -> erro (sem substring/tokens/fuzzy no flat)', async () => {
        await page.setContent(telaComprovacao([bloco('Periódico', [linha('Advogado(a) tributarista', '240.000,00', '240.000,00', 'trib')]), BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 240000);
        assert.equal(r.link, null);
        assert.match(r.motivo, /nenhuma linha com o nome exato/);
    });

    await caso('mensagem de erro do worker traz o motivo e as candidatas', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 250000);
        assert.equal(mensagemRubricaNaoEncontrada(r),
            'Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro"): nome encontrado, mas nenhuma linha com valor aprovado 250000. ' +
            'Candidatas: Advogado(a) (aprovado 240000.00 | produto: perm_media Periódico / Catálogo / Cartilha / Programa)');
    });

    await caso('rubrica que nao existe em lugar nenhum: link null e lista as candidatas (antes: inseria pelo saldo)', async () => {
        await page.setContent(telaComprovacao([BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 240000);
        assert.equal(r.link, null);
        assert.equal(r.matchType, undefined);
        assert.deepEqual(r.candidatos, [
            'Custos de acessibilidade, comunicação e divulgação acessíveis (aprovado 1686048.00 | produto: perm_media Administração do Projeto)',
            'Contador(a) (aprovado 120000.00 | produto: perm_media Administração do Projeto)',
        ]);
    });

    await caso('sem produto e sem nome parecido: link null (sem fallback de saldo no flat)', async () => {
        await page.setContent(telaComprovacao([BLOCO_ADMIN]));
        const r = await localizar('Passagens Aereas', null, null);
        assert.equal(r.link, null);
    });

    await caso('linhas vistas: candidatas e descartadas com texto, numero de td e botao', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Advogado(a)', 'Administração do Projeto', 240000);
        assert.deepEqual(r.vistas.map(v => v.escopo), ['produto: perm_media Administração do Projeto', 'flat']);
        const [produto, flat] = r.vistas;
        assert.deepEqual(produto.candidatas.map(c => c.texto), ['Custos de acessibilidade, comunicação e divulgação acessíveis', 'Contador(a)']);
        assert.deepEqual(produto.descartadas, [
            { texto: 'Item sem saldo', tds: 5, comprovar: false },
            { texto: 'Linha curta', tds: 4, comprovar: false },
        ]);
        assert.equal(flat.candidatas.length, 4);
        assert.deepEqual(flat.descartadas.map(d => `${d.texto}|${d.tds}|${d.comprovar}`),
            ['Valor Aprovado|2|false', 'Valor a Comprovar|2|false', 'Item sem saldo|5|false', 'Linha curta|4|false']);
    });

    await caso('linhas vistas tambem vem quando nada casa', async () => {
        await page.setContent(telaComprovacao([BLOCO_ADMIN]));
        const r = await localizar('Passagens Aereas', null, null);
        assert.equal(r.vistas.length, 1);
        assert.equal(r.vistas[0].escopo, 'flat');
        assert.equal(r.vistas[0].candidatas.length, 2);
    });

    await caso('rubrica presente no bloco do produto: casa dentro do bloco', async () => {
        await page.setContent(telaComprovacao([BLOCO_PERIODICO, BLOCO_ADMIN]));
        const r = await localizar('Contador(a)', 'Administração do Projeto', 120000);
        assert.equal(r.link, 'https://salic.exemplo/comprovar/contador');
        assert.equal(r.matchType, 'valor_aprovado');
        assert.match(r.scopeProduto, /Administração do Projeto/);
        assert.equal(r.nomeTabela, 'Contador(a)');
    });

    await caso('ambiguidade continua sendo erro (dois itens com o mesmo nome no bloco)', async () => {
        await page.setContent(telaComprovacao([bloco('Administração do Projeto', [
            linha('Assistentes', '10.000,00', '10.000,00', 'a1'), linha('Assistentes', '20.000,00', '20.000,00', 'a2')])]));
        const r = await localizar('Assistentes', 'Administração do Projeto', null);
        assert.equal(r.erro_ambiguidade, true);
        assert.equal(r.link, null);
    });

    await caso('tela da rubrica: le o nome do "Item:" (ignora o card do Projeto)', async () => {
        await page.setContent(COMPROVANTES('Custos de acessibilidade, comunicação e divulgação acessíveis'));
        assert.equal(await lerNomeRubricaNaTela(page, { timeoutMs: 1000 }), 'Custos de acessibilidade, comunicação e divulgação acessíveis');
    });

    await caso('tela da rubrica errada: a conferencia barra o envio', async () => {
        await page.setContent(COMPROVANTES('Custos de acessibilidade, comunicação e divulgação acessíveis'));
        const nome = await lerNomeRubricaNaTela(page, { timeoutMs: 1000 });
        assert.throws(() => conferirRubricaDaTela(nome, 'Advogado(a)'), /diverge/);
    });

    await caso('tela da rubrica certa: a conferencia passa', async () => {
        await page.setContent(COMPROVANTES('Advogado(a)'));
        conferirRubricaDaTela(await lerNomeRubricaNaTela(page, { timeoutMs: 1000 }), 'Advogado(a)');
    });

    await caso('tela sem "Item:": devolve null dentro do prazo e a conferencia lanca erro', async () => {
        await page.setContent(COMPROVANTES(null));
        const t0 = Date.now();
        const nome = await lerNomeRubricaNaTela(page, { timeoutMs: 800, intervaloMs: 200 });
        assert.equal(nome, null);
        assert.ok(Date.now() - t0 < 3000, 'respeita o timeout');
        assert.throws(() => conferirRubricaDaTela(nome, 'Advogado(a)'), /Nao consegui ler/);
    });

    await caso('tela que renderiza depois: o polling espera o "Item:" aparecer', async () => {
        await page.setContent(COMPROVANTES(null));
        await page.evaluate(() => setTimeout(() => {
            const d = document.createElement('div'); d.className = 'card-title'; d.textContent = 'Item: Advogado(a)';
            document.body.appendChild(d);
        }, 600));
        assert.equal(await lerNomeRubricaNaTela(page, { timeoutMs: 3000, intervaloMs: 100 }), 'Advogado(a)');
    });

    await browser.close();
    fim();
})();

function fim() {
    console.log(falhas === 0 ? '\ntodos os casos passaram' : `\n${falhas} caso(s) falharam`);
    process.exitCode = falhas === 0 ? 0 : 1;
}
