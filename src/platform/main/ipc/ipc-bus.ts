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
import { registerFontHandlers } from '../fonts/font-handlers';
import { registerYtdlpHandlers } from '../ytdlp/handlers';
import { registerTweetFetcherHandlers } from '../tweet-fetcher/handlers';
import { registerContentExtractionHandlers } from '../content-extraction/handlers';
import { registerLearningHandlers } from '../learning/handlers';
import { registerWebDownloadHistoryHandlers } from '../web-download/handlers';
import { registerEBookHandlers } from '../ebook/library-handlers';
import { registerBookmarkHandlers } from '../bookmark/handlers';
import { registerExtractionHandlers } from '../extraction/handlers';
import { registerGraphHandlers } from '../graph';
import { registerFolderHandlers } from '../folder';
import { registerNoteHandlers } from '../note';
import { registerPmContentHandlers } from '../pm-content';
import { registerThoughtHandlers } from '../thought';
import { registerAIHandlers } from '../ai';
import { registerXHandlers, registerXTestHandlers } from '../x';
import { registerAuthHandlers } from './auth-handler';

export function initIpcBus(): void {
  registerHealthCheckHandlers();
  registerDiagnosticsHandlers();
  registerShellHandlers();
  registerWebTranslateHandlers();
  registerAppHandlers();
  registerMediaHandlers();
  registerFontHandlers();           // L5-G7:系统字体扫描 + 嵌入(可移植画板字体)
  registerYtdlpHandlers();          // L5-B3.17:yt-dlp capability
  registerTweetFetcherHandlers();   // L5-B3.18:tweet-fetcher 临时 capability(Phase D 被吸收)
  registerContentExtractionHandlers(); // 网页剪藏(Defuddle → Note);触发走 web 右键菜单 → main→renderer 推
  registerLearningHandlers();       // L5-B3.20a:learning(vocab + dictionary + translate + TTS)
  registerWebDownloadHistoryHandlers(); // web view 下载历史(list/remove + history-changed 广播);cancel 在 web-download/handler.ts 注册
  registerEBookHandlers();          // L5-C1:ebook 书架 + 文件夹 + 标注(D-3=B JSON 起步)
  registerBookmarkHandlers();       // web view 书签树(书签步骤1 数据层:bookmark atom + folder viewType='web')
  registerExtractionHandlers();     // L5-C6:PDF 提取 → Note(KRIG Knowledge Platform)
  registerGraphHandlers();          // L5-G1:graph 画板 + 文件夹(D-3=B JSON 起步,模板对齐 ebook)
  registerFolderHandlers();         // L7-sub2:folder capability (decision 012,SurrealDB)
  registerNoteHandlers();           // L7-sub2:note capability (decision 012,SurrealDB)
  registerPmContentHandlers();      // L7-sub3a-1:pm-content capability (decision 014,view-agnostic pm atom)
  registerThoughtHandlers();        // 横切思考层(thought-view-port.md v0.5)
  registerAIHandlers();             // ai-extraction capability(V1 web-bridge AI 自动化 → V2 抽 capability)
  registerXHandlers();              // X 集成 阶段 1:右键 X webview 提取推文 → tweetBlock
  registerXTestHandlers();          // X Article 逐块底层测试(独立驱动+验证完整落定);只注册 listener,renderer 主动调才跑
  registerAuthHandlers();           // 账号登录 + 归因(authorization-management-design.md;本期不做授权)
}
