// Webhook do gateway PIX (AbacatePay).
// 1) origem: ?webhookSecret= cadastrado na AbacatePay (ou HMAC do corpo com o mesmo segredo);
// 2) evento de teste (devMode) só é aceito quando a chave configurada também é de teste;
// 3) antes de creditar, a cobrança é conferida na própria AbacatePay (status PAID e mesmo valor);
// 4) registro do evento + crédito numa transação só (svc_webhook_deposit): se falhar, a reentrega funciona.
import { svc, env, hmacHex, safeEqual, abacateDev, abacateCheck } from '../_shared/util.ts';

const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method !== 'POST') return ok({ error: 'método inválido' }, 405);
  const secret = env('ABACATEPAY_WEBHOOK_SECRET'); if (!secret || secret.length < 16) return ok({ error: 'não configurado' }, 503);
  const raw = await req.text();
  if (raw.length > 64_000) return ok({ error: 'grande demais' }, 413);
  const q = new URL(req.url).searchParams.get('webhookSecret') ?? '';
  const sig = (req.headers.get('x-webhook-signature') ?? req.headers.get('x-abacatepay-signature') ?? '').replace(/^sha256=/, '');
  const valid = (q && safeEqual(q, secret)) || (sig && safeEqual(sig, await hmacHex(secret, raw)));
  if (!valid) return ok({ error: 'assinatura inválida' }, 401);
  let ev: any; try { ev = JSON.parse(raw); } catch { return ok({ error: 'json inválido' }, 400); }
  const type = String(ev.event ?? ev.type ?? '');
  if (!/paid/i.test(type)) return ok({ ok: true, ignored: type });
  if (ev.devMode === true && !abacateDev()) return ok({ error: 'evento de teste recusado em produção' }, 400);
  const d = ev.data ?? {}, pix = d.pixQrCode ?? d.billing ?? {};
  const ref = String(pix.id ?? ''); if (!ref) return ok({ error: 'evento sem cobrança' }, 400);
  // confere na AbacatePay: só credita cobrança realmente paga, com o valor que ela informa
  const ck = await abacateCheck(ref);
  if (ck.error) { console.error('check', ref, ck.error); return ok({ error: 'não foi possível conferir agora' }, 503); }
  if (ck.status !== 'PAID') return ok({ error: 'cobrança não está paga', status: ck.status }, 409);
  if (ck.devMode === true && !abacateDev()) return ok({ error: 'cobrança de teste' }, 400);
  const paid = ck.amount ?? Math.round(Number(pix.amount ?? d.payment?.amount ?? 0));
  if (!paid) return ok({ error: 'valor ausente' }, 400);
  const evId = String(ev.id ?? `${type}:${ref}`);
  const r = await svc('svc_webhook_deposit', { p_provider: 'abacatepay', p_event: evId, p_payload: ev, p_ref: ref, p_amount: paid });
  if (r.error) { console.error('webhook_deposit', ref, r.error); return ok({ error: 'revisão manual' }, /deposit_not_found|amount_mismatch|cancelled/.test(r.error) ? 409 : 500); }
  return ok({ ok: true, ...(r.data ?? {}) });
});
