# Documentação Geral do Projeto: Prestaí

## 1. Visão Geral
O **Prestaí** é um assistente completo de conformidade financeira e gestão de orçamentos, focado especificamente em projetos aprovados pela **Lei Rouanet**. Seu principal objetivo é automatizar e simplificar a prestação de contas no sistema oficial do governo (**SALIC**), garantindo o compliance fiscal, categorização das despesas (rubricas), conciliação bancária e, por fim, a automação do envio.

## 2. Arquitetura e Stack Tecnológico
O projeto adota uma arquitetura modularizada que separa o front-end, banco de dados/autenticação e as rotinas de automação em background:

- **Front-end:** Vanilla JavaScript (ES6+), HTML5, CSS3. Utiliza um padrão de "Single Page Application (SPA)" customizado governado pelo `app.js`.
- **Banco de Dados e Backend-as-a-Service (BaaS):** Supabase (PostgreSQL). Gerencia autenticação, Row Level Security (RLS) e envio de arquivos (Storage/Buckets).
- **Orquestração e Integração:** **n8n** gerenciando fluxos de dados, Webhooks para processamento avançado, acionamento de OCR (leitura de notas fiscais) e cron jobs para transições de status (ex: Regra D-3).
- **RPA e Automação Web:** Scripts em **Puppeteer** (ex: `salic_insertion.cjs`) e integrações via Airtop para navegar automaticamente no portal do Ministério da Cultura (SALIC), ler dados e imputar recibos.
- **Servidor Web Local / Hospedagem:** O projeto possui um servidor Node.js/Express (`server.js`) pronto para rodar o cliente e prover endpoints úteis.

## 3. Principais Módulos do Sistema

### 3.1. Painel do Proponente (Gestor)
Interface para quem administra o(s) projeto(s) incentivado(s):
- **Importação de Projetos:** O usuário digita o número do PRONAC e o sistema varre o SALIC para buscar os dados oficiais e criar as instâncias locais.
- **Gestão de Rubricas:** Acompanhamento do orçamento (aprovado vs captado).
- **Upload de Documentos:** Envio de Notas Fiscais (NFs) relacionando a uma rubrica para análise OCR.
- **Conciliação Bancária:** Match das despesas físicas com extratos do banco.

### 3.2. Portal do Fornecedor
Área segregada onde os prestadores de serviço sobem seus próprios comprovantes:
- Permite que fornecedores façam o cadastro rápido no sistema.
- Realizam uploads de NFs ou comprovantes diretos na base do proponente, minimizando gargalos de comunicação.

### 3.3. Status de Pipeline da Despesa
A vida de um documento fiscal no Prestaí baseia-se em uma transição rigorosa de estados para garantir conformidade:
1. `uploaded` -> `processing_ocr` (Em servidor IA)
2. `aguardando_comprovante` ou `aguardando_conciliacao_bancaria`
3. `aguardando_d3` (Carência técnica)
4. `liberado_rpa_airtop` (Pronto para o Robô)
5. `enviado_salic` / `concluido`
- **Desvios de erro:** `bloqueado_conformidade`, `revisao_manual`, `erro_rpa`.

## 4. Banco de Dados e Modelagem Principal (Supabase)
O banco postgres conta com as principais tabelas (protegidas por RLs para Multi-Tenant, ou seja, onde cada usuário só vê os dados dos próprios projetos):
- `projects` / `projetos`: Guarda o PRONAC, nome, usuário dono.
- `rubricas` & `catalogo_rubricas`: Definições orçamentárias.
- `documents` / `despesas`: As notas fiscais aprovadas ou não.
- `fornecedores`: Dados de CNPJ/CNAE.
- `extratos_bancarios`: Arquivos de remessa bancária.

## 5. Script de Inserção SALIC
A automação principal fica a cargo do `salic_insertion.cjs`. O script executa os seguintes passos lógicos usando Puppeteer (modo local Chrome ou browserWSEndpoint, como Browserless):
1. **Login:** Acessa `salic.cultura.gov.br` usando CPF/Senha.
2. **Busca:** Consulta o projeto filtrando pelo PRONAC.
3. **Navegação (iFrames):** Interage com a complexa UI do SALIC para encontrar a sub-página de "Comprovação Financeira".
4. **Inserção:** Encontra a linha da rubrica do orçamento, clica em "Inserir" e abre o modal/página para preenchimento.

## 6. Configuração e Variáveis (Ambiente)
O app requer a configuração básica de `.env` ou `config.js` com:
- `SUPABASE_URL`: Endpoint da API
- `SUPABASE_KEY`: Chave anônima (anon key)
O script de Node / n8n necessitará das chaves secretas e credenciais do Governo (criptografadas logicamente em segredo).
