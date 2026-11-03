/**
 * X 文章每一步之后的核对(用户 11-03:「每一步执行完毕必须有一个好的检查方法」)——
 * 不只看这一步放进去没有,还看到这一步为止该有的都还在(11-03 真机:第 4 步小标题报成功、后来被插的图吃掉,第 8 步才露出来)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ inputEngine: {} }));
vi.mock('@platform/main/web-capability/wiring/web-collect-engine', () => ({ resolve: () => ({ pageId: 'p' }) }));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: () => ({}) }));

const { mismatch } = await import('@modules/x/x-post-article-fill');

const steps = [
  { k: 'heading', level: 1, text: '一、选择订阅' },
  { k: 'image', file: '/a.png' },
  { k: 'heading', level: 1, text: '二、创建VPS并安装节点' },
  { k: 'image', file: '/b.png' },
] as const;

describe('X 文章:每步之后核对前面的都还在', () => {
  it('都在 → 没问题', () => {
    expect(mismatch({ title: 'T', counts: { img: 2 }, text: '一、选择订阅 二、创建VPS并安装节点' }, 'T', steps, 2)).toEqual([]);
  });
  it('⭐ 前面粘的小标题被吃掉了 → 当场查出来', () => {
    expect(mismatch({ title: 'T', counts: { img: 2 }, text: '一、选择订阅' }, 'T', steps, 2).join()).toContain('二、创建VPS');
  });
  it('图少了 / 标题变了 → 查出来', () => {
    const bad = mismatch({ title: 'X', counts: { img: 1 }, text: '一、选择订阅 二、创建VPS并安装节点' }, 'T', steps, 2).join();
    expect(bad).toContain('图 1 / 2');
    expect(bad).toContain('标题');
  });
});
