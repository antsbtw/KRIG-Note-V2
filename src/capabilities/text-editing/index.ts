/**
 * text-editing capability — 入口(Wave 5 C4)
 *
 * 职责:封装 PM 编辑能力(prosemirror-* 全套)。capability 内部依赖
 * @drivers/text-editing-driver(driver 是 capability 内部实现细节,view 不可见)。
 *
 * 对外面孔(WebRenderingApi 同模式):
 * - api: TextEditingApi(Host 组件 + driver 命令 + handler 注入 + 工厂函数)
 * - 类型:见 ./types
 *
 * 装配关系(charter § 1.3 表格):
 * - capability.text-editing 持有 prosemirror-*(通过 driver 内部 import)
 * - view install 路径:`install: ['text-editing']`(audit P1-A:不列 driver ID)
 *
 * 历史(W5 C4):W4.x 期间 view 直 import @drivers/text-editing-driver,
 * install 列表也含 'text-editing-driver'(KNOWN_DRIVER_IDS 白名单豁免)。
 * W5 严格收尾把 driver 完全降级到 capability 内部细节,view 通过 capability api
 * 间接路由(charter § 1.4 view 归属 + § 1.2 注册原则)。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import {
  textEditingDriver,
  textEditingDriverApi,
  setLinkClickHandler,
  setNoteLinkSearchHandler,
  noteLinkCommandKey,
  getNoteLinkActiveView,
  createEmptyDoc,
  extractFirstParagraphText,
} from '@drivers/text-editing-driver';
import { instanceRegistry } from '@drivers/text-editing-driver/instance-registry';
import { atomsToProseMirror } from './converters/atoms-to-pm';
import { sanitizeAtoms } from './converters/sanitize-atoms';
import { registerTextEditingPopups } from './ui/popups';
import { registerNoteLinkSearchIntegration } from './ui/note-link-search/integration';
import { registerTextEditingCommands } from './commands/register-pm-commands';
import type { TextEditingApi } from './types';

/**
 * 组装 capability api(对齐 TextEditingApi 类型)。
 * driver 内部模块原样 re-wrap,不改变行为。
 */
const api: TextEditingApi = {
  Host: textEditingDriver.Host,
  api: textEditingDriverApi as TextEditingApi['api'],
  setLinkClickHandler,
  setNoteLinkSearchHandler,
  noteLinkCommandKey,
  getNoteLinkActiveView,
  createEmptyDoc,
  extractFirstParagraphText,
  instanceRegistry,
  atomsToProseMirror,
  sanitizeAtoms,
};

capabilityRegistry.register({
  id: 'text-editing',
  api,
});

// C4/C6:capability 加载时一次性注册 PM 通用 popup(color / link / note-link)+
// driver note-link search handler 注入。
// 注:driver activeHandler 是模块级单例,view 各自注册会互相覆盖,故归 capability 自管。
registerTextEditingPopups();
registerNoteLinkSearchIntegration();

// C7:capability 加载时一次性注册 PM 通用命令(46 个;原 NoteView 注册全部搬来)。
// N-1:同 id 全工程唯一 register 调用 — 同步删 NoteView 旧 register。
registerTextEditingCommands();
