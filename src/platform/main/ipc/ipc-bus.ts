/**
 * IPC 总线
 *
 * 集中注册各类 IPC handler。后期可扩展为统一的 IPC 路由 + 消息记录等。
 */

import { registerHealthCheckHandlers } from './health-check';
import { registerDiagnosticsHandlers } from './diagnostics-handler';
import { registerShellHandlers } from './shell-handler';
import { registerWebTranslateHandlers } from './web-translate-handler';
import { registerAppHandlers } from './app-handler';
import { registerMediaHandlers } from '../media/media-handlers';
import { registerYtdlpHandlers } from '../ytdlp/handlers';
import { registerTweetFetcherHandlers } from '../tweet-fetcher/handlers';
import { registerLearningHandlers } from '../learning/handlers';
import { registerEBookHandlers } from '../ebook/library-handlers';

export function initIpcBus(): void {
  registerHealthCheckHandlers();
  registerDiagnosticsHandlers();
  registerShellHandlers();
  registerWebTranslateHandlers();
  registerAppHandlers();
  registerMediaHandlers();
  registerYtdlpHandlers();          // L5-B3.17:yt-dlp capability
  registerTweetFetcherHandlers();   // L5-B3.18:tweet-fetcher 临时 capability(Phase D 被吸收)
  registerLearningHandlers();       // L5-B3.20a:learning(vocab + dictionary + translate + TTS)
  registerEBookHandlers();          // L5-C1:ebook 书架 + 文件夹 + 标注(D-3=B JSON 起步)
}
