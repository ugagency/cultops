# Changelog

Histórico de features e correções por módulo. Cada seção vem de um registro de sessão/branch anterior — mantidas como estavam, sem reescrever o conteúdo original.

---

## Módulo I — Dashboard

*(sessão anterior, sem branch/commit de referência registrado)*

### Exclusão em Lote no Dashboard
Foi adicionada a capacidade de selecionar múltiplos documentos diretamente na tabela do Dashboard para excluí-los de uma só vez, facilitando a limpeza de notas inválidas ou duplicadas.
- **Checkbox Geral:** Permite selecionar ou desmarcar todos os documentos listados na página atual.
- **Checkboxes Individuais:** Inseridos na primeira coluna de cada linha da tabela.
- **Botão Dinâmico de Exclusão:** Um botão vermelho "Excluir Selecionados (X)" surge no topo da tabela apenas quando há itens marcados.
- **Exclusão Segura:** A ação de exclusão remove os arquivos associados do *Supabase Storage* e os respectivos registros no *Banco de Dados* de forma combinada.

### Atualização Cirúrgica de Status em Tempo Real (UX/UI)
O sistema de escuta de eventos em tempo real (Supabase Realtime) foi profundamente otimizado para não prejudicar a experiência do usuário.
- **Badges Dinâmicos no Dashboard:** Quando um documento tem seu status alterado no banco (ex: processamento finalizado pelo n8n), o badge de status na tabela do Dashboard atualiza sua cor e texto **cirurgicamente**, sem precisar recarregar a página ou a lista.
- **IDs nas Linhas da Tabela:** Cada linha (`<tr>`) da tabela do Dashboard agora possui um ID único (`doc-row-{id}`) para permitir essas atualizações precisas no DOM.

### Bloqueio de Re-renders Indesejados nas Telas de Upload
Havia um problema onde alterações no banco de dados (em segundo plano) faziam as telas de sistema piscarem e recarregarem, fazendo o usuário perder o foco e dados que estava digitando.
- **Correção Aplicada:** Removemos a chamada global de re-renderização (`render()`) do listener de `UPDATE` do banco de dados para as telas sensíveis (como **Upload** individual e **Upload em Lote**).
- **Resultado:** A interface agora permanece 100% estável enquanto o usuário faz uploads ou preenche formulários de rubrica, mesmo que o status de outros documentos seja atualizado simultaneamente no background.

### Ordenação Alfabética na Fila de Upload em Lote
Melhoria de usabilidade na aba de Upload em Lote.
- **Listagem Intuitiva:** Ao fazer o upload de múltiplos PDFs, a fila "Aguardando Rubrica" agora é exibida em ordem alfabética exata pelo nome do arquivo (de A a Z), abandonando a ordenação confusa por data de criação. Isso torna a conferência e o preenchimento das rubricas muito mais fáceis.

---

## Módulo III — Distribuição/Contrapartidas

> Branch `feature/modulo-3`. Última atualização enviada ao remoto: commit `9f91748`.

### Navegação

- Sidebar única e persistente (`renderSidebarM3`, em `modulo3/supabase-helper-m3.js`) em todas as telas do módulo — 6 itens: Org. Sociais, Patrocinadores, Eventos, Relatórios, Dashboard, Campo (PWA).
- `modulo3/index.html` deixou de ser um hub de cards e agora só redireciona para `eventos.html` (mantido no ar para não quebrar links/favoritos antigos).
- Identidade visual unificada com M1/M2: removidas as variáveis CSS que o M3 redeclarava com valores próprios (cores, sombra, raio de borda, largura da sidebar) — agora tudo herda de `style.css`, a fonte única da marca. Cores hardcoded trocadas por variáveis em `m3-shared.css` e `supabase-helper-m3.js`.

### Telas e funcionalidades

| Área | Arquivo(s) | O que faz |
|---|---|---|
| Org. Sociais / Patrocinadores | `os.html`, `pa.html` | Cadastro e gestão (bloqueado para role `operador`) |
| Eventos | `eventos.html` (lista) + `evento-form.html` (criar/editar, tela dedicada) + `evento-detalhe.html` (vínculos OS/PA) | CRUD completo de evento |
| Convidados | `convidados.html` | Importação em lote via Excel/CSV, carta-convite |
| Portaria | `portaria.html` | Check-in por evento |
| Evidências | `evidencias-m3.html` | Upload separado por tipo (execução / acessibilidade / comunicação) |
| Relatórios | `relatorios.html`, `relatorio-evento.js`, `relatorio-docx.js` | Relatório de evento e mensal, fiel ao template real da Animus (tabelas, links nomeados, galerias por tipo). Gerado **100% no navegador** — não depende mais do backend |
| Dashboard | `contrapartidas.html` | KPIs do projeto + geração do relatório do período |
| Campo (PWA) | `pwa/index.html`, `pwa/sw.js`, `pwa/idb.js`, `pwa/manifest.json` | App instalável, offline-first, busca/check-in de convidados, sincronização — agora com a mesma identidade visual do resto do M3 |

### Segurança

- Guard de role reaplicado em `app.js`: usuário com role `operador` que tentar acessar o M1 pelo "Trocar Módulo" cai em "Sem acesso" em vez do dashboard completo (a branch estava defasada em relação à correção já existente na `main`).
- Sidebar do M3 já escondia Org. Sociais/Patrocinadores da role `operador`.

### Bugs corrigidos nesta sessão

- **PWA não conseguia buscar eventos online** ("Faça login" mesmo autenticado): o código checava variáveis globais que nunca existiram (`window.SUPABASE_URL`/`window.SUPABASE_ANON_KEY`) em vez de `CONFIG.SUPABASE_URL`/`CONFIG.SUPABASE_KEY`, o padrão usado no resto do M3.
- **PWA preso em versão visual antiga**: o Service Worker cacheava `index.html`/CSS com estratégia cache-first e nome de cache fixo — usuários que já tinham aberto o app antes ficavam presos na versão anterior à unificação visual. Corrigido com bump de versão do cache (`v1` → `v2`).
- **Sidebar podia ficar desatualizada após deploy**: adicionado cache-busting (`?v=2`) no `<script src>` do `supabase-helper-m3.js` em todas as páginas do M3.

### Pendências em aberto

1. **Logo do Instituto ArteCidadania** — ainda não recebido, para embutir no cabeçalho do relatório `.docx` gerado (o código já tem o ponto pronto em `relatorio-docx.js`, variável `LOGO_ARTECIDADANIA_B64`).
2. **Backend antigo de geração de relatório** (`server.js`, endpoints `/api/m3/relatorio/*`) — ficou obsoleto desde que a geração passou a ser client-side. Ainda não decidido se deve ser removido.
