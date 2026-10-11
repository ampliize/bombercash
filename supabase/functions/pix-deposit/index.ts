// Depósito PIX: cria a cobrança no gateway (AbacatePay) e registra no razão como pendente.
// O saldo só entra quando o webhook do gateway confirmar o pagamento (pix-webhook).
import { cors, json, getUser, svc, env, friendly, abacateDev } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'método inválido' }, 405);
  const key = env('ABACATEPAY_API_KEY'); if (!key) return json(req, { error: 'Depósito por PIX ainda não está disponível.' }, 503);
  const user = await getUser(req); if (!user) return json(req, { error: 'Faça login de novo.' }, 401);
  let b: any; try { b = await req.json(); } catch { return json(req, { error: 'dados inválidos' }, 400); }
  // só com chave de TESTE da AbacatePay: simula o pagamento de uma cobrança do próprio jogador (a AbacatePay manda o webhook de teste)
  if (b.simulate) {
    if (!abacateDev()) return json(req, { error: 'Simulação só existe no modo de teste.' }, 403);
    const mine = await svc('svc_deposit_owner', { p_ref: String(b.simulate), p_user: user.id });
    if (mine.data !== true) return json(req, { error: 'Cobrança não encontrada.' }, 404);
    const s = await fetch(`https://api.abacatepay.com/v1/pixQrCode/simulate-payment?id=${encodeURIComponent(String(b.simulate))}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
    const sj = await s.json().catch(() => ({}));
    return json(req, s.ok ? { ok: true, status: (sj.data ?? sj)?.status } : { error: 'A AbacatePay recusou a simulação.' }, s.ok ? 200 : 502);
  }
  const amount = Math.round(Number(b.amount_cents));
  if (!Number.isInteger(amount) || amount < 1000 || amount > 500000) return json(req, { error: 'Valor entre R$ 10 e R$ 5.000.' }, 400);
  // só cria cobrança para conta ativa e no máximo 5 pendentes em 30 minutos (evita spam no gateway)
  const can = await svc('svc_deposit_can_create', { p_user: user.id });
  if (can.error) return json(req, { error: 'Não foi possível agora. Tente de novo.' }, 500);
  if (can.data !== true) return json(req, { error: 'Complete seu cadastro ou pague os PIX já gerados antes de criar outro.' }, 429);
  const ref = crypto.randomUUID();
  const g = await fetch('https://api.abacatepay.com/v1/pixQrCode/create', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount, expiresIn: 3600, description: 'BomberCash - deposito', metadata: { externalId: ref } }),
  });
  const gj = await g.json().catch(() => ({}));
  const d = gj && (gj.data ?? gj);
  if (!g.ok || !d || !d.id || !d.brCode) { console.error('abacatepay', g.status, JSON.stringify(gj).slice(0, 300)); return json(req, { error: 'O gateway PIX não respondeu. Tente de novo.' }, 502); }
  const expires = d.expiresAt ?? new Date(Date.now() + 3600e3).toISOString();
  const r = await svc('svc_deposit_create', { p_user: user.id, p_amount: amount, p_gateway: 'abacatepay', p_ref: String(d.id), p_qr: String(d.brCode), p_expires: expires });
  if (r.error) return json(req, { error: friendly(r.error) }, 409);
  return json(req, { id: r.data, ref: String(d.id), test: abacateDev(), amount_cents: amount, brCode: d.brCode, qr: d.brCodeBase64 ?? null, expiresAt: expires });
});
