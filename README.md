# Futebol 2D Online

▶ **JOGUE AGORA NO NAVEGADOR:** https://e-football-2d.onrender.com/ ⚽
&nbsp;&nbsp;*(espelho:* https://fracaropedro-collab.github.io/jogo-efotboll-2d/ *)*

---

Jogo de futebol 2D com física real e multiplayer online, com planejamento completo do MVP.

Inspirado em **Ball 2D: Soccer Online** (Steam, 2017) — futebol 2D top-down, 100% física — evoluindo para um jogo com identidade própria: IA, matchmaking, progresso/ELO, replays e, principalmente, **power-ups**.

---

## 🎯 Visão

Partidas rápidas de futebol 2D, físicas e competitivas, jogáveis em segundos.

O núcleo (bola, chute, defesa) é o de sempre; o diferencial é a profundidade jogável: **controle de bola**, **defesa ativa**, **recursos** e **power-ups com contra-jogo**.

---

## 🏟️ Referência e promessa

- **Fortemente influenciado por:** Ball 2D — simplicidade, reflexo, profundidade mecânica, física.
- **O que resolvemos que o Ball 2D não resolveu:** bots, matchmaking, progresso/ELO, replays, poderes.
- **Filosofia:** profundidade ≠ quantidade de botões.

---

## 🌐 Modo Online (implementado)

O jogo tem **1v1 online por código** com servidor autoritativo — a mesma simulação de física que roda no navegador (`shared/sim.js`) também roda no servidor (`server/`), o que garante partidas idênticas dos dois lados.

**Como jogar online:**
1. Um jogador clica em **🌐 Online 1v1 → ➕ Criar sala** e recebe um código (ex.: `S2D-A7K2`)
2. O outro clica em **Online 1v1 → 🔑 Entrar** e digita o código
3. Quando os dois entram, a partida começa — placar, relógio, power-ups e revanche funcionam ao vivo (snapshots a 30 Hz, simulação a 60 Hz)

**Rodando localmente:**
```bash
cd server
npm install
node server.js          # http://localhost:3000  (PORT=8080 node server.js para outra porta)
```
O servidor também serve os arquivos estáticos do jogo — não precisa de outra hospedagem.

**Hospedando no seu servidor (produção):**
1. Tenha Node.js 18+ instalado
2. Copie o repositório para o servidor e rode `cd server && npm install`
3. Suba o processo com `PORT=3000 node server.js` — de preferência atrás de um proxy com HTTPS (nginx/caddy) e um supervisor (systemd ou pm2). Exemplo com systemd:
   ```ini
   [Unit]
   Description=E-FOOTBALL 2D server
   After=network.target
   [Service]
   WorkingDirectory=/opt/jogo-efotboll-2d
   Environment=PORT=3000
   ExecStart=/usr/bin/node server/server.js
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
4. No nginx, faça proxy de `https://seu-dominio` → `http://127.0.0.1:3000` (o jogo e o WebSocket sobem na mesma porta)
5. No jogo, em **Online 1v1 → Servidor**, aponte para `wss://seu-dominio` (salvo no navegador)

> O GitHub Pages hospeda apenas o cliente (estático) — o modo online precisa deste servidor rodando. O campo "Servidor" do jogo lembra o endereço configurado.

**Limitações atuais (pós-MVP):** sem reconexão automática se cair, sem quick match/matchmaking, sem ELO — salas por código apenas. Re revanche: os dois clicam em **Revanche** na tela de fim de partida.

**Arquitetura real do código:**
```
index.html      cliente completo (renderização, HUD, menu, contas locais)
shared/sim.js   simulação determinística compartilhada (física, chutes, power-ups)
server/server.js  WebSocket autoritativo: salas, sim 60 Hz, snapshots 30 Hz,
                  validação de inputs + também serve os arquivos estáticos
```

---

## ✅ Escopo do MVP

### Dentro

1. 1v1 online (servidor autoritativo, por código) — já implementado ✔ (quick match ainda não).
2. Treino vs IA (3 dificuldades) — já implementado ✔.
3. Sala por código + quick match simples.
4. **1v1 local por sala (código + editor: poderes permitidos, duração até 15 min, gols até 15) — já implementado ✔.**
5. Conta convidada (apelido).
5. HUD, placar, kickoff, fim de partida, revanche.
6. Replay (últimos 10 s), stats básicas, leaderboard/ELO, ajustes, tutorial.

### Fora (pós-MVP)

2v2/3v3, loja/cosméticos, temporadas, clubes, espectador, mobile, editor de mapas, torneios, chat de voz.

---

## 📐 Especificações de gameplay

Mundo em **metros**; render escala 1 m ≈ 32 px.

| Item | Valor inicial |
| --- | --- |
| Campo | 30 × 16 m, paredes com restituição 0,7 |
| Gol | 4 m × 1,2 m (sensor) |
| Jogador | círculo r = 0,45 m, damping linear 1,5 |
| Bola | círculo r = 0,22 m, damping 0,35 |
| Velocidade máx. | 6,5 m/s; aceleração 28 m/s² |
| Chute | segurar Espaço carrega 0→1 em 0,6 s; impulso 8–18 m/s |
| Aftertouch | manter direção após soltar aplica curva por 0,3 s |
| Plantar | segurar Ctrl trava o corpo (massa ×3, imune a empurrão) |

- **Sem dash/tackle básico:** o dash foi removido do movimento padrão (não acrescentava à profundidade). A disputa física forte agora acontece **só via power-up**: o **Carrinho** é a jogada agressiva de roubo/impacto (ver power-ups).
- **Sem eixo Z:** a bola nunca passa por cima/atravessa jogadores. Substituto terrestre do "chapéu": **elástico** (toque lateral rápido).
- **Partida:** 3 min, primeiro a 5 gols, empate → gol de ouro.

---

## 🎮 Controles (padrão)

| Tecla | Ação |
| --- | --- |
| WASD / setas | mover |
| Espaço (tap) | toque rápido |
| Espaço (hold) | chute carregado |
| Ctrl (hold) | plantar |
| E | elástico (toque lateral) |
| Q | ativar power-up |

---

## ⚡ Power-ups — decisão final do MVP

**Kit: 4 poderes iniciais. Power-ups aparecem no campo (círculos coloridos); quem tocar primeiro guarda 1 (sem stack) e ativa com `Q`.**

### Kit inicial

| Poder | Efeito | Counter |
| --- | --- | --- |
| **Foguete** | Próximo chute 1,8× mais rápido e reto | Muralha (fixa/bloqueia), corpo, desviar da linha |
| **Turbo** | +40% velocidade e recuperação por 3 s | Piche, paredes, esperar acabar |
| **Carrinho** | Investida agressiva: expulsa a bola na direção do movimento, empurra o adversário com stun de 1,5 s; pequeno tempo de recuperação se errar tudo | Distância, timing, plantar no caminho |
| **Muralha** | Espawn fixo no campo do usuário, perto do gol aliado: obstáculo pequeno (~2 m) de ~6 s que bloqueia bola e jogadores | Foguete e Carrinho quebram em cheio; pontas do gol ficam abertas; chutes com curva contornam |

Detalhes do Carrinho: velocidade de investida acima do frame de corrida (~15 m/s por ~0,45 s), telegrafado; quebra a Muralha em impacto cheio.
Detalhes da Muralha: posicionamento **automático** (sem mira); não imuniza quem a criou; empurra suavemente quem estiver em cima do ponto de espawn.

Regras: tecla **Q** para ativar; sem stack (1 poder por jogador por vez); não atravessa jogadores; não controla adversário; não marca gol sozinho.

### Catálogo (completo, pós-MVP)

- **Ofensivos (vermelho):** Foguete, Bola de Chumbo, Míssil, Ímã, Canhão de Ar, Bomba.
- **Mobilidade (verde):** Turbo, Salto, Gigante, Formiga, Patins.
- **Defensivos (azul):** Escudo, Espinhos, Piche, Contra-golpe.
- **Controle/caos (roxo/cinza):** Ladrão, Jammer, Portais, Nevoeiro, Inversão, Troca, Buraco Negro, Dupla Bola, Mina.

---

## 🤖 IA

Máquina de estados: chase → position → shoot → clear. Dificuldades ajustam atraso (80/150/250 ms), erro angular (±2°/±7°/±14°) e velocidade máxima (100%/92%/85%).

**A IA usa todos os power-ups, com critério e chance por dificuldade (quase nunca no Fácil, quase sempre na hora certa no Difícil):**

| Poder | Quando a IA ativa |
| --- | --- |
| Foguete | Está com a bola e perto do gol adversário, com ângulo de finalização |
| Turbo | Perseguindo a bola longe (recuperação) ou carregando a bola fugindo da marcação |
| Carrinho | O adversário tem a posse e está ao alcance da investida |
| Muralha | Recuada na defesa — em especial se o adversário tem Foguete armado |

A IA também **busca power-ups de propósito** quando não estiver em urgência defensiva.

---

## 🏗️ Stack e arquitetura

```
ball-arena/ (pnpm workspaces)
├── apps/client     Vite + TS + PixiJS 8 + Preact
├── apps/server     Node 22+ + Colyseus + planck.js
├── packages/shared constantes, protocolo e step de física
└── packages/db     Drizzle + Postgres
```

---

## 🌐 Netcode

- Simulação: **60 Hz fixo** (`dt = 1/60`).
- Input: 60 Hz, máx. 2 por tick; servidor valida.
- Snapshots: **30 Hz** em msgpack.
- Client: prediction + reconciliação + interpolação (~100 ms).

---

## 🗺️ Roadmap (16 semanas)

| Semanas | Fase | Entrega | Critério |
| --- | --- | --- | --- |
| 1–2 | 0. Feel | Local, bola, gol, chute, elástico, carrinho e muralha (protótipos de poder) | 10 min sem instrução |
| 3–5 | 1. Loop vs IA | Menu → partida → revanche; 3 IAs que usam todos os poderes; tutorial | IA no difícil é competitiva |
| 6–10 | 2. Online 1v1 | Servidor autoritativo, sala por código, reconexão | p95 input < 100 ms em GRU |
| 11–13 | 3. Meta | Conta, ELO, histórico, leaderboard, quick match | Partida conta para rank |
| 14–16 | 4. Beta | Replay, polish, correções | 20+ testadores; métricas atingidas |

---

## 📊 Métricas

Revanche espontânea ≥ 50%; partidas concluídas ≥ 90%; p95 input < 100 ms; retentiva D1 ≥ 25%; 0 crashes em 30 min.

---

## ⚠️ Riscos e decisões

- Física imprecisa online → testar 2 máquinas já na semana 6.
- Escopo crescer → lista "fora do MVP" é contrato.

## ❓ Decisões em aberto

- Nome definitivo; direção de arte; provedor de auth; região extra; licença.

---

*Planejamento em andamento — MVP: web, 1v1 online + treino vs IA, ~16 semanas solo.*
