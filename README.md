# Prestaí

Plataforma de comprovação financeira, prestação de contas e contrapartidas para projetos culturais aprovados pela **Lei Rouanet** — automatiza a categorização de despesas (rubricas), a conciliação bancária e o envio de comprovantes ao portal **SALIC** do Ministério da Cultura.

## Stack

- **Front-end:** JavaScript vanilla, HTML5, CSS3 — SPA custom governada por `app.js` (M1/Gestor), mais os módulos `modulo2/` (Comprovação Financeira) e `modulo3/` (Distribuição/Contrapartidas).
- **Back-end:** Node.js/Express (`server.js`), rota serverless em `api/`.
- **Banco:** Supabase (Postgres, Auth, Storage, Row Level Security).
- **Automação:** Puppeteer para o RPA de inserção no SALIC (`salic_insertion.cjs`); n8n para OCR e cron jobs de transição de status.

Detalhe completo em [docs/arquitetura/](docs/arquitetura/DOCUMENTACAO_PROJETO.md).

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencher com as chaves reais (nunca commitar o .env)
npm run dev             # nodemon server.js
```

## Documentação

| Pasta | Conteúdo |
|---|---|
| [docs/manual/](docs/manual/) | Manual de uso — gestor, fornecedor, papéis e navegação |
| [docs/arquitetura/](docs/arquitetura/) | Visão geral do sistema, arquitetura M2↔M3, workflows n8n |
| [docs/auditorias/](docs/auditorias/) | Auditorias de código, banco de dados e briefings de bug |
| [docs/qa/](docs/qa/) | Plano de testes e homologação |
| [docs/changelog/](docs/changelog/) | Histórico de features implementadas por módulo |
| [docs/historico/](docs/historico/) | Planos de fase já concluídos |
| [database/migrations/](database/migrations/) | Migrations SQL do Supabase, em ordem de criação (`archive/` para as já superadas) |

## Estrutura

```
app.js, server.js, *.html (raiz)   — Módulo 1 (Gestor/Proponente)
modulo2/                            — Módulo 2 (Comprovação Financeira)
modulo3/                            — Módulo 3 (Distribuição/Contrapartidas)
api/                                 — função serverless (Vercel)
database/                            — schema e migrations SQL
docs/                                — documentação do projeto
```
