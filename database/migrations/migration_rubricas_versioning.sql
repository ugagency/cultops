-- Migration: Rubrica Versioning
CREATE TABLE IF NOT EXISTS public.rubricas_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    version_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    total_rubricas INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.rubricas_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access versions of their projects" 
ON rubricas_versions FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);
