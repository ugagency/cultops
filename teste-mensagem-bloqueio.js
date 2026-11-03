// Teste do #150b do app.js: a mensagem do bloco "Rubrica Orcamentaria" em bloqueado_conformidade so manda revisar
// a rubrica quando a causa do bloqueio (just_erro; se vazio, justification) fala de CNAE ou rubrica. Sem navegador:
// a funcao e o trecho do template sao recortados do codigo-fonte do app.js.
// Uso: node teste-mensagem-bloqueio.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio);
    assert.ok(i >= 0, 'nao encontrado no app.js: ' + inicio);
    const j = SRC.indexOf(fecho, i);
    assert.ok(j > i, 'fim nao encontrado para: ' + inicio);
    return SRC.slice(i, j + fecho.length);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(bloco('function bloqueioEhDeRubrica(', '\n}\n') + '\n;this.bloqueioEhDeRubrica = bloqueioEhDeRubrica;', ctx);
const ehRubrica = (doc) => ctx.bloqueioEhDeRubrica(doc);

// o paragrafo da mensagem, como a tela o monta, avaliado para um documento
const INI = '<p class="text-xs" style="color: ${doc.status === \'bloqueado_conformidade\'';
const i = SRC.indexOf(INI);
const f = SRC.indexOf('</p>', i);
assert.ok(i > 0 && f > i, 'paragrafo da mensagem nao encontrado');
const paragrafo = vm.runInNewContext('(doc, bloqueioEhDeRubrica) => `' + SRC.slice(i, f + 4) + '`', {});
const msg = (doc) => paragrafo(doc, ctx.bloqueioEhDeRubrica).replace(/<[^>]+>/g, '');

const FRASE_RUBRICA = 'Documento bloqueado por conformidade. Por favor, revise a rubrica vinculada.';
const FRASE_NEUTRA = 'Este documento está bloqueado. Leia o Parecer da Análise ao lado. Se o motivo for a rubrica, corrija o vínculo aqui.';
const B = 'bloqueado_conformidade';

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

teste('texto de CNAE (parecer da IA) e de rubrica: e bloqueio de rubrica', () => {
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'A rubrica não é compatível com o CNAE do emissor.' }), true);
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'Atividade principal (CNAE 5611-2/01) incompatível com o objeto.' }), true);
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'cnae divergente' }), true, 'sem diferenciar caixa');
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'RUBRICA INCOMPATIVEL' }), true, 'sem diferenciar caixa nem acento');
});

teste('textos que o gatilho do banco grava: rubrica nao informada e nao cadastrada', () => {
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'Rubrica não informada — selecione manualmente.' }), true);
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'Rubrica "Hospedagem" não está cadastrada no projeto. Selecione a rubrica correta.' }), true);
});

teste('texto de valor e de beneficiario: nao e bloqueio de rubrica', () => {
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'Valor pago (R$ 9309.05) difere do valor da NF (R$ 9500.00)' }), false);
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'Beneficiário do pagamento difere do emissor da nota.' }), false);
});

teste('vazio, so espacos, null e documento ausente: nao e bloqueio de rubrica', () => {
    assert.strictEqual(ehRubrica({ status: B, just_erro: '' }), false);
    assert.strictEqual(ehRubrica({ status: B, just_erro: '   ' }), false);
    assert.strictEqual(ehRubrica({ status: B, just_erro: null }), false);
    assert.strictEqual(ehRubrica({ status: B }), false);
    assert.strictEqual(ehRubrica({ status: B, just_erro: null, justification: null }), false);
    assert.strictEqual(ehRubrica(null), false);
    assert.strictEqual(ehRubrica(undefined), false);
});

teste('just_erro vazio: a causa vem da justification (caso real do valor pago)', () => {
    const real = { status: B, just_erro: null, justification: 'Valor pago (R$ 9309.05) difere do valor da NF (R$ 9500.00)' };
    assert.strictEqual(ehRubrica(real), false);
    assert.strictEqual(ehRubrica({ status: B, just_erro: '', justification: 'O CNAE do emissor nao atende a rubrica.' }), true);
    assert.strictEqual(ehRubrica({ status: B, just_erro: '  ', justification: 'Rubrica incompativel' }), true);
});

teste('just_erro preenchido manda; a justification nao o sobrescreve', () => {
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'Valor pago difere do valor da NF', justification: 'A rubrica esta correta' }), false);
    assert.strictEqual(ehRubrica({ status: B, just_erro: 'CNAE incompativel', justification: 'Valor pago difere' }), true);
});

teste('mensagem da tela: frase atual para rubrica/CNAE, frase neutra para o resto e sem texto', () => {
    assert.strictEqual(msg({ status: B, just_erro: 'Rubrica não informada — selecione manualmente.' }), FRASE_RUBRICA);
    assert.strictEqual(msg({ status: B, just_erro: 'CNAE incompativel' }), FRASE_RUBRICA);
    assert.strictEqual(msg({ status: B, just_erro: null, justification: 'Valor pago (R$ 9309.05) difere do valor da NF (R$ 9500.00)' }), FRASE_NEUTRA);
    assert.strictEqual(msg({ status: B, just_erro: '' }), FRASE_NEUTRA);
    assert.strictEqual(msg({ status: B, just_erro: null }), FRASE_NEUTRA);
});

teste('tom: o texto neutro nao usa a cor de erro; a frase de rubrica e o erro_rpa mantem', () => {
    const cor = (doc) => /color: ([^;]+);/.exec(paragrafo(doc, ctx.bloqueioEhDeRubrica))[1];
    assert.strictEqual(cor({ status: B, just_erro: null }), 'var(--text-muted)');
    assert.strictEqual(cor({ status: B, just_erro: 'CNAE incompativel' }), 'var(--error)');
    assert.strictEqual(cor({ status: 'erro_rpa', just_erro: 'qualquer coisa' }), 'var(--error)');
});

teste('ramo erro_rpa nao muda: mesma mensagem, qualquer que seja a causa', () => {
    const MSG_RPA = 'O robô não conseguiu usar a rubrica desta nota. Escolha a rubrica correta: a nota volta para a fila de conferência e conciliação e pode esperar o D-3 de novo.';
    assert.strictEqual(msg({ status: 'erro_rpa', just_erro: 'Valor pago difere' }), MSG_RPA);
    assert.strictEqual(msg({ status: 'erro_rpa', just_erro: null }), MSG_RPA);
});

teste('campo e botao Corrigir Vinculo continuam visiveis nos dois casos (mesmo bloco, antes da mensagem)', () => {
    const k = SRC.indexOf("${doc.status === 'bloqueado_conformidade' || (doc.status === 'erro_rpa' && window.ErrosRpa.permiteCorrigirRubrica(doc.just_erro)) ? `");
    assert.ok(k > 0 && k < i, 'condicao do bloco continua so pelo status');
    const trecho = SRC.slice(k, i);
    assert.ok(trecho.includes('id="vincular-rubrica-input"') && trecho.includes('Corrigir Vínculo'));
    assert.ok(!trecho.includes('bloqueioEhDeRubrica'), 'a decisao de rubrica nao esconde campo nem botao');
});

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
