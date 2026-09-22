import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  DEFAULT_WEIGHTS, DIMENSION_LABELS, DIMENSION_DESC,
  computeComposite, getGrade, scanComplianceFlags,
  evaluatePlatformVerdict, autoTags, heuristicDims, COMPLIANCE_RULES
} from './scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LIBRARY_DIR = path.join(ROOT, 'library');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MODEL_FILE = path.join(DATA_DIR, 'model.json');

for (const dir of [DATA_DIR, LIBRARY_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------- 存储 ----------
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { materials: [] };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return { materials: [] }; }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function loadModel() {
  if (fs.existsSync(MODEL_FILE)) {
    try { return JSON.parse(fs.readFileSync(MODEL_FILE, 'utf-8')); } catch {}
  }
  return DEFAULT_WEIGHTS;
}
function saveModel(model) { fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2)); }

let model = loadModel();

// 允许的媒体扩展
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif'];
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'];
const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT, '.mp3', '.wav', '.ogg'];

function mediaTypeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'other';
}

// 生成素材对象（未评分时用启发式预评）
function buildMaterial({ id, name, kind, ref, mediaType, sizeBytes, createdAt }) {
  const dims = heuristicDims({ mediaType, sizeM: sizeBytes ? sizeBytes / 1024 / 1024 : 0 });
  const composite = computeComposite(dims, model);
  const gradeInfo = getGrade(composite);
  const flags = scanComplianceFlags(name, ref);
  const verdict = evaluatePlatformVerdict(dims, composite, flags, mediaType);
  const tags = autoTags({ score: composite, grade: gradeInfo, dims, mediaType, flags, complianceDim: dims.compliance });
  return {
    id, name, kind, ref, mediaType, sizeBytes,
    createdAt, updatedAt: createdAt,
    dims, composite, grade: gradeInfo.grade,
    gradeInfo: { label: gradeInfo.label, advice: gradeInfo.advice, min: gradeInfo.min },
    flags: flags.map(f => f).concat(COMPLIANCE_RULES.filter(r => !flags.some(h => h.key === r.key)).map(r => ({ key: r.key, automatic: false }))).map(f => ({ ...f, checked: flags.some(h => h.key === f.key) })),
    verdict, tags: tags.filter(t => !flags.some(h => COMPLIANCE_RULES.some(r => r.key === h.key && r.label === t))).concat(flags.map(f => COMPLIANCE_RULES.find(r => r.key === f.key && r.label).label).filter(Boolean)),
    customTags: [],
    category: '未分类',
    notes: '',
    meta: {} // ctr/cvr/roas/impr
  };
}

// 从任何维度/flag/meta 重算并更新一个素材（服务端权威重算）
function recompute(m, overrideFlagCheck = []) {
  const flags = overrideFlagCheck.length ? overrideFlagCheck : m.flags.filter(f => f.checked).map(f => ({ key: f.key }));
  const composite = computeComposite(m.dims, model);
  const gradeInfo = getGrade(composite);
  const verdict = evaluatePlatformVerdict(m.dims, composite, flags, m.mediaType);
  const complianceDim = m.dims.compliance;
  m.composite = composite;
  m.grade = gradeInfo.grade;
  m.gradeInfo = gradeInfo;
  m.verdict = verdict;
  m.tags = autoTags({ score: composite, grade: gradeInfo, dims: m.dims, mediaType: m.mediaType, flags, complianceDim: m.dims.compliance });
  m.flags = COMPLIANCE_RULES.map(r => {
    const existing = m.flags.find(f => f.key === r.key);
    return { key: r.key, automatic: existing ? existing.automatic : false, checked: existing ? existing.checked : false };
  });
  m.updatedAt = Date.now();
  return m;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// multer 上传（存本地库）
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LIBRARY_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, id + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ---------- API ----------

// 全库
app.get('/api/materials', (req, res) => {
  res.json(loadDB().materials);
});

// 保存一条（评分/标签/备注等）
app.put('/api/materials/:id', (req, res) => {
  const db = loadDB();
  const idx = db.materials.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const m = db.materials[idx];
  const body = req.body || {};

  if (body.dims) m.dims = { ...m.dims, ...body.dims };
  if (body.customTags !== undefined) m.customTags = body.customTags;
  if (body.category !== undefined) m.category = body.category;
  if (body.notes !== undefined) m.notes = body.notes;
  if (body.meta !== undefined) m.meta = body.meta;
  if (body.checkedFlags !== undefined) {
    m.flags = m.flags.map(f => ({ ...f, checked: body.checkedFlags.includes(f.key) }));
  }
  recompute(m);
  saveDB(db);
  res.json(m);
});

// 新建：粘贴链接 或 传 name/kind
app.post('/api/materials', (req, res) => {
  const db = loadDB();
  const { name, url } = req.body || {};
  if (!name && !url) return res.status(400).json({ error: '需要 name 或 url' });
  const mName = url ? (name || url.split('/').pop() || 'linked-material') : name;
  const m = buildMaterial({
    id: crypto.randomBytes(8).toString('hex'),
    name: mName,
    kind: 'url',
    ref: url || '',
    mediaType: 'image', // 链接类型未知，默认按图；用户可在详情改
    sizeBytes: 0,
    createdAt: Date.now()
  });
  db.materials.unshift(m);
  saveDB(db);
  res.json(m);
});

// 页面上传（文件）
app.post('/api/upload', upload.single('files'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  const db = loadDB();
  const ext = path.extname(req.file.filename);
  mediaTypeGuess(req, res, () => {
    const m = buildMaterial({
      id: req.file.filename.replace(ext, ''),
      name: req.file.originalname || req.file.filename,
      kind: 'local',
      ref: '/media/' + req.file.filename,
      mediaType: mediaTypeOf(req.file.filename),
      sizeBytes: req.file.size,
      createdAt: Date.now()
    });
    db.materials.unshift(m);
    saveDB(db);
    res.json({ material: m, uploadedFile: req.file.filename });
  });
});
function mediaTypeGuess(req, res, next) { const _ = req; next(); }

// 本地文件夹批量导入（服务端扫描路径）
app.post('/api/import', (req, res) => {
  const { dir } = req.body || {};
  if (!dir) return res.status(400).json({ error: '缺少目录路径 dir' });
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return res.status(400).json({ error: '目录不存在: ' + abs });
  }
  const db = loadDB();
  const existingRefs = new Set(db.materials.map(m => m.kind === 'local' ? m.ref : null).filter(Boolean));
  let added = 0, skipped = 0;
  const walk = (dirAbs) => {
    let items = [];
    try { items = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(dirAbs, it.name);
      if (it.isDirectory()) walk(full);
      else if (it.isFile() && MEDIA_EXT.includes(path.extname(it.name).toLowerCase())) {
        const stat = fs.statSync(full);
        const rel = path.relative(abs, full);
        const ref = '/media/' + encodeURIComponent(path.basename(full));
        if (existingRefs.has(rel)) { skipped++; continue; }
        // 复制进本地库
        const id = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(it.name).toLowerCase();
        const dest = path.join(LIBRARY_DIR, id + ext);
        fs.copyFileSync(full, dest);
        const m = buildMaterial({
          id, name: it.name, kind: 'local', ref: '/media/' + id + ext,
          mediaType: mediaTypeOf(it.name), sizeBytes: stat.size, createdAt: Date.now()
        });
        existingRefs.add(rel);
        db.materials.unshift(m);
        added++;
      }
    }
  };
  walk(abs);
  saveDB(db);
  res.json({ added, skipped, dir: abs });
});

// 读取媒体文件
app.use('/media', express.static(LIBRARY_DIR));

// 删除素材（同时删除本地媒体文件）
app.delete('/api/materials/:id', (req, res) => {
  const db = loadDB();
  const idx = db.materials.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const m = db.materials[idx];
  if (m.kind === 'local' && m.ref && m.ref.startsWith('/media/')) {
    const file = path.join(LIBRARY_DIR, path.basename(m.ref));
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
  db.materials.splice(idx, 1);
  saveDB(db);
  res.json({ ok: true });
});

// 评分模型（权重）读写
app.get('/api/model', (req, res) => {
  res.json({
    weights: model,
    dimensions: DIMENSION_LABELS,
    descriptions: DIMENSION_DESC,
    rules: COMPLIANCE_RULES,
    grades: [
      {grade:'S',min:90,label:'优秀'},{grade:'A',min:80,label:'良好'},
      {grade:'B',min:70,label:'合格'},{grade:'C',min:55,label:'待优化'},{grade:'D',min:0,label:'不合格'}
    ]
  });
});
app.put('/api/model', (req, res) => {
  const w = req.body?.weights;
  if (!w) return res.status(400).json({ error: '缺少 weights' });
  const sanitized = {};
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    sanitized[k] = Math.max(0, Math.min(100, Number(w[k]) || DEFAULT_WEIGHTS[k]));
  }
  model = sanitized;
  saveModel(model);
  // 重算全库
  const db = loadDB();
  db.materials.forEach(m => recompute(m));
  saveDB(db);
  res.json({ weights: model });
});

// 静态前端
app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 8700;
app.listen(PORT, () => {
  console.log(`JEV Creative Studio 已启动: http://localhost:${PORT}`);
});