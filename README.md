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

## Ajustes de tela e controles (Configurações)
Disponíveis no lobby e durante a partida (engrenagem). Ficam salvos no aparelho (`localStorage`, chave `bc_cfg`):
- Mostrar controle na tela; sensibilidade e tamanho do analógico; **analógico flutuante** (aparece onde o dedo toca).
- **Tamanho da tela do jogo** (60% a 100% do máximo que cabe) e **tamanho do botão BOMBA** (70% a 150%).
- **Inverter lados** (analógico à direita, bomba à esquerda) e vibração ao tocar.
- "Voltar ao padrão" restaura tudo.

Responsividade: o layout usa `dvh`, `safe-area` e `visualViewport`, os diálogos rolam por dentro em telas baixas e a barra do topo se compacta abaixo de 380px (Galaxy Fold, 280px). Teste: `npm run test:responsive` em `tests/e2e` (14 tamanhos, de 280x653 a 2560x1080, no padrão e com as opções ligadas; confere sobra de rolagem, sobreposição, controles fora da tela e lado invertido).

## Visão do jogo no celular, zoom e som
- **Celular deitado:** a barra do topo flutua sobre os painéis e a arena usa quase toda a altura (16% a 22% maior que antes; os painéis de botões encolhem sozinhos, sem cobrir a arena). Em pé, o jogo mostra a dica para girar o celular. Ao iniciar a partida o jogo tenta **tela cheia + horizontal** (Android/Chrome; o iPhone não permite, então só a dica aparece). Dá para desligar em Configurações.
- **Sem zoom por toque duplo ou pinça** durante a partida (viewport `user-scalable=no`, `touch-action: manipulation` e bloqueio de gestos).
- **Som:** efeitos sintetizados (explosão, bomba, item, caveira, escudo, morte, alarme de morte súbita, vitória e derrota) e música em loop (Lá menor, 128 BPM, acelera para 156 na morte súbita), gerados com WebAudio, sem arquivos nem direitos autorais. Configurações → **Som**: volume da música (0 desliga) e dos efeitos; o botão SOM silencia tudo. Pausa e aba em segundo plano suspendem o áudio.
- Testes: `npm run test:responsive` (tamanhos 280x653 a 2560x1080, barra sobre a arena, lado invertido) e `npm run test:audio` (música, efeitos, mudo, volume e bloqueio de zoom).

## Posição dos controles (cada jogador monta o seu)
Configurações → **Posição dos controles** → *Personalizar posição dos controles*: abre um editor em tela cheia onde dá para **arrastar o analógico, o botão BOMBA e a barra de menu** para qualquer lugar, com sliders de transparência e de tamanho. **Em pé e deitado guardam posições separadas.** No modo personalizado a arena usa o máximo da tela e os controles flutuam semitransparentes por cima. *Salvar* grava no aparelho (`bc_cfg.pos`), *Cancelar* descarta, *Restaurar* volta ao padrão; o switch "Layout personalizado" liga e desliga sem perder as posições. Teste: `npm run test:layout`.

## Tela inicial animada
A abertura começa **só na logomarca** (zoom + máscara suave + anel dourado), a câmera recua e a revelação abre em círculo até o fliperama, o mapa e o ambiente; centelhas, brilho na logo e pulso no "JOGUE AGORA" ficam em loop leve. Toque em qualquer momento acelera até o fim e abre o aviso de 18+ (a confirmação continua obrigatória); a saída faz um zoom de entrada no fliperama. `prefers-reduced-motion` mostra só o quadro final.

**Arte:** `demo/assets/splash-h.webp` (horizontal, 1672x941) e `demo/assets/splash-v.webp` (vertical, 941x1672, com a faixa 18+), ~450 KB cada, já no repositório. O jogo escolhe pela orientação da tela e preenche as laterais com a própria arte desfocada, então nada é cortado; se as imagens não carregarem em ~3,5 s, cai na abertura antiga. Os pontos da arte usados pela animação (centro e retângulo da logo, painel "JOGUE AGORA", centro da tela do fliperama) foram **medidos nos pixels da arte** e estão na tabela `G` da função `splash()` em `demo/index.html`, em frações da imagem; se a arte for trocada por outra de proporção diferente, ajuste esses números.
Testes: `python3 make-placeholder-art.py <pasta>` gera arte provisória só para teste; com `ASSETS_DIR=<pasta> npm run mock` rodam `npm run test:splash` (fluidez, toque, giro, reduzir movimento) e `splash-frames.js` (quadros). Sem `ASSETS_DIR`, `npm run test:splash-fallback` confere a abertura antiga.
