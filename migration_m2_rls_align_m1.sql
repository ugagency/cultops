-- ═══════════════════════════════════════════════════════════════════
-- migration_m2_rls_align_m1.sql
--
-- Alinha as policies do M2 ao padrão multi-tenant do M1:
--   organization_id = public.current_user_org_id()
--   has_role(...) / has_any_role(...)
--
-- INVARIANTES respeitados:
--   INV-01 organization_id NUNCA NULL (UPDATE de catch-up em exportacoes_log)
--   INV-02 org_id vem do JWT app_metadata.org_id
--   INV-04 usuário pertence a UMA organização
--   INV-05 gestor nunca vê dados de outra org
--   INV-08 service_role_key nunca no frontend
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO (opcional — descomente para inspecionar antes de aplicar)
-- ───────────────────────────────────────────────────────────────────

-- 1) Helpers SQL do M1 (esperado: 6 linhas)
-- SELECT routine_name
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'current_user_org_id',
--     'current_user_role',
--     'has_role',
--     'has_any_role',
--     'same_org',
--     'user_organization_ids'
--   )
-- ORDER BY routine_name;

-- 2) Policies atuais do M2
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'contracts','contract_parcelas','contract_aditivos',
--     'physical_evidences','tax_guides','rubricas_readequacoes',
--     'project_checklist','checklist_items',
--     'relatorio_prestacao_contas','exportacoes_log'
--   )
-- ORDER BY tablename, cmd;


-- ═══════════════════════════════════════════════════════════════════
-- BACKFILL — garante organization_id em registros antigos antes das
-- novas policies entrarem em vigor (INV-01). Tabelas que já têm a
-- coluna ganham backfill via JOIN com projects; exportacoes_log tem
-- bloco próprio (ADD COLUMN + UPDATE) mais abaixo.
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'contracts','contract_parcelas','contract_aditivos',
    'physical_evidences','tax_guides','rubricas_readequacoes',
    'project_checklist','checklist_items','relatorio_prestacao_contas'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format($q$
      UPDATE public.%I AS x
         SET organization_id = p.organization_id
        FROM public.projects p
       WHERE x.project_id = p.id
         AND x.organization_id IS NULL
    $q$, t);
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- TAREFA 3 — REESCREVER POLICIES NO PADRÃO M1
-- ═══════════════════════════════════════════════════════════════════

-- ─── CONTRACTS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contracts_all" ON public.contracts;
DROP POLICY IF EXISTS "contracts_select" ON public.contracts;
DROP POLICY IF EXISTS "contracts_insert" ON public.contracts;
DROP POLICY IF EXISTS "contracts_update" ON public.contracts;
DROP POLICY IF EXISTS "contracts_delete" ON public.contracts;

CREATE POLICY "contracts_select" ON public.contracts
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "contracts_insert" ON public.contracts
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "contracts_update" ON public.contracts
FOR UPDATE TO authenticated
USING (
  organization_id = public.current_user_org_id()
  AND public.has_any_role('gestor', 'analista')
);

CREATE POLICY "contracts_delete" ON public.contracts
FOR DELETE TO authenticated
USING (
  organization_id = public.current_user_org_id()
  AND public.has_role('gestor')
);


-- ─── CONTRACT_PARCELAS ─────────────────────────────────────────────
DROP POLICY IF EXISTS "parcelas_all" ON public.contract_parcelas;
DROP POLICY IF EXISTS "parcelas_select" ON public.contract_parcelas;
DROP POLICY IF EXISTS "parcelas_insert" ON public.contract_parcelas;
DROP POLICY IF EXISTS "parcelas_update" ON public.contract_parcelas;

CREATE POLICY "parcelas_select" ON public.contract_parcelas
FOR SELECT TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "parcelas_insert" ON public.contract_parcelas
FOR INSERT TO authenticated
WITH CHECK (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "parcelas_update" ON public.contract_parcelas
FOR UPDATE TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);


-- ─── CONTRACT_ADITIVOS ─────────────────────────────────────────────
DROP POLICY IF EXISTS "aditivos_all" ON public.contract_aditivos;
DROP POLICY IF EXISTS "aditivos_select" ON public.contract_aditivos;
DROP POLICY IF EXISTS "aditivos_insert" ON public.contract_aditivos;

CREATE POLICY "aditivos_select" ON public.contract_aditivos
FOR SELECT TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "aditivos_insert" ON public.contract_aditivos
FOR INSERT TO authenticated
WITH CHECK (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);


-- ─── PHYSICAL_EVIDENCES ────────────────────────────────────────────
-- Limpa policies legadas (vários nomes em uso nos migration_fix_rls_*)
DROP POLICY IF EXISTS "Allow authenticated insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow view own or org evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow org admins update evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow delete own pending evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Fornecedores can insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Users can view own evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Org members can update evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_select" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_insert" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_update" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_delete" ON public.physical_evidences;

-- SELECT: quem enviou (fornecedor) OU qualquer usuário da org
CREATE POLICY "evidences_select" ON public.physical_evidences
FOR SELECT TO authenticated
USING (
  enviado_por = auth.uid()
  OR organization_id = public.current_user_org_id()
);

-- INSERT: qualquer autenticado, desde que se identifique como remetente
CREATE POLICY "evidences_insert" ON public.physical_evidences
FOR INSERT TO authenticated
WITH CHECK (enviado_por = auth.uid());

-- UPDATE: gestor/analista da mesma org (aprovar/reprovar)
CREATE POLICY "evidences_update" ON public.physical_evidences
FOR UPDATE TO authenticated
USING (
  organization_id = public.current_user_org_id()
  AND public.has_any_role('gestor', 'analista')
);

-- DELETE: quem enviou, se ainda pendente
CREATE POLICY "evidences_delete" ON public.physical_evidences
FOR DELETE TO authenticated
USING (
  enviado_por = auth.uid()
  AND status_validacao = 'pendente'
);


-- ─── TAX_GUIDES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tax_all" ON public.tax_guides;
DROP POLICY IF EXISTS "tax_guides_select" ON public.tax_guides;
DROP POLICY IF EXISTS "tax_guides_insert" ON public.tax_guides;
DROP POLICY IF EXISTS "tax_guides_update" ON public.tax_guides;

CREATE POLICY "tax_guides_select" ON public.tax_guides
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "tax_guides_insert" ON public.tax_guides
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "tax_guides_update" ON public.tax_guides
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());


-- ─── RUBRICAS_READEQUACOES ─────────────────────────────────────────
DROP POLICY IF EXISTS "readequacoes_all" ON public.rubricas_readequacoes;
DROP POLICY IF EXISTS "readequacoes_select" ON public.rubricas_readequacoes;
DROP POLICY IF EXISTS "readequacoes_insert" ON public.rubricas_readequacoes;

CREATE POLICY "readequacoes_select" ON public.rubricas_readequacoes
FOR SELECT TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "readequacoes_insert" ON public.rubricas_readequacoes
FOR INSERT TO authenticated
WITH CHECK (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);


-- ─── PROJECT_CHECKLIST ─────────────────────────────────────────────
DROP POLICY IF EXISTS "checklist_all" ON public.project_checklist;
DROP POLICY IF EXISTS "checklist_select" ON public.project_checklist;
DROP POLICY IF EXISTS "checklist_insert" ON public.project_checklist;
DROP POLICY IF EXISTS "checklist_update" ON public.project_checklist;

CREATE POLICY "checklist_select" ON public.project_checklist
FOR SELECT TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "checklist_insert" ON public.project_checklist
FOR INSERT TO authenticated
WITH CHECK (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "checklist_update" ON public.project_checklist
FOR UPDATE TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);


-- ─── CHECKLIST_ITEMS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "ch_items_all" ON public.checklist_items;
DROP POLICY IF EXISTS "checklist_items_select" ON public.checklist_items;
DROP POLICY IF EXISTS "checklist_items_insert" ON public.checklist_items;
DROP POLICY IF EXISTS "checklist_items_update" ON public.checklist_items;

CREATE POLICY "checklist_items_select" ON public.checklist_items
FOR SELECT TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "checklist_items_insert" ON public.checklist_items
FOR INSERT TO authenticated
WITH CHECK (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);

CREATE POLICY "checklist_items_update" ON public.checklist_items
FOR UPDATE TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects
    WHERE organization_id = public.current_user_org_id()
  )
);


-- ─── RELATORIO_PRESTACAO_CONTAS ────────────────────────────────────
-- A tabela JÁ tem organization_id (confirmado no diagnose), então
-- usamos o estilo org-direct (mais barato que subquery em projects)
DROP POLICY IF EXISTS "relatorio_all" ON public.relatorio_prestacao_contas;
DROP POLICY IF EXISTS "relatorio_select" ON public.relatorio_prestacao_contas;
DROP POLICY IF EXISTS "relatorio_insert" ON public.relatorio_prestacao_contas;
DROP POLICY IF EXISTS "relatorio_update" ON public.relatorio_prestacao_contas;

CREATE POLICY "relatorio_select" ON public.relatorio_prestacao_contas
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "relatorio_insert" ON public.relatorio_prestacao_contas
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "relatorio_update" ON public.relatorio_prestacao_contas
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());


-- ─── EXPORTACOES_LOG ───────────────────────────────────────────────
-- Garante a coluna organization_id (nullable enquanto fazemos catch-up)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exportacoes_log'
      AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE public.exportacoes_log
      ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;
END $$;

-- Preenche organization_id dos registros antigos a partir do projeto
UPDATE public.exportacoes_log el
SET organization_id = p.organization_id
FROM public.projects p
WHERE el.project_id = p.id
  AND el.organization_id IS NULL;

-- Indexa para performance das policies
CREATE INDEX IF NOT EXISTS idx_exportacoes_log_org
  ON public.exportacoes_log(organization_id);

DROP POLICY IF EXISTS "exportacoes_select" ON public.exportacoes_log;
DROP POLICY IF EXISTS "exportacoes_insert" ON public.exportacoes_log;
DROP POLICY IF EXISTS "exportacoes_update" ON public.exportacoes_log;

CREATE POLICY "exportacoes_select" ON public.exportacoes_log
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "exportacoes_insert" ON public.exportacoes_log
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "exportacoes_update" ON public.exportacoes_log
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());


-- ═══════════════════════════════════════════════════════════════════
-- NOTA SOBRE FORNECEDORES
-- ═══════════════════════════════════════════════════════════════════
-- As tabelas administrativas (contracts, contract_parcelas, contract_aditivos,
-- tax_guides, rubricas_readequacoes, project_checklist, checklist_items,
-- relatorio_prestacao_contas, exportacoes_log) intencionalmente excluem
-- usuários com role='fornecedor': eles não pertencem a uma organização
-- (current_user_org_id() retorna NULL) e portanto não satisfazem o predicado
-- "organization_id = current_user_org_id()".
--
-- Fornecedores acessam o sistema por dois caminhos próprios:
--   1) projects → policy "Fornecedor ve projetos convidado":
--        id IN (SELECT project_id FROM projeto_fornecedores
--                WHERE fornecedor_id = auth.uid())
--   2) physical_evidences → policies que usam enviado_por = auth.uid()
--      (SELECT, INSERT, DELETE — preservadas nesta migration)
--
-- Se uma tela administrativa precisar futuramente expor algum dado a
-- fornecedores, adicione uma policy adicional com predicado por auth.uid()
-- nessa tabela específica — NÃO afrouxe o predicado organization_id.


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO FINAL
-- ═══════════════════════════════════════════════════════════════════
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts','contract_parcelas','contract_aditivos',
    'physical_evidences','tax_guides','rubricas_readequacoes',
    'project_checklist','checklist_items',
    'relatorio_prestacao_contas','exportacoes_log'
  )
ORDER BY tablename, cmd;
