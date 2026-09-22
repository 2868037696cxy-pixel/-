// ============================================================================
// JEV Creative Workbench · 本地后端服务
// Express + node:sqlite(内置SQLite) + ffmpeg 流水线 + JEV 评分引擎
// ============================================================================
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_WEIGHTS, JEV_LABELS, ENUMS, POLICY_RULES, GRADE_BANDS,
  recomputeAnalysis, heuristicBaseline, scanPolicy
} from './engine/jev-engine.js';
import { buildTags, indexText } from './engine/tags.js';
import { probeMedia, extractKeyframes, buildTimeline, capabilities } from './engine/pipeline.js';
import { analyzeWithAI, aiAvailable } from './engine/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LIBRARY_DIR = path.join(ROOT, 'library');
const THUMBS_DIR = path.join(LIBRARY_DIR, 'thumbs');
const DB_FILE = path.join(DATA_DIR, 'workbench.db');

for (const dir of [DATA_DIR, LIBRARY_DIR, THUMBS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------- SQLite 持久化 ----------
const db = new DatabaseSync(DB_FILE);
db.exec(`
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT,
  createdAt INTEGER, updatedAt INTEGER, status TEXT DEFAULT 'active',
  basic TEXT, analysis TEXT, timeline TEXT, subtitles TEXT, custom TEXT, perf TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

// 模型权重存取
const loadWeights = () => {
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key='weights'`).get();
    if (row) return JSON.parse(row.value);
  } catch {}
  return DEFAULT_WEIGHTS;
};
const saveWeights = w => db.prepare(`INSERT INTO meta(key,value) VALUES('weights',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(w));
let weights = loadWeights();

// 素材行 → 对象
const rowToMaterial = row => ({
  id: row.id, name: row.name, kind: row.kind, ref: row.ref,
  createdAt: row.createdAt, updatedAt: row.updatedAt, status: row.status,
  basic: JSON.parse(row.basic), analysis: JSON.parse(row.analysis),
  timeline: JSON.parse(row.timeline), subtitles: JSON.parse(row.subtitles),
  custom: JSON.parse(row.custom), perf: JSON.parse(row.perf)
});
const getMaterial = id => {
  const row = db.prepare(`SELECT * FROM materials WHERE id=? AND status='active'`).get(id);
  return row ? rowToMaterial(row) : null;
};
const saveMaterial = m => {
  db.prepare(`INSERT INTO materials(id,name,kind,ref,createdAt,updatedAt,status,basic,analysis,timeline,subtitles,custom,perf)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,ref=excluded.ref,
    updatedAt=excluded.updatedAt,basic=excluded.basic,analysis=excluded.analysis,
    timeline=excluded.timeline,subtitles=excluded.subtitles,custom=excluded.custom,perf=excluded.perf`).run(
    m.id, m.name, m.kind, m.ref, m.createdAt, m.updatedAt, m.status,
    JSON.stringify(m.basic), JSON.stringify(m.analysis), JSON.stringify(m.timeline),
    JSON.stringify(m.subtitles), JSON.stringify(m.custom), JSON.stringify(m.perf)
  );
};

// ---------- 核心：素材全链路重算 ----------
function refresh(m) {
  const { hook, engagement, value } = m.analysis;
  // 合规扫描：文件名+字幕+文案
  const autoHits = scanPolicy([indexText(m)]);
  // 合并勾选风险（自动命中强制 checked）
  const riskState = m.custom.riskState || {};            // { 'key': bool } 人工勾选
  const risks = POLICY_RULES.map(r => {
    const auto = autoHits.find(h => h.key === r.key);
    const checked = auto ? true : (riskState[r.key] ?? false);
    return checked ? (auto || { key: r.key, level: r.severity, label: r.label, automatic: false }) : null;
  }).filter(Boolean);

  m.analysis = recomputeAnalysis(
    { hook, engagement, value, policy: { score: 9, risks } },
    m.basic, weights
  );
  m.analysis.tags = buildTags(m, m.analysis, m.basic, m.custom);
  m.analysis.aiAssessed = m.analysis.aiAssessed || false;
  m.timeline = buildTimeline(m.basic, m.analysis);
  m.updatedAt = Date.now();
  return m;
}

// ---------- 素材入库 ----------
const MEDIA_EXT = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg','.avif','.mp4','.mov','.webm','.mkv','.m4v','.avi'];
const IMAGE_EXT = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg','.avif'];
const VIDEO_EXT = ['.mp4','.mov','.webm','.mkv','.m4v','.avi'];
const mediaTypeOf = f => VIDEO_EXT.includes(path.extname(f).toLowerCase()) ? 'video' : 'image';

// 对已落盘文件执行流水线并入库（probe→抽帧→基线评分→标签→时间轴）
async function finalizeLocal(id, name, localFile, sizeBytes, kind, ref) {
  const mediaType = mediaTypeOf(localFile);
  const probed = await probeMedia(localFile);
  const basic = { mediaType, sizeBytes, ...probed, poster: null, frames: [] };
  if (mediaType === 'video' && probed.durationSec > 0) {
    const kf = await extractKeyframes(localFile, id, THUMBS_DIR, probed.durationSec);
    basic.poster = kf.poster; basic.frames = kf.frames;
  }
  const analysis = heuristicBaseline(basic);
  const m = {
    id, name, kind, ref, createdAt: Date.now(), updatedAt: Date.now(), status: 'active',
    basic, analysis,
    timeline: { nodes: [], curve: [] },
    subtitles: [],
    custom: { category: '', notes: '', customTags: [], manualChannel: null, manualHookType: null, manualGrade: null, riskState: {} },
    perf: { ctr: null, cvr: null, roas: null, impr: null }
  };
  refresh(m);
  saveMaterial(m);
  return m;
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: '20mb' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LIBRARY_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, id + (path.extname(file.originalname).toLowerCase() || '.bin'));
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use('/media', express.static(LIBRARY_DIR));
app.use(express.static(PUBLIC_DIR));

// ---- 查询 ----
app.get('/api/materials', (req, res) => {
  const rows = db.prepare(`SELECT * FROM materials WHERE status='active' ORDER BY updatedAt DESC`).all();
  res.json(rows.map(rowToMaterial));
});
app.get('/api/materials/:id', (req, res) => {
  const m = getMaterial(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json(m);
});

// ---- 更新（评分/标签/合规/字幕/自定义/实况） ----
app.put('/api/materials/:id', (req, res) => {
  const m = getMaterial(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  if (b.analysis) {
    const a = b.analysis;
    if (a.hook) m.analysis.hook = { ...m.analysis.hook, ...a.hook };
    if (a.engagement) m.analysis.engagement = { ...m.analysis.engagement, ...a.engagement };
    if (a.value) m.analysis.value = { ...m.analysis.value, ...a.value };
    if (a.aiAssessed !== undefined) m.analysis.aiAssessed = a.aiAssessed;
  }
  if (b.riskState) m.custom.riskState = b.riskState;
  if (b.custom) m.custom = { ...m.custom, ...b.custom };
  if (b.subtitles) m.subtitles = b.subtitles;
  if (b.perf) m.perf = { ...m.perf, ...b.perf };
  if (b.basic) m.basic = { ...m.basic, ...b.basic };
  refresh(m);
  saveMaterial(m);
  res.json(m);
});

// ---- 新建：链接/自定义条目 ----
app.post('/api/materials', (req, res) => {
  const { name, url } = req.body || {};
  if (!name && !url) return res.status(400).json({ error: '需要 name 或 url' });
  const id = crypto.randomBytes(8).toString('hex');
  const m = {
    id, name: name || url.split('/').pop() || 'linked-material',
    kind: 'url', ref: url || '', createdAt: Date.now(), updatedAt: Date.now(), status: 'active',
    basic: { mediaType: 'image', sizeBytes: 0, durationSec: 0, width: 0, height: 0, aspect: null, resolution: null, fps: 0, hasAudio: false, poster: null, frames: [] },
    analysis: heuristicBaseline({ mediaType: 'image' }),
    timeline: { nodes: [], curve: [] }, subtitles: [],
    custom: { category: '', notes: '', customTags: [], manualChannel: null, manualHookType: null, manualGrade: null, riskState: {} },
    perf: { ctr: null, cvr: null, roas: null, impr: null }
  };
  refresh(m);
  saveMaterial(m);
  res.json(m);
});

// ---- 上传 ----
app.post('/api/upload', upload.single('files'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  try {
    const ext = path.extname(req.file.filename);
    const id = req.file.filename.replace(ext, '');
    const m = await finalizeLocal(id, req.file.originalname || req.file.filename, req.file.path, req.file.size, 'upload', '/media/' + req.file.filename);
    res.json({ material: m });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 本地文件夹批量导入 ----
app.post('/api/import', async (req, res) => {
  const { dir } = req.body || {};
  if (!dir) return res.status(400).json({ error: '缺少目录路径 dir' });
  const abs = path.resolve(dir.trim());
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return res.status(400).json({ error: '目录不存在: ' + abs });

  let added = 0, skipped = 0, failed = 0;
  const walk = async (d) => {
    for (const it of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, it.name);
      if (it.isDirectory()) await walk(full);
      else if (it.isFile() && MEDIA_EXT.includes(path.extname(it.name).toLowerCase())) {
        if (db.prepare(`SELECT id FROM materials WHERE name=? AND status='active'`).get(it.name)) { skipped++; continue; }
        const id = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(it.name).toLowerCase();
        const dest = path.join(LIBRARY_DIR, id + ext);
        try {
          fs.copyFileSync(full, dest);
          await finalizeLocal(id, it.name, dest, fs.statSync(full).size, 'local', '/media/' + id + ext);
          added++;
        } catch { failed++; }
      }
    }
  };
  await walk(abs);
  res.json({ added, skipped, failed, dir: abs });
});

// ---- 删除 ----
app.delete('/api/materials/:id', (req, res) => {
  const m = getMaterial(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const del = (ref) => {
    if (ref && ref.startsWith('/media/')) {
      try { fs.unlinkSync(path.join(LIBRARY_DIR, path.basename(ref))); } catch {}
    }
  };
  del(m.ref);
  for (const f of m.basic?.frames || []) del('/media/thumbs/' + f.file);
  db.prepare(`UPDATE materials SET status='deleted' WHERE id=?`).run(m.id);
  res.json({ ok: true });
});

// ---- AI 多模态评测（可选，需 GEMINI_API_KEY） ----
app.post('/api/analyze/:id', async (req, res) => {
  const m = getMaterial(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  if (!aiAvailable()) return res.status(200).json({ ai: false, message: '未配置 GEMINI_API_KEY，当前使用本地启发式评分。' });
  try {
    const frames = (m.basic?.frames || []).map(f => path.join(THUMBS_DIR, f.file)).filter(fs.existsSync);
    if (!frames.length) return res.status(200).json({ ai: false, message: '无关键帧可分析' });
    const result = await analyzeWithAI(frames, frames.map(() => 'image/jpeg'));
    if (!result) return res.status(200).json({ ai: false, message: 'AI 评测未返回有效结果' });
    m.analysis.hook = { ...m.analysis.hook, ...result.hook };
    m.analysis.engagement = { ...m.analysis.engagement, ...result.engagement };
    m.analysis.value = { ...m.analysis.value, ...result.value };
    m.analysis.aiAssessed = true;
    const pr = result.policy_risks || [];
    pr.forEach(r => { if (r.key) m.custom.riskState[r.key] = true; });
    refresh(m);
    saveMaterial(m);
    res.json({ ai: true, material: m });
  } catch (e) {
    res.status(500).json({ ai: false, error: e.message });
  }
});

// ---- 模型与能力 ----
app.get('/api/model', async (req, res) => {
  res.json({
    weights,
    labels: JEV_LABELS,
    enums: ENUMS,
    policyRules: POLICY_RULES,
    grades: GRADE_BANDS,
    ai: { available: aiAvailable() },
    caps: await capabilities()
  });
});
app.put('/api/model', (req, res) => {
  const w = req.body?.weights;
  if (!w) return res.status(400).json({ error: '缺少 weights' });
  const clean = {
    j: num(w.j, DEFAULT_WEIGHTS.j),
    e: num(w.e, DEFAULT_WEIGHTS.e),
    v: num(w.v, DEFAULT_WEIGHTS.v),
    platforms: {
      meta:   sanW(w.platforms?.meta, DEFAULT_WEIGHTS.platforms.meta),
      google: sanW(w.platforms?.google, DEFAULT_WEIGHTS.platforms.google),
      tiktok: sanW(w.platforms?.tiktok, DEFAULT_WEIGHTS.platforms.tiktok)
    }
  };
  weights = clean;
  saveWeights(weights);
  for (const row of db.prepare(`SELECT * FROM materials WHERE status='active'`).all()) {
    const m = rowToMaterial(row);
    refresh(m); saveMaterial(m);
  }
  res.json({ weights });
});
const num = (x, d) => { const n = Number(x); return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : d; };
const sanW = (o, def) => {
  const r = {};
  for (const k of Object.keys(def)) r[k] = num(o?.[k], def[k]);
  return r;
};

const PORT = process.env.PORT || 8700;
// 启动时全库重算（规则/模型更新后自动纠正存量评分）
for (const row of db.prepare(`SELECT * FROM materials WHERE status='active'`).all()) {
  try { const m = rowToMaterial(row); refresh(m); saveMaterial(m); } catch {}
}
app.listen(PORT, async () => {
  const caps = await capabilities();
  console.log(`JEV Creative Workbench 已启动: http://localhost:${PORT}`);
  console.log(`能力: ffmpeg=${caps.ffmpeg} ffprobe=${caps.ffprobe} OCR=${caps.tesseract} ASR=${caps.whisper} AI=${aiAvailable()}`);
});