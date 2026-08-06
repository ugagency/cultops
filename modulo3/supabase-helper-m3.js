// modulo3/supabase-helper-m3.js

let sbClient = null;

async function initSupabase() {
    if (sbClient) return sbClient;
    const url = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : null;
    const key = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_KEY : null;
    if (!url || !key) {
        console.error('Configuração do Supabase não encontrada! Verifique ../config.js');
        return null;
    }
    sbClient = window.supabase.createClient(url, key);
    return sbClient;
}

// ── Guard de acesso: organização precisa ter o modulo_3 ───────
// Menu escondido ≠ página protegida (mesmo padrão do verificarAcessoM2):
// sem este guard, qualquer usuário de org sem M3 acessa as páginas por URL.

async function verificarAcessoM3() {
    const sb = await initSupabase();
    if (!sb) return false;

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.href = '../index.html#login';
        return false;
    }

    // Troca de senha obrigatória do primeiro acesso — o M1 tranca na tela de
    // nova senha; sem este guard o M3 seria acessível por link direto.
    if (session.user?.app_metadata?.must_change_password === true) {
        window.location.href = '../index.html';
        return false;
    }

    const orgId = session.user?.app_metadata?.org_id;
    if (!orgId) {
        window.location.href = '../module-selector.html';
        return false;
    }

    const { data: org, error } = await sb
        .from('organizations')
        .select('modulos')
        .eq('id', orgId)
        .maybeSingle();

    if (error || !org || !(org.modulos || []).includes('modulo_3')) {
        console.warn('[M3] Organização sem acesso ao Módulo 3');
        window.location.href = '../module-selector.html';
        return false;
    }

    return true;
}

window.verificarAcessoM3 = verificarAcessoM3;

// ── Sidebar ───────────────────────────────────────────────────

async function renderSidebarM3() {
    const existing = document.querySelector('.sidebar');
    if (existing) existing.remove();

    let _role = null;
    try {
        const _sb = await initSupabase();
        const { data: { session: _s } } = await _sb.auth.getSession();
        _role = _s?.user?.app_metadata?.role || _s?.user?.user_metadata?.role || null;
    } catch (_) {}

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    const navItems = [
        // Dashboard primeiro — mesmo padrão do M1/M2
        { label: 'Dashboard',       icon: 'layout-dashboard', path: 'contrapartidas.html' },
        { label: 'Org. Sociais',    icon: 'users',        path: 'os.html' },
        { label: 'Patrocinadores',  icon: 'building-2',   path: 'pa.html' },
        { label: 'Eventos',         icon: 'calendar',     path: 'eventos.html' },
        { label: 'Relatórios',      icon: 'file-text',    path: 'relatorios.html' },
        // Equipe, Configurações e Solicitantes são páginas neutras na raiz
        // do repo (fora de M1/M2/M3), sem dono de módulo — restritas a
        // admin/gestor nos 3 módulos (mesma filtragem já usada para esconder
        // itens sensíveis do operador).
        { label: 'Equipe',          icon: 'user-cog',     path: '../equipe.html', restrito: true },
        { label: 'Configurações',   icon: 'settings',     path: '../configuracoes.html', restrito: true },
        { label: 'Solicitantes',    icon: 'users',        path: '../solicitantes.html', restrito: true },
        // App separado/instalável — abre em nova aba (blank), fora da navegação normal.
        // Portaria não tem item próprio: é sempre por evento, acessada pelo botão
        // "Portaria" de cada card em eventos.html (portaria.html?event_id=X).
        { label: 'Campo (PWA)',     icon: 'smartphone',   path: 'pwa/index.html', blank: true },
    ];

    const _filtered = navItems.filter(item => {
        if (_role === 'operador' && ['os.html', 'pa.html'].includes(item.path)) return false;
        if (item.restrito && !['admin', 'gestor'].includes(_role)) return false;
        return true;
    });

    const currentFile = window.location.pathname.split('/').pop();

    const navHtml = _filtered.map(item => {
        const active  = item.path && currentFile === item.path;
        const soon    = !item.path;
        const attrs   = soon ? 'onclick="return false"'
                      : item.blank ? 'target="_blank" rel="noopener"'
                      : 'data-path="' + item.path + '"';
        return `
            <a href="${item.path || '#'}" ${attrs} class="nav-item ${active ? 'active' : ''}"
               ${soon ? 'style="color:#c0c8d8;cursor:default;"' : ''}>
                <i data-lucide="${item.icon}"></i>
                <span>${item.label}</span>
                ${soon ? '<span style="margin-left:auto;font-size:0.65rem;background:#f1f5f9;color:var(--text-muted);padding:0.1rem 0.45rem;border-radius:999px;font-weight:600;">Em breve</span>' : ''}
            </a>
        `;
    }).join('');

    sidebar.innerHTML = `
        <div class="sidebar-logo">
            <img class="sidebar-logo-full" src="../PAI-Logo-Azul.png" alt="Prestaí">
            <img class="sidebar-logo-icon" src="../PAI-Icone-Azul.png" alt="Prestaí">
        </div>
        <div style="font-size:0.65rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;margin:-0.75rem 0 0.5rem 0.75rem;">
            Módulo III · Distribuição
        </div>
        <nav class="sidebar-nav">
            ${navHtml}
        </nav>
        <div class="sidebar-footer">
            <div class="sidebar-user">
                <div class="sidebar-avatar">A</div>
                <div style="overflow: hidden;">
                    <p class="sidebar-user-name" style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; text-overflow: ellipsis;"></p>
                    <p class="sidebar-user-role" style="font-size: 11px; color: var(--text-secondary);"></p>
                </div>
            </div>
            <a href="../module-selector.html" class="nav-item" style="color: var(--primary);">
                <i data-lucide="grid-2x2"></i>
                <span>Trocar Módulo</span>
            </a>
            <a href="#" onclick="handleLogout(event)" class="nav-item" style="color: var(--error);">
                <i data-lucide="log-out"></i>
                <span>Sair</span>
            </a>
        </div>
    `;

    document.body.prepend(sidebar);

    sidebar.querySelectorAll('a[data-path]').forEach(function(el) {
        el.addEventListener('click', function(e) {
            e.preventDefault();
            window.location.href = el.dataset.path;
        });
    });

    // Preenche os dados do usuário no rodapé (assíncrono, não bloqueia o render).
    // A responsividade (hamburger, overlay, colapso) vem de style.css, igual ao M1/M2.
    (async () => {
        try {
            const sb = await initSupabase();
            if (!sb) return;
            const { data: { session } } = await sb.auth.getSession();
            const user = session?.user;
            if (!user || !user.email) return;
            const role = user.app_metadata?.role || user.user_metadata?.role;
            const labels = { admin: 'Administrador', gestor: 'Gestor', analista: 'Analista', operador: 'Operador', fornecedor: 'Fornecedor' };
            const avatarEl = sidebar.querySelector('.sidebar-avatar');
            const nameEl = sidebar.querySelector('.sidebar-user-name');
            const roleEl = sidebar.querySelector('.sidebar-user-role');
            if (avatarEl) avatarEl.textContent = user.email[0].toUpperCase();
            if (nameEl) nameEl.textContent = user.email.split('@')[0];
            if (roleEl) roleEl.textContent = labels[role] || 'Gestor';
        } catch (_) {}
    })();

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('sidebar-open');
        overlay.classList.remove('active');
    });
    document.body.appendChild(overlay);

    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger-btn';
    hamburger.setAttribute('aria-label', 'Abrir menu');
    hamburger.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('sidebar-open');
        overlay.classList.toggle('active');
    });
    document.body.appendChild(hamburger);
    // ──────────────────────────────────────────────────────────

    if (window.lucide) window.lucide.createIcons();
    else setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 500);

    if (!window.handleLogout) {
        window.handleLogout = async function (e) {
            if (e) e.preventDefault();
            const config = window.CONFIG;
            if (window.supabase && config) {
                const sb = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
                await sb.auth.signOut();
            }
            localStorage.removeItem('prestai_modulo_ativo');
            window.location.href = '../index.html#login';
        };
    }
}

// ── org_id helper ─────────────────────────────────────────────

const _orgCache = { value: undefined };

async function getCurrentOrgIdM3() {
    if (_orgCache.value !== undefined) return _orgCache.value;
    const sb = await initSupabase();
    if (!sb) return null;
    try {
        const { data } = await sb.auth.getSession();
        _orgCache.value = data?.session?.user?.app_metadata?.org_id || null;
    } catch (_) {
        _orgCache.value = null;
    }
    return _orgCache.value;
}

// ── Organizações Sociais ──────────────────────────────────────

async function getOrganizacoesSociais(busca = '') {
    const sb = await initSupabase();
    let query = sb.from('distribution_os').select('*').order('nome');
    if (busca.trim()) query = query.ilike('nome', `%${busca.trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function createOrganizacaoSocial(dados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data, error } = await sb
        .from('distribution_os')
        .insert({ ...dados, organization_id: org })
        .select();
    if (error) throw error;
    return data[0];
}

async function updateOrganizacaoSocial(id, dados) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_os')
        .update(dados)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
}

async function deleteOrganizacaoSocial(id) {
    const sb = await initSupabase();
    const { error } = await sb.from('distribution_os').delete().eq('id', id);
    if (error) throw error;
}

// Filtra OS no raio de 30 km usando Haversine (equivalente ao distancia_km do banco)
function _haversineKm(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getOsProximas(eventLat, eventLon) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_os')
        .select('*')
        .not('lat', 'is', null)
        .not('lon', 'is', null)
        .order('nome');
    if (error) throw error;
    return (data || []).filter(os =>
        _haversineKm(Number(eventLat), Number(eventLon), Number(os.lat), Number(os.lon)) <= 30
    );
}

// ── Patrocinadores ────────────────────────────────────────────

async function getPatrocinadores(busca = '') {
    const sb = await initSupabase();
    let query = sb.from('distribution_pa').select('*').order('nome');
    if (busca.trim()) query = query.ilike('nome', `%${busca.trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function createPatrocinador(dados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data, error } = await sb
        .from('distribution_pa')
        .insert({ ...dados, organization_id: org })
        .select();
    if (error) throw error;
    return data[0];
}

async function updatePatrocinador(id, dados) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_pa')
        .update(dados)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
}

async function deletePatrocinador(id) {
    const sb = await initSupabase();
    const { error } = await sb.from('distribution_pa').delete().eq('id', id);
    if (error) throw error;
}

// ── ProjectManagerM3 ─────────────────────────────────────────
// Usa a mesma chave do M2 para compatibilidade de navegação entre módulos

const ProjectManagerM3 = {
    getSelected() { return localStorage.getItem('prestai_project_id'); },
    setSelected(id) {
        localStorage.setItem('prestai_project_id', id);
        window.dispatchEvent(new CustomEvent('projectChanged', { detail: { id } }));
    }
};

/**
 * Lista os projetos acessíveis ao usuário logado, para popular o seletor
 * de PRONAC no header das páginas do M3 (RLS já escopa por organização).
 */
async function getProjectsM3() {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('projects')
        .select('id, pronac, nome')
        .order('nome', { ascending: true });
    if (error) throw error;
    return data || [];
}

window.getProjectsM3 = getProjectsM3;

// ── Eventos ───────────────────────────────────────────────────

async function getEventosByProject(projectId) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_events')
        .select('*')
        .eq('project_id', projectId)
        .is('excluido_em', null)
        .order('data_evento', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function createEvento(dados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const pid = ProjectManagerM3.getSelected();
    const { data, error } = await sb
        .from('distribution_events')
        .insert({ ...dados, organization_id: org, project_id: pid })
        .select();
    if (error) throw error;
    return data[0];
}

async function updateEvento(id, dados) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_events')
        .update(dados)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
}

async function getEventoDetalhe(id) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_events')
        .select(`
            *,
            distribution_event_os ( *, distribution_os (*) ),
            distribution_event_pa ( *, distribution_pa (*) ),
            distribution_atividades ( * )
        `)
        .eq('id', id)
        .is('excluido_em', null)
        .maybeSingle();
    if (error) throw error;
    // null = não existe OU foi excluído (soft delete) — caller redireciona.
    return data;
}

// ── Atividades (sessões dentro de um evento) ─────────────────
// Criação/edição SÓ por admin/gestor — a RLS de distribution_atividades
// bloqueia operador de verdade; a UI apenas espelha isso.

async function getAtividadesByEvento(eventId) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_atividades')
        .select('*')
        .eq('event_id', eventId)
        .order('data_hora', { ascending: true, nullsFirst: false })
        .order('nome', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function createAtividade(eventId, nome, dataHora) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
        .from('distribution_atividades')
        .insert({
            event_id: eventId,
            organization_id: org,
            nome,
            data_hora: dataHora || null,
            criado_por: user?.id || null
        })
        .select();
    if (error) throw error;
    return data[0];
}

async function deleteAtividade(id) {
    // Convidados vinculados NÃO são apagados: atividade_id é ON DELETE SET
    // NULL — eles voltam ao estado "sem atividade".
    const sb = await initSupabase();
    const { error } = await sb
        .from('distribution_atividades')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// ── Exclusão (soft) de evento ────────────────────────────────

async function getContagensExclusaoEvento(eventId) {
    const sb = await initSupabase();
    const [convidados, presentes, atividades] = await Promise.all([
        sb.from('distribution_guests')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventId),
        sb.from('distribution_guests')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventId)
            .not('checkin_em', 'is', null),
        sb.from('distribution_atividades')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventId),
    ]);
    return {
        convidados: convidados.count || 0,
        presentes:  presentes.count  || 0,
        atividades: atividades.count || 0,
    };
}

async function excluirEvento(eventId) {
    // Sempre via endpoint server-side (soft delete + requireRole gestor/admin).
    // A RLS de distribution_events é só por org — um update direto do client
    // não teria como barrar operador.
    const sb = await initSupabase();
    const { data: { session } } = await sb.auth.getSession();
    const resp = await fetch(`/api/m3/eventos/${eventId}/excluir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || 'Falha ao excluir evento.');
    return json;
}

// ── OS links ──────────────────────────────────────────────────

async function vincularOs(eventId, osId, ingressosAlocados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data, error } = await sb
        .from('distribution_event_os')
        .insert({ event_id: eventId, os_id: osId, ingressos_alocados: ingressosAlocados, organization_id: org })
        .select();
    if (error) throw error;
    return data[0];
}

async function desvincularOs(eventId, osId) {
    const sb = await initSupabase();
    const { error } = await sb
        .from('distribution_event_os')
        .delete()
        .eq('event_id', eventId)
        .eq('os_id', osId);
    if (error) throw error;
}

async function atualizarStatusOs(eventId, osId, novoStatus) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_event_os')
        .update({ status: novoStatus })
        .eq('event_id', eventId)
        .eq('os_id', osId)
        .select();
    if (error) throw error;
    return data[0];
}

// ── PA links ──────────────────────────────────────────────────

async function vincularPa(eventId, paId, ingressosAlocados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data, error } = await sb
        .from('distribution_event_pa')
        .insert({ event_id: eventId, pa_id: paId, ingressos_alocados: ingressosAlocados, organization_id: org })
        .select();
    if (error) throw error;
    return data[0];
}

async function desvincularPa(eventId, paId) {
    const sb = await initSupabase();
    const { error } = await sb
        .from('distribution_event_pa')
        .delete()
        .eq('event_id', eventId)
        .eq('pa_id', paId);
    if (error) throw error;
}

async function atualizarStatusPa(eventId, paId, novoStatus) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_event_pa')
        .update({ status: novoStatus })
        .eq('event_id', eventId)
        .eq('pa_id', paId)
        .select();
    if (error) throw error;
    return data[0];
}

// ── Convidados ────────────────────────────────────────

async function getConvidadosByEvento(eventId) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_guests')
        .select('*, distribution_os(*), distribution_pa(*), distribution_atividades(nome)')
        .eq('event_id', eventId)
        .order('nome_completo');
    if (error) throw error;
    return data || [];
}

async function addConvidado(dados) {
    if (dados.cpf && !dados.lgpd_consent) throw new Error('CPF_SEM_LGPD');
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const row = {
        ...dados,
        cpf:             dados.cpf ? dados.cpf.replace(/\D/g, '') || null : null,
        lgpd_consent_at: dados.lgpd_consent ? new Date().toISOString() : null,
        organization_id: org,
        // A CHECK distribution_guests_tipo_consistente exige coerência entre
        // tipo_entrada e os_id/pa_id; sem isto o DEFAULT 'publico_geral'
        // violava a constraint (23514) em qualquer insert com OS/PA vinculado.
        tipo_entrada: dados.os_id ? 'os' : dados.pa_id ? 'pa' : 'publico_geral',
    };
    const { data, error } = await sb
        .from('distribution_guests')
        .insert(row)
        .select();
    if (error) throw error;
    return data[0];
}

async function removeConvidado(id) {
    const sb = await initSupabase();
    const { error } = await sb.from('distribution_guests').delete().eq('id', id);
    if (error) throw error;
}

async function buscarConvidadoPortaria(eventId, termo) {
    const sb = await initSupabase();
    const normalTermo = termo.replace(/[\.\-\s]/g, '');
    const isCpf = /^\d{11}$/.test(normalTermo);

    const { data, error } = await sb
        .from('distribution_guests')
        .select('*, distribution_os(*), distribution_pa(*), distribution_atividades(nome)')
        .eq('event_id', eventId);
    if (error) throw error;

    return (data || []).filter(g => {
        if (isCpf) {
            return (g.cpf || '').replace(/\D/g, '') === normalTermo;
        }
        return g.nome_completo.toLowerCase().includes(termo.toLowerCase());
    });
}

async function getEvidenciasByEvento(eventId) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('physical_evidences')
        .select('*, rubricas(nome), distribution_events(titulo)')
        .eq('distribution_event_id', eventId)
        .order('criado_em', { ascending: false });
    if (error) throw error;
    return data || [];
}

function formatCurrency(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function getSignedUrlsM3(paths) {
    const sb = await initSupabase();
    const clean = paths.filter(Boolean).map(p => p.trim());
    if (!clean.length) return {};
    const { data, error } = await sb.storage.from('physical-evidences').createSignedUrls(clean, 3600);
    if (error) throw error;
    const map = {};
    (data || []).forEach(item => { if (item.signedUrl) map[item.path] = item.signedUrl; });
    return map;
}

async function createEvidencia(dados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
        .from('physical_evidences')
        .insert({
            ...dados,
            organization_id:   org,
            enviado_por:       user.id,
            status_validacao:  'pendente',
        })
        .select();
    if (error) throw error;
    return data[0];
}

async function getAttendanceByEvento(eventId) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_attendance')
        .select('*')
        .eq('event_id', eventId)
        .order('uploaded_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function createAttendance(dados) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
        .from('distribution_attendance')
        .insert({ ...dados, organization_id: org, uploaded_by: user.id })
        .select();
    if (error) throw error;
    return data[0];
}

async function encerrarEvento(eventId) {
    const sb = await initSupabase();
    const { data: { session } } = await sb.auth.getSession();
    const token = session.access_token;
    const r = await fetch('/api/m3/eventos/' + eventId + '/encerrar', {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Erro ao encerrar evento');
    return json;
}

async function getKpisM3(projectId) {
    const sb  = await initSupabase();
    const org = await getCurrentOrgIdM3();

    const [
        { count: eventosAtivos },
        { count: totalOs },
        { count: totalPa },
        { data: vincOs },
        { data: vincPa },
        { data: eventosAtivosData },
        { count: evidenciasPendentes },
        { data: eventosAtivosDataPa },
    ] = await Promise.all([
        sb.from('distribution_events').select('id', { count: 'exact', head: true })
            .eq('project_id', projectId).eq('status', 'ativo')
            .is('excluido_em', null),
        sb.from('distribution_os').select('id', { count: 'exact', head: true })
            .eq('organization_id', org),
        sb.from('distribution_pa').select('id', { count: 'exact', head: true })
            .eq('organization_id', org),
        // Nos joins !inner o filtro no embed remove a linha pai — é assim que
        // eventos soft-deletados saem de todos os KPIs abaixo.
        sb.from('distribution_event_os')
            .select('status, distribution_events!inner(project_id)')
            .eq('distribution_events.project_id', projectId)
            .is('distribution_events.excluido_em', null)
            .eq('status', 'confirmado'),
        sb.from('distribution_event_pa')
            .select('status, distribution_events!inner(project_id)')
            .eq('distribution_events.project_id', projectId)
            .is('distribution_events.excluido_em', null)
            .eq('status', 'confirmado'),
        sb.from('distribution_event_os')
            .select('ingressos_alocados, distribution_events!inner(project_id, status, ingressos_os)')
            .eq('distribution_events.project_id', projectId)
            .is('distribution_events.excluido_em', null)
            .eq('distribution_events.status', 'ativo'),
        sb.from('physical_evidences')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('status_validacao', 'pendente')
            .not('distribution_event_id', 'is', null),
        sb.from('distribution_event_pa')
            .select('ingressos_alocados, distribution_events!inner(project_id, status, ingressos_pa)')
            .eq('distribution_events.project_id', projectId)
            .is('distribution_events.excluido_em', null)
            .eq('distribution_events.status', 'ativo'),
    ]);

    // Público geral (ingressos vendidos): contador SEPARADO da cota OS/PA —
    // presentes de fato (checkin_em preenchido), somados nos eventos do projeto.
    const { count: publicoGeral } = await sb
        .from('distribution_guests')
        .select('id, distribution_events!inner(project_id)', { count: 'exact', head: true })
        .eq('distribution_events.project_id', projectId)
        .is('distribution_events.excluido_em', null)
        .eq('tipo_entrada', 'publico_geral')
        .not('checkin_em', 'is', null);

    const confirmados = (vincOs?.length || 0) + (vincPa?.length || 0);

    let ocupacaoOsPct = 0;
    let ocupacaoPaPct = 0;
    if (eventosAtivosData?.length) {
        const totalAlocOs = eventosAtivosData.reduce((s, v) => s + (v.ingressos_alocados || 0), 0);
        const totalCapOs  = eventosAtivosData.reduce((s, v) => s + (v.distribution_events?.ingressos_os || 0), 0);
        if (totalCapOs > 0) ocupacaoOsPct = Math.round(totalAlocOs / totalCapOs * 100);
    }
    if (eventosAtivosDataPa?.length) {
        const totalAlocPa = eventosAtivosDataPa.reduce((s, v) => s + (v.ingressos_alocados || 0), 0);
        const totalCapPa  = eventosAtivosDataPa.reduce((s, v) => s + (v.distribution_events?.ingressos_pa || 0), 0);
        if (totalCapPa > 0) ocupacaoPaPct = Math.round(totalAlocPa / totalCapPa * 100);
    }

    return {
        eventosAtivos:        eventosAtivos || 0,
        totalOs:              totalOs || 0,
        totalPa:              totalPa || 0,
        confirmados,
        ocupacaoOsPct,
        ocupacaoPaPct,
        evidenciasPendentes:  evidenciasPendentes || 0,
        publicoGeral:         publicoGeral || 0,
    };
}

// ── Exports ───────────────────────────────────────────────────

window.initSupabase            = window.initSupabase || initSupabase;
window.renderSidebarM3         = renderSidebarM3;
window.getCurrentOrgIdM3       = getCurrentOrgIdM3;
window.ProjectManagerM3        = ProjectManagerM3;
window.getOrganizacoesSociais  = getOrganizacoesSociais;
window.createOrganizacaoSocial = createOrganizacaoSocial;
window.updateOrganizacaoSocial = updateOrganizacaoSocial;
window.deleteOrganizacaoSocial = deleteOrganizacaoSocial;
window.getOsProximas           = getOsProximas;
window.getPatrocinadores       = getPatrocinadores;
window.createPatrocinador      = createPatrocinador;
window.updatePatrocinador      = updatePatrocinador;
window.deletePatrocinador      = deletePatrocinador;
window.getEventosByProject     = getEventosByProject;
window.createEvento            = createEvento;
window.updateEvento            = updateEvento;
window.getEventoDetalhe        = getEventoDetalhe;
window.vincularOs              = vincularOs;
window.desvincularOs           = desvincularOs;
window.atualizarStatusOs       = atualizarStatusOs;
window.vincularPa              = vincularPa;
window.desvincularPa           = desvincularPa;
window.atualizarStatusPa       = atualizarStatusPa;
window.getConvidadosByEvento   = getConvidadosByEvento;
window.addConvidado            = addConvidado;
window.removeConvidado         = removeConvidado;
window.buscarConvidadoPortaria = buscarConvidadoPortaria;
window.getEvidenciasByEvento   = getEvidenciasByEvento;
window.getSignedUrlsM3         = getSignedUrlsM3;
window.formatCurrency          = formatCurrency;
window.createEvidencia         = createEvidencia;
window.getAttendanceByEvento   = getAttendanceByEvento;
window.createAttendance        = createAttendance;
window.encerrarEvento          = encerrarEvento;
window.getKpisM3               = getKpisM3;
window.getAtividadesByEvento   = getAtividadesByEvento;
window.createAtividade         = createAtividade;
window.deleteAtividade         = deleteAtividade;
window.getContagensExclusaoEvento = getContagensExclusaoEvento;
window.excluirEvento           = excluirEvento;
