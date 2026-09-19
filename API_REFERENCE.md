# API Reference — Prestaí (Cultopps)

Referência técnica de todas as rotas HTTP expostas pelo backend do Prestaí, a plataforma de comprovação financeira e prestação de contas de projetos culturais aprovados pela Lei Rouanet.

O backend roda como um único processo Express (`server.js`) mais uma função serverless separada (`api/salic/inserir.js`). Em produção (Vercel), o roteamento é feito por `vercel.json`:

- `/api/salic/inserir` → `api/salic/inserir.js` (função serverless própria)
- `/api/:path*` (todo o resto de `/api/*`) → `server.js`
- `/` → `module-selector.html`
- `/config.js` → `server.js` (gera config dinâmico do front-end)

Fora do Vercel (ex.: Railway, ambiente local), `server.js` sobe sozinho com `app.listen(PORT)`, `PORT` vindo de `process.env.PORT` (padrão `3000`).

## Convenções usadas nesta referência

- **Autenticação**: quando a rota usa o middleware `requireAuth`, o cliente precisa enviar `Authorization: Bearer <token de sessão do Supabase>`. O middleware valida o token contra `supabase.auth.getUser()` e popula `req.user`/`req.userRole` a partir de `app_metadata.role` (ou `user_metadata.role`).
- **Autorização por papel**: `requireRole('gestor', 'admin')` etc. exige que `req.userRole` esteja na lista. `requirePlatformAdmin` exige `app_metadata.is_platform_admin === true` (equipe interna SSYS). `requireSuporte` exige `is_suporte` ou `is_platform_admin`.
- **Segredo de cron** (`x-cron-secret`): algumas rotas não usam sessão de usuário — são chamadas por job agendado (pg_cron) ou por trigger de banco, e exigem o header `x-cron-secret` igual a `process.env.CRON_SECRET`.
- Todas as rotas usam o cliente Supabase com **service role** (`SUPABASE_SERVICE_ROLE_KEY`), ou seja, ignoram Row Level Security do Postgres — a autorização de cada rota depende inteiramente do código do middleware/handler, não do banco.

---

## 1. Autenticação / Sessão / Configuração

Rotas de bootstrap do front-end e de sincronização de metadados de sessão.

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| GET | `/config.js` | Serve um script JS com a configuração pública do front-end (URL/chave anônima do Supabase, URLs dos webhooks do n8n, URL da API do SALIC) | Sem autenticação visível no código |
| GET | `/api/health` | Health check simples (`status`, `env`, `hasSupabase`) | Sem autenticação visível no código |
| POST | `/api/auth/sync-org-metadata` | Copia o `organization_id` do vínculo em `organization_users` para o `app_metadata.org_id` do usuário logado (usado para manter o JWT em dia) | `requireAuth` |
| POST | `/api/auth/senha-trocada` | Derruba a flag `must_change_password` em `app_metadata` depois que o usuário troca a senha no primeiro acesso | `requireAuth` |

**`GET /api/health`**: o `AUDITORIA_CODIGO.md` já havia identificado que nenhum fetch no repositório chama essa rota. Confirmado novamente por grep nesta auditoria — **sem chamador conhecido no frontend**; pode ser usada por health check externo (Railway/Vercel), mas isso não está confirmável só pelo código do repo.

Efeitos colaterais: nenhum em `/config.js` e `/api/health` (somente leitura/echo de env vars). As duas rotas de auth gravam em `auth.users` via `supabase.auth.admin.updateUserById`.

---

## 2. Gestão de Usuários / Equipe (Gestor)

Rotas usadas pela tela de gestão de equipe de uma organização (convidar, promover, revogar, excluir).

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| GET | `/api/gestor/usuarios` | Lista os usuários vinculados à organização de quem chama, com e-mail e papel | `requireAuth` + `requireRole('gestor','admin')` |
| POST | `/api/gestor/set-role` | Muda o papel (`role`) de um usuário já existente da equipe | `requireAuth` + `requireRole('gestor','admin')` |
| DELETE | `/api/gestor/usuarios/:userId` | Exclui de vez uma conta de usuário — só permitido se ela não tiver nenhum dado vinculado (senão devolve 409 e sugere revogar) | `requireAuth` + `requireRole('admin')` |
| POST | `/api/gestor/usuarios/:userId/revogar` | Revoga o acesso de um usuário sem apagar os dados que ele já lançou (bane a conta e remove o vínculo com a organização) | `requireAuth` + `requireRole('admin')` |
| POST | `/api/gestor/criar-analista` | Cria uma nova conta de usuário da equipe (analista/operador/gestor/admin, conforme o papel de quem chama) já vinculada à organização | `requireAuth` + `requireRole('gestor','admin')` |
| POST | `/api/gestor/criar-acesso-fornecedor` | Cria a conta de login de um fornecedor já cadastrado, vinculando pelo `auth_user_id` do fornecedor (não entra em `organization_users`) | `requireAuth` + `requireRole('admin','gestor','analista')` |
| POST | `/api/gestor/importar-fornecedores-salic` | Busca fornecedores do projeto na API pública do SALIC (por PRONAC) e grava/atualiza registros em `fornecedores` | `requireAuth` + `requireRole('admin','gestor','analista')` |
| POST | `/api/admin/usuarios/operador` | Cria uma conta de papel "operador" para uma organização (rota alternativa à de `/api/gestor/criar-analista`, checagem de admin feita manualmente dentro do handler) | `requireAuth` (checa `role === 'admin'` manualmente no corpo do handler, não via `requireRole`) |

**Entradas e saídas principais:**
- `POST /api/gestor/set-role` — body `{ targetUserId, role }`; retorna `{ ok: true }`.
- `DELETE /api/gestor/usuarios/:userId` — retorna `{ sucesso: true }` ou 409 com `{ error, vinculos }` se houver dados presos.
- `POST /api/gestor/criar-analista` — body `{ email, password, nome, role }`; retorna `{ ok: true, user }`.
- `POST /api/gestor/criar-acesso-fornecedor` — body `{ fornecedor_id, email, password }`.
- `POST /api/gestor/importar-fornecedores-salic` — body `{ pronac }`; retorna `{ ok: true, importados, total_na_api }`.
- `POST /api/admin/usuarios/operador` — body `{ email, nome, organization_id }`.

**Efeitos colaterais**: todas gravam em `auth.users` (via Supabase Admin API) e/ou `organization_users`/`fornecedores`, e a maioria grava uma linha em `audit_log` registrando quem fez o quê.

---

## 3. Verificação de Fornecedor no SALIC

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/m1/verificar-fornecedor-salic` | Consulta a API pública do SALIC para checar se um CNPJ existe cadastrado, e grava o resultado em `fornecedores.existe_no_salic` | Segredo de cron (`x-cron-secret` == `CRON_SECRET`) — chamada por trigger de banco (`trg_verificar_fornecedor_salic`), não por usuário logado |

Body: `{ document_id, cnpj }`. CPF (11 dígitos) não é verificável na API pública do SALIC — a rota retorna `verificavel: false` nesse caso sem consultar nada.

---

## 4. Envio ao SALIC (RPA / Puppeteer)

Rotas que disparam o robô (Puppeteer) que preenche o sistema SALIC do governo, ou processam documentos vindos de lá.

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/salic/inserir` | Dispara a inserção automática de uma nota fiscal no SALIC via robô Puppeteer | Sem autenticação visível no código |
| POST (serverless) | `/api/salic/inserir` (`api/salic/inserir.js`) | Mesma rota, mas na função serverless da Vercel — sempre repassa (proxy) para `RAILWAY_URL + /api/salic/inserir`, pois Puppeteer não roda no runtime serverless da Vercel | Sem autenticação visível no código |
| POST | `/api/m2/processar-pdf-salic` | Importa um projeto a partir do PDF exportado do SALIC: baixa o PDF do Storage, roda OCR (Mistral), estrutura em JSON e grava nas tabelas `project_*` | Sem autenticação visível no código |
| POST | `/api/m2/salvar-revisao-salic` | Salva a revisão humana dos dados extraídos do PDF do SALIC (etapas de trabalho, locais, deslocamentos, plano de divulgação, dados complementares) | Sem autenticação visível no código |

**Detalhe de arquitetura importante**: quando `server.js` roda na Vercel (`process.env.VERCEL` truthy), `POST /api/salic/inserir` **não executa o Puppeteer localmente** — ele mesmo faz proxy para `RAILWAY_URL`, porque a Vercel não suporta o Chromium headless necessário. Fora da Vercel (Railway), a rota executa `salic_insertion.cjs` de fato: busca as credenciais do SALIC do usuário em `decrypted_external_credentials`, busca o documento e o projeto, monta a config e chama `executarInsercaoSalic(config)`.

- Corpo de `/api/salic/inserir`: `{ documentId, userId }`.
- Retorno em sucesso: `{ success: true, protocol }`; grava `documents.status = 'enviado_salic'` e `documents.protocolo_salic`.
- Retorno em falha: 500 com `{ error }`; grava `documents.status = 'erro_rpa'` e `documents.just_erro`.
- `/api/m2/processar-pdf-salic` — body `{ project_id, file_path, user_id }`; cria/atualiza registro em `project_salic_imports`, faz download do bucket `salic-imports`, chama OCR via Mistral (`MISTRAL_API_KEY`), e distribui os dados extraídos entre as tabelas `project_etapas_trabalho`, `project_locais_realizacao`, `project_deslocamentos`, `project_plano_divulgacao`, `project_dados_complementares`.
- `/api/m2/salvar-revisao-salic` — body `{ project_id, import_id, user_id, etapas, locais, deslocamentos, divulgacao, complementar }`; substitui os registros anteriores dessas mesmas tabelas para o projeto e marca `project_salic_imports.status = 'revisado'`.

Nenhuma dessas quatro rotas tem checagem de autenticação/autorização visível no código — isso é uma lacuna relevante, já que `/api/m2/processar-pdf-salic` e `/api/m2/salvar-revisao-salic` gravam dados de projeto a partir de um `project_id` recebido no corpo, sem verificar se quem chama tem acesso a esse projeto.

---

## 5. Contratos (Módulo 2)

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| GET | `/api/m2/contracts/:project_id` | Lista contratos de um projeto, com dados de fornecedor e rubrica | Sem autenticação visível no código — **sem chamador conhecido no frontend** (`modulo2/contratos.html` lê a tabela `contracts` direto via client Supabase) |
| POST | `/api/m2/contracts` | Cria um novo contrato | Sem autenticação visível no código — **sem chamador conhecido no frontend** (o front insere direto via client Supabase) |
| PATCH | `/api/m2/contracts/:id/status` | Atualiza o status de um contrato (`ativo`, `encerrado`, `suspenso`, `cancelado`, `rescindido`) | `requireAuth` + checagem de acesso ao projeto via `userCanAccessProject(req.user.id, project_id)` |
| POST | `/api/m2/salic/encerrar` | Endpoint stub para o fluxo de "encerramento SALIC" do Módulo 2 | Sem autenticação visível no código — **stub nunca finalizado**: sempre responde `{ success: true, message: "Fluxo de encerramento iniciado (Simulado)..." }` sem executar nada de fato, e **sem chamador conhecido no frontend** |
| POST | `/api/m2/contratos/ocr` | Faz upload de um PDF de contrato para o bucket `contracts` e roda OCR (Mistral) para estruturar os dados do contrato | `requireAuth` + `userCanAccessProject` |

Confirmação da auditoria anterior (`AUDITORIA_CODIGO.md`, seção de rotas sem chamador): reexecutei o grep no repositório atual e as 4 rotas apontadas lá (`/api/health`, `GET /api/m2/contracts/:project_id`, `POST /api/m2/contracts`, `/api/m2/salic/encerrar`, `/api/rubricas/importar`) continuam sem nenhuma chamada `fetch(...)` no front-end. O único hit de `api/m2/contracts` no front é `PATCH .../contracts/${contractId}/status`, que é uma rota diferente (tem `requireAuth` e chamador real em `modulo2/contratos.html:1265`).

**Entradas/saídas**: `PATCH /api/m2/contracts/:id/status` — body `{ status, project_id }`, retorna `{ success: true }`. `POST /api/m2/contratos/ocr` — body `{ fileBase64, fileName, projectId }`, retorna `{ success: true, data, file_path }`.

---

## 6. Impostos / Guias (Módulo 2)

Rotas de OCR e ciclo de vida de guias de imposto (DARF, GPS etc.) e sua ponte com o Módulo 1 (documentos).

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/m2/impostos/ocr` | Faz upload de um PDF de guia de imposto para o bucket `tax-guides` e roda OCR (Mistral) para estruturar os dados da guia | `requireAuth` + `userCanAccessProject` |
| POST | `/api/m2/impostos/marcar-paga` | Marca uma guia como paga; se ela ainda não tiver documento vinculado no Módulo 1, copia o arquivo da guia para o bucket `documentos` e cria automaticamente um registro em `documents` (nasce sem rubrica, cai em `bloqueado_conformidade` até revisão humana) | `requireAuth` + `userCanAccessProject` |
| POST | `/api/m2/impostos/consolidar-duplicata` | Resolve uma duplicata entre uma guia antiga (Módulo 2) e um documento novo (Módulo 1) que o trigger de banco criou automaticamente: marca a guia antiga como paga vinculando o documento, e apaga a guia duplicada nova | `requireAuth` + `userCanAccessProject` |
| POST | `/api/m2/impostos/ignorar-duplicata` | Registra em `audit_log` a decisão do usuário de que duas guias candidatas a duplicata são, na verdade, diferentes (para o front parar de perguntar de novo) | `requireAuth` (sem checagem explícita de acesso ao projeto no handler) |
| POST | `/api/m2/cron-alerta-guias` | Job diário: busca guias de imposto pendentes vencendo nos próximos 7 dias e envia e-mail de alerta (via Resend) para gestores/analistas/admins da organização de cada projeto | Segredo de cron (`x-cron-secret` == `CRON_SECRET`) — chamada pelo pg_cron às 11h |

**Entradas/saídas**:
- `/api/m2/impostos/ocr` — body `{ fileBase64, fileName, projectId }`.
- `/api/m2/impostos/marcar-paga` — body `{ tax_guide_id }`; retorna `{ success: true, document_id }`.
- `/api/m2/impostos/consolidar-duplicata` — body `{ tax_guide_id_antiga, document_id }`.
- `/api/m2/impostos/ignorar-duplicata` — body `{ document_id, tax_guide_id }`.
- `/api/m2/cron-alerta-guias` — sem body relevante; retorna `{ enviados: N }`.

**Efeitos colaterais**: uploads no Supabase Storage, inserts/updates em `documents`/`tax_guides`, envio de e-mail via Resend (`sendEmail`), e gravação em `audit_log`.

---

## 7. Fornecedores (Módulo 2)

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/m2/fornecedores/criar-vincular` | Cria (se não existir pelo CNPJ) e vincula um fornecedor a um projeto (`projeto_fornecedores`), de forma idempotente | `requireAuth` + `userCanAccessProject` |

Body: `{ cnpj, razao_social, project_id }`. Retorna `{ success: true, fornecedor_id }`.

(Ver também a Seção 2 para `/api/gestor/importar-fornecedores-salic` e `/api/gestor/criar-acesso-fornecedor`, que também tratam de fornecedores.)

---

## 8. Relatórios / Exportações

Geração de documentos (.docx) e proxies para workflows de relatório no n8n.

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/m2/gerar-relatorio` | Proxy que repassa o corpo da requisição para um webhook do n8n (`/webhook-test/relatorio`) que gera o relatório do Módulo 2 — existe para evitar CORS no navegador | Sem autenticação visível no código |
| POST | `/api/m3/relatorio/evento/:eventId` | Gera um relatório .docx de um evento de distribuição (Módulo 3), sobe para o bucket `reports` e devolve uma URL assinada de download | `requireAuth` + `userCanAccessProject` |
| POST | `/api/m3/relatorio/periodo` | Gera o relatório mensal consolidado .docx (todos os eventos do mês) a partir de um rascunho já salvo em `distribution_monthly_reports`; recalcula o período no servidor (não confia na lista vinda do cliente) | `requireAuth` + `userCanAccessProject` |
| POST | `/api/rubricas/importar` | Proxy que repassa o corpo da requisição para o webhook do n8n de importação de rubricas (`/webhook/uploadrubricas`) — evita CORS | Sem autenticação visível no código — **proxy morto, sem chamador conhecido no frontend** (`rubricas.html:811` chama `CONFIG.N8N_WEBHOOK_SALIC_IMPORT_RUBRICAS_URL` diretamente, ignorando este proxy) |

**Entradas/saídas**:
- `/api/m3/relatorio/evento/:eventId` — sem body obrigatório; retorna `{ success: true, path, url }` (URL assinada válida por 1h); grava `distribution_events.relatorio_status = 'gerado'` e `relatorio_evento_file_path`.
- `/api/m3/relatorio/periodo` — body `{ project_id, mes_referencia }`; erro 404 se não houver rascunho salvo ainda (`distribution_monthly_reports`); retorna `{ success: true, path, url }`.

Confirmação da auditoria anterior: reconfirmado por grep que `/api/rubricas/importar` continua sem chamador no front. É apontado no `AUDITORIA_CODIGO.md` como "proxy morto" — permanece assim no código atual.

---

## 9. Evidências Físicas (Módulo 2/3)

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/m2/evidencia/notificar` | Envia e-mail ao solicitante (fornecedor/quem enviou a evidência) avisando que a evidência física foi aprovada, reprovada ou que um complemento foi solicitado | Sem autenticação visível no código |

Body: `{ evidencia_id, novo_status, analista_id }`. Responde `{ ok: true }` imediatamente (fire-and-forget) e só depois busca os dados e dispara o e-mail via Resend — falhas de envio não afetam a resposta HTTP, só ficam no log do servidor.

---

## 10. Módulo 3 — Eventos de Distribuição e Contrapartidas

Rotas do módulo de distribuição/contrapartidas culturais: eventos, presença (check-in via PWA offline) e encerramento.

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| PUT | `/api/m3/eventos/:id/encerrar` | Encerra um evento de distribuição — bloqueia se não houver lista de presença registrada | `requireAuth` |
| POST | `/api/m3/eventos/:id/excluir` | Soft delete de um evento (marca `excluido_em`, nunca faz DELETE real, pois cascatearia convidados/check-ins) | `requireAuth` + `requireRole('gestor','admin')` |
| GET | `/api/m3/pwa/eventos` | Busca eventos da organização por nome/título (`?q=termo`), usado no PWA de campo (o operador não sabe o UUID do evento) | `requireAuth` |
| GET | `/api/m3/pwa/evento/:id` | Retorna o evento completo (convidados, atividades, OS/PA) para pré-carregamento offline no PWA de campo | `requireAuth` |
| POST | `/api/m3/pwa/sync` | Recebe lotes de check-in feitos offline pelo PWA e persiste em `distribution_guests`, com proteção contra duplicidade (não sobrescreve check-in já registrado) | `requireAuth` |
| POST | `/api/m3/relatorio/evento/:eventId` | (ver Seção 8 — Relatórios) | `requireAuth` + `userCanAccessProject` |
| POST | `/api/m3/relatorio/periodo` | (ver Seção 8 — Relatórios) | `requireAuth` + `userCanAccessProject` |

**Entradas/saídas**:
- `PUT /api/m3/eventos/:id/encerrar` — retorna `{ sucesso, evidencias_pendentes_aprovacao, mensagem }`.
- `POST /api/m3/eventos/:id/excluir` — retorna `{ sucesso: true }` (idempotente se já excluído); grava `audit_log`.
- `GET /api/m3/pwa/eventos` — query `?q=`; retorna array de eventos (máx. 30, mais recentes primeiro).
- `POST /api/m3/pwa/sync` — body `{ checkins: [...] }`; cada item tem `guest_id` ou dados de convidado avulso, `event_id`, `atividade_id`, `timestamp`; retorna `{ processados, erros }`; grava `audit_log` para toda tentativa, inclusive duplicadas.

---

## 11. Plataforma (Administração interna SSYS)

Rotas usadas pela equipe interna da SSYS (dona do produto) para gerenciar organizações-cliente e seus módulos contratados. Usam service role e enxergam todas as organizações — a autorização é só no middleware, não no banco.

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| GET | `/api/plataforma/organizacoes` | Lista todas as organizações cadastradas, com contagem de projetos e usuários de cada uma | `requireAuth` + `requireSuporte` |
| POST | `/api/plataforma/organizacoes` | Cria uma nova organização-cliente e já cria o primeiro usuário admin dela | `requireAuth` + `requirePlatformAdmin` |
| PATCH | `/api/plataforma/organizacoes/:id/modulos` | Atualiza quais módulos (`modulo_1`, `modulo_2`, `modulo_3`) uma organização tem habilitados | `requireAuth` + `requirePlatformAdmin` |

**Entradas/saídas**:
- `POST /api/plataforma/organizacoes` — body `{ nome, slug, modulos, admin_email, admin_senha, admin_nome }`; em caso de falha após criar a organização, faz rollback (`DELETE` da organização) para não deixar organização órfã sem usuário.
- `PATCH /api/plataforma/organizacoes/:id/modulos` — body `{ modulos: [...] }`.

**Efeitos colaterais**: cria organização + usuário admin no Supabase Auth, grava `audit_log` de cada alteração.

---

## 12. Suporte (Diagnóstico interno, somente leitura + exceções auditadas)

Rotas usadas pela equipe de suporte da SSYS para diagnosticar problemas em qualquer organização, sem precisar logar como o cliente. A maioria é só leitura; duas exceções de escrita existem e são explicitamente auditadas.

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| GET | `/api/suporte/organizacoes/:id/projetos` | Lista projetos de uma organização | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/projetos/:id/documentos` | Lista documentos de um projeto com foco em diagnóstico (status, erro) | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/organizacoes/:id/usuarios` | Lista usuários de uma organização | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/projetos/:id/audit-log` | Monta uma linha do tempo agregada de `audit_log` para um projeto, cruzando documentos, contratos, evidências, guias, despesas e extratos, com rótulos legíveis e e-mails resolvidos | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/projetos/:id/contratos` | Lista contratos de um projeto (visão de diagnóstico) | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/projetos/:id/guias` | Lista guias de imposto de um projeto (visão de diagnóstico) | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/buscar` | Busca global por texto/CNPJ/PRONAC entre organizações, projetos e afins | `requireAuth` + `requireSuporte` |
| GET | `/api/suporte/sistema/crons` | Retorna o status dos jobs agendados (via RPC `suporte_status_crons`) | `requireAuth` + `requireSuporte` |
| POST | `/api/suporte/usuarios/:id/resetar-senha` | **Escrita** — reseta a senha de um usuário de qualquer organização e força troca no próximo login | `requireAuth` + `requireSuporte` |
| POST | `/api/suporte/documentos/:id/reprocessar-ocr` | **Escrita** — força o reprocessamento de OCR de um documento, republicando no webhook do n8n | `requireAuth` + `requireSuporte` |

**Entradas/saídas**:
- `GET /api/suporte/buscar?q=termo` — exige `q` com pelo menos 3 caracteres; retorna `{ resultados: [] }` se menor.
- `POST /api/suporte/usuarios/:id/resetar-senha` — body `{ password }` (mínimo 6 caracteres); retorna `{ ok: true, email }`.
- `POST /api/suporte/documentos/:id/reprocessar-ocr` — sem body; marca `documents.status = 'processing_ocr'` e reenvia ao webhook `https://automacoes-n8n.infrassys.com/webhook/cultops-ocr`.

**Efeitos colaterais**: as duas rotas de escrita gravam sempre em `audit_log` — é essa auditoria que justifica a exceção à regra de "suporte é só leitura", segundo os comentários no código-fonte.

---

## 13. Conciliação Bancária

| Método | Rota | Para que serve | Auth |
|---|---|---|---|
| POST | `/api/conciliacao/auto-lote` | Concilia automaticamente uma nota fiscal que veio de um lote com extrato bancário vinculado (`documents.extrato_origem_id`), casando com o lançamento certo dentro daquele extrato; em caso de falta de match ou ambiguidade, deixa a nota seguir o fluxo manual | `requireAuth` (mais checagem manual de que `nota.organization_id` bate com `req.user.app_metadata.org_id`, quando ambos existem) |

Body: `{ document_id }`. Ao conciliar com sucesso, a nota pula os estados `aguardando_comprovante` e `aguardando_conciliacao_bancaria` e vai direto para `aguardando_d3` (o extrato faz o papel do comprovante).

---

## Rotas sem chamador conhecido no frontend (revalidado nesta auditoria)

O `AUDITORIA_CODIGO.md` já havia identificado 5 rotas sem nenhum `fetch(...)` apontando para elas em todo o repositório. Refiz o grep nesta auditoria (`grep -rn` por essas rotas em `.html`/`.js`, excluindo `server.js`) e o padrão de chamada **não mudou** — permanecem sem chamador:

- `GET /api/health`
- `GET /api/m2/contracts/:project_id`
- `POST /api/m2/contracts`
- `POST /api/m2/salic/encerrar` (além de sem chamador, é um stub que nunca foi implementado de fato — sempre responde com uma mensagem simulada)
- `POST /api/rubricas/importar` (o front bypassa esse proxy e chama o webhook do n8n direto)

Nenhuma decisão foi tomada sobre remover essas rotas — isso continua em aberto, conforme já registrado no `AUDITORIA_CODIGO.md` (seção "Lista de PRECISA DECISÃO", item 2).

---

## Observação geral sobre autenticação

Boa parte das rotas mais antigas do Módulo 2 (`/api/m2/contracts*`, `/api/m2/salic/encerrar`, `/api/m2/processar-pdf-salic`, `/api/m2/salvar-revisao-salic`, `/api/m2/gerar-relatorio`, `/api/m2/evidencia/notificar`, `/api/rubricas/importar`) **não têm nenhuma checagem de autenticação/autorização no código** — nem `requireAuth`, nem verificação manual de header/token. Isso é diferente das rotas mais novas (`/api/m2/impostos/*`, `/api/m2/contratos/ocr`, `/api/m3/*`, `/api/suporte/*`, `/api/plataforma/*`, `/api/gestor/*`), que consistentemente usam `requireAuth` e, quando fazem sentido, `requireRole`/`requireSuporte`/`requirePlatformAdmin` ou a checagem de acesso ao projeto via `userCanAccessProject`. Isso não foi investigado a fundo quanto a exposição real (algumas dessas rotas sem auth são proxies que só repassam para o n8n, ou dependem de o `project_id`/`document_id` já ser um segredo difícil de adivinhar), mas é uma lacuna que vale confirmar com o time antes de expor essas rotas publicamente sem uma camada adicional (ex.: API gateway, rede interna).

---

## Como testar localmente

O servidor lê `PORT` de `process.env.PORT`, com padrão `3000` (`const PORT = process.env.PORT || 3000;`, em `server.js`). Rodando localmente (`node server.js` ou `npm start`, conforme o `package.json` do projeto), a base URL local é:

```
http://localhost:3000
```

Exemplo — checar se o servidor está de pé (rota sem autenticação):

```bash
curl http://localhost:3000/api/health
```

Resposta esperada (formato):

```json
{ "status": "ok", "env": "development", "hasSupabase": true }
```

Exemplo — rota autenticada (troca de papel de um usuário da equipe), usando um token de sessão do Supabase obtido via login no front-end:

```bash
curl -X POST http://localhost:3000/api/gestor/set-role \
  -H "Authorization: Bearer SEU_TOKEN_SUPABASE" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"uuid-do-usuario-alvo","role":"analista"}'
```

Não foi encontrado no repositório nenhum script de seed/fixture pronto para gerar esse token localmente — na prática, o token é obtido fazendo login pela própria interface web (`index.html`) e copiando o `access_token` da sessão do Supabase no DevTools do navegador.
