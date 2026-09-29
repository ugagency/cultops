-- ==============================================================
-- MIGRATION: SALDO SALIC — FASE 0 (fundação de dados)
-- CR-2026-001 — Controle Preventivo de Saldo de Rubricas
-- ==============================================================
-- Cria a fundação para o controle preventivo de saldo: captura
-- read-only do relatório de Execução Física do SALIC, pareamento
-- linha↔rubrica, e a view única (v_saldo_rubricas) que calcula as
-- quatro camadas de saldo (oficial SALIC + projeção PrestAI).
--
-- ADITIVO — não altera nada do motor de consumo existente
-- (recalc_rubrica_valor_utilizado / despesas_atualiza_consumo em
-- migration_consumo_rubricas.sql) nem do trigger
-- documents_cria_despesa (migration_auto_despesas.sql).
--
-- Prefixo saldo_salic_ evita colisão com a tabela já existente
-- project_salic_imports (que trata de importação de dados
-- CADASTRAIS do projeto — não tem relação com esta feature).
-- ==============================================================


-- ==============================================================
-- TABELAS
-- ==============================================================

-- Controle de cada captura do relatório de execução física
CREATE TABLE IF NOT EXISTS public.saldo_salic_capturas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    iniciada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluida_em    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'executando'
                        CHECK (status IN ('executando', 'sucesso', 'erro')),
    total_linhas    INT,
    erro_mensagem   TEXT,
    disparada_por   UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_capturas_project ON public.saldo_salic_capturas(project_id);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_capturas_org ON public.saldo_salic_capturas(organization_id);
-- Índice de suporte à view: "última captura com sucesso do projeto"
CREATE INDEX IF NOT EXISTS idx_saldo_salic_capturas_sucesso ON public.saldo_salic_capturas(project_id, status, concluida_em DESC);


-- Espelho das linhas do relatório (Execução Física) de cada captura
CREATE TABLE IF NOT EXISTS public.saldo_salic_linhas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    captura_id          UUID NOT NULL REFERENCES public.saldo_salic_capturas(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    organization_id     UUID NOT NULL REFERENCES public.organizations(id),
    numero              TEXT,
    etapa               TEXT,
    item                TEXT,
    unidade             TEXT,
    qtde_programada     NUMERIC(14, 2),
    vl_programado       NUMERIC(14, 2),
    pct_executado       NUMERIC(6, 2),
    vl_executado        NUMERIC(14, 2),
    pct_a_executar      NUMERIC(6, 2),
    rubrica_id          UUID REFERENCES public.rubricas(id),
    pareamento_nivel    INT,
    pareamento_status   TEXT CHECK (pareamento_status IN ('pareada', 'fila_conferencia')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_linhas_project ON public.saldo_salic_linhas(project_id);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_linhas_org ON public.saldo_salic_linhas(organization_id);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_linhas_captura ON public.saldo_salic_linhas(captura_id);
-- Índice de suporte à view: soma de vl_executado por rubrica dentro de uma captura
CREATE INDEX IF NOT EXISTS idx_saldo_salic_linhas_captura_rubrica ON public.saldo_salic_linhas(captura_id, rubrica_id);
-- Índice de suporte à tela de conferência de pareamento
CREATE INDEX IF NOT EXISTS idx_saldo_salic_linhas_fila ON public.saldo_salic_linhas(project_id, pareamento_status);


-- Memória de pareamento linha <-> rubrica, para não perguntar duas vezes
CREATE TABLE IF NOT EXISTS public.saldo_salic_vinculos (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    organization_id      UUID NOT NULL REFERENCES public.organizations(id),
    chave_etapa          TEXT NOT NULL,
    chave_item           TEXT NOT NULL,
    chave_vl_programado  NUMERIC(14, 2) NOT NULL,
    rubrica_id           UUID NOT NULL REFERENCES public.rubricas(id),
    confirmado_por       UUID REFERENCES auth.users(id),
    confirmado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, chave_etapa, chave_item, chave_vl_programado)
);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_vinculos_project ON public.saldo_salic_vinculos(project_id);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_vinculos_org ON public.saldo_salic_vinculos(organization_id);


-- Divergências entre o executado do SALIC e o confirmado no PrestAI.
-- Criada agora, populada só na Fase 4 (reconciliação/detecção automática).
CREATE TABLE IF NOT EXISTS public.saldo_salic_divergencias (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id             UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    organization_id        UUID NOT NULL REFERENCES public.organizations(id),
    rubrica_id             UUID NOT NULL REFERENCES public.rubricas(id),
    vl_executado_salic     NUMERIC(14, 2),
    vl_confirmado_prestai  NUMERIC(14, 2),
    diferenca              NUMERIC(14, 2),
    detectada_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                 TEXT NOT NULL DEFAULT 'aberta'
                               CHECK (status IN ('aberta', 'resolvida', 'ignorada')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_divergencias_project ON public.saldo_salic_divergencias(project_id);
CREATE INDEX IF NOT EXISTS idx_saldo_salic_divergencias_org ON public.saldo_salic_divergencias(organization_id);


-- ==============================================================
-- RLS — padrão org-direct de migration_m2_rls_align_m1.sql
-- ==============================================================

ALTER TABLE public.saldo_salic_capturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saldo_salic_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saldo_salic_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saldo_salic_divergencias ENABLE ROW LEVEL SECURITY;

-- ─── SALDO_SALIC_CAPTURAS ──────────────────────────────────────────
DROP POLICY IF EXISTS "saldo_salic_capturas_select" ON public.saldo_salic_capturas;
DROP POLICY IF EXISTS "saldo_salic_capturas_insert" ON public.saldo_salic_capturas;
DROP POLICY IF EXISTS "saldo_salic_capturas_update" ON public.saldo_salic_capturas;

CREATE POLICY "saldo_salic_capturas_select" ON public.saldo_salic_capturas
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_capturas_insert" ON public.saldo_salic_capturas
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_capturas_update" ON public.saldo_salic_capturas
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());

-- ─── SALDO_SALIC_LINHAS ────────────────────────────────────────────
DROP POLICY IF EXISTS "saldo_salic_linhas_select" ON public.saldo_salic_linhas;
DROP POLICY IF EXISTS "saldo_salic_linhas_insert" ON public.saldo_salic_linhas;
DROP POLICY IF EXISTS "saldo_salic_linhas_update" ON public.saldo_salic_linhas;

CREATE POLICY "saldo_salic_linhas_select" ON public.saldo_salic_linhas
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_linhas_insert" ON public.saldo_salic_linhas
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

-- UPDATE: tela de conferência de pareamento grava rubrica_id na linha
CREATE POLICY "saldo_salic_linhas_update" ON public.saldo_salic_linhas
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());

-- ─── SALDO_SALIC_VINCULOS ──────────────────────────────────────────
DROP POLICY IF EXISTS "saldo_salic_vinculos_select" ON public.saldo_salic_vinculos;
DROP POLICY IF EXISTS "saldo_salic_vinculos_insert" ON public.saldo_salic_vinculos;
DROP POLICY IF EXISTS "saldo_salic_vinculos_update" ON public.saldo_salic_vinculos;

CREATE POLICY "saldo_salic_vinculos_select" ON public.saldo_salic_vinculos
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_vinculos_insert" ON public.saldo_salic_vinculos
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_vinculos_update" ON public.saldo_salic_vinculos
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());

-- ─── SALDO_SALIC_DIVERGENCIAS ──────────────────────────────────────
DROP POLICY IF EXISTS "saldo_salic_divergencias_select" ON public.saldo_salic_divergencias;
DROP POLICY IF EXISTS "saldo_salic_divergencias_insert" ON public.saldo_salic_divergencias;
DROP POLICY IF EXISTS "saldo_salic_divergencias_update" ON public.saldo_salic_divergencias;

CREATE POLICY "saldo_salic_divergencias_select" ON public.saldo_salic_divergencias
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_divergencias_insert" ON public.saldo_salic_divergencias
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY "saldo_salic_divergencias_update" ON public.saldo_salic_divergencias
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());


-- ==============================================================
-- VIEW v_saldo_rubricas — fonte única das quatro camadas de saldo
-- ==============================================================
-- Uma linha por rubrica. Nunca soma a partir de documents — despesas
-- é a fonte de valores (rubrica_id tem cobertura 100% em produção).
--
-- Regra D3 (em_transito): soma de despesas da rubrica com
-- data_salic IS NULL e status NOT IN ('concluido','erro_rpa',
-- 'bloqueado_conformidade'). Inclui aguardando_conformidade e
-- aguardando_conciliacao_bancaria — critério DIFERENTE do usado por
-- recalc_rubrica_valor_utilizado (que só considera status >=
-- aguardando_d3). É intencional: para alerta preventivo, nota já
-- lançada no PrestAI compromete saldo mesmo antes de chegar em
-- aguardando_d3.
--
-- Regra D4 (despesas legadas): despesas com status='enviado_salic' e
-- data_salic NULL (histórico anterior a esta feature) são tratadas
-- como já absorvidas pelo SALIC a partir da primeira captura bem
-- sucedida do projeto — não entram em em_transito nem em
-- nfs_confirmadas_nao_absorvidas. Antes da primeira captura (sem
-- baseline oficial ainda), continuam contando em em_transito.
--
-- NULL vs 0: se o projeto nunca teve captura com sucesso,
-- executado_salic / disponivel_oficial / disponivel_projetado são
-- NULL (front exibe "Indisponível"). Se já houve captura mas a
-- rubrica não aparece em nenhuma linha pareada, executado_salic = 0
-- (o relatório do SALIC só lista rubricas já lançadas).
CREATE OR REPLACE VIEW public.v_saldo_rubricas
WITH (security_invoker = true) AS
WITH ultima_captura AS (
    SELECT DISTINCT ON (project_id)
        project_id,
        id AS captura_id,
        concluida_em
    FROM public.saldo_salic_capturas
    WHERE status = 'sucesso' AND concluida_em IS NOT NULL
    ORDER BY project_id, concluida_em DESC
),
executado AS (
    SELECT
        uc.project_id,
        l.rubrica_id,
        SUM(l.vl_executado) AS executado_salic
    FROM ultima_captura uc
    JOIN public.saldo_salic_linhas l
        ON l.captura_id = uc.captura_id AND l.rubrica_id IS NOT NULL
    GROUP BY uc.project_id, l.rubrica_id
),
nfs_pos_captura AS (
    SELECT
        d.rubrica_id,
        SUM(d.valor) AS total
    FROM public.despesas d
    JOIN ultima_captura uc ON uc.project_id = d.project_id
    WHERE d.data_salic IS NOT NULL
      AND d.data_salic > uc.concluida_em
    GROUP BY d.rubrica_id
),
em_transito AS (
    SELECT
        d.rubrica_id,
        SUM(d.valor) AS total
    FROM public.despesas d
    LEFT JOIN ultima_captura uc ON uc.project_id = d.project_id
    WHERE d.data_salic IS NULL
      AND d.status NOT IN ('concluido', 'erro_rpa', 'bloqueado_conformidade')
      -- D4: despesa legada 'enviado_salic' sem data_salic conta como
      -- em trânsito só até a primeira captura bem-sucedida do projeto
      AND NOT (d.status = 'enviado_salic' AND uc.project_id IS NOT NULL)
    GROUP BY d.rubrica_id
)
SELECT
    r.id AS rubrica_id,
    r.project_id,
    r.organization_id,
    r.nome,
    r.etapa,
    r.valor_aprovado,
    r.valor_utilizado,
    r.percentual_alerta,
    r.alerta_limite_ativo,
    uc.concluida_em AS ultima_captura_em,
    CASE
        WHEN uc.project_id IS NULL THEN NULL
        ELSE COALESCE(ex.executado_salic, 0)
    END AS executado_salic,
    COALESCE(nfs.total, 0) AS nfs_confirmadas_nao_absorvidas,
    CASE
        WHEN uc.project_id IS NULL THEN NULL
        ELSE COALESCE(ex.executado_salic, 0) + COALESCE(nfs.total, 0)
    END AS executado_efetivo,
    COALESCE(et.total, 0) AS em_transito,
    0::NUMERIC AS comprometido, -- Fase 3 implementa (contratos)
    CASE
        WHEN uc.project_id IS NULL THEN NULL
        ELSE r.valor_aprovado - COALESCE(ex.executado_salic, 0)
    END AS disponivel_oficial,
    CASE
        WHEN uc.project_id IS NULL THEN NULL
        ELSE r.valor_aprovado
             - (COALESCE(ex.executado_salic, 0) + COALESCE(nfs.total, 0))
             - COALESCE(et.total, 0)
    END AS disponivel_projetado
FROM public.rubricas r
LEFT JOIN ultima_captura uc ON uc.project_id = r.project_id
LEFT JOIN executado ex ON ex.project_id = r.project_id AND ex.rubrica_id = r.id
LEFT JOIN nfs_pos_captura nfs ON nfs.rubrica_id = r.id
LEFT JOIN em_transito et ON et.rubrica_id = r.id;

COMMENT ON VIEW public.v_saldo_rubricas IS
'Fonte única das quatro camadas de saldo por rubrica (Fase 0/1 do CR-2026-001). Ver comentário acima da definição para as regras D3/D4.';


-- ==============================================================
-- VERIFICAÇÃO FINAL
-- ==============================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'saldo_salic_capturas', 'saldo_salic_linhas',
    'saldo_salic_vinculos', 'saldo_salic_divergencias'
  )
ORDER BY tablename, cmd;
