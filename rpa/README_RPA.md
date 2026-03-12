# Arquitetura RPA Prestaí (Python + Playwright)

Este módulo é responsável por automatizar a inserção de despesas no portal Salic/MinC.

## 🏗️ Estrutura do Projeto
- `main.py`: Servidor FastAPI que recebe comandos do n8n.
- `salic_bot.py`: Lógica central de automação usando Playwright.
- `requirements.txt`: Bibliotecas necessárias (Playwright, Supabase, FastAPI).

## 🚀 Como a Automação Funciona
1. **Gatilho:** O n8n chama o endpoint `POST /run-rpa/{document_id}`.
2. **Dados:** O RPA busca todos os dados extraídos (PRONAC, Valor, CNPJ, Status) no Supabase.
3. **Execução:** O Playwright abre um navegador, faz login no Salic e preenche os formulários.
4. **Resultado:** O status do documento no Supabase é atualizado para `enviado_salic` ou `erro_rpa`.

## 🛠️ Infraestrutura Necessária
Para rodar este RPA em produção, você tem três caminhos principais:

### Opção A: Servidor Próprio (VPS/Local) - **Recomendado**
1. Instalar Python 3.10+.
2. Instalar navegadores do Playwright: `playwright install chromium`.
3. Rodar como serviço: `uvicorn main:app --host 0.0.0.0 --port 8000`.

### Opção B: Docker (Escalável)
- Use uma imagem base `mcr.microsoft.com/playwright/python:v1.40.0-jammy`.
- Garante que todas as dependências do navegador estejam presentes.

### Opção C: Cloud Functions (GCP/AWS)
- Difícil para RPA de longa duração, mas possível se o processo for rápido (< 5 min).

## 🔒 Segurança
- Nunca salve senhas no código. Use o arquivo `.env`.
- Em produção, adicione um `API_KEY` no cabeçalho do FastAPI para garantir que apenas o seu n8n consiga disparar o RPA.
