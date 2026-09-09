# Briefing — Controle de saldo de rubrica desincroniza com uploads fora do Prestaí

> Gerado em 2026-07-25, branch `api`. Objetivo: decidir a estratégia antes de implementar.

---

## 1. Problema

O saldo de cada rubrica (`rubricas.valor_utilizado`, e por consequência `saldo = valor_aprovado - valor_utilizado`) é calculado **internamente**, somando os registros da tabela `despesas` que passaram pelo Prestaí. Confirmado ao vivo no banco de produção:

- Trigger `despesas_atualiza_consumo` (tabela `despesas`, habilitado) chama a função `recalc_rubrica_valor_utilizado(rubrica_id)`, que faz:
  ```sql
  UPDATE rubricas SET valor_utilizado = COALESCE((
      SELECT SUM(d.valor) FROM despesas d
      WHERE d.rubrica_id = p_rubrica_id
        AND d.status IN ('aguardando_d3','liberado_rpa_airtop','enviado_salic','concluido')
  ), 0) WHERE id = p_rubrica_id;
  ```
- **Esse trigger e a função não existem em nenhum arquivo `.sql` versionado no repositório** — foram aplicados direto no Supabase de produção, fora do controle de versão.

**Causa raiz:** se uma despesa é lançada contra uma rubrica **fora do Prestaí** (diretamente no portal do SALIC, por outro processo, manualmente), o Prestaí nunca fica sabendo — a soma continua rodando só sobre `despesas` conhecidas pelo sistema. O número exibido ao usuário (`valor_utilizado`/saldo) diverge silenciosamente da realidade no SALIC, sem nenhum aviso.

Hoje não existe:
- Nenhuma consulta ao SALIC que traga o saldo real sob demanda.
- Nenhum bloqueio ou alerta ao vincular uma despesa que ultrapasse o saldo aprovado (nem client-side, nem constraint/trigger no banco).
- Nenhuma implementação dos limites percentuais regulatórios da IN 23/2025 MinC (nem placeholder).

A exibição visual de saldo/percentual (cards de rubrica, cores por faixa de uso) está ativa em `app.js` (`OrcamentoView`), mas mostra sempre o número **calculado internamente** — que é exatamente o número que pode estar errado.

---

## 2. Solução proposta

Em vez de só rotular o número interno com um timestamp ("desde quando foi calculado"), a ideia é **buscar o saldo real do próprio SALIC no momento em que o Prestaí já está lá inserindo uma despesa**, e usar esse valor como a fonte de verdade exibida ao usuário — com o rótulo **"Saldo da rubrica desde a última consulta realizada em: DATA"** passando a ser honesto de verdade, porque reflete o que o SALIC realmente tinha naquele instante (incluindo lançamentos feitos fora do Prestaí antes daquela consulta).

### Por que isso é viável com esforço baixo

O RPA de inserção financeira (`cultops-rpa-worker/salic_insertion.cjs`, script completo e o que está de fato em produção — via `SALIC_API_URL` apontando para esse microsserviço; a versão em `salic_insertion.cjs` na raiz do repo é uma versão antiga/incompleta, não usada) **já lê a tabela de saldo por rubrica antes de inserir**, para decidir em qual linha clicar:

```js
// cultops-rpa-worker/salic_insertion.cjs:288-305
const coletarCandidatos = (rows) => {
    for (const row of rows) {
        const colunas = row.querySelectorAll('td');
        candidatos.push({
            nomeOriginal:  colunas[0].innerText.trim(),
            strAprovado:   colunas[1].innerText...,  // valor aprovado
            strSaldo:      colunas[3].innerText...,  // saldo ATUAL segundo o SALIC
        });
    }
};
```

E depois de salvar, já existe um fluxo (usado hoje só no caminho de "resultado ambíguo") que **re-navega para essa mesma página de Comprovação Financeira** para confirmar a inserção (linha ~905).

Ou seja: a leitura do saldo real já é feita pelo robô — só não é aproveitada nem devolvida. O trabalho é essencialmente:

1. Depois de uma inserção bem-sucedida, reler a mesma tabela (ou reusar o resultado já lido antes de inserir + 1 refresh) e extrair o `strSaldo` da rubrica que acabou de receber a despesa.
2. Devolver esse valor (e o timestamp da leitura) na resposta do endpoint `POST /api/salic/inserir`.
3. No lado Prestaí, persistir esse valor (nova coluna, ver decisão 1 abaixo) e trocar a exibição do saldo na UI para esse número + label "desde a última consulta em: DATA", em vez do `valor_utilizado` calculado internamente.

---

## 3. Decisões em aberto

### Decisão 1 — Onde persistir o saldo real vindo do SALIC

| Opção | Descrição | Prós | Contras |
|---|---|---|---|
| **A. Nova coluna em `rubricas`** | `rubricas.saldo_salic numeric`, `rubricas.saldo_salic_consultado_em timestamptz` | Simples de exibir em qualquer tela que já lê `rubricas`; um valor por rubrica, sempre o mais recente | Sobrescreve a leitura anterior — não guarda histórico de consultas |
| **B. Log por consulta (nova tabela)** | Ex: `rubrica_saldo_consultas (rubrica_id, saldo, consultado_em, origem_document_id)` | Histórico completo, auditável, dá pra detectar divergências ao longo do tempo | Mais uma tabela pra manter; telas precisam de um `ORDER BY ... LIMIT 1` pra pegar o mais recente |

**Recomendação inicial:** A para o MVP (é o que a UI precisa pra mostrar o label), com espaço pra evoluir pra B depois se quisermos auditoria de divergência histórica.

### Decisão 2 — Consulta de saldo sem precisar inserir uma despesa

O fluxo acima só atualiza o saldo real quando **o Prestaí insere algo no SALIC**. Se nada for inserido por semanas, o número fica parado (o que é esperado e é exatamente o que o label comunica) — mas pode valer a pena ter também um botão "Consultar saldo real" independente, sem precisar subir uma NF pra isso.

Tecnicamente é reaproveitar ~70% do mesmo script: login → localizar projeto por PRONAC → abrir Comprovação Financeira → ler a tabela → **parar aí, sem clicar em Inserir**. Precisa decidir se entra já no MVP ou fica pra uma segunda fase.

### Decisão 3 — O que fazer quando o número interno e o número do SALIC divergirem

Quando a primeira consulta pós-implementação acontecer, é provável que `valor_utilizado` (interno) e `saldo_salic` (real) já estejam diferentes em produção. Precisa decidir:
- Só substituir a exibição pelo número do SALIC dali pra frente (mais simples), ou
- Gerar um alerta pontual pro gestor quando a divergência for detectada (mais trabalho, mas com valor de auditoria — ajuda a entender se está havendo lançamento fora do fluxo com frequência).

---

## 4. Limitações que continuam existindo mesmo com essa solução

- O saldo real só é atualizado nos momentos em que o Prestaí interage com o SALIC (inserção, ou eventualmente a consulta avulsa da Decisão 2). Um lançamento externo feito **depois** da última consulta continua invisível até a próxima interação — é uma redução de janela de desatualização, não uma eliminação total.
- Continua não existindo bloqueio/alerta de estouro no momento de vincular uma despesa no Prestaí (isso é uma frente separada, não coberta por esta solução).
- Os limites regulatórios da IN 23/2025 (teto percentual por categoria) continuam fora de escopo aqui.

---

## 5. Resumo para decisão

**Proposta:** aproveitar a leitura de saldo que o RPA de inserção já faz no SALIC, capturar o valor logo após uma inserção bem-sucedida, e passar a exibir esse número (com timestamp da consulta) em vez do saldo calculado internamente por soma de `despesas`.

**Esforço estimado:** baixo-médio — não é preciso construir uma capacidade nova de leitura no SALIC, só reaproveitar/expor a que já existe no `cultops-rpa-worker`. O trabalho maior é decidir onde persistir (Decisão 1) e ajustar a UI (`OrcamentoView` em `app.js`) para consumir o novo valor.

**Pendente de decisão antes de implementar:** as três decisões da seção 3.
