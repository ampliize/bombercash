-- Demo: zera ranking e IDs sem apagar dados. As tabelas antigas viram arquivo (bc_*_arq_20261009),
-- entram tabelas novas vazias com a mesma estrutura (RLS ligado, sem policies; acesso só pelas RPC bc_*).
-- Aplicada no Supabase em 2026-10-09 junto com 20261009183500 (que corrigiu a numeração de identidade herdada).
alter table public.bc_friends rename to bc_friends_arq_20261009;
alter table public.bc_invites rename to bc_invites_arq_20261009;
alter table public.bc_matches rename to bc_matches_arq_20261009;
alter table public.bc_players rename to bc_players_arq_20261009;
create table public.bc_players (like public.bc_players_arq_20261009 including all);
create table public.bc_matches (like public.bc_matches_arq_20261009 including all);
create table public.bc_invites (like public.bc_invites_arq_20261009 including all);
create table public.bc_friends (like public.bc_friends_arq_20261009 including all);
alter table public.bc_matches add foreign key (player_id) references public.bc_players(id) on delete cascade;
alter table public.bc_friends add foreign key (player_id) references public.bc_players(id) on delete cascade;
alter table public.bc_friends add foreign key (friend_id) references public.bc_players(id) on delete cascade;
alter table public.bc_invites add foreign key (from_id) references public.bc_players(id) on delete cascade;
alter table public.bc_invites add foreign key (to_id) references public.bc_players(id) on delete cascade;
alter table public.bc_players enable row level security;
alter table public.bc_matches enable row level security;
alter table public.bc_invites enable row level security;
alter table public.bc_friends enable row level security;
alter table public.bc_players_arq_20261009 enable row level security;
alter table public.bc_matches_arq_20261009 enable row level security;
alter table public.bc_invites_arq_20261009 enable row level security;
alter table public.bc_friends_arq_20261009 enable row level security;
