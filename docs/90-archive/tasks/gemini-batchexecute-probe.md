# Gemini 单条提取 — batchexecute/hNvQHb 数据源验证

## 背景

V2 当前 Gemini 整页提取拦的是 **StreamGenerate** 端点(流式生成响应,**不含用户提问**),
所以用户提问只能从 DOM 扒、按序号跟 AI 回复配对 —— 有对齐风险。

V1 用的是 **batchexecute** 端点的 **hNvQHb** rpc,响应里 `[2,0,0]` 带 userMessage,
整条 turn(提问 + 回答 + groundings + 图)天然对齐、可靠。

要把 Gemini 单条提取做到 V1 那样可靠,需要 V2 也保留 batchexecute/hNvQHb 原始响应。
**但现代 Gemini 可能已弃用该端点**。本脚本用于在真实页面确认它还在不在。

## 怎么跑

1. 启动 app(`npm start`),AI View 切到 Gemini,打开/进入一个**已有多轮对话**的会话页
   (URL 形如 `gemini.google.com/app/xxxxxxxx`)。
2. 对着 Gemini 的 webview 打开 devtools:
   - 最简单:在 webview 上右键(若菜单不便),或用菜单/快捷键打开开发者工具指向 guest。
   - 或者直接用 Chrome 浏览器登录 gemini.google.com 打开同一对话(数据源结构一致,验证端点是否存在足够)。
3. 把下面整段贴进 **Console** 回车,然后**在 Gemini 里发一条新消息 / 切换一次对话 / 刷新页面**,
   触发网络请求。观察 console 输出。

```js
(function () {
  console.log('[gemini-probe] installed — 现在发条消息或切换/刷新对话来触发请求');
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = (args[0] && args[0].url) || String(args[0] || '');
    const resp = await origFetch.apply(this, args);
    try {
      if (url.includes('batchexecute')) {
        const clone = resp.clone();
        const body = await clone.text();
        const hasHnv = body.includes('hNvQHb');
        console.log(
          '%c[gemini-probe] batchexecute 命中',
          'color:#0a0',
          { url: url.slice(0, 120), bodyLen: body.length, hasHnvQHb: hasHnv },
        );
        if (hasHnv) {
          // 试解第一帧 hNvQHb，看 [2,0,0] 是否有 userMessage 文本
          try {
            let rest = body.startsWith(")]}'") ? body.slice(4) : body;
            const m = rest.match(/"hNvQHb"\s*,\s*"((?:\\.|[^"\\])*)"/);
            if (m) {
              const inner = JSON.parse('"' + m[1] + '"'); // 反转义
              const parsed = JSON.parse(inner);
              const userText = parsed?.[0]?.[0]?.[2]?.[0]?.[0]
                ?? parsed?.[0]?.[0]?.[0]?.[2]?.[0]?.[0]; // 两种可能路径都试
              console.log('%c[gemini-probe] hNvQHb 解出 userMessage 样例:',
                'color:#06c', String(userText).slice(0, 120));
            }
          } catch (e) {
            console.log('[gemini-probe] hNvQHb 内层解析失败(结构可能变了):', e.message);
          }
        }
      }
      if (url.includes('StreamGenerate')) {
        console.log('[gemini-probe] StreamGenerate 命中(V2 现在用的端点)', url.slice(0, 100));
      }
    } catch (e) {
      console.log('[gemini-probe] err', e.message);
    }
    return resp;
  };
})();
```

## 怎么判断结果

- **看到 `batchexecute 命中` 且 `hasHnvQHb: true`，并解出了 userMessage 样例**
  → batchexecute/hNvQHb **还在**。可以照 V1 做：让 SSECaptureManager 额外拦
  batchexecute 并保留原始 body，移植 V1 `gemini-conversation-query` 解析。Gemini 能做对。

- **只看到 `StreamGenerate 命中`，从没出现 `batchexecute 命中`(或出现但 `hasHnvQHb:false`)**
  → 现代 Gemini 已不走 hNvQHb 加载历史。需另寻数据源：
    - 方案 A:从 StreamGenerate 响应里找用户提问是否藏在别的 path（多半没有）；
    - 方案 B:接受 DOM 扒提问 + StreamGenerate markdown，按序号配对（有对齐风险，
      可加文本匹配兜底降低误配）。

把 console 输出截图发回，我据此决定 Gemini 的实现路线。

## 备注

注入的是 `window.fetch` 包装，**只在当前页面会话生效**，刷新或关页即失效，不改任何持久代码。
纯诊断，安全。
