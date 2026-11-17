-- #209 (e base para #191/#207): o trigger genérico de auditoria de documents passa a registrar
-- também o parecer da análise (justification), o motivo de erro/bloqueio (just_erro), a data de
-- emissão e o nome do emissor. Até aqui, essas mudanças não ficavam no histórico do documento.
-- fitid e extrato_origem_id continuam fora: já são registrados de forma explícita pelas rotinas
-- que os alteram (confirmar_lancamento_nota, informar_pagamento_manual, vincular_extrato).
-- Idempotente: recria o mesmo trigger com a lista nova.
DROP TRIGGER IF EXISTS audit_documents_update ON public.documents;
CREATE TRIGGER audit_documents_update
    AFTER UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.trg_audit_generico(
        'status', 'valor', 'valor_pago', 'cnpj_emissor', 'rubrica_id_fk', 'fornecedor_id',
        'protocolo_salic', 'aprovado_por', 'numero_nf', 'data_pagamento', 'nivel_duplicidade',
        'justification', 'just_erro', 'data_emissao', 'nome_emissor'
    );
