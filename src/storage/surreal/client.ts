/**
 * V2 SurrealDB Client — Sidecar 模式
 *
 * 启动独立 surreal server 进程,通过 WebSocket 连接。
 * 决议 011 §5.6 (方案 A): 本 sub-phase 仅 Sidecar,Embedded 升级留未来 sub-phase。
 *
 * 防御性启动 (memory project_surreal_defensive_startup):
 * - startServer 前 pgrep + SIGKILL 残留 surreal 进程 → 根治"重置后连回旧数据"
 * - shutdownSurrealDBAsync 末尾再清一次孤儿
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { Surreal } from 'surrealdb';

const DEFAULT_PORT = 8533;
const NAMESPACE = 'krig';
/** 笔记库 —— getDB() 的目标,全 app 默认库 */
const NOTE_DATABASE = 'krig_note_v2';
/**
 * X 库 —— getXDB() 的目标。与笔记库**物理隔离**的独立 database(同 ns)。
 *
 * 隔离是有意的(见 docs/00-architecture/storage-isolation-boundaries.md):
 * X 是外部采集数据,不进笔记本体命名空间;独立 schema / migration / 清理粒度,
 * SurrealDB 层面无法跨库 JOIN。跨库关联(若将来需要)只能落应用层。
 */
const X_DATABASE = 'krig_x';
const READY_TIMEOUT = 15000;
const READY_POLL_INTERVAL = 500;
const DB_SUBDIR = 'krig-data/surreal';

let db: Surreal | null = null;
let xdb: Surreal | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = DEFAULT_PORT;
let isReady = false;

type ReadyCallback = () => void;
const readyCallbacks: ReadyCallback[] = [];

function getCredentialsPath(): string {
  return path.join(app.getPath('userData'), '.db-credentials');
}

function getDbDir(): string {
  return path.join(app.getPath('userData'), DB_SUBDIR);
}

function getCredentials(): { username: string; password: string } {
  const credPath = getCredentialsPath();
  try {
    if (existsSync(credPath)) {
      const data = JSON.parse(readFileSync(credPath, 'utf-8'));
      if (data.username && data.password) return data;
    }
  } catch {
    // 文件损坏,重新生成
  }
  const credentials = { username: 'root', password: randomBytes(24).toString('hex') };
  const dir = path.dirname(credPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(credPath, JSON.stringify(credentials), 'utf-8');
  return credentials;
}

let cachedCredentials: { username: string; password: string } | null = null;
function credentials(): { username: string; password: string } {
  if (!cachedCredentials) cachedCredentials = getCredentials();
  return cachedCredentials;
}

export function onDBReady(callback: ReadyCallback): void {
  if (isReady) {
    callback();
  } else {
    readyCallbacks.push(callback);
  }
}

/** 笔记库连接(krig_note_v2)。全 app 默认库,语义与多库改造前一致。 */
export function getDB(): Surreal {
  if (!db) throw new Error('SurrealDB not initialized; call initSurrealDB() first');
  return db;
}

/**
 * X 库连接(krig_x)。
 *
 * **绝不 fallback 到 getDB()** —— 一旦兜底,X 数据会静默写进笔记库,
 * 而"两边数据不混"正是独立库要保证的东西。未初始化就是 bug,直接 throw。
 */
export function getXDB(): Surreal {
  if (!xdb) throw new Error('X SurrealDB not initialized; call initSurrealDB() first');
  return xdb;
}

export function isDBReady(): boolean {
  return isReady;
}

export function getConnectionInfo() {
  const { username, password } = credentials();
  return {
    endpoint: `http://127.0.0.1:${serverPort}`,
    username,
    password,
    namespace: NAMESPACE,
    database: NOTE_DATABASE,
  };
}

/** X 库的 ns/db(与 getConnectionInfo 同端点、同凭据,只是库名不同) */
export function getXConnectionInfo() {
  return { ...getConnectionInfo(), database: X_DATABASE };
}

export function getMode(): 'sidecar' {
  return 'sidecar';
}

// ── Binary 查找 ──

/** 暴露给 backup-store 复用(避免重复二进制查找逻辑) */
export function findSurrealBinary(): string | null {
  return findBinary();
}

function findBinary(): string | null {
  const exe = process.platform === 'win32' ? 'surreal.exe' : 'surreal';
  const arch = process.arch;
  const platform = process.platform;
  const platformDir =
    platform === 'darwin' ? `darwin-${arch}` :
    platform === 'linux'  ? `linux-${arch}`  :
    platform === 'win32'  ? `win32-${arch}`  : null;

  const candidates = [
    // 打包内置 (extraResource);本 sub-phase 不打包,但保留接口
    path.join(process.resourcesPath || '', exe),
    // dev 模式: build/<platform-arch>/<surreal>
    platformDir ? path.join(app.getAppPath(), 'build', 'surreal', platformDir, exe) : null,
    // 用户自带
    path.join(app.getPath('userData'), 'bin', exe),
    // Homebrew (macOS)
    '/opt/homebrew/bin/surreal',
    // 系统安装
    '/usr/local/bin/surreal',
  ].filter((p): p is string => typeof p === 'string');

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ── LOCK 清理 ──

function cleanLock(): void {
  const lockPath = path.join(getDbDir(), 'LOCK');
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
      console.log('[storage/surreal] Cleaned stale LOCK file');
    }
  } catch (err) {
    console.warn('[storage/surreal] Failed to clean LOCK:', err);
  }
}

// ── 孤儿进程清理 ──

const execFileAsync = promisify(execFile);

/**
 * 找到「命令行含本 dbDir 的 surreal start」孤儿进程的 PID 列表。
 * Windows 无 pgrep,改用 PowerShell CIM 查 CommandLine;Unix 走 pgrep -f。
 */
async function findOrphanSurrealPids(dbDir: string): Promise<number[]> {
  if (process.platform === 'win32') {
    // CommandLine 里同时含 "surreal" 与 dbDir 的进程即目标(路径分隔符 win 下为 \)
    const needle = dbDir.replace(/'/g, "''");
    const ps =
      `Get-CimInstance Win32_Process -Filter "Name='surreal.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${needle}*' } | ` +
      `Select-Object -ExpandProperty ProcessId`;
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', ps,
    ]);
    return stdout
      .split('\n')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const { stdout } = await execFileAsync('pgrep', [
    '-f',
    `surreal start.*rocksdb://.*${dbDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  ]);
  return stdout
    .split('\n')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function killOrphanSurrealProcesses(reason: string): Promise<void> {
  const dbDir = getDbDir();
  try {
    const pids = await findOrphanSurrealPids(dbDir);
    const ownPid = serverProcess?.pid;
    const orphanPids = pids.filter((pid) => pid !== ownPid);
    if (orphanPids.length === 0) return;

    console.log(`[storage/surreal] Killing orphan server(s) [${reason}]: PIDs=${orphanPids.join(',')}`);
    for (const pid of orphanPids) {
      // process.kill 在 Windows 上忽略 SIGKILL 语义但仍会强制终止;跨平台可用
      try { process.kill(pid, 'SIGKILL'); } catch { /* 已死或权限不足 */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // 查不到匹配进程(pgrep 无匹配 / CIM 空),静默
  }
}

// ── Server 启动 ──

async function startServer(): Promise<void> {
  const binary = findBinary();
  if (!binary) {
    throw new Error(
      '[storage/surreal] Binary not found. Expected at build/surreal/<platform-arch>/surreal or /opt/homebrew/bin/surreal',
    );
  }

  const dbPath = getDbDir();
  if (!existsSync(path.dirname(dbPath))) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  await killOrphanSurrealProcesses('pre-start');
  cleanLock();

  const { username, password } = credentials();
  console.log(`[storage/surreal] Starting server on port ${serverPort} (binary=${binary})`);

  serverProcess = spawn(
    binary,
    [
      'start',
      '--bind', `127.0.0.1:${serverPort}`,
      '--username', username,
      '--password', password,
      '--log', 'warn',
      `rocksdb://${dbPath}`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // 独立进程组(detached):否则 sidecar 与 app 同组,Ctrl+C 的 SIGINT 会被
      // **同时**投递给它,它 ~0.3s 就自己退了 —— 而此时 before-quit 的
      // reconcileHasWindow 还要用这条连接写 hasWindow,于是写在一条已死的连接上,
      // 重连 15s 后抛 CallTerminatedError,hasWindow 落不了盘
      // (退化成 24a137a1 修掉的「每次启动开两个窗口」)。
      // detached 后 sidecar 收不到终端信号,只由我们在 shutdownSurrealDB 里显式
      // kill —— 关闭时序从此完全由 app 掌握:先写完对账,再关库。
      detached: true,
    },
  );
  // detached 的子进程默认会让父进程的事件循环一直等它 → 退出被吊住。
  // unref 解除这层引用;进程本身仍在跑,仍由 shutdownSurrealDB 显式 kill。
  serverProcess.unref();

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[storage/surreal server] ${data.toString().trim()}`);
  });
  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[storage/surreal server] ${data.toString().trim()}`);
  });
  serverProcess.on('close', (code) => {
    console.log(`[storage/surreal] Server exited with code ${code}`);
    serverProcess = null;
  });

  await waitForReady();
}

async function waitForReady(): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < READY_TIMEOUT) {
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/health`);
      if (res.ok) {
        console.log(`[storage/surreal] Server ready on port ${serverPort}`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL));
  }
  throw new Error(`[storage/surreal] Server failed to start within ${READY_TIMEOUT}ms`);
}

// ── WebSocket 连接 ──

/**
 * 建立一条到指定 database 的连接。
 *
 * **每个库一条独立连接,不用 `use()` 切库** —— SurrealDB WS 的鉴权态与 ns/db
 * 绑在单条 socket 上,SDK 自动重连后建立的是全新匿名会话:一次性 signin()/use()
 * 不会重放,重连后所有 RPC 报 NotAllowed。只有 connect() 的选项会随重连恢复
 * (见下方 connect 调用处的详注)。所以「一条连接 + use() 来回切」在重连后必然
 * 退化成:鉴权没了、库也切回默认 —— 两个坑一起踩。
 */
async function connectOne(database: string): Promise<Surreal> {
  const { username, password } = credentials();
  const conn = new Surreal();
  // 鉴权 + ns/db 走 connect() 选项而非一次性 signin()/use():
  // SurrealDB WS 的鉴权态绑定在单条 socket 上,SDK 自动重连后会建立全新匿名会话。
  // 一次性 signin() 不会在重连后重放 → 重连后所有 RPC 报 NotAllowed(Anonymous access not allowed)。
  // connect({ authentication }) 的凭据会被 SDK 在每次(重)连接时复用(见 d.ts ConnectOptions.authentication),
  // namespace/database 同样作为连接配置随重连恢复。
  // [surreal-ws] WS 连接事件长期观测 — 2026-05-31 排查 AI webview 震荡时确认了
  // "震荡 → WS 断连"因果不成立(webview 震荡全程 WS 始终 connected),但**真实断连源头仍未知**
  // (上一轮观察到的 NotAllowed / NavSide 归零背后的触发条件没找到)。
  // 保留这组 subscribe 作被动埋点:下次正常使用中若再撞断连/归零,终端会有
  // `[surreal-ws] event=disconnect/reconnect` 时间戳可直接对齐当时操作。成本极低(仅状态翻转时打一行)。
  // 详见 docs/90-archive/tasks/2026-05-31-ai-webview-churn-investigation.md。断连真因确认后可移除。
  {
    const stamp = (): string => new Date().toISOString();
    // 日志带库名:两条连接的事件混在一起时,不带标签就分不清是谁断了。
    for (const evt of ['connecting', 'connected', 'reconnecting', 'disconnected'] as const) {
      conn.subscribe(evt, () => {
        // 退出途中的断连/重连是预期内噪音,不刷屏(真因排查埋点只关心运行期)
        if (shuttingDown) return;
        console.log(`[surreal-ws][${database}] ${stamp()} event=${evt} status=${conn.status}`);
      });
    }
    conn.subscribe('error', (err: unknown) => {
      if (shuttingDown) return;
      console.log(`[surreal-ws][${database}] ${stamp()} event=error status=${conn.status} err=${String(err)}`);
    });
  }

  await conn.connect(`ws://127.0.0.1:${serverPort}/rpc`, {
    namespace: NAMESPACE,
    database,
    authentication: { username, password },
    // 显式配置重连:服务端是本机 sidecar 子进程,不是网络对端。它没了通常意味着
    // 「进程组一起在退出」或「sidecar 崩了」,不值得按公网对端的耐心去等。
    // SDK 默认 attempts:5 次数本身不多,但 retryDelay 1s ×2 递增、封顶
    // retryDelayMax **60s** —— 尾几次每次要等到近一分钟,进程就吊在那儿出不去,
    // 观感就是「Ctrl+C 后 app 迟迟不退还在刷 event=reconnecting」。
    // 这里把封顶压到 4s:短暂抖动仍能自愈,真没了也能很快认输放事件循环走人。
    // 注:ReconnectOptions.catch 的返回值会被 SDK 丢弃(propagate 只调不取值),
    // 拦不住重连,故不用它做退出短路 —— 真正起作用的只有 enabled / attempts / 延迟。
    reconnect: {
      enabled: true,
      attempts: 5,
      retryDelay: 500,
      retryDelayMax: 4_000,
      retryDelayMultiplier: 2,
      retryDelayJitter: 0.1,
    },
  });
  console.log(`[storage/surreal] Connected via WebSocket (${NAMESPACE}/${database})`);
  return conn;
}

// ── 公开 API ──

export async function initSurrealDB(): Promise<void> {
  await startServer();
  // 两条独立连接:笔记库 + X 库。顺序无所谓(同一个 sidecar),
  // 但两条都连上才算 ready —— X 连接失败不能降级成"只有笔记库能用",
  // 那会让 getXDB() 在运行期才 throw,故障点离真因十万八千里。
  db = await connectOne(NOTE_DATABASE);
  xdb = await connectOne(X_DATABASE);
  isReady = true;
  for (const cb of readyCallbacks) {
    try { cb(); } catch (err) { console.error('[storage/surreal] Ready callback error:', err); }
  }
  readyCallbacks.length = 0;
  console.log('[storage/surreal] Sidecar mode started');
}

/**
 * 标记「本进程正在主动退出」。
 *
 * 置位后 WS 断连一律视为预期内(见 connectOne 的 reconnecting 监听):不再重连、
 * 不再刷日志。Ctrl+C 场景尤其重要 —— SurrealDB 子进程与本进程同属一个进程组、
 * 会**同时**收到 SIGINT,子进程往往先死,此时若客户端还认为是意外掉线,
 * SDK 就会对着一个已经没了的服务端指数退避重连(2s→4s→8s→16s…)不肯收手。
 */
let shuttingDown = false;

export function markStorageShuttingDown(): void {
  shuttingDown = true;
}

/** 同步关闭(用于 before-quit;不等子进程退出) */
export function shutdownSurrealDB(): void {
  shuttingDown = true;
  // 所有常驻连接都要有停止调用(memory project-graceful-shutdown):
  // 漏关一条,它的重连定时器会把事件循环吊住,表现成"Ctrl+C 后不退"。
  for (const conn of [db, xdb]) {
    if (conn) { try { conn.close(); } catch { /* ignore */ } }
  }
  db = null;
  xdb = null;
  if (serverProcess) {
    // detached 后 sidecar 不再随终端信号一起死,必须由我们显式送信号。
    // 这里是**同步**退出路径(before-quit 二次进入后紧接着就 exit),原先那个
    // 300ms 后补 SIGKILL 的 setTimeout 根本等不到执行 —— 进程先没了。
    // 故直接 SIGTERM;surreal 收到后会自己 graceful 退出(日志 `Goodbye!`)。
    // 万一它没退成孤儿,下次启动 initSurrealDB → killOrphanSurrealProcesses 会兜掉。
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
    serverProcess = null;
  }
  isReady = false;
}

/** 异步关闭(等子进程真退出 + 孤儿兜底,用于 reset/restore) */
export async function shutdownSurrealDBAsync(): Promise<void> {
  for (const conn of [db, xdb]) {
    if (conn) { try { conn.close(); } catch { /* ignore */ } }
  }
  db = null;
  xdb = null;
  if (serverProcess) {
    const proc = serverProcess;
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
      proc.once('close', () => {
        clearTimeout(killTimer);
        resolve();
      });
      try { proc.kill('SIGTERM'); } catch { resolve(); }
    });
    serverProcess = null;
  }
  await killOrphanSurrealProcesses('post-shutdown');
  isReady = false;
}
