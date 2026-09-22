// ============================================================================
// 素材分析流水线 Pipeline
// ① ffprobe 元数据探测 → ② ffmpeg 关键帧抽取 → ③ 时间轴/JEV 状态曲线 → ④ OCR/ASR 适配器
// ============================================================================
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const exec = promisify(execFile);
const FFMPEG = 'ffmpeg', FFPROBE = 'ffprobe';

// 能力探测
export async function capabilities() {
  let ffmpeg = true, ffprobe = true, tesseract = false, whisper = false;
  try { await exec('ffmpeg', ['-version']); } catch { ffmpeg = false; }
  try { await exec('ffprobe', ['-version']); } catch { ffprobe = false; }
  try { await exec('tesseract', ['--version']); tesseract = true; } catch {}
  try { await exec('whisper', ['--help']); whisper = true; } catch {}
  return { ffmpeg, ffprobe, tesseract, whisper };
}

// ---------- ① ffprobe 元数据 ----------
export async function probeMedia(filePath) {
  try {
    const { stdout } = await exec(FFPROBE, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath
    ], { maxBuffer: 8 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const vstream = (data.streams || []).find(s => s.codec_type === 'video');
    const astream = (data.streams || []).find(s => s.codec_type === 'audio' && !s.tags?.attached_pic);
    const durationSec = parseFloat(data.format?.duration || vstream?.duration || 0);
    const width = vstream?.width || 0, height = vstream?.height || 0;

    const fr = (vstream?.avg_frame_rate || '').split('/').map(Number);
    const fps = fr.length === 2 && fr[1] ? Math.round((fr[0] / fr[1]) * 100) / 100 : (vstream?.r_frame_rate || 0);

    return {
      durationSec: Math.round(durationSec * 100) / 100,
      width, height,
      fps, hasAudio: !!astream,
      aspect: aspectOf(width, height),
      resolution: resolutionOf(height),
      codec: vstream?.codec_name || null
    };
  } catch {
    // 非媒体文件：按扩展名兜底
    return { durationSec: 0, width: 0, height: 0, fps: 0, hasAudio: false, aspect: null, resolution: null, codec: null };
  }
}

function aspectOf(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  if (r >= 1.6) return '16:9';
  if (r >= 1.25) return '4:3';
  if (r >= 0.95) return '1:1';
  if (r >= 0.72) return '4:5';
  return '9:16';
}
function resolutionOf(h) {
  if (h >= 2160) return '4K';
  if (h >= 1080) return 'FHD';
  if (h >= 720) return 'HD';
  return 'SD';
}

// ---------- ② ffmpeg 关键帧抽取（海报 + 钩子/中段/结尾帧） ----------
export async function extractKeyframes(filePath, id, outDir, durationSec) {
  if (!durationSec || durationSec <= 0) return { poster: null, frames: [] };
  const frames = [];
  const times = durationSec <= 3
    ? [durationSec / 2]
    : [1.0, Math.round(durationSec / 2), Math.max(2, durationSec - 1)].filter(t => t < durationSec);
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const out = path.join(outDir, `${id}_f${i}.jpg`);
    try {
      await exec(FFMPEG, ['-ss', String(t), '-i', filePath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', '-y', out]);
      if (fs.existsSync(out)) frames.push({ t, file: `${id}_f${i}.jpg` });
    } catch { /* 抽帧失败不阻断流程 */ }
  }
  const poster = frames.find(f => Math.abs(f.t - 1.0) < 0.6) || frames[0];
  return { poster: poster ? `/media/thumbs/${poster.file}` : null, frames };
}

// ---------- ③ 时间轴节点 + JEV 状态曲线 ----------
export function buildTimeline(basic, analysis) {
  const dur = basic?.durationSec || 0;
  const nodes = [];
  if (basic?.mediaType === 'video' && dur > 0) {
    const h = analysis.hook || {};
    nodes.push({ sec: 0, label: 'Hook 起点', kind: 'hook' });
    const reveal = Math.min(3, Math.max(0.5, h.productRevealSec || 1.5));
    nodes.push({ sec: Math.round(reveal * 10) / 10, label: '产品/卖点亮相', kind: 'usp' });
    nodes.push({ sec: Math.round(dur * 0.5 * 10) / 10, label: '演示/信任中段', kind: 'demo' });
    nodes.push({ sec: Math.round(Math.max(2, dur - 1) * 10) / 10, label: 'CTA 收尾', kind: 'cta' });
  } else {
    // 图片素材：伪三节点（展示用）
    nodes.push({ sec: 0, label: '首屏视觉', kind: 'hook' });
    nodes.push({ sec: 1, label: '卖点信息', kind: 'usp' });
    nodes.push({ sec: 2, label: 'CTA 区域', kind: 'cta' });
  }

  // JEV 曲线采样（由三个维度分合成的状态曲线：前段 Hook 主导 → 中段 Engagement → 尾段 Value）
  const j = analysis.hook?.score ?? 5, e = analysis.engagement?.score ?? 5, v = analysis.value?.score ?? 5;
  const N = 7;
  const curve = [];
  for (let i = 0; i < N; i++) {
    const p = i / (N - 1);   // 0→1 播放进度
    // 权重随进度渐变：Hook 前强后弱，Value 前弱后强，Engagement 中段峰值
    const wj = 0.9 - 0.8 * p;
    const we = 1 - Math.abs(p - 0.55) * 1.6;
    const wv = 0.15 + 0.85 * p;
    curve.push({
      t: basic?.mediaType === 'video' ? Math.round(dur * p * 10) / 10 : i,
      j: Math.round(j * wj * 10) / 10,
      e: Math.round(e * Math.max(0.2, we) * 10) / 10,
      v: Math.round(v * wv * 10) / 10
    });
  }
  return { nodes, curve };
}

// ---------- ④ OCR / ASR 适配器（可插拔；未安装则返回 null 由用户手动粘贴） ----------
export async function runOCR(imagePath) {
  try {
    const { stdout } = await exec('tesseract', [imagePath, 'stdout', '-l', 'eng+deu+fra+ita+spa+por']);
    return stdout.trim() || null;
  } catch { return null; }
}
export async function runASR(videoPath, language = 'auto') {
  // whisper CLI 未安装时返回 null
  try {
    const args = [videoPath, '--model', 'small', '--language', language, '--output_format', 'json', '--output_dir', path.dirname(videoPath)];
    await exec('whisper', args);
    return null; // 结果文件读取由调用方处理
  } catch { return null; }
}