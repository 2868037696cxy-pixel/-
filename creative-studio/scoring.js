// ============================================================================
// JEV Creative Quality Model
// 基于 Meta Creative Insights / Google Ad Policy / 行业创意漏斗(Hook→Hold→CTR→CVR→ROAS)
// 提炼出的加权综合评分模型。所有评分均为 0-100。
// ============================================================================

// 默认维度权重（百分比，总和 100）
export const DEFAULT_WEIGHTS = {
  hook: 20,          // 首屏钩子（前3秒抓停滑动，Thumbstop/Hook rate）
  message: 15,       // 卖点传达（单一清晰主张、一屏看懂）
  visual: 15,        // 视觉质量（构图/色彩/字体/专业度/清晰度）
  proof: 10,         // 产品呈现与可信度（细节、场景、评价/数字/保证）
  pacing: 10,        // 节奏与结构（钩子到正文过渡、Hold rate、版式层级）
  cta: 10,           // 行动号召（明确单一 CTA、紧迫感、转化动机）
  format: 10,        // 平台适配（尺寸/安全区/字幕/音效，贴合平台最佳实践）
  compliance: 10     // 合规安全（高分=低风险；主政策减分项）
};

export const DIMENSION_LABELS = {
  hook: '首屏钩子 Hook',
  message: '卖点传达 Message',
  visual: '视觉质量 Visual',
  proof: '产品/可信度 Proof',
  pacing: '节奏与结构 Pacing',
  cta: '行动号召 CTA',
  format: '平台适配 Format',
  compliance: '合规安全 Compliance'
};

export const DIMENSION_DESC = {
  hook: '前3秒能否停住浏览者拇指(Thumbstop)。Meta 冷流量 Hook rate <25% 即判定钩子偏弱；>35% 为优秀。',
  message: '是否在几秒内讲清"你是谁、卖什么、凭什么"，主张单一不贪多、卖点可复述。',
  visual: '成像清晰、构图/色彩/对齐专业、字体可读性高、无廉价/低清/拉伸变形。',
  proof: '产品有细节特写/真人上身/使用场景，或有数据承诺、好评、保证、测评等信任锚点。',
  pacing: '视频钩子→正文过渡自然，Hold 保持率不塌（15s 观看占比），图片版式层级清晰一眼看完。',
  cta: '有且只有一个明确的行动引导，制造点击动机与适度紧迫感（限时/限量/优惠）。',
  format: '尺寸与安全区符合平台规格、视频有字幕/合适音效、无播放按钮误触等版块遮挡。',
  compliance: '无政治/成人/赌博/医药夸大/仿冒/诱导点击等平台违禁元素。高分=合规安全。'
};

// 分级阈值
export const GRADE_BANDS = [
  { grade: 'S', min: 90, label: '优秀',   advice: '高优先投放' },
  { grade: 'A', min: 80, label: '良好',   advice: '建议投放' },
  { grade: 'B', min: 70, label: '合格',   advice: '建议测试投放' },
  { grade: 'C', min: 55, label: '待优化', advice: '优化后小流量测试' },
  { grade: 'D', min: 0,  label: '不合格', advice: '不建议投放' }
];

// 合规风险规则（按关键词自动预判 + 手动确认）。severity: critical=一票否决 / warning=风险提示
export const COMPLIANCE_RULES = [
  { key: 'adult',       label: '成人/色情内容', severity: 'critical', keywords: ['porn', 'nude', 'xxx', 'sex', 'adult', 'escort'] },
  { key: 'political',   label: '政治/选举内容', severity: 'critical', keywords: ['election', 'vote', 'president', 'politics', 'campaign', 'covid', 'corona'] },
  { key: 'health_claim',label: '医疗/增肌/减重功效夸大', severity: 'critical', keywords: ['weight loss', 'lose weight', 'fat burn', 'cure', 'heal', 'detox', 'muscle', 'testosterone', 'boost test'] },
  { key: 'gambling',    label: '赌博/博彩', severity: 'critical', keywords: ['casino', 'betting', 'gamble', 'slot', 'poker', 'lottery', 'trading'] },
  { key: 'overpromise', label: '虚假/夸张承诺(100%/暴富)', severity: 'critical', keywords: ['100% guaranteed', 'get rich', 'make money fast', 'free forever', 'miracle'] },
  { key: 'counterfeit', label: '仿冒/侵权品牌内容', severity: 'critical', keywords: ['replica', 'counterfeit', 'knockoff', 'fake brand', 'coco chanel', 'hermes copy'] },
  { key: 'misleading_btn',label: '虚假播放/诱导点击按钮', severity: 'warning', keywords: ['click here to play', 'dont miss', 'claim now'] },
  { key: 'shaky_flash', label: '强烈晃动/频闪(视频)', severity: 'warning', keywords: ['strobe', 'flash warning', 'motion sickness'] }
];

// 规则：合规→投放判定
// 任一 critical 触发 => 对应平台 NO（不可投放）
// 无 critical，按综合分给投放建议
export function computeComposite(dims, weights) {
  let total = 0;
  let wSum = 0;
  for (const k of Object.keys(weights)) {
    const w = Number(weights[k]) || 0;
    const v = Number(dims[k]) ?? 0;
    total += w * v;
    wSum += w;
  }
  if (wSum === 0) return 0;
  return Math.round((total / wSum) * 100) / 100; // 保留两位
}

export function getGrade(score) {
  for (const b of GRADE_BANDS) {
    if (score >= b.min) return b;
  }
  return GRADE_BANDS[GRADE_BANDS.length - 1];
}

// 扫描文本命中合规规则的自动预判
export function scanComplianceFlags(...texts) {
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  const hits = [];
  for (const rule of COMPLIANCE_RULES) {
    const found = rule.keywords.some(k => haystack.includes(k));
    if (found) hits.push({ key: rule.key, automatic: true });
  }
  return hits;
}

// 投放判定
// params: dims 中 compliance, 综合分 score, activeFlags(用户/自动确认的违禁flag keys), mediaType
// 返回 { google: {verdict,reasons}, fb: {verdict,reasons} }
export function evaluatePlatformVerdict(dims, score, activeFlags, mediaType) {
  const critical = activeFlags.filter(f => {
    const rule = COMPLIANCE_RULES.find(r => r.key === f.key);
    return rule && rule.severity === 'critical';
  });
  const warning = activeFlags.filter(f => {
    const rule = COMPLIANCE_RULES.find(r => r.key === f.key);
    return rule && rule.severity === 'warning';
  });

  const reasons = [];
  const noReason = [];
  for (const f of critical) {
    const r = COMPLIANCE_RULES.find(x => x.key === f.key);
    noReason.push(`违禁:${r ? r.label : f.key}`);
  }

  // Google 对医疗健康类更严格；Meta 对金融/异性话题更敏感 —— 这里用统一规则+平台差分
  const google = { verdict: 'NO', reasons: [...noReason] };
  const fb = { verdict: 'NO', reasons: [...noReason] };
  const healthCritical = critical.some(f => f.key === 'health_claim' || f.key === 'gambling');
  if (healthCritical) {
    google.reasons.push('Google 对医疗功效/博彩类目严格限制');
    fb.reasons.push('Meta 对医疗功效/博彩类目严格限制');
  }

  const penalized = (score > 0 && score < 70) || critical.length > 0 || warning.length > 0;

  if (critical.length === 0) {
    // 依据综合分
    if (score >= 80) {
      google.verdict = 'GO';
      fb.verdict = 'GO';
      google.reasons.push('综合评分优秀，创意策略健康');
      fb.reasons.push('综合评分优秀，创意策略健康');
    } else if (score >= 70) {
      google.verdict = 'GO';
      fb.verdict = 'GO';
      google.reasons.push('评分达标，建议测试投放');
      fb.reasons.push('评分达标，建议测试投放');
    } else if (score >= 55) {
      google.verdict = 'COND';
      fb.verdict = 'COND';
      google.reasons.push('评分待优化：先针对性优化钩子/CTA 后再投放');
      fb.reasons.push('评分待优化：先针对性优化钩子/CTA 后再投放');
    } else {
      google.verdict = 'NO';
      fb.verdict = 'NO';
      google.reasons.push('综合评分过低，不建议投放');
      fb.reasons.push('综合评分过低，不建议投放');
    }
  }

  // warning 动作：降级或加"需修订"
  for (const f of warning) {
    const r = COMPLIANCE_RULES.find(x => x.key === f.key);
    if (google.verdict === 'GO') { google.verdict = 'COND'; }
    if (fb.verdict === 'GO') { fb.verdict = 'COND'; }
    google.reasons.push(`风险提示:${r ? r.label : f.key}，建议移除后投放`);
    fb.reasons.push(`风险提示:${r ? r.label : f.key}，建议移除后投放`);
  }

  // mediaType 对平台差分
  if (mediaType === 'carousel') {
    google.reasons.unshift('轮播格式适合 Google PMax 多资产组合');
    fb.reasons.push('Meta 轮播注意首卡钩子');
  }
  if (mediaType === 'video' && score < 70) {
    fb.reasons.push('视频注意前3秒 Thumbstop 是否达标');
  }

  return { google, fb };
}

// 自动标签（规则引擎，基于评分/合规/媒体类型）
export function autoTags({ score, grade, dims, mediaType, flags, complianceDim }) {
  const tags = [];
  tags.push(grade.label + '素材');
  if (score >= 80) tags.push('重点投放候选');
  if (score < 55) tags.push('待修复');
  if (complianceDim >= 85) tags.push('合规良好');
  if (complianceDim < 50) tags.push('高风险类目');
  if (mediaType === 'video') tags.push('视频素材');
  else if (mediaType === 'image') tags.push('图文素材');
  else if (mediaType === 'carousel') tags.push('轮播素材');
  // 钩子类型启发
  if (dims.hook >= 75) tags.push('强钩子');
  if (dims.hook < 50) tags.push('弱钩子');
  if (dims.cta >= 75) tags.push('强CTA');
  if (dims.proof >= 75) tags.push('高可信度');
  // 违规标签
  for (const f of flags) {
    const r = COMPLIANCE_RULES.find(x => x.key === f.key);
    if (r) tags.push(r.label);
  }
  return [...new Set(tags)];
}

// 生成维度启发式初评（基于有限元数据给一个起点分，供人工微调）
export function heuristicDims({ mediaType, dimensions, sizeM }) {
  const d = {};
  d.hook = 58;
  d.message = 60;
  d.visual = mediaType === 'video' ? 62 : 65;
  d.proof = 58;
  d.pacing = mediaType === 'video' ? 60 : 62;
  d.cta = 55;
  d.format = 62;
  d.compliance = 80;

  // 依尺寸给视觉/格式加成
  if (dimensions && dimensions.w && dimensions.h) {
    const ar = dimensions.w / dimensions.h;
    // 竖屏视频 / 方形图片更贴合移动端 feed
    if (mediaType === 'video' && ar < 1) { d.visual += 4; d.format += 5; d.hook += 3; }
    if (mediaType === 'image' && Math.abs(ar - 1) < 0.15) { d.visual += 4; d.format += 4; }
    if (mediaType === 'image' && ar > 1.3) { d.format -= 4; } // 横版大图适合搜索但 feed 弱
  }
  if (sizeM && sizeM < 0.15) d.visual -= 6; // 极小文件，可能低清
  // 钳制
  for (const k of Object.keys(d)) d[k] = Math.max(0, Math.min(100, d[k]));
  return d;
}