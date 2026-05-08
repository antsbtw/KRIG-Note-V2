/**
 * install 覆盖率自检(Wave 1 / W5 严格化)
 *
 * 启动末尾跑一次,聚合所有 view 的 install 列表 vs capabilityRegistry 实际注册项,
 * 在 console 打一张诊断表。dev-only(import.meta.env.DEV 内调用),prod 不消耗。
 *
 * W5 严格收尾:install 列表 0 driver id,只有 capability(`KNOWN_DRIVER_IDS`
 * 整体淘汰)。报告里仅 capabilities + missing 两列。
 *
 * 对照 charter v0.4 § 1.2 / § 1.4:
 * - install 项必须是已注册 capability id
 * - 缺失即"字面合规但运行时违规"(charter.md:11 失败模式)
 */

import { viewTypeRegistry } from '../view-type-registry/view-type-registry';
import { capabilityRegistry } from '../capability-registry/capability-registry';

interface CoverageRow {
  view: string;
  capabilities: string[];
  missing: string[];
}

export function computeInstallCoverage(): CoverageRow[] {
  return viewTypeRegistry.getAll().map((def) => {
    const capabilities: string[] = [];
    const missing: string[] = [];
    for (const id of def.install ?? []) {
      if (capabilityRegistry.has(id)) capabilities.push(id);
      else missing.push(id);
    }
    return { view: def.id, capabilities, missing };
  });
}

export function reportInstallCoverage(): void {
  const rows = computeInstallCoverage();
  const totalMissing = rows.reduce((acc, r) => acc + r.missing.length, 0);

  const summary =
    `install 覆盖率自检:${rows.length} views · ` +
    `${capabilityRegistry.count} capabilities · ` +
    `缺失 ${totalMissing}`;

  if (totalMissing > 0) {
    console.warn(`[install-coverage] ❌ ${summary}`);
  } else {
    console.info(`[install-coverage] ✅ ${summary}`);
  }

  console.table(
    rows.map((r) => ({
      view: r.view,
      capabilities: r.capabilities.join(', ') || '—',
      missing: r.missing.join(', ') || '—',
    })),
  );
}
