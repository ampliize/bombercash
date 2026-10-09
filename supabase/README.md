# Backend (Supabase) · núcleo financeiro

Migrações em `supabase/migrations/` (ordem numérica). **Ainda não aplicadas no projeto Supabase do demo** — só depois de revisão.
Elas não tocam nas tabelas `bc_*` do demo; tudo novo vive no schema `core` (não exposto pela API) e em funções `public.*` novas.

| Migração | O que faz |
|---|---|
| `0001_core_schema` | perfis (CPF único por hash, 18+), papéis e permissões por ação, configurações (rake etc.), **ledger imutável de dupla entrada**, auditoria append-only, limites de jogo responsável |
| `0002_core_money` | depósito PIX idempotente, saque (carência, rollover, mesmo CPF, aprovação híbrida), escrow e liquidação de partida (**rake 20%**, vencedor leva o resto), reembolso, afiliado (70% do rake da 1ª partida do indicado), mudança de configuração com **segunda aprovação** |
| `0003_public_api_and_grants` | leitura do jogador (`my_wallet`, `my_ledger`…), painel (`admin_*`, cada ação confere o papel) e permissões: **o cliente nunca move dinheiro** |

## Regras que o banco garante (não dependem do front)
- Valores em centavos inteiros; cada transação do ledger soma zero (checado no commit); linhas nunca são editadas ou apagadas (triggers bloqueiam UPDATE/DELETE/TRUNCATE); corrigir = estorno.
- Saldo de jogador nunca fica negativo; saldo insuficiente aborta a partida inteira (sem escrow parcial).
- Todo lançamento tem `idem_key`: repetir webhook, liquidação ou saque não duplica.
- Saque só com KYC aprovado, chave PIX do **mesmo CPF**, carência após o 1º depósito, rollover, limite diário; pequeno e limpo sai automático, o resto vai para revisão manual; quem pede não revisa o próprio saque.
- Percentuais (rake, afiliado, limites) só mudam com pedido de um admin e **aprovação de outra pessoa**; vale só para partidas futuras; tudo vai para `audit_log`.
- `anon` e `authenticated` não leem nem escrevem em `core.*` e não executam funções de dinheiro; só `service_role` (servidor de jogo / Edge Functions) executa `core.*`.

## Testar localmente
`bash supabase/tests/run-local.sh` sobe um Postgres descartável (precisa dos binários do Postgres 15+), simula os papéis e o `auth.uid()` do Supabase, aplica as migrações e roda `supabase/tests/core.test.sql` (depósito, escrow, rake, afiliado, saque, aprovação dupla, imutabilidade e permissões por papel).

## Fora do escopo desta etapa
Servidor de jogo autoritativo (Colyseus), Edge Functions do gateway PIX/KYC (o provedor ainda não foi confirmado), regras completas de jogo responsável (a tabela `rg_limits` existe, falta aplicar limites no depósito) e o painel admin.
