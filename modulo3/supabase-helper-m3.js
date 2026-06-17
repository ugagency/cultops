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

// ── Sidebar ───────────────────────────────────────────────────

function renderSidebarM3() {
    const existing = document.querySelector('.sidebar');
    if (existing) existing.remove();

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.style.cssText = `
        position: fixed; left: 0; top: 0; height: 100vh;
        width: var(--sidebar-width, 260px);
        background: white;
        border-right: 1px solid var(--glass-border, #e2e8f0);
        padding: 1.5rem;
        display: flex; flex-direction: column; gap: 2rem;
        z-index: 1000;
        box-shadow: 4px 0 24px rgba(0,0,0,0.02);
        overflow-y: auto;
    `;

    const navItems = [
        { label: 'Org. Sociais',    icon: 'users',        path: 'os.html' },
        { label: 'Patrocinadores',  icon: 'building-2',   path: 'pa.html' },
        { label: 'Eventos',         icon: 'calendar',     path: 'eventos.html' },
        { label: 'Distribuição',    icon: 'ticket',       path: null },
        { label: 'Convidados',      icon: 'user-check',   path: 'convidados.html' },
        { label: 'Presenças',       icon: 'clipboard-check', path: null },
    ];

    const currentFile = window.location.pathname.split('/').pop();

    const navHtml = navItems.map(item => {
        const active  = item.path && currentFile === item.path;
        const soon    = !item.path;
        return `
            <a href="${item.path || '#'}" ${soon ? 'onclick="return false"' : ''} style="
                display: flex; align-items: center; gap: 0.75rem;
                padding: 0.75rem 1rem; border-radius: 12px;
                text-decoration: none;
                color: ${active ? '#1547FF' : soon ? '#c0c8d8' : '#64748b'};
                background: ${active ? 'rgba(21,71,255,0.08)' : 'transparent'};
                font-weight: ${active ? '700' : '500'};
                font-size: 0.9rem;
                cursor: ${soon ? 'default' : 'pointer'};
                transition: all 0.2s;
            ">
                <i data-lucide="${item.icon}" style="width:18px;height:18px;flex-shrink:0;"></i>
                <span>${item.label}</span>
                ${soon ? '<span style="margin-left:auto;font-size:0.65rem;background:#f1f5f9;color:#94a3b8;padding:0.1rem 0.45rem;border-radius:999px;font-weight:600;">Em breve</span>' : ''}
            </a>
        `;
    }).join('');

    sidebar.innerHTML = `
        <div style="display:flex;align-items:center;padding-bottom:0.5rem;margin-bottom:0.5rem;">
            <img src="../PAI-Logo-Azul.png" alt="Prestaí" style="height:28px;width:auto;">
        </div>
        <div style="font-size:0.65rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin:-1.5rem 0 -1rem 0.25rem;">
            Módulo III · Distribuição
        </div>
        <nav style="display:flex;flex-direction:column;gap:0.25rem;flex:1;">
            ${navHtml}
        </nav>
        <div style="border-top:1px solid #f1f5f9;padding-top:1.25rem;display:flex;flex-direction:column;gap:0.25rem;">
            <a href="../module-selector.html" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;text-decoration:none;color:#64748b;font-size:0.875rem;font-weight:500;border-radius:12px;transition:all 0.2s;">
                <i data-lucide="arrow-left-right" style="width:16px;"></i>
                <span>Trocar Módulo</span>
            </a>
            <a href="#" onclick="handleLogout(event)" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;text-decoration:none;color:#ef4444;font-size:0.875rem;font-weight:500;border-radius:12px;transition:all 0.2s;">
                <i data-lucide="log-out" style="width:16px;"></i>
                <span>Sair</span>
            </a>
        </div>
    `;

    document.body.prepend(sidebar);

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

// ── Eventos ───────────────────────────────────────────────────

async function getEventosByProject(projectId) {
    const sb = await initSupabase();
    const { data, error } = await sb
        .from('distribution_events')
        .select('*')
        .eq('project_id', projectId)
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
            distribution_event_pa ( *, distribution_pa (*) )
        `)
        .eq('id', id)
        .single();
    if (error) throw error;
    return data;
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
        .select('*, distribution_os(*), distribution_pa(*)')
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
        .select('*, distribution_os(*), distribution_pa(*)')
        .eq('event_id', eventId);
    if (error) throw error;

    return (data || []).filter(g => {
        if (isCpf) {
            return (g.cpf || '').replace(/\D/g, '') === normalTermo;
        }
        return g.nome_completo.toLowerCase().includes(termo.toLowerCase());
    });
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
