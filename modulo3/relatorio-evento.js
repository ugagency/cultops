// ═══════════════════════════════════════════════════════════════════════
//  relatorio-evento.js — Lógica compartilhada do FORMULÁRIO DE RELATÓRIO
//  do evento (M3). Extraído de evento-detalhe.html para ser reaproveitado
//  também por relatorios.html, sem duplicar a lógica.
//
//  Depende de (fornecidos pela página que inclui este script):
//    - globais mutáveis: `evento` (objeto do evento) e `eventId` (string)
//    - helpers da página : esc(), showToast(), reIcons()
//    - helpers do supabase-helper-m3.js: initSupabase(), updateEvento(),
//      getEvidenciasByEvento(), getSignedUrlsM3()
//    - endpoint backend  : POST /api/m3/relatorio/evento/:id  (geração .docx)
//    - markup            : o bloco #tab-relatorio (mesmos ids em ambas páginas)
//
//  Observação: `atividadesLines` e `publicoPorDiaRows` são declarados com
//  `var` (viram window.*) porque são referenciados por handlers inline
//  (oninput) gerados dinamicamente.
// ═══════════════════════════════════════════════════════════════════════

// ── Estado do relatório ────────────────────────────────
var atividadesLines   = [];

// Listas de links nomeados ({nome,url}) por campo. `state` é preenchido em
// renderRelatorio a partir do evento e lido em salvarRelatorioEvento.
var LINK_LISTS = [
    { key: 'borderos',            container: 'rel-links-borderos-list',       field: 'link_borderos',              state: [] },
    { key: 'execucao',            container: 'rel-links-execucao-list',       field: 'link_fotos_execucao',        state: [] },
    { key: 'acessibilidade',      container: 'rel-links-acessibilidade-list', field: 'link_fotos_acessibilidade',  state: [] },
    { key: 'materiais',           container: 'rel-links-materiais-list',      field: 'link_materiais_comunicacao', state: [] },
];
function linkCfg(key) { return LINK_LISTS.find(c => c.key === key); }

const REL_STATUS_LABEL = { pendente: 'Pendente', preenchido: 'Preenchido', gerado: 'Relatório Gerado' };
const REL_STATUS_CLS   = { pendente: 'badge-gray', preenchido: 'badge-blue', gerado: 'badge-green' };

async function renderRelatorio() {
    renderRelatorioStatusBar();

    const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    setV('rel-horario-desc',              evento.horario_descricao);
    setV('rel-resumo',                    evento.resumo_evento);
    setV('rel-perfil',                    evento.perfil_publico);
    setV('rel-acessibilidade',            evento.acoes_acessibilidade);
    setV('rel-fornecedores',              evento.numero_fornecedores);
    setV('rel-empregos',                  evento.empregos_gerados);
    setV('rel-ambiental',                 evento.acoes_ambientais);
    setV('rel-desafios',                  evento.desafios_evento);
    setV('rel-publico-meta',              evento.publico_meta_texto);

    // Links nomeados: carrega o estado de cada lista a partir do evento (jsonb).
    LINK_LISTS.forEach(cfg => {
        const arr = Array.isArray(evento[cfg.field]) ? evento[cfg.field] : [];
        cfg.state = arr.map(l => ({ nome: l.nome || '', url: l.url || '' }));
        renderLinkList(cfg.key);
    });

    atividadesLines = evento.quantitativo_atividades
        ? evento.quantitativo_atividades.split('\n').filter(l => l.trim())
        : [];
    renderAtividadesList();

    // Todos os links "adicionar evidência" apontam para o evento atual.
    document.querySelectorAll('.rel-add-evidencia').forEach(a => {
        a.href = `evidencias-m3.html?event_id=${eventId}`;
    });
    updateGerarBtnState();

    await loadRelatorioFotos();
}

function renderRelatorioStatusBar() {
    const st  = evento.relatorio_status || 'pendente';
    const bar = document.getElementById('relatorio-status-bar');
    bar.innerHTML = `
        <span class="badge ${REL_STATUS_CLS[st] || 'badge-gray'}">${esc(REL_STATUS_LABEL[st] || st)}</span>
        ${evento.relatorio_evento_file_path
            ? `<a href="#" onclick="baixarRelatorioEvento(); return false;" style="font-size:0.82rem;font-weight:600;color:#1547FF;text-decoration:none;">Baixar último relatório gerado</a>`
            : ''}
    `;
}

function updateGerarBtnState() {
    const st  = evento.relatorio_status || 'pendente';
    const btn = document.getElementById('rel-gerar-btn');
    btn.disabled = !(st === 'preenchido' || st === 'gerado');
}

// ── Quantitativo de atividades ────────────────────────────────
// "Quantitativo de atividades" é texto livre há muito tempo (é o que o
// modelo .docx da Animus espera: uma linha por atividade). Desde que
// distribution_atividades existe como entidade real, com check-in de
// verdade por atividade, esta função busca os dados REAIS (nome, data/hora,
// presentes vs. cadastrados) e gera as linhas prontas — continuam sendo
// texto livre editável depois, só a origem do preenchimento muda.
//
// Não força a relação: se o evento não tem nenhuma distribution_atividades
// cadastrada (ainda é o caso normal para a maioria dos eventos, que usam
// atividade única implícita), a lista de texto livre continua 100% manual,
// exatamente como sempre foi.
async function preencherAtividadesComDadosReais() {
    const btn = document.getElementById('rel-preencher-atividades-btn');
    const setLoading = (loading) => {
        if (!btn) return;
        btn.disabled = loading;
        btn.innerHTML = loading
            ? '<i data-lucide="loader" class="spin" style="width:14px;"></i> Buscando…'
            : '<i data-lucide="refresh-cw" style="width:14px;"></i> Preencher com dados reais';
        reIcons();
    };

    setLoading(true);

    let atividades;
    try {
        atividades = await getAtividadesByEvento(eventId);
    } catch (err) {
        console.error(err);
        showToast('Erro ao buscar dados das atividades: ' + (err.message || ''), 'error');
        setLoading(false);
        return;
    }

    if (!atividades.length) {
        showToast('Nenhuma atividade cadastrada para este evento — cadastre na aba "Atividades" antes de preencher automaticamente.', 'error');
        setLoading(false);
        return;
    }

    // Executa a substituição de fato — extraído porque, quando já há linhas
    // preenchidas, só roda depois de confirmação no modal (ver abaixo).
    const prosseguir = async () => {
        setLoading(true);
        try {
            const guests = await getConvidadosByEvento(eventId);
            const ordenadas = [...atividades].sort((a, b) =>
                (a.data_hora || '9999') < (b.data_hora || '9999') ? -1 : 1);

            const linhas = ordenadas.map(a => {
                const doGrupo   = guests.filter(g => g.atividade_id === a.id);
                const presentes = doGrupo.filter(g => g.checkin_em).length;
                const quando    = a.data_hora ? ' (' + fmtDataHoraAtividade(a.data_hora) + ')' : '';
                return `${a.nome}${quando} — ${presentes} presente(s) de ${doGrupo.length} convidado(s)`;
            });

            const semAtividade = guests.filter(g => !g.atividade_id);
            if (semAtividade.length) {
                const presentes = semAtividade.filter(g => g.checkin_em).length;
                linhas.push(`Sem atividade definida — ${presentes} presente(s) de ${semAtividade.length} convidado(s)`);
            }

            atividadesLines = linhas;
            renderAtividadesList();
            showToast('Quantitativo preenchido com os dados reais das atividades.');
        } catch (err) {
            console.error(err);
            showToast('Erro ao buscar dados das atividades: ' + (err.message || ''), 'error');
        } finally {
            setLoading(false);
        }
    };

    if (atividadesLines.some(l => l.trim())) {
        // Aguardando decisão do usuário no modal — não deixa o botão travado
        // em "Buscando…" enquanto ele decide; volta a desabilitar dentro de
        // prosseguir() se ele confirmar. abrirModalConfirmGenerico() é
        // definida tanto em evento-detalhe.html quanto em relatorios.html
        // (as duas páginas que carregam este arquivo).
        setLoading(false);
        abrirModalConfirmGenerico({
            titulo: 'Substituir quantitativo',
            mensagem: 'Isso substitui as linhas atuais pelos dados reais das atividades cadastradas. Continuar?',
            textoConfirmar: 'Continuar',
            onConfirm: prosseguir
        });
    } else {
        await prosseguir();
    }
}

function fmtDataHoraAtividade(dh) {
    if (!dh) return '';
    try {
        return new Date(dh).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    } catch { return dh; }
}

// ── Quantitativo de atividades (lista dinâmica de linhas de texto) ──
function renderAtividadesList() {
    const wrap = document.getElementById('rel-atividades-list');
    if (!atividadesLines.length) {
        wrap.innerHTML = `<div class="hint">Nenhuma atividade adicionada ainda.</div>`;
        return;
    }
    wrap.innerHTML = atividadesLines.map((line, i) => `
        <div class="rel-dynamic-row">
            <input type="text" value="${esc(line)}" placeholder="Ex: Atividade 1 - Feira Curva"
                   oninput="atividadesLines[${i}] = this.value">
            <button type="button" class="btn-remove" onclick="removeAtividadeLine(${i})" title="Remover">
                <i data-lucide="x" style="width:13px;"></i>
            </button>
        </div>
    `).join('');
    reIcons();
}
function addAtividadeLine() {
    atividadesLines.push('');
    renderAtividadesList();
    const inputs = document.querySelectorAll('#rel-atividades-list input');
    if (inputs.length) inputs[inputs.length - 1].focus();
}
function removeAtividadeLine(i) {
    atividadesLines.splice(i, 1);
    renderAtividadesList();
}

// ── Links nomeados (lista {nome,url} repetível por campo) ────────────────
function renderLinkList(key) {
    const cfg = linkCfg(key);
    if (!cfg) return;
    const wrap = document.getElementById(cfg.container);
    if (!wrap) return;
    if (!cfg.state.length) {
        wrap.innerHTML = `<div class="hint">Nenhum link adicionado.</div>`;
        return;
    }
    wrap.innerHTML = cfg.state.map((l, i) => `
        <div class="rel-link-row">
            <input type="text" value="${esc(l.nome)}" placeholder="Nome do arquivo/link (ex: Borderô_16.05.pdf)"
                   oninput="onLinkInput('${key}', ${i}, 'nome', this.value)">
            <input type="url" value="${esc(l.url)}" placeholder="https://…"
                   oninput="onLinkInput('${key}', ${i}, 'url', this.value)">
            <button type="button" class="btn-remove" onclick="removeLinkRow('${key}', ${i})" title="Remover">
                <i data-lucide="x" style="width:13px;"></i>
            </button>
        </div>
    `).join('');
    reIcons();
}
function onLinkInput(key, i, campo, val) {
    const cfg = linkCfg(key);
    if (cfg && cfg.state[i]) cfg.state[i][campo] = val;
}
function addLinkRow(key) {
    const cfg = linkCfg(key);
    if (!cfg) return;
    cfg.state.push({ nome: '', url: '' });
    renderLinkList(key);
    const inputs = document.querySelectorAll(`#${cfg.container} input`);
    if (inputs.length) inputs[inputs.length - 2]?.focus();
}
function removeLinkRow(key, i) {
    const cfg = linkCfg(key);
    if (!cfg) return;
    cfg.state.splice(i, 1);
    renderLinkList(key);
}

// ── Fotos (somente leitura) — 3 galerias separadas por tipo_evidencia ──
// Mapa: containerId -> tipo_evidencia exibido nele.
const REL_GALERIAS = [
    { grid: 'rel-fotos-execucao',       tipo: 'foto_evento' },
    { grid: 'rel-fotos-acessibilidade', tipo: 'acessibilidade' },
    { grid: 'rel-fotos-comunicacao',    tipo: 'peca_marketing' },
];

async function loadRelatorioFotos() {
    REL_GALERIAS.forEach(g => {
        const el = document.getElementById(g.grid);
        if (el) el.innerHTML = `<div class="empty-state" style="padding:1rem;grid-column:1/-1;"><i data-lucide="loader" class="spin" style="width:20px;"></i></div>`;
    });
    reIcons();
    try {
        const evidencias = await getEvidenciasByEvento(eventId);
        await renderFotosGrid(evidencias);
    } catch (err) {
        REL_GALERIAS.forEach(g => {
            const el = document.getElementById(g.grid);
            if (el) el.innerHTML = `<div class="empty-state" style="color:#FF5807;padding:1rem;grid-column:1/-1;">Erro ao carregar evidências: ${esc(err.message)}</div>`;
        });
    }
}

async function renderFotosGrid(evidencias) {
    // Uma única assinatura de URLs para todas as evidências do evento.
    const paths  = evidencias.map(e => e.file_path).filter(Boolean);
    const urlMap = paths.length ? await getSignedUrlsM3(paths) : {};

    const thumbHtml = (e) => {
        const url     = e.file_path ? urlMap[e.file_path.trim()] : null;
        const isImage = (e.mime_type || '').startsWith('image/');
        return `
            <a href="${url || '#'}" target="_blank" class="rel-foto-thumb" title="${esc(e.descricao || e.file_name || '')}">
                ${url && isImage
                    ? `<img src="${url}" alt="${esc(e.file_name || '')}">`
                    : `<div class="rel-foto-fallback"><i data-lucide="file" style="width:22px;"></i></div>`}
            </a>`;
    };

    REL_GALERIAS.forEach(g => {
        const grid = document.getElementById(g.grid);
        if (!grid) return;
        const lista = evidencias.filter(e => (e.tipo_evidencia || 'outros') === g.tipo);
        grid.innerHTML = lista.length
            ? lista.map(thumbHtml).join('')
            : `<div class="empty-state" style="padding:0.85rem;grid-column:1/-1;font-size:0.8rem;">Nenhuma evidência deste tipo vinculada.</div>`;
    });
    reIcons();
}

// ── Salvar / Gerar ────────────────────────────────────────
async function salvarRelatorioEvento() {
    const btn = document.getElementById('rel-salvar-btn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spin" style="width:15px;"></i> Salvando…';
    reIcons();

    const gv = id => { const el = document.getElementById(id); return el && el.value.trim() ? el.value.trim() : null; };
    // Serializa cada lista de links, descartando linhas totalmente vazias.
    const links = key => {
        const cfg = linkCfg(key);
        return (cfg ? cfg.state : [])
            .map(l => ({ nome: (l.nome || '').trim(), url: (l.url || '').trim() }))
            .filter(l => l.nome || l.url);
    };
    const dados = {
        horario_descricao: gv('rel-horario-desc'),
        resumo_evento: gv('rel-resumo'),
        quantitativo_atividades: atividadesLines.filter(l => l.trim()).join('\n') || null,
        publico_meta_texto: gv('rel-publico-meta'),
        perfil_publico: gv('rel-perfil'),
        acoes_acessibilidade: gv('rel-acessibilidade'),
        numero_fornecedores: gv('rel-fornecedores'),
        empregos_gerados: gv('rel-empregos'),
        acoes_ambientais: gv('rel-ambiental'),
        desafios_evento: gv('rel-desafios'),
        link_borderos: links('borderos'),
        link_fotos_execucao: links('execucao'),
        link_fotos_acessibilidade: links('acessibilidade'),
        link_materiais_comunicacao: links('materiais'),
        relatorio_status: 'preenchido',
    };

    try {
        await updateEvento(eventId, dados);
        evento = { ...evento, ...dados };
        renderRelatorioStatusBar();
        updateGerarBtnState();
        showToast('Relatório do evento salvo!');
    } catch (err) {
        showToast('Erro ao salvar: ' + (err.message || ''), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
        reIcons();
    }
}

async function gerarRelatorioEvento() {
    const btn = document.getElementById('rel-gerar-btn');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spin" style="width:15px;"></i> Gerando…';
    reIcons();

    try {
        // Geração 100% no navegador (sem backend) — ver relatorio-docx.js.
        const result = await gerarDocEventoClient(evento);

        evento.relatorio_status           = 'gerado';
        evento.relatorio_evento_file_path = result.path || evento.relatorio_evento_file_path;
        renderRelatorioStatusBar();
        updateGerarBtnState();
        showToast('Relatório gerado e baixado!');
    } catch (err) {
        showToast('Erro ao gerar relatório: ' + (err.message || ''), 'error');
    } finally {
        btn.innerHTML = original;
        updateGerarBtnState();
        reIcons();
    }
}

async function baixarRelatorioEvento() {
    try {
        const sb = await initSupabase();
        const { data, error } = await sb.storage
            .from('reports')
            .createSignedUrl(evento.relatorio_evento_file_path.trim(), 3600);
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch (err) {
        showToast('Erro ao baixar relatório: ' + (err.message || ''), 'error');
    }
}
