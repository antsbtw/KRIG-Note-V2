/**
 * IPC 消息类型契约(纯类型)
 */

/** 健康检查响应 — 各层 IPC 返回此格式 */
export interface HealthCheckResponse {
  /** 该层是否存活 */
  alive: boolean;
  /** 启动时间戳(ms) */
  since: number;
  /** 累积错误列表(空数组 = 无错) */
  errors: string[];
  /** 可选额外信息 */
  details?: Record<string, unknown>;
}

/** 诊断上报载荷(renderer → main) */
export interface DiagnosticsReportPayload {
  /** 上报的层名(如 'L2', 'Renderer') */
  layer: string;
  /** 可选详情(如 size / version / 等) */
  details?: Record<string, unknown>;
}
