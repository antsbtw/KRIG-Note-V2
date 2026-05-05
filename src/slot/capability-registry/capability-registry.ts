/**
 * CapabilityRegistry — 能力注册中心
 *
 * 按 charter § 1.4:能力是 V2 业务模块的真正所在。view 通过 install 列表
 * 引用能力 ID,L4 帮 view 装配。
 *
 * 按 Q5=B(避免过度设计):
 * - L4 阶段实施最小集(register / get / has)
 * - createInstancesForView 等高级 API 留 L5 真用时实施
 */

import type { CapabilityDefinition } from './capability-definition';
import { commandRegistry } from '../command-registry/command-registry';

class CapabilityRegistry {
  private capabilities: Map<string, CapabilityDefinition> = new Map();

  register(def: CapabilityDefinition): void {
    if (this.capabilities.has(def.id)) {
      console.warn(`[L4] CapabilityRegistry: '${def.id}' already registered, overwriting`);
    }
    this.capabilities.set(def.id, def);

    // 自动注册能力暴露的命令到 commandRegistry
    if (def.commands) {
      for (const [cmdId, handler] of Object.entries(def.commands)) {
        commandRegistry.register(cmdId, handler);
      }
    }
  }

  get(id: string): CapabilityDefinition | undefined {
    return this.capabilities.get(id);
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  getAll(): CapabilityDefinition[] {
    return Array.from(this.capabilities.values());
  }

  get count(): number {
    return this.capabilities.size;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
