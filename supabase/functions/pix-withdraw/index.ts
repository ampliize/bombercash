// Pedido de saque: só para a chave PIX do tipo CPF do próprio titular (o banco compara o HMAC do CPF).
// Até R$ 100 em conta sem alerta sai como "aprovado"; acima disso vai para revisão do financeiro.
// O envio do PIX é feito pelo financeiro no painel do gateway e marcado como enviado (envio automático entra
// quando a API de saque do gateway for confirmada).
import { cors, json, getUser, svc, hmacHex, digits, cpfValid, env, friendly } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'método inválido' }, 405);
  const pepper = env('CPF_PEPPER'); if (pepper.length < 32) return json(req, { error: 'Saque indisponível: servidor sem configuração.' }, 503);
  const user = await getUser(req); if (!user) return json(req, { error: 'Faça login de novo.' }, 401);
  let b: any; try { b = await req.json(); } catch { return json(req, { error: 'dados inválidos' }, 400); }
  const amount = Math.round(Number(b.amount_cents)), cpf = digits(b.cpf);
  if (!Number.isInteger(amount) || amount < 1000) return json(req, { error: 'O saque mínimo é R$ 10.' }, 400);
  if (!cpfValid(cpf)) return json(req, { error: 'Informe o CPF (chave PIX) do titular.' }, 400);
  const masked = '***.***.' + cpf.slice(6, 9) + '-' + cpf.slice(9);
  const r = await svc('svc_withdrawal_request', { p_user: user.id, p_amount: amount, p_pix_masked: masked, p_pix_cpf_hash: await hmacHex(pepper, cpf) });
  if (r.error) return json(req, { error: friendly(r.error) }, 409);
  return json(req, { ok: true, ...r.data });
});
