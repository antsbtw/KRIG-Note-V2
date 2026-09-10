/**
 * ⭐⭐ 几何 shape 撑高 + 「拖过就锁」—— 两者互为前提
 *
 * 用户拍板:「shape 是服务于文字的,不是一个固定的长宽比。」
 * 于是几何 shape(圆角矩形等)内容溢出也要撑高,不再只有纯文字框才撑。
 *
 * ⚠️ 这两件事**必须成对存在**:
 *   放开撑高但没有「拖过就锁」→ 用户拖高的框会被内容改回去(像拖动没生效);
 *   有锁但没放开撑高 → 锁了个寂寞。
 * 任一半被删掉,画板就退化,所以两条都钉住。
 *
 * ⚠️ 测不到 three(node 环境无 WebGL),故守的是**代码事实**,
 * 并且**剥掉注释再比** —— 同样的话往往也写在注释里,只比字符串会被注释骗过
 * (这个坑刚在 magnet-actions 踩过)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/** 读文件并**剥掉注释行** —— 守卫只该看会执行的东西 */
const readCode = (p: string): string =>
  readFileSync(resolve(ROOT, p), 'utf-8')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

describe('几何 shape 撑高', () => {
  it('⭐⭐ 几何 shape 的文字层不再硬编码 autogrow=false', () => {
    const code = readCode('src/capabilities/canvas-rendering/scene/NodeRenderer.ts');
    // 几何路径那次调用要读 shape.textGrows(缺省 true),不能是写死的 false
    expect(code).toMatch(/}, shape\.textGrows \?\? true, insetY\);/);
    expect(
      /\}, false\);/.test(code),
      '几何 shape 又被写回 autogrow=false → 文字溢出框外不撑高',
    ).toBe(false);
  });

  it('⭐ 撑高要把 textBox 的上下内缩量加回去(否则文字顶到圆角边缘被裁)', () => {
    const code = readCode('src/capabilities/canvas-rendering/scene/NodeRenderer.ts');
    expect(code).toContain('adaptTextNodeSizeToContent(inst.id, current, contentH + insetY)');
  });

  it('⚠️ size_lock.h 的保护还在(手动定高的节点不该被撑)', () => {
    const code = readCode('src/capabilities/canvas-rendering/scene/NodeRenderer.ts');
    expect(code).toMatch(/if \(inst\?\.size_lock\?\.h\) return;/);
  });
});

describe('拖过就锁(size_lock.h)', () => {
  it('⭐⭐ resize 改到高度时必须写 size_lock.h —— 否则撑高会吃掉用户的拖动', () => {
    const code = readCode('src/capabilities/canvas-rendering/interaction/InteractionController.ts');
    expect(
      code,
      'applyResize 不写 size_lock.h → 用户拖高后下次渲染又被内容改回去',
    ).toMatch(/size_lock = \{ \.\.\.inst\.size_lock, h: true \}/);
  });

  it('⚠️ 只有真的改到高才锁(纯 E/W 拖动只改宽,不该顺手锁死高)', () => {
    const code = readCode('src/capabilities/canvas-rendering/interaction/InteractionController.ts');
    expect(code).toMatch(/if \(dir\.y !== 0 \|\| isCorner\)/);
  });
});
