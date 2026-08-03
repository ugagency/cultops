# Evidências físicas — arquitetura M2 ↔ M3

Este documento explica por que **duas telas diferentes** (uma no Módulo II, outra no Módulo III) trabalham com evidências físicas, e por que isso **não é redundância**.

## Uma tabela, dois pontos de entrada

Todas as evidências vivem numa única tabela: **`physical_evidences`**. Não há cópia, sincronização nem espelhamento — M2 e M3 leem e escrevem nas mesmas linhas. O que muda é o **contexto de trabalho** de cada tela:

```
                       ┌──────────────────────────┐
   M3 (campo)  ──────▶ │                          │ ◀────── M2 (mesa de controle)
   evidencias-m3.html  │    physical_evidences    │         comprovacao-fisica.html
   intake por EVENTO   │      (tabela única)      │         visão do PROJETO inteiro
                       └──────────────────────────┘
                                    ▲
                                    │
                       Portal do Solicitante (M1)
                       fornecedor envia comprovação física
```

## M3 — `modulo3/evidencias-m3.html`: intake descentralizado

- Sempre aberta **no contexto de um evento** (`?event_id=...`).
- Quem está em campo (operador, gestor) sobe a foto/material **daquele evento** — o vínculo `distribution_event_id` é gravado **obrigatoriamente**.
- Também registra as **listas de presença** do evento (pré-requisito para encerrá-lo).
- Desde a rodada standalone do M3, esta tela também **valida** (aprovar / reprovar / solicitar complemento) — restrito a **admin/gestor/analista**; o operador que sobe a evidência não valida a própria evidência.

## M2 — `modulo2/comprovacao-fisica.html`: mesa de controle central

- Vê **todas** as evidências do projeto — as criadas pelo M3, as enviadas pelo Portal do Solicitante e as subidas ali mesmo — com filtros por evento, produto, ano e tipo.
- O vínculo a evento aqui é **opcional**, porque nem toda evidência do projeto pertence a um evento (ex.: relatório do objeto, peça de marketing institucional, clipagem).
- O campo "Vincular a evento" do upload do M2 grava o **mesmo** `distribution_event_id` que o M3 grava — é a mesma relação, preenchida a partir de qualquer um dos lados.

## Quem aprova o quê

| | M3 (`evidencias-m3.html`) | M2 (`comprovacao-fisica.html`) |
|---|---|---|
| Escopo | Evidências de **um evento** | **Todas** as evidências do projeto |
| Vínculo a evento | Obrigatório | Opcional |
| Quem sobe | Operador/gestor em campo | Gestor/analista ou fornecedor (via Portal M1) |
| Quem valida | admin/gestor/analista | admin/gestor/analista |
| Papel na prestação de contas | Fecha o ciclo do evento | **Visão consolidada** para o checklist e o envio ao MinC |

As duas telas gravam a validação nos mesmos campos (`status_validacao`, `motivo_reprovacao`, `validado_por`, `validado_em`) — uma aprovação feita no M3 aparece imediatamente no M2 e vice-versa.

## Por organização

- **Organização M3-only (freemium)**: o ciclo fecha inteiro dentro do M3 — sobe no evento, valida no evento, gera relatório de evento/mensal.
- **Organização com M2**: o M2 é a camada de **auditoria consolidada** por cima do intake do M3 — é nela que o checklist da Prestação de Contas (itens P05/P06/P07) e as exportações enxergam o conjunto.

## Referências de código

- Vínculo evento no upload do M2: `modulo2/comprovacao-fisica.html` (select `#ev-evento`, `loadEventosM3()`, `distribution_event_id` no insert)
- Validação no M2: `approveEvidence()` / `confirmReject()` / fluxo de complemento em `modulo2/comprovacao-fisica.html`
- Validação no M3: `aprovarEvidenciaM3()` / `confirmarValidacaoM3()` em `modulo3/evidencias-m3.html`
- Notificação de mudança de status (best-effort, ambos os lados): `POST /api/m2/evidencia/notificar`
