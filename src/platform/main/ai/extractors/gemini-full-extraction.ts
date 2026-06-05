/**
 * Gemini 完整对话提取(多 turn)— 主动拉取历史,去 DOM,对齐 Claude/ChatGPT
 *
 * 数据源(2026-06-05 重写):提取时主动在 guest 页 fetch batchexecute 的 hNvQHb rpc
 * (gemini-conversation-query.fetchGeminiConversation),拿整条对话历史 → 每个 turn 含
 * [用户提问 + AI markdown + groundings + 图],turn 内天然对齐。
 *
 * 旧实现(被动 SSE 缓存 + DOM 扒提问)的两大缺陷一并根治:
 *  - 打开历史对话提取为空(SSE 只缓存本次实时发的消息)→ 现在主动拉历史,随时能提
 *  - 用户提问 DOM querySelector → 现在来自 hNvQHb 响应,零 DOM(标题仍读 DOM,非对话内容)
 */

import type { WebContents } from 'electron';
import {
  fetchGeminiConversation,
  type GeminiTurn,
} from './gemini-conversation-query';
import { mediaStore } from '../../media/media-store-impl';
import { prepareSvgForDom } from './claude-extract-turn';

export interface GeminiFullExtractionResult {
  success: boolean;
  markdown?: string;
  title?: string;
  model?: string;
  turnCount?: number;
  artifactCount?: number;
  error?: string;
}

/** 从 DOM 拿当前对话标题(仅标题,非对话内容;Gemini 数据里无独立标题字段)。*/
async function readGeminiTitle(wc: WebContents): Promise<string> {
  try {
    const script = `(function() {
      var sel = '.conversation-title, [data-test-id="conversation-title"], h1';
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || '').trim();
        if (t && t.length < 200) return t;
      }
      return '';
    })()`;
    const result = await wc.executeJavaScript(script);
    return typeof result === 'string' ? result : '';
  } catch {
    return '';
  }
}

/**
 * 解包「blockquote 包代码块」的 Gemini artifact。
 *
 * Gemini hNvQHb markdown 把 artifact(如 config.json)写成 blockquote 里套代码块:
 *   > **`config.json`**
 *   > ```json
 *   > { ... }
 *   > ```
 * note 的 result-parser 把整段 blockquote 当纯文本,内部 fence 不生效 → 露出 ```json
 * 和大括号。这里把「内部含完整代码块的 blockquote 段」去掉每行 `> ` 前缀解包,让代码块
 * 在 note 里正常渲染。只解包确实含 fence 的引用段,普通引用文字不动。
 */
function unwrapBlockquotedCode(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    // 收集一段连续的 blockquote(> 开头,含空 `>` 行)
    if (/^>\s?/.test(lines[i])) {
      const block: string[] = [];
      let j = i;
      while (j < lines.length && /^>\s?/.test(lines[j])) {
        block.push(lines[j].replace(/^>\s?/, ''));
        j++;
      }
      const inner = block.join('\n');
      // 仅当解包后的内容含代码块 fence 时才解包(否则保持 blockquote 原样)
      if (/^[\s\S]*```/.test(inner) && (inner.match(/```/g) || []).length >= 2) {
        out.push(inner);
      } else {
        out.push(...lines.slice(i, j));
      }
      i = j;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

/**
 * 把 turn markdown 里的 SVG / HTML 代码块 fence 转成 note 可渲染的形态:
 *   ```xml / ```svg(内容是 <svg>)→ prepareSvgForDom → mediaStore → ![](media://..svg)
 *     (note image NodeView 见 media://*.svg 自动 innerHTML 真渲染)
 *   ```html(含 <!DOCTYPE / <html)→ mediaStore → !html[](media://..html)
 *     (ResultParser 识别 !html[]() → htmlBlock,iframe 渲染)
 * 复用 Claude artifact 的同款 mediaStore 落盘逻辑。失败兜底:保留原 fence(至少有源码)。
 */
async function convertFenceArtifacts(md: string): Promise<{ markdown: string; count: number }> {
  let count = 0;
  // 匹配 ```lang\n...\n``` 代码块
  const fenceRe = /```([a-zA-Z0-9]*)\n([\s\S]*?)\n```/g;
  const replacements: Array<{ match: string; replacement: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(md)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const code = m[2];
    const isSvg = (lang === 'xml' || lang === 'svg') && /<svg[\s>]/i.test(code);
    const isHtml = lang === 'html' && /<!doctype|<html[\s>]/i.test(code);
    if (!isSvg && !isHtml) continue;
    try {
      if (isSvg) {
        const svgCode = prepareSvgForDom(code);
        const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
        const r = await mediaStore.putBase64(dataUrl, 'image/svg+xml', 'gemini-svg.svg');
        if (r.success && r.mediaUrl) {
          replacements.push({ match: m[0], replacement: `![](${r.mediaUrl})` });
          count++;
        }
      } else {
        const dataUrl = `data:text/html;base64,${Buffer.from(code, 'utf-8').toString('base64')}`;
        const r = await mediaStore.putBase64(dataUrl, 'text/html', 'gemini-html.html');
        if (r.success && r.mediaUrl) {
          replacements.push({ match: m[0], replacement: `!html[HTML 预览](${r.mediaUrl})` });
          count++;
        }
      }
    } catch (err) {
      console.warn('[gemini-extract] fence artifact → media failed:', err);
    }
  }
  let out = md;
  for (const { match, replacement } of replacements) {
    out = out.replace(match, replacement);
  }
  return { markdown: out, count };
}

/**
 * 用 guest 页 session 下载 Gemini 图(带登录 cookie)→ mediaStore → media:// URL。
 *
 * Gemini 的 lh3.googleusercontent.com/gg/ 图需要登录态,通用 image-proxy 用
 * credentials:'omit' 会被拒(403)→ 图加载失败显示空。故 Gemini 图改在此用
 * wc.session.fetch(带 Gemini 页 cookie)下载入库,markdown 直接放 media:// URL,
 * 不再依赖 image-proxy。失败返 null(保留原 lh3 URL 兜底)。
 */
async function downloadGeminiImage(wc: WebContents, url: string): Promise<string | null> {
  try {
    const resp = await wc.session.fetch(url);
    if (!resp.ok) {
      console.warn('[gemini-extract] image download fail status=', resp.status, url.slice(0, 80));
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength === 0) return null;
    const ct = resp.headers.get('content-type') || 'image/jpeg';
    const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const r = await mediaStore.putBase64(dataUrl, ct, `gemini-${url.slice(-10).replace(/[^a-zA-Z0-9]/g, '')}.${ext}`);
    if (r.success && r.mediaUrl) return r.mediaUrl;
    return null;
  } catch (err) {
    console.warn('[gemini-extract] image download exception:', err);
    return null;
  }
}

/**
 * 单个 turn 的 AI 回复 → markdown(SVG/HTML 转可渲染 + 下载图 + groundings)。
 * 图用 wc.session.fetch(带登录态)下载入 mediaStore → ![](media://..),不走 image-proxy。
 */
export async function geminiTurnMarkdown(wc: WebContents, turn: GeminiTurn): Promise<{ markdown: string; artifactCount: number }> {
  let md = unwrapBlockquotedCode(turn.markdown);
  let artifactCount = 0;

  // SVG / HTML 代码块 → note 可渲染形态
  const converted = await convertFenceArtifacts(md);
  md = converted.markdown;
  artifactCount += converted.count;

  // 清掉 Gemini 生成图的假占位 URL(image_generation_content/N — 真实 lh3 URL 在
  // turn.imageUrls,由下方追加)。占位符可能裸 URL 或 ![](...) 包裹,一并删。
  md = md.replace(/!?\[[^\]]*\]\(https?:\/\/[^)]*image_generation_content\/\d+[^)]*\)/g, '');
  md = md.replace(/https?:\/\/[^\s)]*image_generation_content\/\d+/g, '');
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  if (turn.imageUrls.length > 0) {
    const imgMds: string[] = [];
    for (const u of turn.imageUrls) {
      const mediaUrl = await downloadGeminiImage(wc, u);
      imgMds.push(`![](${mediaUrl ?? u})`); // 下载失败保留原 URL 兜底
      artifactCount++;
    }
    md = md.trimEnd() + '\n\n' + imgMds.join('\n\n');
  }

  if (turn.groundings.length > 0) {
    const lines = ['', '---', '', '## 参考来源', ''];
    turn.groundings.forEach((g, i) => lines.push(`${i + 1}. [${g.title}](${g.url})`));
    md = md + '\n' + lines.join('\n');
    artifactCount += turn.groundings.length;
  }
  return { markdown: md, artifactCount };
}

/**
 * 整页提取入口。主动拉取完整对话历史 → 拼 ## 用户 / ## AI 分隔的 markdown。
 */
export async function extractGeminiFullConversation(
  wc: WebContents,
): Promise<GeminiFullExtractionResult> {
  const conv = await fetchGeminiConversation(wc);
  if (!conv || conv.turns.length === 0) {
    return {
      success: false,
      error: 'Gemini 对话拉取失败或为空:请确认在 gemini.google.com/app/{id} 对话页且已登录,然后重试',
    };
  }

  const title = (await readGeminiTitle(wc)) || 'Gemini 对话';

  const turnBlocks: string[] = [];
  let artifactCount = 0;
  for (const turn of conv.turns) {
    if (turn.userMessage.trim()) {
      turnBlocks.push(`## 👤 用户\n\n${turn.userMessage.trim()}`);
    }
    const built = await geminiTurnMarkdown(wc, turn);
    artifactCount += built.artifactCount;
    turnBlocks.push(`## 🤖 AI (Gemini)\n\n${built.markdown}`);
  }

  const header = `# ${title}\n\n> Gemini 对话 · 共 ${conv.turns.length} 轮`;
  const markdown = `${header}\n\n${turnBlocks.join('\n\n---\n\n')}`;

  return {
    success: true,
    markdown,
    title,
    turnCount: conv.turns.length,
    artifactCount,
  };
}
