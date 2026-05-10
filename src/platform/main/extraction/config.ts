/**
 * Extraction Platform 配置(L5-C6)
 *
 * V1 同款 — Platform URL + 凭证。V2 暂硬编码默认值;
 * 后续 ebook capability config 落地后从 `~/krig-data/ebook/extraction.json` 读(留扩展接口)。
 *
 * E-5 决策:配置文件起步 + 默认值 V1 同款,但 v0.1 先硬编码减少初始改动面。
 */

export const PLATFORM_API = 'http://192.168.1.240:8090/api/v1';

/** Platform Web UI 根 URL(配 `/book/<md5>` 跳转用)*/
export const PLATFORM_WEB_UI = 'http://192.168.1.240:8091';

/** 默认登录凭证(V1 同款 — TODO:挪到 config 文件,加配置 UI)*/
export const DEFAULT_CREDENTIALS = {
  username: 'admin',
  password: '123456',
};
