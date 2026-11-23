// Prévia do que o robô grava no SALIC (ocorrência #195): lógica pura, sem DOM, sem banco e sem
// rede, para testar em isolamento (ver teste-previa-salic.js). Carregado como script comum no
// index.html e por require() nos testes.
//
// As regras são CÓPIA das do robô (branch api, cultops-rpa-worker):
//   - server.js: camposFaltando, resolverDataPagamento, calcularValorEnvio, formatarNrDocPagamento
//     e a montagem de config.documento (numero, recibo, numero_guia, justificativa).
//   - salic_insertion.cjs: tipo do documento (#tpDocumento), #nrComprovante, forma de pagamento
//     fixa em Transferência Bancária, fallback do #nrDocumentoDePagamento.
// Mudou a regra no robô? Mude aqui também e rode teste-previa-salic.js. A prévia é só leitura:
// a confirmação exata (rubrica achada na tela do SALIC, campos preenchidos) é a simulação
// (POST /api/salic/dry-run no worker), que preenche tudo e não salva.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.PreviaSalic = api;
})(typeof self !== 'undefined' ? self : this, function () {
    // tpDocumento no SALIC: 2 = Guia de Recolhimento, 3 = Nota Fiscal/Fatura, 4 = Recibo de Pagamento.
    function tipoDocumento(doc) {
        const numeroGuia = doc && doc.json_extraido && doc.json_extraido.guia && doc.json_extraido.guia.numero_guia;
        const isGuia = !!(numeroGuia && String(numeroGuia).trim());
        const isRecibo = String((doc && doc.recibo) || '').trim().toLowerCase() === 'yes';
        if (isGuia) return { codigo: '2', rotulo: 'Guia de Recolhimento', numeroGuia: String(numeroGuia) };
        if (isRecibo) return { codigo: '4', rotulo: 'Recibo de Pagamento' };
        return { codigo: '3', rotulo: 'Nota Fiscal/Fatura' };
    }

    function numeroComprovante(doc) {
        const tipo = tipoDocumento(doc);
        if (tipo.codigo === '2') return tipo.numeroGuia;
        return String((doc && doc.numero_nf) || 'S/N');
    }

    function camposFaltando(doc) {
        return [
            !doc.cnpj_emissor && 'CNPJ/CPF',
            !doc.nome_emissor && 'Fornecedor',
            (!doc.valor || Number(doc.valor) === 0) && 'Valor',
            !doc.data_emissao && 'Data de Emissão',
            !doc.numero_nf && 'Nr. Comprovante',
        ].filter(Boolean);
    }

    // TED do BB (13+ dígitos): conta destino = últimos 6 dígitos; demais: zero-pad para 10.
    function formatarNrDocPagamento(docExtrato) {
        if (!docExtrato) return '';
        const limpo = String(docExtrato).replace(/\D/g, '');
        if (limpo.length >= 13) return limpo.slice(-6).padStart(10, '0');
        return limpo.padStart(10, '0');
    }

    function resolverDataPagamento(lancamento, doc) {
        if (lancamento && lancamento.data_lancamento) return { data: lancamento.data_lancamento, origem: 'lancamento' };
        if (doc.data_pagamento) return { data: doc.data_pagamento, origem: 'informada' };
        return { erro: 'DATA_PAGAMENTO_SEM_LANCAMENTO', mensagem: 'Sem lançamento bancário conciliado e sem data de pagamento informada.' };
    }

    // Ocorrência #120: o SALIC recebe o valor PAGO, não o da nota.
    function calcularValorEnvio(doc, lancamentosDoDoc, lancamentosMesmoFitid) {
        const centavos = (v) => Math.round(Number(v) * 100);
        const chave = (l) => `${l.fitid}|${centavos(l.valor)}|${l.data_lancamento}`;
        let valor;
        let origem;
        if (doc.valor_pago !== null && doc.valor_pago !== undefined) {
            valor = Number(doc.valor_pago);
            origem = 'valor_pago';
        } else {
            const distintos = new Set((lancamentosDoDoc || []).map(chave));
            if (distintos.size === 0) {
                return { erro: 'VALOR_PAGO_INDETERMINADO', mensagem: 'Sem valor pago informado e sem lançamento conciliado com a nota.' };
            }
            if (distintos.size > 1) {
                return { erro: 'VALOR_PAGO_INDETERMINADO', mensagem: `${distintos.size} lançamentos diferentes conciliados com a nota; informe o valor pago.` };
            }
            const lancamento = lancamentosDoDoc[0];
            const documentos = new Set((lancamentosMesmoFitid || []).filter(l => l.document_id).map(l => l.document_id));
            documentos.add(doc.id);
            if (documentos.size > 1) {
                return { erro: 'LANCAMENTO_DIVIDIDO', mensagem: `O lançamento ${lancamento.fitid} está conciliado com ${documentos.size} documentos; informe o valor pago.` };
            }
            valor = Math.abs(Number(lancamento.valor));
            origem = 'lancamento';
        }
        if (!Number.isFinite(valor) || valor <= 0) {
            return { erro: 'VALOR_PAGO_INDETERMINADO', mensagem: 'Valor pago inválido.' };
        }
        if (valor > Number(doc.valor) + 0.01) {
            return { erro: 'VALOR_MAIOR_QUE_NOTA', mensagem: `Valor pago (R$ ${valor.toFixed(2)}) maior que o valor da nota (R$ ${Number(doc.valor).toFixed(2)}).` };
        }
        return { valor, origem };
    }

    // dados: { doc, rubrica: {nome, produto, etapa} | null, lancamentos (conciliados com a nota,
    // mais recente primeiro), lancamentosMesmoFitid, documentoReferenciaExtrato (fallback do fitid) }
    // Devolve { campos: [{ campo, rotulo, valor, origem? }], pendencias: [{ codigo, mensagem }] }.
    // Campo com problema vem com valor null e a pendência explica.
    function montar(dados) {
        const doc = dados.doc || {};
        const pendencias = [];
        const campos = [];
        const add = (campo, rotulo, valor, origem) => campos.push({ campo, rotulo, valor: valor === undefined ? null : valor, origem: origem || null });

        const faltando = camposFaltando(doc);
        if (faltando.length) pendencias.push({ codigo: 'DADOS_OBRIGATORIOS_FALTANDO', mensagem: `Faltam dados obrigatórios: ${faltando.join(', ')}.` });

        if (!doc.rubrica_id_fk) {
            pendencias.push({ codigo: 'RUBRICA_NAO_VINCULADA', mensagem: 'A nota não está ligada a uma rubrica do projeto.' });
            add('rubrica', 'Rubrica', null);
        } else if (!dados.rubrica) {
            pendencias.push({ codigo: 'RUBRICA_INEXISTENTE', mensagem: 'A rubrica ligada à nota não existe mais no projeto.' });
            add('rubrica', 'Rubrica', null);
        } else {
            add('rubrica', 'Rubrica', dados.rubrica.nome);
            add('produto', 'Produto', dados.rubrica.produto || '(sem produto)');
            add('etapa', 'Etapa', dados.rubrica.etapa || null);
        }

        add('cnpj', 'CNPJ/CPF do fornecedor', doc.cnpj_emissor || null);
        add('fornecedor', 'Fornecedor', doc.nome_emissor || null);
        const tipo = tipoDocumento(doc);
        add('tipo', 'Tipo de documento', `${tipo.rotulo} (código ${tipo.codigo})`);
        add('data_emissao', 'Data de emissão', doc.data_emissao || null);
        add('numero', 'Nº do comprovante', numeroComprovante(doc), tipo.codigo === '2' ? 'número da guia' : null);
        add('forma_pagamento', 'Forma de pagamento', 'Transferência Bancária');

        const lancamentos = dados.lancamentos || [];
        const data = resolverDataPagamento(lancamentos[0], doc);
        if (data.erro) {
            pendencias.push({ codigo: data.erro, mensagem: data.mensagem });
            add('data_pagamento', 'Data do pagamento', null);
        } else {
            add('data_pagamento', 'Data do pagamento', data.data, data.origem === 'lancamento' ? 'do lançamento conciliado' : 'informada no pagamento manual');
        }

        const fitid = (doc.fitid && String(doc.fitid).trim()) || dados.documentoReferenciaExtrato || null;
        if (fitid) {
            add('nr_doc_pagamento', 'Nº do documento de pagamento', formatarNrDocPagamento(fitid), 'do extrato');
        } else {
            const dig = String(doc.numero_nf || '').replace(/\D/g, '');
            add('nr_doc_pagamento', 'Nº do documento de pagamento', (dig.length >= 13 ? dig.slice(-6) : dig).padStart(10, '0'), 'sem extrato: usa o número da nota');
        }

        const v = calcularValorEnvio(doc, lancamentos, dados.lancamentosMesmoFitid || []);
        if (v.erro) {
            pendencias.push({ codigo: v.erro, mensagem: v.mensagem });
            add('valor', 'Valor comprovado', null);
        } else {
            add('valor', 'Valor comprovado', v.valor, v.origem === 'valor_pago' ? 'valor pago informado' : 'valor do lançamento conciliado');
        }

        const just = (doc.justificativa_salic || '').toString().trim();
        if (just) add('justificativa', 'Justificativa (rubrica excedida)', just);
        add('arquivo', 'Arquivo anexado', doc.name || 'PDF da nota');

        return { campos, pendencias };
    }

    return { tipoDocumento, numeroComprovante, camposFaltando, formatarNrDocPagamento, resolverDataPagamento, calcularValorEnvio, montar };
});
