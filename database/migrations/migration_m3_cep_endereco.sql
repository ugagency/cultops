-- ==============================================================
-- migration_m3_cep_endereco.sql
--
-- Entrada de endereço por CEP nos formulários de Evento e de OS (M3), com
-- coordenadas vindas da BrasilAPI CEP V2 em vez de digitação manual de lat/lon.
--
-- As duas tabelas precisavam de coisas DIFERENTES — conferido no banco antes:
--   distribution_events → não tinha cep NEM bairro
--   distribution_os     → já tinha cep; faltava só bairro
-- Por isso os dois ALTER abaixo não são simétricos.
--
-- lat/lon já existem nas duas tabelas e continuam como estão: o preenchimento
-- automático só passa a alimentá-las, sem trocar tipo nem semântica. Seguem
-- editáveis à mão, porque getOsProximas() filtra por raio de 30km e a
-- geolocalização por CEP é aproximada (OpenStreetMap, conforme a própria
-- documentação da V2 admite).
-- ==============================================================

ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS bairro text;

ALTER TABLE public.distribution_os
  ADD COLUMN IF NOT EXISTS bairro text;

COMMENT ON COLUMN public.distribution_events.cep IS
  'CEP do local do evento. Usado para preencher endereço, cidade, estado, bairro e coordenadas via BrasilAPI CEP V2.';

COMMENT ON COLUMN public.distribution_events.bairro IS
  'Bairro do local, preenchido a partir do CEP. Pode vir vazio: a API devolve neighborhood nulo em muitos CEPs de cidade pequena e área rural.';

COMMENT ON COLUMN public.distribution_os.bairro IS
  'Bairro da OS, preenchido a partir do CEP. Pode vir vazio: a API devolve neighborhood nulo em muitos CEPs de cidade pequena e área rural.';

-- ==============================================================
-- VERIFICAÇÃO
-- ==============================================================
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('distribution_events', 'distribution_os')
  AND column_name IN ('cep', 'bairro', 'lat', 'lon', 'endereco', 'cidade', 'estado')
ORDER BY table_name, column_name;
