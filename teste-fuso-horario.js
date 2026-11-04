// Testes da ocorrencia #160 (horario em UTC): hojeBrasil, somarDiasData e a migration das mensagens de OCR.
// Sem banco e sem rede. Uso: node teste-fuso-horario.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// server.js so e carregado para pegar as funcoes puras; as variaveis evitam createClient falhar e abrir porta.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:0';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'teste';
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
const { hojeBrasil, somarDiasData } = require('./server.js').__teste;

let ok = 0, falhas = 0;
function teste(nome, fn) {
    try { fn(); ok++; } catch (e) { falhas++; console.error('FALHOU:', nome, '\n  ', e.message); }
}

teste('hojeBrasil as 23h30 no Brasil (ja e o dia seguinte em UTC) devolve o dia do Brasil', () => {
    const instante = new Date('2026-11-05T02:30:00Z'); // 04/11 23:30 em Brasilia
    assert.strictEqual(instante.toISOString().slice(0, 10), '2026-11-05', 'premissa: em UTC ja e dia 5');
    assert.strictEqual(hojeBrasil(instante), '2026-11-04');
});

teste('hojeBrasil na virada do dia no Brasil (03:00 UTC)', () => {
    assert.strictEqual(hojeBrasil(new Date('2026-11-05T02:59:59Z')), '2026-11-04');
    assert.strictEqual(hojeBrasil(new Date('2026-11-05T03:00:00Z')), '2026-11-05');
});

teste('hojeBrasil de manha e ao meio-dia coincide com UTC', () => {
    assert.strictEqual(hojeBrasil(new Date('2026-11-04T12:00:00Z')), '2026-11-04');
    assert.strictEqual(hojeBrasil(new Date('2026-11-04T09:00:00Z')), '2026-11-04');
});

teste('hojeBrasil na virada do ano e em dia 29/02', () => {
    assert.strictEqual(hojeBrasil(new Date('2027-01-01T02:00:00Z')), '2026-12-31');
    assert.strictEqual(hojeBrasil(new Date('2028-03-01T02:00:00Z')), '2028-02-29');
});

teste('hojeBrasil sem argumento devolve AAAA-MM-DD', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(hojeBrasil()));
});

teste('somarDiasData: mes, ano e bissexto, sem depender do fuso da maquina', () => {
    assert.strictEqual(somarDiasData('2026-11-04', 7), '2026-11-11');
    assert.strictEqual(somarDiasData('2026-11-28', 7), '2026-12-05');
    assert.strictEqual(somarDiasData('2026-12-28', 7), '2027-01-04');
    assert.strictEqual(somarDiasData('2028-02-25', 7), '2028-03-03');
    assert.strictEqual(somarDiasData('2026-11-04', 0), '2026-11-04');
});

teste('server.js nao grava mais data pelo dia em UTC nem formata data sem fuso', () => {
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.ok(!src.includes('agora.slice(0, 10)'));
    assert.ok(!/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/.test(src));
    assert.ok(!/new Date\(\)\.toLocaleDateString\('pt-BR'\)/.test(src));
    assert.strictEqual(src.split('data_pagamento: hojeBrasil()').length - 1, 3);
    assert.ok(src.includes('data_pagamento: doc.data_pagamento || hojeBrasil()'));
});

teste('migration 160: as duas mensagens usam America/Sao_Paulo e o resto da funcao e o da migration anterior', () => {
    const nova = fs.readFileSync(path.join(__dirname, 'migration_160_fuso_mensagens.sql'), 'utf8');
    const antiga = fs.readFileSync(path.join(__dirname, 'migration_ocr_por_tipo_documento.sql'), 'utf8');
    const corpo = (s) => s.slice(s.indexOf('CREATE OR REPLACE FUNCTION public.revisar_ocr_travado'), s.indexOf('$function$;', s.indexOf('CREATE OR REPLACE FUNCTION public.revisar_ocr_travado')) + 11);
    const a = corpo(antiga), n = corpo(nova);
    assert.strictEqual((n.match(/to_char\(now\(\) AT TIME ZONE 'America\/Sao_Paulo', 'DD\/MM\/YYYY HH24:MI'\)/g) || []).length, 2);
    assert.ok(!/to_char\(now\(\),/.test(n));
    assert.strictEqual(n.replace(/ AT TIME ZONE 'America\/Sao_Paulo'/g, ''), a);
    assert.ok(/NAO APLICADA/.test(nova));
});

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
