// ═══════════════════════════════════════════════════════════════════════════
//  relatorio-docx.js — Geração do .docx (EVENTO e MENSAL) NO NAVEGADOR,
//  em layout de TABELAS idêntico ao template real da Animus.
//
//  Requer, carregados ANTES deste script:
//    - vendor/docx.umd.js     (window.docx)
//    - supabase-helper-m3.js  (initSupabase, getEvidenciasByEvento, getSignedUrlsM3)
//
//  Logo do cabeçalho: definir LOGO_ARTECIDADANIA_B64 (dataURI base64 do PNG).
//  Enquanto vazio, o cabeçalho mostra só o texto do contrato.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    const {
        Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
        WidthType, ShadingType, PageBreak, AlignmentType, Header,
    } = window.docx;

    // Logo (opcional). Cole aqui o base64 puro do PNG (sem "data:image/png;base64,").
    const LOGO_ARTECIDADANIA_B64 = '';

    const REPORTS_BUCKET = 'reports';
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const MAX_LARGURA_PX = 500;

    const COR_GRAY   = 'F2F2F2';   // barras de rótulo de campo
    const COR_ORANGE = 'FCE4D6';   // caixa "Nome do evento"
    const COR_TITULO = 'C45911';   // títulos de seção (laranja)
    const CONTRATO_TITULO = 'RELATÓRIO DE ATIVIDADES - CONTRATO INSTITUTO ARTECIDADANIA';
    const MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
    const DIAS_SEMANA = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

    // ── Formatação básica ──────────────────────────────────────────────────
    function fmtDataBR(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return '—';
        const [a, m, d] = dateStr.split('-');
        if (!a || !m || !d) return dateStr;
        return `${d}/${m}/${a}`;
    }
    function diaSemana(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return '';
        const [a, m, d] = dateStr.split('-').map(Number);
        if (!a || !m || !d) return '';
        return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] || '';
    }
    function mesReferenciaTexto(mesRef) {
        if (!mesRef || typeof mesRef !== 'string') return '—';
        const [a, m] = mesRef.split('-').map(Number);
        if (!a || !m) return mesRef;
        return `${MESES[m - 1]} / ${a}`;
    }
    function brl(n) {
        return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    }

    // ── Parágrafos ─────────────────────────────────────────────────────────
    function par(text, opts = {}) {
        return new Paragraph({
            alignment: opts.align,
            spacing: { after: opts.after != null ? opts.after : 0, before: opts.before || 0 },
            children: [new TextRun({ text: String(text == null ? '' : text), bold: !!opts.bold, italics: !!opts.italics, size: opts.size, color: opts.color })],
        });
    }
    function multiParas(text, opts = {}) {
        if (text == null || String(text).trim() === '') return [par('—', opts)];
        const linhas = String(text).split('\n');
        // preserva linhas em branco como espaçamento leve, mas evita cauda vazia dupla
        const out = linhas.map(l => l.trim() === '' ? par('', { after: 60 }) : par(l, opts));
        return out.length ? out : [par('—', opts)];
    }
    function tituloSecao(text) {
        return par(text, { bold: true, color: COR_TITULO, size: 26, before: 240, after: 120 });
    }
    function spacer() { return new Paragraph({ spacing: { after: 80 }, children: [] }); }

    // ── Tabelas ────────────────────────────────────────────────────────────
    function cell(children, opts = {}) {
        return new TableCell({
            children: Array.isArray(children) ? children : [children],
            shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
            width: opts.width,
            columnSpan: opts.colSpan,
            margins: { top: 40, bottom: 40, left: 110, right: 110 },
        });
    }
    function tabelaFull(rows) {
        return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
    }
    // Bloco: barra de rótulo (sombreada) + célula de valor (multi-parágrafo).
    function blocoCampo(label, valorParagraphs, fill) {
        return tabelaFull([
            new TableRow({ children: [cell(par(label + ':', { bold: true }), { fill: fill || COR_GRAY })] }),
            new TableRow({ children: [cell(valorParagraphs)] }),
        ]);
    }
    // Bloco: barra de rótulo + uma linha por item (ex.: atividades).
    function blocoLista(label, itens) {
        const rows = [new TableRow({ children: [cell(par(label + ':', { bold: true }), { fill: COR_GRAY })] })];
        if (!itens || !itens.length) rows.push(new TableRow({ children: [cell(par('—'))] }));
        else itens.forEach(it => rows.push(new TableRow({ children: [cell(par(it))] })));
        return tabelaFull(rows);
    }
    // Bloco: barra de rótulo + célula com os links nomeados (hyperlinks clicáveis).
    function blocoLinks(label, links) {
        const rows = [new TableRow({ children: [cell(par(label + ':', { bold: true }), { fill: COR_GRAY })] })];
        const arr = Array.isArray(links) ? links.filter(l => l && (l.nome || l.url)) : [];
        if (!arr.length) rows.push(new TableRow({ children: [cell(par('—'))] }));
        else {
            const paras = arr.map(l => new Paragraph({
                spacing: { after: 40 },
                children: [l.url && String(l.url).trim()
                    ? new (window.docx.ExternalHyperlink)({ link: String(l.url).trim(), children: [new TextRun({ text: l.nome || l.url, style: 'Hyperlink' })] })
                    : new TextRun(l.nome || '—')],
            }));
            rows.push(new TableRow({ children: [cell(paras)] }));
        }
        return tabelaFull(rows);
    }
    // Bloco: barra de rótulo + uma linha por imagem (centralizada).
    function blocoGaleria(label, imagens) {
        const rows = [new TableRow({ children: [cell(par(label + ':', { bold: true }), { fill: COR_GRAY })] })];
        if (!imagens || !imagens.length) rows.push(new TableRow({ children: [cell(par('—'))] }));
        else imagens.forEach(img => {
            const paras = [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ data: img.data, transformation: { width: img.width, height: img.height }, type: img.type })],
            })];
            if (img.descricao) paras.push(par(img.descricao, { italics: true, size: 16, align: AlignmentType.CENTER, after: 40 }));
            rows.push(new TableRow({ children: [cell(paras)] }));
        });
        return tabelaFull(rows);
    }
    // Tabela chave→valor (2 colunas), rótulos em negrito (Seção 1, Data/Horário/Local).
    function tabelaChaveValor(pares) {
        const rows = pares.map(([k, v]) => new TableRow({
            children: [
                cell(par(k + ':', { bold: true }), { width: { size: 32, type: WidthType.PERCENTAGE } }),
                cell(par(v != null && v !== '' ? String(v) : '—'), { width: { size: 68, type: WidthType.PERCENTAGE } }),
            ],
        }));
        return tabelaFull(rows);
    }
    function barraNomeEvento(nome) {
        return tabelaFull([new TableRow({ children: [cell(par('Nome do evento: ' + (nome || '—'), { bold: true }), { fill: COR_ORANGE })] })]);
    }

    // ── Cabeçalho de página (logo + título do contrato) ────────────────────
    function pageHeader() {
        const children = [par(CONTRATO_TITULO, { bold: true, size: 18 })];
        if (LOGO_ARTECIDADANIA_B64) {
            children.unshift(new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new ImageRun({ data: Uint8Array.from(atob(LOGO_ARTECIDADANIA_B64), c => c.charCodeAt(0)), transformation: { width: 150, height: 44 }, type: 'png' })],
            }));
        }
        return new Header({ children });
    }

    // ── Imagens: signed URL → blob → dimensões reais ───────────────────────
    function mimeParaTipo(mime) {
        const m = (mime || '').toLowerCase();
        if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
        if (m.includes('png')) return 'png';
        if (m.includes('gif')) return 'gif';
        if (m.includes('bmp')) return 'bmp';
        return null;
    }
    async function dimensoes(blob) {
        if (typeof createImageBitmap === 'function') {
            try { const b = await createImageBitmap(blob); const d = { width: b.width, height: b.height }; if (b.close) b.close(); return d; } catch (_) {}
        }
        return await new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { const d = { width: img.naturalWidth, height: img.naturalHeight }; URL.revokeObjectURL(url); resolve(d); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao ler imagem')); };
            img.src = url;
        });
    }
    async function carregarImagens(evidencias) {
        const imgs = evidencias.filter(e => e.file_path && (e.mime_type || '').startsWith('image/'));
        if (!imgs.length) return [];
        const urlMap = await getSignedUrlsM3(imgs.map(e => e.file_path).filter(Boolean));
        const out = [];
        for (const ev of imgs) {
            const tipo = mimeParaTipo(ev.mime_type);
            if (!tipo) continue;
            const url = urlMap[ev.file_path.trim()];
            if (!url) continue;
            try {
                const blob = await (await fetch(url)).blob();
                const dim = await dimensoes(blob);
                const escala = dim.width > MAX_LARGURA_PX ? MAX_LARGURA_PX / dim.width : 1;
                out.push({
                    data: await blob.arrayBuffer(),
                    width: Math.round(dim.width * escala),
                    height: Math.round(dim.height * escala),
                    type: tipo,
                    descricao: ev.descricao || '',
                    tipoEvidencia: ev.tipo_evidencia || 'outros',
                });
            } catch (err) { console.warn('[RELATORIO-DOCX] imagem falhou', ev.id, err.message); }
        }
        return out;
    }

    function publicoTexto(evento) {
        if (evento.publico_meta_texto && String(evento.publico_meta_texto).trim()) return evento.publico_meta_texto;
        const rows = evento.publico_por_dia;
        if (!Array.isArray(rows) || !rows.length) return '';
        return rows.map(r => {
            const dia = diaSemana(r.data), dm = fmtDataBR(r.data).slice(0, 5);
            return `${dia ? dia + ' ' : ''}(${dm})\nIngressos disponibilizados: ${r.disponibilizado ?? 0} (${r.retirado ?? 0} retirados)\nPúblico total: ${r.presente ?? 0}`;
        }).join('\n\n');
    }

    // ── Seção 2: um evento (ordem exata do template, em tabelas) ───────────
    async function buildSecaoEvento(evento, numeroSecao, numeroEvento) {
        const evidencias = await getEvidenciasByEvento(evento.id);
        const imagens = await carregarImagens(evidencias);
        const galExec  = imagens.filter(i => i.tipoEvidencia === 'foto_evento');
        const galAcess = imagens.filter(i => i.tipoEvidencia === 'acessibilidade');
        const galCom   = imagens.filter(i => i.tipoEvidencia === 'peca_marketing');

        const atividades = evento.quantitativo_atividades
            ? String(evento.quantitativo_atividades).split('\n').map(s => s.trim()).filter(Boolean)
            : [];

        const tituloEv = numeroSecao
            ? `${numeroSecao} EVENTO ${String(numeroEvento || 1).padStart(2, '0')}`
            : (evento.titulo || 'EVENTO');

        const out = [];
        const add = (...els) => { els.forEach(e => { out.push(e); out.push(spacer()); }); };

        out.push(tituloSecao(tituloEv));
        add(barraNomeEvento(evento.titulo));
        add(tabelaChaveValor([
            ['Data', fmtDataBR(evento.data_evento)],
            ['Horário de início e término', evento.horario_descricao || (evento.horario ? String(evento.horario).slice(0, 5) : null)],
            ['Local de realização', [evento.nome_local, evento.cidade, evento.estado].filter(Boolean).join(' — ')],
        ]));
        add(blocoCampo('Resumo do evento', multiParas(evento.resumo_evento)));
        add(blocoLista('Quantitativo de atividades incluídas no evento (especificar)', atividades));
        add(blocoCampo('Quantitativo de público x meta estimada', multiParas(publicoTexto(evento))));
        add(blocoCampo('Perfil do público-alvo', multiParas(evento.perfil_publico)));
        add(blocoLinks('Link aberto para borderôs e listas de presença de atividades', evento.link_borderos));
        add(blocoLinks('Link aberto para fotos, vídeos e comprovantes de execução', evento.link_fotos_execucao));
        add(blocoGaleria('Fotos, vídeos e comprovantes de execução', galExec));
        add(blocoCampo('Ações de Acessibilidade', multiParas(evento.acoes_acessibilidade)));
        add(blocoLinks('Link aberto para fotos comprobatórias de ações de Acessibilidade', evento.link_fotos_acessibilidade));
        add(blocoGaleria('Fotos comprobatórias de ações de Acessibilidade', galAcess));
        add(blocoLinks('Link aberto para materiais de comunicação (artes, fotos de cartazes, banners etc.)', evento.link_materiais_comunicacao));
        add(blocoGaleria('Materiais de comunicação (artes, fotos de cartazes, banners etc.)', galCom));
        add(blocoCampo('Número de fornecedores contratados', multiParas(evento.numero_fornecedores)));
        add(blocoCampo('Quantidade de empregos temporários gerados', multiParas(evento.empregos_gerados)));
        add(blocoCampo('Ocorreram ações ambientais no evento? Quais?', multiParas(evento.acoes_ambientais)));
        add(blocoCampo('Desafios encontrados e possíveis soluções', multiParas(evento.desafios_evento)));
        return out;
    }

    // ── Seção 3: financeiro (links de planilha nomeados) ───────────────────
    function blocoFinanceiro(custos) {
        const rows = [new TableRow({ children: [cell(par('Link aberto para orçamento final do mês:', { bold: true }), { fill: COR_GRAY })] })];
        const paras = [];
        if (!custos.length) paras.push(par('Nenhum custo informado.'));
        else {
            custos.forEach(c => {
                const nome = c.link_nome || c.nome_evento || '—';
                const sufixo = ` - R$ ${brl(c.valor)}`;
                paras.push(new Paragraph({
                    spacing: { after: 40 },
                    children: [
                        (c.link_planilha && String(c.link_planilha).trim())
                            ? new (window.docx.ExternalHyperlink)({ link: String(c.link_planilha).trim(), children: [new TextRun({ text: nome, style: 'Hyperlink' })] })
                            : new TextRun(nome),
                        new TextRun(sufixo),
                    ],
                }));
            });
            const total = custos.reduce((s, c) => s + (Number(c.valor) || 0), 0);
            paras.push(par(`Custo total: ${brl(total)}`, { bold: true, before: 80 }));
        }
        rows.push(new TableRow({ children: [cell(paras)] }));
        return tabelaFull(rows);
    }

    // ── Seção 6: comunicação (célula única "valor + rótulo") ───────────────
    function linhaComunicacao(num, sufixo) {
        const valor = num != null && num !== '' ? String(num) : '—';
        return new Paragraph({ children: [new TextRun({ text: valor, bold: true }), new TextRun(' ' + sufixo)] });
    }
    function blocoComunicacao(r) {
        const rows = [];
        rows.push(new TableRow({ children: [cell(par('Redes Sociais - Instagram:', { bold: true }), { fill: COR_GRAY })] }));
        rows.push(new TableRow({ children: [cell([
            linhaComunicacao(r.comunicacao_seguidores_total != null ? Number(r.comunicacao_seguidores_total).toLocaleString('pt-BR') : null, 'seguidores (total)'),
            linhaComunicacao(r.comunicacao_novos_seguidores != null ? Number(r.comunicacao_novos_seguidores).toLocaleString('pt-BR') : null, 'novos seguidores no mês'),
            linhaComunicacao(r.comunicacao_interacoes != null ? Number(r.comunicacao_interacoes).toLocaleString('pt-BR') : null, 'interações'),
            linhaComunicacao(r.comunicacao_visualizacoes != null ? Number(r.comunicacao_visualizacoes).toLocaleString('pt-BR') : null, 'visualizações'),
            linhaComunicacao(r.comunicacao_alcance != null ? Number(r.comunicacao_alcance).toLocaleString('pt-BR') : null, 'pessoas alcançadas'),
        ])] }));
        rows.push(new TableRow({ children: [cell(par('Mídia espontânea/imprensa:', { bold: true }), { fill: COR_GRAY })] }));
        const materias = r.comunicacao_materias_qtd != null ? `${r.comunicacao_materias_qtd} matérias` : '—';
        const positivas = r.comunicacao_materias_positivas_pct != null ? `; ${r.comunicacao_materias_positivas_pct}% positivas` : '';
        rows.push(new TableRow({ children: [cell([
            par(materias + positivas),
            linhaComunicacao(r.comunicacao_retorno_midia_valor != null ? 'R$ ' + brl(r.comunicacao_retorno_midia_valor) : null, 'em retorno'),
        ])] }));
        return tabelaFull(rows);
    }

    // ── Storage + download ─────────────────────────────────────────────────
    async function uploadReports(blob, projectId, filename) {
        const sb = await initSupabase();
        const uuid = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const filePath = `${projectId}/${uuid}/${filename}`;
        const { error } = await sb.storage.from(REPORTS_BUCKET).upload(filePath, blob, { contentType: DOCX_MIME, upsert: true });
        if (error) throw new Error('Falha ao salvar no sistema: ' + error.message);
        return filePath;
    }
    function baixar(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    // ── Relatório AVULSO de um evento ──────────────────────────────────────
    async function gerarDocEventoClient(evento) {
        const sb = await initSupabase();
        const secao = await buildSecaoEvento(evento, null);
        const doc = new Document({
            sections: [{
                headers: { default: pageHeader() },
                children: [
                    par('RELATÓRIO DE EVENTO', { bold: true, size: 30, align: AlignmentType.CENTER, after: 120 }),
                    ...secao,
                ],
            }],
        });
        const blob = await Packer.toBlob(doc);
        const filename = `relatorio-evento-${evento.id}.docx`;
        const filePath = await uploadReports(blob, evento.project_id, filename);
        await sb.from('distribution_events').update({
            relatorio_status: 'gerado',
            relatorio_evento_file_path: filePath,
            relatorio_evento_gerado_em: new Date().toISOString(),
        }).eq('id', evento.id);
        baixar(blob, filename);
        return { path: filePath };
    }

    // ── Relatório MENSAL consolidado ───────────────────────────────────────
    async function gerarDocPeriodoClient(projectId, mesReferencia) {
        const sb = await initSupabase();
        const { data: relatorio, error: relErr } = await sb.from('distribution_monthly_reports')
            .select('*').eq('project_id', projectId).eq('mes_referencia', mesReferencia).maybeSingle();
        if (relErr) throw relErr;
        if (!relatorio) throw new Error('Finalize o rascunho antes de gerar o relatório final.');

        const { data: projeto } = await sb.from('projects')
            .select('nome, pronac, codigo_projeto_contrato').eq('id', projectId).maybeSingle();

        const [ano, mes] = mesReferencia.split('-');
        const proximoMes = mes === '12' ? `${Number(ano) + 1}-01-01` : `${ano}-${String(Number(mes) + 1).padStart(2, '0')}-01`;
        const { data: eventos, error: evErr } = await sb.from('distribution_events')
            .select('*').eq('project_id', projectId)
            .gte('data_evento', mesReferencia).lt('data_evento', proximoMes)
            .order('data_evento', { ascending: true });
        if (evErr) throw evErr;

        const custos = Array.isArray(relatorio.custos_por_evento) ? relatorio.custos_por_evento : [];

        const children = [];
        // Seção 1
        children.push(tituloSecao('1. IDENTIFICAÇÃO DO ESPECIALISTA'));
        children.push(tabelaChaveValor([
            ['Nome completo', relatorio.especialista_nome],
            ['Função', relatorio.especialista_funcao],
            ['Período do relatório', mesReferenciaTexto(mesReferencia)],
            ['Projeto de atuação', projeto && projeto.nome],
            ['Projeto', projeto && projeto.codigo_projeto_contrato],
        ]));
        children.push(new Paragraph({ children: [new PageBreak()] }));

        // Seção 2
        children.push(tituloSecao('2. REALIZAÇÕES'));
        for (let i = 0; i < (eventos || []).length; i++) {
            const secao = await buildSecaoEvento(eventos[i], `2.${i + 1}`, i + 1);
            children.push(...secao);
            children.push(new Paragraph({ children: [new PageBreak()] }));
        }

        // Seção 3
        children.push(tituloSecao('3. RESULTADO FINANCEIRO'));
        children.push(blocoFinanceiro(custos));
        children.push(spacer());

        // Seção 4
        children.push(tituloSecao('4. PRINCIPAIS DESAFIOS DO PERÍODO'));
        children.push(...multiParas(relatorio.desafios_periodo, { after: 120 }));

        // Seção 5
        children.push(tituloSecao('5. GERENCIAMENTO DE EQUIPE'));
        children.push(...multiParas(relatorio.gerenciamento_equipe, { after: 120 }));

        // Seção 6
        children.push(tituloSecao('6. DADOS GERAIS DA COMUNICAÇÃO - REDES SOCIAIS E IMPRENSA'));
        children.push(blocoComunicacao(relatorio));

        // Assinatura (sem título, centralizada, com linha)
        children.push(new Paragraph({ children: [new PageBreak()] }));
        children.push(par(relatorio.assinatura_cidade_data || '—', { after: 600 }));
        children.push(par('_________________________________________________', { align: AlignmentType.CENTER, after: 40 }));
        children.push(par(relatorio.assinatura_nome || '—', { bold: true, align: AlignmentType.CENTER }));
        children.push(par(relatorio.assinatura_cargo || '—', { bold: true, align: AlignmentType.CENTER }));
        children.push(par(relatorio.assinatura_local_projeto || '—', { bold: true, align: AlignmentType.CENTER }));

        const doc = new Document({ sections: [{ headers: { default: pageHeader() }, children }] });
        const blob = await Packer.toBlob(doc);
        const filename = `relatorio-mensal-${mesReferencia}.docx`;
        const filePath = await uploadReports(blob, projectId, filename);
        await sb.from('distribution_monthly_reports').update({
            relatorio_file_path: filePath,
            relatorio_gerado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
        }).eq('id', relatorio.id);
        baixar(blob, filename);
        return { path: filePath };
    }

    window.gerarDocEventoClient  = gerarDocEventoClient;
    window.gerarDocPeriodoClient = gerarDocPeriodoClient;
})();
