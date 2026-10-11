# BomberCash · Auditoria de pré-lançamento (11/10/2026)

Levantamento feito em três frentes: banco e Edge Functions (Supabase), servidor de partidas e site, e pesquisa de mercado/legal/infra.
Nada disto é parecer jurídico.

## 0. Bloqueio legal (decidir antes de ligar dinheiro de verdade)
- **MP 1.394/2026** (DOU 25/09/2026) proíbe em todo o país a operação, oferta, intermediação e publicidade de apostas de quota fixa e jogos on-line; plataformas tiveram de sair do ar até 06/10. Resoluções do Banco Central mandam bancos e meios de pagamento **bloquear PIX/TED/boleto para apostas**. Divulgar apostas virou infração (atinge influenciadores).
- Não há fonte classificando **jogo de habilidade PvP** (resultado pela habilidade, não sorte) dentro da MP. É zona cinzenta, e hoje a fiscalização e os bancos estão tratando qualquer "aposta dinheiro, ganha dinheiro" como bet.
- A **AbacatePay** aparenta listar "cassinos, apostas ou sorteios" entre os usos não aceitos (não confirmado nos termos). Risco real de conta congelada.
- **Recomendação:** pré-lançamento **só com demo multijogador (fichas virtuais)**; dinheiro real desligado até (1) parecer de advogado de games/meios de pagamento e (2) confirmação por escrito da AbacatePay. Até lá, nada de afiliados/influenciadores falando em "ganhar dinheiro".

## 1. O que já está pronto
- Jogo completo: 1x1 (online e com amigo), 4, 8, sala dourada ClashToken; contagem, morte súbita, duelo na lava, mapas sorteados, celular vertical/horizontal, passo a passo, perfil, ranking, demo local contra bots.
- Servidor autoritativo: o cliente só envia direção e bomba (sem speed/teleport hack), fila por modo+valor, sala privada 1x1, partida verificável por hash.
- Banco: livro-caixa de partidas dobradas imutável e idempotente, escrow, rake 20%, saque com KYC/mesmo CPF/carência/rollover/revisão, aprovação dupla de configurações, auditoria, ClashToken. Nenhuma rota deixa o jogador mover dinheiro.
- PIX: Edge Functions de cadastro, depósito, webhook e saque publicadas (aguardando a chave).

## 2. Achados de segurança (prioridade)
### Crítico
1. **Partida decidida pelo cronômetro de inatividade** (servidor): o limite de inatividade (9 s) vence antes do fim da contagem (10 s) e derruba quem não mandou comando no 1º instante. **Corrigido nesta rodada.**
2. **Link `?gs=` rouba o login**: qualquer link com outro servidor fazia o site enviar o token do jogador para lá. **Corrigido.**
3. **Webhook do PIX credita só pelo conteúdo do aviso** e aceita evento de teste (`devMode`); se o segredo vazar, dá para criar saldo. **Corrigido:** confere a cobrança na AbacatePay (`/pixQrCode/check`) antes de creditar e recusa eventos de teste em produção.
### Alto
4. **Dinheiro preso no escrow** se o servidor cair/reiniciar, se a resposta do banco se perder ou se a liquidação falhar; e quem fica com partida "aberta" não consegue jogar de novo. **Corrigido:** tempo-limite nas chamadas, tentativa de reembolso e varredura automática que devolve partidas abertas há mais de 10 minutos.
5. **Uma conta derruba as salas dos outros** (sem saldo/KYC entra na fila e a sala aborta). **Corrigido:** checagem de elegibilidade antes da fila, uma fila/sala por usuário.
6. **ClashToken paga dinheiro do caixa sem teto** (vira lucro com CPFs "laranja"). **Mitigado:** exige KYC aprovado e teto diário global; decisão pendente: tratar como bônus não sacável.
7. **Sala 1x1 com amigo permite passar dinheiro** (um perde de propósito). Precisa de limites e monitoramento (pares repetidos, partidas sem comandos). **Parcial:** teto diário por par a definir.
### Médio
8. Queda durante a abertura fazia o outro ganhar sem jogar. **Corrigido** (vira cancelamento com reembolso).
9. Servidor podia rodar "sem dinheiro" mostrando R$. **Corrigido** (em produção falha fechado).
10. Sem limite de conexões/tempo para se identificar. **Corrigido.**
11. Eventos de webhook podiam se perder em falha temporária. **Corrigido** (só marca como processado depois de creditar).
12. CPF validado só pelo dígito; cadastro sem limite de tentativas; ações antes do KYC. Ver seção 4.
13. Funções `bc_*` do ranking abertas: o próprio cliente informa vitória (ranking forjável). Sem impacto em dinheiro hoje; mover para o servidor antes de dar prêmio por ranking.
14. Sem CSP/anti-clickjacking no site. **Corrigido** (cabeçalhos na Vercel).
### Baixo
Escapar campos do ranking no HTML (corrigido), `aud/iss` no JWT, semente dos itens previsível, proteção de senha vazada desligada no Supabase (ligar no painel), índice em `core.deposits(user_id, paid_at)` (criado), tabelas `bc_*_arq` antigas para apagar.

## 3. Arquitetura de buscar partida e cobrança
- Entrar na fila **não cobra nada**. Quando a sala enche, o servidor pede ao banco para tirar a entrada de **todos de uma vez** e prender no escrow; se um não tiver saldo, ninguém é cobrado e a sala recomeça.
- Fim da partida: vencedor recebe o total − 20% na hora; empate devolve.
- O reembolso é obrigatório mesmo assim (servidor cair no meio, queda antes do jogo): agora é automático pela varredura de 10 minutos.

## 4. KYC sem custo (recomendado para o MVP)
1. Nome completo, CPF e nascimento no cadastro; CPF válido e 18+ conferidos; 1 conta por CPF (já existe).
2. **Saque só para chave PIX tipo CPF igual ao da conta** (já existe): a rede PIX amarra o dinheiro ao dono do CPF.
3. A AbacatePay **não informa o CPF de quem pagou** no webhook, então não dá para checar titularidade no depósito.
4. Verificação paga só no 1º saque ou acima de um valor (Didit ~US$ 0,20/consulta, ou Serpro Consulta CPF v3 que confere CPF + nascimento).

## 5. Infra para o lançamento
- Site: Vercel (ok).
- **Servidor de partidas não roda na Vercel** (WebSocket em função tem duração máxima de 300–800 s e sem estado compartilhado). Opções em São Paulo: **Fly.io região `gru`** (~US$ 2/mês) ou VPS SP com Easypanel/Coolify (R$ 25–50/mês). Sem ele, só o demo contra bots funciona.
- Supabase: banco, contas e Edge Functions (ok).

## 6. Demo público de 72 h multijogador (como o mercado faz)
- Igual às mesas de "play money" do pôquer: **fila separada**, moeda virtual que **nunca** vira dinheiro, recarga diária gratuita, ranking próprio.
- Proposta: ao criar conta (só e-mail, sem CPF), o jogador ganha fichas demo e **72 h** de acesso ao demo multijogador contra outras pessoas; depois disso continua o demo contra bots e é convidado a completar o cadastro. Limite de contas por aparelho/IP.

## 7. Afiliação (blogueiros) e indicação (qualquer jogador)
- **Afiliados:** pagar % do rake gerado pelos indicados (ex.: 20–30% por 6–12 meses), com mínimo de qualificação (depósito + N partidas) e retenção de 30 dias; link/código próprio; painel com cliques, cadastros, depósitos e comissão. Já existe a base no banco (70% do rake da 1ª partida) — revisar o modelo.
- **Indicação:** bônus só depois do 1º depósito e de partidas jogadas pelo indicado, pago como crédito para jogar (não sacável); bloquear mesmo CPF, aparelho, IP e chave PIX; marcar quem só joga contra quem indicou.
- Com a MP, publicidade de apostas é infração: afiliados só depois da validação jurídica.

## 8. Painel admin (MVP)
Aprovar KYC, ver e aprovar/recusar saques e marcar como enviados, bloquear conta, ver partidas presas/abertas e reembolsar, ver depósitos e webhooks, relatórios de rake, ClashToken e afiliados, alterar configurações (com segunda aprovação, já existente no banco).

## 9. Projeções (custos fixos mínimos)
- Infra: Vercel grátis, Supabase grátis até ~500 MB / 50 mil usuários ativos (Pro US$ 25/mês), servidor de jogo US$ 2–10/mês.
- PIX: R$ 0,80 por depósito recebido; saques R$ 0,80 (20 primeiros/mês) e R$ 2,50 depois.
- Receita: 20% do total de entradas. Ex.: 1x1 de R$ 5 = R$ 2 de rake por partida; 1.000 partidas/dia ≈ R$ 2.000/dia de rake bruto, menos taxas PIX, ClashToken e afiliados.
- ClashToken custa até R$ 2,00 a cada 6 dias por conta ativa elegível: limitar por teto diário.

## 10. Ordem de trabalho proposta
1. (feito) Correções críticas e altas de segurança.
2. Publicar o servidor de partidas (Fly.io gru) e ligar `window.BC_GS`.
3. Demo multijogador 72 h (fila separada, fichas virtuais) — pré-lançamento.
4. Painel admin MVP.
5. Testar AbacatePay em modo dev (cobrança, simular pagamento, webhook) — sem ligar dinheiro real em produção.
6. Parecer jurídico + confirmação AbacatePay → ligar dinheiro real.
7. Indicação e afiliados.
