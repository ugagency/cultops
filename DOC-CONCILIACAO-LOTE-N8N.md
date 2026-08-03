# Workflow n8n — "Conciliação em Lote" (prestai-conciliation-lote)

Guia de montagem do workflow **novo e separado** de conciliação em lote: um extrato do período conciliado contra **todas** as NFs pendentes do projeto. O workflow atual (`prestai-conciliation`, 1 extrato ↔ 1 nota) **não é alterado** — os dois convivem.

O frontend já está pronto (branch `feature/conciliacao-lote`): o botão "Conciliar extrato do período" no Dashboard do M1 chama `window.handleUploadExtratoLote()`, que sobe o arquivo, cria a linha em `extratos` e dispara o webhook abaixo.

## 1. Webhook

- **Path**: `prestai-conciliation-lote` · **Método**: POST
- **Payload** (repare: sem `nf_id` nem `comprovante_id` — é a diferença do fluxo atual):

```json
{ "extrato_id": "...", "project_id": "...", "file_path": "...", "bucket": "documentos" }
```

## 2. Parse do arquivo

Copiar **sem alteração** do workflow atual: Edit Fields → Detecta Formato → os 3 ramos (OFX / CSV / PDF com Mistral/Gemini). A saída é a mesma lista `lancamentos` (`fitid`, `valor`, `data_lancamento`, `memo`...).

## 3. Node "Busca Candidatos"

Relação NF↔comprovante **confirmada no banco**: comprovantes são linhas próprias em `documents` com `tipo_documento='comprovante'` e **`nf_vinculada_id`** apontando para a NF. Duas queries (Supabase get many) + um Code de junção:

**Query A — NFs pendentes:**
- Tabela `documents`, filtros: `project_id = {{project_id}}`, `status = aguardando_conciliacao_bancaria`, `tipo_documento = nf`
- Campos: `id, valor, valor_pago, data_pagamento, autenticacao_bancaria`

**Query B — comprovantes vinculados:**
- Tabela `documents`, filtros: `project_id = {{project_id}}`, `tipo_documento = comprovante`
- Campos: `id, nf_vinculada_id, valor, valor_pago, data_pagamento, autenticacao_bancaria`

**Code "Monta Candidatos"** (dados do comprovante têm prioridade — é ele que o fluxo 1-para-1 usa no match):

```javascript
const nfs = $('Busca NFs Pendentes').all().map(i => i.json);
const comprovantes = $('Busca Comprovantes').all().map(i => i.json);

const porNf = {};
for (const c of comprovantes) {
  if (c.nf_vinculada_id) porNf[c.nf_vinculada_id] = c;
}

const candidatos = nfs.map(nf => {
  const comp = porNf[nf.id] || {};
  return {
    id: nf.id, // sempre o id da NF — é ela que muda de status
    valor_pago: comp.valor_pago ?? comp.valor ?? nf.valor_pago ?? nf.valor,
    data_pagamento: comp.data_pagamento ?? nf.data_pagamento,
    autenticacao_bancaria: comp.autenticacao_bancaria ?? nf.autenticacao_bancaria,
  };
});

return [{ json: { candidatos } }];
```

## 4. Node "Engine de Match em Lote" (Code)

Substitui o match 1×N do fluxo atual por N×N com regra de ambiguidade. **Regra inegociável: match múltiplo NUNCA casa automaticamente** — casar errado em prestação de contas do MinC é pior do que não casar.

```javascript
const lancamentos = $('Parse ...').item.json.lancamentos || []; // ajustar nome do node de parse
const candidatos = $('Monta Candidatos').item.json.candidatos || [];
const usados = new Set(); // candidato já casado nesta execução
const conciliados = [], pendentes = [], ambiguos = [];

for (const l of lancamentos) {
  // 1º critério: fitid === autenticacao_bancaria
  let matches = candidatos.filter(c =>
    !usados.has(c.id) &&
    c.autenticacao_bancaria &&
    l.fitid &&
    c.autenticacao_bancaria.trim().toLowerCase()
      === l.fitid.trim().toLowerCase());

  // 2º critério: valor ±0,01 e data ±3 dias
  if (matches.length === 0) {
    matches = candidatos.filter(c => {
      if (usados.has(c.id)) return false;
      const v = parseFloat(c.valor_pago || 0);
      if (Math.abs(l.valor - v) > 0.01) return false;
      if (!c.data_pagamento || !l.data_lancamento) return true;
      const diff = Math.abs(
        (new Date(l.data_lancamento) - new Date(c.data_pagamento))
        / 86400000);
      return diff <= 3;
    });
  }

  if (matches.length === 1) {
    usados.add(matches[0].id);
    conciliados.push({ lancamento: l, nf_id: matches[0].id });
  } else if (matches.length > 1) {
    ambiguos.push({ lancamento: l,
      candidatos_ids: matches.map(m => m.id) });
  } else {
    pendentes.push(l);
  }
}

return [{ json: { conciliados, pendentes, ambiguos } }];
```

## 5. Saídas (3 ramos)

| Ramo | extratos_lancamentos | documents (NF) |
|---|---|---|
| **conciliados** | mesmos campos do node "Salva Lançamento Conciliado" atual, com `status_conciliacao: 'conciliado'` e `document_id: nf_id` | UPDATE `status = 'aguardando_d3'`, `justification = 'Conciliação em lote via ' + metodo` (metodo = 'fitid' ou 'valor+data') |
| **ambiguos** | `status_conciliacao: 'pendente'`, `document_id: null`, `memo` prefixado com `'[AMBÍGUO: ' + candidatos_ids.join(',') + '] '` | — (nenhuma NF muda) |
| **pendentes** | igual ao "Split Lançamentos Pendentes" atual: `'pendente'`, `document_id: null` | — |

O prefixo `[AMBÍGUO: id1,id2]` no memo permite a futura tela de revisão manual identificar os candidatos sem coluna nova.

## 6. Finalizar

`UPDATE extratos SET status = 'processado' WHERE id = {{extrato_id}}` — igual ao workflow atual. Em erro de parse, `status = 'erro'` (também igual).

## Zero migration

`extratos_lancamentos` já é N:N (`extrato_id` + `document_id` por linha) — o banco já suporta o lote sem mudança de schema.

## Próximos passos registrados (fora desta rodada)

- **Tela de revisão manual** de pendentes/ambíguos: listar `extratos_lancamentos` com `status_conciliacao = 'pendente'` e permitir vincular `document_id` na mão. O lote vai gerar mais pendentes que o fluxo 1-para-1 — recomendada como rodada seguinte.
- Nenhuma mudança nos workflows de OCR ou CNAE.

## Verificação (após montar o workflow)

1. Fluxo atual (extrato dentro da nota) segue igual — zero regressão
2. Projeto com 3+ NFs pendentes + 1 OFX com os pagamentos → cada lançamento casa com a NF certa (`document_id` correto)
3. 2 NFs de mesmo valor/datas próximas → lançamento fica pendente com memo `[AMBÍGUO: ...]`, sem casar
4. Lançamento sem NF → `'pendente'`, `document_id null`
5. Extrato termina `'processado'`
6. NFs casadas avançam para `'aguardando_d3'` com a justification de lote
