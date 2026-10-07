/**
 * ⭐ view 的 `commands` 字段:登记 → 等 wsId → 跑
 *
 * 2026-09-30 之前,每个模块要在 `renderer/index.tsx` 占**两行**
 * (具名 import + 显式调用),8 个模块共 16 行接线 →
 * 卸载一个模块要删两处,而 view 本身只要删一行 self-register。
 *
 * ⭐ 改成:模块在自己的 `registerView({ commands })` 里填,
 * registry 收着,renderer 只调一次 `runViewCommandRegistrars(wsId)`。
 *
 * ⚠️ 这里必须是**行为测试**不是源码扫描 ——
 * `toMatch(/commands:/)` 遇上 `void 0 && run()` 会全绿(文本在、行为没了)。
 * 见 feedback-source-scan-cant-see-execution。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { viewTypeRegistry, registerView, runViewCommandRegistrars }
  from '@slot/view-type-registry/view-type-registry';

/** 每个用例用独立 id,避免相互覆盖 */
let seq = 0;
const nextId = (): string => `test-view-${++seq}`;

describe('⭐ view commands 注册器', () => {
  beforeEach(() => {
    // @ts-expect-error 测试里重置内部态(registry 是单例)
    viewTypeRegistry.commandRegistrars = new Map();
    // @ts-expect-error 同上
    viewTypeRegistry.readyWsId = null;
  });

  it('⭐ 登记时不执行 —— 必须等 wsId', () => {
    const spy = vi.fn();
    registerView({ id: nextId(), install: [], commands: spy });
    expect(spy, '注册当场就跑了 —— 此时还没有本窗口 wsId,命令会注册到错的 ws 上')
      .not.toHaveBeenCalled();
  });

  it('⭐ runViewCommandRegistrars 把已登记的全跑掉,且传对 wsId', () => {
    const a = vi.fn(); const b = vi.fn();
    registerView({ id: nextId(), install: [], commands: a });
    registerView({ id: nextId(), install: [], commands: b });
    runViewCommandRegistrars('ws-7');
    expect(a).toHaveBeenCalledWith('ws-7');
    expect(b).toHaveBeenCalledWith('ws-7');
  });

  it('⭐⭐ 晚注册的 view 也要跑到 —— 否则它的命令静默没有', () => {
    /**
     * ⚠️ 真实风险:`onMyWsIdReady` 是**一次性**的(见 use-workspace.ts:41
     * 「若 myWsId 已就绪,立即同步调用」并 clear 监听器)。
     * 若 registry 只在那一刻跑一遍,之后注册的 view 永远不会被调用 ——
     * 现象是「这个 view 的快捷键/命令点了没反应」,而且不报错。
     */
    runViewCommandRegistrars('ws-3');          // wsId 先到
    const late = vi.fn();
    registerView({ id: nextId(), install: [], commands: late });   // view 后到
    expect(late, '晚注册的 view 没跑到 —— 它的命令会静默失效')
      .toHaveBeenCalledWith('ws-3');
  });

  it('没填 commands 的 view 不受影响', () => {
    expect(() => {
      registerView({ id: nextId(), install: [] });
      runViewCommandRegistrars('ws-1');
    }).not.toThrow();
  });

  it('⭐ 不会重复跑 —— 同一个 registrar 只登记一次', () => {
    const spy = vi.fn();
    const id = nextId();
    registerView({ id, install: [], commands: spy });
    registerView({ id, install: [], commands: spy });   // 同 id 覆盖注册
    runViewCommandRegistrars('ws-2');
    expect(spy, '同一个 view 重复注册后命令跑了多次 —— 会重复注册命令')
      .toHaveBeenCalledTimes(1);
  });
});
