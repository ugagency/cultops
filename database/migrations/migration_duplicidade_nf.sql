-- ==============================================================
-- migration_duplicidade_nf.sql
--
-- Aviso de duplicidade de NF (M1) — detecção assíncrona.
--
-- Chave: numero_nf + cnpj_emissor, restrito ao mesmo project_id.
--   'confirmada' → mesmo numero_nf + cnpj + valor de outro documento
--   'possivel'   → mesmo numero_nf + cnpj, valor diferente
-- Documentos com numero_nf ou cnpj_emissor nulos são ignorados.
--
-- POR QUE UM TRIGGER, E NÃO UM ENDPOINT NO server.js
-- --------------------------------------------------------------
-- numero_nf, cnpj_emissor e valor NÃO passam pelo server.js: o workflow de OCR
-- do n8n grava direto no Supabase (não existe rota de callback no server.js — a
-- única menção a cnpj_emissor lá é leitura, no envio ao SALIC). Não há, portanto,
-- endpoint onde pendurar a checagem.
--
-- O trigger cobre TODOS os caminhos de escrita, inclusive o que um endpoint não
-- pegaria: a correção manual dos campos na tela de detalhe (app.js →
-- handleSalvarCamposDocumento), que pode transformar uma NF única em duplicata ao
-- consertar um erro de OCR. É também o idioma já usado neste banco para reagir a
-- mudanças em documents (ver documents_cria_despesa em migration_auto_despesas.sql).
--
-- Nunca bloqueia nada: só preenche um sinalizador.
-- ==============================================================

-- ==============================================================
-- 1) COLUNAS
-- ==============================================================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS nivel_duplicidade text
    CHECK (nivel_duplicidade IN ('confirmada','possivel')),
  -- ON DELETE SET NULL: sem isto, a FK impediria excluir um documento que outro
  -- aponta como duplicata, quebrando o botão de excluir da listagem.
  ADD COLUMN IF NOT EXISTS duplicata_de_id uuid
    REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicidade_revisada boolean DEFAULT false;

COMMENT ON COLUMN public.documents.nivel_duplicidade IS
  'NULL = sem duplicidade detectada. confirmada = mesmo numero_nf+cnpj+valor de outro documento. possivel = mesmo numero_nf+cnpj com valor diferente (possível erro de digitação/OCR). Preenchido automaticamente após extração, nunca bloqueia o fluxo.';

COMMENT ON COLUMN public.documents.duplicata_de_id IS
  'Outro documento do mesmo grupo de duplicidade (mesmo project_id + numero_nf + cnpj_emissor). Serve para abrir o comparativo lado a lado; o grupo pode ter mais de dois membros, e neste caso aponta para um deles.';

COMMENT ON COLUMN public.documents.duplicidade_revisada IS
  'true quando o usuário já viu e confirmou ciência da duplicidade sinalizada. Usado para sumir do contador de pendências sem apagar o sinalizador.';

-- Índice para a busca de candidatos do trigger e para o filtro da tela.
CREATE INDEX IF NOT EXISTS idx_documents_duplicidade_lookup
  ON public.documents (project_id, numero_nf, cnpj_emissor)
  WHERE tipo_documento = 'nf'
    AND numero_nf IS NOT NULL
    AND cnpj_emissor IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_duplicidade_pendente
  ON public.documents (project_id)
  WHERE nivel_duplicidade IS NOT NULL AND duplicidade_revisada = false;

-- ==============================================================
-- 2) CLASSIFICAÇÃO DE UM DOCUMENTO
-- ==============================================================
-- Recebe o id e reclassifica SÓ aquele documento, olhando os demais do mesmo
-- grupo. Devolve o nível aplicado (NULL quando não há duplicidade).
--
-- Comparação de valor por '=' e não por IS NOT DISTINCT FROM: se algum dos dois
-- valores for NULL não dá para afirmar que são idênticos, então o caso cai em
-- 'possivel' — que é o nível que pede conferência humana. Preferir o alarme mais
-- fraco a afirmar uma confirmação que não se pode sustentar.
CREATE OR REPLACE FUNCTION public.classificar_duplicidade_documento(p_document_id uuid)
RETURNS text AS $$
DECLARE
    v_doc        public.documents%ROWTYPE;
    v_par_id     uuid;
    v_nivel      text;
BEGIN
    SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id;

    IF NOT FOUND
       OR v_doc.tipo_documento IS DISTINCT FROM 'nf'
       OR v_doc.numero_nf IS NULL OR btrim(v_doc.numero_nf) = ''
       OR v_doc.cnpj_emissor IS NULL OR btrim(v_doc.cnpj_emissor) = ''
    THEN
        -- Não elegível: limpa qualquer marca anterior (ex.: o número foi corrigido
        -- para vazio) sem mexer no que já foi revisado.
        UPDATE public.documents
        SET nivel_duplicidade = NULL, duplicata_de_id = NULL
        WHERE id = p_document_id AND nivel_duplicidade IS NOT NULL;
        RETURN NULL;
    END IF;

    -- Prioriza um par de valor idêntico ('confirmada'); se não houver, qualquer
    -- outro membro do grupo serve para o comparativo ('possivel').
    SELECT d.id INTO v_par_id
    FROM public.documents d
    WHERE d.project_id    = v_doc.project_id
      AND d.tipo_documento = 'nf'
      AND d.numero_nf     = v_doc.numero_nf
      AND d.cnpj_emissor  = v_doc.cnpj_emissor
      AND d.id <> v_doc.id
    ORDER BY (d.valor = v_doc.valor) DESC NULLS LAST, d.created_at ASC
    LIMIT 1;

    IF v_par_id IS NULL THEN
        UPDATE public.documents
        SET nivel_duplicidade = NULL, duplicata_de_id = NULL
        WHERE id = p_document_id AND nivel_duplicidade IS NOT NULL;
        RETURN NULL;
    END IF;

    SELECT CASE WHEN d.valor = v_doc.valor THEN 'confirmada' ELSE 'possivel' END
    INTO v_nivel
    FROM public.documents d WHERE d.id = v_par_id;

    v_nivel := COALESCE(v_nivel, 'possivel');

    UPDATE public.documents
    SET nivel_duplicidade = v_nivel,
        duplicata_de_id   = v_par_id,
        -- Nível mudou → volta para a fila de revisão. Reconfirmar o mesmo nível
        -- não desfaz uma revisão já feita.
        duplicidade_revisada = CASE
            WHEN nivel_duplicidade IS DISTINCT FROM v_nivel THEN false
            ELSE duplicidade_revisada
        END
    WHERE id = p_document_id
      AND (nivel_duplicidade IS DISTINCT FROM v_nivel
           OR duplicata_de_id IS DISTINCT FROM v_par_id);

    RETURN v_nivel;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================
-- 3) TRIGGER
-- ==============================================================
-- AFTER INSERT OR UPDATE OF numero_nf, cnpj_emissor, valor: as gravações que a
-- própria função faz tocam só nivel_duplicidade/duplicata_de_id/
-- duplicidade_revisada, que estão FORA da lista de colunas observadas — por isso
-- não há recursão.
CREATE OR REPLACE FUNCTION public.trg_documents_checa_duplicidade()
RETURNS TRIGGER AS $$
DECLARE
    v_outro_id uuid;
BEGIN
    PERFORM public.classificar_duplicidade_documento(NEW.id);

    -- Reclassifica os OUTROS membros do grupo. Sem isto, num par recém-formado só
    -- o documento que chegou por último ficaria marcado, e o badge não apareceria
    -- na linha do documento original.
    FOR v_outro_id IN
        SELECT d.id
        FROM public.documents d
        WHERE d.project_id     = NEW.project_id
          AND d.tipo_documento = 'nf'
          AND d.numero_nf      = NEW.numero_nf
          AND d.cnpj_emissor   = NEW.cnpj_emissor
          AND d.id <> NEW.id
    LOOP
        PERFORM public.classificar_duplicidade_documento(v_outro_id);
    END LOOP;

    -- Um UPDATE pode ter tirado o documento de um grupo antigo (ex.: correção do
    -- numero_nf). Quem ficou sozinho lá precisa perder a marca.
    IF TG_OP = 'UPDATE'
       AND (OLD.numero_nf IS DISTINCT FROM NEW.numero_nf
            OR OLD.cnpj_emissor IS DISTINCT FROM NEW.cnpj_emissor)
       AND OLD.numero_nf IS NOT NULL AND OLD.cnpj_emissor IS NOT NULL
    THEN
        FOR v_outro_id IN
            SELECT d.id
            FROM public.documents d
            WHERE d.project_id     = OLD.project_id
              AND d.tipo_documento = 'nf'
              AND d.numero_nf      = OLD.numero_nf
              AND d.cnpj_emissor   = OLD.cnpj_emissor
              AND d.id <> NEW.id
        LOOP
            PERFORM public.classificar_duplicidade_documento(v_outro_id);
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS documents_checa_duplicidade ON public.documents;
CREATE TRIGGER documents_checa_duplicidade
AFTER INSERT OR UPDATE OF numero_nf, cnpj_emissor, valor
ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.trg_documents_checa_duplicidade();

-- ==============================================================
-- 4) BACKFILL DO LEGADO (passo único, não é endpoint)
-- ==============================================================
DO $$
DECLARE
    v_id uuid;
BEGIN
    FOR v_id IN
        SELECT id FROM public.documents
        WHERE tipo_documento = 'nf'
          AND numero_nf IS NOT NULL AND btrim(numero_nf) <> ''
          AND cnpj_emissor IS NOT NULL AND btrim(cnpj_emissor) <> ''
        ORDER BY created_at
    LOOP
        PERFORM public.classificar_duplicidade_documento(v_id);
    END LOOP;
END $$;

-- ==============================================================
-- 5) VERIFICAÇÃO
-- ==============================================================
-- Esperado, conforme levantamento em produção:
--   confirmada = 4  (os pares de numero_nf '13' e '00000107')
--   possivel   = 5  (os 3 de numero_nf '01' + os 2 de '3467')
SELECT nivel_duplicidade, COUNT(*) AS total
FROM public.documents
WHERE nivel_duplicidade IS NOT NULL
GROUP BY nivel_duplicidade
ORDER BY nivel_duplicidade;

-- Detalhe dos grupos encontrados, para conferir caso a caso.
SELECT project_id, numero_nf, cnpj_emissor,
       COUNT(*) AS documentos,
       COUNT(DISTINCT valor) AS valores_distintos,
       array_agg(valor ORDER BY created_at) AS valores,
       array_agg(nivel_duplicidade ORDER BY created_at) AS niveis
FROM public.documents
WHERE tipo_documento = 'nf'
  AND numero_nf IS NOT NULL AND cnpj_emissor IS NOT NULL
GROUP BY project_id, numero_nf, cnpj_emissor
HAVING COUNT(*) > 1
ORDER BY numero_nf;
