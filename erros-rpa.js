// Erros do robô SALIC (documents.just_erro com status erro_rpa): lógica pura, sem DOM, sem banco
// e sem rede, para testar em isolamento (ver teste-erros-rpa.js). O app.js usa daqui.
// Carregado como script comum no index.html e por require() nos testes.
//
// O worker grava o motivo em just_erro no formato "[CODIGO] texto". Só os códigos de MAPA são
// conhecidos. Sem prefixo, com código fora do mapa ou com marcadores que não são erro do robô
// (como [OVERRIDE], do "Forçar avanço"), o texto vai cru para a tela e o reenvio direto não é
// oferecido: sem saber a causa, reenviar só repete a falha.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.ErrosRpa = api;
})(typeof self !== 'undefined' ? self : this, function () {
    // acao.tipo: vincular_rubrica | informar_pagamento | configuracoes | null.
    // Sem rotulo, a acao é só orientação em texto (não há tela para onde levar o usuário).
    // confirmarAntesDeReenviar: texto de um aviso mostrado antes do reenvio.
    const MAPA = {
        RUBRICA_NAO_VINCULADA: {
            titulo: 'Rubrica não vinculada',
            explicacao: 'Esta nota ainda não está ligada a uma rubrica do projeto, e o robô precisa dela para lançar a nota no SALIC.',
            acao: { tipo: 'vincular_rubrica', rotulo: 'Corrigir rubrica', orientacao: 'Escolha a rubrica correta no campo "Rubrica Orçamentária" desta tela. Ao corrigir, a nota volta para a fila de conferência e conciliação e pode esperar o D-3 de novo antes de ser liberada para o envio.' },
            permiteReenviar: false
        },
        RUBRICA_INEXISTENTE: {
            titulo: 'A rubrica da nota não existe mais no projeto',
            explicacao: 'A rubrica ligada a esta nota não está mais na lista de rubricas do projeto (por exemplo, depois de uma nova importação da planilha orçamentária).',
            acao: { tipo: 'vincular_rubrica', rotulo: 'Corrigir rubrica', orientacao: 'Escolha a rubrica correta no campo "Rubrica Orçamentária" desta tela. Ao corrigir, a nota volta para a fila de conferência e conciliação e pode esperar o D-3 de novo antes de ser liberada para o envio.' },
            permiteReenviar: false
        },
        RUBRICA_NAO_ENCONTRADA_SALIC: {
            titulo: 'Rubrica não localizada na tela do SALIC',
            explicacao: 'O robô não conseguiu identificar com segurança, na tela do SALIC, a linha da rubrica desta nota. O vínculo no Prestaí pode estar certo: o problema costuma estar no cadastro da rubrica no SALIC (nomes repetidos ou valor aprovado diferente do esperado).',
            acao: { tipo: null, rotulo: null, orientacao: 'Corrigir o vínculo e reenviar não resolve este caso. Acione o suporte, informando o PRONAC e esta nota.' },
            permiteReenviar: false
        },
        RUBRICA_TELA_DIVERGENTE: {
            titulo: 'A tela do SALIC não bate com a rubrica escolhida',
            explicacao: 'O robô abriu uma rubrica diferente da que a nota pede e parou antes de lançar, para não gravar a despesa na rubrica errada. O vínculo no Prestaí pode estar certo.',
            acao: { tipo: null, rotulo: null, orientacao: 'Corrigir o vínculo e reenviar não resolve este caso. Acione o suporte, informando o PRONAC e esta nota.' },
            permiteReenviar: false
        },
        VALOR_PAGO_INDETERMINADO: {
            titulo: 'Valor pago não identificado',
            explicacao: 'O robô não conseguiu definir o valor efetivamente pago desta nota, que o SALIC exige no lançamento.',
            acao: { tipo: 'informar_pagamento', rotulo: 'Informar pagamento', orientacao: 'Informe o pagamento (data, valor pago e número da transação) no formulário desta tela e depois use "Tentar Novamente".' },
            permiteReenviar: true
        },
        LANCAMENTO_DIVIDIDO: {
            titulo: 'Pagamento dividido em mais de um lançamento',
            explicacao: 'O pagamento desta nota aparece repartido em mais de um lançamento, e o robô não conseguiu definir um único valor pago.',
            acao: { tipo: 'informar_pagamento', rotulo: 'Informar pagamento', orientacao: 'Informe o pagamento (data, valor pago e número da transação) no formulário desta tela e depois use "Tentar Novamente".' },
            permiteReenviar: true
        },
        VALOR_MAIOR_QUE_NOTA: {
            titulo: 'Valor pago maior que o valor da nota',
            explicacao: 'O pagamento ligado a esta nota tem valor acima do valor da nota. O robô não envia ao SALIC um pagamento maior que a despesa.',
            acao: { tipo: 'informar_pagamento', rotulo: 'Informar pagamento', orientacao: 'Se o valor pago foi digitado errado, corrija no formulário desta tela. Se o lançamento do extrato é de outro pagamento, revise a conciliação. Depois use Tentar Novamente.' },
            permiteReenviar: true
        },
        DATA_PAGAMENTO_SEM_LANCAMENTO: {
            titulo: 'Data do pagamento não encontrada',
            explicacao: 'O robô não encontrou o lançamento do extrato conciliado com esta nota, e a nota também não tem data de pagamento informada.',
            acao: { tipo: 'informar_pagamento', rotulo: 'Informar pagamento', orientacao: 'Informe o pagamento (data, valor pago e número da transação) no formulário desta tela e depois use "Tentar Novamente".' },
            permiteReenviar: true
        },
        DADOS_OBRIGATORIOS_FALTANDO: {
            titulo: 'Dados obrigatórios da nota faltando',
            explicacao: 'Falta algum dado que o SALIC exige para receber a nota (como CNPJ/CPF, fornecedor, valor, data de emissão ou número do documento).',
            acao: { tipo: null, rotulo: null, orientacao: 'Preencha os campos destacados nesta tela e use "Tentar Novamente".' },
            permiteReenviar: true
        },
        CREDENCIAL_SALIC_AUSENTE: {
            titulo: 'Credencial do SALIC não cadastrada',
            explicacao: 'O robô não encontrou o CPF e a senha do SALIC para entrar no sistema.',
            acao: { tipo: 'configuracoes', rotulo: 'Abrir Configurações', orientacao: 'Cadastre o CPF e a senha do SALIC em Configurações e depois use "Tentar Novamente".' },
            permiteReenviar: true
        },
        ARQUIVO_NF_INDISPONIVEL: {
            titulo: 'Arquivo da nota indisponível',
            explicacao: 'O robô não conseguiu abrir o arquivo (PDF ou imagem) desta nota para anexá-lo no SALIC.',
            acao: { tipo: null, rotulo: null, orientacao: 'Confira se "Visualizar PDF" abre o arquivo. Reenviar não resolve: acione o suporte, informando esta nota.' },
            permiteReenviar: false
        },
        FORNECEDOR_NAO_ENCONTRADO_SALIC: {
            titulo: 'Fornecedor não encontrado no SALIC',
            explicacao: 'O robô não localizou, no cadastro do SALIC, o fornecedor desta nota.',
            acao: { tipo: null, rotulo: null, orientacao: 'Confira o CNPJ/CPF da nota e o cadastro do fornecedor no SALIC. Depois de regularizar, use "Tentar Novamente".' },
            permiteReenviar: true
        },
        LOGIN_SALIC_RECUSADO: {
            titulo: 'O SALIC recusou o login',
            explicacao: 'O CPF ou a senha do SALIC cadastrados foram recusados. O robô usa a senha própria do SALIC, não a entrada pelo gov.br.',
            acao: { tipo: 'configuracoes', rotulo: 'Atualizar credenciais', orientacao: 'Atualize a credencial em Configurações. Evite reenviar antes de corrigir: tentativas seguidas com senha errada podem bloquear o seu acesso ao SALIC.' },
            permiteReenviar: false
        },
        TEMPO_ESGOTADO_SALVAMENTO: {
            titulo: 'O SALIC demorou para confirmar o salvamento',
            explicacao: 'O robô enviou a nota, mas o SALIC não confirmou o salvamento a tempo. A nota pode ter sido gravada mesmo assim.',
            acao: { tipo: null, rotulo: null, orientacao: 'Antes de reenviar, confira no SALIC se esta nota já aparece lançada. Se já estiver lá, não reenvie, para não duplicar a despesa.' },
            permiteReenviar: true,
            confirmarAntesDeReenviar: 'Você conferiu no SALIC e esta nota NÃO aparece lançada? Se ela já estiver lá, reenviar duplica a despesa.'
        },
        ERRO_RPA_GENERICO: {
            titulo: 'Falha no envio automático',
            explicacao: 'O robô não conseguiu concluir o envio e não identificou uma causa específica. Pode ser instabilidade do SALIC.',
            acao: { tipo: null, rotulo: null, orientacao: 'Veja os detalhes abaixo e tente novamente. Se repetir, acione o suporte.' },
            permiteReenviar: true
        }
    };

    // Códigos em que a tela mostra o formulário "Informar pagamento manualmente" mesmo em erro_rpa.
    const CODIGOS_INFORMAR_PAGAMENTO = ['VALOR_PAGO_INDETERMINADO', 'LANCAMENTO_DIVIDIDO', 'DATA_PAGAMENTO_SEM_LANCAMENTO', 'VALOR_MAIOR_QUE_NOTA'];
    // Códigos em que a tela libera o campo de vínculo de rubrica em erro_rpa.
    const CODIGOS_CORRIGIR_RUBRICA = ['RUBRICA_NAO_VINCULADA', 'RUBRICA_INEXISTENTE'];

    const PREFIXO = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\]\s*/;

    function semAcento(texto) {
        return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    // Motivos da busca de rubrica no SALIC. A lista de candidatas só serve quando há linhas
    // parecidas para mostrar; em "nenhuma linha com o nome exato" ela seria só o começo da
    // página, sem utilidade.
    function motivoCandidatas(textoNormalizado) {
        if (/\d+ linhas? com o mesmo nome e o mesmo valor aprovado/.test(textoNormalizado)) return { motivo: 'nome_e_valor_repetidos', util: true };
        if (/nome encontrado, mas nenhuma linha com valor aprovado/.test(textoNormalizado)) return { motivo: 'valor_aprovado_diferente', util: true };
        if (/nome encontrado, mas sem valor aprovado da rubrica para conferir/.test(textoNormalizado)) return { motivo: 'sem_valor_para_conferir', util: true };
        if (/nenhuma linha com o nome exato/.test(textoNormalizado)) return { motivo: 'nome_exato_ausente', util: false };
        return { motivo: null, util: false };
    }

    // "Candidatas: Nome (aprovado 240000.00 | produto: X); Nome2 (...) (+N)". Até 20 itens
    // separados por ";" e, quando há mais, o total restante em "(+N)" no fim.
    function extrairCandidatas(detalhe) {
        const m = String(detalhe || '').match(/candidatas:\s*([\s\S]*)$/i);
        if (!m) return { itens: [], restantes: 0 };
        let lista = m[1].trim();
        let restantes = 0;
        const resto = lista.match(/\s*\(\+\s*(\d+)\s*\)\s*\.?\s*$/);
        if (resto) {
            restantes = Number(resto[1]);
            lista = lista.slice(0, resto.index).trim();
        }
        const itens = lista.split(/\s*;\s*/).map(s => s.trim()).filter(Boolean).slice(0, 20);
        return { itens, restantes };
    }

    // Lê o just_erro. Sempre devolve { bruto, codigo, conhecido, info, detalhe, candidatas }.
    //  - codigo: o código do prefixo quando ele está no mapa; null caso contrário.
    //  - conhecido: true só para código do mapa (é o que libera título, explicação e reenvio).
    function interpretar(justErro) {
        const bruto = justErro == null ? '' : String(justErro);
        const base = { bruto, codigo: null, conhecido: false, info: null, detalhe: bruto.trim(), candidatas: null };
        const m = bruto.match(PREFIXO);
        if (!m) return base;
        const codigo = m[1].toUpperCase();
        // [OVERRIDE], [AUTO] e afins não são códigos de erro do robô.
        if (!Object.prototype.hasOwnProperty.call(MAPA, codigo)) return base;
        const detalhe = bruto.slice(m[0].length).trim();
        const resultado = { bruto, codigo, conhecido: true, info: MAPA[codigo], detalhe, candidatas: null };
        if (codigo === 'RUBRICA_NAO_ENCONTRADA_SALIC') {
            const { motivo, util } = motivoCandidatas(semAcento(detalhe));
            const lista = util ? extrairCandidatas(detalhe) : { itens: [], restantes: 0 };
            resultado.candidatas = { motivo, itens: lista.itens, restantes: lista.restantes };
        }
        return resultado;
    }

    const permiteReenviar = (justErro) => { const e = interpretar(justErro); return e.conhecido && e.info.permiteReenviar === true; };
    // Envio em lote não passa pelo aviso de "conferir no SALIC antes de reenviar": esses erros
    // só se reenviam um a um, na tela da nota.
    const permiteReenviarEmLote = (justErro) => { const e = interpretar(justErro); return e.conhecido && e.info.permiteReenviar === true && !e.info.confirmarAntesDeReenviar; };
    const pedeInformarPagamento = (justErro) => CODIGOS_INFORMAR_PAGAMENTO.includes(interpretar(justErro).codigo);
    const permiteCorrigirRubrica = (justErro) => CODIGOS_CORRIGIR_RUBRICA.includes(interpretar(justErro).codigo);

    // Resposta HTTP do envio (/api/salic/inserir) que não deu certo. Só 404 e 500 viram aviso;
    // o envio não tem limite de uso e não devolve 429. Qualquer outro status devolve null e
    // segue o tratamento que o app já tinha. Nenhum caso altera o documento.
    function avisoEnvio(status, corpo) {
        if (status === 404) {
            return { tipo: 'warning', mensagem: 'Documento não encontrado ou de outra organização. Atualize a lista e confira se a nota ainda existe para você.' };
        }
        if (status === 500) {
            const e = interpretar(corpo && corpo.error);
            const motivo = e.conhecido ? ' Motivo: ' + e.info.titulo + '.' : '';
            return { tipo: 'warning', mensagem: 'O envio não foi concluído.' + motivo + ' Abra os detalhes da nota para ver o que foi registrado antes de tentar de novo.' };
        }
        return null;
    }

    return { MAPA, CODIGOS_INFORMAR_PAGAMENTO, CODIGOS_CORRIGIR_RUBRICA, interpretar, permiteReenviar, permiteReenviarEmLote, pedeInformarPagamento, permiteCorrigirRubrica, avisoEnvio };
});
