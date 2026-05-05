/**
 * registerView — 公开 API
 *
 * L5 view 调用此函数注册自身,内部自动拆分子字段到对应 Registry。
 *
 * 使用示例(L5 view):
 * ```ts
 * import { registerView } from '@slot/view-type-registry/register-view';
 *
 * registerView({
 *   id: 'note',
 *   install: ['text-editing', 'history'],
 *   contextMenu: [
 *     { id: 'copy', label: 'Copy', command: 'note.copy' },
 *   ],
 * });
 * ```
 */

export { registerView } from './view-type-registry';
