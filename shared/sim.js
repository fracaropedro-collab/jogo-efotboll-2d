/* ============================================================
   E-FOOTBALL 2D — Simulação compartilhada (navegador + Node)
   Usada pelo cliente (offline/local) e pelo servidor autoritativo
   (modo online). NADA de DOM, canvas, áudio ou FX aqui dentro:
   efeitos visuais são comunicados via match.events e desenhados
   pelo cliente.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* ================= CONSTANTES (do planejamento) ================= */
  const SCALE = 32;                 // 1 m ≈ 32 px
  const FIELD_W = 30, FIELD_H = 16; // campo em metros
  const GOAL_HALF = 2;              // abertura do gol: 4 m
  const GOAL_DEPTH = 1.2;           // profundidade 1.2 m
  const REST = 0.7;                 // restituição das paredes
  const PLAYER_R = 0.45, BALL_R = 0.22;
  const DAMP_P = 1.5, DAMP_B = 0.35;
  const MAX_SPD = 6.5, ACCEL = 28;
  const KICK_MIN = 8, KICK_MAX = 18, CHARGE_TIME = 0.6;
  const AFTERTOUCH_T = 0.3;
  /* ---- Carrinho (power-up): investida agressiva que rouba a bola ---- */
  const CART_START = 0.18;   // arranque telegrafado
  const CART_SPD   = 15;     // velocidade da investida
  const CART_T     = 0.45;   // duração da investida
  const CART_REC   = 0.45;   // recuperação lenta se errar tudo
  const CART_BALL_POW = 13;  // impulso na bola ao acertar
  const CART_KNOCK = 10;     // empurrão no adversário
  const CART_STUN  = 1.5;    // atordoa quem leva o carrinho
  /* ---- Muralha (power-up): obstáculo fixo na frente do próprio gol ---- */
  const WALL_X_OFF = 2.5;    // distância da linha de fundo
  const WALL_HW = 0.2, WALL_HH = 1.0;  // meia-largura (0,4 m) e meia-altura (2 m)
  const WALL_LIFE = 6;       // segundos de pé
  const MATCH_TIME = 180, GOALS_TO_WIN = 5;

  const PU_TYPES = ['Foguete', 'Turbo', 'Carrinho', 'Muralha'];
  const PU_COLOR = { 'Foguete': '#ff4d4d', 'Turbo': '#43d860', 'Carrinho': '#ffa03c', 'Muralha': '#9fb2cc' };

  const AI_CFG = [
    { delay: 0.38, err: 24 * Math.PI / 180, spd: 0.68, kickPow: 7,   puP: 0.12, kickChance: 0.6  }, // Fácil
    { delay: 0.15, err: 7 * Math.PI / 180,  spd: 0.92, kickPow: 10,  puP: 0.55, kickChance: 0.85 }, // Médio
    { delay: 0.08, err: 2 * Math.PI / 180,  spd: 1.00, kickPow: 11.5, puP: 0.95, kickChance: 1   }  // Difícil
  ];
  const DIFF_NAMES = ['Fácil', 'Médio', 'Difícil'];

  function makePlayer(id, x, y) {
    return { id, x, y, vx: 0, vy: 0, r: PLAYER_R, mass: 1,
             kickChargeT: 0, charging: false,
             cartState: 0 /* 0 nada · 1 arranque · 2 investida · 3 recuperando */, cartT: 0, cartDir: [id === 0 ? 1 : -1, 0], slowT: 0,
             planted: false, stunT: 0, turboT: 0, rocket: false, hitFxT: 0,
             hasPower: null, lastTouchT: 0, facing: [id === 0 ? 1 : -1, 0], score: 0,
             skin: null, hair: null };
  }
  function makeInput() {
    return { u: false, d: false, l: false, r: false, plant: false, kick: false, ela: false, pow: false };
  }
  function inputVec(inp) {
    const x = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    const y = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
    const n = Math.hypot(x, y);
    return n ? [x / n, y / n, n] : [0, 0, 0];
  }

  /* ============================================================
     createMatch — cria uma partida completa e isolada.
     cfg: { mode:'ia'|'sala'|'online', diff:0|1|2, matchTime, goalLimit,
            allowedPUs:[], rng:fn }
     ============================================================ */
  function createMatch(cfg) {
    cfg = cfg || {};
    const players = [makePlayer(0, 7, 8), makePlayer(1, 23, 8)];
    const me = players[0], foe = players[1];
    const ball = { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0, r: BALL_R,
                   lastKicker: null, afterT: 0, owner: null, noStealT: 0, flameT: 0, curveLock: false };
    const pickups = [];
    const walls = [];

    const S = {
      mode: cfg.mode || 'ia',
      diff: cfg.diff | 0 || 1,
      gameState: 'play',                 // 'play' | 'over' (o cliente cuida de 'menu')
      matchTime: (cfg.matchTime != null) ? cfg.matchTime : MATCH_TIME,
      timeLeft: (cfg.matchTime != null) ? cfg.matchTime : MATCH_TIME,
      goldenGoal: false, kickoffPause: 3,
      goalLimit: cfg.goalLimit || GOALS_TO_WIN,
      players, ball, pickups, walls,
      inputs: [makeInput(), makeInput()],
      allowedPUs: (cfg.allowedPUs && cfg.allowedPUs.length) ? cfg.allowedPUs.slice() : PU_TYPES.slice(),
      timeAcc: 0,
      rng: cfg.rng || Math.random,
      events: []                          // [{type, ...}] — drenado pelo cliente/servidor
    };
    const emit = (ev) => { S.events.push(ev); };

    function spawnPickup() {
      const pool = S.allowedPUs;
      if (!pool.length) return;          // sala com "nenhum poder": futebol puro
      const t = pool[Math.floor(S.rng() * pool.length)];
      pickups.push({ x: 4 + S.rng() * 22, y: 2.5 + S.rng() * 11, type: t });
    }

    function damp(v, k, dt) { const f = Math.exp(-k * dt); v.vx *= f; v.vy *= f; }
    function clampSpeed(p, max) {
      const s = Math.hypot(p.vx, p.vy);
      if (s > max) { p.vx *= max / s; p.vy *= max / s; }
    }
    function currentMaxSpeed(p) {
      let m = MAX_SPD;
      if (p.turboT > 0) m *= 1.4;
      if (p.id === 1 && S.mode === 'ia') m *= AI_CFG[S.diff].spd;   // IA mais lenta; 1v1 local e online: full speed
      return m;
    }

    function movePlayer(p, dt) {
      if (p.cartState === 1) {                         // arranque do carrinho (telegrafado)
        p.cartT -= dt;
        p.vx *= Math.exp(-8 * dt); p.vy *= Math.exp(-8 * dt);
        if (p.cartT <= 0) {
          p.cartState = 2; p.cartT = CART_T;
          p.vx = p.cartDir[0] * CART_SPD; p.vy = p.cartDir[1] * CART_SPD;
          // se você estava com a bola: a investida lança a bola à frente
          if (ball.owner === p) {
            ball.owner = null; ball.noStealT = 0.30;
            ball.vx = p.cartDir[0] * CART_BALL_POW; ball.vy = p.cartDir[1] * CART_BALL_POW;
            ball.lastKicker = p; ball.afterT = 0.2;
            emit({ type: 'cartBallLaunch', player: p.id, x: ball.x, y: ball.y });
          }
          emit({ type: 'cartLaunch', player: p.id, x: p.x, y: p.y });
        }
      } else if (p.cartState === 2) {                  // investida: velocidade fixa, sem damping
        p.cartT -= dt;
        p.vx = p.cartDir[0] * CART_SPD; p.vy = p.cartDir[1] * CART_SPD;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.cartT <= 0) { p.cartState = 3; p.slowT = CART_REC; p.vx *= 0.15; p.vy *= 0.15; }
        wallBouncePlayer(p); cartWallCheck(p);   // sem wallResolve: a investida atravessa e derruba a pedra
        return;
      } else if (p.cartState === 3) {                  // recuperando: lento
        p.slowT -= dt;
        clampSpeed(p, MAX_SPD * 0.35);
        damp(p, DAMP_P * 1.4, dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        wallBouncePlayer(p); wallResolve(p);
        if (p.slowT <= 0) { p.cartState = 0; }
        return;
      }
      clampSpeed(p, currentMaxSpeed(p));
      damp(p, DAMP_P, dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      wallBouncePlayer(p); wallResolve(p);
    }

    /* ================= MURALHA: colisões ================= */
    function wallResolve(p) {                        // empurra para fora (bloqueio suave, sem stun)
      for (const w of walls) {
        if (w.life <= 0) continue;
        const dx = p.x - w.x, dy = p.y - w.y;
        const ox = (w.hw + p.r) - Math.abs(dx), oy = (w.hh + p.r) - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) { p.x += dx >= 0 ? ox : -ox; p.vx = 0; }
        else { p.y += dy >= 0 ? oy : -oy; p.vy = 0; }
      }
    }
    function cartWallCheck(p) {                      // carrinho atravessa e demole a muralha
      for (const w of walls) {
        if (w.life <= 0) continue;
        if (Math.abs(p.x - w.x) < w.hw + p.r && Math.abs(p.y - w.y) < w.hh + p.r) {
          breakWall(w, 'cart');
          p.cartState = 3; p.slowT = CART_REC; p.vx *= 0.2; p.vy *= 0.2;
          emit({ type: 'wallCrash', player: p.id });
          return;
        }
      }
    }
    function breakWall(w, cause) {                   // marca a pedra para morrer neste tick
      w.life = 0;
      emit({ type: 'wallBroken', x: w.x, y: w.y, cause: cause || 'cart' });
    }
    function wallBouncePlayer(p) {
      const inMouth = Math.abs(p.y - FIELD_H / 2) < GOAL_HALF;
      // nas laterais fora da boca do gol, rebate nas linhas de campo
      if (!inMouth) {
        if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * REST; }
        if (p.x > FIELD_W - p.r) { p.x = FIELD_W - p.r; p.vx = -Math.abs(p.vx) * REST; }
      }
      // topo/base sempre rebatem
      if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy) * REST; }
      if (p.y > FIELD_H - p.r) { p.y = FIELD_H - p.r; p.vy = -Math.abs(p.vy) * REST; }
      // jogador entrou dentro do gol → contabiliza gol (cobre gol contra)
      if (inMouth) {
        if (p.x < -GOAL_DEPTH + p.r) onGoal(1);
        else if (p.x > FIELD_W + GOAL_DEPTH - p.r) onGoal(0);
      }
    }
    function moveBall(dt) {
      damp(ball, DAMP_B, dt);
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      // paredes
      const inMouth = Math.abs(ball.y - FIELD_H / 2) < GOAL_HALF;
      if (ball.x < ball.r && !inMouth) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) * REST; }
      if (ball.x > FIELD_W - ball.r && !inMouth) { ball.x = FIELD_W - ball.r; ball.vx = -Math.abs(ball.vx) * REST; }
      if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy) * REST; }
      if (ball.y > FIELD_H - ball.r) { ball.y = FIELD_H - ball.r; ball.vy = -Math.abs(ball.vy) * REST; }
      // profundidade do gol / sensores
      if (inMouth) {
        if (ball.x < -GOAL_DEPTH + ball.r) { ball.x = -GOAL_DEPTH + ball.r; ball.vx = Math.abs(ball.vx) * REST; }
        if (ball.x > FIELD_W + GOAL_DEPTH - ball.r) { ball.x = FIELD_W + GOAL_DEPTH - ball.r; ball.vx = -Math.abs(ball.vx) * REST; }
        if (ball.x < -0.1) onGoal(1);
        else if (ball.x > FIELD_W + 0.1) onGoal(0);
      }
      // muralhas: ricochete; chute-foguete derruba a muralha e atravessa mais devagar
      for (const w of walls) {
        if (w.life <= 0) continue;
        const dx = ball.x - w.x, dy = ball.y - w.y;
        const px = (w.hw + ball.r) - Math.abs(dx), py = (w.hh + ball.r) - Math.abs(dy);
        if (px <= 0 || py <= 0) continue;
        if (ball.flameT > 0 && ball.curveLock) {          // foguete: demolição
          breakWall(w, 'rocket'); ball.vx *= 0.72; ball.vy *= 0.72;
          emit({ type: 'rocketWallBreak' });
          continue;
        }
        if (px < py) {
          ball.x += dx >= 0 ? px : -px;
          ball.vx = (dx >= 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx)) * REST;
        } else {
          ball.y += dy >= 0 ? py : -py;
          ball.vy = (dy >= 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy)) * REST;
        }
      }
      // rastro de chamas do chute-foguete (chamas contínuas)
      if (ball.flameT > 0) ball.flameT -= dt;
    }

    /* ================= POSSE / DRIBLE ================= */
    function carryBall() {
      const p = ball.owner;
      if (p.stunT > 0) { ball.owner = null; ball.noStealT = 0.25; return; }   // levou tackle → solta
      const dist = p.r + ball.r + 0.02;                                     // bola colada na frente do dono
      let bx = p.x + p.facing[0] * dist, by = p.y + p.facing[1] * dist;
      bx = Math.max(ball.r, Math.min(bx, FIELD_W - ball.r));
      by = Math.max(ball.r, Math.min(by, FIELD_H - ball.r));
      ball.x = bx; ball.y = by;
      ball.vx = p.vx; ball.vy = p.vy;                                       // gruda: anda junto
      ball.afterT = 0;
    }
    function collide(a, b, e, aFixed, bFixed) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d === 0 || d >= min) return false;
      const nx = dx / d, ny = dy / d;
      const invA = aFixed ? 0 : (a.id !== undefined ? 1 / a.mass : 1 / (a.mass || 1));
      const invB = bFixed ? 0 : (b.id !== undefined ? 1 / b.mass : 1 / (b.mass || 1));
      const invTot = invA + invB; if (invTot === 0) return true;
      // separação
      a.x -= nx * (min - d) * (invA / invTot); a.y -= ny * (min - d) * (invA / invTot);
      b.x += nx * (min - d) * (invB / invTot); b.y += ny * (min - d) * (invB / invTot);
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn > 0) return true;
      const j = -(1 + e) * vn / invTot;
      a.vx -= j * nx * invA; a.vy -= j * ny * invA;
      b.vx += j * nx * invB; b.vy += j * ny * invB;
      return true;
    }
    function touchingBall(p) { return Math.hypot(ball.x - p.x, ball.y - p.y) < p.r + ball.r + 0.15; }

    /* ================= CHUTE / AFTERTOUCH ================= */
    function releaseKick(p) {
      if (!p.charging) return;
      p.charging = false;
      let power = KICK_MIN;
      if (p.kickChargeT > 0.08) {
        const ch = Math.min(p.kickChargeT / CHARGE_TIME, 1);
        power = KICK_MIN + ch * (KICK_MAX - KICK_MIN);
      }
      doKick(p, power);
      p.kickChargeT = 0;
    }
    function doKick(p, power) {
      // soltar a bola da posse antes de chutar
      ball.owner = null; ball.noStealT = 0.22;
      if (!touchingBall(p)) return;
      let dx = ball.x - p.x, dy = ball.y - p.y;
      let n = Math.hypot(dx, dy); if (n === 0) n = 1;
      dx /= n; dy /= n;
      if (p.id === 1 && S.mode === 'ia') {   // erro angular da IA (apenas no treino)
        const a = Math.atan2(dy, dx) + (S.rng() * 2 - 1) * AI_CFG[S.diff].err;
        dx = Math.cos(a); dy = Math.sin(a);
      }
      let locked = false;
      if (p.rocket) { power *= 1.8; p.rocket = false; locked = true; }
      ball.vx = dx * power; ball.vy = dy * power;
      ball.lastKicker = p; ball.afterT = AFTERTOUCH_T; ball.curveLock = locked;
      p.facing = [dx, dy];
      if (locked) ball.flameT = 0.6;
      emit({ type: 'kick', player: p.id, rocket: locked, x: p.x, y: p.y, bx: ball.x, by: ball.y });
    }
    function applyAftertouch(p, dt, inp) {
      if (ball.afterT <= 0 || ball.lastKicker !== p) return;
      ball.afterT -= dt;
      const iv = inputVec(inp);
      const ix = iv[0], iy = iv[1], n = iv[2];
      if (!n) return;
      if (ball.curveLock) return; // foguete: reto
      // curva: gira a velocidade da bola na direção do input
      const v = Math.hypot(ball.vx, ball.vy); if (v < 0.5) return;
      const ang = Math.atan2(ball.vy, ball.vx);
      const tgt = Math.atan2(iy, ix);
      let da = tgt - ang;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const limit = Math.PI / 2;
      da = Math.max(-limit, Math.min(limit, da));
      const rot = da * dt / AFTERTOUCH_T * 2.6; // curva suave
      const na = ang + rot;
      ball.vx = Math.cos(na) * v; ball.vy = Math.sin(na) * v;
    }

    /* ================= ELÁSTICO ================= */
    function elastic(p) {
      if (S.gameState !== 'play' || S.kickoffPause > 0 || p.stunT > 0 || p.cartState !== 0) return;
      if (!(touchingBall(p) || ball.owner === p)) return;
      ball.owner = null; ball.noStealT = 0.18;   // o elástico também solta a bola da posse (roubo!)
      // toque lateral rápido: empurra a bola perpendicular à linha jogador→bola
      let dx = ball.x - p.x, dy = ball.y - p.y;
      let n = Math.hypot(dx, dy); if (!n) return; dx /= n; dy /= n;
      const iv = inputVec(S.inputs[p.id]);
      const ix = iv[0], iy = iv[1], ii = iv[2];
      let side = dx * iy - dy * ix; // sinal para escolher o lado do input
      if (ii && Math.abs(side) < 0.15) side = 1;
      const s = side >= 0 ? 1 : -1;
      const lx = -dy * s, ly = dx * s;
      const pow = 10;
      ball.vx = lx * pow + dx * 3; ball.vy = ly * pow + dy * 3;
      ball.lastKicker = p; ball.afterT = AFTERTOUCH_T;
      emit({ type: 'elastic', player: p.id });
    }

    /* ================= USO DE POWER-UP ================= */
    function usePower(p) {
      if (S.gameState !== 'play' || S.kickoffPause > 0) {
        emit({ type: 'notice', player: p.id, code: 'kickoffWait' });
        return;
      }
      if (p.cartState !== 0) {
        emit({ type: 'notice', player: p.id, code: 'cartBusy' });
        return;
      }
      if (!p.hasPower) {
        emit({ type: 'notice', player: p.id, code: 'noPower' });
        return;
      }
      const t = p.hasPower; p.hasPower = null;
      const ev = { type: 'powerActivated', player: p.id, power: t, x: p.x, y: p.y };
      if (t === 'Foguete') {
        p.rocket = true;
      }
      if (t === 'Carrinho') {
        // direção: input atual; sem input, a direção que você está virado
        let dx, dy;
        const iv = inputVec(S.inputs[p.id]);
        if (iv[2] > 0) { dx = iv[0]; dy = iv[1]; }
        else if (p.id === 1 && S.mode === 'ia') {
          // IA: investe na direção da bola/adversário
          const tx = ball.x - p.x, ty = ball.y - p.y;
          const nn = Math.hypot(tx, ty);
          dx = nn ? tx / nn : p.facing[0]; dy = nn ? ty / nn : p.facing[1];
        } else { dx = p.facing[0]; dy = p.facing[1]; }
        const nn2 = Math.hypot(dx, dy);
        if (nn2) { dx /= nn2; dy /= nn2; } else { dx = p.facing[0]; dy = p.facing[1]; }
        p.cartDir = [dx, dy]; p.facing = [dx, dy];
        p.cartState = 1; p.cartT = CART_START;
      }
      if (t === 'Muralha') {
        // espawn fixo: no seu campo, ~2,5 m à frente da linha do próprio gol, centralizado
        const sx = p.id === 0 ? WALL_X_OFF : FIELD_W - WALL_X_OFF;
        walls.push({ x: sx, y: FIELD_H / 2, hw: WALL_HW, hh: WALL_HH, life: WALL_LIFE, max: WALL_LIFE, owner: p.id });
        // ninguém espawna em cima da pedra: bola e jogadores saem empurrados
        for (const o of [ball].concat(players)) {
          const dx = o.x - sx, dy = o.y - FIELD_H / 2;
          const ox = (WALL_HW + o.r) - Math.abs(dx), oy = (WALL_HH + o.r) - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy) { o.x += dx >= 0 ? ox : -ox; } else { o.y += dy >= 0 ? oy : -oy; }
        }
        ev.sx = sx; ev.sy = FIELD_H / 2;
      }
      if (t === 'Turbo') {
        p.turboT = 3;
      }
      emit(ev);
    }

    /* ================= GOL / KICKOFF / FIM ================= */
    function resetKickoffState(lossSide) {
      ball.x = FIELD_W / 2; ball.y = FIELD_H / 2; ball.vx = 0; ball.vy = 0;
      ball.afterT = 0; ball.lastKicker = null; ball.owner = null; ball.noStealT = 0;
      me.x = 7; me.y = FIELD_H / 2; me.vx = 0; me.vy = 0;
      foe.x = FIELD_W - 7; foe.y = FIELD_H / 2; foe.vx = 0; foe.vy = 0;
      for (const p of players) { p.cartState = 0; p.cartT = 0; p.slowT = 0; p.charging = false; p.kickChargeT = 0; }
    }
    function onGoal(scorer) {
      if (S.gameState !== 'play') return;
      players[scorer].score++;
      const wins = players[scorer].score >= S.goalLimit;
      const wasGolden = S.goldenGoal;
      resetKickoffState(scorer === 0 ? 1 : 0);
      if (wins || wasGolden) {
        S.gameState = 'over';
        emit({ type: 'over', reason: wins ? 'goals' : 'goldenGoal', scorer,
                goldenGoal: S.goldenGoal, scores: [me.score, foe.score] });
        return;
      }
      S.kickoffPause = 3;   // 3 s congelados com todos nos pontos de partida
      emit({ type: 'goal', scorer, scores: [me.score, foe.score] });
    }
    function reset(opts) {
      opts = opts || {};
      if (opts.goalLimit != null) S.goalLimit = opts.goalLimit;
      if (opts.matchTime != null) S.matchTime = opts.matchTime;
      me.score = 0; foe.score = 0;
      S.timeLeft = S.matchTime; S.goldenGoal = false; S.kickoffPause = 3;
      S.gameState = 'play'; S.timeAcc = 0;
      for (const p of players) {
        p.hasPower = null; p.rocket = false; p.turboT = 0;
        p.cartState = 0; p.cartT = 0; p.slowT = 0;
        p.charging = false; p.kickChargeT = 0;
        p.stunT = 0; p.planted = false; p.hitFxT = 0; p.slowT = 0;
      }
      walls.length = 0; pickups.length = 0;
      spawnPickup(); spawnPickup();
      ball.owner = null; ball.noStealT = 0; ball.flameT = 0; ball.afterT = 0; ball.curveLock = false;
      for (const inp of S.inputs) { inp.ela = false; inp.pow = false; }
      resetKickoffState(0);
      emit({ type: 'kickoff' });
    }

    /* ================= INPUT HUMANO → SIMULAÇÃO ================= */
    function stepHuman(p, inp, dt) {
      if (!p.planted && p.stunT <= 0 && p.cartState !== 1 && p.cartState !== 2) {
        const iv = inputVec(inp);
        if (iv[2] > 0) { p.vx += iv[0] * ACCEL * dt; p.vy += iv[1] * ACCEL * dt; p.facing = [iv[0], iv[1]]; }
      }
      p.planted = inp.plant && p.stunT <= 0 && p.cartState === 0;
      if (p.planted) { p.vx = 0; p.vy = 0; }
      // carga de chute (carrega enquanto pressionado — encostando ou com a bola grudada)
      if (inp.kick && (touchingBall(p) || ball.owner === p)) { p.charging = true; p.kickChargeT += dt; }
      if (inp.plant) { p.charging = false; p.kickChargeT = 0; }
      // soltar o botão → chute
      if (!inp.kick && p.charging) releaseKick(p);
      // bordas (consumidas aqui, uma vez por aperto de tecla)
      if (inp.ela) { elastic(p); inp.ela = false; }
      if (inp.pow) { usePower(p); inp.pow = false; }
    }

    /* ================= PASSO FIXO (60 Hz) ================= */
    function step(dt, aiHook) {
      if (S.gameState !== 'play') return;
      // pausa de kickoff: 3 s congelados nos pontos de partida após gol (ou início)
      if (S.kickoffPause > 0) {
        S.kickoffPause -= dt;
        me.stunT = Math.max(0, me.stunT - dt); foe.stunT = Math.max(0, foe.stunT - dt);
        for (const inp of S.inputs) { inp.ela = false; inp.pow = false; }   // bordas não atravessam o kickoff
        if (S.kickoffPause <= 0) { S.kickoffPause = 0; emit({ type: 'kickoffEnd' }); }
        return;   // ninguém se move, IA parada, bola no centro
      }
      // timers
      me.stunT = Math.max(0, me.stunT - dt); foe.stunT = Math.max(0, foe.stunT - dt);
      me.turboT = Math.max(0, me.turboT - dt); foe.turboT = Math.max(0, foe.turboT - dt);
      me.hitFxT = Math.max(0, me.hitFxT - dt); foe.hitFxT = Math.max(0, foe.hitFxT - dt);
      // muralhas: esgotam e desmoronam
      for (const w of walls) {
        w.life -= dt;
        if (w.life > 0) continue;
        emit({ type: 'wallDown', x: w.x, y: w.y });
      }
      for (let i = walls.length - 1; i >= 0; i--) if (walls[i].life <= 0) walls.splice(i, 1);
      // input dos dois lados (P1 e, no treino, P2 vem do hook de IA)
      stepHuman(me, S.inputs[0], dt);
      stepHuman(foe, S.inputs[1], dt);
      if (S.mode === 'ia' && aiHook) aiHook(dt);
      // movimento — a bola GRUDA em quem encostar nela primeiro (drible estilo Ball 2D)
      movePlayer(me, dt); movePlayer(foe, dt);
      if (ball.owner) carryBall(); else moveBall(dt);
      applyAftertouch(me, dt, S.inputs[0]); applyAftertouch(foe, dt, S.inputs[1]);
      // colisões jogador×jogador
      me.mass = me.planted ? 3 : 1; foe.mass = foe.planted ? 3 : 1;
      const met = collide(me, foe, 0.4, false, false);
      if (met) {
        // CARRINHO: quem está em investida atropela e atordoa
        const carting = p => p.cartState === 2;
        const endCart = p => { p.cartState = 3; p.slowT = CART_REC; p.vx *= 0.2; p.vy *= 0.2; };
        if (carting(me) && !carting(foe)) {
          foe.vx += me.cartDir[0] * CART_KNOCK; foe.vy += me.cartDir[1] * CART_KNOCK;
          foe.stunT = CART_STUN; foe.planted = false; foe.cartState = 0; foe.cartT = 0; foe.slowT = 0;
          foe.hitFxT = 0.35;
          endCart(me);
          emit({ type: 'cartHit', winner: me.id, loser: foe.id, x: foe.x, y: foe.y });
        } else if (carting(foe) && !carting(me)) {
          me.vx += foe.cartDir[0] * CART_KNOCK; me.vy += foe.cartDir[1] * CART_KNOCK;
          me.stunT = CART_STUN; me.planted = false; me.cartState = 0; me.cartT = 0; me.slowT = 0;
          me.hitFxT = 0.35;
          endCart(foe);
          emit({ type: 'cartHit', winner: foe.id, loser: me.id, x: me.x, y: me.y });
        } else if (carting(me) && carting(foe)) {
          // dois carrinhos de frente: batida forte dos dois lados
          me.vx -= foe.cartDir[0] * 8; me.vy -= foe.cartDir[1] * 8;
          foe.vx -= me.cartDir[0] * 8; foe.vy -= me.cartDir[1] * 8;
          me.stunT = 0.8; foe.stunT = 0.8;
          endCart(me); endCart(foe);
          emit({ type: 'cartCollide', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 });
        }
        // quem levou o carrinho solta a bola
        if (ball.owner && ball.owner.stunT > 0) { ball.owner = null; ball.noStealT = 0.25; }
      }
      // posse / roubo da bola
      ball.noStealT = Math.max(0, ball.noStealT - dt);
      for (const p of players) {
        p.mass = p.planted ? 3 : 1;
        if (ball.owner === p) continue;
        // CARRINHO: a investida lança a bola na direção do movimento (rouba a posse!)
        if (p.cartState === 2 && touchingBall(p) && ball.owner !== p) {
          ball.owner = null; ball.noStealT = 0.30;
          ball.vx = p.cartDir[0] * CART_BALL_POW; ball.vy = p.cartDir[1] * CART_BALL_POW;
          ball.lastKicker = p; ball.afterT = 0.2;
          emit({ type: 'cartBallLaunch', player: p.id, x: ball.x, y: ball.y });
          continue;
        }
        // encostou quando a bola está solta → gruda (primeiro que pega)
        if (!ball.owner && touchingBall(p) && ball.noStealT <= 0 && p.stunT <= 0 && p.cartState !== 2) {
          ball.owner = p;
          ball.lastKicker = p; ball.afterT = 0;
          emit({ type: 'ballStick', player: p.id });
        }
      }
      // power-ups no chão
      for (const pk of pickups) {
        for (const p of players) {
          if (!p.hasPower && Math.hypot(pk.x - p.x, pk.y - p.y) < p.r + 0.75) {
            p.hasPower = pk.type; pk.got = true;
            emit({ type: 'pickupCollected', player: p.id, power: pk.type, x: pk.x, y: pk.y });
          }
        }
      }
      for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].got) pickups.splice(i, 1);
      if (pickups.length < 2 && S.rng() < dt * 0.12) spawnPickup();
      // relógio
      S.timeAcc += dt;
      S.timeLeft -= dt;
      if (S.timeLeft <= 0) {
        if (me.score !== foe.score) {
          S.gameState = 'over';
          const lead = me.score > foe.score ? 0 : 1;
          emit({ type: 'over', reason: 'time', scorer: lead, goldenGoal: false, scores: [me.score, foe.score] });
        } else if (!S.goldenGoal) {
          S.goldenGoal = true; S.timeLeft = 9999;
          emit({ type: 'goldenGoal' });
        }
      }
    }

    /* ================= SNAPSHOT (rede) ================= */
    S.snapshot = function () {
      const snapP = p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, id: p.id,
                            facing: [p.facing[0], p.facing[1]], stunT: p.stunT, turboT: p.turboT,
                            hitFxT: p.hitFxT, cartState: p.cartState, cartT: p.cartT, slowT: p.slowT,
                            charging: p.charging, kickChargeT: p.kickChargeT, planted: p.planted,
                            hasPower: p.hasPower, rocket: p.rocket, score: p.score, mass: p.mass });
      return { t: Date.now(),
               timeLeft: S.timeLeft, goldenGoal: S.goldenGoal, kickoffPause: S.kickoffPause,
               gameState: S.gameState, goalLimit: S.goalLimit, matchTime: S.matchTime,
               players: [snapP(me), snapP(foe)],
               ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, afterT: ball.afterT,
                       flameT: ball.flameT, curveLock: ball.curveLock,
                       owner: ball.owner ? ball.owner.id : null,
                       lastKicker: ball.lastKicker ? ball.lastKicker.id : null, noStealT: ball.noStealT },
               pickups: pickups.map(p => ({ x: p.x, y: p.y, type: p.type })),
               walls: walls.map(w => ({ x: w.x, y: w.y, hw: w.hw, hh: w.hh, life: w.life, max: w.max, owner: w.owner })) };
    };
    S.applySnapshot = function (snap) {
      S.timeLeft = snap.timeLeft; S.goldenGoal = snap.goldenGoal; S.kickoffPause = snap.kickoffPause;
      S.gameState = snap.gameState; S.goalLimit = snap.goalLimit; S.matchTime = snap.matchTime;
      for (let i = 0; i < 2; i++) {
        const sp = snap.players[i], p = S.players[i];
        p.x = sp.x; p.y = sp.y; p.vx = sp.vx; p.vy = sp.vy;
        p.facing = [sp.facing[0], sp.facing[1]];
        p.stunT = sp.stunT; p.turboT = sp.turboT; p.hitFxT = sp.hitFxT;
        p.cartState = sp.cartState; p.cartT = sp.cartT; p.slowT = sp.slowT;
        p.charging = sp.charging; p.kickChargeT = sp.kickChargeT; p.planted = sp.planted;
        p.hasPower = sp.hasPower; p.rocket = sp.rocket; p.score = sp.score; p.mass = sp.mass;
      }
      ball.x = snap.ball.x; ball.y = snap.ball.y; ball.vx = snap.ball.vx; ball.vy = snap.ball.vy;
      ball.afterT = snap.ball.afterT; ball.flameT = snap.ball.flameT; ball.curveLock = snap.ball.curveLock;
      ball.owner = snap.ball.owner == null ? null : S.players[snap.ball.owner];
      ball.lastKicker = snap.ball.lastKicker == null ? null : S.players[snap.ball.lastKicker];
      ball.noStealT = snap.ball.noStealT;
      walls.length = 0;
      for (const w of snap.walls) walls.push({ x: w.x, y: w.y, hw: w.hw, hh: w.hh, life: w.life, max: w.max, owner: w.owner });
      pickups.length = 0;
      for (const pk of snap.pickups) pickups.push({ x: pk.x, y: pk.y, type: pk.type });
    };

    // APIs públicas usadas pelo cliente/servidor
    S.step = step;
    S.reset = reset;
    S.resetKickoff = resetKickoffState;
    S.spawnPickup = spawnPickup;
    S.touchingBall = touchingBall;
    S.elastic = elastic;
    S.usePower = usePower;
    S.releaseKick = releaseKick;
    S.inputVec = inputVec;
    return S;
  }

  return {
    createMatch,
    AI_CFG, DIFF_NAMES, PU_TYPES, PU_COLOR,
    SCALE, FIELD_W, FIELD_H, GOAL_HALF, GOAL_DEPTH, REST,
    PLAYER_R, BALL_R, MAX_SPD, ACCEL, KICK_MIN, KICK_MAX, CHARGE_TIME, AFTERTOUCH_T,
    MATCH_TIME, GOALS_TO_WIN
  };
});
