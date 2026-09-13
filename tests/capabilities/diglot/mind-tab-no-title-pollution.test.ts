/**
 * mind 语义面:Tab 不许污染节点标题(用户拍板 2026-09-13,方案 a)
 *
 * ⚠️⚠️ 踩出来的真问题(离线探针实测,非推理):
 * note 本体的 Tab 有三种行为,其中「纯文本光标 → 插两个**全角空格** `　　`」
 * 在 note 里是**正确**的(中文段内缩进,用户既有约定)。
 * 但 mind 的语义面里,标题块的文字 = **节点的名字**,于是:
 * ```
 * 光标在标题「子」里按 Tab → insertText('　　') → 标题变成「　　子」
 *   → noteDocToTree 取首块 inline 当标签 → 画布上主题框显示「　　子」
 * ```
 * ⭐ 这不是「功能缺失」,是**静默污染数据** —— 用户不知道自己按了什么。
 *
 * ⭐⭐ 用户决议(2026-09-13):**方案 a —— Tab 在 mind 语义面什么都不做**。
 * 理由(用户原话):「hn 已经有很好的编辑方法了,就是 slash,如果有其他,
 * 通过 handle 改变就行了。**没有必要调整原来 note 的编辑习惯**。」
 *
 * ⚠️ 明确**不做**「Tab = 升降级」(规格 01 §7.1 的「大纲侧 Tab」):
 * 那会在一个 note 编辑器里把 Tab 改成非 note 语义,是两套习惯打架。
 * 改层级的入口已经有两个且都是 note 原生的:slash(h1~h6 六项俱全)
 * 与 ⋮⋮ handle 的 turn-into —— 已在 mind-semantic-menus.ts 注册。
 * ⭐ 实测佐证:把块从 h2 敲成 h3,`parent` 自动跟着变(层级本就改得动)。
 *
 * ── 本文件钉住什么 ─────────────────────────────────────
 * 1. mind 语义面(blockIndentKeymap: false)下 Tab **不插任何字符**
 * 2. ⭐⭐ note 本体(不传 toggle = 默认全开)行为**零回归** —— 照插全角空格
 * 3. Shift-Tab 同理
 *
 * ⚠️ 断言看的是**真实命令跑完后的文档内容**,不是源码文本 ——
 * 源码守卫会被注释骗过(铁律 §4.1 教训 1)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { buildBlockIndentKeymap } from '@drivers/text-editing-driver/plugins/build-block-indent-keymap';

/** 最小 schema:heading / paragraph 都带 indent + textIndent(与真 schema 同形)。 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { indent: { default: 0 }, textIndent: { default: false } },
      toDOM: () => ['p', 0],
    },
    heading: {
      content: 'inline*',
      group: 'block',
      attrs: { level: { default: 1 }, indent: { default: 0 }, textIndent: { default: false } },
      toDOM: () => ['h1', 0],
    },
  },
  marks: {},
});

/** 全角空格 —— tabCmd 的「行为 3」插的就是它(两个)。 */
const IDEOGRAPHIC_SPACE = '　';

function makeDoc() {
  const { heading } = schema.nodes;
  return schema.node('doc', null, [
    heading.create({ level: 1 }, schema.text('根')),
    heading.create({ level: 2 }, schema.text('子')),
  ]);
}

/**
 * 光标落在第二个 heading(「子」)的**行首**。
 *
 * ⚠️ 刻意用行首:tabCmd 的「行为 3」是**任意 offset 都插**(含行首),
 * 行首插入产出 `　　子`,一眼能看出污染发生在标题开头。
 * (起初把光标放在文末,得到 `子　　` —— 那是我的场景搭错,不是行为不同。)
 */
function cursorInSecondHeading(state: EditorState): EditorState {
  let pos = -1;
  let seen = 0;
  state.doc.descendants((node, p) => {
    if (node.type.name === 'heading') {
      seen += 1;
      if (seen === 2 && pos < 0) pos = p + 1; // +1 = 进入该块内容的行首
    }
    return true;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/**
 * 用真实 keymap 跑一次按键。
 * ⚠️ 走 plugin 的 handleKeyDown —— 与真机同一条命令,不另写一套。
 */
function press(
  state: EditorState,
  key: string,
  opts: { shift?: boolean; blockIndentKeymap?: boolean } = {},
): EditorState {
  const plugin = buildBlockIndentKeymap({ enabled: opts.blockIndentKeymap });
  const handleKeyDown = plugin.props.handleKeyDown;
  if (!handleKeyDown) return state;
  let next = state;
  const fakeView = {
    state,
    dispatch: (tr: Transaction) => {
      next = state.apply(tr);
    },
  };
  const event = {
    key,
    shiftKey: opts.shift ?? false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleKeyDown(fakeView as any, event);
  return next;
}

/** 第二个 heading 的纯文本 —— 它就是节点在画布上显示的名字。 */
function secondHeadingText(state: EditorState): string {
  const texts: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === 'heading') texts.push(node.textContent);
    return true;
  });
  return texts[1] ?? '';
}

describe('mind 语义面:Tab 不许污染节点标题(方案 a)', () => {
  it('⭐⭐ mind 下按 Tab —— 标题文字一个字符都不许变', () => {
    let state = EditorState.create({ doc: makeDoc() });
    state = cursorInSecondHeading(state);
    expect(secondHeadingText(state)).toBe('子');

    state = press(state, 'Tab', { blockIndentKeymap: false });

    expect(
      secondHeadingText(state),
      '⚠️ 标题被改了 —— 节点名字会变成带全角空格的样子,这正是要堵的污染',
    ).toBe('子');
    expect(
      secondHeadingText(state).includes(IDEOGRAPHIC_SPACE),
      '⚠️ 标题里出现了全角空格 —— Tab 的「行为 3」漏进了 mind 语义面',
    ).toBe(false);
  });

  it('⭐ mind 下按 Shift-Tab —— 同样不许动文字', () => {
    let state = EditorState.create({ doc: makeDoc() });
    state = cursorInSecondHeading(state);
    state = press(state, 'Tab', { shift: true, blockIndentKeymap: false });
    expect(secondHeadingText(state)).toBe('子');
  });

  it('⭐ mind 下 Tab 也不许改 indent attr(层级只由 hn 决定)', () => {
    let state = EditorState.create({ doc: makeDoc() });
    state = cursorInSecondHeading(state);
    const before = state.doc.child(1).attrs.indent;
    state = press(state, 'Tab', { blockIndentKeymap: false });
    expect(state.doc.child(1).attrs.indent, 'mind 下 Tab 不该动 indent').toBe(before);
  });

  it('⭐⭐ note 本体零回归 —— 不传 toggle 时 Tab 照插全角空格', () => {
    let state = EditorState.create({ doc: makeDoc() });
    state = cursorInSecondHeading(state);

    // ⚠️ 不传 enabled = note 本体的默认路径(opt-out 契约:默认全开)
    state = press(state, 'Tab');

    expect(
      secondHeadingText(state),
      '⚠️⚠️ note 本体的 Tab 行为被改了 —— 这是共用层回归,绝不允许',
    ).toBe(IDEOGRAPHIC_SPACE + IDEOGRAPHIC_SPACE + '子');
  });

  it('⭐ note 本体:显式传 true 与不传等价(opt-out 语义)', () => {
    let state = EditorState.create({ doc: makeDoc() });
    state = cursorInSecondHeading(state);
    state = press(state, 'Tab', { blockIndentKeymap: true });
    expect(secondHeadingText(state)).toBe(IDEOGRAPHIC_SPACE + IDEOGRAPHIC_SPACE + '子');
  });

  /**
   * ⭐⭐ 上面五条钉的是**机制**(开关一关,Tab 就不污染)。
   * ⚠️ 但机制对了不等于 mind **用**了它 —— 实测:把 MindSemanticPane 里那行
   * `blockIndentKeymap: false` 删掉,上面五条**全绿**(注入验证过)。
   * 所以还要钉住**接线本身**。
   */
  it('⭐⭐ mind 语义面必须真的关掉它 —— 接线被删要能发现', () => {
    const src = readFileSync(
      resolve(__dirname, '../../..', 'src/views/graph-canvas-view/MindSemanticPane.tsx'),
      'utf-8',
    );
    // ⚠️⚠️ 必须**剥掉注释**再比 —— 否则上面那段说明文字本身就能让断言通过
    //    (铁律 §4.1 教训 1:注释里也有这句话 → 删掉真代码照样绿)。
    const code = src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(
      /blockIndentKeymap\s*:\s*false/.test(code),
      '⚠️ mind 语义面没有关掉 Tab —— 标题会被全角空格污染(见本文件顶部)',
    ).toBe(true);
  });
});
