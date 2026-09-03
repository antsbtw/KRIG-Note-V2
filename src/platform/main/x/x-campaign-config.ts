/**
 * 活动契约的运行时配置 —— 密钥与地址一律从环境读,**代码里零默认值**。
 *
 * 契约 §1 明确:「密钥由 campaign-tasks 侧生成(32 字节随机,hex),
 * 线下交给爬虫侧写进配置;**不要出现在对话、issue、代码里**」。
 *
 * 故:
 *  · 只从 process.env / userData 下的配置文件读
 *  · 缺失 → fail loud 拒绝启动推送,不用空串兜底(空密钥会被对方 401,
 *    却看着像"网络问题",排查成本高)
 *  · 日志里只打「已配置 / 未配置」,绝不打值
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface CampaignConfig {
  /** 接口 A:推送地址(campaign-tasks 提供) */
  importUrl: string;
  /** 共享密钥,两个方向都带 */
  secret: string;
  /** 接口 B:本地监听地址。Windows 上**不能是 127.0.0.1**(契约 §6) */
  refreshBind: string;
  refreshPort: number;
}

/**
 * 配置文件路径:userData/campaign-config.json —— 不进 git,不进日志。
 *
 * ⚠️ app 在**非 Electron 上下文**(单元测试)里是 undefined,
 * 直接 app.getPath 会抛。配置读取属于「有就用、没有就回落环境变量」的
 * 容错路径,不该因为拿不到 userData 就整个崩掉。
 */
function configFilePath(): string | null {
  try {
    return join(app.getPath('userData'), 'campaign-config.json');
  } catch {
    return null;
  }
}

function fromFile(): Partial<CampaignConfig> {
  const p = configFilePath();
  if (!p || !existsSync(p)) return {};
  try {
    // ⚠️ 去 BOM:Windows 上用 PowerShell `Set-Content -Encoding UTF8` 写出的文件
    //    带 UTF-8 BOM(EF BB BF),Node 的 JSON.parse 会直接抛。
    //    2026-09-03 部署时踩到:配置看着完全正常,服务却静默不启动 ——
    //    因为解析失败被 catch 成「没有配置」。宁可容错,不可静默失效。
    const text = readFileSync(p, 'utf-8').replace(/^\uFEFF/, '');
    const raw = JSON.parse(text) as Record<string, unknown>;
    return {
      importUrl: typeof raw.importUrl === 'string' ? raw.importUrl : undefined,
      secret: typeof raw.secret === 'string' ? raw.secret : undefined,
      refreshBind: typeof raw.refreshBind === 'string' ? raw.refreshBind : undefined,
      refreshPort: typeof raw.refreshPort === 'number' ? raw.refreshPort : undefined,
    };
  } catch (err) {
    // fail loud:解析失败若只是静默回落,现象会是「服务莫名不启动」——
    // 部署时正是这样浪费了一轮排查。把文件路径与原因都打出来。
    console.error(`[campaign-config] ⚠️ 配置文件解析失败,将当作「未配置」处理!`
      + `\n  文件: ${p}\n  原因: ${err}`
      + `\n  常见原因:UTF-8 BOM、尾随逗号、单引号。`
      + `\n  服务不会启动,直到这个文件能被正确解析。`);
    return {};
  }
}

/**
 * 读配置。优先级:环境变量 > 配置文件。
 * 返回 null 表示**未配置完整** —— 调用方必须据此拒绝推送,不能猜。
 */
export function getCampaignConfig(): CampaignConfig | null {
  const f = fromFile();
  const importUrl = process.env.CAMPAIGN_TASKS_IMPORT_URL || f.importUrl;
  const secret = process.env.X_SCRAPER_SECRET || f.secret;
  // 契约 §6:爬虫监听 tailnet IP,**不是 127.0.0.1**(否则 campaign-tasks 敲不到)
  const refreshBind = process.env.REFRESH_BIND || f.refreshBind || '0.0.0.0';
  const refreshPort = Number(process.env.REFRESH_PORT) || f.refreshPort || 8791;

  // 占位符不算配置好 —— 否则服务会带着假密钥启动,对方一律 401,
  // 而现象像「网络不通」,排查方向全错。
  if (!importUrl || !secret || secret.startsWith('REPLACE_ME')) return null;
  return { importUrl, secret, refreshBind, refreshPort };
}

/** 配置状态 —— 给 UI 显示用,**绝不含密钥值** */
export function campaignConfigStatus(): {
  configured: boolean; importUrl?: string; hasSecret: boolean;
  refreshBind: string; refreshPort: number; filePath: string;
} {
  const f = fromFile();
  const importUrl = process.env.CAMPAIGN_TASKS_IMPORT_URL || f.importUrl;
  const secret = process.env.X_SCRAPER_SECRET || f.secret;
  return {
    configured: !!(importUrl && secret && !secret.startsWith('REPLACE_ME')),
    importUrl,                               // 地址不是机密,可显示
    hasSecret: !!secret,                     // 密钥只报「有没有」
    refreshBind: process.env.REFRESH_BIND || f.refreshBind || '0.0.0.0',
    refreshPort: Number(process.env.REFRESH_PORT) || f.refreshPort || 8791,
    filePath: configFilePath() ?? '(不可用)',
  };
}
