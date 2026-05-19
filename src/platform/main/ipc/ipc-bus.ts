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
import { registerExtractionHandlers } from '../extraction/handlers';
import { registerGraphHandlers } from '../graph';
import { registerFolderHandlers } from '../folder';
import { registerNoteHandlers } from '../note';
import { registerPmContentHandlers } from '../pm-content';
import { registerThoughtHandlers } from '../thought';
import { registerAIHandlers } from '../ai';

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
  registerExtractionHandlers();     // L5-C6:PDF 提取 → Note(KRIG Knowledge Platform)
  registerGraphHandlers();          // L5-G1:graph 画板 + 文件夹(D-3=B JSON 起步,模板对齐 ebook)
  registerFolderHandlers();         // L7-sub2:folder capability (decision 012,SurrealDB)
  registerNoteHandlers();           // L7-sub2:note capability (decision 012,SurrealDB)
  registerPmContentHandlers();      // L7-sub3a-1:pm-content capability (decision 014,view-agnostic pm atom)
  registerThoughtHandlers();        // 横切思考层(thought-view-port.md v0.5)
  registerAIHandlers();             // ai-conversation capability(V1 web-bridge AI 自动化 → V2 抽 capability)
}
