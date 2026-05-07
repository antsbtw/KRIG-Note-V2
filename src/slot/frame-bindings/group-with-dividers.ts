/**
 * group-with-dividers — 通用工具,把按 order 排好的 items 按 group 分组,
 * 不同 group 之间插一个 'divider' 哨兵元素(Binding 渲染时遇到 divider 渲分隔线)。
 *
 * 用途:HandleMenuBinding / ContextMenuBinding 渲染分组菜单(对齐 V1 体验)。
 * items 已经按 order 排好(由 registry 保证),本函数只是检测相邻 item 的 group 是否变化。
 *
 * 没 group 字段的 item 视为 group="default",所有 default 之间不插分隔符。
 */

export type DividerSentinel = { __divider: true; key: string };

export function isDivider<T>(x: T | DividerSentinel): x is DividerSentinel {
  return (x as DividerSentinel).__divider === true;
}

/**
 * 把 items 数组按 group 分组,group 切换时插 divider sentinel。
 * 不同 group 间最多插一个分隔符;头尾不插。
 */
export function groupWithDividers<T extends { id: string; group?: string }>(
  items: readonly T[],
): Array<T | DividerSentinel> {
  const result: Array<T | DividerSentinel> = [];
  let lastGroup: string | undefined;
  for (const item of items) {
    const g = item.group ?? '';
    if (lastGroup !== undefined && g !== lastGroup) {
      result.push({ __divider: true, key: `divider-${item.id}` });
    }
    result.push(item);
    lastGroup = g;
  }
  return result;
}
