// Fila interna da conciliação de notas de lote (documents.extrato_origem_id): lógica pura, sem
// banco e sem rede, para testar em isolamento (ver teste-fila-conciliacao.js). O server.js usa
// daqui na rota POST /api/m1/cron-conciliacao-lote.
//
// A fila é o próprio cron de 1 minuto: cada rodada pega as notas elegíveis, na ordem, e envia UMA
// por vez ao webhook prestai-conciliation (1 nota x 1 extrato), esperando o retorno de cada uma
// antes de enviar a próxima. Entre o início de um envio e o do seguinte passam pelo menos
// INTERVALO_MS. O que não couber no orçamento da rodada fica para a rodada seguinte.
const STATUS_ELEGIVEIS = ['aguardando_comprovante', 'aguardando_conciliacao_bancaria'];

// Espaçamento mínimo entre o INÍCIO de um envio e o do próximo.
const INTERVALO_MS = 6000;

// Prazo para uma nota nova começar dentro da rodada. A rodada é uma função com limite de 300 s:
// um envio que começa no último instante ainda espera até 180 s pelo n8n (100 s + 180 s < 300 s).
const ORCAMENTO_MS = 100000;

// Quanto a nota precisa estar parada no status antes de a fila pegá-la. Padrão curto: o
// navegador não dispara mais o webhook, então a espera só serve para o status "assentar".
const CARENCIA_PADRAO_MS = 30 * 1000;

// Uma nota com marcador de início e sem evento de fim é tratada como "em andamento" por este
// tempo: a espera máxima do envio (180 s) mais uma margem. Passado isso, o n8n já deve ter
// terminado ou desistido, e as outras notas do mesmo extrato podem seguir.
const JANELA_EM_ANDAMENTO_MS = 200 * 1000;

const ACAO_INICIO = 'conciliacao_auto_lote_inicio';
const ACAO_FIM = 'conciliacao_auto_lote';

// Lê a carência de uma variável de ambiente (texto em milissegundos). Valor ausente, não
// numérico ou negativo cai no padrão: uma configuração errada não pode parar nem acelerar a fila.
function lerCarenciaMs(valor, padrao = CARENCIA_PADRAO_MS) {
    if (valor == null || String(valor).trim() === '') return padrao;
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : padrao;
}

const tempo = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// Notas que a fila pode pegar, na ordem de envio: status elegível, extrato de origem preenchido
// e parada há pelo menos a carência. Ordem por extrato e, dentro dele, da mais antiga para a mais
// nova (updated_at); empate por id, para a ordem ser sempre a mesma.
function elegiveis(notas, { agoraMs, carenciaMs, statuses = STATUS_ELEGIVEIS }) {
    const limite = agoraMs - carenciaMs;
    return (notas || [])
        .filter(n => statuses.includes(n.status) && n.extrato_origem_id != null && tempo(n.updated_at) < limite)
        .sort((a, b) => {
            if (a.extrato_origem_id !== b.extrato_origem_id) return String(a.extrato_origem_id) < String(b.extrato_origem_id) ? -1 : 1;
            const d = tempo(a.updated_at) - tempo(b.updated_at);
            if (d !== 0) return d;
            return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
        });
}

// Marcador de início da nota nesta "chegada" ao status: o mais recente que seja mais novo que
// documents.updated_at. Sem ele, a nota ainda não foi tentada desde que chegou.
function ultimoMarcador(nota, eventos) {
    const chegada = tempo(nota.updated_at);
    let melhor = null;
    for (const e of eventos || []) {
        if (e.registro_id !== nota.id || e.acao !== ACAO_INICIO) continue;
        const t = tempo(e.criado_em);
        if (t > chegada && (melhor === null || t > melhor)) melhor = t;
    }
    return melhor;
}

// Notas ainda não tentadas desde que chegaram ao status (cada nota é tentada uma vez por chegada).
function pendentes(notas, eventos) {
    return (notas || []).filter(n => ultimoMarcador(n, eventos) === null);
}

// Extratos com uma nota em andamento: marcador de início dentro da janela e sem evento de fim
// depois dele. A fila não começa outra nota desses extratos, nem em outra rodada nem em outra
// instância do servidor, para duas notas do mesmo extrato nunca disputarem o mesmo lançamento.
function extratosOcupados(notas, eventos, { agoraMs, janelaMs = JANELA_EM_ANDAMENTO_MS }) {
    const ocupados = new Set();
    for (const n of notas || []) {
        const inicio = ultimoMarcador(n, eventos);
        if (inicio === null || agoraMs - inicio >= janelaMs) continue;
        const terminou = (eventos || []).some(e => e.registro_id === n.id && e.acao === ACAO_FIM && tempo(e.criado_em) >= inicio);
        if (!terminou) ocupados.add(n.extrato_origem_id);
    }
    return ocupados;
}

// Quanto esperar antes de enviar a próxima nota, contando do início do envio anterior. Nunca
// negativo: se o anterior demorou mais que o intervalo, a próxima sai logo em seguida. Sem envio
// anterior, não há o que esperar.
function esperaProximoEnvio({ inicioAnteriorMs, agoraMs, intervaloMs = INTERVALO_MS }) {
    if (inicioAnteriorMs == null) return 0;
    return Math.max(0, intervaloMs - (agoraMs - inicioAnteriorMs));
}

// O início previsto de uma nota cabe no orçamento da rodada?
function cabeNaRodada({ inicioRodadaMs, inicioPrevistoMs, orcamentoMs = ORCAMENTO_MS }) {
    return inicioPrevistoMs - inicioRodadaMs <= orcamentoMs;
}

// Percorre as notas uma a uma. enviar(item) devolve { enviado, ok }:
//  - enviado=false: nada foi mandado ao webhook (ex.: extrato sem arquivo); não conta para o
//    espaçamento nem consome a espera da próxima;
//  - enviado=true: o webhook foi chamado; enviar só devolve quando ele responde (ou estoura o
//    tempo), então o laço nunca tem dois envios ao mesmo tempo.
// Uma falha (exceção) de uma nota não interrompe as demais. O laço para quando o início previsto
// da próxima não cabe mais no orçamento; as que sobram voltam em naoProcessados.
async function executarFila({ itens, enviar, agora, dormir, intervaloMs = INTERVALO_MS, orcamentoMs = ORCAMENTO_MS }) {
    const inicioRodadaMs = agora();
    let inicioAnteriorMs = null;
    const resultados = [];
    let indice = 0;
    for (; indice < itens.length; indice++) {
        const item = itens[indice];
        const espera = esperaProximoEnvio({ inicioAnteriorMs, agoraMs: agora(), intervaloMs });
        if (!cabeNaRodada({ inicioRodadaMs, inicioPrevistoMs: agora() + espera, orcamentoMs })) break;
        if (espera > 0) await dormir(espera);
        const inicioMs = agora();
        let r;
        try {
            r = await enviar(item);
        } catch (e) {
            r = { enviado: true, ok: false, erro: e && e.message ? e.message : String(e) };
        }
        if (r && r.enviado) inicioAnteriorMs = inicioMs;
        resultados.push({ item, inicioMs, enviado: !!(r && r.enviado), ok: !!(r && r.ok), erro: r && r.erro });
    }
    return { resultados, naoProcessados: itens.slice(indice) };
}

module.exports = {
    STATUS_ELEGIVEIS, INTERVALO_MS, ORCAMENTO_MS, CARENCIA_PADRAO_MS, JANELA_EM_ANDAMENTO_MS, ACAO_INICIO, ACAO_FIM,
    lerCarenciaMs, elegiveis, ultimoMarcador, pendentes, extratosOcupados, esperaProximoEnvio, cabeNaRodada, executarFila
};
