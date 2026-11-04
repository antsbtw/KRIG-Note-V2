/**
 * html-paste-normalize plugin — 外部富文本粘贴前的 html 规范化
 *
 * Word / 网页 / Notion 粘进来走 PM 默认:按各 block 的 parseDOM 解析 text/html。
 * 标题 / 粗斜体 / 链接 / 表格 / 分隔线这样直接就对;下面几样用真剪贴板样本
 * (tests/fixtures/paste/)查出来是坏的,在 transformPastedHTML 里改写 html 再交给 PM:
 *
 * - Word 列表:不是 <ul>/<ol>,而是带 `mso-list:lN levelM` 样式的 <p>,项目符号
 *   (「·」「1.」「☒」)是 `mso-list:Ignore` 的 span 里的字面文字 → 粘进来成了
 *   「·      价格低」这样的段落。改写成 ul / ol / task-list,level → data-indent
 *   (KRIG 列表缩进走 indent attr,不嵌套)
 * - Word 引用:段落样式 MsoQuote / MsoIntenseQuote / MsoBlockText → <blockquote>
 * - 网页任务列表:<li> 里开头一个 checkbox(GitHub / pandoc 等)→ KRIG task-list 的 DOM
 * - 方括号任务列表:<li>[x]  买好服务器</li>(Notion 的 html 就是这样,把 markdown 原样渲染)
 *   → task-list
 * - Notion 提示框:html 里是字面文字段落 `<aside>` + 图标 … `</aside>` → callout
 * - 代码块:<pre><code> 末尾多一个换行(Notion / markdown 渲染器都带)→ 去掉
 *   (Notion 的折叠块 html 里就是「两段文字的列表项」,与普通列表项分不出来,不改)
 * - 文字颜色:Chrome 复制会把页面正文颜色(如 rgb(26,26,26))内联到每个元素,
 *   textStyle mark 照单全收 → 暗色主题下字几乎看不见。灰阶颜色(黑/白/灰,即页面底色字)
 *   去掉;有色相的颜色(红字、蓝字)是作者有意标的,保留
 *
 * KRIG 内部复制(html 带 data-pm-slice)原样放行。
 */

import { Plugin } from 'prosemirror-state';

/** 列表缩进上限,与 list-item / task-item 的 indent attr 一致 */
const MAX_INDENT = 8;

type ListKind = 'bullet' | 'ordered' | 'task';

export interface NormalizeReport {
  source: 'word' | 'notion' | 'html';
  lists: number;
  quotes: number;
  taskLists: number;
  callouts: number;
  colorsRemoved: number;
}

export function isWordHtml(html: string): boolean {
  return /urn:schemas-microsoft-com:office:word|<meta[^>]+content=["']?Word\.Document/i.test(html);
}

/** 'mso-list:l0 level2 lfo1' → level 2;不是列表段落(或是 mso-list:Ignore)→ null */
function wordListLevel(p: Element): number | null {
  const m = /mso-list:\s*l\d+\s+level(\d+)/i.exec(p.getAttribute('style') ?? '');
  return m ? parseInt(m[1], 10) : null;
}

/** 从 Word 的项目符号文字判断列表种类;顺带给出有序列表的起始号 */
function classifyWordMarker(marker: string): { kind: ListKind; checked?: boolean; start?: number } {
  const t = marker.replace(/\s+/g, '');
  if (t === '☒' || t === '☑' || t === '■') return { kind: 'task', checked: true };
  if (t === '☐' || t === '□') return { kind: 'task', checked: false };
  const num = /^(\d+)[.)、]$/.exec(t);
  if (num) return { kind: 'ordered', start: parseInt(num[1], 10) };
  if (/^([a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]$/.test(t)) return { kind: 'ordered' };
  return { kind: 'bullet' };
}

function makeList(doc: Document, kind: ListKind, start?: number): HTMLElement {
  if (kind === 'ordered') {
    const ol = doc.createElement('ol');
    if (start && start !== 1) ol.setAttribute('start', String(start));
    return ol;
  }
  const ul = doc.createElement('ul');
  if (kind === 'task') ul.setAttribute('data-type', 'task-list');
  return ul;
}

function makeItem(doc: Document, kind: ListKind, indent: number, checked: boolean): HTMLElement {
  const li = doc.createElement('li');
  if (kind === 'task') {
    li.setAttribute('data-type', 'task-item');
    li.setAttribute('data-checked', String(checked));
  }
  if (indent > 0) li.setAttribute('data-indent', String(Math.min(MAX_INDENT, indent)));
  return li;
}

/** 同一组列表之间夹着的空 span(Word 的 mso-bookmark 尾巴)/ 空白,不算断开 */
function nextListSibling(el: Element): Element | null {
  let n = el.nextSibling;
  while (n) {
    if (n.nodeType === 1) {
      const e = n as Element;
      if (wordListLevel(e) !== null) return e;
      if (e.tagName === 'SPAN' && !e.textContent?.trim()) {
        n = n.nextSibling;
        continue;
      }
      return null;
    }
    if (n.nodeType === 3 && n.textContent?.trim()) return null;
    n = n.nextSibling;
  }
  return null;
}

function normalizeWordLists(doc: Document): number {
  let groups = 0;
  const firsts = Array.from(doc.body.querySelectorAll('p')).filter((p) => wordListLevel(p) !== null);
  const done = new Set<Element>();
  for (const first of firsts) {
    if (done.has(first)) continue;
    // 收一组连续的列表段落
    const run: Element[] = [];
    for (let p: Element | null = first; p; p = nextListSibling(p)) run.push(p);

    let list: HTMLElement | null = null;
    let listKind: ListKind | null = null;
    const anchor = doc.createComment('krig-word-list');
    first.before(anchor);
    const lists: HTMLElement[] = [];
    for (const p of run) {
      done.add(p);
      const markerEl = p.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
      const info = classifyWordMarker(markerEl?.textContent ?? '');
      // 项目符号所在的 span 整个去掉(里面还有一段 &nbsp; 占位)
      markerEl?.remove();
      if (!list || listKind !== info.kind) {
        list = makeList(doc, info.kind, info.start);
        listKind = info.kind;
        lists.push(list);
      }
      const li = makeItem(doc, info.kind, (wordListLevel(p) ?? 1) - 1, info.checked ?? false);
      const para = doc.createElement('p');
      while (p.firstChild) para.appendChild(p.firstChild);
      li.appendChild(para);
      list.appendChild(li);
      p.remove();
    }
    anchor.replaceWith(...lists);
    groups += lists.length;
  }
  return groups;
}

const WORD_QUOTE_SELECTOR = 'p.MsoQuote, p.MsoIntenseQuote, p.MsoBlockText';

function normalizeWordQuotes(doc: Document): number {
  let quotes = 0;
  for (const p of Array.from(doc.body.querySelectorAll(WORD_QUOTE_SELECTOR))) {
    if (!p.isConnected) continue;
    const prev = p.previousElementSibling;
    if (prev?.tagName === 'BLOCKQUOTE' && prev.getAttribute('data-krig-word-quote') === '1') {
      prev.appendChild(p);
      continue;
    }
    const bq = doc.createElement('blockquote');
    bq.setAttribute('data-krig-word-quote', '1');
    p.replaceWith(bq);
    bq.appendChild(p);
    quotes++;
  }
  return quotes;
}

/** <li> 开头的 checkbox(直接子、或包在 label / p 里) */
function leadingCheckbox(li: Element): HTMLInputElement | null {
  return li.querySelector(
    ':scope > input[type="checkbox"], :scope > label > input[type="checkbox"], :scope > p > input[type="checkbox"]',
  );
}

function normalizeTaskLists(doc: Document): number {
  let lists = 0;
  for (const ul of Array.from(doc.body.querySelectorAll('ul'))) {
    if (ul.getAttribute('data-type') === 'task-list') continue;
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (items.length === 0 || !items.every((li) => leadingCheckbox(li))) continue;
    ul.setAttribute('data-type', 'task-list');
    for (const li of items) {
      const cb = leadingCheckbox(li)!;
      li.setAttribute('data-type', 'task-item');
      li.setAttribute('data-checked', String(cb.checked || cb.hasAttribute('checked')));
      cb.remove();
    }
    lists++;
  }
  return lists;
}

const BRACKET_TASK = /^\s*\[([ xX])\]\s+/;

/** <li>[x] 文字</li> 整组 → task-list(只有全部项都是方括号开头才算) */
function normalizeBracketTaskLists(doc: Document): number {
  let lists = 0;
  for (const ul of Array.from(doc.body.querySelectorAll('ul'))) {
    if (ul.getAttribute('data-type') === 'task-list') continue;
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (items.length === 0 || !items.every((li) => BRACKET_TASK.test(li.textContent ?? ''))) continue;
    ul.setAttribute('data-type', 'task-list');
    for (const li of items) {
      li.setAttribute('data-type', 'task-item');
      li.setAttribute('data-checked', String(/^\s*\[[xX]\]/.test(li.textContent ?? '')));
      // 方括号在第一个文字节点里(可能包在 <p> 里)
      const walker = doc.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.textContent?.trim()) continue;
        t.textContent = t.textContent.replace(BRACKET_TASK, '');
        break;
      }
    }
    lists++;
  }
  return lists;
}

/**
 * Notion 提示框:`<p>&lt;aside&gt;<br>💡</p> <p>正文…</p> <p>&lt;/aside&gt;</p>`
 * → `<div class="krig-callout" data-emoji="💡"><p>正文…</p></div>`
 */
function normalizeAsideCallouts(doc: Document): number {
  let callouts = 0;
  for (const open of Array.from(doc.body.querySelectorAll('p'))) {
    if (!open.isConnected) continue;
    const head = /^\s*<aside>\s*([\s\S]*?)\s*$/.exec(open.textContent ?? '');
    if (!head) continue;
    const body: Element[] = [];
    let close: Element | null = null;
    for (let e = open.nextElementSibling; e; e = e.nextElementSibling) {
      if (e.tagName === 'P' && e.textContent?.trim() === '</aside>') {
        close = e;
        break;
      }
      body.push(e);
    }
    if (!close) continue;
    const div = doc.createElement('div');
    div.className = 'krig-callout';
    if (head[1]) div.setAttribute('data-emoji', head[1]);
    if (body.length === 0) body.push(doc.createElement('p'));
    open.replaceWith(div);
    div.append(...body);
    close.remove();
    callouts++;
  }
  return callouts;
}

/** <pre><code>…\n</code></pre> 末尾的换行不是代码内容 */
function trimCodeTrailingNewline(doc: Document): void {
  for (const pre of Array.from(doc.body.querySelectorAll('pre'))) {
    const last = pre.lastChild?.nodeType === 1 ? pre.lastChild.lastChild : pre.lastChild;
    if (last?.nodeType === 3 && last.textContent?.endsWith('\n')) {
      last.textContent = last.textContent.replace(/\r?\n$/, '');
    }
  }
}

/** 颜色是不是灰阶(黑 / 白 / 灰)—— 页面正文底色字,不是作者有意标的颜色 */
export function isGrayscaleColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (['black', 'white', 'gray', 'grey', 'silver', 'windowtext', 'inherit', 'initial', 'currentcolor', 'canvastext'].includes(v)) {
    return true;
  }
  let rgb: number[] | null = null;
  const fn = /^rgba?\(([^)]+)\)$/.exec(v);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      if (parts.length >= 4 && parts[3] === 0) return true; // 全透明
      rgb = parts.slice(0, 3);
    }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  if (!rgb) return false; // 认不出的颜色名(red / teal …)当有色保留
  return Math.max(...rgb) - Math.min(...rgb) < 24;
}

function stripGrayscaleColors(doc: Document): number {
  let removed = 0;
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>('[style]'))) {
    const color = el.style.getPropertyValue('color');
    if (color && isGrayscaleColor(color)) {
      el.style.removeProperty('color');
      removed++;
    }
  }
  return removed;
}

/** 纯函数:改写外部 html;KRIG 内部复制返回 null(不动) */
export function normalizePastedHtml(html: string): { html: string; report: NormalizeReport } | null {
  if (html.includes('data-pm-slice')) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const word = isWordHtml(html);
  trimCodeTrailingNewline(doc);
  const report: NormalizeReport = {
    source: word ? 'word' : html.includes('notionvc:') ? 'notion' : 'html',
    lists: word ? normalizeWordLists(doc) : 0,
    quotes: word ? normalizeWordQuotes(doc) : 0,
    taskLists: normalizeTaskLists(doc) + normalizeBracketTaskLists(doc),
    callouts: normalizeAsideCallouts(doc),
    colorsRemoved: stripGrayscaleColors(doc),
  };
  return { html: doc.body.innerHTML, report };
}

export function buildHtmlPasteNormalizePlugin(): Plugin {
  return new Plugin({
    props: {
      transformPastedHTML(html) {
        const r = normalizePastedHtml(html);
        if (!r) return html;
        // 成功路径也留痕:粘贴的结构不对时,先看这一行改写了什么
        console.info('[html-paste] 外部富文本粘贴', r.report);
        return r.html;
      },
    },
  });
}
