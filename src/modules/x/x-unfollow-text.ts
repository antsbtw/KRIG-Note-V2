/** 取关脚本的结果码 → 人话(主进程 x-person-act 与界面共用;纯常量,两边都能 import) */
export const UNFOLLOW_STATE_TEXT: Readonly<Record<string, string>> = {
  'not-following': '本来就没关注他', 'no-button': '页面上找不到他的关注按钮', 'no-confirm': '确认框没出来',
  'no-switch': '点了确认,按钮没变回 Follow', 'bad-id': '数字 id 不对', error: '脚本出错',
};
