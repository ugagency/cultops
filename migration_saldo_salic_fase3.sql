-- ==============================================================
-- MIGRATION: SALDO SALIC — FASE 3 (comprometido de contratos)
-- + fundação da Fase 4 (divergências/agendamento) + feature flag
-- CR-2026-001 — Controle Preventivo de Saldo de Rubricas
-- ==============================================================
-- Executar DEPOIS de migration_saldo_salic_fase0.sql (Fase 0/1, já em
-- produção). ADITIVO — não recria as tabelas/view da Fase 0, só:
--   1) documents.contract_id (vínculo opcional nota <-> contrato)
--   2) CREATE OR REPLACE v_saldo_rubricas: comprometido real +
--      codigo_rubrica (corrige a colisão de nome com rubricas.rubrica_id)
--   3) colunas de resolução em saldo_salic_divergencias (Fase 4.2)
--   4) organizations.saldo_rubricas_habilitado (feature flag) +
--      organizations.saldo_rubricas_prazo_nota_parada_dias (Fase 4.3)
--   5) função de suporte ao agendamento condicional (Fase 4.1)
--
-- Ordem de propósito: Fase 3 (comprometido) sobe ANTES da Fase 2
-- (validação no lançamento) para que a Fase 2 já alerte contra o saldo
-- completo, sem precisar ser reescrita depois.
--
-- NÃO altera recalc_rubrica_valor_utilizado, despesas_atualiza_consumo,
-- find_rubrica_for_document nem trg_documents_cria_despesa.
-- ==============================================================


-- ==============================================================
-- 3.1 — Vínculo opcional nota <-> contrato
-- ==============================================================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES public.contracts(id);

CREATE INDEX IF NOT EXISTS idx_documents_contract ON public.documents(contract_id);


-- ==============================================================
-- 4.2 (fundação) — resolução manual de divergências
-- ==============================================================
ALTER TABLE public.saldo_salic_divergencias
  ADD COLUMN IF NOT EXISTS resolvida_por UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolvida_em TIMESTAMPTZ;


-- ==============================================================
-- FEATURE FLAG — organizations
-- ==============================================================
-- Com o flag desligado (default), nenhuma tela/alerta novo aparece —
-- comportamento idêntico ao de antes da feature. Deploy e exposição
-- ao cliente são eventos separados de propósito.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS saldo_rubricas_habilitado BOOLEAN NOT NULL DEFAULT false;

-- Fase 4.3: prazo (dias) para avisar de nota parada em trânsito.
-- Configurável por organização em vez de hardcoded, sem precisar de UI:
-- o suporte ajusta via SQL quando necessário.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS saldo_rubricas_prazo_nota_parada_dias INT NOT NULL DEFAULT 7;


-- ==============================================================
-- v_saldo_rubricas — CREATE OR REPLACE (Fase 3: comprometido real)
-- ==============================================================
-- Mudanças em relação à Fase 0/1:
--   - comprometido deixa de ser 0::NUMERIC fixo: soma, por contrato
--     elegível da rubrica, de MAIOR(0, valor_total - NFs vinculadas).
--   - disponivel_projetado passa a descontar comprometido.
--   - nova coluna codigo_rubrica = rubricas.rubrica_id (código numérico
--     SALIC). A view já expunha `rubrica_id` = UUID da rubrica (r.id) —
--     nome que colide com a coluna rubrica_id (numeric) da tabela
--     rubricas. Não renomeamos o que já existe (quebraria
--     financeiro.html/rubricas.html/app.js já implementados); só
--     adicionamos codigo_rubrica para dar acesso direto ao código sem
--     precisar de query paralela.
--
-- Contrato elegível para comprometido — três filtros:
--   status = 'ativo' AND excluido_em IS NULL AND rubrica_id IS NOT NULL.
-- Contratos-pai "guarda-chuva" (valor_total = 0, valor real nos anexos
-- via contrato_pai_id) são somados igual aos demais, sem tentar
-- consolidar hierarquia — é o padrão real dos dados em produção (30 dos
-- 47 contratos são anexos) e consolidar zeraria o comprometido real.
--
-- O desconto de NFs vinculadas (documents.contract_id) ao contrato
-- ocorre independentemente do status da despesa: uma nota já contada em
-- em_transito ou executado precisa sair do comprometido, senão conta
-- duas vezes o mesmo compromisso financeiro.
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
),
contrato_consumido AS (
    -- NFs (despesas) vinculadas a cada contrato via documents.contract_id.
    -- Exclui erro_rpa/bloqueado_conformidade: essas despesas também não
    -- entram em em_transito (regra D3) nem em executado_efetivo (sem
    -- data_salic) — se contassem aqui, abateriam o comprometido do
    -- contrato sem aparecer em nenhuma outra camada, inflando
    -- disponivel_projetado. Correção de bug (produção, 3 notas, R$ 22.359,85).
    SELECT
        doc.contract_id,
        SUM(d.valor) AS total
    FROM public.despesas d
    JOIN public.documents doc ON doc.id = d.document_id
    WHERE doc.contract_id IS NOT NULL
      AND d.status NOT IN ('erro_rpa', 'bloqueado_conformidade')
    GROUP BY doc.contract_id
),
comprometido_por_rubrica AS (
    SELECT
        c.rubrica_id,
        SUM(GREATEST(0, c.valor_total - COALESCE(cc.total, 0))) AS total
    FROM public.contracts c
    LEFT JOIN contrato_consumido cc ON cc.contract_id = c.id
    WHERE c.status = 'ativo'
      AND c.excluido_em IS NULL
      AND c.rubrica_id IS NOT NULL
      -- Contrato vencido nesta operação está sempre pago/concluído — não
      -- deve mais reservar saldo. Sem isso o comprometido de dia-um
      -- inflava para R$ 120.468 (produção) em vez de R$ 14.000.
      AND (c.data_fim IS NULL OR c.data_fim >= CURRENT_DATE)
    GROUP BY c.rubrica_id
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
    COALESCE(cpr.total, 0) AS comprometido,
    CASE
        WHEN uc.project_id IS NULL THEN NULL
        ELSE r.valor_aprovado - COALESCE(ex.executado_salic, 0)
    END AS disponivel_oficial,
    CASE
        WHEN uc.project_id IS NULL THEN NULL
        ELSE r.valor_aprovado
             - (COALESCE(ex.executado_salic, 0) + COALESCE(nfs.total, 0))
             - COALESCE(et.total, 0)
             - COALESCE(cpr.total, 0)
    END AS disponivel_projetado,
    -- codigo_rubrica precisa ficar por ÚLTIMO no SELECT: CREATE OR REPLACE
    -- VIEW só aceita ACRESCENTAR colunas ao final da lista existente — em
    -- qualquer outra posição, o Postgres recusa com "cannot change name of
    -- view column" (já aconteceu em produção).
    r.rubrica_id AS codigo_rubrica
FROM public.rubricas r
LEFT JOIN ultima_captura uc ON uc.project_id = r.project_id
LEFT JOIN executado ex ON ex.project_id = r.project_id AND ex.rubrica_id = r.id
LEFT JOIN nfs_pos_captura nfs ON nfs.rubrica_id = r.id
LEFT JOIN em_transito et ON et.rubrica_id = r.id
LEFT JOIN comprometido_por_rubrica cpr ON cpr.rubrica_id = r.id;

COMMENT ON VIEW public.v_saldo_rubricas IS
'Fonte única das quatro camadas de saldo por rubrica (CR-2026-001). comprometido (Fase 3) soma contratos ativos/não-excluídos da rubrica, descontando NFs já vinculadas. Ver comentários acima da definição para as regras D3/D4 (Fase 0) e do comprometido (Fase 3).';


-- ==============================================================
-- Fase 4.1 (fundação) — projetos elegíveis à captura condicional
-- ==============================================================
-- "Movimentação" = projeto tem pelo menos uma despesa (está ativo no
-- fluxo financeiro). Não tenta detectar mudança desde a última captura
-- porque o cenário que essa rede de segurança cobre é justamente
-- lançamento feito DIRETO no SALIC, fora do PrestAI — invisível para
-- nós por definição. Em vez disso, roda a cada 4h para projetos ativos,
-- sem intervalo curto (evita uso abusivo do portal do governo).
-- Também retorna o disparador da captura mais recente do projeto (se
-- houver), para o worker localizar credenciais SALIC de um usuário real
-- em vez de rodar sem contexto de usuário.
--
-- Correção de bug: o endpoint que consome esta função (/cron/captura-
-- condicional) não tinha teto de quantos projetos processava por
-- chamada. Para dar ao worker como priorizar quando limitar (BUG 4:
-- máximo 5 por chamada), a função agora também retorna
-- ultima_captura_sucesso_em e já vem ordenada com os projetos mais
-- atrasados primeiro (nunca capturados, depois captura sucesso mais
-- antiga) — o worker só precisa pegar os N primeiros da lista.
CREATE OR REPLACE FUNCTION public.saldo_salic_projetos_elegiveis_captura()
RETURNS TABLE (
    project_id UUID,
    pronac TEXT,
    organization_id UUID,
    sugestao_user_id UUID,
    ultima_captura_sucesso_em TIMESTAMPTZ
) AS $$
    SELECT
        p.id,
        p.pronac,
        p.organization_id,
        (
            SELECT c.disparada_por
            FROM public.saldo_salic_capturas c
            WHERE c.project_id = p.id AND c.disparada_por IS NOT NULL
            ORDER BY c.iniciada_em DESC
            LIMIT 1
        ) AS sugestao_user_id,
        (
            SELECT MAX(c.concluida_em)
            FROM public.saldo_salic_capturas c
            WHERE c.project_id = p.id AND c.status = 'sucesso'
        ) AS ultima_captura_sucesso_em
    FROM public.projects p
    WHERE EXISTS (SELECT 1 FROM public.despesas d WHERE d.project_id = p.id)
      AND NOT EXISTS (
          SELECT 1 FROM public.saldo_salic_capturas c
          WHERE c.project_id = p.id
            AND c.status = 'sucesso'
            AND c.concluida_em > now() - interval '4 hours'
      )
      -- não reenfileira projeto com captura em andamento (ou travada há
      -- menos de 10min — acima disso, trata como morta e tenta de novo)
      AND NOT EXISTS (
          SELECT 1 FROM public.saldo_salic_capturas c2
          WHERE c2.project_id = p.id
            AND c2.status = 'executando'
            AND c2.iniciada_em > now() - interval '10 minutes'
      )
    ORDER BY ultima_captura_sucesso_em ASC NULLS FIRST;
$$ LANGUAGE sql STABLE;


-- ==============================================================
-- VERIFICAÇÃO FINAL
-- ==============================================================
-- Critério 14: contratos excluídos não aparecem em nenhum comprometido
-- SELECT rubrica_id, comprometido FROM public.v_saldo_rubricas WHERE comprometido > 0;
-- SELECT id, numero, status, excluido_em FROM public.contracts WHERE excluido_em IS NOT NULL;
