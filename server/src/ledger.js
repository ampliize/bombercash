// Adaptador de dinheiro. O servidor de jogo NUNCA mexe em saldo direto: só chama as funções
// svc_* do Supabase (service_role), que usam o razão de partidas dobradas (core.match_*).
// NoopLedger: modo demo/beta sem dinheiro. SupabaseLedger: modo valendo.
export class NoopLedger {
  async open() { return { ok: true }; }
  async settle() { return { ok: true }; }
  async refund() { return { ok: true }; }
  async tokenOpen() { return { ok: true }; }
  async tokenSettle() { return { ok: true }; }
  async tokenRefund() { return { ok: true }; }
}

export class SupabaseLedger {
  constructor({ url, serviceKey, fetchImpl = fetch }) {
    if (!url || !serviceKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no modo dinheiro');
    this.url = url.replace(/\/$/, ''); this.key = serviceKey; this.f = fetchImpl;
  }
  async rpc(fn, args) {
    const r = await this.f(`${this.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: this.key, authorization: `Bearer ${this.key}` }, body: JSON.stringify(args) });
    const body = await r.text();
    if (!r.ok) { const e = new Error(`${fn} ${r.status}: ${body.slice(0, 200)}`); e.status = r.status; throw e; }
    return body ? JSON.parse(body) : null;
  }
  open({ matchId, mode, stakeCents, userIds }) { return this.rpc('svc_match_open', { p_match: matchId, p_mode: mode, p_stake: stakeCents, p_users: userIds }); }
  settle({ matchId, winnerId, seed, resultHash }) { return this.rpc('svc_match_settle', { p_match: matchId, p_winner: winnerId, p_seed: String(seed), p_result_hash: resultHash }); }
  refund({ matchId, reason }) { return this.rpc('svc_match_refund', { p_match: matchId, p_reason: reason }); }
  // ClashToken (moeda do jogo, não é dinheiro): mesma ideia, entrada antes, pote inteiro para o vencedor
  tokenOpen({ matchId, entry, userIds }) { return this.rpc('svc_clash_open', { p_match: matchId, p_entry: entry, p_users: userIds }); }
  tokenSettle({ matchId, winnerId }) { return this.rpc('svc_clash_settle', { p_match: matchId, p_winner: winnerId }); }
  tokenRefund({ matchId, reason }) { return this.rpc('svc_clash_refund', { p_match: matchId, p_reason: reason }); }
}
