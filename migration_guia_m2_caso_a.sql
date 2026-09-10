-- SPEC-GUIA-01, Caso A — guia sobe direto no M1 (documents), cria a linha
-- correspondente em tax_guides (M2) automaticamente.
--
-- Idempotência: json_extraido é reescrito mais de uma vez durante o
-- processamento do OCR (classificação, depois extração fina) — o EXISTS
-- abaixo evita criar uma linha nova a cada reescrita, mesma proteção que
-- trg_documents_cria_despesa já tem (lá via ON CONFLICT; aqui via EXISTS
-- porque não há constraint única em tax_guides.document_id).
--
-- Status condicional: só nasce 'paga' se o documento já tiver
-- data_pagamento E valor_pago preenchidos (comprovante já processado pelo
-- OCR). Sem isso, nasce 'pendente' — o fluxo de comprovante separado do M1
-- pode preencher esses campos depois, mas essa atualização não é coberta
-- por esta versão do trigger (ela só observa json_extraido, não
-- data_pagamento/valor_pago) — mesmo escopo descrito na spec, sem promoção
-- automática posterior de pendente → paga.
--
-- Não checa subtipo_documento: confirmado contra produção que a esteira do
-- n8n nunca escreve essa coluna, só json_extraido — json_extraido->'guia'
-- é o sinal certo e já confiável sozinho (mesmo critério que
-- app.js/renderDadosGuia já usa).
--
-- Não faz nenhum match contra guias pendentes existentes no M2 (isso é
-- deliberado — ver Caso D, resolvido como reconciliação retroativa na tela
-- de detalhes do M1, não dentro deste trigger).

CREATE OR REPLACE FUNCTION public.trg_documents_cria_guia_m2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_guia jsonb;
    v_status text;
BEGIN
    v_guia := NEW.json_extraido->'guia';
    IF v_guia IS NULL THEN
        RETURN NEW;
    END IF;

    -- Dados mínimos ainda não chegaram (OCR pode estar no meio do processamento).
    IF v_guia->>'tributo' IS NULL OR v_guia->>'competencia' IS NULL
       OR v_guia->>'vencimento' IS NULL OR v_guia->>'valor_tributo' IS NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.tax_guides WHERE document_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    v_status := CASE
        WHEN NEW.data_pagamento IS NOT NULL AND NEW.valor_pago IS NOT NULL THEN 'paga'
        ELSE 'pendente'
    END;

    INSERT INTO public.tax_guides (
        project_id, organization_id, tipo_imposto, competencia, data_vencimento,
        valor, codigo_receita, numero_guia, document_id, status, data_pagamento
    ) VALUES (
        NEW.project_id,
        NEW.organization_id,
        v_guia->>'tributo',
        v_guia->>'competencia',
        (v_guia->>'vencimento')::date,
        (v_guia->>'valor_tributo')::numeric,
        v_guia->>'codigo_receita',
        v_guia->>'numero_guia',
        NEW.id,
        v_status,
        CASE WHEN v_status = 'paga' THEN NEW.data_pagamento ELSE NULL END
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_cria_guia_m2 ON public.documents;
CREATE TRIGGER documents_cria_guia_m2
AFTER INSERT OR UPDATE OF json_extraido ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.trg_documents_cria_guia_m2();
