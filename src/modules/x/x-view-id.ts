/**
 * X 的 view id —— 单独一个文件,谁要都从这里拿(renderer.ts 也从这里 re-export)。
 * ⚠️ 不放在 renderer.ts 里让别人 import:那会把 registerView 的副作用拖进来(循环引用)。
 */
export const X_WEB_VIEW_ID = 'x-web-view';
export const X_OPS_VIEW_ID = 'x-ops-view';
export const X_TASK_VIEW_ID = 'x-task-view';
