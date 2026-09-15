/**
 * X 工作台 —— X 的自动协作面板(采集 / 分析 / 回复)
 *
 * ⭐ 用户 2026-09-15 拍板重构:
 * > 「这个面板已经不适合我们使用了。先隐藏起来,重新构建一个简洁的面板。」
 * > 「在 toolbar 中保留一个旧界面的切换 button,这样就不会中断原来的一些操作,
 * >   直到全部迁移完毕为止。然后重构 UI,从简单的 task 开始。」
 *
 * ⚠️ **第一版只做三样**:任务列表 / 执行与进度 / 盯人对照。
 * 收件箱的 5 个切片、✎拟回复、人工标注**一律不搬** —— 靠顶栏「旧版」按钮
 * 切回 `x-inbox-view` 继续用。迁移完成前两个面板并存,这是用户定的节奏。
 */
import { registerView } from '@slot/view-type-registry/register-view';
import { XWorkbenchView } from './XWorkbenchView';

registerView({
  id: 'x-workbench-view',
  install: ['x-extraction'],
  component: XWorkbenchView,
  /**
   * ⭐ 放进 SlotPicker —— 让用户能手动把它召回右槽。
   * ⚠️ 不给 navSideTab:它不是一个独立的左侧导航目的地,而是 X 的配套面板
   * (与 x-inbox-view 同类,从 SocialView 的 tab 打开)。
   */
  slotPickerEntry: { label: 'X 工作台', icon: '🛠', order: 61 },
});
