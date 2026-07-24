import { protocol, Session } from 'electron';

const SCHEME = 'x-inbox';

// index.html 内联，避免 Vite 打包后 __dirname/assets/ 路径失效
const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>X Inbox</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; background: #0f172a; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; }

header { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #1e293b; border-bottom: 1px solid #334155; }
header h1 { font-size: 15px; font-weight: 600; color: #f1f5f9; }
.ws-badge { background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
.header-actions { margin-left: auto; display: flex; gap: 8px; }

.main { display: flex; flex: 1; overflow: hidden; }

.sidebar { width: 200px; min-width: 200px; background: #1e293b; border-right: 1px solid #334155; padding: 12px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }

.section-title { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }

.status-list { display: flex; flex-direction: column; gap: 2px; }
.status-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 5px; cursor: pointer; color: #94a3b8; transition: background 0.1s; }
.status-item:hover { background: #334155; }
.status-item.active { background: #1d4ed8; color: #fff; }
.status-item .count { margin-left: auto; font-size: 11px; background: #334155; padding: 1px 6px; border-radius: 10px; }
.status-item.active .count { background: rgba(255,255,255,0.2); }

.recipe-section { display: flex; flex-direction: column; gap: 8px; }
select { width: 100%; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 5px 8px; border-radius: 5px; font-size: 12px; }
select:focus { outline: none; border-color: #3b82f6; }

.scan-actions { display: flex; gap: 6px; }

.ollama-status { margin-top: auto; padding-top: 12px; border-top: 1px solid #334155; font-size: 11px; color: #64748b; }
#ollamaStatus { font-weight: 500; }

.content { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.empty-state { color: #475569; text-align: center; margin: 40px auto; }

.card { background: #1e293b; border-radius: 8px; padding: 12px; border-left: 3px solid #334155; }
.card.worth { border-left-color: #22c55e; }
.card.pending { border-left-color: #f59e0b; }
.card.skip { opacity: 0.5; }
.card.filtered_out { opacity: 0.4; }
.card.ai_judging { border-left-color: #8b5cf6; }

.card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.author-name { font-weight: 600; color: #f1f5f9; font-size: 12px; }
.author-handle { color: #64748b; font-size: 11px; }
.meta { margin-left: auto; color: #64748b; font-size: 11px; display: flex; gap: 10px; }

.tweet-text { color: #cbd5e1; line-height: 1.5; font-size: 12px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.tweet-text.expanded { display: block; -webkit-line-clamp: unset; }
.expand-btn { color: #3b82f6; font-size: 11px; cursor: pointer; margin-top: 3px; }
.expand-btn:hover { text-decoration: underline; }

.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag { background: #1d4ed8; color: #bfdbfe; font-size: 10px; padding: 1px 6px; border-radius: 10px; }

.ai-reason { color: #6b7280; font-style: italic; font-size: 11px; margin-top: 4px; }
.ai-reason::before { content: '\\u2726 '; }

.card-actions { display: flex; gap: 6px; margin-top: 8px; }

button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 10px; border-radius: 5px; font-size: 12px; cursor: pointer; border: 1px solid transparent; transition: background 0.1s; background: #334155; color: #e2e8f0; border-color: #475569; }
button:hover { background: #475569; }
button.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
button.primary:hover { background: #1e40af; }
button.sm { padding: 3px 8px; font-size: 11px; }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.load-more { text-align: center; padding: 8px; }
.scan-status { font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>

<header>
  <h1>📥 X Inbox</h1>
  <span class="ws-badge" id="wsLabel">-</span>
  <div class="header-actions">
    <button onclick="loadTweets(false)">刷新</button>
    <button class="primary" onclick="triggerJudge()">AI 判断</button>
  </div>
</header>

<div class="main">
  <div class="sidebar">
    <div>
      <div class="section-title">状态过滤</div>
      <div class="status-list">
        <div class="status-item active" data-status="worth" onclick="setStatus('worth', this)">
          <span>⭐ worth</span><span class="count" id="count-worth">-</span>
        </div>
        <div class="status-item" data-status="pending" onclick="setStatus('pending', this)">
          <span>⏳ pending</span><span class="count" id="count-pending">-</span>
        </div>
        <div class="status-item" data-status="skip" onclick="setStatus('skip', this)">
          <span>⏭ skip</span><span class="count" id="count-skip">-</span>
        </div>
        <div class="status-item" data-status="filtered_out" onclick="setStatus('filtered_out', this)">
          <span>🚫 filtered</span><span class="count" id="count-filtered_out">-</span>
        </div>
        <div class="status-item" data-status="all" onclick="setStatus('all', this)">
          <span>📋 全部</span><span class="count" id="count-all">-</span>
        </div>
      </div>
    </div>

    <div class="recipe-section">
      <div class="section-title">触发采集</div>
      <select id="recipeSelect"><option value="">加载中...</option></select>
      <div class="scan-actions">
        <button class="primary" onclick="startScan()" id="scanBtn">开始扫描</button>
        <button onclick="stopScan()">停</button>
      </div>
      <div class="scan-status" id="scanStatus"></div>
    </div>

    <div class="ollama-status">
      Ollama: <span id="ollamaStatus">检测中...</span>
    </div>
  </div>

  <div class="content" id="cardList">
    <div class="empty-state">加载中...</div>
  </div>
</div>

<script>
const api = window.electronAPI?.xTimeline;
const wsId = new URLSearchParams(location.search).get('wsId') ?? 'unknown';

document.title = 'X Inbox [' + wsId + ']';
document.getElementById('wsLabel').textContent = wsId;

let currentStatus = 'worth';
let offset = 0;
let cachedWcId = null;
let hasMore = false;

async function getWcId() {
  if (cachedWcId) return cachedWcId;
  if (!api) return null;
  const r = await api.getActiveWcId(wsId);
  cachedWcId = r?.wcId ?? null;
  return cachedWcId;
}

async function loadRecipes() {
  if (!api) return;
  const r = await api.listRecipes();
  const sel = document.getElementById('recipeSelect');
  if (r?.success && r.recipes?.length) {
    sel.innerHTML = r.recipes.map(rec =>
      '<option value="' + rec.id + '">' + rec.name + '</option>'
    ).join('');
  } else {
    sel.innerHTML = '<option value="">无配方</option>';
  }
}

async function loadCounts() {
  if (!api) return;
  const statuses = ['worth', 'pending', 'skip', 'filtered_out'];
  for (const s of statuses) {
    const r = await api.queryInbox({ status: s, wsId: wsId, limit: 1000, offset: 0 });
    const el = document.getElementById('count-' + s);
    if (el && r?.records) el.textContent = r.records.length;
  }
}

async function loadTweets(append) {
  if (!api) {
    document.getElementById('cardList').innerHTML =
      '<div class="empty-state">electronAPI.xTimeline 不可用（需要通过内置浏览器打开）</div>';
    return;
  }
  if (!append) { offset = 0; }

  const opts = {
    status: currentStatus === 'all' ? undefined : currentStatus,
    wsId: wsId,
    limit: 20,
    offset: append ? offset : 0,
  };
  const r = await api.queryInbox(opts);
  if (!append) offset = 0;
  if (r?.records) {
    offset += r.records.length;
    hasMore = r.records.length === 20;
    renderCards(r.records, append);
  }
  loadCounts();
}

function renderCards(records, append) {
  const list = document.getElementById('cardList');
  if (!append) list.innerHTML = '';

  if (!records.length && !append) {
    list.innerHTML = '<div class="empty-state">暂无推文</div>';
    return;
  }

  for (const t of records) {
    const card = document.createElement('div');
    card.className = 'card ' + t.status;
    card.dataset.id = t.tweet_id;

    const ago = t.fetched_at ? timeAgo(t.fetched_at) : '';
    const likes = t.metrics?.likes ?? 0;
    const tags = t.ai_verdict?.tags ?? [];
    const reason = t.ai_verdict?.reason ?? '';

    const tagsHtml = tags.length
      ? '<div class="tags">' + tags.map(function(tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('') + '</div>'
      : '';
    const reasonHtml = reason ? '<div class="ai-reason">' + esc(reason) + '</div>' : '';
    const expandHtml = t.text && t.text.length > 160
      ? '<div class="expand-btn" onclick="toggleExpand(\'' + esc(t.tweet_id) + '\')">展开</div>'
      : '';
    const viewBtn = t.tweet_url
      ? '<button class="sm" onclick="viewTweet(\'' + esc(t.tweet_url) + '\')">查看原推</button>'
      : '';
    const replyBtn = t.tweet_url
      ? '<button class="sm primary" onclick="sendToReply(' + JSON.stringify({tweet_url: t.tweet_url, tweet_id: t.tweet_id, author_handle: t.author_handle, text: (t.text || '').slice(0, 120)}) + ')">送入回复</button>'
      : '';

    card.innerHTML =
      '<div class="card-header">' +
        '<span class="author-name">' + esc(t.author_name) + '</span>' +
        '<span class="author-handle">@' + esc(t.author_handle) + '</span>' +
        '<span class="meta"><span>' + ago + '</span><span>❤ ' + likes + '</span></span>' +
      '</div>' +
      '<div class="tweet-text" id="txt-' + esc(t.tweet_id) + '">' + esc(t.text) + '</div>' +
      expandHtml +
      tagsHtml +
      reasonHtml +
      '<div class="card-actions">' + viewBtn + replyBtn + '</div>';

    list.appendChild(card);
  }

  if (hasMore) {
    const btn = document.createElement('div');
    btn.className = 'load-more';
    btn.innerHTML = '<button onclick="loadTweets(true)">加载更多</button>';
    list.appendChild(btn);
  }
}

function toggleExpand(tweetId) {
  const el = document.getElementById('txt-' + tweetId);
  if (!el) return;
  el.classList.toggle('expanded');
  const btn = el.nextElementSibling;
  if (btn && btn.classList.contains('expand-btn')) {
    btn.textContent = el.classList.contains('expanded') ? '收起' : '展开';
  }
}

function setStatus(status, el) {
  currentStatus = status;
  document.querySelectorAll('.status-item').forEach(function(e) { e.classList.remove('active'); });
  el.classList.add('active');
  loadTweets(false);
}

function viewTweet(url) {
  if (api) api.replyToTweet(url, '', wsId);
}

async function startScan() {
  const recipeId = document.getElementById('recipeSelect').value;
  if (!recipeId) { alert('请选择配方'); return; }
  const wcId = await getWcId();
  if (!wcId) {
    alert('请先在 X 视图登录（当前 workspace 无活跃 X webview）');
    return;
  }
  setScanStatus('扫描中...');
  document.getElementById('scanBtn').disabled = true;
  const r = await api.runRecipe(recipeId, wsId, wcId);
  setScanStatus(r?.success ? '完成：采集 ' + (r.saved ?? 0) + ' 条' : '失败：' + r?.error);
  document.getElementById('scanBtn').disabled = false;
  loadTweets(false);
}

async function stopScan() {
  if (!api) return;
  await api.pauseScan(wsId);
  setScanStatus('已暂停');
}

async function triggerJudge() {
  if (!api) return;
  setScanStatus('AI 判断中...');
  const r = await api.judgeNow();
  setScanStatus(r?.success ? 'AI 判断完成' : '判断失败：' + r?.error);
  loadTweets(false);
}

function setScanStatus(msg) {
  document.getElementById('scanStatus').textContent = msg;
}

async function sendToReply(tweet) {
  const msg = '即将在 X 中打开 @' + tweet.author_handle + ' 的推文准备回复。\\n\\n' + tweet.text;
  if (window.confirm(msg)) {
    const r = await api.replyToTweet(tweet.tweet_url, tweet.tweet_id, wsId);
    if (!r?.success) alert('导航失败：' + r?.error);
  }
}

async function checkOllama() {
  const el = document.getElementById('ollamaStatus');
  try {
    const r = await fetch('http://localhost:11434/api/tags');
    el.textContent = r.ok ? '✅ 就绪' : '❌ 不可用';
  } catch(e) {
    el.textContent = '❌ 不可用';
  }
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

loadRecipes();
loadTweets(false);
checkOllama();
setInterval(checkOllama, 30000);
</script>
</body>
</html>`;

function makeHandler(): (request: Request) => Response {
  return (_request: Request): Response => {
    return new Response(INDEX_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
}

export function registerXInboxProtocol(): void {
  protocol.handle(SCHEME, makeHandler());
}

const registeredSessions = new WeakSet<Session>();

export function registerXInboxForSession(sess: Session): void {
  if (registeredSessions.has(sess)) return;
  registeredSessions.add(sess);
  sess.protocol.handle(SCHEME, makeHandler());
}
