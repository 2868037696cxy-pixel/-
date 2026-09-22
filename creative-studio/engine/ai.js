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
  const b = material?.basic || {};
  if (b.mediaType) {
    const ar = Number(b.aspect) || 0;
    const orient = !ar ? '' : ar >= 1.2 ? '横版' : ar <= 0.83 ? '竖版' : '近方形';
    const form = b.mediaType === 'video'
      ? `视频（约${Math.round(b.durationSec || 0)}秒${b.hasAudio ? '，有声音' : '，无声'}）`
      : '静态图片';
    const dim = b.width && b.height ? `，分辨率 ${b.width}x${b.height}` : '';
    parts.push(`素材形态: ${form}${orient ? '，' + orient : ''}${dim}`);
  }
  parts.push('投放平台: 仅投放 Facebook/Meta Ads 与 Google Ads 两个渠道');
  parts.push('设计背景: 该素材为无促销设计（不打折/不赠礼/不限时），购买动机完全依赖内容本身（钩子、情绪、产品力）');
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
      instructions: '评估【V - Value & CTA 转化闭环】。该素材为无促销设计（不打折/不促销），不要因缺少价格优惠而扣分；重点评估：卖点是否清晰可感知、产品价值本身是否足以让用户无需优惠就产生购买动机、CTA 动作指引是否明确。',
      criteria: [
        '卖点模糊，价值感知弱，看完不知道为什么要买',
        '卖点可感知，购买动机中等',
        '卖点清晰秒懂，产品力本身激发强烈购买动机，CTA 明确'
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
        visual: '视觉冲击型：产品颜值/画面美感直接抓眼球',
        offer: '优惠直给型：直接给折扣/促销',
        none: '无明确钩子'
      }
    },
    emotion: {
      type: 'choice',
      instructions: '判断该素材主要唤起/瞄准的观众主导情绪。该素材为无促销设计，情绪是最核心的驱动力，请基于画面氛围、文案语气与内容主题判断。',
      criteria: {
        curiosity: '好奇/悬念 —— 想看下去弄明白是什么、为什么',
        desire: '渴望/向往 —— 想拥有同款效果或生活方式',
        anxiety: '焦虑/痛点共鸣 —— "说的就是我"，迫切需要解决',
        comfort: '信任/安心 —— 真实可信，敢放心买',
        surprise: '惊讶/震撼 —— 视觉冲击让人停下拇指',
        neutral: '平淡无感 —— 情绪唤起弱'
      }
    },
    core_appeal: {
      type: 'choice',
      instructions: '提炼该素材的核心吸引力：用户被打动、愿意停留并产生兴趣的最主要原因是哪一个（单选最能代表素材灵魂的一项）。',
      criteria: {
        visual: '视觉产品力 —— 产品颜值/使用效果直观可见，看一眼就想要',
        pain_solution: '痛点解决方案 —— 直击问题并清晰给出解法',
        emotional: '情绪价值 —— 氛围与情绪共鸣驱动，产品是配角',
        lifestyle: '生活方式认同 —— 场景与身份代入感引发向往',
        none: '无清晰核心 —— 信息杂乱、缺乏主线'
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
    },
    fb_fit: {
      type: 'score',
      instructions: '评估该素材对 Facebook/Meta Ads（信息流/Reels/Stories，移动端刷屏场景）的投放适配度：竖版/方形优先、前3秒强Hook、原生UGC感、移动端可读性与节奏。',
      criteria: [
        '不适配信息流节奏：横屏冗长或信息密度低，易被划走',
        '基本适配，但移动端吸引力或原生感一般',
        '高度适配 Meta：竖版/方形优先，前3秒强Hook，原生感强，移动端体验佳'
      ]
    },
    google_fit: {
      type: 'score',
      instructions: '评估该素材对 Google Ads（YouTube 内流/Shorts、Demand Gen、展示广告）的投放适配度：卖点信息清晰直接、表达可信专业、品牌感、可跨版式复用。',
      criteria: [
        '不适配：信息混乱或过度标题党，缺乏可信度',
        '基本适配，信息可读但亮点与可信度一般',
        '高度适配 Google：卖点清晰秒懂、表达可信专业，适配多版式投放'
      ]
    },
    fb_policy: {
      type: 'noul',
      instructions: '按 Meta 广告政策判断风险：是否包含减肥/健康类 Before-After 前后对比、针对个人身体属性的断言（如"你太胖了"）、负面自我认知暗示或夸大健康功效？Meta 对此类内容限制极严，易拒登甚至封户。',
      criteria: { true: '存在 Meta 政策受限内容', false: '无 Meta 政策风险' }
    },
    google_policy: {
      type: 'noul',
      instructions: '按 Google Ads 政策判断风险：是否包含不可能实现或误导性编辑的前后对比演示、夸大健康医疗声明、点击诱饵式标题？Google 对健康类与误导性演示审核严格。',
      criteria: { true: '存在 Google 政策受限内容', false: '无 Google 政策风险' }
    },
    best_platform: {
      type: 'choice',
      instructions: '综合素材风格与两个投放平台（Meta / Google）的特性，判断它更适合投到哪。',
      criteria: {
        fb: '更适合 Meta：情绪化、UGC原生、强Hook，适合信息流/Reels',
        google: '更适合 Google：信息清晰、可信专业，适合 YouTube/展示',
        both: '双平台通用',
        neither: '两平台均不适合'
      }
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
    quiz: '问答互动型', controversy: '争议话题型', visual: '视觉冲击型',
    offer: '优惠直给型', none: '无明确钩子'
  };
  const ACTOR_MAP = { western: '欧美真人', asian: '亚洲真人', none: '无真人', cg: '3D动画', ai: 'AI合成' };
  const SCENE_MAP = { indoor: '室内', outdoor: '户外', studio: '工作室', street: '街头', product: '纯产品展示' };
  const BEST_MAP = { fb: 'Meta(FB/IG)', google: 'Google Ads', both: '双平台通用', neither: '两平台均不宜' };
  const EMOTION_MAP = {
    curiosity: '好奇悬念', desire: '渴望向往', anxiety: '焦虑共鸣',
    comfort: '信任安心', surprise: '惊讶震撼', neutral: '平淡无感'
  };
  const APPEAL_MAP = {
    visual: '视觉产品力', pain_solution: '痛点解决', emotional: '情绪价值',
    lifestyle: '生活方式', none: '无清晰核心'
  };

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

  // 双平台（Meta / Google）评测：适配度 + 平台专属政策红线 + 平台级判定
  const fbFit = scoreTo10(pick('fb_fit'), 3);
  const googleFit = scoreTo10(pick('google_fit'), 3);
  const riskFb = noul('fb_policy');
  const riskGoogle = noul('google_policy');
  result.policy.riskFb = riskFb;
  result.policy.riskGoogle = riskGoogle;
  const pfVerdict = (fit, risk) => {
    if (risk === true) return 'reject';
    if (fit == null) return 'review';
    return fit >= 6.5 ? 'pass' : fit >= 4 ? 'review' : 'reject';
  };
  result.platform = {
    fbFit,
    googleFit,
    best: BEST_MAP[pick('best_platform')] || null,
    fbVerdict: pfVerdict(fbFit, riskFb),
    googleVerdict: pfVerdict(googleFit, riskGoogle)
  };

  // 素材核心提炼：钩子策略 × 主导情绪 × 核心吸引力（无促销设计下的内容驱动力画像）
  const hookType = HOOK_MAP[pick('hook_type')] || null;
  const emotion = EMOTION_MAP[pick('emotion')] || null;
  const appeal = APPEAL_MAP[pick('core_appeal')] || null;
  const coreSummary = appeal === '无清晰核心'
    ? '素材缺乏清晰核心主线，信息杂乱，建议重构'
    : [hookType, emotion, appeal].filter(Boolean).length
      ? `以「${[hookType, emotion].filter(Boolean).join(' × ')}」抓人，核心靠「${appeal || '?'}」打动用户`
      : null;
  result.core = { hookType, emotion, appeal, summary: coreSummary };

  // AI 审核建议：通用违规或双平台政策均受限 → 淘汰；单平台受限 → 按另一平台表现保留/复核；否则按三维均值
  const risks = [result.policy.riskHealth, result.policy.riskMislead, result.policy.riskPolicy];
  const genRisk = risks.some(Boolean);
  const bothPfRisk = riskFb === true && riskGoogle === true;
  const onlyFb = riskFb === true && riskGoogle !== true;
  const onlyGg = riskGoogle === true && riskFb !== true;
  const avg = ((result.hook.score || 0) + (result.engagement.score || 0) + (result.value.score || 0)) / 3;
  const altFit = onlyFb ? googleFit : fbFit;
  const altPass = onlyFb ? result.platform.googleVerdict === 'pass' : result.platform.fbVerdict === 'pass';

  if (genRisk || bothPfRisk) {
    result.recommendation = 'reject';
    result.recommendReason = genRisk
      ? '检测到合规风险项（医疗夸大/虚假承诺/政策违规）'
      : 'Meta 与 Google 双平台政策均受限，建议淘汰';
  } else if (onlyFb || onlyGg) {
    const alt = onlyFb ? 'Google Ads' : 'Meta(FB/IG)';
    const blocked = onlyFb ? 'Meta' : 'Google';
    if (altPass && avg >= 5.5) {
      result.recommendation = 'keep';
      result.recommendReason = `${blocked} 政策受限，仅建议投 ${alt}（适配 ${altFit ?? '?'}/10）`;
    } else {
      result.recommendation = 'review';
      result.recommendReason = `${blocked} 政策受限，${alt} 适配一般，需人工确认单平台投放`;
    }
  } else if (avg >= 7) {
    result.recommendation = 'keep';
    const minFit = Math.min(fbFit ?? 10, googleFit ?? 10);
    result.recommendReason = minFit >= 5
      ? `J/E/V 三维均强势，双平台适配良好，更宜投 ${result.platform.best || '双平台'}`
      : 'J/E/V 三维均强势，质量达标';
  } else if (avg >= 4.5) {
    result.recommendation = 'review';
    result.recommendReason = '三维中等，建议人工复核关键短板';
  } else {
    result.recommendation = 'reject';
    result.recommendReason = '三维偏弱，建议淘汰或重构';
  }
  return result;
}