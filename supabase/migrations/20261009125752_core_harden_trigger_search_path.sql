-- Reforço apontado pelo auditor do Supabase: funções de gatilho com search_path fixo.
alter function core.check_txn_balanced() set search_path = '';
alter function core.apply_entry() set search_path = '';
alter function core.forbid_mutation() set search_path = '';
