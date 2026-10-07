/**
 * `web.dom` —— Web 能力层的「页面读取与脚本执行」能力。
 *
 * ⭐ 核心不变量:`run` 只认预注册脚本 id,不认脚本字符串
 * (`project-x-inject-template-escape` 的类型层面根治)。
 */
export * from './types';
export * from './web-dom';
export { ScriptRegistry } from './script-registry';
export { AI_SCRIPTS, AI_SCRIPT_DEFINITIONS, registerAIScripts } from './ai-scripts';
export { LOCATE_SCRIPTS, LOCATE_SCRIPT_DEFINITIONS, registerLocateScripts } from './locate-scripts';
export { RENDERER_SCRIPTS, RENDERER_SCRIPT_DEFINITIONS, registerRendererScripts } from './renderer-scripts';
