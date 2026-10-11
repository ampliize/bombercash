# Operações no banco do demo (tabelas `bc_*`)
As tabelas `bc_*` do demo foram criadas fora das migrações do núcleo (`supabase/migrations`), então estes scripts
ficam aqui e **não** rodam no `tests/run-local.sh`. Já foram aplicados no Supabase em 2026-10-09:
- `20261009183000_bc_reset_ranking_and_ids.sql` e `20261009183500_bc_reset_ids_identity.sql`: zeram ranking e IDs.
  Nada foi apagado: os dados antigos ficaram em `bc_*_arq_20261009` (e `bc_*_tmp_20261009`, só 1 linha de teste).
  O próximo jogador recebe o ID 1 (o jogo mostra 0000001) e o limite é 9999999.
