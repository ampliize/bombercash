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

## Sala com amigos (2 a 4 humanos online)
No lobby, botão **Sala com amigos**: um jogador cria a sala e passa o código de 5 letras; os outros entram com o código. Até 4 humanos jogam juntos e as vagas vazias viram bots. O prêmio é a entrada × número de humanos, tudo para o vencedor (fichas virtuais).

Como funciona (demo): o anfitrião simula a partida e manda o estado 10x por segundo pelo Supabase Realtime (canal de broadcast `bc-rm-<código>`); cada convidado move o próprio boneco e informa posição e bombas. O código de rede está em `demo/index.html` (engine: `netRecv`, `guestUpdate`; lobby: bloco "sala com amigos").

### Teste automatizado (3 navegadores, servidor Realtime simulado)
    cd tests/e2e && npm i && npm run mock &   # servidor local na porta 8765
    CHROME_PATH=/caminho/do/chrome npm test    # cria sala, entra com 2, joga, termina e confere o prêmio
O mock substitui o Supabase só no servidor de teste; o arquivo do demo não muda.
