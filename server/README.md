# Servidor de jogo (autoritativo)

Node 20+ e `ws` puro (sem Colyseus: o protocolo é pequeno e o resto das regras já está em `sim.js`).
O cliente só manda **intenção** (`{t:'in',dx,dy,bomb}`); o servidor move, solta bombas, explode, mata e decide o vencedor.
Mapa/itens saem de um PRNG semeado (`seed`), então a partida é reproduzível: `resultHash` = sha256(seed, mapa, entradas, vencedor).

| Arquivo | Papel |
|---|---|
| `src/sim.js` | regras (porte do demo): mapa simétrico, bombas, itens, morte súbita, snapshot no formato do demo |
| `src/room.js` | sala, loop 30 Hz, snapshot 15 Hz, desconexão = derrota, abre/liquida/reembolsa no caixa |
| `src/ledger.js` | `NoopLedger` (sem dinheiro) e `SupabaseLedger` (chama `public.svc_match_*` com a service key) |
| `src/auth.js` | valida JWT do Supabase (HS256) |
| `src/index.js` | WebSocket + `/health` |

## Protocolo (JSON)
cliente → `hello {name | token}`, `create {mode:'1x1'|'4x4'|'8x8', stake}`, `join {code}`, `start` (só quem criou, ≥2 pessoas), `in {dx,dy,bomb}`
servidor → `hello`, `joined`, `lobby {names,you}`, `start {seed,map,W,H,n,w,br,names,skins}`, `snap {s}`, `end {winner,resultHash,settled}`, `abort`, `error`

## Variáveis de ambiente (Easypanel)
`PORT` · `COUNTDOWN` (segundos de contagem antes de liberar os bonecos; padrão 10) · `ALLOWED_ORIGINS` (domínios do front, separados por vírgula) · `MONEY_MODE=1` + `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` + `SUPABASE_JWT_SECRET`.
Sem `MONEY_MODE` só rodam salas de brincadeira (sem saldo). **A service key só existe no servidor, nunca no front nem no repositório.**

## Dinheiro
Pré-requisito: migration `20261009140000_public_svc_game_server.sql` (aplicada no Supabase em 2026-10-09; só `service_role` executa).
Fluxo: sala cheia → `svc_match_open` (escrow; se alguém não cobre, ninguém joga) → partida → `svc_match_settle` (80/20, afiliado) ou `svc_match_refund` (empate/queda do servidor). Falha ao liquidar fica no log para revisão e a partida continua `open` no razão.

## Testes
`npm i && npm test`
