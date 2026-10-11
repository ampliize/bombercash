# Backend (Supabase) · núcleo financeiro

Migrações em `supabase/migrations/` (ordem numérica) — **aplicadas no projeto Supabase em 09/10/2026** e idênticas ao que está no banco (mesmos nomes e versões; as 39 funções têm o mesmo hash de corpo que o banco local testado).
Elas não tocam nas tabelas `bc_*` do demo; tudo novo vive no schema `core` (não exposto pela API) e em funções `public.*` novas (`my_*`, `admin_*`).

| Migração | O que faz |
|---|---|
| `core_schema` | perfis (CPF único por hash, 18+), papéis e permissões por ação, configurações (rake etc.), **ledger imutável de dupla entrada**, auditoria append-only, limites de jogo responsável |
| `core_money_a_utils_deposits` | utilitários (`post_txn` idempotente), cadastro/KYC/bloqueio, depósito PIX e webhooks sem duplicar |
| `core_money_b_withdrawals` | saque (carência, rollover, mesmo CPF, aprovação híbrida), revisão, enviado/falhou |
| `core_money_c_affiliates_matches` | afiliados (70% do rake da 1ª partida do indicado), escrow e liquidação de partida (**rake 20%**), reembolso, comissões |
| `core_money_d_settings_roles` | mudança de configuração com **segunda aprovação**; papéis com revogação por `revoked_at` (histórico preservado, sem `DELETE`) |
| `public_api_and_grants` | leitura do jogador (`my_wallet`, `my_ledger`…), painel (`admin_*`, cada ação confere o papel) e permissões: **o cliente nunca move dinheiro** |
| `core_harden_trigger_search_path` | `search_path` fixo nas funções de gatilho (apontado pelo auditor do Supabase) |

> A ferramenta de migração do Supabase trava (e estoura o prazo) quando o SQL contém `DELETE`, por pedir confirmação de comando destrutivo. Por isso a revogação de papel é uma marcação (`revoked_at`), o que também é melhor para auditoria.

## Regras que o banco garante (não dependem do front)
- Valores em centavos inteiros; cada transação do ledger soma zero (checado no commit); linhas nunca são editadas ou apagadas (triggers bloqueiam UPDATE/DELETE/TRUNCATE); corrigir = estorno.
- Saldo de jogador nunca fica negativo; saldo insuficiente aborta a partida inteira (sem escrow parcial).
- Todo lançamento tem `idem_key`: repetir webhook, liquidação ou saque não duplica.
- Saque só com KYC aprovado, chave PIX do **mesmo CPF**, carência após o 1º depósito, rollover, limite diário; pequeno e limpo sai automático, o resto vai para revisão manual; quem pede não revisa o próprio saque.
- Percentuais (rake, afiliado, limites) só mudam com pedido de um admin e **aprovação de outra pessoa**; vale só para partidas futuras; tudo vai para `audit_log`.
- `anon` e `authenticated` não leem nem escrevem em `core.*` e não executam funções de dinheiro; só `service_role` (servidor de jogo / Edge Functions) executa `core.*`.

## Testar localmente
`bash supabase/tests/run-local.sh` sobe um Postgres descartável (precisa dos binários do Postgres 15+), simula os papéis e o `auth.uid()` do Supabase, aplica as migrações e roda `supabase/tests/core.test.sql` (depósito, escrow, rake, afiliado, saque, aprovação dupla, imutabilidade e permissões por papel).

## Estado do banco real (verificado após aplicar)
18 tabelas em `core`, todas com RLS e **sem nenhuma permissão** para `anon`/`authenticated` (nem tabela, nem função, nem schema); o servidor (`service_role`) executa as funções de negócio mas não o lançamento cru (`post_txn`); `rake_bps = 2000`; o demo seguiu intacto (36 jogadores, 107 partidas). Os avisos que o auditor ainda mostra são esperados: `public.my_*`/`admin_*` são `SECURITY DEFINER` por desenho (só `authenticated`, cada uma confere o papel) e as tabelas `core` sem política são o desenho (acesso só pelas funções).

## Fora do escopo desta etapa
Servidor de jogo autoritativo (Colyseus), Edge Functions do gateway PIX/KYC (o provedor ainda não foi confirmado), regras completas de jogo responsável (a tabela `rg_limits` existe, falta aplicar limites no depósito) e o painel admin.
