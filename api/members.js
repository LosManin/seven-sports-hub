// api/members.js · Número REAL de miembros del canal SEVEN (contador en directo de la web).
// Copia de la de Masters (25/11/2026). Pregunta a Telegram y guarda el último número en Upstash
// (claves con prefijo «s:»). Si Telegram pide esperar, devuelve el último número guardado.
//
// Variables de entorno en Vercel:
//   TELEGRAM_COUNT_BOT_TOKEN → clave de un bot admin del canal (la pega el usuario)
//   TELEGRAM_JOIN_BOT_TOKEN  → de reserva
//   TELEGRAM_CHAT_ID         → id del canal SEVEN (-1004470383972)
//   KV_REST_API_URL / KV_REST_API_TOKEN → Upstash (opcional)

const kv = (cmd) => fetch(process.env.KV_REST_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(cmd),
}).then((r) => r.json());

const conTiempo = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), ms))]);

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_COUNT_BOT_TOKEN || process.env.TELEGRAM_JOIN_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const responde = (cuerpo, segundos) => { res.setHeader('Cache-Control', `s-maxage=${segundos}, stale-while-revalidate=300`); return res.status(200).json(cuerpo); };
  if (!token || !chat) return responde({ ok: false, motivo: 'sin bot' }, 60);

  const hayKV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  let guardado = null;
  try {
    if (hayKV) {
      const [g, espera] = await conTiempo(Promise.all([kv(['GET', 's:members']), kv(['GET', 's:tgwait'])]), 2500);
      guardado = g && g.result ? JSON.parse(g.result) : null;
      const ahora = Date.now() / 1000;
      if (guardado && ahora - guardado.t < 60) return responde({ ok: true, count: guardado.count }, 30);
      if (espera && espera.result) return guardado ? responde({ ok: true, count: guardado.count, guardado: true }, 20) : responde({ ok: false }, 20);
    }

    const r = await conTiempo(fetch(`https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chat)}`).then((x) => x.json()), 15000);
    if (r.ok) {
      if (hayKV) await kv(['SET', 's:members', JSON.stringify({ count: r.result, t: Math.floor(Date.now() / 1000) })]).catch(() => {});
      return responde({ ok: true, count: r.result }, 60);
    }
    const seg = (r.parameters && r.parameters.retry_after) || 0;
    if (seg && hayKV) await kv(['SET', 's:tgwait', '1', 'EX', String(seg + 3)]).catch(() => {});
    console.error('Telegram error', JSON.stringify(r).slice(0, 200));
    return guardado ? responde({ ok: true, count: guardado.count, guardado: true }, 20) : responde({ ok: false }, Math.max(20, seg + 3));
  } catch (e) {
    console.error('members fallo', String(e));
    if (hayKV) await kv(['SET', 's:tgwait', '1', 'EX', '35']).catch(() => {});
    return guardado ? responde({ ok: true, count: guardado.count, guardado: true }, 20) : responde({ ok: false }, 20);
  }
};
