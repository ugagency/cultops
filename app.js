// --- Supabase Configuração ---
const supabaseUrl = CONFIG.SUPABASE_URL;
const supabaseKey = CONFIG.SUPABASE_KEY;
const supabaseClient = (window.supabase) ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

const app = document.getElementById('app');

const state = {
    currentView: 'login', // 'login' or 'register'
    user: null,
    projects: [],
    documents: [],
    loading: false
};

const STATUS_MAP = {
    'uploaded': { label: 'Enviado', class: 'status-pending' },
    'processing_ocr': { label: 'Extraindo IA', class: 'status-pending' },
    'validated': { label: 'Validado', class: 'status-completed' },
    'bloqueado_conformidade': { label: 'Bloqueado', class: 'status-error' },
    'aguardando_d3': { label: 'D+3 Aguardando', class: 'status-pending' },
    'enviado_salic': { label: 'Enviado SALIC', class: 'status-completed' },
    'erro_rpa': { label: 'Erro RPA', class: 'status-error' },
    'concluido': { label: 'Concluído', class: 'status-completed' }
};

// --- Templates ---

const Header = () => `
<header class="header">
    <div class="logo">
        <i data-lucide="shield-check"></i>
        <span>CultOps</span>
    </div>
    <nav class="navbar">
        <a class="nav-link ${state.currentView === 'dashboard' ? 'active' : ''}" onclick="window.navigate('dashboard')">Dashboard</a>
        <a class="nav-link ${state.currentView === 'upload' ? 'active' : ''}" onclick="window.navigate('upload')">Upload</a>
        <a class="nav-link" href="#">Configurações</a>
        <a class="nav-link" href="#">Admin</a>
    </nav>
    <div style="display: flex; align-items: center; gap: 1rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; font-weight: 500;">
            <i data-lucide="user-circle"></i>
            <span>${state.user ? state.user.email.split('@')[0] : 'Admin'}</span>
        </div>
        <button class="btn btn-ghost" onclick="window.handleLogout()">
            <i data-lucide="log-out"></i>
            Sair
        </button>
    </div>
</header>
`;

const LoginView = () => `
<div class="login-view view-content">
    <div class="card login-card">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem;">
                <i data-lucide="shield-check" style="width: 32px; height: 32px;"></i>
                <span>CultOps</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Acesse sua conta</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleLogin();">
            <div class="form-group">
                <label for="email">E-mail</label>
                <input type="email" id="login-email" placeholder="seu@email.com" required>
            </div>
            
            <div class="form-group">
                <label for="password">Senha</label>
                <input type="password" id="login-password" placeholder="••••••••" required>
            </div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; font-size: 0.75rem;">
                <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0; cursor: pointer;">
                    <input type="checkbox"> Lembrar-me
                </label>
                <a href="#" style="color: var(--primary); font-weight: 500;">Esqueceu a senha?</a>
            </div>
            
            <button class="btn btn-primary" id="login-btn" style="width: 100%;" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Entrando...' : 'Entrar na Plataforma'}
            </button>
        </form>
        
        <div class="login-footer">
            <p>Não tem uma conta? <a href="#" onclick="window.navigate('register')" style="color: var(--primary); font-weight: 600;">Crie uma agora</a></p>
            <a href="#" style="display: flex; align-items: center; justify-content: center; gap: 0.25rem; margin-top: 1rem;">
                <i data-lucide="arrow-left" style="width: 14px;"></i>
                Voltar ao site
            </a>
        </div>
    </div>
</div>
`;

const RegisterView = () => `
<div class="login-view view-content">
    <div class="card login-card">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem;">
                <i data-lucide="shield-check" style="width: 32px; height: 32px;"></i>
                <span>CultOps</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Crie sua conta gratuita</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleRegister();">
            <div class="form-group">
                <label for="reg-email">E-mail</label>
                <input type="email" id="reg-email" placeholder="seu@email.com" required>
            </div>
            
            <div class="form-group">
                <label for="reg-password">Senha</label>
                <input type="password" id="reg-password" placeholder="••••••••" required minlength="6">
            </div>

            <div class="form-group">
                <label for="reg-password-confirm">Confirmar Senha</label>
                <input type="password" id="reg-password-confirm" placeholder="••••••••" required minlength="6">
            </div>
            
            <button class="btn btn-primary" id="register-btn" style="width: 100%;" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Criando conta...' : 'Cadastrar'}
            </button>
        </form>
        
        <div class="login-footer">
            <p>Já tem uma conta? <a href="#" onclick="window.navigate('login')" style="color: var(--primary); font-weight: 600;">Faça login</a></p>
        </div>
    </div>
</div>
`;

const DashboardView = () => `
${Header()}
<main class="dashboard-view view-content">
    <div class="container">
        <div class="dashboard-header">
            <h1 style="font-size: 1.5rem;">Dashboard</h1>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Bem-vindo, ${state.user ? state.user.email : ''}</p>
        </div>
        
        <div class="metrics-grid">
            <div class="card metric-card">
                <p class="metric-label">Total de Documentos</p>
                <div class="metric-value">
                    ${state.documents.length}
                    <i data-lucide="file-text" style="color: var(--primary); opacity: 0.2;"></i>
                </div>
            </div>
            <div class="card metric-card">
                <p class="metric-label">Pendentes</p>
                <div class="metric-value">
                    ${state.documents.filter(d => d.status === 'pendente' || d.status === 'uploaded').length}
                    <i data-lucide="clock" style="color: var(--pending); opacity: 0.2;"></i>
                </div>
            </div>
            <div class="card metric-card">
                <p class="metric-label">Enviados</p>
                <div class="metric-value">
                    ${state.documents.filter(d => d.status === 'concluido' || d.status === 'enviado_salic').length}
                    <i data-lucide="check-circle" style="color: var(--success); opacity: 0.2;"></i>
                </div>
            </div>
            <div class="card metric-card">
                <p class="metric-label">Com Erro</p>
                <div class="metric-value">
                    ${state.documents.filter(d => d.status === 'erro' || d.status === 'erro_rpa').length}
                    <i data-lucide="alert-circle" style="color: var(--error); opacity: 0.2;"></i>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="flex-row mb-4">
                <div>
                    <h3>Documentos Recentes</h3>
                    <p style="font-size: 0.75rem; color: var(--text-muted);">Últimos documentos processados pela plataforma</p>
                </div>
                <button class="btn btn-primary" onclick="window.navigate('upload')">
                    <i data-lucide="plus"></i>
                    Novo Upload
                </button>
            </div>
            
            <div class="data-table-container">
                ${state.documents.length === 0 ?
        `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum documento encontrado. Faça seu primeiro upload!</p>` :
        `<table class="data-table">
                        <thead>
                            <tr>
                                <th>Arquivo</th>
                                <th>Status</th>
                                <th>Data</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${state.documents.map(doc => `
                                <tr>
                                    <td>
                                        <div class="file-info">
                                            <span class="file-name">${doc.name}</span>
                                            <span class="file-size">${doc.size || '---'}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span class="badge ${(STATUS_MAP[doc.status] || {}).class || 'status-pending'}">
                                            <span class="badge-dot"></span>
                                            ${(STATUS_MAP[doc.status] || {}).label || doc.status}
                                        </span>
                                    </td>
                                    <td style="color: var(--text-muted); font-size: 0.75rem;">${new Date(doc.created_at).toLocaleString('pt-BR')}</td>
                                    <td>
                                        <button class="btn btn-ghost" onclick="window.navigate('details', '${doc.id}')">Ver Detalhes</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>`
    }
            </div>
        </div>
    </div>
</main>
`;

const UploadView = () => `
${Header()}
<main class="upload-view view-content">
    <div class="container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; max-width: 1000px;">
        
        <!-- Coluna 1: Criar Novo Projeto -->
        <div class="card">
            <h3 class="mb-4">Criar Novo Projeto / PRONAC</h3>
            <form onsubmit="event.preventDefault(); window.handleCreateProject();">
                <div class="form-group">
                    <label for="new-pronac">Número PRONAC</label>
                    <input type="text" id="new-pronac" placeholder="Ex: 230561" required>
                </div>
                <div class="form-group">
                    <label for="new-project-name">Nome do Projeto</label>
                    <input type="text" id="new-project-name" placeholder="Ex: Festival de Verão" required>
                </div>
                <button class="btn btn-primary" style="width: 100%;">
                    ${state.loading ? 'Criando...' : 'Cadastrar Projeto'}
                </button>
            </form>
        </div>

        <!-- Coluna 2: Upload de Documentos -->
        <div class="card">
            <h3 class="mb-4">Upload de Documentos</h3>
            <div class="form-group mb-4">
                <label>Selecione o Projeto</label>
                <select id="project-selector" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);">
                    <option value="">Selecione um projeto...</option>
                    ${state.projects.map(p => `<option value="${p.id}">${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
                ${state.projects.length === 0 ? '<p style="font-size: 0.75rem; color: var(--error); margin-top: 0.5rem;">Crie um projeto primeiro no formulário ao lado!</p>' : ''}
            </div>

            <div class="upload-area" onclick="if(document.getElementById('project-selector').value) document.getElementById('file-input').click(); else alert('Selecione um projeto primeiro!');">
                <input type="file" id="file-input" style="display: none;" onchange="window.handleUpload(this.files[0])" accept=".pdf">
                <div class="upload-icon">
                    <i data-lucide="upload-cloud" style="width: 32px; height: 32px;"></i>
                </div>
                <h3 class="mb-2" style="font-size: 1rem;">Arraste aqui seu PDF</h3>
                <p class="mb-4" style="color: var(--text-muted); font-size: 0.75rem;">ou clique para selecionar</p>
                <button class="btn btn-primary" id="upload-btn">
                     ${state.loading ? 'Enviando...' : 'Selecionar Arquivo'}
                </button>
            </div>
        </div>
    </div>
</main>
`;

// --- Handlers & API ---

window.handleLogin = async function () {
    if (!supabaseClient) return alert("Erro ao carregar o Supabase Client.");

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    state.loading = true;
    render();

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        state.user = data.user;
        window.navigate('dashboard');
    } catch (error) {
        alert("Erro no login: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleRegister = async function () {
    if (!supabaseClient) return alert("Erro ao carregar o Supabase Client.");

    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-password-confirm').value;

    if (password !== confirmPassword) {
        return alert("As senhas não coincidem!");
    }

    state.loading = true;
    render();

    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;

        if (data.user && data.session) {
            state.user = data.user;
            alert("Conta criada com sucesso!");
            window.navigate('dashboard');
        } else {
            alert("Conta criada! Verifique seu e-mail para confirmar o cadastro.");
            window.navigate('login');
        }
    } catch (error) {
        alert("Erro ao cadastrar: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleLogout = async function () {
    await supabaseClient.auth.signOut();
    state.user = null;
    window.navigate('login');
};

window.navigate = async function (view, id = null) {
    state.currentView = view;

    if (view === 'dashboard') {
        await fetchDocuments();
        await fetchProjects();
    } else if (view === 'upload') {
        await fetchProjects();
    }

    render();
    window.scrollTo(0, 0);
};

async function fetchProjects() {
    if (!supabaseClient || !state.user) return;
    const { data } = await supabaseClient.from('projects').select('*');
    state.projects = data || [];
}

async function fetchDocuments() {
    if (!supabaseClient || !state.user) return;
    const { data } = await supabaseClient
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
    state.documents = data || [];
}

window.handleCreateProject = async function () {
    if (!supabaseClient || !state.user) return;

    const pronac = document.getElementById('new-pronac').value;
    const nome = document.getElementById('new-project-name').value;

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('projects')
            .insert({
                user_id: state.user.id,
                pronac,
                nome
            });

        if (error) throw error;

        alert("Projeto criado com sucesso!");
        await fetchProjects();
        render(); // Atualiza a lista no select
    } catch (error) {
        alert("Erro ao criar projeto: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleUpload = async function (file) {
    const projectId = document.getElementById('project-selector').value;
    if (!file || !projectId) return alert("Selecione um projeto e um arquivo PDF!");

    state.loading = true;
    render();

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${state.user.id}/${fileName}`;

        // 1. Upload para o Storage
        const { error: uploadError } = await supabaseClient.storage
            .from('documentos')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 2. Salvar no Banco
        const { error: dbError } = await supabaseClient
            .from('documents')
            .insert({
                user_id: state.user.id,
                project_id: projectId,
                name: file.name,
                size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                file_path: filePath,
                status: 'uploaded'
            });

        if (dbError) throw dbError;

        alert("Upload concluído com sucesso!");
        window.navigate('dashboard');
    } catch (error) {
        alert("Erro no upload: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

function render() {
    let content = '';

    if (!state.user && state.currentView !== 'login' && state.currentView !== 'register') {
        state.currentView = 'login';
    }

    switch (state.currentView) {
        case 'login':
            content = LoginView();
            break;
        case 'register':
            content = RegisterView();
            break;
        case 'dashboard':
            content = DashboardView();
            break;
        case 'upload':
            content = UploadView();
            break;
        default:
            content = LoginView();
    }

    app.innerHTML = content;
    lucide.createIcons();
}

// Initial render
render();
