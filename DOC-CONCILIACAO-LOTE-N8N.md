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

**CORREÇÃO IMPORTANTE (verificado direto no banco de produção, não presumido):** minha suposição original — de que `tipo_documento='nf'` é o candidato e o comprovante é sempre uma linha filha separada apontando via `nf_vinculada_id` — está incompleta. Existem **dois padrões reais** em `documents`, e o trigger `trg_documents_cria_despesa` até comenta isso ("comprovante misto auto-referenciado" vs. "comprovantes filhos"):

1. **Documento misto (é o padrão dominante nos dados reais hoje):** uma única linha com `tipo_documento='comprovante'` onde **`nf_vinculada_id` aponta para o próprio `id`** — o mesmo PDF é a NF e o comprovante de pagamento. `valor_pago`, `data_pagamento` e `autenticacao_bancaria` já vêm **nessa mesma linha**. Nos dados de produção, **100% dos documentos que chegam a `status = aguardando_conciliacao_bancaria` são deste tipo** (`tipo_documento='comprovante'`) — uma query filtrando `tipo_documento = nf` (como eu tinha escrito antes) retornaria **zero linhas**, mesmo com o projeto tendo pendências reais.
2. **Comprovante filho (existe no código, mas nenhuma linha assim na produção hoje):** `tipo_documento='nf'` com status `aguardando_conciliacao_bancaria`, e um comprovante **separado**, `tipo_documento='comprovante'`, com `nf_vinculada_id` apontando para o `id` da NF (`id` diferente). `valor_pago`/`data_pagamento`/`autenticacao_bancaria` ficam na linha do comprovante, não na da NF.

A query de candidatos precisa cobrir os dois, então: **não filtrar por `tipo_documento`** na busca principal — filtrar só por `status`. O join com o padrão filho vira um *fallback*, usado só quando o candidato não já trouxer os campos consigo mesmo.

**Query A — candidatos pendentes de conciliação (sem filtro de tipo_documento):**
- Tabela `documents`, filtros: `project_id = {{project_id}}`, `status = aguardando_conciliacao_bancaria`
- Campos: `id, tipo_documento, valor, valor_pago, data_pagamento, autenticacao_bancaria, nf_vinculada_id`

**Query B — comprovantes filhos (para o fallback do padrão 2):**
- Tabela `documents`, filtros: `project_id = {{project_id}}`, `tipo_documento = comprovante`
- Campos: `id, nf_vinculada_id, valor, valor_pago, data_pagamento, autenticacao_bancaria`

**Code "Monta Candidatos":**

```javascript
const pendentesNF = $('Busca Candidatos Pendentes').all().map(i => i.json);
const comprovantes = $('Busca Comprovantes').all().map(i => i.json);

// Só usado como fallback: comprovante FILHO, com id diferente da NF que aponta
const porNf = {};
for (const c of comprovantes) {
  if (c.nf_vinculada_id && c.nf_vinculada_id !== c.id) porNf[c.nf_vinculada_id] = c;
}

const candidatos = pendentesNF.map(doc => {
  // Padrão 1 (misto/auto-referenciado): os campos já estão na própria linha.
  // Padrão 2 (NF + comprovante filho): cai no fallback via nf_vinculada_id.
  const temCamposProprios = doc.valor_pago != null || doc.autenticacao_bancaria != null;
  const comp = temCamposProprios ? doc : (porNf[doc.id] || {});
  return {
    id: doc.id, // sempre o id do documento que está em aguardando_conciliacao_bancaria — é ele que muda de status
    valor_pago: comp.valor_pago ?? comp.valor ?? doc.valor,
    data_pagamento: comp.data_pagamento ?? doc.data_pagamento,
    autenticacao_bancaria: comp.autenticacao_bancaria ?? doc.autenticacao_bancaria,
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
