// Catálogo de status do Prestaí para o painel de suporte (SPEC-SUPORTE-03).
// Importado pelo server.js (require) e servido como estático ao suporte.html
// (script comum): por isso o módulo se expõe nos dois ambientes.
//
// Grupos: em_andamento, esperando_cliente, travado, erro, finalizado.
// "travado" nunca é gravado aqui: é calculado por grupoEfetivo() quando um
// status em_andamento passa do prazo_minutos.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.StatusCatalogo = api;
})(typeof self !== 'undefined' ? self : this, function () {

    const item = (rotulo, grupo, prazo_minutos, explicacao, proximo_passo) =>
        ({ rotulo, grupo, prazo_minutos, explicacao, proximo_passo });

    const SEM_GRAVADOR = 'Status sem gravador conhecido; não deveria existir.';
    const AVISAR_DEV = 'Tratar como travado e avisar o desenvolvimento.';

    const CATALOGO = {
        documents: {
            processing_ocr: item('Em Processamento', 'em_andamento', 5,
                'O n8n está lendo o arquivo.',
                'Aguardar; passando de 5 min o cron move para Revisão Manual.'),
            revisao_manual: item('Revisão Manual', 'erro', null,
                'O OCR não terminou em 5 min ou falhou 3 vezes.',
                'Reprocessar OCR; ou Avançar documento a pedido do cliente.'),
            aguardando_conformidade: item('Em Auditoria IA', 'em_andamento', 5,
                'O n8n confere o CNAE do fornecedor contra a rubrica; leva menos de 1 min.',
                'Passou de 5 min: Revalidar conformidade.'),
            bloqueado_conformidade: item('Bloqueado', 'esperando_cliente', null,
                'Rubrica ausente, fora do projeto ou CNAE incompatível (o motivo está em just_erro).',
                'O cliente troca a rubrica; ou Avançar documento a pedido dele.'),
            aguardando_conciliacao_bancaria: item('Falta Conciliação', 'esperando_cliente', null,
                'Falta o extrato com o lançamento deste pagamento.',
                'Se já existe extrato do lote: Refazer conciliação.'),
            aguardando_comprovante: item('Falta Comprovante', 'em_andamento', 5,
                'Um trigger converte este status na hora em Falta Conciliação; não deveria permanecer.',
                'Se permanecer, tratar como travado e avisar o desenvolvimento.'),
            divergencia_valor: item('Divergência de Valor', 'esperando_cliente', null,
                'O valor da nota difere do lançamento no extrato.',
                'Refazer conciliação; ou Avançar documento a pedido do cliente.'),
            divergencia_beneficiario: item('Divergência de Beneficiário', 'esperando_cliente', null,
                'Não foi encontrado lançamento para este fornecedor.',
                'Refazer conciliação; ou Avançar documento a pedido do cliente.'),
            aguardando_d3: item('Em carência (D-3)', 'em_andamento', 5760,
                'Conciliado; aguarda 72 h da data da transação.',
                'Nenhuma.'),
            liberado_rpa_airtop: item('Pronto para envio', 'esperando_cliente', null,
                'Pode ir ao SALIC; o gestor precisa clicar em Enviar (usa a credencial gov.br dele).',
                'Avisar o cliente. O suporte não envia.'),
            erro_rpa: item('Erro no Envio', 'erro', null,
                'O robô falhou ao lançar no SALIC.',
                'Ver a mensagem; o cliente usa Tentar novamente. O suporte não reenvia.'),
            enviado_salic: item('Enviado ao SALIC', 'finalizado', null,
                'Lançado no SALIC.',
                'Nenhuma.'),
            aguardando_rubrica: item('Aguardando Rubrica', 'esperando_cliente', null,
                'Veio do upload em lote; o cliente escolhe a rubrica antes do OCR.',
                'Avisar o cliente.'),
            aguardando_aprovacao_fornecedor: item('Aguardando aprovação', 'esperando_cliente', null,
                'Nota enviada pelo fornecedor; o gestor aprova ou rejeita.',
                'Avisar o cliente.'),
            rejeitado_fornecedor: item('Rejeitada', 'finalizado', null,
                'O gestor rejeitou; nunca sai deste status.',
                'Nenhuma.'),
            concluido: item('Concluído', 'finalizado', null,
                'Planilha orçamentária importada.',
                'Nenhuma.'),
            erro: item('Erro', 'erro', null,
                'Planilha orçamentária: a importação falhou (o motivo está em just_erro).',
                'Reimportar planilha, só a mais recente do projeto.'),
            uploaded: item('Enviado', 'em_andamento', 5, SEM_GRAVADOR, AVISAR_DEV),
            validating: item('Validando', 'em_andamento', 5, SEM_GRAVADOR, AVISAR_DEV),
            validated: item('Validado', 'em_andamento', 5, SEM_GRAVADOR, AVISAR_DEV)
        },
        extratos: {
            pendente: item('Pendente', 'em_andamento', 30,
                'O n8n está lendo o extrato e criando os lançamentos.',
                'Passou de 30 min: Reprocessar extrato.'),
            processado: item('Processado', 'finalizado', null,
                'Extrato lido e lançamentos criados.', 'Nenhuma.'),
            erro: item('Erro', 'erro', null,
                'A leitura do extrato falhou.', 'Reprocessar extrato.')
        },
        exportacoes_log: {
            gerando: item('Gerando', 'em_andamento', 60,
                'O arquivo da exportação está sendo gerado.',
                'Passou de 60 min: Encerrar exportação.'),
            pronto: item('Pronto', 'finalizado', null,
                'Exportação concluída.', 'Nenhuma.'),
            erro: item('Erro', 'erro', null,
                'A exportação falhou.', 'O cliente pode gerar de novo.')
        },
        saldo_salic_capturas: {
            executando: item('Executando', 'em_andamento', 30,
                'O robô está lendo o relatório de execução do SALIC.',
                'Passou de 30 min: verificar a saúde do worker.'),
            sucesso: item('Sucesso', 'finalizado', null,
                'Captura concluída.', 'Nenhuma.'),
            erro: item('Erro', 'erro', null,
                'A captura do saldo falhou (o motivo está em erro_mensagem).',
                'O cliente atualiza o saldo de novo (usa a credencial dele).')
        },
        physical_evidences: {
            pendente: item('Pendente', 'esperando_cliente', null,
                'Evidência enviada, aguardando validação do gestor.', 'Avisar o cliente.'),
            pendente_complemento: item('Pendente de complemento', 'esperando_cliente', null,
                'O gestor pediu complemento da evidência.', 'Avisar o cliente.'),
            aprovada: item('Aprovada', 'finalizado', null,
                'Evidência aprovada.', 'Nenhuma.'),
            reprovada: item('Reprovada', 'finalizado', null,
                'Evidência reprovada (o motivo está em motivo_reprovacao).', 'Nenhuma.'),
            enviada_salic: item('Enviada ao SALIC', 'finalizado', null,
                'Evidência enviada ao SALIC.', 'Nenhuma.'),
            erro_rpa: item('Erro no Envio', 'erro', null,
                'O robô falhou ao enviar a evidência ao SALIC.',
                'O cliente tenta novamente. O suporte não reenvia.')
        },
        project_salic_imports: {
            pendente: item('Pendente', 'em_andamento', 30,
                'A importação do projeto SALIC vai começar.',
                'Passou de 30 min: Reimportar projeto SALIC.'),
            processando: item('Processando', 'em_andamento', 30,
                'O servidor está lendo o PDF do projeto.',
                'Passou de 30 min: Reimportar projeto SALIC.'),
            processado: item('Processado', 'finalizado', null,
                'PDF lido e dados do projeto gravados.', 'Nenhuma.'),
            erro: item('Erro', 'erro', null,
                'A importação do PDF falhou (o motivo está em erro_mensagem).',
                'Reimportar projeto SALIC.')
        }
    };

    // Tolerante a status fora do catálogo (substituido, revisado etc.): vira
    // item neutro em vez de quebrar a fila.
    function obter(entidade, status) {
        const e = CATALOGO[entidade];
        return (e && e[status]) || null;
    }

    function minutosDesde(desdeISO, agora) {
        if (!desdeISO) return null;
        const t = new Date(desdeISO).getTime();
        if (Number.isNaN(t)) return null;
        return ((agora == null ? Date.now() : agora) - t) / 60000;
    }

    // travado = em_andamento que passou do prazo. Sem data de início (null)
    // não dá para afirmar nada: mantém em_andamento.
    function grupoEfetivo(entidade, status, desdeISO, agora) {
        const it = obter(entidade, status);
        if (!it) return 'desconhecido';
        if (it.grupo === 'em_andamento' && it.prazo_minutos != null) {
            const min = minutosDesde(desdeISO, agora);
            if (min != null && min > it.prazo_minutos) return 'travado';
        }
        return it.grupo;
    }

    return { CATALOGO, obter, grupoEfetivo, minutosDesde };
});
