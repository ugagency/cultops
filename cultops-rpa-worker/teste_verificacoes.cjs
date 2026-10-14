// Testes de salic_verificacoes.cjs — não acessam o SALIC.
// Rodar: node teste_verificacoes.cjs
// A parte de navegador usa HTML fixo (page.setContent) e só roda se o
// puppeteer conseguir abrir um Chrome/Chromium local; senão é pulada.
const assert = require('node:assert/strict');
const {
    urlIndicaLoginRecusado, exigirSaidaDoLogin, aguardarFimDoSalvamento, regexPronac, avaliarConferencia,
    lerTelaProjeto, conferirPronacNaTela
} = require('./salic_verificacoes.cjs');

let falhas = 0;
async function caso(nome, fn) {
    try { await fn(); console.log('ok   -', nome); }
    catch (e) { falhas++; console.log('FALHA -', nome, '\n      ', e.message); }
}

const URL_DETALHE = 'https://salic.cultura.gov.br/projeto/#/123456/detalhe';
const URL_LISTA = 'https://salic.cultura.gov.br/projeto/#/listar-projetos-proponente';

(async () => {
    // ── regex ──
    await caso('regex: palavra inteira bate com espaços/quebras ao redor', () => {
        assert.ok(regexPronac('2414072').test('\n   2414072\n  '));
        assert.ok(regexPronac('248504').test('PRONAC 248504 - Nome'));
    });
    await caso('regex: não bate dentro de número maior', () => {
        assert.ok(!regexPronac('248504').test('1248504'));
        assert.ok(!regexPronac('248504').test('2485040'));
        assert.ok(!regexPronac('2414072').test('24140720'));
    });
    await caso('regex: escapa caracteres especiais', () => {
        assert.ok(!regexPronac('24.1').test('2441'));
        assert.ok(regexPronac('24.1').test('x 24.1 y'));
    });

    // ── login ──
    await caso('login: /autenticacao/ = recusado', () => {
        assert.ok(urlIndicaLoginRecusado('https://salic.cultura.gov.br/autenticacao/index/index'));
        assert.ok(!urlIndicaLoginRecusado('https://salic.cultura.gov.br/comunicados-proponente/#/home-comunicados-proponente'));
        assert.ok(!urlIndicaLoginRecusado(''));
        assert.ok(!urlIndicaLoginRecusado(undefined));
    });

    // ── avaliação pura ──
    await caso('avaliar: célula com o PRONAC confere via célula', () => {
        assert.deepEqual(avaliarConferencia({ url: URL_DETALHE, celulas: ['2414072'], textoPagina: '' }, '2414072'), { ok: true, via: 'celula' });
    });
    await caso('avaliar: célula com outro PRONAC não confere nem cai no fallback', () => {
        const r = avaliarConferencia({ url: URL_DETALHE, celulas: ['999999'], textoPagina: 'menciona 2414072' }, '2414072');
        assert.equal(r.ok, false);
    });
    await caso('avaliar: sem célula, fallback pelo texto da página', () => {
        assert.deepEqual(avaliarConferencia({ url: URL_DETALHE, celulas: null, textoPagina: 'PRONAC 2414072' }, '2414072'), { ok: true, via: 'pagina' });
    });
    await caso('avaliar: fallback não vale na URL da listagem', () => {
        assert.equal(avaliarConferencia({ url: URL_LISTA, celulas: null, textoPagina: '2414072' }, '2414072').ok, false);
    });
    await caso('avaliar: fallback não vale com a tabela da listagem ainda no DOM', () => {
        assert.equal(avaliarConferencia({ url: URL_DETALHE, celulas: null, temListagem: true, textoPagina: '2414072' }, '2414072').ok, false);
    });
    await caso('avaliar: página vazia não confere', () => {
        assert.equal(avaliarConferencia({ url: URL_DETALHE, celulas: null, textoPagina: '' }, '2414072').ok, false);
    });

    // ── navegador com HTML fixo ──
    let puppeteer;
    try { puppeteer = require('puppeteer'); } catch (e) { }
    let browser;
    if (puppeteer) {
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: process.env.CHROME_PATH || undefined,
                args: ['--no-sandbox']
            });
        } catch (e) { console.log('pulado - navegador não abriu:', e.message); }
    } else {
        console.log('pulado - puppeteer não instalado (use NODE_PATH)');
    }

    if (browser) {
        // Imita a tela real: id-pronac é ID interno (diferente do PRONAC),
        // PRONAC em <u><p> com espaços e quebras de linha.
        const tela = (pronac) => `
            <div id="app" class="application--wrap"><!---->
              <div id="dados-projeto">
                <div id="conteudo" id-pronac="987654">
                  <table class="tabela">
                    <tr><th>PRONAC</th><th>Nome do Projeto</th></tr>
                    <tr>
                      <td>
                        <u><p>
                          ${pronac}
                        </p></u>
                      </td>
                      <td>Projeto Exemplo</td>
                    </tr>
                  </table>
                </div>
              </div>
            </div>`;
        const telaSemPronac = `<div id="dados-projeto"><div id="conteudo" id-pronac="2414072">
            <table class="tabela"><tr><th>PRONAC</th><th>Nome do Projeto</th></tr>
            <tr><td><u><p>
               1111111
            </p></u></td><td>Outro</td></tr></table></div></div>`;
        const silencioso = { log: () => { } };

        const page = await browser.newPage();

        await caso('html: tela com o PRONAC (7 dígitos) confere pela célula', async () => {
            await page.setContent(tela('2414072'));
            const r = await conferirPronacNaTela(page, '2414072', { timeoutMs: 2000, intervaloMs: 200, ...silencioso });
            assert.deepEqual(r, { ok: true, via: 'celula' });
        });
        await caso('html: tela com o PRONAC (6 dígitos) confere pela célula', async () => {
            await page.setContent(tela('248504'));
            const r = await conferirPronacNaTela(page, '248504', { timeoutMs: 2000, intervaloMs: 200, ...silencioso });
            assert.equal(r.via, 'celula');
        });
        await caso('html: tela sem o PRONAC aborta (id-pronac interno não conta)', async () => {
            await page.setContent(telaSemPronac);
            const linhas = [];
            await assert.rejects(
                conferirPronacNaTela(page, '2414072', { timeoutMs: 1500, intervaloMs: 300, log: (m) => linhas.push(m) }),
                /Abortando insercao: PRONAC 2414072 nao apareceu/
            );
            assert.ok(linhas.some(l => l.includes('url:') && l.includes('texto:')), 'log com url e trecho');
        });
        await caso('html: tela montada com atraso (render da SPA) confere após polling', async () => {
            await page.setContent('<div id="app"></div>');
            await page.evaluate((html) => {
                setTimeout(() => { document.getElementById('app').innerHTML = html; }, 2500);
            }, tela('2414072'));
            const r = await conferirPronacNaTela(page, '2414072', { timeoutMs: 6000, intervaloMs: 500, ...silencioso });
            assert.equal(r.via, 'celula');
        });
        await caso('html: sem tabela, fallback pelo texto da página', async () => {
            await page.setContent('<main><h1>Projeto</h1><p>PRONAC: 2414072</p></main>');
            const r = await conferirPronacNaTela(page, '2414072', { timeoutMs: 1500, intervaloMs: 300, ...silencioso });
            assert.equal(r.via, 'pagina');
        });
        await caso('html: listagem ainda no DOM não confere pelo fallback', async () => {
            await page.setContent('<table><tbody><tr><td><a title="Visualizar Projeto" href="#">2414072</a></td></tr></tbody></table>');
            await assert.rejects(conferirPronacNaTela(page, '2414072', { timeoutMs: 1000, intervaloMs: 300, ...silencioso }));
        });
        await caso('html: lerTelaProjeto normaliza espaços da célula', async () => {
            await page.setContent(tela('2414072'));
            const l = await page.evaluate(lerTelaProjeto);
            assert.deepEqual(l.celulas, ['2414072']);
        });

        // URLs falsas servidas pela interceptação — nada sai para a rede.
        const pageLogin = await browser.newPage();
        await pageLogin.setRequestInterception(true);
        pageLogin.on('request', (req) => req.respond({ status: 200, contentType: 'text/html', body: '<p>tela</p>' }));
        await caso('login: página parada em /autenticacao/ lança erro claro com CPF mascarado', async () => {
            await pageLogin.goto('https://salic.invalido/autenticacao/index/index');
            await assert.rejects(exigirSaidaDoLogin(pageLogin, '896***97', 500),
                /Falha no login SALIC: a pagina continuou na tela de login .*896\*\*\*97/);
        });
        await caso('login: página fora de /autenticacao/ segue', async () => {
            await pageLogin.goto('https://salic.invalido/comunicados-proponente/#/home-comunicados-proponente');
            await exigirSaidaDoLogin(pageLogin, '896***97', 500);
        });


        // ── espera do salvamento (tempos curtos; HTML fixo, sem SALIC) ──
        // O aviso é um <div id="aviso"> inserido/removido por timers na página.
        const montarAviso = async (aparecerEm, sumirEm) => {
            await page.setContent('<main><div id="modal">Cadastrar novo comprovante</div></main>');
            await page.evaluate((a, b) => {
                const t = 'Salvando Comprovação Financeira';
                if (a !== null) setTimeout(() => {
                    const d = document.createElement('div'); d.id = 'aviso'; d.textContent = t;
                    document.body.appendChild(d);
                }, a);
                if (b !== null) setTimeout(() => { const d = document.getElementById('aviso'); if (d) d.remove(); }, b);
            }, aparecerEm, sumirEm);
        };

        await caso('salvando: aviso aparece em 0,3s e some em 1,5s -> conclui quando some', async () => {
            await montarAviso(300, 1500);
            const r = await aguardarFimDoSalvamento(page, { timeoutMs: 6000, intervaloMs: 100, graceSemAvisoMs: 800, log: () => { } });
            assert.equal(r.concluido, true);
            assert.equal(r.motivo, 'aviso_sumiu');
            assert.equal(r.avisoVisto, true);
            assert.ok(r.ms >= 1400 && r.ms < 2500, 'concluiu em ' + r.ms + 'ms');
        });
        await caso('salvando: aviso nunca aparece -> conclui pela regra da folga', async () => {
            await montarAviso(null, null);
            const r = await aguardarFimDoSalvamento(page, { timeoutMs: 6000, intervaloMs: 100, graceSemAvisoMs: 600, log: () => { } });
            assert.equal(r.concluido, true);
            assert.equal(r.motivo, 'aviso_nao_apareceu');
            assert.ok(r.ms >= 600 && r.ms < 1500, 'concluiu em ' + r.ms + 'ms');
        });
        await caso('salvando: folga padrao e de 6s (nao espera menos que a espera fixa antiga)', async () => {
            await montarAviso(null, null);
            // so o intervalo e encurtado; a folga fica no padrao (leva ~6s)
            const r = await aguardarFimDoSalvamento(page, { intervaloMs: 250, log: () => { } });
            assert.equal(r.motivo, 'aviso_nao_apareceu');
            assert.ok(r.ms >= 6000 && r.ms < 7000, 'concluiu em ' + r.ms + 'ms');
        });
        await caso('salvando: aviso nunca some -> estoura o prazo e não conclui', async () => {
            await montarAviso(200, null);
            const linhas = [];
            const r = await aguardarFimDoSalvamento(page, { timeoutMs: 1500, intervaloMs: 100, graceSemAvisoMs: 600, log: (m) => linhas.push(m) });
            assert.equal(r.concluido, false);
            assert.equal(r.motivo, 'prazo_esgotado');
            assert.equal(r.avisoVisto, true);
            assert.ok(r.ms >= 1500 && r.ms < 2500, 'estourou em ' + r.ms + 'ms');
            assert.ok(r.trecho.includes('Salvando'), 'trecho do texto visível');
            assert.ok(linhas.some(l => l.includes('url:') && l.includes('texto:')), 'log com url e trecho');
        });
        await caso('salvando: o aviso aparecendo depois da folga ainda é aguardado até sumir', async () => {
            await montarAviso(500, 1200);
            const r = await aguardarFimDoSalvamento(page, { timeoutMs: 6000, intervaloMs: 100, graceSemAvisoMs: 1000, log: () => { } });
            assert.equal(r.motivo, 'aviso_sumiu');
        });
        await caso('salvando: erro de leitura da página não conclui por engano', async () => {
            const falsa = { evaluate: async () => { throw new Error('Execution context was destroyed'); } };
            const r = await aguardarFimDoSalvamento(falsa, { timeoutMs: 600, intervaloMs: 100, graceSemAvisoMs: 200, log: () => { } });
            assert.equal(r.motivo, 'prazo_esgotado');
        });

        // (d) aviso que aparece e some em menos de um ciclo de leitura. Não
        // afirma nada sobre perder ou não: mede a taxa de perda para o relatório.
        {
            let perdidos = 0, vistos = 0; const N = 12;
            for (let k = 0; k < N; k++) {
                await montarAviso(150 + k * 17, 150 + k * 17 + 30);   // 30ms de duração, fase variável
                const r = await aguardarFimDoSalvamento(page, { timeoutMs: 3000, intervaloMs: 200, graceSemAvisoMs: 600, log: () => { } });
                if (r.avisoVisto) vistos++; else perdidos++;
                assert.equal(r.concluido, true);   // nunca trava: cai na regra da folga
            }
            console.log(`info  - aviso de 30ms com leitura a cada 200ms: visto em ${vistos}/${N}, perdido em ${perdidos}/${N} (o robô conclui nos dois casos)`);
        }

        await browser.close();
    }

    console.log(falhas ? `\n${falhas} falha(s)` : '\ntodos os testes passaram');
    process.exit(falhas ? 1 : 0);
})();
