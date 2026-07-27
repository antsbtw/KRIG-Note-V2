/**
 * ① AI 提取的**预处理层**（阶段 B4b 收官）。
 *
 * B4b 让 ① 成为唯一解析核 markdownCore 的「薄 caller」：废掉 ExtractedBlock 中间态，
 * 块解析全交 markdownCore。但 ① 有一批 **AI-提取专属**、markdownCore/② 都没有的处理 ——
 * 这些不属于通用 markdown 语法，留在本预处理层：
 *
 *  A. **字符串预处理**（喂 markdownCore 前）：
 *     - 整段被 ```markdown 包裹 → 剥外层 fence
 *     - ChatGPT genui widget 清洗 → $$…$$
 *     - LaTeX 定界符归一 `\[..\]`→`$$`、`\(..\)`→`$`
 *     - ①方言 `<<IMAGE:pageN|caption|desc>>` → 标准 `![caption | desc](image:pageN)`
 *  B. **JSON 块路径**：AI 偶尔输出 JSON 数组 → 直接产 PMNode[]（绕过 markdown 解析）。
 *  C. **后处理**（markdownCore 产出 PMNode[] 后）：
 *     - `<center>…</center>` 段并入前一张 image 的 caption（title）
 *     - markdown 包裹块展开：language=markdown/md 的 codeBlock，其 text 本身是 markdown
 *       （常含内层 ```mermaid），再过 markdownCore 展开成真块
 *
 * 纯 sync、无副作用。① 无媒体本地化（图进来已是 URL/占位/base64，src 原样即可）。
 */

import { markdownCore, buildHeadingNode, buildParagraphNode, type PMNode } from '@shared/markdown-core';

/**
 * AI markdown → PMNode[]（① 唯一入口）：A 预处理 → markdownCore → C 后处理。
 * JSON 数组走 B 路径直接产 PMNode[]。
 */
export function aiMarkdownToPmNodes(text: string): PMNode[] {
  if (!text || !text.trim()) return [];

  let trimmed = text.trim();

  // A1：整段被 ```markdown / ```md / ```text 包裹 → 剥外层 fence
  const codeBlockWrapMatch = trimmed.match(/^`{3,}\s*(markdown|md|text|)\s*\n([\s\S]*?)\n`{3,}\s*$/);
  if (codeBlockWrapMatch) {
    trimmed = codeBlockWrapMatch[2].trim();
  }

  // B：JSON 数组路径（部分 AI 输出结构化 JSON）→ 直接产 PMNode[]
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return jsonBlocksToPmNodes(parsed);
      }
    } catch {
      // 非 JSON，落 markdown
    }
  }

  // A2：ChatGPT genui widget 清洗
  trimmed = cleanChatGPTWidgets(trimmed);
  // A3：LaTeX 定界符归一
  trimmed = normalizeLatexDelimiters(trimmed);
  // A4：①方言 <<IMAGE:pageN|caption|desc>> → 标准图片语法（让 markdownCore 的 image 分支接住）
  trimmed = rewriteImagePlaceholders(trimmed);

  // 核解析
  const nodes = markdownCore(trimmed);

  // C：后处理
  return unwrapMarkdownWrapperNodes(mergeCenterCaptions(nodes));
}

// ─── A2：ChatGPT genui widget 清洗 ──────────────────────────────────
function cleanChatGPTWidgets(text: string): string {
  text = text.replace(
    /▁?genui▁?\{.*?"content"\s*:\s*"([^"]+)".*?\}\}?▁?/g,
    (_m, content) => `\n$$\n${content}\n$$\n`,
  );
  text = text.replace(/▁?genui▁?\{.*?\}\}?▁?/g, '');
  return text;
}

// ─── A3：LaTeX 定界符归一 ───────────────────────────────────────────
function normalizeLatexDelimiters(text: string): string {
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, content) => `$$\n${content.trim()}\n$$`);
  text = text.replace(/\\\(([^)]*?)\\\)/g, (_m, content) => `$${content}$`);
  return text;
}

// ─── A4：<<IMAGE:pageN|caption|desc>> → ![caption | desc](image:pageN) ─
function rewriteImagePlaceholders(text: string): string {
  // 与 ① result-parser 的 <<IMAGE>> 正则一致（desc 可含 `>`，用 .*? 到 `>>` 止）。
  // alt = caption ? `caption | desc` : desc（对齐 buildImageBlock 的 alt 组装 + splitImageAlt 复原）。
  return text.replace(
    /^<<IMAGE:(page\d+(?:-\d+)?)\|([^|]*)\|(.*?)>>\s*$/gm,
    (_m, pageRef, caption, desc) => {
      const cap = String(caption).trim();
      const d = String(desc).trim();
      const alt = cap ? `${cap} | ${d}` : d;
      return `![${alt}](image:${pageRef})`;
    },
  );
}

// ─── B：JSON 数组 → PMNode[] ────────────────────────────────────────
/**
 * AI 输出的 JSON 块数组 → PMNode[]。历史 parseJsonBlocks 只产 heading/paragraph（带 text）；
 * 保持等价：heading 用 buildHeadingNode，其余把 text 走 markdownCore（承接任意行内/块）。
 */
function jsonBlocksToPmNodes(arr: unknown[]): PMNode[] {
  const out: PMNode[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = (item.type as string) || 'paragraph';
    const text = (item.text as string) || '';
    if (type === 'heading') {
      const level = (item.headingLevel as number) || 1;
      out.push(buildHeadingNode(Math.min(Math.max(level, 1), 6), text));
    } else if (text) {
      // 非 heading：text 过核（承接 markdown 行内/块），空 text 则空段落占位
      const nodes = markdownCore(text);
      if (nodes.length > 0) out.push(...nodes);
      else out.push(buildParagraphNode(text));
    } else {
      out.push({ type: 'paragraph' });
    }
  }
  return out;
}

// ─── C1：<center>…</center> 段并入前一张 image 的 caption ─────────────
/**
 * markdownCore 把 `<center>text</center>` 落成 paragraph（core 不识别 center）。① 语义：
 * 紧跟 image 的 center 文本是该图 caption → 并入前一 image 节点 title；否则保留为纯文本段。
 */
function mergeCenterCaptions(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    const centerText = paragraphCenterText(node);
    if (centerText !== null) {
      const prev = out[out.length - 1];
      if (prev && prev.type === 'image') {
        prev.attrs = { ...prev.attrs, title: centerText };
        continue;
      }
      // 无前置 image → 保留为纯文本段（剥 <center> 标签）
      if (centerText) out.push(buildParagraphNode(centerText));
      continue;
    }
    out.push(node);
  }
  return out;
}

/** 若节点是单一 `<center>…</center>` 文本段，返回其内文（去标签）；否则 null。 */
function paragraphCenterText(node: PMNode): string | null {
  if (node.type !== 'paragraph' || !node.content) return null;
  const text = node.content.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('');
  const m = text.trim().match(/^<center>(.*?)<\/center>$/i);
  return m ? m[1].trim() : null;
}

// ─── C2：language=markdown 的 codeBlock 展开 ─────────────────────────
/**
 * ChatGPT 常把一段回复渲染成一个 language=markdown 的代码块，里面才是真 markdown
 * （含内层 ```mermaid 等）。把这类 codeBlock 的 text 再过 markdownCore 展开成真块。
 * 仅对 markdown/md 生效（不误伤 python/js）；内层产物语言不会是 markdown，无限递归风险为零。
 */
function unwrapMarkdownWrapperNodes(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    const lang = (node.attrs?.language as string | undefined)?.toLowerCase();
    const codeText = node.type === 'codeBlock' ? node.content?.[0]?.text ?? '' : '';
    if (node.type === 'codeBlock' && (lang === 'markdown' || lang === 'md') && codeText.trim()) {
      out.push(...markdownCore(codeText.trim()));
    } else {
      out.push(node);
    }
  }
  return out;
}
