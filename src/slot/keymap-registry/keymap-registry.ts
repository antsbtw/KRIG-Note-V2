/**
 * KeymapRegistry — view 全局快捷键注册中心(W4.1)
 *
 * view 注册时通过 ViewDefinition.keymap 字段声明绑定,view-type-registry
 * 在 distributeToRegistries 阶段把 keymap 拆到本 registry。
 *
 * 见 docs/RefactorV2/audit/wave4-design/W4.1-keymap-registrar.md § 4.2。
 */

import type { KeymapBinding } from './keymap-types';

/** key 表达式标准化:小写 + 修饰键固定顺序 mod, shift, alt */
function normalizeKey(expr: string): string {
  const parts = expr.toLowerCase().split('+').map((s) => s.trim());
  const mods = new Set(parts.slice(0, -1));
  const main = parts[parts.length - 1];
  const ordered: string[] = [];
  if (mods.has('mod')) ordered.push('mod');
  if (mods.has('shift')) ordered.push('shift');
  if (mods.has('alt')) ordered.push('alt');
  ordered.push(main);
  return ordered.join('+');
}

class KeymapRegistry {
  /** viewId → bindings[];binding.key 内部存"标准化"形态(小写+顺序)*/
  private bindings: Map<string, KeymapBinding[]> = new Map();

  register(viewId: string, bindings: KeymapBinding[]): void {
    if (this.bindings.has(viewId)) {
      console.warn(`[L4] KeymapRegistry: '${viewId}' already registered, overwriting`);
    }
    this.bindings.set(
      viewId,
      bindings.map((b) => ({ ...b, key: normalizeKey(b.key) })),
    );
  }

  unregisterByView(viewId: string): void {
    this.bindings.delete(viewId);
  }

  /**
   * 给定标准化 key 表达式 + 当前活跃 view id,返回匹配的 binding(无则 null)。
   * keymap-listener 调用,enabledWhen 校验由 listener 自己跑。
   */
  match(viewId: string, normalizedKey: string): KeymapBinding | null {
    const list = this.bindings.get(viewId);
    if (!list) return null;
    return list.find((b) => b.key === normalizedKey) ?? null;
  }

  /** 诊断 */
  get count(): number {
    let total = 0;
    for (const list of this.bindings.values()) total += list.length;
    return total;
  }

  /** view 数(诊断)*/
  get viewCount(): number {
    return this.bindings.size;
  }
}

export const keymapRegistry = new KeymapRegistry();

/** 内部工具导出(给 listener 用,view 注册侧不应直接用)*/
export { normalizeKey };
