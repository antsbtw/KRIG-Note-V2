/**
 * learning context-menu item 工厂(S3 上提,D-B + D-5 决议)
 *
 * 任何 view 拼装 context-menu 想加查词/翻译条目,调本工厂:
 *
 *   contextMenuRegistry.register([
 *     ...createTextEditingClipboardGroup(VIEW),  // text-editing 工厂
 *     createDictionaryLookupItem(VIEW),           // learning 工厂(本文件)
 *     createTranslateItem(VIEW),                  // learning 工厂(本文件)
 *     ...createMyViewSpecificItems(VIEW),
 *   ]);
 *
 * 设计原则(同 stage 04 D-B):
 * - 工厂只返回 Item,不调 register(N-1 唯一注册源仍在 view)
 * - viewId 决定 item id 前缀(`${viewId}.cm.dictionary-lookup`)+ item.view 字段
 * - command 走 'learning.cm-*' 命名空间(D-5;capability/learning/commands 自注册)
 */

import type { ContextMenuItem } from '@slot/interaction-registries/context-menu-registry/context-menu-types';

/** 📖 查词(group='learning';选区单词 → DictionaryPanel lookup) */
export function createDictionaryLookupItem(viewId: string): ContextMenuItem {
  return {
    id: `${viewId}.cm.dictionary-lookup`,
    label: '📖 查词',
    command: 'learning.cm-dictionary-lookup',
    view: viewId,
    enabledWhen: 'has-selection',
    group: 'learning',
    order: 40,
  };
}

/** 🌐 翻译(group='learning';选区句子/段落 → DictionaryPanel translate) */
export function createTranslateItem(viewId: string): ContextMenuItem {
  return {
    id: `${viewId}.cm.translate-text`,
    label: '🌐 翻译',
    command: 'learning.cm-translate-text',
    view: viewId,
    enabledWhen: 'has-selection',
    group: 'learning',
    order: 41,
  };
}
