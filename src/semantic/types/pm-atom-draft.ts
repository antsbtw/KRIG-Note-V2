/**
 * PmAtomDraft — import-pipeline 内 pm atom 草稿形态 (5B Stage 7 拍板)
 *
 * 规范依据 (docs/RefactorV2/data-model/persistence/spec.md §6 PE4):
 *   "atom.id 由 storage 层生成,业务层不允许指定"
 *
 * 因此 import 路径(markdownToAtoms / krigBatchToAtoms / 等)产出的 atom 集合
 * **不能预设 atom.id**.但 atom 间嵌套关系(childOf)必须在产出时表达 —
 * 走临时 string id (tmpId).storage 层 putAtom 分配真 ULID 后,
 * createNotesBatch 字面建 tmpId → realId 映射,**改写 parentTmpId 引用为 realId**
 * 后 putEdge 字面持久化 childOf 边.
 *
 * 设计理由:
 *  - payload 字段字面是 `Atom<'pm'>` (规范数据壳),不引入新形态
 *  - tmpId / parentTmpId 是 **draft 阶段专用** 字段,storage 写入后丢弃(不进 storage)
 *  - 与 dissectPmDoc 输出 (DissectResult) 是**两条平行路径**,不混塞:
 *    - dissect: PM editor 端 user-edit 后 → DissectResult (atom.id 已 inject 真 ULID)
 *    - markdownToAtoms / krigBatchToAtoms: 源 → PmAtomDraft[] (tmpId 待 storage 分配)
 *  - 边集表达:childOf 走 parentTmpId 字段隐式表达;
 *             belongsToNote 走 createNotesBatch 字面拼接 (item 内所有 atom → 容器 id);
 *             nextSibling 走 atoms 数组顺序 + parentTmpId 分组隐式表达
 *    (不在 PmAtomDraft 里显式持有边集 — 三类边均由 createNotesBatch 单点合成)
 */

import type { Atom } from './atom';

export interface AtomFrom {
  extractionType?: string;
  pdfPage?: number;
  extractedAt?: number;
}

export interface PmAtomDraft {
  /** 临时 id (string,如 'tmp-0' / 'tmp-1' / ...);本数组内唯一,storage 写入后丢弃 */
  tmpId: string;
  /** 嵌套父 atom 的 tmpId (顶层 atom 字面无此字段);
   *  字面表达 childOf 边,storage 层改写为 realId 后 putEdge */
  parentTmpId?: string;
  /** atom 数据载荷 — 规范字面要求 Atom<'pm'> 形态 (decision 010 + atom/spec.md §1) */
  payload: Atom<'pm'>;
  /** 来源元数据 (透传到 storage 实体壳的 attrs 或 from,未来 sub-phase 决定收敛位置) */
  from?: AtomFrom;
}
