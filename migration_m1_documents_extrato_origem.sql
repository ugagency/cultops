ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extrato_origem_id uuid
  REFERENCES public.extratos(id);

CREATE INDEX IF NOT EXISTS idx_documents_extrato_origem
  ON public.documents(extrato_origem_id);

COMMENT ON COLUMN public.documents.extrato_origem_id IS
  'Extrato ao qual este documento pertence por ORIGEM: gravado no upload em lote, delimitando o universo de conciliação na fonte. Distinto de extratos_lancamentos.document_id, que é o vínculo lançamento-a-lançamento feito na conciliação posterior. NULL = documento subido sem extrato (fluxo antigo, segue válido).';
