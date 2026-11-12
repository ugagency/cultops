// Testes da ocorrencia #184: tela de uma nota em erro_rpa (falha no envio ao SALIC).
//  - Parecer da Analise nao diz so "Aprovado": diz que a conformidade foi aprovada e o envio falhou.
//  - Aviso no alto da tela, com o botao "Tentar Novamente" quando o erro permite.
//  - Quadro "Portal SALIC" ganha o botao nos erros de rubrica no SALIC (antes nao tinha).
//  - O quadro "Continuar por Conta e Risco" continua em erro_rpa (decisao do #184).
// Sem navegador e sem rede: as funcoes sao recortadas do app.js e rodam em um contexto falso.
// Uso: node teste-erro-envio-tela.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ErrosRpa = require('./erros-rpa.js');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function bloco(inicio, fecho) {
    const i = SRC.indexOf(inicio);
    assert.ok(i >= 0, 'nao encontrado no app.js: ' + inicio);
    const j = SRC.indexOf(fecho, i);
    assert.ok(j > i, 'fim nao encontrado para: ' + inicio);
    return SRC.slice(i, j + fecho.length);
}
const FIM_F = '\n}\n';
const CODIGO = [
    bloco('function escHtml(', FIM_F),
    bloco('function parecerErroRpaHtml(', FIM_F),
    bloco('function alertaErroEnvioHtml(', FIM_F),
    bloco('function blocoErroRpaHtml(', FIM_F)
].join('\n');

const ctx = { window: { ErrosRpa }, console };
vm.createContext(ctx);
vm.runInContext(CODIGO + ';this.F = { parecerErroRpaHtml, alertaErroEnvioHtml, blocoErroRpaHtml };', ctx);
const F = ctx.F;

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const JUST_APROVACAO = 'Pagamento localizado no extrato: R$ 27.194,60 em 11/09/2026.';
const ERRO_RUBRICA = '[RUBRICA_NAO_ENCONTRADA_SALIC] Rubrica nao encontrada ou sem link de comprovacao ("sinal de dinheiro"): nenhuma linha com o nome exato';
const doc = (extra = {}) => ({ id: 'n1', status: 'erro_rpa', just_erro: ERRO_RUBRICA, justification: JUST_APROVACAO, ...extra });
const CTX = (extra = {}) => ({ vendoAtual: true, faltaDadoObrigatorioSalic: false, estiloBotaoEnvioBloqueado: '', atributosBotaoEnvioJustificativa: '', robotRodando: false, ...extra });
const temBotaoTentar = (h) => /handleTentarNovamenteErroRpa\('n1'\)/.test(h) && /Tentar Novamente/.test(h);

teste('parecer em erro_rpa: conformidade aprovada, mas o envio falhou, com o texto da aprovacao', () => {
    const h = F.parecerErroRpaHtml(doc());
    assert.ok(h.includes('Conformidade aprovada, mas o envio ao SALIC falhou'), h);
    assert.ok(h.includes(JUST_APROVACAO), h);
    assert.ok(!h.includes('Aprovado</strong>') && !h.includes('✓'), 'nao pode mais dizer so "Aprovado"');
});

teste('parecer em erro_rpa sem texto de aprovacao: so o titulo, sem "undefined" nem "null"', () => {
    for (const j of [null, undefined, '']) {
        const h = F.parecerErroRpaHtml(doc({ justification: j }));
        assert.ok(h.includes('Conformidade aprovada, mas o envio ao SALIC falhou'), h);
        assert.ok(!/undefined|null|<br>/.test(h), h);
    }
});

teste('aviso: erro de rubrica no SALIC mostra o aviso, o titulo do erro e o botao Tentar Novamente', () => {
    const h = F.alertaErroEnvioHtml(doc(), CTX());
    assert.ok(h.includes('id="alerta-erro-envio"') && h.includes('O envio ao SALIC falhou'), h);
    assert.ok(h.includes('Rubrica não localizada na tela do SALIC'), h);
    assert.ok(temBotaoTentar(h), h);
    assert.ok(h.includes('quadro Portal SALIC, logo abaixo'), h);
    assert.ok(!h.includes('Ver detalhes da falha'), 'vendo a etapa atual nao precisa do botao de voltar');
});

teste('aviso: os dois erros de rubrica no SALIC e os que ja permitiam reenvio trazem o botao', () => {
    for (const c of ['RUBRICA_NAO_ENCONTRADA_SALIC', 'RUBRICA_TELA_DIVERGENTE', 'ERRO_RPA_GENERICO', 'TEMPO_ESGOTADO_SALVAMENTO', 'FORNECEDOR_NAO_ENCONTRADO_SALIC']) {
        assert.ok(temBotaoTentar(F.alertaErroEnvioHtml(doc({ just_erro: '[' + c + '] x' }), CTX())), c);
    }
});

teste('aviso: erros em que reenviar nao adianta mostram o aviso, mas sem o botao', () => {
    for (const j of ['[LOGIN_SALIC_RECUSADO] x', '[ARQUIVO_NF_INDISPONIVEL] x', '[RUBRICA_NAO_VINCULADA] x', '[RUBRICA_INEXISTENTE] x', 'Timeout navegando', '', null, '[OVERRIDE] forcou']) {
        const h = F.alertaErroEnvioHtml(doc({ just_erro: j }), CTX());
        assert.ok(h.includes('O envio ao SALIC falhou'), String(j));
        assert.ok(!temBotaoTentar(h), String(j));
    }
});

teste('aviso: fora de erro_rpa e com o robo rodando nao aparece', () => {
    for (const st of ['liberado_rpa_airtop', 'enviado_salic', 'bloqueado_conformidade', 'aguardando_d3', 'concluido']) {
        assert.strictEqual(F.alertaErroEnvioHtml(doc({ status: st }), CTX()), '', st);
    }
    assert.strictEqual(F.alertaErroEnvioHtml(doc(), CTX({ robotRodando: true })), '');
});

teste('aviso: faltando dado obrigatorio nao mostra o botao (o quadro explica o que preencher)', () => {
    const h = F.alertaErroEnvioHtml(doc(), CTX({ faltaDadoObrigatorioSalic: true }));
    assert.ok(h.includes('O envio ao SALIC falhou'));
    assert.ok(!temBotaoTentar(h), h);
});

teste('aviso: justificativa obrigatoria ausente deixa o botao desabilitado, como no quadro', () => {
    const h = F.alertaErroEnvioHtml(doc(), CTX({ estiloBotaoEnvioBloqueado: ' opacity: 0.5; cursor: not-allowed;', atributosBotaoEnvioJustificativa: ' data-exige-justificativa="1" disabled' }));
    assert.ok(temBotaoTentar(h) && /data-exige-justificativa="1" disabled/.test(h) && /cursor: not-allowed/.test(h), h);
});

teste('aviso: vendo outra etapa, orienta voltar e oferece o botao Ver detalhes da falha', () => {
    const h = F.alertaErroEnvioHtml(doc(), CTX({ vendoAtual: false }));
    assert.ok(h.includes('Ver detalhes da falha') && h.includes('verEtapaDetalhe(null)'), h);
    assert.ok(h.includes('Volte para a etapa atual') && !h.includes('logo abaixo'), h);
    assert.ok(temBotaoTentar(h), 'o botao de tentar de novo continua disponivel');
});

teste('aviso: o texto do erro nao entra como HTML (so o titulo do catalogo)', () => {
    const h = F.alertaErroEnvioHtml(doc({ just_erro: '[RUBRICA_NAO_ENCONTRADA_SALIC] <img src=x onerror=alert(1)>' }), CTX());
    assert.ok(!h.includes('<img') && !h.includes('onerror'), h);
});

teste('quadro Portal SALIC: erro de rubrica no SALIC agora tem o botao Tentar Novamente', () => {
    const c = { blocoJustificativaSalic: '', faltaDadoObrigatorioSalic: false, estiloBotaoEnvioBloqueado: '', atributosBotaoEnvioJustificativa: '' };
    for (const cod of ['RUBRICA_NAO_ENCONTRADA_SALIC', 'RUBRICA_TELA_DIVERGENTE']) {
        const h = F.blocoErroRpaHtml(doc({ just_erro: '[' + cod + '] x' }), c);
        assert.ok(temBotaoTentar(h), cod);
        assert.ok(/suporte/i.test(h), cod + ': a orientacao de acionar o suporte continua');
    }
});

teste('quadro Portal SALIC: erros sem reenvio continuam sem o botao', () => {
    const c = { blocoJustificativaSalic: '', faltaDadoObrigatorioSalic: false, estiloBotaoEnvioBloqueado: '', atributosBotaoEnvioJustificativa: '' };
    for (const j of ['[LOGIN_SALIC_RECUSADO] x', '[ARQUIVO_NF_INDISPONIVEL] x', '[RUBRICA_NAO_VINCULADA] x', 'Timeout navegando']) {
        assert.ok(!temBotaoTentar(F.blocoErroRpaHtml(doc({ just_erro: j }), c)), j);
    }
});

teste('quadro Portal SALIC: erro que ja permitia reenvio continua igual', () => {
    const c = { blocoJustificativaSalic: '', faltaDadoObrigatorioSalic: false, estiloBotaoEnvioBloqueado: '', atributosBotaoEnvioJustificativa: '' };
    assert.ok(temBotaoTentar(F.blocoErroRpaHtml(doc({ just_erro: '[ERRO_RPA_GENERICO] x' }), c)));
    const bloqueado = F.blocoErroRpaHtml(doc({ just_erro: '[ERRO_RPA_GENERICO] x' }), { ...c, faltaDadoObrigatorioSalic: true });
    assert.ok(/disabled>Tentar Novamente/.test(bloqueado) && /Preencha os dados obrigat/.test(bloqueado));
});

teste('ligacao na DetailsView: aviso antes dos alertas, parecer por funcao, quadro de conta e risco mantido', () => {
    const tela = bloco('const DetailsView = () => {', '\n};\n');
    assert.ok(tela.includes('alertaErroEnvioHtml(doc,'), 'aviso nao esta ligado na tela');
    assert.ok(tela.indexOf('${blocoAlertaErroEnvio}') > 0 && tela.indexOf('${blocoAlertaErroEnvio}') < tela.indexOf('${blocoAlertas}'), 'aviso deve vir antes dos demais alertas');
    assert.ok(tela.includes("doc.status === 'erro_rpa'\n                ? parecerErroRpaHtml(doc)"), 'parecer nao esta ligado');
    // decisao do #184: o quadro de conta e risco NAO sai em erro_rpa (admin pode seguir por fora do robo)
    assert.ok(tela.includes("doc.status.includes('erro')") && tela.includes('Continuar por Conta e Risco') && tela.includes("window.handleForcarAvanco('${doc.id}', '${doc.status}')"), 'quadro de conta e risco precisa continuar');
    assert.ok(tela.includes('userCanDelete()'), 'continua so para admin');
});

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
