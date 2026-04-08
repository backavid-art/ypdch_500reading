const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2026bible500';
const GOAL_READS = 500;
const DISTRICTS = ['당회원', '장년교구', '중년교구', '젊은이교구', '청년교구', '다음세대'];

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ members: [], logs: [] }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const members = Array.isArray(parsed.members) ? parsed.members : [];
    const logs = Array.isArray(parsed.logs) ? parsed.logs : [];
    return { members, logs };
  } catch {
    return { members: [], logs: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

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

function buildState() {
  const store = readStore();
  const members = store.members
    .map((m) => ({
      name: normalizeName(m.name),
      district: normalizeDistrict(m.district),
      count: Number.isFinite(Number(m.count)) ? Number(m.count) : 0,
      lastAt: typeof m.lastAt === 'string' ? m.lastAt : '',
    }))
    .filter((m) => m.name && m.count >= 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'ko');
    });

  const totalReads = members.reduce((sum, m) => sum + m.count, 0);
  const totalPeople = members.length;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const monthLogs = (Array.isArray(store.logs) ? store.logs : []).filter((x) => {
    const d = new Date(x.at);
    return Number.isFinite(d.getTime()) && d.getFullYear() === year && d.getMonth() === month;
  });

  const monthlyMap = {};
  for (const l of monthLogs) {
    const name = normalizeName(l.name);
    const district = normalizeDistrict(l.district);
    if (!name) continue;
    const key = `${name}__${district}`;
    if (!monthlyMap[key]) monthlyMap[key] = { name, district, count: 0, lastAt: '' };
    monthlyMap[key].count += 1;
    if (!monthlyMap[key].lastAt || new Date(l.at).getTime() > new Date(monthlyMap[key].lastAt).getTime()) {
      monthlyMap[key].lastAt = l.at;
    }
  }

  const monthlyUpdates = Object.values(monthlyMap).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });

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
    members: members.map((m) => ({ ...m, lastAtText: formatKST(m.lastAt) })),
    monthlyUpdates,
    districtTotals,
    serverTime: nowIso(),
    currentMonthLabel: `${year}년 ${month + 1}월`,
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

  if (!abs.startsWith(PUBLIC_DIR)) {
    return notFound(res);
  }

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
    return sendJson(res, 200, { ok: true, state: buildState() });
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

      const store = readStore();
      let target = store.members.find((m) => normalizeName(m.name) === name && normalizeDistrict(m.district) === district);

      if (!target) {
        target = { name, district, count: 0, lastAt: '' };
        store.members.push(target);
      }

      target.count = Number(target.count || 0) + 1;
      target.lastAt = nowIso();

      if (!Array.isArray(store.logs)) store.logs = [];
      store.logs.push({ name, district, at: target.lastAt });

      writeStore(store);
      return sendJson(res, 200, {
        ok: true,
        message: `${name} (${district}) 1독이 추가되었습니다.`,
        state: buildState(),
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
      writeStore({ members: [], logs: [] });
      return sendJson(res, 200, { ok: true, message: '전체 기록이 초기화되었습니다.', state: buildState() });
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: e.message || '요청 오류' });
    }
  }

  return notFound(res);
}

const server = http.createServer(async (req, res) => {
  cleanupSessions();
  if (req.url.startsWith('/api/')) {
    return handleApi(req, res);
  }
  return serveStatic(req, res);
});

ensureStore();
server.listen(PORT, () => {
  console.log(`Bible Hall server running at http://localhost:${PORT}`);
});
