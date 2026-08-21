let supabaseClient = null;

// Expõe a URL publicamente para uso nos templates HTML
let SUPABASE_URL = "";

function initializeSupabase() {
    const supabaseUrl = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : "") || "";
    const supabaseKey = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_KEY : "") || "";
    SUPABASE_URL = supabaseUrl; // Torna disponível globalmente para templates

    if (window.supabase && supabaseUrl && supabaseKey) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
        // `let` em script clássico não vira propriedade de window. Publicar aqui
        // deixa auth-logout.js reaproveitar este cliente em vez de criar um segundo.
        window.supabaseClient = supabaseClient;
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

// ─── IN 23/2025 — helpers ────────────────────────────────────────────────────

function categorizeRubrica(r) {
    if (r.categoria) return r.categoria;
    const texto = ((r.nome || '') + ' ' + (r.codigo || '')).toLowerCase();
    if (texto.includes('proponente'))                                   return 'proponente';
    if (texto.includes('administr'))                                    return 'administracao';
    if (texto.includes('divulg') || texto.includes('comunic') || texto.includes('acessib')) return 'divulgacao';
    if (texto.includes('capta')  || texto.includes('remunera'))         return 'captacao';
    return 'outros';
}

function calcularRegrasIN23(rubricas, valorProjeto, valorCaptado, documentos) {
    const totais = { captacao: 0, divulgacao: 0, administracao: 0, proponente: 0 };
    (rubricas || []).forEach(r => {
        const cat = categorizeRubrica(r);
        if (totais[cat] !== undefined) totais[cat] += Number(r.valor_utilizado) || 0;
    });

    const regras = [
        { id: 'R001', tipo: 'erro',  label: 'Remuneração de Captação',                       executado: totais.captacao,      limite: Math.min((valorProjeto || 0) * 0.10, 150000) },
        { id: 'R002', tipo: 'erro',  label: 'Divulgação / Comunicação / Acessibilidade',      executado: totais.divulgacao,    limite: (valorProjeto || 0) * 0.20 },
        { id: 'R003', tipo: 'erro',  label: 'Custos de Administração',                        executado: totais.administracao, limite: (valorProjeto || 0) * 0.15 },
        { id: 'R004', tipo: 'aviso', label: 'Remuneração do Proponente',                      executado: totais.proponente,    limite: (valorCaptado  || 0) * 0.20 },
    ];

    regras.forEach(r => {
        r.percentual = r.limite > 0 ? Math.round((r.executado / r.limite) * 100) : 0;
        r.status = r.percentual >= 100 ? 'excedido' : r.percentual >= 80 ? 'atencao' : 'ok';
    });

    if (valorCaptado > 0 && (documentos || []).length > 0) {
        const porFornecedor = {};
        documentos.forEach(d => {
            const chave = d.cnpj_emissor || d.nome_emissor || 'desconhecido';
            porFornecedor[chave] = (porFornecedor[chave] || 0) + (Number(d.valor) || 0);
        });
        const limite = valorCaptado * 0.30;
        const lista = Object.entries(porFornecedor)
            .map(([nome, total]) => ({ nome, total, percentual: Math.round((total / valorCaptado) * 100), status: total > limite ? 'excedido' : 'ok' }))
            .sort((a, b) => b.total - a.total);
        regras.push({
            id: 'R005', tipo: 'aviso', label: 'Concentração por Fornecedor (> 30% do captado)',
            fornecedores: lista, excedidos: lista.filter(f => f.status === 'excedido'),
            status: lista.some(f => f.status === 'excedido') ? 'excedido' : 'ok',
        });
    }
    return regras;
}

function renderIN23(rubricas, valorProjeto, valorCaptado, documentos) {
    const regras = calcularRegrasIN23(rubricas, valorProjeto, valorCaptado, documentos);

    const container = document.createElement('div');
    container.id = 'painel-in23';
    container.style.cssText = 'margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden';

    const header = document.createElement('div');
    header.style.cssText = 'background:#1A3A5C;color:white;padding:12px 16px;font-weight:600;font-size:14px';
    header.textContent = 'Conformidade IN 23/2025';
    container.appendChild(header);

    const body = document.createElement('div');
    body.style.padding = '12px 16px';

    regras.filter(r => r.id !== 'R005').forEach(r => {
        const cor = r.status === 'excedido' ? '#ef4444' : r.status === 'atencao' ? '#f59e0b' : '#22c55e';
        const row = document.createElement('div');
        row.style.marginBottom = '12px';
        row.innerHTML = `
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span>${r.label} <span style="font-size:10px;color:#94a3b8">(${r.tipo === 'erro' ? 'limite obrigatório' : 'limite recomendado'})</span></span>
            <span style="color:${cor};font-weight:600">${r.percentual}% ${r.status === 'excedido' ? '⚠️' : ''}</span>
          </div>
          <div style="background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${cor};width:${Math.min(r.percentual, 100)}%;height:100%;transition:width 0.3s"></div>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">
            R$ ${r.executado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de R$ ${r.limite.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>`;
        body.appendChild(row);
    });

    const r5 = regras.find(r => r.id === 'R005');
    if (r5?.excedidos?.length > 0) {
        const aviso = document.createElement('div');
        aviso.style.cssText = 'background:#fef3c7;border-left:3px solid #f59e0b;padding:8px 12px;font-size:12px;margin-top:8px;border-radius:0 4px 4px 0';
        aviso.innerHTML = '<strong>⚠️ Fornecedor acima de 30% do captado:</strong><br>' +
            r5.excedidos.map(f => `${f.nome}: ${f.percentual}% (R$ ${f.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`).join('<br>');
        body.appendChild(aviso);
    }

    container.appendChild(body);
    return container;
}

function mountIN23Panel() {
    const mount = document.getElementById('in23-panel-mount');
    if (!mount || !state.in23ProjectFinanceiro) return;
    const vProjeto = parseFloat(state.in23ProjectFinanceiro.valor_aprovado) || 0;
    const vCaptado = parseFloat(state.in23ProjectFinanceiro.valor_captado)  || 0;
    const panel = renderIN23(state.rubricas, vProjeto, vCaptado, state.in23DocumentosConferidos || []);
    mount.innerHTML = '';
    mount.appendChild(panel);
}
// ─────────────────────────────────────────────────────────────────────────────

// Converte valores financeiros do banco independente do formato (BR ou numérico)
function parseValorBR(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    // Formato BR com vírgula decimal: "1.234.567,89" ou "1.234,56"
    if (s.includes(',')) {
        return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    }
    const dots = (s.match(/\./g) || []).length;
    // Múltiplos pontos → separadores de milhar BR: "1.234.567"
    if (dots > 1) return parseFloat(s.replace(/\./g, '')) || 0;
    // Ponto único com exatamente 3 dígitos depois → milhar BR: "1.500"
    if (dots === 1 && s.split('.')[1].length === 3) {
        return parseFloat(s.replace('.', '')) || 0;
    }
    return parseFloat(s) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUBRICAS — rótulo único e resolução inversa (os 3 seletores do M1)
//
// Um mesmo projeto pode ter rubricas homônimas na mesma etapa, distintas apenas
// pelo PRODUTO (ex.: duas "Assistente de Produção" no PRONAC 258804 — uma sob
// "Festival..." com R$ 80.000, outra sob "CURSO/OFICINA..." com R$ 3.000). Sem o
// produto no rótulo a escolha é cega e o vínculo errado passa sem validação.
//
// <datalist> não aceita <optgroup>, então o produto entra como PREFIXO: ordenando
// por produto, os itens do mesmo produto ficam adjacentes na lista e o efeito
// visual é o de um agrupamento. A busca por digitação continua funcionando.
//
// Estes três helpers são usados por TODOS os seletores e por todos os pontos de
// resolução (texto → rubrica). Não duplicar a montagem de rótulo em outro lugar:
// rótulo e resolução precisam mudar juntos, senão o vínculo falha silenciosamente.
// ─────────────────────────────────────────────────────────────────────────────

// Escapa texto para uso dentro de atributo HTML (value="...").
function escAttr(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// "PRODUTO · 65 - Nome da rubrica (R$ 3.000,00)"
// Degrada sem quebrar: produto, rubrica_id e valor_aprovado são todos opcionais.
function rotuloRubrica(r) {
    if (!r) return '';
    const produto = r.produto != null && String(r.produto).trim() !== '' ? String(r.produto).trim() : '';
    const prod = produto ? `${produto} · ` : '';
    const num = r.rubrica_id != null && String(r.rubrica_id).trim() !== '' ? `${r.rubrica_id} - ` : '';
    const val = r.valor_aprovado != null && String(r.valor_aprovado).trim() !== ''
        ? ` (${parseValorBR(r.valor_aprovado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`
        : '';
    return `${prod}${num}${r.nome || ''}${val}`;
}

// Ordena por produto e depois por rubrica_id (numérico quando possível, para que
// 9 venha antes de 10). Rubricas sem produto vão para o fim da lista.
function ordenarRubricas(lista) {
    return [...(lista || [])].sort((a, b) => {
        const pa = a.produto != null && String(a.produto).trim() !== '' ? String(a.produto).trim() : null;
        const pb = b.produto != null && String(b.produto).trim() !== '' ? String(b.produto).trim() : null;
        if (pa === null && pb !== null) return 1;
        if (pb === null && pa !== null) return -1;
        if (pa !== null && pb !== null) {
            const cmp = pa.localeCompare(pb, 'pt-BR');
            if (cmp !== 0) return cmp;
        }
        const na = parseFloat(a.rubrica_id);
        const nb = parseFloat(b.rubrica_id);
        if (!isNaN(na) && !isNaN(nb)) {
            if (na !== nb) return na - nb;
        } else if (!isNaN(na)) {
            return -1;
        } else if (!isNaN(nb)) {
            return 1;
        }
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });
}

// Caminho inverso: texto digitado/escolhido → rubrica.
// Aceita o rótulo novo, o rótulo antigo ("id - nome") para não quebrar valores já
// preenchidos, e o nome puro — este último SÓ quando não houver homônimos, senão
// voltaríamos a escolher às cegas. Retorna null quando ambíguo ou desconhecido.
function resolverRubricaPorRotulo(texto, lista) {
    const alvo = (texto || '').trim();
    if (!alvo) return null;
    const rubricas = lista || [];

    const porRotulo = rubricas.find(r => rotuloRubrica(r) === alvo);
    if (porRotulo) return porRotulo;

    // Rótulo legado, ainda presente em inputs pré-preenchidos e na fila do lote.
    const porRotuloLegado = rubricas.find(r => (r.rubrica_id ? `${r.rubrica_id} - ${r.nome}` : r.nome) === alvo);
    if (porRotuloLegado) return porRotuloLegado;

    const porNome = rubricas.filter(r => (r.nome || '') === alvo);
    return porNome.length === 1 ? porNome[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBOBOX DE RUBRICAS — substitui o <datalist> nos 3 seletores do M1
//
// O <datalist> não aceita <optgroup>: só dava para prefixar o produto em cada
// linha, o que repetia o produto 20x e não agrupava de verdade. Aqui o painel é
// próprio, então o produto vira CABEÇALHO e as rubricas ficam indentadas embaixo:
//
//     CURSO/OFICINA/CAPACITAÇÃO - ARTES CÊNICAS
//        65 - Assistente de Produção            R$ 3.000,00
//        10 - Cenografia                       R$ 12.000,00
//     FESTIVAL, BIENAL, FESTA OU FEIRA
//         9 - Assistente de Produção           R$ 80.000,00
//
// A busca por digitação é preservada (requisito com 161 rubricas): filtro por
// tokens sobre produto + número + nome, sem acento e sem caixa, com navegação por
// teclado. Ao escolher, o input recebe rotuloRubrica(r) — exatamente o texto que
// resolverRubricaPorRotulo() sabe desfazer, então a resolução inversa não muda.
//
// O painel vive no <body> (position: fixed) por dois motivos: não ser recortado
// pelo overflow da tabela do lote, e não ser apagado pelo app.innerHTML do render.
// ─────────────────────────────────────────────────────────────────────────────

let _comboPainel = null;
let _comboInput = null;
let _comboLista = [];   // rubricas visíveis, alinhado com data-idx dos itens
let _comboAtivo = -1;

// Remove acento e caixa preservando o comprimento, para os índices do texto
// normalizado continuarem válidos no texto original (usado no destaque).
function _comboNormalizar(s) {
    return Array.from(String(s == null ? '' : s)).map(ch => {
        const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return n.length === 1 ? n : ch;
    }).join('');
}

function _comboTokens(termo) {
    return _comboNormalizar(termo).split(/\s+/).filter(Boolean);
}

// Envolve em <mark> os trechos que casam com os termos digitados.
function _comboDestacar(texto, tokens) {
    const original = String(texto == null ? '' : texto);
    if (!tokens.length) return escAttr(original);

    const alvo = _comboNormalizar(original);
    const marcado = new Array(original.length).fill(false);
    tokens.forEach(t => {
        let de = alvo.indexOf(t);
        while (de !== -1) {
            for (let i = de; i < de + t.length; i++) marcado[i] = true;
            de = alvo.indexOf(t, de + t.length);
        }
    });

    let html = '';
    let i = 0;
    while (i < original.length) {
        const inicio = i;
        const dentro = marcado[i];
        while (i < original.length && marcado[i] === dentro) i++;
        const trecho = escAttr(original.slice(inicio, i));
        html += dentro ? `<mark>${trecho}</mark>` : trecho;
    }
    return html;
}

function _comboFiltrar(lista, termo) {
    const tokens = _comboTokens(termo);
    if (!tokens.length) return lista.slice();
    return lista.filter(r => {
        const alvo = _comboNormalizar(`${r.produto || ''} ${r.rubrica_id != null ? r.rubrica_id : ''} ${r.nome || ''}`);
        return tokens.every(t => alvo.includes(t));
    });
}

function _comboObterPainel() {
    if (_comboPainel && document.body.contains(_comboPainel)) return _comboPainel;
    _comboPainel = document.createElement('div');
    _comboPainel.className = 'rubrica-combo-panel';
    _comboPainel.setAttribute('role', 'listbox');
    document.body.appendChild(_comboPainel);
    return _comboPainel;
}

function _comboPosicionar() {
    if (!_comboInput || !_comboPainel) return;
    const rect = _comboInput.getBoundingClientRect();
    const painel = _comboPainel;

    const largura = Math.min(Math.max(rect.width, 340), window.innerWidth - 16);
    painel.style.width = `${largura}px`;
    painel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - largura - 8))}px`;

    const abaixo = window.innerHeight - rect.bottom - 12;
    const acima = rect.top - 12;
    const paraCima = abaixo < 200 && acima > abaixo;
    painel.style.maxHeight = `${Math.max(140, Math.min(340, paraCima ? acima : abaixo))}px`;
    if (paraCima) {
        painel.style.top = 'auto';
        painel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
        painel.style.bottom = 'auto';
        painel.style.top = `${rect.bottom + 4}px`;
    }
}

function _comboRenderizar() {
    if (!_comboInput) return;
    const painel = _comboObterPainel();
    const termo = _comboInput.value || '';
    const tokens = _comboTokens(termo);

    // Se o texto atual é exatamente um rótulo válido, o operador acabou de escolher:
    // mostrar a lista inteira em vez de filtrar por ela mesma (que devolveria 1 item).
    const jaResolvido = resolverRubricaPorRotulo(termo, state.rubricas_disponiveis || []);
    const base = state.rubricas_disponiveis || [];
    _comboLista = ordenarRubricas(jaResolvido ? base : _comboFiltrar(base, termo));

    if (_comboLista.length === 0) {
        painel.innerHTML = `<div class="rubrica-combo-empty">${base.length === 0
            ? 'Nenhuma rubrica carregada para este projeto.'
            : 'Nenhuma rubrica encontrada para esta busca.'}</div>`;
        _comboAtivo = -1;
        return;
    }

    const marcarTokens = jaResolvido ? [] : tokens;
    let produtoAtual = null;
    let html = '';
    _comboLista.forEach((r, idx) => {
        const produto = r.produto != null && String(r.produto).trim() !== ''
            ? String(r.produto).trim()
            : 'Sem produto definido';
        if (produto !== produtoAtual) {
            produtoAtual = produto;
            html += `<div class="rubrica-combo-group">${_comboDestacar(produto, marcarTokens)}</div>`;
        }
        const num = r.rubrica_id != null && String(r.rubrica_id).trim() !== ''
            ? `<span class="rubrica-combo-num">${_comboDestacar(`${r.rubrica_id} - `, marcarTokens)}</span>`
            : '';
        const valor = r.valor_aprovado != null && String(r.valor_aprovado).trim() !== ''
            ? `<span class="rubrica-combo-valor">${escAttr(parseValorBR(r.valor_aprovado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</span>`
            : '';
        html += `<div class="rubrica-combo-item" role="option" data-idx="${idx}">`
            + `<span class="rubrica-combo-nome">${num}${_comboDestacar(r.nome || '', marcarTokens)}</span>`
            + valor
            + `</div>`;
    });

    painel.innerHTML = html;
    _comboAtivo = _comboLista.length === 1 ? 0 : -1;
    _comboMarcarAtivo(false);
}

function _comboMarcarAtivo(rolar = true) {
    if (!_comboPainel) return;
    const itens = _comboPainel.querySelectorAll('.rubrica-combo-item');
    itens.forEach(el => el.classList.remove('is-active'));
    if (_comboAtivo < 0 || _comboAtivo >= itens.length) return;
    const alvo = itens[_comboAtivo];
    alvo.classList.add('is-active');
    if (rolar) alvo.scrollIntoView({ block: 'nearest' });
}

function _comboAbrir(input) {
    _comboInput = input;
    const painel = _comboObterPainel();
    _comboRenderizar();
    painel.classList.add('is-open');
    _comboPosicionar();
}

function _comboFechar() {
    if (_comboPainel) _comboPainel.classList.remove('is-open');
    _comboInput = null;
    _comboLista = [];
    _comboAtivo = -1;
}

function _comboAberto() {
    return !!(_comboPainel && _comboPainel.classList.contains('is-open') && _comboInput);
}

function _comboSelecionar(idx) {
    const r = _comboLista[idx];
    if (!r || !_comboInput) return;
    _comboInput.value = rotuloRubrica(r);
    // Guarda o id resolvido: útil para depurar um vínculo suspeito sem refazer o
    // caminho do texto. A gravação continua saindo de resolverRubricaPorRotulo.
    _comboInput.dataset.rubricaId = r.id;
    _comboInput.dispatchEvent(new Event('change', { bubbles: true }));
    _comboFechar();
}

function _comboMover(passo) {
    if (!_comboLista.length) return;
    _comboAtivo = _comboAtivo === -1
        ? (passo > 0 ? 0 : _comboLista.length - 1)
        : (_comboAtivo + passo + _comboLista.length) % _comboLista.length;
    _comboMarcarAtivo();
}

function inicializarComboRubricas() {
    if (window._comboRubricasPronto) return;
    window._comboRubricasPronto = true;

    // Delegação no document: os inputs são recriados a cada app.innerHTML, então
    // não dá para prender listeners neles.
    document.addEventListener('focusin', e => {
        if (!e.target || !e.target.closest) return;
        const input = e.target.closest('[data-rubrica-combo]');
        if (input) _comboAbrir(input);
        else if (_comboAberto() && !e.target.closest('.rubrica-combo-panel')) _comboFechar();
    });

    // Os handlers resolvem o input pelo alvo do evento, não por _comboInput: depois de
    // escolher um item o painel fecha e _comboInput zera, e digitar de novo tem que
    // reabrir a lista em vez de virar um campo de texto morto.
    document.addEventListener('input', e => {
        const input = e.target.closest && e.target.closest('[data-rubrica-combo]');
        if (!input) return;
        delete input.dataset.rubricaId;
        if (_comboAberto() && _comboInput === input) {
            _comboRenderizar();
            _comboPosicionar();
        } else {
            _comboAbrir(input);
        }
    });

    document.addEventListener('keydown', e => {
        const input = e.target.closest && e.target.closest('[data-rubrica-combo]');
        if (!input) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!_comboAberto() || _comboInput !== input) _comboAbrir(input);
            else _comboMover(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
            if (_comboAberto() && _comboAtivo >= 0) {
                e.preventDefault();
                _comboSelecionar(_comboAtivo);
            }
        } else if (e.key === 'Escape') {
            if (_comboAberto()) { e.preventDefault(); _comboFechar(); }
        } else if (e.key === 'Tab') {
            _comboFechar();
        }
    });

    // mousedown (não click): dispara antes do blur, então o painel ainda existe.
    document.addEventListener('mousedown', e => {
        if (!e.target || !e.target.closest) return;
        const item = e.target.closest('.rubrica-combo-item');
        if (item) {
            e.preventDefault();
            _comboSelecionar(Number(item.dataset.idx));
            return;
        }
        if (_comboAberto()
            && !e.target.closest('.rubrica-combo-panel')
            && !e.target.closest('[data-rubrica-combo]')) {
            _comboFechar();
        }
    });

    // Rolagem/redimensionamento: reposiciona, e fecha se o input sumiu do DOM.
    const reposicionar = () => {
        if (!_comboAberto()) return;
        if (!document.body.contains(_comboInput)) _comboFechar();
        else _comboPosicionar();
    };
    window.addEventListener('scroll', reposicionar, true);
    window.addEventListener('resize', reposicionar);
}

const isSolicitanteMode = window.location.pathname.includes('solicitante') || window.location.hash.includes('solicitante') || window.location.search.includes('solicitante');

// Cria o objeto de filtros com o campo `project` persistido em localStorage
// (mesma chave do M2, para lembrar o último projeto entre navegações, reloads
// e troca de módulo). Ler/escrever state.filters.project passa pelo accessor.
function createFilters() {
    const PROJECT_KEY = 'prestai_project_id';
    // duplicidade: '1' filtra só os documentos sinalizados e ainda não revisados.
    const f = { startDate: '', endDate: '', search: '', sort: 'date_desc', status: '', duplicidade: '', aprovacaoFornecedor: '' };
    let _project = localStorage.getItem(PROJECT_KEY) || '';
    Object.defineProperty(f, 'project', {
        get() { return _project; },
        set(v) {
            _project = v || '';
            if (_project) localStorage.setItem(PROJECT_KEY, _project);
            else localStorage.removeItem(PROJECT_KEY);
        },
        enumerable: true,
        configurable: true
    });
    return f;
}

const state = {
    isSolicitanteMode: isSolicitanteMode,
    currentView: isSolicitanteMode ? 'solicitante_login' : 'login',
    user: null,
    projects: [],
    planilhasPorProjeto: {}, // project_id -> { name, file_path } da planilha orçamentária
    documents: [],
    rubricas_disponiveis: [],
    catalogo_rubricas: [],
    currentDocument: null,
    // Documento apontado por currentDocument.duplicata_de_id, para o comparativo.
    currentDuplicata: null,
    // { extrato, lancamentoDaNota, lancamentos, notasPorId } — seção de extrato.
    currentExtrato: null,
    extratoLancamentosExpandido: false,
    loading: false,
    // Troca de senha obrigatória do primeiro acesso: distingue este fluxo do
    // de recuperação por e-mail, que compartilha a mesma UpdatePasswordView.
    forcarTrocaSenha: false,
    rubricas: [],
    filters: createFilters(),
    all_solicitantes: [],
    vinculos_solicitantes: [],
    uploadLoteQueue: [],
    // Extrato opcional vinculado ao lote atual: { id, nome, projectId }.
    // Guarda o projectId para não carimbar documentos de outro projeto —
    // a fila de lote é por usuário, não por projeto (ver fetchUploadLoteQueue).
    loteExtratoVinculado: null,
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
    rubrica_versions: [],
    equipe: [],
    salicLoteQueue: [],          // [{id, name, status, error, project_name}]
    salicLoteRunning: false,
    salicLoteCancelled: false,
    salicLoteProgress: { current: 0, total: 0 },
    in23ProjectFinanceiro: null,
    in23DocumentosConferidos: [],
    juntarPdfFiles: [],
    juntarPdfLoading: false,
    juntarPdfInModal: false,
    financeiroGrupoAtivo: null
};

function getUserRole() {
    return state.user?.app_metadata?.role || state.user?.user_metadata?.role || null;
}

function userCanDelete() {
    return getUserRole() === 'admin';
}

function userIsGestorOrAbove() {
    return ['admin', 'gestor'].includes(getUserRole());
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICIDADE DE NF
//
// nivel_duplicidade é preenchido pelo trigger documents_checa_duplicidade
// (migration_duplicidade_nf.sql) assim que numero_nf + cnpj_emissor + valor
// chegam — o OCR do n8n grava direto no banco, então a marca aparece sozinha na
// tela pelo Realtime, sem refresh. Aqui é só exibição: nada bloqueia o fluxo.
// ─────────────────────────────────────────────────────────────────────────────
const DUPLICIDADE_MAP = {
    confirmada: {
        label: 'Possível duplicata',
        titulo: 'Documento idêntico já registrado',
        descricao: 'Outro documento deste projeto tem o mesmo número, CNPJ e valor.',
        cor: '#B91C1C', fundo: '#FEE2E2', borda: '#FCA5A5', icone: 'copy',
    },
    possivel: {
        label: 'Conferir número',
        titulo: 'Mesmo número e CNPJ, valor diferente',
        descricao: 'Pode ser erro de digitação ou de leitura do OCR em um dos dois. Confira antes de seguir.',
        cor: '#92400E', fundo: '#FEF3C7', borda: '#FDE68A', icone: 'alert-triangle',
    },
};

function duplicidadeInfo(doc) {
    if (!doc || !doc.nivel_duplicidade) return null;
    return DUPLICIDADE_MAP[doc.nivel_duplicidade] || null;
}

function duplicidadesPendentes(docs) {
    return (docs || []).filter(d => d.nivel_duplicidade && !d.duplicidade_revisada);
}

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
    },
    'aguardando_rubrica': {
        label: 'Aguardando Rubrica',
        class: 'status-pending',
        description: 'Aguardando rubrica: Documento enviado em lote, aguardando o usuário escolher a rubrica antes de iniciar o processamento.'
    },
    // Gate das NFs subidas pelo próprio fornecedor: elas não passaram pelo crivo
    // do gestor, então param aqui até decisão humana (ver
    // migration_gate_aprovacao_fornecedor.sql).
    'aguardando_aprovacao_fornecedor': {
        label: 'Aguardando aprovação',
        class: 'status-pending',
        description: 'Aguardando aprovação: nota enviada pelo fornecedor. Um gestor precisa conferir os dados extraídos (CNAE, CNPJ, valor e rubrica) antes de liberar para o fluxo de conformidade.'
    },
    'rejeitado_fornecedor': {
        label: 'Rejeitada',
        class: 'status-error',
        description: 'Rejeitada: o gestor recusou esta nota enviada pelo fornecedor. O motivo está registrado e o fornecedor deve enviar um documento novo e corrigido.'
    },
    'validating': {
        label: 'Validando',
        class: 'status-processing',
        description: 'Validando: dados extraídos pelo OCR estão sendo verificados antes de avançar no fluxo.'
    },
    'validated': {
        label: 'Validado',
        class: 'status-pending',
        description: 'Validado: OCR concluído e dados conferidos, aguardando próxima etapa do fluxo.'
    },
    'divergencia_valor': {
        label: 'Divergência de Valor',
        class: 'status-error',
        description: 'Divergência de valor: o valor do comprovante não corresponde ao valor da nota fiscal.'
    },
    'divergencia_beneficiario': {
        label: 'Divergência de Beneficiário',
        class: 'status-error',
        description: 'Divergência de beneficiário: o fornecedor do comprovante não corresponde ao da nota fiscal.'
    }
};

// --- Templates ---

const Sidebar = () => `
<button class="hamburger-btn" aria-label="Abrir menu" onclick="document.querySelector('.sidebar').classList.toggle('sidebar-open');document.querySelector('.sidebar-overlay').classList.toggle('active')">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>
<div class="sidebar-overlay" onclick="document.querySelector('.sidebar').classList.remove('sidebar-open');this.classList.remove('active')"></div>
<aside class="sidebar">
    <div class="sidebar-logo">
        <img class="sidebar-logo-full" src="PAI-Logo-Azul.png" alt="Prestaí" style="height:28px;width:auto;">
        <img class="sidebar-logo-icon" src="PAI-Icone-Azul.png" alt="Prestaí" style="height:28px;width:auto;">
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
        <a class="nav-item ${['orcamento', 'rubricas'].includes(state.currentView) ? 'active' : ''}" onclick="window.navigate('orcamento')">
            <i data-lucide="list-checks"></i>
            <span>Rubricas</span>
        </a>
        <a class="nav-item ${['upload', 'details'].includes(state.currentView) ? 'active' : ''}" onclick="window.navigate('upload')">
            <i data-lucide="file-text"></i>
            <span>Documentos</span>
        </a>
        <a class="nav-item ${state.currentView === 'upload_lote' ? 'active' : ''}" onclick="window.navigate('upload_lote')">
            <i data-lucide="layers"></i>
            <span>Documentos em Lote</span>
        </a>
        <a class="nav-item ${state.currentView === 'envio_lote_salic' ? 'active' : ''}" onclick="window.navigate('envio_lote_salic')">
            <i data-lucide="send"></i>
            <span>Envio SALIC</span>
        </a>
        <a class="nav-item ${state.currentView === 'financeiro' ? 'active' : ''}" onclick="window.navigate('financeiro')">
            <i data-lucide="bar-chart-3"></i>
            <span>Relatórios</span>
        </a>
        ${userIsGestorOrAbove() ? `
        <a class="nav-item ${['ferramentas', 'ferramentas_juntar_pdf'].includes(state.currentView) ? 'active' : ''}" onclick="window.navigate('ferramentas')">
            <i data-lucide="wrench"></i>
            <span>Ferramentas</span>
        </a>
        ` : ''}
        ${userIsGestorOrAbove() ? `
        <!-- Equipe, Configurações e Solicitantes viraram páginas neutras na
             raiz do repo (fora de M1/M2/M3), acessíveis igualmente pelos 3
             módulos — ver DOC-EVIDENCIAS-M2-M3.md para o mesmo raciocínio de
             "sem dono" aplicado a outra área. Restritas a admin/gestor nos
             3 módulos (mesma filtragem usada para esconder itens sensíveis
             do operador). -->
        <a class="nav-item" href="solicitantes.html">
            <i data-lucide="users"></i>
            <span>Solicitantes</span>
        </a>
        <a class="nav-item" href="configuracoes.html">
            <i data-lucide="settings"></i>
            <span>Configurações</span>
        </a>
        <a class="nav-item" href="equipe.html">
            <i data-lucide="user-cog"></i>
            <span>Equipe</span>
        </a>
        ` : ''}
    </nav>

    <div class="sidebar-footer">
        <div class="sidebar-user">
            <div class="sidebar-avatar">
                ${state.user ? state.user.email[0].toUpperCase() : 'A'}
            </div>
            <div style="overflow: hidden;">
                <p style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; text-overflow: ellipsis;">
                    ${state.user ? state.user.email.split('@')[0] : 'Admin'}
                </p>
                <p style="font-size: 11px; color: var(--text-secondary);">${ROLE_LABELS[getUserRole()] || 'Gestor'}</p>
            </div>
        </div>
        <a class="nav-item" href="/module-selector.html" style="color: var(--primary);">
            <i data-lucide="grid-2x2"></i>
            <span>Trocar Módulo</span>
        </a>
        <a class="nav-item" onclick="window.handleLogout()" style="color: var(--error);">
            <i data-lucide="log-out"></i>
            <span>Sair</span>
        </a>
    </div>
</aside>
`;

// Helper for Header compatibility if needed
const Header = Sidebar;

// Botão para visualizar a Planilha Orçamentária (PDF do SALIC) do projeto
// atualmente selecionado. Retorna '' se não houver projeto ou planilha.
// Usado nas telas de Rubricas, Documentos e Documentos em Lote.
function planilhaOrcamentariaBtn() {
    const pl = state.planilhasPorProjeto && state.planilhasPorProjeto[state.filters.project];
    if (!pl || !pl.file_path) return '';
    const url = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/documentos/${pl.file_path}`;
    return `<button class="btn btn-primary" onclick="window.open('${url}', '_blank')" title="Abrir a Planilha Orçamentária (PDF do SALIC) deste projeto">
        <i data-lucide="file-spreadsheet" style="width: 16px;"></i> Veja a Planilha Orçamentária
    </button>`;
}


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
            <img src="PAI-Logo-Azul.png" alt="Prestaí" style="height:48px;width:auto;margin-bottom:0.75rem;">
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
            <img src="PAI-Logo-Azul.png" alt="Prestaí" style="height:48px;width:auto;margin-bottom:0.75rem;">
            <p style="color: var(--text-muted); font-size: 0.875rem;">Crie sua conta gratuita</p>
        </div>
        
        <form onsubmit="event.preventDefault(); window.handleRegister();">
            <div class="form-group">
                <label for="reg-email">E-mail</label>
                <input type="email" id="reg-email" placeholder="seu@email.com" required>
            </div>
            
            <div class="form-group">
                <label for="reg-org-name">Nome da Organização</label>
                <input type="text" id="reg-org-name" placeholder="Sua Produtora ou Entidade" required>
            </div>

            <div class="form-group">
                <label>Módulos de Interesse</label>
                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-sm); font-size: 0.875rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" name="reg-modules" value="modulo_1" checked> 
                        <span>Módulo I (Comprovação Financeira RPA)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" name="reg-modules" value="modulo_2"> 
                        <span>Módulo II (Prestação de Contas & Contratos)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: not-allowed; color: var(--text-muted);">
                        <input type="checkbox" name="reg-modules" value="modulo_3" disabled> 
                        <span>Módulo III (Contrapartidas - Em breve)</span>
                    </label>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="form-group">
                    <label for="reg-password">Senha</label>
                    <input type="password" id="reg-password" placeholder="••••••••" required minlength="6">
                </div>
                <div class="form-group">
                    <label for="reg-password-confirm">Confirmar Senha</label>
                    <input type="password" id="reg-password-confirm" placeholder="••••••••" required minlength="6">
                </div>
            </div>
            
            <button class="btn btn-primary" id="register-btn" style="width: 100%; margin-top: 0.5rem;" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? 'Criando conta...' : 'Cadastrar e Acessar'}
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
            <img src="PAI-Logo-Azul.png" alt="Prestaí" style="height:48px;width:auto;margin-bottom:0.75rem;">
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
            <img src="PAI-Logo-Azul.png" alt="Prestaí" style="height:48px;width:auto;margin-bottom:0.75rem;">
            <h3 class="h2">${state.forcarTrocaSenha ? 'Defina sua senha' : 'Nova Senha'}</h3>
            <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem;">
                ${state.forcarTrocaSenha
        ? 'Sua conta foi criada com uma senha provisória. Escolha uma senha pessoal para continuar.'
        : 'Defina sua nova senha de acesso'}
            </p>
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
                ${state.loading ? 'Atualizando...' : (state.forcarTrocaSenha ? 'Definir senha e entrar' : 'Redefinir Senha')}
            </button>

            ${state.forcarTrocaSenha ? `
            <!-- Saída para quem entrou na conta errada: sem isto a troca
                 obrigatória é um beco sem saída. type="button" para não
                 submeter o form. No fluxo de recuperação por e-mail não
                 aparece — lá a pessoa já escolheu trocar a senha. -->
            <button type="button" class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;"
                onclick="window.handleLogout()">
                Sair
            </button>` : ''}
        </form>
    </div>
</div>
`;

const SemAcessoView = () => `
<main class="main-content view-content" style="display:flex;align-items:center;justify-content:center;min-height:100vh;">
    <div class="card" style="max-width:420px;text-align:center;padding:2rem;">
        <img src="PAI-Logo-Azul.png" alt="Prestaí" style="height:32px;width:auto;margin-bottom:1.5rem;">
        <i data-lucide="shield-off" style="width:40px;height:40px;color:var(--text-muted);margin-bottom:1rem;"></i>
        <h2 class="h2">Sem acesso</h2>
        <p class="text-sm" style="color:var(--text-secondary);margin:0.75rem 0 1.5rem;">
            Seu perfil não tem uma área disponível neste portal no momento.
        </p>
        <button class="btn btn-secondary" onclick="window.handleLogout()">Sair</button>
    </div>
</main>
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
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <select id="f-upload-project" style="width: 100%; padding: 0.625rem; border-radius: var(--radius-sm); border: 1px solid var(--border-light);" onchange="window.updateSolicitanteUploadButtons()">
                            <option value="">Selecione o Projeto / PRONAC...</option>
                            ${state.projects.map(p => `<option value="${p.project_id}" data-modulos='${JSON.stringify(p.modulos || [])}'>${p.projects.pronac} - ${p.projects.nome}</option>`).join('')}
                        </select>
                        
                        <div id="upload-buttons-area" style="display: none; gap: 1rem;">
                            <button class="btn btn-primary" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); width: 100%; justify-content: center; font-size: 1rem; padding: 1rem;" onclick="window.openUnifiedUploadModal()">
                                <i data-lucide="plus-circle" style="width: 20px; height: 20px;"></i> Adicionar Novo Documento
                            </button>
                        </div>
                        <p id="upload-hint" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;">Selecione um projeto acima para ver as opções de envio.</p>
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
                            ${state.documents.map(doc => {
        // O fornecedor vê o ESTADO, não o detalhe interno da análise.
        const emAnalise = doc.status === 'aguardando_aprovacao_fornecedor';
        const rejeitada = doc.status === 'rejeitado_fornecedor';
        const rotulo = emAnalise ? 'Em análise pelo gestor'
            : (STATUS_MAP[doc.status] || {}).label || (doc.is_m2 ? (doc.status.charAt(0).toUpperCase() + doc.status.slice(1)) : doc.status);
        const classe = (STATUS_MAP[doc.status] || {}).class || (doc.is_m2 ? (doc.status === 'aprovada' ? 'status-success' : doc.status === 'reprovada' ? 'status-error' : 'status-pending') : 'status-pending');
        return `
                                <tr${rejeitada ? ' style="background: rgba(239, 68, 68, 0.04);"' : ''}>
                                    <td>
                                        <div class="file-info">
                                            <span class="file-name">${doc.name}</span>
                                            <span class="file-size">${doc.size || '---'}</span>
                                        </div>
                                    </td>
                                    <td style="font-size: 0.875rem;">${doc.projects ? doc.projects.pronac : '---'}</td>
                                    <td>
                                        <span class="badge ${classe}">
                                            <span class="badge-dot"></span>
                                            ${rotulo}
                                        </span>
                                        ${rejeitada ? `
                                            <div style="margin-top: 0.5rem; padding: 0.6rem 0.75rem; background: #FEE2E2; border: 1px solid #FCA5A5; border-radius: var(--radius-sm); max-width: 420px;">
                                                <p style="margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #B91C1C;">Motivo da recusa</p>
                                                <p style="margin: 0; font-size: 0.8rem; color: #B91C1C; white-space: pre-wrap;">${escAttr(doc.motivo_rejeicao_fornecedor || 'Motivo não informado.')}</p>
                                                <p style="margin: 0.45rem 0 0; font-size: 0.75rem; color: #B91C1C;">
                                                    Corrija e envie um <strong>novo documento</strong> usando "Adicionar Novo Documento" acima.
                                                </p>
                                            </div>` : ''}
                                    </td>
                                    <td style="color: var(--text-muted); font-size: 0.75rem;">${new Date(doc.created_at).toLocaleString('pt-BR')}</td>
                                </tr>
                            `;
    }).join('')}
                        </tbody>
                    </table>`
    }
                </div>
            </div>
        </div>
    </main>

    <!-- Modal Unificado Upload -->
    <div id="modal-upload-unified" class="modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; align-items: center; justify-content: center;">
        <div style="background: white; border-radius: var(--radius-lg); width: 100%; max-width: 500px; padding: 2rem; box-shadow: var(--shadow-lg); max-height: 90vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.25rem;">Enviar Arquivo</h3>
                <button class="btn btn-ghost" onclick="document.getElementById('modal-upload-unified').style.display='none'" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; display: block;">O que você deseja enviar?</label>
                <div style="display: flex; gap: 1rem;">
                    <label style="flex: 1; border: 2px solid var(--border-light); padding: 1.5rem 1rem; border-radius: 8px; cursor: pointer; text-align: center; transition: all 0.2s;" id="label-tipo-nf" onclick="window.selectUnifiedType('nf')">
                        <input type="radio" name="unified_type" value="nf" style="display:none;">
                        <i data-lucide="file-text" style="margin: 0 auto 0.75rem; color: #f59e0b; width: 32px; height: 32px;"></i>
                        <div style="font-weight: 600; font-size: 0.875rem;">Nota Fiscal<br>Recibo</div>
                    </label>
                    <label style="flex: 1; border: 2px solid var(--border-light); padding: 1.5rem 1rem; border-radius: 8px; cursor: pointer; text-align: center; transition: all 0.2s;" id="label-tipo-m2" onclick="window.selectUnifiedType('m2')">
                        <input type="radio" name="unified_type" value="m2" style="display:none;">
                        <i data-lucide="camera" style="margin: 0 auto 0.75rem; color: #4f46e5; width: 32px; height: 32px;"></i>
                        <div style="font-weight: 600; font-size: 0.875rem;">Comprovação<br>Física</div>
                    </label>
                </div>
            </div>

            <!-- Campos NF -->
            <div id="unified-fields-nf" style="display: none; margin-bottom: 1.5rem;">
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem;">Anexe a nota fiscal e nossa inteligência artificial fará a leitura e o processamento automático do pagamento.</p>
                <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; font-size: 0.9rem;">Arquivo PDF / Imagem *</label>
                <input type="file" id="f-upload-nf" accept=".pdf,.png,.jpg,.jpeg" style="width: 100%; padding: 0.75rem; border: 1px dashed var(--border-light); border-radius: 6px;">
            </div>

            <!-- Campos M2 -->
            <div id="unified-fields-m2" style="display: none; margin-bottom: 1.5rem;">
                <div style="margin-bottom: 1rem;">
                    <label style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; display: block;">Tipo de Evidência *</label>
                    <select id="m2-tipo-evidencia" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-light); border-radius: 6px;">
                        <option value="">Selecione...</option>
                        <option value="foto_evento">Foto do Evento</option>
                        <option value="relatorio_objeto">Relatório Fotográfico/Objeto</option>
                        <option value="peca_marketing">Peça de Marketing/Divulgação</option>
                        <option value="outros">Outros</option>
                    </select>
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; display: block;">Descrição (Opcional)</label>
                    <textarea id="m2-descricao" rows="2" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-light); border-radius: 6px;" placeholder="Detalhes do arquivo..."></textarea>
                </div>
                <div>
                    <label style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; display: block;">Arquivo / Mídia *</label>
                    <input type="file" id="m2-file-upload" accept=".pdf,.png,.jpg,.jpeg,.mp4" style="width: 100%; padding: 0.75rem; border: 1px dashed var(--border-light); border-radius: 6px;">
                </div>
            </div>

            <button class="btn btn-primary" id="btn-submit-unified" style="width: 100%; justify-content: center; display: none; padding: 1rem;" onclick="window.submitUnifiedFile()">
                Confirmar Envio
            </button>
        </div>
    </div>
</div>
`;

const DashboardView = () => {
    const totalAnalisadas = state.documents.length;
    const pendentes = state.documents.filter(d => ['uploaded', 'processing_ocr', 'validating', 'aguardando_conformidade', 'aguardando_comprovante', 'aguardando_conciliacao_bancaria', 'aguardando_d3', 'liberado_rpa_airtop'].includes(d.status)).length;
    const erros = state.documents.filter(d => ['erro_rpa', 'bloqueado_conformidade', 'revisao_manual', 'divergencia_valor', 'divergencia_beneficiario'].includes(d.status)).length;

    // Calcular valor aprovado (se disponível no state ou se precisarmos calcular de despesas)
    // Para simplificar agora, vamos mostrar o número de notas validadas se o valor não estiver fácil
    const aprovadas = state.documents.filter(d => ['validated', 'enviado_salic', 'concluido'].includes(d.status)).length;

    const duplicidades = duplicidadesPendentes(state.documents).length;
    const filtrandoDuplicidade = state.filters.duplicidade === '1';

    // Fila de aprovação das NFs do fornecedor — só admin/gestor decide.
    const podeAprovarFornecedor = userIsGestorOrAbove();
    const aguardandoAprovacao = podeAprovarFornecedor
        ? state.documents.filter(d => d.status === 'aguardando_aprovacao_fornecedor').length
        : 0;
    const filtrandoAprovacao = podeAprovarFornecedor && state.filters.aprovacaoFornecedor === '1';

    const docsVisiveis = filtrandoAprovacao
        ? state.documents.filter(d => d.status === 'aguardando_aprovacao_fornecedor')
        : (filtrandoDuplicidade ? duplicidadesPendentes(state.documents) : state.documents);

    const sortedDocs = [...docsVisiveis].sort((a, b) => {
        switch (state.filters.sort) {
            case 'date_asc': return new Date(a.created_at) - new Date(b.created_at);
            case 'status': {
                const la = (STATUS_MAP[a.status] || {}).label || a.status || '';
                const lb = (STATUS_MAP[b.status] || {}).label || b.status || '';
                return la.localeCompare(lb, 'pt-BR');
            }
            case 'name': return (a.name || '').localeCompare(b.name || '', 'pt-BR');
            case 'date_desc':
            default: return new Date(b.created_at) - new Date(a.created_at);
        }
    });

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
            <p class="metric-label">Em processo</p>
            <div class="metric-value" style="color: var(--warning);">${pendentes}</div>
        </div>
        <div class="card metric-card">
            <p class="metric-label">Notas aprovadas</p>
            <div class="metric-value" style="color: var(--success);">${aprovadas}</div>
        </div>
        ${podeAprovarFornecedor && (aguardandoAprovacao > 0 || filtrandoAprovacao) ? `
        <div class="card metric-card" role="button" tabindex="0"
            title="${filtrandoAprovacao ? 'Mostrar todas as notas' : 'Mostrar só as notas do fornecedor aguardando aprovação'}"
            onclick="window.toggleFiltroAprovacaoFornecedor()"
            style="cursor: pointer; ${filtrandoAprovacao ? 'outline: 2px solid var(--primary); outline-offset: -2px;' : ''}">
            <p class="metric-label">Notas do fornecedor a aprovar</p>
            <div class="metric-value" style="color: var(--warning);">${aguardandoAprovacao}</div>
            <p class="text-xs" style="color: var(--text-muted); margin-top: 0.25rem;">
                ${filtrandoAprovacao ? 'Filtro ativo — clique para limpar' : 'Clique para filtrar'}
            </p>
        </div>` : ''}
        ${duplicidades > 0 || filtrandoDuplicidade ? `
        <div class="card metric-card" role="button" tabindex="0"
            title="${filtrandoDuplicidade ? 'Mostrar todas as notas' : 'Mostrar só as duplicidades a revisar'}"
            onclick="window.toggleFiltroDuplicidade()"
            style="cursor: pointer; ${filtrandoDuplicidade ? 'outline: 2px solid var(--primary); outline-offset: -2px;' : ''}">
            <p class="metric-label">Duplicidades a revisar</p>
            <div class="metric-value" style="color: #B91C1C;">${duplicidades}</div>
            <p class="text-xs" style="color: var(--text-muted); margin-top: 0.25rem;">
                ${filtrandoDuplicidade ? 'Filtro ativo — clique para limpar' : 'Clique para filtrar'}
            </p>
        </div>` : ''}
        <div class="card metric-card">
            <p class="metric-label">Divergências</p>
            <div class="metric-value" style="color: var(--error);">${erros}</div>
        </div>
    </div>
    
    <div class="card mb-4" style="padding: 1rem 1.5rem;">
        <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 0;">
                <input type="text" placeholder="Pesquisar notas..." value="${state.filters.search}" oninput="window.updateFilters('search', this.value)">
            </div>
            <div style="flex: 1 1 160px; min-width: 0;">
                <select onchange="window.updateFilters('project', this.value)">
                    <option value="">Todos os projetos</option>
                    ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
            </div>
            <div style="flex: 1 1 160px; min-width: 0;">
                <select onchange="window.updateFilters('status', this.value)">
                    <option value="">Todos os status</option>
                    <option value="uploaded" ${state.filters.status === 'uploaded' ? 'selected' : ''}>Enviado</option>
                    <option value="processing_ocr" ${state.filters.status === 'processing_ocr' ? 'selected' : ''}>Em Processamento</option>
                    <option value="aguardando_comprovante" ${state.filters.status === 'aguardando_comprovante' ? 'selected' : ''}>Falta Comprovante</option>
                    <option value="aguardando_conciliacao_bancaria" ${state.filters.status === 'aguardando_conciliacao_bancaria' ? 'selected' : ''}>Falta Conciliação</option>
                    <option value="aguardando_d3" ${state.filters.status === 'aguardando_d3' ? 'selected' : ''}>Em carência (D-3)</option>
                    <option value="liberado_rpa_airtop" ${state.filters.status === 'liberado_rpa_airtop' ? 'selected' : ''}>Pronto para envio</option>
                    <option value="enviado_salic" ${state.filters.status === 'enviado_salic' ? 'selected' : ''}>Enviado ao SALIC</option>
                    <option value="concluido" ${state.filters.status === 'concluido' ? 'selected' : ''}>Concluído</option>
                    <option value="aguardando_conformidade" ${state.filters.status === 'aguardando_conformidade' ? 'selected' : ''}>Em Auditoria IA</option>
                    <option value="bloqueado_conformidade" ${state.filters.status === 'bloqueado_conformidade' ? 'selected' : ''}>Bloqueado</option>
                    <option value="revisao_manual" ${state.filters.status === 'revisao_manual' ? 'selected' : ''}>Revisão Manual</option>
                    <option value="erro_rpa" ${state.filters.status === 'erro_rpa' ? 'selected' : ''}>Erro no Envio</option>
                    <option value="validating" ${state.filters.status === 'validating' ? 'selected' : ''}>Validando</option>
                    <option value="validated" ${state.filters.status === 'validated' ? 'selected' : ''}>Validado</option>
                    <option value="divergencia_valor" ${state.filters.status === 'divergencia_valor' ? 'selected' : ''}>Divergência de Valor</option>
                    <option value="divergencia_beneficiario" ${state.filters.status === 'divergencia_beneficiario' ? 'selected' : ''}>Divergência de Beneficiário</option>
                </select>
            </div>
            <div style="flex: 1 1 160px; min-width: 0;">
                <select onchange="window.updateSort(this.value)">
                    <option value="date_desc" ${state.filters.sort === 'date_desc' ? 'selected' : ''}>Ordenar: Mais recentes</option>
                    <option value="date_asc" ${state.filters.sort === 'date_asc' ? 'selected' : ''}>Ordenar: Mais antigos</option>
                    <option value="status" ${state.filters.sort === 'status' ? 'selected' : ''}>Ordenar: Status</option>
                    <option value="name" ${state.filters.sort === 'name' ? 'selected' : ''}>Ordenar: Nome (A-Z)</option>
                </select>
            </div>
            <button class="btn btn-secondary" onclick="window.clearFilters()">Limpar filtros</button>
            ${userCanDelete() ? `<button class="btn btn-secondary" id="btn-excluir-lote-dashboard" style="display: none; background: var(--error); color: white; border: none; align-items: center; gap: 0.25rem;" onclick="window.handleDeleteSelectedDocuments()">
                <i data-lucide="trash-2" style="width: 16px;"></i>
                Excluir Selecionados (<span id="count-excluir-lote-dashboard">0</span>)
            </button>` : ''}
            <button class="btn btn-primary" onclick="window.navigate('upload')">
                <i data-lucide="upload-cloud"></i>
                Enviar nota
            </button>
        </div>
    </div>

    <div class="data-table-container">
        ${sortedDocs.length === 0 ? `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="${filtrandoDuplicidade ? 'check-circle' : 'file-warning'}"></i></div>
                ${filtrandoDuplicidade ? `
                    <h3 class="h2">Nenhuma duplicidade a revisar</h3>
                    <p class="text-sm">Todas as duplicidades sinalizadas já foram revisadas.</p>
                    <button class="btn btn-primary" onclick="window.toggleFiltroDuplicidade()">Ver todas as notas</button>
                ` : `
                    <h3 class="h2">Nenhuma nota encontrada</h3>
                    <p class="text-sm">Tente ajustar seus filtros ou envie sua primeira nota fiscal para começar.</p>
                    <button class="btn btn-primary" onclick="window.navigate('upload')">Enviar nota</button>
                `}
            </div>
        ` : `
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 40px; text-align: center;">
                            <input type="checkbox" id="chk-dashboard-select-all" onchange="window.handleSelectAllDashboardDocs(this.checked)">
                        </th>
                        <th>Arquivo</th>
                        <th>Projeto</th>
                        <th>Status</th>
                        <th>Data</th>
                        <th style="text-align: right;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedDocs.map(doc => {
        const status = STATUS_MAP[doc.status] || { label: doc.status, class: 'status-pending' };
        const project = state.projects.find(p => p.id === doc.project_id);
        return `
                        <tr id="doc-row-${doc.id}">
                            <td style="text-align: center;">
                                <input type="checkbox" class="chk-doc-dashboard" data-id="${doc.id}" data-file-path="${doc.file_path}" onchange="window.handleDashboardDocCheckboxChange()">
                            </td>
                            <td>
                                <div style="font-weight: 500;">${doc.name}</div>
                                <div class="text-xs">${doc.size || '---'}</div>
                                ${(() => {
            const dup = duplicidadeInfo(doc);
            if (!dup) return '';
            // Clicar abre o documento já com o comparativo lado a lado.
            return `<button type="button" title="${dup.titulo}"
                                    onclick="event.stopPropagation(); window.navigate('details', '${doc.id}')"
                                    style="margin-top: 0.35rem; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.15rem 0.5rem; border-radius: 9999px; border: 1px solid ${dup.borda}; background: ${dup.fundo}; color: ${dup.cor}; font-size: 11px; font-weight: 600; cursor: pointer; ${doc.duplicidade_revisada ? 'opacity: 0.55;' : ''}">
                                    <i data-lucide="${dup.icone}" style="width: 12px;"></i>
                                    ${dup.label}${doc.duplicidade_revisada ? ' · revisado' : ''}
                                </button>`;
        })()}
                            </td>
                            <td>
                                <div class="text-sm">${project ? project.pronac : '---'}</div>
                            </td>
                            <td>
                                <span class="badge ${status.class}">
                                    <span class="badge-dot"></span>
                                    ${status.label}
                                </span>
                                ${estaTravado(doc) ? `
                                    <button type="button" title="Sem avançar há ${formatarTempoTravado(minutosParadoDoc(doc))} — clique para reprocessar"
                                        onclick="event.stopPropagation(); window.handleReprocessarDocumentoTravado('${doc.id}')"
                                        style="margin-top: 0.35rem; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.15rem 0.5rem; border-radius: 9999px; border: 1px solid #FCA5A5; background: #FEE2E2; color: #B91C1C; font-size: 11px; font-weight: 600; cursor: pointer;">
                                        <i data-lucide="alert-triangle" style="width: 12px;"></i>
                                        Parado há ${formatarTempoTravado(minutosParadoDoc(doc))} — reprocessar
                                    </button>` : ''}
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
                        <th>Valor Aprovado</th>
                        <th>Data importação Prestaí</th>
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
                                R$ ${parseValorBR(p.valor_aprovado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                                    ${(() => {
        const role = getUserRole();
        return (role === 'gestor' || role === 'analista') ? `
                                    <button class="btn btn-secondary" style="padding: 0.4rem;" title="Baixar Laudo Excel" onclick="window.generateLaudoExcel('${p.id}')">
                                        <i data-lucide="file-spreadsheet" style="width: 16px;"></i>
                                    </button>
                                    ` : '';
    })()}

                                    ${userCanDelete() ? `
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
                    <select id="project-selector" onchange="state.filters.project = this.value; window.handleProjectSelectChange(this.value); render();">
                        <option value="">Selecione um projeto...</option>
                        ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                    </select>
                </div>

                ${planilhaOrcamentariaBtn() ? `<div class="mb-4">${planilhaOrcamentariaBtn()}</div>` : ''}

                <div class="form-group mb-4">
                    <label>Rubrica Orçamentária (Obrigatório)</label>
                    <input type="text" id="rubrica-input" data-rubrica-combo placeholder="Digite para buscar rubrica..." autocomplete="off" style="width: 100%;">
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

                <div style="text-align: center; margin-top: 8px;">
                    <button onclick="window.openFerramentasModal()"
                        style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 12px; text-decoration: underline; padding: 4px 8px;">
                        🔧 Precisa juntar arquivos antes de subir? Clique aqui
                    </button>
                </div>

                ${state.loading ? `<p class="text-xs mt-4" style="color: var(--primary); text-align: center;">Enviando arquivo, aguarde...</p>` : ''}
            </div>
            
            <p class="text-xs mt-4" style="text-align: center; color: var(--text-muted);">
                Precisa de um novo projeto? <a href="#" onclick="window.navigate('create_project')" style="color: var(--primary); font-weight: 600;">Cadastre aqui</a>
            </p>
        </div>
    </main>
    `;

const UploadLoteView = () => {
    const fila = state.uploadLoteQueue || [];
    const projetoSelecionado = state.filters.project || '';
    const rubricas = state.rubricas_disponiveis || [];

    return `
${Sidebar()}
    <main class="main-content view-content">
        <header class="content-header">
            <h1>Documentos em Lote</h1>
            <p class="page-subtitle">Envie vários PDFs de uma vez. Depois escolha a rubrica de cada um e clique em Processar para iniciar o OCR.</p>
        </header>

        <div style="max-width: 900px; margin: 0 auto;">
            <div class="card mb-4">
                <h3 class="h2 mb-4">1. Selecionar arquivos</h3>

                <div class="form-group mb-4">
                    <label>Projeto / PRONAC</label>
                    <select id="lote-project-selector" onchange="window.handleLoteProjectChange(this.value)">
                        <option value="">Selecione um projeto...</option>
                        ${state.projects.map(p => `<option value="${p.id}" ${projetoSelecionado === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                    </select>
                </div>

                ${planilhaOrcamentariaBtn() ? `<div class="mb-4">${planilhaOrcamentariaBtn()}</div>` : ''}

                ${projetoSelecionado ? `
                <div class="form-group mb-4" id="lote-extrato-bloco">
                    <label>Extrato bancário do período (opcional)</label>
                    ${state.loteExtratoVinculado ? `
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.85rem 1rem; background: var(--bg-sidebar); border: 1px solid var(--border-light); border-radius: var(--radius-md);">
                            <div style="display: flex; align-items: center; gap: 0.6rem; min-width: 0;">
                                <i data-lucide="check-circle" style="width: 18px; color: var(--success); flex-shrink: 0;"></i>
                                <span class="text-sm" style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    Extrato vinculado: ${state.loteExtratoVinculado.nome}
                                </span>
                            </div>
                            <button class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 12px; flex-shrink: 0;" onclick="window.handleRemoverExtratoLote()">
                                Trocar
                            </button>
                        </div>
                        <p class="text-xs" style="color: var(--text-muted); margin-top: 0.5rem;">
                            As notas processadas abaixo nascerão vinculadas a este extrato.
                        </p>
                    ` : `
                        <div class="upload-area" style="padding: 1.25rem;" onclick="document.getElementById('lote-extrato-input').click()">
                            <input type="file" id="lote-extrato-input" accept=".ofx,.csv,.pdf" style="display: none;" onchange="window.handleUploadExtratoParaLote(this.files[0])">
                            <i data-lucide="landmark" style="width: 24px; color: var(--primary); margin-bottom: 0.5rem;"></i>
                            <p class="text-sm" style="font-weight: 600;">Clique para subir o extrato deste lote</p>
                            <p class="text-xs" style="color: var(--text-muted); margin-top: 0.35rem;">
                                As notas enviadas abaixo ficarão vinculadas a ele (OFX, CSV ou PDF).
                                Deixe em branco para subir notas sem extrato.
                            </p>
                        </div>
                    `}
                </div>
                ` : ''}

                <div class="upload-area" onclick="if(document.getElementById('lote-project-selector').value) document.getElementById('lote-file-input').click(); else alert('Selecione um projeto primeiro!');">
                    <input type="file" id="lote-file-input" multiple accept=".pdf" style="display: none;" onchange="window.handleLoteFilesSelected(this.files)">
                    <i data-lucide="layers" style="width: 32px; color: var(--primary); margin-bottom: 1rem;"></i>
                    <p class="text-sm" style="font-weight: 600;">Selecione vários PDFs ou clique para escolher</p>
                    <p class="text-xs" style="color: var(--text-muted); margin-top: 0.5rem;">Os arquivos serão enviados para a fila abaixo. Você escolhe a rubrica de cada um antes de processar.</p>
                </div>

                ${state.loading ? `<p class="text-xs mt-4" style="color: var(--primary); text-align: center;">Enviando arquivos para a fila, aguarde...</p>` : ''}
            </div>

            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 class="h2" style="margin: 0;">2. Fila aguardando rubrica (${fila.length})</h3>
                    ${fila.length > 0 ? `
                        <button class="btn btn-primary" onclick="window.handleProcessarTodosLote()" ${state.loading ? 'disabled' : ''}>
                            <i data-lucide="play" style="width: 16px;"></i> Processar todos preenchidos
                        </button>
                    ` : ''}
                </div>

                ${fila.length === 0 ? `
                    <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
                        <i data-lucide="inbox" style="width: 32px; margin-bottom: 0.75rem;"></i>
                        <p class="text-sm">Nenhum arquivo na fila. Selecione PDFs acima para começar.</p>
                    </div>
                ` : `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Arquivo</th>
                                <th>Tamanho</th>
                                <th>Rubrica</th>
                                <th style="width: 220px;">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${fila.map(doc => {
        // Pré-preenche com o rótulo completo quando a nota já tem rubrica vinculada,
        // para que a resolução no "Processar" case exatamente com a opção da lista.
        const rubricaPre = rubricas.find(r => r.id === doc.rubrica_id_fk);
        const valorInput = rubricaPre ? rotuloRubrica(rubricaPre) : (doc.rubrica || '');
        return `
                                <tr>
                                    <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${doc.name}">${doc.name}</td>
                                    <td>${doc.size || '-'}</td>
                                    <td>
                                        <input type="text" id="lote-rubrica-${doc.id}" data-rubrica-combo placeholder="${rubricas.length === 0 ? 'Selecione um projeto com rubricas...' : 'Digite para buscar rubrica...'}" autocomplete="off" style="width: 100%; padding: 0.5rem; font-size: 13px; border: 1px solid var(--border-light); border-radius: 4px; background: white;" value="${escAttr(valorInput)}" ${rubricas.length === 0 ? 'disabled' : ''}>
                                    </td>
                                    <td>
                                        <button class="btn btn-primary" style="padding: 0.4rem 0.75rem;" onclick="window.handleProcessarLoteItem('${doc.id}')">
                                            <i data-lucide="play" style="width: 14px;"></i> Processar
                                        </button>
                                        <button class="btn btn-ghost" style="padding: 0.4rem 0.5rem; color: var(--error);" onclick="window.handleExcluirLoteItem('${doc.id}', '${doc.file_path}')" title="Excluir">
                                            <i data-lucide="trash-2" style="width: 14px;"></i>
                                        </button>
                                    </td>
                                </tr>
                            `;
    }).join('')}
                        </tbody>
                    </table>
                `}
            </div>
        </div>
    </main>
    `;
};

// --- Envio SALIC em Lote ---

// Funções de Persistência da Fila do SALIC
function salvarFilaSalic() {
    localStorage.setItem('salicLoteQueue', JSON.stringify(state.salicLoteQueue));
    localStorage.setItem('salicLoteProgress', JSON.stringify(state.salicLoteProgress));
}

function carregarFilaSalic() {
    const queueData = localStorage.getItem('salicLoteQueue');
    const progressData = localStorage.getItem('salicLoteProgress');
    if (queueData) {
        try {
            state.salicLoteQueue = JSON.parse(queueData);
            // Se o app recarregar, qualquer item 'sending' deve voltar para 'pending'
            state.salicLoteQueue.forEach(item => {
                if (item.status === 'sending') {
                    item.status = 'pending';
                }
            });
            if (progressData) {
                state.salicLoteProgress = JSON.parse(progressData);
            }
        } catch (e) {
            console.error("Erro ao ler fila SALIC do localStorage:", e);
            state.salicLoteQueue = [];
            state.salicLoteProgress = { current: 0, total: 0 };
        }
    }
}

function limparFilaSalic() {
    localStorage.removeItem('salicLoteQueue');
    localStorage.removeItem('salicLoteProgress');
    state.salicLoteQueue = [];
    state.salicLoteProgress = { current: 0, total: 0 };
    state.salicLoteRunning = false;
    state.salicLoteCancelled = false;
}

const EnvioLoteSalicView = () => {
    // Se a fila estiver ativa (tem itens salvos no estado)
    const hasQueue = state.salicLoteQueue && state.salicLoteQueue.length > 0;

    if (!hasQueue) {
        // Modo Seleção
        // 'liberado_rpa_airtop' = prontos pela primeira vez; 'erro_rpa' = já
        // tentados e o robô falhou por motivo técnico (ex: instabilidade no
        // site do SALIC), não por bloqueio de conformidade — por isso entram
        // direto aqui, sem exigir o "Assumir risco" que o avanço manual de
        // status pede para os outros casos de erro (esses SIM são achados da
        // auditoria de conformidade, erro_rpa não é).
        const readyDocs = state.documents.filter(doc => ['liberado_rpa_airtop', 'erro_rpa'].includes(doc.status));
        const projetoSelecionado = state.filters.project || '';

        return `
        ${Sidebar()}
        <main class="main-content view-content">
            <header class="content-header">
                <h1>Envio SALIC em Lote</h1>
                <p class="page-subtitle">Selecione os documentos aprovados na auditoria de conformidade (incluindo reenvios de erro técnico do robô) para enviar em lote sequencial ao SALIC.</p>
            </header>

            <div class="salic-batch-container">
                <div class="card mb-4" style="padding: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <div class="form-group" style="margin-bottom: 0; flex: 1 1 200px; min-width: 0;">
                            <label>Filtrar por Projeto</label>
                            <select id="salic-lote-project-selector" onchange="window.updateFilters('project', this.value);">
                                <option value="">Todos os projetos...</option>
                                ${state.projects.map(p => `<option value="${p.id}" ${projetoSelecionado === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                            </select>
                        </div>
                        <div style="display: flex; gap: 0.5rem; align-self: flex-end;">
                            <button class="btn btn-secondary" onclick="window.handleSelectAllSalicDocs(true)">Selecionar Todos</button>
                            <button class="btn btn-ghost" onclick="window.handleSelectAllSalicDocs(false)">Desmarcar Todos</button>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <h3 class="h2" style="margin: 0;">Documentos Prontos para Envio (${readyDocs.length})</h3>
                        <button class="btn btn-primary" id="btn-iniciar-lote" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);" onclick="window.handleIniciarEnvioLote()" ${readyDocs.length === 0 ? 'disabled' : ''}>
                            <i data-lucide="play" style="width: 16px;"></i> Iniciar Envio
                        </button>
                    </div>

                    ${readyDocs.length === 0 ? `
                        <div style="padding: 3rem; text-align: center; color: var(--text-muted);">
                            <i data-lucide="send-to-back" style="width: 48px; height: 48px; margin-bottom: 1rem; color: var(--text-muted); opacity: 0.5;"></i>
                            <p class="text-sm" style="font-weight: 500;">Nenhum documento pronto ou com erro de envio encontrado.</p>
                            <p class="text-xs" style="margin-top: 0.25rem;">Aparecem aqui documentos liberados pelo RPA ("Pronto para envio") e os que o robô tentou enviar mas falhou por erro técnico ("Erro no Envio").</p>
                        </div>
                    ` : `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="width: 40px; text-align: center;">
                                        <input type="checkbox" id="chk-salic-select-all" onchange="window.handleSelectAllSalicDocs(this.checked)" checked>
                                    </th>
                                    <th>Documento</th>
                                    <th>Projeto</th>
                                    <th>Rubrica</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${readyDocs.map(doc => {
                                    const proj = state.projects.find(p => p.id === doc.project_id);
                                    const projLabel = proj ? `${proj.pronac} - ${proj.nome}` : 'Projeto não encontrado';
                                    return `
                                    <tr>
                                        <td style="text-align: center;">
                                            <input type="checkbox" class="chk-salic-doc" data-id="${doc.id}" data-name="${doc.name}" data-project="${projLabel}" checked>
                                        </td>
                                        <td style="font-weight: 600; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${doc.name}</td>
                                        <td style="font-size: 13px; color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${projLabel}</td>
                                        <td style="font-size: 13px; font-weight: 500;">${doc.rubrica_nome || doc.rubrica || '-'}</td>
                                        <td>
                                            ${doc.status === 'erro_rpa'
                                                ? '<span class="status-badge status-error">Reenvio (erro anterior)</span>'
                                                : '<span class="status-badge status-completed">Pronto</span>'}
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        </main>
        `;
    }

    // Modo Progresso/Fila Ativa
    const total = state.salicLoteProgress.total || 1;
    const current = state.salicLoteProgress.current || 0;
    const percentage = Math.round((current / total) * 100);

    const pendingCount = state.salicLoteQueue.filter(i => i.status === 'pending').length;
    const successCount = state.salicLoteQueue.filter(i => i.status === 'success').length;
    const errorCount = state.salicLoteQueue.filter(i => i.status === 'error').length;
    const isFinished = pendingCount === 0 && !state.salicLoteRunning;

    return `
    ${Sidebar()}
    <main class="main-content view-content">
        <header class="content-header">
            <h1>Envio SALIC em Lote (Progresso)</h1>
            <p class="page-subtitle">Os documentos estão sendo enviados sequencialmente para o SALIC. Por favor, mantenha esta aba aberta durante o processo.</p>
        </header>

        <div class="salic-batch-container">
            <!-- Box de Progresso Geral -->
            <div class="salic-progress-box">
                <div class="salic-progress-info">
                    <span class="salic-progress-label">
                        ${isFinished ? 'Envio concluído!' : state.salicLoteRunning ? 'Processando fila...' : 'Fila pausada'}
                    </span>
                    <span class="salic-progress-percentage">${percentage}%</span>
                </div>
                <div class="salic-progress-bar">
                    <div class="salic-progress-fill" style="width: ${percentage}%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; font-size: 13px; color: var(--text-secondary);">
                    <div>
                        <span>Sucesso: <strong style="color: var(--success);">${successCount}</strong></span>
                        <span style="margin-left: 1rem;">Erros: <strong style="color: var(--error);">${errorCount}</strong></span>
                        <span style="margin-left: 1rem;">Pendentes: <strong>${pendingCount}</strong></span>
                    </div>
                    <div>
                        ${state.salicLoteRunning ? `
                            <button class="btn btn-ghost" style="color: var(--error); padding: 0.4rem 1rem;" onclick="window.handleCancelarLoteSalic()">
                                <i data-lucide="square" style="width: 14px; margin-right: 0.25rem;"></i> Cancelar Envio
                            </button>
                        ` : `
                            <div style="display: flex; gap: 0.5rem;">
                                ${pendingCount > 0 ? `
                                    <button class="btn btn-primary" style="padding: 0.4rem 1rem;" onclick="window.handleRetomarLoteSalic()">
                                        <i data-lucide="play" style="width: 14px; margin-right: 0.25rem;"></i> Retomar
                                    </button>
                                ` : ''}
                                <button class="btn btn-ghost" style="padding: 0.4rem 1rem;" onclick="window.handleLimparFilaSalic()">
                                    <i data-lucide="trash-2" style="width: 14px; margin-right: 0.25rem;"></i> Limpar / Voltar
                                </button>
                            </div>
                        `}
                    </div>
                </div>
            </div>

            <!-- Fila de Itens -->
            <div class="card">
                <h3 class="h2 mb-4">Fila de Envio (${state.salicLoteQueue.length} documentos)</h3>
                <div class="salic-queue-list">
                    ${state.salicLoteQueue.map((item, idx) => {
                        let statusText = 'Pendente';
                        let iconName = 'clock';
                        if (item.status === 'sending') {
                            statusText = 'Enviando...';
                            iconName = 'loader-2';
                        } else if (item.status === 'success') {
                            statusText = 'Enviado';
                            iconName = 'check-circle';
                        } else if (item.status === 'error') {
                            statusText = 'Erro';
                            iconName = 'alert-circle';
                        }

                        const spinClass = item.status === 'sending' ? 'spin' : '';

                        return `
                        <div class="salic-queue-item ${item.status}">
                            <div class="salic-queue-item-left">
                                <div class="salic-queue-item-icon ${spinClass}">
                                    <i data-lucide="${iconName}"></i>
                                </div>
                                <div class="salic-queue-item-details">
                                    <span class="salic-queue-item-name" title="${item.name}">${item.name}</span>
                                    <span style="font-size: 11px; color: var(--text-secondary);">${item.project}</span>
                                    ${item.error ? `<span class="salic-queue-item-error-msg">${item.error}</span>` : ''}
                                </div>
                            </div>
                            <span class="salic-queue-item-status">
                                ${statusText}
                            </span>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    </main>
    `;
};

window.handleSelectAllSalicDocs = function (checked) {
    const checkboxes = document.querySelectorAll('.chk-salic-doc');
    checkboxes.forEach(chk => chk.checked = checked);
    const headerChk = document.getElementById('chk-salic-select-all');
    if (headerChk) headerChk.checked = checked;
};

window.handleIniciarEnvioLote = async function () {
    if (!supabaseClient || !state.user) return;

    // Verificar credenciais SALIC
    try {
        state.loading = true;
        render();

        const { data: creds, error: credError } = await supabaseClient
            .from('decrypted_external_credentials')
            .select('*')
            .eq('service_name', 'salic')
            .limit(1)
            .maybeSingle();

        if (credError) throw credError;
        if (!creds) {
            alert("Você precisa configurar suas credenciais SALIC em 'Configurações' antes de enviar em lote.");
            window.navigate('configuracoes');
            return;
        }
    } catch (err) {
        showToast("Erro ao verificar credenciais: " + err.message, 'error');
        return;
    } finally {
        state.loading = false;
        render();
    }

    const checkboxes = document.querySelectorAll('.chk-salic-doc:checked');
    if (checkboxes.length === 0) {
        alert("Por favor, selecione pelo menos um documento para enviar.");
        return;
    }

    const queue = [];
    checkboxes.forEach(chk => {
        queue.push({
            id: chk.getAttribute('data-id'),
            name: chk.getAttribute('data-name'),
            project: chk.getAttribute('data-project'),
            status: 'pending',
            error: null
        });
    });

    state.salicLoteQueue = queue;
    state.salicLoteProgress = { current: 0, total: queue.length };
    state.salicLoteRunning = true;
    state.salicLoteCancelled = false;

    salvarFilaSalic();
    render();

    // Inicia processamento assíncrono
    processarFilaSalic();
};

window.handleCancelarLoteSalic = function () {
    state.salicLoteCancelled = true;
    state.salicLoteRunning = false;
    showToast("Envio em lote cancelado pelo usuário. O envio atual terminará antes de parar.", "warning");
    salvarFilaSalic();
    render();
};

window.handleRetomarLoteSalic = function () {
    if (state.salicLoteRunning) return;
    state.salicLoteCancelled = false;
    state.salicLoteRunning = true;
    showToast("Retomando envio em lote...", "info");
    salvarFilaSalic();
    render();
    processarFilaSalic();
};

window.handleLimparFilaSalic = function () {
    if (state.salicLoteRunning) {
        alert("Não é possível limpar a fila enquanto ela está rodando.");
        return;
    }
    if (confirm("Tem certeza que deseja descartar a fila atual?")) {
        limparFilaSalic();
        fetchDocuments().then(render);
    }
};

async function processarFilaSalic() {
    if (!state.salicLoteRunning) return;

    for (let i = 0; i < state.salicLoteQueue.length; i++) {
        if (state.salicLoteCancelled) {
            state.salicLoteRunning = false;
            salvarFilaSalic();
            render();
            return;
        }

        const item = state.salicLoteQueue[i];
        if (item.status === 'success' || item.status === 'error') {
            continue;
        }

        item.status = 'sending';
        salvarFilaSalic();
        render();

        try {
            console.log(`[LOTE SALIC] Enviando: ${item.name}`);
            
            const fullUrl = CONFIG.SALIC_API_URL.startsWith('/')
                ? window.location.origin + CONFIG.SALIC_API_URL
                : CONFIG.SALIC_API_URL;

            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    documentId: item.id,
                    userId: state.user.id
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || "O servidor de API retornou erro.");
            }

            const resData = await response.json();
            if (resData.success) {
                item.status = 'success';
            } else {
                throw new Error("Erro no processamento da API.");
            }
        } catch (err) {
            item.status = 'error';
            item.error = err.message;
        }

        state.salicLoteProgress.current++;
        salvarFilaSalic();
        render();

        // 2 segundos de cortesia entre envios
        if (i < state.salicLoteQueue.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    state.salicLoteRunning = false;
    salvarFilaSalic();
    render();

    const successCount = state.salicLoteQueue.filter(item => item.status === 'success').length;
    const errorCount = state.salicLoteQueue.filter(item => item.status === 'error').length;
    showToast(`Lote processado! Sucessos: ${successCount}, Falhas: ${errorCount}`, 'info');
}

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

// Tempo (minutos) parado numa etapa intermediária do pipeline pra considerar
// "travado" e oferecer reprocessar. Ajustável aqui sem precisar de deploy de
// schema nem migração — é só uma constante de UI, mude e faça o commit normal.
const MINUTOS_TRAVADO = 30;
// bloqueado_conformidade fica de fora (já tem resultado — bloqueio é decisão
// tomada, não trava); aguardando_rubrica fica de fora (espera ação do gestor,
// não é falha de pipeline); aguardando_comprovante fica de fora (hoje é
// pulado automaticamente pelo trigger do banco, não deveria aparecer).
const STATUS_INTERMEDIARIOS_TRAVAVEIS = ['processing_ocr', 'validating', 'aguardando_conformidade'];
function estaTravado(doc) {
    if (!doc || !STATUS_INTERMEDIARIOS_TRAVAVEIS.includes(doc.status) || !doc.updated_at) return false;
    return minutosParadoDoc(doc) > MINUTOS_TRAVADO;
}
function minutosParadoDoc(doc) {
    return (Date.now() - new Date(doc.updated_at).getTime()) / 60000;
}
function formatarTempoTravado(minutos) {
    if (minutos < 60) return `${Math.floor(minutos)}min`;
    const horas = Math.floor(minutos / 60);
    const restoMin = Math.floor(minutos % 60);
    return restoMin > 0 ? `${horas}h${restoMin}min` : `${horas}h`;
}

// Guia de recolhimento (DARF/GPS/etc.) extraída pelo OCR em json_extraido.guia.
// Complementa o grid de "Dados Extraídos" do DetailsView — não é uma seção nova,
// nem indica visualmente "isto é uma guia": só entram as linhas cujo valor
// existe, no mesmo padrão info-item já usado ali. NF comum (sem doc.json_extraido
// .guia) não chama esta função com dado nenhum, então nada muda para ela.
// Sinaliza, no lugar do "---", quando um campo obrigatório para a comprovação
// financeira (mesmo critério de camposPendentes, ver DetailsView) está vazio —
// texto simples, sem ícone/cor de alerta forte, sem bloquear nenhuma ação.
const DADO_FALTANTE_MSG = 'Faltando dados para a comprovação financeira';
function renderCampoOuFaltando(valorFormatado, faltando) {
    return faltando
        ? `<span style="color: var(--text-secondary); font-weight: 400; font-style: italic;">${DADO_FALTANTE_MSG}</span>`
        : valorFormatado;
}

function renderDadosGuia(doc, esc) {
    const guia = doc?.json_extraido?.guia;
    if (!guia || typeof guia !== 'object') return '';

    const linha = (rotulo, valor) => (valor === null || valor === undefined || valor === '')
        ? ''
        : `<div class="info-item">
                            <label>${rotulo}</label>
                            <p class="text-sm" style="font-weight: 600;">${esc(valor)}</p>
                        </div>`;

    // vencimento chega em ISO (AAAA-MM-DD); competencia já vem como texto livre
    // ("06/2026") — só o primeiro precisa de parse para bater com o formato
    // dd/mm/aaaa usado em "Data de Emissão" no mesmo grid.
    const vencimentoFmt = guia.vencimento ? _laudoFmtDate(guia.vencimento) : null;
    const valorTributoFmt = guia.valor_tributo != null
        ? 'R$ ' + Number(guia.valor_tributo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        : null;
    const recolhidoPor = guia.recolhimento_nome
        ? guia.recolhimento_nome + (guia.recolhimento_cnpj ? ` (${guia.recolhimento_cnpj})` : '')
        : null;

    return [
        linha('Tributo', guia.tributo),
        linha('Competência', guia.competencia),
        linha('Vencimento', vencimentoFmt),
        linha('Valor do Tributo', valorTributoFmt),
        linha('Recolhido por', recolhidoPor),
        linha('Código de Receita', guia.codigo_receita),
    ].join('');
}

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
        { id: 'aguardando_comprovante', label: 'Preparação de Envio', icon: 'file-text' },
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
        else if (doc.status === 'divergencia_valor' || doc.status === 'divergencia_beneficiario') { errorAtStep = 4; activeIndex = 4; }
        else activeIndex = 0;
    } else {
        // Normaliza index para os 6 círculos visuais
        if (activeIndex > 5) activeIndex = 5;
    }

    const camposPendentes = {
        cnpj:   !doc.cnpj_emissor,
        nome:   !doc.nome_emissor,
        valor:  !doc.valor || Number(doc.valor) === 0,
        data:   !doc.data_emissao,
        numero: !doc.numero_nf
    };
    // So exibe o bloco de preenchimento manual quando o OCR de fato falhou
    // (status 'revisao_manual'); enquanto o OCR ainda esta processando, os
    // campos ficam null naturalmente e nao devem disparar o aviso.
    camposPendentes.algum = doc.status === 'revisao_manual'
        && Object.values(camposPendentes).some(Boolean);

    // Independente de status: usado pra bloquear o envio ao SALIC (diferente
    // de camposPendentes.algum, que só liga o banner em 'revisao_manual').
    const faltaDadoObrigatorioSalic = camposPendentes.cnpj || camposPendentes.nome
        || camposPendentes.valor || camposPendentes.data || camposPendentes.numero;

    // Extrato já vinculado via upload em lote (extrato_origem_id): reconhece no
    // front em vez de pedir upload manual de novo — a conciliação é automática.
    const extratoDoLote = !!doc.extrato_origem_id;
    const extratoStatusPendente = doc.status === 'aguardando_conciliacao_bancaria' || doc.status === 'aguardando_comprovante';
    // Botão de abrir o ARQUIVO do extrato (o que a Ana pediu: ver o documento).
    // Mesmo mecanismo já usado para o arquivo da NF nesta tela — URL pública do
    // bucket 'documentos', que é onde handleUploadExtrato grava os extratos.
    // OFX e CSV o navegador baixa em vez de exibir; é o comportamento esperado.
    const extratoArquivo = state.currentExtrato?.extrato?.file_path || null;
    const btnVerExtrato = extratoArquivo ? `
        <button class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 0.5rem;"
            onclick="window.open('${CONFIG.SUPABASE_URL}/storage/v1/object/public/documentos/${extratoArquivo}', '_blank')">
            <i data-lucide="file-search" style="width: 14px;"></i>
            Visualizar extrato${state.currentExtrato?.extrato?.formato ? ` (${String(state.currentExtrato.extrato.formato).toUpperCase()})` : ''}
        </button>` : '';

    let extratoBoxHtml;
    if (state.isUploadingExtrato) {
        extratoBoxHtml = `<div style="padding: 0.5rem; text-align: center;">
                        <div style="width: 100%; height: 6px; background: var(--bg-sidebar); border-radius: 3px; overflow: hidden; margin-bottom: 0.5rem;">
                            <div style="width: 60%; height: 100%; background: var(--primary); animation: loading 2s infinite ease-in-out;"></div>
                        </div>
                        <p class="text-xs" style="color: var(--primary); font-weight: 600;">Enviando extrato...</p>
                     </div>`;
    } else if (state.uploadConcluidoExtrato) {
        extratoBoxHtml = `<p class="text-xs mt-2" style="color: var(--success); font-weight: bold; text-align: center;">✓ Upload do extrato já foi realizado.</p>`;
    } else if (extratoDoLote && !state.mostrarUploadManualExtrato) {
        extratoBoxHtml = `<div style="display: flex; flex-direction: column; gap: 0.25rem;">
                                    <p class="text-xs" style="color: var(--success); font-weight: bold;">✓ Extrato vinculado no upload em lote.</p>
                                    <p class="text-xs" style="color: var(--text-muted); font-style: italic;">A conciliação com este extrato é automática — não é necessário enviar de novo.</p>
                                    <button class="btn btn-secondary" style="width: 100%; font-size: 10px; padding: 0.4rem; margin-top: 0.25rem;" onclick="window.toggleUploadManualExtrato()">Enviar um extrato diferente manualmente</button>
                                 </div>`;
    } else {
        extratoBoxHtml = `<button class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;" onclick="document.getElementById('vincular-extrato-input').click()">
                                        <i data-lucide="file-up" style="width: 14px;"></i>
                                        Subir Extrato (OFX/CSV/PDF)
                                     </button>
                                     <input type="file" id="vincular-extrato-input" style="display: none;" onchange="window.handleUploadExtrato(this.files[0], '${doc.project_id}', '${doc.id}', '${state.currentComprovante?.id || ''}')" accept=".ofx,.csv,.pdf">
                                     ${extratoDoLote ? `<p class="text-xs" style="color: var(--text-muted); font-style: italic; margin-top: 0.5rem; text-align: center; cursor: pointer;" onclick="window.toggleUploadManualExtrato()">Cancelar e usar o extrato do lote</p>` : ''}`;
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
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div class="badge ${(STATUS_MAP[doc.status] || {}).class || 'status-pending'}">
                    <span class="badge-dot"></span>
                    ${(STATUS_MAP[doc.status] || {}).label || doc.status}
                </div>
                ${(() => {
        const role = getUserRole();
        return (role === 'gestor' || role === 'analista') ? `
                <button class="btn btn-secondary" title="Baixar Laudo Excel desta NF" onclick="window.generateLaudoExcelDoc('${doc.id}')">
                    <i data-lucide="file-spreadsheet" style="width: 16px;"></i>
                    Baixar Laudo
                </button>
                ` : '';
    })()}
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

        ${estaTravado(doc) ? `
        <div class="card mb-4" style="background: #FEF2F2; border-left: 4px solid #DC2626; padding: 1.25rem;">
            <div style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                <div style="display: flex; gap: 1rem; align-items: flex-start;">
                    <div style="background: #DC2626; color: white; padding: 0.5rem; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <i data-lucide="alert-triangle" style="width: 18px;"></i>
                    </div>
                    <div>
                        <h4 style="font-size: 14px; margin-bottom: 0.25rem; font-weight: 700; color: #991B1B;">Documento parado há ${formatarTempoTravado(minutosParadoDoc(doc))}</h4>
                        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">Esta etapa costuma terminar rápido — outros documentos do mesmo lote provavelmente já avançaram. Pode ser uma falha pontual no processamento automático.</p>
                    </div>
                </div>
                <button class="btn btn-primary" style="background: #DC2626; border: none; white-space: nowrap;" onclick="window.handleReprocessarDocumentoTravado('${doc.id}')">
                    <i data-lucide="refresh-cw" style="width: 14px;"></i>
                    Reprocessar documento
                </button>
            </div>
        </div>
        ` : ''}

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

        ${AprovacaoFornecedorSection(doc)}

        ${(() => {
        const dup = duplicidadeInfo(doc);
        if (!dup) return '';
        const outro = state.currentDuplicata;
        const fmtV = (v) => v != null ? 'R$ ' + parseValorBR(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '---';
        const fmtD = (d) => d ? _laudoFmtDate(d) : '---';
        // Destaca só o que difere NOS CAMPOS FISCAIS: é o que decide se é duplicata
        // de verdade. O nome do arquivo sempre difere entre dois envios, então
        // marcá-lo só criaria ruído (comparar: false).
        const linha = (rotulo, a, b, comparar = true) => {
            const difere = comparar && outro && String(a ?? '') !== String(b ?? '');
            return `<tr>
                <th style="text-align:left; padding:0.4rem 0.75rem 0.4rem 0; font-size:11px; text-transform:uppercase; letter-spacing:0.03em; color:var(--text-secondary); font-weight:700; white-space:nowrap;">${rotulo}</th>
                <td style="padding:0.4rem 0.75rem; font-size:13px; font-weight:600;">${a}</td>
                <td style="padding:0.4rem 0; font-size:13px; font-weight:600; ${difere ? `color:${dup.cor};` : ''}">${outro ? b : '<span style="color:var(--text-muted);font-weight:400;">—</span>'}${difere ? ' <span style="font-size:11px;font-weight:700;">≠</span>' : ''}</td>
            </tr>`;
        };
        return `
        <div class="card" style="margin-bottom: 1.5rem; border: 1px solid ${dup.borda}; background: ${dup.fundo};">
            <div style="display:flex; align-items:flex-start; gap:0.75rem; flex-wrap:wrap;">
                <i data-lucide="${dup.icone}" style="width:20px; color:${dup.cor}; flex-shrink:0; margin-top:0.15rem;"></i>
                <div style="flex:1; min-width:220px;">
                    <p style="margin:0; font-weight:700; color:${dup.cor};">${dup.titulo}</p>
                    <p class="text-sm" style="margin:0.25rem 0 0; color:${dup.cor};">${dup.descricao}</p>
                </div>
                ${doc.duplicidade_revisada
                ? `<span class="badge" style="background:white; color:${dup.cor}; border:1px solid ${dup.borda};">
                           <i data-lucide="check" style="width:12px;"></i> Revisado
                       </span>`
                : `<button class="btn btn-secondary" style="padding:0.4rem 0.75rem; font-size:12px; background:white;"
                            onclick="window.handleMarcarDuplicidadeRevisada('${doc.id}')">
                           <i data-lucide="check" style="width:14px;"></i> Marcar como revisado
                       </button>`}
            </div>

            <div style="margin-top:1rem; background:white; border-radius:var(--radius-sm); padding:0.75rem 1rem; overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th></th>
                            <th style="text-align:left; padding:0 0.75rem 0.5rem; font-size:11px; text-transform:uppercase; color:var(--text-secondary);">Este documento</th>
                            <th style="text-align:left; padding:0 0 0.5rem; font-size:11px; text-transform:uppercase; color:var(--text-secondary);">
                                ${outro ? 'Documento relacionado' : 'Documento relacionado (não encontrado)'}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${linha('Arquivo', doc.name || '---', outro?.name || '---', false)}
                        ${linha('Nº da nota', doc.numero_nf || '---', outro?.numero_nf || '---')}
                        ${linha('CNPJ', doc.cnpj_emissor || '---', outro?.cnpj_emissor || '---')}
                        ${linha('Valor', fmtV(doc.valor), fmtV(outro?.valor))}
                        ${linha('Emissão', fmtD(doc.data_emissao), fmtD(outro?.data_emissao))}
                    </tbody>
                </table>
                ${outro ? `
                    <div style="margin-top:0.75rem; text-align:right;">
                        <button class="btn btn-secondary" style="padding:0.4rem 0.75rem; font-size:12px;"
                            onclick="window.navigate('details', '${outro.id}')">
                            <i data-lucide="external-link" style="width:14px;"></i> Abrir o documento relacionado
                        </button>
                    </div>` : `
                    <p class="text-xs" style="margin:0.5rem 0 0; color:var(--text-muted);">
                        O documento relacionado pode ter sido excluído. O sinalizador foi mantido como histórico.
                    </p>`}
            </div>
        </div>`;
    })()}

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 1.5rem;">
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="card">
                    ${(() => {
        // Edição manual: liberada enquanto o documento ainda não foi declarado
        // ao SALIC nem está no meio de um processamento automático.
        const podeEditarCampos = !['processing_ocr', 'validating', 'enviado_salic', 'concluido'].includes(doc.status);
        const emEdicao = state.editingDocFields && podeEditarCampos;
        const inputStyle = 'padding: 0.5rem 0.75rem; font-size: 13px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; background: white;';
        const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;" class="mb-4">
                        <h3 class="h2" style="margin: 0;">Dados Extraídos</h3>
                        ${podeEditarCampos && !emEdicao ? `
                            <button class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 12px;" title="Corrigir dados lidos pela IA" onclick="window.toggleEditDocFields(true)">
                                <i data-lucide="pencil" style="width: 14px;"></i>
                                Editar dados
                            </button>
                        ` : ''}
                    </div>
                    ${emEdicao ? `
                    <div style="padding: 0.875rem 1rem; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: var(--radius-sm); margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: flex-start;">
                        <i data-lucide="alert-triangle" style="width: 16px; flex-shrink: 0; margin-top: 2px; color: #92400E;"></i>
                        <p class="text-xs" style="color: #92400E; line-height: 1.5;">
                            <strong>Aviso de responsabilidade:</strong> os dados abaixo substituem os extraídos pela IA.
                            Ao salvar, você declara que as informações conferem com o documento fiscal original e
                            assume a responsabilidade pelo que será prestado ao MinC/SALIC.
                        </p>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Solicitante (CNPJ/CPF)</label>
                            <input type="text" id="edit-cnpj-emissor" value="${esc(doc.cnpj_emissor)}" placeholder="Ex: 04.823.360/0001-44" style="${inputStyle}">
                        </div>
                        <div>
                            <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Nome do fornecedor</label>
                            <input type="text" id="edit-nome-emissor" value="${esc(doc.nome_emissor)}" placeholder="Razão social ou nome" style="${inputStyle}">
                        </div>
                        <div>
                            <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Valor total (R$)</label>
                            <input type="number" id="edit-valor" value="${doc.valor ?? ''}" step="0.01" min="0.01" placeholder="Ex: 1310.31" style="${inputStyle}">
                        </div>
                        <div>
                            <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Data de emissão</label>
                            <input type="date" id="edit-data-emissao" value="${doc.data_emissao ? String(doc.data_emissao).split('T')[0] : ''}" max="${new Date().toISOString().split('T')[0]}" style="${inputStyle}">
                        </div>
                        <div>
                            <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Nr. do comprovante</label>
                            <input type="text" id="edit-numero-nf" value="${esc(doc.numero_nf)}" placeholder="Ex: 505, 042803" style="${inputStyle}">
                        </div>
                        <div class="info-item">
                            <label>Protocolo SALIC</label>
                            <p class="text-sm">${doc.protocolo_salic || '---'}</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
                        <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 12px;" onclick="window.toggleEditDocFields(false)">Cancelar</button>
                        <button class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 12px;" onclick="window.salvarEdicaoCampos('${doc.id}')">Salvar correções</button>
                    </div>
                    ` : `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                        <div class="info-item">
                            <label>Solicitante (CNPJ/CPF)</label>
                            <p class="text-sm" style="font-weight: 600;">${renderCampoOuFaltando(doc.cnpj_emissor, camposPendentes.cnpj)}</p>
                        </div>
                        <div class="info-item">
                            <label>Fornecedor</label>
                            <p class="text-sm" style="font-weight: 600;">${renderCampoOuFaltando(doc.nome_emissor, camposPendentes.nome)}</p>
                        </div>
                        <div class="info-item">
                            <label>Valor Total</label>
                            <p class="text-sm" style="font-weight: 600; color: var(--primary);">${renderCampoOuFaltando('R$ ' + (doc.valor ? doc.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'), camposPendentes.valor)}</p>
                        </div>
                        <div class="info-item">
                            <label>Data de Emissão</label>
                            <p class="text-sm">${renderCampoOuFaltando(doc.data_emissao ? _laudoFmtDate(doc.data_emissao) : '---', camposPendentes.data)}</p>
                        </div>
                        <div class="info-item">
                            <label>Nr. Comprovante</label>
                            <p class="text-sm" style="font-weight: 600;">${renderCampoOuFaltando(doc.numero_nf, camposPendentes.numero)}</p>
                        </div>
                        <div class="info-item">
                            <label>Protocolo SALIC</label>
                            <p class="text-sm">${doc.protocolo_salic || '---'}</p>
                        </div>
                        ${renderDadosGuia(doc, esc)}
                    </div>
                    `}`;
    })()}

                    ${camposPendentes.algum ? `
                    <div style="margin-top: 1.5rem; padding: 1rem; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: var(--radius-sm);">
                        <p style="font-size: 12px; font-weight: 700; color: #92400E; margin-bottom: 0.875rem;">⚠️ Campos pendentes — preencher manualmente</p>
                        <div style="display: flex; flex-direction: column; gap: 0.625rem;">
                            ${camposPendentes.cnpj ? `<div>
                                <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">CNPJ/CPF do fornecedor</label>
                                <input type="text" id="input-cnpj-emissor" placeholder="Ex: 04.823.360/0001-44"
                                    style="padding: 0.5rem 0.75rem; font-size: 13px; border: 1px solid #FDE68A; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; background: white;">
                            </div>` : ''}
                            ${camposPendentes.nome ? `<div>
                                <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Nome do fornecedor</label>
                                <input type="text" id="input-nome-emissor" placeholder="Razão social ou nome"
                                    style="padding: 0.5rem 0.75rem; font-size: 13px; border: 1px solid #FDE68A; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; background: white;">
                            </div>` : ''}
                            ${camposPendentes.valor ? `<div>
                                <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Valor total</label>
                                <input type="number" id="input-valor" placeholder="Ex: 1310.31" step="0.01" min="0.01"
                                    style="padding: 0.5rem 0.75rem; font-size: 13px; border: 1px solid #FDE68A; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; background: white;">
                            </div>` : ''}
                            ${camposPendentes.data ? `<div>
                                <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Data de emissão</label>
                                <input type="date" id="input-data-emissao" max="${new Date().toISOString().split('T')[0]}"
                                    style="padding: 0.5rem 0.75rem; font-size: 13px; border: 1px solid #FDE68A; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; background: white;">
                            </div>` : ''}
                            ${camposPendentes.numero ? `<div>
                                <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Nr. do comprovante</label>
                                <input type="text" id="input-numero-nf" placeholder="Ex: 505, 042803"
                                    style="padding: 0.5rem 0.75rem; font-size: 13px; border: 1px solid #FDE68A; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box; background: white;">
                            </div>` : ''}
                            <button class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 12px; margin-top: 0.25rem;" onclick="window.salvarCamposManuais('${doc.id}')">
                                Salvar campos
                            </button>
                        </div>
                    </div>` : ''}

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
                                        <input type="text" id="vincular-rubrica-input" data-rubrica-combo placeholder="${(state.rubricas_disponiveis || []).length === 0 ? 'Carregando rubricas...' : 'Digite para buscar rubrica...'}" autocomplete="off" style="width: 100%; padding: 0.5rem; font-size: 13px; border: 1px solid var(--border-light); border-radius: 4px; background: white;" ${(state.rubricas_disponiveis || []).length === 0 ? 'disabled' : ''}>
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

                    ${(doc.status.includes('erro') || doc.status.includes('bloqueado') || doc.status.includes('divergencia') || doc.status === 'revisao_manual') && userCanDelete() ? `
                    <div style="margin-top: 1rem; padding: 1rem; background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-sm);">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <i data-lucide="alert-triangle" style="width: 16px; color: #d97706; flex-shrink: 0;"></i>
                            <span style="font-size: 12px; font-weight: 700; color: #d97706;">Continuar por Conta e Risco</span>
                        </div>
                        <p style="font-size: 11px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0.75rem;">
                            Esta ação força o avanço do documento para a próxima etapa ignorando o erro atual. <strong>O gestor assume total responsabilidade pela conformidade deste documento perante o SALIC e a prestação de contas.</strong>
                        </p>
                        <button class="btn" style="width: 100%; font-size: 11px; padding: 0.5rem; background: transparent; border: 1px solid #d97706; color: #d97706; font-weight: 600;" onclick="window.handleForcarAvanco('${doc.id}', '${doc.status}')">
                            <i data-lucide="shield-off" style="width: 14px;"></i>
                            Assumir risco e continuar
                        </button>
                    </div>
                    ` : ''}
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
                    (state.uploadConcluidoComprovante ?
                        `<p class="text-xs mt-2" style="color: var(--success); font-weight: bold; text-align: center;">✓ Upload do comprovante já foi realizado.</p>` :
                        `<button class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 0.5rem;" onclick="document.getElementById('vincular-comprovante-input').click()">Anexar Comprovante</button>
                                 <input type="file" id="vincular-comprovante-input" style="display: none;" onchange="window.handleVincularDocumento('${doc.id}', this.files[0], 'comprovante', { id: '${doc.id}', nome: '${doc.name.replace(/'/g, "\\'")}', valor: ${doc.valor || 0}, cnpj: '${doc.cnpj_emissor || ''}' })" accept=".pdf,image/*">
                                 <p class="text-xs" style="color: var(--text-muted); font-style: italic; margin-top: 0.5rem; text-align: center;">Você pode pular direto para o Extrato</p>`) :
                    `<p class="text-xs" style="color: var(--text-muted); font-style: italic;">Aguardando etapa anterior para liberar upload...</p>`))
        }
                        </div>

                        <!-- Box do Extrato -->
                        <div style="padding: 1rem; border: 1px dashed ${(doc.status === 'divergencia_valor' || doc.status === 'divergencia_beneficiario') ? 'var(--error)' : 'var(--border-light)'}; border-radius: var(--radius-sm); background: ${['aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido'].includes(doc.status) ? 'rgba(37, 99, 235, 0.05)' : (doc.status === 'divergencia_valor' || doc.status === 'divergencia_beneficiario') ? 'rgba(239, 68, 68, 0.05)' : (doc.extrato_origem_id && ['aguardando_comprovante', 'aguardando_conciliacao_bancaria'].includes(doc.status)) ? 'rgba(16, 185, 129, 0.05)' : 'transparent'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <span class="text-xs" style="font-weight: 600; text-transform: uppercase; color: ${(doc.status === 'divergencia_valor' || doc.status === 'divergencia_beneficiario') ? 'var(--error)' : 'inherit'};">2. Extrato Bancário</span>
                                ${['aguardando_d3', 'enviado_salic', 'concluido'].includes(doc.status) ? '<i data-lucide="check-circle-2" style="width: 16px; color: var(--primary);"></i>' : (doc.status === 'divergencia_valor' || doc.status === 'divergencia_beneficiario') ? '<i data-lucide="x-circle" style="width: 16px; color: var(--error);"></i>' : (doc.extrato_origem_id && ['aguardando_comprovante', 'aguardando_conciliacao_bancaria'].includes(doc.status)) ? '<i data-lucide="check-circle-2" style="width: 16px; color: var(--success);"></i>' : '<i data-lucide="clock" style="width: 16px; color: var(--warning);"></i>'}
                            </div>
                            ${(doc.status === 'divergencia_valor' || doc.status === 'divergencia_beneficiario') ? `
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                <p class="text-xs" style="color: var(--error); font-weight: 600;">
                                    ${doc.status === 'divergencia_valor' ? '⚠ Divergência de valor detectada entre a NF e o extrato.' : '⚠  Transação não encontrada no extrato. Verifique manualmente'}
                                </p>
                                <p class="text-xs" style="color: var(--text-muted); line-height: 1.4;">${doc.just_erro || 'Verifique o extrato bancário e a nota fiscal manualmente antes de prosseguir.'}</p>
                                <div style="padding: 0.6rem; background: rgba(245, 158, 11, 0.1); border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.3);">
                                    <p class="text-xs" style="color: #d97706; font-weight: 600; margin-bottom: 0.25rem;">📋 Revisão Manual Necessária</p>
                                    <p class="text-xs" style="color: var(--text-secondary); line-height: 1.4;">Compare o valor e CNPJ do extrato com os dados extraídos da nota fiscal. Se estiver correto, use o botão abaixo para continuar.</p>
                                </div>
                                ${state.isUploadingExtrato ?
                `<div style="padding: 0.5rem; text-align: center;">
                                    <div style="width: 100%; height: 6px; background: var(--bg-sidebar); border-radius: 3px; overflow: hidden; margin-bottom: 0.5rem;">
                                        <div style="width: 60%; height: 100%; background: var(--primary); animation: loading 2s infinite ease-in-out;"></div>
                                    </div>
                                    <p class="text-xs" style="color: var(--primary); font-weight: 600;">Enviando novo extrato...</p>
                                 </div>` :
                `<button class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;" onclick="document.getElementById('substituir-extrato-input').click()">
                                    <i data-lucide="refresh-cw" style="width: 14px;"></i>
                                    Substituir Extrato
                                 </button>
                                 <input type="file" id="substituir-extrato-input" style="display: none;" onchange="window.handleUploadExtrato(this.files[0], '${doc.project_id}', '${doc.id}', '${state.currentComprovante?.id || ''}', true)" accept=".ofx,.csv,.pdf">`
            }
                            </div>` :
            ((['aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido'].includes(doc.status)) ?
                `<p class="text-xs" style="color: var(--text-secondary);">Conciliado e validado em D-3</p>
             <p class="text-xs mt-2" style="color: var(--success); font-weight: bold;">✓ Upload do extrato já foi realizado.</p>` :
                (extratoStatusPendente ?
                    extratoBoxHtml :
                    `<p class="text-xs" style="color: var(--text-muted); font-style: italic;">Aguardando liberação...</p>`))
        }
                            ${btnVerExtrato}
                        </div>

                        <!-- Box do SALIC -->
                        <div style="padding: 1rem; border: 1px dashed var(--border-light); border-radius: var(--radius-sm); background: ${['enviado_salic', 'concluido'].includes(doc.status) ? 'rgba(5, 150, 105, 0.05)' : 'transparent'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <span class="text-xs" style="font-weight: 600; text-transform: uppercase;">3. Portal SALIC</span>
                                ${['enviado_salic', 'concluido'].includes(doc.status) ? '<i data-lucide="check-circle-2" style="width: 16px; color: var(--success);"></i>' : (doc.status === 'erro_rpa' ? '<i data-lucide="alert-circle" style="width: 16px; color: var(--error);"></i>' : '<i data-lucide="clock" style="width: 16px; color: var(--warning);"></i>')}
                            </div>
                            ${doc.status === 'liberado_rpa_airtop' ?
            (state.isSalicRunning ?
                `<div style="padding: 0.5rem; text-align: center;">
                    <div style="width: 100%; height: 6px; background: var(--bg-sidebar); border-radius: 3px; overflow: hidden; margin-bottom: 0.5rem;">
                        <div style="width: 60%; height: 100%; background: var(--primary); animation: loading 2s infinite ease-in-out;"></div>
                    </div>
                    <p class="text-xs" style="color: var(--primary); font-weight: 600;">Robô em processo...</p>
                 </div>` :
                (faltaDadoObrigatorioSalic ?
                    `<div style="display: flex; flex-direction: column; gap: 0.375rem;">
                                        <button class="btn btn-primary" style="width: 100%; font-size: 11px; padding: 0.5rem; opacity: 0.5; cursor: not-allowed;" disabled>
                                            <i data-lucide="plus-circle" style="width: 14px;"></i>
                                            Adicionar documento no SALIC
                                         </button>
                                        <p class="text-xs" style="color: var(--text-secondary); font-style: italic;">Preencha os dados obrigatórios (destacados acima) antes de enviar ao SALIC.</p>
                                     </div>` :
                    `<button class="btn btn-primary" style="width: 100%; font-size: 11px; padding: 0.5rem; background: linear-gradient(135deg, #059669 0%, #10b981 100%); border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);" onclick="window.handleEnviarSalic('${doc.id}')" ${state.loading ? 'disabled' : ''}>
                                        <i data-lucide="plus-circle" style="width: 14px;"></i>
                                        Adicionar documento no SALIC
                                     </button>`)) :
            (doc.status === 'enviado_salic' || doc.status === 'concluido' ?
                `<div style="display: flex; flex-direction: column; gap: 0.25rem;">
                                    <p class="text-xs" style="color: var(--success); font-weight: 600;">Comprovado com sucesso!</p>
                                    <p class="text-xs" style="color: var(--text-muted);">Protocolo: ${doc.protocolo_salic || 'Gerando...'}</p>
                                 </div>` :
                (doc.status === 'erro_rpa' ?
                    (state.isSalicRunning ?
                        `<div style="padding: 0.5rem; text-align: center;">
                            <div style="width: 100%; height: 6px; background: var(--bg-sidebar); border-radius: 3px; overflow: hidden; margin-bottom: 0.5rem;">
                                <div style="width: 60%; height: 100%; background: var(--primary); animation: loading 2s infinite ease-in-out;"></div>
                            </div>
                            <p class="text-xs" style="color: var(--primary); font-weight: 600;">Robô em processo...</p>
                         </div>` :
                        `<div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                            <p class="text-xs" style="color: var(--error); font-weight: 500;">Falha no envio automático:</p>
                                            <p class="text-xs" style="color: var(--text-muted); font-style: italic;">${doc.just_erro || 'Erro no robô SALIC'}</p>
                                            ${faltaDadoObrigatorioSalic ?
                        `<button class="btn btn-secondary" style="width: 100%; font-size: 10px; padding: 0.3rem; opacity: 0.5; cursor: not-allowed;" disabled>Tentar Novamente</button>
                                            <p class="text-xs" style="color: var(--text-secondary); font-style: italic;">Preencha os dados obrigatórios (destacados acima) antes de tentar novamente.</p>` :
                        `<button class="btn btn-secondary" style="width: 100%; font-size: 10px; padding: 0.3rem;" onclick="window.handleEnviarSalic('${doc.id}')">Tentar Novamente</button>`}
                                         </div>`) :
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

        ${ExtratoBancarioSection(doc)}
    </main>
    `;
};

// ─────────────────────────────────────────────────────────────────────────────
// GATE DE APROVAÇÃO — NFs subidas pelo próprio fornecedor
//
// Nota que veio do portal Solicitante não passou pelo crivo do gestor: pode ter
// CNAE incompatível com a rubrica, por exemplo. O trigger do banco a segura em
// 'aguardando_aprovacao_fornecedor' até a decisão humana; aqui é onde ela é
// tomada, com os dados do OCR já na tela para embasar.
//
// Operador não decide: só admin/gestor (userIsGestorOrAbove).
// ─────────────────────────────────────────────────────────────────────────────
const AprovacaoFornecedorSection = (doc) => {
    const noGate = doc.status === 'aguardando_aprovacao_fornecedor';
    const rejeitada = doc.status === 'rejeitado_fornecedor';
    if (!noGate && !rejeitada) return '';

    const podeDecidir = userIsGestorOrAbove();
    const cnae = doc.json_extraido?.cnae_prestador || null;

    if (rejeitada) {
        return `
        <div class="card" style="margin-bottom: 1.5rem; border: 1px solid #FCA5A5; background: #FEE2E2;">
            <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                <i data-lucide="x-circle" style="width: 20px; color: #B91C1C; flex-shrink: 0; margin-top: 0.15rem;"></i>
                <div style="flex: 1; min-width: 0;">
                    <p style="margin: 0; font-weight: 700; color: #B91C1C;">Nota rejeitada</p>
                    <p class="text-sm" style="margin: 0.25rem 0 0; color: #B91C1C;">
                        O fornecedor precisa enviar um documento novo e corrigido — esta nota não segue no fluxo.
                    </p>
                    ${doc.motivo_rejeicao_fornecedor ? `
                        <div style="margin-top: 0.75rem; padding: 0.75rem; background: white; border-radius: var(--radius-sm);">
                            <p class="text-xs" style="font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-secondary); margin: 0 0 0.25rem;">Motivo</p>
                            <p class="text-sm" style="margin: 0; white-space: pre-wrap;">${escAttr(doc.motivo_rejeicao_fornecedor)}</p>
                        </div>` : ''}
                </div>
            </div>
        </div>`;
    }

    const infoItem = (rotulo, valor) => `
        <div class="info-item">
            <label>${rotulo}</label>
            <p class="text-sm" style="font-weight: 600;">${valor}</p>
        </div>`;

    return `
        <div class="card" style="margin-bottom: 1.5rem; border: 1px solid #FDE68A; background: #FFFBEB;">
            <div style="display: flex; align-items: flex-start; gap: 0.75rem; flex-wrap: wrap;">
                <i data-lucide="user-check" style="width: 20px; color: #92400E; flex-shrink: 0; margin-top: 0.15rem;"></i>
                <div style="flex: 1; min-width: 240px;">
                    <p style="margin: 0; font-weight: 700; color: #92400E;">Nota enviada pelo fornecedor — aguardando aprovação</p>
                    <p class="text-sm" style="margin: 0.25rem 0 0; color: #92400E;">
                        Esta nota não passou pelo crivo do gestor. Confira os dados extraídos antes de liberá-la para o fluxo de conformidade.
                    </p>
                </div>
            </div>

            <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: var(--radius-sm);">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 1.25rem;">
                    ${infoItem('CNAE do prestador', cnae ? escAttr(cnae) : '<span style="color: var(--text-muted); font-weight: 400;">não extraído</span>')}
                    ${infoItem('CNPJ do emissor', escAttr(doc.cnpj_emissor || '---'))}
                    ${infoItem('Valor', doc.valor != null ? 'R$ ' + parseValorBR(doc.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '---')}
                    ${infoItem('Rubrica sugerida', escAttr(doc.rubrica || '---'))}
                </div>
                <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 1.25rem;">
                    ${infoItem('Fornecedor que enviou', escAttr(doc.nome_emissor || doc.fornecedor_nome || '---'))}
                    ${infoItem('Enviado em', doc.created_at ? new Date(doc.created_at).toLocaleString('pt-BR') : '---')}
                </div>
            </div>

            ${podeDecidir ? `
                <div style="margin-top: 1rem; display: flex; gap: 0.75rem; justify-content: flex-end; flex-wrap: wrap;">
                    <button class="btn btn-secondary" style="background: white;" onclick="window.handleRejeitarNotaFornecedor('${doc.id}')">
                        <i data-lucide="x" style="width: 14px;"></i> Rejeitar
                    </button>
                    <button class="btn btn-primary" onclick="window.handleAprovarNotaFornecedor('${doc.id}')">
                        <i data-lucide="check" style="width: 14px;"></i> Aprovar e liberar
                    </button>
                </div>
            ` : `
                <p class="text-xs" style="margin-top: 1rem; color: var(--text-muted); font-style: italic;">
                    Somente gestor ou administrador pode aprovar ou rejeitar esta nota.
                </p>
            `}
        </div>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTRATO BANCÁRIO — somente leitura
//
// Os lançamentos já eram gravados pelo n8n mas nunca chegavam à tela: o trabalho
// de conciliação acontecia invisível. Aqui mostramos qual movimentação bancária
// foi casada com esta nota e o que mais veio no mesmo extrato.
//
// Sem nenhuma ação de edição por decisão de escopo: a NF precisa existir como
// documento antes da conciliação, então preencher nota a partir do lançamento
// inverteria o processo de comprovação.
// ─────────────────────────────────────────────────────────────────────────────
const EXTRATO_LANC_VISIVEIS = 8;

function fmtValorExtrato(v) {
    const n = parseValorBR(v);
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

function fmtDataExtrato(d) {
    return d ? _laudoFmtDate(d) : '---';
}

// A coluna extratos_lancamentos.tipo NÃO guarda o tipo do lançamento: o workflow
// de conciliação do n8n grava ali a justificativa textual do modelo ("O lançamento
// com fitid '71.301' foi selecionado pois: 1. O valor pago (-700)..."). Enquanto
// isso não for corrigido na origem, o tipo é derivado do SINAL DO VALOR, que é
// dado do banco e confiável.
function tipoLancamentoDerivado(valor) {
    const n = parseValorBR(valor);
    if (!n) return '---';
    return n < 0 ? 'Débito' : 'Crédito';
}

// Palavras que seriam um tipo de verdade, caso a coluna passe a ser preenchida
// corretamente. Qualquer outra coisa é tratada como justificativa.
const TIPOS_REAIS = ['debit', 'credit', 'debito', 'débito', 'credito', 'crédito', 'd', 'c'];

function justificativaConciliacao(tipo) {
    const t = String(tipo == null ? '' : tipo).trim();
    if (!t) return '';
    if (TIPOS_REAIS.includes(t.toLowerCase())) return '';
    return t;
}

function statusConciliacaoBadge(status) {
    const s = String(status || 'pendente').toLowerCase().trim();
    const conciliado = s === 'conciliado' || s === 'conciliada';
    const cor = conciliado ? 'var(--success)' : 'var(--warning)';
    const fundo = conciliado ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)';
    // Não expõe o valor cru do enum: 'pendente' vira 'Pendente'. Valor
    // desconhecido também é capitalizado, em vez de aparecer em minúsculas.
    const texto = conciliado ? 'Conciliado' : (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Pendente');
    return `<span style="display:inline-flex; align-items:center; padding:0.1rem 0.5rem; border-radius:9999px; background:${fundo}; color:${cor}; font-size:11px; font-weight:600; white-space:nowrap;">${escAttr(texto)}</span>`;
}

const ExtratoBancarioSection = (doc) => {
    const ctx = state.currentExtrato;
    // Nota que ainda não chegou nessa etapa: não polui a tela.
    if (!ctx || (!ctx.lancamentoDaNota && (ctx.lancamentos || []).length === 0)) return '';

    const { extrato, lancamentoDaNota, lancamentos, notasPorId } = ctx;
    const outros = (lancamentos || []).filter(l => l.id !== lancamentoDaNota?.id);
    const expandido = state.extratoLancamentosExpandido;
    const visiveis = expandido ? outros : outros.slice(0, EXTRATO_LANC_VISIVEIS);

    const periodo = extrato && (extrato.periodo_inicio || extrato.periodo_fim)
        ? `${fmtDataExtrato(extrato.periodo_inicio)} a ${fmtDataExtrato(extrato.periodo_fim)}`
        : null;

    const infoItem = (rotulo, valor) => `
        <div class="info-item">
            <label>${rotulo}</label>
            <p class="text-sm" style="font-weight: 600;">${valor}</p>
        </div>`;

    return `
        <div class="card" style="margin-top: 1.5rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;" class="mb-4">
                <h3 class="h2" style="margin: 0;">Extrato Bancário</h3>
                <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                    ${periodo ? `<span class="text-xs" style="color: var(--text-muted);">Período: ${periodo}</span>` : ''}
                    ${extrato?.formato ? `<span class="text-xs" style="color: var(--text-muted); text-transform: uppercase;">${extrato.formato}</span>` : ''}
                </div>
            </div>

            ${lancamentoDaNota ? `
                <div style="padding: 1rem; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: rgba(16, 185, 129, 0.05);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.875rem;">
                        <i data-lucide="link" style="width: 16px; color: var(--success);"></i>
                        <span class="text-xs" style="font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Lançamento conciliado com esta nota</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); gap: 1.25rem;">
                        ${infoItem('Data do lançamento', fmtDataExtrato(lancamentoDaNota.data_lancamento))}
                        ${infoItem('Valor', `<span style="color: var(--primary);">${fmtValorExtrato(lancamentoDaNota.valor)}</span>`)}
                        ${infoItem('Tipo', tipoLancamentoDerivado(lancamentoDaNota.valor))}
                        ${infoItem('Status', statusConciliacaoBadge(lancamentoDaNota.status_conciliacao))}
                    </div>
                    <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 1.25rem;">
                        ${infoItem('Histórico do banco', escAttr(lancamentoDaNota.memo || '---'))}
                        ${lancamentoDaNota.fitid ? infoItem('FITID', `<span style="font-family: monospace; font-size: 12px;">${escAttr(lancamentoDaNota.fitid)}</span>`) : ''}
                    </div>
                    ${(() => {
            const just = justificativaConciliacao(lancamentoDaNota.tipo);
            if (!just) return '';
            // Está na coluna errada, mas o conteúdo tem valor de auditoria:
            // fica recolhido, rotulado pelo que de fato é.
            return `
                    <details style="margin-top: 1rem;">
                        <summary style="cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary);">
                            Justificativa da conciliação (gerada pela IA)
                        </summary>
                        <p class="text-xs" style="margin-top: 0.5rem; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap;">${escAttr(just)}</p>
                    </details>`;
        })()}
                </div>
            ` : `
                <div style="padding: 0.875rem 1rem; border: 1px dashed var(--border-light); border-radius: var(--radius-sm);">
                    <p class="text-xs" style="color: var(--text-muted);">
                        Nenhum lançamento deste extrato foi conciliado com esta nota ainda. Abaixo, o que veio no extrato.
                    </p>
                </div>
            `}

            ${outros.length > 0 ? `
                <div style="margin-top: 1.5rem;">
                    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.75rem;">
                        <span class="text-xs" style="font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Demais lançamentos do mesmo extrato</span>
                        <span class="text-xs" style="color: var(--text-muted);">${outros.length} lançamento${outros.length > 1 ? 's' : ''}</span>
                    </div>
                    <div class="data-table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="white-space: nowrap;">Data</th>
                                    <th style="text-align: right; white-space: nowrap;">Valor</th>
                                    <th>Histórico</th>
                                    <th>Situação</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${visiveis.map(l => {
        const nota = l.document_id ? notasPorId[l.document_id] : null;
        return `
                                    <tr>
                                        <td style="white-space: nowrap;"><div class="text-sm">${fmtDataExtrato(l.data_lancamento)}</div></td>
                                        <td style="text-align: right; white-space: nowrap;"><div class="text-sm" style="font-weight: 600;">${fmtValorExtrato(l.valor)}</div></td>
                                        <td><div class="text-sm">${escAttr(l.memo || '---')}</div></td>
                                        <td>
                                            ${l.document_id
                ? `<div style="display: flex; flex-direction: column; gap: 0.2rem;">
                                                       ${statusConciliacaoBadge(l.status_conciliacao || 'conciliado')}
                                                       <span class="text-xs" style="color: var(--text-muted);">
                                                           Nota: ${escAttr(nota ? (nota.numero_nf ? `nº ${nota.numero_nf}` : nota.name) : 'outra nota')}
                                                       </span>
                                                   </div>`
                : statusConciliacaoBadge('pendente')}
                                        </td>
                                    </tr>`;
    }).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${outros.length > EXTRATO_LANC_VISIVEIS ? `
                        <div style="margin-top: 0.75rem; text-align: center;">
                            <button class="btn btn-secondary" style="padding: 0.4rem 0.9rem; font-size: 12px;" onclick="window.toggleExtratoLancamentos()">
                                <i data-lucide="${expandido ? 'chevron-up' : 'chevron-down'}" style="width: 14px;"></i>
                                ${expandido ? 'Mostrar menos' : `Ver todos os ${outros.length} lançamentos`}
                            </button>
                        </div>` : ''}
                </div>
            ` : ''}
        </div>
    `;
};

// --- Handlers & API ---

window.handleForcarAvanco = async function (docId, currentStatus) {
    if (!userCanDelete()) {
        showToast('Apenas administradores podem forçar o avanço de status.', 'error');
        return;
    }

    const nextStatus = {
        'revisao_manual': 'aguardando_conformidade',
        'bloqueado_conformidade': 'aguardando_comprovante',
        'divergencia_valor': 'aguardando_d3',
        'divergencia_beneficiario': 'aguardando_d3',
        'erro_rpa': 'liberado_rpa_airtop'
    }[currentStatus];

    if (!nextStatus) return alert('Não é possível forçar avanço para este status.');

    const confirmed = window.confirm(
        '⚠️ ATENÇÃO — Continuar por Conta e Risco\n\n' +
        'Ao confirmar, você assume total responsabilidade pela conformidade deste documento perante o SALIC e a prestação de contas.\n\n' +
        'Deseja prosseguir mesmo assim?'
    );
    if (!confirmed) return;

    // Captura antes do UPDATE — fetchDocumentDetails() reescreve state.currentDocument.
    const docAntes = state.currentDocument;

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('documents')
            .update({
                status: nextStatus,
                just_erro: `[OVERRIDE] Gestor forçou avanço manualmente a partir do status "${currentStatus}" em ${new Date().toLocaleString('pt-BR')}.`
            })
            .eq('id', docId);

        if (error) throw error;

        // Ao pular a revisão manual do OCR direto para a Auditoria IA, o n8n precisa
        // ser notificado para rodar a validação de conformidade (CNAE vs. rubrica);
        // sem isso o documento fica "em auditoria" mas nunca é de fato auditado.
        if (currentStatus === 'revisao_manual' && CONFIG.N8N_WEBHOOK_VALIDATION_URL) {
            fetch(CONFIG.N8N_WEBHOOK_VALIDATION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    document_id: docId,
                    cnpj_fornecedor: state.currentDocument?.cnpj_emissor
                })
            }).then(r => console.log("n8n Validation Triggered (forçar avanço):", r.status))
                .catch(e => console.error("Erro ao notificar n8n:", e.message));
        }

        // Avanço manual (bloqueado_conformidade -> aguardando_comprovante) também
        // deve reaproveitar o extrato do lote, igual à varredura do Dashboard —
        // sem isso a nota fica "presa" pedindo upload de extrato de novo.
        if (nextStatus === 'aguardando_comprovante' && docAntes?.id === docId) {
            dispararConciliacaoAutoLote({ ...docAntes, status: nextStatus })
                .then(ok => { if (ok) window.showToast('Nota também enviada para conciliação automática com o extrato do lote.', 'success'); });
        }

        window.showToast('Documento avançado manualmente com sucesso.', 'warning');
        await fetchDocumentDetails(docId);
    } catch (err) {
        window.showToast('Erro ao forçar avanço: ' + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

// Reprocessa um documento travado numa etapa intermediária (ver estaTravado,
// MINUTOS_TRAVADO). Diferente de handleForcarAvanco: aqui não se pula etapa
// nenhuma nem se assume risco — só se dispara de novo o mesmo processamento
// que deveria ter terminado sozinho.
window.handleReprocessarDocumentoTravado = async function (documentId) {
    const doc = state.documents.find(d => d.id === documentId) || state.currentDocument;
    if (!doc) return;

    if (!confirm('Reenviar este documento para processamento?')) return;

    state.loading = true;
    render();

    try {
        if (doc.status === 'aguardando_conformidade') {
            // OCR já rodou (json_extraido preenchido) — reprocessar aqui é
            // re-disparar a VALIDAÇÃO, não o OCR de novo. Mesmo mecanismo já
            // usado quando o gestor edita a rubrica manualmente
            // (handleVincularRubrica) — reaproveitado, não duplicado.
            const { error } = await supabaseClient.from('documents')
                .update({ status: 'processing_ocr', just_erro: null })
                .eq('id', documentId);
            if (error) throw error;

            if (CONFIG.N8N_WEBHOOK_VALIDATION_URL) {
                fetch(CONFIG.N8N_WEBHOOK_VALIDATION_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    mode: 'cors',
                    body: JSON.stringify({
                        document_id: documentId,
                        cnpj_fornecedor: doc.cnpj_emissor,
                        rubrica_id: doc.rubrica_id_fk,
                        rubrica_nome: doc.rubrica
                    })
                }).then(r => console.log("n8n Validation Triggered (reprocessar travado):", r.status))
                    .catch(e => console.error("Erro ao notificar n8n:", e.message));
            }
        } else {
            // processing_ocr ou validating travados: o OCR em si não completou.
            // Reaproveita o mesmo caminho do upload original (dispararOcr).
            const { error } = await supabaseClient.from('documents')
                .update({ status: 'processing_ocr', just_erro: null })
                .eq('id', documentId);
            if (error) throw error;

            await dispararOcr(documentId, doc.file_path);
        }

        window.showToast('Documento reenviado para processamento.', 'success');

        if (state.currentDocument?.id === documentId) {
            await fetchDocumentDetails(documentId);
        } else {
            const idx = state.documents.findIndex(d => d.id === documentId);
            if (idx !== -1) {
                state.documents[idx] = { ...state.documents[idx], status: 'processing_ocr', updated_at: new Date().toISOString(), just_erro: null };
            }
        }
    } catch (err) {
        window.showToast('Erro ao reprocessar: ' + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

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

window.updateSolicitanteUploadButtons = function () {
    const select = document.getElementById('f-upload-project');
    const btnArea = document.getElementById('upload-buttons-area');
    const hint = document.getElementById('upload-hint');

    if (!select.value) {
        btnArea.style.display = 'none';
        hint.style.display = 'block';
        return;
    }

    hint.style.display = 'none';
    btnArea.style.display = 'flex';
};

window.openUnifiedUploadModal = function () {
    const projectId = document.getElementById('f-upload-project').value;
    if (!projectId) return alert("Selecione um projeto primeiro!");

    // Reset modal state
    document.getElementById('unified-fields-nf').style.display = 'none';
    document.getElementById('unified-fields-m2').style.display = 'none';
    document.getElementById('btn-submit-unified').style.display = 'none';

    document.getElementById('label-tipo-nf').style.borderColor = 'var(--border-light)';
    document.getElementById('label-tipo-nf').style.background = '#fff';
    document.getElementById('label-tipo-m2').style.borderColor = 'var(--border-light)';
    document.getElementById('label-tipo-m2').style.background = '#fff';

    document.getElementById('f-upload-nf').value = '';
    document.getElementById('m2-file-upload').value = '';
    document.getElementById('m2-tipo-evidencia').value = '';
    document.getElementById('m2-descricao').value = '';

    document.getElementById('modal-upload-unified').style.display = 'flex';
};

window.selectUnifiedType = function (type) {
    document.getElementById('label-tipo-nf').style.borderColor = type === 'nf' ? '#f59e0b' : 'var(--border-light)';
    document.getElementById('label-tipo-nf').style.background = type === 'nf' ? '#fffbeb' : '#fff';

    document.getElementById('label-tipo-m2').style.borderColor = type === 'm2' ? '#4f46e5' : 'var(--border-light)';
    document.getElementById('label-tipo-m2').style.background = type === 'm2' ? '#eef2ff' : '#fff';

    document.getElementById('unified-fields-nf').style.display = type === 'nf' ? 'block' : 'none';
    document.getElementById('unified-fields-m2').style.display = type === 'm2' ? 'block' : 'none';

    const btn = document.getElementById('btn-submit-unified');
    btn.style.display = 'flex';
    btn.setAttribute('data-type', type);

    if (type === 'nf') {
        btn.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
    } else {
        btn.style.background = 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)';
    }
};

window.submitUnifiedFile = async function () {
    const type = document.getElementById('btn-submit-unified').getAttribute('data-type');

    // CRÍTICO: Captura o projectId ANTES de fechar o modal ou chamar render(),
    // pois o render() reconstrói o DOM e o select perde o valor selecionado.
    const projectId = document.getElementById('f-upload-project').value;
    if (!projectId) return alert("Selecione um projeto primeiro!");

    if (type === 'nf') {
        const fileInput = document.getElementById('f-upload-nf');
        if (!fileInput.files || fileInput.files.length === 0) return alert("Selecione o arquivo da Nota Fiscal.");
        document.getElementById('modal-upload-unified').style.display = 'none';
        await handleSolicitanteUpload(fileInput.files[0], projectId);
    } else if (type === 'm2') {
        const fileInput = document.getElementById('m2-file-upload');
        if (!fileInput.files || fileInput.files.length === 0) return alert("Selecione o arquivo de comprovação.");

        const tipoSelect = document.getElementById('m2-tipo-evidencia');
        if (!tipoSelect.value) return alert("Selecione o tipo de evidência.");

        document.getElementById('modal-upload-unified').style.display = 'none';
        await submitM2Evidencia(fileInput.files[0], tipoSelect.value, document.getElementById('m2-descricao').value, projectId);
    }
};

window.submitM2Evidencia = async function (file, tipo, descricao, projectId) {
    state.loading = true;
    render();

    try {
        // projectId é passado como parâmetro por submitUnifiedFile (capturado antes do render)
        const selectedProject = state.projects.find(p => (p.project_id === projectId) || (p.id === projectId));

        if (!projectId || !selectedProject) {
            console.error("ERRO: Projeto não encontrado no estado.", {
                projetoProcurado: projectId,
                listaProjetos: state.projects,
                currentView: state.currentView
            });
            throw new Error(`Projeto inválido ou não vinculado à sua conta (ID: ${projectId}).`);
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${projectId}/${fileName}`;

        // 1. Upload Storage
        const { error: uploadError } = await supabaseClient.storage
            .from('physical-evidences')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        const insertPayload = {
            project_id: projectId,
            tipo_evidencia: tipo,
            descricao: descricao,
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            enviado_por: state.user.id,
            enviado_via_token: false,
            status_validacao: 'pendente'
        };

        if (selectedProject.organization_id) {
            insertPayload.organization_id = selectedProject.organization_id;
        }

        // 2. Insert into physical_evidences table
        const { error: dbError } = await supabaseClient.from('physical_evidences').insert(insertPayload);

        if (dbError) throw dbError;

        await fetchSolicitanteDashboard(); // recarrega a grid
    } catch (err) {
        console.error(err);
        alert("Erro ao enviar evidência: " + err.message);
    } finally {
        state.loading = false;
        render();
    }
};

window.handleSolicitanteUpload = async function (file, projectId) {
    // projectId é passado como parâmetro por submitUnifiedFile (capturado antes do render)
    if (!file || !projectId) return alert("Selecione um projeto e um arquivo!");

    state.loading = true;
    render();

    try {
        const selectedProject = state.projects.find(p => (p.project_id === projectId) || (p.id === projectId));

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
            tipo_documento: 'nf',
            organization_id: selectedProject?.organization_id || null
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
        // Busca projetos vinculados ao fornecedor, incluindo o gestor_id
        const { data: projData, error: projError } = await supabaseClient
            .from('projeto_fornecedores')
            .select('project_id, gestor_id, projects(id, pronac, nome)');

        if (projError) console.error('Erro ao buscar projetos do fornecedor:', projError);
        let activeProjects = (projData || []).filter(p => p.projects); // filtra registros com join válido

        // Agora busca os módulos de cada gestor (para saber se é M1 ou M2)
        const gestorIds = [...new Set(activeProjects.map(p => p.gestor_id))];
        if (gestorIds.length > 0) {
            const { data: orgUsers } = await supabaseClient.from('organization_users').select('user_id, organization_id').in('user_id', gestorIds);
            console.log("DEBUG: Projetos (projData):", projData);
            console.log("DEBUG: orgUsers:", orgUsers);

            if (orgUsers && orgUsers.length > 0) {
                const orgIds = [...new Set(orgUsers.map(ou => ou.organization_id))];
                const { data: orgs } = await supabaseClient.from('organizations').select('id, modulos').in('id', orgIds);

                // Mapeia gestor -> modulos
                const gestorOrgs = {};
                orgUsers.forEach(ou => {
                    const org = orgs?.find(o => o.id === ou.organization_id);
                    if (org) gestorOrgs[ou.user_id] = { modulos: org.modulos || [], id: org.id };
                });

                // Anexa os modulos ao projeto
                activeProjects = activeProjects.map(p => ({
                    ...p,
                    modulos: gestorOrgs[p.gestor_id]?.modulos || [],
                    organization_id: gestorOrgs[p.gestor_id]?.id
                }));
            }
        }
        state.projects = activeProjects;

        // Busca historico de docs (apenas NF para o fornecedor ver o status da despesa)
        const { data: docData, error: docError } = await supabaseClient
            .from('documents')
            .select('*, projects(pronac, nome)')
            .eq('fornecedor_id', state.user.id)
            .or('tipo_documento.eq.nf,tipo_documento.eq.comprovante,tipo_documento.is.null')
            .order('created_at', { ascending: false });

        if (docError) console.error('Erro ao buscar documentos do fornecedor:', docError);

        // Busca historico de evidencias (Módulo 2)
        const { data: evData, error: evError } = await supabaseClient
            .from('physical_evidences')
            .select('*, projects(pronac, nome)')
            .eq('enviado_por', state.user.id)
            .order('criado_em', { ascending: false });

        if (evError) console.error('Erro ao buscar evidências do fornecedor:', evError);

        const mappedEvData = (evData || []).map(ev => ({
            id: ev.id,
            name: ev.file_name,
            size: (ev.file_size ? (ev.file_size / 1024 / 1024).toFixed(2) + ' MB' : '---'),
            status: ev.status_validacao,
            created_at: ev.criado_em,
            projects: ev.projects,
            is_m2: true
        }));

        // Junta os dois e ordena por data
        state.documents = [...(docData || []), ...mappedEvData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (err) {
        console.error("Erro dashboard solicitante", err);
    }
}


// --- Sync de org_id para app_metadata (S0) ---
async function syncOrgMetadata() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;
        if (session.user?.app_metadata?.org_id) {
            // Já sincronizado; apenas garante state.user atualizado
            state.user = session.user;
            return;
        }

        await fetch('/api/auth/sync-org-metadata', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` }
        });

        await supabaseClient.auth.refreshSession();
        const { data: { session: refreshed } } = await supabaseClient.auth.getSession();
        if (refreshed) state.user = refreshed.user;
    } catch (e) {
        console.warn('sync-org-metadata:', e);
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
        state.userStatus = getUserRole() || 'gestor';
        await syncOrgMetadata();

        // Conta criada por terceiro (admin/suporte) nunca definiu a própria
        // senha: tranca no formulário de nova senha antes de qualquer tela.
        if (state.user?.app_metadata?.must_change_password === true) {
            state.forcarTrocaSenha = true;
            state.currentView = 'update_password';
            return;
        }

        // Todos os perfis (inclusive operador) passam pelo seletor de módulos,
        // que decide o destino: operador é redirecionado ao M3 automaticamente.
        window.location.href = 'module-selector.html';
        return;
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
    const orgName = document.getElementById('reg-org-name').value;

    const checkboxes = document.querySelectorAll('input[name="reg-modules"]:checked');
    const selectedModules = Array.from(checkboxes).map(cb => cb.value);

    if (password !== confirmPassword) {
        return alert("As senhas não coincidem!");
    }

    if (!orgName) {
        return alert("O nome da organização é obrigatório!");
    }

    if (selectedModules.length === 0) {
        return alert("Selecione pelo menos um módulo de interesse!");
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

        if (data.user) {
            // 1. Criar a Organização no BD
            const { data: orgData, error: orgError } = await supabaseClient
                .from('organizations')
                .insert([{
                    nome: orgName,
                    slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    modulos: selectedModules,
                    ativo: true
                }])
                .select()
                .single();

            if (orgError) {
                console.error("Erro ao criar organização:", orgError);
                throw new Error("Erro ao criar estrutura da organização no banco.");
            }

            // 2. Vincular usuário à organização
            const { error: linkError } = await supabaseClient
                .from('organization_users')
                .insert([{
                    organization_id: orgData.id,
                    user_id: data.user.id,
                    role: 'admin'
                }]);

            if (linkError) {
                console.error("Erro ao vincular permissões:", linkError);
                throw new Error("Erro ao vincular sua conta à organização.");
            }

            // S0: popula app_metadata.org_id agora que a org existe
            await syncOrgMetadata();
        }

        if (data.user && data.session) {
            state.user = data.user;
            alert("Conta criada com sucesso!");
            window.location.href = 'module-selector.html';
            return;
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
    const wasFornecedor = getUserRole() === 'fornecedor';
    // Implementação única em auth-logout.js: encerra a sessão e apaga o token
    // persistido mesmo se o signOut falhar. redirect:false porque aqui já estamos
    // no index.html — quem troca de tela é o navigate() abaixo, sem recarregar.
    if (window.prestaiLogout) {
        await window.prestaiLogout({ client: supabaseClient, redirect: false });
    } else {
        try { await supabaseClient.auth.signOut(); } catch (_) { }
    }
    state.user = null;
    state.userStatus = null;
    // Sem isto a flag sobrevive ao logout: quem sai da troca obrigatória e
    // depois pede "esqueci minha senha" na mesma aba veria a tela com o texto
    // de primeiro acesso e o botão Sair, que ali não fazem sentido.
    state.forcarTrocaSenha = false;
    window.navigate(wasFornecedor ? 'solicitante_login' : 'login');
};

window.toggleExtratoLancamentos = function () {
    state.extratoLancamentosExpandido = !state.extratoLancamentosExpandido;
    render();
};

window.toggleFiltroDuplicidade = function () {
    state.filters.duplicidade = state.filters.duplicidade === '1' ? '' : '1';
    state.filters.aprovacaoFornecedor = '';
    render();
};

window.toggleFiltroAprovacaoFornecedor = function () {
    if (!userIsGestorOrAbove()) return;
    state.filters.aprovacaoFornecedor = state.filters.aprovacaoFornecedor === '1' ? '' : '1';
    state.filters.duplicidade = '';
    render();
};

// Libera a NF do fornecedor para o fluxo normal. A partir daqui não há diferença
// nenhuma em relação a uma nota subida pelo M1.
window.handleAprovarNotaFornecedor = async function (documentId) {
    if (!userIsGestorOrAbove()) {
        showToast('Sem permissão para aprovar notas do fornecedor.', 'error');
        return;
    }
    if (!confirm('Aprovar esta nota e liberá-la para o fluxo de conformidade?')) return;

    const { error } = await supabaseClient
        .from('documents')
        .update({
            status: 'aguardando_conformidade',
            aprovado_por: state.user?.id || null,
            aprovado_em: new Date().toISOString(),
            motivo_rejeicao_fornecedor: null,
        })
        .eq('id', documentId);

    if (error) { showToast('Erro ao aprovar: ' + error.message, 'error'); return; }

    showToast('Nota aprovada e liberada para conformidade.', 'success');
    await fetchDocumentDetails(documentId);
};

window.handleRejeitarNotaFornecedor = async function (documentId) {
    if (!userIsGestorOrAbove()) {
        showToast('Sem permissão para rejeitar notas do fornecedor.', 'error');
        return;
    }
    // Motivo é obrigatório: é o que o fornecedor vai ler para saber o que corrigir.
    const motivo = (prompt('Motivo da rejeição (será exibido ao fornecedor):') || '').trim();
    if (!motivo) {
        showToast('A rejeição precisa de um motivo.', 'warning');
        return;
    }

    const { error } = await supabaseClient
        .from('documents')
        .update({ status: 'rejeitado_fornecedor', motivo_rejeicao_fornecedor: motivo })
        .eq('id', documentId);

    if (error) { showToast('Erro ao rejeitar: ' + error.message, 'error'); return; }

    showToast('Nota rejeitada. O fornecedor verá o motivo no portal.', 'success');
    await fetchDocumentDetails(documentId);
};

// Marca ciência da duplicidade. NÃO apaga nivel_duplicidade: o sinalizador fica
// como histórico, só sai da contagem de pendências.
window.handleMarcarDuplicidadeRevisada = async function (documentId) {
    if (!supabaseClient) return;
    const { error } = await supabaseClient
        .from('documents')
        .update({ duplicidade_revisada: true })
        .eq('id', documentId);

    if (error) {
        showToast('Erro ao marcar como revisado: ' + error.message, 'error');
        return;
    }

    // Atualiza o state local sem esperar o Realtime, para o retorno ser imediato.
    if (state.currentDocument?.id === documentId) {
        state.currentDocument = { ...state.currentDocument, duplicidade_revisada: true };
    }
    state.documents = state.documents.map(d =>
        d.id === documentId ? { ...d, duplicidade_revisada: true } : d
    );

    showToast('Duplicidade marcada como revisada.', 'success');
    render();
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

        // Primeiro acesso: a sessão já está válida, então em vez de mandar
        // logar de novo derruba a flag e segue direto para o seletor.
        if (state.forcarTrocaSenha) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const resp = await fetch('/api/auth/senha-trocada', {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            if (!resp.ok) {
                throw new Error('Senha alterada, mas a liberação do acesso falhou. Faça login novamente.');
            }
            // O app_metadata novo só entra no JWT quando a sessão é renovada;
            // sem isso os guards do seletor/M2/M3 ainda leriam a flag antiga.
            await supabaseClient.auth.refreshSession();
            state.forcarTrocaSenha = false;
            window.location.href = 'module-selector.html';
            return;
        }

        showToast("Senha redefinida com sucesso! Faça login agora.", 'success');
        setTimeout(() => window.navigate('login'), 3000);
    } catch (error) {
        showToast("Erro ao atualizar senha: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleTrocarSenha = async function () {
    const novaSenha = document.getElementById('cfg-nova-senha')?.value || '';
    const confirma  = document.getElementById('cfg-confirma-senha')?.value || '';

    if (novaSenha !== confirma) {
        showToast('As senhas não coincidem.', 'error');
        return;
    }
    if (novaSenha.length < 6) {
        showToast('A senha deve ter pelo menos 6 caracteres.', 'error');
        return;
    }

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient.auth.updateUser({ password: novaSenha });
        if (error) throw error;
        showToast('Senha alterada com sucesso!', 'success');
        document.getElementById('cfg-nova-senha').value = '';
        document.getElementById('cfg-confirma-senha').value = '';
    } catch (err) {
        showToast('Erro ao alterar senha: ' + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};


const GRUPOS_STATUS = {
    concluidos: {
        label: 'Concluídos / Enviados',
        statuses: ['enviado_salic', 'concluido'],
        cor: 'var(--success)',
        bg: '#f0fdf4',
        border: '#bbf7d0',
        icone: 'check-circle'
    },
    em_andamento: {
        label: 'Em andamento',
        statuses: ['uploaded', 'processing_ocr', 'validating', 'validated', 'aguardando_conformidade',
                   'aguardando_comprovante', 'aguardando_conciliacao_bancaria', 'aguardando_d3',
                   'liberado_rpa_airtop', 'aguardando_rubrica'],
        cor: 'var(--primary)',
        bg: '#eff6ff',
        border: '#bfdbfe',
        icone: 'clock'
    },
    atencao: {
        label: 'Requer atenção',
        statuses: ['bloqueado_conformidade', 'revisao_manual', 'erro_rpa', 'divergencia_valor', 'divergencia_beneficiario'],
        cor: 'var(--error)',
        bg: '#fef2f2',
        border: '#fecaca',
        icone: 'alert-triangle'
    }
};

const FinanceiroView = () => {
    let totalExecutado = 0;
    const chartLabels = [];
    const chartData = [];

    state.rubricas.forEach(r => {
        let rubricaTotal = 0;
        (r.despesas || []).forEach(d => { rubricaTotal += parseFloat(d.valor || 0); });
        if (rubricaTotal > 0) { chartLabels.push(r.nome); chartData.push(rubricaTotal); }
        totalExecutado += rubricaTotal;
    });

    state.chartData = { labels: chartLabels, data: chartData };

    const docs = state.documents || [];
    const grupoAtivo = state.financeiroGrupoAtivo;

    const contagens = {};
    const docsPorGrupo = {};
    Object.entries(GRUPOS_STATUS).forEach(([key, g]) => {
        const lista = docs.filter(d => g.statuses.includes(d.status));
        contagens[key] = lista.length;
        docsPorGrupo[key] = lista;
    });

    const renderListaDocs = (key) => {
        const g = GRUPOS_STATUS[key];
        const lista = docsPorGrupo[key];
        if (!lista || lista.length === 0) {
            return `<p class="text-sm" style="text-align:center;padding:1.5rem;color:var(--text-muted);">Nenhum documento neste grupo.</p>`;
        }
        return lista.map(d => {
            const sm = STATUS_MAP[d.status] || { label: d.status, class: 'status-pending' };
            const nome = d.nome_emissor || d.name || '---';
            const valor = d.valor ? 'R$ ' + parseValorBR(d.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '---';
            const data = d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : '---';
            const proj = state.projects.find(p => p.id === d.project_id);
            return `
            <div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 1rem;border-bottom:1px solid var(--border-subtle);">
                <i data-lucide="file-text" style="width:16px;color:${g.cor};flex-shrink:0;"></i>
                <div style="flex:1;min-width:0;">
                    <p style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nome}</p>
                    ${proj && !state.filters.project ? `<p class="text-xs" style="color:var(--text-muted);">${proj.pronac} — ${proj.nome}</p>` : ''}
                </div>
                <span class="text-xs" style="color:var(--text-muted);flex-shrink:0;">${data}</span>
                <span class="text-xs" style="color:var(--text-muted);flex-shrink:0;">${valor}</span>
                <span class="badge ${sm.class}" style="flex-shrink:0;">${sm.label}</span>
                <button class="btn btn-secondary" style="padding:4px 8px;flex-shrink:0;" onclick="window.navigate('details','${d.id}')">
                    <i data-lucide="eye" style="width:14px;"></i>
                </button>
            </div>`;
        }).join('');
    };

    return `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <h1>Relatórios Financeiros</h1>
                <p class="page-subtitle">Indicadores de execução e conformidade do projeto.</p>
            </div>
            <div style="flex: 1 1 220px; min-width: 0;">
                <select onchange="window.navigate('financeiro', this.value)">
                    <option value="">Todos os Projetos</option>
                    ${state.projects.map(p => `<option value="${p.id}" ${state.filters.project === p.id ? 'selected' : ''}>${p.pronac} - ${p.nome}</option>`).join('')}
                </select>
            </div>
        </div>
    </header>

    <div class="metrics-grid" style="margin-bottom:1.5rem;">
        <div class="card metric-card" style="display:none;">
            <p class="metric-label">Total Executado (rubricas)</p>
            <div class="metric-value">R$ ${totalExecutado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:1rem;margin-bottom:1.5rem;">
        ${Object.entries(GRUPOS_STATUS).map(([key, g]) => `
        <div onclick="window.toggleFinanceiroGrupo('${key}')"
             style="background:${grupoAtivo === key ? g.bg : 'var(--bg-card)'};border:2px solid ${grupoAtivo === key ? g.cor : g.border};border-radius:var(--radius);padding:1.25rem;cursor:pointer;transition:all 0.15s;">
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
                <i data-lucide="${g.icone}" style="width:20px;color:${g.cor};"></i>
                <span style="font-size:13px;font-weight:600;color:${g.cor};">${g.label}</span>
            </div>
            <div style="font-size:2rem;font-weight:700;color:${g.cor};">${contagens[key]}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">documento${contagens[key] !== 1 ? 's' : ''} ${grupoAtivo === key ? '▲ fechar' : '▼ ver lista'}</div>
        </div>`).join('')}
    </div>

    ${grupoAtivo ? `
    <div class="card" style="margin-bottom:1.5rem;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid var(--border-subtle);background:${GRUPOS_STATUS[grupoAtivo].bg};">
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <i data-lucide="${GRUPOS_STATUS[grupoAtivo].icone}" style="width:16px;color:${GRUPOS_STATUS[grupoAtivo].cor};"></i>
                <span style="font-weight:600;font-size:14px;color:${GRUPOS_STATUS[grupoAtivo].cor};">${GRUPOS_STATUS[grupoAtivo].label}</span>
                <span class="text-xs" style="color:var(--text-muted);">(${contagens[grupoAtivo]} documento${contagens[grupoAtivo] !== 1 ? 's' : ''})</span>
            </div>
            <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="window.toggleFinanceiroGrupo('${grupoAtivo}')">Fechar</button>
        </div>
        <div>${renderListaDocs(grupoAtivo)}</div>
    </div>
    ` : ''}

    <div class="card" style="display:none;">
        <h3 class="h2 mb-4">Execução por Rubrica</h3>
        <div style="height: 300px;">
            ${chartLabels.length > 0 ? '<canvas id="rubricasChart"></canvas>' : '<p class="text-sm" style="text-align: center; padding-top: 4rem; color: var(--text-muted);">Sem dados para o gráfico.</p>'}
        </div>
    </div>
</main>
`;
};

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
                <div style="flex: 1 1 220px; min-width: 0;">
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
                    ${planilhaOrcamentariaBtn() ? `<div style="margin-top: 1.25rem;">${planilhaOrcamentariaBtn()}</div>` : ''}
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
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(350px, 100%), 1fr)); gap: 1rem;">
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
                                        <div style="text-align: right; display:none;">
                                            <div class="text-xs font-bold ${percentual > 90 ? 'text-error' : 'text-primary'}">${percentual.toFixed(1)}%</div>
                                        </div>
                                    </div>
                                    <div style="width: 100%; height: 6px; background: var(--border-light); border-radius: 3px; overflow: hidden; margin-bottom: 0.75rem; display:none;">
                                        <div style="width: ${Math.min(percentual, 100)}%; height: 100%; background: ${percentual > 100 ? 'var(--error)' : 'var(--primary)'}; transition: width 0.3s ease;"></div>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                        <div>
                                            <span class="text-muted">Aprovado:</span>
                                            <span class="font-semibold">R$ ${aprovado.toLocaleString('pt-BR')}</span>
                                        </div>
                                        <div style="display:none;">
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
                    <div id="in23-panel-mount"></div>
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
        // Mantém o projeto filtrado (persistido) ao voltar ao dashboard
        state.filters.status = '';
        await fetchProjects(); // Sempre recarrega projetos ao voltar ao dashboard
        await fetchDocuments();
    } else if (view === 'solicitante_dashboard') {
        await fetchSolicitanteDashboard();
    } else if (view === 'upload') {
        await fetchProjects();
        // Dispara o carregamento das rubricas se já houver projeto selecionado
        if (state.filters.project) {
            setTimeout(() => window.handleProjectSelectChange(state.filters.project), 100);
        }
    } else if (view === 'upload_lote') {
        await fetchProjects();
        // fetchUploadLoteQueue precisa vir antes: fetchExtratoLoteVinculado só
        // restaura o vínculo se a fila deste projeto ainda tiver algo pendente.
        await fetchUploadLoteQueue();
        if (state.filters.project) {
            await Promise.all([
                fetchRubricasDisponiveis(state.filters.project),
                fetchExtratoLoteVinculado(state.filters.project),
            ]);
        }
    } else if (view === 'envio_lote_salic') {
        await fetchProjects();
        await fetchDocuments();
    } else if (view === 'orcamento' || view === 'financeiro') {
        await fetchProjects();
        await fetchCatalogoRubricas();
        if (id) state.filters.project = id;
        else if (!state.filters.project && state.projects.length > 0) state.filters.project = state.projects[0].id;

        if (view === 'financeiro') {
            state.financeiroGrupoAtivo = null;
            await fetchDocuments();
        }

        if (state.filters.project) {
            await fetchRubricas(state.filters.project);
            await fetchRubricaVersions(state.filters.project);
            const [{ data: projFin }, { data: docsConf }] = await Promise.all([
                supabaseClient.from('projects').select('valor_aprovado, valor_captado').eq('id', state.filters.project).single(),
                supabaseClient.from('documents').select('nome_emissor, cnpj_emissor, valor').eq('project_id', state.filters.project).in('status', ['liberado_rpa_airtop', 'enviado_salic', 'concluido'])
            ]);
            state.in23ProjectFinanceiro = projFin || null;
            state.in23DocumentosConferidos = docsConf || [];
        }
    } else if (view === 'details' && id) {
        await fetchDocumentDetails(id);
    } else if (view === 'admin_solicitantes') {
        await fetchProjects();
        await fetchSolicitantesAdmin();
    } else if (view === 'projects' || view === 'create_project') {
        await fetchProjects();
    } else if (view === 'configuracoes') {
        await fetchSettings();
    } else if (view === 'equipe') {
        if (!userCanDelete()) {
            showToast('Acesso restrito a administradores.', 'error');
            return;
        }
        await fetchEquipe();
    } else if (view === 'ferramentas' || view === 'ferramentas_juntar_pdf') {
        if (!userIsGestorOrAbove()) {
            showToast('Acesso restrito a gestores e administradores.', 'error');
            return;
        }
    }

    render();
    // IN23-DISABLED: if (view === 'orcamento' || view === 'financeiro') mountIN23Panel();
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
    if (!userIsGestorOrAbove()) {
        showToast('Sem permissão para criar rubricas.', 'error');
        return;
    }
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

window.salvarCamposManuais = async function (documentId) {
    const updateFields = {};
    const erros = [];

    const cnpjInput = document.getElementById('input-cnpj-emissor');
    if (cnpjInput?.value) {
        const cnpjLimpo = cnpjInput.value.replace(/\D/g, '');
        if (cnpjLimpo.length !== 11 && cnpjLimpo.length !== 14) {
            erros.push('CNPJ deve ter 14 dígitos ou CPF 11 dígitos');
        } else {
            updateFields.cnpj_emissor = cnpjLimpo;
        }
    }

    const nomeInput = document.getElementById('input-nome-emissor');
    if (nomeInput?.value?.trim()) updateFields.nome_emissor = nomeInput.value.trim();

    const valorInput = document.getElementById('input-valor');
    if (valorInput?.value) {
        const valorLimpo = parseFloat(valorInput.value.replace(',', '.'));
        if (isNaN(valorLimpo) || valorLimpo <= 0) {
            erros.push('Valor deve ser maior que zero');
        } else {
            updateFields.valor = valorLimpo;
        }
    }

    const dataInput = document.getElementById('input-data-emissao');
    if (dataInput?.value) {
        const data = new Date(dataInput.value);
        if (isNaN(data.getTime())) {
            erros.push('Data inválida');
        } else if (data > new Date()) {
            erros.push('Data não pode ser futura');
        } else {
            updateFields.data_emissao = dataInput.value;
        }
    }

    const nrInput = document.getElementById('input-numero-nf');
    if (nrInput?.value?.trim()) updateFields.numero_nf = nrInput.value.trim();

    if (erros.length > 0) { showToast(erros.join('. '), 'error'); return; }
    if (Object.keys(updateFields).length === 0) { showToast('Nenhum campo preenchido', 'error'); return; }

    const { data: doc } = await supabaseClient
        .from('documents')
        .select('status, rubrica, rubrica_id_fk, cnpj_emissor, valor, data_emissao, project_id, extrato_origem_id')
        .eq('id', documentId)
        .single();

    const merged = {
        cnpj_emissor:  updateFields.cnpj_emissor  || doc?.cnpj_emissor,
        valor:         updateFields.valor          || doc?.valor,
        data_emissao:  updateFields.data_emissao   || doc?.data_emissao,
        rubrica_id_fk: doc?.rubrica_id_fk
    };

    let avancouParaConformidade = false;

    if (doc?.status === 'aguardando_rubrica'
        && merged.cnpj_emissor && merged.valor && merged.data_emissao && merged.rubrica_id_fk) {
        updateFields.status = 'aguardando_conciliacao_bancaria';
    } else if (doc?.status === 'revisao_manual'
        && merged.cnpj_emissor && merged.valor && merged.data_emissao && merged.rubrica_id_fk) {
        updateFields.status = 'aguardando_conformidade';
        avancouParaConformidade = true;
    }

    const { error } = await supabaseClient
        .from('documents')
        .update(updateFields)
        .eq('id', documentId);

    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return; }

    // Ao completar a revisao manual (OCR falhou, humano preencheu os campos), o n8n
    // precisa ser notificado para rodar a validacao de conformidade (CNAE vs. rubrica);
    // sem isso o documento fica "em auditoria" mas nunca e de fato auditado.
    if (avancouParaConformidade && CONFIG.N8N_WEBHOOK_VALIDATION_URL) {
        fetch(CONFIG.N8N_WEBHOOK_VALIDATION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            mode: 'cors',
            body: JSON.stringify({
                document_id: documentId,
                cnpj_fornecedor: merged.cnpj_emissor
            })
        }).then(r => console.log("n8n Validation Triggered (salvarCamposManuais):", r.status))
            .catch(e => {
                console.error("Erro ao notificar n8n:", e.message);
                window.showToast('Dados salvos, mas houve falha ao notificar o sistema de validação. Se o documento não avançar em alguns minutos, contate o suporte.', 'warning');
            });
    }

    // Completar os campos manualmente (aguardando_rubrica -> aguardando_
    // conciliacao_bancaria) também deve reaproveitar o extrato do lote, igual
    // à varredura do Dashboard — sem isso a nota fica pedindo upload de
    // extrato de novo mesmo já tendo um vinculado desde o upload em lote.
    if (updateFields.status === 'aguardando_conciliacao_bancaria' && doc?.extrato_origem_id) {
        dispararConciliacaoAutoLote({
            id: documentId,
            extrato_origem_id: doc.extrato_origem_id,
            project_id: doc.project_id
        }).then(ok => { if (ok) window.showToast('Nota também enviada para conciliação automática com o extrato do lote.', 'success'); });
    }

    showToast('Campos salvos com sucesso', 'success');
    fetchDocumentDetails(documentId);
};

// --- Edição manual dos dados extraídos (correção de leitura da IA) ---

window.toggleEditDocFields = function (on) {
    state.editingDocFields = !!on;
    render();
};

window.salvarEdicaoCampos = async function (documentId) {
    const cnpj = document.getElementById('edit-cnpj-emissor')?.value.trim() || null;
    const nome = document.getElementById('edit-nome-emissor')?.value.trim() || null;
    const valorRaw = document.getElementById('edit-valor')?.value;
    const dataEmissao = document.getElementById('edit-data-emissao')?.value || null;
    const numeroNf = document.getElementById('edit-numero-nf')?.value.trim() || null;

    const valor = valorRaw ? parseFloat(valorRaw) : null;
    if (valorRaw && (!Number.isFinite(valor) || valor <= 0)) {
        showToast('Valor total inválido.', 'error');
        return;
    }
    if (dataEmissao && dataEmissao > new Date().toISOString().split('T')[0]) {
        showToast('A data de emissão não pode ser futura.', 'error');
        return;
    }

    const ok = confirm(
        'Confirmação de responsabilidade\n\n' +
        'Você está substituindo dados extraídos automaticamente pela IA.\n' +
        'Ao confirmar, declara que as informações conferem com o documento ' +
        'fiscal original e assume a responsabilidade pelos dados prestados ' +
        'ao MinC/SALIC.\n\nDeseja salvar as correções?'
    );
    if (!ok) return;

    const { error } = await supabaseClient
        .from('documents')
        .update({
            cnpj_emissor: cnpj,
            nome_emissor: nome,
            valor: valor,
            data_emissao: dataEmissao,
            numero_nf: numeroNf
        })
        .eq('id', documentId);

    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return; }

    state.editingDocFields = false;
    showToast('Dados corrigidos com sucesso.', 'success');
    fetchDocumentDetails(documentId);
};

// Carrega o extrato vinculado à nota e seus lançamentos, para a seção de leitura
// da DetailsView. A nota chega ao extrato por dois caminhos:
//   a) extrato_origem_id preenchido (veio do upload em lote);
//   b) extrato enviado dentro da própria nota — aí o vínculo está no lançamento,
//      via extratos_lancamentos.document_id, e é o lançamento que carrega o
//      extrato_id.
// Procura primeiro pelo lançamento da nota; se não houver, cai no extrato_origem_id.
async function carregarExtratoDaNota(doc) {
    state.currentExtrato = null;
    // Abrir outra nota recomeça a lista recolhida.
    state.extratoLancamentosExpandido = false;
    if (!supabaseClient || !doc?.id || !doc?.project_id) return;

    const COLS = 'id, extrato_id, project_id, fitid, tipo, valor, data_lancamento, memo, status_conciliacao, document_id';

    try {
        // Caminho (b): o lançamento já aponta para esta nota.
        // project_id sempre no filtro — é o que mantém a leitura dentro do projeto.
        const { data: doDoc, error: errDoc } = await supabaseClient
            .from('extratos_lancamentos')
            .select(COLS)
            .eq('document_id', doc.id)
            .eq('project_id', doc.project_id)
            .limit(1);
        if (errDoc) throw errDoc;

        const lancamentoDaNota = (doDoc && doDoc[0]) || null;
        const extratoId = lancamentoDaNota?.extrato_id || doc.extrato_origem_id || null;
        if (!extratoId) return;

        // Só as colunas que a tabela realmente tem: pedir uma inexistente faz o
        // PostgREST devolver 400 e o extrato voltar nulo — foi o que derrubou o
        // botão de visualizar, silenciosamente, por causa de um 'created_at' que
        // não existe em extratos. Por isso o erro abaixo é checado, não ignorado.
        const [{ data: extrato, error: errExtrato }, { data: lancamentos, error: errLanc }] = await Promise.all([
            supabaseClient
                .from('extratos')
                .select('id, file_path, formato, periodo_inicio, periodo_fim, saldo_final, status')
                .eq('id', extratoId)
                .maybeSingle(),
            supabaseClient
                .from('extratos_lancamentos')
                .select(COLS)
                .eq('extrato_id', extratoId)
                .eq('project_id', doc.project_id)
                .order('data_lancamento', { ascending: true }),
        ]);
        if (errLanc) throw errLanc;
        if (errExtrato) throw errExtrato;

        const lista = lancamentos || [];

        // Nomes das notas conciliadas com os OUTROS lançamentos, para a lista dizer
        // "conciliado com X" em vez de só mostrar um id.
        const outrosDocIds = [...new Set(
            lista.map(l => l.document_id).filter(id => id && id !== doc.id)
        )];
        let notasPorId = {};
        if (outrosDocIds.length > 0) {
            const { data: notas } = await supabaseClient
                .from('documents')
                .select('id, name, numero_nf')
                .in('id', outrosDocIds);
            (notas || []).forEach(n => { notasPorId[n.id] = n; });
        }

        state.currentExtrato = {
            extrato: extrato || null,
            lancamentoDaNota: lancamentoDaNota || lista.find(l => l.document_id === doc.id) || null,
            lancamentos: lista,
            notasPorId,
        };
    } catch (err) {
        // Não derruba o detalhe da nota por causa da seção de extrato.
        console.error('[carregarExtratoDaNota]', err);
        state.currentExtrato = null;
    }
}

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
        // Sai do modo de edição ao abrir outro documento
        state.editingDocFields = false;
        render();
    }

    state.uploadConcluidoComprovante = false;
    state.uploadConcluidoExtrato = false;
    state.isUploadingExtrato = false;
    state.isUploadingComprovante = false;
    state.isSalicRunning = false;
    state.mostrarUploadManualExtrato = false;

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
                .select('id, nome, rubrica_id, produto, valor_aprovado')
                .eq('project_id', data.project_id)
                .order('produto', { ascending: true })
                .order('rubrica_id', { ascending: true });
            state.rubricas_disponiveis = ordenarRubricas(rubData || []);
            state.uploadRubricasProjectId = data.project_id;
        }

        // Extrato bancário e seus lançamentos (somente leitura).
        state.currentExtrato = null;
        if (data) await carregarExtratoDaNota(data);

        // Documento apontado como duplicata, para o comparativo lado a lado.
        // Pode não existir mais (duplicata_de_id vira NULL na exclusão, mas a
        // linha em memória pode estar desatualizada) — por isso maybeSingle.
        state.currentDuplicata = null;
        if (data && data.duplicata_de_id) {
            const { data: dupData } = await supabaseClient
                .from('documents')
                .select('id, name, numero_nf, cnpj_emissor, valor, data_emissao, status')
                .eq('id', data.duplicata_de_id)
                .maybeSingle();
            state.currentDuplicata = dupData || null;
        }

    } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
        state.currentDocument = null;
        state.currentDuplicata = null;
        state.currentExtrato = null;
        if (!silent) {
            showToast("Erro ao carregar detalhes do documento: " + err.message, 'error');
        }
    } finally {
        if (!silent) state.loading = false;
        render();
    }
}

window.handleVincularRubrica = async function (documentId, projectId, valorDespesa) {
    if (!userIsGestorOrAbove()) {
        showToast('Sem permissão para vincular rubrica.', 'error');
        return;
    }
    // O input agora e autocomplete (datalist). Resolve o texto digitado de volta
    // para a rubrica do state (ver resolverRubricaPorRotulo).
    const inputEl = document.getElementById('vincular-rubrica-input');
    const inputText = (inputEl?.value || '').trim();
    if (!inputText) return alert('Digite ou selecione uma rubrica!');

    const rubricasDisp = state.rubricas_disponiveis || [];
    const rubricaSelecionada = resolverRubricaPorRotulo(inputText, rubricasDisp);

    if (!rubricaSelecionada) {
        // Nome puro com homônimos cai aqui de propósito: sem o produto não dá para
        // saber qual das rubricas é a certa, e vincular a primeira seria um chute.
        return alert('Rubrica não encontrada ou ambígua. Selecione uma opção da lista (o produto aparece no início de cada item).');
    }

    const rubricaId = rubricaSelecionada.id;
    const rubricaNome = rubricaSelecionada.nome;
    if (valorDespesa === undefined || valorDespesa === null) valorDespesa = 0;

    state.loading = true;
    render();

    try {
        const doc = state.currentDocument;

        // Upsert em despesas: permite trocar a rubrica de um documento que ja foi vinculado
        const { error } = await supabaseClient.from('despesas').upsert({
            document_id: documentId,
            rubrica_id: rubricaId,
            project_id: projectId,
            valor: parseFloat(valorDespesa),
            cnpj_fornecedor: doc.cnpj_emissor || null,
            data_emissao: doc.data_emissao || null,
            data_pagamento: doc.data_pagamento || null
        }, { onConflict: 'document_id' });

        if (error) throw error;

        // O webhook do n8n provavelmente le de documents.rubrica — sem isso, ele revalidaria
        // contra a rubrica antiga.
        await supabaseClient
            .from('documents')
            .update({ rubrica: rubricaNome, rubrica_id_fk: rubricaId, status: 'processing_ocr', just_erro: null })
            .eq('id', documentId);

        window.showToast('Rubrica atualizada! Revalidando com o n8n...', 'info');

        // Aciona o workflow n8n de revalidacao com a rubrica nova no payload
        // (fire-and-forget; o realtime sub atualiza o status final ao terminar)
        if (CONFIG.N8N_WEBHOOK_VALIDATION_URL) {
            fetch(CONFIG.N8N_WEBHOOK_VALIDATION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({
                    document_id: documentId,
                    cnpj_fornecedor: doc.cnpj_emissor,
                    rubrica_id: rubricaId,
                    rubrica_nome: rubricaNome
                })
            }).then(r => console.log("n8n Validation Triggered:", r.status))
                .catch(e => window.showToast("Erro ao notificar n8n: " + e.message, 'error'));
        }

        await fetchDocumentDetails(documentId);
    } catch (err) {
        window.showToast("Erro ao vincular despesa: " + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
}

async function fetchProjects() {
    if (!supabaseClient || !state.user) return;

    // Só bloqueia se a role for EXPLICITAMENTE 'fornecedor'
    // Contas antigas sem role são tratadas como gestor
    if (getUserRole() === 'fornecedor') {
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

    // Mapa project_id -> planilha orçamentária (mais recente), para o botão
    // "Visualizar Planilha Orçamentária" nas telas de Rubricas/Documentos/Lote.
    try {
        const ids = state.projects.map(p => p.id);
        const map = {};
        if (ids.length) {
            const { data: planilhas } = await supabaseClient
                .from('documents')
                .select('project_id, name, file_path, created_at')
                .eq('tipo_documento', 'planilha_orcamentaria')
                .in('project_id', ids)
                .order('created_at', { ascending: false });
            (planilhas || []).forEach(pl => {
                if (!map[pl.project_id]) map[pl.project_id] = { name: pl.name, file_path: pl.file_path };
            });
        }
        state.planilhasPorProjeto = map;
    } catch (e) {
        console.error('Erro ao buscar planilhas orçamentárias:', e);
    }
}

async function fetchDocuments() {
    if (!supabaseClient || !state.user) return;

    let query = supabaseClient.from('documents').select('*');

    // Mostra Notas Fiscais, Comprovantes e registros sem tipo (legado)
    query = query.or('tipo_documento.eq.nf,tipo_documento.eq.comprovante,tipo_documento.is.null');

    // Não mostra documentos da fila de Upload em Lote (aguardando rubrica manual)
    query = query.neq('status', 'aguardando_rubrica');

    // Filtros adicionais
    if (state.filters.project) {
        query = query.eq('project_id', state.filters.project);
    }

    if (state.filters.status) {
        query = query.eq('status', state.filters.status);
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

    // Notas vindas de lote COM extrato tentam conciliar sozinhas (não bloqueia
    // o fetch — roda em background e recarrega a lista se algo casar).
    tentarConciliacaoAutoLote();
}

// Conciliação automática de notas de lote: varre as notas que estão paradas em
// 'aguardando_comprovante' COM extrato_origem_id e pede ao backend que tente
// casar cada uma contra os lançamentos do próprio extrato.
// Varre o estado atual em vez de só reagir à transição de status: assim uma nota
// que mudou de status com a tela fechada também é pega quando a lista abre.
const _conciliacaoAutoTentada = new Set();

// Reaproveita, por nota, a MESMA chamada que window.handleUploadExtrato já faz
// no fluxo manual (upload dentro da nota) — não é um motor de match novo. O
// arquivo já está no Storage e a linha em `extratos` já existe (criados no
// upload do lote), então só o passo 3 daquele fluxo é repetido: o webhook
// prestai-conciliation, que já concilia corretamente. O resultado chega pelo
// Realtime já assinado em setupRealtime(), igual ao fluxo manual — por isso
// esta função não confirma sucesso, só dispara e segue.
//
// Chamada tanto pela varredura do Dashboard (tentarConciliacaoAutoLote, mais
// abaixo) quanto pelos avanços MANUAIS feitos direto na tela de detalhes
// (handleForcarAvanco, salvarCamposManuais) — sem isso, uma nota que só chega
// a 'aguardando_comprovante'/'aguardando_conciliacao_bancaria' por avanço
// manual nunca passa por fetchDocuments() enquanto o usuário fica na tela de
// detalhes, e o extrato do lote nunca é usado (o bug que motivou isto).
async function dispararConciliacaoAutoLote(doc) {
    if (!doc?.extrato_origem_id || !CONFIG.N8N_WEBHOOK_RECONCILIATION_URL) return false;
    if (_conciliacaoAutoTentada.has(doc.id)) return false;
    _conciliacaoAutoTentada.add(doc.id);

    try {
        const { data: extrato, error: extErr } = await supabaseClient
            .from('extratos')
            .select('file_path')
            .eq('id', doc.extrato_origem_id)
            .maybeSingle();
        if (extErr || !extrato?.file_path) {
            console.warn('[conciliacao-auto-lote] extrato de origem sem file_path:', doc.extrato_origem_id, extErr?.message);
            return false;
        }

        const resp = await fetch(CONFIG.N8N_WEBHOOK_RECONCILIATION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            mode: 'cors',
            body: JSON.stringify({
                extrato_id: doc.extrato_origem_id,
                document_id: doc.extrato_origem_id, // Backward compatibility, igual ao fluxo manual
                nf_id: doc.id,
                comprovante_id: null,
                file_path: extrato.file_path,
                bucket: 'documentos',
                project_id: doc.project_id
            })
        });
        if (!resp.ok) {
            console.warn('[conciliacao-auto-lote] webhook retornou', resp.status, 'para', doc.id);
            return false;
        }
        return true;
    } catch (err) {
        // Uma nota falhando não trava as demais.
        console.warn('[conciliacao-auto-lote]', doc.id, err.message);
        return false;
    }
}

async function tentarConciliacaoAutoLote() {
    // Cobre também aguardando_conciliacao_bancaria: nota do lote que já ganhou
    // comprovante (ou avançou por outro caminho) concilia contra o extrato de
    // origem sem exigir novo upload de extrato nos detalhes da nota.
    const candidatas = (state.documents || []).filter(d =>
        d.extrato_origem_id &&
        ['aguardando_comprovante', 'aguardando_conciliacao_bancaria'].includes(d.status) &&
        !_conciliacaoAutoTentada.has(d.id)
    );
    if (!candidatas.length) return;

    let disparadas = 0;
    for (const doc of candidatas) {
        if (await dispararConciliacaoAutoLote(doc)) disparadas++;
    }

    if (disparadas > 0) {
        showToast(`${disparadas} nota(s) do lote enviada(s) para conciliação automática.`, 'success');
    }
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
    // Reset campo a campo para preservar o accessor persistido de `project`
    state.filters.project = '';
    state.filters.startDate = '';
    state.filters.endDate = '';
    state.filters.search = '';
    state.filters.sort = 'date_desc';
    state.filters.status = '';
    fetchDocuments().then(render);
};

window.updateSort = function (value) {
    state.filters.sort = value;
    render();
};

window.handleDeleteDocument = async function (id, filePath) {
    if (!userCanDelete()) {
        showToast('Apenas administradores podem excluir documentos.', 'error');
        return;
    }
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

window.handleSelectAllDashboardDocs = function (checked) {
    const checkboxes = document.querySelectorAll('.chk-doc-dashboard');
    checkboxes.forEach(chk => chk.checked = checked);
    window.handleDashboardDocCheckboxChange();
};

window.handleDashboardDocCheckboxChange = function () {
    const selected = document.querySelectorAll('.chk-doc-dashboard:checked');
    const btn = document.getElementById('btn-excluir-lote-dashboard');
    const countSpan = document.getElementById('count-excluir-lote-dashboard');
    const selectAllChk = document.getElementById('chk-dashboard-select-all');

    if (btn && countSpan) {
        if (selected.length > 0) {
            btn.style.display = 'inline-flex';
            countSpan.textContent = selected.length;
        } else {
            btn.style.display = 'none';
        }
    }

    if (selectAllChk) {
        const all = document.querySelectorAll('.chk-doc-dashboard');
        selectAllChk.checked = all.length > 0 && selected.length === all.length;
    }
};

window.handleDeleteSelectedDocuments = async function () {
    if (!userCanDelete()) {
        showToast('Apenas administradores podem excluir documentos.', 'error');
        return;
    }
    const checkboxes = document.querySelectorAll('.chk-doc-dashboard:checked');
    if (checkboxes.length === 0) return;

    if (!confirm(`Tem certeza que deseja excluir os ${checkboxes.length} documentos selecionados? Esta ação não pode ser desfeita.`)) return;

    state.loading = true;
    render();

    const ids = [];
    const filePaths = [];

    checkboxes.forEach(chk => {
        ids.push(chk.getAttribute('data-id'));
        const fp = chk.getAttribute('data-file-path');
        if (fp && fp !== 'null' && fp !== 'undefined') filePaths.push(fp);
    });

    try {
        // 1. Excluir do Storage
        if (filePaths.length > 0) {
            const { error: storageError } = await supabaseClient.storage
                .from('documentos')
                .remove(filePaths);

            if (storageError) {
                console.warn("Alguns arquivos podem não ter sido limpos do storage:", storageError.message);
            }
        }

        // 2. Excluir do Banco
        const { error: dbError } = await supabaseClient
            .from('documents')
            .delete()
            .in('id', ids);

        if (dbError) throw dbError;

        showToast(`${ids.length} documentos excluídos com sucesso.`, 'success');
        await fetchDocuments();
        render();
    } catch (error) {
        showToast("Erro ao excluir documentos em lote: " + error.message, 'error');
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
    if (!userCanDelete()) {
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

        <!-- Trocar Senha -->
        <div class="card mb-4">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.25rem;">
                <i data-lucide="lock" style="width: 18px; color: var(--primary);"></i>
                <h3 class="h2">Trocar senha de acesso</h3>
            </div>
            <p class="text-xs mb-4" style="color: var(--text-secondary);">Defina uma nova senha para o seu login no Prestaí.</p>
            <form onsubmit="event.preventDefault(); window.handleTrocarSenha();">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                    <div class="form-group">
                        <label>Nova senha</label>
                        <input type="password" id="cfg-nova-senha" placeholder="Mínimo 6 caracteres" minlength="6" required>
                    </div>
                    <div class="form-group">
                        <label>Confirmar nova senha</label>
                        <input type="password" id="cfg-confirma-senha" placeholder="Repita a senha" minlength="6" required>
                    </div>
                </div>
                <button class="btn btn-primary" type="submit">
                    ${state.loading ? 'Salvando...' : 'Salvar nova senha'}
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


// --- Equipe (S1-B) ---
const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor', analista: 'Analista', operador: 'Operador', fornecedor: 'Fornecedor' };

const EquipeView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <h1>Equipe</h1>
        <p class="page-subtitle">Gerencie os perfis de acesso dos usuários do sistema.</p>
    </header>

    <div class="card" style="max-width: 960px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <i data-lucide="users"></i>
                <h3 class="h2">Usuários cadastrados</h3>
            </div>
            <button class="btn btn-primary" onclick="window.openCriarAnalistaModal()">
                <i data-lucide="user-plus" style="width: 14px;"></i>
                Adicionar Usuário
            </button>
        </div>

        ${state.equipe.length === 0 ? `
            <p class="text-sm" style="color: var(--text-muted);">Nenhum usuário encontrado.</p>
        ` : `
        <table class="data-table" style="width: 100%;">
            <thead>
                <tr>
                    <th>E-mail</th>
                    <th>Perfil atual</th>
                    <th>Cadastro</th>
                    <th style="text-align: right;">Ações</th>
                </tr>
            </thead>
            <tbody>
                ${state.equipe.map(u => `
                    <tr>
                        <td>${u.email || '---'}</td>
                        <td>
                            <span class="status-badge ${u.role === 'gestor' ? 'status-success' : 'status-pending'}">
                                ${ROLE_LABELS[u.role] || (u.role || '—')}
                            </span>
                        </td>
                        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '---'}</td>
                        <td style="text-align: right;">
                            <button class="btn btn-secondary" onclick="window.openEquipeRoleModal('${u.id}', '${u.role || ''}', '${(u.email || '').replace(/'/g, "\\'")}')">
                                <i data-lucide="shield" style="width: 14px;"></i>
                                Alterar Perfil
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        `}
    </div>

    <!-- Modal: Alterar Perfil -->
    <div id="modal-equipe-role" class="modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
        <div class="card" style="width: 100%; max-width: 480px; margin: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                <h3 class="h2">Alterar Perfil</h3>
                <button class="btn btn-ghost" onclick="document.getElementById('modal-equipe-role').style.display='none'">
                    <i data-lucide="x"></i>
                </button>
            </div>

            <p class="text-sm mb-4">Usuário: <strong id="equipe-modal-email">—</strong></p>
            <input type="hidden" id="equipe-modal-target" />

            <div class="form-group mb-4">
                <label for="equipe-modal-role">Perfil</label>
                <select id="equipe-modal-role">
                    <option value="analista">Analista</option>
                    <option value="gestor">Gestor</option>
                    <option value="operador">Operador (campo — Módulo III)</option>
                    <option value="fornecedor">Fornecedor</option>
                </select>
            </div>

            <div style="padding: 0.75rem; background: var(--bg-sidebar); border-radius: var(--radius-sm); margin-bottom: 1.5rem; display: flex; gap: 0.5rem; align-items: flex-start;">
                <i data-lucide="info" style="width: 16px; flex-shrink: 0; margin-top: 2px;"></i>
                <p class="text-xs" style="color: var(--text-secondary); line-height: 1.5;">
                    O usuário precisa fazer logout e login novamente para que o novo perfil tenha efeito no JWT da sessão.
                </p>
            </div>

            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="document.getElementById('modal-equipe-role').style.display='none'">Cancelar</button>
                <button class="btn btn-primary" onclick="window.handleSetRole()">Confirmar alteração</button>
            </div>
        </div>
    </div>

    <!-- Modal: Adicionar Usuário -->
    <div id="modal-criar-analista" class="modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
        <div class="card" style="width: 100%; max-width: 480px; margin: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                <h3 class="h2">Adicionar Usuário</h3>
                <button class="btn btn-ghost" onclick="document.getElementById('modal-criar-analista').style.display='none'">
                    <i data-lucide="x"></i>
                </button>
            </div>

            <form onsubmit="event.preventDefault(); window.handleCriarAnalista();">
                <div class="form-group mb-4">
                    <label for="criar-analista-perfil">Perfil</label>
                    <select id="criar-analista-perfil">
                        <option value="analista">Analista — opera os Módulos I e II</option>
                        <option value="operador">Operador — campo (Módulo III)</option>
                    </select>
                </div>

                <div class="form-group mb-4">
                    <label for="criar-analista-nome">Nome (opcional)</label>
                    <input type="text" id="criar-analista-nome" placeholder="Maria Silva" />
                </div>

                <div class="form-group mb-4">
                    <label for="criar-analista-email">E-mail</label>
                    <input type="email" id="criar-analista-email" placeholder="usuario@empresa.com" required />
                </div>

                <div class="form-group mb-4">
                    <label for="criar-analista-senha">Senha provisória (mín. 6 caracteres)</label>
                    <input type="text" id="criar-analista-senha" placeholder="••••••" minlength="6" required />
                </div>

                <div style="padding: 0.75rem; background: var(--bg-sidebar); border-radius: var(--radius-sm); margin-bottom: 1.5rem; display: flex; gap: 0.5rem; align-items: flex-start;">
                    <i data-lucide="info" style="width: 16px; flex-shrink: 0; margin-top: 2px;"></i>
                    <p class="text-xs" style="color: var(--text-secondary); line-height: 1.5;">
                        O usuário será criado já vinculado à sua organização. O <strong>Operador</strong> acessa apenas o Módulo III (execução em campo). Compartilhe a senha provisória de forma segura — o usuário poderá trocá-la depois.
                    </p>
                </div>

                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-criar-analista').style.display='none'">Cancelar</button>
                    <button type="submit" class="btn btn-primary" id="criar-analista-submit">Criar Usuário</button>
                </div>
            </form>
        </div>
    </div>
</main>
`;

async function fetchEquipe() {
    state.equipe = [];
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('Sessão não encontrada.');
        const resp = await fetch('/api/gestor/usuarios', {
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json.error || 'Erro ao listar usuários.');
        state.equipe = json.users || [];
    } catch (err) {
        console.error('fetchEquipe:', err);
        window.showToast(err.message, 'error');
    }
}

window.openEquipeRoleModal = function (userId, currentRole, email) {
    document.getElementById('equipe-modal-target').value = userId;
    document.getElementById('equipe-modal-role').value = currentRole || 'analista';
    document.getElementById('equipe-modal-email').textContent = email || '—';
    document.getElementById('modal-equipe-role').style.display = 'flex';
};

window.handleSetRole = async function () {
    const targetUserId = document.getElementById('equipe-modal-target').value;
    const role = document.getElementById('equipe-modal-role').value;
    if (!targetUserId || !role) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const resp = await fetch('/api/gestor/set-role', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ targetUserId, role })
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json.error || 'Falha ao alterar perfil.');
        window.showToast('Perfil atualizado com sucesso.', 'success');
        document.getElementById('modal-equipe-role').style.display = 'none';
        // Se o admin alterou o próprio role, atualiza o state com a sessão nova
        if (targetUserId === state.user?.id) {
            await supabaseClient.auth.refreshSession();
            const { data: { session: refreshed } } = await supabaseClient.auth.getSession();
            if (refreshed) state.user = refreshed.user;
        }
        await fetchEquipe();
        render();
    } catch (err) {
        window.showToast(err.message, 'error');
    }
};

window.openCriarAnalistaModal = function () {
    document.getElementById('criar-analista-perfil').value = 'analista';
    document.getElementById('criar-analista-nome').value = '';
    document.getElementById('criar-analista-email').value = '';
    document.getElementById('criar-analista-senha').value = '';
    document.getElementById('modal-criar-analista').style.display = 'flex';
};

window.handleCriarAnalista = async function () {
    const role = document.getElementById('criar-analista-perfil').value;
    const nome = document.getElementById('criar-analista-nome').value.trim();
    const email = document.getElementById('criar-analista-email').value.trim();
    const password = document.getElementById('criar-analista-senha').value;
    if (!email || !password) return;

    const submitBtn = document.getElementById('criar-analista-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Criando...';

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const resp = await fetch('/api/gestor/criar-analista', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ email, password, nome: nome || null, role })
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json.error || 'Falha ao criar usuário.');

        window.showToast(`${ROLE_LABELS[role] || 'Usuário'} ${email} criado com sucesso.`, 'success');
        document.getElementById('modal-criar-analista').style.display = 'none';
        await fetchEquipe();
        render();
    } catch (err) {
        window.showToast(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Criar Usuário';
    }
};

// --- Laudo de Conformidade Excel (S4) ---
const LAUDO_DOC_COLUMNS = `
    nome_emissor, cnpj_emissor, rubrica, tipo_documento,
    numero_nf, data_emissao, valor_pago, data_pagamento,
    autenticacao_bancaria, justification, just_erro,
    status, json_extraido, created_at
`;

const LAUDO_COL_WIDTHS = [
    { wch: 40 }, // Razão Social
    { wch: 18 }, // CNPJ
    { wch: 12 }, // Nº Rubrica
    { wch: 30 }, // Item de Custo
    { wch: 12 }, // CNAE
    { wch: 18 }, // Tipo doc
    { wch: 60 }, // Discriminação
    { wch: 14 }, // Nº NF
    { wch: 14 }, // Data emissão
    { wch: 16 }, // Valor
    { wch: 14 }, // Data pagamento
    { wch: 36 }, // Nº extrato
    { wch: 10 }, // IRRF
    { wch: 10 }, // PCC
    { wch: 12 }, // INSS
    { wch: 10 }, // ISS
    { wch: 20 }, // Status
    { wch: 50 }, // Motivo técnico
];

function _laudoMapStatus(status) {
    const apto = ['validated'];
    const ressalva = ['aguardando_conformidade', 'aguardando_comprovante', 'revisao_manual', 'aguardando_conciliacao_bancaria'];
    const naoApto = ['bloqueado_conformidade', 'divergencia_valor', 'divergencia_beneficiario', 'erro_rpa'];
    if (apto.includes(status)) return 'Apto';
    if (ressalva.includes(status)) return 'Apto com ressalva';
    if (naoApto.includes(status)) return 'Não apto';
    return '(em processamento)';
}

function _laudoFmtDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('pt-BR');
}

function _laudoFmtValor(v) {
    if (v == null) return '';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _laudoBuildRow(d, rubricaMap) {
    const rubricaKey = (d.rubrica || '').toLowerCase().trim();
    const codigoRubrica = rubricaMap[rubricaKey] || '';
    const ret = d.json_extraido?.retencoes || {};
    return {
        'RAZÃO SOCIAL (FORNECEDOR/PRESTADOR)': d.nome_emissor || '',
        'CNPJ': d.cnpj_emissor || '',
        'NUMERO DA RUBRICA - ORÇAMENTO': codigoRubrica,
        'ITEM DE CUSTO (RUBRICA)': d.rubrica || '',
        'CNAE': d.json_extraido?.cnae_prestador || '',
        'DOCUMENTO FISCAL (TIPO)': d.tipo_documento || '',
        'DISCRIMINAÇÃO DOS SERVIÇOS': d.justification || '',
        'NUMERO DOCUMENTO FISCAL': d.numero_nf || '',
        'DATA EMISSÃO DO DOCUMENTO FISCAL': _laudoFmtDate(d.data_emissao),
        'VALOR PAGAMENTO': _laudoFmtValor(d.valor_pago),
        'DATA PAGAMENTO': _laudoFmtDate(d.data_pagamento),
        'Nº DOCUMENTO (NO EXTRATO)': d.autenticacao_bancaria || '',
        'IRRF': ret.irrf || '',
        'PCC': ret.pcc || '',
        'INSS (E PATRONAL)': ret.inss || '',
        'ISS': ret.iss || '',
        'STATUS': _laudoMapStatus(d.status),
        'MOTIVO TÉCNICO': d.just_erro || '',
    };
}

async function _laudoFetchRubricaMap(projectId, orgId) {
    const { data: rubricas } = await supabaseClient
        .from('rubricas')
        .select('codigo, nome')
        .eq('project_id', projectId)
        .eq('organization_id', orgId);
    const rubricaMap = {};
    (rubricas || []).forEach(r => {
        if (r.nome) rubricaMap[r.nome.toLowerCase().trim()] = r.codigo || '';
    });
    return rubricaMap;
}

function _laudoWriteXlsx(rows, filename) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = LAUDO_COL_WIDTHS;
    XLSX.utils.book_append_sheet(wb, ws, 'Conformidade');
    XLSX.writeFile(wb, filename);
}

function _laudoSafeName(s) {
    return String(s || '').replace(/[^a-z0-9]/gi, '_');
}

function _laudoTodayStr() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function generateLaudoExcel(projectId) {
    try {
        if (typeof XLSX === 'undefined') {
            window.showToast('Biblioteca XLSX não carregada. Recarregue a página.', 'error');
            return;
        }
        window.showToast('Gerando laudo, aguarde...', 'info');

        const project = (state.projects || []).find(p => p.id === projectId);
        const projectNome = project?.nome || projectId;
        const orgId = state.user?.app_metadata?.org_id;

        const { data: docs, error: errDocs } = await supabaseClient
            .from('documents')
            .select(LAUDO_DOC_COLUMNS)
            .eq('project_id', projectId)
            .eq('organization_id', orgId)
            .order('created_at', { ascending: true });

        if (errDocs) throw new Error(errDocs.message);
        if (!docs || docs.length === 0) {
            window.showToast('Nenhum documento encontrado para este projeto.', 'error');
            return;
        }

        const rubricaMap = await _laudoFetchRubricaMap(projectId, orgId);
        const rows = docs.map(d => _laudoBuildRow(d, rubricaMap));
        const filename = `laudo_${_laudoSafeName(projectNome)}_${_laudoTodayStr()}.xlsx`;
        _laudoWriteXlsx(rows, filename);

        window.showToast('Laudo gerado com sucesso!', 'success');
    } catch (err) {
        console.error('[LAUDO]', err);
        window.showToast('Erro ao gerar laudo: ' + err.message, 'error');
    }
}
window.generateLaudoExcel = generateLaudoExcel;

async function generateLaudoExcelDoc(documentId) {
    try {
        if (typeof XLSX === 'undefined') {
            window.showToast('Biblioteca XLSX não carregada. Recarregue a página.', 'error');
            return;
        }
        window.showToast('Gerando laudo, aguarde...', 'info');

        const orgId = state.user?.app_metadata?.org_id;

        const { data: doc, error: errDoc } = await supabaseClient
            .from('documents')
            .select(LAUDO_DOC_COLUMNS + ', project_id, numero_nf')
            .eq('id', documentId)
            .eq('organization_id', orgId)
            .maybeSingle();

        if (errDoc) throw new Error(errDoc.message);
        if (!doc) {
            window.showToast('Documento não encontrado.', 'error');
            return;
        }

        const rubricaMap = await _laudoFetchRubricaMap(doc.project_id, orgId);
        const rows = [_laudoBuildRow(doc, rubricaMap)];
        const nfTag = doc.numero_nf ? _laudoSafeName(doc.numero_nf) : 'NF';
        const filename = `laudo_${nfTag}_${_laudoTodayStr()}.xlsx`;
        _laudoWriteXlsx(rows, filename);

        window.showToast('Laudo gerado com sucesso!', 'success');
    } catch (err) {
        console.error('[LAUDO_DOC]', err);
        window.showToast('Erro ao gerar laudo: ' + err.message, 'error');
    }
}
window.generateLaudoExcelDoc = generateLaudoExcelDoc;

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
    const input = document.getElementById('rubrica-input');
    if (!input) return;

    // Trocar de projeto invalida a rubrica escolhida.
    input.value = '';
    delete input.dataset.rubricaId;
    input.placeholder = 'Carregando rubricas...';
    // Marca de qual projeto é a lista em memória, para o render() não refazer a query
    // (nem limpar o input) a cada re-render da tela de upload.
    state.uploadRubricasProjectId = projectId || null;

    if (!projectId || !supabaseClient) {
        state.rubricas_disponiveis = [];
        input.placeholder = 'Selecione o projeto primeiro...';
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('rubricas')
            .select('id, nome, rubrica_id, produto, valor_aprovado')
            .eq('project_id', projectId)
            .order('produto', { ascending: true })
            .order('rubrica_id', { ascending: true });

        if (error) throw error;

        // handleUpload resolve o texto digitado contra state.rubricas_disponiveis, que
        // é a mesma lista que o combobox exibe — lista exibida e lista consultada na
        // resolução não podem divergir, senão o vínculo falha em silêncio.
        state.rubricas_disponiveis = ordenarRubricas(data || []);

        input.placeholder = state.rubricas_disponiveis.length > 0
            ? `Digite para buscar entre ${state.rubricas_disponiveis.length} rubricas...`
            : 'Nenhuma rubrica cadastrada neste projeto';

        // Se o operador já está com o campo aberto, atualiza o painel na hora.
        if (_comboAberto() && _comboInput === input) _comboAbrir(input);
    } catch (error) {
        console.error("Erro ao carregar rubricas:", error);
        state.rubricas_disponiveis = [];
        state.uploadRubricasProjectId = null; // deixa o render() tentar de novo
        input.placeholder = 'Erro ao carregar rubricas';
    }
};

async function subirParaStorage(file, projectId, opts = {}) {
    const status = opts.status || 'processing_ocr';
    const rubrica = opts.rubrica || null;
    const tipoDocumento = opts.tipo_documento || 'nf';
    const projeto = state.projects.find(p => p.id === projectId);

    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt} `;
    const filePath = `${state.user.id}/${fileName}`;

    const { error: uploadError } = await supabaseClient.storage
        .from('documentos')
        .upload(filePath, file);
    if (uploadError) throw uploadError;

    const { data: dbData, error: dbError } = await supabaseClient
        .from('documents')
        .insert({
            user_id: state.user.id,
            project_id: projectId,
            name: file.name,
            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
            file_path: filePath,
            status: status,
            tipo_documento: tipoDocumento,
            rubrica: rubrica,
            rubrica_id_fk: opts.rubrica_id_fk || null,
            organization_id: projeto?.organization_id || null
        })
        .select()
        .single();
    if (dbError) throw dbError;

    return dbData;
}

// Devolve a promise do fetch para quem precisar aguardar (processamento
// sequencial de lote); as chamadas existentes continuam fire-and-forget, porque
// nada as obriga a usar o retorno.
function dispararOcr(documentId, filePath) {
    if (!CONFIG.N8N_WEBHOOK_URL) return Promise.resolve();
    console.log("Tentando notificar n8n em:", CONFIG.N8N_WEBHOOK_URL);
    return fetch(CONFIG.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        mode: 'cors',
        body: JSON.stringify({
            document_id: documentId,
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

window.handleUpload = async function (file) {
    const projectId = document.getElementById('project-selector').value;
    const rubricaInput = document.getElementById('rubrica-input') ? document.getElementById('rubrica-input').value : null;

    if (!file || !projectId) return alert("Selecione um projeto e um arquivo PDF!");

    let rubricaIdFk = null;
    let rubricaTexto = rubricaInput;
    if (rubricaInput) {
        const r = resolverRubricaPorRotulo(rubricaInput, state.rubricas_disponiveis);
        if (!r) {
            // Falhar aqui em vez de subir a nota sem rubrica_id_fk: sem o vínculo a
            // nota entra no fluxo apontando para lugar nenhum, e isso passa em silêncio.
            return alert('Rubrica não encontrada ou ambígua. Selecione uma opção da lista (o produto aparece no início de cada item).');
        }
        rubricaIdFk = r.id;
        rubricaTexto = r.nome;
    }

    state.loading = true;
    render();

    try {
        const dbData = await subirParaStorage(file, projectId, {
            status: 'processing_ocr',
            rubrica: rubricaTexto || null,
            rubrica_id_fk: rubricaIdFk,
            tipo_documento: 'nf'
        });
        dispararOcr(dbData.id, dbData.file_path);

        alert("Upload concluído! A IA está processando seu documento...");
        window.navigate('dashboard');
    } catch (error) {
        alert("Erro no upload: " + error.message);
    } finally {
        state.loading = false;
        render();
    }
};

async function fetchRubricasDisponiveis(projectId) {
    // state.rubricas_disponiveis é compartilhado entre as telas; sempre registrar de
    // qual projeto é a lista, senão a tela de upload reaproveita rubricas de outro.
    state.uploadRubricasProjectId = projectId || null;
    if (!supabaseClient || !projectId) {
        state.rubricas_disponiveis = [];
        return;
    }
    // produto e valor_aprovado entram no rótulo para distinguir rubricas homônimas.
    const { data, error } = await supabaseClient
        .from('rubricas')
        .select('id, nome, rubrica_id, produto, valor_aprovado')
        .eq('project_id', projectId)
        .order('produto', { ascending: true })
        .order('rubrica_id', { ascending: true });
    if (error) {
        console.error("Erro fetchRubricasDisponiveis:", error);
        state.rubricas_disponiveis = [];
        return;
    }
    state.rubricas_disponiveis = ordenarRubricas(data || []);
}

async function fetchUploadLoteQueue() {
    if (!supabaseClient || !state.user) return;
    const { data, error } = await supabaseClient
        .from('documents')
        .select('*')
        .eq('user_id', state.user.id)
        .eq('status', 'aguardando_rubrica')
        .order('name', { ascending: true });
    if (error) {
        console.error("Erro fetchUploadLoteQueue:", error);
        return;
    }
    state.uploadLoteQueue = data || [];
}
window.fetchUploadLoteQueue = fetchUploadLoteQueue;

window.handleLoteProjectChange = async function (projectId) {
    state.filters.project = projectId;
    await Promise.all([
        fetchRubricasDisponiveis(projectId),
        // Restaura do banco em vez de só zerar: outro projeto pode ter um
        // vínculo próprio ativo de uma sessão anterior.
        fetchExtratoLoteVinculado(projectId),
    ]);
    render();
};

// Restaura state.loteExtratoVinculado a partir do banco — é o que faz o vínculo
// sobreviver a F5, troca de aba prolongada ou expiração de sessão. Só restaura
// se ainda houver algo pendente na fila deste projeto: uma vez que o lote é
// totalmente processado, um vínculo antigo esquecido no banco não deve
// "vazar" para um lote novo e diferente que o usuário monte semanas depois.
async function fetchExtratoLoteVinculado(projectId) {
    state.loteExtratoVinculado = null;
    if (!supabaseClient || !projectId || !state.user) return;

    const filaDoProjeto = (state.uploadLoteQueue || []).filter(d => d.project_id === projectId);
    if (filaDoProjeto.length === 0) return;

    const { data, error } = await supabaseClient
        .from('extratos')
        .select('id, file_path')
        .eq('project_id', projectId)
        .eq('user_id', state.user.id)
        .eq('vinculo_lote_ativo', true)
        .limit(1)
        .maybeSingle();

    if (error) { console.error('[fetchExtratoLoteVinculado]', error); return; }
    if (!data) return;

    state.loteExtratoVinculado = {
        id: data.id,
        nome: (data.file_path || '').split('/').pop() || 'extrato',
        projectId
    };
}

// Extrato do lote: sobe o arquivo e cria a linha em `extratos` — SEM disparar
// nenhum parse agora. O extrato sobe ANTES das notas do lote existirem, então
// qualquer workflow de "buscar candidatos pendentes" neste momento acharia
// zero itens (e no n8n, nodes com zero itens de entrada simplesmente não
// executam os seguintes — sem erro nenhum, silenciosamente). O arquivo e a
// linha em `extratos` só servem aqui como referência: quando cada nota do
// lote terminar a auditoria, tentarConciliacaoAutoLote() dispara a MESMA
// chamada do fluxo manual (handleUploadExtrato) para aquela nota específica,
// reaproveitando este file_path — sem reenviar o arquivo nem parsear de novo
// aqui.
window.handleUploadExtratoParaLote = async function (file) {
    if (!file) return;
    const projectId = document.getElementById('lote-project-selector')?.value;
    if (!projectId) return alert('Selecione um projeto primeiro.');

    const formato = file.name.split('.').pop().toLowerCase();
    if (!['ofx', 'csv', 'pdf'].includes(formato)) {
        return alert('Extrato deve ser OFX, CSV ou PDF.');
    }

    state.loading = true;
    render();

    try {
        const fileUuid = (crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const safeName = file.name.normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `${projectId}/${fileUuid}/${safeName}`;

        const { error: upErr } = await supabaseClient.storage
            .from('documentos').upload(filePath, file);
        if (upErr) throw upErr;

        // Desmarca qualquer vínculo ativo anterior deste projeto+usuário ANTES de
        // criar o novo — só um extrato pode ser "o vínculo do lote" por vez,
        // senão fetchExtratoLoteVinculado() acharia mais de uma linha.
        const { error: unsetErr } = await supabaseClient
            .from('extratos')
            .update({ vinculo_lote_ativo: false })
            .eq('project_id', projectId)
            .eq('user_id', state.user.id)
            .eq('vinculo_lote_ativo', true);
        if (unsetErr) throw unsetErr;

        // Colunas conferidas no banco: extratos usa user_id (NOT NULL),
        // não `enviado_por`. organization_id é opcional.
        //
        // vinculo_lote_ativo:true é o que faz este vínculo sobreviver a um F5:
        // sem persistir no banco, um reload entre "subir extrato" e "Processar
        // Todos" apaga o vínculo em silêncio (extrato_origem_id grava null sem
        // erro nem aviso) — era exatamente esse o bug relatado em produção.
        const { data: extrato, error: insErr } = await supabaseClient
            .from('extratos')
            .insert({
                project_id: projectId,
                user_id: state.user.id,
                organization_id: state.user?.app_metadata?.org_id || null,
                file_path: filePath,
                formato: formato,
                status: 'pendente', // o workflow de parse muda para 'processado' ou 'erro'
                vinculo_lote_ativo: true
            })
            .select('id')
            .single();
        if (insErr) throw insErr;

        state.loteExtratoVinculado = { id: extrato.id, nome: file.name, projectId };
        showToast('Extrato vinculado ao lote. As notas processadas abaixo serão conciliadas automaticamente contra ele.', 'success');
    } catch (e) {
        showToast('Erro ao subir extrato: ' + e.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleRemoverExtratoLote = async function () {
    // Desfaz também no banco — sem isso, um F5 logo depois de "Trocar" faria
    // fetchExtratoLoteVinculado() reencontrar o vínculo removido e restaurá-lo.
    // NÃO apaga o extrato já criado (pode ser reaproveitado); só desmarca a flag.
    // "Trocar" cria um extrato novo no próximo upload.
    const vinc = state.loteExtratoVinculado;
    state.loteExtratoVinculado = null;
    render();

    if (vinc && supabaseClient) {
        const { error } = await supabaseClient
            .from('extratos')
            .update({ vinculo_lote_ativo: false })
            .eq('id', vinc.id);
        if (error) console.error('[handleRemoverExtratoLote]', error);
    }
};

// Só carimba o extrato em documentos do MESMO projeto do extrato: a fila de
// lote é filtrada por usuário e status, não por projeto (fetchUploadLoteQueue),
// então pode conter arquivos de outro projeto.
function extratoOrigemPara(doc) {
    const vinc = state.loteExtratoVinculado;
    if (!vinc) return null;
    return doc.project_id === vinc.projectId ? vinc.id : null;
}

window.handleLoteFilesSelected = async function (fileList) {
    const projectId = document.getElementById('lote-project-selector').value;
    if (!projectId) return alert("Selecione um projeto primeiro!");
    if (!fileList || fileList.length === 0) return;

    const arquivos = Array.from(fileList);
    state.loading = true;
    render();

    const resultados = await Promise.allSettled(
        arquivos.map(file => subirParaStorage(file, projectId, {
            status: 'aguardando_rubrica',
            rubrica: null,
            tipo_documento: 'nf'
        }))
    );

    const sucessos = resultados.filter(r => r.status === 'fulfilled').length;
    const falhas = resultados.length - sucessos;

    if (sucessos > 0) showToast(`${sucessos} arquivo(s) adicionado(s) à fila.`, 'success');
    if (falhas > 0) {
        const primeiraFalha = resultados.find(r => r.status === 'rejected');
        showToast(`${falhas} arquivo(s) falharam: ${primeiraFalha.reason?.message || 'erro desconhecido'}`, 'error');
    }

    await fetchUploadLoteQueue();
    state.loading = false;
    render();
};

window.handleProcessarLoteItem = async function (documentId) {
    const input = document.getElementById(`lote-rubrica-${documentId}`);
    const rubricaInput = input ? input.value.trim() : '';
    if (!rubricaInput) return alert("Escolha a rubrica antes de processar.");

    const rubricaResolvida = resolverRubricaPorRotulo(rubricaInput, state.rubricas_disponiveis);
    if (!rubricaResolvida) {
        return alert('Rubrica não encontrada ou ambígua. Selecione uma opção da lista (o produto aparece no início de cada item).');
    }
    const rubricaIdFk = rubricaResolvida.id;
    const rubricaTexto = rubricaResolvida.nome;

    const doc = state.uploadLoteQueue.find(d => d.id === documentId);
    if (!doc) return;

    state.loading = true;
    render();

    try {
        const { error } = await supabaseClient
            .from('documents')
            .update({
                rubrica: rubricaTexto,
                rubrica_id_fk: rubricaIdFk,
                status: 'processing_ocr',
                extrato_origem_id: extratoOrigemPara(doc)
            })
            .eq('id', documentId);
        if (error) throw error;

        dispararOcr(documentId, doc.file_path);

        showToast(`"${doc.name}" enviado para processamento.`, 'success');
        await fetchUploadLoteQueue();
    } catch (err) {
        showToast("Erro ao processar: " + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleProcessarTodosLote = async function () {
    const itensComRubrica = state.uploadLoteQueue
        .map(doc => {
            const input = document.getElementById(`lote-rubrica-${doc.id}`);
            const rubricaInput = input ? input.value.trim() : '';
            
            const r = resolverRubricaPorRotulo(rubricaInput, state.rubricas_disponiveis);
            return {
                doc,
                rubricaTexto: r ? r.nome : rubricaInput,
                rubricaIdFk: r ? r.id : null,
                hasInput: !!rubricaInput,
                resolvida: !!r
            };
        })
        .filter(x => x.hasInput);

    if (itensComRubrica.length === 0) {
        return alert("Preencha a rubrica em pelo menos um arquivo.");
    }

    // Nenhum item sobe sem rubrica_id_fk — um vínculo nulo aqui só apareceria muito
    // depois, na conciliação, sem pista de onde veio.
    const naoResolvidos = itensComRubrica.filter(x => !x.resolvida);
    if (naoResolvidos.length > 0) {
        return alert(
            'Rubrica não encontrada ou ambígua em:\n\n' +
            naoResolvidos.map(x => `• ${x.doc.name}`).join('\n') +
            '\n\nSelecione uma opção da lista (o produto aparece no início de cada item).'
        );
    }

    if (!confirm(`Processar ${itensComRubrica.length} documento(s)?`)) return;

    state.loading = true;
    render();

    // Sequencial, não Promise.allSettled: documentos do mesmo lote (mesmo extrato)
    // disparados em paralelo corriam risco de corrida na conciliação — o n8n busca
    // "candidatos pendentes" contra o mesmo extrato, e dois documentos concluindo
    // ao mesmo tempo podiam competir pelo mesmo lançamento. Um por vez, aguardando
    // o disparo ao n8n antes do próximo, elimina a corrida.
    let sucessos = 0, falhas = 0;
    for (const { doc, rubricaTexto, rubricaIdFk } of itensComRubrica) {
        try {
            const { error } = await supabaseClient
                .from('documents')
                .update({
                    rubrica: rubricaTexto,
                    rubrica_id_fk: rubricaIdFk,
                    status: 'processing_ocr',
                    extrato_origem_id: extratoOrigemPara(doc)
                })
                .eq('id', doc.id);
            if (error) throw error;
            await dispararOcr(doc.id, doc.file_path);
            sucessos++;
        } catch (err) {
            console.error('[handleProcessarTodosLote]', doc.id, err);
            falhas++;
        }
    }

    if (sucessos > 0) showToast(`${sucessos} documento(s) enviados para processamento.`, 'success');
    if (falhas > 0) showToast(`${falhas} falharam.`, 'error');

    await fetchUploadLoteQueue();
    state.loading = false;
    render();
};

window.handleExcluirLoteItem = async function (documentId, filePath) {
    if (!confirm("Excluir este arquivo da fila? Esta ação não pode ser desfeita.")) return;

    state.loading = true;
    render();

    try {
        const { error: storageError } = await supabaseClient.storage
            .from('documentos')
            .remove([filePath]);
        if (storageError && storageError.message !== 'Object not found') throw storageError;

        const { error: dbError } = await supabaseClient
            .from('documents')
            .delete()
            .eq('id', documentId);
        if (dbError) throw dbError;

        showToast("Arquivo removido da fila.", 'success');
        await fetchUploadLoteQueue();
    } catch (err) {
        showToast("Erro ao excluir: " + err.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

window.handleEnviarSalic = async function (documentId) {
    if (!supabaseClient || !state.user) return;

    // Defesa em profundidade: o botão já fica desabilitado nesse caso, mas
    // isso cobre disparo direto via console/replay de request.
    const docParaValidar = state.currentDocument;
    const camposFaltandoSalic = docParaValidar ? [
        !docParaValidar.cnpj_emissor && 'CNPJ/CPF',
        !docParaValidar.nome_emissor && 'Fornecedor',
        (!docParaValidar.valor || Number(docParaValidar.valor) === 0) && 'Valor',
        !docParaValidar.data_emissao && 'Data de Emissão',
        !docParaValidar.numero_nf && 'Nr. Comprovante',
    ].filter(Boolean) : [];
    if (camposFaltandoSalic.length > 0) {
        showToast(`Faltam dados obrigatórios para enviar ao SALIC: ${camposFaltandoSalic.join(', ')}.`, 'error');
        return;
    }

    state.loading = true;
    state.isSalicRunning = true;
    render();
    showToast("Subindo ao SALIC, aguarde até terminar...", 'info');

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

        // Validação IN 23/2025 antes do envio ao SALIC
        const [
            { data: rubricasProjeto },
            { data: projFinanc },
            { data: docsConferidos },
        ] = await Promise.all([
            supabaseClient.from('rubricas').select('nome, codigo, categoria, valor_utilizado').eq('project_id', doc.project_id),
            supabaseClient.from('projects').select('valor_aprovado, valor_captado').eq('id', doc.project_id).single(),
            supabaseClient.from('documents').select('nome_emissor, cnpj_emissor, valor').eq('project_id', doc.project_id).in('status', ['liberado_rpa_airtop', 'enviado_salic', 'concluido']),
        ]);

        /* IN23-DISABLED: bloqueio de envio por IN23 desativado — Reativar quando gestão de saldo implementada
        const vProjeto = parseFloat(projFinanc?.valor_aprovado) || 0;
        const vCaptado = parseFloat(projFinanc?.valor_captado)  || 0;
        const regrasIN23 = calcularRegrasIN23(rubricasProjeto, vProjeto, vCaptado, docsConferidos);

        const errosIN23 = regrasIN23.filter(r => ['R001', 'R002', 'R003'].includes(r.id) && r.status === 'excedido');
        if (errosIN23.length > 0) {
            const msgs = errosIN23.map(r => `${r.label} (${r.percentual}% do limite)`).join('; ');
            showToast(`Envio bloqueado — IN 23/2025: ${msgs}`, 'error');
            return;
        }

        const avisosIN23 = regrasIN23.filter(r => ['R004', 'R005'].includes(r.id) && r.status === 'excedido');
        if (avisosIN23.length > 0) {
            showToast(`Atenção IN 23/2025: ${avisosIN23.map(r => r.label).join(', ')} acima do recomendado`, 'warning');
        }
        */

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
        state.isSalicRunning = false;
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

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 2rem;">
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


// ─── Ferramentas ─────────────────────────────────────────────────────────────

const FerramentasView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <h1>Ferramentas</h1>
        <p class="page-subtitle">Utilitários para facilitar seu trabalho no Prestaí.</p>
    </header>

    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem;">
        <div class="card" style="cursor: pointer; transition: box-shadow 0.2s;" onclick="window.navigate('ferramentas_juntar_pdf')">
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                <div style="width: 48px; height: 48px; background: #eff6ff; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i data-lucide="file-stack" style="width: 24px; height: 24px; color: var(--primary);"></i>
                </div>
                <div>
                    <h3 class="h2">Consolidar PDFs</h3>
                    <p class="text-xs" style="color: var(--text-muted);">PDF, PNG e JPG em um único PDF</p>
                </div>
            </div>
            <p class="text-sm" style="color: var(--text-secondary); margin-bottom: 1.5rem;">Combine múltiplos arquivos PDF, PNG e JPG em um único PDF, direto no navegador — sem servidor.</p>
            <button class="btn btn-primary" style="width: 100%;" onclick="event.stopPropagation(); window.navigate('ferramentas_juntar_pdf')">
                Abrir ferramenta
            </button>
        </div>
    </div>
</main>
`;

function juntarPDFBodyHTML() {
    return `
    <div id="juntar-drop-zone"
         style="border: 2px dashed var(--border-color); border-radius: var(--radius); padding: 3rem 2rem; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s; background: var(--bg-card); margin-bottom: 1.5rem;"
         ondragover="event.preventDefault(); this.style.borderColor='var(--primary)'; this.style.background='#eff6ff';"
         ondragleave="this.style.borderColor=''; this.style.background='';"
         ondrop="event.preventDefault(); this.style.borderColor=''; this.style.background=''; window.handleJuntarPdfDrop(event);"
         onclick="window.handleJuntarPdfSelectFiles()">
        <i data-lucide="upload-cloud" style="width: 48px; height: 48px; color: var(--primary); margin-bottom: 1rem;"></i>
        <p style="font-weight: 600; margin-bottom: 0.5rem;">Arraste arquivos aqui ou clique para selecionar</p>
        <p class="text-xs" style="color: var(--text-muted);">Aceita: PDF, PNG, JPG, JPEG &bull; Máximo 10 MB por arquivo &bull; Até 20 arquivos</p>
    </div>
    <input type="file" id="juntar-pdf-input" multiple accept=".pdf,.png,.jpg,.jpeg" style="display: none;" onchange="window.handleJuntarPdfInputChange(event)">

    ${state.juntarPdfFiles.length > 0 ? `
    <div class="card" style="margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3 class="h2">${state.juntarPdfFiles.length} arquivo${state.juntarPdfFiles.length !== 1 ? 's' : ''} adicionado${state.juntarPdfFiles.length !== 1 ? 's' : ''}</h3>
            <p class="text-xs" style="color: var(--text-muted);">Arraste as linhas para reordenar</p>
        </div>
        <div id="juntar-pdf-list">
            ${state.juntarPdfFiles.map((file, i) => {
                const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
                const icon = isPdf ? 'file-text' : 'image';
                const iconColor = isPdf ? 'var(--primary)' : '#f59e0b';
                const size = file.size < 1024 * 1024
                    ? (file.size / 1024).toFixed(1) + ' KB'
                    : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
                return `<div class="juntar-pdf-item"
                     draggable="true"
                     ondragstart="window.juntarPdfDragStart(event, ${i})"
                     ondragover="event.preventDefault(); document.querySelectorAll('.juntar-pdf-item').forEach((el,idx)=>{ el.style.background = idx===${i} ? 'var(--bg-sidebar)' : ''; });"
                     ondragleave="this.style.background='';"
                     ondrop="event.preventDefault(); document.querySelectorAll('.juntar-pdf-item').forEach(el=>el.style.background=''); window.juntarPdfDropReorder(event, ${i});"
                     ondragend="window.juntarPdfDragEnd();"
                     style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-bottom: 1px solid var(--border-subtle); cursor: grab; transition: background 0.15s; user-select: none;">
                    <i data-lucide="grip-vertical" style="width: 16px; color: var(--text-muted); flex-shrink: 0;"></i>
                    <i data-lucide="${icon}" style="width: 18px; color: ${iconColor}; flex-shrink: 0;"></i>
                    <span style="flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${file.name}">${file.name}</span>
                    <span class="text-xs" style="color: var(--text-muted); flex-shrink: 0;">${size}</span>
                    <button class="btn btn-secondary" style="padding: 4px 8px; flex-shrink: 0; color: var(--error);" onclick="window.handleJuntarPdfRemove(${i})">
                        <i data-lucide="x" style="width: 14px;"></i>
                    </button>
                </div>`;
            }).join('')}
        </div>
    </div>

    <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: #374151;">
            Nome do arquivo gerado
        </label>
        <div style="display: flex; align-items: center; gap: 0;">
            <input
                type="text"
                id="juntar-pdf-nome"
                placeholder="documentos_unificados"
                value="documentos_unificados"
                style="flex: 1; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px 0 0 6px; font-size: 14px; outline: none;"
            />
            <span style="padding: 8px 10px; background: #f1f5f9; border: 1px solid #e2e8f0; border-left: none; border-radius: 0 6px 6px 0; font-size: 13px; color: #64748b;">
                .pdf
            </span>
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center;">
        <button class="btn btn-secondary" onclick="window.handleJuntarPdfLimpar()">
            <i data-lucide="trash-2" style="width: 16px;"></i>
            Limpar tudo
        </button>
        <button class="btn btn-primary" onclick="window.handleGerarPDFUnificado()" ${state.juntarPdfFiles.length < 2 || state.juntarPdfLoading ? 'disabled' : ''} style="${state.juntarPdfLoading ? 'opacity: 0.75;' : ''}">
            ${state.juntarPdfLoading
                ? '<i data-lucide="loader" style="width: 16px;"></i>&nbsp;Gerando PDF...'
                : '<i data-lucide="download" style="width: 16px;"></i>&nbsp;Gerar PDF único'}
        </button>
    </div>
    ` : ''}
    `;
}

const JuntarPDFView = () => `
${Sidebar()}
<main class="main-content view-content">
    <header class="content-header">
        <div style="display: flex; align-items: center; gap: 1rem;">
            <button class="btn btn-secondary" onclick="window.navigate('ferramentas')" style="padding: 0.5rem;">
                <i data-lucide="arrow-left" style="width: 18px;"></i>
            </button>
            <div>
                <p class="text-xs" style="color: var(--text-muted); margin-bottom: 0.25rem;">
                    <span onclick="window.navigate('ferramentas')" style="cursor: pointer; color: var(--primary);">Ferramentas</span>
                    &rsaquo; Consolidar PDFs
                </p>
                <h1>Consolidar PDFs</h1>
            </div>
        </div>
    </header>

    ${juntarPDFBodyHTML()}
</main>
`;

// ─── Ferramentas — handlers ───────────────────────────────────────────────────

function refreshJuntarPdfView() {
    if (state.juntarPdfInModal) {
        const content = document.getElementById('juntar-pdf-modal-content');
        if (content) {
            content.innerHTML = juntarPDFBodyHTML();
            if (window.lucide) window.lucide.createIcons();
        }
    } else {
        render();
    }
}

function closeFerramentasModal() {
    document.getElementById('ferramentas-modal-overlay')?.remove();
    state.juntarPdfInModal = false;
}

window.openFerramentasModal = function () {
    state.juntarPdfInModal = true;

    const overlay = document.createElement('div');
    overlay.id = 'ferramentas-modal-overlay';
    overlay.style.cssText = [
        'position: fixed',
        'inset: 0',
        'background: rgba(0,0,0,0.5)',
        'z-index: 1000',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'padding: 16px',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
        'background: white',
        'border-radius: 12px',
        'width: 100%',
        'max-width: 680px',
        'max-height: 90vh',
        'overflow-y: auto',
        'display: flex',
        'flex-direction: column',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = [
        'display: flex',
        'justify-content: space-between',
        'align-items: center',
        'padding: 16px 20px',
        'border-bottom: 1px solid #e2e8f0',
        'position: sticky',
        'top: 0',
        'background: white',
        'z-index: 1',
    ].join(';');
    header.innerHTML = `
        <div>
            <span style="font-weight:600;font-size:16px">🔧 Juntar arquivos em PDF</span>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px">Após gerar o PDF, feche este painel e faça o upload normalmente</div>
        </div>
        <button onclick="closeFerramentasModal()"
            style="background:none;border:none;cursor:pointer;font-size:20px;color:#94a3b8;padding:4px 8px;border-radius:4px">✕</button>
    `;

    const content = document.createElement('div');
    content.id = 'juntar-pdf-modal-content';
    content.style.cssText = 'padding: 20px; flex: 1;';
    content.innerHTML = juntarPDFBodyHTML();

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    if (window.lucide) window.lucide.createIcons();

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFerramentasModal();
    });

    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') {
            closeFerramentasModal();
            document.removeEventListener('keydown', onEsc);
        }
    });
};

window.handleJuntarPdfDrop = function (event) {
    window.handleJuntarPdfAddFiles(Array.from(event.dataTransfer.files));
};

window.handleJuntarPdfSelectFiles = function () {
    const input = document.getElementById('juntar-pdf-input');
    if (input) input.click();
};

window.handleJuntarPdfInputChange = function (event) {
    window.handleJuntarPdfAddFiles(Array.from(event.target.files));
    event.target.value = '';
};

window.handleJuntarPdfAddFiles = function (files) {
    const TIPOS_ACEITOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    const EXT_ACEITAS = ['pdf', 'png', 'jpg', 'jpeg'];
    const MAX_TAMANHO = 10 * 1024 * 1024;
    const MAX_ARQUIVOS = 20;

    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        const tipoOk = TIPOS_ACEITOS.includes(file.type) || EXT_ACEITAS.includes(ext);
        if (!tipoOk) {
            window.showToast(`Tipo não suportado: use PDF, PNG ou JPG (${file.name})`, 'error');
            continue;
        }
        if (file.size > MAX_TAMANHO) {
            window.showToast(`Arquivo muito grande (máx 10 MB): ${file.name}`, 'error');
            continue;
        }
        if (state.juntarPdfFiles.length >= MAX_ARQUIVOS) {
            window.showToast(`Limite de ${MAX_ARQUIVOS} arquivos atingido`, 'warning');
            break;
        }
        state.juntarPdfFiles.push(file);
    }
    refreshJuntarPdfView();
};

window.handleJuntarPdfRemove = function (index) {
    state.juntarPdfFiles.splice(index, 1);
    refreshJuntarPdfView();
};

window.handleJuntarPdfLimpar = function () {
    state.juntarPdfFiles = [];
    refreshJuntarPdfView();
};

window.toggleFinanceiroGrupo = function (grupo) {
    state.financeiroGrupoAtivo = state.financeiroGrupoAtivo === grupo ? null : grupo;
    render();
};

window._juntarDragIndex = null;

window.juntarPdfDragStart = function (event, index) {
    window._juntarDragIndex = index;
    event.dataTransfer.effectAllowed = 'move';
};

window.juntarPdfDropReorder = function (event, targetIndex) {
    const fromIndex = window._juntarDragIndex;
    if (fromIndex === null || fromIndex === targetIndex) return;
    const [moved] = state.juntarPdfFiles.splice(fromIndex, 1);
    state.juntarPdfFiles.splice(targetIndex, 0, moved);
    window._juntarDragIndex = null;
    refreshJuntarPdfView();
};

window.juntarPdfDragEnd = function () {
    window._juntarDragIndex = null;
    document.querySelectorAll('.juntar-pdf-item').forEach(el => { el.style.background = ''; });
};

window.handleGerarPDFUnificado = async function () {
    if (state.juntarPdfFiles.length < 2) {
        window.showToast('Adicione pelo menos 2 arquivos para gerar o PDF.', 'warning');
        return;
    }
    if (!window.PDFLib) {
        window.showToast('PDF-lib ainda não carregou. Aguarde um momento e tente novamente.', 'error');
        return;
    }
    state.juntarPdfLoading = true;
    refreshJuntarPdfView();
    try {
        const bytes = await gerarPDFUnificado(state.juntarPdfFiles);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const inputNome = document.getElementById('juntar-pdf-nome');
        const nomeDigitado = inputNome?.value?.trim() || 'documentos_unificados';
        const nomeFinal = nomeDigitado.replace(/\.pdf$/i, '');
        a.download = nomeFinal + '.pdf';
        a.click();
        URL.revokeObjectURL(url);
        window.showToast('PDF gerado com sucesso — verifique seus downloads', 'success');
    } catch (err) {
        console.error('Erro ao gerar PDF:', err);
        window.showToast('Erro ao gerar PDF: ' + err.message, 'error');
    } finally {
        state.juntarPdfLoading = false;
        refreshJuntarPdfView();
    }
};

async function gerarPDFUnificado(arquivos) {
    const { PDFDocument } = PDFLib;
    const pdfFinal = await PDFDocument.create();

    for (const arquivo of arquivos) {
        const arrayBuffer = await arquivo.arrayBuffer();
        const tipo = arquivo.type || '';
        const nome = arquivo.name.toLowerCase();

        const isPdf = tipo === 'application/pdf' || nome.endsWith('.pdf');
        const isPng  = tipo === 'image/png'  || nome.endsWith('.png');
        const isJpg  = tipo === 'image/jpeg' || tipo === 'image/jpg' || nome.endsWith('.jpg') || nome.endsWith('.jpeg');

        if (isPdf) {
            const pdfOrigem = await PDFDocument.load(arrayBuffer);
            const paginas = await pdfFinal.copyPages(pdfOrigem, pdfOrigem.getPageIndices());
            paginas.forEach(p => pdfFinal.addPage(p));
        } else if (isPng || isJpg) {
            const img = isPng
                ? await pdfFinal.embedPng(arrayBuffer)
                : await pdfFinal.embedJpg(arrayBuffer);

            const pagina = pdfFinal.addPage([595, 842]);
            const { width, height } = img.scale(1);
            const margemH = 40;
            const margemV = 40;
            const maxW = 595 - margemH * 2;
            const maxH = 842 - margemV * 2;
            const escala = Math.min(maxW / width, maxH / height, 1);
            const w = width * escala;
            const h = height * escala;
            pagina.drawImage(img, { x: (595 - w) / 2, y: (842 - h) / 2, width: w, height: h });
        }
    }

    return await pdfFinal.save();
}

// ─────────────────────────────────────────────────────────────────────────────

function render() {
    let content = '';

    // Opção B: cadastro publico de gestor desabilitado.
    // Redireciona para login, limpa o hash (evita loop no F5) e avisa.
    if (state.currentView === 'register') {
        state.currentView = 'login';
        if (window.location.hash === '#register' || window.location.hash === '#/register') {
            window.location.hash = 'login';
        }
        setTimeout(() => window.showToast('Cadastros restritos. Solicite acesso ao administrador.', 'info'), 0);
    }

    if (!state.user && !['login', 'solicitante_login', 'solicitante_register', 'forgot_password', 'update_password'].includes(state.currentView)) {
        state.currentView = state.isSolicitanteMode ? 'solicitante_login' : 'login';
    }

    // Segurança: Bloquear solicitante de acessar rotas de gestor
    const isGestorView = !['login', 'solicitante_login', 'solicitante_register', 'solicitante_dashboard'].includes(state.currentView);
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
        case 'upload_lote':
            content = UploadLoteView();
            break;
        case 'envio_lote_salic':
            content = EnvioLoteSalicView();
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
        case 'admin_solicitantes':
            content = SolicitantesAdminView();
            break;
        case 'equipe':
            content = EquipeView();
            break;
        case 'configuracoes':
            content = ConfiguracoesView();
            break;
        case 'ferramentas':
            content = FerramentasView();
            break;
        case 'ferramentas_juntar_pdf':
            content = JuntarPDFView();
            break;
        case 'sem_acesso':
            content = SemAcessoView();
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

    // O painel do combobox é montado sob demanda, mas os inputs são recriados a cada
    // innerHTML — se um estava aberto, ele agora aponta para um elemento fora do DOM.
    if (_comboAberto() && !document.body.contains(_comboInput)) _comboFechar();

    // O <script> inline da UploadView nunca roda (app.innerHTML não executa scripts),
    // então as rubricas não eram carregadas ao entrar na tela com um projeto já
    // selecionado. Dispara aqui, depois que o DOM existe.
    if (state.currentView === 'upload') {
        const selector = document.getElementById('project-selector');
        const input = document.getElementById('rubrica-input');
        if (selector && selector.value && input) {
            if (state.uploadRubricasProjectId === selector.value) {
                // Já carregado para este projeto: só reajusta o placeholder, sem refazer
                // a query e sem limpar o que o operador já digitou.
                const total = (state.rubricas_disponiveis || []).length;
                input.placeholder = total > 0
                    ? `Digite para buscar entre ${total} rubricas...`
                    : 'Nenhuma rubrica cadastrada neste projeto';
            } else {
                window.handleProjectSelectChange(selector.value);
            }
        }
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
                } else if (state.currentView === 'dashboard') {
                    // Atualização cirúrgica do badge de status
                    const status = STATUS_MAP[payload.new.status] || { label: payload.new.status, class: 'status-pending' };
                    const badgeContainer = document.querySelector(`#doc-row-${payload.new.id} .badge`);
                    if (badgeContainer) {
                        badgeContainer.className = `badge ${status.class}`;
                        badgeContainer.innerHTML = `<span class="badge-dot"></span>${status.label}`;
                    }
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

window.toggleUploadManualExtrato = function () {
    state.mostrarUploadManualExtrato = !state.mostrarUploadManualExtrato;
    render();
};

window.handleUploadExtrato = async function (file, projectId, documentId, comprovanteId, isReplace = false) {
    if (!file || !projectId || !documentId) return alert("Houve um erro ao processar o upload do extrato.");

    const fileExt = file.name.split('.').pop().toLowerCase();
    if (!['ofx', 'csv', 'pdf'].includes(fileExt)) {
        return alert("Formato inválido! Por favor, use OFX, CSV ou PDF.");
    }

    state.loading = true;
    state.isUploadingExtrato = true;
    render();

    try {
        if (isReplace) {
            const { error: resetError } = await supabaseClient
                .from('documents')
                .update({ status: 'aguardando_conciliacao_bancaria', just_erro: null })
                .eq('id', documentId);
            if (resetError) throw resetError;
        }

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

        showToast(isReplace
            ? "Novo extrato enviado! Reprocessando a conciliação..."
            : "Extrato enviado com sucesso! O processamento e conciliação IA foram iniciados.", 'success');
        state.uploadConcluidoExtrato = true;

        // Recarrega os detalhes para mostrar o status (que será atualizado via Realtime/Fetch)
        setTimeout(() => fetchDocumentDetails(documentId), 2500);

    } catch (error) {
        showToast("Erro no extrato: " + error.message, 'error');
    } finally {
        state.loading = false;
        state.isUploadingExtrato = false;
        render();
    }
};

// Conciliação em LOTE: um extrato do período para o projeto inteiro, casado
// contra TODAS as NFs aguardando conciliação pelo workflow
// prestai-conciliation-lote (workflow separado; o fluxo 1-para-1 acima
// continua intacto). Sem nf_id/comprovante_id no payload — é a diferença.
window.handleUploadExtratoLote = async function (file, projectId) {
    if (!file) return;
    if (!projectId) return alert("Selecione um projeto antes de subir o extrato do período.");

    const fileExt = file.name.split('.').pop().toLowerCase();
    if (!['ofx', 'csv', 'pdf'].includes(fileExt)) {
        return alert("Formato inválido! Por favor, use OFX, CSV ou PDF.");
    }
    if (!CONFIG.N8N_WEBHOOK_RECONCILIATION_LOTE_URL) {
        return alert("URL do webhook de conciliação em lote não configurada.");
    }

    state.loading = true;
    render();

    try {
        const fileName = `extrato_lote_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${state.user.id}/${fileName}`;

        // 1. Upload para o Storage (mesmo bucket do fluxo 1-para-1)
        const { error: uploadError } = await supabaseClient.storage
            .from('documentos')
            .upload(filePath, file);
        if (uploadError) throw uploadError;

        // 2. Registro em extratos (mesmos campos do fluxo atual)
        const { data: extratoData, error: dbError } = await supabaseClient
            .from('extratos')
            .insert({
                project_id: projectId,
                user_id: state.user.id,
                file_path: filePath,
                formato: fileExt,
                status: 'pendente' // n8n mudará para 'processado' ou 'erro'
            })
            .select()
            .single();
        if (dbError) throw dbError;

        // 3. Webhook do lote — sem nf_id/comprovante_id
        const response = await fetch(CONFIG.N8N_WEBHOOK_RECONCILIATION_LOTE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            mode: 'cors',
            body: JSON.stringify({
                extrato_id: extratoData.id,
                project_id: projectId,
                file_path: filePath,
                bucket: 'documentos'
            })
        });
        if (!response.ok) {
            throw new Error(`O servidor n8n retornou erro: ${response.status} ${response.statusText}`);
        }

        showToast("Extrato enviado! Conciliando contra todas as notas pendentes do projeto...", 'success');

        // Não há nota única para detalhar — recarrega a lista para refletir
        // os status novos quando o workflow terminar.
        setTimeout(() => { fetchDocuments().then(render); }, 3000);
    } catch (error) {
        showToast("Erro no extrato em lote: " + error.message, 'error');
    } finally {
        state.loading = false;
        render();
    }
};

// Initial render and setup
async function init() {
    // Listeners delegados do combobox de rubricas — registrados uma vez só, antes de
    // qualquer render, porque os inputs são recriados a cada app.innerHTML.
    inicializarComboRubricas();

    // Chegada vinda de um botão "Sair" de qualquer módulo. Precisa ser tratada
    // ANTES do getSession(): se sobrar qualquer resquício de sessão, o roteamento
    // abaixo mandaria de volta ao module-selector.html — que é exatamente o bug de
    // o "Sair" do M2/M3 devolver o usuário ao seletor em vez da tela de login.
    if (window.location.search.includes('logout=1')) {
        if (supabaseClient) {
            try { await supabaseClient.auth.signOut(); } catch (_) { }
        }
        if (window.prestaiPurgarSessaoLocal) window.prestaiPurgarSessaoLocal();
        state.user = null;
        state.userStatus = null;
        state.currentView = 'login';
        // Tira o ?logout=1 da barra para o F5 não repetir o fluxo de saída.
        try { history.replaceState(null, '', window.location.pathname + '#login'); } catch (_) { }
        render();
        return;
    }

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
            const role = getUserRole();
            state.userStatus = role || 'gestor';

            // Antes de qualquer roteamento por role: os guards do seletor, do M2
            // e do M3 mandam para cá quem ainda deve a troca de senha, então
            // esta checagem precisa vir antes de qualquer redirect de volta.
            if (session.user?.app_metadata?.must_change_password === true) {
                state.forcarTrocaSenha = true;
                state.currentView = 'update_password';
                render();
                return;
            }

            // Carregar dados iniciais baseados na role, ignorando isSolicitanteMode da URL se logado
            if (role === 'fornecedor') {
                state.currentView = 'solicitante_dashboard';
                await fetchSolicitanteDashboard();
            } else if (role === 'operador') {
                // Operador não tem área no M1 — o seletor o redireciona ao M3.
                window.location.href = 'module-selector.html';
                return;
            } else if (role && !['gestor', 'admin', 'analista'].includes(role)) {
                // Contas sem role (legado) continuam tratadas como gestor.
                // Roles reconhecidas sem área própria caem aqui.
                state.currentView = 'sem_acesso';
            } else {
                const hash = window.location.hash.replace('#', '');
                if (!hash || hash === 'login' || hash === 'register') {
                    // Sessão ativa sem destino explícito: o seletor de módulos é
                    // sempre a primeira tela. Vir do seletor traz #dashboard etc.
                    window.location.href = 'module-selector.html';
                    return;
                }
                state.currentView = hash;
                await fetchProjects();
                await fetchDocuments();

                // Carrega a fila do SALIC persistida
                carregarFilaSalic();
                const pendingCount = state.salicLoteQueue.filter(item => item.status === 'pending').length;
                if (pendingCount > 0) {
                    state.currentView = 'envio_lote_salic';
                    setTimeout(() => {
                        showToast(`Você tem um envio em lote do SALIC pendente (${pendingCount} documentos).`, 'warning');
                    }, 1000);
                }
            }
        }
    }
    render();
    setupRealtime();
}

init();
