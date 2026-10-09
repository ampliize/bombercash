import { createHmac, timingSafeEqual } from 'node:crypto';
const b64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Valida o JWT do Supabase (HS256) e devolve { id, name } ou null. Sem segredo configurado só o modo demo funciona.
export function verifyJwt(token, secret, now = Date.now()) {
  try {
    const [h, p, s] = String(token).split('.'); if (!h || !p || !s) return null;
    if (JSON.parse(b64(h)).alg !== 'HS256') return null;
    const want = createHmac('sha256', secret).update(h + '.' + p).digest(), got = b64(s);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const c = JSON.parse(b64(p));
    if (!c.sub || (c.exp && c.exp * 1000 < now) || c.role !== 'authenticated') return null;
    return { id: c.sub, name: (c.user_metadata && c.user_metadata.nickname) || 'Jogador' };
  } catch { return null; }
}
