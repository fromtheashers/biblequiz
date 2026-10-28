/**
 * The Worker: the front door of "Bible or Not?".
 *
 *   /ws        WebSocket for phones (?role=player) and the host screen (?role=host&key=...),
 *              handed to the one GameRoom Durable Object.
 *   /host      The host page, only with ?key=HOST_KEY (also guards /host.html).
 *   /qr.svg    QR code of the join address (this site's own address, or PUBLIC_URL).
 *   /healthz   "ok".
 *   anything else: the files in public/ (public/index.html is the phone page).
 *
 * questions.json is bundled into the code (see game-room.js) and is never served.
 */
import QRCode from 'qrcode';
import { GameRoom, keyMatches, hostKeyOf } from './game-room.js';

export { GameRoom };

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function text(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS, ...extra },
  });
}

function page(title, message, status) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222;background:#fff}
@media (prefers-color-scheme:dark){body{color:#eee;background:#111}}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS },
  });
}

// "/host", "/host/", "/HOST.html", "/host/index.html", "/%68ost" ... all count as the host page.
function normalPath(pathname) {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  p = p.toLowerCase().replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}
const HOST_PATHS = new Set(['/host', '/host.html', '/host/index.html', '/host/index']);

function joinUrl(request, env) {
  const raw = typeof env.PUBLIC_URL === 'string' ? env.PUBLIC_URL.trim() : '';
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin + u.pathname.replace(/\/*$/, '/');
    } catch {
      /* fall through to the request's own address */
    }
  }
  return new URL(request.url).origin + '/';
}

const qrCache = new Map();
async function qrSvg(url) {
  if (!qrCache.has(url)) {
    if (qrCache.size > 20) qrCache.clear();
    qrCache.set(url, await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  }
  return qrCache.get(url);
}

async function hostPage(request, env, url) {
  const secret = hostKeyOf(env);
  if (!secret) {
    return page(
      'Host key not set',
      'The game has no host key yet. In the Cloudflare dashboard open this Worker, go to <b>Settings</b> → <b>Variables and Secrets</b>, add a <b>Secret</b> named <code>HOST_KEY</code> with a secret word of your choice, then open <code>/host?key=</code><i>your word</i>.',
      503
    );
  }
  if (!(await keyMatches(url.searchParams.get('key') || '', secret))) {
    return page(
      'Wrong link',
      'This host link is wrong or incomplete. Use the full host link, which ends in <code>/host?key=</code> followed by your host key. Players should open the main address instead.',
      403
    );
  }
  // Fetch the asset directly (this does not pass through the Worker again).
  const res = await env.ASSETS.fetch(new Request(new URL('/host', url.origin), { method: 'GET' }));
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalPath(url.pathname);
    if (path === null) return text('Bad request.', 400);

    if (path === '/ws') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return text('Expected a WebSocket upgrade.', 426);
      }
      const role = url.searchParams.get('role');
      if (role !== 'player' && role !== 'host') return text('Unknown role.', 400);
      if (role === 'host' && !(await keyMatches(url.searchParams.get('key') || '', hostKeyOf(env)))) {
        return text('Wrong or missing host key.', 403);
      }
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('main'));
      return stub.fetch(request);
    }

    if (HOST_PATHS.has(path)) return hostPage(request, env, url);

    if (path === '/qr.svg') {
      // Always the site's own join address: query parameters are ignored.
      try {
        return new Response(await qrSvg(joinUrl(request, env)), {
          headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache', ...BASE_HEADERS },
        });
      } catch (e) {
        console.error('QR code failed', e);
        return text('Could not make the QR code.', 500);
      }
    }

    if (path === '/healthz') return text('ok');

    if (path === '/questions.json' || path.endsWith('/questions.json')) return text('Not found.', 404);

    return env.ASSETS.fetch(request);
  },
};
