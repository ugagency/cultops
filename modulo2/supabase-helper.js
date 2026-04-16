// modulo2/supabase-helper.js

let supabase = null;

/**
 * Inicializa o cliente Supabase
 */
async function initSupabase() {
    if (supabase) return supabase;

    // CONFIG deve estar disponível globalmente via <script src="../config.js">
    const url = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : null;
    const key = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_KEY : null;

    if (!url || !key) {
        console.error("Configuração do Supabase não encontrada! Verifique ../config.js");
        return null;
    }

    supabase = window.supabase.createClient(url, key);
    return supabase;
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
        return localStorage.getItem('m2_selected_project_id');
    },
    setSelected(id) {
        localStorage.setItem('m2_selected_project_id', id);
        window.dispatchEvent(new CustomEvent('projectChanged', { detail: { id } }));
    }
};

/**
 * Renderiza o Sidebar consistente com o M1 mas incluindo links do M2
 */
function renderSidebar(currentPath) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    
    const navItems = [
        { label: 'Dashboard', icon: 'layout-dashboard', path: '../index.html#dashboard' },
        { label: 'Projetos', icon: 'briefcase', path: '../index.html#projects' },
        { label: 'Contratos', icon: 'file-signature', path: 'contratos.html' },
        { label: 'Rubricas', icon: 'list-checks', path: 'rubricas.html' },
        { label: 'DARF / Impostos', icon: 'landmark', path: 'impostos.html' },
        { label: 'Comprovação Física', icon: 'image', path: 'comprovacao-fisica.html' },
        { label: 'Financeiro M2', icon: 'bar-chart-3', path: 'financeiro.html' },
        { label: 'Prestação de Contas', icon: 'clipboard-check', path: 'prestacao-contas.html' },
        { label: 'Configurações', icon: 'settings', path: '../index.html#configuracoes' },
    ];

    sidebar.innerHTML = `
        <div class="sidebar-logo">
            <i data-lucide="shield-check"></i>
            <span>Prestaí M2</span>
        </div>
        <nav class="sidebar-nav">
            ${navItems.map(item => `
                <a href="${item.path}" class="nav-item ${currentPath.includes(item.path) ? 'active' : ''}">
                    <i data-lucide="${item.icon}"></i>
                    <span>${item.label}</span>
                </a>
            `).join('')}
        </nav>
        <div class="sidebar-footer">
            <a class="nav-item" onclick="handleLogout()" style="color: var(--error);">
                <i data-lucide="log-out"></i>
                <span>Sair</span>
            </a>
        </div>
    `;

    document.body.prepend(sidebar);
    if (window.lucide) window.lucide.createIcons();
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
        .single();

    if (orgUserError || !orgUser) {
        console.error("Erro ao buscar organization_users:", orgUserError);
        return null;
    }

    const { data: org, error: orgError } = await sb
        .from('organizations')
        .select('nome, modulos')
        .eq('id', orgUser.organization_id)
        .single();

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
