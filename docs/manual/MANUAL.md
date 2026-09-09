# Manual do Usuário — prestaí

**Plataforma de prestação de contas para projetos culturais incentivados pela Lei de Incentivo à Cultura**

> Lei Rouanet · Lei nº 8.313/91 · Prestação de Contas Inteligente · Versão 2 · Última atualização: 03/09/2026

---

## Conteúdo

01. [Como funciona o acesso](#01-como-funciona-o-acesso)
02. [Perfis de usuário](#02-perfis-de-usuário)
03. [Módulo 1 — Comprovação Financeira](#03-módulo-1--comprovação-financeira)
04. [Módulo 2 — Prestação de Contas](#04-módulo-2--prestação-de-contas)
05. [Módulo 3 — Contrapartidas](#05-módulo-3--contrapartidas)
06. [Portal do Fornecedor](#06-portal-do-fornecedor)
07. [Configurações da conta](#07-configurações-da-conta)
08. [Perguntas frequentes](#08-perguntas-frequentes)

---

## 01. Como funciona o acesso

Ao entrar na plataforma, você cai no **Seletor de Módulos**, que mostra apenas os módulos contratados pela sua organização. Cada organização vê somente os seus próprios dados.

### Primeiro acesso

Contas novas exigem **troca de senha obrigatória** no primeiro login. Se você entrou na conta errada, use o botão **Sair**, disponível em toda a plataforma, incluindo a tela de troca de senha.

> Você pode alternar entre os módulos a qualquer momento pelo seletor, sem sair e entrar de novo.

---

## 02. Perfis de usuário

| Perfil | O que pode fazer |
|---|---|
| **Admin** | Tudo, incluindo criar, editar e excluir usuários da organização |
| **Gestor** | Acesso completo aos módulos contratados, sem gerenciar usuários |
| **Analista** | Acesso operacional. Não acessa configurações nem exclui registros |
| **Operador** | Apenas o Módulo 3 (campo e portaria), para check-in em eventos |
| **Fornecedor** | Portal externo próprio. Envia apenas as suas notas fiscais |

### 2.1 Gerenciar equipe (Admin)

Na tela **Equipe** você cria usuários — incluindo Gestor e Administrador, além de Analista e Operador —, altera perfis e remove acessos.

Se a pessoa já lançou documentos, contratos ou evidências, a conta **não é apagada** — o sistema oferece **revogar o acesso**, preservando o histórico de auditoria. Contas sem vínculo são excluídas normalmente.

> Não é possível excluir a própria conta, nem remover o último Admin da organização.

---

## 03. Módulo 1 — Comprovação Financeira

Onde as notas fiscais e guias de imposto entram no sistema, são auditadas e seguem até o envio ao SALIC.

### 3.1 Enviando documentos

**Envio individual** — um documento por vez.

**Envio em lote** (recomendado para volume) — sobe vários documentos, você preenche a rubrica de cada um e clica em **Processar**, que envia um por vez para processamento.

**Envio em lote com extrato vinculado** — antes de subir os documentos, você pode anexar **um único extrato bancário** para todo o lote. O vínculo fica salvo: mesmo fechando a página ou voltando depois, o extrato continua vinculado ao reabrir a tela do mesmo projeto, enquanto houver documentos pendentes na fila.

### 3.2 Escolhendo a rubrica

O seletor mostra o **produto** de cada rubrica, além do número e do nome — importante quando duas rubricas têm nomes idênticos e só se diferenciam pelo produto.

### 3.3 Duplicidade de nota fiscal

Depois que os dados da nota são extraídos, o sistema verifica se já existe outra com o **mesmo número e mesmo CNPJ do fornecedor**:

| Situação | Aviso |
|---|---|
| Número, fornecedor e valor idênticos | **Possível duplicata** |
| Número e fornecedor iguais, valor diferente | **Conferir número** — pode ser erro de digitação ou cobranças distintas ligadas à mesma nota |

Nenhum dos dois bloqueia o envio. Compare os documentos lado a lado e use **Marcar como revisado** se estiver tudo certo.

> O aviso pode levar alguns minutos para aparecer, já que roda depois do processamento.

### 3.4 Guia de recolhimento de imposto (DARF/DRAM)

Guias sobem pelo mesmo fluxo de upload das notas. O sistema identifica sozinho que é uma guia e extrai tributo, competência, vencimento e valor recolhido, exibidos no detalhe do documento junto aos demais dados.

**CNPJ do fornecedor:** quando a guia se refere à retenção sobre um fornecedor, o sistema tenta identificar automaticamente esse fornecedor cruzando com as cadastradas no projeto. Quando consegue, o campo já vem preenchido.

> Quando não consegue — falta de informação na guia, ou mais de um fornecedor compatível — o campo aparece vazio com o aviso **"Faltando dados para a comprovação financeira"**, para preenchimento manual.

Esse mesmo aviso aparece em qualquer um dos cinco campos que o sistema considera obrigatórios para o documento (Solicitante/CNPJ, Fornecedor, Valor Total, Data de Emissão e Nr. Comprovante), sempre que algum deles não tiver sido preenchido — não só em guia, em qualquer documento do Módulo 1. Um valor lançado como R$ 0,00 também é tratado como pendente, já que não é um valor fiscal válido.

### 3.5 O caminho de cada documento

`Enviado → Em Processamento → Em Auditoria IA → Falta Conciliação → Em carência (D-3) → Pronto para envio → Enviado ao SALIC → Concluído`

| Status | Significado | Ação |
|---|---|---|
| Enviado | Documento recebido | Aguardar |
| Em Processamento | Extraindo dados (OCR) | Aguardar |
| Aguardando Rubrica | Lote aguardando você escolher a rubrica | Escolher a rubrica |
| Em Auditoria IA | Verificando CNAE × rubrica | Aguardar |
| **Bloqueado** | Divergência entre CNAE e rubrica | Sua ação — ver 3.6 |
| Falta Conciliação | Aguardando extrato bancário | Subir extrato, ou aguardar se veio de lote |
| Em carência (D-3) | Carência antes do envio | Aguardar |
| Pronto para envio | Liberado para o SALIC | Aguardar |
| Enviado ao SALIC | Já consta no portal do governo | Nada |
| Concluído | Processo encerrado | Nada |

> Não é mais necessário anexar comprovante de pagamento separado — o extrato já é suficiente.

### 3.6 Quando aparece "Bloqueado"

A auditoria não encontrou relação entre os CNAEs do fornecedor e a rubrica. Não é necessariamente erro. No detalhe:

- **Trocar a rubrica**, se estava errada
- **Assumir risco e continuar**, se está correta — o CNAE pode permitir o serviço sem a IA identificar a relação

### 3.7 Visualizando o extrato

No detalhe da nota, **Visualizar extrato** abre o arquivo bancário vinculado, com o lançamento conciliado com aquela nota e os demais lançamentos do mesmo extrato.

### 3.8 Envio ao SALIC em lote

A tela **Envio SALIC em Lote** reúne as notas prontas e dispara a automação. Notas com erro no envio voltam automaticamente para essa fila.

---

## 04. Módulo 2 — Prestação de Contas

### 4.1 Dados do Projeto

Tela de importação e revisão dos dados cadastrais do projeto vindos do SALIC. O sistema importa o PDF do projeto e extrai as informações automaticamente, organizadas em quatro abas para revisão:

- Etapas de trabalho
- Locais de realização
- Plano de divulgação
- Dados complementares

Após revisar e corrigir o que for necessário, salve. Os dados revisados são usados nas demais telas do módulo.

> Confirme sempre o projeto selecionado antes de importar.

### 4.2 Rubricas

Importação da planilha orçamentária, com número, nome, etapa, produto e valor aprovado.

> Confirme sempre o projeto selecionado antes de atualizar a planilha — a atualização substitui os dados do projeto escolhido.

### 4.3 Dashboard Financeiro

Visão consolidada da situação financeira do projeto, com seis indicadores no topo:

| Indicador | O que mostra |
|---|---|
| Total Aprovado MinC | Valor total aprovado no projeto |
| Total Executado | Soma das despesas já lançadas |
| Saldo Disponível | Diferença entre aprovado e executado |
| % Execução | Percentual do orçamento já utilizado |
| Impostos Pagos | Total de guias de imposto quitadas |
| Checklist MinC | Situação do checklist de encerramento |

Abaixo, a tela traz a execução por rubrica, as despesas recentes, alertas de rubricas próximas do limite, o acompanhamento dos limites percentuais da **IN23** (captação, divulgação, administração) e atalhos para as demais telas do módulo.

### 4.4 Contratos

Ao anexar o PDF, o sistema extrai número, objeto, valor, vigência e fornecedor — inclusive contratos de locação (Locadora/Locatária) e fornecedor pessoa física.

**Fornecedor:** herdado do contrato principal em anexos; opcional em contratos novos. Se o fornecedor não aparecer na lista, use **+ Cadastrar novo fornecedor** no próprio formulário: informe CNPJ (os dados são buscados automaticamente) ou CPF (preenchimento manual — dados de pessoa física não são públicos).

**Rubrica:** o campo agrupa as opções por produto do projeto, facilitando encontrar a rubrica certa.

**Contratos guarda-chuva:** sem valor definido, podem ter valor zero — o valor real entra nos anexos e soma automaticamente no principal como "Total contratado".

**Anexos:** o campo objeto não é obrigatório em anexos, já que aditivos frequentemente não têm objeto próprio. Cada anexo listado tem botão de edição, para corrigir rubrica ou qualquer outro dado depois de salvo.

**Distrato:** ao registrar um anexo, marque a opção **"É um distrato"** quando for encerramento antecipado. Nesse caso, data fim e valor deixam de ser obrigatórios.

**Filtros:** por razão social, vigência, ano e rubrica.

### 4.5 Impostos

Controle das guias de imposto do projeto.

- **Cadastro manual:** guias podem ser cadastradas diretamente nesta tela, com tipo, competência, vencimento e valor.
- **Guias vindas do Módulo 1:** quando uma guia paga é enviada pelo Módulo 1, ela aparece automaticamente aqui, já marcada como paga, sem precisar cadastrar de novo.
- **Marcar como paga:** ao marcar uma guia cadastrada aqui como paga, ela é enviada automaticamente ao Módulo 1 para seguir o fluxo de envio ao SALIC, sem precisar subir o arquivo novamente.
- **Guia duplicada:** se a mesma guia for enviada pelo Módulo 1 e já existir aqui como não paga, o sistema avisa e oferece atualizar a existente, em vez de criar uma segunda.
- **Excluir guia:** cada guia tem ação de exclusão, com confirmação.

### 4.6 Comprovação Física (Evidências)

Envio de fotos e documentos, por clique ou arrastando para a área de upload. Vários arquivos podem ser enviados de uma vez.

**Classificação obrigatória** — determina a seção do relatório de evento:
- Comprovação de execução
- Comprovação de acessibilidade
- Comprovação de material de comunicação

**Filtros:** status, evento, produto, ano, tipo, com ordenação por data. **Aprovação:** aprovada, reprovada ou complemento solicitado. **Descrição:** cada evidência tem ícone de edição para corrigir a descrição depois de salva.

### 4.7 Prestação de Contas

É onde o projeto é encerrado formalmente. A tela apresenta um checklist de verificação — o relatório final só pode ser gerado quando todos os pontos estiverem atendidos.

**O que o checklist verifica:**

1. Todas as despesas enviadas ao SALIC
2. Nenhuma despesa bloqueada por conformidade
3. Conciliação bancária completa (100%)
4. Nenhuma guia de imposto vencida ou atrasada
5. Nenhuma evidência física pendente de validação
6. Pelo menos um "Relatório de Objeto" anexado e aprovado
7. Nenhum contrato expirado ainda ativo
8. Nenhuma parcela de contrato vencida ou atrasada
9. Saldo remanescente zerado, ou com comprovante de recolhimento ao FNC
10. Limites percentuais da IN23 respeitados

Cada item mostra o que está pendente e leva direto à tela onde a pendência se resolve.

**Gerar o relatório** — com o checklist fechado, o botão de geração fica disponível. O sistema monta o relatório completo em PDF, contendo o orçamento aprovado por rubrica, a relação de despesas, contratos, impostos recolhidos, comprovação física e a declaração de encerramento.

**Fechamento** — após gerar o relatório, é possível marcar a prestação de contas como fechada. A partir daí, o projeto fica travado para novos lançamentos.

> **Importante:** o envio ao MinC é **manual**. O sistema gera o relatório, mas quem sobe o arquivo no portal do SALIC é você. O PrestAí não faz esse envio automaticamente.

### 4.8 Exportações

| Exportação | Conteúdo |
|---|---|
| CSV de despesas | Relação de despesas em planilha simples |
| Excel Gerencial | Planilha com múltiplas abas — despesas, rubricas, contratos, impostos, auditoria |
| ZIP de documentos | Todos os arquivos do projeto compactados |
| PDF de Auditoria | Histórico de alterações — quem alterou o quê e quando |
| PDF Consolidado | Relatório completo da prestação de contas |

---

## 05. Módulo 3 — Contrapartidas

### 5.1 Painel de Contrapartidas

Visão consolidada do módulo: eventos ativos, organizações sociais cadastradas, patrocinadores, taxa de ocupação de OS e de PA, e público geral (ingressos vendidos). A tela também gera o **relatório do período**, selecionando o mês de referência.

### 5.2 Eventos

**Endereço por CEP:** preenche logradouro, bairro, cidade, estado e coordenadas automaticamente (aproximadas — ajustáveis manualmente).

**Tipo de acesso:**
- **Com ingresso** — total de ingressos e divisão entre OS e PA.
- **Entrada livre** — museus, ações sociais, sem contagem prévia. O público é contado pelos check-ins reais.

**Excluir evento:** mostra antes quantos convidados, check-ins e atividades existem. Some das listagens, dado preservado.

### 5.3 Atividades

Um evento pode ter várias, criadas por Admin ou Gestor. Com duas ou mais, o check-in pergunta em qual delas a pessoa entra.

### 5.4 Organizações Sociais (OS) e Pontos de Apoio (PA)

Cadastro de entidades parceiras. O sistema pode sugerir OS próximas por localização.

### 5.5 Convidados

Cadastro individual ou em lote, vinculado a OS, PA, ou público geral.

### 5.6 Portaria e aplicativo de campo (PWA)

Check-in pelo celular, **funciona sem internet** — sincroniza sozinho quando a conexão volta. **Público geral** pode ser registrado na hora, sem cadastro prévio.

> O perfil **Operador** só acessa esta parte da plataforma.

### 5.7 Acompanhando os check-ins

Aba **Check-ins**: card por atividade, **Visão Geral** somando tudo, lista nominal com horário. Em eventos de **entrada livre**, os números vêm direto da contagem real de check-ins.

**Lista de presença:** gera Word com os presentes, por atividade.

### 5.8 Evidências do evento

Mesmo funcionamento do Módulo 2 — mesma base de dados, aparece nos dois lados.

### 5.9 Relatórios

Três seções de imagens: execução, acessibilidade, comunicação. **Preencher com dados reais** monta o quantitativo a partir dos check-ins, editável depois.

---

## 06. Portal do Fornecedor

Acesso próprio, separado da plataforma principal.

**Cadastro:** CNPJ, razão social, visualização dos projetos vinculados, envio de notas fiscais.

**Aprovação obrigatória:** notas de fornecedor ficam em **Aguardando aprovação** até um Gestor ou Admin conferir CNAE, CNPJ, valor e rubrica.

- **Aprovada:** segue o fluxo normal a partir da auditoria.
- **Rejeitada:** definitiva. O fornecedor vê o motivo e envia documento novo — nunca edita o recusado.

---

## 07. Configurações da conta

**Conexão SALIC (Gov.br):** cadastro das credenciais usadas pela automação de envio ao SALIC. Sem elas, o envio automatizado não funciona.

**Trocar Senha:** alteração da própria senha de acesso.

> Só Administrador e Gestor têm acesso a esta tela.

---

## 08. Perguntas frequentes

**Preciso subir comprovante de pagamento junto com a nota?**
Não. O extrato bancário é suficiente.

**Por que uma nota está "Bloqueada"?**
CNAE do fornecedor sem relação com a rubrica escolhida. Troque a rubrica ou use "Assumir risco e continuar". Ver 3.6.

**Aparece aviso de duplicidade em notas certas. É erro?**
Não, é aviso para conferência. "Marcar como revisado" se estiver tudo certo. Ver 3.3.

**Preciso repetir o extrato em cada nota?**
Não — envio em lote com extrato vinculado serve para todas de uma vez. Ver 3.1.

**Fechei a página no meio do lote. Perdi o vínculo do extrato?**
Não, ele é restaurado ao voltar, enquanto houver fila pendente.

**Guia de imposto precisa de tela diferente?**
Não, sobe pelo upload normal. O sistema identifica e tenta achar o fornecedor sozinho.

**Por que aparece "Faltando dados para a comprovação financeira"?**
Um dos cinco campos obrigatórios do documento (CNPJ, Fornecedor, Valor Total, Data de Emissão ou Nr. Comprovante) está vazio — em guia, o mais comum é o CNPJ do fornecedor não ter sido identificado automaticamente. Preencha manualmente. O aviso aparece em qualquer documento do Módulo 1, não só em guia.

**Cadastrei a guia no Módulo 2 e ela também chegou pelo Módulo 1. Vai duplicar?**
Não. O sistema reconhece que é a mesma guia e oferece atualizar a existente. Ver 4.5.

**O fornecedor não aparece na lista ao cadastrar contrato. E agora?**
Use "+ Cadastrar novo fornecedor" no próprio formulário do contrato. Ver 4.4.

**Preciso registrar um distrato. O sistema exige data fim e valor.**
Marque a opção "É um distrato" no anexo — os campos deixam de ser obrigatórios. Ver 4.4.

**Gerei o relatório de prestação de contas. Ele foi enviado ao MinC?**
Não. O envio é manual — baixe o PDF e suba no portal do SALIC. Ver 4.7.

**O aplicativo de campo funciona sem internet?**
Sim, sincroniza sozinho quando a conexão volta.

**Como conto o público de evento sem ingresso?**
Tipo de acesso Entrada livre — conta pelos check-ins reais. Ver 5.2.

**Excluí um evento por engano. Perdi os dados?**
Não, só sai das listagens. Fale com o suporte para restaurar.

*Dúvidas não cobertas aqui: entre em contato com o suporte.*

---

*prestaí · Manual do Usuário · Prestação de Contas Inteligente*
