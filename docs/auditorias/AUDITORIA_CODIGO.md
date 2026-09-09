# Auditoria de Código — PrestAI/Cultopps

**Data:** 2026-07-17
**Escopo:** código morto, duplicidade, risco de bug e divergência entre branches, como insumo para a decisão de arquitetura do Módulo 3.
**Método:** leitura direta de arquivo + grep no repositório (`main`) + consultas reais ao schema/RLS do Supabase (projeto `CULTOPPS-AIDA`, `ucmahpyxjxqbrvnistrh`). Somente leitura — nenhum arquivo foi alterado.
**Status da execução:** as categorias 1, 2 e 3 foram concluídas. A categoria 4 (divergência entre branches) e o subitem "funções JS nunca chamadas" (categoria 1, item 2) foram **interrompidos antes de terminar** — os dados dessas duas partes abaixo são parciais, vindos do que já havia sido levantado na conversa antes da auditoria formal, não de uma varredura completa.

---

## 1. Resumo executivo

| Categoria | Itens levantados | Observação |
|---|---|---|
| Código morto | 1 arquivo órfão, 5 rotas server.js sem chamador, 4 colunas de banco nunca referenciadas, 1 caminho de escrita morto (`subirParaStorage` não grava `rubrica_id_fk`), 4 migrations RLS superadas por uma mais recente | Item "funções JS nunca chamadas" não foi concluído |
| Duplicidade | 2 portais de fornecedor (1 quebrado e órfão), 2 telas de admin de solicitantes (ambas ativas, lógica distinta), 4 famílias de helper duplicadas (`formatCurrency`, `formatDate`, `escapeHtml`, `showToast`), 4 pontos de INSERT em `physical_evidences` com payloads divergentes, 1 filtro de relatório divergente (`contrato_pai_id`) | `showToast` tem 3 implementações **incompatíveis** entre si |
| Risco de bug | 5 críticos, 4 médios/altos, 3 hipóteses do usuário refutadas | O achado crítico #1 (espaço literal no nome de arquivo) não estava entre as hipóteses do usuário — foi descoberto durante a investigação |
| Divergência entre branches | Não concluída nesta rodada | Dados abaixo vêm da conversa anterior, não de auditoria formal |

**Visão geral:** o repositório tem **débito técnico moderado a preocupante**, concentrado em duas áreas: (1) o par app.js × modulo2 evoluindo em paralelo sem um único ponto de verdade para lógica compartilhada, e (2) gaps de `organization_id`/roles que têm efeito direto em segurança/integridade de dados, não só em estética de código. Nenhum dos achados críticos é sobre M3 diretamente — mas o achado de duplicidade do portal do fornecedor (seção 3.1) é decisivo para a arquitetura do M3.

---

## 2. Tabela — Código morto

| Arquivo/Função | Tipo | Evidência | Ação sugerida |
|---|---|---|---|
| `modulo2/portal-solicitante.html` | Arquivo órfão | Zero ocorrências da string `portal-solicitante` em qualquer outro arquivo do repo (não está no menu dinâmico de `supabase-helper.js:77-89`, não é linkado por `gestao-solicitantes.html` nem `app.js`). Só acessível digitando a URL na mão. | Decidir: apagar, ou consertar e linkar (ver §3.1 — está também quebrado) |
| `GET /api/health` (server.js:167) | Rota sem chamador | Nenhum fetch no repo aponta pra cá | Manter se for usado por monitoramento externo (Railway/Vercel health check); confirmar antes de remover |
| `GET /api/m2/contracts/:project_id` (server.js:510) | Rota sem chamador | `contratos.html:496` lê `contracts` direto via client Supabase, não via essa rota | Remover ou documentar por que foi mantida |
| `POST /api/m2/contracts` (server.js:552) | Rota sem chamador | `contratos.html:943` insere direto via client Supabase | Remover ou documentar |
| `POST /api/m2/salic/encerrar` (server.js:570) | Stub nunca chamado | Handler retorna resposta simulada (`"Fluxo de encerramento iniciado (Simulado)..."`) — nunca foi finalizado nem tem chamador | Remover ou finalizar, dependendo se o "encerramento SALIC" ainda é necessário |
| `POST /api/rubricas/importar` (server.js:578) | Proxy morto | `rubricas.html:811` chama `CONFIG.N8N_WEBHOOK_SALIC_IMPORT_RUBRICAS_URL` direto, bypassando este proxy | Remover |
| `physical_evidences.token_solicitante` | Coluna nunca lida/escrita | Só existe em `setup.sql`; nenhum `.select`/`.insert`/`.update` no repo inteiro | Confirmar se é usada por algum processo fora do repo (n8n?) antes de remover — o nome sugere um fluxo de link mágico sem login que **nunca foi implementado** |
| `physical_evidences.ia_categoria` | Coluna nunca lida/escrita | Só em `setup.sql`; `select('*')` a traz implicitamente mas nunca é exibida/usada | Idem — provável campo de IA planejado e não conectado |
| `physical_evidences.enviada_salic_em` | Coluna nunca lida/escrita | Consistente com o commit `f1d4d65` que removeu o envio de evidência física ao SALIC | Remover coluna ou documentar como vestígio intencional |
| `physical_evidences.rubrica_id_fk` | Coluna legada confirmada morta | Migration `migration_m2_evidencia_produto.sql:32-33` documenta a substituição por `produto_evidencia`; nenhum código no repo ainda lê/escreve nela | Segura para dropar quando quiserem, mas sem urgência |
| `subirParaStorage()` não grava `rubrica_id_fk` em `documents` (app.js:4796-4827) | Caminho de escrita morto | A função recebe `opts.rubrica_id_fk` (`app.js:4876`) mas o `.insert()` real não inclui esse campo — só grava `rubrica` (texto) | Bug latente mais do que "código morto" puro — ver §4 |
| `migration_fix_rls_evidences.sql`, `migration_fix_rls_final.sql`, `migration_fix_rls_RODAR_AGORA.sql` | Migrations superadas | Cada uma dropa as policies (por nome exato) da anterior; `migration_m2_rls_align_m1.sql` é a versão vigente | Nenhuma ação necessária no banco (já não fazem efeito prático se rodadas de novo, pois a última sobrepõe), mas vale mover para uma pasta `migrations/archive/` pra não confundir o próximo dev |
| **Funções JS nunca chamadas** | — | **Investigação interrompida antes de produzir resultado.** Não há dado confiável aqui — não tratar a ausência de achados como "não há funções mortas". | Recomendo rodar esse item separadamente antes de decisões de limpeza |

---

## 3. Tabela — Duplicidade

### 3.1 Portal do fornecedor — achado mais relevante para o Módulo 3

| Local | O que faz | Está em uso? | Recomendação |
|---|---|---|---|
| `app.js` — `handleSolicitanteUpload` (2469-2529) + `submitM2Evidencia` (2409-2467) dentro de `SolicitanteDashboardView` | Upload de NF (`documents`) **e** upload de evidência física (`physical_evidences`), no mesmo dashboard do fornecedor, mesmo modal unificado | **Sim** — roteado, linkado na sidebar do fornecedor, é o caminho real que fornecedores usam hoje | Este é o portal do fornecedor de fato "vigente" — já cobre os dois tipos de conteúdo |
| `modulo2/portal-solicitante.html` — `handleUpload` (505-580) | Upload de evidência física (`physical_evidences`), mesma tabela e bucket que `submitM2Evidencia` | **Não** — órfão (§2), e além disso **quebrado**: `loadHistory()` (linha 589-593) ordena por `.order('created_at', ...)`, mas a coluna real é `criado_em` — a query provavelmente falha e o histórico nunca carrega | Não usar como base para nada novo. Se for reaproveitar algo do M3 relacionado a fornecedor, partir do fluxo do `app.js`, não deste arquivo |

**Implicação direta para M3:** vocês já têm, funcionando em produção, um único portal de fornecedor (dentro do app.js) que cobre NF + evidência física. `modulo2/portal-solicitante.html` é uma tentativa paralela e abandonada da mesma coisa. Se o M3 precisar de mais um tipo de conteúdo enviado por fornecedor/prestador (ex: evidência de contrapartida, ou documento ligado a um evento/OS), a rota natural é **estender o dashboard único do app.js**, e não criar um quarto portal HTML solto em `modulo3/`.

### 3.2 Admin de vínculo fornecedor↔projeto

| Local | Query de vínculos | Está em uso? |
|---|---|---|
| `SolicitantesAdminView` (app.js, rota `admin_solicitantes`) | `projeto_fornecedores` filtrado indiretamente por `project_id IN (projetos do gestor)` | Sim — linkado na sidebar do M1 |
| `modulo2/gestao-solicitantes.html` | Mesma tabela, filtro direto `gestor_id = usuário atual` | Sim — linkado na sidebar do M2 (`supabase-helper.js:85`) |

Ambas ativas, cada uma no seu módulo — não é código morto, é duplicidade funcional real porque M1 e M2 não compartilham essa tela. Os dois filtros (indireto via projetos vs direto via `gestor_id`) **podem divergir** em cenário de múltiplos gestores por projeto — não confirmado se isso ocorre na prática hoje.

### 3.3 Helpers duplicados

| Helper | Situação |
|---|---|
| `formatCurrency` | Fonte única em `supabase-helper.js`, mas `prestacao-contas.html`, `financeiro.html` e `exportacoes.html` têm reimplementações locais (`fmtBRL`, `pdfFormatMoney`) em vez de reusar — resultado hoje é equivalente, mas é manutenção em 4 lugares |
| `formatDate` | Mesma situação — `projeto-setup.html` redeclara `formatDate` no escopo global e **sobrescreve** o `window.formatDate` de `supabase-helper.js` (carregado antes). Resultado quase idêntico hoje, mas é uma pegadinha para o próximo dev |
| `escapeHtml` | Copiada **idêntica, byte a byte**, em 7 arquivos de `modulo2/`. `app.js` não tem `escapeHtml` nenhuma — templates do M1 não escapam strings do banco do mesmo jeito |
| `showToast` | **3 implementações incompatíveis** (dependem de estruturas DOM diferentes) espalhadas por 10 arquivos. Copiar a função de um arquivo padrão A/B para um arquivo com markup padrão C faz o toast simplesmente não aparecer |

### 3.4 Pontos de INSERT em `physical_evidences` — payloads divergentes

| # | Local | `produto_evidencia` | `data_captura` | `rubrica_id_fk` |
|---|---|---|---|---|
| 1 | `app.js` `submitM2Evidencia` (fornecedor) | ✘ | ✘ | ✘ |
| 2 | `modulo2/portal-solicitante.html` (órfão) | ✘ | ✘ | ✘ |
| 3 | `modulo2/comprovacao-fisica.html` (gestor/admin) | ✔ | ✔ | ✘ |
| 4 | `feature/modulo-3:modulo3/evidencias-m3.html` (branch não mergeada) | ✘ | ✘ | **✔ (campo legado!)** |

**Achado crítico para a decisão de M3:** o código do Módulo 3 ainda em desenvolvimento (branch `feature/modulo-3`) grava evidências usando `rubrica_id_fk`, o vínculo **antigo que a migration `migration_m2_evidencia_produto.sql` já documentou como descontinuado** em favor de `produto_evidencia`. Se essa branch for mergeada sem ajuste, evidências criadas pelo M3 **não vão aparecer vinculadas a produto** na UI do M2 (o badge em `comprovacao-fisica.html:785-786` só renderiza quando `produto_evidencia` existe). Isso precisa ser corrigido antes do merge do M3, independente de qualquer decisão sobre o portal do fornecedor.

Também nenhum dos 4 pontos preenche `enviado_via_token: true` ou usa `token_solicitante` — o fluxo de "link mágico sem login" sugerido pelo nome dessas colunas não tem implementação em lugar nenhum encontrado.

### 3.5 Filtro de relatório divergente (`contrato_pai_id`)

`contratos.html`, `financeiro.html` e `prestacao-contas.html` filtram `.is('contrato_pai_id', null)` ao listar contratos (excluindo anexos/aditivos). **`exportacoes.html` não aplica esse filtro** em nenhuma das 3 queries de contrato que faz — os relatórios exportados (usados para prestação de contas ao MinC) podem contar/somar anexos de contrato como se fossem contratos independentes, diferente do que a tela "Contratos" e o dashboard "Financeiro" mostram. **Isto é uma divergência com efeito prático real em relatório oficial, não só estética de código.**

### 3.6 Migrations RLS duplicadas

`migration_fix_rls_evidences.sql` → `migration_fix_rls_final.sql` → `migration_fix_rls_RODAR_AGORA.sql` → `migration_m2_rls_align_m1.sql`: quatro tentativas separadas de acertar a política RLS de `physical_evidences`, cada uma dropando a anterior por nome. A última é a vigente. Ver também §2.

---

## 4. Tabela — Risco de bug

### Veredito das hipóteses trazidas pelo usuário (nenhuma tinha sido verificada nesta conversa antes da auditoria)

| Hipótese | Veredito |
|---|---|
| `Promise.all` com query fora de ordem | **REFUTADO** — 8 ocorrências relevantes verificadas, todas com destructuring na ordem correta |
| `file_path` sem `.trim()` antes de `createSignedUrl` | **Parcialmente confirmado, mas a causa raiz é pior** — ver achado crítico #1 abaixo |
| `pdfFinal.copyPagesFrom` (método inexistente no pdf-lib) | **REFUTADO** — as 2 ocorrências usam corretamente `copyPages` |
| Timezone em `formatDate()` do `supabase-helper.js` | **CONFIRMADO** |
| `fetch('/api/salic/comprovar-fisico')` sem rota | **NÃO ENCONTRADO** — a chamada nem existe; não há nada quebrado aqui, a integração simplesmente não foi implementada |

### Críticos

| Local | Cenário de falha | Evidência |
|---|---|---|
| `app.js:2480` (`handleSolicitanteUpload`) e `app.js:4802` (`subirParaStorage`) | Nome de arquivo gerado com **espaço literal no final**: `` `${Math.random()}.${fileExt} ` ``. Esse `file_path` sujo é gravado em `documents` e usado sem encoding em `server.js:271` para montar a URL pública que o robô SALIC baixa (`nf_url`). É a causa mais provável de falhas reais do RPA ao tentar abrir a NF (consistente com o print `erro_salic_*.png` já presente no repo). | `app.js:2480`, `app.js:4802`, `server.js:271` |
| `server.js:441` (`/api/gestor/criar-analista`) | Insere `role: 'membro'` em `organization_users`, mas o CHECK constraint real do banco só aceita `admin, gestor, analista, member, operador` — `'membro'` (português) não existe, é `'member'` (inglês). O insert falha, o código faz rollback (deleta o usuário recém-criado) e retorna erro 500. **"Adicionar Analista" está quebrado em produção agora.** | `server.js:441-444` + CHECK constraint real confirmado no banco |
| `app.js` `init()` (6017-6056) | Nenhum guard restringe roles diferentes de `fornecedor`. Um usuário `operador` (ou `member`, ou role nula) com sessão persistida que abra o SPA cai direto no dashboard/financeiro completo do M1, com `fetchProjects()`/`fetchDocuments()` disparados sem checagem de role. | `app.js:6017-6056` |
| `app.js` `handleSolicitanteUpload` (2469-2494) e `subirParaStorage` (4796-4827) | Nenhum dos dois insere `organization_id` em `documents`. Todo documento enviado por esses dois caminhos nasce com `organization_id = NULL`. A RLS policy de `documents` (`migration_documents_rls.sql:64-78`) só libera para gestor/analista via `organization_id = current_user_org_id()` (fallback só cobre o próprio uploader) — **um gestor pode não ver documentos enviados por membros da própria equipe**, e a função de laudo (`generateLaudoExcel`, `app.js:4604-4609`) filtra `.eq('organization_id', orgId)`, o que em Postgres **exclui silenciosamente** qualquer linha com `organization_id IS NULL` do relatório de conformidade enviado ao MinC. | `app.js:2469-2494`, `4796-4827`, `4604-4609` |
| `modulo2/supabase-helper.js:223-226` (`formatDate`) + `app.js:1909` | `new Date(dateString).toLocaleDateString('pt-BR')` sobre colunas `date` puras (`contracts.data_inicio`, `data_fim`, `documents.data_emissao`) pode exibir o dia anterior dependendo do fuso do navegador (UTC-3 interpreta meia-noite UTC como o dia anterior). Datas de vencimento de contrato e emissão de NF podem aparecer erradas na tela. | `supabase-helper.js:223-226`; call sites em `contratos.html:548,1026,1183,1186`; `app.js:1909` |

### Médios/altos

| Local | Cenário de falha |
|---|---|
| RLS desabilitada em `extratos` (Alto) | Tabela tem `organization_id`, mas o único INSERT do frontend (`app.js:5957-5965`) não o define — fica NULL. Sem RLS, qualquer client autenticado pode ler extratos bancários de **todas** as organizações via console/API direta, não só via UI. |
| RLS desabilitada em `extratos_lancamentos` e `rubricas_uploads` | Sem uso direto encontrado no frontend hoje, mas exposição idêntica via API direta para quem tiver a anon key (que é pública por design do Supabase) |
| `createSignedUrl`/`createSignedUrls` sem `.trim()` em 5 locais (`comprovacao-fisica.html`, `contratos.html`, `impostos.html`, `exportacoes.html`, `prestacao-contas.html`) | Se algum `file_path` no banco tiver espaço/whitespace (ver achado crítico #1, que é a fonte mais provável), o download falha com "objeto não encontrado" |
| `modulo2/rubricas.html:836` — `.update({ status: 'erro' })` em `documents` | `'erro'` não está na lista do CHECK de `documents.status` (o valor correto seria `erro_rpa`) — esse update deve falhar silenciosamente dependendo do tratamento de erro |
| `contracts.status = 'cancelado'` nunca é enviado pelo frontend | O CHECK permite, mas a UI não tem essa opção — funcionalidade de cancelar contrato parece ausente, não é bug ativo, mas é uma lacuna |

### Baixo / sem risco confirmado

- `documents.rubrica_id_fk`: **não é legado** como o usuário supôs — é ativamente usado como gate de transição de status (`aguardando_rubrica` → `aguardando_conciliacao_bancaria`). O legado é só em `physical_evidences.rubrica_id_fk`.
- `physical_evidences.rubrica_id_fk`: confirmado morto no código do M2 atual (main), mas **voltou a ser escrito na branch `feature/modulo-3`** — ver §3.4.
- Botão "Baixar Laudo Excel" só escondido via role no client, sem guard na função chamada — impacto baixo porque os dados já pertencem ao usuário autenticado.

---

## 5. Tabela — Divergência entre branches (PARCIAL — não concluída)

Esta seção não foi auditada por arquivo nesta rodada; os dados abaixo vêm de investigação anterior nesta conversa, não da auditoria formal.

| Branch A | Branch B | Diferença conhecida | Impacto |
|---|---|---|---|
| `main` | `api` (RPA) | `api` tem 39 commits próprios não em `main` (inclui seletores reais do formulário "Comprovação Financeira" do SALIC nos passos 3-12 e busca hierárquica de rubrica por produto) e está 111 commits atrás de `main` | `salic_insertion.cjs` em `main` ainda tem seletores `TODO_SELETOR_*` — a versão funcional está isolada em `api`, não integrada |
| `main` | `feature/modulo-2` | 0 commits à frente, 88 atrás | Já totalmente absorvida por `main` — branch morta, candidata a ser apagada |
| `main` | `feature/modulo-3` | 14 commits próprios, 10 atrás de `main` | Precisa rebase antes de merge; **não foi verificado** quais dos 10 commits que `main` tem e `modulo-3` não tocam nos mesmos arquivos (conflito provável) — pendente |
| `main` | `merge/m2-integration` | 1 commit à frente, 31 atrás | Quase totalmente absorvida — provável candidata a descarte, não confirmado o que o commit único faz |

**Pendente desta auditoria:** diff arquivo-a-arquivo `main` × `api` além do RPA, verificação de conflito real entre os 10 commits exclusivos de `main` e os arquivos tocados por `feature/modulo-3`, e varredura de comentários `TODO`/`FIXME`/blocos comentados em todo o repositório.

---

## 6. Lista de "PRECISA DECISÃO"

1. **`modulo2/portal-solicitante.html`**: apagar (está órfão e quebrado) ou consertar e conectar? Dado que `app.js` já cobre o mesmo caso de uso funcionando, a opção mais simples é apagar — mas confirmar antes se `token_solicitante`/`enviado_via_token` (colunas nunca usadas) eram para um fluxo planejado que ainda querem construir via este arquivo.
2. **5 rotas do `server.js` sem chamador** (`/api/health`, `GET/POST /api/m2/contracts`, `/api/m2/salic/encerrar`, `/api/rubricas/importar`): remover ou documentar por que existem (health check externo? uso futuro planejado?).
3. **Duas telas de admin de solicitantes** (`SolicitantesAdminView` vs `gestao-solicitantes.html`): unificar em uma só (qual módulo fica com ela?) ou manter as duas por serem específicas de cada módulo?
4. **`physical_evidences.rubrica_id_fk` voltando na branch `feature/modulo-3`**: corrigir para `produto_evidencia` antes do merge, ou é intencional que M3 use um vínculo diferente de M2?
5. **Portal do fornecedor para o M3**: estender o dashboard único existente no `app.js`, ou construir uma superfície própria dentro de `modulo3/`? (Recomendação técnica: estender o existente — ver §3.1 — mas é decisão de produto, não só técnica.)
6. **Helpers duplicados** (`formatCurrency`, `formatDate`, `escapeHtml`, `showToast`): vale o esforço de consolidar em `supabase-helper.js` agora, ou só quando o próximo bug de inconsistência aparecer?
7. **Colunas nunca usadas** (`token_solicitante`, `ia_categoria`, `enviada_salic_em`): eram planejadas para algo específico (fluxo de link mágico, categorização por IA)? Se sim, viram trabalho futuro; se não, remover do schema.

---

## 7. Recomendação de priorização

Ordenado por o que pode estar causando **perda ou exposição silenciosa de dados em produção agora**, não por esforço de correção:

1. **Uploads sem `organization_id`** (`handleSolicitanteUpload`, `subirParaStorage`) — cada documento novo enviado por esses caminhos pode estar invisível para o gestor certo e ausente do laudo de conformidade enviado ao MinC. Isso é o mais grave: afeta compliance regulatório, não só UX.
2. **Espaço literal no nome de arquivo** (`app.js:2480`, `4802`) — corrompe o `file_path` de todo upload novo feito por esses dois caminhos, provável causa raiz de falhas do robô SALIC (evidência: o próprio `erro_salic_*.png` já no repo).
3. **`role: 'membro'` inválido** quebrando "Adicionar Analista" — funcionalidade de gestão de equipe quebrada agora, fácil de confirmar e corrigir (é literalmente trocar uma string).
4. **RLS desabilitada em `extratos`** — exposição real de dado bancário sensível entre organizações, mesmo que hoje só a UI não explore isso (API direta explora).
5. **Guard de role ausente para `operador`/outras roles no `init()`** — antes de avançar com M3 (que introduz justamente a role `operador`), vale fechar esse guard, senão o M3 herda a mesma superfície de risco.
6. **`rubrica_id_fk` voltando no M3** — resolver antes do merge da branch, é rápido e evita retrabalho de dado depois que evidências já tiverem sido criadas em produção com o campo errado.
7. Daí pra baixo (helpers duplicados, arquivo órfão, rotas mortas, timezone em datas menos críticas) é debt normal de limpeza — importante, mas sem urgência de produção.
