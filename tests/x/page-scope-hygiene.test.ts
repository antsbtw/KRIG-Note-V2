import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 采集的**归属**要干净 —— 2026-09-20 逐页验证时实测暴露的两处。
 *
 * 都属于同一个根因:代码假设「所有采人的页面都属于某个 handle、
 * 都是一个稳定名单」,而通知页两条都不满足。
 */
describe('⭐⭐ 页面归属与快照卫生', () => {
  const collect = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));
  const handler = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/ipc/web-console-handler.ts'), 'utf-8'));

  it('⭐⭐⭐ 只有「稳定名单」页才写快照 —— 流水页写了会产出假结论', () => {
    /**
     * 实测:采通知页 374 人**也写进了快照**。但通知页的人不是名单
     * (今天谁点赞就是谁),做差集会报「373 人取关」——
     * ⚠️ **那种数字看起来像结论**,比没有更糟。
     */
    const assign = collect.match(/const mayWriteSnapshot\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 mayWriteSnapshot 的赋值').toBeTruthy();
    expect(
      assign,
      '写快照没有限定页面类型 —— 通知页/搜索页会写出无意义的「名单」,'
      + '下次差集报出假的「谁取关了」',
    ).toMatch(/isListPage/);

    /** ⚠️ 钉**白名单的内容**,不是「出现过 isListPage」 */
    const list = collect.match(/const isListPage\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(list, '找不到 isListPage 的赋值').toBeTruthy();
    expect(list, '白名单里没有 followers').toMatch(/followers/);
    expect(list, '白名单里没有 following').toMatch(/following/);
    expect(
      list,
      '白名单把通知页放进来了 —— 通知页不是名单',
    ).not.toMatch(/notifications|search|home/);
  });

  it('⭐⭐ 没有 handle 的页面不能留空尾巴(x.notifications:)', () => {
    /**
     * 实测:list_source 存成 `x.notifications:` —— 冒号后面是空的,
     * 因为通知页不带 handle 而这里无条件拼 `:${handle ?? ''}`。
     * ⚠️ 更要紧:通知页归属的是**该 ws 登录的账号**,不是 URL 参数里的谁 ——
     * 多账号时两个 ws 的通知人会混进同一个 scope,分不开。
     */
    const i = handler.indexOf('pageLabel:');
    expect(i, '找不到 pageLabel 的构造').toBeGreaterThan(0);
    const blk = handler.slice(i, i + 500);
    expect(
      blk,
      'pageLabel 仍然无条件拼 `:${handle ?? \'\'}` —— 没有 handle 的页面会留空尾巴',
    ).not.toMatch(/\$\{pageName\}:\$\{\(p\.params[^}]*\?\?\s*''\)/);
    expect(
      blk,
      '没有 handle 时没有退路 —— 多 ws 的通知人会混进同一个 scope',
    ).toMatch(/wsId|ws\b/);
  });

  it('⭐ 名单页的归属仍然按 handle(回归)', () => {
    const i = handler.indexOf('pageLabel:');
    const blk = handler.slice(i, i + 500);
    expect(blk, '有 handle 时不再用 handle 做归属了').toMatch(/pageName\}:\$\{h\}|`\$\{pageName\}:/);
  });
});
