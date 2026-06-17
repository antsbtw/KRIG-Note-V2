/**
 * auth IPC handlers(账号登录 + 归因;本期不做授权)
 *
 * 模板对齐 bookmark/handlers.ts:入参 typeof 严格校验、每个操作走 authService。
 * 注册入口:src/platform/main/ipc/ipc-bus.ts.initIpcBus()。
 *
 * 红线:
 * - token 绝不进 renderer:所有返回走 authService.getPublicState()(不含 token)。
 * - fail loud:client 抛错 → 归一为 { ok:false, error },不静默吞;state 也带 error。
 * - 多 ws 扇出:启动时 subscribe authService → broadcastAuthChanged(遍历所有 webContents)。
 *
 * 邮箱注册两步:先 AUTH_SEND_CODE 拿 6 位码,再 AUTH_REGISTER 带 code。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  AuthState,
  AuthActionResult,
  AuthSendCodeInput,
  AuthRegisterInput,
  AuthLoginInput,
} from '@shared/auth/auth-types';
import { authService } from '../auth/auth-service';
import { broadcastAuthChanged } from '../auth/broadcast';

/** 归一错误为可读字符串(fail loud)*/
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 成功:带最新 public 态;失败:带 error(都不抛到 renderer)*/
function ok(state: AuthState): AuthActionResult {
  return { ok: true, state };
}
function fail(err: unknown): AuthActionResult {
  return { ok: false, error: toErrorMessage(err) };
}

export function registerAuthHandlers(): void {
  // 启动即接广播:authService 任何状态变化 → 遍历所有 webContents 推 public 态
  authService.subscribe((state) => broadcastAuthChanged(state));

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATE, async () => authService.getPublicState());

  ipcMain.handle(IPC_CHANNELS.AUTH_SEND_CODE, async (_e, input: unknown): Promise<AuthActionResult> => {
    const i = input as AuthSendCodeInput;
    if (!i || typeof i.email !== 'string' || !i.email) {
      return { ok: false, error: 'email 必填' };
    }
    const purpose = i.purpose ?? 'register';
    try {
      await authService.sendCode(i.email, purpose);
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_REGISTER, async (_e, input: unknown): Promise<AuthActionResult> => {
    const i = input as AuthRegisterInput;
    if (!i || typeof i.email !== 'string' || !i.email) return { ok: false, error: 'email 必填' };
    if (typeof i.password !== 'string' || i.password.length < 8) {
      return { ok: false, error: '密码至少 8 位' };
    }
    if (typeof i.code !== 'string' || !/^\d{6}$/.test(i.code)) {
      return { ok: false, error: '验证码须为 6 位数字' };
    }
    try {
      await authService.register(i.email, i.password, i.code);
      return ok(authService.getPublicState());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_e, input: unknown): Promise<AuthActionResult> => {
    const i = input as AuthLoginInput;
    if (!i || typeof i.email !== 'string' || !i.email) return { ok: false, error: 'email 必填' };
    if (typeof i.password !== 'string' || !i.password) return { ok: false, error: '密码必填' };
    try {
      await authService.login(i.email, i.password);
      return ok(authService.getPublicState());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    await authService.logout();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_REFRESH, async (): Promise<AuthActionResult> => {
    try {
      await authService.refresh();
      return ok(authService.getPublicState());
    } catch (err) {
      return fail(err);
    }
  });
}
