/**
 * Pareamento linha do relatório SALIC <-> rubrica do PrestAI.
 * CR-2026-001 Fase 1. Roda no worker logo após a captura inserir as
 * linhas — ver ordem de níveis no PROMPT FASE 0+1, seção 1.2.
 */

function normalizar(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * @param {Object} supabase - client com service_role (mesmo do server.js)
 * @param {Object} params - { projectId, organizationId, capturaId, linhas }
 * @returns {Promise<{ total: number, pareadas: number, fila: number }>}
 */
async function parearLinhas(supabase, { projectId, organizationId, capturaId, linhas }) {
    const { data: rubricas, error: rubricasErr } = await supabase
        .from('rubricas')
        .select('id, nome, etapa, valor_aprovado')
        .eq('project_id', projectId);
    if (rubricasErr) throw rubricasErr;

    const { data: vinculos, error: vinculosErr } = await supabase
        .from('saldo_salic_vinculos')
        .select('chave_etapa, chave_item, chave_vl_programado, rubrica_id')
        .eq('project_id', projectId);
    if (vinculosErr) throw vinculosErr;

    const chaveVinculo = (etapa, item, valor) =>
        `${normalizar(etapa)}|${normalizar(item)}|${Number(valor)}`;

    const vinculoMap = new Map(
        (vinculos || []).map(v => [chaveVinculo(v.chave_etapa, v.chave_item, v.chave_vl_programado), v.rubrica_id])
    );

    const resultados = [];
    const novosVinculos = [];

    for (const linha of linhas) {
        const etapaNorm = normalizar(linha.etapa);
        const itemNorm = normalizar(linha.item);
        let rubricaId = null;
        let nivel = null;

        // Nível 0: vínculo memorizado de uma conferência manual anterior
        if (linha.vl_programado != null) {
            const chave = chaveVinculo(linha.etapa, linha.item, linha.vl_programado);
            if (vinculoMap.has(chave)) {
                rubricaId = vinculoMap.get(chave);
                nivel = 0;
            }
        }

        // Nível 1: match único por (etapa, nome=item)
        if (!rubricaId) {
            const candidatas = (rubricas || []).filter(r =>
                normalizar(r.etapa) === etapaNorm && normalizar(r.nome) === itemNorm
            );
            if (candidatas.length === 1) {
                rubricaId = candidatas[0].id;
                nivel = 1;
            } else if (candidatas.length > 1 && linha.vl_programado != null) {
                // Nível 2: desempata por vl_programado = valor_aprovado
                const porValor = candidatas.filter(r => Number(r.valor_aprovado) === Number(linha.vl_programado));
                if (porValor.length === 1) {
                    rubricaId = porValor[0].id;
                    nivel = 2;
                }
            }
        }

        // Nível 3: ainda ambíguo ou zero matches -> fila de conferência
        const status = rubricaId ? 'pareada' : 'fila_conferencia';

        resultados.push({
            captura_id: capturaId,
            project_id: projectId,
            organization_id: organizationId,
            numero: linha.numero,
            etapa: linha.etapa,
            item: linha.item,
            unidade: linha.unidade,
            qtde_programada: linha.qtde_programada,
            vl_programado: linha.vl_programado,
            pct_executado: linha.pct_executado,
            vl_executado: linha.vl_executado,
            pct_a_executar: linha.pct_a_executar,
            rubrica_id: rubricaId,
            pareamento_nivel: nivel,
            pareamento_status: status
        });

        // Memoriza o vínculo só quando resolvido automaticamente (níveis 1-2) —
        // nível 0 já veio de um vínculo existente, não precisa regravar.
        if (rubricaId && (nivel === 1 || nivel === 2) && linha.vl_programado != null) {
            novosVinculos.push({
                project_id: projectId,
                organization_id: organizationId,
                chave_etapa: linha.etapa,
                chave_item: linha.item,
                chave_vl_programado: linha.vl_programado,
                rubrica_id: rubricaId,
                confirmado_em: new Date().toISOString()
            });
        }
    }

    if (resultados.length > 0) {
        const { error: insertErr } = await supabase.from('saldo_salic_linhas').insert(resultados);
        if (insertErr) throw insertErr;
    }

    if (novosVinculos.length > 0) {
        const { error: upsertErr } = await supabase
            .from('saldo_salic_vinculos')
            .upsert(novosVinculos, { onConflict: 'project_id,chave_etapa,chave_item,chave_vl_programado' });
        if (upsertErr) throw upsertErr;
    }

    const pareadas = resultados.filter(r => r.pareamento_status === 'pareada').length;
    return { total: resultados.length, pareadas, fila: resultados.length - pareadas };
}

module.exports = { parearLinhas, normalizar };
