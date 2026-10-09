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

### Sala no servidor de jogo (autoritativo)
Abra o jogo com `?gs=wss://SEU-SERVIDOR` (fica salvo no aparelho; `?gs=off` volta ao modo antigo). A sala com amigos passa a rodar no `server/`:
o código vira 4 dígitos, quem criou toca em Começar (2 a 4 pessoas, sem bots), o servidor move os bonecos, explode as bombas e decide o vencedor.
O aparelho só manda direção/bomba e corrige a própria posição pelo estado do servidor (mexer no boneco pelo console não adianta).
Teste: suba o mock (`npm run mock` em `tests/e2e`) e rode `npm run test:server` (sobe o servidor na porta 2599 e joga com 2 navegadores).

## Ajustes de tela e controles (Configurações)
Disponíveis no lobby e durante a partida (engrenagem). Ficam salvos no aparelho (`localStorage`, chave `bc_cfg`):
- Mostrar controle na tela; sensibilidade e tamanho do analógico; **analógico flutuante** (aparece onde o dedo toca).
- **Tamanho da tela do jogo** (60% a 100% do máximo que cabe) e **tamanho do botão BOMBA** (70% a 150%).
- **Inverter lados** (analógico à direita, bomba à esquerda) e vibração ao tocar.
- "Voltar ao padrão" restaura tudo.

Responsividade: o layout usa `dvh`, `safe-area` e `visualViewport`, os diálogos rolam por dentro em telas baixas e a barra do topo se compacta abaixo de 380px (Galaxy Fold, 280px). Teste: `npm run test:responsive` em `tests/e2e` (14 tamanhos, de 280x653 a 2560x1080, no padrão e com as opções ligadas; confere sobra de rolagem, sobreposição, controles fora da tela e lado invertido).

## Visão do jogo no celular, zoom e som
- **Celular deitado:** a barra do topo flutua sobre os painéis e a arena usa quase toda a altura (16% a 22% maior que antes; os painéis de botões encolhem sozinhos, sem cobrir a arena). Em pé, o jogo mostra a dica para girar o celular. Ao iniciar a partida o jogo tenta **tela cheia + horizontal** (Android/Chrome; o iPhone não permite, então só a dica aparece). Dá para desligar em Configurações.
- **Contagem antes da partida:** toda partida (bots, sala com amigos, servidor) começa com 10 segundos na tela (10…1 e "VAI!", com bipes). Durante a contagem ninguém anda nem solta bomba e o relógio fica em 2:30. Teste: `npm run test:count`.
- **Câmera automática:** se o mapa inteiro deixaria cada bloco pequeno demais (celular), o jogo aproxima até o bloco ter 34px (30px com mouse) e a câmera segue o seu boneco, sem passar da borda do mapa. Em pé o bloco foi de ~25px para 34px. Deitado (e em celulares grandes) o mapa inteiro já quase cabe, então o jogo mostra tudo sem cortar a borda. Tablet e PC continuam vendo o mapa inteiro. Configurações → **Câmera automática** desliga (volta a mostrar o mapa inteiro).
- **Layout personalizado:** o mapa fica centralizado na tela inteira (largura toda em pé, altura toda deitado) e a página não rola; o editor de controles mostra o mapa de verdade nessa mesma posição, para você ver o que o analógico e a bomba cobrem.
- **Sem zoom por toque duplo ou pinça** durante a partida (viewport `user-scalable=no`, `touch-action: manipulation` e bloqueio de gestos).
- **Som:** efeitos sintetizados (explosão, bomba, item, caveira, escudo, morte, alarme de morte súbita, vitória e derrota) e música em loop (Lá menor, 128 BPM, acelera para 156 na morte súbita), gerados com WebAudio, sem arquivos nem direitos autorais. Configurações → **Som**: volume da música (0 desliga) e dos efeitos; o botão SOM silencia tudo. Pausa e aba em segundo plano suspendem o áudio.
- Testes: `npm run test:responsive` (tamanhos 280x653 a 2560x1080, barra sobre a arena, lado invertido), `npm run test:camera` (bloco >=34px no celular, câmera seguindo, mapa centralizado, editor) e `npm run test:audio` (música, efeitos, mudo, volume e bloqueio de zoom).

## Posição dos controles (cada jogador monta o seu)
Configurações → **Posição dos controles** → *Personalizar posição dos controles*: abre um editor em tela cheia onde dá para **arrastar o analógico, o botão BOMBA e a barra de menu** para qualquer lugar, com sliders de transparência e de tamanho. **Em pé e deitado guardam posições separadas.** No modo personalizado a arena usa o máximo da tela e os controles flutuam semitransparentes por cima. *Salvar* grava no aparelho (`bc_cfg.pos`), *Cancelar* descarta, *Restaurar* volta ao padrão; o switch "Layout personalizado" liga e desliga sem perder as posições. Teste: `npm run test:layout`.

## Tela inicial (fliperama animado) e trilha da interface
A tela inicial é a animação do designer, `demo/start.html`: a logomarca entra com explosão, a câmera abre no fliperama com uma partida simulada ao vivo na telinha (dá para soltar bomba tocando na tela dele) e o botão **JOGUE AGORA** abre o aviso 18+ (confirmação obrigatória). Ela roda num `iframe` em cima do jogo e avisa o jogo por `postMessage({type:'bombercash:play'})`. Arte: `demo/assets/start-L.webp` (deitado), `start-P.webp` (em pé) e `start-logo.webp`, tiradas do arquivo original (antes embutidas em base64).
**Reserva:** se a animação não ficar pronta em 6s, entra o vídeo `assets/start-L.mp4` / `start-P.mp4` (12s em loop, troca ao girar a tela; tocar na tela abre o aviso). Se o navegador não tocar o vídeo, sobra a abertura antiga (logo com raios).
**Trilha:** música original do BomberCash, composta para o jogo e gerada ao vivo com WebAudio (chiptune 8-bit, Ré maior, 132 BPM, 16 compassos; pulso 25% na melodia, triângulo no baixo, arpejo e bateria de ruído). Não usa arquivo nem música de terceiros, então não tem direito autoral a pagar. Toca na tela inicial, no lobby e nos resultados (o navegador só libera som depois do primeiro toque); dentro da partida entra a música do jogo. O volume é o de Configurações → Música (0 desliga).
Teste: `npm run test:start` (animação carrega, JOGUE AGORA abre o 18+, trilha toca e para na partida, reserva sem a animação).

## Empate: duelo na lava
Se o tempo acabar com 2+ de pé, ou se os últimos morrerem no mesmo instante, a partida **não empata**: começa um duelo de morte súbita só entre os finalistas, num mapa exclusivo de lava (basalto rachado, lava em volta, poucos pilares e caixas, tudo espelhado). Todos voltam com os poderes zerados e mais velocidade (140), cada um num canto, contagem de 3s. Aos 5s a lava começa a entrar por um ponto sorteado e fecha a arena casa por casa até o centro, então alguém sempre cai primeiro; se empatar de novo, há outro duelo. Vale contra bots, na sala com amigos e no servidor (`server/src/sim.js`), onde o vencedor do duelo é quem recebe o prêmio. Testes: `npm run test:duel` e os testes do servidor.

## Recorte do mapa
Quando a câmera aproxima (celular em pé), a janela mostra um número inteiro de blocos e a câmera para sempre alinhada à grade: nenhum bloco aparece cortado pela metade na beirada, e na borda do mapa a parede de fora aparece inteira. Se o mapa inteiro quase cabe (celular deitado, celulares grandes), o jogo mostra o mapa todo em vez de aproximar.
