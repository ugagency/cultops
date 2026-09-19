# Auditoria de Credenciais e Integrações Externas — Handoff de Titularidade

> Gerado em 2026-09-04. Objetivo: mapear **quais** credenciais/integrações existem e **onde** são usadas no código, para preparar a migração de titularidade das chaves atuais (SSYS) para a nova conta/organização (Prestaí). **Nenhum valor de credencial foi lido, extraído ou reproduzido aqui** — o arquivo `.env` não foi aberto em nenhum momento.
>
> Metodologia: busca em todo o repositório por `process.env.*`, arquivos de exemplo de ambiente, workflows de CI, exports de n8n, `package.json`/`package-lock.json`, chamadas `fetch`/`axios` para domínios externos, e o script de RPA do SALIC.

---

## 1. Tabela de credenciais e integrações

| Credencial/Variável | Serviço | Onde é usada (arquivo:linha) | Finalidade | Titular atual (SSYS) | Ação necessária | Bloqueia o quê se não migrar |
|---|---|---|---|---|---|---|
| `SUPABASE_URL` | Supabase (banco/auth/storage) | [server.js:118](server.js#L118), [server.js:184](server.js#L184), [server.js:206](server.js#L206), [server.js:306](server.js#L306) | URL do projeto Supabase usado pelo backend e injetado no frontend via `/config.js` | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Login, todo o app (M1/M2/M3), storage de documentos, RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (service role) | [server.js:119](server.js#L119) | Bypassa RLS no backend para ler credenciais externas descriptografadas e operar como admin | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Todas as rotas `/api/*` que tocam o banco |
| `SUPABASE_ANON_KEY` | Supabase (anon/publishable) | [server.js:185](server.js#L185) | Chave pública usada pelo frontend (via `/config.js`) para autenticação de usuários | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Login e todas as chamadas client-side ao Supabase |
| `SUPABASE_URL` / `SUPABASE_KEY` (hardcoded) | Supabase (anon) | [config.js:2-3](config.js#L2-L3) | Fallback local de dev — **não está no Git** (arquivo listado em `.gitignore`, sem histórico de commit); em produção é sobrescrito dinamicamente por `/config.js` (server.js:182-199) | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Apenas ambiente local de quem tiver esse arquivo; não afeta produção |
| `RESEND_API_KEY` | Resend (envio de e-mail) | [server.js:14-15](server.js#L14-L15) | Envio de e-mails transacionais (alertas de guias, notificações) | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Todos os e-mails automáticos (alerta de guias vencendo, notificação de evidência etc.) |
| `RESEND_FROM_EMAIL` | Resend | [server.js:17](server.js#L17) | Endereço de remetente configurado (fallback: `onboarding@resend.dev`) | Não sensível (é um endereço, não segredo) | Ajustar para domínio/remetente da nova titularidade | Identidade do remetente dos e-mails |
| `MISTRAL_API_KEY` | Mistral AI (OCR + chat completions) | [server.js:1469](server.js#L1469), [server.js:1567](server.js#L1567), [server.js:1601](server.js#L1601) — chamadas em [server.js:1090](server.js#L1090), [server.js:1160](server.js#L1160), [server.js:1305](server.js#L1305), [server.js:1352](server.js#L1352) | OCR de notas fiscais/comprovantes e extração/estruturação de dados via IA | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | OCR de documentos, importação de PDF do SALIC, extração de dados financeiros |
| `BROWSERLESS_ENDPOINT` | Browserless (Chrome remoto para Puppeteer) | [server.js:316](server.js#L316) | `browserWSEndpoint` usado por `salic_insertion.cjs` para rodar o robô SALIC sem Chrome local | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | RPA de inserção de comprovação financeira no SALIC (produção, sem Chrome local disponível) |
| `RAILWAY_URL` | Railway (deploy do worker RPA) | [server.js:193-194](server.js#L193-L194), [server.js:225-226](server.js#L225-L226), [api/salic/inserir.js:6](api/salic/inserir.js#L6) | URL do serviço Railway que roda o worker Puppeteer/Express do SALIC; o Vercel faz proxy para lá | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Toda a automação de inserção no SALIC quando rodando no Vercel |
| `CRON_SECRET` | Interno (segredo compartilhado) | [server.js:835](server.js#L835), [server.js:2150](server.js#L2150) | Autentica chamadas do `pg_cron` do Supabase às rotas `/api/m1/verificar-fornecedor-salic` e `/api/m2/cron-alerta-guias` via header `x-cron-secret` | Sim | Criar conta nova sob titularidade Prestaí e gerar credencial nova — não reaproveitar a atual | Verificação automática de fornecedor no SALIC e alerta diário de guias vencendo (rodam via cron do banco) |
| `CHROME_PATH` | Local (caminho executável) | [salic_insertion.cjs:254](salic_insertion.cjs#L254) | Caminho do Chrome local, usado só quando não há `browserWSEndpoint` (fallback de dev/Windows) | Não sensível (caminho de arquivo, não segredo) | Nenhuma — é específico da máquina de dev | Nada em produção |
| `DISABLE_FRONTEND` | Interno (flag) | [server.js:211](server.js#L211) | Liga/desliga servir os arquivos estáticos do frontend pelo próprio server.js | Não sensível (flag booleana) | Nenhuma | Nada |
| `PORT`, `NODE_ENV`, `VERCEL` | Infra (Node/Vercel) | [server.js:114](server.js#L114), [server.js:205](server.js#L205), [server.js:225](server.js#L225), [server.js:3657](server.js#L3657) | Configuração padrão de runtime Node/Vercel | Não sensível | Nenhuma | Nada |
| Credenciais SALIC por usuário (`identifier`/`secret_plain`) | Portal SALIC (MinC) | Armazenadas na tabela `public.external_credentials` / view `public.decrypted_external_credentials` (ver [setup.sql:172-182](setup.sql#L172-L182)); consumidas em [server.js:264-296](server.js#L264-L296) e usadas para login em [salic_insertion.cjs:278-283](salic_insertion.cjs#L278-L283) | Login de **cada usuário/organização** no portal SALIC para inserir comprovação financeira via RPA | **Não é credencial da SSYS** — é dado de cliente (CPF/senha do proponente cultural cadastrado pelo próprio usuário no app) | Não se aplica trocar a credencial em si (é do cliente); a ação necessária é **garantir que os dados migrem intactos para o novo banco Supabase** e que a coluna `secret` (armazenada em texto plano, ver achado crítico abaixo) seja tratada com o mesmo cuidado na nova titularidade | Toda a automação de envio ao SALIC para clientes que já cadastraram credencial |
| CPF e senha reais hardcoded como dados de teste | Portal SALIC (MinC) | [salic_insertion.cjs:502-504](salic_insertion.cjs#L502-L504) — bloco `if (require.main === module)` | Dados de teste manual do robô, deixados no código-fonte e **commitados no histórico do Git** (arquivo rastreado, 4 commits) | Aparenta ser credencial pessoal/de teste de alguém da equipe SSYS, não claramente "titularidade Prestaí" | **Ação crítica**: remover do código imediatamente e, se necessário legalmente, considerar o CPF/senha comprometidos (trocar a senha do respectivo login SALIC). Substituir por variáveis de ambiente ou dados fictícios antes do handoff | Exposição de credencial pessoal real de terceiro no repositório entregue à nova titularidade |
| CNPJá (`open.cnpja.com`) | CNPJá (consulta de CNPJ) | [solicitantes.html:862](solicitantes.html#L862), [modulo2/contratos.html:1345](modulo2/contratos.html#L1345) | Consulta de dados de empresa por CNPJ — chamada direta do frontend, **sem env var/API key visível no código** (endpoint público `open.cnpja.com`) | Não encontrado no código (endpoint aberto, sem autenticação aparente) | Verificar se existe plano pago/API key do CNPJá fora do código (ex: painel do CNPJá) — se houver, criar conta nova sob titularidade Prestaí | Autocompletar dados de fornecedor/solicitante por CNPJ |
| BrasilAPI (`brasilapi.com.br`) | BrasilAPI (consulta de CEP) | [modulo3/supabase-helper-m3.js:361](modulo3/supabase-helper-m3.js#L361) | Busca de endereço por CEP — API pública, sem autenticação | Não se aplica (serviço público, sem credencial) | Nenhuma | Nada |
| API SALIC pública (`api.salic.cultura.gov.br`) | Portal de Dados Abertos do SALIC/MinC | [server.js:787](server.js#L787), [server.js:851](server.js#L851) | Consulta pública de fornecedores cadastrados no SALIC — sem autenticação aparente no código | Não se aplica (API de dados abertos do governo) | Nenhuma | Nada |
| Webhooks n8n (`automacoes-n8n.infrassys.com`) | n8n (instância de automação, domínio de terceiro/agência `infrassys.com`) | [server.js:186-192](server.js#L186-L192), [server.js:1006](server.js#L1006), [server.js:2051](server.js#L2051), [server.js:3487](server.js#L3487), [config.js:4-9](config.js#L4-L9), [modulo2/rubricas.html:817](modulo2/rubricas.html#L817) | Disparo de fluxos de OCR, conciliação bancária, validação, importação SALIC e geração de relatório PDF | **Não é credencial da SSYS diretamente, mas a instância n8n está hospedada em domínio de terceiro (`infrassys.com`)** — acesso/titularidade dessa instância não está no código | Confirmar com o operador da instância n8n (`infrassys.com`) se o acesso/propriedade migra para Prestaí, ou recriar os workflows em uma instância n8n própria da nova titularidade | Toda automação de OCR, conciliação de extratos, validação de documentos, importação de rubricas do SALIC e geração de relatórios em PDF |

---

## 2. Achado crítico de segurança (relevante para o handoff)

Durante a auditoria, o código revelou um achado documentado no próprio repositório (não é uma descoberta nova desta auditoria, mas é diretamente relevante para o handoff):

- **[migration_sec01_fix1_has_external_credential.sql](migration_sec01_fix1_has_external_credential.sql) e [migration_sec01_fix3_revoke_view.sql](migration_sec01_fix3_revoke_view.sql)** documentam que a view `public.decrypted_external_credentials` (que expõe usuário/senha do SALIC em texto claro) esteve com `SELECT` liberado para os papéis `anon` e `authenticated` — testado em produção, retornando 7 credenciais sem nenhum login. A tabela base `external_credentials` armazena a coluna `secret` como `text NOT NULL` (ver [setup.sql:172-182](setup.sql#L172-L182)), ou seja, **não há criptografia real** apesar do nome "decrypted" na view.
- O arquivo `migration_sec01_fix3_revoke_view.sql` (que revoga o acesso da view) está marcado como **"NÃO RODAR ainda"** — não é possível confirmar apenas pelo código se esse revoke já foi aplicado em produção.
- **Recomendação para o handoff**: antes de transferir titularidade, confirmar via Supabase (policies/grants na view `decrypted_external_credentials`) se o Fix 3 já foi aplicado. Caso não tenha sido, tratar como prioridade máxima — está diretamente ligado aos dados de login SALIC dos clientes que serão migrados.

---

## 3. GitHub Actions

Não foi encontrado diretório `.github/workflows/` no repositório — não há pipelines de CI/CD configurados via GitHub Actions, logo nenhum `secrets.*` para listar.

## 4. Exports de workflow n8n

Não foram encontrados arquivos JSON de export de workflows do n8n no repositório. As integrações com n8n existem apenas como chamadas HTTP a webhooks (ver tabela, seção "Webhooks n8n"); os workflows em si (e os nós de credencial dentro deles) vivem na instância n8n remota (`automacoes-n8n.infrassys.com`), fora deste repositório.

## 5. cultops-rpa-worker/

Existe um diretório `cultops-rpa-worker/` com um arquivo `.env` local e `node_modules/`, mas **nenhum arquivo desse diretório está rastreado pelo Git** (`git ls-files` não retorna nenhuma entrada para ele). Não foi possível auditar seu conteúdo além do `.env` (que não foi aberto, por instrução). Recomenda-se verificar manualmente esse diretório antes do handoff, pois o `package.json` da raiz do projeto já indica uma descrição de "Automação SALIC com Puppeteer e Express para o Render" — pode haver uma segunda cópia/versão do worker RPA com suas próprias variáveis de ambiente não capturadas nesta auditoria baseada em código versionado.

---

## 6. Não encontrado no código, mas mencionado na documentação do projeto

| Item mencionado | Status da busca |
|---|---|
| **Resend (envio de e-mail)** | **Encontrado** — ver tabela (`RESEND_API_KEY`, `RESEND_FROM_EMAIL` em server.js). Removido desta seção, incluído na tabela principal. |
| **Browserless (RPA)** | **Encontrado** — ver tabela (`BROWSERLESS_ENDPOINT` em server.js:316, usado por salic_insertion.cjs). Removido desta seção, incluído na tabela principal. |
| **Autenticação do portal SALIC do MinC** | **Encontrado** — ver tabela (credenciais por usuário na tabela `external_credentials`/view `decrypted_external_credentials`, e dados de teste hardcoded em salic_insertion.cjs). Removido desta seção, incluído na tabela principal. |
| **Credenciais de acesso à VPS Hostinger (SSH)** | **Não encontrado no código.** Nenhuma referência a Hostinger, chaves SSH, `id_rsa` ou configuração de deploy para VPS foi localizada no repositório. Se a aplicação roda em uma VPS Hostinger, o acesso (usuário SSH, chave privada, painel Hostinger) não está documentado nem versionado neste repo — precisa ser levantado diretamente com quem administra a VPS. |
| **Acesso ao domínio/DNS** | **Não encontrado no código.** Nenhuma referência a registrador de domínio, painel de DNS (Cloudflare como provedor de DNS, Registro.br, etc.) foi localizada — as únicas menções a "cloudflare" no repositório são links de CDN público (`cdnjs.cloudflare.com`), não credenciais de conta. O acesso ao domínio/DNS precisa ser levantado fora do código-fonte. |

---

## 7. Resumo executivo

**Credenciais que precisam de rotação/nova conta (titularidade Prestaí):** Supabase (URL + service role + anon key), Resend, Mistral AI, Browserless, Railway, `CRON_SECRET`.

**Não são credenciais da SSYS, mas afetam a migração:** credenciais SALIC por cliente (dado do usuário, precisa migrar junto com o banco) e a instância n8n hospedada em `infrassys.com` (titularidade/acesso a confirmar separadamente).

**Ação imediata recomendada, independente do handoff:** remover o CPF e a senha reais hardcoded em [salic_insertion.cjs:502-504](salic_insertion.cjs#L502-L504) do código e do histórico do Git, e confirmar se o `REVOKE` da view `decrypted_external_credentials` (migration_sec01_fix3) já foi aplicado em produção.

**Fora do alcance desta auditoria (levantar manualmente):** acesso SSH à VPS Hostinger, acesso ao domínio/DNS, e o conteúdo de `cultops-rpa-worker/.env` (diretório não versionado).
