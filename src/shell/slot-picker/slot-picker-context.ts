/**
 * SlotPickerContext — 触发 SlotPickerPopup 前注入 open-right-slot 命令 ID
 *
 * 每个 view 的 open-right-slot 命令 ID 不同（如 note-view.open-right-slot），
 * 在触发 popup 前通过 setCommandId 注入，popup 组件读取后执行。
 */

let commandId = 'note-view.open-right-slot';

export const slotPickerContext = {
  setCommandId(id: string): void {
    commandId = id;
  },
  getCommandId(): string {
    return commandId;
  },
};
