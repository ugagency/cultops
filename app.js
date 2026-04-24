let supabaseClient = null;

// Expõe a URL publicamente para uso nos templates HTML
let SUPABASE_URL = "";

function initializeSupabase() {
    const supabaseUrl = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : "") || "";
    const supabaseKey = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_KEY : "") || "";
    SUPABASE_URL = supabaseUrl; // Torna disponível globalmente para templates

    if (window.supabase && supabaseUrl && supabaseKey) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
        console.log("Supabase Client inicializado com sucesso.");
    } else {
        console.error("ERRO: Falha ao inicializar o Supabase.");
        if (typeof window.showToast === 'function' && !window.location.hash.includes('login')) {
            window.showToast("Falha na configuração do banco de dados (Supabase). Confira as chaves no arquivo .env", 'error');
        }
    }
}

// Inicializa imediatamente
initializeSupabase();

if (!supabaseClient && !window.location.hash.includes('login')) {
    console.error("ERRO: CONFIGURAÇÃO DO SUPABASE NÃO DETECTADA OU INCOMPLETA. Certifique-se que o .env ou config.js contêm SUPABASE_URL e SUPABASE_KEY.");
}


const app = document.getElementById('app');

// --- Notificações Premium (Toasts) ---
window.showToast = function (message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    if (type === 'warning') icon = 'alert-triangle';

    toast.innerHTML = `
        <i class="toast-icon" data-lucide="${icon}"></i>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

// Redireciona alerts para o toast por padrão
const nativeAlert = window.alert;
window.alert = (message) => {
    // Se a mensagem contém palavras de erro comuns, usa tipo error
    const lower = message.toLowerCase();
    if (lower.includes('erro') || lower.includes('falhou') || lower.includes('inválido') || lower.includes('não encontrado')) {
        window.showToast(message, 'error');
    } else if (lower.includes('sucesso') || lower.includes('concluído') || lower.includes('criado')) {
        window.showToast(message, 'success');
    } else {
        window.showToast(message, 'info');
    }
    console.log("Alert interceptado:", message);
};

const isSolicitanteMode = window.location.pathname.includes('solicitante') || window.location.hash.includes('solicitante') || window.location.search.includes('solicitante');

const state = {
    isSolicitanteMode: isSolicitanteMode,
    currentView: isSolicitanteMode ? 'solicitante_login' : 'login',
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
    all_solicitantes: [],
    vinculos_solicitantes: [],
    extratos: [],
    settings: {
        salic_user: '',
        salic_pass: ''
    },
    importState: null, // null, 'disparando', 'navegando', 'gerando', 'ocr', 'salvando', 'concluido', 'erro'
    importProgress: 0,
    importResult: null,
    showRubricaInstructions: false,
    capturedProject: null,
    showCapturedProjectModal: false,
    isUploadingComprovante: false,
    rubrica_versions: []
};

const STATUS_MAP = {
    // Status Gerais NF
    'uploaded': {
        label: 'Enviado',
        class: 'status-pending',
        description: 'Upload realizado: O arquivo foi enviado com sucesso e aguarda o início do processamento.'
    },
    'processing_ocr': {
        label: 'Em Processamento',
        class: 'status-pending',
        description: 'Em processamento: O documento se encontra no servidor e em análise pela IA do Prestaí.'
    },
    'aguardando_comprovante': {
        label: 'Falta Comprovante',
        class: 'status-warning',
        description: 'Aguardando comprovante: A nota foi aceita, mas precisa do upload do comprovante de pagamento.'
    },
    'aguardando_conciliacao_bancaria': {
        label: 'Falta Conciliação',
        class: 'status-warning',
        description: 'Aguardando extrato: O documento aguarda o upload do extrato bancário para conciliação.'
    },
    'aguardando_d3': {
        label: 'Em carência (D-3)',
        class: 'status-pending',
        description: 'Em carência (D-3): Conciliado! O documento está cumprindo o prazo de 72h antes do envio oficial ao SALIC.'
    },
    'liberado_rpa_airtop': {
        label: 'Pronto para envio',
        class: 'status-completed',
        description: 'Pronto para envio: Documento conferido e pronto para ser enviado automaticamente pelo Robô Prestaí ao SALIC.'
    },
    'enviado_salic': {
        label: 'Enviado ao SALIC',
        class: 'status-completed',
        description: 'Enviado ao SALIC: Documento inserido com sucesso no sistema do Ministério da Cultura.'
    },
    'concluido': {
        label: 'Concluído',
        class: 'status-completed',
        description: 'Concluído: O processo foi finalizado com sucesso em todas as etapas.'
    },

    'aguardando_conformidade': {
        label: 'Em Auditoria IA',
        class: 'status-processing',
        description: 'Em Auditoria IA: A inteligência artificial está validando o CNAE do fornecedor contra as regras da rubrica orçamentária.'
    },
    'bloqueado_conformidade': {
        label: 'Bloqueado',
        class: 'status-error',
        description: 'Bloqueado: A IA detectou uma inconsistência (ex: CNAE inválido) e o documento requer correção ou justificativa.'
    },
    'revisao_manual': {
        label: 'Revisão Manual',
        class: 'status-warning',
        description: 'Revisão manual: O sistema identificou pontos de dúvida no OCR e requer uma conferência humana.'
    },
    'erro_rpa': {
        label: 'Erro no Envio',
        class: 'status-error',
        description: 'Erro no envio: O robô encontrou um problema ao tentar inserir no SALIC (ex: instabilidade no site do governo).'
    }
};

// --- Templates ---

const Sidebar = () => `
<aside class="sidebar">
    <div class="sidebar-logo">
        <i data-lucide="shield-check"></i>
        <span>Prestaí</span>
    </div>
    
    <nav class="sidebar-nav">
        <a class="nav-item ${state.currentView === 'dashboard' ? 'active' : ''}" onclick="window.navigate('dashboard')">
            <i data-lucide="layout-dashboard"></i>
            <span>Dashboard</span>
        </a>
        <a class="nav-item ${state.currentView === 'projects' ? 'active' : ''}" onclick="window.navigate('projects')">
            <i data-lucide="briefcase"></i>
            <span>Projetos</span>
        </a>
        <a class="nav-item ${['upload', 'details'].includes(state.currentView) ? 'active' : ''}" onclick="window.navigate('upload')">
            <i data-lucide="file-text"></i>
            <span>Documentos</span>
        </a>
        <a class="nav-item ${['orcamento', 'rubricas'].includes(state.currentView) ? 'active' : ''}" onclick="window.navigate('orcamento')">
            <i data-lucide="list-checks"></i>
            <span>Rubricas</span>
        </a>
        <a class="nav-item ${state.currentView === 'financeiro' ? 'active' : ''}" onclick="window.navigate('financeiro')">
            <i data-lucide="bar-chart-3"></i>
            <span>Relatórios</span>
        </a>
        <a class="nav-item ${state.currentView === 'admin_solicitantes' ? 'active' : ''}" onclick="window.navigate('admin_solicitantes')">
            <i data-lucide="users"></i>
            <span>Solicitantes</span>
        </a>
        <a class="nav-item ${state.currentView === 'configuracoes' ? 'active' : ''}" onclick="window.navigate('configuracoes')">
            <i data-lucide="settings"></i>
            <span>Configurações</span>
        </a>
    </nav>

    <div class="sidebar-footer">
        <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; margin-bottom: 0.5rem;">
            <div style="width: 32px; height: 32px; background: var(--border-light); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--text-secondary);">
                ${state.user ? state.user.email[0].toUpperCase() : 'A'}
            </div>
            <div style="overflow: hidden;">
                <p style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; text-overflow: ellipsis;">
                    ${state.user ? state.user.email.split('@')[0] : 'Admin'}
                </p>
                <p style="font-size: 11px; color: var(--text-secondary);">Gestor</p>
            </div>
        </div>
        <a class="nav-item" onclick="window.handleLogout()" style="color: var(--error);">
            <i data-lucide="log-out"></i>
            <span>Sair</span>
        </a>
    </div>
</aside>
`;

// Helper for Header compatibility if needed
const Header = Sidebar;


const SolicitanteHeader = () => `
<header class="header">
    <div class="logo">
        <i data-lucide="truck"></i>
        <span>Portal Solicitante</span>
    </div>
    <div style="display: flex; align-items: center; gap: 1rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; font-weight: 500;">
            <i data-lucide="user-circle"></i>
            <span>${state.user ? state.user.email.split('@')[0] : 'Solicitante'}</span>
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
                <a href="javascript:void(0)" onclick="window.navigate('forgot_password')" style="color: var(--primary); font-weight: 500;">Esqueceu a senha?</a>
            </div>
            
            <button class="btn btn-primary" id="login-btn" style="width: 100%;" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Entrando...' : 'Entrar na Plataforma'}
            </button>
        </form>
        
        <div class="login-footer">
            <p>Não tem uma conta? <a href="#" onclick="window.navigate('register')" style="color: var(--primary); font-weight: 600;">Crie uma agora</a></p>
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                <p style="margin-bottom: 0.5rem;">É um solicitante?</p>
                <button class="btn btn-ghost" onclick="window.navigate('solicitante_login')" style="width: 100%; border: 1px solid #f59e0b; color: #d97706;">
                    <i data-lucide="truck"></i>
                    Acesso Solicitante
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
                <p style="margin-bottom: 0.5rem;">É um solicitante?</p>
                <button class="btn btn-ghost" onclick="window.navigate('solicitante_login')" style="width: 100%; border: 1px solid #f59e0b; color: #d97706;">
                    <i data-lucide="truck"></i>
                    Acesso Solicitante
                </button>
            </div>
        </div>
    </div>
</div>
`;

const ForgotPasswordView = () => `
<div class="login-view view-content">
    <div class="card login-card">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem;">
                <i data-lucide="shield-check" style="width: 32px; height: 32px;"></i>
                <span>Prestaí</span>
            </div>
            <h3 class="h2">Recuperar Senha</h3>
            <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem;">Enviaremos um link para o seu e-mail</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleForgotPassword();">
            <div class="form-group">
                <label for="reset-email">E-mail</label>
                <input type="email" id="reset-email" placeholder="seu@email.com" required>
            </div>
            
            <button class="btn btn-primary" id="reset-btn" style="width: 100%;" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Enviando...' : 'Enviar Link de Recuperação'}
            </button>
        </form>
        
        <div class="login-footer">
            <p><a href="#" onclick="window.navigate('login')" style="color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
                <i data-lucide="arrow-left" style="width: 16px;"></i> Voltar para o login
            </a></p>
        </div>
    </div>
</div>
`;

const UpdatePasswordView = () => `
<div class="login-view view-content">
    <div class="card login-card">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem;">
                <i data-lucide="shield-check" style="width: 32px; height: 32px;"></i>
                <span>Prestaí</span>
            </div>
            <h3 class="h2">Nova Senha</h3>
            <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem;">Defina sua nova senha de acesso</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleUpdatePassword();">
            <div class="form-group">
                <label for="new-password">Nova Senha</label>
                <input type="password" id="new-password" placeholder="••••••••" required minlength="6">
            </div>

            <div class="form-group">
                <label for="confirm-new-password">Confirmar Nova Senha</label>
                <input type="password" id="confirm-new-password" placeholder="••••••••" required minlength="6">
            </div>
            
            <button class="btn btn-primary" id="update-btn" style="width: 100%;" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Atualizando...' : 'Redefinir Senha'}
            </button>
        </form>
    </div>
</div>
`;

const SolicitanteLoginView = () => `
<div class="login-view view-content">
    <div class="card login-card">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem; color: #f59e0b;">
                <i data-lucide="truck" style="width: 32px; height: 32px;"></i>
                <span>Portal Solicitante</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Acesse para enviar comprovantes</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleSolicitanteLogin();">
            <div class="form-group">
                <label for="f-email">E-mail</label>
                <input type="email" id="f-login-email" placeholder="solicitante@email.com" required>
            </div>
            
            <div class="form-group">
                <label for="f-password">Senha</label>
                <input type="password" id="f-login-password" placeholder="••••••••" required>
            </div>

            <div style="text-align: right; margin-bottom: 1.5rem; font-size: 0.75rem;">
                <a href="javascript:void(0)" onclick="window.navigate('forgot_password')" style="color: #d97706; font-weight: 500;">Esqueceu a senha?</a>
            </div>
            
            <button class="btn btn-primary" id="f-login-btn" style="width: 100%; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); shadow: 0 4px 10px rgba(245, 158, 11, 0.3);" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Entrando...' : 'Acessar Área do Solicitante'}
            </button>
        </form>
        
        <div class="login-footer">
            <p>Primeiro acesso? <a href="#" onclick="window.navigate('solicitante_register')" style="color: #d97706; font-weight: 600;">Cadastre sua empresa</a></p>
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

const SolicitanteRegisterView = () => `
<div class="login-view view-content">
    <div class="card login-card" style="max-width: 500px;">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div class="logo" style="justify-content: center; font-size: 2rem; margin-bottom: 0.5rem; color: #f59e0b;">
                <i data-lucide="truck" style="width: 32px; height: 32px;"></i>
                <span>Portal Solicitante</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.875rem;">Cadastro Rápido de Empresa</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleSolicitanteRegister();">
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
            <p>Já tem uma conta? <a href="#" onclick="window.navigate('solicitante_login')" style="color: #d97706; font-weight: 600;">Faça login</a></p>
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

const SolicitanteDashboardView = () => `
<div style="display: flex; flex-direction: column; flex: 1; width: 100%;">
    ${SolicitanteHeader()}
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
                        <select id="f-upload-project" style="min-width: 250px; padding: 0.625rem; border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
                            <option value="">Selecione o Projeto / PRONAC...</option>
                            ${state.projects.map(p => `<option value="${p.project_id}">${p.projects.pronac} - ${p.projects.nome}</option>`).join('')}
                        </select>
                        <input type="file" id="f-upload-file" style="display: none;" accept=".pdf" onchange="window.handleSolicitanteUpload(this.files[0])">
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
</div>
`;

const DashboardView = () => {
    const totalAnalisadas = state.documents.length;
    const pendentes = state.documents.filter(d => ['uploaded', 'processing_ocr', 'validating', 'pendente'].includes(d.status)).length;
    const erros = state.documents.filter(d => ['erro', 'erro_rpa'].includes(d.status)).length;

    // Calcular valor aprovado (se disponível no state ou se precisarmos calcular de despesas)
    // Para simplificar agora, vamos mostrar o número de notas validadas se o valor não estiver fácil
    const aprovadas = state.documents.filter(d => ['validated', 'enviado_salic', 'concluido'].includes(d.status)).length;

    return `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <h1>Dashboard</h1>
        <p class="page-subtitle">Bem-vindo ao Prestaí, seu assistente de conformidade financeira.</p>
    </header>
    
    <div class="metrics-grid">
        <div class="card metric-card">
            <p class="metric-label">Notas analisadas</p>
            <div class="metric-value">${totalAnalisadas}</div>
        </div>
        <div class="card metric-card">
            <p class="metric-label">Pendentes de revisão</p>
            <div class="metric-value" style="color: var(--warning);">${pendentes}</div>
        </div>
        <div class="card metric-card">
            <p class="metric-label">Notas aprovadas</p>
            <div class="metric-value" style="color: var(--success);">${aprovadas}</div>
        </div>
        <div class="card metric-card">
            <p class="metric-label">Erros encontrados</p>
            <div class="metric-value" style="color: var(--error);">${erros}</div>
        </div>
    </div>
    
    <div class="card mb-4" style="padding: 1rem 1.5rem;">
        <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
                <input type="text" placeholder="Pesquisar notas..." value="${state.filters.search}" oninput="window.updateFilters('search', this.value)">
            </div>
            <div style="min-width: 180px;">
                <select onchange="window.updateFilters('project', this.value)">
                    <option value="">Todos os projetos</option>
                    ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
            </div>
            <button class="btn btn-secondary" onclick="window.clearFilters()">Limpar filtros</button>
            <button class="btn btn-primary" onclick="window.navigate('upload')">
                <i data-lucide="upload-cloud"></i>
                Enviar nota
            </button>
        </div>
    </div>
    
    <div class="data-table-container">
        ${state.documents.length === 0 ? `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="file-warning"></i></div>
                <h3 class="h2">Nenhuma nota encontrada</h3>
                <p class="text-sm">Tente ajustar seus filtros ou envie sua primeira nota fiscal para começar.</p>
                <button class="btn btn-primary" onclick="window.navigate('upload')">Enviar nota</button>
            </div>
        ` : `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Arquivo</th>
                        <th>Projeto</th>
                        <th>Status</th>
                        <th>Data</th>
                        <th style="text-align: right;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.documents.map(doc => {
        const status = STATUS_MAP[doc.status] || { label: doc.status, class: 'status-pending' };
        const project = state.projects.find(p => p.id === doc.project_id);
        return `
                        <tr>
                            <td>
                                <div style="font-weight: 500;">${doc.name}</div>
                                <div class="text-xs">${doc.size || '---'}</div>
                            </td>
                            <td>
                                <div class="text-sm">${project ? project.pronac : '---'}</div>
                            </td>
                            <td>
                                <span class="badge ${status.class}">
                                    <span class="badge-dot"></span>
                                    ${status.label}
                                </span>
                            </td>
                            <td>
                                <div class="text-sm">${new Date(doc.created_at).toLocaleDateString('pt-BR')}</div>
                            </td>
                            <td style="text-align: right;">
                                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                    <button class="btn btn-secondary" style="padding: 0.4rem;" title="Ver detalhes" onclick="window.navigate('details', '${doc.id}')">
                                        <i data-lucide="eye" style="width: 16px;"></i>
                                    </button>
                                    <button class="btn btn-secondary" style="padding: 0.4rem; color: var(--error);" title="Excluir" onclick="window.handleDeleteDocument('${doc.id}', '${doc.file_path}')">
                                        <i data-lucide="trash-2" style="width: 16px;"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        `}
    </div>
</main>
`;
};

const ProjectsView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
            <h1>Gestão de Projetos</h1>
            <p class="page-subtitle">Visualize e gerencie todos os seus projetos culturais.</p>
        </div>
        <button class="btn btn-primary" onclick="window.navigate('create_project')">
            <i data-lucide="plus"></i>
            Novo Projeto
        </button>
    </header>

    <div class="data-table-container">
        ${state.projects.length === 0 ? `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="briefcase"></i></div>
                <h3 class="h2">Nenhum projeto encontrado</h3>
                <p class="text-sm">Comece criando um novo projeto para organizar suas notas fiscais.</p>
                <button class="btn btn-primary" onclick="window.navigate('create_project')">Criar Projeto</button>
            </div>
        ` : `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>PRONAC</th>
                        <th>Projeto / Proponente</th>
                        <th>UF</th>
                        <th>Vr. Arrecadado</th>
                        <th>Data Criação</th>
                        <th style="text-align: right;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.projects.map(p => `
                        <tr>
                            <td style="font-weight: 600; color: var(--primary);">${p.pronac}</td>
                            <td>
                                <div style="font-weight: 500;">${p.nome}</div>
                                <div class="text-xs" style="color: var(--text-muted);">${p.propoente || '---'}</div>
                            </td>
                            <td class="text-sm">${p.uf || '---'}</td>
                            <td class="text-sm" style="font-weight: 600; color: var(--success);">
                                R$ ${(p.valor_captado ? parseFloat(p.valor_captado) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td class="text-sm">${new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                            <td style="text-align: right;">
                                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                    <button class="btn btn-secondary" style="padding: 0.4rem;" title="Detalhes SALIC" onclick="window.showProjectDetails('${p.id}')">
                                        <i data-lucide="info" style="width: 16px;"></i>
                                    </button>
                                    <button class="btn btn-secondary" style="padding: 0.4rem;" title="Financeiro" onclick="state.filters.project = '${p.id}'; window.navigate('financeiro')">
                                        <i data-lucide="bar-chart-3" style="width: 16px;"></i>
                                    </button>
                                    
                                    ${state.user?.user_metadata?.role === 'admin' ? `
                                        <button class="btn btn-secondary" style="padding: 0.4rem; color: var(--error);" title="Excluir Projeto" onclick="window.handleDeleteProject('${p.id}', '${p.nome}')">
                                            <i data-lucide="trash-2" style="width: 16px;"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `}
    </div>
</main>
`;

const UploadView = () => `
${Sidebar()}
    <main class="main-content view-content">
        <header class="content-header">
            <h1>Enviar Nota Fiscal</h1>
            <p class="page-subtitle">Inicie a conciliação subindo a NF e selecionando a rubrica.</p>
        </header>

        <div style="max-width: 600px; margin: 0 auto;">
            <div class="card">
                <h3 class="h2 mb-4">Novo upload de NF</h3>

                <div class="form-group mb-4">
                    <label>Projeto / PRONAC</label>
                    <select id="project-selector" onchange="window.handleProjectSelectChange(this.value); state.filters.project = this.value;">
                        <option value="">Selecione um projeto...</option>
                        ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group mb-4">
                    <label>Rubrica Orçamentária (Obrigatório)</label>
                    <input type="text" id="rubrica-input" list="rubricas-list" placeholder="Digite para buscar rubrica..." autocomplete="off" style="width: 100%;">
                    <datalist id="rubricas-list">
                        <option value="">Selecione o projeto primeiro...</option>
                    </datalist>
                </div>

                <script>
                    // Aciona o carregamento das rubricas se já houver um projeto selecionado no estado
                    setTimeout(() => {
                        const selector = document.getElementById('project-selector');
                        if (selector && selector.value) {
                            window.handleProjectSelectChange(selector.value);
                        }
                    }, 100);
                </script>

                <div class="upload-area" onclick="if(document.getElementById('project-selector').value && document.getElementById('rubrica-input').value) document.getElementById('file-input').click(); else alert('Selecione projeto e rubrica primeiro!');">
                    <input type="file" id="file-input" style="display: none;" onchange="window.handleUpload(this.files[0], 'nf')" accept=".pdf">
                        <i data-lucide="file-text" style="width: 32px; color: var(--primary); margin-bottom: 1rem;"></i>
                        <p class="text-sm" style="font-weight: 600;">Arraste a NF (PDF) ou clique para selecionar</p>
                        <p class="text-xs" style="color: var(--text-muted); margin-top: 0.5rem;">Apenas arquivos PDF são aceitos.</p>
                </div>


                ${state.loading ? `<p class="text-xs mt-4" style="color: var(--primary); text-align: center;">Enviando arquivo, aguarde...</p>` : ''}
            </div>
            
            <p class="text-xs mt-4" style="text-align: center; color: var(--text-muted);">
                Precisa de um novo projeto? <a href="#" onclick="window.navigate('create_project')" style="color: var(--primary); font-weight: 600;">Cadastre aqui</a>
            </p>
        </div>
    </main>
    `;

const CreateProjectView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem;">
            <button class="btn btn-secondary" onclick="window.navigate('projects')" style="padding: 0.5rem;">
                <i data-lucide="arrow-left" style="width: 18px;"></i>
            </button>
            <h1>Cadastrar Novo Projeto</h1>
        </div>
        <p class="page-subtitle">Configure um novo projeto cultural buscando os dados oficiais do SALIC.</p>
    </header>

    <div style="max-width: 600px;">
        <div class="card">
            <h3 class="h2 mb-4">Importar Projeto do SALIC</h3>
            
            <form id="form-busca-salic" onsubmit="event.preventDefault(); window.handleFetchSalicProject();">
                <div class="form-group mb-4">
                    <label>Número PRONAC</label>
                    <div style="display: flex; gap: 1rem;">
                        <input type="text" id="busca-pronac" placeholder="Ex: 230561" required pattern="\\d+" title="Apenas números">
                        <button type="submit" class="btn btn-primary" style="white-space: nowrap; min-width: 140px;" ${state.loading ? 'disabled' : ''}>
                            ${state.loading ? 'Importando...' : '<i data-lucide="download-cloud" style="width: 18px;"></i> Importar'}
                        </button>
                    </div>
                    <p class="text-xs mt-2" style="color: var(--text-muted); line-height: 1.5;">O nosso robô irá acessar o SALIC, buscar os dados do projeto e cadastrá-lo automaticamente na sua conta. Isso pode levar alguns segundos.</p>
                </div>
            </form>

            ${state.error ? `
                <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(239, 68, 68, 0.1); border-radius: var(--radius-sm); border-left: 3px solid var(--error); display: flex; gap: 0.75rem; align-items: flex-start;">
                    <i data-lucide="alert-circle" style="width: 18px; color: var(--error); flex-shrink: 0; margin-top: 2px;"></i>
                    <div>
                        <p class="text-sm" style="color: var(--error); font-weight: 600; margin-bottom: 2px;">Falha na importação</p>
                        <p class="text-xs" style="color: var(--text-secondary); line-height: 1.4;">${state.error}</p>
                    </div>
                </div>
            ` : ''}
        </div>
    </div>
</main>
`;

const DetailsView = () => {
    const doc = state.currentDocument;
    if (!doc) {
        const isLoading = state.loading;
        return `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header" style="display: flex; align-items: center; gap: 1rem;">
        <button class="btn btn-secondary" onclick="window.navigate('dashboard')" style="padding: 0.5rem;">
            <i data-lucide="arrow-left" style="width: 18px;"></i>
        </button>
        <h1>Detalhes da Nota</h1>
    </header>
    <div class="card" style="padding: 3rem; text-align: center;">
        ${isLoading
                ? `<i data-lucide="loader" style="width: 32px; height: 32px; color: var(--primary); animation: spin 1s linear infinite;"></i>
               <p class="text-sm" style="margin-top: 1rem; color: var(--text-secondary);">Carregando detalhes do documento...</p>`
                : `<i data-lucide="alert-circle" style="width: 32px; height: 32px; color: var(--error);"></i>
               <p class="text-sm" style="margin-top: 1rem; color: var(--text-secondary);">Não foi possível carregar o documento. Verifique sua conexão ou tente novamente.</p>
               <button class="btn btn-primary" style="margin-top: 1.5rem;" onclick="window.navigate('dashboard')">Voltar ao Dashboard</button>`
            }
    </div>
</main>`;
    }

    const steps = [
        { id: 'uploaded', label: 'Enviado', icon: 'upload-cloud' },
        { id: 'processing_ocr', label: 'OCR', icon: 'cpu' },
        { id: 'aguardando_conformidade', label: 'Auditoria', icon: 'shield' },
        { id: 'aguardando_comprovante', label: 'Documentação', icon: 'file-text' },
        { id: 'aguardando_conciliacao_bancaria', label: 'Conciliação', icon: 'banknote' },
        { id: 'enviado_salic', label: 'SALIC', icon: 'check-circle' }
    ];

    let activeIndex = 0;
    let errorAtStep = -1;

    // Lógica revisada de steps baseada no novo fluxo
    const statusOrder = [
        'uploaded',
        'processing_ocr',
        'aguardando_conformidade',
        'aguardando_comprovante',
        'aguardando_conciliacao_bancaria',
        'aguardando_d3',
        'liberado_rpa_airtop',
        'enviado_salic',
        'concluido'
    ];

    activeIndex = statusOrder.indexOf(doc.status);
    if (activeIndex === -1) {
        // Trata desvios
        if (doc.status === 'bloqueado_conformidade') { errorAtStep = 2; activeIndex = 2; }
        else if (doc.status === 'revisao_manual') { errorAtStep = 1; activeIndex = 1; }
        else if (doc.status === 'erro_rpa') { errorAtStep = 5; activeIndex = 5; }
        else activeIndex = 0;
    } else {
        // Normaliza index para os 6 círculos visuais
        if (activeIndex > 5) activeIndex = 5;
    }

    return `
${Sidebar()}
    <main class="main-content view-content">
        <header class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <button class="btn btn-secondary" onclick="window.navigate('dashboard')" style="padding: 0.5rem;">
                    <i data-lucide="arrow-left" style="width: 18px;"></i>
                </button>
                <div>
                    <h1>Detalhes da Nota</h1>
                    <p class="page-subtitle">${doc.name}</p>
                </div>
            </div>
            <div class="badge ${(STATUS_MAP[doc.status] || {}).class || 'status-pending'}">
                <span class="badge-dot"></span>
                ${(STATUS_MAP[doc.status] || {}).label || doc.status}
            </div>
        </header>

        <!-- NOVO: Descritivo de Esteira -->
        <div class="card mb-4" style="background: rgba(37, 99, 235, 0.03); border-left: 4px solid var(--primary); padding: 1.25rem;">
            <div style="display: flex; gap: 1rem; align-items: flex-start;">
                <div style="background: var(--primary); color: white; padding: 0.5rem; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="info" style="width: 18px;"></i>
                </div>
                <div>
                    <h4 style="font-size: 14px; margin-bottom: 0.25rem; font-weight: 700; color: var(--text-primary);">Ponto da Esteira: ${(STATUS_MAP[doc.status] || {}).label}</h4>
                    <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">${(STATUS_MAP[doc.status] || {}).description || 'O documento está seguindo o fluxo normal de processamento.'}</p>
                </div>
            </div>
        </div>

        <div class="card mb-4" style="padding: 2rem;">
            <div style="display: flex; justify-content: space-between; position: relative;">
                <div style="position: absolute; top: 15px; left: 40px; right: 40px; height: 2px; background: var(--border-subtle); z-index: 1;"></div>
                ${steps.map((step, index) => {
        let statusClass = '';
        if (errorAtStep !== -1) {
            if (index < errorAtStep) statusClass = 'completed';
            else if (index === errorAtStep) statusClass = 'error';
            else statusClass = '';
        } else if (activeIndex === -1) {
            statusClass = index === 0 ? 'completed' : 'error';
        } else {
            statusClass = index === activeIndex ? 'active' : (index < activeIndex ? 'completed' : '');
        }

        const isActive = statusClass === 'active';
        const isCompleted = statusClass === 'completed';
        const isError = statusClass === 'error';

        let color = 'var(--text-muted)';
        let bg = '#FFF';
        let border = 'var(--border-light)';
        let icon = step.icon;

        if (isCompleted) {
            color = '#FFF';
            bg = 'var(--success)';
            border = 'var(--success)';
            icon = 'check';
        } else if (isActive) {
            color = '#FFF';
            bg = 'var(--primary)';
            border = 'var(--primary)';
        } else if (isError) {
            color = '#FFF';
            bg = 'var(--error)';
            border = 'var(--error)';
            icon = 'x';
        }

        return `
                <div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; flex: 1;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${bg}; border: 2px solid ${border}; color: ${color}; transition: var(--transition);">
                        <i data-lucide="${icon}" style="width: 14px;"></i>
                    </div>
                    <span style="font-size: 11px; font-weight: 600; color: ${isError ? 'var(--error)' : (isActive ? 'var(--primary)' : 'var(--text-secondary)')}">${step.label}</span>
                </div>
                `;
    }).join('')}
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem;">
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="card">
                    <h3 class="h2 mb-4">Dados Extraídos</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                        <div class="info-item">
                            <label>Solicitante (CNPJ)</label>
                            <p class="text-sm" style="font-weight: 600;">${doc.cnpj_emissor || '---'}</p>
                        </div>
                        <div class="info-item">
                            <label>Valor Total</label>
                            <p class="text-sm" style="font-weight: 600; color: var(--primary);">R$ ${doc.valor ? doc.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}</p>
                        </div>
                        <div class="info-item">
                            <label>Data de Emissão</label>
                            <p class="text-sm">${doc.data_emissao ? new Date(doc.data_emissao).toLocaleDateString('pt-BR') : '---'}</p>
                        </div>
                        <div class="info-item">
                            <label>Protocolo SALIC</label>
                            <p class="text-sm">${doc.protocolo_salic || '---'}</p>
                        </div>
                    </div>

                    <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border-subtle);">
                        <label>Rubrica Orçamentária</label>
                        <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem; padding: 1rem; background: var(--bg-sidebar); border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                <i data-lucide="tag" style="width: 16px; color: var(--primary);"></i>
                                <span class="text-sm" style="font-weight: 600;">${doc.rubrica || '<span style="color: var(--primary); font-weight: 500;">Identificada pela IA</span>'}</span>
                            </div>
                            
                            <!-- Só permite vincular/alterar se houver bloqueio -->
                            ${doc.status === 'bloqueado_conformidade' ? `
                                <div style="display: flex; gap: 0.5rem;">
                                    <div style="flex: 1;">
                                        <select id="vincular-rubrica-select" style="width: 100%; padding: 0.5rem; font-size: 13px; border: 1px solid var(--border-light); border-radius: 4px; background: white;">
                                            <option value="">Selecione a rubrica para corrigir...</option>
                                            ${(state.rubricas_disponiveis || []).map((r, idx) => `
                                                <option value="${r.id}" ${doc.rubrica === r.nome || (!doc.rubrica && idx === 0) ? 'selected' : ''}>
                                                    ${r.rubrica_id ? r.rubrica_id + ' - ' : ''}${r.nome}
                                                </option>
                                            `).join('')}
                                        </select>
                                    </div>
                                    <button class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 12px;" onclick="window.handleVincularRubrica('${doc.id}', '${doc.project_id}', ${doc.valor})">
                                        Corrigir Vínculo
                                    </button>
                                </div>
                                <p class="text-xs" style="color: var(--error); margin-top: 0.25rem;">Documento bloqueado por conformidade. Por favor, revise a rubrica vinculada.</p>
                            ` : `
                                <p class="text-xs" style="color: var(--text-muted); margin-top: 0.25rem;">Vínculo de rubrica validado automaticamente para conformidade fiscal.</p>
                            `}
                        </div>
                    </div>
                </div>

                <div class="card">
                    <h3 class="h2 mb-4">Análise de Conformidade</h3>
                    <div style="padding: 1rem; background: ${doc.status.includes('erro') || doc.status.includes('bloqueado') || doc.status.includes('divergencia') ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-sidebar)'}; border-radius: var(--radius-sm); border-left: 3px solid ${doc.status.includes('erro') || doc.status.includes('bloqueado') || doc.status.includes('divergencia') ? 'var(--error)' : 'var(--primary)'};">
                        <p class="text-sm" style="line-height: 1.6; color: var(--text-primary);">
                            ${doc.status.includes('bloqueado') || doc.status.includes('divergencia') || doc.status === 'revisao_manual' ?
            `<strong>Atenção:</strong><br>${doc.justification || doc.just_erro || 'Documento requer análise manual devido a divergências ou baixa confiança no OCR.'}` :
            (doc.justification || 'Aguardando processamento da IA para gerar a análise de conformidade...')
        }
                        </p>
                    </div>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="card">
                    <h3 class="h2 mb-4">Fluxo de Conciliação</h3>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        
                        
                        <!-- Box do Comprovante -->
                        <div style="padding: 1rem; border: 1px dashed var(--border-light); border-radius: var(--radius-sm); background: ${doc.data_pagamento || doc.status === 'aguardando_conciliacao_bancaria' || state.currentComprovante ? 'rgba(16, 185, 129, 0.05)' : 'transparent'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <span class="text-xs" style="font-weight: 600; text-transform: uppercase;">1. Comprovante (Opcional)</span>
                                ${doc.data_pagamento || doc.status === 'aguardando_conciliacao_bancaria' || state.currentComprovante ? '<i data-lucide="check-circle-2" style="width: 16px; color: var(--success);"></i>' : (state.isUploadingComprovante ? '<i data-lucide="loader" class="spin" style="width: 16px; color: var(--primary);"></i>' : '<i data-lucide="clock" style="width: 16px; color: var(--warning);"></i>')}
                            </div>
                            ${(doc.data_pagamento || doc.status === 'aguardando_conciliacao_bancaria' || state.currentComprovante) ?
            `<div style="display: flex; flex-direction: column; gap: 0.25rem;">
                                    <p class="text-xs" style="color: var(--text-secondary); font-weight: 500;">Comprovante recebido:</p>
                                    ${state.currentComprovante ? `<a href="${CONFIG.SUPABASE_URL}/storage/v1/object/public/documentos/${state.currentComprovante.file_path}" target="_blank" class="text-xs" style="color: var(--primary); text-decoration: none;">📄 ${state.currentComprovante.name}</a>` : '<p class="text-xs" style="color: var(--text-muted); font-style: italic;">Nenhum comprovante enviado.</p>'}
                                    <div class="badge status-completed" style="margin-top: 0.5rem; width: fit-content; font-size: 10px;">Etapa Opcional</div>
                                 </div>` :
            (state.isUploadingComprovante ?
                `<div style="padding: 0.5rem; text-align: center;">
                                    <div style="width: 100%; height: 6px; background: var(--bg-sidebar); border-radius: 3px; overflow: hidden; margin-bottom: 0.5rem;">
                                        <div style="width: 60%; height: 100%; background: var(--primary); animation: loading 2s infinite ease-in-out;"></div>
                                    </div>
                                    <p class="text-xs" style="color: var(--primary); font-weight: 600;">Enviando comprovante...</p>
                                 </div>` :
                (doc.status === 'aguardando_comprovante' ?
                    `<button class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 0.5rem;" onclick="document.getElementById('vincular-comprovante-input').click()">Anexar Comprovante</button>
                                 <input type="file" id="vincular-comprovante-input" style="display: none;" onchange="window.handleVincularDocumento('${doc.id}', this.files[0], 'comprovante', { id: '${doc.id}', nome: '${doc.name.replace(/'/g, "\\'")}', valor: ${doc.valor || 0}, cnpj: '${doc.cnpj_emissor || ''}' })" accept=".pdf,image/*">
                                 <p class="text-xs" style="color: var(--text-muted); font-style: italic; margin-top: 0.5rem; text-align: center;">Você pode pular direto para o Extrato</p>` :
                    `<p class="text-xs" style="color: var(--text-muted); font-style: italic;">Aguardando etapa anterior para liberar upload...</p>`))
        }
                        </div>

                        <!-- Box do Extrato -->
                        <div style="padding: 1rem; border: 1px dashed var(--border-light); border-radius: var(--radius-sm); background: ${['aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido'].includes(doc.status) ? 'rgba(37, 99, 235, 0.05)' : 'transparent'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <span class="text-xs" style="font-weight: 600; text-transform: uppercase;">2. Extrato Bancário</span>
                                ${['aguardando_d3', 'enviado_salic', 'concluido'].includes(doc.status) ? '<i data-lucide="check-circle-2" style="width: 16px; color: var(--primary);"></i>' : '<i data-lucide="clock" style="width: 16px; color: var(--warning);"></i>'}
                            </div>
                            ${['aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido'].includes(doc.status) ?
            `<p class="text-xs" style="color: var(--text-secondary);">Conciliado e validado em D-3</p>` :
            (doc.status === 'aguardando_conciliacao_bancaria' || doc.status === 'aguardando_comprovante' ?
                `<button class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;" onclick="document.getElementById('vincular-extrato-input').click()">
                                    <i data-lucide="file-up" style="width: 14px;"></i>
                                    Subir Extrato (OFX/CSV/PDF)
                                 </button>
                                 <input type="file" id="vincular-extrato-input" style="display: none;" onchange="window.handleUploadExtrato(this.files[0], '${doc.project_id}', '${doc.id}', '${state.currentComprovante?.id || ''}')" accept=".ofx,.csv,.pdf">` :
                `<p class="text-xs" style="color: var(--text-muted); font-style: italic;">Aguardando liberação...</p>`)
        }
                        </div>

                        <!-- Box do SALIC -->
                        <div style="padding: 1rem; border: 1px dashed var(--border-light); border-radius: var(--radius-sm); background: ${['enviado_salic', 'concluido'].includes(doc.status) ? 'rgba(5, 150, 105, 0.05)' : 'transparent'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <span class="text-xs" style="font-weight: 600; text-transform: uppercase;">3. Portal SALIC</span>
                                ${['enviado_salic', 'concluido'].includes(doc.status) ? '<i data-lucide="check-circle-2" style="width: 16px; color: var(--success);"></i>' : (doc.status === 'erro_rpa' ? '<i data-lucide="alert-circle" style="width: 16px; color: var(--error);"></i>' : '<i data-lucide="clock" style="width: 16px; color: var(--warning);"></i>')}
                            </div>
                            ${doc.status === 'liberado_rpa_airtop' ?
            `<button class="btn btn-primary" style="width: 100%; font-size: 11px; padding: 0.5rem; background: linear-gradient(135deg, #059669 0%, #10b981 100%); border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);" onclick="window.handleEnviarSalic('${doc.id}')" ${state.loading ? 'disabled' : ''}>
                                    <i data-lucide="plus-circle" style="width: 14px;"></i>
                                    Adicionar documento no SALIC
                                 </button>` :
            (doc.status === 'enviado_salic' || doc.status === 'concluido' ?
                `<div style="display: flex; flex-direction: column; gap: 0.25rem;">
                                    <p class="text-xs" style="color: var(--success); font-weight: 600;">Comprovado com sucesso!</p>
                                    <p class="text-xs" style="color: var(--text-muted);">Protocolo: ${doc.protocolo_salic || 'Gerando...'}</p>
                                 </div>` :
                (doc.status === 'erro_rpa' ?
                    `<div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                        <p class="text-xs" style="color: var(--error); font-weight: 500;">Falha no envio automático:</p>
                                        <p class="text-xs" style="color: var(--text-muted); font-style: italic;">${doc.just_erro || 'Erro no robô SALIC'}</p>
                                        <button class="btn btn-secondary" style="width: 100%; font-size: 10px; padding: 0.3rem;" onclick="window.handleEnviarSalic('${doc.id}')">Tentar Novamente</button>
                                     </div>` :
                    `<p class="text-xs" style="color: var(--text-muted); font-style: italic;">Aguardando liberação financeira (D+3)...</p>`))
        }
                        </div>

                    </div>
                </div>

                <div class="card">
                    <h3 class="h2 mb-4">Arquivo Original (NF)</h3>
                    <div style="aspect-ratio: 3/4; background: var(--bg-sidebar); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; border: 1px solid var(--border-light);">
                        <i data-lucide="file-text" style="width: 48px; color: var(--text-muted);"></i>
                        <p class="text-xs" style="color: var(--text-muted);">${doc.name}</p>
                        <button class="btn btn-secondary" onclick="window.open('${CONFIG.SUPABASE_URL}/storage/v1/object/public/documentos/${doc.file_path}', '_blank')">
                            Visualizar PDF
                        </button>
                    </div>
                </div>

                <div class="card">
                    <h3 class="h2 mb-2">Metadados</h3>
                    <p class="text-xs mb-4">Dados em formato JSON gerados pelo OCR.</p>
                    <div style="max-height: 200px; overflow: auto; background: #1e293b; color: #cbd5e1; padding: 1rem; border-radius: var(--radius-sm); font-family: monospace; font-size: 10px;">
                        <pre style="margin: 0;">${JSON.stringify(doc.json_extraido || {}, null, 2)}</pre>
                    </div>
                </div>
            </div>
        </div>
    </main>
    `;
};

// --- Handlers & API ---

window.handleSolicitanteLogin = async function () {
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
            throw new Error("Esta conta não possui permissão de Solicitante. Use o Portal do Gestor.");
        }

        state.user = data.user;
        window.navigate('solicitante_dashboard');
    } catch (error) {
        alert("Erro no login Solicitante: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleSolicitanteRegister = async function () {
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

            // 3. Importante: Limpar estado e navegar para o login do solicitante para garantir a validação do perfil
            alert("Conta de solicitante criada com sucesso! Faça login para acessar o portal.");
            await supabaseClient.auth.signOut();
            state.user = null;
            window.navigate('solicitante_login');
        }
    } catch (error) {
        alert("Erro ao cadastrar: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleSolicitanteUpload = async function (file) {
    const projectId = document.getElementById('f-upload-project').value;
    if (!file || !projectId) return alert("Selecione um projeto e um arquivo!");

    state.loading = true;
    render();

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt} `;
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
            status: 'processing_ocr',
            tipo_documento: 'nf'
        }).select().single();

        if (dbError) throw dbError;

        // Disparar Webhook para o n8n
        console.log("Notificando n8n (Fornecedor)...", CONFIG.N8N_WEBHOOK_URL);
        if (CONFIG.N8N_WEBHOOK_URL) {
            await fetch(CONFIG.N8N_WEBHOOK_URL, {
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
            })
                .then(res => console.log("n8n ok:", res.status))
                .catch(err => console.error("Erro Webhook n8n:", err));
        }

        alert("Upload concluído! Gestor notificado.");
        await fetchSolicitanteDashboard(); // recarrega a grid
    } catch (error) {
        alert("Erro no upload: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

async function fetchSolicitanteDashboard() {
    if (!supabaseClient || !state.user) return;
    try {
        // Busca projetos vinculados ao fornecedor
        const { data: projData, error: projError } = await supabaseClient
            .from('projeto_fornecedores')
            .select('project_id, projects(id, pronac, nome)');

        if (projError) console.error('Erro ao buscar projetos do fornecedor:', projError);
        state.projects = (projData || []).filter(p => p.projects); // filtra registros com join válido

        // Busca historico de docs (apenas NF para o fornecedor ver o status da despesa)
        const { data: docData, error: docError } = await supabaseClient
            .from('documents')
            .select('*, projects(pronac, nome)')
            .eq('fornecedor_id', state.user.id)
            .or('tipo_documento.eq.nf,tipo_documento.eq.comprovante,tipo_documento.is.null')
            .order('created_at', { ascending: false });

        if (docError) console.error('Erro ao buscar documentos do fornecedor:', docError);
        state.documents = docData || [];
    } catch (err) {
        console.error("Erro dashboard solicitante", err);
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
            throw new Error("Esta é uma conta de Solicitante. Use o Portal do Solicitante.");
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
    const wasFornecedor = state.user?.user_metadata?.role === 'fornecedor';
    await supabaseClient.auth.signOut();
    state.user = null;
    state.userStatus = null;
    window.navigate(wasFornecedor ? 'solicitante_login' : 'login');
};

window.handleForgotPassword = async function () {
    if (!supabaseClient) return;

    const email = document.getElementById('reset-email').value;
    if (!email) return;

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '?recovery=true',
        });

        if (error) throw error;

        showToast("Link de recuperação enviado para o seu e-mail!", 'success');
        setTimeout(() => window.navigate('login'), 3000);
    } catch (error) {
        showToast("Erro ao enviar e-mail: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleUpdatePassword = async function () {
    if (!supabaseClient) return;

    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-new-password').value;

    if (password !== confirm) {
        return showToast("As senhas não coincidem!", 'error');
    }

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;

        showToast("Senha redefinida com sucesso! Faça login agora.", 'success');
        setTimeout(() => window.navigate('login'), 3000);
    } catch (error) {
        showToast("Erro ao atualizar senha: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};


const FinanceiroView = () => {
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

    state.chartData = { labels: chartLabels, data: chartData };

    return `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <h1>Relatórios Financeiros</h1>
                <p class="page-subtitle">Indicadores de execução e conformidade do projeto.</p>
            </div>
            <div style="min-width: 250px;">
                <select onchange="window.navigate('financeiro', this.value)">
                    <option value="">Todos os Projetos</option>
                    ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
            </div>
        </div>
    </header>

    <div class="metrics-grid">
        <div class="card metric-card">
            <p class="metric-label">Total Executado</p>
            <div class="metric-value">R$ ${totalExecutado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card metric-card">
            <p class="metric-label">Pendente Conformidade</p>
            <div class="metric-value" style="color: var(--warning);">${pendentesConformidade}</div>
        </div>
        <div class="card metric-card">
            <p class="metric-label">Pendente Conciliação</p>
            <div class="metric-value" style="color: var(--error);">${pendentesConciliacao}</div>
        </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
        <div class="card">
            <h3 class="h2 mb-4">Execução por Rubrica</h3>
            <div style="height: 300px;">
                ${chartLabels.length > 0 ? '<canvas id="rubricasChart"></canvas>' : '<p class="text-sm" style="text-align: center; padding-top: 4rem; color: var(--text-muted);">Sem dados para o gráfico.</p>'}
            </div>
        </div>
        <div class="card">
            <h3 class="h2 mb-1">Status de Conformidade</h3>
            <p class="text-xs" style="color: var(--text-muted); margin-bottom: 1.5rem; line-height: 1.4;">Resumo da saúde jurídica e operacional do seu projeto perante o SALIC e a análise automática IA.</p>
            <div style="display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="text-sm">Documentos validados</span>
                    <span class="badge status-completed">Bom</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="text-sm">Certidões negativas</span>
                    <span class="badge status-completed">Regular</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="text-sm">Pendências SALIC</span>
                    <span class="badge status-pending">1 pendência</span>
                </div>
            </div>
        </div>
    </div>
</main>
`;
};

const ConciliacaoView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <h1>Conciliação Bancária</h1>
                <p class="page-subtitle">Cruze o extrato bancário com as despesas analisadas.</p>
            </div>
            <div style="min-width: 250px;">
                <select onchange="window.navigate('conciliacao', this.value)">
                    <option value="">Selecione o Projeto...</option>
                    ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
            </div>
        </div>
    </header>

    ${!state.filters.project ? `
        <div class="card" style="text-align: center; padding: 4rem;">
            <div class="empty-state-icon" style="margin: 0 auto 1rem;"><i data-lucide="building-2"></i></div>
            <p style="color: var(--text-muted);">Selecione um projeto para iniciar a conciliação bancária.</p>
        </div>
    ` : `
        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 2rem;">
            <div class="card">
                <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
                    <div style="width: 42px; height: 42px; background: #FFF100; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);">
                        <img src="https://upload.wikimedia.org/wikipedia/pt/thumb/3/3b/Logo_Banco_do_Brasil.png/300px-Logo_Banco_do_Brasil.png" style="width: 24px;" alt="BB">
                    </div>
                    <div>
                        <h3 class="h2">Extrato Bancário</h3>
                        <p class="text-xs" style="color: var(--success); font-weight: 600;">Conectado via API</p>
                    </div>
                </div>
                
                <div style="padding: 1.25rem; background: var(--bg-sidebar); border-radius: var(--radius-sm); border: 1px solid var(--border-light); margin-bottom: 1.5rem;">
                    <p class="text-xs mb-2" style="font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Status da Conta</p>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="text-sm">Sincronizado em:</span>
                        <span class="text-sm" style="font-weight: 600;">${state.extSorted && state.extSorted.length > 0 ? new Date().toLocaleDateString('pt-BR') : 'Aguardando...'}</span>
                    </div>
                </div>

                <button class="btn btn-primary" style="width: 100%; background: #0038A8;" onclick="window.handleSyncBB('${state.filters.project}')" ${state.loading ? 'disabled' : ''}>
                    <i data-lucide="refresh-cw" class="${state.loading ? 'spin' : ''}"></i>
                    Sincronizar BB
                </button>
                
                <p class="text-xs" style="margin-top: 1rem; line-height: 1.5; color: var(--text-muted);">
                    As transações são buscadas diretamente na API do Banco do Brasil para garantir a conformidade absoluta.
                </p>
            </div>

            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center;" class="mb-4">
                    <h3 class="h2">Transações Bancárias</h3>
                    <button class="btn btn-secondary" style="font-size: 12px;" onclick="window.handleRunN8NReconciliation()" ${state.loading ? 'disabled' : ''}>
                        <i data-lucide="brain" style="width: 14px;"></i>
                        Match Inteligente
                    </button>
                </div>

                <div class="data-table-container">
                    ${state.extSorted = [...state.extratos].sort((a, b) => new Date(b.data_transacao) - new Date(a.data_transacao)), ''}
                    ${state.extratos.length === 0 ? `<p class="text-sm" style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhuma transação importada.</p>` : `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Data</th>
                                    <th>Descrição</th>
                                    <th style="text-align: right;">Valor</th>
                                    <th style="text-align: right;">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${state.extSorted.map(ex => `
                                    <tr>
                                        <td class="text-sm">${new Date(ex.data_transacao).toLocaleDateString('pt-BR')}</td>
                                        <td>
                                            <div style="font-weight: 500;">${ex.descricao}</div>
                                            ${ex.documento_referencia ? `<div class="text-xs">Ref: ${ex.documento_referencia}</div>` : ''}
                                        </td>
                                        <td style="text-align: right; font-weight: 600; color: ${ex.valor < 0 ? 'var(--error)' : 'var(--success)'};">
                                            R$ ${Math.abs(ex.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td style="text-align: right;">
                                            ${ex.conciliado_com_despesa_id ?
        `<span class="badge status-completed">Conciliado</span>` :
        `<button class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="window.handleShowMatchForm('${ex.id}', ${ex.valor})">Conciliar</button>`
    }
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        </div>
    `}
</main>
`;

const RubricaInstructionsModal = () => `
<div class="modal-overlay" onclick="state.showRubricaInstructions = false; render();">
    <div class="modal-content" onclick="event.stopPropagation()">
        <button class="modal-close" onclick="state.showRubricaInstructions = false; render();">
            <i data-lucide="x" style="width: 18px;"></i>
        </button>
        <h3 class="h2 mb-4">Como obter a Planilha Orçamentária</h3>
        <p class="text-sm text-secondary mb-6">Siga os passos abaixo no portal SALIC para gerar o arquivo correto:</p>
        
        <div class="steps-list">
            <div class="step-item">
                <div class="step-number">1</div>
                <div class="step-text">Acesse <strong>salic.cultura.gov.br</strong> e faça login com suas crednciais ou com sua conta Gov.br.</div>
            </div>
            <div class="step-item">
                <div class="step-number">2</div>
                <div class="step-text">No menu superior, vá em <strong>Projeto → Listar Projetos</strong>.</div>
            </div>
            <div class="step-item">
                <div class="step-number">3</div>
                <div class="step-text">Busque pelo <strong>PRONAC</strong> do seu projeto e localize-o na lista.</div>
            </div>
            <div class="step-item">
                <div class="step-number">4</div>
                <div class="step-text"><strong>Clique duas vezes</strong> sobre o projeto para abrir os detalhes.</div>
            </div>
            <div class="step-item">
                <div class="step-number">5</div>
                <div class="step-text">Clique no <strong>botão de ações</strong> (ícone vermelho flutuante no canto inferior direito).</div>
            </div>
            <div class="step-item">
                <div class="step-number">6</div>
                <div class="step-text">Selecione a opção <strong>"Imprimir Projeto"</strong>.</div>
            </div>
            <div class="step-item">
                <div class="step-number">7</div>
                <div class="step-text">Na tela que abrir, marque <strong>APENAS</strong> a opção <strong>"Planilha Orçamentária"</strong>.</div>
            </div>
            <div class="step-item">
                <div class="step-number">8</div>
                <div class="step-text">Clique em <strong>Imprimir</strong> e, na janela de impressão do sistema, escolha <strong>Salvar como PDF</strong>.</div>
            </div>
            <div class="step-item">
                <div class="step-number">9</div>
                <div class="step-text">Volte aqui no CultOps e faça o upload do arquivo gerado.</div>
            </div>
        </div>
        
        <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" onclick="state.showRubricaInstructions = false; render();">
            Entendi, vou buscar o PDF
        </button>
    </div>
</div>
`;

const OrcamentoView = () => {
    const activeProject = state.projects.find(p => p.id === state.filters.project);

    // Agrupar rubricas de forma segura
    const rubricasPorEtapa = (state.rubricas || []).reduce((acc, r) => {
        const etapa = r.etapa || 'Etapa não definida';
        if (!acc[etapa]) acc[etapa] = {};
        const local = r.uf_municipio || 'Local não definido';
        if (!acc[etapa][local]) acc[etapa][local] = [];
        acc[etapa][local].push(r);
        return acc;
    }, {});

    const IMPORT_MESSAGES = {
        'uploading': 'Enviando PDF...',
        'processing': 'Lendo o documento...',
        'extracting': 'Extraindo rubricas...',
        'saving': 'Salvando no sistema...',
        'concluido': 'Rubricas importadas com sucesso!',
        'erro': 'Erro ao processar o PDF. Verifique se é a Planilha Orçamentária correta.'
    };

    const headerContent = `
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <h1>Gestão Orçamentária</h1>
                <p class="page-subtitle">Acompanhe as rubricas importadas do SALIC para o projeto.</p>
            </div>
            <div style="display: flex; gap: 1rem; align-items: flex-end;">
                <div style="min-width: 250px;">
                    <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: 0.25rem; display: block;">Selecione o Projeto</label>
                    <select onchange="window.navigate('orcamento', this.value)" style="background: white; border: 1px solid var(--border-light); padding: 0.5rem; border-radius: 6px;">
                        <option value="">Escolha um projeto...</option>
                        ${state.projects.map(p => `
                            <option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>
                                ${p.pronac} - ${p.nome}
                            </option>
                        `).join('')}
                    </select>
                </div>
            </div>
        </div>
    `;

    const progressContent = state.importState ? `
        <div class="card mb-6" style="background: rgba(37, 99, 235, 0.05); border-color: var(--primary); padding: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i data-lucide="${state.importState === 'concluido' ? 'check-circle' : (state.importState === 'erro' ? 'alert-circle' : 'loader-2')}" 
                       class="${['concluido', 'erro'].includes(state.importState) ? '' : 'spin'}" 
                       style="width: 20px; color: var(--primary);"></i>
                    <h4 class="font-bold" style="color: var(--primary); margin: 0;">${IMPORT_MESSAGES[state.importState] || 'Processando...'}</h4>
                </div>
                <span class="text-sm font-bold text-primary">${state.importProgress || 0}%</span>
            </div>
            <div style="width: 100%; height: 6px; background: var(--border-light); border-radius: 3px; overflow: hidden;">
                <div style="width: ${state.importProgress}%; height: 100%; background: var(--primary); transition: width 0.5s ease;"></div>
            </div>
            ${state.importState === 'erro' ? `<p class="text-xs mt-2" style="color: var(--error);">${state.error || ''}</p>` : ''}
        </div>
    ` : '';

    const emptyContent = `
        <div class="card" style="text-align: center; padding: 4rem;">
            <div class="empty-state-icon" style="margin: 0 auto 1rem;"><i data-lucide="layout-list"></i></div>
            <p style="color: var(--text-muted);">Selecione um projeto acima para visualizar ou importar o orçamento do SALIC.</p>
        </div>
    `;

    const instructionsAndUpload = `
        <div class="card mb-6" style="padding: 2.5rem; border: 1px solid var(--border-light); background: #ffffff;">
            <div style="display: flex; gap: 3rem; align-items: flex-start;">
                <div style="flex: 1.2;">
                    <h3 class="h2 mb-4">Importar Rubricas</h3>
                    <p class="text-sm text-secondary mb-3">1. Acesse o SALIC e gere o PDF da Planilha Orçamentária do seu projeto.</p>
                    <a href="#" class="help-link mb-6" onclick="state.showRubricaInstructions = true; render();">
                        Como fazer isso? <i data-lucide="arrow-right" style="width: 14px;"></i>
                    </a>
                    
                    <div style="margin-top: 2rem;">
                         <p class="text-sm text-secondary mb-3">2. Faça o upload do PDF aqui:</p>
                         <div class="upload-card-interactive" onclick="document.getElementById('rubrica-pdf-input').click()">
                            <input type="file" id="rubrica-pdf-input" style="display: none;" accept=".pdf" onchange="window.handleRubricaUpload(this.files[0])">
                            <i data-lucide="file-text" style="width: 38px; height: 38px; color: var(--primary); margin-bottom: 1rem;"></i>
                            <p class="text-sm font-semibold">Arraste o PDF ou clique para selecionar</p>
                            <p class="text-xs text-muted mt-2">Apenas arquivos .pdf gerados pelo SALIC</p>
                         </div>
                    </div>
                    
                    <button class="btn btn-primary" style="width: 100%; height: 48px; font-size: 16px;" onclick="document.getElementById('rubrica-pdf-input').click()" ${state.importState ? 'disabled' : ''}>
                        <i data-lucide="upload-cloud"></i>
                        Importar Rubricas
                    </button>
                    ${state.importState ? `<p class="text-xs mt-4 text-center color-primary">${IMPORT_MESSAGES[state.importState]}</p>` : ''}
                </div>
                
                <div style="flex: 0.8; background: var(--bg-sidebar); border-radius: var(--radius-md); padding: 1.5rem; border: 1px solid var(--border-subtle);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; color: var(--primary);">
                        <i data-lucide="info" style="width: 18px;"></i>
                        <span class="font-bold text-sm">Importante</span>
                    </div>
                    <p class="text-xs text-secondary" style="line-height: 1.6;">
                        O PDF deve ter sido gerado diretamente pelo portal SALIC (Opção "Imprimir"). 
                        O sistema utiliza OCR inteligente para ler as colunas de Etapa, Local, Nome da Rubrica e Valores.
                    </p>
                    <div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-light);">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; color: var(--text-secondary);">
                            <i data-lucide="history" style="width: 18px;"></i>
                            <span class="font-bold text-sm">Versões Anterior (Backups)</span>
                        </div>
                        ${state.rubrica_versions.length === 0 ? `
                            <p class="text-xs text-muted italic">Nenhum backup de versão anterior encontrado.</p>
                        ` : `
                            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                                ${state.rubrica_versions.map(v => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: white; border: 1px solid var(--border-light); border-radius: 4px;">
                                        <div>
                                            <p class="text-xs font-bold" style="margin: 0;">${v.version_name}</p>
                                            <p class="text-xs text-muted" style="margin: 0;">${new Date(v.created_at).toLocaleDateString('pt-BR')} • ${v.total_rubricas} rubricas</p>
                                        </div>
                                        <a href="${v.file_path}" target="_blank" class="btn btn-secondary" style="padding: 4px 8px; font-size: 10px;">
                                            <i data-lucide="download" style="width: 12px;"></i> Baixar
                                        </a>
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                </div>
            </div>
        </div>
    `;

    const rubricasContent = Object.entries(rubricasPorEtapa).length === 0 ? `
        <div class="empty-state card">
            <i data-lucide="folder-search" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 1rem;"></i>
            <h3 class="h2">Nenhuma rubrica sincronizada</h3>
            <p class="text-muted text-sm">Selecione o projeto e suba a planilha orçamentária do SALIC acima.</p>
        </div>
    ` : Object.entries(rubricasPorEtapa).map(([etapa, locais]) => `
        <div class="etapa-section mb-6">
            <h2 class="etapa-title">
                ${etapa}
            </h2>
            ${Object.entries(locais).map(([local, rubricas]) => `
                <div class="local-group mb-4">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-muted mb-3">📍 ${local}</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem;">
                        ${rubricas.map(r => {
        const aprovado = parseFloat(r.valor_aprovado || 0);
        const utilizado = parseFloat(r.valor_utilizado || 0);
        const percentual = aprovado > 0 ? (utilizado / aprovado) * 100 : 0;
        const saldo = aprovado - utilizado;
        return `
                                <div class="card rubric-card" style="padding: 1.25rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                                        <div style="max-width: 70%;">
                                            <h5 class="font-bold text-sm" style="line-height: 1.2;">
                                                <span style="color: var(--primary); font-family: monospace;">[${r.rubrica_id || '---'}]</span> ${r.nome}
                                            </h5>
                                            <p class="text-xs text-muted mt-1">Qtde: ${r.quantidade || 1} x R$ ${(parseFloat(r.valor_unitario || r.valor_aprovado || 0)).toLocaleString('pt-BR')}</p>
                                        </div>
                                        <div style="text-align: right;">
                                            <div class="text-xs font-bold ${percentual > 90 ? 'text-error' : 'text-primary'}">${percentual.toFixed(1)}%</div>
                                        </div>
                                    </div>
                                    <div style="width: 100%; height: 6px; background: var(--border-light); border-radius: 3px; overflow: hidden; margin-bottom: 0.75rem;">
                                        <div style="width: ${Math.min(percentual, 100)}%; height: 100%; background: ${percentual > 100 ? 'var(--error)' : 'var(--primary)'}; transition: width 0.3s ease;"></div>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                        <div>
                                            <span class="text-muted">Aprovado:</span>
                                            <span class="font-semibold">R$ ${aprovado.toLocaleString('pt-BR')}</span>
                                        </div>
                                        <div>
                                            <span class="text-muted">Saldo:</span>
                                            <span class="font-bold ${saldo < 0 ? 'color-error' : 'color-success'}">R$ ${saldo.toLocaleString('pt-BR')}</span>
                                        </div>
                                    </div>
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');

    return `
        ${Sidebar()}
        <main class="main-content view-content">
            <header class="content-header">${headerContent}</header>
            ${!state.filters.project ? emptyContent : `
                <div class="budget-container">
                    ${instructionsAndUpload}
                    ${progressContent}
                    ${rubricasContent}
                </div>
            `}
        </main>
    `;
};

const CapturedProjectModal = () => {
    const p = state.capturedProject;
    if (!p) return '';

    return `
    <div class="modal-overlay" onclick="state.showCapturedProjectModal = false; render();">
        <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 700px;">
            <button class="modal-close" onclick="state.showCapturedProjectModal = false; render();">
                <i data-lucide="x" style="width: 18px;"></i>
            </button>
            <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem;">
                <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--success); display: flex; align-items: center; justify-content: center; color: white;">
                    <i data-lucide="check" style="width: 28px;"></i>
                </div>
                <div>
                    <h3 class="h2" style="margin-bottom: 0.25rem;">Projeto Importado com Sucesso!</h3>
                    <p class="text-sm text-secondary">Os dados integrados do SALIC já estão disponíveis.</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; background: var(--bg-sidebar); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: 2rem;">
                <div class="info-item">
                    <label>PRONAC</label>
                    <p class="text-sm font-bold">${p.pronac || '---'}</p>
                </div>
                <div class="info-item">
                    <label>Nome do Projeto</label>
                    <p class="text-sm font-bold">${p.nome || '---'}</p>
                </div>
                <div class="info-item">
                    <label>Proponente</label>
                    <p class="text-sm">${p.propoente || '---'}</p>
                </div>
                <div class="info-item">
                    <label>UF</label>
                    <p class="text-sm">${p.uf || '---'}</p>
                </div>
                <div class="info-item">
                    <label>Valor Aprovado</label>
                    <p class="text-sm font-bold" style="color: var(--primary);">R$ ${(p.valor_aprovado ? parseFloat(p.valor_aprovado) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div class="info-item">
                    <label>Valor Arrecadado</label>
                    <p class="text-sm font-bold" style="color: var(--success);">R$ ${(p.valor_captado ? parseFloat(p.valor_captado) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div class="info-item" style="grid-column: span 2;">
                    <label>Mecanismo</label>
                    <p class="text-sm">${p.Mecanismo || p['Mecanismo'] || '---'}</p>
                </div>
            </div>

            <button class="btn btn-primary" style="width: 100%; height: 48px; font-size: 16px;" onclick="state.showCapturedProjectModal = false; window.navigate('projects'); render();">
                <i data-lucide="arrow-left" style="width: 18px; margin-right: 0.5rem;"></i>
                Voltar
            </button>
        </div>
    </div>
    `;
};


window.navigate = async function (view, id = null) {
    state.currentView = view;
    state.error = null; // Limpa erros ao navegar

    if (view === 'dashboard') {
        await fetchProjects(); // Sempre recarrega projetos ao voltar ao dashboard
        await fetchDocuments();
    } else if (view === 'fornecedor_dashboard') {
        await fetchFornecedorDashboard();
    } else if (view === 'upload') {
        await fetchProjects();
        // Dispara o carregamento das rubricas se já houver projeto selecionado
        if (state.filters.project) {
            setTimeout(() => window.handleProjectSelectChange(state.filters.project), 100);
        }
    } else if (view === 'orcamento' || view === 'financeiro') {
        await fetchProjects();
        await fetchCatalogoRubricas();
        if (id) state.filters.project = id;
        else if (!state.filters.project && state.projects.length > 0) state.filters.project = state.projects[0].id;

        if (state.filters.project) {
            await fetchRubricas(state.filters.project);
            await fetchRubricaVersions(state.filters.project);
        }
    } else if (view === 'details' && id) {
        await fetchDocumentDetails(id);
    } else if (view === 'admin_solicitantes') {
        await fetchProjects();
        await fetchSolicitantesAdmin();
    } else if (view === 'conciliacao') {
        await fetchProjects();
        if (id) state.filters.project = id;
        else if (!state.filters.project && state.projects.length > 0) state.filters.project = state.projects[0].id;

        if (state.filters.project) await fetchExtratos(state.filters.project);
    } else if (view === 'projects' || view === 'create_project') {
        await fetchProjects();
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
    } catch (err) {
        console.error("Erro fetch catalogo:", err);
    }
}

async function fetchSolicitantesAdmin() {
    if (!supabaseClient) return;
    try {
        // 1. Pegar todos os solicitantes (para o select)
        const { data: allF } = await supabaseClient.from('fornecedores').select('*').order('razao_social');
        state.all_solicitantes = allF || [];

        // 2. Pegar vínculos dos projetos que o gestor é dono
        if (state.projects.length === 0) {
            state.vinculos_solicitantes = [];
            return;
        }

        const projectIds = state.projects.map(p => p.id);
        const { data: vinculos } = await supabaseClient
            .from('projeto_fornecedores')
            .select('*, fornecedores(*), projects(*)')
            .in('project_id', projectIds);

        state.vinculos_solicitantes = vinculos || [];
    } catch (err) {
        console.error("Erro fetch admin solicitantes:", err);
    }
}

window.handleInviteSolicitante = async function () {
    const fornecedorId = document.getElementById('invite-solicitante-id').value;
    const projectId = document.getElementById('invite-project-id').value;

    if (!fornecedorId || !projectId) return alert('Selecione solicitante e projeto!');

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
        alert("Solicitante vinculado com sucesso!");
        await fetchSolicitantesAdmin();
    } catch (err) {
        alert("Erro ao vincular: " + (err.code === '23505' ? "Este solicitante já está vinculado a este projeto." : err.message));
    } finally {
        state.loading = false;
        render();
    }
};

window.handleRemoveVinculo = async function (vinculoId) {
    if (!confirm("Tem certeza que deseja remover este acesso?")) return;

    try {
        const { error } = await supabaseClient
            .from('projeto_fornecedores')
            .delete()
            .eq('id', vinculoId);

        if (error) throw error;
        await fetchSolicitantesAdmin();
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
    } catch (err) {
        console.error("Erro fetch rubricas:", err);
    }
}

async function fetchRubricaVersions(projectId) {
    if (!supabaseClient || !projectId) return;
    try {
        const { data, error } = await supabaseClient
            .from('rubricas_versions')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (!error && data) state.rubrica_versions = data;
    } catch (err) {
        console.error("Erro fetch rubrica versions:", err);
    }
}

window.handleCreateRubrica = async function () {
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
    } catch (err) {
        alert("Erro ao criar rubrica: " + err.message);
    } finally {
        state.loading = false;
        render();
    }
};

async function fetchDocumentDetails(id, silent = false) {
    // Se o supabase ou o usuário não estiver pronto, aguarda até 3s e tenta de novo
    if (!supabaseClient || !state.user) {
        if (!silent) {
            state.loading = true;
            render();
            await new Promise(resolve => setTimeout(resolve, 1500));
            if (!supabaseClient || !state.user) {
                console.error("fetchDocumentDetails: Supabase ou usuário não disponível.");
                state.loading = false;
                render();
                return;
            }
        } else {
            return;
        }
    }

    if (!silent) {
        state.loading = true;
        render();
    }

    try {
        // Tenta buscar com join completo
        let { data, error } = await supabaseClient
            .from('documents')
            .select('*, projects(nome, pronac), despesas(*)')
            .eq('id', id)
            .single();

        // 2. Fallback: se o join falhar, tenta sem despesas
        if (error && error.code === 'PGRST200') {
            throw error;
        }

        state.currentDocument = data;

        // Busca comprovante vinculado se existir
        const { data: compList } = await supabaseClient
            .from('documents')
            .select('*')
            .eq('nf_vinculada_id', id)
            .maybeSingle();

        state.currentComprovante = compList;

        // Traz rubricas se precisar vincular
        if (data && data.project_id) {
            const { data: rubData } = await supabaseClient
                .from('rubricas')
                .select('id, nome, rubrica_id')
                .eq('project_id', data.project_id)
                .order('nome');
            state.rubricas_disponiveis = rubData || [];
        }

    } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
        state.currentDocument = null;
        if (!silent) {
            showToast("Erro ao carregar detalhes do documento: " + err.message, 'error');
        }
    } finally {
        if (!silent) state.loading = false;
        render();
    }
}

window.handleVincularRubrica = async function (documentId, projectId, valorDespesa) {
    const rubricaId = document.getElementById('vincular-rubrica-select').value;
    if (!rubricaId) return alert('Selecione uma rubrica!');
    if (valorDespesa === undefined || valorDespesa === null) valorDespesa = 0;

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
        if (CONFIG.N8N_WEBHOOK_VALIDATION_URL) {
            fetch(CONFIG.N8N_WEBHOOK_VALIDATION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({ document_id: documentId, cnpj_fornecedor: doc.cnpj_emissor })
            }).then(r => console.log("n8n Validation Triggered:", r.status))
                .catch(e => showToast("Erro ao notificar n8n: " + e.message, 'error'));
        }

        await fetchDocumentDetails(documentId);
    } catch (err) {
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

    // Mostra Notas Fiscais, Comprovantes e registros sem tipo (legado)
    query = query.or('tipo_documento.eq.nf,tipo_documento.eq.comprovante,tipo_documento.is.null');

    // Filtros adicionais
    if (state.filters.project) {
        query = query.eq('project_id', state.filters.project);
    }

    if (state.filters.search) {
        const term = state.filters.search.trim();
        query = query.ilike('name', `%${term}%`);
    }

    if (state.filters.startDate) {
        query = query.gte('created_at', state.filters.startDate + 'T00:00:00');
    }

    if (state.filters.endDate) {
        query = query.lte('created_at', state.filters.endDate + 'T23:59:59');
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
        console.error("Erro fetchDocuments:", error);
        return;
    }
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

        showToast("Documento excluído com sucesso.", 'success');
        await fetchDocuments();
        render();
    } catch (error) {
        showToast("Erro ao excluir: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleFetchSalicProject = async function () {
    const pronac = document.getElementById('busca-pronac').value.trim();
    if (!pronac || !state.user) return;

    state.loading = true;
    state.error = null;
    render();

    try {
        if (!CONFIG.N8N_WEBHOOK_SALIC_PROJECT_URL) {
            throw new Error("URL do Webhook do n8n não configurada.");
        }

        const response = await fetch(CONFIG.N8N_WEBHOOK_SALIC_PROJECT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            mode: 'cors',
            body: JSON.stringify({ pronac: pronac, user_id: state.user.id })
        });

        if (!response.ok) {
            throw new Error(`Erro de comunicação com o webhook: ${response.status}`);
        }

        const rawData = await response.json();
        const data = Array.isArray(rawData) ? rawData[0] : rawData;

        const isNotFound =
            (data.message && data.message.toLowerCase().includes("não encontrado")) ||
            (data.pronac === null && data.nome === null);

        if (isNotFound || data.success === false || data.error) {
            const errorMsg = data.message || data.error || "Projeto não encontrado no SALIC. Verifique o número do PRONAC.";
            state.error = errorMsg;
            throw new Error(errorMsg);
        }

        showToast(data.message || `Projeto importado com sucesso do SALIC!`, 'success');

        // NOVO: Exibe o detalhamento do projeto captado
        state.capturedProject = data;
        state.showCapturedProjectModal = true;

        // Recarrega a lista de projetos em background
        fetchProjects();
        render();

    } catch (err) {
        state.error = err.message;
        showToast(err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.showProjectDetails = function (projectId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    state.capturedProject = project;
    state.showCapturedProjectModal = true;
    render();
};

window.handleRubricaUpload = async function (file) {
    if (!file) return;
    const project = state.projects.find(p => p.id === state.filters.project);
    if (!project) return alert("Selecione um projeto primeiro!");

    state.importState = 'uploading';
    state.importProgress = 10;
    render();

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `rubricas_pronac_${project.pronac}_${Date.now()}.${fileExt}`;
        const filePath = `${state.user.id}/${fileName}`;

        // 1. Upload to Supabase Storage
        const { error: uploadError } = await supabaseClient.storage.from('documentos').upload(filePath, file);
        if (uploadError) throw uploadError;

        // 2. Salvar registro na tabela documents (tipo planilha_orcamentaria)
        const { data: docData, error: dbError } = await supabaseClient
            .from('documents')
            .insert({
                user_id: state.user.id,
                project_id: project.id,
                name: file.name,
                size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                file_path: filePath,
                status: 'processing_ocr',
                tipo_documento: 'planilha_orcamentaria'
            })
            .select()
            .single();

        if (dbError) throw dbError;

        state.importState = 'processing';
        state.importProgress = 30;
        render();

        // 3. Notify Webhook
        const payload = {
            document_id: docData.id,
            project_id: project.id,
            user_id: state.user.id,
            file_path: filePath,
            bucket: 'documentos'
        };

        // Simulação de progresso enquanto espera o webhook
        let progress = 30;
        const interval = setInterval(() => {
            if (progress < 90 && state.importState !== 'concluido' && state.importState !== 'erro') {
                progress += 2;
                state.importProgress = progress;
                if (progress > 45) state.importState = 'processing';
                if (progress > 60) state.importState = 'extracting';
                if (progress > 85) state.importState = 'saving';
                render();
            } else {
                clearInterval(interval);
            }
        }, 1500);

        const response = await fetch(CONFIG.N8N_WEBHOOK_SALIC_IMPORT_RUBRICAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        clearInterval(interval);

        if (!response.ok) throw new Error("Erro no processamento do arquivo pelo servidor.");

        const rawResult = await response.json();
        const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;

        if (result.success) {
            state.importState = 'concluido';
            state.importProgress = 100;
            showToast(`${result.rubricas_importadas} rubricas importadas com sucesso!`, 'success');
            await fetchRubricas(project.id);
        } else {
            state.importState = 'erro';
            state.error = result.message || "O servidor não conseguiu extrair as rubricas. Verifique se o arquivo PDF é a 'Planilha Orçamentária' oficial do SALIC.";
            console.error("Erro no processamento das rubricas:", result);
        }
    } catch (err) {
        state.importState = 'erro';
        state.error = "Erro técnico: " + err.message;
        console.error("Falha técnica no upload de rubricas:", err);
        showToast(err.message, 'error');
    } finally {
        render();
        // Limpar estado após alguns segundos se for sucesso
        if (state.importState === 'concluido') {
            setTimeout(() => {
                if (state.importState === 'concluido') {
                    state.importState = null;
                    state.importProgress = 0;
                    render();
                }
            }, 5000);
        }
    }
};

window.handleDeleteProject = async function (id, nome) {
    // Trava de segurança: Verifica se o usuário é admin
    if (state.user?.user_metadata?.role !== 'admin') {
        showToast("Acesso negado: Apenas administradores podem excluir projetos.", 'error');
        return;
    }

    if (!confirm(`Tem certeza que deseja excluir o projeto "${nome}"? Esta ação excluirá todos os documentos, rubricas e despesas vinculadas a ele.`)) return;

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('projects')
            .delete()
            .eq('id', id);

        if (error) throw error;

        showToast("Projeto excluído com sucesso.", 'success');
        if (state.filters.project === id) state.filters.project = '';

        await fetchProjects();
        render();
    } catch (error) {
        showToast("Erro ao excluir projeto: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

// --- Settings & Credentials ---

const ConfiguracoesView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <h1>Configurações</h1>
        <p class="page-subtitle">Gerencie suas credenciais e preferências da conta.</p>
    </header>

    <div style="max-width: 800px;">
        <!-- Credenciais Banco do Brasil -->
        <div class="card mb-4" style="border-left: 4px solid #fff100;">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
                <img src="https://upload.wikimedia.org/wikipedia/pt/thumb/3/3b/Logo_Banco_do_Brasil.png/300px-Logo_Banco_do_Brasil.png" style="width: 24px;" alt="BB">
                <h3 class="h2">Integração Banco do Brasil (API)</h3>
            </div>
            <p class="text-xs mb-4">Credenciais do Portal do Desenvolvedor BB para consulta automática de extratos.</p>

            <form onsubmit="event.preventDefault(); window.handleSaveBBSettings();">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div class="form-group">
                        <label>Client ID</label>
                        <input type="text" id="bb-client-id" placeholder="eyJhbGci..." value="${state.settings.bb_client_id || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Client Secret</label>
                        <input type="password" id="bb-client-secret" placeholder="••••••••" value="${state.settings.bb_client_secret ? '********' : ''}" required>
                    </div>
                </div>
                <div class="form-group mb-4">
                    <label>Developer Application Key (X-Developer-Key)</label>
                    <input type="text" id="bb-developer-key" placeholder="6f8f..." value="${state.settings.bb_developer_key || ''}" required>
                </div>

                <div style="padding: 1rem; background: #fffcf0; border-radius: var(--radius-sm); margin-bottom: 1.5rem; display: flex; gap: 0.75rem; align-items: flex-start; border: 1px solid #ffeeba;">
                    <i data-lucide="info" style="width: 18px; color: #856404; flex-shrink: 0;"></i>
                    <p class="text-xs" style="color: #856404; line-height: 1.5;">
                        <strong>Nota Técnica:</strong> Essa integração requer um certificado digital (.key/.pem) configurado no servidor do n8n para autenticação mTLS (Segurança Bancária).
                    </p>
                </div>

                <button class="btn btn-primary" style="background: #0038A8;">
                    ${state.loading ? 'Salvando...' : 'Salvar Credenciais BB'}
                </button>
            </form>
        </div>

        <!-- Credenciais SALIC -->
        <div class="card mb-4">
            <h3 class="h2 mb-4">Conexão SALIC (Gov.br)</h3>
            <p class="text-xs mb-4">Credenciais para o robô de envio automático de comprovantes ao MinC via Airtop.</p>

            <form onsubmit="event.preventDefault(); window.handleSaveSettings();">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                    <div class="form-group">
                        <label>Usuário / CPF</label>
                        <input type="text" id="salic-user" placeholder="000.000.000-00" value="${state.settings.salic_user || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Senha</label>
                        <input type="password" id="salic-pass" placeholder="••••••••" value="${state.settings.salic_pass ? '********' : ''}" required>
                    </div>
                </div>

                <div style="padding: 1rem; background: var(--bg-sidebar); border-radius: var(--radius-sm); margin-bottom: 1.5rem; display: flex; gap: 0.75rem; align-items: flex-start;">
                    <i data-lucide="shield-check" style="width: 18px; color: var(--success); flex-shrink: 0;"></i>
                    <p class="text-xs" style="color: var(--text-secondary); line-height: 1.5;">
                        <strong>Seguro:</strong> Suas credenciais são criptografadas e utilizadas apenas para comunicação oficial com o Ministério da Cultura.
                    </p>
                </div>

                <button class="btn btn-primary">
                    ${state.loading ? 'Salvando...' : 'Salvar credenciais SALIC'}
                </button>
            </form>
        </div>

        <div class="card" style="border-top: 4px solid var(--error);">
            <h3 class="h2 mb-2">Zona de perigo</h3>
            <p class="text-sm mb-4">Ações irreversíveis que podem apagar seus dados permanentemente.</p>

            <button class="btn btn-secondary" style="color: var(--error); border-color: var(--error);" onclick="alert('Funcionalidade em desenvolvimento')">
                Excluir conta e dados
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
            .in('service_name', ['salic', 'bb_api']);

        if (error) throw error;

        // Reset settings
        state.settings = { salic_user: '', bb_client_id: '', bb_developer_key: '' };

        if (data) {
            data.forEach(cred => {
                if (cred.service_name === 'salic') {
                    state.settings.salic_user = cred.identifier;
                    state.settings.salic_pass = '********';
                } else if (cred.service_name === 'bb_api') {
                    state.settings.bb_client_id = cred.identifier;
                    state.settings.bb_client_secret = '********';
                    // No BB, a application_key vai como extra ou no identifier com separador
                    const meta = cred.metadata || {};
                    state.settings.bb_developer_key = meta.developer_key || '';
                }
            });
        }
    } catch (err) {
        console.error("Erro ao buscar configurações:", err);
    }
}

window.handleSaveBBSettings = async function () {
    if (!supabaseClient || !state.user) return;

    const clientId = document.getElementById('bb-client-id').value.trim();
    const clientSecret = document.getElementById('bb-client-secret').value.trim();
    const devKey = document.getElementById('bb-developer-key').value.trim();

    state.loading = true;
    render();

    try {
        // Usamos a mesma RPC securizada para o BB
        const { error } = await supabaseClient
            .rpc('upsert_external_credential', {
                p_service_name: 'bb_api',
                p_identifier: clientId,
                p_secret: clientSecret === '********' ? null : clientSecret,
                p_metadata: { developer_key: devKey }
            });

        if (error) throw error;

        showToast("Credenciais Banco do Brasil salvas com sucesso!", 'success');
        await fetchSettings();
    } catch (err) {
        showToast("Erro ao salvar BB: " + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleSaveSettings = async function () {
    if (!supabaseClient || !state.user) return;

    const salicUser = document.getElementById('salic-user').value.trim();
    const salicPass = document.getElementById('salic-pass').value.trim();

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .rpc('upsert_external_credential', {
                p_service_name: 'salic',
                p_identifier: salicUser,
                p_secret: salicPass
            });

        if (error) throw error;

        state.settings = { salic_user: salicUser, salic_pass: '********' };
        showToast("Configurações salvas com sucesso e criptografadas!", 'success');
    } catch (err) {
        showToast("Erro ao salvar configurações: " + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};


window.handleProjectSelectChange = async function (projectId) {
    const list = document.getElementById('rubricas-list');
    const input = document.getElementById('rubrica-input');
    if (!list || !input) return;

    input.value = '';
    list.innerHTML = '<option value="Carregando...">';

    if (!projectId || !supabaseClient) {
        list.innerHTML = '<option value="Selecione um projeto primeiro...">';
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('rubricas')
            .select('id, nome, rubrica_id')
            .eq('project_id', projectId)
            .order('nome');

        if (error) throw error;

        if (data && data.length > 0) {
            list.innerHTML = data.map(r => `<option value="${r.rubrica_id ? r.rubrica_id + ' - ' : ''}${r.nome}">${r.rubrica_id ? r.rubrica_id + ' - ' : ''}${r.nome}</option>`).join('');
            input.placeholder = "Digite para buscar entre " + data.length + " rubricas...";
        } else {
            list.innerHTML = '<option value="Nenhuma rubrica cadastrada neste projeto.">';
            input.placeholder = "Sem rubricas disponíveis";
        }
    } catch (error) {
        console.error("Erro ao carregar rubricas:", error);
        list.innerHTML = '<option value="Erro ao carregar rubricas.">';
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
        const fileName = `${Math.random()}.${fileExt} `;
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
                tipo_documento: 'nf',
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

window.handleEnviarSalic = async function (documentId) {
    if (!supabaseClient || !state.user) return;

    state.loading = true;
    render();

    try {
        const doc = state.currentDocument;
        if (!doc) throw new Error("Documento não encontrado no estado.");

        // Busca credenciais SALIC se existirem
        const { data: creds, error: credError } = await supabaseClient
            .from('decrypted_external_credentials')
            .select('*')
            .eq('service_name', 'salic')
            .limit(1)
            .maybeSingle();

        if (credError) throw credError;
        if (!creds) {
            alert("Você precisa configurar suas credenciais SALIC em 'Configurações' antes de enviar.");
            window.navigate('configuracoes');
            return;
        }

        // 1. Atualizar Status para processando ou mantendo em fila
        // (O n8n vai mudar para 'enviado_salic' ou 'erro_rpa')

        // 2. Notificar API local para Inserção no SALIC
        console.log(`[RPA] Disparando envio para o servidor local: ${CONFIG.SALIC_API_URL}...`);

        if (CONFIG.SALIC_API_URL) {
            // Se a URL começar com "/", concatena com a origem atual para evitar erros de fetch relativo em ambientes SPA
            const fullUrl = CONFIG.SALIC_API_URL.startsWith('/')
                ? window.location.origin + CONFIG.SALIC_API_URL
                : CONFIG.SALIC_API_URL;

            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    documentId: documentId,
                    userId: state.user.id
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || "O servidor do robô não respondeu corretamente.");
            }

            const resData = await response.json();

            if (resData.success) {
                showToast("Inserção concluída com sucesso!", 'success');
            }
        }

        showToast("Processo de inserção no SALIC iniciado! O robô assumiu o comando.", 'success');

        // Atualizar silenciosamente enquanto o n8n processa
        setTimeout(() => fetchDocumentDetails(documentId, true), 3000);

    } catch (err) {
        showToast("Erro ao processar envio: " + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleVincularDocumento = async function (parentDocumentId, file, tipo, lastroInfo = null) {
    if (!file || !parentDocumentId) return;

    state.isUploadingComprovante = true;
    render();

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${tipo}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${state.user.id}/${fileName}`;

        // 1. Upload para o Storage (mesmo bucket 'documentos')
        const { error: uploadError } = await supabaseClient.storage
            .from('documentos')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 2. Criar registro do Comprovante na tabela 'documents'
        // Pegamos o project_id da NF mãe (que deve estar no state.currentDocument se for via Detalhes)
        const projectId = state.currentDocument?.project_id;

        const { data: comprovanteData, error: dbError } = await supabaseClient
            .from('documents')
            .insert({
                user_id: state.user.id,
                project_id: projectId,
                name: file.name,
                size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                file_path: filePath,
                status: 'processing_ocr', // Inicia processamento
                tipo_documento: 'comprovante',
                nf_vinculada_id: parentDocumentId,
                rubrica: state.currentDocument?.rubrica || null
            })
            .select()
            .single();

        if (dbError) throw dbError;

        // 3. Notificar o n8n sobre o novo vínculo
        // O document_id agora é o UUID do NOVO comprovante
        // O lastro.id continua sendo o UUID da NF Mãe
        console.log(`Vinculando Comprovante ${comprovanteData.id} à NF ${parentDocumentId}...`);

        if (CONFIG.N8N_WEBHOOK_URL) {
            const response = await fetch(CONFIG.N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    document_id: comprovanteData.id, // UUID do novo comprovante
                    file_path: filePath,
                    user_id: state.user.id,
                    tipo_vinculo: tipo, // 'comprovante'
                    bucket: 'documentos',
                    lastro: { ...lastroInfo, id: parentDocumentId } // UUID da NF Mãe no lastro
                })
            });

            if (!response.ok) {
                console.error("Erro n8n vinculacao:", response.status);
                throw new Error(`Erro ao notificar servidor de automação: ${response.status}`);
            }
        }

        alert(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} enviado com sucesso! O processamento da IA foi iniciado.`);

        // Recarrega os detalhes para mostrar o status atualizado
        await fetchDocumentDetails(parentDocumentId);
    } catch (error) {
        alert(`Erro ao vincular ${tipo}: ` + error.message);
    } finally {
        state.isUploadingComprovante = false;
        render();
    }
};

const SolicitantesAdminView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <h1>Gestão de Solicitantes</h1>
        <p class="page-subtitle">Autorize solicitantes a enviar documentos diretamente para seus projetos.</p>
    </header>

    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 2rem;">
        <div class="card">
            <h3 class="h2 mb-4">Novo acesso</h3>
            <form onsubmit="event.preventDefault(); window.handleInviteSolicitante();">
                <div class="form-group">
                    <label>Solicitante</label>
                    <select id="invite-solicitante-id" required>
                        <option value="">Selecione o solicitante...</option>
                        ${(state.all_solicitantes || []).map(f => `<option value="${f.id}">${f.razao_social}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Projeto</label>
                    <select id="invite-project-id" required>
                        <option value="">Selecione o projeto...</option>
                        ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-primary" style="width: 100%;">Liberar acesso</button>
            </form>
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-subtle);">
                <p class="text-xs mb-2" style="font-weight: 600;">O solicitante não aparece na lista?</p>
                <p class="text-xs mb-3" style="color: var(--text-muted);">Envie este link para que ele se cadastre na plataforma:</p>
                <button class="btn btn-secondary" style="width: 100%; font-size: 11px;" onclick="const link = window.location.origin + '?solicitante=true'; navigator.clipboard.writeText(link); alert('Link de cadastro copiado!');">
                    <i data-lucide="copy" style="width: 12px;"></i>
                    Copiar link de cadastro
                </button>
            </div>
        </div>

        <div class="card">
            <h3 class="h2 mb-4">Acessos ativos</h3>
            <div class="data-table-container">
                ${(state.vinculos_solicitantes || []).length === 0 ?
        `<p class="text-sm" style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum solicitante vinculado ainda.</p>` : `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Solicitante</th>
                                <th>Projeto</th>
                                <th style="text-align: right;">Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(state.vinculos_solicitantes || []).map(v => `
                                <tr>
                                    <td>
                                        <div style="font-weight: 500;">${v.fornecedores.razao_social}</div>
                                        <div class="text-xs">${v.fornecedores.cnpj}</div>
                                    </td>
                                    <td class="text-sm">${v.projects.pronac}</td>
                                    <td style="text-align: right;">
                                        <button class="btn btn-secondary" style="padding: 4px 8px; color: var(--error);" onclick="window.handleRemoveVinculo('${v.id}')">Remover</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            </div>
        </div>
    </div>
</main>
`;


function render() {
    let content = '';

    if (!state.user && !['login', 'register', 'solicitante_login', 'solicitante_register', 'forgot_password', 'update_password'].includes(state.currentView)) {
        state.currentView = state.isSolicitanteMode ? 'solicitante_login' : 'login';
    }

    // Segurança: Bloquear solicitante de acessar rotas de gestor
    const isGestorView = !['login', 'register', 'solicitante_login', 'solicitante_register', 'solicitante_dashboard'].includes(state.currentView);
    if (state.user && state.user.user_metadata?.role === 'fornecedor' && isGestorView) {
        state.currentView = 'solicitante_dashboard';
    }

    switch (state.currentView) {
        case 'login':
            content = LoginView();
            break;
        case 'register':
            content = RegisterView();
            break;
        case 'solicitante_login':
            content = SolicitanteLoginView();
            break;
        case 'solicitante_register':
            content = SolicitanteRegisterView();
            break;
        case 'forgot_password':
            content = ForgotPasswordView();
            break;
        case 'update_password':
            content = UpdatePasswordView();
            break;
        case 'solicitante_dashboard':
            content = SolicitanteDashboardView();
            break;
        case 'projects':
            content = ProjectsView();
            break;
        case 'create_project':
            content = CreateProjectView();
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
        case 'conciliacao':
            content = ConciliacaoView();
            break;
        case 'admin_solicitantes':
            content = SolicitantesAdminView();
            break;
        case 'configuracoes':
            content = ConfiguracoesView();
            break;
        default:
            content = LoginView();
    }

    app.innerHTML = content;
    if (state.showRubricaInstructions) app.innerHTML += RubricaInstructionsModal();
    if (state.showCapturedProjectModal) app.innerHTML += CapturedProjectModal();

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
                        label: function (context) {
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


// --- Sprint 4: Re-structured Banking Logic (Manual Upload) ---

window.handleUploadExtrato = async function (file, projectId, documentId, comprovanteId) {
    if (!file || !projectId || !documentId) return alert("Houve um erro ao processar o upload do extrato.");

    const fileExt = file.name.split('.').pop().toLowerCase();
    if (!['ofx', 'csv', 'pdf'].includes(fileExt)) {
        return alert("Formato inválido! Por favor, use OFX, CSV ou PDF.");
    }

    state.loading = true;
    render();

    try {
        const fileName = `extrato_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${state.user.id}/${fileName}`;

        // 1. Upload para o Storage (bucket 'documentos')
        const { error: uploadError } = await supabaseClient.storage
            .from('documentos')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 2. Criar registro na nova tabela 'extratos'
        const { data: extratoData, error: dbError } = await supabaseClient
            .from('extratos')
            .insert({
                project_id: projectId,
                user_id: state.user.id,
                file_path: filePath,
                formato: fileExt, // Removido toUpperCase() para bater com a constraint (ofx, csv, pdf)
                status: 'pendente' // n8n mudará para 'processado' ou 'erro'
            })
            .select()
            .single();

        if (dbError) throw dbError;

        // 3. Notificar o n8n sobre o novo extrato
        console.log(`Notificando n8n sobre o novo extrato ${extratoData.id}...`);

        if (CONFIG.N8N_WEBHOOK_RECONCILIATION_URL) {
            console.log(`Disparando webhook: ${CONFIG.N8N_WEBHOOK_RECONCILIATION_URL}`);
            const response = await fetch(CONFIG.N8N_WEBHOOK_RECONCILIATION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    extrato_id: extratoData.id,
                    document_id: extratoData.id, // For backward compatibility
                    nf_id: documentId, // Renomeado para nf_id
                    comprovante_id: comprovanteId || null, // Renomeado para comprovante_id
                    file_path: filePath,
                    bucket: 'documentos',
                    project_id: projectId
                })
            });

            if (!response.ok) {
                console.error("Erro na resposta do n8n:", response.status, response.statusText);
                throw new Error(`O servidor n8n retornou erro: ${response.status} ${response.statusText}`);
            }

            console.log("n8n reconciliation ok!");
        }

        showToast("Extrato enviado com sucesso! O processamento e conciliação IA foram iniciados.", 'success');

        // Recarrega os detalhes para mostrar o status (que será atualizado via Realtime/Fetch)
        setTimeout(() => fetchDocumentDetails(documentId), 2500);

    } catch (error) {
        showToast("Erro no extrato: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

async function fetchExtratos(projectId) {
    if (!supabaseClient || !projectId) return;
    try {
        const { data, error } = await supabaseClient
            .from('extratos_bancarios')
            .select('*')
            .eq('project_id', projectId)
            .order('data_transacao', { ascending: false });

        if (!error) state.extratos = data || [];
    } catch (err) {
        console.error("Erro fetch extratos:", err);
    }
}

window.handleImportExtrato = async function (file) {
    if (!file || !state.filters.project || !supabaseClient) return;

    state.loading = true;
    render();

    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        let transactions = [];

        try {
            if (file.name.toLowerCase().endsWith('.ofx')) {
                transactions = parseOFX(text);
            } else if (file.name.toLowerCase().endsWith('.csv')) {
                transactions = parseCSV(text);
            }

            if (transactions.length === 0) {
                state.loading = false;
                render();
                return alert("Nenhuma transação válida encontrada no arquivo.");
            }

            const toInsert = transactions.map(t => ({
                project_id: state.filters.project,
                user_id: state.user.id,
                data_transacao: t.date,
                descricao: t.description,
                valor: t.amount,
                documento_referencia: t.ref || null
            }));

            const { error } = await supabaseClient.from('extratos_bancarios').insert(toInsert);
            if (error) throw error;

            alert(`${transactions.length} transações importadas com sucesso!`);
            await fetchExtratos(state.filters.project);
        } catch (err) {
            alert("Erro ao processar/salvar transações: " + err.message);
        } finally {
            state.loading = false;
            render();
        }
    };
    reader.readAsText(file);
};

function parseOFX(text) {
    const transactions = [];
    const stmtTrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
    let match;

    while ((match = stmtTrnRegex.exec(text)) !== null) {
        const block = match[1];
        const dateStr = extractOFXTag(block, 'DTPOSTED');
        const amount = parseFloat(extractOFXTag(block, 'TRNAMT'));
        const memo = extractOFXTag(block, 'MEMO') || extractOFXTag(block, 'NAME');
        const fitid = extractOFXTag(block, 'FITID');

        if (dateStr && !isNaN(amount)) {
            const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
            transactions.push({
                date: formattedDate,
                description: memo,
                amount: amount,
                ref: fitid
            });
        }
    }
    return transactions;
}

function extractOFXTag(text, tag) {
    const regex = new RegExp(`<${tag}>([^<\\r\\n\\t]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
}

function parseCSV(text) {
    const lines = text.split('\n');
    const transactions = [];

    lines.forEach(line => {
        const cols = line.split(/[;,]/);
        if (cols.length >= 3) {
            const dateStr = cols[0].trim();
            const desc = cols[1].trim();
            const amount = parseFloat(cols[2].trim().replace(',', '.'));

            if (dateStr.includes('/') && !isNaN(amount)) {
                const parts = dateStr.split('/');
                if (parts.length === 3) {
                    const formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    transactions.push({
                        date: formattedDate,
                        description: desc,
                        amount: amount
                    });
                }
            }
        }
    });
    return transactions;
}

window.handleRunN8NReconciliation = async function () {
    if (!state.filters.project || !CONFIG.N8N_WEBHOOK_RECONCILIATION_URL) return;

    state.loading = true;
    render();

    try {
        const response = await fetch(CONFIG.N8N_WEBHOOK_RECONCILIATION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: state.filters.project,
                user_id: state.user.id,
                action: 'reconcile_all'
            })
        });

        if (!response.ok) throw new Error("Erro ao disparar n8n.");

        alert("O processo de conciliação inteligente foi iniciado no n8n. Aguarde alguns instantes e atualize a página.");
    } catch (err) {
        alert("Erro ao disparar conciliação: " + err.message);
    } finally {
        state.loading = false;
        render();
    }
};

// Initial render and setup
async function init() {
    if (supabaseClient) {
        // Verifica se é um fluxo de recuperação de senha pelo hash da URL ou query ?recovery=true
        const isRecovery = window.location.search.includes('recovery=true') || window.location.hash.includes('type=recovery');

        if (isRecovery) {
            state.currentView = 'update_password';
            render();
            return; // Interrompe o init normal para focar na troca de senha
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            state.user = session.user;
            const role = session.user.user_metadata?.role;
            state.userStatus = role || 'gestor';

            // Carregar dados iniciais baseados na role, ignorando isSolicitanteMode da URL se logado
            if (role === 'fornecedor') {
                state.currentView = 'solicitante_dashboard';
                await fetchSolicitanteDashboard();
            } else {
                state.currentView = 'dashboard';
                await fetchProjects();
                await fetchDocuments();
            }
        }
    }
    render();
    setupRealtime();
}

init();
