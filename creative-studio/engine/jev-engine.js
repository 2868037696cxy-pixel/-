// ============================================================================
// JEV 核心评分引擎 (Jaw-dropping Hook / Engagement & Empathy / Value & Conversion)
// 跨境广告素材黄金三维评测：单项 1-10 分 → 平台适配 0-100 → 综合评级 S/A/B/C/D
// 参考 Meta Creative Insights / Google Ads Policy / TikTok 原生创意标准
// ============================================================================

// ---------------------- 模型权重（可在线调整） ----------------------
export const DEFAULT_WEIGHTS = {
  j: 0.40,                     // J - Hook 吸睛度
  e: 0.35,                     // E - Engagement 沉浸与信任
  v: 0.25,                     // V - Value & CTA 转化闭环
  // 各渠道适配权重（狗覆写）
  platforms: {
    meta:   { hook: 0.30, engagement: 0.35, value: 0.20, policy: 0.15 },
    google: { hook: 0.20, engagement: 0.30, value: 0.30, policy: 0.20 },
    tiktok: { hook: 0.40, engagement: 0.22, value: 0.13, policy: 0.10, native: 0.15 }
  }
};

export const JEV_LABELS = {
  j: 'J · Hook 吸睛度 (0-3s)',
  e: 'E · Engagement 沉浸与信任',
  v: 'V · Value & CTA 转化闭环'
};

// ---------------------- 枚举常量（标签学字典） ----------------------
export const ENUMS = {
  hookType: ['痛点直击型', '猎奇拆箱型', '效果对比型', '问答互动型', '争议话题型', '优惠直给型', '无明确钩子'],
  actor: ['欧美真人', '亚洲真人', '无真人', '3D动画', 'AI合成'],
  scene: ['室内', '户外', '工作室', '街头', '纯产品展示'],
  language: ['英语(美音)', '英语(英音)', '德语', '法语', '意大利语', '西班牙语', '葡萄牙语', '日韩', '无配音'],
  trust: ['UGC真人出镜', '专家背书', '5星好评', '解压舒爽视觉', '数据佐证'],
  offer: ['买一送一', '限时折扣', '免费送货', '满减优惠', '新品首发', '无促销']
};

// ---------------------- 合规审查规则 ----------------------
// severity: critical = 一票否决(所有平台 NO) / warning = 风险提示(降级为需优化)
export const POLICY_RULES = [
  { key: 'adult',       label: '成人/色情内容',          severity: 'critical', keywords: ['porn','nude','xxx','escort','onlyfans'] },
  { key: 'violence',    label: '暴力/血腥恐吓内容',      severity: 'critical', keywords: ['gore','bloody','kill','weapon','gun'] },
  { key: 'political',   label: '政治/选举敏感内容',      severity: 'critical', keywords: ['election','vote','president','politics','trump','biden','covid'] },
  { key: 'health',      label: '医疗/增肌减重功效夸大',  severity: 'critical', keywords: ['weight loss','weight_loss','weightloss','lose weight','lose_weight','fat burn','fat_burn','cure','heal','detox','testosterone','muscle gain'] },
  { key: 'gambling',    label: '博彩/传销/币圈暴富',     severity: 'critical', keywords: ['casino','betting','gamble','poker','lottery','get rich','crypto millionaire','forex'] },
  { key: 'copyright',   label: '版权/仿冒侵权风险',      severity: 'critical', keywords: ['replica','counterfeit','knockoff','fake brand','hermes','chanel copy','nike copy'] },
  { key: 'mislead',     label: '虚假/夸张承诺(100%等)',  severity: 'critical', keywords: ['100% guaranteed','miracle','free forever','overnight results'] },
  { key: 'extreme_ba',  label: '极限Before/After对比',   severity: 'warning', keywords: ['before after','results in 3 days','transformation'] },
  { key: 'fake_urgency',label: '虚假紧迫感(倒计时逼单)', severity: 'warning', keywords: ['countdown','last chance','today only','limited stock'] },
  { key: 'fake_btn',    label: '诱导点击假按钮',         severity: 'warning', keywords: ['click here to play','claim now','tap to win'] },
  { key: 'mismatch',    label: '创意与落地页不符风险',   severity: 'warning', keywords: [] },
  { key: 'flash',       label: '频闪/晃动不适内容',      severity: 'warning', keywords: ['strobe','flash warning','motion sickness'] }
];

// ---------------------- 评级 ----------------------
export const GRADE_BANDS = [
  { grade: 'S', min: 90, label: '优秀',   advice: '高优先放量投放' },
  { grade: 'A', min: 80, label: '良好',   advice: '建议投放' },
  { grade: 'B', min: 70, label: '合格',   advice: '建议测试投放' },
  { grade: 'C', min: 55, label: '待优化', advice: '优化后小流量测试' },
  { grade: 'D', min: 0,  label: '不合格', advice: '不建议投放' }
];

// 平台判定阈值（适配分 → 裁定），默认 GO≥72 / COND≥58
export const DEFAULT_VERDICT = { go: 72, cond: 58 };

// 完整模型配置（权重 + 评级阈值 + 判定阈值），可整体存取
export const DEFAULT_MODEL = {
  weights: DEFAULT_WEIGHTS,
  gradeBands: GRADE_BANDS.map(g => ({ ...g })),
  verdict: { ...DEFAULT_VERDICT }
};

// 清洗/校验用户提交的模型配置
export function sanitizeModel(m) {
  const w = m?.weights || {};
  const gb = Array.isArray(m?.gradeBands) ? m.gradeBands : null;
  const vd = m?.verdict || {};
  const model = {
    weights: {
      j: clamp10(w.j ?? DEFAULT_WEIGHTS.j),
      e: clamp10(w.e ?? DEFAULT_WEIGHTS.e),
      v: clamp10(w.v ?? DEFAULT_WEIGHTS.v),
      platforms: {
        meta:   sanWeights(w.platforms?.meta, DEFAULT_WEIGHTS.platforms.meta),
        google: sanWeights(w.platforms?.google, DEFAULT_WEIGHTS.platforms.google),
        tiktok: sanWeights(w.platforms?.tiktok, DEFAULT_WEIGHTS.platforms.tiktok)
      }
    },
    gradeBands: GRADE_BANDS.map((g, i) => {
      if (!gb || !gb[i] || !Number.isFinite(+gb[i].min)) return { ...g };
      const min = Math.max(0, Math.min(100, Math.round(+gb[i].min * 100) / 100));
      return { ...g, min };
    }).sort((a, b) => b.min - a.min),
    verdict: {
      go: clamp100(vd.go ?? DEFAULT_VERDICT.go),
      cond: clamp100(vd.cond ?? DEFAULT_VERDICT.cond)
    }
  };
  return model;
}
const sanWeights = (o, def) => {
  const r = {};
  for (const k of Object.keys(def)) r[k] = clamp10(o?.[k] ?? def[k]);
  return r;
};
const clamp10 = x => Math.max(0, Math.min(10, Number(x) || 0));
const clamp100 = x => Math.max(0, Math.min(100, Number(x) || 0));

// ---------------------- 核心计算 ----------------------
// J/E/V 单项(1-10) → 综合分(0-100)
export function computeComposite(hookScore, engScore, valScore, weights = DEFAULT_WEIGHTS) {
  const j = clamp10(hookScore), e = clamp10(engScore), v = clamp10(valScore);
  const sum = (weights.j || 0) + (weights.e || 0) + (weights.v || 0);
  if (sum <= 0) return 0;
  const s10 = (j * weights.j + e * weights.e + v * weights.v) / sum;   // 加权 1-10
  return Math.round(s10 * 1000) / 100;                                  // → 0-100 保留两位
}

export function getGrade(score) {
  return GRADE_BANDS.find(b => score >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];
}

function clamp10(x) { return Math.max(1, Math.min(10, Number(x) || 1)); }

// ---------------------- 平台适配度 ----------------------
// 输入: analysis(含 hook/engagement/value/policy), basic, weights
// 输出: { meta:{fit,verdict,reasons}, google:{...}, tiktok:{...} }
export function evaluatePlatforms(analysis, basic, weights = DEFAULT_WEIGHTS) {
  const h = analysis.hook || {}, e = analysis.engagement || {}, v = analysis.value || {};
  const p = analysis.policy || {};
  const j = clamp10(h.score), E = clamp10(e.score), V = clamp10(v.score);
  const P = clamp10(p.score ?? 9);                  // 政策安全分
  const nativeBonus = nativeScore(analysis);        // 原生感 0-10

  const critical = (p.risks || []).filter(r => r.level === 'critical');
  const warning  = (p.risks || []).filter(r => r.level === 'warning');

  const calcs = {
    meta: {
      raw: j*(weights.platforms.meta.hook||0)  + E*(weights.platforms.meta.engagement||0)
         + V*(weights.platforms.meta.value||0) + P*(weights.platforms.meta.policy||0),
      wsum: (weights.platforms.meta.hook||0)+(weights.platforms.meta.engagement||0)
          + (weights.platforms.meta.value||0)+(weights.platforms.meta.policy||0)
    },
    google: {
      raw: j*(weights.platforms.google.hook||0)  + E*(weights.platforms.google.engagement||0)
         + V*(weights.platforms.google.value||0) + P*(weights.platforms.google.policy||0),
      wsum: (weights.platforms.google.hook||0)+(weights.platforms.google.engagement||0)
          + (weights.platforms.google.value||0)+(weights.platforms.google.policy||0)
    },
    tiktok: {
      raw: j*(weights.platforms.tiktok.hook||0)    + E*(weights.platforms.tiktok.engagement||0)
         + V*(weights.platforms.tiktok.value||0)   + P*(weights.platforms.tiktok.policy||0)
         + nativeBonus*(weights.platforms.tiktok.native||0),
      wsum: (weights.platforms.tiktok.hook||0)+(weights.platforms.tiktok.engagement||0)
          + (weights.platforms.tiktok.value||0)+(weights.platforms.tiktok.policy||0)
          + (weights.platforms.tiktok.native||0)
    }
  };

  const out = {};
  for (const key of Object.keys(calcs)) {
    const c = calcs[key];
    let fit = c.wsum > 0 ? Math.round((c.raw / c.wsum) * 1000) / 100 : 0;

    // —— 画幅/规格加成 ——
    const reasons = [];
    const aspect = basic?.aspect, dur = basic?.durationSec;
    if (key === 'meta' || key === 'tiktok') {
      if (aspect === '9:16') { fit += 5; reasons.push(key === 'tiktok' ? '竖屏原生形态，Feed/Reels 友好' : '9:16 竖屏符合 Feed/Reels'); }
      else if (aspect === '1:1') { fit += 2; }
    }
    if (key === 'google') {
      if (aspect === '1:1' || aspect === '16:9') { fit += 4; reasons.push(aspect === '16:9' ? '16:9 适合 YouTube' : '1:1 兼容 PMax 多画幅'); }
      if (basic?.resolution === 'FHD' || basic?.resolution === '4K') { fit += 3; reasons.push('高画质利于 YouTube/PMax'); }
      if (basic?.mediaType === 'video' && dur && dur < 6) { fit -= 3; reasons.push('视频过短，YouTube 完整观看易低'); }
    }
    if (key === 'tiktok') {
      if (dur && dur <= 60 && basic?.mediaType === 'video') { fit += 2; reasons.push('时长符合 TikTok 短平快节奏'); }
      if (nativeBonus >= 8) reasons.push('原生感强，无硬广痕迹');
    }
    if (key === 'meta' && e.trust?.includes('UGC真人出镜')) { fit += 3; reasons.push('UGC 真人出镜，社交信任感强'); }

    fit = Math.max(0, Math.min(100, Math.round(fit * 100) / 100));

    // —— 裁定 ——
    let verdict = fit >= 72 ? 'GO' : fit >= 58 ? 'COND' : 'NO';
    if (critical.length) {
      verdict = 'NO';
      reasons.unshift(`违禁(一票否决)：${critical.map(r => r.label).join('、')}`);
      if (key === 'google') reasons.push('Google 政策对功效/侵权类目最严');
    }
    for (const w of warning) {
      if (verdict === 'GO') verdict = 'COND';
      reasons.push(`风险提示：${w.label}，建议修订后投放`);
    }

    out[key] = { fit, verdict, reasons };
  }
  return out;
}

// 原生感 0-10：UGC/真人/口语化/无硬广感
function nativeScore(analysis) {
  const e = analysis.engagement || {};
  let s = 5;
  if (e.actor === '欧美真人' || e.actor === '亚洲真人') s += 2.5;
  else if (e.actor === '3D动画') s += 0.5;
  else if (e.actor === '无真人') s -= 1.5;
  if (e.trust?.includes('UGC真人出镜')) s += 1.5;
  if (e.scene === '室内' || e.scene === '街头') s += 0.5;
  const v = analysis.value || {};
  if (v.offer && v.offer !== '无促销') s -= 1;   // 促销词削弱原生感
  return Math.max(0, Math.min(10, s));
}

// ---------------------- 合规扫描 ----------------------
// 扫描文本（文件名/字幕/OCR/ASR）自动命中规则
export function scanPolicy(texts = []) {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  const hits = [];
  for (const r of POLICY_RULES) {
    if (r.keywords.length && r.keywords.some(k => hay.includes(k))) {
      hits.push({ key: r.key, level: r.severity, label: r.label, automatic: true });
    }
  }
  return hits;
}

// 合规安全分（1-10，10=完全安全）：从勾选风险计算
export function policyScoreFromRisks(risks = []) {
  const critical = risks.filter(r => r.level === 'critical').length;
  const warning = risks.filter(r => r.level === 'warning').length;
  let s = 10 - critical * 4 - warning * 1.2;
  return Math.max(1, Math.min(10, Math.round(s * 10) / 10));
}

// ---------------------- 综合重算（素材全链路） ----------------------
export function recomputeAnalysis(analysis, basic, weights = DEFAULT_WEIGHTS, risksOverride = null) {
  const risks = risksOverride ?? analysis.policy?.risks ?? [];
  const policy = {
    score: policyScoreFromRisks(risks),
    risks
  };
  const composite = computeComposite(analysis.hook?.score, analysis.engagement?.score, analysis.value?.score, weights);
  const gradeInfo = getGrade(composite);
  const platforms = evaluatePlatforms({ ...analysis, policy }, basic, weights);
  return {
    ...analysis,
    policy,
    platforms,
    composite,
    grade: gradeInfo.grade,
    gradeInfo: { label: gradeInfo.label, advice: gradeInfo.advice, min: gradeInfo.min }
  };
}

// 启发式基线初评（无 AI 时的起点分，供人工微调）；结合 ffprobe 元数据
export function heuristicBaseline(basic) {
  let j = 6.0, e = 6.0, v = 6.0;
  const aspect = basic?.aspect;
  if (basic?.mediaType === 'video') {
    if (aspect === '9:16') j += 0.4;
    if ((basic?.durationSec ?? 0) < 15) e -= 0.3;
    if (basic?.resolution === 'FHD' || basic?.resolution === '4K') e += 0.3;
  } else {
    if (aspect === '9:16') j += 0.2;
    e -= 0.5; // 单图无沉浸叙事
  }
  return {
    hook: {
      score: round1(j), hookType: '无明确钩子', visualImpact: 6,
      textOverlay: false, productRevealSec: 1.5
    },
    engagement: {
      score: round1(e), painPoint: '', scene: '室内', sceneRealism: 6,
      demoClarity: 6, beforeAfter: false, trust: [], actor: '无真人',
      language: '无配音'
    },
    value: {
      score: round1(v), usp: '', offer: '无促销', priceShown: false,
      ctaScore: 6, ctaText: ''
    },
    policy: { score: 9, risks: [] },
    platforms: { meta: {}, google: {}, tiktok: {} },
    composite: 0, grade: 'C', gradeInfo: { label: '待优化', advice: '' },
    tags: { basic: [], content: [], strategy: [], advice: [] },
    aiAssessed: false
  };
}

function round1(x) { return Math.round(x * 10) / 10; }