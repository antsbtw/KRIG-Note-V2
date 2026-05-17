/**
 * mermaid ELK loader adapter
 *
 * mermaid v11+ 通过 `mermaidModule.registerLayoutLoaders(loader)` 注入 ELK 布局后端,
 * loader 由 @mermaid-js/layout-elk 包提供(其内部包了一份 elkjs)。
 *
 * 本模块只暴露 loader 给业务方,业务方拿到后调
 * `mermaidModule.registerLayoutLoaders(getMermaidElkLoader())`。
 *
 * lazy import 避免启动期开销(mermaid 也是按需 lazy 加载,loader 等到 mermaid 真用时再取)。
 */

let _loader: unknown | null = null;
let _loading: Promise<unknown> | null = null;

export async function getMermaidElkLoader(): Promise<unknown> {
  if (_loader) return _loader;
  if (_loading) return _loading;
  _loading = import('@mermaid-js/layout-elk').then((m) => {
    _loader = m.default;
    return _loader;
  });
  return _loading;
}
