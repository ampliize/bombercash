# BomberCash

Jogo (`demo/index.html`): arquivo único, partidas só entre pessoas, saldo real por PIX.

## Versão final (09/10): só jogadores de verdade
- **Sem bots:** toda partida é entre pessoas. O jogador escolhe modo (1x1, 4 ou 8) e valor, toca em **Procurar partida** e entra na fila do servidor de jogo (`server/src/match.js`); a partida só começa quando a sala enche com gente no mesmo modo e valor. Cancelar sai da fila.
- **Como jogar no celular:** abaixo da prévia "Veja o jogo rodando", dois celulares (em pé e deitado) mostram a partida ao vivo com o controle de cada jeito.
- **Removidos:** sala com amigos por código, convite 1x1 entre amigos, pausa (botão, tecla P e o "+ PAUSA" do controle) e o botão "+ R$ 100 demo". A prévia ao vivo com bots ("Veja o jogo rodando") continua no lobby só como demonstração; nenhuma partida tem bots.
- **Precisa do servidor no ar:** sem o `server/` publicado (Easypanel, com `wss://`), o jogo mostra "Servidor de partidas indisponível". O endereço vai em `window.BC_GS` no `index.html` (ou `?gs=wss://…`).
- Testes: `npm test` (fila real com 2 navegadores + servidor), `npm run test:rules`. Os outros testes usam `__bcSolo()`, um atalho que só existe no mock de teste para exercitar o motor sem servidor.

## Dinheiro real: conta, cadastro com CPF e PIX (AbacatePay)
- **Fluxo:** Procurar partida → (aviso) → **Entrar / Criar conta** (Supabase Auth, e-mail e senha) → **cadastro** (nome, CPF, nascimento, apelido, 18+) → **Depositar** (PIX copia-e-cola e QR) → fila. O saldo exibido é o da carteira em `core` (livro-razão de partidas dobradas); nada fica guardado no aparelho.
- **Edge Functions** (`supabase/functions/`, publicadas com `verify_jwt=false` e autenticação própria):
  - `account`: cria o perfil (o CPF vira hash com `CPF_PEPPER`; só os 4 últimos ficam legíveis).
  - `pix-deposit`: cria a cobrança PIX na AbacatePay e o depósito pendente.
  - `pix-webhook`: recebe `billing.paid`, grava o evento uma vez só e credita a carteira.
  - `pix-withdraw`: pedido de saque, só para o CPF do titular. Exige KYC aprovado, 24 h desde o 1º depósito e rollover. Até R$ 100 é aprovado automaticamente, acima disso vai para revisão.
- **Segredos** (Supabase → Edge Functions → Secrets; nunca no front nem no repositório): `CPF_PEPPER` (32+ caracteres aleatórios), `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`, opcional `ALLOWED_ORIGINS`.
- **Webhook na AbacatePay:** `https://tuowzfpbpjxknouodzgb.supabase.co/functions/v1/pix-webhook?webhookSecret=<o mesmo ABACATEPAY_WEBHOOK_SECRET>`, evento `billing.paid`.
- **Saques:** o envio do PIX é manual (financeiro), marcado com `core.withdrawal_mark_sent`/`withdrawal_mark_failed`. O KYC começa `pending` e é aprovado por `core.kyc_set`.
- **Servidor de jogo:** com `MONEY_MODE=1` exige login (JWT do Supabase via JWKS em `SUPABASE_URL`, ou `SUPABASE_JWT_SECRET` legado) e usa `SUPABASE_SERVICE_KEY` só no servidor.
- Testes: `node money.test.js` (conta → cadastro → PIX simulado → saque). O mock simula Auth, carteira e funções; `/__pay` marca os PIX como pagos.

## Passo a passo do primeiro login
- No primeiro login de cada conta (depois do cadastro), abre um passo a passo de 6 telas: objetivo e prêmio, movimento, bombas (alcance 1), itens, como funciona a partida (fila, contagem, sem pausa, duelo na lava) e saldo/PIX com jogo responsável.
- **Pular passo a passo** em qualquer tela; Voltar/Próximo; no fim, "Começar a jogar" segue para o depósito ou para a fila. Fica lembrado por conta neste aparelho (`bc_tut_<id>`). O botão **?** no topo reabre quando quiser.
- Teste: `npm run test:tutorial`.

## Modo demo (para testar o sistema)
- Botão **🧪 Testar no modo demo** no lobby, ou abrir com `?demo` (ex.: `https://bombercash.vercel.app/?demo`).
- Saldo virtual de R$ 100 (botão **+ R$ 100 demo** recarrega), guardado só no aparelho. Não precisa de login nem do servidor de jogo.
- A partida começa na hora contra bots, com a mesma regra de entrada e prêmio (−20%). O resultado não vai para o ranking.
- **Sair do demo** volta ao modo real (login, saldo da carteira, fila só com pessoas).
- Teste: `npm run test:demo`.

## ClashToken (moeda de ouro do Bomber Clash) e sala dourada
- **Coleta:** 1 ClashToken a cada 24 horas para cada conta, contadas a partir da última coleta; o horário da próxima aparece no relógio de Brasília e a carteira mostra a contagem regressiva (migração `20261010200000_clash_claim_24h.sql`, já aplicada). Precisa de login e cadastro (CPF), para ninguém criar contas só para juntar tokens. A janela "Coleta diária" abre sozinha uma vez por dia no lobby, e o botão **Coletar** na carteira abre quando quiser.
- **Sala dourada "Mata-mata 4 · ClashToken":** entrada de 6 ClashTokens por jogador; a partida começa com 4 pessoas. O vencedor **não recebe tokens**: os 24 do pote viram **R$ 2,00 no saldo**, pagos automaticamente pelo caixa da empresa (conta `house_rake`) no fim da partida. Empate ou queda devolve a entrada.
- **Troca direta:** 6 ClashTokens por R$ 2,00 no saldo (botão na janela de coleta, função `clash_exchange`). Vale por 3 semanas a partir de cada recarga de R$ 10,00 ou mais; passou da 3ª semana, precisa de nova recarga mínima (migração `20261010220000_clash_exchange_deposit_window.sql`, já aplicada).
- **Depósito para a sala dourada:** só entra quem fez pelo menos 1 depósito de R$ 10,00 ou mais nas últimas 3 semanas (21 dias). A regra vale só para a sala dourada; as partidas valendo dinheiro seguem só com saldo. Migração `20261010210000_clash_cash_exchange.sql`, já aplicada.
- ClashToken não é dinheiro: não se compra nem se saca. Fica em `core.clash_wallets`/`core.clash_log`/`core.clash_matches` (migração `20261010190000_clash_tokens.sql`, já aplicada). O jogador só lê o saldo e coleta (`clash_status`, `clash_claim`); quem tira a entrada e paga o pote é o servidor de jogo (`svc_clash_open/settle/refund`, só `service_role`).
- **Servidor de jogo:** a sala `4x4t` só abre quando o servidor tem `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` (mesmo sem `MONEY_MODE`). Sem essas variáveis, mostra "sala ClashToken indisponível".
- **Demo:** começa com 6 ClashTokens no aparelho, coleta diária local e o botão **+ 6 ClashTokens demo**.
- **Visual:** carteira com saldo, ClashTokens, Depositar e Sacar um abaixo do outro, acabamento dourado; valores sempre com centavos (R$ 2,00 … R$ 100,00); "Valor por partida" em destaque.
- Teste: `npm run test:clash`.

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
**Tela cheia:** no jogo a animação abre com `start.html?fit=fill`: ela cobre a tela inteira (sem faixas nas laterais), cortando só céu e chão, nunca a logo, a tela do fliperama ou o JOGUE AGORA. Só em monitor ultralargo (21:9) sobra uma faixa desfocada nas laterais.
**Reserva:** se a animação não ficar pronta em 6s, entra o vídeo `assets/start-L.mp4` / `start-P.mp4` (12s em loop, troca ao girar a tela; tocar na tela abre o aviso). Se o navegador não tocar o vídeo, sobra a abertura antiga (logo com raios).
**Trilha:** música original do BomberCash, composta para o jogo e gerada ao vivo com WebAudio (chiptune 8-bit, Ré maior, 132 BPM, 16 compassos; pulso 25% na melodia, triângulo no baixo, arpejo e bateria de ruído). Não usa arquivo nem música de terceiros, então não tem direito autoral a pagar. Toca na tela inicial, no lobby e nos resultados (o navegador só libera som depois do primeiro toque); dentro da partida entra a música do jogo. O volume é o de Configurações → Música (0 desliga).
Teste: `npm run test:start` (animação carrega, JOGUE AGORA abre o 18+, trilha toca e para na partida, reserva sem a animação).

## Prêmio: 20% da casa
Em toda partida a casa fica com 20% da soma das entradas e o vencedor leva o resto (ex.: 1x1 de R$ 10 → R$ 20 − 20% = R$ 16; 4 jogadores de R$ 5 → R$ 20 − 20% = R$ 16). O demo usa `RAKE=.2` em `demo/index.html` (cartões dos modos, detalhe do modo, convite, histórico, "Como jogar" e tela de resultado); com dinheiro de verdade quem calcula é o banco (`core.match_settle`, `rake_bps=2000`).

## Empate: duelo na lava
Se o tempo acabar com 2+ de pé, ou se os últimos morrerem no mesmo instante, a partida **não empata**: começa um duelo de morte súbita só entre os finalistas, num mapa exclusivo de lava (basalto rachado, lava em volta, poucos pilares e caixas, tudo espelhado). Todos voltam com os poderes zerados e mais velocidade (140), cada um num canto, contagem de 3s. Aos 5s a lava começa a entrar por um ponto sorteado e fecha a arena casa por casa até o centro, então alguém sempre cai primeiro; se empatar de novo, há outro duelo. Vale contra bots, na sala com amigos e no servidor (`server/src/sim.js`), onde o vencedor do duelo é quem recebe o prêmio. Testes: `npm run test:duel` e os testes do servidor.

## Recorte do mapa
Quando a câmera aproxima (celular em pé), a janela mostra um número inteiro de blocos e a câmera para sempre alinhada à grade: nenhum bloco aparece cortado pela metade na beirada, e na borda do mapa a parede de fora aparece inteira. Se o mapa inteiro quase cabe (celular deitado, celulares grandes), o jogo mostra o mapa todo em vez de aproximar.

## Fim de partida, perfil e controles
- **Tela final detalhada:** resumo da partida (modo, mapa ou "Duelo na lava", duração, entradas, banca de 20% e prêmio) e a classificação de todos os participantes: posição (1º, 2º…; quem morreu por último fica na frente), boneco usado na partida, nome (Você / Bot / Jogador), eliminações e o prêmio de cada um (o 1º recebe a soma das entradas − 20%; os outros R$ 0, com o saldo da partida em verde/vermelho). Na sala com amigos, bots aparecem "sem entrada".
- **Ícone do perfil:** 10 opções (os 6 bonecos, a sigla BC, a bomba e os mapas Castelo e Selva), escolhidas em Seu perfil; ficam salvas no aparelho e aparecem no topo do lobby.
- **Direcional:** Configurações → Direcional: **Analógico** ou **Setas** (cruz de 4 botões; a seta apertada acende). Vale também no editor de posição.
- **Cores dos controles:** 12 paletas só para os controles (painéis, analógico/setas e BOMBA): Clássico, Neon, Ouro, Floresta, Gelo, Lava, Retrô, Doce e 4 com arte dos mapas (Castelo, Selva, Laboratório, Ilhas).
- **Mapas no mesmo tamanho:** todos usam a borda de blocos inteira, como o Castelo (sem moldura decorativa), então nenhum bloco some e todos medem 15×13 (21×15 no 8 jogadores).
- **Movimento nos trilhos:** o boneco anda centralizado no corredor e, se bater numa quina, escorrega sozinho para a faixa livre (até ~60% de bloco), como no Bomberman clássico. A mesma regra está no servidor (`walkStep`).
- Teste: `npm run test:custom` (setas, paletas, ícones, classificação e prêmio).

## Bloqueio de captura de tela
A página escurece por completo (tela preta por cima de tudo) quando alguém começa um atalho de print: **Cmd+Shift** no Mac (antes do 3/4/5) e **Win+Shift** no Windows (antes do S do Recorte); **PrintScreen** apaga a tela por ~2s e limpa a área de transferência; quando a janela perde o foco ou a aba some (ferramenta de recorte, gravador de tela, troca de app no celular) a tela fica preta até voltar; imprimir (Ctrl+P) sai preto. Botão direito e arrastar imagem ficam bloqueados no jogo.
**Limite honesto:** nenhum site consegue impedir o print do sistema. No Windows a tecla PrintScreen sozinha chega ao navegador depois que a imagem já foi tirada, e no celular o print pelos botões físicos nem chega ao navegador. Bloqueio de verdade (tela preta no print e na gravação) só no app nativo: Android com `FLAG_SECURE` (dá para empacotar este PWA com TWA/Capacitor); no iPhone dá para detectar o print, não impedir. Teste: `npm run test:shield`.

## Regras e telas (09/10)
- **Bomba inicial:** alcance de 1 bloco para cada lado (cada item de fogo soma 1, até 7). Vale no jogo, no duelo e no servidor.
- **Mapa sempre aleatório:** saiu a escolha de mapa do modo e da prévia; toda partida sorteia o mapa.
- **Fundo do lobby:** arte da arena (`demo/assets/bg-arena.webp`) com um véu escuro por cima; as bombas flutuando continuam.
- **Aviso de jogo responsável:** ao escolher o valor da partida, e antes da 1ª partida/sala/convite de cada sessão, aparece o aviso "JOGUE COM RESPONSABILIDADE"; o Confirmar só libera depois de marcar "Li o aviso e vou jogar com responsabilidade".
- **Sair do jogo:** botão ⏻ no topo do lobby; confirma, encerra a partida/sala e volta para a tela inicial (no app instalado tenta fechar a janela).
- **Ranking e IDs zerados:** os IDs agora têm 7 dígitos (0000001 a 9999999). No banco, as tabelas antigas ficaram guardadas como arquivo (`bc_*_arq_20261009`, ver `supabase/demo-ops/`); quem já tinha ID recebe um novo no próximo acesso.
- Teste: `npm run test:rules`.

