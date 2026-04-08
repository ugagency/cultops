-- ==========================================================
-- SQL SETUP PARA PRESTAÍ - UPLOAD E PROJETOS
-- ==========================================================

-- 1. Tabela de Projetos (PRONACs)
-- 1. Tabela de Projetos (PRONACs)
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    pronac TEXT NOT NULL,
    nome TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    propoente TEXT,
    "Mecanismo" TEXT,
    uf TEXT,
    valor_aprovado TEXT,
    valor_captado TEXT
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
        'uploaded', 'processing_ocr', 'validating', 'validated', 
        'bloqueado_conformidade', 'aguardando_d3', 
        'enviado_salic', 'erro_rpa', 'concluido'
    )),
    valor DECIMAL(12,2),
    cnpj_emissor TEXT,
    data_emissao DATE,
    data_pagamento DATE,
    justification TEXT,
    just_erro TEXT,
    protocolo_salic TEXT,
    json_extraido JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Habilitar RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Users can access their own projects" ON projects;
DROP POLICY IF EXISTS "Users can access their own documents" ON documents;

-- Projetos: Gestor vê e gerencia os seus
CREATE POLICY "Gestores inserem projetos" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Gestores veem seus projetos" ON projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Gestores atualizam seus projetos" ON projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Gestores deletam seus projetos" ON projects FOR DELETE USING (auth.uid() = user_id);

-- Documentos: Gestor ou dono do doc vê os seus
CREATE POLICY "Gestor ve docs do projeto" ON documents FOR SELECT USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);
CREATE POLICY "Usuarios inserem documentos" ON documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Usuarios atualizam documentos" ON documents FOR UPDATE USING (
    auth.uid() = user_id OR project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);
CREATE POLICY "Usuarios deletam documentos" ON documents FOR DELETE USING (
    auth.uid() = user_id OR project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);

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

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- ==========================================================
-- FASE 2: SPRINT 3 - PORTAL DO SOLICITANTE
-- ==========================================================

-- 6. Perfis de Solicitantes (Appends over auth.users)
CREATE TABLE IF NOT EXISTS public.fornecedores (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    cnpj TEXT UNIQUE NOT NULL,
    razao_social TEXT NOT NULL,
    telefone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 7. Vínculo entre Solicitante e Projeto
-- IMPORTANTE: gestor_id armazenado diretamente para evitar recursão no RLS
CREATE TABLE IF NOT EXISTS public.projeto_fornecedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE CASCADE,
    gestor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(project_id, fornecedor_id)
);

-- Adicionar campo de solicitante nos documentos
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL;

-- ============================================================
-- RLS SEM RECURSÃO (chave: projeto_fornecedores.gestor_id)
-- ============================================================

-- Documentos: limpar políticas antigas conflitantes
DROP POLICY IF EXISTS "Dono ve os docs pelo user_id" ON documents;
DROP POLICY IF EXISTS "Gestor ve os docs pelo project_id" ON documents;
DROP POLICY IF EXISTS "Fornecedor ve seus docs" ON documents;

-- Gestor enxerga documentos do PROJETO inteiro (incluindo do solicitante)
CREATE POLICY "Gestor acessa docs do projeto" ON documents FOR ALL
USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Solicitante só vê os docs que ele mesmo enviou
CREATE POLICY "Solicitante acessa seus proprios docs" ON documents FOR SELECT
USING (auth.uid() = fornecedor_id);

-- Solicitante pode inserir documentos
CREATE POLICY "Solicitante insere doc" ON documents FOR INSERT
WITH CHECK (auth.uid() = fornecedor_id);

-- ============================================================
-- RLS de Solicitantes (sem ciclo)
-- ============================================================
ALTER TABLE fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE projeto_fornecedores ENABLE ROW LEVEL SECURITY;

-- Solicitante gerencia seu próprio perfil
DROP POLICY IF EXISTS "Solicitantes alteram seu perfil" ON fornecedores;
CREATE POLICY "Solicitante gerencia seu perfil" ON fornecedores FOR ALL
USING (auth.uid() = id);

-- Gestor vê todos os solicitantes para poder vinculá-los
-- Sem referenciar projects (evita ciclo)
DROP POLICY IF EXISTS "Gestores veem todos os fornecedores para vincular" ON fornecedores;
DROP POLICY IF EXISTS "Gestores veem fornecedores do projeto" ON fornecedores;
CREATE POLICY "Usuario autenticado ve solicitantes" ON fornecedores FOR SELECT
USING (auth.role() = 'authenticated');

-- ============================================================
-- RLS de projeto_fornecedores (SEM referenciar a tabela projects)
-- Usa gestor_id diretamente — quebra o ciclo de recursão
-- ============================================================
DROP POLICY IF EXISTS "Fornecedores veem seus projetos convidados" ON projeto_fornecedores;
DROP POLICY IF EXISTS "Fornecedores podem se vincular" ON projeto_fornecedores;
DROP POLICY IF EXISTS "Gestores controlam seus projetos" ON projeto_fornecedores;

-- Solicitante vê seus vínculos
CREATE POLICY "Solicitante ve seus vinculos" ON projeto_fornecedores FOR SELECT
USING (auth.uid() = fornecedor_id);

-- Gestor controla seus próprios vínculos (via gestor_id, sem referenciar projects)
CREATE POLICY "Gestor gerencia vinculos" ON projeto_fornecedores FOR ALL
USING (auth.uid() = gestor_id);

-- ============================================================
-- RLS de projects: Fornecedor vê projetos dos quais foi convidado
-- Usa projeto_fornecedores.fornecedor_id (sem voltar para projects)
-- ============================================================
DROP POLICY IF EXISTS "Fornecedores veem infos dos projetos vinculados" ON projects;
CREATE POLICY "Fornecedor ve projetos convidado" ON projects FOR SELECT
USING (
    id IN (SELECT project_id FROM projeto_fornecedores WHERE fornecedor_id = auth.uid())
);


-- ============================================================
-- SPRINT 4: AUTOMAÇÃO E CREDENCIAIS EXTERNAS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.external_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    service_name TEXT NOT NULL, -- ex: 'salic'
    identifier TEXT NOT NULL,    -- ex: CPF
    secret TEXT NOT NULL,        -- ex: Senha (idealmente criptografada)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, service_name)
);

ALTER TABLE external_credentials ENABLE ROW LEVEL SECURITY;

-- Função para salvar credenciais com criptografia PGP
-- A chave 'sua_chave_mestra_aqui' deve ser trocada por uma variável de ambiente no n8n depois
CREATE OR REPLACE FUNCTION upsert_external_credential(
    p_service_name TEXT,
    p_identifier TEXT,
    p_secret TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.external_credentials (user_id, service_name, identifier, secret, updated_at)
    VALUES (
        auth.uid(), 
        p_service_name, 
        p_identifier, 
        encode(pgp_sym_encrypt(p_secret, 'chave_mestra_cultopps'), 'hex'), -- Criptografa e converte para HEX
        now()
    )
    ON CONFLICT (user_id, service_name) 
    DO UPDATE SET 
        identifier = EXCLUDED.identifier,
        secret = EXCLUDED.secret,
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View para o n8n descriptografar (Protegida por RLS ou usada apenas via Service Role)
CREATE OR REPLACE VIEW decrypted_external_credentials AS
SELECT 
    user_id,
    service_name,
    identifier,
    pgp_sym_decrypt(decode(secret, 'hex'), 'chave_mestra_cultopps') as secret_plain
FROM public.external_credentials;

CREATE POLICY "Users can manage their own credentials" 
ON external_credentials FOR ALL 
USING (auth.uid() = user_id);
-- ============================================================
-- SPRINT 4: CONCILIAÇÃO BANCÁRIA
-- ============================================================

CREATE TABLE IF NOT EXISTS public.extratos_bancarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    data_transacao DATE NOT NULL,
    descricao TEXT NOT NULL,
    valor NUMERIC(12,2) NOT NULL,
    documento_referencia TEXT, -- Numero do doc/cheque no extrato
    conciliado_com_despesa_id UUID REFERENCES public.despesas(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE extratos_bancarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own bank statements" 
ON extratos_bancarios FOR ALL 
USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Adicionar flag de conciliação nas despesas se não existir (ajuste da fase 2)
ALTER TABLE public.despesas ADD COLUMN IF NOT EXISTS extrato_vinculado_id UUID REFERENCES public.extratos_bancarios(id) ON DELETE SET NULL;
