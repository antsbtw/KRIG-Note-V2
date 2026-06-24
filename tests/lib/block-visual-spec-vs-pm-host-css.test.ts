/**
 * L5 编辑↔渲染一致性专项 E2 — 防漂单测:block-visual-spec 值 == pm-host.css 权威值
 *
 * 方案乙(总指挥拍板):block-visual-spec.ts 是渲染态读的唯一真源,**初值逐条 = pm-host.css
 * 现值**(note 权威观感);pm-host.css 不动。本测从 pm-host.css 抽对应选择器的值,断言
 * 与 spec 一致 —— 将来谁改了 note 的 pm-host.css 却忘了同步 spec(graph 渲染态会漂离
 * note),本测变红逼其同步。
 *
 * 解析手段:对每个选择器块取首个匹配段,正则抽属性值。pm-host.css 选择器稳定(各 block
 * 命名 class),够稳;若 css 重构改选择器,本测会找不到 → 红,提示同步。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BLOCK_VISUAL_SPEC, headingFontSize } from '../../src/lib/visual-spec/block-visual-spec';

let css = '';
beforeAll(() => {
  css = fs.readFileSync(
    path.resolve(__dirname, '../../src/drivers/text-editing-driver/pm-host.css'),
    'utf-8',
  );
});

/** 取某选择器 `{ ... }` 块的内容(首个匹配)。 */
function block(selector: string): string {
  // 转义选择器里的正则元字符,再匹配到下一个 `}`
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  if (!m) throw new Error(`pm-host.css 未找到选择器块:${selector}`);
  return m[1];
}

/** 从块内容抽某属性的原始值(去分号去首尾空格)。 */
function prop(blockBody: string, name: string): string {
  const re = new RegExp('(?:^|[;{\\s])' + name + '\\s*:\\s*([^;]+);');
  const m = re.exec(blockBody);
  if (!m) throw new Error(`属性 ${name} 未在块内找到`);
  return m[1].trim();
}

function px(v: string): number {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  if (!m) throw new Error(`非 px 值:${v}`);
  return parseFloat(m[1]);
}

describe('E2 防漂 — block-visual-spec == pm-host.css', () => {
  it('正文 / 根容器(.krig-pm-host)', () => {
    const b = block('.krig-pm-host');
    expect(px(prop(b, 'font-size'))).toBe(BLOCK_VISUAL_SPEC.body.fontSize);
    expect(parseFloat(prop(b, 'line-height'))).toBe(BLOCK_VISUAL_SPEC.body.lineHeight);
    expect(prop(b, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.body.color);
  });

  it('heading h1/h2/h3 绝对 px + weight', () => {
    const h1 = block('.krig-pm-host .ProseMirror h1');
    expect(px(prop(h1, 'font-size'))).toBe(BLOCK_VISUAL_SPEC.headings.h1.fontSize);
    expect(parseFloat(prop(h1, 'font-weight'))).toBe(BLOCK_VISUAL_SPEC.headings.h1.fontWeight);
    const h2 = block('.krig-pm-host .ProseMirror h2');
    expect(px(prop(h2, 'font-size'))).toBe(BLOCK_VISUAL_SPEC.headings.h2.fontSize);
    expect(parseFloat(prop(h2, 'font-weight'))).toBe(BLOCK_VISUAL_SPEC.headings.h2.fontWeight);
    const h3 = block('.krig-pm-host .ProseMirror h3');
    expect(px(prop(h3, 'font-size'))).toBe(BLOCK_VISUAL_SPEC.headings.h3.fontSize);
    expect(parseFloat(prop(h3, 'font-weight'))).toBe(BLOCK_VISUAL_SPEC.headings.h3.fontWeight);
  });

  it('headingFontSize() 映射对齐(h1-h3 绝对 px;paragraph/h4+ 退正文)', () => {
    expect(headingFontSize(1)).toBe(38);
    expect(headingFontSize(2)).toBe(28);
    expect(headingFontSize(3)).toBe(22);
    expect(headingFontSize(undefined)).toBe(BLOCK_VISUAL_SPEC.body.fontSize);
    expect(headingFontSize(4)).toBe(BLOCK_VISUAL_SPEC.body.fontSize);
  });

  it('list(li padding-left / bullet 直径)', () => {
    const li = block('.krig-pm-host .ProseMirror li');
    expect(px(prop(li, 'padding-left'))).toBe(BLOCK_VISUAL_SPEC.list.indentPerLevel);
    const bullet = block('.krig-pm-host .ProseMirror ul.krig-bullet-list > li::before');
    expect(px(prop(bullet, 'width'))).toBe(BLOCK_VISUAL_SPEC.list.bulletDiameter);
    expect(px(prop(bullet, 'height'))).toBe(BLOCK_VISUAL_SPEC.list.bulletDiameter);
  });

  it('blockquote(竖条宽/色 / 缩进 / 文字色 / 斜体)', () => {
    const b = block('.krig-pm-host .ProseMirror blockquote.krig-blockquote');
    const borderLeft = prop(b, 'border-left'); // "3px solid #555"
    expect(px(borderLeft.split(/\s+/)[0])).toBe(BLOCK_VISUAL_SPEC.quote.barWidth);
    expect(borderLeft.split(/\s+/)[2].toLowerCase()).toBe(BLOCK_VISUAL_SPEC.quote.barColor);
    expect(px(prop(b, 'padding-left'))).toBe(BLOCK_VISUAL_SPEC.quote.indent);
    expect(prop(b, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.quote.textColor);
    expect(prop(b, 'font-style')).toBe(BLOCK_VISUAL_SPEC.quote.italic ? 'italic' : 'normal');
  });

  it('callout(背景/圆角/padding/图标框/gap)', () => {
    const c = block('.krig-pm-host .ProseMirror div.krig-callout');
    // 背景去空格后比对(css 'rgba(255, 255, 255, 0.04)' vs spec 无空格)
    expect(prop(c, 'background').replace(/\s+/g, '')).toBe(BLOCK_VISUAL_SPEC.callout.bgFill.replace(/\s+/g, ''));
    expect(px(prop(c, 'border-radius'))).toBe(BLOCK_VISUAL_SPEC.callout.radius);
    expect(px(prop(c, 'padding'))).toBe(BLOCK_VISUAL_SPEC.callout.padX);
    expect(px(prop(c, 'padding'))).toBe(BLOCK_VISUAL_SPEC.callout.padY);
    expect(px(prop(c, 'gap'))).toBe(BLOCK_VISUAL_SPEC.callout.iconGap);
    const emoji = block('.krig-pm-host .ProseMirror .krig-callout__emoji');
    expect(px(prop(emoji, 'width'))).toBe(BLOCK_VISUAL_SPEC.callout.iconBox);
    expect(px(prop(emoji, 'height'))).toBe(BLOCK_VISUAL_SPEC.callout.iconBox);
  });

  it('codeBlock(字号/行高/背景/边框/圆角/padding/文字色)', () => {
    const c = block('.krig-pm-host .ProseMirror pre.krig-code-block');
    expect(px(prop(c, 'font-size'))).toBe(BLOCK_VISUAL_SPEC.code.fontSize);
    expect(parseFloat(prop(c, 'line-height'))).toBe(BLOCK_VISUAL_SPEC.code.lineHeight);
    expect(prop(c, 'background').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.code.bgFill);
    const border = prop(c, 'border'); // "1px solid #3a3a3a"
    expect(border.split(/\s+/)[2].toLowerCase()).toBe(BLOCK_VISUAL_SPEC.code.borderColor);
    expect(px(prop(c, 'border-radius'))).toBe(BLOCK_VISUAL_SPEC.code.radius);
    const padding = prop(c, 'padding'); // "12px 16px" = y x
    const [py, pxx] = padding.split(/\s+/);
    expect(px(py)).toBe(BLOCK_VISUAL_SPEC.code.padY);
    expect(px(pxx)).toBe(BLOCK_VISUAL_SPEC.code.padX);
    expect(prop(c, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.code.textColor);
  });

  it('horizontalRule(线宽/色;margin 1.5em@16=24px)', () => {
    const hr = block('.krig-pm-host .ProseMirror hr.krig-horizontal-rule');
    const borderTop = prop(hr, 'border-top'); // "1px solid #444"
    expect(px(borderTop.split(/\s+/)[0])).toBe(BLOCK_VISUAL_SPEC.horizontalRule.thickness);
    expect(borderTop.split(/\s+/)[2].toLowerCase()).toBe(BLOCK_VISUAL_SPEC.horizontalRule.color);
    // margin:1.5em 0 → 1.5 × 16(基准字号)= 24px
    const em = parseFloat(prop(hr, 'margin').split(/\s+/)[0]); // "1.5em"
    expect(em * BLOCK_VISUAL_SPEC.body.fontSize).toBe(BLOCK_VISUAL_SPEC.horizontalRule.marginY);
  });

  it('taskList(checkbox 尺寸/accent / gap / checked 色)', () => {
    const cb = block('.krig-pm-host .ProseMirror .krig-task-item__checkbox');
    expect(px(prop(cb, 'width'))).toBe(BLOCK_VISUAL_SPEC.taskList.checkboxSize);
    expect(px(prop(cb, 'height'))).toBe(BLOCK_VISUAL_SPEC.taskList.checkboxSize);
    expect(prop(cb, 'accent-color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.taskList.accentColor);
    const item = block('.krig-pm-host .ProseMirror li.krig-task-item');
    expect(px(prop(item, 'gap'))).toBe(BLOCK_VISUAL_SPEC.taskList.gap);
    const checked = block('.krig-pm-host .ProseMirror li.krig-task-item.checked > .krig-task-item__content');
    expect(prop(checked, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.taskList.checkedColor);
  });

  it('toggleList(箭头列宽/色 / gap)', () => {
    const arrow = block('.krig-pm-host .ProseMirror .krig-toggle-list__arrow');
    expect(px(prop(arrow, 'width'))).toBe(BLOCK_VISUAL_SPEC.toggle.arrowBox);
    expect(prop(arrow, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.toggle.arrowColor);
    const tl = block('.krig-pm-host .ProseMirror div.krig-toggle-list');
    expect(px(prop(tl, 'gap'))).toBe(BLOCK_VISUAL_SPEC.toggle.gap);
  });

  it('inline marks(code 橙字背景圆角 / link 蓝)', () => {
    const code = block('.krig-pm-host .ProseMirror code');
    expect(prop(code, 'background').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.marks.inlineCode.bgFill);
    expect(prop(code, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.marks.inlineCode.textColor);
    expect(px(prop(code, 'border-radius'))).toBe(BLOCK_VISUAL_SPEC.marks.inlineCode.radius);
    const link = block('.krig-pm-host .ProseMirror a[href]');
    expect(prop(link, 'color').toLowerCase()).toBe(BLOCK_VISUAL_SPEC.marks.link.color);
  });
});
