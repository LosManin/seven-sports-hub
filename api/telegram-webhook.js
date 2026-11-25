// api/telegram-webhook.js · Telegram avisa aquí cuando alguien pide entrar al canal SEVEN. Copia de Masters (25/11/2026).
// Solo trata los enlaces PERSONALES de api/join.js (nombre «w_…»). Manda a Meta «CompleteRegistration».
// NO aprueba (lo hace el usuario a mano) salvo TELEGRAM_AUTO_APPROVE = 1.
// OJO: el bot de TELEGRAM_JOIN_BOT_TOKEN tiene que ser uno SOLO para la web. Si se pone aquí
// @sevenpicks_access_bot, el webhook le cortaría las órdenes del PC (Telegram con Claude).
//
// Puesta en marcha (una vez, tras poner el token): abrir https://<dirección de la web>/api/telegram-webhook?setup=1

const crypto = require('crypto');
const PIXEL_ID = '1038318315115764';

const secreto = (token) => crypto.createHash('sha256').update('sv-join:' + token).digest('hex').slice(0, 48);
const h = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

const kv = (cmd) => fetch(process.env.KV_REST_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(cmd),
}).then((r) => r.json());

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_JOIN_BOT_TOKEN;
  if (!token) return res.status(200).json({ ok: false, motivo: 'falta TELEGRAM_JOIN_BOT_TOKEN' });
  const tg = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  }).then((r) => r.json());
  const urlWebhook = `https://${req.headers.host}/api/telegram-webhook`;

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const me = await tg('getMe');
    const usuario = me.result && me.result.username;
    if (new URL(req.url, 'https://x').searchParams.get('setup') === '1') {
      if (/sevenpicks_access_bot/i.test(usuario || '')) return res.status(200).json({ ok: false, motivo: 'este bot lo usa el PC; crea uno solo para la web' });
      const r = await tg('setWebhook', { url: urlWebhook, secret_token: secreto(token), allowed_updates: ['chat_join_request'], drop_pending_updates: true });
      return res.status(200).json({ ok: !!r.ok, bot: usuario, descripcion: r.description });
    }
    const w = await tg('getWebhookInfo');
    const x = w.result || {};
    return res.status(200).json({ bot: usuario, webhook_ok: x.url === urlWebhook, pendientes: x.pending_update_count, ultimo_error: x.last_error_message });
  }

  if (req.headers['x-telegram-bot-api-secret-token'] !== secreto(token)) return res.status(401).end();

  const u = await leerCuerpo(req);
  const sol = u.chat_join_request;
  if (!sol) return res.status(200).end();
  const enlace = sol.invite_link || {};
  if (String(sol.chat.id) !== String(process.env.TELEGRAM_CHAT_ID) || !/^w_/.test(enlace.name || '')) return res.status(200).end();

  if (process.env.TELEGRAM_AUTO_APPROVE === '1') {
    const ap = await tg('approveChatJoinRequest', { chat_id: sol.chat.id, user_id: sol.from.id }).catch((e) => ({ ok: false, description: String(e) }));
    if (!ap.ok) console.log('aprobar:', ap.description);
  }

  let v = null;
  try {
    const r = await kv(['GET', 'sjl:' + enlace.invite_link]);
    v = r && r.result ? JSON.parse(r.result) : null;
  } catch (e) { console.error('Upstash', String(e)); }

  const metaToken = process.env.META_CONVERSIONS_API_TOKEN;
  if (metaToken) {
    const user_data = { external_id: [h('tg' + sol.from.id)] };
    if (v) {
      if (v.ip) user_data.client_ip_address = v.ip;
      if (v.ua) user_data.client_user_agent = v.ua;
      if (v.fbp && v.fbp.startsWith('fb.')) user_data.fbp = v.fbp;
      if (v.fbc && v.fbc.startsWith('fb.')) user_data.fbc = v.fbc;
    }
    const body = { data: [{
      event_name: 'CompleteRegistration',
      event_time: Math.floor(Date.now() / 1000),
      event_id: 'tj_' + (v && v.id ? v.id : sol.from.id),
      action_source: 'website',
      event_source_url: (v && v.url) || `https://${req.headers.host}/`,
      user_data,
      custom_data: { content_name: 'Telegram join request' },
    }] };
    if (process.env.META_TEST_CODE) body.test_event_code = process.env.META_TEST_CODE;
    try {
      const r = await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION || 'v26.0'}/${PIXEL_ID}/events?access_token=${encodeURIComponent(metaToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const txt = await r.text();
      if (!r.ok) console.error('Meta entrada error', r.status, txt.slice(0, 400));
      else console.log('Meta entrada ok', v ? 'con visita' : 'sin visita', txt.slice(0, 100));
    } catch (e) { console.error('Meta entrada fallo de red', String(e)); }
  }

  await kv(['DEL', 'sjl:' + enlace.invite_link]).catch(() => {});
  return res.status(200).end();
};
