/**
 * ContextInfoProviderRegistry — L4 右键上下文字段贡献者
 *
 * 设计(handoff: docs/tasks/context-menu-registry-handoff.md):
 * - L4 不知道任何业务字段(thoughtId / pmInstanceId / hasLink 等),
 *   全部由 capability / view 通过 register 贡献到 ContextInfo.custom
 * - use-context-menu-trigger 右键时遍历 all(),合并各 provider 输出到 custom
 *
 * 行为契约:
 * - 同 id 重复注册 → 后者覆盖,console.warn 一次(便于发现意外重复)
 * - provider 顺序无依赖,字段冲突走 Object.assign 后写胜
 * - provider 抛错被 try/catch 收住,console.error 后继续下个 provider(单 provider 故障
 *   不应阻断整个右键)
 */

export interface ContextInfoProvider {
  /** 注册者 id(如 'text-editing' / 'thought' / 'ebook')— 便于诊断,同 id 后注册覆盖 */
  id: string;
  /** 输出贡献到 ContextInfo.custom 的字段。target = 右键 e.target。 */
  provider: (target: HTMLElement) => Record<string, unknown>;
}

class ContextInfoProviderRegistry {
  private providers: ContextInfoProvider[] = [];

  register(p: ContextInfoProvider): void {
    const idx = this.providers.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      console.warn(`[contextInfoProviderRegistry] '${p.id}' re-registered, replacing previous`);
      this.providers[idx] = p;
    } else {
      this.providers.push(p);
    }
  }

  unregister(id: string): void {
    this.providers = this.providers.filter((p) => p.id !== id);
  }

  all(): ContextInfoProvider[] {
    return this.providers.slice();
  }

  /** 跑所有 provider 合并到 custom(单 provider 抛错不阻断后续)*/
  collect(target: HTMLElement): Record<string, unknown> {
    const custom: Record<string, unknown> = {};
    for (const p of this.providers) {
      try {
        Object.assign(custom, p.provider(target));
      } catch (err) {
        console.error(`[contextInfoProviderRegistry] provider '${p.id}' threw`, err);
      }
    }
    return custom;
  }
}

export const contextInfoProviderRegistry = new ContextInfoProviderRegistry();
