/**
 * 「X Article 兼容 doc」→ X 支持的干净 HTML(X Articles 发布,2026-06-12 总指挥拍板)。
 *
 * 缘起 + 路径(实测见 docs/tasks/2026-06-12-x-articles-prompt.md §★★):X Article 编辑器
 * **认网页富文本粘贴、不认 markdown**。发布 = 把 doc 序列化成 X 支持标签的 HTML → 写剪贴板
 * (text/html)→ 在 X Article 正文合成 paste,X 自己把 HTML 富文本转成它的内部格式。
 *
 * 本模块输入是**已转换过的 Article doc**(经 doc-to-article-doc:只含 X 支持块 + image + table,
 * 文本降级已完成)。这里只负责「干净 HTML 字符串」—— 不再做格式映射(那是上一层职责)。
 *
 * 为什么不直接复用 note 的 DOMSerializer.fromSchema(note toDOM):
 *  - note 的 toDOM 带大量 app 私有 attrs / class(data-id / krig-* / contenteditable 标记 /
 *    NodeView 包裹),X 粘贴时这些是噪音甚至触发 X 的清洗逻辑不可控。
 *  - 这里手写一套**最小、干净、语义化**的标签映射,只产出 X 能稳定吃下的 HTML:
 *    h1-h3 / p / strong·em·s·a / ul·ol·li / blockquote / img / table。
 *
 * 标题层级(实测 #1):粘贴时 X 自己按 <h1>/<h2>/<h3> 映射到它的标题样式,note heading
 * level 4-6 这里夹到 h3(X 最低标题级,见矩阵 §5 默认值)。
 *
 * img:src 用 media://(总指挥拍板 §★★)。media:// 在 X 所在的我方 webview partition 已注册
 * (media-store-impl registerMediaForSession),guest 内能加载。**但 X 粘贴后是否保留/转存该图
 * 待实机验**(spike #7 只确认了文本富格式,图未验)—— 见交付说明实机验点。
 */

import type { Node as PMNode, Mark } from 'prosemirror-model';

/** X Article 支持的最深标题级(实测 #1 待精确;矩阵默认夹到 3)。 */
const X_MAX_HEADING_LEVEL = 3;

/** HTML 实体转义(文本节点 + 属性值)。 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 一段文字 + 它的 marks → 内联 HTML(嵌套包裹)。 */
function inlineTextToHtml(text: string, marks: readonly Mark[]): string {
  let html = esc(text);
  // 由内到外包裹;link 放最外(语义上 <a><strong>..</strong></a> 与反之等价,X 都识别)。
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'link': {
        const href = esc((mark.attrs?.href as string) || '');
        html = `<a href="${href}">${html}</a>`;
        break;
      }
      // 其他 mark(underline/highlight/textStyle/thought/code)上一层已降级丢掉,这里不会遇到。
    }
  }
  return html;
}

/** textblock(paragraph/heading)的 inline 内容 → HTML。 */
function inlineContentToHtml(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) {
      out += inlineTextToHtml(child.text || '', child.marks);
      return;
    }
    if (child.type.name === 'hardBreak') {
      out += '<br>';
      return;
    }
    // 兜底:其余 inline 取 textContent 转义(转换层应已清掉行内 atom)
    out += esc(child.textContent);
  });
  return out;
}

function blockToHtml(node: PMNode): string {
  const name = node.type.name;
  switch (name) {
    case 'paragraph': {
      const inner = inlineContentToHtml(node);
      // 空段落 → <p><br></p> 让 X 保留空行
      return inner ? `<p>${inner}</p>` : '<p><br></p>';
    }
    case 'heading': {
      const lvl = Math.min((node.attrs?.level as number) || 1, X_MAX_HEADING_LEVEL);
      return `<h${lvl}>${inlineContentToHtml(node)}</h${lvl}>`;
    }
    case 'blockquote':
      return `<blockquote>${childrenToHtml(node)}</blockquote>`;
    case 'bulletList':
      return `<ul>${childrenToHtml(node)}</ul>`;
    case 'orderedList': {
      const start = (node.attrs?.start as number) || 1;
      const startAttr = start !== 1 ? ` start="${start}"` : '';
      return `<ol${startAttr}>${childrenToHtml(node)}</ol>`;
    }
    case 'listItem':
      return `<li>${childrenToHtml(node)}</li>`;
    case 'image': {
      // ⚠️ 终态(2026-06-13):note-to-article-plan 已把 image 切成独立 media step 喂文件
      //    (总指挥实测 <img src=media://> 粘不进 X)→ 终态路径下不会走到这里。
      //    保留此 case 仅作通用序列化器的防御(若 article doc 直接含 image)。
      const src = esc((node.attrs?.src as string) || '');
      const alt = esc((node.attrs?.alt as string) || '');
      return `<img src="${src}" alt="${alt}">`;
    }
    case 'table':
      return tableToHtml(node);
    default: {
      // 转换层应已把所有非 X 块降级;到这里仍遇到 → 取 textContent 兜底成段落(fail soft)。
      const tc = node.textContent;
      return tc ? `<p>${esc(tc)}</p>` : '';
    }
  }
}

/**
 * table → HTML <table>。注:发布管线里 table 会被 capturePage 截成图替换(§2.3),
 * 此 HTML 路是降级/调试用(若截图失败仍有可读表格)。
 */
function tableToHtml(node: PMNode): string {
  let rows = '';
  node.forEach((row) => {
    let cells = '';
    row.forEach((cell) => {
      const tag = cell.type.name === 'tableHeader' ? 'th' : 'td';
      cells += `<${tag}>${childrenToHtml(cell)}</${tag}>`;
    });
    rows += `<tr>${cells}</tr>`;
  });
  return `<table>${rows}</table>`;
}

function childrenToHtml(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) {
      out += inlineTextToHtml(child.text || '', child.marks);
    } else if (child.isInline) {
      out += child.type.name === 'hardBreak' ? '<br>' : esc(child.textContent);
    } else {
      out += blockToHtml(child);
    }
  });
  return out;
}

/**
 * Article doc(PMNode)→ X 支持的 HTML 字符串。
 * 顶层逐块拼接;包一层 <div> 方便剪贴板/调试,X 粘贴时会拆掉外层容器。
 */
export function articleDocToHtml(doc: PMNode): string {
  let body = '';
  doc.forEach((child) => {
    body += blockToHtml(child);
  });
  return body;
}
