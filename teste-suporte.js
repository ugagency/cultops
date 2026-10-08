// Testes unitários da lógica pura do painel de suporte (SPEC-SUPORTE-03).
// Não toca produção: nenhuma consulta ao banco nem chamada de rede.
// Uso: node teste-suporte.js
const assert = require('assert');
const Catalogo = require('./status-catalogo.js');
const Regras = require('./suporte-regras.js');

// server.js só é carregado para pegar avaliarReprocesso; as variáveis abaixo
// evitam que o createClient falhe e que o servidor abra porta.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:0';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'teste';
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
const { avaliarReprocesso } = require('./server.js').__teste;

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

const AGORA = Date.parse('2026-10-08T12:00:00Z');
const atras = (min) => new Date(AGORA - min * 60000).toISOString();

// ── Catálogo: cada linha do prompt ──────────────────────────────────────────
const ESPERADO_DOCS = {
    processing_ocr: ['Em Processamento', 'em_andamento', 5],
    revisao_manual: ['Revisão Manual', 'erro', null],
    aguardando_conformidade: ['Em Auditoria IA', 'em_andamento', 5],
    bloqueado_conformidade: ['Bloqueado', 'esperando_cliente', null],
    aguardando_conciliacao_bancaria: ['Falta Conciliação', 'esperando_cliente', null],
    aguardando_comprovante: ['Falta Comprovante', 'em_andamento', 5],
    divergencia_valor: ['Divergência de Valor', 'esperando_cliente', null],
    divergencia_beneficiario: ['Divergência de Beneficiário', 'esperando_cliente', null],
    aguardando_d3: ['Em carência (D-3)', 'em_andamento', 5760],
    liberado_rpa_airtop: ['Pronto para envio', 'esperando_cliente', null],
    erro_rpa: ['Erro no Envio', 'erro', null],
    enviado_salic: ['Enviado ao SALIC', 'finalizado', null],
    aguardando_rubrica: ['Aguardando Rubrica', 'esperando_cliente', null],
    aguardando_aprovacao_fornecedor: ['Aguardando aprovação', 'esperando_cliente', null],
    rejeitado_fornecedor: ['Rejeitada', 'finalizado', null],
    concluido: ['Concluído', 'finalizado', null],
    erro: ['Erro', 'erro', null],
    uploaded: ['Enviado', 'em_andamento', 5],
    validating: ['Validando', 'em_andamento', 5],
    validated: ['Validado', 'em_andamento', 5]
};
for (const [status, [rotulo, grupo, prazo]] of Object.entries(ESPERADO_DOCS)) {
    teste(`catálogo documents.${status}`, () => {
        const it = Catalogo.obter('documents', status);
        assert.ok(it, 'faltando');
        assert.strictEqual(it.rotulo, rotulo);
        assert.strictEqual(it.grupo, grupo);
        assert.strictEqual(it.prazo_minutos, prazo);
        assert.ok(it.explicacao && it.proximo_passo, 'explicação e próximo passo');
    });
    teste(`grupoEfetivo documents.${status}`, () => {
        // Dentro do prazo (ou sem prazo): grupo normal.
        assert.strictEqual(Catalogo.grupoEfetivo('documents', status, atras(1), AGORA), grupo);
        if (grupo === 'em_andamento') {
            assert.strictEqual(Catalogo.grupoEfetivo('documents', status, atras(prazo + 1), AGORA), 'travado');
            assert.strictEqual(Catalogo.grupoEfetivo('documents', status, atras(prazo), AGORA), 'em_andamento', 'no limite ainda não é travado');
        } else {
            // Esperando cliente / erro / finalizado nunca viram travado.
            assert.strictEqual(Catalogo.grupoEfetivo('documents', status, atras(100000), AGORA), grupo);
        }
    });
}
teste('catálogo documents não tem status além do prompt', () => {
    assert.deepStrictEqual(Object.keys(Catalogo.CATALOGO.documents).sort(), Object.keys(ESPERADO_DOCS).sort());
});

const ESPERADO_OUTRAS = {
    extratos: { pendente: ['em_andamento', 30], processado: ['finalizado', null], erro: ['erro', null] },
    exportacoes_log: { gerando: ['em_andamento', 60], pronto: ['finalizado', null], erro: ['erro', null] },
    saldo_salic_capturas: { executando: ['em_andamento', 30], sucesso: ['finalizado', null], erro: ['erro', null] },
    physical_evidences: {
        pendente: ['esperando_cliente', null], pendente_complemento: ['esperando_cliente', null],
        aprovada: ['finalizado', null], reprovada: ['finalizado', null], enviada_salic: ['finalizado', null], erro_rpa: ['erro', null]
    },
    project_salic_imports: { pendente: ['em_andamento', 30], processando: ['em_andamento', 30], processado: ['finalizado', null], erro: ['erro', null] }
};
for (const [ent, mapa] of Object.entries(ESPERADO_OUTRAS)) {
    for (const [status, [grupo, prazo]] of Object.entries(mapa)) {
        teste(`catálogo ${ent}.${status}`, () => {
            const it = Catalogo.obter(ent, status);
            assert.ok(it, 'faltando');
            assert.strictEqual(it.grupo, grupo);
            assert.strictEqual(it.prazo_minutos, prazo);
            if (prazo) {
                assert.strictEqual(Catalogo.grupoEfetivo(ent, status, atras(prazo + 1), AGORA), 'travado');
                assert.strictEqual(Catalogo.grupoEfetivo(ent, status, atras(prazo - 1), AGORA), 'em_andamento');
            }
        });
    }
}
teste('grupoEfetivo: sem data não afirma travado; status/entidade desconhecidos', () => {
    assert.strictEqual(Catalogo.grupoEfetivo('documents', 'processing_ocr', null, AGORA), 'em_andamento');
    assert.strictEqual(Catalogo.grupoEfetivo('documents', 'nao_existe', atras(1), AGORA), 'desconhecido');
    assert.strictEqual(Catalogo.grupoEfetivo('tabela_x', 'pendente', atras(1), AGORA), 'desconhecido');
});

// ── Fila: esperando cliente só alerta depois de 7 dias ──────────────────────
teste('classificarParaFila', () => {
    const c = (...a) => Regras.classificarParaFila(...a, AGORA);
    assert.strictEqual(c('documents', 'bloqueado_conformidade', atras(7 * 1440 - 1)), null);
    assert.strictEqual(c('documents', 'bloqueado_conformidade', atras(7 * 1440 + 1)), 'esperando_cliente');
    assert.strictEqual(c('documents', 'revisao_manual', atras(1)), 'erro');
    assert.strictEqual(c('documents', 'processing_ocr', atras(1)), null);
    assert.strictEqual(c('documents', 'processing_ocr', atras(6)), 'travado');
    assert.strictEqual(c('documents', 'aguardando_d3', atras(5761)), 'travado');
    assert.strictEqual(c('documents', 'aguardando_d3', atras(5000)), null);
    assert.strictEqual(c('documents', 'enviado_salic', atras(999999)), null);
});

// ── Regra de avançar: cada linha do mapa e cada bloqueio ────────────────────
teste('avançar: mapa permitido', () => {
    const casos = {
        revisao_manual: 'aguardando_conformidade',
        bloqueado_conformidade: 'aguardando_comprovante',
        divergencia_valor: 'aguardando_d3',
        divergencia_beneficiario: 'aguardando_d3'
    };
    for (const [de, para] of Object.entries(casos)) {
        for (const tipo of [null, undefined, 'nf', 'comprovante']) {
            const r = Regras.regraAvancar({ status: de, tipo_documento: tipo });
            assert.strictEqual(r.habilitada, true, `${de}/${tipo}`);
            assert.strictEqual(r.destino, para);
            assert.ok(r.efeito);
        }
    }
});
teste('avançar: divergência avisa que pula a conferência com o extrato', () => {
    for (const s of ['divergencia_valor', 'divergencia_beneficiario']) {
        assert.match(Regras.regraAvancar({ status: s, tipo_documento: 'nf' }).efeito, /pula a conferência com o extrato/);
    }
});
teste('avançar: erro_rpa e liberado_rpa_airtop nunca (SALIC)', () => {
    for (const s of ['erro_rpa', 'liberado_rpa_airtop']) {
        const r = Regras.regraAvancar({ status: s, tipo_documento: 'nf' });
        assert.strictEqual(r.habilitada, false);
        assert.match(r.motivo_bloqueio, /SALIC/);
        assert.strictEqual(r.destino, null);
    }
});
teste('avançar: qualquer outro status é bloqueado', () => {
    const permitidos = Object.keys(Regras.MAPA_AVANCAR);
    for (const s of Object.keys(Catalogo.CATALOGO.documents).filter(x => !permitidos.includes(x))) {
        const r = Regras.regraAvancar({ status: s, tipo_documento: 'nf' });
        assert.strictEqual(r.habilitada, false, s);
        assert.ok(r.motivo_bloqueio);
    }
});
teste('avançar: tipos fora de nf/comprovante/nulo são bloqueados', () => {
    for (const tipo of ['planilha_orcamentaria', 'guia', 'contrato']) {
        const r = Regras.regraAvancar({ status: 'revisao_manual', tipo_documento: tipo });
        assert.strictEqual(r.habilitada, false, tipo);
    }
});

// ── Revalidar conformidade ──────────────────────────────────────────────────
teste('revalidar: só aguardando_conformidade há mais de 5 min', () => {
    const av = (status, min) => Regras.avaliarRevalidar({ status, updated_at: min == null ? null : atras(min) }, AGORA);
    assert.strictEqual(av('aguardando_conformidade', 6).habilitada, true);
    assert.strictEqual(av('aguardando_conformidade', 5).habilitada, false);
    assert.strictEqual(av('aguardando_conformidade', 1).habilitada, false);
    assert.strictEqual(av('aguardando_conformidade', null).habilitada, false);
    for (const s of Object.keys(Catalogo.CATALOGO.documents).filter(x => x !== 'aguardando_conformidade')) {
        const r = av(s, 600);
        assert.strictEqual(r.habilitada, false, s);
        assert.ok(r.motivo_bloqueio);
    }
});

// ── Refazer conciliação ─────────────────────────────────────────────────────
teste('refazer conciliação: status e extrato processado', () => {
    for (const s of Regras.STATUS_CONCILIACAO) {
        assert.strictEqual(Regras.avaliarRefazerConciliacao({ status: s }, { existeExtratoProcessado: true }).habilitada, true, s);
        const sem = Regras.avaliarRefazerConciliacao({ status: s }, { existeExtratoProcessado: false });
        assert.strictEqual(sem.habilitada, false, s);
        assert.match(sem.motivo_bloqueio, /extrato/i);
    }
    for (const s of Object.keys(Catalogo.CATALOGO.documents).filter(x => !Regras.STATUS_CONCILIACAO.includes(x))) {
        assert.strictEqual(Regras.avaliarRefazerConciliacao({ status: s }, { existeExtratoProcessado: true }).habilitada, false, s);
    }
});

// ── Extratos, exportações, saldo, importação de projeto ─────────────────────
teste('extrato: pendente > 30 min ou erro', () => {
    const av = (status, min, campo = 'updated_at') => Regras.avaliarReprocessarExtrato({ status, [campo]: min == null ? null : atras(min) }, AGORA);
    assert.strictEqual(av('pendente', 31).habilitada, true);
    assert.strictEqual(av('pendente', 30).habilitada, false);
    assert.strictEqual(av('pendente', 5).habilitada, false);
    assert.strictEqual(av('erro', 1).habilitada, true);
    assert.strictEqual(av('processado', 999).habilitada, false);
    const desconhecido = av('pendente', null);
    assert.strictEqual(desconhecido.habilitada, true);
    assert.strictEqual(desconhecido.tempo_desconhecido, true);
    assert.strictEqual(av('pendente', 31, 'created_at').habilitada, true, 'usa created_at se não há updated_at');
});
teste('exportação: gerando > 60 min', () => {
    const av = (status, min) => Regras.avaliarEncerrarExportacao({ status, criado_em: atras(min) }, AGORA);
    assert.strictEqual(av('gerando', 61).habilitada, true);
    assert.strictEqual(av('gerando', 60).habilitada, false);
    assert.strictEqual(av('pronto', 999).habilitada, false);
    assert.strictEqual(av('erro', 999).habilitada, false);
});
teste('recaptura de saldo: sempre bloqueada, com motivo', () => {
    assert.strictEqual(Regras.avaliarRecapturaSaldo({ status: 'erro' }).habilitada, false);
    assert.match(Regras.avaliarRecapturaSaldo({ status: 'erro' }).motivo_bloqueio, /credencial/);
    assert.strictEqual(Regras.avaliarRecapturaSaldo({ status: 'sucesso' }).habilitada, false);
    assert.strictEqual(Regras.avaliarRecapturaSaldo(undefined).habilitada, false);
});
teste('reimportar projeto SALIC: só última em erro com arquivo', () => {
    assert.strictEqual(Regras.avaliarReimportarProjetoSalic({ status: 'erro', file_path: 'a.pdf' }).habilitada, true);
    assert.strictEqual(Regras.avaliarReimportarProjetoSalic({ status: 'processado', file_path: 'a.pdf' }).habilitada, false);
    assert.strictEqual(Regras.avaliarReimportarProjetoSalic({ status: 'erro', file_path: null }).habilitada, false);
    assert.strictEqual(Regras.avaliarReimportarProjetoSalic(null).habilitada, false);
});

// ── Motivo e tradução ───────────────────────────────────────────────────────
teste('motivo: mínimo de 10 caracteres', () => {
    assert.strictEqual(Regras.validarMotivo('123456789').ok, false);
    assert.strictEqual(Regras.validarMotivo('         x         ').ok, false, 'espaços não contam');
    assert.strictEqual(Regras.validarMotivo('1234567890').ok, true);
    assert.strictEqual(Regras.validarMotivo(undefined).ok, false);
    assert.strictEqual(Regras.validarMotivo(12345678901).ok, false);
    assert.strictEqual(Regras.validarMotivo('  ocorrência 123  ').motivo, 'ocorrência 123');
});
teste('exigirMotivo (middleware): 400 sem motivo, passa com motivo', () => {
    const { exigirMotivo } = require('./server.js').__teste;
    let status = null, corpo = null, seguiu = false;
    const res = { status(c) { status = c; return this; }, json(b) { corpo = b; return this; } };
    exigirMotivo({ body: { motivo: 'curto' } }, res, () => { seguiu = true; });
    assert.strictEqual(status, 400);
    assert.strictEqual(seguiu, false);
    const req = { body: { motivo: 'ocorrência 4821' } };
    exigirMotivo(req, res, () => { seguiu = true; });
    assert.strictEqual(seguiu, true);
    assert.strictEqual(req.motivo, 'ocorrência 4821');
});
teste('tradução de causas do SALIC preserva o original', () => {
    const casos = [
        'Link do PRONAC nao encontrado na tabela.',
        'Nao encontrei o link "Avaliacao de Resultados" na sidebar (#sidebar-vue).',
        'Protocol error (Target.setAutoAttach): Target closed',
        'Waiting for selector `input[aria-label="Proponentes"]` failed: Waiting failed: 15000ms exceeded',
        'This operation was aborted'
    ];
    for (const c of casos) {
        const t = Regras.traduzirCausaSalic(c);
        assert.strictEqual(t.detalhe_tecnico, c);
        assert.ok(t.causa && !/sem tradução/.test(t.causa), c);
    }
    assert.deepStrictEqual(Regras.traduzirCausaSalic(null), { causa: null, detalhe_tecnico: null });
    assert.match(Regras.traduzirCausaSalic('xyz inesperado').causa, /sem tradução/);
});

// ── avaliarReprocesso (patch de reprocessamento por tipo) ───────────────────
// avaliarReprocesso usa Date.now(): estes casos precisam de datas relativas ao relógio real.
const atrasReal = (min) => new Date(Date.now() - min * 60000).toISOString();
const SEM_CTX = { temDespesa: false, planilhaMaisRecentePorProjeto: {} };
const nf = (status, extra = {}) => ({ id: 'd1', tipo_documento: 'nf', status, project_id: 'p1', updated_at: atrasReal(60), ...extra });
teste('avaliarReprocesso: NF/comprovante/legado vão ao OCR de NF', () => {
    for (const tipo of ['nf', 'comprovante', null]) {
        const r = avaliarReprocesso(nf('revisao_manual', { tipo_documento: tipo }), SEM_CTX);
        assert.strictEqual(r.permitido, true);
        assert.strictEqual(r.esteira, 'ocr_nf');
    }
});
teste('avaliarReprocesso: bloqueios', () => {
    // em processamento há menos de 5 min
    assert.strictEqual(avaliarReprocesso(nf('processing_ocr', { updated_at: atrasReal(2) }), SEM_CTX).permitido, false);
    assert.strictEqual(avaliarReprocesso(nf('processing_ocr', { updated_at: atrasReal(6) }), SEM_CTX).permitido, true);
    // liberado, enviado, concluído
    for (const s of ['liberado_rpa_airtop', 'enviado_salic', 'concluido']) {
        const r = avaliarReprocesso(nf(s), SEM_CTX);
        assert.strictEqual(r.permitido, false, s);
        assert.ok(r.motivo);
    }
    // já gerou despesa
    assert.strictEqual(avaliarReprocesso(nf('revisao_manual'), { ...SEM_CTX, temDespesa: true }).permitido, false);
    // tipo desconhecido
    assert.strictEqual(avaliarReprocesso(nf('revisao_manual', { tipo_documento: 'guia' }), SEM_CTX).permitido, false);
});
teste('avaliarReprocesso: planilha só a mais recente do projeto', () => {
    const pl = (id, extra = {}) => ({ id, tipo_documento: 'planilha_orcamentaria', status: 'erro', project_id: 'p1', updated_at: atrasReal(60), ...extra });
    const ctx = { temDespesa: false, planilhaMaisRecentePorProjeto: { p1: 'nova' } };
    const nova = avaliarReprocesso(pl('nova'), ctx);
    assert.strictEqual(nova.permitido, true);
    assert.strictEqual(nova.esteira, 'importacao_rubricas');
    assert.strictEqual(avaliarReprocesso(pl('velha'), ctx).permitido, false);
    assert.strictEqual(avaliarReprocesso(pl('nova', { project_id: null }), ctx).permitido, false);
});

console.log(`\n${ok} testes passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
