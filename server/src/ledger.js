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
  async canPlay() { return { ok: true }; }
  async canClash() { return { ok: true }; }
}

export class SupabaseLedger {
  constructor({ url, serviceKey, fetchImpl = fetch }) {
    if (!url || !serviceKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no modo dinheiro');
    this.url = url.replace(/\/$/, ''); this.key = serviceKey; this.f = fetchImpl;
  }
  // chamada com tempo-limite (8 s): o servidor nunca fica parado esperando o banco
  async rpc(fn, args) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await this.f(`${this.url}/rest/v1/rpc/${fn}`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', apikey: this.key, authorization: `Bearer ${this.key}` }, body: JSON.stringify(args) });
      const body = await r.text();
      if (!r.ok) { const e = new Error(`${fn} ${r.status}: ${body.slice(0, 200)}`); e.status = r.status; throw e; }
      return body ? JSON.parse(body) : null;
    } finally { clearTimeout(t); }
  }
  // liquidação e reembolso são idempotentes no banco: dá para repetir com segurança (3 tentativas: 0 s, 1 s, 3 s)
  async retry(fn, args) {
    let last;
    for (const wait of [0, 1000, 3000]) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      try { return await this.rpc(fn, args); } catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e; }
    }
    throw last;
  }
  canPlay({ userId, stakeCents }) { return this.rpc('svc_can_play', { p_user: userId, p_stake: stakeCents }); }
  canClash({ userId, entry }) { return this.rpc('svc_clash_can_play', { p_user: userId, p_entry: entry }); }
  open({ matchId, mode, stakeCents, userIds }) { return this.rpc('svc_match_open', { p_match: matchId, p_mode: mode, p_stake: stakeCents, p_users: userIds }); }
  settle({ matchId, winnerId, seed, resultHash }) { return this.retry('svc_match_settle', { p_match: matchId, p_winner: winnerId, p_seed: String(seed), p_result_hash: resultHash }); }
  refund({ matchId, reason }) { return this.retry('svc_match_refund', { p_match: matchId, p_reason: reason }); }
  // ClashToken (moeda do jogo, não é dinheiro): mesma ideia, entrada antes, pote inteiro para o vencedor
  tokenOpen({ matchId, entry, userIds }) { return this.rpc('svc_clash_open', { p_match: matchId, p_entry: entry, p_users: userIds }); }
  tokenSettle({ matchId, winnerId }) { return this.retry('svc_clash_settle', { p_match: matchId, p_winner: winnerId }); }
  tokenRefund({ matchId, reason }) { return this.retry('svc_clash_refund', { p_match: matchId, p_reason: reason }); }
}
