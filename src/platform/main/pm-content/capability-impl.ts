/**
 * pm-content capability — main 端实施 (decision 014 §3.4 §3.7)
 *
 * 边界:
 * - main 进程独占,直接 import @storage (合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件 (src/capabilities/pm-content/index.ts 薄包装)
 * - view ↔ capability:PmAtomInfo.doc = PmDocEnvelope (DriverSerialized 等价体)
 * - capability 内部 ↔ storage:裸 PmPayload (复用 @platform/main/note envelope.ts wrap/unwrap)
 *
 * 实施要点 (decision 014 §3.4):
 * - atom domain = 'pm' (sub-phase 2 已注册,本 capability 复用)
 * - 创建时显式 hasBeenReferenced=false (storage schema DEFAULT 兜底,代码层双保险)
 * - update 不重置 hasBeenReferenced (单向 flag,decision 013 §3.5.1)
 *
 * 单引用约束 (decision 013 §3.5.1.bis):
 * 本 sub-phase 不实施浅引用 / 跨 view 复用;hasBeenReferenced 在本 sub-phase 恒 false。
 */

import { storage } from '@storage/index';
import type { AtomEntity, PmPayload } from '@semantic/types';
import type { PmAtomInfo, PmDocEnvelope } from '@shared/ipc/pm-content-types';
import { wrapPmDoc, unwrapPmDoc } from '../note/envelope';

const PM_DOMAIN = 'pm';

function atomToPmAtomInfo(atom: AtomEntity<'pm'>): PmAtomInfo {
  return {
    id: atom.id,
    doc: wrapPmDoc(atom.payload.payload as PmPayload),
    // schema DEFAULT false 兜底,旧 atom 无字段时 normalizer 已用 ?? false 补
    hasBeenReferenced: atom.hasBeenReferenced ?? false,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

export async function createPmAtom(initialDoc: PmDocEnvelope): Promise<PmAtomInfo> {
  const pmDoc = unwrapPmDoc(initialDoc);
  const atom = await storage.putAtom<'pm'>({
    payload: { domain: PM_DOMAIN, payload: pmDoc },
  });
  return atomToPmAtomInfo(atom);
}

export async function getPmAtom(id: string): Promise<PmAtomInfo | null> {
  const atom = await storage.getAtom<'pm'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== PM_DOMAIN) return null;
  return atomToPmAtomInfo(atom);
}

export async function updatePmAtom(id: string, doc: PmDocEnvelope): Promise<PmAtomInfo> {
  const pmDoc = unwrapPmDoc(doc);
  const atom = await storage.putAtom<'pm'>({
    id,
    payload: { domain: PM_DOMAIN, payload: pmDoc },
  });
  return atomToPmAtomInfo(atom);
}
