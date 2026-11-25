// api/meta-conversion.js · API de conversiones de Meta (servidor) para SEVEN. Copia de Masters (25/11/2026).
// Envía «Lead» (1,35 €) y «JoinTelegramClick» con el MISMO event_id que el píxel del navegador
// para que Meta junte los dos y no cuente doble.
//
// Variables de entorno en Vercel:
//   META_CONVERSIONS_API_TOKEN → token del píxel (secreto, lo pega el usuario)
//   META_TEST_CODE             → opcional; código de «Probar eventos» (quitarlo al terminar)

const PIXEL_ID = '1038318315115764';

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); } }
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const token = process.env.META_CONVERSIONS_API_TOKEN;
  if (!token) return res.status(204).end();

  const d = await leerCuerpo(req);
  const id = String(d.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
  if (!id) return res.status(400).end();

  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '');
  const user_data = {};
  if (ip) user_data.client_ip_address = ip;
  if (ua) user_data.client_user_agent = ua;
  if (typeof d.fbp === 'string' && d.fbp.startsWith('fb.')) user_data.fbp = d.fbp.slice(0, 200);
  if (typeof d.fbc === 'string' && d.fbc.startsWith('fb.')) user_data.fbc = d.fbc.slice(0, 500);

  const base = `https://${req.headers.host}/`;
  let url = typeof d.url === 'string' ? d.url.slice(0, 1000) : '';
  if (!url.startsWith(base)) url = base;

  const comun = { event_time: Math.floor(Date.now() / 1000), action_source: 'website', event_source_url: url, user_data };
  const body = { data: [
    { ...comun, event_name: 'Lead', event_id: 'ld_' + id, custom_data: { value: 1.35, currency: 'EUR' } },
    { ...comun, event_name: 'JoinTelegramClick', event_id: 'jt_' + id },
  ] };
  if (process.env.META_TEST_CODE) body.test_event_code = process.env.META_TEST_CODE;

  try {
    const r = await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION || 'v26.0'}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) console.error('Meta CAPI error', r.status, txt.slice(0, 500));
    else console.log('Meta CAPI ok', txt.slice(0, 200));
  } catch (e) {
    console.error('Meta CAPI fallo de red', String(e));
  }
  return res.status(204).end();
};
