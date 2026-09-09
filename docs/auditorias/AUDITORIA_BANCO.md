# Auditoria Completa do Banco de Dados Supabase — Cultopps / Prestaí

> Gerada em: 2026-06-17 | Project ID: `ucmahpyxjxqbrvnistrh`
> **Não implementar nenhuma correção sem revisão prévia.**

---

## Mapa das Tabelas (31 no total)

### Grupo 1 — Core Multi-Tenant (Sempre ativos)

| Tabela | Linhas | Tamanho | Uso |
|--------|--------|---------|-----|
| `organizations` | 2 | 48 kB | Cadastro de organizações (clientes). Toda a isolação de dados passa por aqui. |
| `organization_users` | 10 | 64 kB | Vínculo usuário ↔ org com roles (owner, admin, analista, gestor). Trigger sincroniza `app_metadata.org_id` no Auth. |
| `projects` | 5 | 80 kB | Projetos Lei Rouanet (PRONAC). Ponto de agregação central — quase todas as outras tabelas apontam para cá. |

### Grupo 2 — Fluxo Principal M1 (Motor do sistema)

| Tabela | Linhas | Tamanho | Seq/Idx scans | Uso |
|--------|--------|---------|---------------|-----|
| `documents` | 160 | 600 kB | 6.351 / 24.635 | Nota fiscal, recibo, comprovante. Tabela mais ativa. Possui OCR, status de conformidade, vinculação a extratos bancários. |
| `despesas` | 159 | 160 kB | 30.540 / 8.309 | Criada automaticamente via trigger `documents_cria_despesa` quando document atinge status-alvo. Vincula document → rubrica → projeto. |
| `rubricas` | 395 | 448 kB | 711 / 9.718 | Linhas orçamentárias aprovadas por projeto. `valor_utilizado` é recalculado por trigger a cada INSERT/UPDATE/DELETE em `despesas`. |
| `catalogo_rubricas` | 6 | 48 kB | 32 / 577 | Catálogo de tipos de rubrica (templates). **RLS desabilitado** — ver Problemas. |
| `extratos` | 355 | 192 kB | 118 / 707 | Arquivos OFX/PDF/CSV importados. **RLS desabilitado** — ver Problemas. |
| `extratos_lancamentos` | 313 | 360 kB | 664 / 62 | Lançamentos individuais de cada extrato. Conciliação bancária vincula lançamento → document. **RLS desabilitado**. |
| `fornecedores` | 3 | 48 kB | 141 / 172 | Cadastro de fornecedores (CNPJ). O `id` é o próprio UUID do usuário Supabase Auth do fornecedor. |
| `projeto_fornecedores` | 0 | 40 kB | 17.836 / 188 | Vínculo project ↔ fornecedor. Vazio agora mas houve uso (10 inserts, 8 deletes). Performance crítica — ver abaixo. |
| `audit_log` | 1.288 | 384 kB | 24 / 47 | Log de mudanças de status em `despesas` e `documents`. Alimentado por triggers. |
| `external_credentials` | 7 | 48 kB | 74 / 1.065 | Credenciais SALIC criptografadas (PGP). Acessadas via view `decrypted_external_credentials`. |

### Grupo 3 — Módulo 2: Dados SALIC (Ativos, pouco preenchidos)

| Tabela | Linhas | Uso |
|--------|--------|-----|
| `project_salic_imports` | 3 | Cada importação do portal SALIC. Tabela-pai das 4 abaixo. |
| `project_etapas_trabalho` | 3 | Etapas de trabalho importadas do SALIC. |
| `project_locais_realizacao` | 4 | Locais de realização do projeto. |
| `project_deslocamentos` | 6 | Deslocamentos previstos. |
| `project_plano_divulgacao` | 3 | Plano de divulgação. |
| `project_dados_complementares` | 1 | Dados complementares do projeto SALIC. |

### Grupo 4 — Funcionalidades Ativas com Dados Zerados

| Tabela | Linhas | Histórico | Uso |
|--------|--------|-----------|-----|
| `exportacoes_log` | 7 | 12 inserts, 9 updates, 5 deletes | Rastreia PDFs/Excel gerados. Ativa. |
| `project_checklist` | 2 | 3 inserts | Checklist header (1 por projeto) para liberação de envio ao MinC. |
| `checklist_items` | 0 | **0 inserts** | Sub-itens do checklist. Nunca populado — feature incompleta. |
| `physical_evidences` | 0 | 2 inserts, 2 deletes | Upload de fotos/evidências físicas. Usada e limpa. |
| `relatorio_prestacao_contas` | 0 | 25 inserts, 25 deletes | Relatórios gerados e depois excluídos. Ciclo normal. |

### Grupo 5 — Módulo 2: Contratos e Impostos (Schema criado, NUNCA usado)

| Tabela | Linhas | Histórico | Status |
|--------|--------|-----------|--------|
| `contracts` | 0 | **0 inserts** | Feature M2 de contratos — nunca ativada |
| `contract_aditivos` | 0 | **0 inserts** | Aditivos de contrato — nunca ativada |
| `contract_parcelas` | 0 | **0 inserts** | Parcelas de contrato — nunca ativada |
| `tax_guides` | 0 | **0 inserts** | Guias DARF/ISS/INSS — nunca ativada |

### Grupo 6 — Versionamento de Rubricas (Nunca efetivo)

| Tabela | Linhas | Histórico | Status |
|--------|--------|-----------|--------|
| `rubricas_uploads` | 0 | **0 inserts** | Tracking de upload batch — nunca usado |
| `rubricas_readequacoes` | 0 | **0 inserts** | Readequações orçamentárias — nunca registradas |
| `rubricas_versions` | 0 | 2 inserts / 2 deletes | Versionamento — só testado, nunca produtivo |

---

## Storage Buckets

| Bucket | Tipo | Status |
|--------|------|--------|
| `documentos` | Privado | OK — políticas por org |
| `contracts` | Público | PROBLEMA — policy SELECT permite listar todos os arquivos do bucket |
| `tax-guides` | Privado | OK |

---

## Triggers Ativos

| Trigger | Tabela | Função | O que faz |
|---------|--------|--------|-----------|
| `documents_cria_despesa` | `documents` | `trg_documents_cria_despesa` | Cria automaticamente uma `despesa` quando document muda para status-alvo. Resolve rubrica via `find_rubrica_for_document`. |
| `despesas_atualiza_consumo` | `despesas` | `trg_despesas_atualiza_consumo` | Recalcula `rubricas.valor_utilizado` a cada INSERT/UPDATE/DELETE em despesas. |
| `despesas_status_audit` | `despesas` | `trg_despesas_status_audit` | Loga mudanças de status no `audit_log`. |
| `trg_set_document_organization` | `documents` | `set_document_organization` | Preenche `organization_id` automaticamente a partir do project. |
| `trg_sync_org_metadata_insert/update` | `organization_users` | `sync_user_org_metadata` | Sincroniza `org_id` no `auth.users.app_metadata` ao vincular usuário a org. |

---

## View

| View | Descrição | Risco |
|------|-----------|-------|
| `decrypted_external_credentials` | Decripta senhas SALIC com chave hardcoded | SECURITY DEFINER + chave `chave_mestra_cultopps` visível no SQL |

---

## Problemas Encontrados

### 🔴 ERROS DE SEGURANÇA (Supabase Advisor: ERROR)

**1. RLS desabilitado em 4 tabelas públicas:**
- `extratos` — dados bancários de qualquer organização ficam expostos via API
- `extratos_lancamentos` — mesma exposição, com 313 lançamentos reais no banco
- `catalogo_rubricas` — catálogo exposto (baixo risco mas viola padrão)
- `rubricas_uploads` — qualquer usuário autenticado pode ler/escrever uploads de outras orgs

**Correção sugerida:**
```sql
ALTER TABLE extratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE extratos_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_rubricas ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubricas_uploads ENABLE ROW LEVEL SECURITY;

-- Exemplo de policy para extratos (replicar padrão das outras tabelas)
CREATE POLICY "extratos_org_access" ON extratos
  FOR ALL USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "lancamentos_org_access" ON extratos_lancamentos
  FOR ALL USING (
    extrato_id IN (SELECT id FROM extratos WHERE organization_id = current_user_org_id())
  );

-- catalogo_rubricas: leitura pública para autenticados (é um catálogo global)
CREATE POLICY "catalogo_leitura_auth" ON catalogo_rubricas
  FOR SELECT USING (auth.role() = 'authenticated');
```

**2. View `decrypted_external_credentials` com SECURITY DEFINER:**
A view executa como owner do banco (bypassa RLS). Se um usuário acessar a view sem filtro, pode ver credenciais de outros.

Além disso, a chave de decriptação `'chave_mestra_cultopps'` está hardcoded no SQL da view — visível a qualquer pessoa com acesso ao schema.

**Correção sugerida:**
```sql
-- Opção 1: adicionar filtro por user_id na view
CREATE OR REPLACE VIEW decrypted_external_credentials AS
  SELECT user_id, service_name, identifier,
    pgp_sym_decrypt(decode(secret, 'hex'), 'chave_mestra_cultopps') AS secret_plain
  FROM external_credentials
  WHERE user_id = auth.uid();  -- adicionar este filtro

-- Opção 2 (melhor): mover a chave para Supabase Vault
-- e usar vault.decrypted_secrets no lugar da chave hardcoded
```

**3. Política INSERT always-true em `organizations`:**
```sql
-- Atual: WITH CHECK (true) — qualquer auth user pode criar org
-- Corrigir para limitar criação (ex: apenas via service_role ou com convite)
DROP POLICY "Permitir criacao de organizacao" ON organizations;
-- Recriar com regra de negócio adequada
```

---

### ⚠️ AVISOS DE SEGURANÇA (Supabase Advisor: WARN)

**4. 21 funções sem `search_path` fixo (vulnerabilidade a schema injection):**

Funções afetadas: `current_user_org_id`, `has_role`, `has_any_role`, `find_rubrica_for_document`, `recalc_rubrica_valor_utilizado`, `trg_documents_cria_despesa`, `trg_despesas_atualiza_consumo`, `trg_despesas_status_audit`, `set_document_organization`, `log_status_change`, `upsert_external_credential`, `user_organization_ids`, `sync_role_metadata`, `sync_role_to_app_metadata`, `get_my_org`, `same_org`, `update_updated_at_column`, `retry_ocr_stuck_documents`, `map_document_status_to_despesa`, `current_user_role`, `sync_user_org_metadata`.

**Correção sugerida:** Adicionar `SET search_path = public` na definição de cada função:
```sql
-- Exemplo para has_role:
ALTER FUNCTION public.has_role(text) SET search_path = public;
-- Repetir para todas as 21 funções
```

**5. Funções SECURITY DEFINER chamáveis por usuários não autenticados (`anon`):**

As seguintes funções estão expostas via `/rest/v1/rpc/` sem exigir JWT:
`current_user_org_id`, `current_user_role`, `get_my_org`, `has_any_role`, `has_role`, `log_status_change`, `recalc_rubrica_valor_utilizado`, `same_org`, `sync_role_metadata`, `sync_role_to_app_metadata`, `trg_despesas_atualiza_consumo`, `trg_despesas_status_audit`, `trg_documents_cria_despesa`, `upsert_external_credential`, `user_organization_ids`.

**Correção sugerida:**
```sql
-- Revogar acesso anon nas funções que não devem ser públicas
REVOKE EXECUTE ON FUNCTION public.current_user_org_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(VARIADIC text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_org() FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_external_credential(text, text, text) FROM anon;
-- etc. para todas as listadas acima
```

**6. Bucket `contracts` permite listagem de todos os arquivos:**
Policy `Authenticated users can read contracts files` é muito ampla — permite ver arquivos de outras orgs.

**7. Proteção de senhas vazadas desabilitada:**
HaveIBeenPwned não está ativado no Supabase Auth. Ativar em: Dashboard → Auth → Providers → Password → Enable Leaked Password Protection.

---

### 🟡 REDUNDÂNCIAS E DUPLICATAS

**8. Índice duplicado em `projects.organization_id`:**
```sql
-- Dois índices idênticos na mesma coluna:
-- idx_projects_org       → btree(organization_id)
-- idx_projects_org_id    → btree(organization_id)  ← duplicata
DROP INDEX public.idx_projects_org;  -- ou o idx_projects_org_id
```

**9. Índice duplicado em `project_checklist.project_id`:**
```sql
-- idx_checklist_project              → btree(project_id) não-único
-- project_checklist_project_id_key   → btree(project_id) único  ← já cobre buscas
DROP INDEX public.idx_checklist_project;
```

**10. Redundância `rubrica` (texto) + `rubrica_id_fk` (FK) em `documents`:**
- `documents.rubrica` = nome vindo do OCR (ex: "Produção")
- `documents.rubrica_id_fk` = UUID da rubrica resolvida
- São dois campos para a mesma informação. O texto serve de fallback para o trigger `find_rubrica_for_document`.
- **Não remover por ora** — o texto é necessário para a resolução automática. Apenas documentar.

---

### 🟡 PROBLEMAS DE PERFORMANCE

**11. `despesas` com 30.540 seq_scans:**
Falta índice em `rubrica_id`. Joins de despesas → rubricas ocorrem sem suporte de índice.
```sql
CREATE INDEX idx_despesas_rubrica ON public.despesas(rubrica_id);
```

**12. `projeto_fornecedores` com 17.836 seq_scans e 0 linhas:**
A tabela está vazia mas o código continua consultando-a. Provável polling desnecessário no frontend quando não há fornecedor vinculado. Investigar no `app.js` / `server.js` se há verificação de existência sem early-return.

**13. `contracts` (578 seq_scans) e `tax_guides` (366 seq_scans) — tabelas com 0 inserts:**
O M2 consulta essas tabelas continuamente mesmo nunca tendo inserido dados. Indica que o `financeiro.html` ou `contratos.html` faz loading automático sem verificar se a feature está ativa.

---

## Tabelas Candidatas à Remoção

### Fortes candidatas (nunca tiveram dados reais)
| Tabela | Motivo |
|--------|--------|
| `checklist_items` | Feature do checklist nunca implementada no frontend |
| `rubricas_uploads` | Substituído por lógica direta no n8n |
| `rubricas_readequacoes` | Feature de readequação não implementada |
| `rubricas_versions` | Versionamento nunca efetivo (2 inserts de teste, 2 deletes) |

### Candidatas condicionais (depende do roadmap do M2)
| Tabela | Condição para remover |
|--------|----------------------|
| `contracts` | Se feature de contratos do M2 for descontinuada |
| `contract_aditivos` | Idem |
| `contract_parcelas` | Idem |
| `tax_guides` | Se feature de guias fiscais do M2 for descontinuada |

**Recomendação:** Confirmar com o roadmap do produto antes de qualquer DROP TABLE. As tabelas de contratos/impostos têm schema bem definido e podem estar planejadas para implementação futura.

---

## Plano de Correção (Priorizado)

### Prioridade 1 — Segurança Crítica
- [ ] Habilitar RLS em `extratos`, `extratos_lancamentos`, `catalogo_rubricas`, `rubricas_uploads`
- [ ] Criar políticas para `extratos` e `extratos_lancamentos` baseadas em `organization_id`
- [ ] Adicionar `WHERE user_id = auth.uid()` à view `decrypted_external_credentials`
- [ ] Mover a chave `chave_mestra_cultopps` para Supabase Vault

### Prioridade 2 — Segurança Moderada
- [ ] Adicionar `SET search_path = public` nas 21 funções listadas
- [ ] `REVOKE EXECUTE FROM anon` nas funções que não devem ser públicas
- [ ] Restringir política INSERT de `organizations`
- [ ] Ativar proteção de senhas vazadas no Auth Dashboard

### Prioridade 3 — Performance
- [ ] `CREATE INDEX idx_despesas_rubrica ON despesas(rubrica_id);`
- [ ] Investigar polling de `projeto_fornecedores` no frontend
- [ ] Investigar loading automático de `contracts` e `tax_guides` no M2

### Prioridade 4 — Limpeza
- [ ] `DROP INDEX idx_projects_org;`
- [ ] `DROP INDEX idx_checklist_project;`
- [ ] Decidir com o produto: manter ou remover tabelas M2 sem uso

---

## Verificação das Correções

```bash
# 1. Após habilitar RLS — testar com anon key que retorna 0 rows:
curl -H "apikey: ANON_KEY" https://ucmahpyxjxqbrvnistrh.supabase.co/rest/v1/extratos
# Esperado: []

# 2. Após criar índice em despesas.rubrica_id — verificar uso:
EXPLAIN ANALYZE SELECT * FROM despesas WHERE rubrica_id = 'UUID_AQUI';
# Esperado: Index Scan (não Seq Scan)

# 3. Após revogar anon — testar que RPC retorna 401:
curl https://ucmahpyxjxqbrvnistrh.supabase.co/rest/v1/rpc/current_user_org_id
# Esperado: {"message":"JWT required"}

# 4. Reexecutar advisors após fixes para confirmar que ERRORs foram resolvidos
```
