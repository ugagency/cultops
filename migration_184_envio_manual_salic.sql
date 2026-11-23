-- #184: nota que o robô não conseguiu enviar (erro_rpa) e que o cliente lançou manualmente no SALIC.
-- Pedido do Felipe: manter a saída por conta e risco, mas deixando claro que o lançamento é manual e
-- marcando a nota como envio manual, para não perder o rastro na gestão dos documentos.
-- Antes, "Continuar por Conta e Risco" levava erro_rpa para liberado_rpa_airtop, ou seja, devolvia a
-- nota para a fila do robô, com risco de lançamento em dobro.
-- Idempotente.

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS envio_salic_manual boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS envio_salic_manual_por uuid,
    ADD COLUMN IF NOT EXISTS envio_salic_manual_em timestamptz;

COMMENT ON COLUMN public.documents.envio_salic_manual IS
    '#184: true quando a nota foi lançada manualmente no SALIC pelo cliente depois de falha do robô (registrar_envio_manual_salic).';

-- Registra o envio manual. Só admin da organização, só nota em erro_rpa e não excluída.
-- A nota vai para enviado_salic (não volta para a fila do robô), a despesa recebe data_salic como no
-- envio automático, e o audit_log fica com origem envio_manual_salic e o motivo informado.
CREATE OR REPLACE FUNCTION public.registrar_envio_manual_salic(p_document_id uuid, p_protocolo text, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    d public.documents%ROWTYPE;
    v_org uuid;
    v_protocolo text := nullif(btrim(coalesce(p_protocolo, '')), '');
    v_motivo text := 'Lançamento manual no SALIC confirmado na tela'
        || CASE WHEN nullif(btrim(coalesce(p_motivo, '')), '') IS NOT NULL THEN ': ' || btrim(p_motivo) ELSE '' END
        || CASE WHEN v_protocolo IS NOT NULL THEN ' (protocolo ' || v_protocolo || ')' ELSE '' END;
BEGIN
    IF NOT public.has_any_role('admin') THEN
        RAISE EXCEPTION 'Apenas administradores podem registrar o envio manual ao SALIC.';
    END IF;
    SELECT * INTO d FROM public.documents WHERE id = p_document_id FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;
    SELECT organization_id INTO v_org FROM public.projects WHERE id = d.project_id;
    IF v_org IS DISTINCT FROM public.current_user_org_id() THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;
    IF d.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'Nota excluída.'; END IF;
    IF d.status <> 'erro_rpa' THEN
        RAISE EXCEPTION 'Só nota com falha no envio ao SALIC pode ser marcada como envio manual (status atual: %).', d.status;
    END IF;

    PERFORM set_config('app.origem', 'envio_manual_salic', true);
    UPDATE public.documents
       SET status = 'enviado_salic',
           envio_salic_manual = true,
           envio_salic_manual_por = auth.uid(),
           envio_salic_manual_em = now(),
           protocolo_salic = coalesce(v_protocolo, protocolo_salic)
     WHERE id = d.id AND status = 'erro_rpa';

    UPDATE public.despesas
       SET data_salic = now(),
           protocolo_salic = coalesce(v_protocolo, protocolo_salic)
     WHERE document_id = d.id;

    UPDATE public.audit_log
       SET motivo = v_motivo
     WHERE tabela = 'documents' AND registro_id = d.id AND campo = 'status'
       AND created_at = now() AND motivo IS NULL;

    RETURN jsonb_build_object('ok', true, 'status_anterior', d.status, 'status_novo', 'enviado_salic');
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_envio_manual_salic(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_envio_manual_salic(uuid, text, text) TO authenticated;

-- Auditoria: a lista de campos da migration_209 mais envio_salic_manual. Aplicar esta depois da 209
-- (ou só esta: ela já inclui os campos da 209).
DROP TRIGGER IF EXISTS audit_documents_update ON public.documents;
CREATE TRIGGER audit_documents_update
    AFTER UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.trg_audit_generico(
        'status', 'valor', 'valor_pago', 'cnpj_emissor', 'rubrica_id_fk', 'fornecedor_id',
        'protocolo_salic', 'aprovado_por', 'numero_nf', 'data_pagamento', 'nivel_duplicidade',
        'justification', 'just_erro', 'data_emissao', 'nome_emissor', 'envio_salic_manual'
    );
