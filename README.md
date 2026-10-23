# Futebol 2D Online

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

## ✅ Escopo do MVP

### Dentro

1. 1v1 online (servidor autoritativo).
2. Treino vs IA (3 dificuldades).
3. Sala por código + quick match simples.
4. Conta convidada (apelido).
5. HUD, placar, kickoff, fim de partida, revanche.
6. Replay (últimos 10 s), stats básicas, leaderboard/ELO, ajustes, tutorial.

### Fora (pós-MVP)

2v2/3v3, loja/cosméticos, temporadas, clubes, espectador, mobile, editor de mapas, torneios, chat de voz.

---

## 📐 Especificações de gameplay

Mundo em **metros**; render escala 1 m ≈ 32 px.

| Item | Valor inicial |
|---|---|
| Campo | 30 × 16 m, paredes com restituição 0,7 |
| Gol | 4 m × 1,2 m (sensor) |
| Jogador | círculo r = 0,45 m, damping linear 1,5 |
| Bola | círculo r = 0,22 m, damping 0,35 |
| Velocidade máx. | 6,5 m/s; aceleração 28 m/s² |
| Chute | segurar Espaço carrega 0→1 em 0,6 s; impulso 8–18 m/s |
| Aftertouch | manter direção após soltar aplica curva por 0,3 s |
| Dash/tackle | 0,15 s de arranque, 12 m/s, CD 2,5 s |
| Plantar | segurar Ctrl trava o corpo (massa ×3, imune a empurrão) |

- **Sem eixo Z:** a bola nunca passa por cima/atravessa jogadores. Substituto terrestre do "chapéu": **elástico** (toque lateral rápido).
- **Partida:** 3 min, primeiro a 5 gols, empate → gol de ouro.

---

## 🎮 Controles (padrão)

| Tecla | Ação |
|---|---|
| WASD / setas | mover |
| Espaço (tap) | toque rápido |
| Espaço (hold) | chute carregado |
| Shift | dash/tackle |
| Ctrl (hold) | plantar |
| E | elástico (toque lateral) |

---

## ⚡ Power-ups — decisão final do MVP

**Kit: 2 cargas no lobby. 4 poderes iniciais.**

### Kit inicial

| Poder | Efeito | Counter |
|---|---|---|
| **Foguete** | Próximo chute 1,8× mais rápido e reto | Escudo, corpo, desviar da linha |
| **Escudo** | Absorve 1 tackle ou 1 chute por 4 s | Esperar, pressionar, Ímã |
| **Turbo** | +40% velocidade e dash sem cooldown por 3 s | Piche, paredes, esperar acabar |
| **Canhão de Ar** | Empurra bola e adversário; **cancela plantar** | Salto, distância, Escudo |

Regras: **2 cargas por partida**; tecla **Q** para ativar; cast de **0,25 s** (telegrafado); sem stack; não atravessa jogadores; não controla adversário; não marca gol sozinho.

### Catálogo (completo, pós-MVP)

- **Ofensivos (vermelho):** Foguete, Bola de Chumbo, Míssil, Ímã, Canhão de Ar, Bomba.
- **Mobilidade (verde):** Turbo, Salto, Gigante, Formiga, Patins.
- **Defensivos (azul):** Escudo, Muralha, Espinhos, Piche, Contra-golpe.
- **Controle/caos (roxo/cinza):** Ladrão, Jammer, Portais, Nevoeiro, Inversão, Troca, Buraco Negro, Dupla Bola, Mina.

---

## 🤖 IA

Máquina de estados: chase → position → shoot → clear. Dificuldades ajustam atraso (80/150/250 ms), erro angular (±2°/±7°/±14°) e velocidade máxima (100%/92%/85%).

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
|---|---|---|---|
| 1–2 | 0. Feel | Local, bola, gol, chute, dash, elástico | 10 min sem instrução |
| 3–5 | 1. Loop vs IA | Menu → partida → revanche; 3 IAs; tutorial | IA no difícil é competitiva |
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
