// ============================================================================
// 多模态 AI 评测适配器（可选）
// 配置环境变量 GEMINI_API_KEY 后，调用 Gemini 视觉模型对素材关键帧做真实评测；
// 未配置时返回 null，系统使用本地启发式基线评分 + 人工微调。
// ============================================================================

import fs from 'fs';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export function aiAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

function toBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

// 评测提示词：严格按 JEV 黄金三维输出 JSON
const PROMPT = `You are a senior Meta/Google/TikTok creative strategist for cross-border e-commerce.
Analyze this ad creative and output ONLY a JSON object (no markdown):
{
  "hook": {"score": 0-10, "hookType": one of [痛点直击型,猎奇拆箱型,效果对比型,问答互动型,争议话题型,优惠直给型,无明确钩子], "visualImpact": 0-10, "textOverlay": bool, "productRevealSec": number},
  "engagement": {"score": 0-10, "painPoint": string, "scene": one of [室内,户外,工作室,街头,纯产品展示], "sceneRealism": 0-10, "demoClarity": 0-10, "beforeAfter": bool, "trust": array of [UGC真人出镜,专家背书,5星好评,解压舒爽视觉,数据佐证], "actor": one of [欧美真人,亚洲真人,无真人,3D动画,AI合成], "language": string},
  "value": {"score": 0-10, "usp": string, "offer": one of [买一送一,限时折扣,免费送货,满减优惠,新品首发,无促销], "priceShown": bool, "ctaScore": 0-10, "ctaText": string},
  "policy_risks": [{"key": string, "level": critical|warning, "label": string}]
}
Score strictly by: J=Hook jaw-dropping power in first 3s; E=Engagement, realism & trust; V=Value clarity & CTA strength.`;

export async function analyzeWithAI(imagePaths, mimeTypes) {
  if (!aiAvailable()) return null;
  try {
    const parts = await Promise.all(imagePaths.map(async (p, i) => {
      const payload = await toBase64(p);
      return { inline_data: { mime_type: mimeTypes[i] || 'image/jpeg', data: payload } };
    }));
    const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }, ...parts] }] })
    });
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.error('[AI adapter] 评测失败:', e.message);
    return null;
  }
}