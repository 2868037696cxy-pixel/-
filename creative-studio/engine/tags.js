// ============================================================================
// 动态标签学 + 投放建议生成器
// 输出四类标签：基础属性 / 内容特征 / 营销策略 / 投放建议
// ============================================================================

const ASPECT_LABEL = { '9:16': '竖屏9:16', '1:1': '方形1:1', '16:9': '横屏16:9', '4:5': '竖版4:5', '4:3': '横版4:3' };

// 生成素材主索引文本（用于合规扫描：文件名 + 字幕 + OCR 文案）
export function indexText(material) {
  const parts = [material?.name || ''];
  for (const s of material?.subtitles || []) parts.push(s.text);
  return parts.filter(Boolean).join(' ');
}

export function buildTags(material, analysis, basic, custom = {}) {
  const tags = { basic: [], content: [], strategy: [], advice: [] };

  // ---------- 基础属性 ----------
  if (basic?.mediaType === 'video') tags.basic.push('视频素材');
  else if (basic?.mediaType === 'carousel') tags.basic.push('轮播素材');
  else tags.basic.push('单图素材');

  if (basic?.aspect) tags.basic.push(ASPECT_LABEL[basic.aspect] || basic.aspect);
  if (basic?.mediaType === 'video' && basic.durationSec != null) {
    const d = basic.durationSec;
    tags.basic.push(d < 15 ? `短视频<15s` : d <= 60 ? '中视频15-60s' : '长视频>60s');
  }
  if (basic?.resolution) tags.basic.push(basic.resolution === 'FHD' ? '1080P高清' : basic.resolution === '4K' ? '4K超清' : basic.resolution);

  // ---------- 内容特征 ----------
  const e = analysis?.engagement || {};
  if (e.actor) tags.content.push('出镜:' + e.actor);
  if (e.language) tags.content.push('语言:' + e.language);
  if (e.scene) tags.content.push('场景:' + e.scene);
  if (e.painPoint) tags.content.push('痛点:' + e.painPoint);
  for (const t of e.trust || []) tags.content.push(t);

  // ---------- 营销策略 ----------
  const h = analysis?.hook || {};
  if (h.hookType) tags.strategy.push('Hook:' + h.hookType);
  const v = analysis?.value || {};
  if (v.offer && v.offer !== '无促销') tags.strategy.push('促销:' + v.offer);
  if (e.beforeAfter) tags.strategy.push('Before/After对比');
  if (v.priceShown) tags.strategy.push('价格露出');
  if (v.usp) tags.strategy.push('卖点:' + v.usp);

  // ---------- 投放建议（动态生成） ----------
  tags.advice = buildAdvice(material, analysis, basic, custom);

  return tags;
}

// 投放建议规则引擎
export function buildAdvice(material, analysis, basic, custom = {}) {
  const advice = [];
  const h = analysis?.hook || {};
  const e = analysis?.engagement || {};
  const v = analysis?.value || {};
  const plats = analysis?.platforms || {};

  // —— 推荐测试渠道（按适配分排序取前二） ——
  const ranked = Object.entries(plats)
    .filter(([, p]) => p.verdict !== 'NO')
    .sort((a, b) => b[1].fit - a[1].fit)
    .map(([k]) => ({ meta: 'Meta Reels', google: 'Google PMax/YouTube', tiktok: 'TikTok' }[k]));
  if (ranked.length) {
    advice.push(`推荐测试渠道：${ranked.slice(0, 2).join(' + ')}`);
  } else {
    advice.push('暂不建议投放任何渠道（合规一票否决）');
  }

  // —— 修改建议（按优先级） ——
  if (analysis?.policy?.risks?.length) {
    advice.push(`建议修改点：先移除合规风险项（${analysis.policy.risks.map(r => r.label).join('、')}）`);
  }
  if (h.score < 6) advice.push('建议修改点：重做前3秒钩子 — 加强视觉重音+字幕强调，产品尽量1秒内亮相');
  if (h.score >= 8) advice.push('前3秒钩子强劲，可视为核心优势保留');
  if (v.ctaScore < 6) advice.push('建议修改点：结尾CTA动作指引偏弱，建议强化按钮视觉+限时紧迫感');
  if (basic?.mediaType === 'video' && basic.aspect !== '9:16' && basic.aspect !== '1:1') {
    advice.push('建议修改点：补做 9:16 竖版（适配 Reels/TikTok 主战场）');
  }
  if (basic?.mediaType === 'video' && !(material?.subtitles?.length)) {
    advice.push('建议修改点：添加字幕（多数用户静音观看）');
  }
  if (!e.beforeAfter && v.offer === '无促销') {
    advice.push('建议修改点：补充信任锚点（Before/After、好评、真人演示均可）');
  }
  if (basic?.mediaType === 'image') advice.push('单图素材建议搭配轮播(Carousel)扩大信息承载');
  return advice;
}

// 生成全部标签的扁平数组（用于筛选/标签云）
export function flatTags(analysisTags, customTags = []) {
  const t = analysisTags || { basic: [], content: [], strategy: [], advice: [] };
  return [...t.basic, ...t.content, ...t.strategy, ...t.advice, ...(customTags || [])];
}