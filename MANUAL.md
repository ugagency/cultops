# Manual de Uso — prestaí

**Plataforma de Comprovação Financeira, Prestação de Contas e Contrapartidas para Projetos Culturais (Lei Rouanet)**

---

## Sumário

1. [Introdução](#1-introdução)
2. [Acesso, papéis e navegação](#2-acesso-papéis-e-navegação)
3. [Glossário](#3-glossário)
4. [Módulo I — Comprovação Financeira (RPA)](#4-módulo-i--comprovação-financeira-rpa)
5. [Módulo II — Prestação de Contas & Contratos](#5-módulo-ii--prestação-de-contas--contratos)
6. [Módulo III — Contrapartidas (Campo)](#6-módulo-iii--contrapartidas-campo)
7. [Referência rápida: status de documento](#7-referência-rápida-status-de-documento)
8. [Perguntas frequentes (FAQ)](#8-perguntas-frequentes-faq)

---

## 1. Introdução

O **prestaí** automatiza o ciclo completo de prestação de contas de projetos culturais aprovados pela **Lei Rouanet (Lei nº 8.313/91)** em três módulos:

| Módulo | Nome | O que faz |
|--------|------|-----------|
| **I** | Comprovação Financeira (RPA) | Recebe NFs, extrai dados por IA (OCR), audita conformidade CNAE × rubrica, concilia com o extrato bancário e envia ao SALIC via robô |
| **II** | Prestação de Contas & Contratos | Contratos com parcelas e aditivos, impostos (DARF), evidências físicas, checklist de encerramento, exportações e relatório final ao MinC |
| **III** | Contrapartidas (Campo) | Eventos, distribuição de ingressos a Organizações Sociais e Patrocinadores, convidados, check-in na portaria (inclusive offline via app), evidências de execução e relatórios de evento/mensais |

Fluxo geral: o dinheiro do projeto é comprovado no **Módulo I**, a documentação jurídico-fiscal e o encerramento acontecem no **Módulo II**, e a execução das contrapartidas em campo é registrada no **Módulo III**.

---

## 2. Acesso, papéis e navegação

### Login e seleção de módulo

1. Acesse a página inicial e faça login com e-mail e senha (ou crie a conta em **"Crie uma agora"**).
2. Após o login, a tela **Seleção de Módulo** mostra os módulos contratados pela sua organização. Clique no card do módulo desejado.
3. Dentro de qualquer módulo, o item **"Trocar Módulo"** no rodapé da barra lateral volta para essa tela.

### Papéis de acesso

| Papel | Módulo I | Módulo II | Módulo III |
|-------|----------|-----------|------------|
| **Administrador** | Tudo (+ Equipe, exclusões) | Tudo | Tudo |
| **Gestor** | Tudo, exceto Equipe e exclusões em lote | Tudo | Tudo |
| **Analista** | Operação (sem Ferramentas/Equipe) | Tudo | Tudo |
| **Operador** | — | Sem acesso (redirecionado ao M3) | Operação de campo: não cria/exclui eventos, não cadastra OS/PA, não vincula OS/PA a eventos |
| **Fornecedor (Solicitante)** | Apenas o Portal do Solicitante | — | — |

- Quem faz login com papel **operador** é levado direto ao Módulo III (sem passar pela seleção de módulo).
- Papéis são gerenciados na tela **Equipe** do Módulo I (somente admin). Após alterar um papel, o usuário precisa **sair e entrar de novo**.

### Seleção de projeto

Quase todas as telas dependem de um **projeto selecionado** no seletor do topo (identificado pelo PRONAC). A seleção fica memorizada no navegador e é compartilhada entre as telas e módulos.

---

## 3. Glossário

| Termo | Definição |
|-------|-----------|
| **PRONAC** | Número do projeto no SALIC (ex: 250001). Identifica o projeto em todas as telas. |
| **SALIC** | Sistema de Apoio às Leis de Incentivo à Cultura — portal do MinC onde as despesas são comprovadas oficialmente. |
| **Rubrica** | Linha do orçamento aprovado, com valor máximo e tipo de despesa permitido (ex: "Cachê Artístico"). |
| **Comprovante** | Documento que prova o pagamento da NF (ordem de pagamento, TED, recibo). |
| **Conciliação** | Cruzamento da NF com a transação real no extrato bancário. |
| **D-3** | Prazo regulatório de 72 horas após a conciliação, exigido antes do envio ao SALIC. |
| **OCR** | Leitura automática do PDF por IA, que extrai CNPJ, valor, data etc. |
| **RPA** | Robô que acessa o SALIC e preenche o formulário automaticamente com suas credenciais. |
| **CNAE** | Código do ramo de atuação da empresa. A auditoria valida se o CNAE do fornecedor é compatível com a rubrica. |
| **OS** | Organização Social — entidade parceira que recebe cota de ingressos como contrapartida. |
| **PA** | Patrocinador / Ponto de Apoio — também recebe cota de ingressos. |
| **Contrapartida** | Obrigação social do projeto (ex: distribuição gratuita de ingressos), comprovada no Módulo III. |
| **Evidência** | Foto, vídeo, material ou relatório que comprova a execução física do projeto. |
| **LGPD** | Lei Geral de Proteção de Dados (13.709/2018) — exige consentimento para uso do CPF dos convidados. |

---

## 4. Módulo I — Comprovação Financeira (RPA)

Menu lateral: **Dashboard · Projetos · Rubricas · Documentos · Documentos em Lote · Envio SALIC · Relatórios · Solicitantes · Configurações · Ferramentas · Equipe**

### 4.1 Dashboard

Tela inicial: todas as notas fiscais enviadas, em qualquer status.

- **KPIs**: Notas analisadas, Em processo, Notas aprovadas, Divergências.
- **Filtros**: busca por texto, projeto, status, ordenação (mais recentes/antigos, status, nome) e **Limpar filtros**.
- **Tabela**: arquivo, projeto, status e data, com ações **ver detalhes** (olho) e **excluir** (lixeira). O admin pode selecionar várias linhas e usar **Excluir Selecionados**.
- Botão **Enviar nota** leva à tela de upload.

### 4.2 Projetos

Lista dos projetos importados: PRONAC, nome/proponente, UF, valor aprovado e data.

- Ações por linha: **Detalhes SALIC**, **Financeiro** (abre Relatórios já filtrado), **Baixar Laudo Excel** (gestor/analista) e **Excluir Projeto** (somente admin).
- **Novo Projeto**: não há cadastro manual — informe o **número do PRONAC** e clique em **Importar**. O robô busca no SALIC nome, proponente, UF, valor aprovado, valor arrecadado e mecanismo, e confirma num modal.

### 4.3 Rubricas (Gestão Orçamentária)

Importa e exibe o orçamento aprovado do projeto. Pré-requisito: projeto selecionado.

1. Gere o PDF da **Planilha Orçamentária** no SALIC (o link **"Como fazer isso?"** mostra o passo a passo com 9 etapas).
2. Arraste o PDF para a área de importação e clique em **Importar Rubricas**. A barra de progresso passa por: envio → leitura → extração → salvamento.
3. As rubricas aparecem como cards agrupados por **Etapa** e **Local (UF/Município)**, com código, nome, quantidade × valor unitário e **Valor Aprovado**.

- O painel **Versões Anteriores (Backups)** guarda cada importação, com botão **Baixar**.
- Nas telas de Rubricas, Documentos e Documentos em Lote, o botão **"Veja a Planilha Orçamentária"** abre o PDF do SALIC do projeto selecionado.

### 4.4 Documentos (enviar uma NF)

1. Selecione **Projeto/PRONAC** e a **Rubrica Orçamentária** (obrigatória, com busca).
2. Arraste o PDF da NF ou clique para selecionar (somente PDF). O upload inicia sozinho.
3. O documento aparece no Dashboard como **"Em Processamento"** enquanto a IA extrai os dados.

> Precisa juntar vários arquivos num só PDF antes de subir? Use o link **"Precisa juntar arquivos antes de subir?"** — abre a ferramenta de consolidar PDFs sem sair da tela.

### 4.5 Documentos em Lote

Envio de vários PDFs de uma vez, em duas etapas:

1. **Selecionar arquivos**: escolha o projeto e selecione os PDFs.
2. **Fila aguardando rubrica**: cada arquivo fica numa linha com campo de rubrica próprio (autocomplete). Preencha e clique em **Processar** (por item) ou **Processar todos preenchidos**. O OCR só começa após o processamento.

### 4.6 Envio SALIC (em lote)

Envia ao SALIC, de uma vez, todos os documentos com status **"Pronto para envio"**.

- **Pré-requisito**: credenciais SALIC salvas em **Configurações** (sem elas o sistema redireciona para lá).
- Filtre por projeto, use **Selecionar Todos/Desmarcar Todos** e clique em **Iniciar Envio**.
- O modo progresso mostra barra de percentual, contadores (Sucesso/Erros/Pendentes) e a fila item a item. Botões: **Cancelar Envio**, **Retomar** (se sobraram pendentes) e **Limpar/Voltar**.
- Mantenha a aba aberta durante o envio. A fila sobrevive a recarregamentos da página.

### 4.7 Detalhe do documento (pipeline)

Clique no olho de qualquer documento para acompanhar as 6 etapas: **Enviado → OCR → Auditoria → Documentação → Conciliação → SALIC**. A tabela completa de status está na [seção 7](#7-referência-rápida-status-de-documento). Ações principais na tela de detalhes:

- **Revisão Manual**: se o OCR falhou, preencha os campos pendentes (CNPJ, valor, data, número) e salve — o documento avança sozinho para a auditoria.
- **Bloqueado (conformidade)**: o CNAE do fornecedor não bate com a rubrica. Selecione a rubrica correta no dropdown e clique em **Corrigir Vínculo**.
- **Falta Comprovante**: clique em **Anexar Comprovante** (PDF ou imagem). *Opcional* — pode pular direto para o extrato.
- **Falta Conciliação**: clique em **Subir Extrato (OFX/CSV/PDF)** ou use a sincronização com o Banco do Brasil (credenciais no Módulo II → Configurações).
- **Pronto para envio**: clique em **Adicionar documento no SALIC** — o robô preenche tudo e captura o **protocolo SALIC**.
- **Erro no Envio**: nada se perde; clique em **Tentar Novamente**.

### 4.8 Relatórios

Saúde financeira por projeto (ou visão consolidada).

- Três cartões clicáveis por grupo: **Concluídos/Enviados**, **Em andamento** e **Requer atenção** — cada um abre a lista dos documentos do grupo com atalho para os detalhes.

### 4.9 Solicitantes

Autoriza fornecedores a enviarem documentos diretamente pelo Portal do Solicitante.

- **Novo acesso**: selecione o solicitante e o projeto → **Liberar acesso**.
- Fornecedor ainda não cadastrado? **Copiar link de cadastro** e envie a ele — o link abre o autocadastro do portal.
- **Acessos ativos**: tabela com os vínculos e botão **Remover**.

### 4.10 Configurações

- **Conexão SALIC (Gov.br)**: usuário/CPF e senha usados pelo robô. Criptografados no banco.
- **Trocar senha de acesso** da sua conta.
- A integração com o **Banco do Brasil** fica nas Configurações do **Módulo II**.

### 4.11 Ferramentas (gestor/admin)

- **Consolidar PDFs**: junta PDF, PNG e JPG num único PDF, direto no navegador (nada é enviado ao servidor). Até 20 arquivos de 10 MB; arraste as linhas para reordenar; defina o nome do arquivo e clique em **Gerar PDF único**.

### 4.12 Equipe (somente admin)

- Tabela de usuários com e-mail, perfil e data de cadastro.
- **Adicionar Analista**: cria usuário com senha provisória.
- **Alterar Perfil**: muda entre Analista, Gestor e Fornecedor. O usuário precisa relogar para valer.

### 4.13 Portal do Solicitante (perfil Fornecedor)

Portal separado para o fornecedor enviar documentos sem intermediação do gestor.

1. **Cadastro** (pelo link enviado pelo gestor): CNPJ, telefone, razão social, e-mail e senha.
2. **Login**: botão "Acesso Solicitante" na tela inicial.
3. **Meus Envios**: escolha o projeto autorizado e clique em **Adicionar Novo Documento**. Dois tipos:
   - **Nota Fiscal / Recibo** — PDF/imagem, com leitura automática por IA;
   - **Comprovação Física** — foto do evento, relatório fotográfico, peça de marketing ou outros (PDF/PNG/JPG/MP4), com descrição opcional. Cai na tela **Evidências** do Módulo II para validação do gestor.
4. A tabela **Histórico de Documentos** mostra o status de cada envio (somente acompanhamento).

---

## 5. Módulo II — Prestação de Contas & Contratos

Menu lateral: **Dashboard · Projetos · Dados do Projeto · Rubricas · Contratos · Impostos · Evidências · Solicitantes · Prestação de Contas · Exportações · Configurações**

> Acesso restrito a **admin, gestor e analista**. Operador é redirecionado ao Módulo III.

### 5.1 Dashboard Financeiro

Visão geral da prestação de contas do projeto selecionado.

- **KPIs**: Total Aprovado MinC, Impostos Pagos e Checklist MinC (x/y com barra de progresso).
- Faixa de **contratos** com resumo e link "Ver contratos"; blocos de **Rubricas** e **Despesas Recentes**.
- **Acesso Rápido**: atalhos para Rubricas, Contratos, Impostos e Comprovação Física.

### 5.2 Projetos

Escolhe ou traz um projeto para o M2.

- **Projetos ativos**: cards com PRONAC, nome e status — clicar seleciona o projeto e abre o Dashboard.
- **Importar novo projeto**: do **Módulo I** (lista os projetos já cadastrados lá) ou **do SALIC** (digite o PRONAC → **Importar Projeto**).
- Após criar, o modal oferece importar a planilha orçamentária (.xlsx/.csv) na hora ou **Fazer depois**.

### 5.3 Dados do Projeto (SALIC)

Extrai por OCR o PDF do projeto no SALIC e permite revisar antes de salvar.

1. Selecione o projeto, anexe o PDF e clique em **Processar**.
2. Revise os dados em 4 abas: **Etapas de Trabalho** (nome, duração, objetivo, atividades), **Local de Realização** (locais e deslocamentos), **Plano de Divulgação** e **Dados Complementares** (síntese, objetivos, justificativa, período).
3. **Salvar** (ou **Reimportar PDF** para recomeçar).

### 5.4 Rubricas

Controle orçamentário avançado com histórico de readequações.

- **Importar Planilha** (PDF do SALIC) com barra de progresso e **Histórico de Importações**.
- Lista com código, nome/etapa e valor aprovado. Por rubrica: **Histórico de readequações** (relógio) e **Nova readequação orçamentária** (engrenagem) — o modal pede o novo valor aprovado e um **motivo obrigatório**, registrado no histórico.

### 5.5 Contratos

Gestão completa dos contratos do projeto, vinculados a fornecedor e rubrica.

- **Barra de filtros**: busca por fornecedor/número/objeto, rubrica, ano e status, com contador ("n de N contratos") e botão Limpar.
- **Novo Contrato**: número, objeto, valor, vigência, fornecedor e rubrica (obrigatórios) + arquivo PDF opcional. Ao anexar o PDF, o **OCR preenche os campos automaticamente**; se o CNPJ do fornecedor não estiver cadastrado, um aviso oferece criá-lo e vinculá-lo na hora.
- **Coluna Ações** por linha: **Ver arquivo** (abre o PDF), **Editar** (mesmo formulário, pré-preenchido; trocar o arquivo é opcional) e **Excluir** (com confirmação; anexos vinculados são excluídos junto — ação irreversível).
- Clique na linha para expandir as abas:
  - **Parcelas**: adicionar parcela (nº, valor, vencimento) e **Marcar paga**; parcelas vencidas ganham alerta vermelho na listagem.
  - **Aditivos**: registrar aditivo de prazo, valor, objeto, supressão, rescisão ou outros — prazo e valor atualizam o contrato automaticamente; rescisão muda o status.
  - **Anexos**: contratos derivados vinculados ao contrato pai (1 nível), com **Adicionar anexo** e **Remover vínculo**.
- Ações de status na própria linha: **Suspender / Encerrar / Reativar**.

### 5.6 Impostos (DARF)

Controle das guias tributárias do projeto.

- Cards de resumo: total, pendentes, pagas e atrasadas.
- **Nova Guia**: tipo (DARF, ISS, INSS, PIS, COFINS, CSLL, Outro), código de receita, competência, valor, vencimento, NF vinculada (opcional) e arquivo PDF da guia (opcional).
- Por guia: **Ver arquivo** e **Marcar como paga** (pede confirmação; irreversível pelo sistema).

### 5.7 Evidências (Comprovação Física)

Validação das evidências de execução do objeto (fotos, relatórios, peças de marketing).

- **Enviar evidência**: tipo (Foto do evento, Relatório do objeto, Peça de marketing, Outros), **produto vinculado** (da planilha orçamentária), **vínculo opcional a um evento do Módulo III**, observações e **data da captura**. Aceita PDF/JPG/PNG/GIF/WEBP/MP4 até 50 MB, múltiplos arquivos.
- **Validação**: cada evidência (inclusive as enviadas pelo fornecedor no Portal e pelo Módulo III) tem três decisões: **Aprovar**, **Solicitar Complemento** (com justificativa) e **Reprovar** (com motivo). Clique na evidência para conferir em tela cheia.
- Evidências aprovadas contam para o checklist da Prestação de Contas e entram nos relatórios do Módulo III.

### 5.8 Solicitantes

Vincula fornecedores já cadastrados a projetos do M2: selecione projeto + solicitante → **Vincular**. A lista de ativos permite **Remover Vínculo**. (O cadastro do fornecedor em si é feito pelo Portal do Solicitante, no Módulo I.)

### 5.9 Prestação de Contas

Encerramento do projeto: checklist automático + relatório final ao MinC.

**Checklist de Validação** (automático):

| Item | Verificação |
|------|-------------|
| P01 | Todas as despesas enviadas ao SALIC |
| P02 | Sem despesas bloqueadas por conformidade |
| P03 | Conciliação bancária 100% |
| P04 | Nenhuma guia de imposto vencida ou atrasada |
| P05/P07 | Nenhuma evidência física pendente de validação |
| P06 | Ao menos 1 "Relatório de Objeto" **aprovado** |
| P08 | Sem contratos ativos expirados |
| P09 | Nenhuma parcela de contrato vencida ou atrasada |

**Confirmações manuais**: P10 (liberação do projeto para encerramento) e P12 (autorização de acesso a documentos fiscais ao MinC — registra quem confirmou e quando).

- **Gerar Relatório de Prestação de Contas**: só habilita com o checklist 100% verde.
- **Autorizar Envio ao MinC**: depois de gerado. **Atenção:** após autorizar, não é mais possível lançar despesas nem alterar documentos.
- **Histórico de Versões**: versões geradas, com download.

### 5.10 Exportações

Cinco exportações (todas exigem projeto selecionado):

| Exportação | Conteúdo |
|------------|----------|
| **CSV de Despesas** | Gerado no navegador, com filtros de período, status e rubrica |
| **Excel Gerencial** | .xlsx com 6 abas: Resumo, Despesas, Rubricas, Contratos, Impostos, Auditoria |
| **ZIP de Documentos** | Arquivos do projeto por categoria: NFs, contratos, evidências, guias |
| **PDF de Auditoria** | Histórico do projeto + log de auditoria |
| **PDF Consolidado da PC** | Todos os documentos reunidos num único PDF |

A seção **Histórico de Exportações** guarda as gerações anteriores com **Download** e **Tentar novamente** em caso de falha.

### 5.11 Configurações

- **Conexão SALIC (Gov.br)**: usuário/CPF e senha.
- **Integração Banco do Brasil (API)**: Client ID, Client Secret e Developer Application Key — habilita a conciliação bancária automática. (Sem elas, o extrato pode ser enviado manualmente em OFX/CSV/PDF.)

---

## 6. Módulo III — Contrapartidas (Campo)

Menu lateral: **Org. Sociais · Patrocinadores · Eventos · Relatórios · Dashboard · Campo (PWA)**

> **Operador** não vê Org. Sociais e Patrocinadores, não cria/exclui eventos e não vincula OS/PA — mas opera todo o resto (preencher evento, convidados, portaria, evidências, relatórios, PWA).

### 6.1 Eventos (lista)

Todos os eventos do projeto selecionado, em cards com título, status (Rascunho/Ativo/Encerrado/Cancelado), tipo, data e horário, local e a faixa de ingressos ("OS: x | PA: y | Total: z").

- Botões por card: **Editar**, **Detalhes** e **Portaria**.
- **Novo Evento** (cabeçalho): habilitado apenas com projeto selecionado e para gestor/admin.

### 6.2 Formulário de Evento

Tela dedicada para criar (gestor/admin) ou editar/completar (qualquer papel) um evento, em 3 blocos:

- **Dados**: título, tipo, data, horário, status e descrição.
- **Local**: nome do local, endereço, cidade, UF e latitude/longitude (opcionais, mas necessários para a sugestão de OS num raio de 30 km).
- **Ingressos**: total, cota OS e cota PA — o sistema valida em tempo real que OS + PA ≤ total.

Ações: **Salvar** (volta à lista), **Cancelar** e, no modo edição, **Excluir** (gestor/admin; remove também vínculos de OS, PA e convidados).

### 6.3 Detalhe do Evento

Painel do evento com data, local, cotas, e atalhos para **Convidados**, **Portaria**, **Evidências** e **Campo (PWA)**. Três abas:

- **Organizações Sociais / Patrocinadores**: barra de saldo (cota × alocados × saldo), botão **Adicionar OS/PA** (gestor/admin) e cards das entidades vinculadas. Se o evento tem coordenadas, o modal sugere **OS a até 30 km**. Informe os **ingressos a alocar** (limitado ao saldo). O status do convite avança em sequência: *Pendente → Convite Enviado → Confirmado/Recusado → Lista Enviada → Concluído*.
- **Relatório do Evento**: mesmo formulário da tela Relatórios (ver 6.8), com situação (Pendente/Preenchido/Relatório Gerado) e link para baixar o último .docx gerado.

### 6.4 Org. Sociais e Patrocinadores (cadastros)

Cadastros globais (não dependem de projeto). Indisponíveis para o papel operador.

- **OS**: nome, CNPJ, área de atuação, contato, nº de associados, endereço com CEP e **latitude/longitude** (o selo "Geo OK"/"Sem Geo" indica se a OS entra na sugestão de 30 km) e dados do coordenador.
- **PA**: nome, CNPJ, contato, endereço e coordenador.
- Ações em ambos: busca por nome, **Nova OS / Novo PA**, **Editar** e **Excluir** (no modal de edição, com confirmação).

### 6.5 Convidados

Lista de convidados por evento (chega-se pelo botão "Convidados" do detalhe). Abas de OS e PA, com um bloco por organização vinculada mostrando status do convite, ingressos alocados e os convidados cadastrados.

- **+ Convidado**: exige marcar a confirmação **LGPD** antes de liberar o CPF; campos: nome completo (obrigatório), CPF, RG e telefone.
- **Importar Lista**: planilha .xlsx/.xls/.csv (baixe o **Modelo**); mostra prévia com erros por linha e exige a confirmação LGPD da lista.
- **Carta-Convite**: gera o PDF de convite da organização.
- Na listagem, o CPF aparece mascarado e convidados sem consentimento ganham a etiqueta "Sem LGPD".

### 6.6 Portaria (consulta online)

Tela de conferência no dia do evento (`Portaria` no card do evento).

- Busque por **nome completo ou CPF** → o cartão do convidado mostra nome, OS/PA, organização, status do convite e ingressos.
- **Importante**: esta tela é só consulta. O **registro de check-in** (inclusive offline) é feito no app **Campo (PWA)**.

### 6.7 Evidências do Evento

Evidências de execução vinculadas a um evento (chega-se pelo atalho "Evidências" do detalhe).

- **Listas de Presença** (PDF + total de presentes): ao menos uma é obrigatória para encerrar o evento.
- **Evidências para o SALIC**: arquivo (JPG/PNG/PDF), tipo (Foto de execução, Foto de acessibilidade, Material de comunicação, Relatório do Objeto, Outros), produto vinculado, data da captura e descrição. Após o upload, o gestor **aprova na tela Evidências do Módulo II** antes do envio ao SALIC.
- **Encerrar Evento**: botão liberado só com lista de presença registrada; após confirmar, o evento não volta ao status ativo.

### 6.8 Relatórios (de evento)

Preenche e gera o relatório .docx de qualquer evento, no padrão exigido pela patrocinadora. Pré-requisito: projeto selecionado. O campo **Código do contrato** (ex.: IAC_24) fica no cabeçalho e vale para o projeto todo.

1. Clique no card do evento (situação: Pendente / Preenchido / Relatório Gerado).
2. Preencha: horário (texto livre), resumo, quantitativo de atividades, público × meta, perfil do público, ações de acessibilidade, nº de fornecedores, empregos temporários, ações ambientais e desafios.
3. Adicione os **links nomeados** (borderôs/listas de presença, fotos e comprovantes, fotos de acessibilidade, materiais de comunicação). As galerias mostram as evidências já enviadas de cada tipo, com atalho **Adicionar evidências**.
4. **Salvar** → marca como Preenchido. **Gerar Relatório deste Evento** → monta o .docx no navegador, **salva no sistema** e baixa o arquivo.

### 6.9 Dashboard (Contrapartidas)

Visão gerencial do módulo por projeto.

- **KPIs**: Eventos Ativos, Org. Sociais, Patrocinadores, Confirmados, Ocupação OS (%) e Ocupação PA (%).
- Alerta de **evidências aguardando aprovação** com link "Ver no M2".
- **Eventos Recentes** (5 últimos) com atalho para os detalhes.
- **Gerar Relatório do Período** (relatório mensal): escolha o mês → a tela mostra quais eventos do mês estão com relatório preenchido → complete identificação do especialista, custos por evento (com links de planilha), desafios do período, gerenciamento de equipe, métricas de comunicação (seguidores, interações, alcance, matérias, retorno em mídia) e assinatura. **Salvar rascunho** ou **Gerar Relatório Final** (baixa o .docx consolidado do mês, com a seção de cada evento).

### 6.10 Campo (PWA) — app offline

App instalável para a porta do evento, funciona **sem internet**. Abra pelo item **Campo (PWA)** da sidebar (nova aba) e, no celular, use "Adicionar à tela inicial".

**Preparação (com internet, logado):**
1. Toque em **Buscar evento**, digite o nome e toque no resultado.
2. "Evento salvo para uso offline ✓" — evento, vínculos e convidados ficam no aparelho.

**No evento (com ou sem internet):**
1. Abra o evento na lista "Eventos disponíveis offline".
2. **Buscar Convidado** por nome ou CPF (com ou sem pontuação).
3. Toque em **Registrar Check-in** — confirmado localmente mesmo sem sinal.

**Sincronização:** automática ao voltar o sinal. A faixa do topo mostra o estado: 🟢 Online / 🔴 Offline — dados salvos localmente / 🔄 Sincronizando N check-in(s). Sem sessão ativa, os check-ins aguardam o login — nada se perde.

---

## 7. Referência rápida: status de documento

| Status | Cor | Significado | Ação do gestor |
|--------|-----|-------------|----------------|
| Enviado | Cinza | Arquivo recebido, na fila de OCR | Aguardar |
| Em Processamento | Azul | IA lendo e extraindo dados do PDF | Aguardar |
| Em Auditoria IA | Azul | Validando conformidade CNAE vs rubrica | Aguardar |
| Bloqueado | Vermelho | CNAE incompatível com a rubrica | Corrigir rubrica na tela de detalhes |
| Revisão Manual | Amarelo | OCR incerto, dados precisam de revisão humana | Conferir e corrigir dados extraídos |
| Falta Comprovante | Amarelo | Aguardando comprovante de pagamento | Anexar comprovante (opcional) |
| Falta Conciliação | Amarelo | Aguardando conciliação bancária | Subir extrato ou sincronizar BB |
| Em carência (D-3) | Azul | Cumprindo prazo de 72h obrigatório | Aguardar |
| Pronto para envio | Verde | Liberado para envio ao SALIC | Enviar (individual ou em lote) |
| Enviado ao SALIC | Verde | Enviado com protocolo registrado | Ver protocolo |
| Concluído | Verde | Processo finalizado | — |
| Erro no Envio | Vermelho | RPA falhou ao enviar ao SALIC | Clicar em "Tentar Novamente" |

---

## 8. Perguntas frequentes (FAQ)

**Minha NF foi bloqueada por conformidade. O que fazer?**
O CNAE da empresa emissora não é elegível para a rubrica selecionada. Na tela de detalhes, selecione a rubrica correta e clique em "Corrigir Vínculo". Se nenhuma rubrica for compatível, verifique com o MinC se a despesa é elegível.

**Posso pular o comprovante de pagamento?**
Sim, é opcional. Suba o extrato bancário diretamente na etapa de conciliação.

**Quanto tempo leva o D-3?**
Exatamente 72 horas após a conciliação. O sistema controla o prazo e muda o status sozinho para "Pronto para envio".

**O robô SALIC falhou. Perdi os dados?**
Não. O documento fica em "Erro no Envio" com tudo salvo. Clique em "Tentar Novamente".

**O fornecedor não aparece na lista de solicitantes.**
Ele ainda não se cadastrou. Em **Solicitantes** (M1), use **Copiar link de cadastro** e envie a ele.

**Posso usar extratos de outros bancos?**
Sim. A sincronização automática é só com o Banco do Brasil (API). Para os demais, exporte OFX, CSV ou PDF e faça upload manual.

**O botão "Novo Evento" está cinza no Módulo III.**
Ou não há projeto selecionado, ou seu papel é **operador** (apenas gestor/admin criam eventos). O operador pode preencher os dados de um evento já criado pelo gestor.

**Não consigo gerar o relatório de prestação de contas (M2).**
O botão só habilita com o checklist 100% verde. Passe o mouse em cada item vermelho para ver a pendência (despesa não enviada, guia atrasada, evidência pendente etc.).

**O check-in funciona sem internet?**
Sim, pelo app **Campo (PWA)** — desde que o evento tenha sido baixado antes, com internet. Os check-ins ficam salvos no aparelho e sincronizam sozinhos quando o sinal volta.

**Excluí um contrato por engano. Dá para recuperar?**
A exclusão remove o contrato (e seus anexos) de todas as listagens e exportações e não pode ser desfeita pela interface. Contate o suporte.

---

*prestaí · Comprovação Financeira, Prestação de Contas e Contrapartidas*
