/**
 * EnabledWhenRegistry — L4 右键 enabledWhen 谓词贡献者
 *
 * 设计(handoff: docs/tasks/context-menu-registry-handoff.md):
 * - L4 不知道有哪些 enabledWhen 值(EnabledWhen 字面变 string)
 * - capability / view 通过 register(name, predicate) 贡献
 * - context-menu-registry.getItemsForContext 过滤时调 eval(name, ctx)
 *
 * builtin(通用 DOM 概念,L4 自管):
 * - 'always'         总是 true
 * - 'has-selection'  ctx.hasSelection
 * - 'is-editable'    ctx.isEditable
 *
 * 行为契约:
 * - 找不到 predicate → 字面 fallback () => true(不报错破回归),console.warn 一次去重
 *   (同名只 warn 一次,避免每次右键刷屏)
 * - 同名重复注册 → 后者覆盖,console.warn 一次
 * - predicate 抛错 → 当作 false(更保险:有问题宁可隐藏 item 也不误显)
 */

import type { ContextInfo } from './context-menu-registry/context-menu-types';

export type EnabledWhenPredicate = (ctx: ContextInfo) => boolean;

class EnabledWhenRegistry {
  private predicates = new Map<string, EnabledWhenPredicate>();
  private warnedMissing = new Set<string>();

  constructor() {
    this.predicates.set('always', () => true);
    this.predicates.set('has-selection', (ctx) => ctx.hasSelection);
    this.predicates.set('is-editable', (ctx) => ctx.isEditable);
  }

  register(name: string, pred: EnabledWhenPredicate): void {
    if (this.predicates.has(name)) {
      console.warn(`[enabledWhenRegistry] '${name}' re-registered, replacing previous`);
    }
    this.predicates.set(name, pred);
  }

  unregister(name: string): void {
    this.predicates.delete(name);
  }

  eval(name: string, ctx: ContextInfo): boolean {
    const pred = this.predicates.get(name);
    if (!pred) {
      if (!this.warnedMissing.has(name)) {
        console.warn(
          `[enabledWhenRegistry] no predicate for '${name}', falling back to true (item will always show)`,
        );
        this.warnedMissing.add(name);
      }
      return true;
    }
    try {
      return pred(ctx);
    } catch (err) {
      console.error(`[enabledWhenRegistry] predicate '${name}' threw`, err);
      return false;
    }
  }
}

export const enabledWhenRegistry = new EnabledWhenRegistry();
