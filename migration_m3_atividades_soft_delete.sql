-- M3: Atividade como entidade real dentro de evento de contrapartida + soft
-- delete de evento.
--
-- Não confundir com distribution_events.quantitativo_atividades, que é o campo
-- de TEXTO LIVRE do relatório e segue existindo sem mudança nesta rodada.

-- 1. Atividades (sessões/apresentações dentro de um evento — ex: evento
--    "Parque" com atividades "Show do Mágico" e "Show do Cantor").
CREATE TABLE IF NOT EXISTS public.distribution_atividades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_id        uuid NOT NULL REFERENCES public.distribution_events(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  data_hora       timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_dist_atividades_event
  ON public.distribution_atividades(event_id);

ALTER TABLE public.distribution_atividades ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro da org (o PWA/portaria precisa listar para o
-- seletor de check-in). Escrita: só admin/gestor — a decisão de produto é que
-- atividade NUNCA nasce no campo, e aqui isso vira bloqueio real de banco,
-- não só botão escondido.
CREATE POLICY atividades_select ON public.distribution_atividades
  FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY atividades_insert ON public.distribution_atividades
  FOR INSERT WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.has_any_role('admin', 'gestor'));

CREATE POLICY atividades_update ON public.distribution_atividades
  FOR UPDATE USING (
    organization_id = public.current_user_org_id()
    AND public.has_any_role('admin', 'gestor'))
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.has_any_role('admin', 'gestor'));

CREATE POLICY atividades_delete ON public.distribution_atividades
  FOR DELETE USING (
    organization_id = public.current_user_org_id()
    AND public.has_any_role('admin', 'gestor'));

COMMENT ON TABLE public.distribution_atividades IS
  'Atividades (sessões) de um evento de contrapartida. Cadastro exclusivo de admin/gestor via RLS; operador/PWA apenas leem. Distinto de distribution_events.quantitativo_atividades (texto livre do relatório).';

-- 2. Vínculo convidado -> atividade. ON DELETE SET NULL: excluir uma atividade
--    não pode falhar nem apagar convidados — eles apenas voltam ao estado
--    "sem atividade".
ALTER TABLE public.distribution_guests
  ADD COLUMN IF NOT EXISTS atividade_id uuid
    REFERENCES public.distribution_atividades(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dist_guests_atividade
  ON public.distribution_guests(atividade_id);

COMMENT ON COLUMN public.distribution_guests.atividade_id IS
  'Opcional — NULL para eventos com atividade única (compatibilidade com dado existente e com eventos de 0/1 atividade). Quando o evento tem 2+ atividades, todo convidado novo deve ser associado a uma.';

-- 3. Soft delete de evento. NUNCA hard delete: distribution_guests,
--    distribution_event_os, distribution_event_pa e distribution_attendance
--    são todos ON DELETE CASCADE — um DELETE real apagaria convidados e
--    check-ins junto, silenciosamente.
ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_dist_events_excluido_em
  ON public.distribution_events(excluido_em);

COMMENT ON COLUMN public.distribution_events.excluido_em IS
  'Soft delete — quando preenchido, o evento não deve aparecer em nenhuma listagem/KPI/relatório/PWA. NULL = evento ativo. Exclusão só via POST /api/m3/eventos/:id/excluir (requireRole gestor/admin — a RLS da tabela é só por org e não bloquearia operador). Restauração é ação manual de suporte.';
