/**
 * `/def` slash 入口 —— 骨架生成与别名自动分配(`00 §2.5.7`)
 *
 * ⚠️ 光有 `+++` 记号不够:**用户不知道要写什么**(`id:` 还是 `ID:`?
 * `-.->` 还是 `-->`?)。⭐ slash 一敲直接给骨架,并**自动分配别名** ——
 * 这是方案丙「系统兜底」的自然落点(`00 §2.5.4`)。
 *
 * ⭐⭐ **名字只有一个,入口可以很多**(用户 2026-09-13):
 * 文档与代码只认 `def`,但 `/meta`、`/图元`、`/graphmeta` 都搜得到同一项 ——
 * 把「叫什么」的分歧降到最小。
 *
 * ── 本文件钉住什么 ─────────────────────────────────────
 * 1. 骨架能被自己的解析器读懂(⭐ **产出必须是合法 def 块**)
 * 2. ⭐⭐ 别名**按文档已用的自动顺延**,不与现有别名撞车
 * 3. ⭐ 多入口:keywords 覆盖用户可能的几种说法
 * 4. ⚠️ 只注册到图种 viewId,**绝不注册到 note-view**(否则就是给 note
 *    加了图种专属功能,撞「mind 适应 note」铁律)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDefBlock, parseDefBlock, defValue } from '@capabilities/diglot-model/def-block';
import { buildDefSkeleton, nextDefAlias } from '@capabilities/diglot-model/def-block';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

describe('/def 骨架与别名分配', () => {
  it('⭐⭐ 产出的骨架必须是**自己解析器认得的** def 块', () => {
    const node = buildDefSkeleton('A');
    expect(isDefBlock(node), '⚠️ /def 产出的东西自己都不认 —— 那是白插').toBe(true);
    expect(defValue(parseDefBlock(node), 'id')).toBe('A');
  });

  it('⭐⭐ 别名顺延:躲开文档里已用的', () => {
    expect(nextDefAlias([])).toBe('A');
    expect(nextDefAlias(['A'])).toBe('B');
    expect(nextDefAlias(['A', 'B', 'C'])).toBe('D');
    // ⚠️ 不是简单数个数:中间空缺时要取**第一个没被占的**
    expect(nextDefAlias(['A', 'C'])).toBe('B');
  });

  it('⭐ 超过 26 个后不塌缩成重复(Z 之后继续给得出新名)', () => {
    const all = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    const next = nextDefAlias(all);
    expect(next, '⚠️ 26 个用完后必须还能给出新别名').not.toBe('');
    expect(all.includes(next), '⚠️ 给出的别名与已用的撞车了').toBe(false);
  });

  it('⭐ 多入口:keywords 覆盖 def/meta/图元 等说法', () => {
    const src = read('src/views/graph-canvas-view/mind-semantic-menus.ts');
    // ⚠️ 剥注释再比 —— 注释里也会写这些词(铁律 §4.1 教训 1)
    const code = src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    for (const kw of ['def', 'meta', '图元']) {
      expect(code.includes(`'${kw}'`), `⚠️ keywords 缺「${kw}」—— 用户按这个说法搜不到`).toBe(true);
    }
  });

  it('⚠️⚠️ 绝不注册到 note-view(撞「mind 适应 note」铁律)', () => {
    const src = read('src/views/graph-canvas-view/mind-semantic-menus.ts');
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(
      code.includes("'note-view'") || code.includes('"note-view"'),
      '⚠️⚠️ def 项注册到了 note-view —— 那是给 note 加图种专属功能',
    ).toBe(false);
  });
});
