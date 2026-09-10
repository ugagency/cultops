# Plano de Testes e Homologação (QA) - Prestaí

## 1. Escopo de Validação
O QA deste projeto deve validar três frentes totalmente distintas mas interligadas:
1. **Interface do Usuário (UI/UX) - Gestor e Fornecedor**
2. **Back-end e Banco de Dados (Supabase RLS & Fluxos)**
3. **Automação (RPA - Robô de Integração SALIC/n8n)**

---

## 2. Casos de Teste (Test Cases) Principais

### ÉPICO 1: Autenticação e Multilocação (Multi-Tenant)
- **QA-1.1:** Tentar acessar as páginas de dashboard sem estar autenticado. (Espera-se redirecionamento p/ Login).
- **QA-1.2:** Login com credenciais válidas e inválidas (Proponente vs Fornecedor).
- **QA-1.3:** Teste Muro-RLS do Supabase: Com o Token do *Usuário A*, chame um endpoint do Supabase buscando os projetos do *Usuário B*. O banco deve retornar vazio (Array com 0 items) e nenhum dado cruzado.

### ÉPICO 2: Gestão de Projetos e Portal Público
- **QA-2.1:** Inserir um PRONAC válido no Dashboard do Gerente (ex: 230561). Validar se o disparo webhook ou API consome do Portal Transparência/Salic corretamente e exibe sucesso.
- **QA-2.2:** Testar inserção de PRONAC Inexistente ou string alfanumérica. Validar tratamento de erro nativo.
- **QA-2.3:** Na visão Fornecedor (`fornecedor_login`), conseguir selecionar o PRONAC e realizar upload de PDF. Confirmar se o documento cai no painel do usuário Gestor imediatamente (ou mediante F5).

### ÉPICO 3: Workflow da Nota Fiscal (Despesa e OCR)
- **QA-3.1:** Fazer upload de PDF que **seja** uma Nota Fiscal válida. O sistema deve alterar o status de `uploaded` para `processing_ocr`.
- **QA-3.2:** Validação Inteligente: O OCR (conectado no n8n) deve devolver para o sistema se a nota tem um CNAE compatível com a rubrica.
- **QA-3.3 (Falha Induzida):** Fazer upload de PDF que **não seja** nota fiscal. Validar se o documento cai em status `revisao_manual` ou `bloqueado_conformidade`.

### ÉPICO 4: Conciliação e Regra de Transição
Este teste é sensível, pois impacta diretamente a submissão governamental:
- **QA-4.1:** Simular inserção de Extrato. Fazer match do valor/data da Nota Fiscal com as do extrato. O documento transiciona para status `aguardando_d3`.
- **QA-4.2 (Disparo Cron/D-3):** O cron job/n8n checa notas no status aguardando_d3. Se já passaram as 72 horas exigidas legalmente, o sistema precisa avançá-las a `liberado_rpa_airtop`.

### ÉPICO 5: Automação RPA SALIC (`salic_insertion.cjs`)
A homologação deste componente demanda controle isolado.
- **QA-5.1:** Teste Dry-Run. Rodar o robô localmente usando `node salic_insertion.cjs` em conta de sandbox ou monitorada.
  - Verifica passagem da tela de login.
  - Verifica o botão de busca.
  - Verifica navegação para os modais/iframes `Comprovação Financeira`.
  - Verifica sucesso base de detecção do modal sem quebrar (Timeout Validation).
- **QA-5.2:** Tratativa de indisponibilidade oficial: Se o portal oficial `salic.cultura.gov.br` cair ou estiver lento, o Robô não pode travar em loop; ele deve estourar Timeout, lançar erro no console, logar no DB o status `erro_rpa` no documento específico para retentativa humana / batch posterior.

---

## 3. Checklist de Ambiente para Aprovação de QA

- [ ] Todas as tabelas no Supabase (`projects`, `rubricas`, `documents`, `fornecedores`) estão ativas e com RLS Policies para `SELECT`, `INSERT`, `UPDATE` estritas ao UUID do Usuário Autenticado.
- [ ] O Robô do Puppeteer (`salic_insertion.cjs`) não expõe senhas no Console ou em prints gerados na falha.
- [ ] As URLs amigáveis internas da SPA JavaScript mantêm as views consistentes ao sofrer *refresh* (reload na página).
- [ ] O Bucket (armazenamento do Supabase) possui limite de tamanho ou regra de mime_types fixados só para PDF (`application/pdf`) na UI HTML quanto no DB para evitar invasões.
- [ ] O Toast de Mensagens e Validações aparece limpo e na linguagem PT-BR, conforme os tratamentos de `window.alert` no `app.js`.

---

## 4. Notas finais e Boas Práticas
- Utilize um usuário de teste fixo para a rotina E2E.
- O n8n deverá rodar num subdomínio de staging independente durante os testes para evitar gravação em produção.
- Use mocks nos retornos do SALIC quando o portal sair do ar para não bloquear a equipe do frontend de validar lógicas de erro.
