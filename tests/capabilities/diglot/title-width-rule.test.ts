/**
 * ⭐⭐ 宽度由 **hn(标题)那一行**决定(用户 2026-09-11)
 *
 * > 「图元的渲染方式首先就错了,应该**按照 hn 的长度来确定主题框的长度**,
 * >  除非用户手动缩短。」
 *
 * ⚠️ 我先前的规则是「取最宽那一行(含正文)」——方向就不对。
 * 后果链(真机实测):
 *   标题装不下 → 折成两行 → 框比 ELK 估算高 ~28px
 *   → 渲染层撑高 → **把兄弟间距吃掉**(实测同层间距 85px 只剩 11px)
 * ⭐ 所以「标题一行装下」不只是好看,它还是**布局稳定的前提**。
 */
import { describe, it, expect } from 'vitest';
import {
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  TEXT_INSET_PX,
  type LayoutAnswer,
} from '@capabilities/diglot-model/project-to-canvas';
import { noteDocToTree } from '@capabilities/diglot-model/note-projection';
import { BLOCK_VISUAL_SPEC, headingFontSize } from '../../../src/lib/visual-spec/block-visual-spec';

const TITLE = '分支Achang123';

const tree = () =>
  noteDocToTree({
    format: 'pm-doc-json', version: '0.1',
    payload: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
      { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: TITLE }] },
      { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '123' }] },
      { type: 'paragraph', attrs: { id: 'b2' }, content: [{ type: 'text', text: '这一行正文远远比标题长得多得多得多得多' }] },
      { type: 'heading', attrs: { level: 2, id: 'b' }, content: [{ type: 'text', text: '分支B' }] },
    ] },
  });

const project = () => {
  const s = tree();
  const g = new Map();
  const req = buildLayoutRequest(s, g);
  const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 137, y: i * 80 })) };
  return projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id));
};

/** 该字号下这串字的像素宽(与 measureText 同口径) */
const textW = (t: string, fs: number): number => {
  let w = 0;
  for (const ch of t) w += /[一-鿿぀-ゟ゠-ヿ　-〿＀-￯]/.test(ch) ? fs : fs * 0.55;
  return Math.round(w);
};

describe('宽度由标题决定', () => {
  it('⭐⭐ 标题必须**一行装得下**(否则折行 → 撑高 → 吃掉兄弟间距)', () => {
    const inst = project();
    const a = inst.find((i) => i.id === 'a')!;
    const fs = headingFontSize(2); // 深度 1 → h2
    const pad = Math.round(fs * 1.6);
    expect(
      a.size!.w,
      `宽度 ${a.size!.w} 装不下标题(需 ${textW(TITLE, fs) + pad}) → 标题会折行`,
    ).toBeGreaterThanOrEqual(textW(TITLE, fs) + pad);
  });

  it('⭐⭐ 正文再长也**不撑宽**框(正文在框内折行,由标题定宽)', () => {
    const inst = project();
    const a = inst.find((i) => i.id === 'a')!;
    const fs = headingFontSize(2);
    const pad = Math.round(fs * 1.6);
    const longBody = textW('这一行正文远远比标题长得多得多得多得多', BLOCK_VISUAL_SPEC.body.fontSize);
    // 框宽应贴着标题走,而不是被那行长正文撑开
    expect(a.size!.w, '正文把框撑宽了 —— 应由标题定宽,正文折行').toBeLessThan(longBody + pad);
  });

  it('⭐ 同层**各自按自己的 hn** 定宽(用户 2026-09-11 推翻了"同层同宽")', () => {
    const inst = project();
    const a = inst.find((i) => i.id === 'a')!; // 长标题
    const b = inst.find((i) => i.id === 'b')!; // 短标题
    expect(b.size!.w, '短标题被撑到与长标题同宽 —— 用户已明确不要这样').toBeLessThan(a.size!.w);
  });
});

/**
 * ⭐⭐ 估算高度必须 **≥ 渲染高度**(否则撑高会吃掉兄弟间距)
 *
 * ⚠️ 真机现象:同层间距 85px 只剩 11px。
 * 链条:标题折行 → 实际比估算高 ~28px → 渲染层撑高 → 差多少就吃掉多少间距。
 * ⭐ 只要「估算 ≥ 渲染」,撑高就**不会触发**(adaptTextNodeSizeToContent 里
 *   `newH <= size.h + 1` 直接 return),间距自然保住。
 */
describe('估算高度不低于渲染高度', () => {
  const LINE = BLOCK_VISUAL_SPEC.body.lineHeight;
  const BODY = BLOCK_VISUAL_SPEC.body.fontSize;

  it('⭐⭐ 带正文的节点:估算高 ≥ 渲染内容高 + 撑高阈值', () => {
    const inst = project();
    const a = inst.find((i) => i.id === 'a')!;

    // 渲染层(textBlock)按块累加:标题 h2 一行 + 两块正文各一行,均 ×1.7
    const fs = headingFontSize(2);
    const renderH = Math.round(fs * LINE) + Math.round(BODY * LINE) * 2;
    const ADAPT_PADDING = 8; // NodeRenderer.adaptTextNodeSizeToContent
    // ⚠️⚠️ 本断言原来**漏了 insetY** —— 它与被测代码犯了同一个疏忽,
    //   所以永远抓不到「高度没覆盖上下内缩」这个 bug(真机日志才抓到)。
    // ⭐ 教训:守卫若照抄实现的公式,就只能验证"实现和自己一致",验不出漏项。
    //   必须按**渲染层真正要的东西**列全:内容 + 内缩 + 撑高阈值。
    // ⭐ 内缩已固定 10px(TEXT_INSET_PX),不再按比例
    const insetY = 2 * TEXT_INSET_PX;
    const need = Math.ceil(renderH + insetY) + ADAPT_PADDING;

    expect(
      a.size!.h,
      `估算 ${a.size!.h} < 渲染 ${need} → 会触发撑高 → 吃掉兄弟间距`,
    ).toBeGreaterThanOrEqual(need);
  });

  it('⭐ 纯标题节点同理(不能因为没正文就估算不足)', () => {
    const inst = project();
    const b = inst.find((i) => i.id === 'b')!;
    const fs = headingFontSize(2);
    expect(b.size!.h).toBeGreaterThanOrEqual(Math.round(fs * LINE) + 8);
  });
});
