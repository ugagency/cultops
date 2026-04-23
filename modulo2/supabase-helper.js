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
 * Renderiza o Sidebar consistente com o M1 mas incluindo links do M2
 */
function renderSidebar() {
    // Remove sidebar anterior se existir para evitar duplicação em SPAs/navegação manual
    const existingSidebar = document.querySelector('.sidebar');
    if (existingSidebar) existingSidebar.remove();

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.style.cssText = `
        position: fixed; 
        left: 0; 
        top: 0; 
        height: 100vh; 
        width: 260px; /* Fallback em caso de falha na variável */
        width: var(--sidebar-width, 260px); 
        background: white; 
        border-right: 1px solid var(--glass-border, #e2e8f0); 
        padding: 1.5rem; 
        display: flex; 
        flex-direction: column; 
        gap: 2rem;
        z-index: 1000;
        box-shadow: 4px 0 24px rgba(0,0,0,0.02);
    `;
    
    // Lista de itens de navegação interna do M2
    const navItems = [
        { label: 'Projetos', icon: 'folder-kanban', path: 'projeto-setup.html' },
        { label: 'Dashboard', icon: 'layout-dashboard', path: 'financeiro.html' },
        { label: 'Rubricas', icon: 'pie-chart', path: 'rubricas.html' },
        { label: 'Contratos', icon: 'file-text', path: 'contratos.html' },
        { label: 'Impostos', icon: 'landmark', path: 'impostos.html' },
        { label: 'Evidências', icon: 'camera', path: 'comprovacao-fisica.html' },
        { label: 'Solicitantes', icon: 'users', path: 'gestao-solicitantes.html' },
        { label: 'Prestação de Contas', icon: 'file-check-2', path: 'prestacao-contas.html' },
        { label: 'Configurações', icon: 'settings', path: 'configuracoes.html' },
    ];

    const currentFile = window.location.pathname.split('/').pop();

    sidebar.innerHTML = `
        <div class="logo" style="display: flex; align-items: center; gap: 0.75rem; font-weight: 800; color: var(--m2-accent); font-size: 1.25rem; padding-bottom: 0.5rem; margin-bottom: 1rem;">
            <i data-lucide="shield-check"></i> 
            <span>PrestAI M2</span>
        </div>
        <nav style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1;">
            ${navItems.map(item => {
                const active = currentFile === item.path;
                return `
                    <a href="${item.path}" class="nav-link ${active ? 'active' : ''}" style="
                        display: flex; 
                        align-items: center; 
                        gap: 0.75rem; 
                        padding: 0.75rem 1rem; 
                        border-radius: 12px; 
                        text-decoration: none; 
                        color: ${active ? 'var(--m2-accent)' : '#64748b'}; 
                        background: ${active ? 'rgba(99, 102, 241, 0.08)' : 'transparent'}; 
                        font-weight: ${active ? '700' : '500'};
                        transition: all 0.2s;
                    ">
                        <i data-lucide="${item.icon}" style="width: 20px; height: 20px;"></i> 
                        <span>${item.label}</span>
                    </a>
                `;
            }).join('')}
        </nav>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
            <a href="../module-selector.html" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; text-decoration: none; color: #64748b; font-size: 0.875rem; font-weight: 500;">
                <i data-lucide="arrow-left-right" style="width: 18px;"></i> 
                <span>Trocar Módulo</span>
            </a>
            <a href="#" onclick="handleLogout()" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; text-decoration: none; color: #ef4444; font-size: 0.875rem; font-weight: 500;">
                <i data-lucide="log-out" style="width: 18px;"></i> 
                <span>Sair</span>
            </a>
        </div>
    `;

    document.body.prepend(sidebar);
    
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
