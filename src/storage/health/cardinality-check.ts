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

// ── sub-phase 022 L2 (decision 022 §4.3.1-L2) — 仅扫描+告警, 不自愈 ──

/**
 * sub-phase 022 一对一 / 0..1 cardinality 扫描 (decision 022 §4.3.1-L2).
 *
 * 区别于 CARDINALITY_ONE_PREDICATES (keep-latest 自愈): 本组 predicate 字面
 * 一旦发现违反, 仅 warn 告警, 不自动清理 — 沿决议 §4.3.1-L2 "扫描+告警" 语义,
 * 数据完整性问题留管理员决断 (跟 L1 throw + L3 throw+不写 flag 区分).
 */
const CARDINALITY_SCAN_PREDICATES = [
  // hasReadingState: ebook → reading-state, cardinality 1:1 (每 ebook 必有且仅 1 条)
  { predicate: 'user:krig:hasReadingState', cardinality: '1:1' as const },
  // hasReadingThought: ebook → pm-as-thought, cardinality 0..1 (lazy create, 最多 1 条)
  { predicate: 'user:krig:hasReadingThought', cardinality: '0..1' as const },
  // Decision 028 Phase 4:结构边(belongsToNote / childOf / nextSibling)已整体移除
  // —— 文档结构改由 block atom 属性(noteId/parentId/order)表达,不再有结构边可扫。
];

interface ScanResult {
  predicate: string;
  cardinality: '1:1' | '0..1';
  scannedEdges: number;
  /** subject.atomId 字面挂 > 1 条同 predicate 边 (违反 1:1 或 0..1 字面 "最多 1 条") */
  multiViolations: number;
}

/**
 * sub-phase 022 字面扫描器 (decision 022 §4.3.1-L2): 按 subject.atomId 分组,
 * 任何 atom 挂 > 1 条同 predicate 边 → 报告违反 (warn, 不清理).
 *
 * 跟 checkPredicate 区别:
 * - 本函数字面**不**走 keep-latest 自愈路径 (沿 §4.3.1-L2 "告警" 语义)
 * - 1:1 字面字面**不**报"=0 条违反"(因 ebook atom 创建时字面伴随 reading-state,
 *   若 0 条字面是 migration 中途失败留半成品, 字面字面 L1 ensureReadingState 兜底
 *   而不是 L2 健康检查负责)
 */
async function scanCardinality(
  storage: StorageAPI,
  predicate: string,
  cardinality: '1:1' | '0..1',
): Promise<ScanResult> {
  const allEdges = await storage.listEdges({ predicate });
  const grouped = new Map<string, EdgeEntity[]>();
  for (const edge of allEdges) {
    if (edge.subject.kind !== 'atom') continue;
    const list = grouped.get(edge.subject.atomId) ?? [];
    list.push(edge);
    grouped.set(edge.subject.atomId, list);
  }
  let multiViolations = 0;
  for (const [subjectId, edges] of grouped) {
    if (edges.length <= 1) continue;
    multiViolations++;
    console.warn(
      `[storage/cardinality-check] CARDINALITY_VIOLATION_${cardinality === '1:1' ? 'ONE_TO_ONE' : 'AT_MOST_ONE'} `
        + `${predicate} subject ${subjectId}: ${edges.length} edges (expected ≤1)`,
    );
  }
  return { predicate, cardinality, scannedEdges: allEdges.length, multiViolations };
}

/**
 * 启动 self-check 入口(initStorage 后调用)。
 *
 * 失败 best-effort:单个 predicate 扫描失败 warn 继续,不抛错阻塞启动。
 */
export async function runCardinalityCheck(storage: StorageAPI): Promise<void> {
  // 既有 1:1 keep-latest 自愈扫描 (inCanvas / hasContent, decision 014)
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

  // sub-phase 022 L2 仅扫描+告警 (hasReadingState 1:1 / hasReadingThought 0..1)
  for (const { predicate, cardinality } of CARDINALITY_SCAN_PREDICATES) {
    try {
      const r = await scanCardinality(storage, predicate, cardinality);
      console.log(
        `[storage/cardinality-check] ${r.predicate} (${r.cardinality}): scanned `
          + `${r.scannedEdges} edges, found ${r.multiViolations} multi-edge violations`,
      );
    } catch (err) {
      console.warn(`[storage/cardinality-check] ${predicate} scan failed:`, err);
    }
  }

  // Decision 028 Phase 4:nextSibling / belongsToNote / childOf 结构边已移除,
  // 不再扫描(结构改由 block atom 属性表达)。

  // sub-phase 022 L2 marker 边互斥扫描 (decision 022 §4.3.1-L2)
  // 复用 Step 5.7 抽的 scanMarkerEdgeMutexViolations helper.
  try {
    const violations = await scanMarkerEdgeMutexViolations(storage);
    if (violations.length > 0) {
      for (const v of violations) {
        console.warn(
          `[storage/cardinality-check] CARDINALITY_VIOLATION_PM_MARKER_MUTEX `
            + `atom ${v.atomId}: 同时挂 [${v.predicates.join(', ')}]`,
        );
      }
    }
    console.log(
      `[storage/cardinality-check] marker-edge-mutex: scanned, found ${violations.length} violations`,
    );
  } catch (err) {
    console.warn('[storage/cardinality-check] marker-edge-mutex scan failed:', err);
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
