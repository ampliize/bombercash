import { createHmac, timingSafeEqual, createPublicKey, verify as cverify } from 'node:crypto';
const b64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function claims(c, now) {
  if (!c || !c.sub || (c.exp && c.exp * 1000 < now) || c.role !== 'authenticated') return null;
  const md = c.user_metadata || {};
  return { id: c.sub, auth: true, name: String(md.nickname || md.nick || (c.email || 'Jogador').split('@')[0]).slice(0, 16) };
}

// HS256 com o segredo legado do projeto (SUPABASE_JWT_SECRET). Síncrono; usado nos testes.
export function verifyJwt(token, secret, now = Date.now()) {
  try {
    const [h, p, s] = String(token).split('.'); if (!h || !p || !s || !secret) return null;
    if (JSON.parse(b64(h)).alg !== 'HS256') return null;
    const want = createHmac('sha256', secret).update(h + '.' + p).digest(), got = b64(s);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    return claims(JSON.parse(b64(p)), now);
  } catch { return null; }
}

// Chaves de assinatura novas do Supabase (ES256/RS256): busca o JWKS público e guarda por 10 min.
let jwks = { at: 0, keys: [] };
async function loadJwks(url, fetchImpl) {
  if (Date.now() - jwks.at < 600000 && jwks.keys.length) return jwks.keys;
  const r = await fetchImpl(url.replace(/\/$/, '') + '/auth/v1/.well-known/jwks.json');
  if (!r.ok) throw new Error('jwks ' + r.status);
  const j = await r.json(); jwks = { at: Date.now(), keys: j.keys || [] }; return jwks.keys;
}
export async function verifyToken(token, { secret, supabaseUrl, fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    const [h, p, s] = String(token).split('.'); if (!h || !p || !s) return null;
    const hd = JSON.parse(b64(h));
    if (hd.alg === 'HS256') return verifyJwt(token, secret, now);
    if (!supabaseUrl || !['ES256', 'RS256'].includes(hd.alg)) return null;
    const keys = await loadJwks(supabaseUrl, fetchImpl), jwk = keys.find(k => k.kid === hd.kid) || (keys.length === 1 ? keys[0] : null);
    if (!jwk) return null;
    const key = createPublicKey({ key: jwk, format: 'jwk' }), data = Buffer.from(h + '.' + p), sig = b64(s);
    const ok = hd.alg === 'ES256' ? cverify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig) : cverify('RSA-SHA256', data, key, sig);
    return ok ? claims(JSON.parse(b64(p)), now) : null;
  } catch { return null; }
}
