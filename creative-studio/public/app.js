// =============================================================
// JEV Creative Workbench · 前端逻辑（看素材 / 筛素材 / 评素材）
// =============================================================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Math.round(n * 10) / 10;

let MATERIALS = [];
let MODEL = null;   // {weights, labels, enums, policyRules, grades, ai, caps}
let view = 'grid';
let boardBy = 'grade';
let selectedId = null;
let sortBy = 'composite-desc';

// -------- 筛选状态（全部可视化在左侧面板） --------
const F = {
  q: '',
  grades: new Set(),    // S/A/B/C/D 多选
  categories: new Set(),// 品类
  review: new Set(),    // 审片状态 todo/keep/reject
  media: new Set(),     // video/image
  channels: new Set(),  // google/meta/tiktok（可投=GO）
  actors: new Set(),
  hooks: new Set(),
  tags: new Set(),
  minScore: 0, maxScore: 100,
  riskOnly: false
};

const GCOLOR = { S: '#10b981', A: '#22c55e', B: '#0ea5e9', C: '#f59e0b', D: '#ef4444' };
const CH_ICON = { google: 'G', meta: 'M', tiktok: 'T' };
const CH_NAME = { google: 'Google', meta: 'Meta', tiktok: 'TikTok' };

// ---------------- 客户端镜像计算（实时预览用） ----------------
function clComputeComposite(a) {
  const w = MODEL.weights;
  const sum = w.j + w.e + w.v;
  const s = ((a.hook?.score || 0) * w.j + (a.engagement?.score || 0) * w.e + (a.value?.score || 0) * w.v) / sum;
  return fmt(s * 10);
}
function clGrade(score) { return MODEL.grades.find(b => score >= b.min) || MODEL.grades[MODEL.grades.length - 1]; }
function clPolicyScore(risks) {
  const c = risks.filter(r => r.level === 'critical').length, w = risks.filter(r => r.level === 'warning').length;
  return Math.max(1, Math.min(10, fmt(10 - c * 4 - w * 1.2)));
}
function clNative(a) {
  const e = a.engagement || {}; let s = 5;
  if (e.actor === '欧美真人' || e.actor === '亚洲真人') s += 2.5;
  else if (e.actor === '3D动画') s += 0.5;
  else if (e.actor === '无真人' || e.actor === 'AI合成') s -= 1.5;
  if ((e.trust || []).includes('UGC真人出镜')) s += 1.5;
  if (e.scene === '室内' || e.scene === '街头') s += 0.5;
  if (a.value?.offer && a.value.offer !== '无促销') s -= 1;
  return Math.max(0, Math.min(10, s));
}
function clPlatforms(m, risks) {
  const a = m.analysis, w = MODEL.weights.platforms, basic = m.basic;
  const j = a.hook?.score || 0, e = a.engagement?.score || 0, v = a.value?.score || 0;
  const P = clPolicyScore(risks), nat = clNative(a);
  const critical = risks.filter(r => r.level === 'critical'), warning = risks.filter(r => r.level === 'warning');
  const mk = (pw) => {
    const raw = j * pw.hook + e * pw.engagement + v * pw.value + P * pw.policy + (pw.native ? nat * pw.native : 0);
    const wsum = pw.hook + pw.engagement + pw.value + pw.policy + (pw.native || 0);
    let fit = fmt(raw / wsum * 10);
    const reasons = [];
    const asp = basic.aspect;
    if (pw.native) { if (asp === '9:16') { fit += 5; reasons.push('竖屏原生形态友好'); } }
    if (!pw.native && pw.value === w.google.value) {
      if (asp === '1:1' || asp === '16:9') { fit += 4; reasons.push('画幅兼容 YouTube/PMax'); }
      if (basic.resolution === 'FHD' || basic.resolution === '4K') { fit += 3; reasons.push('高画质利于 YouTube'); }
    }
    if (pw.hook === w.meta.hook && (e.trust || []).includes('UGC真人出镜')) { fit += 3; reasons.push('UGC 社交信任感强'); }
    fit = Math.max(0, Math.min(100, fmt(fit)));
    let verdict = fit >= 72 ? 'GO' : fit >= 58 ? 'COND' : 'NO';
    if (critical.length) { verdict = 'NO'; reasons.unshift('违禁(一票否决)'); }
    for (const rw of warning) if (verdict === 'GO') verdict = 'COND';
    return { fit, verdict, reasons };
  };
  const g = mk({ hook: w.google.hook, engagement: w.google.engagement, value: w.google.value, policy: w.google.policy });
  const meta = mk({ hook: w.meta.hook, engagement: w.meta.engagement, value: w.meta.value, policy: w.meta.policy, native: 0.34 });
  const tiktok = mk({ hook: w.tiktok.hook, engagement: w.tiktok.engagement, value: w.tiktok.value, policy: w.tiktok.policy, native: w.tiktok.native });
  return { google: g, meta, tiktok };
}

// ---------------- 数据 ----------------
async function loadData() {
  const [mats, mod] = await Promise.all([
    fetch('/api/materials').then(r => r.json()),
    fetch('/api/model').then(r => r.json())
  ]);
  MATERIALS = mats; MODEL = mod;
  render();
}

const effGrade = m => m.custom?.manualGrade || m.analysis.grade;
const effChannel = m => m.custom?.manualChannel || bestChannel(m);
function bestChannel(m) {
  const ps = m.analysis.platforms || {};
  let best = null, bf = -1;
  for (const k of ['google', 'meta', 'tiktok']) {
    const p = ps[k];
    if (!p) continue;
    const s = p.verdict === 'GO' ? p.fit + 30 : p.verdict === 'COND' ? p.fit : p.fit - 30;
    if (s > bf) { bf = s; best = k; }
  }
  return best;
}
const flatTags = m => [...(m.analysis.tags?.basic || []), ...(m.analysis.tags?.content || []), ...(m.analysis.tags?.strategy || []), ...(m.analysis.tags?.advice || []), ...(m.custom?.customTags || [])];
const policyRiskCount = m => (m.analysis.policy?.risks || []).length;
const revOf = m => m.custom?.review || 'todo';   // 审片状态：todo 未审 / keep 通过 / reject 淘汰

// ---------------- 筛选 ----------------
function hasFilter() {
  return F.q || F.grades.size || F.media.size || F.channels.size || F.actors.size || F.hooks.size || F.tags.size ||
    F.riskOnly || F.minScore > 0 || F.maxScore < 100;
}
function filtered() {
  const q = F.q.trim().toLowerCase();
  return MATERIALS.filter(m => {
    if (F.grades.size && !F.grades.has(effGrade(m))) return false;
    if (F.categories.size && !F.categories.has(m.custom?.category || '未分类')) return false;
    if (F.review.size && !F.review.has(revOf(m))) return false;
    if (F.media.size && !F.media.has(m.basic.mediaType)) return false;
    if (F.actors.size && !F.actors.has(m.analysis.engagement?.actor || '')) return false;
    if (F.hooks.size && !F.hooks.has(m.analysis.hook?.hookType || '无明确钩子')) return false;
    if (F.channels.size && ![...F.channels].some(k => m.analysis.platforms?.[k]?.verdict === 'GO')) return false;
    if (F.riskOnly && !policyRiskCount(m)) return false;
    const sc = m.analysis.composite;
    if (sc < F.minScore || sc > F.maxScore) return false;
    if (F.tags.size) {
      const tt = new Set(flatTags(m));
      for (const t of F.tags) if (!tt.has(t)) return false;
    }
    if (q) {
      const hay = (m.name + ' ' + flatTags(m).join(' ') + ' ' + (m.analysis.engagement?.painPoint || '') + ' ' + (m.custom?.notes || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const [field, dir] = sortBy.split('-');
    if (field === 'composite') return dir === 'desc' ? b.analysis.composite - a.analysis.composite : a.analysis.composite - b.analysis.composite;
    if (field === 'updated') return b.updatedAt - a.updatedAt;
    if (field === 'name') return a.name.localeCompare(b.name, 'zh');
    return 0;
  });
}

// ---------------- 左侧筛选面板 ----------------
function countBy(fn) {
  const c = {};
  for (const m of MATERIALS) { const k = fn(m); if (k) c[k] = (c[k] || 0) + 1; }
  return c;
}
function togF(key, val) {
  const s = F[key];
  if (s.has(val)) s.delete(val); else s.add(val);
  renderPanel(); renderMain();
}
function setF(key, val, on) {
  const s = F[key];
  if (on) s.add(val); else s.delete(val);
  renderPanel(); renderMain();
}
function renderPanel() {
  // 评级胶囊
  $('fGrades').innerHTML = MODEL.grades.map(g => {
    const n = MATERIALS.filter(m => effGrade(m) === g.grade).length;
    return `<span class="fchip ${F.grades.has(g.grade) ? 'on' : ''}" onclick="togF('grades','${g.grade}')"><i class="gdot" style="background:${GCOLOR[g.grade]}"></i>${g.grade} · ${g.label}<small>${n}</small></span>`;
  }).join('');

  // 审片状态
  const rvCount = { todo: 0, keep: 0, reject: 0 };
  for (const m of MATERIALS) rvCount[revOf(m)]++;
  $('fReview').innerHTML = [['todo', '⏳ 未审'], ['keep', '✅ 通过'], ['reject', '❌ 淘汰']].map(([k, l]) =>
    `<span class="fchip ${F.review.has(k) ? 'on' : ''}" onclick="togF('review','${k}')">${l}<small>${rvCount[k]}</small></span>`).join('');

  // 品类
  const catCount = countBy(m => m.custom?.category || '未分类');
  $('fCats').innerHTML = Object.entries(catCount).sort((a, b) => b[1] - a[1]).map(([c, n]) =>
    `<label><input type="checkbox" ${F.categories.has(c) ? 'checked' : ''} onchange="setF('categories',decodeURIComponent('${encodeURIComponent(c)}'),this.checked)">${esc(c)}<span class="cnt">${n}</span></label>`).join('')
    || '<div class="subtle">暂无分类（详情可设置品类）</div>';

  // 素材类型
  const mediaCount = countBy(m => m.basic.mediaType);
  $('fMedia').innerHTML = [['video', '🎬 视频'], ['image', '🖼️ 单图']].map(([k, l]) =>
    `<label><input type="checkbox" ${F.media.has(k) ? 'checked' : ''} onchange="setF('media','${k}',this.checked)">${l}<span class="cnt">${mediaCount[k] || 0}</span></label>`).join('');

  // 渠道可投
  const chCount = {};
  for (const k of ['google', 'meta', 'tiktok']) chCount[k] = MATERIALS.filter(m => m.analysis.platforms?.[k]?.verdict === 'GO').length;
  $('fChannels').innerHTML = [['google', 'Google Ads 可投'], ['meta', 'Meta/FB 可投'], ['tiktok', 'TikTok 可投']].map(([k, l]) =>
    `<label><input type="checkbox" ${F.channels.has(k) ? 'checked' : ''} onchange="setF('channels','${k}',this.checked)">${l}<span class="cnt">${chCount[k] || 0}</span></label>`).join('');

  // 出镜类型
  const actCount = countBy(m => m.analysis.engagement?.actor);
  $('fActors').innerHTML = MODEL.enums.actor.map(a =>
    `<label><input type="checkbox" ${F.actors.has(a) ? 'checked' : ''} onchange="setF('actors','${esc(a).replace(/'/g, "\\'")}',this.checked)">${a}<span class="cnt">${actCount[a] || 0}</span></label>`).join('');

  // Hook 类型
  const hookCount = countBy(m => m.analysis.hook?.hookType);
  $('fHooks').innerHTML = MODEL.enums.hookType.map(h =>
    `<label><input type="checkbox" ${F.hooks.has(h) ? 'checked' : ''} onchange="setF('hooks','${esc(h).replace(/'/g, "\\'")}',this.checked)">${h}<span class="cnt">${hookCount[h] || 0}</span></label>`).join('');

  // 标签 Top 24
  const tagCount = {};
  for (const m of MATERIALS) for (const t of flatTags(m)) tagCount[t] = (tagCount[t] || 0) + 1;
  const top = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 24);
  $('fTags').innerHTML = top.map(([t, c]) =>
    `<label><input type="checkbox" ${F.tags.has(t) ? 'checked' : ''} onchange="setF('tags',decodeURIComponent('${encodeURIComponent(t)}'),this.checked)">${esc(t)}<span class="cnt">${c}</span></label>`).join('')
    || '<div class="subtle">素材入库后自动生成标签</div>';

  // 汇总
  const parts = [];
  if (F.q) parts.push(`搜索“${F.q}”`);
  if (F.grades.size) parts.push('评级 ' + [...F.grades].join('/'));
  if (F.categories.size) parts.push('品类 ' + [...F.categories].join('/'));
  if (F.review.size) parts.push('审片 ' + [...F.review].map(x => x === 'todo' ? '未审' : x === 'keep' ? '通过' : '淘汰').join('/'));
  if (F.media.size) parts.push([...F.media].map(x => x === 'video' ? '视频' : '单图').join('/'));
  if (F.channels.size) parts.push([...F.channels].map(k => CH_NAME[k]).join('或') + ' 可投');
  if (F.actors.size) parts.push('出镜 ' + [...F.actors].join('/'));
  if (F.hooks.size) parts.push('Hook ' + [...F.hooks].join('/'));
  if (F.tags.size) parts.push('标签×' + F.tags.size);
  if (F.riskOnly) parts.push('仅风险素材');
  if (F.minScore > 0 || F.maxScore < 100) parts.push(`${F.minScore}-${F.maxScore} 分`);
  $('fSummary').innerHTML = parts.length ? `已选 <b>${parts.length}</b> 项：${parts.join(' · ')}` : '当前未筛选（显示全部素材）';
}
function clearFilters() {
  F.q = ''; F.grades.clear(); F.categories.clear(); F.review.clear(); F.media.clear(); F.channels.clear();
  F.actors.clear(); F.hooks.clear(); F.tags.clear();
  F.minScore = 0; F.maxScore = 100; F.riskOnly = false;
  $('searchBox').value = ''; $('fMin').value = ''; $('fMax').value = ''; $('fRiskOnly').checked = false;
  renderPanel(); renderStats(); renderMain();
}

// ---------------- 渲染 ----------------
function render() {
  renderStats(); renderPanel(); renderMain();
}
function renderStats() {
  const n = MATERIALS.length;
  $('statTotal').textContent = n;
  $('statAvg').textContent = n ? fmt(MATERIALS.reduce((a, m) => a + m.analysis.composite, 0) / n) : '--';
  $('statTop').textContent = MATERIALS.filter(m => ['S', 'A'].includes(effGrade(m))).length;
  $('statRisk').textContent = MATERIALS.filter(m => policyRiskCount(m) > 0).length;
  $('statGo').textContent = MATERIALS.filter(m => ['google', 'meta', 'tiktok'].some(k => m.analysis.platforms?.[k]?.verdict === 'GO')).length;
}
function thumbOf(m) {
  if (m.kind === 'url' && /^(https?:)?\/\//.test(m.ref || '')) return m.ref;
  if (m.kind !== 'url') {
    if (m.basic?.mediaType === 'video') return m.basic.poster || m.ref;
    return m.ref;
  }
  return null;
}
function cardHTML(m) {
  const src = thumbOf(m);
  const g = effGrade(m);
  const a = m.analysis;
  const plats = ['google', 'meta', 'tiktok'].map(k => a.platforms?.[k]).filter(Boolean);
  const tagList = [...(a.tags?.advice || []).slice(0, 1), ...(a.tags?.strategy || []).slice(0, 2), ...(a.tags?.content || []).slice(0, 2)];
  const mediaEl = !src ? `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:44px">🗂️</div>`
    : m.basic.mediaType === 'video'
      ? `<video src="${m.ref}" poster="${m.basic.poster || ''}" muted loop preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>`
      : `<img src="${src}" loading="lazy" alt="">`;
  const vChip = (p, k) => `<span class="vchip ${p.verdict === 'GO' ? 'g' : p.verdict === 'COND' ? 'y' : 'r'}" title="${esc((p.reasons || []).join('；'))}"><i>${CH_ICON[k]}</i>${fmt(p.fit)}</span>`;
  return `<article class="card" data-id="${m.id}" draggable="true" onclick="openDrawer('${m.id}')">
    <div class="thumb">${mediaEl}
      ${revOf(m) !== 'todo' ? `<div class="rv-badge ${revOf(m)}">${revOf(m) === 'keep' ? '✅ 通过' : '❌ 淘汰'}</div>` : ''}
      <div class="score-badge ${g}"><b>${fmt(a.composite)}</b><span>分</span></div>
      <div class="grade-chip badge-${g}">${g}级${m.custom?.manualGrade ? ' ✍' : ''}</div>
    </div>
    <div class="card-body">
      <div class="card-title">${esc(m.name)}</div>
      <div class="jev-bars">
        <i class="j"><div class="jb j" style="width:${(a.hook?.score || 0) * 10}%"></div></i>
        <i class="e"><div class="jb e" style="width:${(a.engagement?.score || 0) * 10}%"></div></i>
        <i class="v"><div class="jb v" style="width:${(a.value?.score || 0) * 10}%"></div></i>
      </div>
      <div class="verdicts">${plats.map((p, i) => vChip(p, ['google', 'meta', 'tiktok'][i])).join('')}</div>
      <div class="tags">${tagList.map(t => `<span class="tag ${/风险|违禁/.test(t) ? 'risk' : /建议/.test(t) ? 'advice' : ''}">${esc(t)}</span>`).join('')}</div>
      <div class="card-foot">
        <span>${m.basic.mediaType === 'video' ? '🎬 视频' : '🖼️ 单图'}${a.engagement?.actor ? ' · ' + esc(a.engagement.actor) : ''}</span>
        <span>${policyRiskCount(m) ? '⚠ ' + policyRiskCount(m) + ' 风险' : timeAgo(m.updatedAt)}</span>
      </div>
    </div>
  </article>`;
}
function renderMain() {
  const list = filtered();
  $('hitCount').textContent = list.length;
  $('totalCount').textContent = MATERIALS.length;
  const none = list.length === 0;
  $('empty').classList.toggle('hidden', !none);
  $('emptyText').textContent = MATERIALS.length === 0 ? '素材库为空' : '没有符合条件的素材';
  if (view === 'grid') renderGrid(list);
  else if (view === 'review') renderReview(list);
  else if (view === 'cats') renderCategoryView(list);
  else renderKanban(list);
}
function renderGrid(list) {
  $('kanban').classList.add('hidden');
  $('cats').classList.add('hidden');
  $('review').classList.add('hidden');
  $('grid').classList.remove('hidden');
  $('grid').innerHTML = list.map(cardHTML).join('');
}
function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚'; if (s < 3600) return Math.floor(s / 60) + '分前';
  if (s < 86400) return Math.floor(s / 3600) + '时前';
  return Math.floor(s / 86400) + '天前';
}

// ---------------- 分类状态视图（可视化窗口） ----------------
function statusOf(m) {
  // 单素材综合状态：有违禁风险→禁投；否则有可投→可投；有需优化→需优化
  const risks = m.analysis.policy?.risks || [];
  if (risks.some(r => r.level === 'critical')) return 'no';
  const ps = m.analysis.platforms || {};
  let hasCond = false;
  for (const k of ['google', 'meta', 'tiktok']) {
    const v = ps[k]?.verdict;
    if (v === 'GO') return 'go';
    if (v === 'COND') hasCond = true;
  }
  return hasCond ? 'cond' : 'no';
}
const ST_LABEL = { go: '可投放', cond: '需优化', no: '不可投' };

function overviewChartsHTML(list) {
  // 评级分布
  const gd = MODEL.grades.map(g => ({ ...g, n: list.filter(m => effGrade(m) === g.grade).length }));
  const gMax = Math.max(1, ...gd.map(x => x.n));
  const gradeBar = gd.map(g => `
    <div class="dist-row">
      <span class="dist-lbl"><i class="gdot" style="background:${GCOLOR[g.grade]}"></i>${g.grade}级 ${g.label}</span>
      <div class="dist-bar"><div style="width:${(g.n / gMax) * 100}%;background:${GCOLOR[g.grade]}"></div></div>
      <b class="dist-n">${g.n}</b>
    </div>`).join('');

  // 渠道判定分布（每渠道 GO/COND/NO 三段）
  const chanRows = ['google', 'meta', 'tiktok'].map(k => {
    const c = { GO: 0, COND: 0, NO: 0 };
    for (const m of list) c[m.analysis.platforms?.[k]?.verdict || 'NO']++;
    const total = Math.max(1, c.GO + c.COND + c.NO);
    return `<div class="dist-row">
      <span class="dist-lbl">${CH_ICON[k]} ${CH_NAME[k]}</span>
      <div class="dist-bar stacked">
        <div style="width:${c.GO / total * 100}%;background:#10b981" title="可投 ${c.GO}"></div>
        <div style="width:${c.COND / total * 100}%;background:#f59e0b" title="需优化 ${c.COND}"></div>
        <div style="width:${c.NO / total * 100}%;background:#ef4444" title="不可投 ${c.NO}"></div>
      </div>
      <b class="dist-n">${c.GO}/${c.COND}/${c.NO}</b>
    </div>`;
  }).join('');

  return `<div class="overview-charts">
    <div class="chart-card"><h4>评级分布</h4>${gradeBar}</div>
    <div class="chart-card"><h4>渠道投放状态（可投/需优化/不可投）</h4>${chanRows}</div>
  </div>`;
}

function categoryCardHTML(cat, mats) {
  const avg = fmt(mats.reduce((a, m) => a + m.analysis.composite, 0) / mats.length);
  const riskN = mats.filter(m => policyRiskCount(m) > 0).length;
  const stCount = { go: 0, cond: 0, no: 0 };
  for (const m of mats) stCount[statusOf(m)]++;
  const gd = MODEL.grades.map(g => ({ ...g, n: mats.filter(m => effGrade(m) === g.grade).length }));
  const thumbs = mats.slice(0, 12).map(m => {
    const src = thumbOf(m);
    const st = statusOf(m);
    const img = src ? `<img src="${src}" loading="lazy" alt="">` : '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:20px">🗂️</div>';
    return `<div class="catthumb" title="${esc(m.name)} · ${fmt(m.analysis.composite)}分 · ${ST_LABEL[st]}" onclick="event.stopPropagation();openDrawer('${m.id}')">${img}<span class="st st-${st}"></span></div>`;
  }).join('');
  const gradeBar = `<div class="gradebar">${gd.filter(g => g.n).map(g => `<i style="flex:${g.n};background:${GCOLOR[g.grade]}" title="${g.grade}级×${g.n}"></i>`).join('')}</div>`;
  return `<div class="catcard" onclick="gotoCategory('${esc(cat).replace(/'/g, "\\'")}')">
    <div class="catcard-head">
      <b class="catname">${esc(cat)}</b>
      <span class="subtle">${mats.length} 个素材 · 均分 ${avg}</span>
      ${riskN ? `<span class="tag risk">⚠ ${riskN} 风险</span>` : ''}
      <span class="catstatus"><i class="st st-go"></i>可投 ${stCount.go} <i class="st st-cond"></i>需优化 ${stCount.cond} <i class="st st-no"></i>禁投 ${stCount.no}</span>
    </div>
    <div class="catthumb-strip">${thumbs}</div>
    ${gradeBar}
    <div class="subtle" style="margin-top:6px">点击查看该品类全部素材 →</div>
  </div>`;
}

function renderCategoryView(list) {
  $('grid').classList.add('hidden');
  $('kanban').classList.add('hidden');
  $('review').classList.add('hidden');
  $('cats').classList.remove('hidden');
  if (!list.length) { $('cats').innerHTML = ''; return; }
  // 按品类聚合（未分类的兜底展示）
  const groups = {};
  for (const m of list) {
    const c = m.custom?.category || '未分类';
    (groups[c] = groups[c] || []).push(m);
  }
  const catCards = Object.entries(groups)
    .sort((a, b) => (a[0] === '未分类' ? 1 : 0) - (b[0] === '未分类' ? 1 : 0) || b[1].length - a[1].length)
    .map(([cat, mats]) => categoryCardHTML(cat, mats)).join('');
  $('cats').innerHTML = overviewChartsHTML(list) + catCards;
}
function gotoCategory(cat) {
  // 只保留该品类的筛选并跳回素材墙
  F.categories = new Set([cat]);
  setView('grid');
  renderPanel();
  toast(`已筛选品类：${cat}`);
}

// ---------------- 审片扫描视图（一张一张检查 + 进度条） ----------------
let reviewIdx = 0;
let reviewQueue = [];
let revMode = 'single';     // single 单张扫描 / bulk 批量棋盘
let bulkSel = new Set();    // 批量棋盘已选素材 id
let bulkPage = 0;           // 当前批次
let lastBulkIdx = null;     // shift 连续选择锚点
let lastPageIds = [];       // 当前批 id 顺序
const BATCH = 50;           // 每批 50 张
// 扫描动画状态
let scanOn = false;         // 是否扫描中
let scanIdx = 0;            // 当前扫到的格子序号
let scanTimer = null;
let scanSpeed = 120;        // 每格毫秒（疾速/快速/舒缓）

function setRevMode(v) {
  stopBulkScan();
  revMode = v;
  bulkSel.clear();
  reviewIdx = 0;
  bulkPage = 0;
  scanIdx = 0;
  renderMain();
}

function renderReview(list) {
  reviewQueue = list;
  $('grid').classList.add('hidden');
  $('kanban').classList.add('hidden');
  $('cats').classList.add('hidden');
  $('empty').classList.add('hidden');
  $('review').classList.remove('hidden');
  if (!list.length) { $('review').innerHTML = reviewDoneHTML(); return; }
  const modebar = `
  <div class="rev-modebar">
    <div class="rev-modeseg">
      <button class="rv-seg ${revMode === 'single' ? 'on' : ''}" onclick="setRevMode('single')">🔍 单张扫描</button>
      <button class="rv-seg ${revMode === 'bulk' ? 'on' : ''}" onclick="setRevMode('bulk')">▦ 批量棋盘</button>
    </div>
    <span class="rv-modehint">${revMode === 'single' ? '一张一张检查：P 通过 · X 淘汰 · ←/→ 切换' : `大批量扫选：每批 ${BATCH} 张，点选多张后统一通过/淘汰 · Shift 连续选 · Ctrl 加减选 · 双击看详情`}</span>
  </div>`;
  $('review').innerHTML = modebar + (revMode === 'bulk' ? reviewBulkHTML(list) : reviewSingleHTML(list));
}

// 单张扫描模式主体
function reviewSingleHTML(list) {
  const total = list.length;
  const reviewed = list.filter(x => revOf(x) !== 'todo').length;
  const keepN = list.filter(x => revOf(x) === 'keep').length;
  const rejN = list.filter(x => revOf(x) === 'reject').length;
  if (reviewIdx >= total) reviewIdx = total - 1;
  if (reviewIdx < 0) reviewIdx = 0;
  const m = list[reviewIdx];
  const pct = Math.round(((reviewIdx + 1) / total) * 100);

  return `
  <div class="review-top">
    <div class="rv-meta">检查进度：第 <b>${reviewIdx + 1}</b> / <b>${total}</b> 张
      <span class="rv-stats"><i class="rv-chip keep">✅ 通过 ${keepN}</i><i class="rv-chip reject">❌ 淘汰 ${rejN}</i><i class="rv-chip todo">⏳ 未审 ${total - reviewed}</i></span>
    </div>
    <div class="rv-progress"><i style="width:${pct}%"></i></div>
  </div>
  <div class="review-stage">
    <div class="review-main">
      <div class="rv-frame">
        ${frameHTML(m, reviewIdx, total)}
      </div>
      <div class="rv-actions">
        <button class="rv-btn ghost" onclick="reviewStep(-1)">⏮ 上一张</button>
        <button class="rv-btn reject" onclick="reviewAct('reject')">❌ 淘汰 (X)</button>
        <button class="rv-btn keep" onclick="reviewAct('keep')">✅ 通过 (P)</button>
        <button class="rv-btn ghost" onclick="reviewStep(1)">⏭ 下一张</button>
      </div>
      <div class="rv-hints">快捷键：← 上一张 · → 下一张 · P 通过 · X 淘汰 · 点击下方缩略图可跳转</div>
    </div>
    <aside class="review-side">${reviewSideHTML(m)}</aside>
  </div>
  <div class="review-strip">${stripHTML(list, reviewIdx)}</div>`;
}
function frameHTML(m, i, total) {
  const src = thumbOf(m);
  const media = !src
    ? `<div class="rv-nomedia">🗂️</div>`
    : m.basic.mediaType === 'video'
      ? `<video src="${m.ref}" poster="${m.basic.poster || ''}" controls style="max-width:100%;max-height:56vh"></video>`
      : `<img src="${src}" style="max-width:100%;max-height:56vh" alt="">`;
  const st = revOf(m);
  const stBadge = st === 'keep' ? '<span class="rv-tag keep">✅ 已通过</span>' : st === 'reject' ? '<span class="rv-tag reject">❌ 已淘汰</span>' : '<span class="rv-tag todo">⏳ 待审</span>';
  return `<div class="rv-frame-head"><span>#${i + 1}/${total}</span><b>${esc(m.name)}</b>${stBadge}</div>
    <div class="rv-frame-body">${media}</div>
    <div class="rv-frame-foot">
      <span class="score-badge ${effGrade(m)}"><b>${fmt(m.analysis.composite)}</b><span>分</span></span>
      <div class="verdicts">${['google', 'meta', 'tiktok'].map(k => {
        const p = m.analysis.platforms?.[k];
        return `<span class="vchip ${p?.verdict === 'GO' ? 'g' : p?.verdict === 'COND' ? 'y' : 'r'}"><i>${CH_ICON[k]}</i>${fmt(p?.fit || 0)}</span>`;
      }).join('')}</div>
      ${policyRiskCount(m) ? '<span class="tag risk">⚠ ' + policyRiskCount(m) + ' 风险</span>' : ''}
    </div>`;
}
function reviewSideHTML(m) {
  const a = m.analysis;
  const dim = (label, val, color) => `<div class="dim"><span class="lbl">${label}</span>
    <div style="flex:1;height:6px;background:#eef1f8;border-radius:3px"><div style="width:${val * 10}%;height:100%;background:${color};border-radius:3px"></div></div>
    <span class="val">${val}</span></div>`;
  return `
    <div class="section"><h3>JEV 三维</h3>
      ${dim('J 吸睛度', a.hook?.score || 0, '#f43f5e')}
      ${dim('E 沉浸信任', a.engagement?.score || 0, '#8b5cf6')}
      ${dim('V 转化闭环', a.value?.score || 0, '#10b981')}
      <div class="subtle" style="margin-top:4px">评级 <b>${effGrade(m)} 级</b>${m.custom?.manualGrade ? '(人工)' : ''} · Hook：${a.hook?.hookType || '未标'}</div>
    </div>
    <div class="section"><h3>平台判定</h3>${verdictZoneHTML(m)}</div>
    <div class="section"><h3>标签</h3>
      <div class="tags">${flatTags(m).slice(0, 12).map(t => `<span class="tag ${/风险|违禁/.test(t) ? 'risk' : /建议/.test(t) ? 'advice' : ''}">${esc(t)}</span>`).join('') || '<span class="subtle">暂无标签</span>'}</div>
    </div>
    <div class="d-actions">
      <button class="btn sm line" onclick="openDrawer('${m.id}')">🔧 打开深度剖析</button>
    </div>`;
}
function stripHTML(list, cur) {
  return list.map((m, i) => {
    const src = thumbOf(m);
    const img = src ? `<img src="${src}" alt="">` : '🗂️';
    const st = revOf(m);
    return `<div class="rv-strip-item ${i === cur ? 'cur' : ''}" onclick="reviewJump(${i})">
      ${img}
      <span class="st st-${st === 'keep' ? 'go' : st === 'reject' ? 'no' : 'cond'}" title="${st === 'keep' ? '已通过' : st === 'reject' ? '已淘汰' : '未审查'}"></span>
    </div>`;
  }).join('');
}
function reviewJump(i) { reviewIdx = i; renderReview(filtered()); }
function reviewStep(d) { reviewIdx += d; renderReview(filtered()); }

// ---------------- 批量棋盘模式（一个大框平铺 50/100 张批量扫选） ----------------
function reviewBulkHTML(list) {
  const total = list.length;
  const reviewed = total - list.filter(x => revOf(x) === 'todo').length;
  const keepN = list.filter(x => revOf(x) === 'keep').length;
  const rejN = list.filter(x => revOf(x) === 'reject').length;
  const pages = Math.max(1, Math.ceil(total / BATCH));
  if (bulkPage >= pages) bulkPage = pages - 1;
  if (bulkPage < 0) bulkPage = 0;
  const start = bulkPage * BATCH;
  const pageList = list.slice(start, start + BATCH);
  lastPageIds = pageList.map(m => m.id);
  const pct = total ? Math.round((reviewed / total) * 100) : 0;
  const selInPage = pageList.filter(m => bulkSel.has(m.id));
  const onlyTodo = F.review.has('todo');

  return `
  <div class="review-top">
    <div class="rv-meta">批量进度：已处理 <b>${reviewed}</b> / <b>${total}</b> 张
      <span class="rv-stats"><i class="rv-chip keep">✅ 通过 ${keepN}</i><i class="rv-chip reject">❌ 淘汰 ${rejN}</i><i class="rv-chip todo">⏳ 未审 ${total - reviewed}</i></span>
    </div>
    <div class="rv-progress"><i style="width:${pct}%"></i></div>
  </div>
  <div class="bulk-toolbar">
    <button class="rv-btn keep" style="flex:0 1 auto;padding:9px 18px" onclick="bulkAct('keep')">✅ 通过所选 (${bulkSel.size})</button>
    <button class="rv-btn reject" style="flex:0 1 auto;padding:9px 18px" onclick="bulkAct('reject')">❌ 淘汰所选 (${bulkSel.size})</button>
    <button class="rv-btn ghost" style="flex:0 1 auto;padding:9px 14px" onclick="bulkSelectAll()">全选本批 (${selInPage.length}/${pageList.length})</button>
    <button class="rv-btn ghost" style="flex:0 1 auto;padding:9px 14px" onclick="bulkClearSel()">清空选择</button>
    <button class="rv-btn scan" id="btnScan" style="flex:0 1 auto;padding:9px 16px" onclick="startBulkScan()">⚡ 开始扫描</button>
    <select class="select" style="width:auto" onchange="setScanSpeed(+this.value)" title="扫描速度">
      <option value="60">疾速</option>
      <option value="120" selected>快速</option>
      <option value="220">舒缓</option>
    </select>
    <span class="subtle" id="scanStatus"></span>
    <label class="bulk-onlytodo"><input type="checkbox" ${onlyTodo ? 'checked' : ''} onchange="reviewOnlyToggle(this.checked)"> 只看未审（处理后自动翻批）</label>
  </div>
  <div class="bulk-grid">
    ${pageList.map(bulkItemHTML).join('')}
  </div>
  <div class="bulk-pager">
    <button class="btn sm line" ${bulkPage === 0 ? 'disabled' : ''} onclick="bulkPageGo(-1)">← 上一批</button>
    <span>第 ${bulkPage + 1} / ${pages} 批 · 每批 ${BATCH} 张 · 共 ${total} 张 · 已选 ${bulkSel.size} 张</span>
    <button class="btn sm line" ${bulkPage >= pages - 1 ? 'disabled' : ''} onclick="bulkPageGo(1)">下一批 →</button>
  </div>`;
}

function bulkItemHTML(m) {
  const src = thumbOf(m);
  const st = revOf(m);
  const sel = bulkSel.has(m.id);
  const img = src ? `<img src="${src}" loading="lazy" alt="">` : '<span style="font-size:20px">🗂️</span>';
  return `<div class="bulk-item ${sel ? 'sel' : ''} bulk-${st}" data-id="${m.id}"
      onclick="bulkClick(event,'${m.id}')" ondblclick="openDrawer('${m.id}')"
      title="${esc(m.name)} · ${fmt(m.analysis.composite)}分 · ${st === 'keep' ? '已通过' : st === 'reject' ? '已淘汰' : '未审查'}">
      ${img}
      <span class="bulk-score badge-${effGrade(m)}">${fmt(m.analysis.composite)}</span>
      ${sel ? '<span class="bulk-check">✓</span>' : ''}
      <span class="scan-light" title="未扫描"></span>
      <span class="st st-${st === 'keep' ? 'go' : st === 'reject' ? 'no' : 'cond'}"></span>
    </div>`;
}

function bulkClick(ev, id) {
  const idx = lastPageIds.indexOf(id);
  if (ev.shiftKey && lastBulkIdx != null) {
    // Shift 连续选择
    const [a, b] = [Math.min(idx, lastBulkIdx), Math.max(idx, lastBulkIdx)];
    for (let i = a; i <= b; i++) bulkSel.add(lastPageIds[i]);
  } else if (ev.ctrlKey || ev.metaKey) {
    // Ctrl 加减选
    if (bulkSel.has(id)) bulkSel.delete(id); else bulkSel.add(id);
    lastBulkIdx = idx;
  } else {
    // 单选
    bulkSel = new Set([id]);
    lastBulkIdx = idx;
  }
  renderReview(filtered());
}
function bulkSelectAll() {
  const pageList = lastPageIds.map(id => MATERIALS.find(x => x.id === id)).filter(Boolean);
  if (bulkSel.size === pageList.length && [...pageList].every(m => bulkSel.has(m.id))) bulkSel.clear();
  else for (const m of pageList) bulkSel.add(m.id);
  renderReview(filtered());
}
function bulkClearSel() { bulkSel.clear(); renderReview(filtered()); }
function bulkPageGo(d) { stopBulkScan(); scanIdx = 0; bulkPage += d; bulkSel.clear(); renderReview(filtered()); }
function reviewOnlyToggle(on) {
  stopBulkScan(); scanIdx = 0;
  F.review = on ? new Set(['todo']) : new Set();
  bulkPage = 0; bulkSel.clear();
  renderPanel(); renderMain();
}

// ---------------- 扫描动画（光带逐格扫过，速度可调） ----------------
function startBulkScan() {
  if (scanOn) return;
  const items = [...document.querySelectorAll('.bulk-item')];
  if (!items.length) return toast('当前批没有素材可扫描');
  if (scanIdx >= items.length) {
    // 从头再扫：清除上一轮痕迹
    scanIdx = 0;
    items.forEach(el => el.classList.remove('scanned'));
  }
  scanOn = true;
  scanTimer = setInterval(scanTick, scanSpeed);
  syncScanUI();
  toast(`⚡ 开始扫描本批 ${items.length} 张（${scanSpeed < 90 ? '疾速' : scanSpeed < 180 ? '快速' : '舒缓'}）`);
}
function pauseBulkScan() {
  stopBulkScan();
  toast('⏸ 已暂停扫描');
}
function stopBulkScan() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  scanOn = false;
  syncScanUI();
}
function scanTick() {
  const items = [...document.querySelectorAll('.bulk-item')];
  if (!items.length) { stopBulkScan(); return; }
  if (scanIdx < items.length) {
    items.forEach(el => el.classList.remove('scanning'));
    const cur = items[scanIdx];
    if (cur) {
      cur.classList.remove('scanned');
      cur.classList.add('scanning');
      try { cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
    }
    if (scanIdx - 1 >= 0 && items[scanIdx - 1]) items[scanIdx - 1].classList.add('scanned');
    scanIdx++;
    const st = document.getElementById('scanStatus');
    if (st) st.textContent = `⚡ 扫描中 ${Math.min(scanIdx, items.length)} / ${items.length}`;
  } else {
    // 收尾：清除 scanning 态，把最后扫到的格子标记为已扫（变绿）
    items.forEach(el => el.classList.remove('scanning'));
    if (items[items.length - 1]) items[items.length - 1].classList.add('scanned');
    stopBulkScan();
    toast('✅ 本批扫描完成，可点选格子标记通过/淘汰');
  }
}
function setScanSpeed(v) {
  scanSpeed = v;
  if (scanOn) { stopBulkScan(); startBulkScan(); }
}
function syncScanUI() {
  const btn = document.getElementById('btnScan');
  if (btn) {
    btn.textContent = scanOn ? '⏸ 暂停扫描' : '⚡ 开始扫描';
    btn.className = 'rv-btn ' + (scanOn ? 'reject' : 'scan');
    btn.onclick = scanOn ? pauseBulkScan : startBulkScan;
  }
  const st = document.getElementById('scanStatus');
  if (st && !scanOn) st.textContent = scanIdx > 0 ? `已扫 ${scanIdx} 格` : '';
}
async function bulkAct(status) {
  if (!bulkSel.size) return toast('先点选素材（可 Shift 连续选 / Ctrl 多选 / 全选本批）');
  const ids = [...bulkSel];
  toast(`正在批量标记 ${ids.length} 张…`);
  const results = await Promise.all(ids.map(id =>
    fetch('/api/materials/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: { review: status } })
    }).then(r => r.json())
  ));
  const map = new Map(results.map(x => [x.id, x]));
  MATERIALS = MATERIALS.map(x => map.get(x.id) || x);
  bulkSel.clear();
  lastBulkIdx = null;
  renderPanel(); renderMain();
  toast(`✅ 已批量${status === 'keep' ? '通过' : '淘汰'} ${ids.length} 张`);
}
async function reviewAct(status) {
  const m = reviewQueue[reviewIdx];
  if (!m) return;
  const upd = await fetch('/api/materials/' + m.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom: { review: status } })
  }).then(r => r.json());
  MATERIALS = MATERIALS.map(x => x.id === m.id ? upd : x);
  const updList = filtered();   // 若筛选含审片状态，列表会变化
  const idx = updList.findIndex(x => x.id === m.id);
  reviewIdx = idx >= 0 ? idx + 1 : Math.min(reviewIdx, updList.length - 1);
  renderPanel(); renderMain();
}
function reviewDoneHTML() {
  const all = MATERIALS;
  const keepN = all.filter(x => revOf(x) === 'keep').length;
  const rejN = all.filter(x => revOf(x) === 'reject').length;
  const todoN = all.filter(x => revOf(x) === 'todo').length;
  return `<div class="review-done">
    <div style="font-size:52px">🎉</div>
    <h3>本轮审片完成！</h3>
    <div class="rv-stats" style="justify-content:center">
      <i class="rv-chip keep">✅ 通过 ${keepN}</i><i class="rv-chip reject">❌ 淘汰 ${rejN}</i><i class="rv-chip todo">⏳ 未审 ${todoN}</i>
    </div>
    <div class="rv-done-actions">
      ${todoN ? `<button class="btn primary" onclick="reviewOnlyTodo()">继续审阅 ${todoN} 张未审素材</button>` : ''}
      <button class="btn soft" onclick="setView('grid')">返回素材墙</button>
    </div>
  </div>`;
}
function reviewOnlyTodo() {
  F.review = new Set(['todo']);
  setView('review');
  renderPanel();
}

// ---------------- 动态看板 ----------------
function setView(v) {
  view = v;
  if (v === 'review') reviewIdx = 0;   // 进入审片模式从头开始
  document.querySelectorAll('.vtab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('boardBy').classList.toggle('hidden', v !== 'kanban');
  renderMain();
}
function setBoardBy(v) { boardBy = v; renderKanban(filtered()); }
function kanbanCols() {
  if (boardBy === 'grade') return [{ key: 'S' }, { key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }].map(c => ({ ...c, label: c.key + ' 级', color: GCOLOR[c.key] }));
  if (boardBy === 'channel') return [
    { key: 'auto', label: '自动推荐', color: '#8b5cf6' },
    { key: 'google', label: 'Google', color: '#0ea5e9' },
    { key: 'meta', label: 'Meta', color: '#4f46e5' },
    { key: 'tiktok', label: 'TikTok', color: '#10b981' }
  ];
  return MODEL.enums.hookType.map(ht => ({ key: ht, label: ht, color: '#6b7594' }));
}
function kanbanKeyOf(m) {
  if (boardBy === 'grade') return effGrade(m);
  if (boardBy === 'channel') return effChannel(m) ? effChannel(m) : 'auto';
  return m.analysis.hook?.hookType || '无明确钩子';
}
function kCardHTML(m) {
  const src = thumbOf(m);
  const img = src ? `<img class="kthumb" src="${src}" alt="">` : `<div class="kthumb" style="display:flex;align-items:center;justify-content:center">🎬</div>`;
  return `<div class="kcard" draggable="true" data-id="${m.id}"
      ondragstart="onKDrag(event,'${m.id}')" ondragend="onKDragEnd(event)" onclick="openDrawer('${m.id}')">
      ${img}
      <div class="kmeta"><div class="kt">${esc(m.name)}</div>
        <div class="ks">${fmt(m.analysis.composite)} 分 · ${m.analysis.hook?.hookType || ''}</div>
        <div class="ks">${(m.analysis.tags?.advice || [])[0] ? esc((m.analysis.tags.advice)[0]) : ''}</div>
      </div>
      <span class="kbadge badge-${effGrade(m)}">${effGrade(m)}</span>
    </div>`;
}
function renderKanban(list) {
  $('grid').classList.add('hidden');
  $('cats').classList.add('hidden');
  $('review').classList.add('hidden');
  $('kanban').classList.remove('hidden');
  const cols = kanbanCols();
  $('kanban').innerHTML = cols.map(c => {
    const items = list.filter(m => kanbanKeyOf(m) === c.key);
    return `<div class="kcol" data-col="${esc(c.key)}" ondragover="onKDragOver(event)" ondragleave="this.classList.remove('dragover')" ondrop="onKDrop(event)">
      <div class="kcol-head"><span class="dot" style="background:${c.color}"></span>${c.label}<small>${items.length}</small></div>
      ${items.map(kCardHTML).join('') || '<div class="subtle" style="padding:8px 6px">拖拽卡片到此处分类</div>'}
    </div>`;
  }).join('');
}
function onKDrag(ev, id) { ev.dataTransfer.setData('text/plain', id); ev.currentTarget.classList.add('dragging'); }
function onKDragEnd(ev) { ev.currentTarget.classList.remove('dragging'); }
function onKDragOver(ev) { ev.preventDefault(); ev.currentTarget.classList.add('dragover'); ev.dataTransfer.dropEffect = 'move'; }
async function onKDrop(ev) {
  ev.preventDefault();
  const col = ev.currentTarget;
  col.classList.remove('dragover');
  const id = ev.dataTransfer.getData('text/plain');
  const colKey = col.dataset.col;
  const m = MATERIALS.find(x => x.id === id);
  if (!m) return;
  let body = {};
  if (boardBy === 'grade') {
    if (colKey === effGrade(m)) return;
    body.custom = { manualGrade: colKey };
  } else if (boardBy === 'channel') {
    const target = colKey === 'auto' ? null : colKey;
    if (target === (m.custom?.manualChannel ?? null)) return;
    body.custom = { manualChannel: target };
  } else {
    if (colKey === (m.analysis.hook?.hookType || '无明确钩子')) return;
    body.analysis = { hook: { hookType: colKey } };
  }
  const upd = await fetch(`/api/materials/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  MATERIALS = MATERIALS.map(x => x.id === id ? upd : x);
  render();
  toast('已重新分类');
}

// ---------------- 详情工作室 ----------------
function openDrawer(id) {
  selectedId = id;
  renderDrawer();
  $('drawerBackdrop').classList.remove('hidden');
  $('drawer').classList.remove('hidden');
}
function closeDrawer() { $('drawerBackdrop').classList.add('hidden'); $('drawer').classList.add('hidden'); selectedId = null; }
const cur = () => MATERIALS.find(m => m.id === selectedId);

function renderDrawer() {
  const m = cur();
  if (!m) return;
  const a = m.analysis, b = m.basic;
  const riskState = m.custom?.riskState || {};
  const src = thumbOf(m);

  const preview = !src
    ? `<div style="font-size:64px;color:#c7d2fe;padding:40px">${b.mediaType === 'video' ? '🎬' : '🗂️'}</div>`
    : b.mediaType === 'video'
      ? `<video src="${m.ref}" poster="${b.poster || ''}" controls id="dvideo" style="width:100%"></video>`
      : `<img src="${src}" style="max-width:100%">`;

  const statusChips = ['google', 'meta', 'tiktok'].map(k => {
    const p = a.platforms?.[k];
    if (!p) return '';
    return `<span class="vchip ${p.verdict === 'GO' ? 'g' : p.verdict === 'COND' ? 'y' : 'r'}"><i>${CH_ICON[k]}</i>${CH_NAME[k]} ${fmt(p.fit)}</span>`;
  }).join('');

  $('drawer').innerHTML = `
  <div class="drawer-head"><h2>素材深度剖析工作台</h2>
    ${MODEL.ai.available ? `<button class="btn sm line" id="btnAI">✨ AI 多模态评测</button>` : `<span class="subtle" title="配置 GEMINI_API_KEY 后可启用">🤖 AI 评测未启用</span>`}
    <button class="shape-btn" onclick="closeDrawer()">✕</button>
  </div>
  <div class="drawer-body">
    <div class="preview">${preview}</div>
    <div class="d-summary">
      <div class="d-score ${effGrade(m)}" style="background:${GCOLOR[effGrade(m)]}">
        <b>${fmt(a.composite)}</b><span>JEV 综合分</span>
      </div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:16px">${esc(m.name)}</div>
        <div style="color:var(--muted);font-size:12.5px;margin-top:4px">
          ${b.mediaType === 'video' ? '🎬 视频' : '🖼️ 单图'} · ${b.aspect || '?'} · ${b.durationSec ? b.durationSec + 's' : ''} · ${b.resolution || '未知分辨率'} · ${b.hasAudio ? '有音轨' : '无音轨'}
          ${m.custom?.manualGrade ? ` · 人工定级 ${m.custom.manualGrade}` : ''}
        </div>
        <div class="verdicts" style="margin-top:8px">${statusChips}</div>
      </div>
    </div>

    <div class="section">
      <h3>⏱ 时间轴 & JEV 状态曲线 <span class="warn">点击节点跳转画面</span></h3>
      ${timelineHTML(m)}
      ${curveHTML(m)}
      <div class="curve-legend"><span><i style="background:#f43f5e"></i>J 吸睛度</span><span><i style="background:#8b5cf6"></i>E 沉浸信任</span><span><i style="background:#10b981"></i>V 转化闭环</span></div>
    </div>

    <div class="g2">
      <div class="section">
        <h3>📡 渠道适配雷达</h3>
        <div class="radar-box">${radarHTML(m)}</div>
      </div>
      <div class="section">
        <h3>🎯 JEV 黄金三维评分 <span class="warn">1-10 分</span></h3>
        <div class="dim"><span class="lbl">${MODEL.labels.j}</span><input type="range" min="1" max="10" step="0.1" value="${a.hook.score}" id="s-j" oninput="onJevIn(this)"><span class="val" id="v-j">${a.hook.score}</span></div>
        <div class="dim"><span class="lbl">${MODEL.labels.e}</span><input type="range" min="1" max="10" step="0.1" value="${a.engagement.score}" id="s-e" oninput="onJevIn(this)"><span class="val" id="v-e">${a.engagement.score}</span></div>
        <div class="dim"><span class="lbl">${MODEL.labels.v}</span><input type="range" min="1" max="10" step="0.1" value="${a.value.score}" id="s-v" oninput="onJevIn(this)"><span class="val" id="v-v">${a.value.score}</span></div>
        <div class="subtle" style="margin-top:6px">权重 J=${MODEL.weights.j} · E=${MODEL.weights.e} · V=${MODEL.weights.v}（可在「评分模型」调整）</div>
      </div>
    </div>

    <div class="section">
      <h3>🔍 J - Hook 拆解</h3>
      <div class="form-grid">
        <div class="fld"><label>Hook 策略类型</label><select id="f-hookType">${selOpts(MODEL.enums.hookType, a.hook?.hookType)}</select></div>
        <div class="fld"><label>前3秒视觉冲击力 (1-10)</label><input type="number" id="f-visualImpact" min="1" max="10" step="0.1" value="${a.hook?.visualImpact ?? 6}"></div>
        <div class="fld"><label>产品亮相秒数</label><input type="number" id="f-reveal" step="0.1" value="${a.hook?.productRevealSec ?? 1.5}"></div>
        <div class="fld"><label style="margin-top:22px"><input type="checkbox" id="f-textOverlay" ${a.hook?.textOverlay ? 'checked' : ''} style="width:auto;accent-color:var(--accent)"> 有字幕视觉重音</label></div>
      </div>
    </div>

    <div class="section">
      <h3>🤝 E - Engagement 拆解</h3>
      <div class="form-grid">
        <div class="fld"><label>核心痛点词</label><input id="f-painPoint" value="${esc(a.engagement?.painPoint || '')}" placeholder="如：毛孔粗大"></div>
        <div class="fld"><label>场景</label><select id="f-scene">${selOpts(MODEL.enums.scene, a.engagement?.scene)}</select></div>
        <div class="fld"><label>出镜类型</label><select id="f-actor">${selOpts(MODEL.enums.actor, a.engagement?.actor)}</select></div>
        <div class="fld"><label>语言/口音</label><select id="f-lang">${selOpts(MODEL.enums.language, a.engagement?.language)}</select></div>
        <div class="fld"><label>场景真实感 (1-10)</label><input type="number" id="f-realism" min="1" max="10" step="0.1" value="${a.engagement?.sceneRealism ?? 6}"></div>
        <div class="fld"><label>方案演示清晰度 (1-10)</label><input type="number" id="f-demo" min="1" max="10" step="0.1" value="${a.engagement?.demoClarity ?? 6}"></div>
        <div class="fld"><label><input type="checkbox" id="f-ba" style="width:auto;accent-color:var(--accent)" ${a.engagement?.beforeAfter ? 'checked' : ''}> Before/After 对比</label></div>
        <div class="fld"><label>信任元素</label>${MODEL.enums.trust.map(t => `<label class="check-row" style="padding:1px 0"><input type="checkbox" class="chk-trust" value="${t}" ${(a.engagement?.trust || []).includes(t) ? 'checked' : ''} style="width:auto"><span class="cr-label">${t}</span></label>`).join('')}</div>
      </div>
    </div>

    <div class="section">
      <h3>💰 V - Value & CTA 拆解</h3>
      <div class="form-grid">
        <div class="fld"><label>核心卖点 USP</label><input id="f-usp" value="${esc(a.value?.usp || '')}" placeholder="如：3天见效 / 免运费"></div>
        <div class="fld"><label>促销类型</label><select id="f-offer">${selOpts(MODEL.enums.offer, a.value?.offer)}</select></div>
        <div class="fld"><label>CTA 强度 (1-10)</label><input type="number" id="f-ctaScore" min="1" max="10" step="0.1" value="${a.value?.ctaScore ?? 6}"></div>
        <div class="fld"><label>CTA 文案</label><input id="f-ctaText" value="${esc(a.value?.ctaText || '')}" placeholder="Shop Now"></div>
        <div class="fld"><label><input type="checkbox" id="f-price" style="width:auto;accent-color:var(--accent)" ${a.value?.priceShown ? 'checked' : ''}> 有价格/Discount 露出</label></div>
      </div>
    </div>

    <div class="section">
      <h3>🛡 合规审查 & 渠道适配判定 <span class="warn">勾选违禁项实时更新判定</span></h3>
      ${MODEL.policyRules.map(r => `<label class="check-row"><input type="checkbox" class="chk-risk" data-key="${r.key}" data-level="${r.severity}" ${riskState[r.key] ? 'checked' : ''} style="width:auto"><span class="cr-label">${r.label}</span><span class="cr-sev sev-${r.severity}">${r.severity === 'critical' ? '一票否决' : '风险'}</span></label>`).join('')}
      <div class="line20"></div>
      <div id="verdictZone">${verdictZoneHTML(m)}</div>
    </div>

    <div class="section">
      <h3>📝 OCR & 语音字幕 <span class="warn">${MODEL.caps?.tesseract || MODEL.caps?.whisper ? '本地引擎可用' : '本地未装 tesseract/whisper，可手动粘贴'}</span></h3>
      <div class="fld"><textarea id="f-subtitles" rows="5" placeholder="每行一段：起始秒,结束秒|文本（如：1.5,3.2|Pores gone in 3 days）">${(m.subtitles || []).map(s => `${s.start},${s.end}|${s.text}`).join('\n')}</textarea></div>
    </div>

    <div class="section">
      <h3>🏷 素材信息 & 实况指标</h3>
      <div class="form-grid">
        <div class="fld"><label>分类/品类</label><input id="f-category" value="${esc(m.custom?.category || '')}" placeholder="如：美妆、家居、3C"></div>
        <div class="fld"><label>自定义标签（逗号分隔）</label><input id="f-customTags" value="${esc((m.custom?.customTags || []).join(', '))}"></div>
        <div class="fld"><label>CTR %</label><input type="number" id="f-ctr" step="0.01" value="${m.perf?.ctr ?? ''}"></div>
        <div class="fld"><label>CVR %</label><input type="number" id="f-cvr" step="0.01" value="${m.perf?.cvr ?? ''}"></div>
        <div class="fld"><label>ROAS</label><input type="number" id="f-roas" step="0.01" value="${m.perf?.roas ?? ''}"></div>
        <div class="fld"><label>展示 Impr</label><input type="number" id="f-impr" value="${m.perf?.impr ?? ''}"></div>
        <div class="fld full"><label>备注</label><textarea id="f-notes">${esc(m.custom?.notes || '')}</textarea></div>
      </div>
      <div class="d-actions">
        <button class="btn sm soft" onclick="applyPerf()">依据实况指标微调</button>
        ${m.custom?.manualGrade || m.custom?.manualChannel ? '<button class="btn sm line" onclick="clearOverride()">恢复自动分类</button>' : ''}
      </div>
    </div>

    <div class="d-actions">
      <button class="btn primary" onclick="saveDetail()">💾 保存修改</button>
      <button class="btn soft" onclick="exportOne('${m.id}')">📄 导出报告 CSV</button>
      <button class="btn danger" onclick="delMaterial('${m.id}')">🗑 删除</button>
    </div>
  </div>`;

  const aiBtn = $('btnAI');
  if (aiBtn) aiBtn.onclick = () => runAI(m.id);
}

function selOpts(list, curVal) {
  return list.map(x => `<option ${x === curVal ? 'selected' : ''}>${esc(x)}</option>`).join('');
}
function timelineHTML(m) {
  const tl = m.timeline || { nodes: [], curve: [] };
  const dur = Math.max(m.basic.durationSec || 2, 1);
  const nodes = (tl.nodes || []).map(n => {
    const pct = Math.min(100, (n.sec / dur) * 100);
    return `<div class="tl-node" style="left:${pct}%" title="${n.sec}s" onclick="seekVideo(${n.sec})"><span>${esc(n.label)}</span></div>`;
  }).join('');
  return `<div class="timeline-wrap"><div class="timeline-track" style="width:100%"><div class="fill" style="width:100%"></div>${nodes}</div></div>`;
}
function curveHTML(m) {
  const tl = m.timeline || { nodes: [], curve: [] };
  const dur = Math.max(m.basic.durationSec || 2, 1);
  const W = 360, H = 90, P = 8;
  const pts = tl.curve || [];
  if (!pts.length) return '<div class="subtle">暂无曲线数据</div>';
  const X = p => P + (p.t / dur) * (W - 2 * P);
  const Y = v => H - P - (v / 10) * (H - 2 * P);
  const line = (key, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map(p => `${X(p)},${Y(p[key])}`).join(' ')}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${[2.5, 5, 7.5].map(g => `<line x1="${P}" y1="${Y(g)}" x2="${W - P}" y2="${Y(g)}" stroke="#e6e9f2" stroke-width="1"/>`).join('')}
    ${line('j', '#f43f5e')}${line('e', '#8b5cf6')}${line('v', '#10b981')}
  </svg>`;
}
function radarHTML(m) {
  const a = m.analysis;
  const vals = {
    'J': (a.hook?.score || 0) / 10,
    'E': (a.engagement?.score || 0) / 10,
    'V': (a.value?.score || 0) / 10,
    'Google': (a.platforms?.google?.fit || 0) / 100,
    'Meta': (a.platforms?.meta?.fit || 0) / 100,
    'TikTok': (a.platforms?.tiktok?.fit || 0) / 100
  };
  const keys = Object.keys(vals), N = keys.length;
  const C = 120, R = 95;
  const pt = (i, r) => {
    const ang = (Math.PI * 2 * i) / N - Math.PI / 2;
    return [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  };
  const ring = (f) => keys.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const poly = keys.map((_, i) => pt(i, R * vals[keys[i]]).join(',')).join(' ');
  const labels = keys.map((k, i) => {
    const [x, y] = pt(i, R + 16);
    return `<text x="${x}" y="${y}" font-size="10" fill="#6b7594" text-anchor="middle">${k}</text>`;
  }).join('');
  return `<svg width="240" height="240" viewBox="0 0 240 240">
    <polygon points="${ring(1)}" fill="none" stroke="#e6e9f2"/>
    <polygon points="${ring(0.66)}" fill="none" stroke="#e6e9f2"/>
    <polygon points="${ring(0.33)}" fill="none" stroke="#e6e9f2"/>
    ${keys.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="#e6e9f2"/>`; }).join('')}
    <polygon points="${poly}" fill="rgba(79,70,229,.22)" stroke="#4f46e5" stroke-width="2"/>
    ${keys.map((_, i) => { const [x, y] = pt(i, R * vals[keys[i]]); return `<circle cx="${x}" cy="${y}" r="3.5" fill="#4f46e5"/>`; }).join('')}
    ${labels}
  </svg>`;
}
function verdictZoneHTML(m) {
  const a = m.analysis;
  const vb = (title, p) => `<div class="verdict-box vb-${p.verdict}">
    <h4><span class="vchip ${p.verdict === 'GO' ? 'g' : p.verdict === 'COND' ? 'y' : 'r'}"><i>${title[0]}</i>${title}</span> → <b>${p.verdict === 'GO' ? '可投放' : p.verdict === 'COND' ? '需优化后投放' : '不可投放'}</b> <span class="vchip fit">适配 ${fmt(p.fit)}</span></h4>
    <ul>${(p.reasons || ['—']).map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`;
  return vb('Google', a.platforms?.google || {}) + vb('Meta', a.platforms?.meta || {}) + vb('TikTok', a.platforms?.tiktok || {});
}
function seekVideo(sec) {
  const v = $('dvideo');
  if (v) { v.currentTime = sec; v.play().catch(() => {}); }
}

// ---------------- 详情交互 ----------------
function onJevIn(el) {
  $(el.id.replace('s-', 'v-')).textContent = el.value;
  const m = cur();
  m.analysis.hook.score = +$('s-j').value;
  m.analysis.engagement.score = +$('s-e').value;
  m.analysis.value.score = +$('s-v').value;
  const comp = clComputeComposite(m.analysis);
  document.querySelector('.d-score b').textContent = comp;
  const g = clGrade(comp);
  const dsc = document.querySelector('.d-score');
  dsc.className = 'd-score ' + g.grade;
  dsc.style.background = GCOLOR[g.grade];
  const risks = currentRisks(m);
  const plats = clPlatforms(m, risks);
  $('verdictZone').innerHTML = verdictZoneHTML({ ...m, analysis: { ...m.analysis, platforms: plats } });
}
function currentRisks(m) {
  const checked = [...document.querySelectorAll('.chk-risk:checked')].map(x => x.dataset.key);
  const mRisks = m.analysis.policy?.risks || [];
  const manual = checked.map(key => {
    const r = MODEL.policyRules.find(x => x.key === key);
    const exist = mRisks.find(x => x.key === key);
    return exist || { key, level: r.severity, label: r.label, automatic: false };
  });
  return manual.length ? manual : mRisks;
}
async function saveDetail() {
  const m = cur();
  if (!m) return;
  const trust = [...document.querySelectorAll('.chk-trust:checked')].map(x => x.value);
  const checkedRiskKeys = [...document.querySelectorAll('.chk-risk:checked')].map(x => x.dataset.key);
  const riskState = {};
  for (const r of MODEL.policyRules) riskState[r.key] = checkedRiskKeys.includes(r.key);

  let subtitles = [];
  try {
    subtitles = $('f-subtitles').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const m2 = l.match(/^\s*([\d.]+)\s*,\s*([\d.]+)\s*\|\s*(.+)$/);
      if (m2) return { start: +m2[1], end: +m2[2], text: m2[3].trim() };
      return { start: 0, end: 0, text: l };
    });
  } catch {}

  const body = {
    analysis: {
      hook: {
        score: +$('s-j').value, hookType: $('f-hookType').value,
        visualImpact: +$('f-visualImpact').value || 6,
        productRevealSec: +$('f-reveal').value || 1.5,
        textOverlay: $('f-textOverlay').checked
      },
      engagement: {
        score: +$('s-e').value, painPoint: $('f-painPoint').value.trim(),
        scene: $('f-scene').value, actor: $('f-actor').value, language: $('f-lang').value,
        sceneRealism: +$('f-realism').value || 6, demoClarity: +$('f-demo').value || 6,
        beforeAfter: $('f-ba').checked, trust
      },
      value: {
        score: +$('s-v').value, usp: $('f-usp').value.trim(), offer: $('f-offer').value,
        priceShown: $('f-price').checked, ctaScore: +$('f-ctaScore').value || 6,
        ctaText: $('f-ctaText').value.trim()
      }
    },
    riskState,
    custom: {
      category: $('f-category').value.trim(),
      customTags: $('f-customTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      notes: $('f-notes').value
    },
    subtitles,
    perf: { ctr: +$('f-ctr').value || null, cvr: +$('f-cvr').value || null, roas: +$('f-roas').value || null, impr: +$('f-impr').value || null }
  };
  const upd = await fetch('/api/materials/' + m.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  MATERIALS = MATERIALS.map(x => x.id === m.id ? upd : x);
  render();
  renderDrawer();
  toast('已保存');
}
function applyPerf() {
  const ctr = +$('f-ctr').value || 0, cvr = +$('f-cvr').value || 0;
  if (ctr >= 2) { $('s-j').value = Math.min(10, +$('s-j').value + 0.8); $('v-j').textContent = $('s-j').value; }
  else if (ctr > 0 && ctr < 0.8) { $('s-j').value = Math.max(1, +$('s-j').value - 0.8); $('v-j').textContent = $('s-j').value; }
  if (cvr >= 3) { $('s-v').value = Math.min(10, +$('s-v').value + 0.8); $('v-v').textContent = $('s-v').value; }
  else if (cvr > 0 && cvr < 1) { $('s-v').value = Math.max(1, +$('s-v').value - 0.6); $('v-v').textContent = $('s-v').value; }
  onJevIn({ id: 's-j', value: $('s-j').value });
  toast('已按实况指标微调 J/V 维度，请保存');
}
async function clearOverride() {
  const m = cur();
  const upd = await fetch('/api/materials/' + m.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom: { manualGrade: null, manualChannel: null } })
  }).then(r => r.json());
  MATERIALS = MATERIALS.map(x => x.id === m.id ? upd : x);
  render(); renderDrawer();
  toast('已恢复自动分类');
}
async function runAI(id) {
  const r = await fetch('/api/analyze/' + id, { method: 'POST' }).then(x => x.json());
  if (!r.ai) { toast('⚠ ' + (r.message || 'AI 不可用')); return; }
  MATERIALS = MATERIALS.map(x => x.id === id ? r.material : x);
  render(); renderDrawer();
  toast('AI 多模态评测完成');
}
async function delMaterial(id) {
  if (!confirm('确定删除该素材？（本地媒体文件与抽帧缩略图会一并清理）')) return;
  await fetch('/api/materials/' + id, { method: 'DELETE' });
  MATERIALS = MATERIALS.filter(x => x.id !== id);
  closeDrawer(); render();
  toast('已删除');
}

// ---------------- CSV 导出 ----------------
function csvHead() {
  return ['素材ID', '名称', '类型', '画幅', '时长s', '分辨率', '综合分', '评级', '人工评级',
    'J分', 'E分', 'V分', 'Hook类型', '出镜', '语言', '场景', '痛点', '促销', 'CTA分', '合规分',
    'Google适配', 'Google判定', 'Meta适配', 'Meta判定', 'TikTok适配', 'TikTok判定',
    '风险项', '标签', '推荐策略', '备注', 'CTR', 'CVR', 'ROAS', '展示'];
}
function csvRow(m) {
  const a = m.analysis;
  const q = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  return [
    m.id, m.name, m.basic.mediaType, m.basic.aspect || '', m.basic.durationSec || '', m.basic.resolution || '',
    a.composite, a.grade, m.custom?.manualGrade || '',
    a.hook?.score, a.engagement?.score, a.value?.score, a.hook?.hookType || '',
    a.engagement?.actor || '', a.engagement?.language || '', a.engagement?.scene || '',
    a.engagement?.painPoint || '', a.value?.offer === '无促销' ? '' : a.value?.offer,
    a.value?.ctaScore, a.policy?.score,
    a.platforms?.google?.fit, a.platforms?.google?.verdict,
    a.platforms?.meta?.fit, a.platforms?.meta?.verdict,
    a.platforms?.tiktok?.fit, a.platforms?.tiktok?.verdict,
    (a.policy?.risks || []).map(r => r.label).join('；'),
    flatTags(m).join('；'),
    (a.tags?.advice || []).join('；'),
    m.custom?.notes || '', m.perf?.ctr ?? '', m.perf?.cvr ?? '', m.perf?.roas ?? '', m.perf?.impr ?? ''
  ].map(q).join(',');
}
function doExport(list, filename) {
  const rows = [csvHead().join(','), ...list.map(csvRow)];
  const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportAll() {
  const list = filtered();
  if (!list.length) return toast('当前筛选无素材');
  doExport(list, `JEV_工作台导出_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`);
  toast(`已导出 ${list.length} 条素材`);
}
function exportOne(id) {
  const m = MATERIALS.find(x => x.id === id);
  if (m) doExport([m], `JEV_${m.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_')}.csv`);
}

// ---------------- 导入弹窗 ----------------
function openAdd() {
  $('modalBackdrop').classList.remove('hidden');
  $('modal').innerHTML = `
    <h2>导入素材</h2>
    <div class="sub">本地工作台：文件将入库并自动执行 ffprobe 元数据探测 + ffmpeg 关键帧抽取 + JEV 启发式评分</div>
    <div class="capsline">🛠 引擎能力：ffmpeg ${MODEL.caps?.ffmpeg ? '✓' : '✗'} · ffprobe ${MODEL.caps?.ffprobe ? '✓' : '✗'} · OCR ${MODEL.caps?.tesseract ? '✓' : '✗(可手动粘贴)'} · ASR ${MODEL.caps?.whisper ? '✓' : '✗(可手动粘贴)'} · 多模态AI ${MODEL.ai?.available ? '✓' : '✗(配 GEMINI_API_KEY 启用)'}</div>
    <div class="dropzone" id="dz">点击或拖拽文件到此处上传<small>支持图片、视频（≤500MB/个，视频自动抽帧）</small>
      <input type="file" id="fileIn" multiple accept="image/*,video/*" hidden>
    </div>
    <div class="line20"></div>
    <div class="mfield"><label>批量扫描本地素材文件夹（服务端递归扫描）</label>
      <input id="importDir" placeholder="输入绝对路径，如 /workspace/creative-studio/demo"></div>
    <button class="btn primary" onclick="runFolderImport()">扫描此文件夹入库</button>
    <div class="line20"></div>
    <div class="mfield"><label>粘贴素材链接</label>
      <input id="linkInput" placeholder="https://…/creative.png 或 .mp4 链接"></div>
    <button class="btn primary" onclick="runLinkImport()">从链接入库</button>
    <div class="import-actions"><button class="btn ghost" onclick="closeModal()">关闭</button></div>
    <div id="importProgress" style="margin-top:12px;font-size:13px;color:var(--accent)"></div>`;
  const dz = $('dz'), fileIn = $('fileIn');
  dz.onclick = () => fileIn.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag'); doUpload(e.dataTransfer.files); };
  fileIn.onchange = () => doUpload(fileIn.files);
}
async function doUpload(files) {
  if (!files || !files.length) return;
  const form = new FormData();
  [...files].forEach(x => form.append('files', x));
  const prog = $('importProgress');
  prog.textContent = `上传中 ${files.length} 个文件…（视频会执行抽帧，稍候）`;
  try {
    await fetch('/api/upload', { method: 'POST', body: form });
    await loadData();
    prog.textContent = `✓ 已导入 ${files.length} 个素材`;
    toast('导入成功');
  } catch (e) { prog.textContent = '上传失败: ' + e.message; }
}
async function runFolderImport() {
  const dir = $('importDir').value.trim();
  if (!dir) return toast('请输入目录路径（沙箱内绝对路径）');
  const prog = $('importProgress');
  prog.textContent = '扫描 + 入库中…（视频抽帧较慢）';
  const j = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir }) }).then(r => r.json());
  if (j.error) { prog.textContent = '✗ ' + j.error; return; }
  await loadData();
  prog.textContent = `✓ 新增 ${j.added} · 跳过 ${j.skipped} · 失败 ${j.failed}`;
  toast(`导入 ${j.added} 个素材`);
}
async function runLinkImport() {
  const url = $('linkInput').value.trim();
  if (!url) return toast('请输入链接');
  const name = url.split('/').pop() || 'linked-material';
  await fetch('/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name }) });
  await loadData();
  $('linkInput').value = '';
  toast('已从链接入库（外链素材默认按单图，可在详情修改）');
}

// ---------------- 评分模型弹窗 ----------------
function openModel() {
  $('modelModalBackdrop').classList.remove('hidden');
  const w = MODEL.weights;
  const pw = (k, title) => `
    <div class="wt-group"><h4>${title} 渠道适配权重</h4>
    <div class="wt-grid">
      ${Object.keys(w.platforms[k]).map(d => `<div class="wt"><label>${d}</label><input id="pw-${k}-${d}" type="number" min="0" max="10" step="0.1" value="${w.platforms[k][d]}"></div>`).join('')}
    </div></div>`;
  $('modelModal').innerHTML = `
    <h2>JEV 评分模型</h2>
    <div class="sub">综合分 = (J×Wj + E×We + V×Wv) / ΣW × 10。渠道适配 = 平台权重加权(J/E/V/合规/原生感) × 10。保存后全库自动重算。</div>
    <div class="wt-group"><h4>黄金三维权重</h4>
    <div class="wt-grid">
      <div class="wt"><label>J · Hook 吸睛度</label><input id="w-j" type="number" min="0" max="10" step="0.1" value="${w.j}"></div>
      <div class="wt"><label>E · Engagement 沉浸信任</label><input id="w-e" type="number" min="0" max="10" step="0.1" value="${w.e}"></div>
      <div class="wt"><label>V · Value & CTA</label><input id="w-v" type="number" min="0" max="10" step="0.1" value="${w.v}"></div>
    </div></div>
    ${pw('meta', 'Meta (FB/IG)')}
    ${pw('google', 'Google (PMax/YouTube)')}
    ${pw('tiktok', 'TikTok')}
    <div class="import-actions">
      <button class="btn primary" onclick="saveModel()">保存并重新评分全库</button>
      <button class="btn ghost" onclick="closeModel()">关闭</button>
    </div>`;
}
async function saveModel() {
  const num = id => { const v = Number($(id).value); return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0; };
  const body = { weights: {
    j: num('w-j'), e: num('w-e'), v: num('w-v'),
    platforms: {
      meta: Object.fromEntries(Object.keys(MODEL.weights.platforms.meta).map(d => [d, num('pw-meta-' + d)])),
      google: Object.fromEntries(Object.keys(MODEL.weights.platforms.google).map(d => [d, num('pw-google-' + d)])),
      tiktok: Object.fromEntries(Object.keys(MODEL.weights.platforms.tiktok).map(d => [d, num('pw-tiktok-' + d)]))
    }
  }};
  await fetch('/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await loadData();
  closeModel();
  toast('模型已更新，全库重新评分');
}
function closeModel() { $('modelModalBackdrop').classList.add('hidden'); $('modelModal').classList.add('hidden'); }
function closeModal() { $('modalBackdrop').classList.add('hidden'); $('modal').classList.add('hidden'); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2600); }

// ---------------- 事件绑定 ----------------
$('btnAdd').onclick = openAdd;
$('btnModel').onclick = openModel;
$('btnExport').onclick = exportAll;
$('drawerBackdrop').onclick = closeDrawer;
$('modalBackdrop').onclick = closeModal;
$('modelModalBackdrop').onclick = closeModel;
$('searchBox').oninput = e => { F.q = e.target.value; renderPanel(); renderMain(); };
$('fMin').oninput = e => { F.minScore = Math.max(0, Math.min(100, +e.target.value || 0)); renderMain(); renderPanel(); };
$('fMax').oninput = e => { F.maxScore = Math.max(0, Math.min(100, +e.target.value || 100)); renderMain(); renderPanel(); };
$('fRiskOnly').onchange = e => { F.riskOnly = e.target.checked; renderPanel(); renderMain(); };
$('fClear').onclick = clearFilters;
$('sortBy').onchange = e => { sortBy = e.target.value; renderMain(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDrawer(); closeModal(); closeModel();
    if (view === 'review' && revMode === 'bulk') bulkClearSel();
    return;
  }
  // 审片模式快捷键（输入框内不触发）
  if (view === 'review' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) &&
      document.getElementById('drawer').classList.contains('hidden')) {
    if (revMode === 'single') {
      if (e.key === 'ArrowRight') { e.preventDefault(); reviewStep(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); reviewStep(-1); }
      else if (e.key === 'p' || e.key === 'P') { reviewAct('keep'); }
      else if (e.key === 'x' || e.key === 'X') { reviewAct('reject'); }
    } else {
      // 批量棋盘模式：方向键翻批
      if (e.key === 'ArrowRight') { e.preventDefault(); bulkPageGo(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); bulkPageGo(-1); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); bulkSelectAll(); }
    }
  }
});

loadData();