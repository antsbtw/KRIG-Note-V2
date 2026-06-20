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

/**
 * L5-G7.1:一条可选系统字体(IPC 跨进程 DTO;.ttc 已展开为 per-subfont 条目)。
 * 与 main 进程 SystemFontEntry 结构同形,此处独立声明避免 renderer 反依赖 platform/main。
 */
export interface SystemFontEntryDTO {
  /** 字体族名(如 "PingFang SC") */
  family: string;
  /** 字重 / 样式(如 "Regular" / "Bold") */
  style: string;
  /** 源文件绝对路径 */
  path: string;
  /** .ttc 内子字体序号;非 ttc 恒为 0 */
  fontIndex: number;
  /** 文件格式 */
  format: 'ttf' | 'otf' | 'ttc';
  /** opentype 能否解析(false 的不可嵌入) */
  supported: boolean;
}
