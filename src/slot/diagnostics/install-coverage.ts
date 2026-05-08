/**
 * install 覆盖率自检(Wave 1)
 *
 * 启动末尾跑一次,聚合所有 view 的 install 列表 vs capabilityRegistry 实际注册项,
 * 在 console 打一张诊断表。dev-only(import.meta.env.DEV 内调用),prod 不消耗。
 *
 * 对照 charter v0.4 § 1.2 / § 1.4:
 * - install 项必须是已注册 capability id
 * - 缺失即"字面合规但运行时违规"(charter.md:11 失败模式)
 *
 * 规则:
 * - missing(install 项不在 registry) → ❌(违规)
 * - 已知 driver id(白名单)            → ⚠️(V2 现状,Wave 2+ 处理)
 * - 其余                                → ✅
 */

import { viewTypeRegistry } from '../view-type-registry/view-type-registry';
import { capabilityRegistry } from '../capability-registry/capability-registry';
import { KNOWN_DRIVER_IDS } from '../view-type-registry/known-driver-ids';

interface CoverageRow {
  view: string;
  capabilities: string[];
  drivers: string[];
  missing: string[];
}

export function computeInstallCoverage(): CoverageRow[] {
  return viewTypeRegistry.getAll().map((def) => {
    const capabilities: string[] = [];
    const drivers: string[] = [];
    const missing: string[] = [];
    for (const id of def.install ?? []) {
      if (capabilityRegistry.has(id)) capabilities.push(id);
      else if (KNOWN_DRIVER_IDS.has(id)) drivers.push(id);
      else missing.push(id);
    }
    return { view: def.id, capabilities, drivers, missing };
  });
}

export function reportInstallCoverage(): void {
  const rows = computeInstallCoverage();
  const totalMissing = rows.reduce((acc, r) => acc + r.missing.length, 0);
  const totalDriver = rows.reduce((acc, r) => acc + r.drivers.length, 0);

  // 标题 + 汇总
  const summary =
    `install 覆盖率自检:${rows.length} views · ` +
    `${capabilityRegistry.count} capabilities · ` +
    `driver 引用 ${totalDriver} · ` +
    `缺失 ${totalMissing}`;

  if (totalMissing > 0) {
    console.warn(`[install-coverage] ❌ ${summary}`);
  } else {
    console.info(`[install-coverage] ✅ ${summary}`);
  }

  // 明细表
  console.table(
    rows.map((r) => ({
      view: r.view,
      capabilities: r.capabilities.join(', ') || '—',
      drivers: r.drivers.join(', ') || '—',
      missing: r.missing.join(', ') || '—',
    })),
  );
}
