// Cadastro do jogador (uma vez por conta): nome, CPF válido (uma conta por CPF), 18+, apelido.
// O CPF nunca é guardado em claro: vai só o HMAC (CPF_PEPPER) e os 4 últimos dígitos.
import { cors, json, getUser, svc, hmacHex, digits, cpfValid, env, friendly } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'método inválido' }, 405);
  const pepper = env('CPF_PEPPER'); if (pepper.length < 32) return json(req, { error: 'Cadastro indisponível: servidor sem configuração.' }, 503);
  const user = await getUser(req); if (!user) return json(req, { error: 'Faça login de novo.' }, 401);
  let b: any; try { b = await req.json(); } catch { return json(req, { error: 'dados inválidos' }, 400); }
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim(), cpf = digits(b.cpf), nick = String(b.nick ?? '').trim(), birth = String(b.birth ?? '');
  if (name.length < 3 || name.length > 120 || !/^[\p{L} '.-]+$/u.test(name)) return json(req, { error: 'Informe seu nome completo.' }, 400);
  if (!cpfValid(cpf)) return json(req, { error: 'CPF inválido.' }, 400);
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return json(req, { error: 'Apelido: 3 a 16 letras, números ou _.' }, 400);
  const bd = new Date(birth + 'T00:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || isNaN(+bd)) return json(req, { error: 'Data de nascimento inválida.' }, 400);
  const lim = new Date(); lim.setUTCFullYear(lim.getUTCFullYear() - 18);
  if (bd > lim) return json(req, { error: 'Proibido para menores de 18 anos.' }, 403);
  const r = await svc('svc_profile_create', { p_user: user.id, p_cpf_hash: await hmacHex(pepper, cpf), p_last4: cpf.slice(-4), p_name: name, p_birth: birth, p_nick: nick });
  if (r.error) return json(req, { error: friendly(r.error) }, 409);
  return json(req, { ok: true });
});
