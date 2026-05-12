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
const DATABASE = 'krig_note_v2';
const READY_TIMEOUT = 15000;
const READY_POLL_INTERVAL = 500;
const DB_SUBDIR = 'krig-data/surreal';

let db: Surreal | null = null;
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

export function getDB(): Surreal {
  if (!db) throw new Error('SurrealDB not initialized; call initSurrealDB() first');
  return db;
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
    database: DATABASE,
  };
}

export function getMode(): 'sidecar' {
  return 'sidecar';
}

// ── Binary 查找 ──

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

async function killOrphanSurrealProcesses(reason: string): Promise<void> {
  const dbDir = getDbDir();
  try {
    const { stdout } = await execFileAsync('pgrep', [
      '-f',
      `surreal start.*rocksdb://.*${dbDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ]);
    const pids = stdout
      .split('\n')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const ownPid = serverProcess?.pid;
    const orphanPids = pids.filter((pid) => pid !== ownPid);
    if (orphanPids.length === 0) return;

    console.log(`[storage/surreal] Killing orphan server(s) [${reason}]: PIDs=${orphanPids.join(',')}`);
    for (const pid of orphanPids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* 已死或权限不足 */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // pgrep 无匹配,静默
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
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

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

async function connectDB(): Promise<void> {
  const { username, password } = credentials();
  db = new Surreal();
  await db.connect(`ws://127.0.0.1:${serverPort}/rpc`);
  await db.signin({ username, password });
  await db.use({ namespace: NAMESPACE, database: DATABASE });
  console.log(`[storage/surreal] Connected via WebSocket (${NAMESPACE}/${DATABASE})`);
}

// ── 公开 API ──

export async function initSurrealDB(): Promise<void> {
  await startServer();
  await connectDB();
  isReady = true;
  for (const cb of readyCallbacks) {
    try { cb(); } catch (err) { console.error('[storage/surreal] Ready callback error:', err); }
  }
  readyCallbacks.length = 0;
  console.log('[storage/surreal] Sidecar mode started');
}

/** 同步关闭(用于 before-quit;不等子进程退出) */
export function shutdownSurrealDB(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      if (serverProcess) {
        try { serverProcess.kill('SIGKILL'); } catch { /* ignore */ }
        serverProcess = null;
      }
    }, 300);
  }
  isReady = false;
}

/** 异步关闭(等子进程真退出 + 孤儿兜底,用于 reset/restore) */
export async function shutdownSurrealDBAsync(): Promise<void> {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
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
