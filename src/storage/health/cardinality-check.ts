/**
 * P0a-bis K3+K4 — 启动 self-check + 数据修复
 *
 * 背景:
 * decision 014 字面拍板 inCanvas / hasContent 边 cardinality 一对一,但 sub-phase 3a-1
 * 实施时未在 store 层加守门,叠加 P0a UPSERT 字面后 view 端撞库的 i-001 等历史数据
 * 出现一对多 inCanvas 边(同一 instance 出现在两个画板)。
 *
 * 本模块在 initStorage 收尾(runMigrations 之后)扫描两个 cardinality 一对一边:
 * - user:krig:inCanvas (instance → canvas)
 * - user:krig:hasContent (text-instance → pm)
 *
 * 按 subject.atomId 分组,count > 1 标违反,按 createdAt 降序留 keep-latest 异步清旧。
 * 不阻塞启动(失败 best-effort warn),不抛错(沿 decision 014 line 735 keep-latest 模式)。
 *
 * 不扫 inFolder(超 P0a-bis 范围,留 decision 019 §9 Q-2 未来扩展)。
 */
import type { StorageAPI } from '../api';
import type { EdgeEntity } from '@semantic/types';

/** 待扫描的一对一边 predicate(本 sub-phase 范围) */
const CARDINALITY_ONE_PREDICATES = [
  'user:krig:inCanvas',
  'user:krig:hasContent',
] as const;

interface CheckResult {
  predicate: string;
  scannedEdges: number;
  violationCount: number;
  cleanedEdges: number;
}

/**
 * 扫描指定 predicate 的所有边,按 subject.atomId 分组找违反,keep-latest 自愈。
 */
async function checkPredicate(storage: StorageAPI, predicate: string): Promise<CheckResult> {
  const result: CheckResult = {
    predicate,
    scannedEdges: 0,
    violationCount: 0,
    cleanedEdges: 0,
  };

  // listEdges 按 predicate 过滤,storage 层封装好 RecordId 绑定
  const allEdges = await storage.listEdges({ predicate });
  result.scannedEdges = allEdges.length;

  // 按 subject.atomId 分组
  const grouped = new Map<string, EdgeEntity[]>();
  for (const edge of allEdges) {
    if (edge.subject.kind !== 'atom') continue;
    const list = grouped.get(edge.subject.atomId) ?? [];
    list.push(edge);
    grouped.set(edge.subject.atomId, list);
  }

  // 找违反(count > 1)+ keep-latest 清旧
  for (const [subjectId, edges] of grouped) {
    if (edges.length <= 1) continue;
    result.violationCount += 1;

    // 按 createdAt 降序 + id 字典序降序兜底(沿 decision 014 §3.5.3.6 keep-latest)
    edges.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const keep = edges[0];
    const drop = edges.slice(1);

    console.warn(
      `[storage/cardinality-check] ${predicate} violation on subject ${subjectId}: `
        + `${edges.length} edges; keep ${keep.id} (createdAt ${keep.createdAt}), `
        + `dropping ${drop.length} stale edges`,
    );

    for (const e of drop) {
      try {
        const r = await storage.deleteEdge(e.id);
        if (r.deleted) result.cleanedEdges += 1;
      } catch (err) {
        console.warn(
          `[storage/cardinality-check] failed to clean stale ${predicate} edge ${e.id}:`,
          err,
        );
      }
    }
  }

  return result;
}

/**
 * 启动 self-check 入口(initStorage 后调用)。
 *
 * 失败 best-effort:单个 predicate 扫描失败 warn 继续,不抛错阻塞启动。
 */
export async function runCardinalityCheck(storage: StorageAPI): Promise<void> {
  for (const predicate of CARDINALITY_ONE_PREDICATES) {
    try {
      const r = await checkPredicate(storage, predicate);
      console.log(
        `[storage/cardinality-check] ${r.predicate}: scanned ${r.scannedEdges} edges, `
          + `found ${r.violationCount} violations, cleaned ${r.cleanedEdges} stale edges`,
      );
    } catch (err) {
      console.warn(`[storage/cardinality-check] ${predicate} scan failed:`, err);
    }
  }
}

// ── sub-phase 022 (decision 022 §4.3.1) — pm atom marker 边互斥扫描 ──

/**
 * pm atom 上的 marker 边互斥组 (decision 022 §4.3.1).
 *
 * 一个 pm atom 最多挂这组中的 1 条 marker 边:
 * - user:krig:hasNoteView      (note,decision 016 §3.6)
 * - user:krig:hasReadingThought (ebook reading thought,decision 022 §4.1.2)
 * - 未来 023+ 可能加 hasNoteThought (V1 老 thought 挂 note 字面,沿 §4.3 字面)
 *
 * 互斥扫描结果字面 — L2 健康检查 + L3 migration 末段都消费.
 */
export interface MarkerEdgeMutexViolation {
  /** pm atom id (subject 字面) */
  atomId: string;
  /** 该 atom 同时挂的 marker predicate (字面应只 1 条) */
  predicates: string[];
}

const PM_MARKER_PREDICATES = [
  'user:krig:hasNoteView',
  'user:krig:hasReadingThought',
] as const;

/**
 * 扫描 pm atom 上的 marker 边互斥违反.
 *
 * L2 字面消费:启动期 + 用户手动触发 health-check 时调,违反 → warn 告警,不抛错.
 * L3 字面消费:022 migration 末段调,违反 → migration throw + 不写 flag.
 *
 * 字面 helper 单一职责: 纯 storage.listEdges 查询 + 返 violations[], 不抛错,
 * 字面由调用者 (L2 / L3) 字面分流处置.
 */
export async function scanMarkerEdgeMutexViolations(
  storage: StorageAPI,
): Promise<MarkerEdgeMutexViolation[]> {
  // 按 subject.atomId 聚合各 predicate 的边
  const atomToPredicates = new Map<string, Set<string>>();
  for (const predicate of PM_MARKER_PREDICATES) {
    const edges = await storage.listEdges({ predicate });
    for (const e of edges) {
      if (e.subject.kind !== 'atom') continue;
      const set = atomToPredicates.get(e.subject.atomId) ?? new Set<string>();
      set.add(predicate);
      atomToPredicates.set(e.subject.atomId, set);
    }
  }
  // 找出挂 >1 marker 的 atom
  const violations: MarkerEdgeMutexViolation[] = [];
  for (const [atomId, set] of atomToPredicates) {
    if (set.size > 1) {
      violations.push({ atomId, predicates: [...set] });
    }
  }
  return violations;
}
