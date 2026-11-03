-- Aplicada em 03/11/2026.
-- #154: documento excluido (excluido_em preenchido) nao entra na checagem de duplicidade.

-- Mudanca 1: funcao de classificacao. Mesma assinatura, mesmo SECURITY DEFINER.
-- (a) o documento excluido nao e classificado (limpa a marca, se tiver);
-- (b) um documento excluido nunca e escolhido como "o original".
CREATE OR REPLACE FUNCTION public.classificar_duplicidade_documento(p_document_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_doc        public.documents%ROWTYPE;
    v_par_id     uuid;
    v_nivel      text;
BEGIN
    SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id;

    IF NOT FOUND
       OR v_doc.excluido_em IS NOT NULL
       OR v_doc.tipo_documento IS NULL
       OR v_doc.tipo_documento NOT IN ('nf', 'comprovante')
       OR v_doc.numero_nf IS NULL OR btrim(v_doc.numero_nf) = ''
       OR v_doc.cnpj_emissor IS NULL OR btrim(v_doc.cnpj_emissor) = ''
    THEN
        UPDATE public.documents
        SET nivel_duplicidade = NULL, duplicata_de_id = NULL
        WHERE id = p_document_id AND nivel_duplicidade IS NOT NULL;
        RETURN NULL;
    END IF;

    SELECT d.id INTO v_par_id
    FROM public.documents d
    WHERE d.project_id     = v_doc.project_id
      AND d.tipo_documento = v_doc.tipo_documento
      AND d.numero_nf      = v_doc.numero_nf
      AND d.cnpj_emissor   = v_doc.cnpj_emissor
      AND d.id <> v_doc.id
      AND d.excluido_em IS NULL
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
        duplicidade_revisada = CASE
            WHEN nivel_duplicidade IS DISTINCT FROM v_nivel THEN false
            ELSE duplicidade_revisada
        END
    WHERE id = p_document_id
      AND (nivel_duplicidade IS DISTINCT FROM v_nivel
           OR duplicata_de_id IS DISTINCT FROM v_par_id);

    RETURN v_nivel;
END;
$function$;

-- Mudanca 2: o gatilho tambem dispara quando excluido_em muda (excluir e restaurar),
-- para o par do documento excluido ser reclassificado na hora.
DROP TRIGGER IF EXISTS documents_checa_duplicidade ON public.documents;
CREATE TRIGGER documents_checa_duplicidade
AFTER INSERT OR UPDATE OF numero_nf, cnpj_emissor, valor, excluido_em ON public.documents
FOR EACH ROW EXECUTE FUNCTION trg_documents_checa_duplicidade();

-- Mudanca 3: limpa as marcas do caso de hoje (nota 111): o reenviado e o excluido.
SELECT public.classificar_duplicidade_documento('daf16831-97b3-48b3-b59e-8042c1deab1c');
SELECT public.classificar_duplicidade_documento('3589af89-500d-481d-8375-f57a77c69b4d');
