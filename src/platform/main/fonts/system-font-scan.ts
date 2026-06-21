/**
 * 系统字体扫描(main 进程,W5 边界内)— L5-G7.1
 *
 * 职责:扫本机系统字体目录 → 读 name 表取 family/style → 列出可选字体。
 * Mac 主力中文字体(苹方等)是 .ttc 集合,展开为 per-subfont 条目(带 fontIndex)。
 * 不支持的格式 / 解析失败的 **fail loud(console.warn 明确跳过)**,不静默崩(红线)。
 *
 * 渲染进程经 IPC `FONT_LIST_SYSTEM` 拿结果,不直 import 本模块(W5)。
 *
 * 范围(G7.0 实测 + 用户拍板 D1):
 * - .ttf / .otf 单字体(99.9% / 99.5% opentype 可解析)
 * - .ttc 集合 → 子字体展开(苹方/黑体/Hiragino 全过)
 * - 个别异常 → 列为跳过,embed 时 fail loud
 *
 * 清单依据:docs/RefactorV2/stages/L5G7-G7.0-opentype-compat-report.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isTtc, extractSfntFromTtc } from './ttc-extract';
import { isTtcBuffer, ttcSubfontDirOffsets, readSfntNames } from './sfnt-name-reader';

/** 一条可选系统字体(展开后:.ttc 的每个子字体一条) */
export interface SystemFontEntry {
  /** 字体族名(name 表 fontFamily,如 "PingFang SC") */
  family: string;
  /** 字重 / 样式(name 表 fontSubfamily,如 "Regular" / "Bold") */
  style: string;
  /** 源文件绝对路径 */
  path: string;
  /** .ttc 内子字体序号;非 ttc 恒为 0 */
  fontIndex: number;
  /** 文件格式 */
  format: 'ttf' | 'otf' | 'ttc';
  /** name 表可读(可嵌入候选);真正字形可解析性在 embed 时校验 */
  supported: boolean;
}

/**
 * 扫描目录列表(按平台)。Linux 暂不写死目录但留接口(返回空,不报错)。
 * Mac 苹方等 CJK 主力住在 AssetsV2 的 MobileAsset 子目录,需递归扫。
 */
function scanDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      path.join(home, 'Library', 'Fonts'),
      // 苹方 PingFang / 部分系统字体住这(MobileAsset 下载式字体)
      '/System/Library/AssetsV2',
    ];
  }
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    return [
      path.join(winDir, 'Fonts'),
      // 每用户字体(Win10+)
      path.join(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
    ];
  }
  // Linux / 其它:暂不写死,留空(后续可扩 fontconfig 目录)
  return [];
}

const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc']);

/** 递归收集字体文件路径(忽略无权限 / 不存在的目录,不报错) */
function collectFontFiles(dir: string, acc: { path: string; ext: string }[], depth = 0): void {
  // AssetsV2 嵌套较深,限个合理递归深度防极端目录树
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 无权限 / 不存在 — 跳过,不报错
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectFontFiles(full, acc, depth + 1);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (FONT_EXTS.has(ext)) acc.push({ path: full, ext });
    }
  }
}

/**
 * 扫描系统字体,返回去重后的可选字体清单。
 *
 * 提速:只读 `name` 表(sfnt-name-reader),不做全量 opentype.parse —— 后者会解析
 * glyf/CFF/cmap 等全部表(本机 ~2900 字体全量 parse 约 26s,会卡死主进程),
 * 改 name-only 读取后降到秒级。完整 parse 推迟到嵌入(G7.2,那时才真正需要字形)。
 *
 * - .ttf/.otf:直读 name 表
 * - .ttc:按子字体表目录偏移逐个读 name 表(不必抽整 sfnt)
 * - 同名(family+style)去重:同一 family 在多文件 / .ttc 重复子字体里只留第一条
 * - 无 name / 读取失败:console.warn 计数跳过(fail loud,不静默崩)
 */
export function scanSystemFonts(): SystemFontEntry[] {
  const files: { path: string; ext: string }[] = [];
  for (const dir of scanDirs()) collectFontFiles(dir, files);

  const result: SystemFontEntry[] = [];
  const seen = new Set<string>(); // dedup key
  let skippedParse = 0;
  let skippedTtcSub = 0;

  const pushNamed = (
    names: { family: string; style: string } | null,
    filePath: string,
    ext: 'ttf' | 'otf' | 'ttc',
    fontIndex: number,
  ): boolean => {
    if (!names || !names.family) return false;
    const key = `${names.family}__${names.style}`;
    if (seen.has(key)) return true; // dedup 命中也算成功,不计 skipped
    seen.add(key);
    result.push({
      family: names.family,
      style: names.style,
      path: filePath,
      fontIndex,
      format: ext,
      supported: true,
    });
    return true;
  };

  for (const f of files) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(f.path);
    } catch {
      continue; // 读取失败(权限) — 跳过
    }

    if (f.ext === '.ttc' || isTtcBuffer(buf)) {
      let dirOffsets: number[];
      try {
        dirOffsets = ttcSubfontDirOffsets(buf);
      } catch {
        skippedParse++;
        continue;
      }
      for (let idx = 0; idx < dirOffsets.length; idx++) {
        const names = readSfntNames(buf, dirOffsets[idx]);
        if (!pushNamed(names, f.path, 'ttc', idx)) skippedTtcSub++;
      }
    } else {
      const ext = f.ext === '.otf' ? 'otf' : 'ttf';
      const names = readSfntNames(buf, 0);
      if (!pushNamed(names, f.path, ext, 0)) skippedParse++;
    }
  }

  // fail loud:汇总跳过情况(不静默)
  if (skippedParse > 0 || skippedTtcSub > 0) {
    console.warn(
      `[font-scan] skipped ${skippedParse} files + ${skippedTtcSub} ttc sub-fonts ` +
        `(no name table / unreadable); collected ${result.length} selectable fonts`,
    );
  }

  // 按 family 排序(同 family 的多 style 相邻),便于 UI 分组
  result.sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
  return result;
}

/**
 * 按 family 名读出字体二进制(L5-G7b 记名方案核心)。
 *
 * 转向后画板**不嵌入字体本体**,只记 `sysname:<family>`;本机渲染 / 导出时按名
 * 实时把该字体读出来 outline。本函数:family 名 → 扫描结果里查 path+fontIndex →
 * readFontBinary 抽出独立 sfnt buffer。
 *
 * - 扫描结果模块级缓存(首调扫一次,~0.5s;后续命中缓存),避免每字形探测重扫。
 * - 同 family 多 style:优先 Regular(渲染默认字重;bold/italic 暂不分,沿用记名方案
 *   "只记 family"的粒度,字重靠 opentype 合成 / 后续扩)。
 * - 查不到(对方没装该字体)→ 返回 null(渲染层据此回退**打包字体**,红线:不乱码)。
 * - 读取 / 抽取失败 → fail loud(console.warn)+ 返回 null。
 *
 * @returns ArrayBuffer(可直接 transfer 给渲染进程喂 opentype.parse)或 null(没装 / 读失败)
 */
let _scanCache: SystemFontEntry[] | null = null;

function cachedScan(): SystemFontEntry[] {
  if (!_scanCache) _scanCache = scanSystemFonts();
  return _scanCache;
}

export function readFontByName(family: string): ArrayBuffer | null {
  if (!family) return null;
  const fonts = cachedScan();
  const matches = fonts.filter((f) => f.family === family);
  if (matches.length === 0) {
    // 对方没装该字体 —— 正常路径,渲染层回退打包字体(非错误,不 warn)
    return null;
  }
  // 优先 Regular 字重;无 Regular 取第一条
  const pick = matches.find((f) => /regular/i.test(f.style)) ?? matches[0];
  try {
    const { buffer } = readFontBinary(pick.path, pick.fontIndex);
    // 拷成独立 ArrayBuffer(避免把整个 Node Buffer 底层池 / SharedArrayBuffer 透传)
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    return ab;
  } catch (err) {
    // fail loud:命中了 family 但读取 / ttc 抽取失败(红线:不静默崩)
    console.warn(`[font] readFontByName 读取失败 family=${family} path=${pick.path}:`, err);
    return null;
  }
}

/**
 * 按 path + fontIndex 读出字体二进制,统一为可被 opentype.parse 的独立 sfnt。
 * .ttc 经 extractSfntFromTtc 抽出指定子字体;.ttf/.otf 原样返回。
 * 供 readFontByName(本机渲染 / 导出按名读)用。
 *
 * @returns { buffer, ext } ext 是落盘文件后缀(按 sfnt version 判 ttf/otf)
 * @throws 读取失败 / ttc 抽取失败
 */
export function readFontBinary(filePath: string, fontIndex: number): { buffer: Buffer; ext: 'ttf' | 'otf' } {
  const buf = fs.readFileSync(filePath);
  if (isTtc(buf)) {
    const ab = extractSfntFromTtc(buf, fontIndex);
    return { buffer: Buffer.from(ab), ext: sfntExt(new DataView(ab)) };
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { buffer: buf, ext: sfntExt(dv) };
}

/** sfntVersion == 'OTTO'(0x4F54544F)→ CFF outline(otf);否则 TrueType(ttf) */
function sfntExt(dv: DataView): 'ttf' | 'otf' {
  return dv.getUint32(0) === 0x4f54544f ? 'otf' : 'ttf';
}
