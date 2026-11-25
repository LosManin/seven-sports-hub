// api/join.js · Botón de la web → enlace de invitación PERSONAL de Telegram. Copia de Masters (25/11/2026).
// Claves de Upstash con prefijo «s» (sip:, sjl:) para no mezclarse con Radicals y Masters.
// Si falta algo (bot, Upstash…) o Telegram falla, manda al enlace general: el botón nunca se rompe.
//
// Variables de entorno en Vercel:
//   TELEGRAM_JOIN_BOT_TOKEN → bot SOLO para la web, admin del canal con «Add Subscribers» (lo pega el usuario)
//   TELEGRAM_CHAT_ID        → -1004470383972
//   KV_REST_API_URL / KV_REST_API_TOKEN → Upstash

const ENLACE_GENERAL = 'https://t.me/+FcfVuH7_fEo0OGQ8'; // canal SEVEN
const DIAS = 7;

const kv = (cmd) => fetch(process.env.KV_REST_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(cmd),
}).then((r) => r.json());

const conTiempo = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), ms))]);

function cookie(req, n) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + n + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

module.exports = async (req, res) => {
  const ir = (url) => { res.setHeader('Cache-Control', 'no-store'); res.writeHead(302, { Location: url }); res.end(); };

  const token = process.env.TELEGRAM_JOIN_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return ir(ENLACE_GENERAL);

  const q = new URL(req.url, 'https://x').searchParams;
  const id = String(q.get('id') || '').replace(/[^a-z0-9]/gi, '').slice(0, 24) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  if (/bot|crawl|spider|facebookexternalhit|preview/i.test(ua)) return ir(ENLACE_GENERAL);

  let fbc = cookie(req, '_fbc');
  const fbclid = String(q.get('fbclid') || '').slice(0, 300);
  if (!fbc && fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
  const fbp = cookie(req, '_fbp');
  const base = `https://${req.headers.host}/`;
  let pagina = String(q.get('u') || '').slice(0, 500);
  if (!pagina.startsWith(base)) pagina = base;

  try {
    if (ip) {
      const n = await conTiempo(kv(['INCR', 'sip:' + ip]), 2000);
      if (n && n.result === 1) await kv(['EXPIRE', 'sip:' + ip, '3600']).catch(() => {});
      if (n && n.result > 15) return ir(ENLACE_GENERAL);
    }
    const r = await conTiempo(fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, name: ('w_' + id).slice(0, 32), creates_join_request: true,
        expire_date: Math.floor(Date.now() / 1000) + DIAS * 86400 }),
    }).then((x) => x.json()), 4000);
    if (!r.ok || !r.result || !r.result.invite_link) { console.error('Telegram createChatInviteLink', JSON.stringify(r).slice(0, 300)); return ir(ENLACE_GENERAL); }

    const enlace = r.result.invite_link;
    const datos = { id, fbp, fbc, ip, ua, url: pagina, t: Math.floor(Date.now() / 1000) };
    await conTiempo(kv(['SET', 'sjl:' + enlace, JSON.stringify(datos), 'EX', String(DIAS * 86400)]), 2500);
    return ir(enlace);
  } catch (e) {
    console.error('join fallo', String(e));
    return ir(ENLACE_GENERAL);
  }
};
