/**
 * Backup / Restore IPC 类型契约
 *
 * 跨进程共享(main / renderer / preload),0 业务依赖。
 */

/** 备份结果 */
export interface BackupResult {
  success: boolean;
  /** 成功时:.tar.gz 完整路径 */
  path?: string;
  /** 成功时:归档字节数 */
  size?: number;
  /** 失败时:错误描述 */
  error?: string;
}

/** 恢复结果 */
export interface RestoreResult {
  success: boolean;
  error?: string;
}

/** 进度任务起始载荷 */
export interface ProgressStartPayload {
  taskId: string;
  title: string;
  /** 起始时是否为不定进度(主标题旁不显示百分比) */
  indeterminate?: boolean;
  message?: string;
  /**
   * 作用域:'global'(默认)→ 全屏 GlobalProgressOverlay(备份/导入等);
   * 'x-view' → 只遮 X view 区(X 发布:驱动期间冻结 X webview 防破坏脚本,不锁 note 区)。
   */
  scope?: 'global' | 'x-view';
}

/** 进度更新载荷 */
export interface ProgressUpdatePayload {
  taskId: string;
  message?: string;
  /** 已完成步骤(1-based);搭配 total 一起出现时显示百分比 */
  current?: number;
  /** 总步骤数 */
  total?: number;
}

/** 进度完成载荷 */
export interface ProgressDonePayload {
  taskId: string;
  success: boolean;
  message: string;
}

/**
 * renderer → main 进度驱动载荷(PROGRESS_DRIVE 通道)。
 *
 * 让 renderer 端长任务(如 import 解析/切割阶段在 renderer 跑)也能驱动同一个
 * GlobalProgressOverlay。main 收到后按 kind 原样回推对应 PROGRESS_START/UPDATE/DONE
 * 到本窗口。renderer 自己生成 taskId,保证 start/update/done 串成一条任务。
 */
export type ProgressDrivePayload =
  | { kind: 'start'; payload: ProgressStartPayload }
  | { kind: 'update'; payload: ProgressUpdatePayload }
  | { kind: 'done'; payload: ProgressDonePayload };
