/**
 * pm-content capability — 对外类型 (decision 014 §3.4)
 *
 * view-agnostic pm atom CRUD。跟 noteCapability 共享底层 pm atom domain 但**互不调用**:
 * - noteCapability:sub-phase 2 实施的 note view + folder 管理 (note = pm atom 1:1)
 * - pmContentCapability:本 sub-phase 引入,graph 端 Instance.doc (text-node) 走的 pm atom CRUD
 *
 * 本 sub-phase (3a-1) 仅 3 个核心方法,留 3a-N+ 扩展:
 * - listOrphaned / listReferences / deletePmAtom / forceDetachWrapper / getReferencedFlag
 */

import type { PmAtomInfo, PmDocEnvelope } from '@shared/ipc/pm-content-types';

export type { PmAtomInfo, PmDocEnvelope };

export interface PmContentCapabilityApi {
  /** 创建独立 pm atom (graph 端 text-node Instance 创建时调用) */
  createPmAtom(initialDoc: PmDocEnvelope): Promise<PmAtomInfo>;
  /** 读单个 pm atom;不存在返 null */
  getPmAtom(id: string): Promise<PmAtomInfo | null>;
  /** 更新 pm atom 内容 */
  updatePmAtom(id: string, doc: PmDocEnvelope): Promise<PmAtomInfo>;
}
