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
  DEFAULT_WEIGHTS, DEFAULT_MODEL, sanitizeModel,
  JEV_LABELS, ENUMS, POLICY_RULES, GRADE_BANDS,
  recomputeAnalysis, heuristicBaseline, scanPolicy
} from './engine/jev-engine.js';
import { buildTags, indexText } from './engine/tags.js';
import { probeMedia, extractKeyframes, buildTimeline, capabilities } from './engine/pipeline.js';
import { analyzeWithTypeSafe, aiAvailable } from './engine/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LIBRARY_DIR = path.join(ROOT, 'library');
const THUMBS_DIR = path.join(LIBRARY_DIR, 'thumbs');
const DB_FILE = path.join(DATA_DIR, 'workbench.db');

// 加载本地 .env（TYPESAFE_API_KEY 等）
try {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  }
} catch {} // 无 .env 时忽略（仅失去 AI 评测能力）

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

// 完整模型配置存取（weights + gradeBands + verdict）
const loadModel = () => {
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key='model'`).get();
    if (row) return sanitizeModel(JSON.parse(row.value));
  } catch {}
  // 兼容旧版 weights 存储
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key='weights'`).get();
    if (row) return sanitizeModel({ weights: JSON.parse(row.value) });
  } catch {}
  return sanitizeModel(DEFAULT_MODEL);
};
const saveModelCfg = model => db.prepare(`INSERT INTO meta(key,value) VALUES('model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(model));
let model = loadModel();

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

  // 保留 AI 审核字段（recompute 返回新对象会丢弃非 JEV 键）
  const prevAI = m.analysis.aiAssessed ? {
    aiAssessed: true,
    aiRecommendation: m.analysis.aiRecommendation,
    aiRecommendReason: m.analysis.aiRecommendReason,
    aiProvider: m.analysis.aiProvider
  } : null;
  m.analysis = recomputeAnalysis(
    { ...m.analysis, hook, engagement, value, policy: { score: 9, risks } },
    m.basic, model
  );
  if (prevAI) Object.assign(m.analysis, prevAI);
  m.analysis.tags = buildTags(m, m.analysis, m.basic, m.custom);
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

// ---- 素材重复率排查（文件名归一化 + 变体分组 + 相似度） ----
app.get('/api/duplicates', (req, res) => {
  const rows = db.prepare(`SELECT * FROM materials WHERE status='active'`).all();
  const round1 = n => Math.round((n || 0) * 10) / 10;
  // 归一化基名：去扩展名 → 小写 → 剥离版本后缀(_v000 / _010 / -03 / 数字串)
  const normBase = name => {
    const s = String(name || '').replace(/\.[^.]+$/, '').toLowerCase()
      .replace(/[_\s-]+v?\d{2,}$/, '')
      .replace(/[_\s-]*\d{3}$/, '')
      .replace(/[_\s-]+$/, '')
      .trim();
    return s || String(name || '');
  };
  const groups = {};
  for (const row of rows) {
    const m = rowToMaterial(row);
    const base = normBase(m.name);
    (groups[base] = groups[base] || []).push(m);
  }
  const dups = Object.entries(groups)
    .filter(([, ms]) => ms.length > 1)
    .map(([base, ms]) => {
      ms.sort((a, b) => (b.analysis.composite || 0) - (a.analysis.composite || 0));
      const best = ms[0];
      // 相似度：同基名基础 74 + 类型/画幅/时长一致性加成
      const sim = ms.map(m => {
        let s = 74;
        if (m.basic.mediaType === best.basic.mediaType) s += 8;
        if (m.basic.aspect && m.basic.aspect === best.basic.aspect) s += 10;
        const d1 = m.basic.durationSec || 0, d2 = best.basic.durationSec || 0;
        if (d1 && d2 && Math.abs(d1 - d2) <= Math.max(2, d2 * 0.1)) s += 8;
        return Math.min(100, s);
      });
      return {
        base, count: ms.length,
        bestId: best.id, bestName: best.name, bestScore: round1(best.analysis.composite),
        members: ms.map((m, i) => ({
          id: m.id, name: m.name, score: round1(m.analysis.composite),
          grade: m.analysis.grade || '', ref: m.ref, mediaType: m.basic.mediaType,
          poster: m.basic.poster || null, aspect: m.basic.aspect || null,
          sim: sim[i], isBest: i === 0
        }))
      };
    })
    .sort((a, b) => b.count - a.count);
  const involved = dups.reduce((s, g) => s + g.count, 0);
  res.json({
    rate: rows.length ? Math.round(involved / rows.length * 100) : 0,
    involved, groupCount: dups.length, total: rows.length,
    groups: dups
  });
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

// ---- AI 评测（TypeSafe System One / Jev 模型，需 TYPESAFE_API_KEY） ----
// 把 TypeSafe 结果回填素材并落库（单条/批量共用）
async function applyAIResult(m, result) {
  if (result.hook?.score != null) m.analysis.hook.score = result.hook.score;
  if (result.engagement?.score != null) m.analysis.engagement.score = result.engagement.score;
  if (result.value?.score != null) m.analysis.value.score = result.value.score;
  if (result.value?.ctaScore != null) m.analysis.value.ctaScore = result.value.ctaScore;

  const isDefault = (v, defs) => !v || defs.includes(v);
  if (result.hook?.hookType && isDefault(m.analysis.hook.hookType, ['无明确钩子'])) {
    m.analysis.hook.hookType = result.hook.hookType;
  }
  if (result.engagement?.actor && isDefault(m.analysis.engagement.actor, ['无真人'])) {
    m.analysis.engagement.actor = result.engagement.actor;
  }
  if (result.engagement?.scene && isDefault(m.analysis.engagement.scene, ['室内'])) {
    m.analysis.engagement.scene = result.engagement.scene;
  }
  if (result.engagement?.beforeAfter != null && !m.analysis.engagement.beforeAfter) {
    m.analysis.engagement.beforeAfter = result.engagement.beforeAfter;
  }

  // AI 审核建议（keep / review / reject）+ 理由
  m.analysis.aiRecommendation = result.recommendation || 'review';
  m.analysis.aiRecommendReason = result.recommendReason || '';
  m.analysis.aiAssessed = true;
  m.analysis.aiProvider = result.provider || 'typesafe';

  // 双平台投放适配结果（Meta / Google）
  if (result.platform) m.analysis.platform = result.platform;

  // 合规风险：Noul 判定 → riskState 勾选（critical 类）
  const riskState = m.custom.riskState || {};
  const RULES = { riskHealth: 'health', riskMislead: 'mislead', riskPolicy: 'adult' };
  for (const [k, ruleKey] of Object.entries(RULES)) {
    if (result.policy?.[k] === true) riskState[ruleKey] = true;
  }
  m.custom.riskState = riskState;

  refresh(m);
  saveMaterial(m);
  return m;
}

// 带限流退避的 TypeSafe 调用（429/529 → 指数退避重试）
async function callTypeSafeWithRetry(material, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await analyzeWithTypeSafe(material);
    } catch (e) {
      const isRate = /429|529|Too Many|Overloaded/.test(e.message);
      if (!isRate || i >= retries) throw e;
      await new Promise(r => setTimeout(r, 1200 * Math.pow(2, i)));
    }
  }
  return null;
}

// 本地启发式评测（未配置 TYPESAFE_API_KEY 时的兜底扫描，保证扫描流程可演示）
function localAIResult(m) {
  const a = m.analysis || {};
  const risks = a.policy?.risks || [];
  const hasRisk = risks.some(r => r.level === 'critical');
  const avg = ((a.hook?.score || 0) + (a.engagement?.score || 0) + (a.value?.score || 0)) / 3;
  let recommendation = 'review';
  let reason = '三维中等，建议人工复核关键短板';
  if (hasRisk) { recommendation = 'reject'; reason = '检测到合规风险项（critical 一票否决）'; }
  else if (avg >= 7) { recommendation = 'keep'; reason = 'J/E/V 三维均强势，质量达标'; }
  else if (avg < 4.5) { recommendation = 'reject'; reason = '三维偏弱，建议淘汰或重构'; }
  const fbFit = Math.round(Math.min(10, avg) * 10) / 10;
  const pfVerdict = f => (f >= 6.5 ? 'pass' : f >= 4 ? 'review' : 'reject');
  return {
    provider: 'local',
    recommendation,
    recommendReason: reason,
    hook: { score: a.hook?.score },
    engagement: { score: a.engagement?.score },
    value: { score: a.value?.score },
    platform: {
      fbFit,
      googleFit: fbFit,
      best: fbFit >= 4.5 ? '双平台通用' : '两平台均不宜',
      fbVerdict: pfVerdict(fbFit),
      googleVerdict: pfVerdict(fbFit)
    },
    policy: {}
  };
}

app.post('/api/analyze/:id', async (req, res) => {
  const m = getMaterial(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  if (!aiAvailable()) {
    const local = localAIResult(m);
    await applyAIResult(m, local);
    return res.json({ ai: false, provider: 'local', message: '未配置 TYPESAFE_API_KEY，已使用本地启发式评测。', recommendation: local.recommendation, material: m });
  }
  try {
    const result = await callTypeSafeWithRetry(m);
    if (!result) return res.status(200).json({ ai: false, message: 'TypeSafe 评测未返回有效结果' });
    const updated = await applyAIResult(m, result);
    res.json({ ai: true, provider: 'typesafe', recommendation: result.recommendation, confidence: result.confidence, material: updated });
  } catch (e) {
    res.status(500).json({ ai: false, error: e.message });
  }
});

// ---- 批量 AI 评测（并发 + 逐条落库 + 进度） ----
app.post('/api/analyze-batch', async (req, res) => {
  const { ids = [], concurrency = 3 } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '缺少 ids' });

  const queue = ids.map(id => getMaterial(id)).filter(Boolean);
  const done = [];
  const failed = [];

  if (!aiAvailable()) {
    // 未配置 TypeSafe：逐条本地启发式评测（保证扫描队列可逐格点亮）
    for (const m of queue) {
      try {
        const local = localAIResult(m);
        await applyAIResult(m, local);
        done.push({ id: m.id, name: m.name, recommendation: local.recommendation });
      } catch (e) {
        failed.push({ id: m.id, name: m.name, error: e.message.slice(0, 120) });
      }
    }
    return res.json({ ai: false, provider: 'local', total: queue.length, done: done.length, failed, doneList: done });
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const idx = cursor++;
      const m = queue[idx];
      try {
        const result = await callTypeSafeWithRetry(m);
        if (result) {
          await applyAIResult(m, result);
          done.push({ id: m.id, name: m.name, recommendation: result.recommendation });
        } else {
          failed.push({ id: m.id, name: m.name, error: '无有效结果' });
        }
      } catch (e) {
        failed.push({ id: m.id, name: m.name, error: e.message.slice(0, 120) });
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(6, +concurrency || 3)) }, worker);
  await Promise.all(workers);
  res.json({ ai: true, total: queue.length, done: done.length, failed, doneList: done });
});

// ---- 模型与能力 ----
app.get('/api/model', async (req, res) => {
  res.json({
    model,
    defaults: DEFAULT_MODEL,
    labels: JEV_LABELS,
    enums: ENUMS,
    policyRules: POLICY_RULES,
    grades: GRADE_BANDS,
    ai: { available: aiAvailable() },
    caps: await capabilities()
  });
});
app.put('/api/model', (req, res) => {
  const next = sanitizeModel(req.body || {});
  model = next;
  saveModelCfg(model);
  for (const row of db.prepare(`SELECT * FROM materials WHERE status='active'`).all()) {
    const m = rowToMaterial(row);
    refresh(m); saveMaterial(m);
  }
  res.json({ model });
});

const PORT = process.env.PORT || 8700;
// 启动时全库重算（规则/模型更新后自动纠正存量评分）
for (const row of db.prepare(`SELECT * FROM materials WHERE status='active'`).all()) {
  try { const m = rowToMaterial(row); refresh(m); saveMaterial(m); } catch {}
}
// 一次性修复：已评估但推荐值丢失的存量素材（按分数+风险确定性重推）
let repaired = 0;
for (const row of db.prepare(`SELECT * FROM materials WHERE status='active'`).all()) {
  try {
    const m = rowToMaterial(row);
    const a = m.analysis;
    if (!a.aiAssessed || a.aiRecommendation) continue;
    const risks = (a.policy && a.policy.risks) || [];
    const hasCritical = risks.some(r => r.level === 'critical');
    const avg = ((a.hook?.score || 0) + (a.engagement?.score || 0) + (a.value?.score || 0)) / 3;
    a.aiRecommendation = hasCritical ? 'reject' : avg >= 7 ? 'keep' : avg >= 4.5 ? 'review' : 'reject';
    a.aiRecommendReason = hasCritical
      ? '存在关键合规风险（历史数据恢复推导）'
      : a.aiRecommendation === 'keep'
        ? 'J/E/V 三维均强势，质量达标（历史数据恢复推导）'
        : a.aiRecommendation === 'review'
          ? '三维中等，建议人工复核（历史数据恢复推导）'
          : '三维偏弱，建议淘汰（历史数据恢复推导）';
    a.aiProvider = 'recovered';
    saveMaterial(m);
    repaired++;
  } catch {}
}
if (repaired) console.log(`已修复 ${repaired} 条丢失 AI 推荐值的素材记录`);
app.listen(PORT, async () => {
  const caps = await capabilities();
  console.log(`JEV Creative Workbench 已启动: http://localhost:${PORT}`);
  console.log(`能力: ffmpeg=${caps.ffmpeg} ffprobe=${caps.ffprobe} OCR=${caps.tesseract} ASR=${caps.whisper} TypeSafeAI=${aiAvailable() ? '✓(Jev)' : '✗(无 TYPESAFE_API_KEY)'}`);
});