/**
 * @vitest-environment jsdom
 *
 * 分栏(2/3 Columns)空栏里,每一个 slash 命令都要正常生效 —— 用户 2026-10-28:
 * 「2/3 column 上 slash 的命令应该正常生效,包含所有的操作」。
 *
 * 真实编辑器装配(buildEditorView:全部 plugin + nodeView)+ 真实 driver api,
 * 逐条重放 slash 命令的两步(note-commands.ts / register-pm-commands.ts 里同一个套路):
 *   clearSlashTrigger(删 /xxx)→ 对光标处插入 / 转换。
 * 判据:分栏还在、栏数不变、左栏原样、新块落在光标那一栏里。
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
/** jsdom 不排版:slash 弹菜单要 coordsAtPos,给个零矩形 */
const zeroRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
const zeroRects = () => Object.assign([zeroRect()], { item: () => zeroRect() });
(Range.prototype as any).getClientRects = zeroRects;
(Range.prototype as any).getBoundingClientRect = zeroRect;
(Element.prototype as any).getClientRects = zeroRects;
/** jsdom 无 url 时 localStorage 不可用;Mermaid 块读主题偏好要用 */
const mem = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
let schema: any, blocks: any, buildEditorView: any, api: any, instanceRegistry: any;

beforeAll(async () => {
  const sb = await import('@drivers/text-editing-driver/schema-builder');
  const eb = await import('@drivers/text-editing-driver/enabled-blocks');
  buildEditorView = (await import('@drivers/text-editing-driver/editor-view-builder')).buildEditorView;
  api = (await import('@drivers/text-editing-driver/api')).textEditingDriverApi;
  instanceRegistry = (await import('@drivers/text-editing-driver/instance-registry')).instanceRegistry;
  blocks = eb.ENABLED_BLOCKS;
  schema = sb.buildSchema(blocks);
});

/** slash 菜单上的每一项 → 它的命令实际做的第二步(第一步都是 clearSlashTrigger) */
const COMMANDS: Record<string, (id: string) => void> = {
  'Text': (id) => api.turnIntoSelection(id, 'paragraph'),
  'H1': (id) => api.turnIntoSelection(id, 'h1'),
  'H2': (id) => api.turnIntoSelection(id, 'h2'),
  'H3': (id) => api.turnIntoSelection(id, 'h3'),
  'H4': (id) => api.turnIntoSelection(id, 'h4'),
  'H5': (id) => api.turnIntoSelection(id, 'h5'),
  'H6': (id) => api.turnIntoSelection(id, 'h6'),
  'Bullet List': (id) => api.turnIntoSelection(id, 'bullet-list'),
  'Ordered List': (id) => api.turnIntoSelection(id, 'ordered-list'),
  'Task List': (id) => api.turnIntoSelection(id, 'task-list'),
  'Quote': (id) => api.turnIntoSelection(id, 'blockquote'),
  'Code': (id) => api.turnIntoSelection(id, 'code-block'),
  'Divider': (id) => api.turnIntoSelection(id, 'horizontal-rule'),
  'Callout': (id) => api.turnIntoSelection(id, 'callout'),
  'Toggle': (id) => api.turnIntoSelection(id, 'toggle-list'),
  'Math Block': (id) => api.insertMathBlockAtSelection(id),
  'Mermaid': (id) => api.insertMermaidBlockAtSelection(id),
  'HTML': (id) => api.insertHtmlBlockAtSelection(id),
  'Math Visual': (id) => api.insertMathVisualAtSelection(id),
  'Def': (id) => api.insertDefBlockAtSelection(id),
  'Image': (id) => api.insertImageAtSelection(id),
  'Audio': (id) => api.insertAudioBlockAtSelection(id),
  'Video': (id) => api.insertVideoBlockAtSelection(id),
  'X Post': (id) => api.insertTweetBlockAtSelection(id),
  'Table': (id) => api.insertTableAtSelection(id, 3, 3),
  'File': (id) => api.insertFileBlockAtSelection(id),
  'External Ref': (id) => api.insertExternalRefAtSelection(id),
};

let seq = 0;

/** 起一个真编辑器:左栏有字,其余栏空;光标进第 target 栏,打 `/q` */
function mount(cols: 2 | 3, target: number) {
  const p = (text?: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const columns = Array.from({ length: cols }, (_, i) => schema.nodes.column.create(null, p(i === 0 ? '左栏内容' : undefined)));
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 1, isTitle: true }, schema.text('标题')),
    schema.nodes.columnList.create({ columns: cols }, columns),
    p('后面'),
  ]);
  const id = `t::slot:left#${++seq}`;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = buildEditorView(el, schema, blocks, doc, () => undefined, 'note-view', id);
  instanceRegistry.set(id, { view });
  let at = -1;
  let k = 0;
  view.state.doc.descendants((n: any, pos: number) => {
    if (n.type.name === 'column' && k++ === target) at = pos + 2;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  view.dispatch(view.state.tr.insertText('/'));
  view.dispatch(view.state.tr.insertText('q'));
  return { id, view };
}

function columnsOf(view: any): any[] | null {
  let cl: any = null;
  view.state.doc.forEach((n: any) => { if (n.type.name === 'columnList') cl = n; });
  if (!cl) return null;
  const out: any[] = [];
  cl.forEach((c: any) => out.push(c));
  return out;
}

for (const cols of [2, 3] as const) {
  for (const target of cols === 2 ? [1] : [1, 2]) {
    describe(`${cols} 栏 · 第 ${target + 1} 栏(空)里 slash`, () => {
      for (const [label, run] of Object.entries(COMMANDS)) {
        it(label, () => {
          const { id, view } = mount(cols, target);
          const before = view.state.doc;
          expect(api.clearSlashTrigger(id)).toBe(true);
          run(id);
          expect(view.state.doc.eq(before)).toBe(false);
          const cs = columnsOf(view);
          expect(cs, '分栏没了').not.toBeNull();
          expect(cs!.length, '栏数变了').toBe(cols);
          expect(cs![0].textContent).toBe('左栏内容');
          const mine = cs![target];
          expect(mine.textContent.includes('/q'), '/q 没删掉').toBe(false);
          /** 光标还在这一栏里 */
          const $f = view.state.selection.$from;
          let inMine = false;
          for (let d = $f.depth; d > 0; d--) if ($f.node(d) === mine) inMine = true;
          expect(inMine, '光标跑出这一栏了').toBe(true);
          /** 「Text」= 空段落转正文,本来就还是空段落 */
          if (label === 'Text') { view.destroy(); return; }
          /** 这一栏不再只是一个空段落 = 新块落进来了 */
          const onlyEmptyP = mine.childCount === 1 && mine.child(0).type.name === 'paragraph' && mine.child(0).content.size === 0;
          expect(onlyEmptyP, `新块没落进第 ${target + 1} 栏:${JSON.stringify(mine.toJSON())}`).toBe(false);
          view.destroy();
        });
      }
    });
  }
}

/** 用户 2026-10-28 选 A:栏里打 / 不出「2 Columns」(分栏不能嵌套,点了也是空操作) */
describe('栏里的 slash 菜单不出「2 Columns」', () => {
  async function menuLabels(): Promise<string[]> {
    const { slashRegistry } = await import('@slot/interaction-registries/slash-registry/slash-registry');
    const { slashMenuController } = await import('@slot/triggers/slash-menu-controller');
    const { visibleInside } = await import('@slot/frame-bindings/SlashMenuBinding');
    const st = slashMenuController.getState();
    expect(st.visible).toBe(true);
    return visibleInside(slashRegistry.getItemsForView('note-view', ''), st.inside).map((i) => i.label);
  }

  beforeAll(async () => {
    const { registerSlashMenu } = await import('@views/note/slash-menu-content');
    registerSlashMenu();
  });

  it('栏里:没有 2 Columns,其它项照常', async () => {
    const { view } = mount(2, 1);
    const labels = await menuLabels();
    expect(labels).not.toContain('2 Columns');
    expect(labels).toContain('Image');
    view.destroy();
  });

  it('栏外:2 Columns 照常出现', async () => {
    const p = schema.nodes.paragraph.create();
    const doc = schema.nodes.doc.create(null, [schema.nodes.heading.create({ level: 1, isTitle: true }, schema.text('标题')), p]);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const id = `t::slot:left#${++seq}`;
    const view = buildEditorView(el, schema, blocks, doc, () => undefined, 'note-view', id);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.dispatch(view.state.tr.insertText('/'));
    const labels = await menuLabels();
    expect(labels).toContain('2 Columns');
    view.destroy();
  });
});
