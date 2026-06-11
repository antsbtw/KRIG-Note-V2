/**
 * X(Twitter)Service Profile 类型定义
 *
 * 铁律 3(profile 独立,用户已拍板):不扩展 AIServiceId / AIServiceProfile。
 * AI 的 profile 是问答语义(messageList / userMessage / assistantMessage)、SSE 拦截策略、
 * AIServiceId 写死三家 —— X 全用不上。X 自成一套:
 * - selectors 语义为 tweetElement(读方向,本阶段)/ composeBox / replyBox / publishButton
 *   (写方向,阶段 2 才用,本阶段先留字段、可空)。
 * - urlPattern 匹配 x.com / twitter.com,homeUrl = https://x.com/home。
 *
 * 与 AIServiceProfile 完全独立,X 提取/发布逻辑不污染 AI 问答逻辑。
 */

// ═══════════════════════════════════════════════════════
// §1  X Service ID
// ═══════════════════════════════════════════════════════

/** X 目前只一家(留 union 形态便于未来同模式扩展,如 mastodon / bluesky) */
export type XServiceId = 'x';

// ═══════════════════════════════════════════════════════
// §2  XServiceSelectors
// ═══════════════════════════════════════════════════════

export interface XServiceSelectors {
  /** 推文 article 容器(读方向,阶段 1 用)— X 官方 data-testid */
  tweetElement: string;
  // ── 写方向 selector(阶段 2)。支持逗号分隔多候选,运行时顺序命中(容错 X 改版)。──
  /** 发推 compose 输入框(阶段 2)*/
  composeBox?: string;
  /** 回复框(阶段 2)— X 上 reply 框与 compose 框通常同 testid(tweetTextarea_0)*/
  replyBox?: string;
  /** 发布按钮(阶段 2)— ⚠️ 仅用于「定位 / 校验内容落地」,写方向红线:绝不程序 click */
  publishButton?: string;
}

// ═══════════════════════════════════════════════════════
// §3  XServiceProfile
// ═══════════════════════════════════════════════════════

export interface XServiceProfile {
  /** 服务标识 */
  id: XServiceId;
  /** 显示名称 */
  name: string;
  /** 图标 */
  icon: string;

  // ── URL ──
  /** 基础 URL */
  baseUrl: string;
  /** 主页(Host 初始加载 + 「Home」按钮)*/
  homeUrl: string;
  /** 发推 compose 页(阶段 2「发到 X」确保 compose 框在场用)*/
  composeUrl: string;
  /** URL 匹配正则(字符串形式,运行时转 RegExp)— 匹配 x.com / twitter.com */
  urlPattern: string;

  // ── DOM ──
  selectors: XServiceSelectors;
}

// ═══════════════════════════════════════════════════════
// §4  X 配置
// ═══════════════════════════════════════════════════════

/**
 * X(Twitter)
 *
 * tweetElement 复用 tweet-fetcher/extract-script 同款官方 data-testid。
 * urlPattern 同时匹配 x.com(新域)与 twitter.com(旧域,仍会 302 到 x.com,
 * 但用户手动导航 / 旧链接仍可能落在 twitter.com,故一并识别)。
 */
const X_PROFILE: XServiceProfile = {
  id: 'x',
  name: 'X',
  icon: '𝕏',
  baseUrl: 'https://x.com',
  homeUrl: 'https://x.com/home',
  // /compose/post 打开独立发推弹窗(直达 compose 框,避免依赖首页布局)
  composeUrl: 'https://x.com/compose/post',
  urlPattern: '^https://(x\\.com|twitter\\.com)',
  selectors: {
    tweetElement: 'article[data-testid="tweet"]',
    // ── 写方向 selector(阶段 2)──
    //
    // ⚠️ SPIKE 待确认(总指挥本地 spike 后核对/替换):以下是 X 官方常用且本仓 read 方向
    //   extract-script 已在用的同体系 data-testid(稳定性与 tweetText/User-Name 同级),
    //   作为「待 spike 确认」的初值。X 改版频繁,务必在真机 devtools 核对一次:
    //   - composeBox:发推框(首页顶部「有什么新鲜事」/ /compose/post 弹窗 / reply 展开框)
    //       X 上发推与回复输入框同为 contenteditable,testid 通常是 tweetTextarea_0。
    //       多候选兜底:富文本 contenteditable 容器 [data-testid^="tweetTextarea_"]。
    //   - replyBox:同 composeBox(X reply 框点开后也是 tweetTextarea_0);保留独立字段
    //       便于将来 X 若区分时只改这里。
    //   - publishButton:发推/回复提交按钮。compose 弹窗用 tweetButton,
    //       内联(首页/详情页 reply)用 tweetButtonInline。⚠️ 仅定位校验,不 click。
    //
    // selector 清单同时誊抄进交付说明(X 改版会失效,要可查)。
    composeBox: '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"][contenteditable="true"], div[role="textbox"][data-testid^="tweetTextarea_"]',
    replyBox: '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"][contenteditable="true"], div[role="textbox"][data-testid^="tweetTextarea_"]',
    publishButton: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
  },
};

// ═══════════════════════════════════════════════════════
// §5  注册表 + 查询
// ═══════════════════════════════════════════════════════

/** 所有已注册的 X 服务 Profile */
export const X_SERVICE_PROFILES: readonly XServiceProfile[] = [X_PROFILE] as const;

/** 默认 X 服务 */
export const DEFAULT_X_SERVICE: XServiceId = 'x';

/** 根据 ID 查 Profile */
export function getXServiceProfile(id: XServiceId): XServiceProfile {
  const profile = X_SERVICE_PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown X service: ${id}`);
  return profile;
}

/**
 * 根据 URL 检测 X 服务。
 * @returns 匹配的 Profile,未匹配返回 null
 */
export function detectXServiceByUrl(url: string): XServiceProfile | null {
  return X_SERVICE_PROFILES.find((p) => new RegExp(p.urlPattern).test(url)) ?? null;
}
