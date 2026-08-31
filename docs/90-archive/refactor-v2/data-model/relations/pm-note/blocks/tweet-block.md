# tweetBlock

> **Status**: V2 已实现 ✓（L5-B3.18）
> **Source**: `src/drivers/text-editing-driver/blocks/tweet-block/spec.ts`

---

## 1. 语义边界

`tweetBlock` 是**X / Twitter 推文嵌入** block 节点 —— 双 Tab UI（Browse iframe / Data 离线缓存卡片）。

### 1.1 形态特征

- **block 节点**（`group: 'block'`），**非 atom**（有 content）。
- **content: 'block'**：单段 caption（对齐 image / audio / video 模式）。
- **双 Tab**：
  - `'browse'`（默认）：Twitter 官方 platform.twitter.com iframe（实时显示，需 CSP frame-src 白名单）
  - `'data'`：结构化卡片（头像/名/handle/正文/时间/metrics/引用/inReplyTo）—— 离线可读

### 1.2 数据来源

元数据来自 `tweet-fetcher` capability（NodeView Fetch 按钮抓回填）。

---

## 2. type 字段值

```ts
type: 'tweetBlock'
```

V2 实际 id 驼峰 `tweetBlock`。

---

## 3. attrs schema

### 3.1 链接字段

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `tweetUrl` | `string \| null` | `null` | 完整 Twitter URL |
| `tweetId` | `string \| null` | `null` | Twitter 推文 ID |

### 3.2 元数据字段（Fetch 按钮抓回填）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `authorName` | `string` | `''` | 作者显示名 |
| `authorHandle` | `string` | `''` | 作者 @handle |
| `authorAvatar` | `string` | `''` | 头像 URL |
| `text` | `string` | `''` | 推文正文 |
| `createdAt` | `string` | `''` | 推文创建时间（ISO） |
| `lang` | `string` | `''` | 语言代码 |
| `media` | `unknown \| null` | `null` | 媒体附件元数据 |
| `metrics` | `unknown \| null` | `null` | likes / retweets / replies 等 |
| `quotedTweet` | `unknown \| null` | `null` | 引用的推文 |
| `inReplyTo` | `unknown \| null` | `null` | 回复目标 |

### 3.3 UI 状态字段（持久化）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `activeTab` | `'browse' \| 'data'` | `'browse'` | 用户 Tab 选择持久化 |
| `downloadedVideoPath` | `string \| null` | `null` | 推文含视频时本地下载路径（点 📁 Finder 高亮） |

### 3.4 KRIG 知识图谱挂钩字段

| 字段 | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `atomId` | `string \| null` | `null` | Phase D 知识图谱接入占位 |

### 3.5 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'block'
group: 'block'
draggable: true
selectable: true
```

单段 caption（与 image / audio / video 同模式）。

### 4.1 嵌套约束

- 恰好一个 block 子节点。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'tweetBlock',
  attrs: {
    tweetUrl: 'https://x.com/user/status/123',
    tweetId: '123',
    authorName: 'User',
    authorHandle: '@user',
    text: 'Hello',
    activeTab: 'browse',
    atomId: null,
    // ... 其他 metadata 字段
    indent: 0,
  },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My caption' }] }]
}
```

### 5.2 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → tweetBlock | **无 CommonMark 标准** —— 通过 KRIG 扩展识别 tweet URL |
| tweetBlock → MD | 降级为 link `[<tweetUrl>](<tweetUrl>)` |

### 5.3 可逆性

| 路径 | 是否无损 |
|---|---|
| tweetBlock ↔ PM doc | ✓ 完全无损 |
| tweetBlock → Markdown → tweetBlock | ⚠ 严重有损：metadata 全部丢失（只剩 URL） |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `tweet` / `tweetBlock` —— attrs 类似，但 V2 砍掉 V1 的 `richText` / `embedHtml`（V1 也只用 text，richText 是预留，embedHtml 走 oEmbed 备用路径本阶段不上）+ `sourcePages` / `thoughtId`。

### 6.2 V2 处置

- 基础字段直搬。
- 砍 V1 `richText` / `embedHtml` / `sourcePages` / `thoughtId`。
- 仅保留 `atomId` 作为 KRIG 挂钩占位。

### 6.3 V1 数据迁移

```ts
function migrateTweetBlock(v1: V1TweetBlock): V2TweetBlock {
  return {
    type: 'tweetBlock',
    attrs: {
      tweetUrl: v1.attrs.tweetUrl,
      tweetId: v1.attrs.tweetId,
      authorName: v1.attrs.author?.name ?? '',
      authorHandle: v1.attrs.author?.handle ?? '',
      authorAvatar: v1.attrs.author?.avatar ?? '',
      text: v1.attrs.text ?? '',
      createdAt: v1.attrs.createdAt ?? '',
      // ... 其他字段
      activeTab: 'browse',
      downloadedVideoPath: null,
      atomId: null,
      // 砍掉的字段: richText / embedHtml / sourcePages / thoughtId
    },
    content: v1.content,
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-TW-1 | metadata 字段（authorName / text / metrics 等）是否过多，应否独立成 atom + 边？ | **暂走 attrs**（简化实施） | Phase 3+ |
| P-TW-2 | tweet 与 X 平台改名后命名是否调整？ | **保留 `tweetBlock`**（V2 现状，避免破坏字段引用） | 不调整 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/tweet-block/spec.ts`
- `tweet-fetcher` capability（元数据抓取）
- [mixins/media-resource.md](../../../mixins/media-resource.md)（基础字段引用）
