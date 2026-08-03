// modulo2/supabase-helper.js

let sbClient = null;

/**
 * Inicializa o cliente Supabase
 */
async function initSupabase() {
    if (sbClient) return sbClient;

    // CONFIG deve estar disponível globalmente via <script src="../config.js">
    const url = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : null;
    const key = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_KEY : null;

    if (!url || !key) {
        console.error("Configuração do Supabase não encontrada! Verifique ../config.js");
        return null;
    }

    sbClient = window.supabase.createClient(url, key);
    return sbClient;
}

/**
 * Carrega todos os projetos do usuário
 */
async function loadProjects() {
    const sb = await initSupabase();
    const { data: { user } } = await sb.auth.getUser();
    
    if (!user) return [];

    const { data, error } = await sb
        .from('projects')
        .select('*')
        .order('nome');

    if (error) {
        console.error("Erro ao carregar projetos:", error);
        return [];
    }
    return data;
}

/**
 * Gerencia o PRONAC selecionado na sessão
 */
const ProjectManager = {
    getSelected() {
        return localStorage.getItem('prestai_project_id');
    },
    setSelected(id) {
        localStorage.setItem('prestai_project_id', id);
        window.dispatchEvent(new CustomEvent('projectChanged', { detail: { id } }));
    }
};

/**
 * Retorna o ID do projeto atual (não redireciona mais de forma forçada).
 */
function checkProjectSetup() {
    return ProjectManager.getSelected();
}

/**
 * Verifica se o usuário logado tem role permitida para acessar o Módulo 2
 * (admin, gestor, analista). Redireciona e retorna false caso contrário.
 * Deve ser chamada e aguardada (await) no início do DOMContentLoaded de
 * cada página do M2, ANTES de renderSidebar() e de qualquer carregamento
 * de dados — chamar só dentro de renderSidebar() não bloqueia queries que
 * as páginas disparam em paralelo, sem esperar a sidebar terminar.
 */
async function verificarAcessoM2() {
    const sb = await initSupabase();
    if (!sb) return false;

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.href = '../index.html#login';
        return false;
    }

    const role = session.user?.app_metadata?.role || session.user?.user_metadata?.role;
    const rolesPermitidasM2 = ['admin', 'gestor', 'analista'];

    if (!rolesPermitidasM2.includes(role)) {
        console.warn('[M2] Acesso negado para role:', role);
        if (role === 'operador') {
            window.location.href = '../modulo3/eventos.html';
        } else {
            window.location.href = 'sem-acesso.html';
        }
        return false;
    }

    return true;
}

window.verificarAcessoM2 = verificarAcessoM2;

/**
 * Renderiza o Sidebar consistente com o M1 mas incluindo links do M2
 */
async function renderSidebar() {
    // Remove sidebar anterior se existir para evitar duplicação em SPAs/navegação manual
    const existingSidebar = document.querySelector('.sidebar');
    if (existingSidebar) existingSidebar.remove();

    let _role = null;
    try {
        const sb = await initSupabase();
        const { data: { session } } = await sb.auth.getSession();
        _role = session?.user?.app_metadata?.role || session?.user?.user_metadata?.role || null;
    } catch (_) {}

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    // Lista de itens de navegação interna do M2. Equipe, Configurações e
    // Solicitantes são páginas neutras na raiz do repo (fora de M1/M2/M3),
    // sem dono de módulo — restritas a admin/gestor nos 3 módulos (mesma
    // filtragem já usada para esconder itens sensíveis do operador).
    const navItems = [
        { label: 'Dashboard', icon: 'layout-dashboard', path: 'financeiro.html' },
        { label: 'Projetos', icon: 'folder-kanban', path: 'projeto-setup.html' },
        { label: 'Dados do Projeto', icon: 'file-text', path: 'dados-projeto-salic.html' },
        { label: 'Rubricas', icon: 'pie-chart', path: 'rubricas.html' },
        { label: 'Contratos', icon: 'file-text', path: 'contratos.html' },
        { label: 'Impostos', icon: 'landmark', path: 'impostos.html' },
        { label: 'Evidências', icon: 'camera', path: 'comprovacao-fisica.html' },
        { label: 'Prestação de Contas', icon: 'file-check-2', path: 'prestacao-contas.html' },
        { label: 'Exportações', icon: 'download', path: 'exportacoes.html' },
        { label: 'Equipe', icon: 'user-cog', path: '../equipe.html', restrito: true },
        { label: 'Configurações', icon: 'settings', path: '../configuracoes.html', restrito: true },
        { label: 'Solicitantes', icon: 'users', path: '../solicitantes.html', restrito: true },
    ];

    const _filtered = navItems.filter(item => !item.restrito || ['admin', 'gestor'].includes(_role));

    const currentFile = window.location.pathname.split('/').pop();

    sidebar.innerHTML = `
        <div class="sidebar-logo">
            <img class="sidebar-logo-full" src="../PAI-Logo-Azul.png" alt="Prestaí">
            <img class="sidebar-logo-icon" src="../PAI-Icone-Azul.png" alt="Prestaí">
        </div>
        <nav class="sidebar-nav">
            ${_filtered.map(item => {
                const active = currentFile === item.path;
                return `
                    <a href="${item.path}" class="nav-item ${active ? 'active' : ''}">
                        <i data-lucide="${item.icon}"></i>
                        <span>${item.label}</span>
                    </a>
                `;
            }).join('')}
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
            <a href="#" onclick="handleLogout()" class="nav-item" style="color: var(--error);">
                <i data-lucide="log-out"></i>
                <span>Sair</span>
            </a>
        </div>
    `;

    document.body.prepend(sidebar);

    // Preenche os dados do usuário no rodapé (assíncrono, não bloqueia o render).
    // A responsividade (hamburger, overlay, colapso) vem de style.css, igual ao M1.
    (async () => {
        try {
            const sb = await initSupabase();
            if (!sb) return;
            const { data: { session } } = await sb.auth.getSession();
            const user = session?.user;
            if (!user || !user.email) return;
            const role = user.app_metadata?.role || user.user_metadata?.role;
            const labels = { admin: 'Administrador', gestor: 'Gestor', analista: 'Analista', fornecedor: 'Fornecedor' };
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

    // Inicia ícones do Lucide após inserir no DOM
    if (window.lucide) {
        window.lucide.createIcons();
    } else {
        // Fallback caso Lucide ainda esteja carregando
        setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 500);
    }

    // Define handleLogout globalmente se ainda não existir
    if (!window.handleLogout) {
        window.handleLogout = async function(e) {
            if(e) e.preventDefault();
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

/**
 * Utilitário para formatar moeda
 */
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

/**
 * Utilitário para formatar data
 */
function formatDate(dateString) {
    if (!dateString) return '---';
    return new Date(dateString).toLocaleDateString('pt-BR');
}

window.initSupabase = initSupabase;
window.loadProjects = loadProjects;
window.ProjectManager = ProjectManager;
window.checkProjectSetup = checkProjectSetup;
window.renderSidebar = renderSidebar;
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;

/**
 * Busca a organização do usuário e retorna a lista de módulos disponíveis.
 */
async function getUserModules() {
    const sb = await initSupabase();
    const { data: { user } } = await sb.auth.getUser();
    
    if (!user) return null;

    const { data: orgUser, error: orgUserError } = await sb
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

    if (orgUserError) {
        console.error("Erro ao buscar organization_users:", orgUserError);
        return null;
    }
    
    if (!orgUser) {
        // Se o usuário não estiver em nenhuma organização (pode ser um Solicitante ou bug de cadastro)
        return { params: { modulos: [] }, user: user };
    }

    const { data: org, error: orgError } = await sb
        .from('organizations')
        .select('nome, modulos')
        .eq('id', orgUser.organization_id)
        .maybeSingle();

    if (orgError || !org) {
        console.error("Erro ao buscar organizations:", orgError);
        return null;
    }

    return { params: org, user: user };
}

/**
 * Define o módulo ativo e redireciona
 */
function setModuloAtivo(modulo) {
    localStorage.setItem('prestai_modulo_ativo', modulo);
    
    if (modulo === 'modulo_1') {
        window.location.href = '../index.html#dashboard'; // Rota base do M1
    } else if (modulo === 'modulo_2') {
        window.location.href = 'financeiro.html'; // Rota base do M2
    }
}

window.getUserModules = getUserModules;
window.setModuloAtivo = setModuloAtivo;

/**
 * Retorna o organization_id do usuário corrente.
 * Padrão M1 (INV-02): app_metadata.org_id é a fonte de verdade.
 * Fallback: lê projects.organization_id pelo projectId fornecido.
 * Resultado por projectId é cacheado em memória.
 */
const _orgIdCache = { jwt: undefined, byProject: {} };

async function getCurrentOrgId(projectId) {
    const sb = await initSupabase();
    if (!sb) return null;

    if (_orgIdCache.jwt === undefined) {
        try {
            const { data } = await sb.auth.getSession();
            _orgIdCache.jwt = data?.session?.user?.app_metadata?.org_id || null;
        } catch (_) {
            _orgIdCache.jwt = null;
        }
    }
    if (_orgIdCache.jwt) return _orgIdCache.jwt;

    if (!projectId) return null;
    if (_orgIdCache.byProject[projectId] !== undefined) {
        return _orgIdCache.byProject[projectId];
    }

    const { data, error } = await sb
        .from('projects')
        .select('organization_id')
        .eq('id', projectId)
        .maybeSingle();

    const orgId = (!error && data && data.organization_id) || null;
    _orgIdCache.byProject[projectId] = orgId;
    return orgId;
}

window.getCurrentOrgId = getCurrentOrgId;
