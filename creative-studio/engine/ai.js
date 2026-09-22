// ============================================================================
// TypeSafe 多模态评测适配器
// 使用 TypeSafe System One 模型 (Jev) 对广告素材做结构化评测：
//   - Score 原语 → J/E/V 三维打分 (1-10) 与 CTA 强度
//   - Choice 原语 → Hook 类型 / 出镜类型 / 场景 / 语言
//   - Noul 原语 → BeforeAfter / 合规风险判断
// 依据 TypeSafe 最佳实践：同一 state 上的独立问题并行提交，一次请求返回全部答案。
// ============================================================================

const TS_URL = 'https://api.typesafe.ai/v1/systemone';
const TS_MODEL = 'jev-latest';

export function aiAvailable() {
  return !!process.env.TYPESAFE_API_KEY;
}

// 组装素材文本状态（文件名 + 字幕 + 已标注的元数据）
export function buildStateText(material) {
  const parts = [];
  parts.push(`素材名称: ${material?.name || '未命名'}`);
  const s = material?.subtitles || [];
  if (s.length) parts.push(`视频字幕/文案: ${s.map(x => x.text).join(' ')}`);
  const an = material?.analysis || {};
  if (an.engagement?.painPoint) parts.push(`核心痛点(标注): ${an.engagement.painPoint}`);
  if (an.value?.usp) parts.push(`核心卖点USP(标注): ${an.value.usp}`);
  if (an.engagement?.scene) parts.push(`场景(标注): ${an.engagement.scene}`);
  if (an.engagement?.actor) parts.push(`出镜(标注): ${an.engagement.actor}`);
  if (an.engagement?.language) parts.push(`语言(标注): ${an.engagement.language}`);
  if (an.value?.offer && an.value.offer !== '无促销') parts.push(`促销(标注): ${an.value.offer}`);
  if (an.hook?.hookType && an.hook.hookType !== '无明确钩子') parts.push(`Hook类型(标注): ${an.hook.hookType}`);
  return parts.join('\n');
}

// 分数归一化：Jev Score 返回 0~N-1 的概率加权值，映射到 1-10
function scoreTo10(score, levels) {
  if (score == null) return null;
  const max = levels - 1;
  return Math.max(1, Math.min(10, Math.round((1 + (score / max) * 9) * 10) / 10));
}

// 一次请求评测素材文本，返回结构化结果（供 server 回填 analysis）
export async function analyzeWithTypeSafe(material) {
  if (!aiAvailable()) return null;
  const state = buildStateText(material);

  const questions = {
    hook_score: {
      type: 'score',
      instructions: '依据提供的跨境广告素材信息（名称/文案/字幕/标注），评估其【J - Hook 首屏吸睛度】。判断前3秒能否抓住海外冷流量用户注意力：痛点直击、猎奇、对比、强视觉等。',
      criteria: [
        '开场平淡，无明确注意力抓取点，滑走率高',
        '有基本的视觉兴趣或卖点开头，但冲击力一般',
        '前3秒有强烈模式中断：痛点/猎奇/对比/强字幕重音，能停住拇指'
      ]
    },
    engagement_score: {
      type: 'score',
      instructions: '评估【E - Engagement 沉浸与信任】：痛点呈现深度、场景真实感、产品演示清晰度、信任元素（真人出镜/好评/数据佐证）是否充分。',
      criteria: [
        '信息单薄，缺场景与信任锚点，难以建立共鸣',
        '有一定场景与演示，信任感中等',
        '真人出镜/测评/数据等信任元素丰富，痛点共鸣强'
      ]
    },
    value_score: {
      type: 'score',
      instructions: '评估【V - Value & CTA 转化闭环】：核心卖点USP是否清晰、价格/优惠引导是否明确、结尾CTA动作指引强弱。',
      criteria: [
        '卖点模糊，无明确价格/优惠与CTA',
        '有卖点说明，但价格或CTA引导一般',
        'USP清晰，价格/限时优惠明确，CTA强有力'
      ]
    },
    cta_score: {
      type: 'score',
      instructions: '评估结尾 CTA 的强度与清晰度：是否有明确单一的动作号召与转化动机。',
      criteria: ['无明显CTA', '有CTA但一般', 'CTA强而清晰，紧迫感/优惠明确']
    },
    hook_type: {
      type: 'choice',
      instructions: '判断该素材最符合哪种 Hook 策略类型。',
      criteria: {
        pain: '痛点直击型：直接抛出用户痛点',
        unboxing: '猎奇拆箱型：开箱/好奇驱动',
        comparison: '效果对比型：Before/After 或对比',
        quiz: '问答互动型：提问/互动引发好奇',
        controversy: '争议话题型：制造争议或反常识',
        offer: '优惠直给型：直接给折扣/促销',
        none: '无明确钩子'
      }
    },
    actor: {
      type: 'choice',
      instructions: '判断素材中出镜者类型。',
      criteria: {
        western: '欧美真人出镜',
        asian: '亚洲真人出镜',
        none: '无真人出镜（纯产品/静物/动画）',
        cg: '3D动画或虚拟形象',
        ai: 'AI合成人物'
      }
    },
    scene: {
      type: 'choice',
      instructions: '判断素材主要场景。',
      criteria: {
        indoor: '室内（居家/房间）',
        outdoor: '户外',
        studio: '工作室/棚拍',
        street: '街头/公共场合',
        product: '纯产品展示，无明显场景'
      }
    },
    before_after: {
      type: 'noul',
      instructions: '素材中是否包含 Before/After（使用前后对比）展示？',
      criteria: { true: '有明确的前后对比画面/表述', false: '无前后对比' }
    },
    risk_health: {
      type: 'noul',
      instructions: '素材是否包含医疗、减肥、增肌、功效夸大等健康类违规表述？',
      criteria: { true: '存在健康功效夸大或医疗承诺', false: '无健康类违规' }
    },
    risk_mislead: {
      type: 'noul',
      instructions: '素材是否包含虚假承诺、100%保证、暴富等误导性表述？',
      criteria: { true: '存在虚假/夸张承诺', false: '无误导性承诺' }
    },
    risk_policy: {
      type: 'noul',
      instructions: '素材是否存在成人、暴力、政治、赌博、仿冒侵权等其他政策违规风险？',
      criteria: { true: '存在其他明显政策违规', false: '无明显违规' }
    }
  };

  const res = await fetch(TS_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.TYPESAFE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ state, model: TS_MODEL, questions })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TypeSafe ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const a = json.answers || {};
  const pick = id => {
    const q = a[id];
    if (!q || !q.type) return null;
    if (q.type === 'noul') return q.noul;
    if (q.type === 'choice') return q.choice;
    if (q.type === 'score') return q.score;
    return null;
  };

  const HOOK_MAP = {
    pain: '痛点直击型', unboxing: '猎奇拆箱型', comparison: '效果对比型',
    quiz: '问答互动型', controversy: '争议话题型', offer: '优惠直给型', none: '无明确钩子'
  };
  const ACTOR_MAP = { western: '欧美真人', asian: '亚洲真人', none: '无真人', cg: '3D动画', ai: 'AI合成' };
  const SCENE_MAP = { indoor: '室内', outdoor: '户外', studio: '工作室', street: '街头', product: '纯产品展示' };

  const noul = (id, threshold = 0.55) => (pick(id) == null ? null : pick(id) > threshold);

  const result = {
    hook: {
      score: scoreTo10(pick('hook_score'), 3),
      hookType: HOOK_MAP[pick('hook_type')] || null
    },
    engagement: {
      score: scoreTo10(pick('engagement_score'), 3),
      actor: ACTOR_MAP[pick('actor')] || null,
      scene: SCENE_MAP[pick('scene')] || null,
      beforeAfter: noul('before_after') ?? false
    },
    value: {
      score: scoreTo10(pick('value_score'), 3),
      ctaScore: scoreTo10(pick('cta_score'), 3)
    },
    policy: {
      riskHealth: noul('risk_health'),
      riskMislead: noul('risk_mislead'),
      riskPolicy: noul('risk_policy')
    },
    confidence: {
      hook: a.hook_score?.confidence ?? null,
      engagement: a.engagement_score?.confidence ?? null,
      value: a.value_score?.confidence ?? null
    }
  };

  // AI 审核建议：任一违规 → 淘汰；三维强势 → 通过；否则 → 人工复核
  const risks = [result.policy.riskHealth, result.policy.riskMislead, result.policy.riskPolicy];
  const hasRisk = risks.some(Boolean);
  const avg = (result.hook.score + result.engagement.score + result.value.score) / 3;
  if (hasRisk) result.recommendation = 'reject';
  else if (avg >= 7) result.recommendation = 'keep';
  else if (avg >= 4.5) result.recommendation = 'review';
  else result.recommendation = 'reject';
  result.recommendReason = hasRisk
    ? '检测到合规风险项（医疗夸大/虚假承诺/政策违规）'
    : result.recommendation === 'keep'
      ? 'J/E/V 三维均强势，质量达标'
      : result.recommendation === 'review'
        ? '三维中等，建议人工复核关键短板'
        : '三维偏弱，建议淘汰或重构';
  return result;
}