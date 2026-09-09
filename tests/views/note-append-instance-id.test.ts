/**
 * 跨 view 插入命令的 instanceId 守卫(fix:append-pm-nodes 传裸 wsId)
 *
 * ## 这个 bug 长什么样
 *
 * `note-view.append-ai-turn` / `note-view.append-pm-nodes` 曾把**裸 wsId** 当 PM
 * instanceId 传给 driver,而 NoteView 注册用的是 `noteInstanceId(wsId, slot)` =
 * `${wsId}::slot:${slot}`。driver 的 insertNodes* 第一行 `registry.get(id)` 拿不到实例
 * 就 early-return false —— **静默 no-op,控制台零报错**,现象是「Gemini 整页提取成功,
 * 但右栏 Note 里什么都没出现」+ 弹「插入失败:右栏 Note 尚未就绪」。
 *
 * 静默失败最难回归,所以这里钉死。
 *
 * ## 为什么是行为测试而不是扫源码
 *
 * 扫源码只能守住「没写裸 wsId」这个**形状**;本测试跑真的 `registerNoteCommands` +
 * 真的 `commandRegistry.execute`,断言命令算出来的 id **能被一个按 per-slot 形态注册的
 * 实例接住** —— 同时守住「id 对得上」和「真的插进去了」两件事。
 *
 * fake 的只有 driver 一侧(记下收到的 instanceId),被测逻辑(note-commands.ts 里
 * 解析槽 → 拼 instanceId)是真代码,没有在测试里复刻一遍。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** driver fake:只认按 `${wsId}::slot:${slot}` 注册的实例(与 NoteView 真实形态一致)*/
const registered = new Map<string, { inserted: unknown[][] }>();
/** 命令实际传给 driver 的 instanceId(断言用)*/
let lastInstanceId: string | null = null;

function insert(instanceId: string, nodes: unknown[]): boolean {
  lastInstanceId = instanceId;
  const inst = registered.get(instanceId);
  if (!inst) return false; // ← 真 driver 的行为:拿不到实例就静默返 false
  inst.inserted.push(nodes);
  return true;
}

const textEditingApi = {
  api: {
    insertNodesAtEnd: (id: string, nodes: unknown[]) => insert(id, nodes),
    insertNodesAtCursorOrEnd: (id: string, nodes: unknown[]) => insert(id, nodes),
  },
};

vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => textEditingApi),
  requireCapabilityApi: vi.fn(() => textEditingApi),
}));

const WS = 'ws-guard-1';

/** slotBinding 由每个用例设定 —— 命令要按它找 note-view 真正在哪一栏 */
let slotBinding: { left: string | null; right: string | null } = {
  left: 'ai-view',
  right: 'note-view',
};

vi.mock('@workspace/workspace-state/workspace-manager', () => ({
  workspaceManager: {
    get: (id: string) => (id === WS ? { slotBinding } : undefined),
    getBus: () => undefined,
    getActiveId: () => WS,
  },
}));

import { commandRegistry } from '@slot/command-registry/command-registry';
import { registerNoteCommands } from '@views/note/note-commands';
import { noteInstanceId } from '@views/note/data-model';
import { setActiveSlot } from '@workspace/workspace-state/active-slot';

/** 一个最小可插入的 PM 节点(paragraph 带一行文字)*/
const NODE = {
  type: 'paragraph',
  content: [{ type: 'text', text: 'hello' }],
};

beforeEach(() => {
  registered.clear();
  lastInstanceId = null;
  slotBinding = { left: 'ai-view', right: 'note-view' };
  registerNoteCommands(WS);
});

describe('append-pm-nodes 的 instanceId 必须对上 NoteView 的 per-slot 注册', () => {
  it('左 AI + 右 Note:插到右栏那个实例(报障复现路径)', () => {
    // NoteView 按真实形态注册在 right 槽
    const rightId = noteInstanceId(WS, 'right');
    registered.set(rightId, { inserted: [] });

    const ok = commandRegistry.execute('note-view.append-pm-nodes', {
      nodes: [NODE],
      mode: 'cursor-or-end',
    });

    expect(
      ok,
      `命令返 false = 没插进去。实际传给 driver 的 instanceId 是 '${lastInstanceId}',` +
        `而实例注册在 '${rightId}'。\n` +
        `→ 传裸 wsId('${WS}')就是本 bug 的原形态:registry.get() 拿不到,静默 no-op。`,
    ).toBe(true);
    expect(lastInstanceId).toBe(rightId);
    expect(registered.get(rightId)!.inserted).toEqual([[NODE]]);
  });

  it('裸 wsId 不是合法 instanceId(反向锁:传裸 wsId 必须失败)', () => {
    // 只按 per-slot 形态注册 —— 若命令传裸 wsId,这里永远拿不到
    registered.set(noteInstanceId(WS, 'right'), { inserted: [] });

    commandRegistry.execute('note-view.append-pm-nodes', {
      nodes: [NODE],
      mode: 'end',
    });

    expect(
      lastInstanceId,
      '命令把裸 wsId 当 instanceId 传给了 driver —— 这正是本 bug。',
    ).not.toBe(WS);
  });

  it('Note 在左栏(左 Note + 右 X):插到左栏', () => {
    slotBinding = { left: 'note-view', right: 'x-view' };
    const leftId = noteInstanceId(WS, 'left');
    registered.set(leftId, { inserted: [] });

    const ok = commandRegistry.execute('note-view.append-pm-nodes', {
      nodes: [NODE],
      mode: 'cursor-or-end',
    });

    expect(ok).toBe(true);
    expect(lastInstanceId).toBe(leftId);
  });

  it('两栏都是 Note:由 activeSlot 决胜', () => {
    slotBinding = { left: 'note-view', right: 'note-view' };
    registered.set(noteInstanceId(WS, 'left'), { inserted: [] });
    registered.set(noteInstanceId(WS, 'right'), { inserted: [] });

    setActiveSlot(WS, 'right');
    commandRegistry.execute('note-view.append-pm-nodes', { nodes: [NODE], mode: 'end' });
    expect(lastInstanceId).toBe(noteInstanceId(WS, 'right'));

    setActiveSlot(WS, 'left');
    commandRegistry.execute('note-view.append-pm-nodes', { nodes: [NODE], mode: 'end' });
    expect(lastInstanceId).toBe(noteInstanceId(WS, 'left'));
  });

  it('没有 note-view 在场:返 false 且不静默假装成功(fail loud)', () => {
    slotBinding = { left: 'ai-view', right: 'x-view' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = commandRegistry.execute('note-view.append-pm-nodes', {
      nodes: [NODE],
      mode: 'end',
    });

    expect(ok).toBe(false);
    expect(err).toHaveBeenCalled(); // 不许静默兜底
    err.mockRestore();
  });
});

describe('append-ai-turn 走同一条 instanceId 解析(auto-sync 路径)', () => {
  it('左 AI + 右 Note:插到右栏那个实例', () => {
    const rightId = noteInstanceId(WS, 'right');
    registered.set(rightId, { inserted: [] });

    const ok = commandRegistry.execute('note-view.append-ai-turn', {
      serviceId: 'claude',
      turn: { userMessage: '问', markdown: '答', timestamp: Date.now() },
      mode: 'end',
    });

    expect(
      ok,
      `实际 instanceId='${lastInstanceId}',期望 '${rightId}'(传裸 wsId 会静默 no-op)`,
    ).toBe(true);
    expect(lastInstanceId).toBe(rightId);
  });
});
