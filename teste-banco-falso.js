// Supabase falso em memória para os testes das rotas do server.js (REST do PostgREST e auth), sem
// rede. Só entende o que as rotas testadas usam: filtros eq., in.(...), is.null, not.is.null, lt. e
// gt.; select, insert (POST) e update (PATCH). Emula o trigger de documents que renova updated_at
// e o default de criado_em em processamento_eventos.
// Uso: const { criarFetchFalso } = require('./teste-banco-falso.js');
function criarFetchFalso({ obterDb, usuarios, webhook = null, antesDoPatch = null }) {
    const json = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

    const comparar = (valor, expr) => {
        if (expr.startsWith('eq.')) return String(valor) === expr.slice(3);
        if (expr === 'is.null') return valor === null || valor === undefined;
        if (expr === 'not.is.null') return !(valor === null || valor === undefined);
        if (expr.startsWith('in.(')) return expr.slice(4, -1).split(',').includes(String(valor));
        if (expr.startsWith('lt.')) return valor != null && new Date(valor).getTime() < new Date(expr.slice(3)).getTime();
        if (expr.startsWith('gt.')) return valor != null && new Date(valor).getTime() > new Date(expr.slice(3)).getTime();
        throw new Error('filtro não suportado no banco falso: ' + expr);
    };
    const casa = (linha, filtros) => filtros.every(([coluna, expr]) => comparar(linha[coluna], expr));

    return async function fetchFalso(url, init = {}) {
        const u = new URL(url);
        const cab = new Headers(init.headers || {});
        const metodo = (init.method || 'GET').toUpperCase();

        if (u.hostname === 'fake.local' && u.pathname === '/auth/v1/user') {
            const token = (cab.get('authorization') || '').replace('Bearer ', '');
            const usuario = usuarios[token];
            return usuario ? json(200, { ...usuario, aud: 'authenticated' }) : json(401, { message: 'invalid' });
        }
        if (webhook && u.hostname !== 'fake.local') {
            return webhook(String(url), init.body ? JSON.parse(init.body) : null);
        }
        if (u.pathname.startsWith('/storage/')) return json(404, { message: 'storage indisponível no banco falso' });

        const db = obterDb();
        const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
        if (!m || !db[m[1]]) return json(404, { message: 'tabela desconhecida ' + u.pathname });
        const nomeTabela = m[1];
        const tabela = db[nomeTabela];
        const filtros = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
        const devolve = (cab.get('prefer') || '').includes('return=representation');

        if (metodo === 'GET') {
            let linhas = tabela.filter(l => casa(l, filtros));
            const limite = Number(u.searchParams.get('limit'));
            if (limite) linhas = linhas.slice(0, limite);
            if ((cab.get('accept') || '').includes('vnd.pgrst.object')) {
                return linhas.length ? json(200, linhas[0]) : json(406, { code: 'PGRST116', message: 'sem linha' });
            }
            return json(200, linhas);
        }
        if (metodo === 'PATCH') {
            if (antesDoPatch) antesDoPatch(tabela, filtros, nomeTabela);
            const alteradas = tabela.filter(l => casa(l, filtros));
            const campos = JSON.parse(init.body);
            alteradas.forEach(l => {
                Object.assign(l, campos);
                if (nomeTabela === 'documents') l.updated_at = new Date().toISOString();
            });
            return devolve ? json(200, alteradas) : new Response(null, { status: 204 });
        }
        if (metodo === 'POST') {
            const novas = [].concat(JSON.parse(init.body)).map(n => ({
                id: '00000000-0000-4000-8000-' + String(900000 + tabela.length).padStart(12, '0'),
                ...(nomeTabela === 'processamento_eventos' ? { criado_em: new Date().toISOString() } : {}),
                ...n
            }));
            novas.forEach(n => tabela.push(n));
            return devolve ? json(201, novas) : new Response(null, { status: 201 });
        }
        return json(405, { message: 'método não suportado' });
    };
}

module.exports = { criarFetchFalso };
