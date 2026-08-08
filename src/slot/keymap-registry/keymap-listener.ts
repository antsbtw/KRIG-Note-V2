/**
 * Keymap listener — 全局 keydown 路由(W4.1)
 *
 * renderer 启动时调一次 startKeymapListener(),返回 dispose 函数。
 *
 * 路径(对齐设计文档 § 4.3):
 * 1. 解析 keydown event → 标准化 key 表达式(如 'mod+k')
 * 2. 查活跃 view ID(target 向上找 [data-view-id],找不到 fallback slotBinding.left)
 * 3. keymapRegistry.match(viewId, key) 拿 binding
 * 4. enabledWhen 数组逐项校验 AND;listener 不内置任何 baseline 条件
 * 5. 通过 → e.preventDefault() + commandRegistry.execute(binding.command)
 */

import { commandRegistry } from '../command-registry/command-registry';
import { getActiveWorkspaceIdSync } from '@workspace/workspace-instance/use-workspace';
import { getActiveSlot, resolveActiveViewId } from '@workspace/workspace-state/active-slot';
import { keymapRegistry, normalizeKey } from './keymap-registry';
import type { KeymapBinding, KeymapCondition } from './keymap-types';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';

/** keydown event → 'mod+k' / 'mod+shift+k' / 'mod+[' 等 */
function eventToKey(e: KeyboardEvent): string | null {
  // 单 modifier 按下(没有真正 key)→ 不响应
  const k = e.key;
  if (!k || k === 'Meta' || k === 'Control' || k === 'Shift' || k === 'Alt') {
    return null;
  }
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push('mod');
  if (e.shiftKey) mods.push('shift');
  if (e.altKey) mods.push('alt');
  // event.key 大小写不一(Shift 时可能大写),统一小写
  mods.push(k.toLowerCase());
  return normalizeKey(mods.join('+'));
}

/** 事件 target 向上找最近 [data-view-id]。找不到返回 null */
function findTargetViewId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>('[data-view-id]');
  return el?.dataset.viewId ?? null;
}

type GetWs = (id: string) => WorkspaceState | null | undefined;
let _getWs: GetWs = () => null;

/**
 * 退化路径:事件 target 上找不到 [data-view-id] 时,按**活跃槽**装的 view 算。
 *
 * feat/slot-navside-follow-active:原实现恒取 slotBinding.left(旧 charter
 * "主 view 在 left")。左右对称化后 left 不再天然是主 view —— 焦点在右栏时
 * 快捷键会跑去操作左栏的 view。改读 activeSlot 单一来源。
 * 活跃槽为空(如 right 尚未装 view)时回落另一槽,保持有 view 可匹配。
 */
function fallbackActiveViewId(): string | null {
  const wsId = getActiveWorkspaceIdSync();
  if (!wsId) return null;
  const ws = _getWs(wsId);
  if (!ws) return null;
  return resolveActiveViewId(ws.slotBinding, getActiveSlot(wsId));
}

/** enabledWhen 单项校验 */
function checkCondition(
  cond: KeymapCondition,
  e: KeyboardEvent,
  viewId: string,
): boolean {
  switch (cond) {
    case 'has-text-selection': {
      const sel = window.getSelection();
      return sel !== null && !sel.isCollapsed && sel.toString().length > 0;
    }
    case 'in-view-area': {
      // 事件 target 必须在 [data-view-id="<viewId>"] 子树内
      if (!(e.target instanceof Element)) return false;
      const el = e.target.closest<HTMLElement>(`[data-view-id="${viewId}"]`);
      return el !== null;
    }
    case 'not-in-input': {
      const t = e.target;
      if (!(t instanceof Element)) return true;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
      // contenteditable 检查(closest 兜住嵌套)
      const editable = t.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""]');
      return editable === null;
    }
  }
}

function checkAllConditions(
  binding: KeymapBinding,
  e: KeyboardEvent,
  viewId: string,
): boolean {
  if (!binding.enabledWhen || binding.enabledWhen.length === 0) return true;
  return binding.enabledWhen.every((c) => checkCondition(c, e, viewId));
}

function handler(e: KeyboardEvent): void {
  const key = eventToKey(e);
  if (!key) return;
  const viewId = findTargetViewId(e.target) ?? fallbackActiveViewId();
  if (!viewId) return;
  const binding = keymapRegistry.match(viewId, key);
  if (!binding) return;
  if (!checkAllConditions(binding, e, viewId)) return;
  e.preventDefault();
  commandRegistry.execute(binding.command);
}

let started = false;

/**
 * 启动全局 keymap 监听。idempotent — 重复调用不会装多个 listener。
 * 返回 dispose 函数(测试 / HMR 用,生产路径不需要 dispose)。
 * getWs — 注入的 ws 查询函数(通常 workspaceManager.get.bind(workspaceManager))。
 */
export function startKeymapListener(getWs: GetWs): () => void {
  _getWs = getWs;
  if (started) return () => {};
  started = true;
  window.addEventListener('keydown', handler);
  return () => {
    started = false;
    window.removeEventListener('keydown', handler);
  };
}
