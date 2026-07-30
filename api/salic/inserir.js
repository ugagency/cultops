export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const railwayUrl = process.env.RAILWAY_URL;
  if (!railwayUrl) {
    return res.status(500).json({ error: 'RAILWAY_URL não configurada' });
  }

  try {
    console.log('[PROXY] Encaminhando para Railway:', railwayUrl);

    const response = await fetch(`${railwayUrl}/api/salic/inserir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('[PROXY] Erro ao chamar Railway:', error.message);
    return res.status(500).json({
      error: 'Erro ao conectar com o serviço RPA',
      detail: error.message,
    });
  }
}
