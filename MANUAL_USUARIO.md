# Manual do Usuário — Prestaí

Bem-vindo ao **Prestaí**, o sistema de comprovação financeira para projetos da **Lei Rouanet**. Este manual explica, passo a passo, como utilizar a plataforma no dia a dia.

> O Prestaí tem duas áreas distintas:
> - **Painel do Gestor (Proponente):** quem administra o projeto incentivado.
> - **Portal do Solicitante (Fornecedor):** quem fornece notas/comprovantes ao projeto.

Cada perfil tem um login próprio. Use o link correto na tela de acesso.

---

## 1. Primeiros passos

### 1.1. Criar conta e entrar
1. Acesse a URL do Prestaí.
2. Na tela de login, escolha:
   - **"Sou Gestor"** se você administra um projeto.
   - **"Sou Solicitante"** se você é fornecedor de um projeto.
3. Clique em **Cadastre-se** se for o primeiro acesso, ou informe e-mail e senha para entrar.
4. Esqueceu a senha? Use **"Recuperar senha"** na tela de login. Você receberá um e-mail com o link de redefinição.

### 1.2. Navegação principal (Gestor)
A barra lateral à esquerda dá acesso a tudo:

| Item | Para que serve |
|---|---|
| **Dashboard** | Visão geral: status do(s) projeto(s), saldo de rubricas, alertas |
| **Projetos** | Lista de projetos importados via PRONAC |
| **Documentos** | Upload e acompanhamento de NFs e comprovantes |
| **Rubricas** | Orçamento aprovado vs. consumido por rubrica |
| **Relatórios** | Exportações financeiras |
| **Solicitantes** | Cadastro de fornecedores e geração de links de acesso |
| **Configurações** | Dados da conta, credenciais SALIC, preferências |

---

## 2. Fluxo do Gestor

### 2.1. Importar um projeto pelo PRONAC
1. Acesse **Projetos → Novo projeto**.
2. Digite o número **PRONAC** (ex.: `230561`).
3. Clique em **Importar**. O sistema busca os dados oficiais no SALIC e cria o projeto e suas rubricas no Prestaí.
4. Confira o nome do projeto, o proponente e a lista de rubricas importadas.

> Se o PRONAC não existir ou o SALIC estiver fora do ar, você verá uma mensagem clara — basta tentar novamente mais tarde.

### 2.2. Acompanhar rubricas (orçamento)
Em **Rubricas** você vê, para cada item do orçamento:
- **Aprovado:** valor autorizado pelo MinC.
- **Consumido:** soma das despesas já lançadas no Prestaí.
- **Saldo:** quanto ainda pode ser gasto.
- **Barra de progresso** colorida (verde/amarelo/vermelho).

Use esta tela como termômetro do projeto antes de aprovar novas notas.

### 2.3. Subir uma Nota Fiscal
1. Vá em **Documentos → Nova nota**.
2. Selecione o **projeto** e a **rubrica** correspondente.
3. Anexe o **PDF da NF**. Apenas PDFs são aceitos.
4. Clique em **Enviar**.

O Prestaí faz **OCR automático** da nota (via n8n) e preenche valor, CNPJ do emissor, datas e demais campos. O documento entra no pipeline com status `processing_ocr`.

### 2.4. Acompanhar o pipeline da despesa
Cada documento percorre, em ordem, os seguintes estados:

1. `uploaded` → recebido.
2. `processing_ocr` → IA lendo a nota.
3. `aguardando_conformidade` → checagem de CNAE/rubrica.
4. `aguardando_comprovante` → falta o comprovante de pagamento (boleto/transferência).
5. `aguardando_conciliacao_bancaria` → falta bater com o extrato bancário.
6. `aguardando_d3` → carência legal de 72h após o pagamento.
7. `liberado_rpa_airtop` → liberado para o robô lançar no SALIC.
8. `enviado_salic` → robô enviou a comprovação.
9. `concluido` → SALIC confirmou.

**Estados de exceção** (exigem sua atenção):
- `bloqueado_conformidade` — rubrica não cadastrada, CNAE incompatível ou divergência fiscal.
- `revisao_manual` — o OCR não conseguiu interpretar o PDF.
- `erro_rpa` — o robô falhou ao enviar para o SALIC. Veja o motivo e libere para nova tentativa.

> **Dica:** clique no documento para ver os detalhes, o motivo do bloqueio e os botões de ação (corrigir rubrica, reenviar, justificar etc.).

### 2.5. Conciliação bancária
1. Acesse **Documentos → Conciliação** (ou **Conciliação** na sidebar quando disponível).
2. Faça **upload do extrato** (OFX ou CSV) do banco do projeto.
3. O sistema lista as transações e tenta cruzar automaticamente com as despesas pendentes (por valor e data).
4. Os matches sugeridos aparecem destacados em **verde**. Confirme em lote ou ajuste manualmente.
5. Após a conciliação, o documento avança para `aguardando_d3` e segue o fluxo até o SALIC.

### 2.6. Resolvendo bloqueios de conformidade
Quando uma nota cai em `bloqueado_conformidade`, abra o documento e leia a justificativa (`just_erro`). As causas mais comuns são:

| Mensagem | O que fazer |
|---|---|
| "Rubrica não informada" | Edite o documento e selecione a rubrica correta |
| "Rubrica X não está cadastrada no projeto" | Confira o orçamento aprovado; selecione uma rubrica equivalente |
| "CNAE incompatível com a rubrica" | Verifique se o fornecedor presta o serviço daquela rubrica |
| "Divergência de valor com o comprovante" | Ajuste manualmente após conferir NF e comprovante |

Após corrigir, salve. O documento volta para o fluxo normal e a despesa correspondente é criada/atualizada automaticamente.

### 2.7. Cadastrar solicitantes (fornecedores)
1. Vá em **Solicitantes → Novo solicitante**.
2. Informe nome, CNPJ e e-mail do fornecedor.
3. Vincule ao(s) projeto(s) em que ele atuará.
4. Clique em **Gerar link de acesso**. O Prestaí cria um token único.
5. Envie o link ao fornecedor — ele cadastra senha no primeiro acesso.

### 2.8. Configurações e SALIC
Em **Configurações** o gestor cadastra:
- **Credenciais SALIC** (CPF/senha de acesso ao portal do MinC) — usadas pelo robô RPA.
- **Dados da empresa proponente.**
- **Preferências de notificação.**

> As senhas do SALIC ficam **criptografadas** no banco. Apenas o robô as decifra na hora de logar. O Prestaí **nunca** exibe a senha em texto na tela depois de salva.

---

## 3. Fluxo do Solicitante (Fornecedor)

### 3.1. Primeiro acesso
1. Abra o link enviado pelo gestor (com token).
2. Cadastre uma senha.
3. Você cai direto no **Portal do Solicitante**.

### 3.2. Enviar uma NF ou comprovante
1. Selecione o **projeto** ao qual a nota se refere.
2. Selecione a **rubrica** (categoria orçamentária).
3. Arraste o **PDF** para a área de upload (drag & drop) ou clique para escolher o arquivo.
4. Clique em **Enviar**.

A nota cai imediatamente no painel do gestor, que será notificado para validar.

### 3.3. Acompanhar status
No painel do solicitante você vê todas as notas que enviou e o status de cada uma:
- **Em análise** → o gestor / OCR está processando.
- **Aprovada** → seguiu para o SALIC.
- **Pendente de correção** → o gestor pediu ajuste; clique para ver o motivo e reenviar.

---

## 4. Boas práticas

- **PDF legível:** envie sempre o PDF original da NF, não foto/scan tortos. O OCR depende disso.
- **Uma rubrica por NF:** se a nota cobre serviços de rubricas diferentes, divida por comprovante.
- **Pagamento ANTES de subir:** o sistema só libera para o SALIC após **72h** do pagamento (Regra D-3). Subir só com a NF, sem comprovante, atrasa o ciclo.
- **Confira o saldo da rubrica:** se a rubrica está estourando, ajuste o orçamento antes de aprovar mais despesas.
- **Reveja os bloqueios diariamente:** abrir os itens em `bloqueado_conformidade` ou `erro_rpa` é o que evita acúmulo no fim do projeto.

---

## 5. Solução de problemas

| Sintoma | Provável causa | Como resolver |
|---|---|---|
| "PRONAC não encontrado" | Número errado, projeto não publicado | Confira no SALIC oficial |
| Documento parado em `processing_ocr` | OCR/n8n com fila | Aguarde alguns minutos; se persistir, contate o suporte |
| `erro_rpa` recorrente | SALIC fora do ar ou senha trocada | Atualize a senha em Configurações e libere o documento para nova tentativa |
| Não vejo projetos de outro usuário | Comportamento esperado (RLS) | Cada conta só enxerga os próprios projetos |
| Upload recusado | Arquivo não é PDF ou está acima do limite | Converta para PDF e tente novamente |

---

## 6. Suporte

Em caso de dúvidas ou erros não previstos:
- **E-mail:** suporte@prestai (ajuste no projeto)
- Inclua **PRONAC**, **ID do documento** e um **print da tela** ao reportar.