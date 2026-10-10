// Utilidades das Edge Functions do BomberCash. Segredos só em variáveis de ambiente do Supabase:
// CPF_PEPPER (HMAC do CPF), ABACATEPAY_API_KEY, ABACATEPAY_WEBHOOK_SECRET, ALLOWED_ORIGINS (opcional).
const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  const allow = !ORIGINS.length ? '*' : ORIGINS.includes(o) ? o : ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// Confere o login do jogador no próprio Supabase Auth (funciona com chave legada ou com chaves de assinatura novas).
export async function getUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { authorization: auth, apikey: ANON || SERVICE } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email } : null;
}

// Chama uma função public.svc_* com a chave de serviço (só o servidor tem).
export async function svc(fn: string, args: Record<string, unknown>): Promise<{ data?: any; error?: string }> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SERVICE, authorization: `Bearer ${SERVICE}` }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) { let m = t; try { const e = JSON.parse(t); m = e.message || e.hint || t; } catch { /* texto puro */ } return { error: String(m) }; }
  return { data: t ? JSON.parse(t) : null };
}

export async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0;
}
export const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export function cpfValid(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +c[9] && dv(10) === +c[10];
}
export const env = (k: string) => Deno.env.get(k) ?? '';
// mensagens do banco -> texto para o jogador
export function friendly(e: string): string {
  const M: Record<string, string> = {
    below_min_deposit: 'O depósito mínimo é R$ 10.', account_not_active: 'Sua conta não está ativa.', kyc_required: 'Seu cadastro ainda está em verificação.',
    pix_owner_mismatch: 'A chave PIX precisa ser o CPF do titular da conta.', below_min_withdraw: 'O saque mínimo é R$ 10.', withdraw_hold: 'O primeiro saque libera 24h depois do primeiro depósito.',
    rollover_not_met: 'Jogue pelo menos o valor depositado antes de sacar.', daily_limit: 'Limite diário de saque atingido.', insufficient_funds: 'Saldo insuficiente.',
    profile_not_found: 'Complete seu cadastro primeiro.',
  };
  for (const k of Object.keys(M)) if (e.includes(k)) return M[k];
  if (e.includes('cpf_hash')) return 'Este CPF já tem uma conta.';
  if (e.includes('nickname')) return 'Esse apelido já está em uso.';
  if (e.includes('profiles_pkey')) return 'Seu cadastro já foi feito.';
  return 'Não foi possível concluir agora. Tente de novo.';
}
