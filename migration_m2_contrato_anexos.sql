-- ═══════════════════════════════════════════════════════════════════
-- migration_m2_contrato_anexos.sql
--
-- Adiciona suporte a "Anexos de Contrato": contratos "guarda-chuva"
-- de valor zero cujo valor real está distribuído em contratos filhos
-- (anexos) vinculados via contracts.contrato_pai_id.
--
-- 1) Coluna contrato_pai_id (self-FK, ON DELETE CASCADE) + índice.
-- 2) Trigger BEFORE INSERT/UPDATE que impede mais de 1 nível de
--    hierarquia (um anexo não pode ter seu próprio anexo) e garante
--    que pai/filho pertencem ao mesmo projeto.
--
-- Nota: contracts.valor_total já NÃO possui CHECK constraint (apenas
-- NOT NULL) — não há nada para dropar/recriar ali. O bloqueio de
-- valor zero é hoje puramente front-end (HTML min + JS) e é relaxado
-- em modulo2/contratos.html separadamente.
--
-- Idempotente — pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1) Coluna + índice ─────────────────────────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contrato_pai_id uuid
  REFERENCES public.contracts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_contracts_contrato_pai_id
  ON public.contracts(contrato_pai_id);

-- ─── 2) Trigger: trava de 1 nível + mesmo projeto ──────────────────
CREATE OR REPLACE FUNCTION public.trg_contracts_valida_nivel_anexo()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_pai_id uuid;
  v_parent_project_id uuid;
BEGIN
  IF NEW.contrato_pai_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.contrato_pai_id = NEW.id THEN
    RAISE EXCEPTION 'Um contrato não pode ser anexo de si mesmo.';
  END IF;

  SELECT contrato_pai_id, project_id
    INTO v_parent_pai_id, v_parent_project_id
    FROM public.contracts
   WHERE id = NEW.contrato_pai_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato pai % não encontrado.', NEW.contrato_pai_id;
  END IF;

  IF v_parent_pai_id IS NOT NULL THEN
    RAISE EXCEPTION 'Não é permitido vincular um anexo a outro anexo (limite de 1 nível de hierarquia).';
  END IF;

  IF v_parent_project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'O contrato pai deve pertencer ao mesmo projeto do anexo.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_valida_nivel_anexo ON public.contracts;
CREATE TRIGGER trg_valida_nivel_anexo
BEFORE INSERT OR UPDATE OF contrato_pai_id ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.trg_contracts_valida_nivel_anexo();

-- ─── VERIFICAÇÃO FINAL ─────────────────────────────────────────────
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='contracts' AND column_name='contrato_pai_id';
