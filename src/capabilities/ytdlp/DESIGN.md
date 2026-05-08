# ytdlp capability

yt-dlp 二进制能力封装(视频下载 / 元数据 / 字幕)。capability 内部依赖
`platform/main/ytdlp/`(主进程 spawn 二进制 + IPC handlers)+ `youtube-transcript` npm
(自动抓 YouTube 字幕)。

view install 路径:`install: ['ytdlp']`(W5 严格态:view 走 requireCapabilityApi 间接路由)。

## 对外面孔

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { YtdlpApi } from '@capabilities/ytdlp/types';

// 业务路径(view render / 命令 handler)
const ytdlp = requireCapabilityApi<YtdlpApi>('ytdlp');

// 检查 + 安装(用户首次点 ⬇️)
const status = await ytdlp.checkStatus();
if (!status.installed) {
  const unsubscribe = ytdlp.onInstallProgress((progress) => {
    console.log('yt-dlp install:', progress.percent + '%');
  });
  await ytdlp.install();
  unsubscribe();
}

// 下载视频
const unsubDl = ytdlp.onDownloadProgress((progress) => {
  console.log('download:', progress.url, progress.percent + '%');
});
const result = await ytdlp.download('https://www.youtube.com/watch?v=...');
unsubDl();
if (result.status === 'complete') {
  console.log('saved to:', result.filename);
  if (result.subtitleFile) console.log('subtitle:', result.subtitleFile);
}

// 元数据(不下载)
const info = await ytdlp.getInfo(url);

// 翻译字幕保存
await ytdlp.saveSubtitle(videoPath, 'zh-CN', '[00:00] 你好\n[00:05] 世界');
```

## 装配关系

```
view (tweet-block / video 字幕系统等 — 留 L5-B3.18+)
  ↓ install: ['ytdlp']
  ↓ requireCapabilityApi<YtdlpApi>('ytdlp')
capability.ytdlp (本目录)
  ↓ 调 window.electronAPI.ytdlp* (preload contextBridge)
  ↓ IPC YTDLP_*
main/ytdlp/handlers.ts
  ↓ 调
main/ytdlp/binary-manager.ts (checkStatus / install — net.fetch + execFile)
main/ytdlp/downloader.ts     (download / getInfo / saveSubtitle — spawn yt-dlp binary)
                             + npm youtube-transcript (YouTube 字幕)
```

## W5 严格态 A 边界

- View 侧(强制):走 `requireCapabilityApi('ytdlp')` 间接路由
- Driver/slot 侧(允许):可直 import `@capabilities/ytdlp`(模块级 export)
  作为临时允许项,跟现有 5 老 capability + media-storage / text-editing / web-rendering 一致
- 详见 [audit 2026-05-08 § 5.2](../../../docs/RefactorV2/audit/2026-05-08-register-and-layer-audit.md)

## 平台限制

本阶段沿用 V1:**仅支持 macOS**(下载 yt-dlp_macos universal binary)。

- Windows / Linux 用户:install 会下载 macOS binary,checkStatus 用 execFile 探测会失败
  → 用户层显"yt-dlp 当前仅支持 macOS"提示
- 跨平台 binary 区分留 Phase E

## 字幕策略

- **YouTube 自动字幕**:走 `youtube-transcript` npm,download 完后自动保存为 .en.srt
  (失败静默跳过,不影响视频下载本身)
- **翻译字幕**:saveSubtitle(videoFilePath, langCode, timestampText) 写 `.<langCode>.srt`
  - 输入 timestampText 格式:`[MM:SS] text` 多行
  - 输出标准 SRT 格式
  - 路径安全:isAbsolute + 不含 .. + langCode 正则约束(防 ../ 注入)

## npm 依赖

`youtube-transcript@^1.3.x` — **仅 ytdlp capability 内部使用**:
- ✅ `src/platform/main/ytdlp/downloader.ts` 内 import
- ❌ view / driver / 其他 capability 不可直 import(走 ytdlp.download 输出的 subtitle 字段)

## 后续

- L5-B3.18 tweet-block 完整迁(消费 ytdlp.download / ytdlp.getInfo)
- L5-B3.19 video 字幕系统(消费 ytdlp.saveSubtitle 写翻译字幕)
- Phase E:跨平台 binary(Windows / Linux)+ 自动更新机制
