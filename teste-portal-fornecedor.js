// Teste da ocorrencia #128 do app.js (portal do fornecedor: nota bloqueada por falta de rubrica aparecia
// como "Bloqueado"), sem navegador e sem rede. As funcoes sao recortadas do codigo-fonte do app.js e rodam
// em um contexto isolado. Cobre:
//  - bloqueio por "Rubrica nao informada" (variacoes de travessao, caixa, acento, espacos) vira "Em analise pelo gestor";
//  - bloqueio por outro motivo continua "Bloqueado"; just_erro nulo nao quebra;
//  - status sem regra mantem o rotulo do STATUS_MAP; rejeitada mantem rotulo e quadro do motivo;
//  - o texto de just_erro nao vai para a tela do fornecedor; STATUS_MAP e telas de gestor nao mudam.
// Uso: node teste-portal-fornecedor.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function bloco(fonte, inicio, fecho) {
    const i = fonte.indexOf(inicio);
    assert.ok(i >= 0, 'nao encontrado no app.js: ' + inicio);
    const j = fonte.indexOf(fecho, i);
    assert.ok(j > i, 'fim nao encontrado para: ' + inicio);
    return fonte.slice(i, j + fecho.length);
}
const FIM_WINDOW = '\n};\n';
const FIM_FUNCAO = '\n}\n';
const FIM_CONST = '\n`;\n';

const CODIGO = [
    bloco(SRC, 'const STATUS_MAP = {', FIM_WINDOW),
    bloco(SRC, 'function bloqueioPorRubricaNaoInformada(', FIM_FUNCAO),
    bloco(SRC, 'function rotuloStatusFornecedor(', FIM_FUNCAO),
    bloco(SRC, 'const SolicitanteDashboardView = () => `', FIM_CONST)
].join('\n');

const ctx = {
    state: { documents: [], projects: [], user: { email: 'forn@x.com' } },
    SolicitanteHeader: () => '',
    escAttr: (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    window: {}, console: { log() { }, error() { } }
};
vm.createContext(ctx);
vm.runInContext(CODIGO + '\n;this.rotuloStatusFornecedor = rotuloStatusFornecedor; this.SolicitanteDashboardView = SolicitanteDashboardView; this.STATUS_MAP = STATUS_MAP;', ctx);
const rotulo = (doc) => JSON.parse(JSON.stringify(ctx.rotuloStatusFornecedor(doc)));

const RUBRICA = 'Rubrica não informada — selecione manualmente.';
const EM_ANALISE = { rotulo: 'Em análise pelo gestor', classe: 'status-pending' };

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

teste('bloqueio por rubrica nao informada vira "Em analise pelo gestor" com a classe de pendente', () => {
    assert.deepStrictEqual(rotulo({ status: 'bloqueado_conformidade', just_erro: RUBRICA }), EM_ANALISE);
});

teste('variacoes do travessao, da caixa, do acento e dos espacos', () => {
    for (const texto of [
        'Rubrica não informada - selecione manualmente.',
        'Rubrica não informada – selecione manualmente.',
        'Rubrica não informada — selecione manualmente.',
        'Rubrica não informada',
        'RUBRICA NÃO INFORMADA — SELECIONE MANUALMENTE.',
        'rubrica nao informada - selecione manualmente',
        '  Rubrica não informada — selecione manualmente.  ',
        'Rubrica nao informada—selecione manualmente.'
    ]) {
        assert.deepStrictEqual(rotulo({ status: 'bloqueado_conformidade', just_erro: texto }), EM_ANALISE, JSON.stringify(texto));
    }
});

teste('bloqueio por outro motivo continua "Bloqueado"', () => {
    for (const texto of [
        'CNAE do emissor não é compatível com o objeto do projeto.',
        'CNPJ inválido',
        'Valor divergente. Rubrica não informada acima.',
        'A rubrica não informada foi corrigida',
        '[OVERRIDE] algo',
        ''
    ]) {
        const r = rotulo({ status: 'bloqueado_conformidade', just_erro: texto });
        assert.strictEqual(r.rotulo, 'Bloqueado', JSON.stringify(texto));
        assert.strictEqual(r.classe, ctx.STATUS_MAP.bloqueado_conformidade.class);
    }
});

teste('just_erro nulo, ausente ou documento ausente nao quebram', () => {
    assert.strictEqual(rotulo({ status: 'bloqueado_conformidade', just_erro: null }).rotulo, 'Bloqueado');
    assert.strictEqual(rotulo({ status: 'bloqueado_conformidade' }).rotulo, 'Bloqueado');
    assert.strictEqual(rotulo({ status: 'bloqueado_conformidade', just_erro: 42 }).rotulo, 'Bloqueado');
    assert.doesNotThrow(() => ctx.rotuloStatusFornecedor(null));
    assert.doesNotThrow(() => ctx.rotuloStatusFornecedor({}));
    assert.doesNotThrow(() => ctx.rotuloStatusFornecedor({ is_m2: true }));
});

teste('so bloqueado_conformidade e afetado: o texto da rubrica em outro status nao muda nada', () => {
    const r = rotulo({ status: 'erro_rpa', just_erro: RUBRICA });
    assert.strictEqual(r.rotulo, ctx.STATUS_MAP.erro_rpa.label);
    const v = rotulo({ status: 'validated', just_erro: RUBRICA });
    assert.strictEqual(v.rotulo, ctx.STATUS_MAP.validated.label);
});

teste('aguardando aprovacao continua "Em analise pelo gestor"; rejeitada continua "Rejeitada"', () => {
    assert.deepStrictEqual(rotulo({ status: 'aguardando_aprovacao_fornecedor' }), EM_ANALISE);
    assert.deepStrictEqual(rotulo({ status: 'rejeitado_fornecedor' }), { rotulo: 'Rejeitada', classe: 'status-error' });
});

teste('status sem regra mantem o rotulo e a classe do STATUS_MAP', () => {
    for (const status of Object.keys(ctx.STATUS_MAP)) {
        if (status === 'aguardando_aprovacao_fornecedor') continue;
        const r = rotulo({ status, just_erro: 'qualquer coisa' });
        assert.strictEqual(r.rotulo, ctx.STATUS_MAP[status].label, status);
        assert.strictEqual(r.classe, ctx.STATUS_MAP[status].class, status);
    }
    assert.strictEqual(rotulo({ status: 'status_desconhecido' }).rotulo, 'status_desconhecido');
    assert.strictEqual(rotulo({ status: 'status_desconhecido' }).classe, 'status-pending');
});

teste('evidencias do modulo 2 mantem o comportamento de antes', () => {
    assert.deepStrictEqual(rotulo({ status: 'aprovada', is_m2: true }), { rotulo: 'Aprovada', classe: 'status-success' });
    assert.deepStrictEqual(rotulo({ status: 'reprovada', is_m2: true }), { rotulo: 'Reprovada', classe: 'status-error' });
    assert.deepStrictEqual(rotulo({ status: 'pendente', is_m2: true }), { rotulo: 'Pendente', classe: 'status-pending' });
});

teste('tela do portal: usa o rotulo novo, mantem o quadro do motivo da recusa e nao mostra just_erro', () => {
    const base = { size: '1 MB', projects: { pronac: '123456' }, created_at: '2026-10-01T12:00:00Z' };
    ctx.state.documents = [
        { ...base, id: '1', name: 'nota-rubrica.pdf', status: 'bloqueado_conformidade', just_erro: RUBRICA },
        { ...base, id: '2', name: 'nota-cnae.pdf', status: 'bloqueado_conformidade', just_erro: 'CNAE invalido para o projeto SEGREDO-INTERNO' },
        { ...base, id: '3', name: 'nota-rejeitada.pdf', status: 'rejeitado_fornecedor', motivo_rejeicao_fornecedor: 'Nota ilegivel', just_erro: 'TEXTO-INTERNO-REJ' },
        { ...base, id: '4', name: 'nota-gate.pdf', status: 'aguardando_aprovacao_fornecedor' }
    ];
    const html = ctx.SolicitanteDashboardView();
    const linha = (nome) => html.split('<tr').find(t => t.includes(nome)) || '';
    const badge = (nome) => /<span class="badge ([^"]+)">\s*<span class="badge-dot"><\/span>\s*([^<\n]+?)\s*<\/span>/.exec(linha(nome)).slice(1, 3);
    assert.deepStrictEqual(badge('nota-rubrica.pdf'), ['status-pending', 'Em análise pelo gestor']);
    assert.deepStrictEqual(badge('nota-cnae.pdf'), [ctx.STATUS_MAP.bloqueado_conformidade.class, 'Bloqueado']);
    assert.deepStrictEqual(badge('nota-rejeitada.pdf'), ['status-error', 'Rejeitada']);
    assert.deepStrictEqual(badge('nota-gate.pdf'), ['status-pending', 'Em análise pelo gestor']);
    assert.ok(linha('nota-rejeitada.pdf').includes('Motivo da recusa') && linha('nota-rejeitada.pdf').includes('Nota ilegivel'));
    assert.ok(!linha('nota-rubrica.pdf').includes('Motivo da recusa'));
    for (const proibido of ['Rubrica não informada', 'selecione manualmente', 'SEGREDO-INTERNO', 'TEXTO-INTERNO-REJ']) {
        assert.ok(!html.includes(proibido), 'a tela do fornecedor nao pode mostrar: ' + proibido);
    }
});

teste('o codigo da tela do portal nao le just_erro; a consulta que a alimenta traz a coluna (select *)', () => {
    const tela = bloco(SRC, 'const SolicitanteDashboardView = () => `', FIM_CONST);
    assert.ok(!tela.includes('just_erro'), 'a view do fornecedor nao referencia just_erro');
    const consulta = bloco(SRC, 'async function fetchSolicitanteDashboard()', FIM_FUNCAO);
    assert.ok(/\.from\('documents'\)\s+\.select\('\*, projects\(pronac, nome\)'\)/.test(consulta));
    assert.ok(tela.includes('rotuloStatusFornecedor(doc)'));
});

teste('nada de gestor, admin ou analista muda: STATUS_MAP e telas de gestor iguais as da main', () => {
    let main;
    try {
        main = execFileSync('git', ['show', 'origin/main:app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, '\n');
    } catch (e) {
        console.log('  (origin/main indisponivel; comparacao com a main ignorada)');
        return;
    }
    assert.strictEqual(bloco(SRC, 'const STATUS_MAP = {', FIM_WINDOW), bloco(main, 'const STATUS_MAP = {', FIM_WINDOW));
    for (const [inicio, fim] of [
        ['const DashboardView = () => {', '\n};\n'],
        ['const DetailsView = ', '\n};\n']
    ]) {
        if (SRC.indexOf(inicio) < 0) continue;
        assert.strictEqual(bloco(SRC, inicio, fim), bloco(main, inicio, fim), inicio);
    }
    // o rotulo de status do gestor continua sendo o do STATUS_MAP puro
    assert.ok(!/rotuloStatusFornecedor/.test(bloco(SRC, 'const DashboardView = () => {', '\n};\n')));
    // unico uso da funcao nova fora da propria definicao: a view do portal
    assert.strictEqual(SRC.split('rotuloStatusFornecedor(').length - 1, 2);
});

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
