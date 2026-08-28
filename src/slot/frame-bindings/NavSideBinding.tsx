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
    // 走到这里 = 这个 view 没注册 NavSide 内容,却仍然把 NavSideFrame 撑开了一栏空白。
    //
    // 正解是在 view 定义里声明 `navSideTab.navSideDisabled: true` ——
    // WorkspaceInstance 会据此**根本不渲染** NavSideFrame(2026-08-28 修)。
    // 这里的占位符只是最后一道兜底,正常情况下用户不该看见它。
    //
    // 出声而不是默默摆一栏空白:没有这条 warn 的话,新 view 忘了声明 flag 时
    // 表现就是「莫名其妙多出一栏空白」,得靠人眼发现(mail 就是这么被用户拍下来的)。
    if (viewId) {
      console.warn(
        `[NavSideBinding] view "${viewId}" 没有注册 NavSide 内容,却渲染了 NavSide 面板。` +
          `请在该 view 的 navSideTab 里加 navSideDisabled: true(或补上 navSide 内容)。`,
      );
    }
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
