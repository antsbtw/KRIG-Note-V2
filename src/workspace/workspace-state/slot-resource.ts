/**
 * slot-resource — 「某个槽持有什么资源」的**唯一**分发层(per-workspace)
 *
 * note 的「当前笔记」、eBook 的「当前书」,将来 Web 的「当前页」/ Graph 的「当前画板」——
 * 这类「左右各自持有一份」的状态,槽分发逻辑只此一处。
 *
 * ## 为什么必须收拢
 *
 * note(`4fda395b`)与 eBook(`3aabe642`)各自走过一遍 per-slot,写出的是**逐行同构**的
 * 两份代码:`slot === 'right' ? state.rightActiveXxxId : state.activeXxxId`。而 eBook
 * 那轮把 note 踩过的坑**重踩了三个**(✕ 关错栏 / 删资源只清 left / 右键取错资源)——
 * 平行实现不会自动继承前一份的修复,这正是"各个 view 各自实现"的代价。
 *
 * ⇒ 第三个 view(Web / Graph)接 per-slot 时**不要再抄第二遍**:来这里 declare 一次。
 *
 * ## 边界:抽什么、不抽什么(本模块的纯粹性所在)
 *
 * | 关注点 | 各 view 是否同构 | 是否收进本层 |
 * |---|---|---|
 * | **哪个槽持有哪个资源**(状态归属) | 完全同构 | ✅ 收 |
 * | **资源变了怎么让画面动**(更新传播) | 天生不同 | ❌ 不收 |
 *
 * 更新传播各 view 本就不同(note 走字段订阅 / eBook 走 IPC 广播 / Web 走 webview 导航)。
 * 把 IPC 广播塞进"资源管理器"会让本层知道 eBook 的 IPC 细节 —— **那才是不纯粹**。
 * 类比:React 管 state,不管你怎么发请求。
 *
 * ⇒ 「不收更新传播」不是留技术债,是**正确的边界**。后来者不要试图统一它。
 *
 * ## 与 active-slot.ts 的分工(不重叠)
 *
 * - `active-slot` 回答「**当前**是哪个槽」—— 唯一来源
 * - `slot-resource` 回答「**某个**槽持有什么」—— 本模块
 *
 * 本模块**不得自行判断当前槽**:所有 API 都要求调用方显式传 slot。需要"当前槽"时
 * 由调用方去 `getActiveSlot()` 取了再传进来。这条自我约束是刻意的 —— 一旦本层
 * 开始自己猜槽,就成了第二个"当前槽"来源,active-slot 的单一来源地位随即瓦解
 * (见 active-slot.ts 文档头「为什么必须单一来源」)。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import type { ActiveSlot } from '@workspace/workspace-state/active-slot';

/**
 * 槽标识 —— 全 app 唯一定义。
 *
 * 抽层前 note(`NoteSlot`)与 eBook(`EBookSlot`)各定义一份同义类型,理由是
 * "两个 view 的 per-slot 状态互不相干"。但槽本身是**布局概念不是 view 概念**:
 * SlotArea 传给两者的是同一个值。各定义一份只会让第三个 view 再定义第三份。
 */
export type SlotId = ActiveSlot;

/**
 * 对侧槽 —— 消灭各处的 `slot === 'right' ? 'left' : 'right'` 三元式。
 *
 * 用于「在另一栏打开」类命令(note-view.open-in-other-slot /
 * ebook-view.open-book-in-other-slot):语义是「送到我现在没在看的那一栏」。
 */
export function otherSlot(slot: SlotId): SlotId {
  return slot === 'right' ? 'left' : 'right';
}

/**
 * 一个 per-slot 资源的声明。
 *
 * @template T 资源标识类型(现有两者都是 `string | null` 的资源 id,
 *             但 readingState 那类结构体同样适用,故留泛型)
 */
export interface SlotResourceSpec<T> {
  /** 诊断用名字(出现在 fail loud 日志里),如 'note.activeNoteId' */
  readonly name: string;
  /** pluginStates 的 key,如 'note' / 'ebook-view' */
  readonly storeKey: string;
  /**
   * left 槽的字段名。
   *
   * **保持历史名**(`activeNoteId` / `activeBookId`)—— 不做数据迁移:
   * 旧版单栏就是今天的 left,历史数据天然落 left 槽,语义正好对得上。
   */
  readonly leftField: string;
  /** right 槽的字段名(新增字段,老数据缺 → fallback)*/
  readonly rightField: string;
  /** 该槽无值时的回落值(通常是 null)*/
  readonly fallback: T;
}

/** declare 返回的读写 API —— view 拿到这个就不用再碰槽分发 */
export interface SlotResourceAccessor<T> {
  /** 读某个槽持有的资源(从已 hydrate 的 pluginStates 原始对象读)*/
  read(persisted: Record<string, unknown> | undefined, slot: SlotId): T;
  /** 读某个槽持有的资源(直接从 WorkspaceState 读,自带 storeKey 定位)*/
  get(ws: WorkspaceState, slot: SlotId): T;
  /** 构造写某个槽的 patch(交给 view 自己的 writePersistent)*/
  patch(slot: SlotId, value: T): Record<string, unknown>;
  /** 两个槽逐个遍历(删资源时清两栏用 —— 只清 left 是已踩过的坑)*/
  readonly slots: readonly SlotId[];
}

/**
 * 全部槽 —— 「删资源要清干净每一栏」这类遍历用。
 *
 * 为什么值得导出而不是各处写 `['left','right'] as const`:eBook 删书时原实现
 * **只清了 left**,右栏若正开着这本书会留下指向已删书的 rightActiveBookId
 * (重启后加载失败)。将来若真有第三个槽,漏改的又会是这些散落的字面量。
 */
export const ALL_SLOTS: readonly SlotId[] = ['left', 'right'];

/** 已声明的资源(重复声明检测用,键 = `${storeKey}.${leftField}`)*/
const declared = new Map<string, string>();

/**
 * 声明一个 per-slot 资源,拿回一组读写 API。
 *
 * view 只声明「我的资源存哪、字段怎么命名」,**不再各自处理槽分发**。
 *
 * ```ts
 * const activeNote = declareSlotResource<string | null>({
 *   name: 'note.activeNoteId',
 *   storeKey: 'note',
 *   leftField: 'activeNoteId',
 *   rightField: 'rightActiveNoteId',
 *   fallback: null,
 * });
 * activeNote.get(ws, slot);            // 读
 * writePersistent(wsId, activeNote.patch(slot, noteId));  // 写
 * ```
 */
export function declareSlotResource<T>(spec: SlotResourceSpec<T>): SlotResourceAccessor<T> {
  // fail loud:同一字段被声明两次 = 又出现了平行实现(本层要消灭的正是这个)。
  // 不 throw —— 模块顶层 declare 时 throw 会让整个 view 模块加载失败,代价过大;
  // console.error 足以在开发期暴露,且不牵连运行时。
  const key = `${spec.storeKey}.${spec.leftField}`;
  const prev = declared.get(key);
  if (prev && prev !== spec.name) {
    console.error(
      `[slot-resource] ${key} 被重复声明(已有 "${prev}",又来 "${spec.name}")。` +
        `每个 per-slot 字段只应声明一次 —— 检查是否又写了一份平行实现。`,
    );
  }
  declared.set(key, spec.name);

  /**
   * 槽 → 字段名。**全 app 唯一的一处** `slot === 'right' ? … : …`。
   *
   * 非法槽值 fail loud 后回落 left:回落是为了让调用点仍拿到确定值(而非 undefined
   * 继续往下污染),错误本身已由 console.error 留痕 —— 不是静默兜底。
   */
  function fieldFor(slot: SlotId): string {
    if (slot !== 'left' && slot !== 'right') {
      console.error(
        `[slot-resource] ${spec.name} 收到非法槽值 ${String(slot)},` +
          `已按 left 处理。槽值只有 'left' / 'right' —— 检查调用方是否把 viewId / 'hidden' 当槽传。`,
      );
      return spec.leftField;
    }
    return slot === 'right' ? spec.rightField : spec.leftField;
  }

  return {
    read(persisted, slot) {
      const value = persisted?.[fieldFor(slot)];
      return (value ?? spec.fallback) as T;
    },
    get(ws, slot) {
      const persisted = ws.pluginStates[spec.storeKey] as Record<string, unknown> | undefined;
      return this.read(persisted, slot);
    },
    patch(slot, value) {
      return { [fieldFor(slot)]: value };
    },
    slots: ALL_SLOTS,
  };
}

/**
 * 便捷读:直接按 wsId 取。
 *
 * 命令 handler 常见形态(手上只有 wsId,没有 WorkspaceState)。ws 不存在时回落
 * fallback 并留痕 —— 这种情况通常是 ws 已被删而命令还在飞。
 */
export function getSlotResource<T>(
  accessor: SlotResourceAccessor<T>,
  spec: Pick<SlotResourceSpec<T>, 'name' | 'fallback'>,
  wsId: string,
  slot: SlotId,
): T {
  const ws = workspaceManager.get(wsId);
  if (!ws) {
    console.error(`[slot-resource] ${spec.name} 读取时 ws=${wsId} 不存在,返回兜底值。`);
    return spec.fallback;
  }
  return accessor.get(ws, slot);
}
