# DATABASE.md — Referência de Schema (Prestaí / Cultopps)

## Como este documento foi gerado

Este documento foi gerado a partir de **consulta real ao banco de dados Supabase/Postgres em produção**, em **10/09/2026**, via MCP Supabase (`list_tables`, `execute_sql` sobre `information_schema`, `pg_policies`, `pg_constraint`, e `get_advisors`).

- Projeto Supabase: `CULTOPPS-AIDA` (ref `ucmahpyxjxqbrvnistrh`), região `us-east-1`, Postgres 17.6, status `ACTIVE_HEALTHY`.
- Todas as tabelas, colunas, tipos, defaults, CHECK constraints (enums), foreign keys e políticas RLS listados abaixo foram lidos diretamente do catálogo do Postgres nessa data — **não** foram inferidos a partir dos arquivos `setup.sql`/`migration_*.sql` do repositório.
- Nenhuma operação de escrita foi executada (somente `SELECT`/introspecção). Nenhum arquivo do repositório foi alterado além deste.
- `AUDITORIA_BANCO.md` (17/06) e `AUDITORIA_CODIGO.md` foram usados apenas como ponto de partida para saber o que checar — os achados aqui são validados contra o estado atual do banco, não copiados desses documentos.
- Este documento reflete apenas o schema `public`. Funções, triggers e schema `auth`/`storage` são mencionados apenas quando relevantes para entender um relacionamento (ex.: `auth.users`).

---

## Achado de risco — RLS desabilitada (destaque, não perder no meio do texto)

O advisor de segurança do Supabase (`get_advisors`, consultado nesta mesma data) aponta **2 tabelas com Row Level Security DESABILITADA**, expostas por completo às roles `anon`/`authenticated` via PostgREST:

| Tabela | RLS | Risco |
|---|---|---|
| `public.catalogo_rubricas` | **DESABILITADA** | Baixo risco de dado sensível (é um catálogo de referência, 6 linhas, sem `organization_id` — parece intencional/global), mas hoje qualquer usuário autenticado (ou até anônimo, se a chave `anon` alcançar a API REST) pode ler/escrever a tabela sem controle algum. |
| `public.rubricas_uploads` | **DESABILITADA** | **Risco real**: tabela tem `project_id` e `user_id`, guarda histórico de uploads de planilha de rubricas por projeto — é dado por-organização sem isolamento nenhum. Hoje 0 linhas em produção, mas qualquer usuário autenticado pode ler/escrever uploads de **qualquer** projeto de **qualquer** organização. |

**Atualização em relação à auditoria anterior:** o `AUDITORIA_CODIGO.md` apontava RLS desabilitada também em `extratos` e `extratos_lancamentos`. Isso **já foi corrigido** — na consulta atual ambas as tabelas têm RLS habilitada e a policy `..._org_access` restringindo por `organization_id` + papel (admin/gestor/analista). Apenas `catalogo_rubricas` e `rubricas_uploads` seguem sem RLS.

Outros achados do advisor de segurança (menor severidade, não é o foco deste documento mas vale registro):
- 36 funções com `search_path` mutável (risco de search_path hijacking) — inclui funções centrais como `has_role`, `current_user_org_id`, `find_rubrica_for_document`.
- 27 funções `SECURITY DEFINER` executáveis por `anon`/`authenticated` via RPC — a maioria são helpers de RLS (`has_role`, `same_org` etc.), mas vale revisão caso a caso.
- Proteção contra senha vazada (HaveIBeenPwned) desabilitada no Auth.
- Extensões `pg_trgm` e `pg_net` instaladas no schema `public` (deveriam ir para um schema dedicado).

---

## Visão geral

39 tabelas no schema `public`. Multi-tenant por `organization_id` (praticamente toda tabela de domínio carrega essa coluna e é isolada por RLS comparando com `current_user_org_id()`). Papéis de usuário (`organization_users.role`): `admin`, `gestor`, `analista`, `member`, `operador`, `fornecedor`.

---

## 1. Multi-tenant / Auth

### `organizations`
Organização (tenant) do sistema — unidade de isolamento de dados.
- `id` (uuid, PK), `nome`, `slug` (unique), `modulos` (text[], quais módulos a org tem habilitado), `ativo` (bool), `criado_em`.
- RLS: habilitada. Policies: leitura restrita a `id IN user_organization_ids()` (membro da org).

### `organization_users`
Vínculo usuário ↔ organização, com papel (role).
- PK composta (`organization_id`, `user_id`). FK `user_id` → `auth.users`.
- `role` (text) — **enum via CHECK**: `admin | gestor | analista | member | operador | fornecedor`.
- RLS: habilitada. Insert: só o próprio usuário se auto-associa (`user_id = auth.uid()`); Select: membros da mesma org ou o próprio registro.

### `external_credentials`
Credenciais externas por usuário (ex.: token de serviço terceiro tipo CNPJá).
- `user_id` (FK auth.users), `service_name`, `identifier`, `secret`.
- RLS: habilitada. Policy única: usuário só gerencia as próprias (`auth.uid() = user_id`).
- Nota: existe função `upsert_external_credential` e `has_external_credential` (SECURITY DEFINER, callable por anon/authenticated — revisar exposição).

### `audit_log`
Log de auditoria genérico de mudanças de campo em várias tabelas (documents, contracts, physical_evidences, extratos, tax_guides, despesas).
- `tabela`, `registro_id`, `campo`, `valor_anterior`, `valor_novo`, `alterado_por` (FK auth.users), `origem`.
- RLS: habilitada. Policy `audit_log_org_access` filtra por join com a tabela referenciada e `organization_id = current_user_org_id()`; policy adicional restringe log de `auth.users` a `gestor`.
- 1982 linhas em produção — tabela ativa.

---

## 2. Projetos / Rubricas

### `projects`
Projeto cultural (uma proposta aprovada na Lei Rouanet/PRONAC).
- `id`, `user_id` (FK auth.users), `organization_id` (FK organizations), `pronac`, `nome`, `propoente`, `Mecanismo`, `uf`, `valor_aprovado`/`valor_captado` (text — não numeric), `codigo_projeto_contrato`.
- `status_prestacao` (text) — **enum**: `em_execucao | em_encerramento | enviado_minc | aprovado`.
- `checklist_liberado` (bool), `data_inicio_encerramento`, `data_envio_minc`, `protocolo_encerramento_salic`, `tentativas_rpa_encerramento`.
- RLS: habilitada. Select/Insert/Update/Delete por `organization_id = current_user_org_id()` (+ `user_id = auth.uid()` em update/delete); policy extra dá ao fornecedor visão de projetos aos quais foi convidado via `projeto_fornecedores`.
- Tabela central — praticamente todas as demais tabelas de domínio têm FK para `projects.id`.

### `catalogo_rubricas`
Catálogo global de referência de tipos de rubrica (não é por-projeto).
- `id`, `nome` (unique), `especificacoes`, `cnaes_permitidos` (text[]), `valor_maximo_percentual`, `exige_pessoa_juridica` (bool), `ativo` (bool).
- **RLS: DESABILITADA** (ver seção de risco acima). Sem `organization_id` — parece ser catálogo global mesmo, mas hoje sem controle de escrita.

### `rubricas`
Rubrica orçamentária de um projeto (linha do orçamento aprovado, ex.: "Cachês", "Divulgação").
- `id`, `project_id` (FK projects), `organization_id` (FK organizations), `nome`, `codigo`, `rubrica_id` (numeric — código externo/SALIC), `etapa`, `produto`, `uf_municipio`, `unidade`, `quantidade`, `valor_unitario`.
- `valor_aprovado`, `valor_utilizado` (mantido por trigger `recalc_rubrica_valor_utilizado`/`trg_despesas_atualiza_consumo` a partir de `despesas`), `valor_captado`.
- `alerta_limite_ativo` (bool, default true), `percentual_alerta` (numeric, default 90.00) — dispara alerta de estouro de rubrica.
- `origem`, `fonte`, `upload_id`/`upload_versao`, `versao_atual` — suporte a versionamento de rubricas (ver `rubricas_versions`/`rubricas_uploads`).
- RLS: habilitada. Policy `rubricas_org_access` (ALL) por `project_id IN (projects da org)`.
- 303 linhas.

### `rubricas_versions`
Snapshot de versão de uma planilha de rubricas importada (nome da versão, arquivo, total de rubricas daquela versão).
- `project_id` (FK projects), `version_name`, `file_path`, `total_rubricas`.
- RLS: habilitada, policy `rubricas_versions_org_access` por projeto da org.
- 0 linhas em produção no momento da consulta.

### `rubricas_uploads`
Log de cada upload de planilha de rubricas (resultado do processamento: quantas encontradas/importadas/atualizadas/duplicadas).
- `project_id` (FK projects), `user_id` (FK auth.users), `file_path`, `versao`, `status` — **enum**: `processing | success | error`.
- **RLS: DESABILITADA** — risco (ver seção de risco acima). 0 linhas em produção.

### `rubricas_readequacoes`
Histórico de readequação (remanejamento) de valor de uma rubrica.
- `organization_id`, `rubrica_id` (FK rubricas), `project_id` (FK projects), `versao`, `valor_anterior`, `valor_novo`, `motivo`, `aprovado_em`, `criado_por` (FK auth.users).
- RLS: habilitada, policy por projeto da org. 0 linhas.

---

## 3. Documentos / Despesas

### `documents`
Documento fiscal enviado (NF, recibo, guia, RPA, fatura, cupom) — coração do fluxo de OCR → conformidade → conciliação → SALIC.
- `id`, `user_id`, `project_id`, `organization_id`, `fornecedor_id` (FK fornecedores), `rubrica_id_fk` (FK rubricas).
- `name`, `file_path`, `size` (text), `valor`, `valor_pago`, `cnpj_emissor`, `nome_emissor`, `numero_nf`, `data_emissao`, `data_pagamento`, `autenticacao_bancaria`, `confianca_ocr`, `json_extraido` (jsonb).
- `status` (text) — **enum extenso, ciclo de vida do documento**: `uploaded | processing_ocr | validating | validated | aguardando_conformidade | aguardando_comprovante | aguardando_conciliacao_bancaria | aguardando_d3 | liberado_rpa_airtop | enviado_salic | concluido | erro_rpa | bloqueado_conformidade | revisao_manual | divergencia_valor | divergencia_beneficiario | aguardando_rubrica | aguardando_aprovacao_fornecedor | rejeitado_fornecedor`.
- `subtipo_documento` (text) — **enum**: `nf | recibo | rpa | guia | fatura | cupom_fiscal` (mapeia para "Tipo Comprovante" do SALIC: cupom_fiscal=1, guia=2, nf/fatura=3, recibo=4, rpa=5).
- `nivel_duplicidade` (text) — **enum**: `confirmada | possivel` (NULL = sem duplicidade). `duplicata_de_id` (self-FK) aponta para outro membro do grupo de duplicidade. `duplicidade_revisada` (bool).
- `extrato_origem_id` (FK extratos) — extrato de origem no upload em lote (distinto do vínculo lançamento-a-lançamento feito depois em `extratos_lancamentos.document_id`).
- `nf_vinculada_id` (self-FK) — vínculo NF↔comprovante de pagamento.
- Fluxo de aprovação de fornecedor: `motivo_rejeicao_fornecedor`, `aprovado_por` (FK auth.users), `aprovado_em`.
- RLS: habilitada, múltiplas policies: fornecedor vê/insere os próprios docs (`auth.uid() = fornecedor_id` ou via `fornecedores.auth_user_id`); admin/gestor/analista da org têm acesso amplo (`documents_admin_org`, `documents_gestor_org`, `documents_analista_org` restrita a `user_id = auth.uid()`); gestor de projeto (`documents_gestor_projeto_org`) via `projects.user_id`.
- **Nota importante (memória do projeto)**: a resolução documento→rubrica é feita pelo trigger `documents_cria_despesa` → `find_rubrica_for_document`, **só no banco**, não no n8n/código de aplicação.
- 205 linhas.

### `despesas`
Despesa formal criada a partir de um documento validado (1:1 com `documents` via `document_id` unique) — é o registro que efetivamente consome rubrica e segue para conciliação/SALIC.
- `document_id` (FK documents, unique), `rubrica_id` (FK rubricas), `project_id`, `organization_id`, `valor`, `cnpj_fornecedor`, `cnae_fornecedor`, `fornecedor_nome`.
- `status` (text) — **enum**: `aguardando_ocr | aguardando_conformidade | bloqueado_conformidade | aguardando_conciliacao_bancaria | aguardando_d3 | liberado_rpa_airtop | enviado_salic | erro_rpa | concluido`.
- `status_conformidade` (text) — **enum**: `ok | bloqueado | pendente`. `motivo_bloqueio`.
- `metodo_conciliacao` (text) — **enum**: `autenticacao | valor_data_nome | NULL`.
- `conciliado` (bool), `liberado_rpa` (bool), `extrato_vinculado_id`, `tentativas_rpa`, `protocolo_salic`, datas de conciliação/liberação/salic.
- RLS: habilitada. Policy única `despesas_org_access` (ALL) por `project_id IN (projects da org)`.
- 197 linhas.

### `fornecedores`
Cadastro de fornecedor/prestador (pessoa física ou jurídica) que emite documentos/contratos.
- `id`, `organization_id`, `cnpj`, `razao_social`, `nome_fantasia`, `email`, `telefone`, dados de endereço, `cnae_codigo/descricao`, `situacao_cadastral`.
- `dados_completos` (bool) — false = criado automaticamente via OCR (nome provisório); true = revisado via busca CNPJá.
- `nome_salic` — razão social como o SALIC conhece o CNPJ (pode divergir de `razao_social` e de `documents.nome_emissor`).
- `existe_no_salic` (bool, nullable) — NULL = nunca verificado; atenção: API do SALIC mascara CPF, confiável só para CNPJ.
- `auth_user_id` (FK auth.users) — permite ao fornecedor logar e acessar seu próprio portal (Solicitante).
- `cnpj_invalido` (bool).
- RLS: habilitada. Fornecedor gerencia o próprio registro (`auth.uid() = id` ou `= auth_user_id`); equipe da org (admin/gestor/analista) cadastra/atualiza; select amplo por org.
- 104 linhas.

### `projeto_fornecedores`
Vínculo N:N projeto ↔ fornecedor (fornecedores convidados/participantes de um projeto), com gestor responsável.
- `project_id` (FK projects), `fornecedor_id` (FK fornecedores), `gestor_id` (FK auth.users).
- RLS: habilitada. Equipe da org gerencia (via `projeto_pertence_a_org_atual`); fornecedor vê os próprios vínculos.
- 13 linhas.

### `tax_guides`
Guia de imposto (DARF, ISS, INSS etc.) vinculada a um projeto/documento.
- `project_id`, `organization_id`, `document_id` (FK documents), `gestor_id` (FK auth.users).
- `tipo_imposto` (text) — **enum**: `DARF | ISS | INSS | PIS | COFINS | CSLL | outro`.
- `status` (text) — **enum**: `pendente | paga | atrasada | cancelada`.
- `valor` — CHECK `valor > 0`. `codigo_receita`, `numero_guia`, `competencia`, `data_vencimento`, `data_pagamento`, `motivo_cancelamento`.
- RLS: habilitada, policies por `organization_id = current_user_org_id()`.
- 4 linhas.

### `exportacoes_log`
Log de exportações geradas (CSV, Excel, ZIP, relatório de auditoria).
- `project_id`, `organization_id`, `gerado_por` (FK auth.users).
- `tipo` (text) — **enum**: `csv | excel | zip | auditoria`.
- `status` (text) — **enum**: `gerando | pronto | erro`.
- RLS: habilitada, policies por org. 13 linhas.

---

## 4. Contratos

### `contracts`
Contrato firmado com um fornecedor no âmbito de um projeto.
- `organization_id`, `project_id`, `fornecedor_id` (FK fornecedores), `rubrica_id` (FK rubricas, nullable), `contrato_pai_id` (self-FK — contrato originado de um "pai").
- `numero`, `objeto`, `valor_total`, `data_inicio`, `data_fim`, `arquivo_path`, `observacoes`.
- `status` (text) — **enum**: `ativo | encerrado | suspenso | cancelado | rescindido`.
- Soft delete: `excluido_em`/`excluido_por` — quando preenchido, o contrato não deve aparecer em nenhuma listagem/relatório/export; **distinto** de `status=cancelado` (estado de negócio, não exclusão).
- RLS: habilitada. Select/Insert por org; Update restrito a `admin|gestor|analista`; Delete restrito a `gestor`.
- 47 linhas.

### `contract_parcelas`
Parcela de pagamento de um contrato.
- `contract_id` (FK contracts), `project_id`, `organization_id`, `document_id` (FK documents, vínculo ao comprovante de pagamento).
- `numero`, `valor`, `data_vencimento`, `data_pagamento`.
- `status` (text) — **enum**: `pendente | paga | atrasada | cancelada`.
- RLS: habilitada, policies por projeto da org (sem policy de DELETE explícita listada). 0 linhas.

### `contract_aditivos`
Aditivo contratual (alteração de prazo, valor, objeto etc.).
- `contract_id` (FK contracts), `project_id`, `organization_id`, `criado_por` (FK auth.users).
- `tipo` (text) — **enum**: `prazo | valor | objeto | supressao | rescisao | outros`.
- `descricao`, `data_aditivo`, `nova_data_fim`, `novo_valor`, `arquivo_path`.
- RLS: habilitada, policies de select/insert por projeto da org. 1 linha.

---

## 5. Evidências Físicas

### `physical_evidences`
Evidência física de execução do projeto (foto, relatório de objeto, peça de marketing, acessibilidade), possivelmente vinculada a um evento de contrapartida.
- `organization_id`, `project_id`, `distribution_event_id` (FK distribution_events), `rubrica_id_fk` (FK rubricas — **legado**, mantido para compatibilidade; novos inserts usam `produto_evidencia`).
- `tipo_evidencia` (text) — **enum**: `foto_evento | relatorio_objeto | peca_marketing | acessibilidade | outros`.
- `file_path`, `file_name`, `file_size`, `mime_type`, `enviado_por` (FK auth.users), `enviado_via_token`/`token_solicitante` (upload por link externo, sem login).
- `status_validacao` (text) — **enum**: `pendente | aprovada | reprovada | pendente_complemento | enviada_salic | erro_rpa`. `validado_por`, `validado_em`, `motivo_reprovacao`.
- `ia_categoria`/`ia_score` — classificação automática. `data_captura` (data real do registro, distinta de `criado_em`).
- RLS: habilitada. Select: quem enviou ou membro da org; Insert: `enviado_por = auth.uid()`; Update: `admin|gestor|analista` da org; Delete: só quem enviou, e só se `status_validacao = pendente`.
- 148 linhas.

---

## 6. Extratos / Conciliação

### `extratos`
Extrato bancário importado (OFX/CSV/PDF) para conciliação.
- `project_id`, `user_id` (FK auth.users), `organization_id`, `file_path`.
- `formato` (text) — **enum**: `ofx | csv | pdf`.
- `periodo_inicio`, `periodo_fim`, `saldo_final`, `status` (texto livre, default `processando`).
- `vinculo_lote_ativo` (bool) — só um extrato por `project_id+user_id` fica `true` por vez; documentos entrando na fila de Upload em Lote herdam este extrato via `documents.extrato_origem_id`.
- RLS: **habilitada** (corrigido desde a auditoria de código anterior). Policy `extratos_org_access` (ALL) por `project_id IN (projects da org)` **e** papel `admin|gestor|analista`.
- 227 linhas.

### `extratos_lancamentos`
Lançamento individual dentro de um extrato, com vínculo opcional a um documento (conciliação lançamento-a-lançamento).
- `extrato_id` (FK extratos), `project_id`, `document_id` (FK documents, nullable).
- `fitid` (identificador único do lançamento OFX), `tipo`, `valor`, `data_lancamento`, `memo`, `status_conciliacao` (texto livre, default `pendente`).
- RLS: **habilitada** (corrigido). Policy `extratos_lancamentos_org_access` (ALL) igual à de `extratos`.
- 229 linhas.

---

## 7. Módulo 3 / Contrapartidas (Distribuição de Ingressos e Relatórios)

### `distribution_os` / `distribution_pa`
Cadastro de Organização Social (OS) e Poder Público (PA) — entidades beneficiárias de cotas de contrapartida.
- `organization_id`, `nome`, `cnpj`, `email`, `telefone`, endereço/geolocalização (`lat`/`lon`), dados de coordenador, `bairro` (via CEP).
- RLS: habilitada, `org_isolation` (ALL) por `organization_id = current_user_org_id()`.
- `distribution_os`: 4 linhas. `distribution_pa`: 4 linhas.

### `distribution_events`
Evento de contrapartida cultural vinculado a um projeto.
- `organization_id`, `project_id` (FK projects), `created_by`/`excluido_por` (FK auth.users).
- `tipo` (text) — **enum**: `cultural | esportivo | outro`.
- `tipo_acesso` (text) — **enum**: `ingresso | livre` (livre = contabilizado por check-in real em `distribution_guests`, não consome cota `ingressos_os`/`ingressos_pa`).
- `status` (text) — **enum**: `rascunho | ativo | encerrado | cancelado`.
- `relatorio_status` (text) — **enum**: `pendente | preenchido | gerado`.
- Campos de relatório de evento: `resumo_evento`, `publico_por_dia` (jsonb), `perfil_publico`, `acoes_acessibilidade`, `numero_fornecedores`, `empregos_gerados`, `acoes_ambientais`, `desafios_evento`, links de bordero/fotos/materiais (jsonb).
- Soft delete: `excluido_em`/`excluido_por` (evento excluído não aparece em listagem/KPI/relatório/PWA; exclusão só via rota que exige papel gestor/admin — a RLS por si só não bloquearia operador).
- RLS: habilitada, `org_isolation` por organização.
- 8 linhas.

### `distribution_atividades`
Atividade/sessão de um evento (para eventos com múltiplas sessões).
- `event_id` (FK distribution_events), `organization_id`, `criado_por` (FK auth.users).
- RLS: habilitada. Cadastro exclusivo de admin/gestor; operador/PWA apenas leem (comentário oficial na tabela).
- 3 linhas.

### `distribution_event_os` / `distribution_event_pa`
Alocação de cota de ingressos de um evento para uma OS/PA específica, com fluxo de convite.
- `event_id`, `os_id`/`pa_id`, `organization_id`, `ingressos_alocados`.
- `status` (text) — **enum** (mesmo enum nas duas tabelas): `pendente | convite_enviado | confirmado | recusado | lista_enviada | concluido`.
- RLS: habilitada, `org_isolation` por organização. 1 linha cada.

### `distribution_guests`
Convidado/participante com check-in em um evento — dado sensível (CPF, LGPD).
- `event_id`, `os_id`/`pa_id` (nullable), `atividade_id` (FK distribution_atividades, nullable), `organization_id`.
- `nome_completo`, `cpf`, `rg`, `telefone`, `lgpd_consent` (bool) + `lgpd_consent_at`.
- **CHECK** `cpf_requires_lgpd`: `cpf IS NULL OR lgpd_consent = true` — não permite gravar CPF sem consentimento LGPD.
- **CHECK** `distribution_guests_tipo_consistente`: garante consistência entre `tipo_entrada` (`os`/`pa`/`publico_geral`) e os campos `os_id`/`pa_id` preenchidos.
- `checkin_em`, `checkin_por` (FK auth.users).
- RLS: habilitada, `org_isolation` + policies extras de insert/update/delete por organização.
- 2 linhas — dado sensível (CPF), mas RLS ativa e isolada por org.

### `distribution_attendance`
Upload de lista de presença real de um evento (arquivo + total de presentes).
- `event_id`, `organization_id`, `file_path`, `total_presentes`, `uploaded_by` (FK auth.users).
- RLS: habilitada, `org_isolation` por organização. 2 linhas.

### `distribution_monthly_reports`
Relatório mensal de execução de contrapartidas (métricas de comunicação, custos por evento, assinatura).
- `project_id`, `organization_id`, `criado_por` (FK auth.users).
- `status` (text) — **enum**: `rascunho | finalizado`.
- Métricas de comunicação (seguidores, interações, alcance, mídia espontânea), `custos_por_evento` (jsonb).
- RLS: habilitada, policies por organização. 1 linha.

---

## 8. Dados Complementares do Projeto (importação SALIC)

Tabelas populadas a partir de uma importação do PRONAC via SALIC (ver `project_salic_imports`), todas com FK opcional `import_id` de rastreabilidade e todas RLS-isoladas por `project_id IN (projects da org)`.

### `project_salic_imports`
Registro de uma importação de dados do SALIC para um projeto.
- `organization_id`, `project_id`, `file_path`, `status` (text) — **enum**: `pendente | processando | processado | erro`. `dados_extraidos` (jsonb), `erro_mensagem`, `importado_por`, `revisado_por`/`revisado_em`.
- É a tabela "pai" das cinco abaixo (todas apontam `import_id` para ela).
- 2 linhas.

### `project_dados_complementares`
Dados complementares do projeto (síntese, objetivos, justificativa, produtos, ficha técnica) — 1:1 (lógico) com `projects` via `project_id`.

### `project_etapas_trabalho`
Etapas de trabalho/cronograma do projeto (nome, duração, objetivo, atividades em jsonb, ordem).

### `project_locais_realizacao`
Locais de realização do projeto (país/UF/cidade).

### `project_deslocamentos`
Deslocamentos previstos (origem/destino UF+cidade, quantidade).

### `project_plano_divulgacao`
Plano de divulgação/mídia do projeto (tipo de mídia, veículo, quantidade).

*(Todas as seis tabelas acima: RLS habilitada, policies simétricas select/insert/update/delete por `project_id IN (projects da org)`.)*

---

## 9. Checklist / Prestação de Contas

### `project_checklist`
Checklist agregado de um projeto (contador de itens, liberação para envio ao MinC, autorização de acesso fiscal).
- `project_id` (unique, FK projects), `organization_id`, `total_itens`, `itens_ok`, `liberado_envio_minc` (bool), `acesso_fiscal_autorizado` (bool) + `acesso_fiscal_confirmado_por`/`_em`/`_nome`.
- RLS: habilitada, policies por projeto da org. 2 linhas.

### `checklist_items`
Item individual do checklist de prestação de contas.
- `checklist_id` (FK project_checklist), `project_id`, `organization_id`.
- `categoria` (text) — **enum**: `financeiro | fisico | impostos | contratos | rpa | diligencias`.
- `status` (text) — **enum**: `ok | bloqueado | pendente | nao_aplicavel`.
- `codigo`, `descricao`, `link_resolucao`.
- RLS: habilitada, policies por projeto da org. 0 linhas.

### `relatorio_prestacao_contas`
Versão gerada do relatório final de prestação de contas de um projeto.
- `project_id`, `organization_id`, `versao`, `gerado_por`/`autorizado_por` (FK auth.users), `data_autorizacao`.
- `status` (text) — **enum**: `gerando | pronto | autorizado | substituido | erro`.
- RLS: habilitada, policies por org. 0 linhas.

---

## Resumo de relacionamentos (FKs principais)

- `organizations` é a raiz do isolamento multi-tenant: quase toda tabela de domínio tem `organization_id → organizations.id`.
- `projects.organization_id → organizations`; praticamente todas as tabelas de projeto (rubricas, documents, despesas, contracts, extratos, checklist, distribution_*, project_salic_imports e derivadas) têm `project_id → projects.id`.
- Fluxo documento → despesa: `documents.id ← despesas.document_id` (1:1, unique); `despesas.rubrica_id → rubricas.id`; `despesas.rubrica_id` é resolvido pelo trigger de banco `trg_documents_cria_despesa`/`find_rubrica_for_document` (não em código de aplicação/n8n).
- Fluxo contrato: `contracts.fornecedor_id → fornecedores.id`; `contracts.rubrica_id → rubricas.id`; `contract_parcelas.contract_id → contracts.id`; `contract_aditivos.contract_id → contracts.id`; `contracts.contrato_pai_id` é self-FK.
- Fluxo conciliação: `extratos_lancamentos.extrato_id → extratos.id`; `extratos_lancamentos.document_id → documents.id` (vínculo lançamento-a-lançamento); `documents.extrato_origem_id → extratos.id` (vínculo de origem no upload em lote) — **são conceitos distintos**, conforme comentário oficial da coluna no banco.
- Fluxo evidências/contrapartidas: `physical_evidences.distribution_event_id → distribution_events.id`; `distribution_guests.event_id/os_id/pa_id/atividade_id` conectam convidado a evento e cota; `distribution_event_os`/`distribution_event_pa` são tabelas de associação evento↔cota.
- Fluxo SALIC/PRONAC: `project_salic_imports.id` é referenciado por `project_dados_complementares`, `project_etapas_trabalho`, `project_locais_realizacao`, `project_deslocamentos`, `project_plano_divulgacao` via `import_id`.
