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
