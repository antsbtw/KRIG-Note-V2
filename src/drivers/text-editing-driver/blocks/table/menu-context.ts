/**
 * table menu context — handle 弹 popup 时的"哪一行/列/选区"侧带通道(L5-B3.7.1, M2)
 *
 * popupController.show(id, anchor) 不带额外参数,而 TableMenuPanel 需要知道:
 * - 目标 driver instanceId(确定操作哪个 NoteEditor)
 * - 目标 table 节点的 doc pos
 * - scope: 'row' / 'column' / 'cellSelection'
 * - rowIdx / colIdx(scope='row'/'column' 时填一个)
 *
 * 模式同 [[note-link-search-integration]] 的 setNoteLinkSearchHandler:
 * 单实例,popup 显示前 set,popup 关闭后 clear。同一时刻 popupController 仅
 * 允许一个 popup 可见,所以 module-level 单实例不会撞。
 */

export interface TableMenuContext {
  /** driver instanceId(node-view 从 view.dom data-instance-id 反查)*/
  instanceId: string;
  /** table 节点在 doc 中的起点(getPos() 返回值)*/
  tablePos: number;
  /** 菜单作用域 */
  scope: 'row' | 'column' | 'cellSelection';
  /** scope='row' 时填(0-based)*/
  rowIdx?: number;
  /** scope='column' 时填(0-based)*/
  colIdx?: number;
}

let current: TableMenuContext | null = null;

export function setTableMenuContext(ctx: TableMenuContext): void {
  current = ctx;
}

export function getTableMenuContext(): TableMenuContext | null {
  return current;
}

export function clearTableMenuContext(): void {
  current = null;
}
