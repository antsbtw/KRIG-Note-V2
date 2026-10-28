/**
 * @vitest-environment jsdom
 *
 * Word / 网页 富文本粘贴(build-html-paste-normalize-plugin)。
 *
 * 夹具是真剪贴板(tests/fixtures/paste/):同一段验收文字(acceptance.md 同内容)
 * - word.*   :pandoc 转 docx → Microsoft Word 打开 → 全选复制(2026-10-28 本机 Word 15)
 * - chrome.* :pandoc 转 html → Chrome 打开 → 全选复制
 * 每份是 NSPasteboard 的 public.html + public.utf8-plain-text 原样落盘。
 *
 * 真编辑器装配 + 往 view.dom 派发真 paste 事件,看粘贴后块的种类和顺序。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { readFileSync } from 'node:fs';
import { DOMSerializer } from 'prosemirror-model';
import { isGrayscaleColor, normalizePastedHtml } from '@drivers/text-editing-driver/plugins/build-html-paste-normalize-plugin';

const deepNoop: unknown = new Proxy(function () {} as object, {
  get: () => deepNoop,
  apply: () => deepNoop,
});
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => deepNoop),
  requireCapabilityApi: vi.fn(() => deepNoop),
}));

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.IntersectionObserver ??= NoopObserver;
g.ResizeObserver ??= NoopObserver;
(window as unknown as Record<string, unknown>).electronAPI ??= { learningVocabList: () => Promise.resolve([]) };
const zeroRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
const zeroRects = () => Object.assign([zeroRect()], { item: () => zeroRect() });
(Range.prototype as any).getClientRects = zeroRects;
(Range.prototype as any).getBoundingClientRect = zeroRect;
(Element.prototype as any).getClientRects = zeroRects;
const mem = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
let schema: any, blocks: any, buildEditorView: any;

beforeAll(async () => {
  const sb = await import('@drivers/text-editing-driver/schema-builder');
  const eb = await import('@drivers/text-editing-driver/enabled-blocks');
  buildEditorView = (await import('@drivers/text-editing-driver/editor-view-builder')).buildEditorView;
  blocks = eb.ENABLED_BLOCKS;
  schema = sb.buildSchema(blocks);
});


const fixture = (name: string) => ({
  'text/plain': readFileSync(`tests/fixtures/paste/${name}.plain.txt`, 'utf8'),
  'text/html': readFileSync(`tests/fixtures/paste/${name}.html`, 'utf8'),
});

let seq = 0;

function mount(body: any[] = [schema.nodes.paragraph.create()]) {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ isTitle: true }, schema.text('标题')),
    ...body,
  ]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = buildEditorView(el, schema, blocks, doc, () => undefined, 'note-view', `h::slot:left#${++seq}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(doc.content.size - 1), -1)));
  return view;
}

function paste(view: any, data: Record<string, string>): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: { getData: (t: string) => data[t] ?? '', items: [], types: Object.keys(data) },
  });
  view.dom.dispatchEvent(ev);
}

/** 顶层块(去掉标题块):heading 带级别,列表带项数,任务项带勾选 */
function kinds(view: any): string[] {
  const out: string[] = [];
  view.state.doc.forEach((n: any, _o: number, i: number) => {
    if (i === 0) return;
    const name = n.type.name;
    if (name === 'heading') out.push(`h${n.attrs.level}`);
    else if (name === 'taskList') out.push(`taskList[${n.content.content.map((t: any) => (t.attrs.checked ? 'x' : ' ')).join('')}]`);
    else if (/List$/.test(name)) out.push(`${name}(${n.childCount})`);
    else out.push(name);
  });
  return out;
}

function marksOf(view: any, name: string): string[] {
  const out: string[] = [];
  view.state.doc.descendants((n: any) => {
    if (n.isText && n.marks.some((m: any) => m.type.name === name)) out.push(n.text);
  });
  return out;
}

describe('Word 粘贴(真剪贴板)', () => {
  it('列表 / 任务 / 引用 都成真块,不再是「·  价格低」段落', () => {
    const view = mount();
    paste(view, fixture('word'));
    expect(kinds(view)).toEqual([
      'h1', 'h2', 'paragraph',
      'h2', 'bulletList(3)',
      'h2', 'orderedList(3)',
      'h2', 'taskList[x ]',
      'blockquote', 'horizontalRule', 'table', 'paragraph',
    ]);
    expect(view.state.doc.textContent).not.toMatch(/[·☒☐]/);
    expect(view.state.doc.child(5).child(0).textContent).toBe('价格低');
    expect(marksOf(view, 'bold')).toEqual(['租来的服务器']);
    expect(marksOf(view, 'italic')).toEqual(['便宜']);
    expect(marksOf(view, 'link')).toEqual(['https://x.com/antsBTW']);
  });

  it('多级列表:Word 的 level → 列表项 indent(KRIG 列表缩进不嵌套)', () => {
    const p = (lvl: number, marker: string, text: string) =>
      `<p class=MsoListParagraph style='mso-list:l0 level${lvl} lfo1'><![if !supportLists]><span style='mso-list:Ignore'>${marker}<span>&nbsp;&nbsp; </span></span><![endif]>${text}</p>`;
    const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>${p(1, '1.', '一')}${p(2, 'a.', '一点一')}${p(1, '2.', '二')}</body></html>`;
    const view = mount();
    paste(view, { 'text/plain': '一\n一点一\n二', 'text/html': html });
    expect(kinds(view)).toEqual(['orderedList(3)']);
    const items = view.state.doc.child(1).content.content;
    expect(items.map((li: any) => [li.textContent, li.attrs.indent])).toEqual([['一', 0], ['一点一', 1], ['二', 0]]);
  });
});

describe('网页粘贴(Chrome 真剪贴板)', () => {
  it('结构正确,任务列表保住勾选', () => {
    const view = mount();
    paste(view, fixture('chrome'));
    expect(kinds(view)).toEqual([
      'h1', // pandoc 页面自带的标题
      'h1', 'h2', 'paragraph',
      'h2', 'bulletList(3)',
      'h2', 'orderedList(3)',
      'h2', 'taskList[x ]',
      'blockquote', 'horizontalRule', 'table', 'paragraph',
    ]);
  });

  it('页面正文底色字(Chrome 内联的 rgb(26,26,26))不带进来 —— 否则暗色主题下看不见', () => {
    expect(fixture('chrome')['text/html']).toContain('color: rgb(26, 26, 26)');
    const view = mount();
    paste(view, fixture('chrome'));
    expect(marksOf(view, 'textStyle')).toEqual([]);
  });

  it('作者有意标的彩色字保留', () => {
    const view = mount();
    paste(view, {
      'text/plain': '注意 危险',
      'text/html': '<p style="color: rgb(20, 20, 20)">注意 <span style="color: rgb(220, 38, 38)">危险</span></p>',
    });
    expect(marksOf(view, 'textStyle')).toEqual(['危险']);
  });

  it('GitHub 式任务列表(li > input 直接子)', () => {
    const view = mount();
    paste(view, {
      'text/plain': '做完\n没做',
      'text/html': '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled checked> 做完</li><li class="task-list-item"><input type="checkbox" disabled> 没做</li></ul>',
    });
    expect(kinds(view)).toEqual(['taskList[x ]']);
  });

  it('只有部分项带 checkbox 的列表不当任务列表', () => {
    const r = normalizePastedHtml('<ul><li><input type="checkbox"> a</li><li>b</li></ul>')!;
    expect(r.html).not.toContain('task-list');
  });
});

describe('KRIG 内部复制粘贴', () => {
  it('任务列表复制再粘贴仍是任务列表、勾选不丢(之前被 ul/li 规则抢成无序列表)', () => {
    const ti = (t: string, c: boolean) => schema.nodes.taskItem.create({ checked: c }, schema.nodes.paragraph.create(null, schema.text(t)));
    const src = schema.nodes.doc.create(null, [schema.nodes.taskList.create(null, [ti('a', true), ti('b', false)])]);
    const holder = document.createElement('div');
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(src.content, { document }));
    holder.firstElementChild!.setAttribute('data-pm-slice', '0 0 []');
    const view = mount();
    paste(view, { 'text/plain': 'a\nb', 'text/html': holder.innerHTML });
    expect(kinds(view)).toEqual(['taskList[x ]']);
  });

  it('带 data-pm-slice 的 html 不改写(颜色等原样)', () => {
    expect(normalizePastedHtml('<p data-pm-slice="1 1 []" style="color: black">x</p>')).toBeNull();
  });
});

describe('isGrayscaleColor', () => {
  it.each([
    ['rgb(26, 26, 26)', true], ['#333', true], ['#ffffff', true], ['rgba(0, 0, 0, 0.87)', true],
    ['windowtext', true], ['rgb(96, 96, 96)', true],
    ['rgb(220, 38, 38)', false], ['#156082', false], ['red', false], ['teal', false],
  ])('%s → %s', (c, gray) => {
    expect(isGrayscaleColor(c)).toBe(gray);
  });
});
