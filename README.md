# BomberCash

Demo "entre amigos" (`demo/index.html`): arquivo único feito pelo designer, com fichas virtuais (sem dinheiro real).

## Rodar local
    cd demo && python3 -m http.server 8080   # abrir http://localhost:8080

## Backend do demo
- Supabase (projeto `tuowzfpbpjxknouodzgb`): tabelas `bc_*` com RLS ligado e sem policies; o acesso é só pelas funções RPC `bc_*`.
- A chave no HTML é `sb_publishable_...` (pública por desenho). Nunca colocar `service_role` no front.

## Limites conhecidos do demo (não usar com dinheiro real)
- O resultado da partida é reportado pelo cliente (`bc_report_v3`). No produto, o servidor autoritativo decide (ver PRD, seção 4).
- Saldo de fichas fica no `localStorage`.
