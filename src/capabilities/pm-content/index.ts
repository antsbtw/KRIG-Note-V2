/**
 * pm-content capability — renderer 端薄包装 (decision 014 §3.4)
 *
 * 实施位置:src/platform/main/pm-content/ (capability-impl + handlers)
 * 本文件:把 window.electronAPI.pmContentXxx 扁平驼峰 alias 成业务名
 * (createPmAtom / getPmAtom / updatePmAtom)
 *
 * 跟 noteCapability 的关系 (decision 014 §3.4):
 * - 底层共享 pm atom domain (sub-phase 2 已注册),但 capability 互不调用
 * - sub-phase 3a-2.5 升级 noteCapability 时,可考虑合并 — 本 sub-phase 不合并
 *
 * W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
 * W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { PmContentCapabilityApi, PmAtomInfo, PmDocEnvelope } from './types';

export type { PmContentCapabilityApi, PmAtomInfo, PmDocEnvelope } from './types';

async function createPmAtom(initialDoc: PmDocEnvelope): Promise<PmAtomInfo> {
  return window.electronAPI.pmContentCreate(initialDoc);
}

async function getPmAtom(id: string): Promise<PmAtomInfo | null> {
  return window.electronAPI.pmContentGet(id);
}

async function updatePmAtom(id: string, doc: PmDocEnvelope): Promise<PmAtomInfo> {
  return window.electronAPI.pmContentUpdate(id, doc);
}

export const pmContentCapability: PmContentCapabilityApi = {
  createPmAtom,
  getPmAtom,
  updatePmAtom,
};

// W5 严格态:Registry 注册 — view 走 requireCapabilityApi<PmContentCapabilityApi>('pm-content')
capabilityRegistry.register({
  id: 'pm-content',
  api: pmContentCapability,
});
