/**
 * web-translate 协议常量(L5-B4.2)
 *
 * 5 个 ViewMessage action(从 V1 直迁,无修改)。
 */

export const WEB_TRANSLATE_PROTOCOL = 'web-translate';

export const SYNC_ACTION = {
  /** controller → passive:URL 变更,对面跟随加载 */
  NAVIGATE: 'wt:navigate',
  /** 右→左(初始化一次):右侧 renderer 就绪,请求左侧发送当前 URL */
  REQUEST_URL: 'wt:request-url',
  /** 右→左:右侧页面加载完成 + 同步脚本注入完毕,可以开始同步 */
  READY: 'wt:ready',
  /** controller → passive:同步事件批量传输 */
  SYNC_EVENTS: 'wt:sync-events',
  /** 新 controller → 旧 controller:控制权交接 */
  TAKE_CONTROL: 'wt:take-control',
} as const;
