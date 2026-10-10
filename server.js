'use strict';
/*
 * Flockavelli — self-hosted backend.
 * Node + Express + SQLite (better-sqlite3). Serves the API and the static front end.
 * Data lives in one SQLite file (DB_PATH). Back it up by copying that file.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'flockavelli.db');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''; // set this in production to enable admin delete
const MAX_POSTS_PER_HOUR = parseInt(process.env.MAX_POSTS_PER_HOUR || '12', 10);
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // set to 1 behind nginx / Cloudflare

// ---- storage ----
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    entity      TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    whenText    TEXT DEFAULT '',
    sourceUrl   TEXT DEFAULT '',
    alias       TEXT DEFAULT 'Anonymous',
    submitterId TEXT DEFAULT '',
    voters      TEXT DEFAULT '[]',
    createdAt   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(createdAt DESC);
`);

const CATS = new Set(["Government","Law Enforcement","Judiciary","Finance","Corporate",
  "Healthcare","Education","Housing","Media","Nonprofit","Utilities","Other"]);

// ---- helpers ----
const S = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);
function safeUrl(u){ u = S(u, 500); return /^https?:\/\//i.test(u) ? u : ''; }
function rowOut(r){
  let voters = [];
  try { voters = JSON.parse(r.voters || '[]'); } catch (e) {}
  return {
    id: r.id, category: r.category, title: r.title, description: r.description,
    entity: r.entity, location: r.location, when: r.whenText, sourceUrl: r.sourceUrl,
    alias: r.alias, submitterId: r.submitterId, createdAt: r.createdAt,
    corroborations: voters.length
  };
}

// ---- very small in-memory rate limiter (per IP, per window) ----
const hits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now - v.start > 3600000) hits.delete(k);
}, 600000).unref();
function rateLimited(ip){
  const now = Date.now();
  let e = hits.get(ip);
  if (!e || now - e.start > 3600000) { e = { start: now, n: 0 }; hits.set(ip, e); }
  e.n++;
  return e.n > MAX_POSTS_PER_HOUR;
}

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

// ---- API ----
const listStmt = db.prepare('SELECT * FROM reports ORDER BY createdAt DESC LIMIT ?');
app.get('/api/reports', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '400', 10) || 400, 1), 1000);
  res.json({ reports: listStmt.all(limit).map(rowOut) });
});

const insertStmt = db.prepare(`INSERT INTO reports
  (id,category,title,description,entity,location,whenText,sourceUrl,alias,submitterId,voters,createdAt)
  VALUES (@id,@category,@title,@description,@entity,@location,@whenText,@sourceUrl,@alias,@submitterId,'[]',@createdAt)`);
app.post('/api/reports', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'x';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many reports from here. Try again later.' });
  const b = req.body || {};
  const category = S(b.category, 40);
  const title = S(b.title, 140);
  const description = S(b.description, 2200);
  if (!CATS.has(category)) return res.status(400).json({ error: 'Pick a valid category.' });
  if (!title) return res.status(400).json({ error: 'A headline is required.' });
  if (!description) return res.status(400).json({ error: 'A description is required.' });
  const doc = {
    id: crypto.randomUUID(),
    category, title, description,
    entity: S(b.entity, 120), location: S(b.location, 90), whenText: S(b.when, 60),
    sourceUrl: safeUrl(b.sourceUrl), alias: S(b.alias, 40) || 'Anonymous',
    submitterId: S(b.submitterId, 64), createdAt: Date.now()
  };
  insertStmt.run(doc);
  const row = db.prepare('SELECT * FROM reports WHERE id=?').get(doc.id);
  res.status(201).json({ report: rowOut(row) });
});

const getStmt = db.prepare('SELECT * FROM reports WHERE id=?');
const setVotersStmt = db.prepare('UPDATE reports SET voters=? WHERE id=?');
app.post('/api/reports/:id/corroborate', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No such report.' });
  const voterId = S((req.body || {}).voterId, 64);
  if (!voterId) return res.status(400).json({ error: 'Missing voter id.' });
  let voters = [];
  try { voters = JSON.parse(row.voters || '[]'); } catch (e) {}
  if (!voters.includes(voterId)) { voters.push(voterId); setVotersStmt.run(JSON.stringify(voters), row.id); }
  res.json({ corroborations: voters.length });
});

const delStmt = db.prepare('DELETE FROM reports WHERE id=?');
app.delete('/api/reports/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No such report.' });
  const admin = ADMIN_TOKEN && req.get('x-admin-token') === ADMIN_TOKEN;
  const owner = row.submitterId && req.get('x-voter-id') === row.submitterId;
  if (!admin && !owner) return res.status(403).json({ error: 'Not allowed.' });
  delStmt.run(row.id);
  res.json({ ok: true });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- static front end ----
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Flockavelli listening on :${PORT}  (db: ${DB_PATH})`);
  if (!ADMIN_TOKEN) console.log('WARNING: ADMIN_TOKEN is not set — admin delete is disabled.');
});
