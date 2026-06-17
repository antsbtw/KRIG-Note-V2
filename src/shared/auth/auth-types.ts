/**
 * Auth 共享类型(账号登录 + 归因;本期不做授权/计费)
 *
 * 跨层共享类型(纯类型,0 业务依赖):
 * - main 进程 auth 模块(auth-service / auth-store / auth-client)持有/落盘这些结构
 * - renderer 侧 d.ts(electron-api.d.ts)声明 IPC 出入参类型
 * - capabilities/auth(renderer)持本地 public state 快照
 *
 * 设计依据:authorization-management-design.md「★ 2026-06-17 最终决定」——
 *          本期只做登录 + 归因,砍掉 grant / 到期判定 / 倒计时 / 验签 / 客户端门控。
 *          授权真正边界在后端登录/refresh 判定(下期计费时收口),不在客户端。
 *
 * 红线:token / refresh_token 绝不进 renderer。public 的 AuthState 不含 token,
 *       仅主进程内部结构持 token,且只在 safeStorage 加密落盘。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 状态枚举
// ─────────────────────────────────────────────────────────────────────────────

/** 客户端登录态 */
export type AuthStatus =
  | 'loading' // 启动中,尚未从磁盘恢复 session
  | 'anonymous' // 未登录
  | 'authenticated' // 已登录
  | 'token-expired'; // token 失效需重新登录

/** 设备类型(后端合法值含 macos / windows;app_source 走顶层不在此)*/
export type DeviceType = 'macos' | 'windows';

// ─────────────────────────────────────────────────────────────────────────────
// 账号
// ─────────────────────────────────────────────────────────────────────────────

/** 平台账号(public,可进 renderer)*/
export interface AuthAccount {
  /** auth.users.id(UUID),平台账号主键 */
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// public 状态(renderer 拿到的快照,不含 token)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * public 授权态:广播给 renderer / 经 AUTH_GET_STATE 返回的快照。
 *
 * ⚠️ 不含 access_token / refresh_token(红线:token 绝不进 renderer)。
 * 本期无 tier / grant —— 只有「登录与否」。
 */
export interface AuthState {
  status: AuthStatus;
  /** 已登录时有值 */
  account?: AuthAccount;
  /** 上次成功联网核实的时间(毫秒);展示用 */
  lastVerifiedAt?: number;
  /** fail loud:登录 / 刷新失败时的可读错误(不静默吞)*/
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC 出入参(renderer ↔ main)
// ─────────────────────────────────────────────────────────────────────────────

/** 设备信息(嵌套对象,随注册 / 登录上送;app_source 走顶层,不在此)*/
export interface AuthDeviceInfo {
  device_id: string;
  device_type: DeviceType;
  device_name?: string;
  fingerprint?: string;
}

/** 发验证码入参(AUTH_SEND_CODE → POST /auth/code)*/
export interface AuthSendCodeInput {
  email: string;
  /** 用途:register | reset_password | bind_email;本期只用 register */
  purpose: 'register' | 'reset_password' | 'bind_email';
}

/** 注册入参(AUTH_REGISTER → POST /auth/register)。device / app_source 由主进程补 */
export interface AuthRegisterInput {
  email: string;
  /** min 8 */
  password: string;
  /** 6 位验证码(字段名 `code`,非 verification_code)*/
  code: string;
}

/** 登录入参(AUTH_LOGIN → POST /auth/login)。device / app_source 由主进程补 */
export interface AuthLoginInput {
  email: string;
  password: string;
}

/** 登录 / 注册 / 发码 等可失败操作的统一返回(fail loud:失败带 error,不抛吞)*/
export interface AuthActionResult {
  ok: boolean;
  /** 成功时的最新 public 状态 */
  state?: AuthState;
  /** 失败时的可读错误(fail loud)*/
  error?: string;
}
