# learning capability

KRIG 学习能力封装(vocab 生词本 / dictionary 查询 / translate 翻译 / TTS 朗读)。
capability 内部依赖 `platform/main/learning/`(主进程 vocab-store + dictionary
provider + Google translate/TTS),通过 IPC 暴露给 renderer 层。

view install 路径:`install: ['learning']`(W5 严格态:view 走 requireCapabilityApi 间接路由)。

## 对外面孔

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi } from '@capabilities/learning/types';

const learning = requireCapabilityApi<LearningApi>('learning');

// vocab CRUD
const entry = await learning.vocabAdd('serendipity', '意外的发现', 'I found...');
const list = await learning.vocabList();
await learning.vocabRemove(entry.id);
const inBook = await learning.vocabHas('serendipity'); // true / false

// 订阅变化(任何 add/remove → 推全量 list)
const unsubscribe = learning.onVocabChanged((entries) => {
  console.log('vocab changed:', entries.length);
});

// 字典查询(macOS 优先 / Google fallback)
const lookup = await learning.dictionaryLookup('hello');
// → { word, definition, source: 'macOS Dictionary' / 'Google Translate' / ... }

// 翻译
const trans = await learning.translate('Hello world', 'zh-CN');
// → { text: '你好世界', sourceLang: 'en', targetLang: 'zh-CN' }

// TTS 朗读(返 ArrayBuffer,renderer 自创 audio Blob)
const audioBuf = await learning.tts('Hello', 'en');
if (audioBuf) {
  const blob = new Blob([audioBuf], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  new Audio(url).play();
}
```

## 装配关系

```
view (B3.20b dictionary-panel / B3.19 video-block / 等)
  ↓ install: ['learning']
  ↓ requireCapabilityApi<LearningApi>('learning')
capability.learning (本目录)
  ↓ 调 window.electronAPI.learning* (preload contextBridge)
  ↓ IPC LEARNING_*
main/learning/handlers.ts
  ↓ 调
main/learning/vocab-store.ts                   (JSON 文件 CRUD,atomic write)
main/learning/dictionary-service.ts            (provider 编排:macOS → Google fallback)
main/learning/providers/macos-dictionary.ts    (swift CLI + CoreServices)
main/learning/providers/google-translate.ts    (translate.googleapis.com / translate.google.com)
```

## W5 严格态 A 边界

- View 侧(强制):走 `requireCapabilityApi('learning')` 间接路由
- Driver/slot 侧(允许):可直 import `@capabilities/learning`(模块级 export)
  作为临时允许项,跟现有 capability 一致
- 详见 [audit 2026-05-08 § 5.2](../../../docs/RefactorV2/audit/2026-05-08-register-and-layer-audit.md)

## 注册闭环(P1 审计修正,2026-05-08)

learning capability 的 `capabilityRegistry.register()` 副作用要求模块被 import 才执行。
**B3.20a 本段无 view 直接消费**(20b dictionary-panel + B3.19 video-block 是消费方),
所以**必须**在 `src/platform/renderer/index.tsx` 显式 side-effect import:

```ts
import '@capabilities/learning';   // L5-B3.20a:learning 注册闭环
```

否则 install-coverage 自检失败(view note-view install 含 'learning' → Registry
没注册 → console.error)。

## 平台限制

- **macOS:swift CLI 优先**(系统词典质量最高,无网络依赖)
  - 需要 Xcode Command Line Tools(`xcode-select --install`)
  - 未装 swift → spawn 失败 → 自动 fallback Google
- **Windows / Linux:仅 Google fallback**(无系统词典 provider)
  - 跨平台词典 provider(StarDict / Wiktionary / 等)留 Phase D
- **Google 反爬**:translate / TTS / dictionary fallback 走 Google 免费端点,
  反爬时静默失败返 null,UI 层做"翻译失败"提示;长期方案接 LLM 翻译留 Phase D

## 存储

- **vocab**:`{userData}/krig-data/learning/vocab.json`
  - JSON 文件 + 内存 Map 缓存
  - atomic write(tmp + rename,POSIX 原子)
  - 几千条以下毫秒级 IO,无瓶颈
  - 规模超 5000 时再考虑分片或 DB 升级(留 Phase E)

## 后续 sub-stage

- **L5-B3.20b** renderer dictionary-panel UI(选词查字典 / 加生词本 / TTS 发音)
  + vocab-highlight PM plugin(transcript / note 文本里高亮生词)
- **L5-B3.19** video-block 整体重做(消费 translate / TTS;vocab timeline 用 vocabList)

## npm 依赖

无外部 npm 依赖(用 Electron 内置 `net.fetch` + `child_process.execFile` 调 swift)。
