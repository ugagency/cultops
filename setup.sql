-- ==========================================================
-- SQL SETUP PARA CULTOPS - UPLOAD E PROJETOS
-- ==========================================================

-- 1. Tabela de Projetos (PRONACs)
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    pronac TEXT NOT NULL,
    nome TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Tabela de Documentos
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    size TEXT,
    file_path TEXT NOT NULL,
    status TEXT DEFAULT 'uploaded' CHECK (status IN (
        'uploaded', 'processing_ocr', 'validated', 
        'bloqueado_conformidade', 'aguardando_d3', 
        'enviado_salic', 'erro_rpa', 'concluido'
    )),
    valor DECIMAL(12,2),
    cnpj_emissor TEXT,
    data_emissao DATE,
    data_pagamento DATE,
    justification TEXT,
    protocolo_salic TEXT,
    json_extraido JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Habilitar RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Users can access their own projects" ON projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can access their own documents" ON documents FOR ALL USING (auth.uid() = user_id);

-- ==========================================================
-- INSTRUÇÕES STORAGE
-- ==========================================================
-- 1. Vá em Storage no painel do Supabase.
-- 2. Crie um novo Bucket chamado: documentos
-- 3. Edite as políticas do Bucket para permitir INSERT e SELECT para usuários autenticados.

-- ==========================================================
-- FASE 2: GESTÃO FINANCEIRA E ORÇAMENTO
-- ==========================================================

-- 3.5. Catálogo Global de Rubricas (Validação por IA)
CREATE TABLE IF NOT EXISTS public.catalogo_rubricas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL UNIQUE,
    especificacoes TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Inserir alguns exemplos iniciais de rubricas
INSERT INTO public.catalogo_rubricas (nome, especificacoes) VALUES 
('Cachê Artístico', 'Pagamento de artistas, músicos, atores. Exige nota fiscal com CNAE artístico ou recibo no caso de Pessoa Física.'),
('Assessoria Jurídica', 'Serviços de advogados. Limitado a profissionais inscritos na OAB.'),
('Coordenação Geral', 'Pagamento do coordenador do projeto. Sem exigência cruzada específica de fornecedor.'),
('Aluguel de Equipamentos', 'Locação de som, luz, palco para o projeto.'),
('Divulgação e Marketing', 'Serviços de panfletagem, tráfego pago, assessoria de imprensa.')
ON CONFLICT (nome) DO NOTHING;

-- 4. Tabela de Rubricas (Fase 2)
CREATE TABLE IF NOT EXISTS public.rubricas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    nome TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(project_id, nome)
);

-- 5. Tabela de Despesas (Fase 2)
CREATE TABLE IF NOT EXISTS public.despesas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL UNIQUE,
    rubrica_id UUID REFERENCES public.rubricas(id) ON DELETE RESTRICT NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    valor NUMERIC(12,2) NOT NULL,
    cnpj_fornecedor TEXT,
    cnae_fornecedor TEXT,
    data_emissao DATE,
    data_pagamento DATE,
    status_conformidade TEXT DEFAULT 'pendente' CHECK (status_conformidade IN ('ok', 'bloqueado', 'pendente')),
    motivo_bloqueio TEXT,
    conciliado BOOLEAN DEFAULT false,
    liberado_rpa BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS para Rubricas e Despesas
ALTER TABLE rubricas ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access rubricas of their projects" 
ON rubricas FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can access despesas of their projects" 
ON despesas FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
