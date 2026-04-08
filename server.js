const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2026bible500';
const DATABASE_URL = process.env.DATABASE_URL || '';
const GOAL_READS = 500;
const APP_TZ = process.env.APP_TZ || 'Asia/Seoul';
const DISTRICTS = ['당회원', '장년교구', '중년교구', '젊은이교구', '청년교구', '다음세대'];

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Please set Supabase/Postgres connection string.');
  process.exit(1);
}

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
});

const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeDistrict(d) {
  return DISTRICTS.includes(d) ? d : '미분류';
}

function nowIso() {
  return new Date().toISOString();
}

function formatKST(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function getCurrentMonthLabel() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || String(now.getFullYear());
  const month = parts.find((p) => p.type === 'month')?.value || String(now.getMonth() + 1);
  return `${year}년 ${month}월`;
}

async function initDb() {
  await pool.query(`
    create table if not exists members (
      id bigserial primary key,
      name text not null,
      district text not null,
      count integer not null default 0,
      last_at timestamptz
    );
  `);

  await pool.query(`
    create unique index if not exists members_name_district_uq
    on members(name, district);
  `);

  await pool.query(`
    create table if not exists read_logs (
      id bigserial primary key,
      name text not null,
      district text not null,
      at timestamptz not null default now()
    );
  `);
}

async function buildState() {
  const membersRes = await pool.query(`
    select name, district, count, last_at
    from members
    where count >= 0
    order by count desc, name asc;
  `);

  const members = membersRes.rows.map((r) => ({
    name: normalizeName(r.name),
    district: normalizeDistrict(r.district),
    count: Number(r.count || 0),
    lastAt: r.last_at,
    lastAtText: formatKST(r.last_at),
  }));

  const totalReads = members.reduce((sum, m) => sum + m.count, 0);
  const totalPeople = members.length;

  const monthlyRes = await pool.query(
    `
      select name, district, count(*)::int as count, max(at) as last_at
      from read_logs
      where date_trunc('month', at at time zone $1) = date_trunc('month', now() at time zone $1)
      group by name, district
      order by count desc, last_at desc;
    `,
    [APP_TZ]
  );

  const monthlyUpdates = monthlyRes.rows.map((r) => ({
    name: normalizeName(r.name),
    district: normalizeDistrict(r.district),
    count: Number(r.count || 0),
    lastAt: r.last_at,
  }));

  const districtTotals = {};
  for (const d of DISTRICTS) districtTotals[d] = 0;
  districtTotals['미분류'] = 0;

  for (const m of members) {
    const d = normalizeDistrict(m.district);
    districtTotals[d] = (districtTotals[d] || 0) + m.count;
  }

  return {
    goalReads: GOAL_READS,
    totalReads,
    totalPeople,
    members,
    monthlyUpdates,
    districtTotals,
    serverTime: nowIso(),
    currentMonthLabel: getCurrentMonthLabel(),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function issueSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now());
  return token;
}

function validateSession(token) {
  if (!token || typeof token !== 'string') return false;
  const createdAt = sessions.get(token);
  if (!createdAt) return false;
  if (Date.now() - createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, ts] of sessions.entries()) {
    if (now - ts > SESSION_TTL_MS) sessions.delete(token);
  }
}

function notFound(res) {
  sendText(res, 404, 'Not Found');
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = decodeURIComponent(filePath.split('?')[0]);
  const normalized = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');
  const abs = path.join(PUBLIC_DIR, normalized);

  if (!abs.startsWith(PUBLIC_DIR)) return notFound(res);

  fs.readFile(abs, (err, data) => {
    if (err) return notFound(res);

    const ext = path.extname(abs).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function handleApi(req, res) {
  if (req.method === 'GET' && req.url.startsWith('/api/health')) {
    return sendJson(res, 200, { ok: true, status: 'healthy', time: nowIso() });
  }

  if (req.method === 'GET' && req.url.startsWith('/api/state')) {
    try {
      const state = await buildState();
      return sendJson(res, 200, { ok: true, state });
    } catch (e) {
      return sendJson(res, 500, { ok: false, message: '상태 조회 실패', detail: e.message });
    }
  }

  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const body = await parseBody(req);
      if (body.password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { ok: false, message: '비밀번호가 올바르지 않습니다.' });
      }
      const token = issueSession();
      return sendJson(res, 200, { ok: true, token, message: '관리자 로그인 되었습니다.' });
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: e.message || '요청 오류' });
    }
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    try {
      const body = await parseBody(req);
      if (body.token && sessions.has(body.token)) sessions.delete(body.token);
      return sendJson(res, 200, { ok: true, message: '로그아웃되었습니다.' });
    } catch {
      return sendJson(res, 200, { ok: true, message: '로그아웃되었습니다.' });
    }
  }

  if (req.method === 'POST' && req.url === '/api/reads') {
    try {
      const body = await parseBody(req);
      if (!validateSession(body.token)) {
        return sendJson(res, 401, { ok: false, message: '관리자 인증이 필요합니다.' });
      }

      const name = normalizeName(body.name);
      const district = normalizeDistrict(body.district);

      if (!name) return sendJson(res, 400, { ok: false, message: '이름을 입력해 주세요.' });
      if (!DISTRICTS.includes(district)) {
        return sendJson(res, 400, { ok: false, message: '교구를 올바르게 선택해 주세요.' });
      }

      const client = await pool.connect();
      try {
        await client.query('begin');

        await client.query(
          `
            insert into members(name, district, count, last_at)
            values($1, $2, 1, now())
            on conflict(name, district)
            do update set count = members.count + 1, last_at = now();
          `,
          [name, district]
        );

        await client.query(
          `insert into read_logs(name, district, at) values($1, $2, now());`,
          [name, district]
        );

        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }

      return sendJson(res, 200, {
        ok: true,
        message: `${name} (${district}) 1독이 추가되었습니다.`,
        state: await buildState(),
      });
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: e.message || '요청 오류' });
    }
  }

  if (req.method === 'POST' && req.url === '/api/reset') {
    try {
      const body = await parseBody(req);
      if (!validateSession(body.token)) {
        return sendJson(res, 401, { ok: false, message: '관리자 인증이 필요합니다.' });
      }

      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('truncate table read_logs, members restart identity;');
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }

      return sendJson(res, 200, {
        ok: true,
        message: '전체 기록이 초기화되었습니다.',
        state: await buildState(),
      });
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: e.message || '요청 오류' });
    }
  }

  return notFound(res);
}

const server = http.createServer(async (req, res) => {
  cleanupSessions();
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
});

(async () => {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log(`Bible Hall server running at http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Failed to initialize database:', e.message);
    process.exit(1);
  }
})();
