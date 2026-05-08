/**
 * title-guard plugin — note 标题保护(L5-B3.11,V1 直迁)
 *
 * V1 来源:src/plugins/note/plugins/title-guard.ts
 *
 * 职责:
 * 1. **doc 必须以 isTitle text-block 开头** — appendTransaction 检测,缺则补一个空 title
 *    (适用场景:旧 note 加载第一次 — 旧 doc 首块 isTitle=false → 自动转 true;
 *     用户删了第一块 → 自动补;转换第一块类型 → 自动补)
 * 2. **title 内不允许换行** — handlePaste 拦截 paste,只取第一行作纯文本插入
 * 3. **Enter 在 title 内** — V2 不在本 plugin 处理,由 base keymap default splitBlock
 *    自动 split 出新段落,新段落 isTitle=false(因为 default false)— 行为天然正确
 *
 * **关键约定**:本 plugin 假设 note 用 driver,doc.firstChild 是 text-block。
 * 其他用 driver 的场景(如未来 thought view 等)如果不希望强制 title,可以选择不挂这个
 * plugin — 通过 BlockSpec 注册的 plugin 是 schema 全局生效,但 view 可以选择性接入。
 *
 * **L5-B3.11 接入策略**:本 plugin 不在 text-block.spec.plugin 注册(避免影响其他用
 * driver 但不要 title 的场景),而是在 NoteView 层用 viewId='note-view' 时单独装。
 *   → 实施:加进 Host.tsx ENABLED_BLOCKS 之外的 plugins 数组(plugin 全局),但 view
 *     只有 NoteView 用 driver,所以暂时不用区分;若未来 thought view 接入,再用
 *     config.viewId 守门。
 */

import { Plugin, PluginKey } from 'prosemirror-state';

export const titleGuardKey = new PluginKey('text-editing-driver:title-guard');

export function buildTitleGuardPlugin(): Plugin {
  return new Plugin({
    key: titleGuardKey,

    props: {
      /**
       * title 内粘贴 → 强制纯文本(取第一行)
       *
       * 不拦其他场景,handlePaste 返回 false 走 PM 默认。
       */
      handlePaste(view, event) {
        const { state } = view;
        const { $from } = state.selection;

        // 必须在 doc 第一层(深度 1 = 顶层 block 内)
        if ($from.depth < 1) return false;
        const block = state.doc.nodeAt($from.before(1));
        if (!block) return false;
        if (block.type.name !== 'text-block') return false;
        if (!block.attrs.isTitle) return false;

        // 取纯文本(第一行)
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        const firstLine = text.split(/\r?\n/)[0] || '';
        if (!firstLine) return true; // 空文本 — 阻止默认行为(否则会插换行)

        const tr = state.tr.insertText(firstLine);
        view.dispatch(tr);
        return true;
      },
    },

    /**
     * 维护 doc 首块为 isTitle text-block
     *
     * 触发场景:
     * - 旧 note 加载:firstChild 不是 isTitle → 把它转成 isTitle(若是 text-block)
     *   或在前面插一个空 isTitle title(若不是 text-block)
     * - 用户删了第一块 / 转换第一块类型 → 自动补
     */
    appendTransaction(_transactions, _oldState, newState) {
      const firstChild = newState.doc.firstChild;
      const titleType = newState.schema.nodes['text-block'];
      if (!titleType) return null;

      // 已经合规 — 不动
      if (
        firstChild &&
        firstChild.type.name === 'text-block' &&
        firstChild.attrs.isTitle
      ) {
        return null;
      }

      let tr = newState.tr;

      if (
        firstChild &&
        firstChild.type.name === 'text-block' &&
        !firstChild.attrs.isTitle
      ) {
        // 首块是 text-block 但 isTitle=false — 把它转成 title(用户旧 note 自动迁移)
        // 同时清掉 level(title 不应该有 heading level)
        tr.setNodeMarkup(0, undefined, {
          ...firstChild.attrs,
          level: null,
          isTitle: true,
        });
      } else {
        // 首块不是 text-block(罕见;比如 image / list 等)— 在前面插一个空 title
        const emptyTitle = titleType.create({ isTitle: true, level: null });
        tr.insert(0, emptyTitle);
      }

      // 标记不入 history(用户撤销不应该撤这个自动补 / 转换)
      tr.setMeta('addToHistory', false);
      return tr;
    },
  });
}
