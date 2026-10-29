/**
 * 推串手动排(用户 10-29「让用户自己拖动合并」):合并 / 分开 / 挪图 → composePost(nodes, layout) 照人排的出
 */
import { describe, it, expect } from 'vitest';
import { composePost, fillBlock, type PmNode } from '../../src/modules/x/x-post-compose';
import { mergeNext, moveMedia, splitBefore } from '../../src/modules/x/x-post-layout';

const t = (text: string): PmNode => ({ type: 'text', text });
const p = (s: string): PmNode => ({ type: 'paragraph', content: [t(s)] });
const img = (n: number): PmNode => ({ type: 'image', attrs: { src: `media://images/p${n}.png` } });
const hr: PmNode = { type: 'horizontalRule' };
const thread = (nodes: PmNode[], layout?: Parameters<typeof composePost>[1]) => {
  const plan = composePost(nodes, layout);
  return { plan, opt: plan.options.find((o) => o.form === 'thread')! };
};

/** 三条:甲+图1 / 乙 / 丙+图2 */
const doc = [p('甲'), img(1), hr, p('乙'), hr, p('丙'), img(2)];

describe('推串手动排', () => {
  it('自动排的件和分组;没人排时 manual=false', () => {
    const { plan, opt } = thread(doc);
    expect(opt.posts.map((x) => x.text)).toEqual(['甲 1/3', '乙 2/3', '丙 3/3']);
    expect(plan.threadEdit.items.map((i) => (i.k === 'text' ? i.text : 'img'))).toEqual(['甲', 'img', '乙', '丙', 'img']);
    expect(plan.threadEdit.posts).toEqual([[0, 1], [2], [3, 4]]);
    expect(plan.threadEdit.manual).toBe(false);
  });
  it('合并:第 1、2 条合成一条,字在前图在后;页码跟着变', () => {
    const e = thread(doc).plan.threadEdit;
    const l = mergeNext(e.key, e.items, e.posts, 0);
    expect(l.posts).toEqual([[0, 2, 1], [3, 4]]);
    const { plan, opt } = thread(doc, l);
    expect(plan.threadEdit.manual).toBe(true);
    expect(opt.posts.map((x) => [x.text, x.media.length])).toEqual([['甲\n\n乙 1/2', 1], ['丙 2/2', 1]]);
    expect(opt.note).toContain('手动');
  });
  it('分开:在某段字前分开,这条的图跟后半', () => {
    const e = thread([p('甲'), p('乙'), img(1)]).plan.threadEdit;
    expect(e.posts).toEqual([[0, 1, 2]]);
    const l = splitBefore(e.key, e.items, e.posts, 0, 1);
    expect(l.posts).toEqual([[0], [1, 2]]);
    expect(thread([p('甲'), p('乙'), img(1)], l).opt.posts.map((x) => [x.text, x.media.length])).toEqual([['甲 1/2', 0], ['乙 2/2', 1]]);
    expect(splitBefore(e.key, e.items, e.posts, 0, 0).posts).toEqual(e.posts);
  });
  it('挪图:图拖到别的条;挪空了的那条去掉', () => {
    const e = thread(doc).plan.threadEdit;
    expect(moveMedia(e.key, e.posts, 4, 1).posts).toEqual([[0, 1], [2, 4], [3]]);
    const solo = thread([p('甲'), hr, img(1)]).plan.threadEdit;
    expect(solo.posts).toEqual([[0], [1]]);
    expect(moveMedia(solo.key, solo.posts, 1, 0).posts).toEqual([[0, 1]]);
  });
  it('note 改了(key 对不上)→ 照自动排,warnings 里说', () => {
    const e = thread(doc).plan.threadEdit;
    const l = mergeNext(e.key, e.items, e.posts, 0);
    const { plan, opt } = thread([...doc, p('新加')], l);
    expect(plan.threadEdit.manual).toBe(false);
    expect(opt.posts.length).toBe(3);
    expect(plan.warnings.join()).toContain('手动排的分条用不上了');
  });
  it('note 改了字但件数没变 → 也照自动排(靠指纹认出来)', () => {
    const e = thread(doc).plan.threadEdit;
    const l = mergeNext(e.key, e.items, e.posts, 0);
    const changed = [p('丁'), ...doc.slice(1)];
    const { plan } = thread(changed, l);
    expect(plan.threadEdit.manual).toBe(false);
    expect(plan.warnings.join()).toContain('note 内容变了');
  });
  it('分组坏了(漏件 / 重复)→ 照自动排', () => {
    const e = thread(doc).plan.threadEdit;
    expect(thread(doc, { key: e.key, posts: [[0, 1], [2]] }).plan.threadEdit.manual).toBe(false);
    expect(thread(doc, { key: e.key, posts: [[0, 1, 1], [2, 3, 4]] }).plan.threadEdit.manual).toBe(false);
  });
  it('转图还在画和画好了是同一件(key 不变,人排的不丢)', () => {
    const math = { type: 'mathBlock', attrs: { latex: 'a' } } as PmNode;
    const before = thread([p('甲'), math, hr, p('乙')]).plan.threadEdit;
    const after = thread([p('甲'), { ...math, attrs: { latex: 'a', xImage: 'media://images/m.png' } }, hr, p('乙')]).plan.threadEdit;
    expect(after.key).toBe(before.key);
  });
  it('合并后一条超过 4 张图:不能填,说清楚', () => {
    const many = [p('甲'), img(1), img(2), img(3), hr, p('乙'), img(4), img(5)];
    const e = thread(many).plan.threadEdit;
    const { opt } = thread(many, mergeNext(e.key, e.items, e.posts, 0));
    expect(fillBlock(opt)).toContain('最多 4 张');
  });
});
