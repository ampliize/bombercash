// Webhook do gateway PIX. Só aceita se o segredo bater (parâmetro ?webhookSecret= cadastrado na AbacatePay
// ou assinatura HMAC-SHA256 do corpo). Cada evento é registrado uma vez (idempotente) antes de mexer no saldo.
import { svc, env, hmacHex, safeEqual } from '../_shared/util.ts';

const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method !== 'POST') return ok({ error: 'método inválido' }, 405);
  const secret = env('ABACATEPAY_WEBHOOK_SECRET'); if (!secret) return ok({ error: 'não configurado' }, 503);
  const raw = await req.text();
  const q = new URL(req.url).searchParams.get('webhookSecret') ?? '';
  const sig = (req.headers.get('x-webhook-signature') ?? req.headers.get('x-abacatepay-signature') ?? '').replace(/^sha256=/, '');
  const valid = (q && safeEqual(q, secret)) || (sig && safeEqual(sig, await hmacHex(secret, raw)));
  if (!valid) return ok({ error: 'assinatura inválida' }, 401);
  let ev: any; try { ev = JSON.parse(raw); } catch { return ok({ error: 'json inválido' }, 400); }
  const evId = String(ev.id ?? ev.eventId ?? crypto.randomUUID());
  const first = await svc('svc_webhook_record', { p_provider: 'abacatepay', p_event: evId, p_payload: ev });
  if (first.error) return ok({ error: 'falha ao registrar' }, 500);
  if (first.data === false) return ok({ ok: true, repeated: true });
  const type = String(ev.event ?? ev.type ?? '');
  if (/paid/i.test(type)) {
    const d = ev.data ?? {}, pix = d.pixQrCode ?? d.billing ?? d;
    const ref = String(pix.id ?? d.id ?? ''), paid = Math.round(Number(pix.amount ?? d.payment?.amount ?? pix.paidAmount ?? 0));
    if (!ref || !paid) return ok({ error: 'evento sem cobrança' }, 400);
    const r = await svc('svc_deposit_confirm', { p_gateway_ref: ref, p_paid_cents: paid });
    if (r.error) { console.error('deposit_confirm', ref, r.error); return ok({ error: 'revisão manual' }, 409); }
  }
  return ok({ ok: true });
});
