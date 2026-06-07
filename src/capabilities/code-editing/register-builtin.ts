/**
 * 启动期一次性注册内置语言(Phase 1:6 个)
 *
 * mermaid 用 StreamLanguage 同步定义(轻量,直接 export module-level 常量,loader
 * 返回 Promise.resolve);其余 5 个走 dynamic import,实现 lazy load。
 *
 * 业务方贡献新语言:`requireCapabilityApi<CodeEditingApi>('code-editing').registerLanguage({...})`
 */

import { registerLanguage } from './languages/registry';
import { mermaidLanguage } from './languages/mermaid-lang';
import { javascriptLanguage } from './languages/javascript';
import { typescriptLanguage } from './languages/typescript';
import { pythonLanguage } from './languages/python';
import { jsonLanguage } from './languages/json';
import { markdownLanguage } from './languages/markdown';
import { goLanguage } from './languages/go';
import { yamlLanguage, ymlLanguage } from './languages/yaml';

export function registerBuiltinLanguages(): void {
  // mermaid:StreamLanguage 已 module-level 同步构造,loader 返回包好的 Promise
  registerLanguage({
    id: 'mermaid',
    label: 'Mermaid',
    loader: async () => mermaidLanguage,
  });
  registerLanguage(javascriptLanguage);
  registerLanguage(typescriptLanguage);
  registerLanguage(pythonLanguage);
  registerLanguage(jsonLanguage);
  registerLanguage(markdownLanguage);
  registerLanguage(goLanguage);
  registerLanguage(yamlLanguage);
  registerLanguage(ymlLanguage);
}
