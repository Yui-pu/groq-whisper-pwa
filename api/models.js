export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
      },
    });
  }

  const authHeader = req.headers.get('authorization') || '';
  try {
    const groqResp = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    const bodyText = await groqResp.text();
    return new Response(bodyText, {
      status: groqResp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: `Proxy Error: ${err.message}` } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
