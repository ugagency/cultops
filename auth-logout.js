// auth-logout.js — implementação única do "Sair do sistema".
//
// Antes existiam quatro cópias independentes (app.js, module-selector.html,
// modulo2/supabase-helper.js, modulo3/supabase-helper-m3.js e ainda a
// modulo2/sem-acesso.html). Todas compartilhavam o mesmo defeito de fundo:
//
//     if (window.supabase && CONFIG) { await sb.auth.signOut(); }
//     window.location.href = '../index.html#login';
//
// O redirect acontecia SEMPRE, mesmo quando o signOut não rodava (SDK ainda não
// carregado) ou lançava (rede fora, refresh token já expirado). E o destino
// index.html manda toda sessão ativa direto para o module-selector.html — para
// operador isso é incondicional. Resultado: clicar em "Sair" com a sessão viva
// devolvia o usuário ao seletor de módulos em vez da tela de login.
//
// Aqui o logout é determinístico: quem garante a saída é a limpeza da sessão
// persistida no localStorage, não o sucesso da chamada de rede. A revogação no
// servidor é tentada primeiro, mas nunca é o que decide se o usuário sai.

(function () {
    'use strict';

    // Chaves de sessão do supabase-js v2: "sb-<project-ref>-auth-token", que pode
    // vir fatiada em ".0", ".1" quando o JWT é grande. A legada é da v1.
    var RE_CHAVE_SESSAO = /^sb-.+-auth-token(\.\d+)?$/;

    // Estado por usuário que não pode vazar para quem logar depois nesta máquina.
    var CHAVES_APP = ['prestai_modulo_ativo', 'prestai_project_id'];

    function purgarSessaoLocal() {
        try {
            var remover = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && (RE_CHAVE_SESSAO.test(k) || k === 'supabase.auth.token')) remover.push(k);
            }
            remover.forEach(function (k) { localStorage.removeItem(k); });
        } catch (_) { /* localStorage bloqueado: segue para o redirect mesmo assim */ }

        CHAVES_APP.forEach(function (k) {
            try { localStorage.removeItem(k); } catch (_) { }
        });
    }

    // Nenhuma etapa de rede pode segurar a saída: se o servidor não responder, o
    // usuário ainda assim sai, porque a sessão local já foi apagada.
    function comLimite(promessa, ms) {
        return Promise.race([
            Promise.resolve(promessa),
            new Promise(function (resolve) { setTimeout(resolve, ms); })
        ]);
    }

    // config.js declara `const CONFIG`, que em script clássico NÃO vira propriedade
    // de window. Ler só window.CONFIG devolvia undefined — foi exatamente assim que
    // o signOut do M2/M3 deixou de rodar. Aqui as duas formas são aceitas.
    function lerConfig() {
        if (window.CONFIG && window.CONFIG.SUPABASE_URL) return window.CONFIG;
        try {
            if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.SUPABASE_URL) return CONFIG;
        } catch (_) { }
        return null;
    }

    function resolverCliente(explicito) {
        if (explicito && explicito.auth) return explicito;
        // Reaproveita o cliente da SPA; criar um segundo GoTrueClient no mesmo
        // contexto faz as duas instâncias disputarem o lock da sessão.
        if (window.supabaseClient && window.supabaseClient.auth) return window.supabaseClient;
        try {
            var cfg = lerConfig();
            if (window.supabase && cfg) {
                return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
            }
        } catch (_) { }
        return null;
    }

    /**
     * Encerra a sessão e leva à tela de login.
     *
     * @param {Object}  [opts]
     * @param {Object}  [opts.client]    Cliente Supabase já criado pela página.
     * @param {string}  [opts.base]      Prefixo até a raiz ('' na raiz, '../' nos módulos).
     * @param {Event}   [opts.event]     Evento do clique, para preventDefault.
     * @param {boolean} [opts.redirect]  false mantém na página (a SPA cuida da navegação).
     */
    async function prestaiLogout(opts) {
        opts = opts || {};
        if (opts.event && typeof opts.event.preventDefault === 'function') opts.event.preventDefault();

        var cliente = resolverCliente(opts.client);
        if (cliente) {
            try {
                // Escopo global revoga o refresh token no servidor. O teto de 2s é
                // para não deixar o usuário preso num clique quando a rede pendura —
                // a sessão local é apagada logo abaixo de qualquer forma.
                await comLimite(cliente.auth.signOut(), 2000);
            } catch (_) {
                // Token já inválido ou rede fora: a limpeza local abaixo resolve.
                try { await comLimite(cliente.auth.signOut({ scope: 'local' }), 1000); } catch (_) { }
            }
        }

        purgarSessaoLocal();

        if (opts.redirect === false) return;

        // ?logout=1 é lido pelo init() do app.js: sem essa marca, qualquer resquício
        // de sessão faria o index.html rotear de volta para o seletor de módulos.
        var base = typeof opts.base === 'string' ? opts.base : '';
        window.location.href = base + 'index.html?logout=1#login';
    }

    window.prestaiLogout = prestaiLogout;
    window.prestaiPurgarSessaoLocal = purgarSessaoLocal;
})();
