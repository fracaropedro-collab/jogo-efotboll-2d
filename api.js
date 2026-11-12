'use strict';
/*
 * E-FOOTBALL 2D — API de contas (Render Web Service + PostgreSQL)
 *
 * Endpoints:
 *   GET  /health
 *   POST /api/register  { username, password }        -> { token, profile }
 *   POST /api/login     { username, password }        -> { token, profile }
 *   GET  /api/me        Authorization: Bearer <token> -> { profile }
 *   PUT  /api/profile   Bearer + { avatar, style }    -> { profile }
 *
 * Segurança: senha nunca é guardada em texto puro (scrypt + salt por conta),
 * sessões com token aleatório no banco e expiração de 60 dias.
 */

const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const STARTED_AT = Date.now();

/* ---------- conexão com o PostgreSQL ---------- */
function buildPoolConfig(url) {
  let ssl = false;
  try {
    const u = new URL(url);
    // Conexões externas (host com domínio) exigem SSL.
    // Conexões internas do Render (host sem ponto) não usam SSL.
    ssl = u.hostname.includes('.') ? { rejectUnauthorized: false } : false;
  } catch (e) { /* mantém ssl = false */ }
  return { connectionString: url, ssl, max: 5, idleTimeoutMillis: 30000 };
}
const pool = DATABASE_URL ? new Pool(buildPoolConfig(DATABASE_URL)) : null;

/* ---------- schema ---------- */
async function initDb() {
  if (!pool) throw new Error('DATABASE_URL ausente');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id             SERIAL PRIMARY KEY,
      username       TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      pass_hash      TEXT NOT NULL,
      pass_salt      TEXT NOT NULL,
      avatar         INTEGER NOT NULL DEFAULT 0,
      style          INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS sessions_player_idx ON sessions(player_id);`);
}

/* ---------- utilidades ---------- */
function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function profileOf(row) {
  return { user: row.username, avatar: Number(row.avatar) || 0, style: Number(row.style) || 0 };
}

/* ---------- HTTP ---------- */
const ALLOWED_HEADERS = 'Content-Type, Authorization';
function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
}
function sendJson(req, res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}
function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

/* rate limit simples em memória (por IP, janela de 1 min) */
const buckets = new Map();
function rateLimited(ip, max = 30) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.reset) {
    buckets.set(ip, { count: 1, reset: now + 60000 });
    return false;
  }
  b.count++;
  return b.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (now > b.reset) buckets.delete(ip);
}, 60000).unref();

/* validações (mesmas regras do jogo) */
const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const PASS_RE = /^[0-9]{6}$/;

async function findPlayerByToken(token) {
  if (!token) return null;
  const r = await pool.query(
    `SELECT p.* FROM sessions s
       JOIN players p ON p.id = s.player_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return r.rows[0] || null;
}
function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(h.trim());
  return m ? m[1] : '';
}

/* ---------- rotas ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    let db = 'down';
    try {
      if (pool) { await pool.query('SELECT 1'); db = 'up'; }
    } catch (e) { db = 'down'; }
    return sendJson(req, res, 200, {
      ok: true,
      service: 'e-football-2d-api',
      db,
      uptime: Math.round((Date.now() - STARTED_AT) / 1000),
      time: new Date().toISOString(),
    });
  }

  if (!pool) {
    return sendJson(req, res, 503, { ok: false, error: 'Servidor de contas sem banco configurado.' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const authRoutes = ['/api/register', '/api/login'];
  if (authRoutes.includes(path) && rateLimited(ip)) {
    return sendJson(req, res, 429, { ok: false, error: 'Muitas tentativas. Aguarde 1 minuto.' });
  }

  try {
    /* ---- cadastro ---- */
    if (req.method === 'POST' && path === '/api/register') {
      const body = await readJson(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();
      if (!USER_RE.test(username)) {
        return sendJson(req, res, 400, { ok: false, error: 'Username: 3 a 16 letras, números ou _' });
      }
      if (!PASS_RE.test(password)) {
        return sendJson(req, res, 400, { ok: false, error: 'A senha precisa ter exatamente 6 dígitos' });
      }
      const key = username.toLowerCase();
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      let row;
      try {
        const ins = await pool.query(
          `INSERT INTO players (username, username_lower, pass_hash, pass_salt, avatar, style)
           VALUES ($1, $2, $3, $4, 0, 0)
           RETURNING *`,
          [username, key, hash, salt]
        );
        row = ins.rows[0];
      } catch (e) {
        if (e.code === '23505') {
          return sendJson(req, res, 409, { ok: false, error: 'Esse username já existe — escolha outro.' });
        }
        throw e;
      }
      const token = newToken();
      await pool.query(
        `INSERT INTO sessions (token, player_id, expires_at) VALUES ($1, $2, now() + interval '60 days')`,
        [token, row.id]
      );
      return sendJson(req, res, 201, { ok: true, token, profile: profileOf(row) });
    }

    /* ---- login ---- */
    if (req.method === 'POST' && path === '/api/login') {
      const body = await readJson(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();
      if (!USER_RE.test(username)) {
        return sendJson(req, res, 400, { ok: false, error: 'Username: 3 a 16 letras, números ou _' });
      }
      if (!PASS_RE.test(password)) {
        return sendJson(req, res, 400, { ok: false, error: 'A senha precisa ter exatamente 6 dígitos' });
      }
      const r = await pool.query('SELECT * FROM players WHERE username_lower = $1', [username.toLowerCase()]);
      const row = r.rows[0];
      if (!row) {
        return sendJson(req, res, 404, { ok: false, error: 'Conta não encontrada — use "Criar conta".' });
      }
      const expected = hashPassword(password, row.pass_salt);
      if (!safeEqualHex(expected, row.pass_hash)) {
        return sendJson(req, res, 401, { ok: false, error: 'Senha incorreta.' });
      }
      const token = newToken();
      await pool.query(
        `INSERT INTO sessions (token, player_id, expires_at) VALUES ($1, $2, now() + interval '60 days')`,
        [token, row.id]
      );
      await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
      return sendJson(req, res, 200, { ok: true, token, profile: profileOf(row) });
    }

    /* ---- perfil (sessão) ---- */
    if (req.method === 'GET' && path === '/api/me') {
      const row = await findPlayerByToken(bearer(req));
      if (!row) return sendJson(req, res, 401, { ok: false, error: 'Sessão expirada — entre novamente.' });
      return sendJson(req, res, 200, { ok: true, profile: profileOf(row) });
    }

    if (req.method === 'PUT' && path === '/api/profile') {
      const row = await findPlayerByToken(bearer(req));
      if (!row) return sendJson(req, res, 401, { ok: false, error: 'Sessão expirada — entre novamente.' });
      const body = await readJson(req);
      const avatar = Number(body.avatar);
      const style = Number(body.style);
      if (!Number.isInteger(avatar) || avatar < 0 || avatar > 2) {
        return sendJson(req, res, 400, { ok: false, error: 'Avatar inválido.' });
      }
      if (!Number.isInteger(style) || style < 0 || style > 2) {
        return sendJson(req, res, 400, { ok: false, error: 'Design inválido.' });
      }
      const upd = await pool.query(
        `UPDATE players SET avatar = $1, style = $2 WHERE id = $3 RETURNING *`,
        [avatar, style, row.id]
      );
      return sendJson(req, res, 200, { ok: true, profile: profileOf(upd.rows[0]) });
    }

    return sendJson(req, res, 404, { ok: false, error: 'Rota não encontrada.' });
  } catch (err) {
    if (err && (err.message === 'invalid_json' || err.message === 'body_too_large')) {
      return sendJson(req, res, 400, { ok: false, error: 'Requisição inválida.' });
    }
    console.error('[api] erro:', err);
    return sendJson(req, res, 503, { ok: false, error: 'Servidor de contas indisponível no momento.' });
  }
}

/* ---------- boot ---------- */
const server = http.createServer(handle);
server.listen(PORT, () => {
  console.log(`[api] ouvindo na porta ${PORT}`);
});

(async () => {
  if (!pool) {
    console.error('[api] DATABASE_URL não definida — endpoints de conta ficarão indisponíveis.');
    return;
  }
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await initDb();
      console.log('[api] schema pronto (PostgreSQL conectado).');
      return;
    } catch (e) {
      console.error(`[api] banco indisponível (tentativa ${attempt}/10):`, e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
})();

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
