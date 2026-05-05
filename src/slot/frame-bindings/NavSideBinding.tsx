/**
 * NavSide Binding — 把 NavSideRegistry 内容渲染到 NavSideFrame 内
 *
 * 按 charter § 1.4:NavSide 式样在 Workspace,内容由 Registry 注册。
 */

import { useNavSideContent } from './use-registry';
import { commandRegistry } from '../command-registry/command-registry';

interface NavSideBindingProps {
  /** 当前活跃 view ID */
  viewId: string | null;
}

export function NavSideBinding({ viewId }: NavSideBindingProps) {
  const content = useNavSideContent(viewId ?? '');

  if (!viewId || !content) {
    return (
      <div className="krig-nav-side-empty">NavSide (待 view 注册内容)</div>
    );
  }

  const Renderer = content.contentRenderer;

  return (
    <div className="krig-nav-side-binding">
      <div className="krig-nav-side-header">
        <div className="krig-nav-side-title-row">
          <h3 className="krig-nav-side-title">{content.title}</h3>
          {content.actions && content.actions.length > 0 && (
            <div className="krig-nav-side-actions">
              {content.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="krig-nav-side-action"
                  onClick={() => commandRegistry.execute(a.command)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {content.searchPlaceholder !== undefined && (
          <div className="krig-nav-side-search">
            <input
              type="search"
              className="krig-nav-side-search-input"
              placeholder={content.searchPlaceholder}
              onChange={(e) => content.onSearch?.(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="krig-nav-side-content">
        <Renderer />
      </div>
    </div>
  );
}
