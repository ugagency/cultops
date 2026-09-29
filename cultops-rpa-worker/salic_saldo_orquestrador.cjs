const { capturarExecucaoSalic } = require('./salic_captura_execucao.cjs');
const { parearLinhas } = require('./salic_pareamento.cjs');

// CR-2026-001 Fase 4.2: tolerância abaixo da qual uma diferença não é
// tratada como divergência (arredondamento).
const TOLERANCIA_DIVERGENCIA = 0.01;

/**
 * Compara, por rubrica, o executado que o SALIC acabou de reportar nesta
 * captura com o que o PrestAI já tinha como confirmado (despesas com
 * data_salic preenchido até o momento da captura). Diferença acima da
 * tolerância vira registro em saldo_salic_divergencias — é o
 * autodiagnóstico da feature: detecta quando o PrestAI acha que mandou
 * algo que o SALIC não registrou, ou vice-versa.
 */
async function detectarDivergencias(supabase, { projectId, organizationId, capturaId, concluidaEm }) {
    const { data: linhas, error: linhasErr } = await supabase
        .from('saldo_salic_linhas')
        .select('rubrica_id, vl_executado')
        .eq('captura_id', capturaId)
        .not('rubrica_id', 'is', null);
    if (linhasErr) throw linhasErr;

    const executadoPorRubrica = {};
    (linhas || []).forEach(l => {
        executadoPorRubrica[l.rubrica_id] = (executadoPorRubrica[l.rubrica_id] || 0) + Number(l.vl_executado || 0);
    });

    // Correção de bug: antes a busca de despesas era filtrada pelas
    // rubricas desta captura (.in('rubrica_id', rubricaIds)), então uma
    // rubrica com despesa confirmada no PrestAI mas AUSENTE do relatório
    // do SALIC nunca entrava na comparação — era o cenário mais grave
    // ("mandei e o SALIC não registrou"). Agora busca por projeto inteiro
    // e a união dos dois lados decide quais rubricas comparar.
    const { data: despesas, error: despesasErr } = await supabase
        .from('despesas')
        .select('rubrica_id, valor')
        .eq('project_id', projectId)
        .not('data_salic', 'is', null)
        .lte('data_salic', concluidaEm);
    if (despesasErr) throw despesasErr;

    const confirmadoPorRubrica = {};
    (despesas || []).forEach(d => {
        confirmadoPorRubrica[d.rubrica_id] = (confirmadoPorRubrica[d.rubrica_id] || 0) + Number(d.valor || 0);
    });

    const rubricaIds = Array.from(new Set([
        ...Object.keys(executadoPorRubrica),
        ...Object.keys(confirmadoPorRubrica)
    ]));
    if (rubricaIds.length === 0) return { divergencias: 0 };

    const novasDivergencias = rubricaIds
        .map(rubricaId => {
            // Rubrica ausente da captura (nunca lançada no SALIC) entra
            // com executado_salic = 0, não fica de fora da comparação.
            const vlSalic = executadoPorRubrica[rubricaId] || 0;
            const vlPrestai = confirmadoPorRubrica[rubricaId] || 0;
            const diferenca = vlSalic - vlPrestai;
            return { rubricaId, vlSalic, vlPrestai, diferenca };
        })
        .filter(d => Math.abs(d.diferenca) > TOLERANCIA_DIVERGENCIA)
        .map(d => ({
            project_id: projectId,
            organization_id: organizationId,
            rubrica_id: d.rubricaId,
            vl_executado_salic: d.vlSalic,
            vl_confirmado_prestai: d.vlPrestai,
            diferenca: d.diferenca,
            status: 'aberta'
        }));

    if (novasDivergencias.length > 0) {
        const { error: insErr } = await supabase.from('saldo_salic_divergencias').insert(novasDivergencias);
        if (insErr) throw insErr;
    }
    return { divergencias: novasDivergencias.length };
}

/**
 * Orquestra uma captura completa: cria o registro de controle, roda o
 * scraping, pareia as linhas, marca sucesso/erro e detecta divergências.
 * Usado tanto pelo endpoint manual (/capturar-execucao) quanto pela rede
 * de segurança condicional (/cron/captura-condicional) — mesma lógica,
 * evita duplicar o fluxo entre os dois pontos de entrada.
 */
async function executarCapturaProjeto(supabase, { projectId, pronac, organizationId, usuario, senha, disparadaPor }) {
    // Achado de auditoria: nem o clique manual nem o cron verificavam se já
    // havia uma captura em andamento para este projeto antes de abrir outro
    // Chrome — dois admins clicando quase juntos (ou um clique coincidindo
    // com o cron) abriam duas sessões simultâneas com a MESMA credencial no
    // SALIC, que não tem homologação. Mesma janela de 10min de "travada"
    // usada em saldo_salic_projetos_elegiveis_captura() (Fase 4.1), para as
    // duas checagens tratarem "em andamento" do mesmo jeito. Isso não é uma
    // trava atômica (SELECT-então-INSERT) — fecha a janela de clique humano,
    // não uma corrida de milissegundos entre dois processos.
    const { data: emAndamento, error: emAndamentoErr } = await supabase
        .from('saldo_salic_capturas')
        .select('id, iniciada_em')
        .eq('project_id', projectId)
        .eq('status', 'executando')
        .gt('iniciada_em', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
    if (emAndamentoErr) throw emAndamentoErr;
    if (emAndamento) {
        throw new Error(`Já existe uma captura em andamento para este projeto (iniciada às ${emAndamento.iniciada_em}). Aguarde terminar antes de tentar de novo.`);
    }

    const { data: captura, error: capturaErr } = await supabase
        .from('saldo_salic_capturas')
        .insert({
            project_id: projectId,
            organization_id: organizationId,
            status: 'executando',
            disparada_por: disparadaPor || null
        })
        .select('id')
        .single();
    if (capturaErr || !captura) throw new Error('Falha ao criar registro de captura: ' + (capturaErr?.message || ''));
    const capturaId = captura.id;

    try {
        const resultado = await capturarExecucaoSalic({ usuario, senha, pronac });
        if (!resultado.sucesso) throw new Error(resultado.erro);

        const pareamento = await parearLinhas(supabase, { projectId, organizationId, capturaId, linhas: resultado.linhas });

        const concluidaEm = new Date().toISOString();
        await supabase.from('saldo_salic_capturas').update({
            status: 'sucesso',
            concluida_em: concluidaEm,
            total_linhas: pareamento.total
        }).eq('id', capturaId);

        let divergenciasInfo = { divergencias: 0 };
        try {
            divergenciasInfo = await detectarDivergencias(supabase, { projectId, organizationId, capturaId, concluidaEm });
        } catch (divErr) {
            // Divergência é autodiagnóstico, não pode derrubar uma captura
            // que já teve sucesso — só loga.
            console.error('[SALDO-SALIC] Falha ao detectar divergências (captura seguiu OK):', divErr.message);
        }

        return { capturaId, ...pareamento, ...divergenciasInfo };
    } catch (error) {
        await supabase.from('saldo_salic_capturas').update({
            status: 'erro',
            concluida_em: new Date().toISOString(),
            erro_mensagem: error.message
        }).eq('id', capturaId);
        throw error;
    }
}

module.exports = { executarCapturaProjeto, detectarDivergencias };
