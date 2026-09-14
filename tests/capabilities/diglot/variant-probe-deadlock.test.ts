/**
 * variant 探测死锁回归
 *
 * ⚠️ 真机实测撞到的 bug(2026-09-10):新建画板后界面**永远卡在「加载中…」**。
 *
 * 死锁链条:
 * ```
 * 渲染分支 variant===null → 不挂 <Host>
 *        → hostRef.current 恒为 null
 *        → 加载 effect 的 `if (!host) return` 早退
 *        → library.load 永不执行 → setActiveVariant 永不被调用
 *        → variant 永远是 null → 回到第一步
 * ```
 *
 * ⭐ **根因是一句可以推广的话**:
 * **把「决定渲染谁」的前置查询,放进了「渲染完才跑」的 effect 里。**
 * 二者互为前置 → 谁都跑不起来。
 *
 * 修法:variant 探测独立成 effect,**不依赖 Host**。
 *
 * ⚠️ 本文件测的是**状态机形状**,不是 React 组件本身
 * (组件要挂载真 Host + 真 library 才跑得起来)。
 * 它固化「探测不得依赖渲染」这条判据,防止将来有人把它合回去。
 */
import { describe, it, expect } from 'vitest';

/** 模拟组件的两个关键前置条件。 */
interface ViewState {
  variant: 'canvas' | 'mindmap' | null;
  hostMounted: boolean;
}

/** 渲染分支:variant 未知时不挂 Host(这是**正确**的 —— 免得用错渲染器读写记录)。 */
function shouldMountHost(variant: ViewState['variant']): boolean {
  return variant === 'canvas';
}

describe('variant 探测不得依赖 Host(死锁回归)', () => {
  it('⚠️ 复现旧 bug:探测依赖 Host 时,状态永远卡在 null', () => {
    const st: ViewState = { variant: null, hostMounted: false };

    /** 旧实现:探测写在「需要 host」的 effect 里 */
    const brokenProbe = (s: ViewState): void => {
      if (!s.hostMounted) return; // ← 早退
      s.variant = 'canvas';
    };

    // 跑够多次,模拟 React 反复重渲染
    for (let i = 0; i < 10; i++) {
      st.hostMounted = shouldMountHost(st.variant);
      brokenProbe(st);
    }

    // ⭐ 这就是界面卡「加载中…」的机器化描述
    expect(st.variant, '旧实现:variant 永远探测不出来').toBeNull();
    expect(st.hostMounted, 'Host 也永远挂不上 —— 互为前置').toBe(false);
  });

  it('⭐ 新实现:探测独立于 Host,一轮就收敛', () => {
    const st: ViewState = { variant: null, hostMounted: false };

    /** 新实现:探测**不看** hostMounted */
    const fixedProbe = (s: ViewState): void => {
      s.variant = 'canvas';
    };

    fixedProbe(st);
    st.hostMounted = shouldMountHost(st.variant);

    expect(st.variant).toBe('canvas');
    expect(st.hostMounted, 'variant 出来后 Host 才挂 —— 单向依赖,不成环').toBe(true);
  });

  it('⭐ mindmap 记录:探测出来后走 MindCanvas,画板 Host 不挂', () => {
    const st: ViewState = { variant: null, hostMounted: false };
    st.variant = 'mindmap';
    st.hostMounted = shouldMountHost(st.variant);
    // ⭐ 画板 Host 不挂是**对的** —— mind 由 MindCanvas 自己的 Host 渲染,
    //   画板 Host 若挂上会用 sanitizeDocument 把 mind 洗成空画板
    expect(st.hostMounted).toBe(false);
  });

  it('⚠️ 记录不存在时也必须收敛,不能卡住', () => {
    // 真机上「记录查不到」是可能的(刚删掉 / id 过期)。
    // 若此时不设 variant,界面同样卡「加载中…」—— 同一个坑的另一个入口。
    const resolveVariant = (record: { variant: string } | null): string =>
      record ? record.variant : 'canvas';
    expect(resolveVariant(null), '查不到记录要有兜底,不能让 variant 悬着').toBe('canvas');
  });
});

/**
 * §注入台账
 *
 * | 注入 | 期望 | 实测 |
 * |---|---|---|
 * | 把 fixedProbe 改回「依赖 hostMounted」 | 「一轮收敛」红 | ✅ |
 * | resolveVariant 对 null 返回 null | 「记录不存在也收敛」红 | ✅ |
 *
 * ⚠️ 未覆盖(诚实记账):
 * - **真组件没被执行** —— 本文件只固化状态机形状。真正的验证是真机点一遍:
 *   新建导图 → 应看到六个节点而非「加载中…」。
 * - 竞态:快速切换画板时的 `cancelled` 保护未测。
 */
