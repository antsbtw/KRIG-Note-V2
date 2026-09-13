/**
 * defBlock 守卫 —— note 的定义块(`00 §2.5`,归属 `§2.5.9`)
 *
 * ⭐ 归属钉死:def 是 **note 的能力**,graph 只是调用者。
 * 前一版把块与词法建在 `capabilities/diglot-model/` 只给 mind 用,已整体回退
 * (c8475b55 / 588df07e)—— 那是把地基盖在二楼。本测试锁住新归属不再漂回去。
 *
 * ⚠️ 每条断言都做过**注入验红**(故意改坏实现看它变红,还原后全绿),
 * 验红清单见本文件末尾注释。
 *
 * 环境:全 ENABLED_BLOCKS 的 import 链需要浏览器 global(math-block node-view 模块级
 * new IntersectionObserver 等)—— 照 node-style-command.test.ts 先例补最小 stub,
 * 再动态 import(静态 import 会被提升到 stub 之前)。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

// 全 ENABLED_BLOCKS import 链顺带拉起 learning vocab 集成,它 lazy 调
// requireCapabilityApi('text-editing');深 no-op 吞掉链式调用(与本测试无关)。
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
g.window ??= g;
const win = g.window as Record<string, unknown>;
win.electronAPI ??= { learningVocabList: () => Promise.resolve([]) };
win.addEventListener ??= () => {};
win.removeEventListener ??= () => {};

type Lex = typeof import('@drivers/text-editing-driver/blocks/def-block/lexicon');
type Gate = typeof import('@views/graph-canvas-view/slash-render-gate');

let schema: Schema;
let ENABLED_BLOCKS: typeof import('@drivers/text-editing-driver/enabled-blocks').ENABLED_BLOCKS;
let buildInputRules: typeof import('@drivers/text-editing-driver/plugins/build-input-rules').buildInputRules;
let buildAutoBlockIdPlugin: typeof import('@drivers/text-editing-driver/plugins/build-auto-block-id-plugin').buildAutoBlockIdPlugin;
let docNodeToMarkdown: typeof import('@drivers/text-editing-driver/serializers/pm-to-markdown').docNodeToMarkdown;
let dissectPmDoc: typeof import('@platform/main/note/dissect-pm-doc').dissectPmDoc;
let createDefBlockItem: typeof import('@capabilities/text-editing/ui/slash-menu/items').createDefBlockItem;
let markdownToProseMirror: typeof import('@capabilities/text-editing/converters/md-to-pm').markdownToProseMirror;
let buildBackspaceCommand: typeof import('@drivers/text-editing-driver/keyboard/backspace-decision').buildBackspaceCommand;
let buildKeyboardMetaLookup: typeof import('@drivers/text-editing-driver/keyboard/build-keyboard-keymap').buildKeyboardMetaLookup;
let lex: Lex;
let gate: Gate;
let RENDERABLE_ATOM_TYPES: ReadonlySet<string>;

beforeAll(async () => {
  const { buildSchema } = await import('@drivers/text-editing-driver/schema-builder');
  ({ ENABLED_BLOCKS } = await import('@drivers/text-editing-driver/enabled-blocks'));
  ({ buildInputRules } = await import('@drivers/text-editing-driver/plugins/build-input-rules'));
  ({ buildAutoBlockIdPlugin } = await import(
    '@drivers/text-editing-driver/plugins/build-auto-block-id-plugin'
  ));
  ({ docNodeToMarkdown } = await import('@drivers/text-editing-driver/serializers/pm-to-markdown'));
  ({ dissectPmDoc } = await import('@platform/main/note/dissect-pm-doc'));
  ({ createDefBlockItem } = await import('@capabilities/text-editing/ui/slash-menu/items'));
  ({ markdownToProseMirror } = await import('@capabilities/text-editing/converters/md-to-pm'));
  ({ buildBackspaceCommand } = await import(
    '@drivers/text-editing-driver/keyboard/backspace-decision'
  ));
  ({ buildKeyboardMetaLookup } = await import(
    '@drivers/text-editing-driver/keyboard/build-keyboard-keymap'
  ));
  lex = await import('@drivers/text-editing-driver/blocks/def-block/lexicon');
  gate = await import('@views/graph-canvas-view/slash-render-gate');
  ({ RENDERABLE_ATOM_TYPES } = await import('../../src/lib/atom-serializers/svg'));
  schema = buildSchema(ENABLED_BLOCKS);
});

const REPO = resolve(__dirname, '../..');
const readSrc = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');

/**
 * ⚠️ 源码守卫必须**剥掉注释再比** —— 踩过:注释里也有那句话,删掉真代码照样绿
 * (铁律 §6)。行注释 + 块注释都剥。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ────────────────────────────────────────────────────────────
// 一、词法(note 侧,图种无关)
// ────────────────────────────────────────────────────────────

describe('def 词法 · 六种行形态', () => {
  it('① id: / ② shape: / ③ role: 归 kv,值原样(不 trim key 的大小写、不规范化)', () => {
    expect(lex.classifyDefLine('id: A')).toMatchObject({ kind: 'kv', key: 'id', value: 'A' });
    expect(lex.classifyDefLine('shape: 菱形')).toMatchObject({ kind: 'kv', key: 'shape', value: '菱形' });
    expect(lex.classifyDefLine('role: floating')).toMatchObject({ kind: 'kv', key: 'role', value: 'floating' });
    // ⚠️ 值里可以含冒号(URL),只切第一个
    expect(lex.classifyDefLine('src: https://a.com/x')).toMatchObject({
      kind: 'kv',
      key: 'src',
      value: 'https://a.com/x',
    });
  });

  it('④ 关系行:带标签与**无标签**都要认', () => {
    expect(lex.classifyDefLine('A -.支撑.-> C')).toMatchObject({
      kind: 'rel',
      source: 'A',
      target: 'C',
      label: '支撑',
    });
    // ⚠️ 这条是上一轮踩的坑:`-\.([^.]*)\.->` 要求标签两侧各一个点,
    //   而 `-.->` 只有两个点(两侧共用)→ 无标签写法被归成 other,边根本没造出来。
    const noLabel = lex.classifyDefLine('A -.-> C');
    expect(noLabel.kind).toBe('rel');
    expect(noLabel).toMatchObject({ source: 'A', target: 'C' });
    expect((noLabel as { label?: string }).label).toBeUndefined();
  });

  it('⑤ 注释行 / ⑥ 不认识的行 → other,且 raw 逐字节原样', () => {
    const comment = lex.classifyDefLine('# 这行是注释');
    expect(comment.kind).toBe('other');
    expect(comment.raw).toBe('# 这行是注释');
    const junk = lex.classifyDefLine('随手写的一句话');
    expect(junk.kind).toBe('other');
    expect(junk.raw).toBe('随手写的一句话');
  });

  it('⚠️ 注释行里的冒号不许被当 kv 吃掉(`# note: 备忘` 是注释不是键值)', () => {
    expect(lex.classifyDefLine('# note: 备忘').kind).toBe('other');
  });

  it('⚠️ note 不解释含义:未知 key 与已知 key 同等对待(都是 kv,不挑词表)', () => {
    // ⭐ 00 §2.5.5「共用解析器可以,共用含义不行」——
    //   bpmn 将来可以有完全不同的词表,词法层不许有 mind 词表白名单。
    const exotic = lex.classifyDefLine('gatewayType: exclusive');
    expect(exotic).toMatchObject({ kind: 'kv', key: 'gatewayType', value: 'exclusive' });
  });
});

describe('def 词法 · 往返逐字节收敛(01 §7.7.3)', () => {
  // ⚠️ 含 ⑤⑥ 的样本必须在断言里 —— 否则「原样保留」这条验不出来
  const sample = [
    'id: B',
    'shape:菱形', // ⚠️ 故意不加空格:不许"顺手规范化"成 `shape: 菱形`
    '  color: red', // ⚠️ 故意带前导空格
    'B -.支撑.-> C',
    'B -.-> D',
    '# 注释行',
    '随手写的一句话',
    '', // ⚠️ 空行也要留住
  ].join('\n');

  it('parse → serialize 逐字节一致(含注释 / 未知行 / 空行 / 非规范空格)', () => {
    expect(lex.serializeDefText(lex.parseDefText(sample))).toBe(sample);
  });

  it('二次往返仍然一致(幂等)', () => {
    const once = lex.serializeDefText(lex.parseDefText(sample));
    expect(lex.serializeDefText(lex.parseDefText(once))).toBe(once);
  });

  it('空块 → 零行,写回仍是空串(⚠️ 不许多出一个空行)', () => {
    expect(lex.parseDefText('').lines).toHaveLength(0);
    expect(lex.serializeDefText(lex.parseDefText(''))).toBe('');
  });

  it('取值与关系:defValue 取 kv,defRelations 只收关系行', () => {
    const block = lex.parseDefText(sample);
    expect(lex.defValue(block, 'id')).toBe('B');
    expect(lex.defValue(block, 'color')).toBe('red');
    expect(lex.defValue(block, 'nonexistent')).toBeUndefined();
    const rels = lex.defRelations(block);
    expect(rels).toHaveLength(2);
    expect(rels[0]).toMatchObject({ source: 'B', target: 'C', label: '支撑' });
    expect(rels[1]).toMatchObject({ source: 'B', target: 'D' });
  });
});

describe('def 词法 · 别名分配(00 §2.5.4 方案丙)', () => {
  it('取第一个没被占的 —— ⚠️ 不是按个数递增(删掉中间的那个字母该能重用)', () => {
    // 用了 3 个但 B 空着:按个数递增会给 'D'(撞不了但浪费),正解是复用 B
    expect(lex.nextDefAlias(['A', 'C', 'D'])).toBe('B');
    expect(lex.nextDefAlias([])).toBe('A');
    expect(lex.nextDefAlias(['A'])).toBe('B');
  });

  it('26 个用完继续 A2/B2… ⚠️ 不许塌缩成重复', () => {
    const all26 = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    expect(lex.nextDefAlias(all26)).toBe('A2');
    expect(lex.nextDefAlias([...all26, 'A2', 'B2'])).toBe('C2');
  });

  it('⚠️ 真耗尽 throw,不静默返回空串(fail loud)', () => {
    const exhausted: string[] = [];
    for (let round = 1; round < 1000; round += 1) {
      for (let i = 0; i < 26; i += 1) {
        exhausted.push(String.fromCharCode(65 + i) + (round === 1 ? '' : String(round)));
      }
    }
    expect(() => lex.nextDefAlias(exhausted)).toThrow();
  });

  it('骨架只有一行 `id:`,且能被自己的词法读回来', () => {
    const skeleton = lex.buildDefSkeleton('A');
    const parsed = lex.parseDefText(skeleton);
    expect(parsed.lines).toHaveLength(1);
    expect(lex.defValue(parsed, 'id')).toBe('A');
  });
});

// ────────────────────────────────────────────────────────────
// 二、⭐ 块是 note 的一等公民(归属:§2.5.9)
// ────────────────────────────────────────────────────────────

describe('defBlock · note schema 里是真块', () => {
  it('defBlock 在 note 的 ENABLED_BLOCKS 里(不是 mind 私有)', () => {
    expect(schema.nodes.defBlock).toBeTruthy();
    expect(ENABLED_BLOCKS.some((b) => b.id === 'defBlock')).toBe(true);
  });

  it('⭐⭐ 归属:块与词法住在 note 侧(drivers/text-editing-driver),不在 diglot 里', () => {
    // ⚠️ 前一版建在 capabilities/diglot-model/def-block.ts,归属错,已回退。
    //   这条守住新归属:实现文件必须在 note 的 block 目录下。
    expect(() => readSrc('src/drivers/text-editing-driver/blocks/def-block/spec.ts')).not.toThrow();
    expect(() => readSrc('src/drivers/text-editing-driver/blocks/def-block/lexicon.ts')).not.toThrow();
    // 且 note 的 slash 工厂里有它 —— 图种专属项不会出现在这个通用工厂
    const items = stripComments(readSrc('src/capabilities/text-editing/ui/slash-menu/items.ts'));
    expect(items).toContain('createDefBlockItem');
  });

  it('⭐ 归属 attrs:`for` 默认 null(甲为主 —— 定义上一个块),可显式绑定(乙)', () => {
    // 用户 2026-09-13 拍板「甲为主 + 乙可选」
    const node = schema.nodes.defBlock.create();
    expect(node.attrs.for).toBeNull();
    const bound = schema.nodes.defBlock.create({ for: '01HXAB1234CDEFGHJKMNPQRSTV' });
    expect(bound.attrs.for).toBe('01HXAB1234CDEFGHJKMNPQRSTV');
  });

  it('⭐ 用户拍板默认折叠:spec 的 open 缺省为 false', () => {
    expect(schema.nodes.defBlock.create().attrs.open).toBe(false);
  });

  it('⚠️ 有 attrs.id 字段 —— 否则 dissect throw → 改动静默不保存', () => {
    // 血泪教训:「table cell 块 id」「导入 note 缺 id 不保存」
    expect('id' in (schema.nodes.defBlock.spec.attrs ?? {})).toBe(true);
  });

  it('内容是纯文本(词法是逐行的,富文本会让逐字节往返失守)', () => {
    const node = schema.nodes.defBlock.create(null, schema.text('id: A\nshape: 菱形'));
    expect(node.textContent).toBe('id: A\nshape: 菱形');
    expect(node.type.spec.marks).toBe('');
  });
});

describe('defBlock · 落库(dissect)', () => {
  it('⭐ 真机保存的必经处:def 块能 dissect 成 atom,内容一字不丢', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1id', level: 1 }, content: [{ type: 'text', text: '技术选型' }] },
        {
          type: 'defBlock',
          attrs: { id: 'defid', for: null, open: false },
          content: [{ type: 'text', text: 'id: B\nB -.支撑.-> C\n# 注释' }],
        },
      ],
    };
    const result = dissectPmDoc('note1', doc as never);
    const def = result.blocks.find((b) => b.id === 'defid');
    expect(def).toBeTruthy();
    expect(def!.payload.type).toBe('defBlock');
    // ⚠️ 落库的是块内文本本身 —— 注释与关系行都在,一字不丢
    const text = (def!.payload.content as { text?: string }[])[0].text;
    expect(text).toBe('id: B\nB -.支撑.-> C\n# 注释');
  });

  it('⚠️ 缺 attrs.id 时 dissect 必须 throw(fail loud,不静默吞)', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'defBlock', attrs: { id: null, for: null, open: false } }],
    };
    expect(() => dissectPmDoc('note1', doc as never)).toThrow();
  });

  it('新建的 def 块会被 auto-block-id-plugin 自动补 ULID(不必手动传 id)', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.nodes.defBlock.create(null, schema.text('id: A')),
      ]),
      plugins: [buildAutoBlockIdPlugin()],
    });
    // appendTransaction 在下一个 tr 上跑
    const next = state.apply(state.tr.insertText('', 1));
    expect(next.doc.firstChild!.attrs.id).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────
// 三、书写入口:`+++` 输入规则 + `/def` slash
// ────────────────────────────────────────────────────────────

describe('defBlock · `+++` 输入规则(用户拍板保留)', () => {
  function typeFence(text: string, isTitle = false) {
    const plugin = buildInputRules(schema);
    const handleTextInput = plugin.props.handleTextInput!;
    const para = schema.nodes.paragraph.create({ isTitle }, schema.text(text.slice(0, -1)));
    let state = EditorState.create({ schema, doc: schema.node('doc', null, [para]), plugins: [plugin] });
    const view = {
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
      },
      composing: false,
    };
    const from = text.length; // paragraph 内文本末尾 = 1 + (text.length - 1)
    handleTextInput.call(plugin, view as never, from, from, text.slice(-1));
    return state;
  }

  it('行首打 `+++` → 变 defBlock,光标进块内', () => {
    const state = typeFence('+++');
    expect(state.doc.firstChild!.type.name).toBe('defBlock');
    // ⭐ 新插入的块展开(刚敲出来就要写,折叠着没法写)
    expect(state.doc.firstChild!.attrs.open).toBe(true);
  });

  it('⚠️ title paragraph 上不触发(单标题不变量)', () => {
    const state = typeFence('+++', true);
    expect(state.doc.firstChild!.type.name).toBe('paragraph');
  });

  it('⚠️⚠️ 不许动 `---`:它仍归 horizontalRule(buildInputRules 是"始终开"的共用层)', () => {
    // 铁律:只许增能力,不许改既有行为
    const plugin = buildInputRules(schema);
    const handleTextInput = plugin.props.handleTextInput!;
    const para = schema.nodes.paragraph.create(null, schema.text('--'));
    let state = EditorState.create({ schema, doc: schema.node('doc', null, [para]), plugins: [plugin] });
    const view = {
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
      },
      composing: false,
    };
    handleTextInput.call(plugin, view as never, 3, 3, '-');
    expect(state.doc.firstChild!.type.name).toBe('horizontalRule');
  });
});

describe('defBlock · `/def` slash 入口', () => {

  it('⭐ 名字一个入口很多:def / meta / 图元 / graphmeta 都命中同一项', () => {
    const item = createDefBlockItem('note-view');
    for (const kw of ['def', 'meta', 'graphmeta', '定义', '图元', 'gd']) {
      expect(item.keywords).toContain(kw);
    }
  });

  it('⭐⭐ 注册在 note(归属 §2.5.9)—— note / thought / mind 语义面三处都有', () => {
    // ⚠️ 前一版「绝不注册到 note-view」是归属搞反的产物,已作废。
    for (const f of [
      'src/views/note/slash-menu-content.ts',
      'src/views/thought/slash-menu-content.ts',
      'src/views/graph-canvas-view/mind-semantic-menus.ts',
    ]) {
      expect(stripComments(readSrc(f))).toContain('createDefBlockItem');
    }
  });

  it('⚠️ 画布文字节点里**不放行** —— 守「编辑能插 ⊆ 渲染能渲」防功能黑洞', () => {
    const item = createDefBlockItem('note-view');
    // defBlock 不在 RENDERABLE_ATOM_TYPES:atomsToSvg 渲不出它
    expect(RENDERABLE_ATOM_TYPES.has('defBlock')).toBe(false);
    // ⭐ 且必须**显式登记**在 insert 表里 —— 闸对未登记的 insert 项是放行的,
    //   不登记就等于静默放行黑洞(闸自己的 fail loud 注释要求)
    expect(gate.SLASH_INSERT_COMMAND_TO_ATOM_TYPE[item.command]).toBe('defBlock');
    expect(gate.isSlashItemRenderable(item)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 四、markdown 往返
// ────────────────────────────────────────────────────────────

describe('defBlock · markdown 往返', () => {
  it('doc → markdown 吐出 `+++ … +++`(边框由序列化补回,不在 textContent 里)', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.heading.create({ level: 1 }, schema.text('技术选型')),
      schema.nodes.defBlock.create(null, schema.text('id: B\nB -.支撑.-> C\n# 注释')),
    ]);
    const { markdown } = docNodeToMarkdown(doc);
    expect(markdown).toContain(`${lex.DEF_FENCE}\nid: B\nB -.支撑.-> C\n# 注释\n${lex.DEF_FENCE}`);
  });

  it('⚠️ 空 def 块也 emit 首尾 `+++`(吞掉它 = 往返丢块)', () => {
    const doc = schema.node('doc', null, [schema.nodes.defBlock.create()]);
    expect(docNodeToMarkdown(doc).markdown).toContain('+++\n+++');
  });

  it('⭐⭐ 全链路 markdown → PM → markdown 逐字节收敛(探针实证,非脑补)', async () => {
    // ⚠️「每层都对但结果不对 → 查数据经过的格式」—— 单测各层绿不代表全链路通,
    //   这条把 md 解析 → PM 节点 → 序列化整条链钉住。
    const src = [
      '# 技术选型',
      '',
      '+++',
      'id: B',
      'shape:菱形', // ⚠️ 非规范空格必须原样活着穿过全链路
      'B -.支撑.-> C',
      'B -.-> D',
      '# 注释行',
      '随手写的一句话',
      '+++',
      '',
      '正文一段',
    ].join('\n');
    const nodes = await markdownToProseMirror(src);
    expect(nodes.map((n) => n.type)).toEqual(['heading', 'defBlock', 'paragraph']);
    const doc = schema.nodeFromJSON({ type: 'doc', content: nodes });
    const { markdown } = docNodeToMarkdown(doc);
    expect(markdown).toContain(
      '+++\nid: B\nshape:菱形\nB -.支撑.-> C\nB -.-> D\n# 注释行\n随手写的一句话\n+++',
    );
  });

  it('⚠️ 没闭合的 `+++` 不认(fail safe:少写一行不该把后文全吞进定义块)', async () => {
    const nodes = await markdownToProseMirror(['+++', 'id: A', '', '正文'].join('\n'));
    expect(nodes.some((n) => n.type === 'defBlock')).toBe(false);
    expect(nodes.every((n) => n.type === 'paragraph')).toBe(true);
  });
});


// ────────────────────────────────────────────────────────────
// 五、折叠态形态与删除入口(用户 2026-09-13 拍板)
// ────────────────────────────────────────────────────────────

describe('defBlock · 折叠态:一条双线,不可交互', () => {
  it('⭐ `+++` 是通栏的线,不是字面三个加号(CSS 用 border-top,与 hr 同族)', () => {
    // 用户:「+++ 是否使用一条线覆盖整个页面宽度?类似 --- 产生的效果」
    // ⚠️ 必须**只看展开态那条规则的花括号内部** —— 早先写成「从选择器往后 slice
    //   全文再 match」,折叠态的 `3px double` 会把它满足掉(注入验红时抓到的假绿)。
    const css = stripComments(readSrc('src/drivers/text-editing-driver/pm-host.css'));
    const block = /\.krig-def-block__rule\s*\{([^}]*)\}/.exec(css);
    expect(block).toBeTruthy();
    expect(block![1]).toMatch(/border-top:\s*1px solid/);
  });

  it('⭐ 折叠态上边框是**双线**(border-style: double)', () => {
    const css = stripComments(readSrc('src/drivers/text-editing-driver/pm-host.css'));
    const closed = css.slice(css.indexOf('.krig-def-block.closed'));
    expect(closed).toMatch(/border-top:\s*3px double/);
  });

  it('⚠️ 折叠态**不显示 def 里的任何内容**(正文与下边框都 display:none)', () => {
    const css = stripComments(readSrc('src/drivers/text-editing-driver/pm-host.css'));
    // 收起规则必须同时点名正文和末条线,且值是 display:none
    const m = css.match(
      /\.krig-def-block\.closed \.krig-def-block__body[^{]*\{[^}]*display:\s*none/,
    );
    expect(m).toBeTruthy();
  });

  it('⚠️ NodeView 不再渲染摘要 —— 折叠态一个字都不露', () => {
    // 早先版本折叠时显示 `id: A · 2 项` 摘要;用户要求改成什么都不显示。
    const nv = stripComments(readSrc('src/drivers/text-editing-driver/blocks/def-block/node-view.ts'));
    expect(nv).not.toContain('summary');
  });

  it('⭐ 折叠态不显示 handle(⋮⋮);⚠️ 展开态仍要有', () => {
    const plugin = stripComments(
      readSrc('src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts'),
    );
    // 必须是「defBlock 且未展开」才隐藏 —— 无条件隐藏会把展开态的 handle 也砍掉
    expect(plugin).toMatch(/defBlock[\s\S]{0,80}attrs\.open\s*!==\s*true/);
  });
});

describe('defBlock · 删除入口:下一段行首 Backspace(用户拍板)', () => {
  function pressBackspaceAtStartOfLastPara(blocks: import('prosemirror-model').Node[]) {
    const doc = schema.node('doc', null, blocks);
    let state = EditorState.create({ schema, doc });
    const last = doc.child(doc.childCount - 1);
    const pos = doc.content.size - last.nodeSize + 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    const cmd = buildBackspaceCommand(buildKeyboardMetaLookup(ENABLED_BLOCKS));
    const handled = cmd(state, (tr) => {
      state = state.apply(tr);
    }, undefined as never);
    return { handled, state };
  }

  it('⭐ 光标在 def 块下一段行首按 Backspace → 整个 def 块被删掉', () => {
    const { handled, state } = pressBackspaceAtStartOfLastPara([
      schema.nodes.paragraph.create(null, schema.text('上文')),
      schema.nodes.defBlock.create({ open: false }, schema.text('id: A')),
      schema.nodes.paragraph.create(null, schema.text('下文')),
    ]);
    expect(handled).toBe(true);
    const types = state.doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(['paragraph', 'paragraph']);
    // ⚠️ 下文一个字都不能丢(删的是 def 块,不是这段)
    expect(state.doc.child(1).textContent).toBe('下文');
    expect(state.doc.child(0).textContent).toBe('上文');
  });

  it('⚠️⚠️ 修掉一个真 bug:不接管时正文会被并进 def 块污染词法', () => {
    // 探针实测(非脑补):joinTextblockBackward 会产出
    //   [para "上文"] [defBlock "id: A下文"]   ⭐ 正文混进逐行词法,定义就不合法了
    const { state } = pressBackspaceAtStartOfLastPara([
      schema.nodes.paragraph.create(null, schema.text('上文')),
      schema.nodes.defBlock.create({ open: false }, schema.text('id: A')),
      schema.nodes.paragraph.create(null, schema.text('下文')),
    ]);
    for (const n of state.doc.content.content) {
      if (n.type.name === 'defBlock') expect(n.textContent).not.toContain('下文');
    }
  });

  it('展开态同样能这样删(删除入口与折叠与否无关)', () => {
    const { handled, state } = pressBackspaceAtStartOfLastPara([
      schema.nodes.defBlock.create({ open: true }, schema.text('id: A')),
      schema.nodes.paragraph.create(null, schema.text('下文')),
    ]);
    expect(handled).toBe(true);
    expect(state.doc.content.content.map((n) => n.type.name)).toEqual(['paragraph']);
  });

  it('⚠️ 不许误伤:上一块**不是** def 块时,仍走原来的合并语义', () => {
    const { state } = pressBackspaceAtStartOfLastPara([
      schema.nodes.paragraph.create(null, schema.text('上文')),
      schema.nodes.paragraph.create(null, schema.text('下文')),
    ]);
    // 原行为:两段合并成一段
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('上文下文');
  });

  it('⚠️ 不许误伤:光标不在行首时不接管(该删字符就删字符)', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.defBlock.create({ open: false }, schema.text('id: A')),
      schema.nodes.paragraph.create(null, schema.text('下文')),
    ]);
    let state = EditorState.create({ schema, doc });
    const last = doc.child(1);
    const startPos = doc.content.size - last.nodeSize + 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, startPos + 1)));
    const cmd = buildBackspaceCommand(buildKeyboardMetaLookup(ENABLED_BLOCKS));
    const handled = cmd(state, () => {}, undefined as never);
    expect(handled).toBe(false); // 放行 → baseKeymap 删字符,def 块不受影响
  });
});

/**
 * ── ⚠️ 注入验红清单(每条都实跑过:注入后变红、还原后全绿)──────
 *
 * 见 commit message。核心几刀:
 *  1. REL_RE 退回 `-\.([^.]*)\.->`(无标签匹配不上)     → 「无标签」+「往返」红
 *  2. serializeDefText 改成重新格式化 `${key}: ${value}` → 「逐字节往返」红
 *  3. nextDefAlias 改成按个数递增                        → 「第一个没被占的」红
 *  4. spec 去掉 attrs.id                                 → 「dissect」+「id 字段」红
 *  5. spec 的 open 默认改 true                           → 「默认折叠」红
 *  6. 输入规则改用 `---`                                 → 「不许动 ---」红
 *  7. 闸的 insert 登记表删掉 defBlock                    → 「不放行」红
 *  8. 序列化不补 `+++`                                   → 「markdown 往返」红
 */
