# Resumo das Features Implementadas (Sessão Atual)

Abaixo estão detalhadas todas as funcionalidades, otimizações e correções implementadas durante nossa última sessão de desenvolvimento no projeto **Prestaí (Cultopps)**.

---

## 1. Exclusão em Lote no Dashboard
Foi adicionada a capacidade de selecionar múltiplos documentos diretamente na tabela do Dashboard para excluí-los de uma só vez, facilitando a limpeza de notas inválidas ou duplicadas.
- **Checkbox Geral:** Permite selecionar ou desmarcar todos os documentos listados na página atual.
- **Checkboxes Individuais:** Inseridos na primeira coluna de cada linha da tabela.
- **Botão Dinâmico de Exclusão:** Um botão vermelho "Excluir Selecionados (X)" surge no topo da tabela apenas quando há itens marcados.
- **Exclusão Segura:** A ação de exclusão remove os arquivos associados do *Supabase Storage* e os respectivos registros no *Banco de Dados* de forma combinada.

## 2. Atualização Cirúrgica de Status em Tempo Real (UX/UI)
O sistema de escuta de eventos em tempo real (Supabase Realtime) foi profundamente otimizado para não prejudicar a experiência do usuário.
- **Badges Dinâmicos no Dashboard:** Quando um documento tem seu status alterado no banco (ex: processamento finalizado pelo n8n), o badge de status na tabela do Dashboard atualiza sua cor e texto **cirurgicamente**, sem precisar recarregar a página ou a lista.
- **IDs nas Linhas da Tabela:** Cada linha (`<tr>`) da tabela do Dashboard agora possui um ID único (`doc-row-{id}`) para permitir essas atualizações precisas no DOM.

## 3. Bloqueio de Re-renders Indesejados nas Telas de Upload
Havia um problema onde alterações no banco de dados (em segundo plano) faziam as telas de sistema piscarem e recarregarem, fazendo o usuário perder o foco e dados que estava digitando.
- **Correção Aplicada:** Removemos a chamada global de re-renderização (`render()`) do listener de `UPDATE` do banco de dados para as telas sensíveis (como **Upload** individual e **Upload em Lote**).
- **Resultado:** A interface agora permanece 100% estável enquanto o usuário faz uploads ou preenche formulários de rubrica, mesmo que o status de outros documentos seja atualizado simultaneamente no background.

## 4. Ordenação Alfabética na Fila de Upload em Lote
Melhoria de usabilidade na aba de Upload em Lote.
- **Listagem Intuitiva:** Ao fazer o upload de múltiplos PDFs, a fila "Aguardando Rubrica" agora é exibida em ordem alfabética exata pelo nome do arquivo (de A a Z), abandonando a ordenação confusa por data de criação. Isso torna a conferência e o preenchimento das rubricas muito mais fáceis.
