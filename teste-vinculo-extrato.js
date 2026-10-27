// Testes das regras do vínculo de extrato a várias notas (vinculo-extrato.js): perfil, organização,
// projeto, nota já vinculada, analista com nota de outro usuário e divergência com e sem
// confirmação. Sem banco e sem rede. Uso: node teste-vinculo-extrato.js
const assert = require('assert');
const V = require('./vinculo-extrato.js');

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const ORG = 'org-1';
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const EXTRATO = { id: 'ext-1', project_id: 'proj-1', organization_id: ORG, status: 'pendente' };
const nota = (extra) => ({
    id: 'n1', name: 'nf.pdf', project_id: 'proj-1', user_id: 'u-gestor', tipo_documento: 'nf',
    status: 'aguardando_conciliacao_bancaria', extrato_origem_id: null, ...extra
});
const gestor = { id: 'u-gestor', role: 'gestor', orgId: ORG };
const analista = { id: 'u-analista', role: 'analista', orgId: ORG };
const avaliar = (n, extra = {}) => V.avaliarNota({ nota: n, orgDaNota: ORG, usuario: gestor, extrato: EXTRATO, incluirDivergencias: false, ...extra });

teste('pedido: só admin, gestor e analista', () => {
    const pedido = (role) => V.validarPedido({ role, orgId: ORG, extratoId: U(1), documentIds: [U(2)] });
    for (const r of ['admin', 'gestor', 'analista']) assert.strictEqual(pedido(r).ok, true, r);
    for (const r of ['fornecedor', 'operador', 'suporte', null, undefined]) {
        const p = pedido(r);
        assert.strictEqual(p.ok, false, String(r));
        assert.strictEqual(p.http, 403);
    }
});

teste('pedido: organização do usuário é obrigatória (vem do JWT, nunca do corpo)', () => {
    const p = V.validarPedido({ role: 'gestor', orgId: null, extratoId: U(1), documentIds: [U(2)] });
    assert.deepStrictEqual([p.ok, p.http], [false, 403]);
});

teste('pedido: extrato e notas obrigatórios, sem repetidos, identificadores válidos e com limite', () => {
    const p = (extra) => V.validarPedido({ role: 'gestor', orgId: ORG, extratoId: U(1), documentIds: [U(2)], ...extra });
    assert.strictEqual(p({ extratoId: '' }).http, 400);
    assert.strictEqual(p({ extratoId: 'ext-1' }).http, 400, 'extrato que não é uuid');
    assert.strictEqual(p({ documentIds: [] }).http, 400);
    assert.strictEqual(p({ documentIds: U(2) }).http, 400);
    assert.strictEqual(p({ documentIds: [null, 1, ' '] }).http, 400);
    assert.strictEqual(p({ documentIds: [U(2), 'nao-e-uuid'] }).http, 400, 'nota que não é uuid');
    const dup = p({ documentIds: [U(2), U(2), ' ' + U(3) + ' '] });
    assert.deepStrictEqual(dup.ids, [U(2), U(3)]);
    assert.strictEqual(dup.extratoId, U(1));
    const muitas = Array.from({ length: V.MAX_NOTAS + 1 }, (_, i) => U(i + 10));
    assert.strictEqual(p({ documentIds: muitas }).http, 400);
    assert.strictEqual(p({ documentIds: muitas.slice(0, V.MAX_NOTAS) }).ok, true);
});

teste('extrato: precisa ser da organização do usuário (pelo projeto e pelo próprio extrato)', () => {
    const v = (extrato, orgDoProjeto) => V.validarExtrato({ extrato, orgDoProjeto, orgId: ORG });
    assert.strictEqual(v(EXTRATO, ORG).ok, true);
    assert.strictEqual(v(null, ORG).http, 404);
    assert.strictEqual(v(EXTRATO, 'org-2').http, 404, 'projeto de outra organização');
    assert.strictEqual(v(EXTRATO, null).http, 404, 'projeto não encontrado');
    assert.strictEqual(v({ ...EXTRATO, organization_id: 'org-2' }, ORG).http, 404, 'extrato marcado com outra organização');
    assert.strictEqual(v({ ...EXTRATO, organization_id: null }, ORG).ok, true, 'extrato antigo sem organization_id vale pelo projeto');
});

teste('extrato com erro de leitura é recusado', () => {
    const r = V.validarExtrato({ extrato: { ...EXTRATO, status: 'erro' }, orgDoProjeto: ORG, orgId: ORG });
    assert.deepStrictEqual([r.ok, r.http], [false, 409]);
    for (const status of ['pendente', 'processado']) {
        assert.strictEqual(V.validarExtrato({ extrato: { ...EXTRATO, status }, orgDoProjeto: ORG, orgId: ORG }).ok, true, status);
    }
});

teste('nota de outra organização ou inexistente: recusada com a mesma mensagem', () => {
    const outraOrg = V.avaliarNota({ nota: nota(), orgDaNota: 'org-2', usuario: gestor, extrato: EXTRATO, incluirDivergencias: false });
    const inexistente = V.avaliarNota({ nota: null, orgDaNota: null, usuario: gestor, extrato: EXTRATO, incluirDivergencias: false });
    assert.strictEqual(outraOrg.resultado, 'recusada');
    assert.strictEqual(inexistente.resultado, 'recusada');
    assert.strictEqual(outraOrg.motivo, inexistente.motivo, 'não revela se a nota existe em outra organização');
    assert.strictEqual(V.avaliarNota({ nota: nota(), orgDaNota: null, usuario: gestor, extrato: EXTRATO, incluirDivergencias: false }).resultado, 'recusada');
});

teste('nota de outro projeto: recusada', () => {
    const r = avaliar(nota({ project_id: 'proj-2' }));
    assert.strictEqual(r.resultado, 'recusada');
    assert.ok(/outro projeto/.test(r.motivo));
    assert.strictEqual(r.atualizar, undefined);
});

teste('analista: só as notas que ele mesmo enviou; gestor e admin: qualquer nota da organização', () => {
    const dele = nota({ user_id: 'u-analista' });
    const deOutro = nota({ user_id: 'u-outro' });
    assert.strictEqual(avaliar(dele, { usuario: analista }).resultado, 'vinculada');
    const recusada = avaliar(deOutro, { usuario: analista });
    assert.strictEqual(recusada.resultado, 'recusada');
    assert.ok(/ele mesmo enviou/.test(recusada.motivo));
    assert.strictEqual(avaliar(deOutro, { usuario: gestor }).resultado, 'vinculada');
    assert.strictEqual(avaliar(deOutro, { usuario: { id: 'u-admin', role: 'admin', orgId: ORG } }).resultado, 'vinculada');
});

teste('nota já vinculada a outro extrato: pulada, com o motivo; ao mesmo extrato: pulada', () => {
    const outro = avaliar(nota({ extrato_origem_id: 'ext-2' }));
    assert.strictEqual(outro.resultado, 'pulada');
    assert.ok(/outro extrato/.test(outro.motivo));
    const mesmo = avaliar(nota({ extrato_origem_id: 'ext-1' }));
    assert.strictEqual(mesmo.resultado, 'pulada');
    assert.ok(/este extrato/.test(mesmo.motivo));
    // outro extrato continua pulado mesmo com a confirmação de divergência
    assert.strictEqual(avaliar(nota({ extrato_origem_id: 'ext-2', status: 'divergencia_valor' }), { incluirDivergencias: true }).resultado, 'pulada');
});

teste('status anteriores à conciliação, e ela própria, são vinculados e ganham só o extrato', () => {
    for (const status of V.STATUS_VINCULAVEIS) {
        const r = avaliar(nota({ status }));
        assert.strictEqual(r.resultado, 'vinculada', status);
        assert.deepStrictEqual(r.atualizar, { extrato_origem_id: 'ext-1' }, 'não mexe no status: ' + status);
    }
});

teste('status que já passou da conciliação ou não pode vincular: recusado, com o motivo', () => {
    for (const status of ['uploaded', 'bloqueado_conformidade', 'aguardando_aprovacao_fornecedor', 'rejeitado_fornecedor',
        'aguardando_d3', 'liberado_rpa_airtop', 'erro_rpa', 'enviado_salic', 'concluido', 'status_desconhecido']) {
        const r = avaliar(nota({ status }));
        assert.strictEqual(r.resultado, 'recusada', status);
        assert.ok(r.motivo.length > 10, status);
        assert.strictEqual(r.atualizar, undefined);
    }
    assert.ok(/já enviada ao SALIC/.test(avaliar(nota({ status: 'enviado_salic' })).motivo));
});

teste('divergência SEM confirmação: pulada e nada é gravado', () => {
    for (const status of V.STATUS_DIVERGENCIA) {
        const r = avaliar(nota({ status }), { incluirDivergencias: false });
        assert.strictEqual(r.resultado, 'pulada', status);
        assert.strictEqual(r.atualizar, undefined);
    }
});

teste('divergência COM confirmação: vincula, volta para a conciliação e limpa o erro', () => {
    for (const status of V.STATUS_DIVERGENCIA) {
        const r = avaliar(nota({ status, just_erro: 'Extrato de outro projeto' }), { incluirDivergencias: true });
        assert.strictEqual(r.resultado, 'vinculada', status);
        assert.deepStrictEqual(r.atualizar, { extrato_origem_id: 'ext-1', status: 'aguardando_conciliacao_bancaria', just_erro: null });
    }
    // divergência já vinculada ao mesmo extrato também pode ser reconferida
    const mesmo = avaliar(nota({ status: 'divergencia_valor', extrato_origem_id: 'ext-1' }), { incluirDivergencias: true });
    assert.strictEqual(mesmo.resultado, 'vinculada');
});

teste('a confirmação de divergência não afeta notas que não estão em divergência', () => {
    const r = avaliar(nota({ status: 'aguardando_conciliacao_bancaria' }), { incluirDivergencias: true });
    assert.deepStrictEqual(r.atualizar, { extrato_origem_id: 'ext-1' });
});

teste('tipo: nf (qualquer subtipo) e sem tipo entram; comprovante e planilha não', () => {
    assert.strictEqual(avaliar(nota({ tipo_documento: 'nf', subtipo_documento: 'guia' })).resultado, 'vinculada');
    assert.strictEqual(avaliar(nota({ tipo_documento: null })).resultado, 'vinculada');
    assert.strictEqual(avaliar(nota({ tipo_documento: undefined })).resultado, 'vinculada');
    for (const tipo of ['comprovante', 'planilha_orcamentaria']) {
        assert.strictEqual(avaliar(nota({ tipo_documento: tipo })).resultado, 'recusada', tipo);
    }
});

teste('lista mista: cada nota recebe o seu resultado', () => {
    const notas = [
        nota({ id: 'a' }),
        nota({ id: 'b', project_id: 'proj-2' }),
        nota({ id: 'c', extrato_origem_id: 'ext-2' }),
        nota({ id: 'd', status: 'divergencia_valor' }),
        nota({ id: 'e', status: 'enviado_salic' }),
        nota({ id: 'f', user_id: 'u-outro' })
    ];
    const resultados = notas.map(n => [n.id, avaliar(n, { usuario: analista, incluirDivergencias: true }).resultado]);
    // analista: só a de u-analista conta; aqui nenhuma nota é dele, então todas recusadas
    assert.ok(resultados.every(([, r]) => r === 'recusada'));
    const comoGestor = notas.map(n => [n.id, avaliar(n, { incluirDivergencias: true }).resultado]);
    assert.deepStrictEqual(comoGestor, [['a', 'vinculada'], ['b', 'recusada'], ['c', 'pulada'], ['d', 'vinculada'], ['e', 'recusada'], ['f', 'vinculada']]);
});

teste('selo: na fila, extrato vinculado, ou nenhum', () => {
    const sel = (status, extrato_origem_id = 'ext-1') => V.situacaoExtrato({ status, extrato_origem_id });
    assert.strictEqual(sel('aguardando_conciliacao_bancaria'), 'fila');
    assert.strictEqual(sel('aguardando_comprovante'), 'fila');
    for (const status of ['processing_ocr', 'aguardando_rubrica', 'revisao_manual', 'aguardando_conformidade', 'bloqueado_conformidade', 'uploaded']) {
        assert.strictEqual(sel(status), 'vinculado', status);
    }
    for (const status of ['divergencia_valor', 'divergencia_beneficiario', 'aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'erro_rpa']) {
        assert.strictEqual(sel(status), null, status + ': já passou da conciliação');
    }
    assert.strictEqual(sel('aguardando_conciliacao_bancaria', null), null, 'sem extrato vinculado não há selo');
    assert.strictEqual(V.situacaoExtrato({ status: 'processing_ocr' }), null);
    assert.strictEqual(V.situacaoExtrato(null), null);
});

// ---- Janela "Vincular extrato" e selo (extraídos do app.js) ----
const fs = require('fs');
const vm = require('vm');

function carregarTelaDoApp() {
    const src = fs.readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
    const recorta = (ini, fim) => {
        const i = src.indexOf(ini);
        const j = src.indexOf(fim, i);
        assert.ok(i >= 0 && j > i, 'trecho não encontrado no app.js: ' + ini);
        return src.slice(i, j);
    };
    const codigo = recorta('function escHtml(', '// "PRODUTO')
        + recorta('function userPodeVincularExtrato', 'window.handleAbrirVincularExtrato')
        + recorta('const VincularExtratoModal', 'window.handleSelectAllDashboardDocs');
    const ctx = {
        window: { VinculoExtrato: V },
        state: {}, getUserRole: () => 'gestor',
        STATUS_MAP: { divergencia_valor: { label: 'Divergência de Valor' }, aguardando_conciliacao_bancaria: { label: 'Falta Conciliação' } },
        fmtValorExtrato: (v) => 'R$ ' + Number(v).toFixed(2),
        fmtDataExtrato: (d) => (d ? String(d) : '---')
    };
    vm.createContext(ctx);
    vm.runInContext(codigo + ';this.modal = VincularExtratoModal; this.selo = seloExtratoHtml; this.podeVincular = userPodeVincularExtrato; this.nomeSeguro = nomeArquivoSeguro;', ctx);
    ctx.codigoBuscar = recorta('window.vincularExtratoBuscar', 'window.vincularExtratoDivergencias');
    return ctx;
}
const TELA = carregarTelaDoApp();
const tagsPermitidas = (html) => (html.match(/<[^>]*>?/g) || []).every(t => /^<\/?(div|p|h3|button|span|label|input|table|thead|tbody|tr|th|td|br|strong)[\s>\/]/.test(t));

teste('janela: só admin, gestor e analista veem o botão', () => {
    const quem = (role) => { TELA.getUserRole = () => role; return TELA.podeVincular(); };
    assert.deepStrictEqual(['admin', 'gestor', 'analista'].map(quem), [true, true, true]);
    assert.deepStrictEqual(['fornecedor', 'operador', null].map(quem), [false, false, false]);
    TELA.getUserRole = () => 'gestor';
});

const notaTela = (extra) => ({ id: 'n1', numero_nf: '123', nome_emissor: 'Fornecedor SA', valor: 100, data_emissao: '2026-09-03', status: 'aguardando_conciliacao_bancaria', extrato_origem_id: null, ...extra });

teste('janela: mostra extratos do projeto, notas selecionadas e deixa o botão desabilitado sem extrato escolhido', () => {
    TELA.state = {
        projects: [{ id: 'p1', pronac: '251234' }], documents: [notaTela(), notaTela({ id: 'n2', numero_nf: '124' })],
        vincularExtrato: { projectId: 'p1', docIds: ['n1', 'n2'], carregando: false, enviando: false, executando: false, extratoId: null, incluirDivergencias: false, resultado: null, erro: null,
            extratos: [{ id: 'e1', file_path: 'p1/uuid/extrato_setembro.ofx', status: 'processado', formato: 'ofx', created_at: '2026-09-05T12:00:00Z' }] }
    };
    const h = TELA.modal();
    assert.ok(h.includes('Vincular extrato a 2 notas'));
    assert.ok(h.includes('extrato_setembro.ofx') && h.includes('Lido') && h.includes('251234'));
    assert.ok(h.includes('Fornecedor SA') && h.includes('123') && h.includes('124'));
    assert.ok(/<button class="btn btn-primary" disabled/.test(h), 'sem extrato escolhido, não vincula');
    TELA.state.vincularExtrato.extratoId = 'e1';
    assert.ok(!/<button class="btn btn-primary" disabled/.test(TELA.modal()), 'com extrato escolhido, vincula');
});

teste('janela: a caixa de confirmação só aparece com notas em divergência, com o texto combinado', () => {
    const base = { projectId: 'p1', docIds: ['n1'], carregando: false, enviando: false, executando: false, extratoId: 'e1', incluirDivergencias: false, resultado: null, erro: null, extratos: [] };
    TELA.state = { projects: [], documents: [notaTela()], vincularExtrato: { ...base } };
    assert.ok(!TELA.modal().includes('reconferidas'));
    TELA.state = { projects: [], documents: [notaTela({ status: 'divergencia_valor' })], vincularExtrato: { ...base } };
    const h = TELA.modal();
    assert.ok(h.includes('Estas notas já foram conferidas e serão reconferidas com o novo extrato.'));
    assert.ok(/<input type="checkbox"\s+onchange/.test(h), 'desmarcada por padrão');
    TELA.state.vincularExtrato.incluirDivergencias = true;
    assert.ok(/type="checkbox" checked/.test(TELA.modal()));
});

teste('janela: resultado nota por nota, com o resumo vindo do servidor', () => {
    TELA.state = {
        projects: [], documents: [notaTela()],
        vincularExtrato: { projectId: 'p1', docIds: ['n1'], extratos: [], resultado: {
            resumo: { vinculadas: 1, puladas: 1, recusadas: 1 },
            itens: [
                { id: 'a', nome: 'a.pdf', resultado: 'vinculada', motivo: 'Vinculada; entra na fila de conciliação.' },
                { id: 'b', nome: 'b.pdf', resultado: 'pulada', motivo: 'Já vinculada a outro extrato.' },
                { id: 'c', nome: 'c.pdf', resultado: 'recusada', motivo: 'Nota de outro projeto: o extrato pertence a outro projeto.' }
            ] } }
    };
    const h = TELA.modal();
    assert.ok(h.includes('1 vinculada, 1 pulada, 1 recusada.'));
    for (const t of ['a.pdf', 'b.pdf', 'c.pdf', 'Vinculada', 'Pulada', 'Recusada', 'Já vinculada a outro extrato.', 'fila']) assert.ok(h.includes(t), t);
});

teste('janela: texto de fora (nome do arquivo, fornecedor, motivo do servidor) não vira HTML', () => {
    const ataque = '<img src=x onerror=alert(1)>';
    TELA.state = {
        projects: [{ id: 'p1', pronac: ataque }], documents: [notaTela({ nome_emissor: ataque, numero_nf: ataque })],
        vincularExtrato: { projectId: 'p1', docIds: ['n1'], carregando: false, enviando: false, executando: false, extratoId: null, incluirDivergencias: false, resultado: null,
            erro: ataque, extratos: [{ id: 'e1', file_path: 'p1/u/' + ataque + '.ofx', status: ataque, formato: 'ofx', created_at: null }] }
    };
    const h = TELA.modal();
    assert.ok(!h.includes('<img') && h.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(tagsPermitidas(h), 'sobrou marcação de fora');
    TELA.state.vincularExtrato.erro = null;
    TELA.state.vincularExtrato.resultado = { resumo: { vinculadas: 0, puladas: 0, recusadas: 1 }, itens: [{ id: 'x', nome: ataque, resultado: 'recusada', motivo: ataque }] };
    const r = TELA.modal();
    assert.ok(!r.includes('<img') && tagsPermitidas(r));
});

teste('janela fechada não renderiza nada', () => {
    TELA.state = { vincularExtrato: null };
    assert.strictEqual(TELA.modal(), '');
});

teste('selo: "Na fila de conciliação" e "Extrato vinculado" conforme a situação; nada nos demais casos', () => {
    assert.ok(TELA.selo({ status: 'aguardando_conciliacao_bancaria', extrato_origem_id: 'e1' }).includes('Na fila de conciliação'));
    assert.ok(TELA.selo({ status: 'aguardando_comprovante', extrato_origem_id: 'e1' }).includes('Na fila de conciliação'));
    assert.ok(TELA.selo({ status: 'processing_ocr', extrato_origem_id: 'e1' }).includes('Extrato vinculado'));
    assert.ok(TELA.selo({ status: 'aguardando_rubrica', extrato_origem_id: 'e1' }).includes('Extrato vinculado'));
    assert.strictEqual(TELA.selo({ status: 'aguardando_conciliacao_bancaria', extrato_origem_id: null }), '');
    assert.strictEqual(TELA.selo({ status: 'aguardando_d3', extrato_origem_id: 'e1' }), '');
    assert.strictEqual(TELA.selo(null), '');
});

teste('nome do arquivo do extrato novo: sem acento nem caracteres que o Storage recusa', () => {
    assert.strictEqual(TELA.nomeSeguro('Extrato Setembro (ação).ofx'), 'Extrato_Setembro__acao_.ofx');
});

// ---- Busca nos extratos já enviados ----
const EXTRATOS_BUSCA = [
    { id: 'e1', file_path: 'p1/uuid/Extrato_Setembro_BB.ofx', status: 'processado', formato: 'ofx', created_at: '2026-09-05T15:00:00Z' },
    { id: 'e2', file_path: 'p1/uuid/agosto.pdf', status: 'pendente', formato: 'pdf', created_at: '2026-08-10T15:00:00Z' },
    { id: 'e3', file_path: 'p1/uuid/Conta Poupança.csv', status: 'erro', formato: 'csv', created_at: '2026-07-01T15:00:00Z' },
    { id: 'e4', file_path: 'u1/extrato_1789000.ofx', status: 'processado', formato: 'ofx', created_at: '2026-09-20T15:00:00Z' }
];
const idsBusca = (b) => V.filtrarExtratos(EXTRATOS_BUSCA, b).map(e => e.id);

teste('busca: texto vazio ou só espaços devolve todos, na mesma ordem; lista ausente não quebra', () => {
    assert.deepStrictEqual(idsBusca(''), ['e1', 'e2', 'e3', 'e4']);
    assert.deepStrictEqual(idsBusca('   '), ['e1', 'e2', 'e3', 'e4']);
    assert.deepStrictEqual(idsBusca(null), ['e1', 'e2', 'e3', 'e4']);
    assert.deepStrictEqual(V.filtrarExtratos(null, 'x'), []);
    assert.deepStrictEqual(V.filtrarExtratos([], 'x'), []);
});

teste('busca: pelo nome do arquivo, sem diferenciar caixa nem acento', () => {
    assert.deepStrictEqual(idsBusca('setembro'), ['e1']);
    assert.deepStrictEqual(idsBusca('SETEMBRO'), ['e1']);
    assert.deepStrictEqual(idsBusca('poupanca'), ['e3'], 'sem acento acha "Poupança"');
    assert.deepStrictEqual(idsBusca('poupança'), ['e3'], 'com acento também');
    assert.deepStrictEqual(idsBusca('bb'), ['e1']);
});

teste('busca: pela data de envio (dd/mm/aaaa, só dia/mês ou mês/ano)', () => {
    assert.deepStrictEqual(idsBusca('05/09/2026'), ['e1']);
    assert.deepStrictEqual(idsBusca('10/08'), ['e2']);
    assert.deepStrictEqual(idsBusca('/09/2026'), ['e1', 'e4']);
    assert.deepStrictEqual(idsBusca('01/07/2026'), ['e3']);
});

teste('busca: pelo status, como aparece na tela e como é gravado', () => {
    assert.deepStrictEqual(idsBusca('aguardando leitura'), ['e2']);
    assert.deepStrictEqual(idsBusca('lido'), ['e1', 'e4']);
    assert.deepStrictEqual(idsBusca('erro de leitura'), ['e3']);
    assert.deepStrictEqual(idsBusca('pendente'), ['e2']);
    assert.deepStrictEqual(idsBusca('processado'), ['e1', 'e4']);
});

teste('busca: pelo formato e combinando palavras (todas precisam aparecer, em qualquer ordem)', () => {
    assert.deepStrictEqual(idsBusca('pdf'), ['e2']);
    assert.deepStrictEqual(idsBusca('ofx'), ['e1', 'e4']);
    assert.deepStrictEqual(idsBusca('ofx setembro'), ['e1']);
    assert.deepStrictEqual(idsBusca('setembro ofx'), ['e1']);
    assert.deepStrictEqual(idsBusca('ofx agosto'), []);
    assert.deepStrictEqual(idsBusca('lido  09/2026'), ['e1', 'e4'], 'espaços repetidos não atrapalham');
});

teste('busca: texto que não existe devolve lista vazia; caracteres de expressão regular são só texto', () => {
    assert.deepStrictEqual(idsBusca('nao existe'), []);
    assert.deepStrictEqual(idsBusca('.*'), []);
    assert.deepStrictEqual(idsBusca('(['), []);
});

teste('busca: extrato sem data ou sem caminho não quebra e continua achável pelo status', () => {
    const esquisito = [{ id: 'x', file_path: null, status: 'pendente', formato: null, created_at: null }];
    assert.deepStrictEqual(V.filtrarExtratos(esquisito, 'aguardando').map(e => e.id), ['x']);
    assert.strictEqual(V.nomeDoArquivo(null), 'extrato');
    assert.strictEqual(V.nomeDoArquivo('a/b/c.ofx'), 'c.ofx');
});

teste('janela: a caixa de busca aparece com extratos e filtra a lista; sem extratos não há caixa', () => {
    const base = { projectId: 'p1', docIds: ['n1'], carregando: false, enviando: false, executando: false, extratoId: null, incluirDivergencias: false, resultado: null, erro: null, busca: '' };
    TELA.state = { projects: [], documents: [notaTela()], vincularExtrato: { ...base, extratos: EXTRATOS_BUSCA } };
    let h = TELA.modal();
    assert.ok(h.includes('id="vincular-extrato-busca"') && h.includes('id="vincular-extrato-lista"'));
    for (const nome of ['Extrato_Setembro_BB.ofx', 'agosto.pdf', 'extrato_1789000.ofx']) assert.ok(h.includes(nome), nome);
    TELA.state.vincularExtrato.busca = 'agosto';
    h = TELA.modal();
    assert.ok(h.includes('agosto.pdf') && !h.includes('Extrato_Setembro_BB.ofx'));
    assert.ok(h.includes('1 de 4 extratos'));
    assert.ok(/id="vincular-extrato-busca"[^>]*value="agosto"/.test(h.replace(/\s+/g, ' ')), 'o texto digitado volta no campo depois de redesenhar');
    TELA.state = { projects: [], documents: [notaTela()], vincularExtrato: { ...base, extratos: [] } };
    assert.ok(!TELA.modal().includes('vincular-extrato-busca'));
});

teste('janela: busca sem resultado diz que nada foi encontrado; o extrato escolhido continua à vista', () => {
    TELA.state = { projects: [], documents: [notaTela()], vincularExtrato: {
        projectId: 'p1', docIds: ['n1'], carregando: false, enviando: false, executando: false, extratoId: 'e1',
        incluirDivergencias: false, resultado: null, erro: null, extratos: EXTRATOS_BUSCA, busca: 'agosto' } };
    let h = TELA.modal();
    assert.ok(!h.includes('Nenhum extrato encontrado'));
    assert.ok(h.includes('Extrato escolhido: Extrato_Setembro_BB.ofx'), 'escolhido fora do filtro continua informado');
    TELA.state.vincularExtrato.busca = 'xyz';
    h = TELA.modal();
    assert.ok(h.includes('Nenhum extrato encontrado para "xyz"'));
    assert.ok(h.includes('0 de 4 extratos'));
    assert.ok(/<button class="btn btn-primary" (?!disabled)/.test(h), 'o botão de vincular continua habilitado com o extrato escolhido');
});

teste('janela: texto digitado na busca e nomes de arquivo não viram HTML', () => {
    const ataque = '<img src=x onerror=alert(1)>';
    TELA.state = { projects: [], documents: [notaTela()], vincularExtrato: {
        projectId: 'p1', docIds: ['n1'], carregando: false, enviando: false, executando: false, extratoId: null,
        incluirDivergencias: false, resultado: null, erro: null, busca: ataque,
        extratos: [{ id: 'e9', file_path: 'p/u/' + ataque + '.ofx', status: 'processado', formato: 'ofx', created_at: null }] } };
    let h = TELA.modal();
    assert.ok(!h.includes('<img'), 'o texto digitado na busca não vira marcação');
    TELA.state.vincularExtrato.busca = '';
    h = TELA.modal();
    assert.ok(!h.includes('<img') && h.includes('&lt;img src=x onerror=alert(1)&gt;.ofx'));
});

teste('janela: digitar na busca atualiza só a lista (sem redesenhar a janela e sem perder o foco)', () => {
    const lista = { innerHTML: '' };
    let renders = 0;
    const ctx = { window: TELA.window, state: { projects: [], documents: [], vincularExtrato: { projectId: 'p1', docIds: [], extratos: EXTRATOS_BUSCA, extratoId: null, busca: '' } },
        document: { getElementById: (id) => (id === 'vincular-extrato-lista' ? lista : null) }, render: () => { renders++; },
        escHtml: TELA.escHtml, nomeDoExtrato: TELA.nomeDoExtrato, extratosVincularListaHtml: TELA.extratosVincularListaHtml };
    vm.createContext(ctx);
    vm.runInContext(TELA.codigoBuscar + ';this.buscar = window.vincularExtratoBuscar;', ctx);
    ctx.buscar('setembro');
    assert.strictEqual(ctx.state.vincularExtrato.busca, 'setembro');
    assert.ok(lista.innerHTML.includes('Extrato_Setembro_BB.ofx') && !lista.innerHTML.includes('agosto.pdf'));
    assert.strictEqual(renders, 0, 'não chama render()');
    ctx.buscar('');
    assert.ok(lista.innerHTML.includes('agosto.pdf'));
});

// ---- Extrato pausado (#127) ----
const PAUSADO = 'ext-pausado';
const PAUSADOS = new Set([PAUSADO]);
const presa = (extra = {}) => nota({ extrato_origem_id: PAUSADO, ...extra });
const ERRO_PRONAC = 'Extrato de outro projeto: PRONAC 1 diferente de 2';

teste('pausado: nota presa ao extrato pausado e revinculada a outro, nao pulada', () => {
    const r = avaliar(presa(), { extratosPausados: PAUSADOS });
    assert.strictEqual(r.resultado, 'vinculada');
    assert.strictEqual(r.motivo, 'Vinculada; substitui o extrato de outro projeto.');
    assert.deepStrictEqual(r.atualizar, { extrato_origem_id: 'ext-1' });
    const emComprovante = avaliar(presa({ status: 'aguardando_comprovante' }), { extratosPausados: PAUSADOS });
    assert.strictEqual(emComprovante.resultado, 'vinculada');
});

teste('pausado: sem o conjunto, ou com outro extrato pausado, a nota continua pulada como hoje', () => {
    for (const extra of [{}, { extratosPausados: null }, { extratosPausados: new Set() }, { extratosPausados: new Set(['outro-extrato']) }]) {
        const r = avaliar(presa(), extra);
        assert.strictEqual(r.resultado, 'pulada');
        assert.strictEqual(r.motivo, 'Já vinculada a outro extrato.');
        assert.strictEqual(r.atualizar, undefined);
    }
    // aceita lista simples tambem
    assert.strictEqual(avaliar(presa(), { extratosPausados: [PAUSADO] }).resultado, 'vinculada');
});

teste('pausado: a nota que disparou a pausa (divergencia) so entra com a confirmacao e volta para a conciliacao', () => {
    for (const status of V.STATUS_DIVERGENCIA) {
        const sem = avaliar(presa({ status, just_erro: ERRO_PRONAC }), { extratosPausados: PAUSADOS });
        assert.strictEqual(sem.resultado, 'pulada', status);
        assert.ok(/divergência/.test(sem.motivo));
        const com = avaliar(presa({ status, just_erro: ERRO_PRONAC }), { extratosPausados: PAUSADOS, incluirDivergencias: true });
        assert.strictEqual(com.resultado, 'vinculada', status);
        assert.strictEqual(com.motivo, 'Vinculada; substitui o extrato de outro projeto.');
        assert.deepStrictEqual(com.atualizar, { extrato_origem_id: 'ext-1', status: 'aguardando_conciliacao_bancaria', just_erro: null });
    }
});

teste('pausado: divergencia presa a um extrato que NAO esta pausado continua pulada ("ja vinculada a outro extrato")', () => {
    const r = avaliar(presa({ status: 'divergencia_beneficiario' }), { extratosPausados: new Set(['outro']), incluirDivergencias: true });
    assert.strictEqual(r.resultado, 'pulada');
    assert.strictEqual(r.motivo, 'Já vinculada a outro extrato.');
});

teste('pausado: status inesperado so entra se o erro for o de extrato de outro projeto e a nota ainda nao passou da conciliacao', () => {
    // status fora de vinculaveis/divergencia, com o erro: tratada como reconferencia (exige confirmacao)
    const sem = avaliar(presa({ status: 'bloqueado_conformidade', just_erro: ERRO_PRONAC }), { extratosPausados: PAUSADOS });
    assert.strictEqual(sem.resultado, 'pulada');
    const com = avaliar(presa({ status: 'bloqueado_conformidade', just_erro: ERRO_PRONAC }), { extratosPausados: PAUSADOS, incluirDivergencias: true });
    assert.strictEqual(com.resultado, 'vinculada');
    assert.deepStrictEqual(com.atualizar, { extrato_origem_id: 'ext-1', status: 'aguardando_conciliacao_bancaria', just_erro: null });
    // sem o erro, o status inesperado continua pulado (extrato de outro) como antes
    assert.strictEqual(avaliar(presa({ status: 'bloqueado_conformidade', just_erro: 'outro erro' }), { extratosPausados: PAUSADOS, incluirDivergencias: true }).resultado, 'pulada');
    // nota que ja passou da conciliacao nunca e revinculada
    for (const status of V.STATUS_ENCERRADOS) {
        const r = avaliar(presa({ status, just_erro: ERRO_PRONAC }), { extratosPausados: PAUSADOS, incluirDivergencias: true });
        assert.strictEqual(r.resultado, 'pulada', status);
    }
});

teste('pausado: as demais regras valem igual (outro projeto, analista, tipo)', () => {
    assert.strictEqual(avaliar(presa({ project_id: 'proj-2' }), { extratosPausados: PAUSADOS }).resultado, 'recusada');
    assert.strictEqual(avaliar(presa({ user_id: 'u-outro' }), { extratosPausados: PAUSADOS, usuario: analista }).resultado, 'recusada');
    assert.strictEqual(avaliar(presa({ tipo_documento: 'comprovante' }), { extratosPausados: PAUSADOS }).resultado, 'recusada');
});

teste('pausado: nota sem extrato entra normalmente; extrato igual ao novo continua "ja vinculada a este extrato"', () => {
    assert.strictEqual(avaliar(nota(), { extratosPausados: PAUSADOS }).motivo, 'Vinculada; entra na fila de conciliação.');
    const mesmo = avaliar(nota({ extrato_origem_id: 'ext-1' }), { extratosPausados: new Set(['ext-1']) });
    assert.strictEqual(mesmo.resultado, 'pulada');
    assert.strictEqual(mesmo.motivo, 'Já vinculada a este extrato.');
});

teste('selo: situacaoExtrato devolve "pausado" so com o conjunto de pausados; sem ele, como antes', () => {
    const sel = (status, pausados) => V.situacaoExtrato({ status, extrato_origem_id: PAUSADO }, pausados);
    assert.strictEqual(sel('aguardando_conciliacao_bancaria'), 'fila');
    assert.strictEqual(sel('aguardando_conciliacao_bancaria', PAUSADOS), 'pausado');
    assert.strictEqual(sel('aguardando_comprovante', PAUSADOS), 'pausado');
    assert.strictEqual(sel('divergencia_beneficiario'), null, 'sem a informacao de pausa o selo e o de sempre');
    assert.strictEqual(sel('divergencia_beneficiario', PAUSADOS), 'pausado');
    assert.strictEqual(sel('aguardando_conciliacao_bancaria', new Set(['outro'])), 'fila');
    assert.strictEqual(sel('liberado_rpa_airtop', PAUSADOS), null, 'nota que ja passou da conciliacao nao e afetada');
    assert.strictEqual(V.situacaoExtrato({ status: 'aguardando_conciliacao_bancaria' }, PAUSADOS), null);
});

teste('pausado: o texto do erro reconhecido aqui e o mesmo da fila (fila-conciliacao.js)', () => {
    const Fila = require('./fila-conciliacao.js');
    for (const t of [ERRO_PRONAC, 'EXTRATO DE OUTRO PROJETO', '  extrato de outro projeto', 'Extrato de outro projéto', 'Divergência: extrato de outro projeto', '', null, undefined, 'Pagamento não localizado']) {
        assert.strictEqual(V.justErroDeExtratoDeOutroProjeto(t), Fila.extratoDeOutroProjeto(t), String(t));
    }
});

teste('consulta de extratos pausados: perfil, organizacao e projeto', () => {
    const c = (extra) => V.validarConsultaPausados({ role: 'gestor', orgId: ORG, projectId: U(10), ...extra });
    for (const r of ['admin', 'gestor', 'analista']) assert.strictEqual(c({ role: r }).ok, true, r);
    for (const r of ['fornecedor', 'operador', null]) assert.deepStrictEqual([c({ role: r }).ok, c({ role: r }).http], [false, 403], String(r));
    assert.strictEqual(c({ orgId: null }).http, 403);
    for (const p of [undefined, '', 'abc', 123, null]) assert.strictEqual(c({ projectId: p }).http, 400, String(p));
    assert.strictEqual(c({ projectId: ' ' + U(10) + ' ' }).projectId, U(10));
});

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
