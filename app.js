// --- Supabase Configuração ---
const supabaseUrl = CONFIG.SUPABASE_URL;
const supabaseKey = CONFIG.SUPABASE_KEY;
const supabaseClient = (window.supabase) ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

const app = document.getElementById('app');

const isFornecedorMode = window.location.pathname.includes('fornecedor') || window.location.hash.includes('fornecedor') || window.location.search.includes('fornecedor');

const state = {
    isFornecedorMode: isFornecedorMode,
    currentView: isFornecedorMode ? 'fornecedor_login' : 'login',
    user: null,
    projects: [],
    documents: [],
    rubricas_disponiveis: [],
    catalogo_rubricas: [],
    currentDocument: null,
    loading: false,
    rubricas: [],
    filters: {
        project: '',
        startDate: '',
        endDate: '',
        search: ''
    },
    all_fornecedores: [],
    vinculos_fornecedores: [],
    settings: {
        salic_user: '',
        salic_pass: ''
    }
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
        <span>Prestaí</span>
    </div>
    <nav class="navbar">
        <a class="nav-link ${state.currentView === 'dashboard' ? 'active' : ''}" onclick="window.navigate('dashboard')">Dashboard</a>
        <a class="nav-link ${state.currentView === 'upload' ? 'active' : ''}" onclick="window.navigate('upload')">Upload</a>
        <a class="nav-link ${state.currentView === 'orcamento' ? 'active' : ''}" onclick="window.navigate('orcamento')">Orçamento</a>
        <a class="nav-link ${state.currentView === 'financeiro' ? 'active' : ''}" onclick="window.navigate('financeiro')">Financeiro</a>
        <a class="nav-link ${state.currentView === 'admin_fornecedores' ? 'active' : ''}" onclick="window.navigate('admin_fornecedores')">Fornecedores</a>
        <a class="nav-link ${state.currentView === 'configuracoes' ? 'active' : ''}" onclick="window.navigate('configuracoes')">Configurações</a>
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
${state.userStatus === 'fornecedor' ? `<div style="background: #fee2e2; color: #b91c1c; text-align: center; padding: 0.5rem; font-size: 0.875rem; font-weight: 600;">⚠️ Você está logado como FORNECEDOR. O painel de gestor está bloqueado. <a href="#" onclick="window.handleLogout()" style="text-decoration: underline;">Sair e trocar conta</a></div>` : ''}
`;

const FornecedorHeader = () => `
<header class="header">
    <div class="logo">
        <i data-lucide="truck"></i>
        <span>Portal Fornecedor</span>
    </div>
    <div style="display: flex; align-items: center; gap: 1rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; font-weight: 500;">
            <i data-lucide="user-circle"></i>
            <span>${state.user ? state.user.email.split('@')[0] : 'Fornecedor'}</span>
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
                <span>Prestaí</span>
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
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                <p style="margin-bottom: 0.5rem;">É um fornecedor?</p>
                <button class="btn btn-ghost" onclick="window.navigate('fornecedor_login')" style="width: 100%; border: 1px solid #f59e0b; color: #d97706;">
                    <i data-lucide="truck"></i>
                    Acesso Fornecedor
                </button>
            </div>
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
                <span>Prestaí</span>
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
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                <p style="margin-bottom: 0.5rem;">É um fornecedor?</p>
                <button class="btn btn-ghost" onclick="window.navigate('fornecedor_login')" style="width: 100%; border: 1px solid #f59e0b; color: #d97706;">
                    <i data-lucide="truck"></i>
                    Acesso Fornecedor
                </button>
            </div>
        </div>
    </div>
</div>
`;

const FornecedorLoginView = () => `
<div class="login-view view-content">
    <div class="card login-card">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem; color: #f59e0b;">
                <i data-lucide="truck" style="width: 32px; height: 32px;"></i>
                <span>Portal Fornecedor</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Acesse para enviar comprovantes</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleFornecedorLogin();">
            <div class="form-group">
                <label for="f-email">E-mail</label>
                <input type="email" id="f-login-email" placeholder="fornecedor@email.com" required>
            </div>
            
            <div class="form-group">
                <label for="f-password">Senha</label>
                <input type="password" id="f-login-password" placeholder="••••••••" required>
            </div>
            
            <button class="btn btn-primary" id="f-login-btn" style="width: 100%; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); shadow: 0 4px 10px rgba(245, 158, 11, 0.3);" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Entrando...' : 'Acessar Área do Fornecedor'}
            </button>
        </form>
        
        <div class="login-footer">
            <p>Primeiro acesso? <a href="#" onclick="window.navigate('fornecedor_register')" style="color: #d97706; font-weight: 600;">Cadastre sua empresa</a></p>
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                <p style="margin-bottom: 0.5rem;">É um proponente/gestor?</p>
                <button class="btn btn-ghost" onclick="window.navigate('login')" style="width: 100%; border: 1px solid var(--primary); color: var(--primary);">
                    <i data-lucide="shield-check"></i>
                    Acesso Gestor Prestaí
                </button>
            </div>
        </div>
    </div>
</div>
`;

const FornecedorRegisterView = () => `
<div class="login-view view-content">
    <div class="card login-card" style="max-width: 500px;">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem; color: #f59e0b;">
                <i data-lucide="truck" style="width: 32px; height: 32px;"></i>
                <span>Portal Fornecedor</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Cadastro Rápido de Empresa</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleFornecedorRegister();">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="form-group">
                    <label>CNPJ</label>
                    <input type="text" id="f-reg-cnpj" placeholder="00.000.000/0000-00" required>
                </div>
                <div class="form-group">
                    <label>Telefone</label>
                    <input type="text" id="f-reg-telefone" placeholder="(00) 00000-0000" required>
                </div>
            </div>
            <div class="form-group">
                <label>Razão Social</label>
                <input type="text" id="f-reg-razao" placeholder="Sua Empresa LTDA" required>
            </div>
            <div class="form-group">
                <label>E-mail (Login)</label>
                <input type="email" id="f-reg-email" placeholder="contato@empresa.com" required>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" id="f-reg-password" placeholder="••••••••" required minlength="6">
                </div>
                <div class="form-group">
                    <label>Confirmar Senha</label>
                    <input type="password" id="f-reg-password-confirm" placeholder="••••••••" required minlength="6">
                </div>
            </div>
            
            <button class="btn btn-primary" id="f-register-btn" style="width: 100%; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); shadow: 0 4px 10px rgba(245, 158, 11, 0.3);" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Criando conta...' : 'Concluir Cadastro'}
            </button>
        </form>
        
        <div class="login-footer">
            <p>Já tem uma conta? <a href="#" onclick="window.navigate('fornecedor_login')" style="color: #d97706; font-weight: 600;">Faça login</a></p>
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                <p style="margin-bottom: 0.5rem;">É um proponente/gestor?</p>
                <button class="btn btn-ghost" onclick="window.navigate('login')" style="width: 100%; border: 1px solid var(--primary); color: var(--primary);">
                    <i data-lucide="shield-check"></i>
                    Acesso Gestor Prestaí
                </button>
            </div>
        </div>
    </div>
</div>
`;

const FornecedorDashboardView = () => `
${FornecedorHeader()}
<main class="dashboard-view view-content">
    <div class="container">
        <div class="dashboard-header mb-4">
            <h1 style="font-size: 1.5rem;">Meus Envios</h1>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Acompanhe o status das suas notas e recibos enviados</p>
        </div>
        
        <div class="card mb-4" style="background: rgba(245, 158, 11, 0.05); border: 1px dashed rgba(245, 158, 11, 0.5);">
            <div style="display: grid; grid-template-columns: 1fr auto; gap: 2rem; align-items: center;">
                <div>
                    <h3 class="mb-2">Enviar Novo Documento</h3>
                    <p style="color: var(--text-muted); font-size: 0.875rem;">Escolha o PRONAC solicitante e anexe seu PDF.</p>
                </div>
                <div style="display: flex; gap: 1rem;">
                    <select id="f-upload-project" style="min-width: 250px; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);">
                        <option value="">Selecione o Projeto / PRONAC...</option>
                        ${state.projects.map(p => `<option value="${p.project_id}">${p.projects.pronac} - ${p.projects.nome}</option>`).join('')}
                    </select>
                    <input type="file" id="f-upload-file" style="display: none;" accept=".pdf" onchange="window.handleFornecedorUpload(this.files[0])">
                    <button class="btn btn-primary" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);" onclick="if(document.getElementById('f-upload-project').value) document.getElementById('f-upload-file').click(); else alert('Selecione primeiro o PRONAC!');">
                        <i data-lucide="upload-cloud"></i> Enviar Arquivo
                    </button>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h3 class="mb-4">Histórico de Documentos</h3>
            <div class="data-table-container">
                ${state.documents.length === 0 ?
        `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum documento enviado ainda.</p>` :
        `<table class="data-table">
                    <thead>
                        <tr>
                            <th>Arquivo</th>
                            <th>Projeto Destino</th>
                            <th>Status Financeiro</th>
                            <th>Data Envio</th>
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
                                <td style="font-size: 0.875rem;">${doc.projects ? doc.projects.pronac : '---'}</td>
                                <td>
                                    <span class="badge ${(STATUS_MAP[doc.status] || {}).class || 'status-pending'}">
                                        <span class="badge-dot"></span>
                                        ${(STATUS_MAP[doc.status] || {}).label || doc.status}
                                    </span>
                                </td>
                                <td style="color: var(--text-muted); font-size: 0.75rem;">${new Date(doc.created_at).toLocaleString('pt-BR')}</td>
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
        
        <div class="card mb-4">
            <div class="filters-bar" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; align-items: end;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label>Buscar Arquivo</label>
                    <input type="text" id="filter-search" placeholder="Nome do arquivo..." value="${state.filters.search}" oninput="window.updateFilters('search', this.value)">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label>Filtrar por Projeto</label>
                    <select id="filter-project" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);" onchange="window.updateFilters('project', this.value)">
                        <option value="">Todos os Projetos</option>
                        ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label>De:</label>
                    <input type="date" id="filter-start" value="${state.filters.startDate}" onchange="window.updateFilters('startDate', this.value)" style="width: 100%; padding: 0.5rem; border-radius: var(--radius); border: 1px solid var(--border-color);">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label>Até:</label>
                    <input type="date" id="filter-end" value="${state.filters.endDate}" onchange="window.updateFilters('endDate', this.value)" style="width: 100%; padding: 0.5rem; border-radius: var(--radius); border: 1px solid var(--border-color);">
                </div>
                <button class="btn btn-ghost" onclick="window.clearFilters()" style="margin-bottom: 2px;">Limpar</button>
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
        `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum documento encontrado com os filtros aplicados.</p>` :
        `<table class="data-table">
                        <thead>
                            <tr>
                                <th>Arquivo</th>
                                <th>Status</th>
                                <th>Data</th>
                                <th style="text-align: right;">Ações</th>
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
                                    <td style="text-align: right;">
                                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                            <button class="btn btn-ghost" style="padding: 0.5rem;" onclick="window.navigate('details', '${doc.id}')" title="Ver Detalhes">
                                                <i data-lucide="eye"></i>
                                            </button>
                                            <button class="btn btn-ghost" style="padding: 0.5rem; color: var(--error);" onclick="window.handleDeleteDocument('${doc.id}', '${doc.file_path}')" title="Excluir">
                                                <i data-lucide="trash-2"></i>
                                            </button>
                                        </div>
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
                <select id="project-selector" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);" onchange="window.handleProjectSelectChange(this.value)">
                    <option value="">Selecione um projeto...</option>
                    ${state.projects.map(p => `<option value="${p.id}">${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
                ${state.projects.length === 0 ? '<p style="font-size: 0.75rem; color: var(--error); margin-top: 0.5rem;">Crie um projeto primeiro no formulário ao lado!</p>' : ''}
            </div>

            <div class="form-group mb-4">
                <label>Rubrica (Categoria Orçamentária)</label>
                <select id="rubrica-input" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);">
                    <option value="">Selecione um projeto primeiro...</option>
                </select>
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

const DetailsView = () => {
    const doc = state.currentDocument;
    if (!doc) return `<div class="container" style="padding: 4rem; text-align: center;">Carregando detalhes...</div>`;

    const steps = [
        { id: 'uploaded', label: 'Enviado', icon: 'upload-cloud' },
        { id: 'processing_ocr', label: 'OCR (IA)', icon: 'cpu' },
        { id: 'validated', label: 'Validada', icon: 'shield-check' },
        { id: 'enviado_salic', label: 'RPA Salic', icon: 'bot' },
        { id: 'concluido', label: 'Concluído', icon: 'check-circle' }
    ];

    // Lógica para determinar o índice do passo atual no pipeline
    let activeIndex = 0;
    if (doc.status === 'uploaded') activeIndex = 0;
    else if (doc.status === 'processing_ocr') activeIndex = 1;
    else if (doc.status === 'validated' || doc.status === 'aguardando_d3') activeIndex = 2;
    else if (doc.status === 'enviado_salic') activeIndex = 3;
    else if (doc.status === 'concluido') activeIndex = 4;
    else if (doc.status.includes('erro') || doc.status.includes('bloqueado')) activeIndex = -1; // Status de erro

    return `
${Header()}
<main class="document-details-view view-content">
    <div class="container">
        <div class="flex-row mb-4">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <button class="btn btn-ghost" onclick="window.navigate('dashboard')" style="padding: 0.5rem;">
                    <i data-lucide="arrow-left"></i>
                    Voltar
                </button>
                <div>
                    <h1 style="font-size: 1.5rem;">Detalhes do Documento</h1>
                    <p style="color: var(--text-muted); font-size: 0.875rem;">Acompanhe o processamento em tempo real</p>
                </div>
            </div>
            <div class="badge ${(STATUS_MAP[doc.status] || {}).class || 'status-pending'}">
                <span class="badge-dot"></span>
                ${(STATUS_MAP[doc.status] || {}).label || doc.status}
            </div>
        </div>

        <!-- Pipeline -->
        <div class="card mb-4" style="padding: 2.5rem 1rem;">
             <h3 class="mb-4" style="font-size: 1rem; margin-left:1rem">Pipeline de Processamento</h3>
            <div class="pipeline">
                ${steps.map((step, index) => {
        let statusClass = '';
        if (activeIndex === -1) {
            statusClass = index === 0 ? 'completed' : 'error'; // Simplificação: se erro, marca o primeiro como ok e o resto em dúvida ou focado no erro
        } else {
            statusClass = index === activeIndex ? 'active' : (index < activeIndex ? 'completed' : '');
        }

        return `
                    <div class="step ${statusClass}">
                        <div class="step-icon">
                            <i data-lucide="${step.icon}" style="width: 20px; height: 20px;"></i>
                        </div>
                        <span class="step-label">${step.label}</span>
                        ${index <= activeIndex && activeIndex !== -1 ? `<span class="step-time">${index === activeIndex ? 'Em curso' : 'Concluído'}</span>` : ''}
                    </div>
                `}).join('')}
            </div>
        </div>

        <!-- Mini Cards Summary -->
        <div class="details-grid mb-4">
            <div class="card" style="border-left: 4px solid var(--primary); padding: 1rem;">
                <div class="flex-row">
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">TIPO</span>
                    <i data-lucide="file-text" style="width: 16px; color: var(--primary);"></i>
                </div>
                <p style="font-size: 1.125rem; font-weight: 700; margin-top: 0.5rem;">PDF</p>
            </div>
            <div class="card" style="border-left: 4px solid #10B981; padding: 1rem;">
                <div class="flex-row">
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">VALOR</span>
                    <i data-lucide="dollar-sign" style="width: 16px; color: #10B981;"></i>
                </div>
                <p style="font-size: 1.125rem; font-weight: 700; margin-top: 0.5rem;">R$ ${doc.valor ? doc.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}</p>
            </div>
            <div class="card" style="border-left: 4px solid #8B5CF6; padding: 1rem;">
                <div class="flex-row">
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">EMISSOR</span>
                    <i data-lucide="building" style="width: 16px; color: #8B5CF6;"></i>
                </div>
                <p style="font-size: 0.875rem; font-weight: 700; margin-top: 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${doc.cnpj_emissor || 'Não identificado'}</p>
            </div>
            <div class="card" style="border-left: 4px solid #F59E0B; padding: 1rem;">
                <div class="flex-row">
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">PROTOCOLO</span>
                    <i data-lucide="hash" style="width: 16px; color: #F59E0B;"></i>
                </div>
                <p style="font-size: 1.125rem; font-weight: 700; margin-top: 0.5rem;">${doc.protocolo_salic || '---'}</p>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 1.5rem;" class="details-container-split">
            <!-- Coluna 1: Dados do Arquivo e Extraídos -->
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="card">
                    <div class="flex-row mb-4" style="border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                         <h3 style="font-size: 1rem;">Informações do Arquivo</h3>
                         <button class="btn btn-ghost" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.open('${supabaseUrl}/storage/v1/object/public/documentos/${doc.file_path}', '_blank')">
                            <i data-lucide="external-link"></i> Abrir Original
                         </button>
                    </div>
                    <div class="info-grid">
                        <div class="info-item">
                            <label>Nome do Arquivo</label>
                            <p>${doc.name}</p>
                        </div>
                        <div class="info-item">
                            <label>Tamanho</label>
                            <p>${doc.size || '---'}</p>
                        </div>
                        <div class="info-item">
                            <label>Data de Upload</label>
                            <p>${new Date(doc.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                        <div class="info-item">
                            <label>Rubrica Molic / OCR</label>
                            <p>${doc.rubrica || '---'}</p>
                        </div>
                        <div class="info-item" style="grid-column: span 2;">
                            <label>Rubrica Oficial (Fase 2)</label>
                            ${doc.despesas && doc.despesas.length > 0 ? `
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
                                    <span class="badge status-completed"><i data-lucide="check-circle" style="width:12px; height:12px;"></i> Vinculada</span>
                                    <p style="margin: 0; font-weight: 600;">${state.rubricas_disponiveis.find(r => r.id === doc.despesas[0].rubrica_id)?.nome || 'ID: ' + doc.despesas[0].rubrica_id}</p>
                                </div>
                            ` : (doc.status === 'validated' ? `
                                <div style="background: var(--bg-color); padding: 1rem; border-radius: var(--radius); margin-top: 0.5rem; border: 1px dashed var(--border-color);">
                                    <p style="font-size: 0.75rem; font-weight: 600; color: var(--pending); margin-bottom: 0.5rem;">
                                        <i data-lucide="alert-triangle" style="width: 14px; display:inline-block; vertical-align:middle;"></i> Ação Requerida: Vincular Rubrica Oficial
                                    </p>
                                    <div style="display: flex; gap: 0.5rem;">
                                        <select id="vincular-rubrica-select" style="flex:1; padding: 0.5rem; border-radius: var(--radius); border: 1px solid var(--border-color);">
                                            <option value="">Selecione uma rubrica...</option>
                                            ${(state.rubricas_disponiveis || []).map(r => {
                                                return `<option value="${r.id}">${r.nome}</option>`;
                                            }).join('')}
                                        </select>
                                        <button class="btn btn-primary" style="padding: 0.5rem 1rem;" onclick="window.handleVincularRubrica('${doc.id}', '${doc.project_id}', ${doc.valor || 0})">Vincular</button>
                                    </div>
                                </div>
                            ` : `<p style="color: var(--text-muted); font-size: 0.75rem; margin-top: 0.25rem;">Aguardando etapa OCR (Validação) para permitir vínculo.</p>`)}
                        </div>
                        <div class="info-item">
                            <label>PRONAC Relacionado</label>
                            <p>${doc.projects ? doc.projects.pronac + ' - ' + doc.projects.nome : '---'}</p>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <h3 class="mb-4" style="font-size: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">Dados Extraídos (IA)</h3>
                    <div class="info-grid">
                        <div class="info-item">
                            <label>Data Emissão</label>
                            <p>${doc.data_emissao ? new Date(doc.data_emissao).toLocaleDateString('pt-BR') : '---'}</p>
                        </div>
                        <div class="info-item">
                            <label>Data Vencimento/Pagto</label>
                            <p>${doc.data_pagamento ? new Date(doc.data_pagamento).toLocaleDateString('pt-BR') : '---'}</p>
                        </div>
                        <div class="info-item">
                            <label>CNPJ Emissor</label>
                            <p>${doc.cnpj_emissor || '---'}</p>
                        </div>
                        <div class="info-item">
                            <label>Valor Bruto</label>
                            <p>R$ ${doc.valor ? doc.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Coluna 2: Justificativa e OCR -->
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="card">
                    <h3 class="mb-2" style="font-size: 1rem;">Justificativa</h3>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">Análise automática de conformidade</p>
                    <div class="justification-box">
                        ${doc.justification || 'Aguardando processamento da IA para gerar justificativa de conformidade...'}
                    </div>
                </div>

                <div class="card">
                    <h3 class="mb-4" style="font-size: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">Metadados OCR</h3>
                    <div style="font-family: monospace; font-size: 0.75rem; background: #f1f5f9; padding: 1rem; border-radius: 4px; max-height: 200px; overflow-y: auto;">
                        <pre style="white-space: pre-wrap;">${JSON.stringify(doc.json_extraido || {}, null, 2)}</pre>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>
`;
};

// --- Handlers & API ---

window.handleFornecedorLogin = async function() {
    if (!supabaseClient) return alert("Erro ao carregar o Supabase Client.");

    const email = document.getElementById('f-login-email').value;
    const password = document.getElementById('f-login-password').value;

    state.loading = true;
    render();

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // VALIDAÇÃO: Verificar Role no Metadata (O campo oficial no Auth que você pediu)
        const role = data.user.user_metadata?.role;

        if (role !== 'fornecedor') {
            await supabaseClient.auth.signOut();
            throw new Error("Esta conta não possui permissão de Fornecedor. Use o Portal do Gestor.");
        }

        state.user = data.user;
        window.navigate('fornecedor_dashboard');
    } catch (error) {
        alert("Erro no login Fornecedor: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleFornecedorRegister = async function() {
    if (!supabaseClient) return alert("Erro ao carregar o Supabase Client.");

    const email = document.getElementById('f-reg-email').value;
    const password = document.getElementById('f-reg-password').value;
    const confirmPassword = document.getElementById('f-reg-password-confirm').value;
    const cnpj = document.getElementById('f-reg-cnpj').value;
    const razao = document.getElementById('f-reg-razao').value;
    const telefone = document.getElementById('f-reg-telefone').value;

    if (password !== confirmPassword) {
        return alert("As senhas não coincidem!");
    }

    state.loading = true;
    render();

    try {
        // 1. Cadastrar Usuario com ROLE no Metadata (O campo no Supabase Auth)
        const { data, error } = await supabaseClient.auth.signUp({ 
            email, 
            password,
            options: {
                data: {
                    role: 'fornecedor',
                    razao_social: razao
                }
            }
        });
        if (error) throw error;

        if (data.user) {
            // 2. Inserir no Perfil Fornecedor
            const { error: profileError } = await supabaseClient.from('fornecedores').insert({
                id: data.user.id,
                cnpj: cnpj,
                razao_social: razao,
                telefone: telefone
            });
            
            if (profileError) {
                console.error("Erro ao salvar perfil de fornecedor:", profileError);
                alert("Erro ao salvar dados da empresa. Entre em contato com o suporte.");
            }

            // 3. Importante: Limpar estado e navegar para o login do fornecedor para garantir a validação do perfil
            alert("Conta de fornecedor criada com sucesso! Faça login para acessar o portal.");
            await supabaseClient.auth.signOut();
            state.user = null;
            window.navigate('fornecedor_login');
        }
    } catch (error) {
        alert("Erro ao cadastrar: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleFornecedorUpload = async function (file) {
    const projectId = document.getElementById('f-upload-project').value;
    if (!file || !projectId) return alert("Selecione um projeto e um arquivo!");

    state.loading = true;
    render();

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${state.user.id}/${fileName}`;

        // Upload Storage
        const { error: uploadError } = await supabaseClient.storage.from('documentos').upload(filePath, file);
        if (uploadError) throw uploadError;

        // Salvar Documento
        const { data: dbData, error: dbError } = await supabaseClient.from('documents').insert({
            user_id: state.user.id,
            project_id: projectId,
            fornecedor_id: state.user.id,
            name: file.name,
            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
            file_path: filePath,
            status: 'processing_ocr'
        }).select().single();

        if (dbError) throw dbError;

        // Disparar Webhook para o n8n
        console.log("Notificando n8n (Fornecedor)...", CONFIG.N8N_WEBHOOK_URL);
        if (CONFIG.N8N_WEBHOOK_URL) {
            fetch(CONFIG.N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    document_id: dbData.id,
                    file_path: filePath,
                    user_id: state.user.id,
                    fornecedor: true,
                    bucket: 'documentos'
                })
            }).catch(err => console.error("Erro Webhook Fornecedor:", err));
        }

        alert("Upload concluído! Gestor notificado.");
        await fetchFornecedorDashboard(); // recarrega a grid
    } catch (error) {
        alert("Erro no upload: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

async function fetchFornecedorDashboard() {
    if (!supabaseClient || !state.user) return;
    try {
        // Busca projetos vinculados ao fornecedor
        const { data: projData, error: projError } = await supabaseClient
            .from('projeto_fornecedores')
            .select('project_id, projects(id, pronac, nome)');
        
        if (projError) console.error('Erro ao buscar projetos do fornecedor:', projError);
        state.projects = (projData || []).filter(p => p.projects); // filtra registros com join válido

        // Busca historico de docs
        const { data: docData, error: docError } = await supabaseClient
            .from('documents')
            .select('*, projects(pronac, nome)')
            .eq('fornecedor_id', state.user.id)
            .order('created_at', { ascending: false });
        
        if (docError) console.error('Erro ao buscar documentos do fornecedor:', docError);
        state.documents = docData || [];
    } catch(err) {
        console.error("Erro dashboard fornecedor", err);
    }
}


window.handleLogin = async function () {
    if (!supabaseClient) return alert("Erro ao carregar o Supabase Client.");

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    state.loading = true;
    render();

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // VALIDAÇÃO: Verificar Role no Metadata
        const role = data.user.user_metadata?.role;
        
        // Se não tiver role ou for diferente de gestor, bloqueia (trata usuários antigos como gestores se necessário)
        if (role === 'fornecedor') {
            await supabaseClient.auth.signOut();
            throw new Error("Esta é uma conta de Fornecedor. Use o Portal do Fornecedor.");
        }

        state.user = data.user;
        state.userStatus = 'gestor'; 
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
        const { data, error } = await supabaseClient.auth.signUp({ 
            email, 
            password,
            options: {
                data: {
                    role: 'gestor'
                }
            }
        });
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

// --- FinanceiroView ---
const FinanceiroView = () => {
    let content = `
    ${Header()}
    <main class="financeiro-view view-content">
        <div class="container">
            <div class="flex-row mb-4">
                <div>
                    <h1 style="font-size: 1.5rem;">Painel Financeiro</h1>
                    <p style="color: var(--text-muted); font-size: 0.875rem;">Visão macro e indicadores de conciliação</p>
                </div>
                
                <div class="form-group" style="margin-bottom: 0; min-width: 250px;">
                    <select id="financeiro-project" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);" onchange="window.navigate('financeiro', this.value)">
                        <option value="">Todos os Projetos</option>
                        ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                    </select>
                </div>
            </div>`;

    if (!state.filters.project && state.projects.length === 0) {
         content += `<div class="card" style="text-align: center; padding: 4rem;"><p style="color: var(--text-muted);">Nenhum projeto encontrado. Crie um projeto primeiro.</p></div>`;
    } else {
         // Calculate metrics
         let totalExecutado = 0;
         let pendentesConformidade = 0;
         let pendentesConciliacao = 0;
         const chartLabels = [];
         const chartData = [];

         state.rubricas.forEach(r => {
             let rubricaTotal = 0;
             if (r.despesas && r.despesas.length > 0) {
                 r.despesas.forEach(d => {
                     rubricaTotal += parseFloat(d.valor || 0);
                     if (d.status_conformidade === 'pendente') pendentesConformidade++;
                     if (d.conciliado === false || d.conciliado === null) pendentesConciliacao++;
                 });
             }
             if (rubricaTotal > 0) {
                 chartLabels.push(r.nome);
                 chartData.push(rubricaTotal);
             }
             totalExecutado += rubricaTotal;
         });

         // Store for chart initialization later
         state.chartData = { labels: chartLabels, data: chartData };

         content += `
         <div class="metrics-grid mb-4">
             <div class="card metric-card">
                 <p class="metric-label">Total Executado</p>
                 <div class="metric-value">
                     R$ ${totalExecutado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                     <i data-lucide="dollar-sign" style="color: var(--primary); opacity: 0.2;"></i>
                 </div>
             </div>
             <div class="card metric-card">
                 <p class="metric-label">Aguardando Conformidade (n8n)</p>
                 <div class="metric-value">
                     ${pendentesConformidade}
                     <i data-lucide="shield-alert" style="color: var(--pending); opacity: 0.2;"></i>
                 </div>
             </div>
             <div class="card metric-card">
                 <p class="metric-label">Pendentes de Conciliação</p>
                 <div class="metric-value">
                     ${pendentesConciliacao}
                     <i data-lucide="building-2" style="color: var(--error); opacity: 0.2;"></i>
                 </div>
             </div>
         </div>

         <div style="display: grid; grid-template-columns: 1fr; gap: 2rem;">
             <div class="card">
                 <h3 class="mb-4">Despesas por Rubrica (R$)</h3>
                 <div style="position: relative; height: 300px; width: 100%;">
                     ${chartLabels.length > 0 ? '<canvas id="rubricasChart"></canvas>' : '<p style="text-align: center; color: var(--text-muted); padding-top: 4rem;">Não há dados financeiros suficientes para gerar o gráfico.</p>'}
                 </div>
             </div>
         </div>
         `;
    }

    content += `</div></main>`;
    return content;
};

// --- OrcamentoView ---

const OrcamentoView = () => `
${Header()}
<main class="orcamento-view view-content">
    <div class="container">
        <div class="flex-row mb-4">
            <div>
                <h1 style="font-size: 1.5rem;">Gestão de Orçamento (Rubricas)</h1>
                <p style="color: var(--text-muted); font-size: 0.875rem;">Acompanhe a execução do plano aprovado pelo MinC</p>
            </div>
            
            <div class="form-group" style="margin-bottom: 0; min-width: 250px;">
                <select id="orcamento-project" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);" onchange="window.navigate('orcamento', this.value)">
                    <option value="">Selecione o Projeto...</option>
                    ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
            </div>
        </div>

        ${!state.filters.project ? `<div class="card" style="text-align: center; padding: 4rem;"><p style="color: var(--text-muted);">Por favor, selecione um projeto acima para gerenciar o orçamento.</p></div>` : `
        
        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 2rem; align-items: start;">
            <!-- Cadastro de Rubrica -->
            <div class="card">
                <h3 class="mb-4">Nova Rubrica</h3>
                <form onsubmit="event.preventDefault(); window.handleCreateRubrica();">
                    <div class="form-group">
                        <label>Catálogo de Rubricas</label>
                        <select id="rubrica-nome" style="width: 100%; padding: 0.625rem; border-radius: var(--radius); border: 1px solid var(--border-color);" required>
                            <option value="">Selecione uma rubrica do catálogo...</option>
                            ${(state.catalogo_rubricas || []).map(c => `<option value="${c.nome}">${c.nome} (Espec: ${c.especificacoes})</option>`).join('')}
                        </select>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">A IA usará estas especificações para validar as despesas nesta rubrica.</p>
                    </div>
                    <button class="btn btn-primary" style="width: 100%;">
                        ${state.loading ? 'Salvando...' : 'Adicionar Rubrica'}
                    </button>
                </form>
            </div>

            <!-- Listagem de Rubricas -->
            <div class="card">
                <h3 class="mb-4">Rubricas do Projeto</h3>
                <div class="data-table-container">
                    ${state.rubricas.length === 0 ? `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Nenhuma rubrica cadastrada para este projeto.</p>` : `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Nome da Rubrica</th>
                                <th style="text-align: right;">Total Executado</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${state.rubricas.map(r => {
                                const executado = r.despesas ? r.despesas.reduce((acc, curr) => acc + parseFloat(curr.valor), 0) : 0;
                                return `
                                <tr>
                                    <td>
                                        <div style="font-weight: 500;">${r.nome}</div>
                                        <div style="font-size: 0.75rem; color: var(--text-muted);">Cadastrada em ${new Date(r.created_at).toLocaleDateString('pt-BR')}</div>
                                    </td>
                                    <td style="text-align: right; font-weight: 600;">R$ ${executado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                </tr>
                            `}).join('')}
                        </tbody>
                    </table>`}
                </div>
            </div>
        </div>
        `}
    </div>
</main>
`;

window.navigate = async function (view, id = null) {
    state.currentView = view;

    if (view === 'dashboard') {
        await fetchProjects(); // Sempre recarrega projetos ao voltar ao dashboard
        await fetchDocuments();
    } else if (view === 'fornecedor_dashboard') {
        await fetchFornecedorDashboard();
    } else if (view === 'upload') {
        await fetchProjects();
    } else if (view === 'orcamento' || view === 'financeiro') {
        await fetchProjects();
        await fetchCatalogoRubricas();
        if(id) state.filters.project = id;
        else if(!state.filters.project && state.projects.length > 0) state.filters.project = state.projects[0].id;
        
        if(state.filters.project) await fetchRubricas(state.filters.project);
    } else if (view === 'details' && id) {
        await fetchDocumentDetails(id);
    } else if (view === 'admin_fornecedores') {
        await fetchProjects();
        await fetchFornecedoresAdmin();
    } else if (view === 'configuracoes') {
        await fetchSettings();
    }

    render();
    window.scrollTo(0, 0);
};

async function fetchCatalogoRubricas() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('catalogo_rubricas').select('*').order('nome');
        if (!error && data) state.catalogo_rubricas = data;
    } catch(err) {
        console.error("Erro fetch catalogo:", err);
    }
}

async function fetchFornecedoresAdmin() {
    if (!supabaseClient) return;
    try {
        // 1. Pegar todos os fornecedores (para o select)
        const { data: allF } = await supabaseClient.from('fornecedores').select('*').order('razao_social');
        state.all_fornecedores = allF || [];

        // 2. Pegar vínculos dos projetos que o gestor é dono
        if (state.projects.length === 0) {
            state.vinculos_fornecedores = [];
            return;
        }

        const projectIds = state.projects.map(p => p.id);
        const { data: vinculos } = await supabaseClient
            .from('projeto_fornecedores')
            .select('*, fornecedores(*), projects(*)')
            .in('project_id', projectIds);
        
        state.vinculos_fornecedores = vinculos || [];
    } catch (err) {
        console.error("Erro fetch admin fornecedores:", err);
    }
}

window.handleInviteFornecedor = async function() {
    const fornecedorId = document.getElementById('invite-fornecedor-id').value;
    const projectId = document.getElementById('invite-project-id').value;

    if (!fornecedorId || !projectId) return alert('Selecione fornecedor e projeto!');

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('projeto_fornecedores')
            .insert({ 
                fornecedor_id: fornecedorId, 
                project_id: projectId,
                gestor_id: state.user.id  // obrigatório para o RLS funcionar sem recursão
            });

        if (error) throw error;
        alert("Fornecedor vinculado com sucesso!");
        await fetchFornecedoresAdmin();
    } catch (err) {
        alert("Erro ao vincular: " + (err.code === '23505' ? "Este fornecedor já está vinculado a este projeto." : err.message));
    } finally {
        state.loading = false;
        render();
    }
};

window.handleRemoveVinculo = async function(vinculoId) {
    if (!confirm("Tem certeza que deseja remover este acesso?")) return;

    try {
        const { error } = await supabaseClient
            .from('projeto_fornecedores')
            .delete()
            .eq('id', vinculoId);

        if (error) throw error;
        await fetchFornecedoresAdmin();
        render();
    } catch (err) {
        alert("Erro ao remover: " + err.message);
    }
};

async function fetchRubricas(projectId) {
    if (!supabaseClient || !projectId) return;
    try {
        const { data, error } = await supabaseClient
            .from('rubricas')
            .select('*, despesas(id, valor, status_conformidade, conciliado)')
            .eq('project_id', projectId)
            .order('nome');
            
        if (error) {
            // Se o join de despesas falhar, tenta pegar apenas as rubricas
            const { data: fallbackData } = await supabaseClient.from('rubricas').select('*').eq('project_id', projectId);
            state.rubricas = fallbackData || [];
            return;
        }
        
        state.rubricas = data || [];
    } catch(err) {
        console.error("Erro fetch rubricas:", err);
    }
}

window.handleCreateRubrica = async function() {
    if (!supabaseClient || !state.filters.project) return;
    
    const nome = document.getElementById('rubrica-nome').value;

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('rubricas')
            .insert({
                project_id: state.filters.project,
                nome: nome
            });

        if (error) throw error;
        alert("Rubrica cadastrada com sucesso!");
        await fetchRubricas(state.filters.project);
    } catch(err) {
        alert("Erro ao criar rubrica: " + err.message);
    } finally {
        state.loading = false;
        render();
    }
};

async function fetchDocumentDetails(id, silent = false) {
    if (!supabaseClient || !state.user) return;
    
    if (!silent) {
        state.loading = true;
        render();
    }

    try {
        const { data, error } = await supabaseClient
            .from('documents')
            .select('*, projects(nome, pronac), despesas(*)')
            .eq('id', id)
            .single();

        if (error) throw error;
        state.currentDocument = data;

        // Traz rubricas se precisar vincular
        if (data && data.project_id) {
            const { data: rubData } = await supabaseClient
                .from('rubricas')
                .select('id, nome')
                .eq('project_id', data.project_id)
                .order('nome');
                
            state.rubricas_disponiveis = rubData || [];
        }

    } catch (error) {
        console.error("Erro ao buscar detalhes:", error);
        if (!silent) {
            alert("Erro ao carregar detalhes do documento.");
            window.navigate('dashboard');
        }
    } finally {
        if (!silent) {
            state.loading = false;
        }
        render(); 
    }
}

window.handleVincularRubrica = async function(documentId, projectId, valorDespesa) {
    const rubricaId = document.getElementById('vincular-rubrica-select').value;
    if(!rubricaId) return alert('Selecione uma rubrica!');
    if(valorDespesa === undefined || valorDespesa === null) valorDespesa = 0;

    state.loading = true;
    render();

    try {
        // Obter os valores do form original no currentDocument (cnpj_fornecedor, emissão, etc)
        const doc = state.currentDocument;

        // Insert into despesas
        const { error } = await supabaseClient.from('despesas').insert({
            document_id: documentId,
            rubrica_id: rubricaId,
            project_id: projectId,
            valor: parseFloat(valorDespesa),
            cnpj_fornecedor: doc.cnpj_emissor || null,
            data_emissao: doc.data_emissao || null,
            data_pagamento: doc.data_pagamento || null
        });

        if (error) {
            // Caso de quebra de saldo no RLS (se implementado) ou erro unique
            throw error;
        }

        alert('Rubrica vinculada com sucesso! O workflow do n8n de conformidade deve ser acionado agora.');
        
        // Simular o acionamento do workflow n8n - Fase 2 # Workflow 3.3
        // No front-end nós recarregamos após notificar o n8n
        if(CONFIG.N8N_WEBHOOK_CNAE_URL) {
            fetch(CONFIG.N8N_WEBHOOK_CNAE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document_id: documentId, cnpj_fornecedor: doc.cnpj_emissor })
            }).catch(e => console.error("Erro ao notificar n8n (CNAE):", e));
        }

        await fetchDocumentDetails(documentId);
    } catch(err) {
        alert("Erro ao vincular despesa: " + err.message);
        state.loading = false;
        render();
    }
}

async function fetchProjects() {
    if (!supabaseClient || !state.user) return;

    // Só bloqueia se a role for EXPLICITAMENTE 'fornecedor'
    // Contas antigas sem role são tratadas como gestor
    const role = state.user.user_metadata?.role;
    if (role === 'fornecedor') {
        state.userStatus = 'fornecedor';
        state.projects = [];
        render();
        return;
    }

    const { data, error } = await supabaseClient.from('projects').select('*').order('nome');
    if (error) {
        console.error('Erro ao buscar projetos:', error);
        return;
    }
    state.projects = data || [];
}

async function fetchDocuments() {
    if (!supabaseClient || !state.user) return;

    let query = supabaseClient.from('documents').select('*');

    // Filtros
    if (state.filters.project) query = query.eq('project_id', state.filters.project);
    if (state.filters.search) query = query.ilike('name', `%${state.filters.search}%`);
    if (state.filters.startDate) query = query.gte('created_at', state.filters.startDate + 'T00:00:00');
    if (state.filters.endDate) query = query.lte('created_at', state.filters.endDate + 'T23:59:59');

    const { data } = await query.order('created_at', { ascending: false });
    state.documents = data || [];
}

window.updateFilters = function (key, value) {
    state.filters[key] = value;
    // Debounce na busca para evitar muitas requisições
    if (window.filterTimeout) clearTimeout(window.filterTimeout);
    window.filterTimeout = setTimeout(() => {
        fetchDocuments().then(render);
    }, 400);
};

window.clearFilters = function () {
    state.filters = { project: '', startDate: '', endDate: '', search: '' };
    fetchDocuments().then(render);
};

window.handleDeleteDocument = async function (id, filePath) {
    if (!confirm("Tem certeza que deseja excluir este documento? Esta ação não pode ser desfeita.")) return;

    state.loading = true;
    render();

    try {
        // 1. Excluir do Storage
        const { error: storageError } = await supabaseClient.storage
            .from('documentos')
            .remove([filePath]);

        // Ignoramos erro de "não encontrado" no storage para permitir limpar o banco
        if (storageError && storageError.message !== 'Object not found') throw storageError;

        // 2. Excluir do Banco
        const { error: dbError } = await supabaseClient
            .from('documents')
            .delete()
            .eq('id', id);

        if (dbError) throw dbError;

        alert("Documento excluído com sucesso.");
        await fetchDocuments();
        render();
    } catch (error) {
        alert("Erro ao excluir: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleCreateProject = async function () {
    if (!supabaseClient || !state.user) return;

    const pronac = document.getElementById('new-pronac').value.trim();
    const nome = document.getElementById('new-project-name').value.trim();
};

// --- Settings & Credentials ---

const ConfiguracoesView = () => `
${Header()}
<main class="settings-view view-content">
    <div class="container" style="max-width: 800px;">
        <div class="dashboard-header mb-4">
            <h1 style="font-size: 1.5rem;">Configurações</h1>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Gerencie suas credenciais e preferências do sistema</p>
        </div>

        <div class="card mb-4">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
                <div style="background: rgba(16, 185, 129, 0.1); color: #10B981; padding: 0.5rem; border-radius: 8px;">
                    <i data-lucide="bot"></i>
                </div>
                <div>
                    <h3 style="font-size: 1rem; margin: 0;">Credenciais SALIC (Rouanet)</h3>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin: 0;">Utilizadas pelo robô para envio automático de comprovantes</p>
                </div>
            </div>

            <form onsubmit="event.preventDefault(); window.handleSaveSettings();">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="salic-user">CPF / Usuário</label>
                        <input type="text" id="salic-user" placeholder="000.000.000-00" value="${state.settings.salic_user || ''}" required>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="salic-pass">Senha SALIC</label>
                        <input type="password" id="salic-pass" placeholder="••••••••" value="${state.settings.salic_pass || ''}" required>
                    </div>
                </div>
                
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                    <p style="font-size: 0.75rem; color: #64748b; line-height: 1.5; margin: 0;">
                        <i data-lucide="shield" style="width: 14px; display: inline-block; vertical-align: middle; margin-right: 0.25rem;"></i>
                        <strong>Segurança:</strong> Suas credenciais são armazenadas com segurança no Supabase e protegidas por Row Level Security (RLS). Apenas você e o sistema de automação têm acesso.
                    </p>
                </div>

                <button class="btn btn-primary" id="save-settings-btn">
                    ${state.loading ? 'Salvando...' : 'Salvar Configurações'}
                </button>
            </form>
        </div>

        <div class="card">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
                <div style="background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 0.5rem; border-radius: 8px;">
                    <i data-lucide="user-x"></i>
                </div>
                <div>
                    <h3 style="font-size: 1rem; margin: 0;">Zona de Perigo</h3>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin: 0;">Ações irreversíveis na sua conta</p>
                </div>
            </div>
            
            <button class="btn btn-ghost" style="color: #ef4444; border: 1px solid #fee2e2;" onclick="alert('Funcionalidade em desenvolvimento')">
                Excluir Minha Conta
            </button>
        </div>
    </div>
</main>
`;

async function fetchSettings() {
    if (!supabaseClient || !state.user) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('external_credentials')
            .select('*')
            .eq('service_name', 'salic')
            .maybeSingle();

        if (error) throw error;

        if (data) {
            state.settings = {
                salic_user: data.identifier,
                salic_pass: data.secret
            };
        } else {
            state.settings = { salic_user: '', salic_pass: '' };
        }
    } catch (err) {
        console.error("Erro ao buscar configurações:", err);
    }
}

window.handleSaveSettings = async function() {
    if (!supabaseClient || !state.user) return;

    const salicUser = document.getElementById('salic-user').value.trim();
    const salicPass = document.getElementById('salic-pass').value.trim();

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('external_credentials')
            .upsert({
                user_id: state.user.id,
                service_name: 'salic',
                identifier: salicUser,
                secret: salicPass,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id, service_name' });

        if (error) throw error;

        state.settings = { salic_user: salicUser, salic_pass: salicPass };
        alert("Configurações salvas com sucesso!");
    } catch (err) {
        alert("Erro ao salvar configurações: " + err.message);
    } finally {
        state.loading = false;
        render();
    }
};
window.handleCreateProject = async function () {
    if (!supabaseClient || !state.user) return;

    const pronac = document.getElementById('new-pronac').value.trim();
    const nome = document.getElementById('new-project-name').value.trim();

    if (!pronac || !nome) return alert('Preencha PRONAC e Nome do Projeto!');

    state.loading = true;
    render();

    try {
        const { data: newProject, error } = await supabaseClient
            .from('projects')
            .insert({ user_id: state.user.id, pronac, nome })
            .select()
            .single();

        if (error) throw error;

        // Adiciona imediatamente ao state sem precisar de re-fetch
        state.projects = [...state.projects, newProject].sort((a, b) => a.nome.localeCompare(b.nome));
        state.loading = false;
        render(); // Renderiza imediatamente com o novo projeto na lista

        alert(`Projeto "${nome}" criado com sucesso!`);
    } catch (error) {
        state.loading = false;
        render();
        alert('Erro ao criar projeto: ' + error.message);
    }
};

window.handleProjectSelectChange = async function(projectId) {
    const select = document.getElementById('rubrica-input');
    if (!select) return;
    
    select.innerHTML = '<option value="">Carregando...</option>';
    
    if (!projectId || !supabaseClient) {
        select.innerHTML = '<option value="">Selecione um projeto primeiro...</option>';
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('rubricas')
            .select('id, nome')
            .eq('project_id', projectId)
            .order('nome');

        if (error) throw error;

        if (data && data.length > 0) {
            select.innerHTML = '<option value="">Selecione uma rubrica...</option>' + 
                data.map(r => `<option value="${r.nome}">${r.nome}</option>`).join('');
        } else {
            select.innerHTML = '<option value="">Nenhuma rubrica cadastrada neste projeto.</option>';
        }
    } catch (error) {
        console.error("Erro ao carregar rubricas:", error);
        select.innerHTML = '<option value="">Erro ao carregar rubricas.</option>';
    }
};

window.handleUpload = async function (file) {
    const projectId = document.getElementById('project-selector').value;
    const rubrica = document.getElementById('rubrica-input') ? document.getElementById('rubrica-input').value : null;

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

        // 2. Salvar no Banco (Status inicial: 'processing_ocr' para indicar que n8n assumiu)
        const { data: dbData, error: dbError } = await supabaseClient
            .from('documents')
            .insert({
                user_id: state.user.id,
                project_id: projectId,
                name: file.name,
                size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                file_path: filePath,
                status: 'processing_ocr',
                rubrica: rubrica || null
            })
            .select()
            .single();

        if (dbError) throw dbError;

        // 3. Disparar Webhook para o n8n
        console.log("Tentando notificar n8n em:", CONFIG.N8N_WEBHOOK_URL);

        if (CONFIG.N8N_WEBHOOK_URL) {
            fetch(CONFIG.N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors', // Força o modo CORS
                body: JSON.stringify({
                    document_id: dbData.id,
                    file_path: filePath,
                    user_id: state.user.id,
                    bucket: 'documentos'
                })
            })
                .then(response => console.log("Resposta n8n:", response.status))
                .catch(err => {
                    console.error("ERRO CRÍTICO n8n:", err);
                    alert("O arquivo foi enviado, mas o processamento automático falhou. Verifique a URL do n8n.");
                });
        }

        alert("Upload concluído! A IA está processando seu documento...");
        window.navigate('dashboard');
    } catch (error) {
        alert("Erro no upload: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

const FornecedoresAdminView = () => `
${Header()}
<main class="dashboard-view view-content">
    <div class="container">
        <div class="dashboard-header mb-4">
            <h1 style="font-size: 1.5rem;">Gestão de Fornecedores</h1>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Vincule fornecedores aos seus projetos para que eles enviem notas</p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 2rem; align-items: start;">
            <!-- Painel de Vínculo -->
            <div class="card">
                <h3 class="mb-4">Vincular Fornecedor</h3>
                <form onsubmit="event.preventDefault(); window.handleInviteFornecedor();">
                    <div class="form-group">
                        <label>Selecionar Fornecedor</label>
                        <select id="invite-fornecedor-id" style="width: 100%;" required>
                            <option value="">Selecione um fornecedor cadastrado...</option>
                            ${(state.all_fornecedores || []).map(f => `<option value="${f.id}">${f.razao_social} (${f.cnpj})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Projeto Destino</label>
                        <select id="invite-project-id" style="width: 100%;" required>
                            <option value="">Selecione o projeto...</option>
                            ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                        </select>
                    </div>
                    <button class="btn btn-primary" style="width: 100%;">
                        ${state.loading ? 'Vinculando...' : 'Conceder Acesso'}
                    </button>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 1rem;">
                        O fornecedor selecionado poderá visualizar este projeto e enviar documentos diretamente para ele.
                    </p>
                </form>
            </div>

            <!-- Listagem de Vínculos -->
            <div class="card">
                <h3 class="mb-4">Vínculos Ativos</h3>
                <div class="data-table-container">
                    ${(state.vinculos_fornecedores || []).length === 0 ? 
                        `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum fornecedor vinculado ainda.</p>` :
                        `<table class="data-table">
                            <thead>
                                <tr>
                                    <th>Fornecedor</th>
                                    <th>Projeto</th>
                                    <th style="text-align: right;">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(state.vinculos_fornecedores || []).map(v => `
                                    <tr>
                                        <td>
                                            <div style="font-weight: 500;">${v.fornecedores.razao_social}</div>
                                            <div style="font-size: 0.75rem; color: var(--text-muted);">${v.fornecedores.cnpj}</div>
                                        </td>
                                        <td style="font-size: 0.875rem;">${v.projects.pronac} - ${v.projects.nome}</td>
                                        <td style="text-align: right;">
                                            <button class="btn btn-ghost" style="color: var(--error);" onclick="window.handleRemoveVinculo('${v.id}')">
                                                <i data-lucide="trash-2" style="width: 16px;"></i>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>`
                    }
                </div>
            </div>
        </div>
    </div>
</main>
`;

function render() {
    let content = '';

    if (!state.user && !['login', 'register', 'fornecedor_login', 'fornecedor_register'].includes(state.currentView)) {
        state.currentView = state.isFornecedorMode ? 'fornecedor_login' : 'login';
    }

    switch (state.currentView) {
        case 'login':
            content = LoginView();
            break;
        case 'register':
            content = RegisterView();
            break;
        case 'fornecedor_login':
            content = FornecedorLoginView();
            break;
        case 'fornecedor_register':
            content = FornecedorRegisterView();
            break;
        case 'fornecedor_dashboard':
            content = FornecedorDashboardView();
            break;
        case 'dashboard':
            content = DashboardView();
            break;
        case 'upload':
            content = UploadView();
            break;
        case 'orcamento':
            content = OrcamentoView();
            break;
        case 'financeiro':
            content = FinanceiroView();
            break;
        case 'details':
            content = DetailsView();
            break;
        case 'admin_fornecedores':
            content = FornecedoresAdminView();
            break;
        case 'configuracoes':
            content = ConfiguracoesView();
            break;
        default:
            content = LoginView();
    }

    app.innerHTML = content;
    lucide.createIcons();

    if (state.currentView === 'financeiro') {
        setTimeout(initFinanceiroCharts, 50); // Initialize charts after DOM updates
    }
}

function initFinanceiroCharts() {
    if (!window.Chart) return; // Ensure Chart.js is loaded
    const ctx = document.getElementById('rubricasChart');
    if (!ctx) return;
    
    // Destroy previous chart instance if exists
    if (window.rubricasChartInstance) {
        window.rubricasChartInstance.destroy();
    }

    const labels = state.chartData?.labels || [];
    const data = state.chartData?.data || [];

    window.rubricasChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe',
                    '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'
                ],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-color') || '#1e293b' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            if (context.parsed !== null) {
                                label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// --- Realtime Listener ---
function setupRealtime() {
    if (!supabaseClient) return;

    supabaseClient
        .channel('document-updates')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'documents'
            },
            (payload) => {
                console.log('Mudança em tempo real detectada:', payload.new);

                // 1. Atualiza o documento na lista geral (Dashboard)
                state.documents = state.documents.map(doc =>
                    doc.id === payload.new.id ? { ...doc, ...payload.new } : doc
                );

                // 2. Se estivermos vendo os detalhes DESTE documento, fazemos um fetch silencioso 
                // para garantir que pegamos as relações (despesas, etc) que o n8n pode ter criado.
                if (state.currentDocument && state.currentDocument.id === payload.new.id && state.currentView === 'details') {
                    fetchDocumentDetails(payload.new.id, true);
                } else {
                    render();
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'documents'
            },
            (payload) => {
                // Opcional: Adiciona novos documentos na lista automaticamente
                if (state.currentView === 'dashboard') {
                    state.documents = [payload.new, ...state.documents];
                    render();
                }
            }
        )
        .subscribe();
}

// Initial render and setup
render();
setupRealtime();
