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
