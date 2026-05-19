/**
 * Claude artifact → markdown / 单 turn / 整页提取
 *
 * V1 plugins/browser-capability/artifact/extract-turn.ts 移植。
 *
 * 关键变化(V1 → V2):
 * - V1 依赖 trace-writer 缓存:V2 直接接 ConversationData(由 fetchClaudeConversationRaw
 *   + getConversationData 解出)
 * - V1 mediaSurrealStore.putBase64:V2 mediaStore.putBase64(API 等价)
 * - V1 ArtifactRecord matched.storageRef(downloaded type)分支删除(那需要 trace-writer
 *   download capture;V2 没接,主路径 widget_code/file_text/local_resource 覆盖 SVG/HTML/code)
 * - downloadLocalResource(bash_tool sandbox 文件 wiggle/download-file API)1:1 移植
 *
 * 输出格式(对齐 V1):
 * - SVG → 保存到 mediaStore → 返 `![title](media://...)` markdown
 * - HTML widget → 保存到 mediaStore → 返 `!html[title](media://...)` markdown
 *   (Note 端 link-click 暂不处理 !html — 现网降级 code fence;后续 sub-phase 加 !html
 *    渲染)。本期 HTML 走 fallback ```html fence,SVG 是当前主诉求。
 * - file_text(代码) → ```lang fence
 * - local_resource → 下载到 sandbox 后按 ext 走 SVG/HTML/code 路径
 */

import { mediaStore } from '../../media/media-store-impl';
import type {
  ConversationData,
  ConversationMessage,
  MessageArtifact,
} from './claude-conversation-query';

// ── Public types ──

export type ExtractedTurn = {
  index: number;
  userMessage: string;
  markdown: string;
  timestamp?: string;
  artifactCount: number;
};

export type ExtractedConversation = {
  title: string;
  model?: string;
  turns: ExtractedTurn[];
};

// ── SVG preprocessing (V1 字面搬:让 widget_code 自包含,Note 端 innerHTML 直渲染) ──

/**
 * Claude SVG 暗色主题样式表(V1 字面搬)。
 *
 * 颜色值从 Claude 页面下载的 SVG 的 computed inline styles 中提取。
 * 选择器覆盖所有 SVG 图形元素类型(rect/ellipse/circle/path/polygon)。
 *
 * Note 是浅色背景,但这些样式提供 c-gray/c-amber/c-coral/... 等彩色 class,
 * SVG 元素带 class 后能正确显示原色;不带 class 的元素继承 fill="currentColor" 等
 * 走 SVG 默认黑色。
 */
const CLAUDE_SVG_STYLESHEET = `
  /* 基础字体 */
  text { font-family: "Anthropic Sans", -apple-system, system-ui, sans-serif; fill: rgb(194,192,182); }
  .ts { font-size: 12px; fill: rgb(194,192,182); }
  .th { font-size: 14px; fill: rgb(211,209,199); font-weight: 500; }

  /* 图形元素通用 */
  .node rect, .node ellipse, .node circle, .node path, .node polygon { stroke-width: 0.5; }

  /* c-gray */
  .c-gray > rect, .c-gray > ellipse, .c-gray > circle, .c-gray > path, .c-gray > polygon { fill: rgb(68,68,65); stroke: rgb(180,178,169); }
  .c-gray > text, .c-gray > text.th { fill: rgb(211,209,199); }
  .c-gray > text.ts, .c-gray text.ts { fill: rgb(180,178,169); }

  /* c-amber */
  .c-amber > rect, .c-amber > ellipse, .c-amber > circle, .c-amber > path, .c-amber > polygon { fill: rgb(99,56,6); stroke: rgb(239,159,39); }
  .c-amber > text.th, .c-amber text.th { fill: rgb(250,199,117); }
  .c-amber > text.ts, .c-amber text.ts { fill: rgb(239,159,39); }

  /* c-coral */
  .c-coral > rect, .c-coral > ellipse, .c-coral > circle, .c-coral > path, .c-coral > polygon { fill: rgb(113,43,19); stroke: rgb(240,153,123); }
  .c-coral > text.th, .c-coral text.th { fill: rgb(245,196,179); }
  .c-coral > text.ts, .c-coral text.ts { fill: rgb(240,153,123); }

  /* c-teal */
  .c-teal > rect, .c-teal > ellipse, .c-teal > circle, .c-teal > path, .c-teal > polygon { fill: rgb(8,80,65); stroke: rgb(93,202,165); }
  .c-teal > text.th, .c-teal text.th { fill: rgb(159,225,203); }
  .c-teal > text.ts, .c-teal text.ts { fill: rgb(93,202,165); }

  /* c-purple */
  .c-purple > rect, .c-purple > ellipse, .c-purple > circle, .c-purple > path, .c-purple > polygon { fill: rgb(60,52,137); stroke: rgb(175,169,236); }
  .c-purple > text.th, .c-purple text.th { fill: rgb(206,203,246); }
  .c-purple > text.ts, .c-purple text.ts { fill: rgb(175,169,236); }

  /* c-blue */
  .c-blue > rect, .c-blue > ellipse, .c-blue > circle, .c-blue > path, .c-blue > polygon { fill: rgb(20,60,120); stroke: rgb(100,160,240); }
  .c-blue > text.th, .c-blue text.th { fill: rgb(180,210,250); }
  .c-blue > text.ts, .c-blue text.ts { fill: rgb(100,160,240); }

  /* c-green */
  .c-green > rect, .c-green > ellipse, .c-green > circle, .c-green > path, .c-green > polygon { fill: rgb(15,70,40); stroke: rgb(80,200,120); }
  .c-green > text.th, .c-green text.th { fill: rgb(160,230,180); }
  .c-green > text.ts, .c-green text.ts { fill: rgb(80,200,120); }

  /* c-red */
  .c-red > rect, .c-red > ellipse, .c-red > circle, .c-red > path, .c-red > polygon { fill: rgb(100,30,30); stroke: rgb(230,80,80); }
  .c-red > text.th, .c-red text.th { fill: rgb(245,170,170); }
  .c-red > text.ts, .c-red text.ts { fill: rgb(230,80,80); }

  /* c-indigo */
  .c-indigo > rect, .c-indigo > ellipse, .c-indigo > circle, .c-indigo > path, .c-indigo > polygon { fill: rgb(45,40,120); stroke: rgb(130,120,220); }
  .c-indigo > text.th, .c-indigo text.th { fill: rgb(190,185,240); }
  .c-indigo > text.ts, .c-indigo text.ts { fill: rgb(130,120,220); }
`;

const CLAUDE_CSS_VARS: Record<string, string> = {
  'var(--color-border-tertiary)': 'rgba(222,220,209,0.15)',
  'var(--color-border-secondary)': 'rgba(222,220,209,0.3)',
  'var(--color-border-primary)': 'rgba(222,220,209,0.5)',
  'var(--color-text-primary)': 'rgb(250,249,245)',
  'var(--color-text-secondary)': 'rgb(194,192,182)',
  'var(--color-text-tertiary)': 'rgb(148,146,137)',
  'var(--color-bg-primary)': 'rgb(43,43,40)',
  'var(--color-bg-secondary)': 'rgb(55,55,52)',
  'var(--color-bg-tertiary)': 'rgb(68,68,65)',
  'var(--color-background-primary)': 'rgb(43,43,40)',
  'var(--color-background-secondary)': 'rgb(55,55,52)',
  'var(--color-background-tertiary)': 'rgb(68,68,65)',
  'var(--text-color-primary)': 'rgb(250,249,245)',
  'var(--text-color-secondary)': 'rgb(194,192,182)',
  'var(--text-color-tertiary)': 'rgb(148,146,137)',
  'var(--bg-color)': 'rgb(43,43,40)',
  'var(--fg-color)': 'rgb(250,249,245)',
};

/**
 * 让 widget_code SVG 源码自包含,可在 Note 暗 / 浅色背景独立渲染:
 *   1. xmlns 补齐
 *   2. 删 onclick/onmouseover 等事件 attr(原因:Claude 页面 SVG 有这些 attr;
 *      Note 端 innerHTML 注入后这些事件不应触发 + 防 XSS)
 *   3. CSS 变量替换成具体色值
 *   4. 注入 <style> 块(若 SVG 无自带 style)
 */
function prepareSvgForDom(raw: string): string {
  let svg = raw;

  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // 删事件 attr(V1 字面搬两步;先 single-line 粗替换,再 per-line 精细兜底)
  svg = svg.replace(/ on\w+=(?:"[^>]*>|'[^>]*>)/g, '>');
  svg = svg.split('\n').map((line) => {
    if (/ on\w+=/.test(line)) {
      return line.replace(/ on\w+=.*?(?=>)/, '');
    }
    return line;
  }).join('\n');

  // CSS 变量 → 具体色值
  for (const [cssVar, value] of Object.entries(CLAUDE_CSS_VARS)) {
    while (svg.includes(cssVar)) {
      svg = svg.replace(cssVar, value);
    }
  }

  // 注入 <style>(若 SVG 无自带)
  if (!svg.includes('<style')) {
    const svgOpenEnd = svg.indexOf('>', svg.indexOf('<svg'));
    if (svgOpenEnd > 0) {
      svg = svg.slice(0, svgOpenEnd + 1) + `\n<style>${CLAUDE_SVG_STYLESHEET}</style>\n` + svg.slice(svgOpenEnd + 1);
    }
  }

  return svg;
}

// ── Artifact → markdown ──

async function artifactToMarkdown(artifact: MessageArtifact): Promise<string> {
  const content = artifact.content;
  if (!content) {
    console.warn('[extract-turn] artifact has no content', { title: artifact.title });
    return `> **${artifact.title}** — artifact 内容不可用\n`;
  }

  if (content.type === 'widget_code') {
    // SVG:转 data URL → mediaStore → media:// URL(Note 端 image NodeView 见到
    // media://*.svg 自动走 innerHTML 真渲染)
    if (content.mimeType === 'image/svg+xml') {
      try {
        const svgCode = prepareSvgForDom(content.code);
        const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
        const result = await mediaStore.putBase64(dataUrl, 'image/svg+xml', `${artifact.title}.svg`);
        if (result.success && result.mediaUrl) {
          return `![${artifact.title}](${result.mediaUrl})\n`;
        }
      } catch (err) {
        console.warn('[extract-turn] mediaStore put SVG failed', { title: artifact.title, error: err });
      }
      // Fallback:inline data URL(Note 端 image NodeView 也支持 data:image/svg+xml;base64)
      const encoded = Buffer.from(content.code, 'utf-8').toString('base64');
      return `![${artifact.title}](data:image/svg+xml;base64,${encoded})\n`;
    }
    // HTML widget(本期 V2 没接 htmlBlock 媒体链路,降级 code fence;后续 sub-phase 补)
    return '```html\n' + content.code.trimEnd() + '\n```\n';
  }

  if (content.type === 'file_text') {
    const ext = content.path.split('.').pop()?.toLowerCase() ?? '';

    // SVG file_text → 同 widget_code 路径
    if (ext === 'svg') {
      try {
        const svgCode = prepareSvgForDom(content.text);
        const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
        const filename = content.path.split('/').pop() || `${artifact.title}.svg`;
        const result = await mediaStore.putBase64(dataUrl, 'image/svg+xml', filename);
        if (result.success && result.mediaUrl) {
          return `![${artifact.title}](${result.mediaUrl})\n`;
        }
      } catch (err) {
        console.warn('[extract-turn] svg file_text put failed', { title: artifact.title, error: err });
      }
    }

    // 其他文本文件:code fence(md/txt 直接出 paragraph)
    const lang = ext === 'md' ? 'markdown'
      : ext === 'py' ? 'python'
      : ext === 'ts' ? 'typescript'
      : ext === 'js' ? 'javascript'
      : ext || 'text';
    if (ext === 'md' || ext === 'txt') {
      return content.text.trimEnd() + '\n';
    }
    return '```' + lang + '\n' + content.text.trimEnd() + '\n```\n';
  }

  if (content.type === 'local_resource') {
    // bash_tool sandbox 文件:通过 Claude wiggle/download-file API 抓内容,再走对应分支
    try {
      const fileContent = await downloadLocalResource(content.filePath);
      if (fileContent) {
        const filename = content.filePath.split('/').pop() || artifact.title;
        const isSvg = content.mimeType === 'image/svg+xml' || filename.match(/\.svg$/i);

        if (isSvg) {
          const svgCode = prepareSvgForDom(fileContent);
          const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
          const result = await mediaStore.putBase64(
            dataUrl,
            'image/svg+xml',
            filename.endsWith('.svg') ? filename : `${filename}.svg`,
          );
          if (result.success && result.mediaUrl) {
            return `![${artifact.title}](${result.mediaUrl})\n`;
          }
        }

        // 其他文件:code fence
        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const lang = ext === 'py' ? 'python'
          : ext === 'js' ? 'javascript'
          : ext === 'ts' ? 'typescript'
          : ext || 'text';
        return '```' + lang + '\n' + fileContent.trimEnd() + '\n```\n';
      }
    } catch (err) {
      console.warn('[extract-turn] local_resource download failed', { title: artifact.title, filePath: content.filePath, error: err });
    }
    return `> 📎 **${artifact.title}** — sandbox 文件(${content.filePath.split('/').pop()})\n`;
  }

  // 兜底(理论不可达 — TS 控制 ArtifactContent union 已穷举)
  const _exhaust: never = content;
  return _exhaust;
}

/**
 * 通过 Claude wiggle/download-file API 抓 sandbox 文件内容(V1 字面搬)。
 *
 * 找当前所有 webContents 中 URL 含 claude.ai/chat/ 的那个,在它里面 fetch
 * /api/.../conversations/{convId}/wiggle/download-file?path=... 拿源码。
 * 需要 user 登录 cookies(走 webContents.executeJavaScript 自动带)。
 */
async function downloadLocalResource(filePath: string): Promise<string | null> {
  try {
    const { webContents: electronWebContents } = await import('electron');
    for (const wc of electronWebContents.getAllWebContents()) {
      const url = wc.getURL();
      if (!url.includes('claude.ai/chat/')) continue;
      const downloadScript = `
        (async () => {
          try {
            var orgId = window.__krig_claude_orgId || null;
            if (!orgId) {
              var entries = performance.getEntriesByType('resource');
              for (var i = 0; i < entries.length; i++) {
                var m = entries[i].name.match(/claude\\.ai\\/api\\/organizations\\/([0-9a-f-]{36})/);
                if (m) { orgId = m[1]; break; }
              }
              if (!orgId) {
                var cm = document.cookie.match(/lastActiveOrg=([0-9a-f-]{36})/);
                if (cm) orgId = cm[1];
              }
              if (orgId) window.__krig_claude_orgId = orgId;
            }
            if (!orgId) return null;

            var convMatch = window.location.href.match(/\\/chat\\/([^/?#]+)/);
            if (!convMatch) return null;
            var convId = convMatch[1];

            var apiUrl = '/api/organizations/' + orgId + '/conversations/' + convId
              + '/wiggle/download-file?path=' + encodeURIComponent(${JSON.stringify(filePath)});
            var resp = await fetch(apiUrl, { credentials: 'include' });
            if (!resp.ok) return null;
            var text = await resp.text();
            return text;
          } catch (e) {
            return null;
          }
        })()
      `;

      const result = await wc.executeJavaScript(downloadScript);
      if (result && typeof result === 'string' && result.length > 0) {
        return result;
      }
    }
    return null;
  } catch (err) {
    console.warn('[extract-turn] downloadLocalResource failed', { filePath, error: err });
    return null;
  }
}

/**
 * 单条 message → markdown(用 contentParts 保持原始 text/artifact 交错顺序)
 */
async function messageToMarkdown(msg: ConversationMessage): Promise<string> {
  if (msg.contentParts.length > 0) {
    const parts: string[] = [];
    for (const part of msg.contentParts) {
      if (part.type === 'text') {
        const trimmed = part.text.trim();
        if (trimmed) parts.push(trimmed);
      } else if (part.type === 'artifact') {
        const md = await artifactToMarkdown(part.artifact);
        if (md.trim()) parts.push(md.trim());
      }
    }
    return parts.join('\n\n');
  }
  // Fallback:无 contentParts(罕见)走 textContent + artifacts 串联
  const parts: string[] = [];
  if (msg.textContent.trim()) parts.push(msg.textContent.trim());
  for (const artifact of msg.artifacts) {
    parts.push(await artifactToMarkdown(artifact));
  }
  return parts.join('\n\n');
}

// ── Public API ──

/**
 * 提取完整对话 — 每个 assistant message 一条 turn(对齐 V1 输出契约)
 */
export async function extractFullConversationFromData(
  conversation: ConversationData,
): Promise<ExtractedConversation | null> {
  if (conversation.messages.length === 0) return null;

  const turns: ExtractedTurn[] = [];

  for (let i = 0; i < conversation.messages.length; i++) {
    const msg = conversation.messages[i];
    if (msg.sender !== 'assistant') continue;

    // 找前一个 human message
    const humanMsgs = conversation.messages.filter(
      (m) => m.sender === 'human' && m.index < msg.index,
    );
    const humanMsg = humanMsgs.length > 0 ? humanMsgs[humanMsgs.length - 1] : null;

    const markdown = await messageToMarkdown(msg);
    turns.push({
      index: msg.index,
      userMessage: humanMsg?.textContent.trim() ?? '',
      markdown,
      timestamp: msg.createdAt,
      artifactCount: msg.artifacts.length,
    });
  }

  return {
    title: conversation.name || '未命名对话',
    model: conversation.model,
    turns,
  };
}

/**
 * 把 ExtractedConversation 的 turns 数组拼成一段 markdown(兼容旧 ai-sync 流的
 * "markdown 文本" 消费方:thought atom doc fallback 路径)。
 *
 * 格式对齐之前 claude-full-extraction.ts 的 buildHeader + turnBlocks 拼接:
 *   # title
 *   > 模型: ...
 *   > 共 N 条消息
 *
 *   ## 👤 用户
 *   ... user 文本 ...
 *
 *   ---
 *
 *   ## 🤖 AI (model)
 *   ... AI markdown(含 artifact image / fence)...
 */
export function buildFullMarkdownFromExtracted(extracted: ExtractedConversation): string {
  const headerLines = [`# ${extracted.title}`];
  if (extracted.model) headerLines.push(`> 模型: \`${extracted.model}\``);
  headerLines.push(`> 共 ${extracted.turns.length * 2} 条消息`);
  const header = headerLines.join('\n\n');

  const turnBlocks: string[] = [];
  for (const t of extracted.turns) {
    if (t.userMessage.trim()) {
      turnBlocks.push(`## 👤 用户\n\n${t.userMessage}`);
    }
    turnBlocks.push(`## 🤖 AI (${extracted.model || 'Claude'})\n\n${t.markdown}`);
  }

  return `${header}\n\n${turnBlocks.join('\n\n---\n\n')}`;
}
