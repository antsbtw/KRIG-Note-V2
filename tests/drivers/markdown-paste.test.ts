/**
 * @vitest-environment jsdom
 *
 * note 里粘贴 markdown 自动变成块(build-markdown-paste-plugin)。
 *
 * 真实编辑器装配(buildEditorView:全部 plugin + nodeView),往 view.dom 派发真 paste 事件,
 * 走 PM 自己的 paste 管线 → handlePaste 链。判据看粘贴后 doc 里块的种类和顺序。
 *
 * 覆盖:验收文字整段 → 结构;Cmd+Shift+V 不转;KRIG 内部复制 / 普通文字 / 标题块 / 代码块
 * 维持原行为;一步撤销;块都有 id 且存库再读回结构不变;转换失败留原文 + 打日志;
 * 等转换期间用户挪光标 / 打字,内容仍插在粘贴处、不吞用户的字。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';

const deepNoop: unknown = new Proxy(function () {} as object, {
  get: () => deepNoop,
  apply: () => deepNoop,
});
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => deepNoop),
  requireCapabilityApi: vi.fn(() => deepNoop),
}));

/** 存库往返要走 capability-impl,它的 import 链会拉起 electron(app.getPath 等);给个空壳 */
vi.mock('electron', () => {
  const noop: unknown = new Proxy(function () {} as object, { get: () => noop, apply: () => noop });
  return { app: new Proxy({}, { get: (_t, k) => (k === 'getPath' ? () => '/tmp/krig-test' : noop) }), default: noop, ipcMain: noop, BrowserWindow: noop, webContents: noop, session: noop, net: noop, shell: noop, dialog: noop, Menu: noop, nativeImage: noop, protocol: noop, screen: noop, clipboard: noop, WebContentsView: noop, nativeTheme: noop, powerMonitor: noop };
});

/** md-to-pm 走真实现;测试可让它卡住(gate)或抛错(fail) */
const mdCtl = vi.hoisted(() => ({ fail: false, gate: null as Promise<void> | null }));
vi.mock('@capabilities/text-editing/converters/md-to-pm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capabilities/text-editing/converters/md-to-pm')>();
  return {
    ...real,
    markdownToProseMirror: async (md: string) => {
      if (mdCtl.gate) await mdCtl.gate;
      if (mdCtl.fail) throw new Error('模拟转换失败');
      return real.markdownToProseMirror(md);
    },
  };
});

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
let schema: any, blocks: any, buildEditorView: any, undo: any;
let createNote: any, updateNote: any, assemblePmDoc: any, wrapPmDoc: any, dissectPmDoc: any;

beforeAll(async () => {
  const sb = await import('@drivers/text-editing-driver/schema-builder');
  const eb = await import('@drivers/text-editing-driver/enabled-blocks');
  buildEditorView = (await import('@drivers/text-editing-driver/editor-view-builder')).buildEditorView;
  undo = (await import('prosemirror-history')).undo;
  blocks = eb.ENABLED_BLOCKS;
  schema = sb.buildSchema(blocks);
  const ci = await import('@platform/main/note/capability-impl');
  createNote = ci.createNote;
  updateNote = ci.updateNote;
  assemblePmDoc = (await import('@platform/main/note/assemble-pm-doc')).assemblePmDoc;
  wrapPmDoc = (await import('@platform/main/note/envelope')).wrapPmDoc;
  dissectPmDoc = (await import('@platform/main/note/dissect-pm-doc')).dissectPmDoc;
});

const ACCEPTANCE = `# 格式测试：VPS 入门

## 什么是 VPS
VPS 是一台**租来的服务器**，按月付费，*便宜*但要自己维护。详见 https://x.com/antsBTW

## 优点
- 价格低
- 可以装任何软件
- 有独立 IP

## 上手步骤
1. 选服务商
2. 装系统
3. 配防火墙

## 今天的进度
- [x] 买好服务器
- [ ] 装好代理

> 先能用，再求快。

---

有问题欢迎留言 @antsBTW #VPS 🚀`;

let seq = 0;

/** 按 Host.tsx 的规则截下真正发给 onChange(→ note.update)的 doc */
const emitted = new WeakMap<object, any[]>();

/** 起一个真 note 编辑器:标题 + body 段落;光标落在 body 段落末尾 */
function mount(body: any[] = [schema.nodes.paragraph.create()]) {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ isTitle: true }, schema.text('标题')),
    ...body,
  ]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const sent: any[] = [];
  const onTransaction = (tr: any, v: any) => {
    if (tr.getMeta('skipOnChange') === true) return;
    if (tr.docChanged) sent.push(v.state.doc.toJSON());
  };
  const view = buildEditorView(el, schema, blocks, doc, onTransaction, 'note-view', `t::slot:left#${++seq}`);
  emitted.set(view, sent);
  const end = doc.content.size - 1;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end), -1)));
  return view;
}

function paste(view: any, data: Record<string, string>): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: { getData: (t: string) => data[t] ?? '', items: [], types: Object.keys(data) },
  });
  view.dom.dispatchEvent(ev);
}

function key(view: any, type: 'keydown' | 'keyup', keyCode: number, shiftKey: boolean): void {
  const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, shiftKey });
  Object.defineProperty(ev, 'keyCode', { value: keyCode });
  view.dom.dispatchEvent(ev);
}

/** 顶层块的种类序列(heading 带级别) */
function kinds(doc: any): string[] {
  const out: string[] = [];
  doc.forEach((n: any) => out.push(n.type.name === 'heading' ? `h${n.attrs.level}` : n.type.name));
  return out;
}

/** 递归结构快照:类型 / 级别 / 勾选 / 文字 + mark —— 存库往返比对用(不含 id) */
function shape(n: any): unknown {
  if (n.type === 'text') return { t: n.text, m: (n.marks ?? []).map((m: any) => m.type) };
  return {
    type: n.type,
    ...(n.attrs?.level ? { level: n.attrs.level } : {}),
    ...(n.attrs?.checked != null ? { checked: n.attrs.checked } : {}),
    ...(n.content ? { c: n.content.map(shape) } : {}),
  };
}

/** 等异步转换落地 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('note 粘贴 markdown', () => {
  it('验收文字:标题 / 三种列表 / 引用 / 分隔线 / 粗斜体 / 链接 都成真块,顺序不乱', async () => {
    const view = mount();
    paste(view, { 'text/plain': ACCEPTANCE });
    await settle();

    expect(kinds(view.state.doc)).toEqual([
      'paragraph', // 标题块不动
      'h1', 'h2', 'paragraph',
      'h2', 'bulletList',
      'h2', 'orderedList',
      'h2', 'taskList',
      'blockquote', 'horizontalRule', 'paragraph',
    ]);
    const doc = view.state.doc;
    expect(doc.child(0).attrs.isTitle).toBe(true);
    expect(doc.child(1).textContent).toBe('格式测试：VPS 入门');
    expect(doc.child(5).childCount).toBe(3);
    expect(doc.child(7).childCount).toBe(3);
    expect(doc.child(9).content.content.map((i: any) => i.attrs.checked)).toEqual([true, false]);
    expect(doc.child(10).textContent).toBe('先能用，再求快。');

    // 粗 / 斜是真 mark,不再有 ** / *;网址是 link mark
    const para = doc.child(3);
    expect(para.textContent).not.toMatch(/\*/);
    const marked = (type: string) => {
      const out: string[] = [];
      para.forEach((t: any) => { if (t.marks.some((m: any) => m.type.name === type)) out.push(t.text); });
      return out;
    };
    expect(marked('bold')).toEqual(['租来的服务器']);
    expect(marked('italic')).toEqual(['便宜']);
    expect(marked('link')).toEqual(['https://x.com/antsBTW']);

    // 原来光标所在的空段落被替换掉,不留空行
    expect(doc.lastChild.textContent).toBe('有问题欢迎留言 @antsBTW #VPS 🚀');
  });

  it('发给保存的 doc 里新块全部带 id,存库再读回结构不变', async () => {
    const view = mount();
    paste(view, { 'text/plain': ACCEPTANCE });
    await settle();

    // 看的是 Host 真正发出去的那份(updateNote 写库边界还有一层补 id 兜底,会盖住前端漏补)
    const sent = emitted.get(view)!;
    expect(sent.length).toBeGreaterThan(0);
    const json = sent[sent.length - 1];
    const missing: string[] = [];
    const walk = (n: any) => {
      if (n.attrs && 'id' in n.attrs && !n.attrs.id) missing.push(n.type);
      (n.content ?? []).forEach(walk);
    };
    walk(json);
    expect(missing).toEqual([]);
    expect(() => dissectPmDoc('note-x', json)).not.toThrow();
    expect(json.content.length).toBe(13);

    const note = await createNote();
    await updateNote(note.id, wrapPmDoc(json));
    const reopened = await assemblePmDoc(note.id);
    expect(reopened.content.map(shape)).toEqual(json.content.map(shape));
  });

  it('Cmd+Z 一步撤回整次粘贴', async () => {
    const view = mount();
    const before = view.state.doc.toJSON();
    paste(view, { 'text/plain': ACCEPTANCE });
    await settle();
    expect(view.state.doc.childCount).toBeGreaterThan(2);
    undo(view.state, view.dispatch);
    expect(view.state.doc.toJSON().content.map(shape)).toEqual(before.content.map(shape));
  });

  it('Cmd+Shift+V:照原样粘成纯文字,不转换', async () => {
    const view = mount();
    key(view, 'keydown', 16, true);
    paste(view, { 'text/plain': '# 不是标题\n- 不是列表' });
    key(view, 'keyup', 16, false);
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(view.state.doc.child(1).textContent).toBe('# 不是标题');
  });

  it('KRIG 内部复制(html 带 data-pm-slice):维持原行为,不被抢走', async () => {
    const view = mount();
    paste(view, {
      'text/plain': '# 字面井号',
      'text/html': '<p data-pm-slice="1 1 []">  # 字面井号</p>',
    });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'paragraph']);
    expect(view.state.doc.child(1).textContent).toContain('# 字面井号');
  });

  it('html 只是纯文字外壳(如 VS Code 的 div/span):照样按 markdown 转', async () => {
    const view = mount();
    paste(view, {
      'text/plain': '## 小标题\n- 一\n- 二',
      'text/html': '<meta charset="utf-8"><div style="color:#ccc"><div><span>## 小标题</span></div><div><span>- 一</span></div><div><span>- 二</span></div></div>',
    });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'h2', 'bulletList']);
  });

  it('富文本 html(网页 / Word / Notion):不归本插件,PM 按 html 解析', async () => {
    const view = mount();
    paste(view, {
      'text/plain': '# 网页标题\n正文',
      'text/html': '<h3>网页标题</h3><p>正文</p>',
    });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'h3', 'paragraph']);
  });

  it('不像 markdown 的普通文字:维持原行为(每行一段,原文不动)', async () => {
    const view = mount();
    paste(view, { 'text/plain': '第一行 2*3*4\n第二行' });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(view.state.doc.child(1).textContent).toBe('第一行 2*3*4');
  });

  it('标题块里粘贴:标题保护照旧,只取第一行', async () => {
    const view = mount();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    paste(view, { 'text/plain': '# 新标题\n- 列表' });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'paragraph']);
    expect(view.state.doc.child(0).textContent).toBe('标题# 新标题');
  });

  it('代码块里粘贴:原样,不转', async () => {
    const view = mount([schema.nodes.codeBlock.create()]);
    paste(view, { 'text/plain': '# 注释\n- x' });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'codeBlock']);
    expect(view.state.doc.child(1).textContent).toBe('# 注释\n- x');
  });

  it('只有行内标记的一行:并进当前段,不新起块', async () => {
    const view = mount([schema.nodes.paragraph.create(null, schema.text('前后'))]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 2)));
    paste(view, { 'text/plain': '是**粗**的' });
    await settle();
    expect(kinds(view.state.doc)).toEqual(['paragraph', 'paragraph']);
    const p = view.state.doc.child(1);
    expect(p.textContent).toBe('前是粗的后');
    const bold: string[] = [];
    p.forEach((t: any) => { if (t.marks.some((m: any) => m.type.name === 'bold')) bold.push(t.text); });
    expect(bold).toEqual(['粗']);
  });

  it('转换失败:打一行错误日志,原文按纯文字插入,不丢内容', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mdCtl.fail = true;
    try {
      const view = mount();
      paste(view, { 'text/plain': '# 标题\n- 项' });
      await settle();
      expect(spy.mock.calls.some((c) => String(c[0]).includes('[markdown-paste]'))).toBe(true);
      expect(kinds(view.state.doc)).toEqual(['paragraph', 'paragraph', 'paragraph']);
      expect(view.state.doc.child(1).textContent).toBe('# 标题');
      expect(view.state.doc.child(2).textContent).toBe('- 项');
    } finally {
      mdCtl.fail = false;
      spy.mockRestore();
    }
  });

  it('等转换期间用户挪了光标并打字:内容插在粘贴处,用户的字和光标都不受影响', async () => {
    let release!: () => void;
    mdCtl.gate = new Promise<void>((r) => { release = r; });
    try {
      const view = mount([
        schema.nodes.paragraph.create(),
        schema.nodes.paragraph.create(null, schema.text('别处')),
      ]);
      // 光标在第一个空段落粘贴
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 1)));
      paste(view, { 'text/plain': '## 粘的\n- 项' });
      // 结果回来前:用户跳到「别处」末尾打字
      const end = view.state.doc.content.size - 1;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
      view.dispatch(view.state.tr.insertText('X'));
      release();
      await settle();

      expect(kinds(view.state.doc)).toEqual(['paragraph', 'h2', 'bulletList', 'paragraph']);
      expect(view.state.doc.lastChild.textContent).toBe('别处X');
      // 光标还在用户那里
      expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
    } finally {
      mdCtl.gate = null;
    }
  });

  it('等转换期间用户就在粘贴点打字:打的字不被吞掉', async () => {
    let release!: () => void;
    mdCtl.gate = new Promise<void>((r) => { release = r; });
    try {
      const view = mount([schema.nodes.paragraph.create(null, schema.text('前'))]);
      paste(view, { 'text/plain': '## 粘的\n- 项' });
      view.dispatch(view.state.tr.insertText('打'));
      release();
      await settle();
      expect(view.state.doc.textContent).toContain('打');
      expect(kinds(view.state.doc)).toContain('h2');
    } finally {
      mdCtl.gate = null;
    }
  });
});
