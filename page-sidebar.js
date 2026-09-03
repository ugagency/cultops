// page-sidebar.js — sidebar compartilhada das páginas neutras na raiz do repo
// (equipe.html, configuracoes.html, solicitantes.html), acessíveis a partir de
// qualquer um dos 3 módulos e por isso sem dono de sidebar fixa.
// `prestai_modulo_ativo` (gravado pelo module-selector ao entrar num módulo)
// diz qual variante mostrar. Extraído da implementação original de
// solicitantes.html para evitar duplicar a mesma lógica em cada página nova.

const SIDEBAR_VARIANTS = {
    modulo_1: {
        moduleLabel: null,
        items: [
            { label: 'Dashboard', icon: 'layout-dashboard', path: 'index.html#dashboard' },
            { label: 'Projetos', icon: 'briefcase', path: 'index.html#projects' },
            { label: 'Rubricas', icon: 'list-checks', path: 'index.html#orcamento' },
            { label: 'Documentos', icon: 'file-text', path: 'index.html#upload' },
            { label: 'Documentos em Lote', icon: 'layers', path: 'index.html#upload_lote' },
            { label: 'Envio SALIC', icon: 'send', path: 'index.html#envio_lote_salic' },
            { label: 'Relatórios', icon: 'bar-chart-3', path: 'index.html#financeiro' },
            { label: 'Ferramentas', icon: 'wrench', path: 'index.html#ferramentas', restrito: true },
            { label: 'Solicitantes', icon: 'users', path: 'solicitantes.html', restrito: true },
            { label: 'Configurações', icon: 'settings', path: 'configuracoes.html', restrito: true },
            { label: 'Equipe', icon: 'user-cog', path: 'equipe.html', restrito: true },
        ]
    },
    modulo_2: {
        moduleLabel: null,
        items: [
            { label: 'Dashboard', icon: 'layout-dashboard', path: 'modulo2/financeiro.html' },
            { label: 'Projetos', icon: 'folder-kanban', path: 'modulo2/projeto-setup.html' },
            { label: 'Dados do Projeto', icon: 'file-text', path: 'modulo2/dados-projeto-salic.html' },
            { label: 'Rubricas', icon: 'pie-chart', path: 'modulo2/rubricas.html' },
            { label: 'Contratos', icon: 'file-text', path: 'modulo2/contratos.html' },
            { label: 'Impostos', icon: 'landmark', path: 'modulo2/impostos.html' },
            { label: 'Evidências', icon: 'camera', path: 'modulo2/comprovacao-fisica.html' },
            { label: 'Prestação de Contas', icon: 'file-check-2', path: 'modulo2/prestacao-contas.html' },
            { label: 'Exportações', icon: 'download', path: 'modulo2/exportacoes.html' },
            { label: 'Equipe', icon: 'user-cog', path: 'equipe.html', restrito: true },
            { label: 'Configurações', icon: 'settings', path: 'configuracoes.html', restrito: true },
            { label: 'Solicitantes', icon: 'users', path: 'solicitantes.html', restrito: true },
        ]
    },
    modulo_3: {
        moduleLabel: 'Módulo III · Distribuição',
        items: [
            { label: 'Dashboard', icon: 'layout-dashboard', path: 'modulo3/contrapartidas.html' },
            { label: 'Org. Sociais', icon: 'users', path: 'modulo3/os.html' },
            { label: 'Patrocinadores', icon: 'building-2', path: 'modulo3/pa.html' },
            { label: 'Eventos', icon: 'calendar', path: 'modulo3/eventos.html' },
            { label: 'Relatórios', icon: 'file-text', path: 'modulo3/relatorios.html' },
            { label: 'Equipe', icon: 'user-cog', path: 'equipe.html', restrito: true },
            { label: 'Configurações', icon: 'settings', path: 'configuracoes.html', restrito: true },
            { label: 'Solicitantes', icon: 'users', path: 'solicitantes.html', restrito: true },
            { label: 'Campo (PWA)', icon: 'smartphone', path: 'modulo3/pwa/index.html', blank: true },
        ]
    }
};

async function renderPageSidebar(role) {
    const existing = document.querySelector('.sidebar');
    if (existing) existing.remove();

    const moduloAtivo = localStorage.getItem('prestai_modulo_ativo') || 'modulo_1';
    const variant = SIDEBAR_VARIANTS[moduloAtivo] || SIDEBAR_VARIANTS.modulo_1;
    const filtered = variant.items.filter(item => !item.restrito || ['admin', 'gestor'].includes(role));

    const currentFile = window.location.pathname.split('/').pop() || 'index.html';

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    const navHtml = filtered.map(item => {
        const itemFile = item.path.split('#')[0].split('/').pop();
        const active = itemFile === currentFile;
        const attrs = item.blank ? 'target="_blank" rel="noopener"' : '';
        return `
            <a href="${item.path}" ${attrs} class="nav-item ${active ? 'active' : ''}" title="${item.label}">
                <i data-lucide="${item.icon}"></i>
                <span>${item.label}</span>
            </a>
        `;
    }).join('');

    sidebar.innerHTML = `
        <div class="sidebar-logo">
            <img class="sidebar-logo-full" src="PAI-Logo-Azul.png" alt="Prestaí">
            <img class="sidebar-logo-icon" src="PAI-Icone-Azul.png" alt="Prestaí">
        </div>
        ${variant.moduleLabel ? `<div style="font-size:0.65rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;margin:-0.75rem 0 0.5rem 0.75rem;">${variant.moduleLabel}</div>` : ''}
        <nav class="sidebar-nav">
            ${navHtml}
        </nav>
        <div class="sidebar-footer">
            <div class="sidebar-user">
                <div class="sidebar-avatar"></div>
                <div style="overflow: hidden;">
                    <p class="sidebar-user-name" style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; text-overflow: ellipsis;"></p>
                    <p class="sidebar-user-role" style="font-size: 11px; color: var(--text-secondary);"></p>
                </div>
            </div>
            <a href="module-selector.html" class="nav-item" title="Trocar Módulo" style="color: var(--primary);">
                <i data-lucide="grid-2x2"></i>
                <span>Trocar Módulo</span>
            </a>
            <a href="index.html?logout=1#login" onclick="window.handleLogout(event)" class="nav-item" title="Sair" style="color: var(--error);">
                <i data-lucide="log-out"></i>
                <span>Sair</span>
            </a>
        </div>
    `;

    document.body.prepend(sidebar);

    (async () => {
        try {
            const sb = await initSupabase();
            const { data: { session } } = await sb.auth.getSession();
            const user = session?.user;
            if (!user || !user.email) return;
            const r = user.app_metadata?.role || user.user_metadata?.role;
            const labels = { admin: 'Administrador', gestor: 'Gestor', analista: 'Analista', operador: 'Operador', fornecedor: 'Fornecedor' };
            sidebar.querySelector('.sidebar-avatar').textContent = user.email[0].toUpperCase();
            sidebar.querySelector('.sidebar-user-name').textContent = user.email.split('@')[0];
            sidebar.querySelector('.sidebar-user-role').textContent = labels[r] || 'Gestor';
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
    hamburger.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('sidebar-open');
        overlay.classList.toggle('active');
    });
    document.body.appendChild(hamburger);

    if (window.lucide) window.lucide.createIcons();
}

if (!window.handleLogout) {
    window.handleLogout = async function (e) {
        if (typeof window.prestaiLogout !== 'function') return;
        if (e) e.preventDefault();
        const sb = await initSupabase();
        return window.prestaiLogout({ client: sb, base: '' });
    };
}
