/**
 * Toolbar Binding — 把 ToolbarRegistry 内容渲染到 ToolbarFrame 内
 *
 * 按 group 分 left / center / right 渲染
 */

import { useToolbarVersion } from './use-registry';
import { toolbarRegistry } from '../toolbar-registry/toolbar-registry';
import { commandRegistry } from '../command-registry/command-registry';

interface ToolbarBindingProps {
  viewId: string | null;
}

export function ToolbarBinding({ viewId }: ToolbarBindingProps) {
  // 订阅版本号触发重渲(items 数组每次新引用,但版本号稳定)
  useToolbarVersion();

  if (!viewId) {
    return <div className="krig-toolbar-empty">Toolbar (待 view 激活)</div>;
  }

  const leftItems = toolbarRegistry.getItemsForView(viewId, 'left');
  const centerItems = toolbarRegistry.getItemsForView(viewId, 'center');
  const rightItems = toolbarRegistry.getItemsForView(viewId, 'right');
  const noGroup = toolbarRegistry.getItemsForView(viewId).filter((it) => !it.group);

  if (leftItems.length === 0 && centerItems.length === 0 && rightItems.length === 0 && noGroup.length === 0) {
    return <div className="krig-toolbar-empty">Toolbar (待 view 注册内容)</div>;
  }

  const renderItem = (item: typeof noGroup[0]) => (
    <button
      key={item.id}
      type="button"
      className="krig-toolbar-item"
      onClick={() => commandRegistry.execute(item.command)}
      title={item.label}
    >
      {item.label}
    </button>
  );

  return (
    <div className="krig-toolbar-binding">
      <div className="krig-toolbar-group krig-toolbar-group--left">
        {[...leftItems, ...noGroup].map(renderItem)}
      </div>
      <div className="krig-toolbar-group krig-toolbar-group--center">
        {centerItems.map(renderItem)}
      </div>
      <div className="krig-toolbar-group krig-toolbar-group--right">
        {rightItems.map(renderItem)}
      </div>
    </div>
  );
}
