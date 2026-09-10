# Plano de Implementação: Prestaí Fase 2

## Visão Geral
Este plano define a execução da Fase 2 do Prestaí, transformando o sistema num gerenciador financeiro completo para projetos da Lei Rouanet. Ele introduz gestão de rubricas, conciliação bancária, validações de conformidade de CNPJ/CNAE, Portal do Fornecedor e automação RPA para o SALIC.

## Tipo de Projeto
WEB (Front-end Vanilla + Supabase) + BACKEND (n8n Webhooks + Airtop RPA)

## Critérios de Sucesso
- Criação e RLS adequado das 5 novas tabelas no Supabase (`rubricas`, `despesas`, `fornecedores`, `extratos_bancarios`, `portal_submissions`).
- Interface de gestão de orçamento 100% funcional.
- Workflows do n8n operando de forma autônoma para validações fiscais e Regra D-3.
- Portal público recebendo documentos com upload seguro via token.
- Robô RPA conseguindo logar no SALIC e emitir comprovantes (POC).

## Stack Tecnológico
- **Front-end:** HTML/CSS/JS (Vanilla), Supabase JS SDK.
- **Back-end/Automação:** n8n (Webhooks e cron jobs).
- **Banco de Dados:** PostgreSQL (Supabase) com Row Level Security.
- **Infra/Robô:** Airtop integrado nativamente no n8n via API para automação web.

## Estrutura de Arquivos
```text
prestai/
├── orcamento.html      ← Gestão de rubricas e despesas
├── conciliacao.html    ← Tela de conciliação bancária
├── conformidade.html   ← Painel de conformidade
├── fornecedores.html   ← Cadastro e links de portal
├── portal.html         ← Portal público do fornecedor
├── relatorios.html     ← Exportação de relatórios
└── js/
    ├── orcamento.js    ← Lógica de rubricas e despesas
    ├── conciliacao.js  ← Lógica de conciliação
    └── portal.js       ← Lógica do portal público
```

## Quebra de Tarefas (Sprints)

### Sprint 1: Gestão Financeira Base
| ID | Tarefa | Agente | Skills | Prioridade | INPUT → OUTPUT → VERIFY |
|---|---|---|---|---|---|
| 1.1 | Tabelas e RLS | `database-architect` | `database-design` | P0 | INPUT: Esquema da DB → OUTPUT: Migração `rubricas` e `despesas` no Supabase → VERIFY: SQL RLS previne acesso indevido |
| 1.2 | UI Orçamento | `frontend-specialist`| `frontend-design` | P1 | INPUT: `orcamento.html` → OUTPUT: UI de cadastro e lista com barras de progresso → VERIFY: Cálculo de saldo em tempo real |
| 1.3 | Vínculo Despesa | `frontend-specialist`| `clean-code`      | P1 | [x] INPUT: Workflow OCR → OUTPUT: UI de vínculo condicional (apenas em bloqueio) → VERIFY: Evita erro humano em fluxos automáticos |

### Sprint 2: Validação e Conformidade
| ID | Tarefa | Agente | Skills | Prioridade | INPUT → OUTPUT → VERIFY |
|---|---|---|---|---|---|
| 2.1 | Tabelas Fornecedores | `database-architect` | `database-design` | P0 | INPUT: Nova tabela → OUTPUT: `fornecedores` e caching → VERIFY: RLS público para selects |
| 2.2 | n8n Consulta & Lock | `backend-specialist`| `api-patterns`    | P1 | [x] INPUT: Webhooks `document_id` → OUTPUT: Auditoria automática para NF avulsa e Misto → VERIFY: Status `aguardando_conformidade` validado |
| 2.3 | UI Conformidade | `frontend-specialist`| `clean-code`      | P2 | INPUT: `conformidade.html` → OUTPUT: Painel de bloqueios e flags IA → VERIFY: Alertas visíveis por projeto |

### Sprint 3: Portal do Fornecedor
| ID | Tarefa | Agente | Skills | Prioridade | INPUT → OUTPUT → VERIFY |
|---|---|---|---|---|---|
| 3.1 | Infraestrutura Subs | `database-architect` | `database-design` | P0 | INPUT: Tabela submissões → OUTPUT: Tabela `portal_submissions` → VERIFY: INSERT permitido apenas via token |
| 3.2 | UI Portal Público | `frontend-specialist`| `frontend-design` | P1 | INPUT: `portal.html` → OUTPUT: Flow de drag&drop sem autenticação → VERIFY: Upload para bucket Supabase via API |
| 3.3 | Envio de Token | `frontend-specialist`| `clean-code`      | P2 | INPUT: `fornecedores.html` → OUTPUT: Geração de token e link de acesso → VERIFY: Token mapeia corretamente pro projeto |

### Sprint 4: Conciliação Bancária
| ID | Tarefa | Agente | Skills | Prioridade | INPUT → OUTPUT → VERIFY |
|---|---|---|---|---|---|
| 4.1 | Tabela Extratos | `database-architect` | `database-design` | P0 | INPUT: Tabela banco → OUTPUT: `extratos_bancarios` e RLS → VERIFY: Inserção correta |
| 4.2 | Parser de Transações| `frontend-specialist`| `clean-code`      | P1 | INPUT: Upload arquivo OFX/CSV → OUTPUT: Parsing no JS → VERIFY: Linhas convertidas e salvas no BD |
| 4.3 | UI Conciliação | `frontend-specialist`| `frontend-design` | P1 | INPUT: `conciliacao.html` → OUTPUT: Layout de colunas e botões de batch → VERIFY: Matching via n8n e cor verde após success |
| 4.4 | Regra D-3 (Cron) | `backend-specialist`| `api-patterns`    | P1 | INPUT: Trigger Cron n8n → OUTPUT: Job às 8h analisando `conciliado` → VERIFY: Documentos sinalizados com `liberado_rpa` |

### Sprint 5: RPA SALIC (Airtop + n8n)
| ID | Tarefa | Agente | Skills | Prioridade | INPUT → OUTPUT → VERIFY |
|---|---|---|---|---|---|
| 5.1 | Setup Airtop | `backend-specialist`| `api-patterns` | P2 | INPUT: Chave API Airtop → OUTPUT: Credencial configurada no n8n → VERIFY: Conexão n8n-Airtop estabelecida |
| 5.2 | Integração SALIC via Airtop | `backend-specialist`| `prompt-engineering` | P1 | INPUT: Credenciais do gov.br/SALIC → OUTPUT: Prompts/Instruções Web para Airtop navegar e inserir → VERIFY: Retorna protocolo do SALIC |
| 5.3 | Cofre de Senhas   | `database-architect` | `database-design`| P0 | INPUT: Tokens → OUTPUT: Mecanismo de KMS / AWS Secrets / Criptografia Supabase → VERIFY: Senhas do projeto protegidas |


## Fase X: Verificações
- [ ] Segurança: Políticas RLS validadas para não haver exclusão acidental ou acesso cross-tenant
- [ ] Fluxo: Regra de salto validada pra nunca passar de executado > aprovado
- [ ] Testes: Lógica de matching banco <---> despesa testada com flutuação de R$0,01
- [ ] Interface: Layout check e mobile responsividade testada
- [ ] RPA: Janelas de runtime e tratativas de exceção validadas contra o backend do MinC

## Lembretes / Briefing do Final do Dia
- **Catálogo Global de Rubricas**: Atualmente a tabela `catalogo_rubricas` conta apenas com 5 exemplos de rubricas para validação de IA. Precisamos, antes de lançar a validação inteligente oficial, migrar os 100% das rubricas possíveis da planilha Excel atual para o banco de dados (tabela `catalogo_rubricas` no Supabase), alimentando a IA com as "especificações" reais de conferência para todas as notas.
