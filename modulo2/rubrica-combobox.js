/**
 * Combobox de rubricas para as páginas do M2 (CR-2026-001).
 *
 * Porte do combobox do M1 (app.js: rotuloRubrica / resolverRubricaPorRotulo /
 * inicializarComboRubricas), que as páginas do M2 não carregam. Mesmo
 * comportamento: o produto vira CABEÇALHO de grupo, a busca por digitação
 * filtra por tokens sobre produto + número + nome (sem acento, sem caixa),
 * navegação por teclado, e o valor aprovado aparece ao lado (é o que separa
 * rubricas homônimas de produtos diferentes, ex.: 2x "Assistente de Produção",
 * R$ 80.000 e R$ 3.000). Os estilos .rubrica-combo-* já estão em ../style.css.
 *
 * O rótulo e a resolução texto -> rubrica precisam mudar JUNTOS: se um divergir
 * do outro, o vínculo falha. Por isso ambos moram aqui e as telas só usam
 * RubricaCombobox.resolver().
 *
 * Uso: <input data-rubrica-combo autocomplete="off"> +
 *      RubricaCombobox.definirLista(rubricasDoProjeto) +
 *      RubricaCombobox.resolver(input.value, rubricasDoProjeto) -> rubrica | null
 */
(function () {
    'use strict';

    var lista = [];
    var painel = null;
    var input = null;
    var visiveis = [];
    var ativo = -1;

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function vazio(v) { return v == null || String(v).trim() === ''; }
    function numero(v) {
        if (v == null || v === '') return 0;
        if (typeof v === 'number') return v;
        var s = String(v).trim();
        return s.indexOf(',') !== -1 ? (parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0) : (parseFloat(s) || 0);
    }
    function brl(v) { return numero(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

    // "PRODUTO · 65 - Nome da rubrica (R$ 3.000,00)" — degrada sem quebrar:
    // produto, rubrica_id e valor_aprovado são todos opcionais.
    function rotulo(r) {
        if (!r) return '';
        var prod = vazio(r.produto) ? '' : String(r.produto).trim() + ' · ';
        var num = vazio(r.rubrica_id) ? '' : r.rubrica_id + ' - ';
        var val = vazio(r.valor_aprovado) ? '' : ' (' + brl(r.valor_aprovado) + ')';
        return prod + num + (r.nome || '') + val;
    }

    // Por produto; dentro dele por rubrica_id (numérico, 9 antes de 10); sem produto no fim.
    function ordenar(l) {
        return (l || []).slice().sort(function (a, b) {
            var pa = vazio(a.produto) ? null : String(a.produto).trim();
            var pb = vazio(b.produto) ? null : String(b.produto).trim();
            if (pa === null && pb !== null) return 1;
            if (pb === null && pa !== null) return -1;
            if (pa !== null && pb !== null) {
                var c = pa.localeCompare(pb, 'pt-BR');
                if (c !== 0) return c;
            }
            var na = parseFloat(a.rubrica_id), nb = parseFloat(b.rubrica_id);
            if (!isNaN(na) && !isNaN(nb)) { if (na !== nb) return na - nb; }
            else if (!isNaN(na)) return -1;
            else if (!isNaN(nb)) return 1;
            return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
    }

    // Texto digitado/escolhido -> rubrica. Aceita o rótulo completo, o legado
    // ("id - nome") e o nome puro SÓ quando não há homônimos. null = ambíguo/desconhecido.
    function resolver(texto, l) {
        var alvo = (texto || '').trim();
        if (!alvo) return null;
        var rs = l || [];
        var porRotulo = rs.filter(function (r) { return rotulo(r) === alvo; });
        if (porRotulo.length === 1) return porRotulo[0];
        if (porRotulo.length > 1) return null;
        var legado = rs.filter(function (r) { return (r.rubrica_id ? r.rubrica_id + ' - ' + r.nome : r.nome) === alvo; });
        if (legado.length === 1) return legado[0];
        var porNome = rs.filter(function (r) { return (r.nome || '') === alvo; });
        return porNome.length === 1 ? porNome[0] : null;
    }

    // ── busca ────────────────────────────────────────────────────────────
    // Remove acento e caixa PRESERVANDO o comprimento (o destaque usa os índices).
    function norm(s) {
        return Array.from(String(s == null ? '' : s)).map(function (ch) {
            var n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
            return n.length === 1 ? n : ch;
        }).join('');
    }
    function tokens(t) { return norm(t).split(/\s+/).filter(Boolean); }

    function destacar(texto, toks) {
        var original = String(texto == null ? '' : texto);
        if (!toks.length) return esc(original);
        var alvo = norm(original);
        var marcado = new Array(original.length).fill(false);
        toks.forEach(function (t) {
            var de = alvo.indexOf(t);
            while (de !== -1) {
                for (var i = de; i < de + t.length; i++) marcado[i] = true;
                de = alvo.indexOf(t, de + t.length);
            }
        });
        var html = '', i = 0;
        while (i < original.length) {
            var ini = i, dentro = marcado[i];
            while (i < original.length && marcado[i] === dentro) i++;
            var trecho = esc(original.slice(ini, i));
            html += dentro ? '<mark>' + trecho + '</mark>' : trecho;
        }
        return html;
    }

    function filtrar(l, termo) {
        var toks = tokens(termo);
        if (!toks.length) return l.slice();
        return l.filter(function (r) {
            var alvo = norm((r.produto || '') + ' ' + (r.rubrica_id != null ? r.rubrica_id : '') + ' ' + (r.nome || ''));
            return toks.every(function (t) { return alvo.indexOf(t) !== -1; });
        });
    }

    // ── painel (vive no <body>, position: fixed: não é recortado pela tabela
    //    nem apagado quando a tela re-renderiza o innerHTML) ─────────────────
    function obterPainel() {
        if (painel && document.body.contains(painel)) return painel;
        painel = document.createElement('div');
        painel.className = 'rubrica-combo-panel';
        painel.setAttribute('role', 'listbox');
        document.body.appendChild(painel);
        return painel;
    }

    function posicionar() {
        if (!input || !painel) return;
        var rect = input.getBoundingClientRect();
        var largura = Math.min(Math.max(rect.width, 340), window.innerWidth - 16);
        painel.style.width = largura + 'px';
        painel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - largura - 8)) + 'px';
        var abaixo = window.innerHeight - rect.bottom - 12;
        var acima = rect.top - 12;
        var paraCima = abaixo < 200 && acima > abaixo;
        painel.style.maxHeight = Math.max(140, Math.min(340, paraCima ? acima : abaixo)) + 'px';
        if (paraCima) { painel.style.top = 'auto'; painel.style.bottom = (window.innerHeight - rect.top + 4) + 'px'; }
        else { painel.style.bottom = 'auto'; painel.style.top = (rect.bottom + 4) + 'px'; }
    }

    function marcarAtivo(rolar) {
        if (!painel) return;
        var itens = painel.querySelectorAll('.rubrica-combo-item');
        itens.forEach(function (el) { el.classList.remove('is-active'); });
        if (ativo < 0 || ativo >= itens.length) return;
        itens[ativo].classList.add('is-active');
        if (rolar !== false) itens[ativo].scrollIntoView({ block: 'nearest' });
    }

    function renderizar() {
        if (!input) return;
        var p = obterPainel();
        var termo = input.value || '';
        var toks = tokens(termo);

        // Texto que já é exatamente um rótulo = acabou de escolher: mostra a lista
        // inteira em vez de filtrar por ela mesma (devolveria 1 item só).
        var jaResolvido = !!resolver(termo, lista);
        visiveis = ordenar(jaResolvido ? lista : filtrar(lista, termo));

        if (visiveis.length === 0) {
            p.innerHTML = '<div class="rubrica-combo-empty">' + (lista.length === 0
                ? 'Nenhuma rubrica carregada para este projeto.'
                : 'Nenhuma rubrica encontrada para esta busca.') + '</div>';
            ativo = -1;
            return;
        }

        var marcar = jaResolvido ? [] : toks;
        var produtoAtual = null, html = '';
        visiveis.forEach(function (r, idx) {
            var produto = vazio(r.produto) ? 'Sem produto definido' : String(r.produto).trim();
            if (produto !== produtoAtual) {
                produtoAtual = produto;
                html += '<div class="rubrica-combo-group">' + destacar(produto, marcar) + '</div>';
            }
            var num = vazio(r.rubrica_id) ? '' : '<span class="rubrica-combo-num">' + destacar(r.rubrica_id + ' - ', marcar) + '</span>';
            var valor = vazio(r.valor_aprovado) ? '' : '<span class="rubrica-combo-valor">' + esc(brl(r.valor_aprovado)) + '</span>';
            html += '<div class="rubrica-combo-item" role="option" data-idx="' + idx + '">'
                + '<span class="rubrica-combo-nome">' + num + destacar(r.nome || '', marcar) + '</span>' + valor + '</div>';
        });
        p.innerHTML = html;
        ativo = visiveis.length === 1 ? 0 : -1;
        marcarAtivo(false);
    }

    function abrir(el) {
        input = el;
        var p = obterPainel();
        renderizar();
        p.classList.add('is-open');
        posicionar();
    }
    function fechar() {
        if (painel) painel.classList.remove('is-open');
        input = null; visiveis = []; ativo = -1;
    }
    function aberto() { return !!(painel && painel.classList.contains('is-open') && input); }

    function selecionar(idx) {
        var r = visiveis[idx];
        if (!r || !input) return;
        input.value = rotulo(r);
        input.dataset.rubricaId = r.id; // só para depurar; a gravação usa resolver(texto)
        input.dispatchEvent(new Event('change', { bubbles: true }));
        fechar();
    }
    function mover(passo) {
        if (!visiveis.length) return;
        ativo = ativo === -1 ? (passo > 0 ? 0 : visiveis.length - 1) : (ativo + passo + visiveis.length) % visiveis.length;
        marcarAtivo();
    }

    // Delegação no document: os inputs são recriados a cada innerHTML da tela.
    function inicializar() {
        if (window._rubricaComboM2Pronto) return;
        window._rubricaComboM2Pronto = true;

        document.addEventListener('focusin', function (e) {
            if (!e.target || !e.target.closest) return;
            var el = e.target.closest('[data-rubrica-combo]');
            if (el) abrir(el);
            else if (aberto() && !e.target.closest('.rubrica-combo-panel')) fechar();
        });

        document.addEventListener('input', function (e) {
            var el = e.target.closest && e.target.closest('[data-rubrica-combo]');
            if (!el) return;
            delete el.dataset.rubricaId;
            if (aberto() && input === el) { renderizar(); posicionar(); }
            else abrir(el);
        });

        document.addEventListener('keydown', function (e) {
            var el = e.target.closest && e.target.closest('[data-rubrica-combo]');
            if (!el) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!aberto() || input !== el) abrir(el);
                else mover(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter') {
                if (aberto() && ativo >= 0) { e.preventDefault(); selecionar(ativo); }
            } else if (e.key === 'Escape') {
                if (aberto()) { e.preventDefault(); fechar(); }
            } else if (e.key === 'Tab') {
                fechar();
            }
        });

        // mousedown (não click): dispara antes do blur, o painel ainda existe.
        document.addEventListener('mousedown', function (e) {
            if (!e.target || !e.target.closest) return;
            var item = e.target.closest('.rubrica-combo-item');
            if (item) { e.preventDefault(); selecionar(Number(item.dataset.idx)); return; }
            if (aberto() && !e.target.closest('.rubrica-combo-panel') && !e.target.closest('[data-rubrica-combo]')) fechar();
        });

        var reposicionar = function () {
            if (!aberto()) return;
            if (!document.body.contains(input)) fechar(); else posicionar();
        };
        window.addEventListener('scroll', reposicionar, true);
        window.addEventListener('resize', reposicionar);
    }

    inicializar();

    window.RubricaCombobox = {
        definirLista: function (rubricas) { lista = rubricas || []; },
        rotulo: rotulo,
        resolver: resolver
    };
})();
