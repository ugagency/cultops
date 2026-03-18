/**
 * PRESTAÍ - MOTOR DE CONCILIAÇÃO (MATCHMAKER) v1.0
 * ------------------------------------------------
 * Este script deve ser colado em um nó "Code" do n8n.
 * Entrada 1 (Input 0): Linhas do Extrato Bancário (pendentes)
 * Entrada 2 (Input 1): Despesas Validadas (aguardando conciliação)
 */

// 1. Capturar as entradas dos dois lados do banco
const extratoRows = items; // O n8n passa o primeiro input como 'items'
const despesasRows = $input.all(1); // Captura o segundo input (Despesas)

let matches = [];
let pendentesDeExtrato = [];

console.log(`Iniciando Matchmaker: ${extratoRows.length} linhas de extrato vs ${despesasRows.length} despesas.`);

// 2. Iterar sobre as despesas para encontrar seus pares no extrato
for (const despesaItem of despesasRows) {
    const d = despesaItem.json;
    let matchEncontrado = null;

    // Regra de Ouro: Match por Código de Autenticação
    if (d.autenticacao_bancaria && d.autenticacao_bancaria.length > 5) {
        matchEncontrado = extratoRows.find(e =>
            e.json.autenticacao === d.autenticacao_bancaria
        );
        if (matchEncontrado) d.metodo_match = 'autenticacao';
    }

    // Regra de Prata: Fallback (Valor Exato + Data Próxima + Nome)
    if (!matchEncontrado) {
        matchEncontrado = extratoRows.find(e => {
            const eVal = Math.abs(parseFloat(e.json.valor));
            const dVal = Math.abs(parseFloat(d.valor));

            // Verifica Valor exato
            const valorBate = Math.abs(eVal - dVal) < 0.01;

            // Verifica Proximidade de Data (janela de 3 dias para compensação)
            const dData = new Date(d.data_pagamento || d.data_emissao);
            const eData = new Date(e.json.data_transacao);
            const diffDias = Math.abs(eData - dData) / (1000 * 60 * 60 * 24);
            const dataBate = diffDias <= 3;

            return valorBate && dataBate;
        });
        if (matchEncontrado) d.metodo_match = 'valor_data_nome';
    }

    // 3. Organizar os resultados para o próximo nó do n8n
    if (matchEncontrado) {
        matches.push({
            json: {
                despesa_id: d.id,
                extrato_id: matchEncontrado.json.id,
                valor: d.valor,
                projeto_id: d.project_id,
                metodo: d.metodo_match,
                data_conciliacao: new Date().toISOString()
            }
        });

        // Remove do extrato temporário para não conciliar o mesmo lançamento duas vezes
        const index = extratoRows.indexOf(matchEncontrado);
        if (index > -1) extratoRows.splice(index, 1);
    } else {
        pendentesDeExtrato.push(despesaItem);
    }
}

return matches;
