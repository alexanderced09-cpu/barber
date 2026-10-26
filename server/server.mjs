// FILO — servidor de la web y del sistema de reservas.
// Sin dependencias: Node 22.5+ (http + node:sqlite). Arranque: `node server/server.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'filo');
const DATA_DIR = path.resolve(process.env.FILO_DATA_DIR || path.join(ROOT, 'data'));
const CONFIG_PATH = path.resolve(process.env.FILO_CONFIG || path.join(HERE, 'config.json'));
const PORT = Number(process.env.PORT || 8080);
// En Render (variable RENDER) hay que escuchar en todas las interfaces, detrás de su proxy HTTPS
const ON_RENDER = !!process.env.RENDER;
const HOST = process.env.HOST || (ON_RENDER ? '0.0.0.0' : '127.0.0.1');
const SECURE_COOKIE = process.env.FILO_SECURE_COOKIE ? process.env.FILO_SECURE_COOKIE === '1' : ON_RENDER;
const TRUST_PROXY = process.env.FILO_TRUST_PROXY ? process.env.FILO_TRUST_PROXY === '1' : ON_RENDER;
const SESSION_HOURS = 12;

/* ------------------------------------------------------------------ Utilidades de fecha */
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const isHM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
const stamp = () => new Date().toISOString();
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/* ------------------------------------------------------------------ Base de datos */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'filo.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    professional TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'confirmada', 'cancelada')),
    history TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- Una sola cita activa por profesional, día y hora de inicio (red de seguridad bajo la comprobación de solapes)
  CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_slot ON bookings (professional, date, time) WHERE status <> 'cancelada';
  CREATE INDEX IF NOT EXISTS bookings_by_date ON bookings (date, time);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  -- Cierres: de todo el estudio (professional NULL) o de un profesional; día completo o franja (start_time/end_time)
  CREATE TABLE IF NOT EXISTS closures (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    professional TEXT,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('bookings').includes('auto_assigned')) db.exec(`ALTER TABLE bookings ADD COLUMN auto_assigned INTEGER NOT NULL DEFAULT 0`);
if (!cols('bookings').includes('duration')) db.exec(`ALTER TABLE bookings ADD COLUMN duration INTEGER NOT NULL DEFAULT 60`);
if (!cols('closures').includes('start_time')) {
  db.exec(`ALTER TABLE closures ADD COLUMN start_time TEXT; ALTER TABLE closures ADD COLUMN end_time TEXT;`);
}
db.exec(`DROP INDEX IF EXISTS closures_one_per_scope;
  CREATE UNIQUE INDEX IF NOT EXISTS closures_unique ON closures (date, ifnull(professional, '*'), ifnull(start_time, ''));`);

const q = {
  setting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  putSetting: db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
  activeOn: db.prepare(`SELECT code, time, duration, professional FROM bookings WHERE status <> 'cancelada' AND date = ?`),
  activeIn: db.prepare(`SELECT * FROM bookings WHERE status <> 'cancelada' AND date BETWEEN ? AND ? ORDER BY date, time`),
  insert: db.prepare(`INSERT INTO bookings (code, date, time, professional, client_name, client_phone, status, history, created_at, updated_at, auto_assigned, duration)
                      VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?)`),
  byCode: db.prepare(`SELECT * FROM bookings WHERE code = ?`),
  list: db.prepare(`SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, time, professional LIMIT 2000`),
  update: db.prepare(`UPDATE bookings SET date = ?, time = ?, professional = ?, status = ?, history = ?, duration = ?, updated_at = ? WHERE code = ?`),
  dayLoad: db.prepare(`SELECT professional, count(*) AS n FROM bookings WHERE status <> 'cancelada' AND date = ? GROUP BY professional`),
  closures: db.prepare(`SELECT * FROM closures WHERE date BETWEEN ? AND ? ORDER BY date, professional, start_time`),
  closuresOn: db.prepare(`SELECT * FROM closures WHERE date = ?`),
  closureById: db.prepare(`SELECT * FROM closures WHERE id = ?`),
  addClosure: db.prepare(`INSERT INTO closures (date, professional, reason, created_at, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)
                          ON CONFLICT (date, ifnull(professional, '*'), ifnull(start_time, '')) DO UPDATE SET reason = excluded.reason, end_time = excluded.end_time`),
  editClosure: db.prepare(`UPDATE closures SET reason = ?, start_time = ?, end_time = ? WHERE id = ?`),
  delClosure: db.prepare(`DELETE FROM closures WHERE id = ?`),
  addSession: db.prepare(`INSERT INTO sessions (token_hash, expires) VALUES (?, ?)`),
  getSession: db.prepare(`SELECT expires FROM sessions WHERE token_hash = ?`),
  delSession: db.prepare(`DELETE FROM sessions WHERE token_hash = ?`),
  purgeSessions: db.prepare(`DELETE FROM sessions WHERE expires < ?`)
};
const getJSON = (k) => { const r = q.setting.get(k); return r ? JSON.parse(r.value) : null; };
const putJSON = (k, v) => q.putSetting.run(k, JSON.stringify(v));
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ------------------------------------------------------------------ Ajustes: horario, negocio y equipo
   Viven en la base de datos y se editan desde el panel. config.json solo da los valores iniciales. */
function seed() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!getJSON('schedule')) {
    const s = config.schedule || {};
    // Formato antiguo {days, open, close} → semana con franjas
    const week = Array.isArray(s.week) ? s.week : Array.from({ length: 7 }, (_, d) => ({ open: (s.days || []).includes(d), ranges: [{ from: s.open || '10:00', to: s.close || '20:00' }] }));
    putJSON('schedule', { slotMinutes: s.slotMinutes || 60, windowDays: s.windowDays || 21, week });
  }
  if (!getJSON('business')) {
    putJSON('business', cleanBusiness({ studioName: config.studioName || 'FILO', timezone: config.timezone || 'Europe/Madrid', location: config.location || {} }));
  }
  if (!getJSON('professionals')) {
    putJSON('professionals', cleanPros(config.professionals || []));
    // Identificadores antiguos del equipo de muestra: las reservas y cierres existentes se reasignan sin perderse
    for (const [from, to] of Object.entries(config.legacyProfessionalIds || {})) {
      db.prepare(`UPDATE bookings SET professional = ? WHERE professional = ?`).run(to, from);
      db.prepare(`UPDATE closures SET professional = ? WHERE professional = ?`).run(to, from);
    }
  }
}
seed();
const S = { get schedule() { return getJSON('schedule'); }, get business() { return getJSON('business'); }, get pros() { return getJSON('professionals'); } };

// Fecha y hora actuales en la zona horaria del negocio, no en la del servidor
function now() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: S.business.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/* ------------------------------------------------------------------ Disponibilidad (fuente única de verdad) */
// Horas de inicio posibles de un profesional en un día, según su horario (propio o común) y la duración de bloque
function gridFor(date, pro, sched) {
  const week = pro.schedule || sched.week;
  const day = week[weekday(date)];
  if (!day || !day.open) return [];
  const out = [];
  for (const r of day.ranges || []) {
    for (let m = toMin(r.from); m + sched.slotMinutes <= toMin(r.to); m += sched.slotMinutes) out.push(toHM(m));
  }
  return out;
}

// Estado de un día: huecos libres por profesional y motivo cuando no hay ninguno
function dayState(date, { exclude = null, sched = S.schedule, pros = S.pros, n = now() } = {}) {
  const closures = q.closuresOn.all(date);
  const bookings = q.activeOn.all(date).filter((b) => b.code !== exclude);
  const studioClosedAll = closures.some((c) => c.professional === null && !c.start_time);
  const out = { closed: studioClosedAll, off: [], pros: {} };
  const beyond = date < n.date || date > addDays(n.date, sched.windowDays);
  for (const p of pros.filter((x) => x.active)) {
    const grid = gridFor(date, p, sched);
    const proOffAll = closures.some((c) => c.professional === p.id && !c.start_time);
    if (studioClosedAll || proOffAll || !grid.length) { out.off.push(p.id); out.pros[p.id] = []; continue; }
    const blocks = closures.filter((c) => c.start_time && (c.professional === null || c.professional === p.id));
    const mine = bookings.filter((b) => b.professional === p.id);
    out.pros[p.id] = beyond ? [] : grid.filter((t) => {
      const a = toMin(t), z = a + sched.slotMinutes;
      if (date === n.date && t <= n.time) return false;
      if (blocks.some((c) => overlaps(a, z, toMin(c.start_time), toMin(c.end_time)))) return false;
      return !mine.some((b) => overlaps(a, z, toMin(b.time), toMin(b.time) + b.duration));
    });
  }
  return out;
}

// Motivo por el que no se puede reservar (o null si se puede)
function slotProblem(date, time, proId, exclude = null) {
  const n = now(), sched = S.schedule, pro = S.pros.find((p) => p.id === proId && p.active);
  if (!isDate(date)) return 'La fecha no es válida.';
  if (!isHM(time)) return 'La hora no es válida.';
  if (!pro) return 'El profesional no está disponible.';
  if (date < n.date || (date === n.date && time <= n.time)) return 'Esa hora ya ha pasado.';
  if (date > addDays(n.date, sched.windowDays)) return `Solo se puede reservar con ${sched.windowDays} días de antelación.`;
  const st = dayState(date, { exclude, sched, n });
  if (st.closed) return 'La barbería no abre ese día.';
  if (st.off.includes(proId)) return `${pro.first} no trabaja ese día.`;
  if (!gridFor(date, pro, sched).includes(time)) return 'Esa hora está fuera del horario.';
  if (!st.pros[proId].includes(time)) return 'Esa hora ya no está disponible.';
  return null;
}

/* ------------------------------------------------------------------ Representación */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => 'F-' + Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const isUnique = (e) => /UNIQUE constraint failed/i.test(String(e && e.message));
function publicBooking(r) {
  return { code: r.code, date: r.date, time: r.time, end: toHM(toMin(r.time) + r.duration), professional: r.professional, name: r.client_name, status: r.status, autoAssigned: !!r.auto_assigned };
}
function adminBooking(r) {
  return { ...publicBooking(r), phone: r.client_phone, duration: r.duration, history: JSON.parse(r.history), createdAt: r.created_at, updatedAt: r.updated_at };
}
const closureOut = (c) => ({ id: c.id, date: c.date, professional: c.professional, reason: c.reason, start: c.start_time, end: c.end_time });
const publicPro = ({ id, name, first, role, photo, whatsapp }) => ({ id, name, first, role, photo, whatsapp: String(whatsapp || '').replace(/\D/g, '') });

/* ------------------------------------------------------------------ Acceso al panel */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
(function initPassword() {
  if (process.env.FILO_ADMIN_PASSWORD) {
    const salt = crypto.randomBytes(16).toString('hex');
    q.putSetting.run('admin_pw', salt + ':' + hashPw(process.env.FILO_ADMIN_PASSWORD, salt));
    return;
  }
  if (q.setting.get('admin_pw')) return;
  // Primera ejecución sin contraseña configurada: se genera una y se guarda fuera de la web
  const pw = crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  q.putSetting.run('admin_pw', salt + ':' + hashPw(pw, salt));
  const file = path.join(DATA_DIR, 'admin-password.txt');
  fs.writeFileSync(file, pw + '\n', { mode: 0o600 });
  console.log(`[FILO] Contraseña inicial del panel guardada en ${file}`);
  if (ON_RENDER) console.warn('[FILO] AVISO: en Render define la variable FILO_ADMIN_PASSWORD (Environment) para poder entrar en el panel.');
})();
function checkPassword(pw) {
  const [salt, hash] = q.setting.get('admin_pw').value.split(':');
  const a = Buffer.from(hashPw(String(pw || ''), salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
function isAdmin(req) {
  const t = cookies(req).filo_admin;
  if (!t) return false;
  const s = q.getSession.get(sha(t));
  return !!s && s.expires > Date.now();
}
// Límites sencillos por IP (memoria): intentos de acceso y creación de reservas
const buckets = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const b = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  b.push(t); buckets.set(key, b);
  return b.length > max;
}

/* ------------------------------------------------------------------ Validación de ajustes */
function cleanWeek(week) {
  if (!Array.isArray(week) || week.length !== 7) throw new Error('El horario semanal no es válido.');
  return week.map((d, i) => {
    const ranges = (d.ranges || []).map((r) => ({ from: r.from, to: r.to }));
    if (d.open) {
      if (!ranges.length) throw new Error('Cada día abierto necesita al menos una franja.');
      ranges.sort((a, b) => toMin(a.from) - toMin(b.from));
      ranges.forEach((r, j) => {
        if (!isHM(r.from) || !isHM(r.to) || toMin(r.to) <= toMin(r.from)) throw new Error('Revisa las horas de apertura y cierre: el cierre debe ser posterior a la apertura.');
        if (j && toMin(r.from) < toMin(ranges[j - 1].to)) throw new Error('Las franjas de un mismo día no pueden solaparse.');
      });
    }
    return { open: !!d.open, ranges: d.open ? ranges : (ranges.length ? ranges : [{ from: '10:00', to: '20:00' }]) };
  });
}
function cleanSchedule(s) {
  const slot = Number(s.slotMinutes), win = Number(s.windowDays);
  if (![15, 20, 30, 40, 45, 60, 75, 90, 120].includes(slot)) throw new Error('Elige una duración de cita válida.');
  if (!Number.isInteger(win) || win < 1 || win > 120) throw new Error('La antelación debe estar entre 1 y 120 días.');
  return { slotMinutes: slot, windowDays: win, week: cleanWeek(s.week) };
}
function cleanBusiness(b) {
  const L = b.location || {};
  const num = (v, lo, hi) => (v === null || v === '' || v === undefined ? null : (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : NaN));
  const lat = num(L.lat, -90, 90), lng = num(L.lng, -180, 180);
  if (Number.isNaN(lat) || Number.isNaN(lng)) throw new Error('Las coordenadas no son válidas (latitud entre -90 y 90; longitud entre -180 y 180).');
  if ((lat === null) !== (lng === null)) throw new Error('Indica latitud y longitud juntas, o deja las dos vacías.');
  const tz = String(b.timezone || 'Europe/Madrid');
  try { new Intl.DateTimeFormat('es', { timeZone: tz }); } catch { throw new Error('La zona horaria no es válida.'); }
  const url = String(L.mapsUrl || '').trim();
  if (url && !/^https:\/\//.test(url)) throw new Error('El enlace de mapas debe empezar por https://');
  const t = (v, n) => String(v || '').trim().slice(0, n);
  return { studioName: t(b.studioName, 60) || 'FILO', timezone: tz,
    location: { address: t(L.address, 160), city: t(L.city, 80), notes: t(L.notes, 160), phone: t(L.phone, 30), mapsUrl: url, lat, lng } };
}
function cleanPros(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Debe haber al menos un profesional.');
  const ids = new Set();
  const out = list.map((p) => {
    const name = String(p.name || '').trim().slice(0, 60);
    if (name.length < 2) throw new Error('Cada profesional necesita un nombre.');
    let id = String(p.id || '').trim() || name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    while (ids.has(id)) id += '-2';
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('Identificador de profesional no válido.');
    ids.add(id);
    const wa = String(p.whatsapp || '').replace(/\D/g, '');
    if (wa && (wa.length < 8 || wa.length > 15)) throw new Error(`El WhatsApp de ${name} debe tener entre 8 y 15 cifras, con el código de país.`);
    const photo = String(p.photo || '').trim();
    if (photo && !/^assets\/[\w.-]+\.(jpe?g|png|webp)$/i.test(photo)) throw new Error('La foto debe ser un archivo dentro de filo/assets/.');
    return { id, name, first: String(p.first || name.split(' ')[0]).trim().slice(0, 30), role: String(p.role || '').trim().slice(0, 80),
      photo, whatsapp: wa, active: p.active !== false, schedule: p.schedule ? cleanWeek(p.schedule) : null };
  });
  if (!out.some((p) => p.active)) throw new Error('Debe quedar al menos un profesional activo.');
  return out;
}
// Citas activas futuras que dejarían de encajar con un horario/equipo nuevo (no se tocan; se avisa)
function misfits(sched, pros) {
  const n = now();
  return q.activeIn.all(n.date, addDays(n.date, 400)).filter((b) => {
    const p = pros.find((x) => x.id === b.professional);
    if (!p || !p.active) return true;
    const week = p.schedule || sched.week, day = week[weekday(b.date)];
    if (!day.open) return true;
    const a = toMin(b.time), z = a + b.duration;
    return !day.ranges.some((r) => a >= toMin(r.from) && z <= toMin(r.to));
  }).map(adminBooking);
}

/* ------------------------------------------------------------------ HTTP */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...BASE_HEADERS, 'Cache-Control': 'no-store', ...(isObj ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, status, error, extra = {}) => send(res, status, { error, ...extra });
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 65536) { reject(new Error('too-large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad-json')); } });
    req.on('error', reject);
  });
}
function serveStatic(req, res, pathname) {
  if (pathname === '/admin') return send(res, 301, '', { Location: '/admin/' });
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(WEB, '.' + rel);
  if (!file.startsWith(WEB + path.sep)) return send(res, 403, 'Prohibido');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    const headers = { ...BASE_HEADERS, 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400' };
    if (rel.startsWith('/admin/')) headers['X-Robots-Tag'] = 'noindex, nofollow';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function availability(from, to, exclude = null) {
  const n = now(), sched = S.schedule, pros = S.pros, days = {};
  for (let d = from; d <= to; d = addDays(d, 1)) days[d] = dayState(d, { exclude, sched, pros, n });
  return { now: n, slotMinutes: sched.slotMinutes, days };
}
function rangeFrom(url, defDays) {
  const n = now();
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : n.date;
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : addDays(from, defDays);
  return [from, to];
}

async function api(req, res, url) {
  const p = url.pathname;
  // Detrás de un proxy (Render), la IP real es la última que añade el proxy a X-Forwarded-For
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
  const ip = fwd || req.socket.remoteAddress || '';

  /* ----- Público: sin datos de clientes ----- */
  if (p === '/api/public-config' && req.method === 'GET') {
    const sched = S.schedule, biz = S.business;
    return send(res, 200, {
      studio: biz.studioName, location: biz.location,
      schedule: { slotMinutes: sched.slotMinutes, windowDays: sched.windowDays, week: sched.week },
      professionals: S.pros.filter((x) => x.active).map(publicPro),
      now: now()
    });
  }
  if (p === '/api/availability' && req.method === 'GET') {
    const [from, to] = rangeFrom(url, S.schedule.windowDays);
    if (to < from || to > addDays(from, 92)) return fail(res, 400, 'Rango de fechas no válido.');
    return send(res, 200, availability(from, to));
  }
  if (p === '/api/bookings' && req.method === 'POST') {
    if (limited('book:' + ip, 20, 10 * 60 * 1000)) return fail(res, 429, 'Demasiadas solicitudes. Espera unos minutos.');
    let b; try { b = await readJson(req); } catch { return fail(res, 400, 'Solicitud no válida.'); }
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const phone = String(b.phone || '').trim();
    const digits = phone.replace(/\D/g, '');
    if (name.length < 2 || name.length > 80) return fail(res, 400, 'Escribe tu nombre (entre 2 y 80 caracteres).');
    if (digits.length < 9 || digits.length > 15 || !/^\+?[\d\s().-]+$/.test(phone)) return fail(res, 400, 'Escribe un teléfono válido, de 9 a 15 cifras.');
    const auto = !b.professional || b.professional === 'any';
    const t = stamp();
    // Comprobación e inserción en la misma transacción: nadie puede ocupar el hueco entre medias
    const result = tx(() => {
      const pros = S.pros.filter((x) => x.active), sched = S.schedule;
      let candidates;
      if (auto) {
        const load = Object.fromEntries(q.dayLoad.all(String(b.date)).map((r) => [r.professional, r.n]));
        candidates = pros.map((x, i) => ({ id: x.id, i, n: load[x.id] || 0 })).filter((x) => !slotProblem(b.date, b.time, x.id))
          .sort((x, y) => x.n - y.n || x.i - y.i).map((x) => x.id);
        if (!candidates.length) {
          const m = slotProblem(b.date, b.time, pros[0].id);
          return { status: m && /ya no está disponible/.test(m) ? 409 : 400, error: m && !/no trabaja/.test(m) ? m : 'A esa hora no queda ningún profesional libre.' };
        }
      } else {
        const m = slotProblem(b.date, b.time, b.professional);
        if (m) return { status: /ya no está disponible/.test(m) ? 409 : 400, error: m };
        candidates = [b.professional];
      }
      const history = JSON.stringify([{ at: t, what: auto ? 'creada (profesional asignado automáticamente)' : 'creada', by: 'web' }]);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        try {
          q.insert.run(code, b.date, b.time, candidates[0], name, phone, history, t, t, auto ? 1 : 0, sched.slotMinutes);
          return { status: 201, booking: publicBooking(q.byCode.get(code)) };
        } catch (e) { if (!(isUnique(e) && /bookings\.code/.test(e.message))) throw e; }
      }
      return { status: 500, error: 'No se ha podido generar el código de reserva.' };
    });
    if (result.status !== 201) return fail(res, result.status, result.error, result.status === 409 ? { conflict: true } : {});
    return send(res, 201, { booking: result.booking });
  }

  /* ----- Panel ----- */
  if (p === '/api/admin/login' && req.method === 'POST') {
    if (limited('login:' + ip, 8, 15 * 60 * 1000)) return fail(res, 429, 'Demasiados intentos. Espera 15 minutos.');
    let b; try { b = await readJson(req); } catch { return fail(res, 400, 'Solicitud no válida.'); }
    if (!checkPassword(b.password)) return fail(res, 401, 'Contraseña incorrecta.');
    q.purgeSessions.run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    q.addSession.run(sha(token), Date.now() + SESSION_HOURS * 3600e3);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `filo_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${SECURE_COOKIE ? '; Secure' : ''}` });
  }
  if (!p.startsWith('/api/admin/')) return fail(res, 404, 'No encontrado.');
  if (!isAdmin(req)) return fail(res, 401, 'Inicia sesión para continuar.');
  // Protección CSRF adicional a SameSite: las mutaciones deben llevar esta cabecera
  if (req.method !== 'GET' && req.headers['x-filo'] !== '1') return fail(res, 403, 'Petición no permitida.');

  if (p === '/api/admin/logout' && req.method === 'POST') {
    q.delSession.run(sha(cookies(req).filo_admin));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'filo_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p === '/api/admin/me' && req.method === 'GET') return send(res, 200, { ok: true, now: now() });

  if (p === '/api/admin/settings' && req.method === 'GET') {
    return send(res, 200, { schedule: S.schedule, business: S.business, professionals: S.pros, now: now() });
  }
  if (p === '/api/admin/settings' && req.method === 'PUT') {
    let b; try { b = await readJson(req); } catch { return fail(res, 400, 'Solicitud no válida.'); }
    let sched, biz, pros;
    try {
      sched = b.schedule ? cleanSchedule(b.schedule) : S.schedule;
      biz = b.business ? cleanBusiness(b.business) : S.business;
      pros = b.professionals ? cleanPros(b.professionals) : S.pros;
    } catch (e) { return fail(res, 400, e.message); }
    // Un profesional con citas no se borra: se desactiva
    const removed = S.pros.filter((x) => !pros.some((y) => y.id === x.id));
    for (const r of removed) if (db.prepare(`SELECT 1 FROM bookings WHERE professional = ? LIMIT 1`).get(r.id)) return fail(res, 400, `${r.name} tiene reservas: desactívalo en lugar de borrarlo.`);
    const affected = misfits(sched, pros);
    if (affected.length && !b.force) return fail(res, 409, 'Hay citas que no encajan con los cambios.', { conflicts: affected });
    if (b.schedule) putJSON('schedule', sched);
    if (b.business) putJSON('business', biz);
    if (b.professionals) putJSON('professionals', pros);
    return send(res, 200, { schedule: S.schedule, business: S.business, professionals: S.pros, affected: affected.length });
  }

  if (p === '/api/admin/availability' && req.method === 'GET') {
    const [from, to] = rangeFrom(url, 0);
    if (to < from || to > addDays(from, 92)) return fail(res, 400, 'Rango de fechas no válido.');
    return send(res, 200, availability(from, to, url.searchParams.get('exclude')));
  }

  if (p === '/api/admin/bookings' && req.method === 'GET') {
    const [from, to] = rangeFrom(url, 7);
    if (to < from || to > addDays(from, 400)) return fail(res, 400, 'Rango de fechas no válido.');
    return send(res, 200, { now: now(), bookings: q.list.all(from, to).map(adminBooking), closures: q.closures.all(from, to).map(closureOut) });
  }

  const m = p.match(/^\/api\/admin\/bookings\/(F-[A-Z0-9]{6})$/);
  if (m && req.method === 'PATCH') {
    let b; try { b = await readJson(req); } catch { return fail(res, 400, 'Solicitud no válida.'); }
    const out = tx(() => {
      const row = q.byCode.get(m[1]);
      if (!row) return { status: 404, error: 'La reserva no existe.' };
      const history = JSON.parse(row.history);
      let { date, time, professional, status, duration } = row;
      if (b.action === 'confirm') {
        if (status !== 'pendiente') return { status: 409, error: 'Solo se pueden confirmar reservas pendientes.' };
        status = 'confirmada'; history.push({ at: stamp(), what: 'confirmada', by: 'panel' });
      } else if (b.action === 'cancel') {
        if (status === 'cancelada') return { status: 409, error: 'La reserva ya estaba cancelada.' };
        status = 'cancelada'; history.push({ at: stamp(), what: 'cancelada', by: 'panel' });
      } else if (b.action === 'reschedule') {
        if (status === 'cancelada') return { status: 409, error: 'No se puede reprogramar una reserva cancelada.' };
        if (b.date === date && b.time === time && b.professional === professional) return { status: 400, error: 'Elige un día, una hora o un profesional distintos.' };
        // La propia cita no cuenta como ocupada: se mueve, no se duplica
        const problem = slotProblem(b.date, b.time, b.professional, row.code);
        if (problem) return { status: /ya no está disponible/.test(problem) ? 409 : 400, error: problem };
        history.push({ at: stamp(), what: 'reprogramada', by: 'panel', from: `${date} ${time} ${professional}`, to: `${b.date} ${b.time} ${b.professional}` });
        ({ date, time, professional } = b);
        duration = S.schedule.slotMinutes;
      } else return { status: 400, error: 'Acción no válida.' };
      try { q.update.run(date, time, professional, status, JSON.stringify(history), duration, stamp(), row.code); }
      catch (e) { if (isUnique(e)) return { status: 409, error: 'Ese horario ya está ocupado para ese profesional.' }; throw e; }
      return { status: 200, booking: adminBooking(q.byCode.get(row.code)) };
    });
    if (out.status !== 200) return fail(res, out.status, out.error);
    return send(res, 200, { booking: out.booking });
  }

  /* Cierres: días completos o franjas, de todo el estudio o de un profesional */
  if (p === '/api/admin/closures' && req.method === 'GET') {
    const n = now();
    return send(res, 200, { now: n, closures: q.closures.all(n.date, addDays(n.date, 400)).map(closureOut) });
  }
  const affectedBy = (from, to, pro, start, end, skipId) => q.activeIn.all(from, to)
    .filter((r) => (!pro || r.professional === pro) && (!start || overlaps(toMin(r.time), toMin(r.time) + r.duration, toMin(start), toMin(end))))
    .map(adminBooking);
  const checkSpan = (start, end) => {
    if (!start && !end) return null;
    if (!isHM(start) || !isHM(end) || toMin(end) <= toMin(start)) return 'La franja no es válida: la hora final debe ser posterior a la inicial.';
    return null;
  };
  if (p === '/api/admin/closures' && req.method === 'POST') {
    let b; try { b = await readJson(req); } catch { return fail(res, 400, 'Solicitud no válida.'); }
    const n = now(), from = b.from, to = b.to || b.from;
    const pro = b.professional ? String(b.professional) : null;
    const reason = String(b.reason || '').trim().slice(0, 80);
    const start = b.start || null, end = b.end || null;
    if (!isDate(from) || !isDate(to)) return fail(res, 400, 'Elige fechas válidas.');
    if (to < from) return fail(res, 400, 'La fecha final no puede ser anterior a la inicial.');
    if (from < n.date) return fail(res, 400, 'No se pueden cerrar días que ya han pasado.');
    if (to > addDays(from, 61)) return fail(res, 400, 'Marca como máximo 62 días seguidos.');
    if (pro && !S.pros.some((x) => x.id === pro)) return fail(res, 400, 'El profesional no existe.');
    const spanErr = checkSpan(start, end); if (spanErr) return fail(res, 400, spanErr);
    const affected = affectedBy(from, to, pro, start, end);
    if (affected.length && !b.force) return fail(res, 409, 'Hay citas activas en ese periodo.', { conflicts: affected });
    const t = stamp();
    const count = tx(() => { let c = 0; for (let d = from; d <= to; d = addDays(d, 1)) { q.addClosure.run(d, pro, reason, t, start, end); c++; } return c; });
    return send(res, 201, { created: count, affected: affected.length });
  }
  const mc = p.match(/^\/api\/admin\/closures\/(\d+)$/);
  if (mc && req.method === 'PATCH') {
    const c = q.closureById.get(Number(mc[1]));
    if (!c) return fail(res, 404, 'Ese cierre ya no existe.');
    let b; try { b = await readJson(req); } catch { return fail(res, 400, 'Solicitud no válida.'); }
    const start = b.start || null, end = b.end || null;
    const spanErr = checkSpan(start, end); if (spanErr) return fail(res, 400, spanErr);
    const affected = affectedBy(c.date, c.date, c.professional, start, end);
    if (affected.length && !b.force) return fail(res, 409, 'Hay citas activas en ese periodo.', { conflicts: affected });
    try { q.editClosure.run(String(b.reason || '').trim().slice(0, 80), start, end, c.id); }
    catch (e) { if (isUnique(e)) return fail(res, 409, 'Ya existe un cierre igual ese día.'); throw e; }
    return send(res, 200, { closure: closureOut(q.closureById.get(c.id)) });
  }
  if (mc && req.method === 'DELETE') {
    const r = q.delClosure.run(Number(mc[1]));
    if (!r.changes) return fail(res, 404, 'Ese cierre ya no existe.');
    return send(res, 200, { ok: true });
  }
  return fail(res, 404, 'No encontrado.');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, 'Error interno del servidor.');
  }
});
server.listen(PORT, HOST, () => console.log(`[FILO] Web en http://${HOST}:${PORT}/  ·  Panel en http://${HOST}:${PORT}/admin/`));
