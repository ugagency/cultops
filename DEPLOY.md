# DEPLOY.md — Runbook de Operação e Deploy do Prestaí (Cultopps)

Este documento descreve como o sistema Prestaí está implantado hoje: quem
serve o quê, onde cada parte roda, quais variáveis de ambiente ele espera e
quais pontos **não** estão documentados no repositório. Escrito para alguém
que precise assumir a manutenção sem ter acompanhado o projeto.

## 1. Visão geral da topologia

```
                         ┌─────────────────────────┐
   usuário (browser) ──▶ │  Vercel                 │
                         │  - estáticos (html/js/css,
                         │    modulo2/, modulo3/)  │
                         │  - server.js (função     │
                         │    serverless, /api/*)   │
                         │  - api/salic/inserir.js  │
                         └───────────┬──────────────┘
                                     │
                    ┌────────────────┼───────────────────┐
                    ▼                ▼                    ▼
            ┌───────────────┐ ┌─────────────┐   ┌──────────────────────┐
            │   Supabase    │ │  n8n        │   │  Worker RPA (SALIC)  │
            │ (Postgres +   │ │ (externo,   │   │  branch git `api`    │
            │  Auth +       │ │  automacoes-│   │  cultops-rpa-worker/ │
            │  Storage +    │ │  n8n.       │   │  cultops-rpa-worker- │
            │  pg_cron)     │ │  infrassys. │   │  m2/                 │
            └───────────────┘ │  com)       │   │  deploy via Docker + │
                               └─────────────┘   │  GitHub Actions →    │
                                                  │  VPS Hostinger (SSH) │
                                                  └──────────────────────┘
```

- O app principal (frontend estático + API Express em `server.js`) é servido
  pela **Vercel**, conforme `vercel.json` na raiz.
- O **Supabase** é o banco/autenticação/storage e também dispara `pg_cron`
  (ex.: alertas de guia) chamando de volta rotas do backend.
- O **n8n** roda **fora deste repositório**, num host próprio
  (`automacoes-n8n.infrassys.com`), e conversa com o backend via webhooks
  fixos (ver seção 5).
- O **worker de RPA do SALIC** (Puppeteer) vive isolado na **branch git
  `api`** — não faz parte do build da Vercel — e tem deploy próprio via
  Docker/GitHub Actions para um servidor separado. Isso é arquitetura
  intencional: o Puppeteer/Chromium não roda em ambiente serverless da
  Vercel, então esse worker precisa de uma VM/container próprio.

## 2. Variáveis de ambiente

Levantadas via grep de `process.env\.` em `server.js` (backend principal, na
branch `main`). **Nenhum valor real é reproduzido aqui** — só nomes e para
que servem. Não existe hoje um `.env.example` preenchido na raiz do
repositório: há um `config.example.js`, mas está **vazio (0 bytes)** — ou
seja, o "template" de configuração citado no projeto não está de fato
disponível no repo. Isso é uma lacuna real (ver seção 6).

| Variável | Para que serve |
|---|---|
| `PORT` | Porta em que o Express escuta localmente (default `3000`); na Vercel a porta é gerenciada pela plataforma. |
| `SUPABASE_URL` | URL do projeto Supabase (banco/auth/storage); usada tanto no backend quanto exposta ao frontend via `/config.js`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave `service_role` do Supabase — acesso privilegiado, usada para ler/gravar dados no servidor (bypassa RLS). Nunca deve ir ao frontend. |
| `SUPABASE_ANON_KEY` | Chave anônima/pública do Supabase, repassada ao frontend via `/config.js` (`SUPABASE_KEY`). |
| `MISTRAL_API_KEY` | Chave da API da Mistral, usada em rotas de OCR/parsing de documentos (extratos em PDF, notas fiscais). |
| `RESEND_API_KEY` | Chave da Resend, usada para envio de e-mails transacionais (alertas, notificações). |
| `RESEND_FROM_EMAIL` | E-mail remetente usado nos envios via Resend (default `onboarding@resend.dev` se não setado). |
| `CRON_SECRET` | Segredo compartilhado que protege rotas chamadas por cron externo (`x-cron-secret` no header) — ver seção 4. |
| `RAILWAY_URL` | URL do worker externo de RPA do SALIC (Puppeteer). O nome sugere Railway, mas hoje o deploy real desse worker (branch `api`) é feito via GitHub Actions + SSH para uma VPS Hostinger — ver seção 3.1 sobre essa inconsistência de nome. Quando setada, `server.js` delega `/api/salic/inserir` para `RAILWAY_URL + "/api/salic/inserir"`. |
| `BROWSERLESS_ENDPOINT` | Endpoint WebSocket de um serviço Browserless, usado como alternativa remota para rodar o Chromium do Puppeteer (em vez de um Chromium local). |
| `NODE_ENV` | Ambiente de execução (`production`/`development`); influencia comportamento de logging/serving. |
| `VERCEL` | Variável automática da própria Vercel — usada em `server.js` para detectar que está rodando serverless (e então delegar tarefas de Puppeteer para `RAILWAY_URL`, pois Chromium não roda no runtime serverless da Vercel). |
| `DISABLE_FRONTEND` | Quando `'true'`, o Express não serve os arquivos estáticos do frontend e responde apenas um texto simples — usado quando essa instância do `server.js`/código roda só como microsserviço de API (ex.: no worker RPA, que reaproveita este mesmo `server.js` como base). |

### Variáveis hardcoded (não são env vars, mas valem registro)

`server.js` expõe ao frontend, via `/config.js`, um conjunto de URLs de
webhook do n8n **hardcoded no código** (não vêm de variável de ambiente):

- `N8N_WEBHOOK_URL` → `.../webhook/cultops-ocr`
- `N8N_WEBHOOK_RECONCILIATION_URL` → `.../webhook/prestai-conciliation`
- `N8N_WEBHOOK_RECONCILIATION_LOTE_URL` → `.../webhook/prestai-conciliation-lote`
- `N8N_WEBHOOK_VALIDATION_URL` → `.../webhook/cultopsvalidation`
- `N8N_WEBHOOK_SALIC_PROJECT_URL` → `.../webhook/cultops-projeto`
- `N8N_WEBHOOK_SALIC_IMPORT_RUBRICAS_URL` → `.../webhook/uploadrubricas`
- `N8N_WEBHOOK_CRIAR_PDF_URL` → `.../webhook/relatorio`

Todas apontam para o host `automacoes-n8n.infrassys.com`. Se esse host mudar
(migração de instância n8n, por exemplo), essas URLs precisam ser editadas
diretamente em `server.js` (função que serve `/config.js`) — não há
variável de ambiente para isso hoje.

## 3. Deploy do app principal (Vercel)

`vercel.json` (raiz) define:

- **Estáticos** (`@vercel/static`): `index.html`, `style.css`, `app.js`,
  `auth-logout.js`, `page-sidebar.js`, `module-selector.html`,
  `equipe.html`, `configuracoes.html`, `solicitantes.html`,
  `plataforma.html`, `suporte.html`, tudo em `modulo2/**` e `modulo3/**`,
  além de `*.png`/`*.ico`.
- **Funções serverless** (`@vercel/node`):
  - `server.js` (backend Express principal, `maxDuration: 300`s) — atende
    todas as rotas `/api/:path*` e também `/config.js` (rewrites).
  - `api/salic/inserir.js` — endpoint dedicado que atende
    `/api/salic/inserir` diretamente (função separada, não passa pelo
    `server.js` na Vercel).
- **Rewrite de raiz**: `/` → `module-selector.html`.

`package.json` (raiz) define `main: server.js` e scripts `start`/`dev`
(`node server.js` / `nodemon server.js`) — usados para rodar o backend
localmente; o deploy na Vercel não usa esses scripts diretamente (a Vercel
constrói `server.js` como função serverless a partir do `vercel.json`).

Deploy prático: push/merge para a branch conectada ao projeto Vercel
(tipicamente `main`) dispara build e deploy automáticos pela integração
Git↔Vercel. As variáveis de ambiente da seção 2 precisam estar configuradas
no painel do projeto na Vercel (Settings → Environment Variables).

### 3.1. Worker RPA dentro do app Vercel — só o disparo

Importante: o Puppeteer **não roda dentro da função serverless da Vercel**.
Quando `VERCEL` está setado e chega uma chamada em `/api/salic/inserir`,
`server.js` apenas repassa (`fetch`) a requisição para
`RAILWAY_URL + "/api/salic/inserir"` — ou seja, delega para o worker externo
descrito na seção 3.2. Se `RAILWAY_URL` não estiver configurada na Vercel,
a rota responde erro 500 (`'RAILWAY_URL não configurada na Vercel.'`).

## 4. Deploy do worker RPA (branch `api`)

O robô que preenche dados no portal do governo (SALIC) usa Puppeteer e
**vive numa branch git separada, `api`** (não em `main`). Isso é
arquitetura intencional, não descuido: automação de navegador headless com
Chromium não roda bem em ambiente serverless (limites de tempo/memória e
falta de binário de browser), então foi isolada num serviço próprio.

Confirmado via `git log --oneline -5 origin/api` e
`git ls-tree -r --name-only origin/api` (leitura, sem checkout):

- `cultops-rpa-worker/` — worker principal (módulo 1), com `package.json`
  próprio (`cultops-rpa-worker`, dependências: `@supabase/supabase-js`,
  `cors`, `dotenv`, `express`, `puppeteer`, `ws`), `Dockerfile` e
  `server.js` (`salic_insertion.cjs` contém a lógica de automação).
- `cultops-rpa-worker-m2/` — worker equivalente para o módulo 2
  (`server.js` + `salic_comprovacao_fisica.cjs`), com `package.json`
  próprio. **Não há workflow de GitHub Actions dedicado a esta pasta** — só
  `cultops-rpa-worker/` tem deploy automatizado (ver abaixo); o deploy do
  `-m2` não está coberto pela automação encontrada no repo.
- `.github/workflows/deploy-rpa-worker.yml` — dispara em push para a branch
  `api` que toque `cultops-rpa-worker/**`, e faz:
  1. Conecta via SSH (`appleboy/ssh-action`) a um host usando os secrets
     `HOSTINGER_HOST` / `HOSTINGER_USER` / `HOSTINGER_SSH_KEY` (GitHub
     Actions Secrets do repositório).
  2. No host: `cd ~/cultops && git pull origin api && cd cultops-rpa-worker
     && docker compose up -d --build`.

**Inconsistência de nomenclatura a registrar**: o `Dockerfile` do worker
comenta "Railway fornece a porta via env var PORT" e a variável de ambiente
do backend principal se chama `RAILWAY_URL` — sinais de que o worker foi
originalmente pensado/hospedado no Railway. Porém o workflow de deploy
atual (`deploy-rpa-worker.yml`) publica via SSH + Docker Compose numa
**VPS Hostinger**, não no Railway. Ou seja: o nome da variável (`RAILWAY_URL`)
é legado e hoje deve apontar para a URL pública do worker rodando na VPS
Hostinger, não necessariamente para um serviço Railway. Isso não foi
verificado além do que está no repo — confirme com quem administra a
infraestrutura qual é o provedor/URL atual antes de mexer.

Deploy prático do worker: dar merge/push na branch `api` (pasta
`cultops-rpa-worker/`) — o GitHub Actions cuida do resto, desde que os
secrets `HOSTINGER_HOST`/`HOSTINGER_USER`/`HOSTINGER_SSH_KEY` estejam
configurados no repositório (Settings → Secrets and variables → Actions).
Para `cultops-rpa-worker-m2/`, não há evidência de automação — deploy
provavelmente manual (não confirmado, ver seção 6).

## 5. O que roda fora do repo (n8n)

O n8n é uma automação **externa**, hospedada em
`automacoes-n8n.infrassys.com`. A configuração dos workflows (nodes,
credenciais, lógica) **não está neste repositório** — só existe descrita em
markdown de apoio (`DOC-CONCILIACAO-LOTE-N8N.md`, `DOCUMENTACAO_PROJETO.md`)
e nas URLs de webhook hardcoded em `server.js` (seção 2).

Workflows identificados (pelos webhooks expostos e pela documentação):

- **OCR de notas fiscais** (`cultops-ocr`) — processa upload de NF e avança
  o pipeline de status do documento (`uploaded` → `processing_ocr` → ...).
- **Conciliação bancária 1×1** (`prestai-conciliation`) — casa um extrato
  com uma nota fiscal.
- **Conciliação em lote** (`prestai-conciliation-lote`) — casa um extrato
  de período contra todas as NFs pendentes do projeto (detalhado em
  `DOC-CONCILIACAO-LOTE-N8N.md`); convive com o fluxo 1×1, não o substitui.
- **Validação** (`cultopsvalidation`).
- **Projeto SALIC** (`cultops-projeto`) e **importação de rubricas**
  (`uploadrubricas`) — integrações com o portal SALIC.
- **Geração de relatório/PDF** (`relatorio`).
- **Cron de mudança de status D-3**: mencionado em `DOCUMENTACAO_PROJETO.md`
  como um cron do n8n (ou do Supabase `pg_cron`, não fica 100% claro qual)
  para regras de prazo (ex.: regra D-3 do fluxo de comprovação).

**Como acessar/editar**: não documentado no repositório. Quem for dar
manutenção precisa das credenciais de acesso ao painel do n8n em
`automacoes-n8n.infrassys.com` — não achadas aqui (ver lacunas, seção 6).

## 6. Cron jobs conhecidos

Duas rotas em `server.js` são protegidas por `CRON_SECRET` (header
`x-cron-secret`), ou seja, são feitas para ser chamadas por um agendador
externo (Supabase `pg_cron` e/ou n8n schedule) e não pelo frontend:

- **`POST /api/m2/cron-alerta-guias`** (linha ~2149) — segundo o comentário
  no código, é "chamado diariamente pelo `pg_cron` às 11h". Busca guias de
  imposto (`tax_guides`) com `status = 'pendente'` e vencimento nos
  próximos 7 dias, e envia alertas a gestores/analistas dos respectivos
  projetos.
- **`POST /api/m1/verificar-fornecedor-salic`** (linha ~834) — segundo o
  comentário no código, é disparado pelo trigger SQL
  `trg_verificar_fornecedor_salic` quando um documento chega em
  `aguardando_d3` (aplicado separadamente no banco, fora deste repo).
  Consulta a API pública do SALIC (`api.salic.cultura.gov.br`) para checar
  se o fornecedor (por CNPJ) existe cadastrado, e atualiza
  `fornecedores.existe_no_salic`. CPFs não são verificáveis (a API do
  governo mascara CPF).

Ambas retornam `401` se o header `x-cron-secret` não bater com
`CRON_SECRET`. Quem configura o agendador (painel do Supabase `pg_cron`,
ou um node de HTTP Request agendado no n8n) precisa ter esse mesmo segredo.

## 7. Lacunas conhecidas

Registrado honestamente o que este documento **não cobre**, porque a
informação não está disponível no repositório:

- **Credenciais e acesso ao n8n**: não há, no repo, como acessar o painel
  do n8n em `automacoes-n8n.infrassys.com` (login, forma de exportar/versionar
  os workflows). Os workflows em si (JSON exportado) também não estão no
  repositório — só descrições em markdown.
- **`config.example.js` está vazio** (0 bytes) — não serve como referência
  real de configuração, apesar de existir na raiz.
- **Não existe `.env.example`** com todas as variáveis da seção 2 — a lista
  desta seção foi reconstruída via grep no código, não via um arquivo de
  referência mantido pelo projeto.
- **Deploy de `cultops-rpa-worker-m2/`**: não foi encontrado nenhum
  workflow de GitHub Actions cobrindo essa pasta (o único workflow
  encontrado, `deploy-rpa-worker.yml`, dispara só em mudanças em
  `cultops-rpa-worker/**`). Como esse segundo worker é publicado/atualizado
  em produção não está documentado no repo.
- **Provedor real do worker RPA**: os nomes (`RAILWAY_URL`, comentário
  "Railway fornece a porta" no Dockerfile) sugerem Railway, mas o workflow
  de CI atual publica via SSH para uma VPS Hostinger. Não dá para confirmar
  pelo repo se `RAILWAY_URL`, em produção, aponta hoje para uma instância
  Railway, para a VPS Hostinger, ou para outra coisa — isso só existe na
  configuração de ambiente da Vercel (fora do repo) e/ou com quem administra
  a infraestrutura.
- **Secrets do GitHub Actions** (`HOSTINGER_HOST`, `HOSTINGER_USER`,
  `HOSTINGER_SSH_KEY`): existência confirmada pelo uso no workflow, mas os
  valores e quem tem acesso a alterá-los não estão no repositório (nem
  deveriam estar).
- **`BROWSERLESS_ENDPOINT`**: aparece no código como alternativa para rodar
  o Chromium remotamente, mas não há indicação de que esteja ativamente em
  uso em produção (pode ser um caminho alternativo não utilizado hoje).
- **Regra de cron "D-3"**: `DOCUMENTACAO_PROJETO.md` cita cron jobs no n8n
  para transições de status por prazo, mas não deixa claro se essa
  transição específica roda como schedule do n8n, como `pg_cron` no
  Supabase, ou ambos — o repositório não tem o workflow do n8n nem a
  definição do `pg_cron` para confirmar.
- **Domínio de produção da Vercel** (URL final do app) e organização/projeto
  Vercel usado não estão documentados no repositório.
