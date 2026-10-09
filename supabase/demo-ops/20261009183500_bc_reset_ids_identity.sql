-- A troca anterior herdou a identidade antiga (IDs 100000+). Refaz as tabelas vazias e reinicia:
-- jogador 1..9999999 (o jogo mostra com 7 dígitos: 0000001). As tabelas *_tmp_20261009 só têm 1 linha de teste.
alter table public.bc_friends rename to bc_friends_tmp_20261009;
alter table public.bc_invites rename to bc_invites_tmp_20261009;
alter table public.bc_matches rename to bc_matches_tmp_20261009;
alter table public.bc_players rename to bc_players_tmp_20261009;
create table public.bc_players (like public.bc_players_arq_20261009 including all);
create table public.bc_matches (like public.bc_matches_arq_20261009 including all);
create table public.bc_invites (like public.bc_invites_arq_20261009 including all);
create table public.bc_friends (like public.bc_friends_arq_20261009 including all);
alter table public.bc_players alter column id restart with 1;
alter table public.bc_players alter column id set minvalue 1;
alter table public.bc_players alter column id set maxvalue 9999999;
alter table public.bc_matches alter column id restart with 1;
alter table public.bc_invites alter column id restart with 1;
alter table public.bc_matches add foreign key (player_id) references public.bc_players(id) on delete cascade;
alter table public.bc_friends add foreign key (player_id) references public.bc_players(id) on delete cascade;
alter table public.bc_friends add foreign key (friend_id) references public.bc_players(id) on delete cascade;
alter table public.bc_invites add foreign key (from_id) references public.bc_players(id) on delete cascade;
alter table public.bc_invites add foreign key (to_id) references public.bc_players(id) on delete cascade;
alter table public.bc_players enable row level security;
alter table public.bc_matches enable row level security;
alter table public.bc_invites enable row level security;
alter table public.bc_friends enable row level security;
alter table public.bc_players_tmp_20261009 enable row level security;
alter table public.bc_matches_tmp_20261009 enable row level security;
alter table public.bc_invites_tmp_20261009 enable row level security;
alter table public.bc_friends_tmp_20261009 enable row level security;
