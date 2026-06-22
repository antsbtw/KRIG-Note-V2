/**
 * 轻量 sfnt `name` 表读取器 — L5-G7.1(扫描提速)
 *
 * 背景:扫描阶段只需要每个字体的 family / style 名,但 `opentype.parse` 会**全量解析**
 * glyf / CFF / cmap 等所有表(本机 2900 字体实测全量 parse ~26s,主进程同步会卡死)。
 * 本模块只读 `name` 表(+ 定位用的 sfnt 表目录),把扫描成本降到只读几 KB / 字体。
 *
 * 嵌入(G7.2)仍走完整 opentype.parse(那时确实需要整个字体)。
 *
 * 支持:
 * - 独立 sfnt(.ttf/.otf)— offset 传 0
 * - .ttc 子字体 — offset 传该子字体在文件内的表目录绝对偏移(ttcSubfontDirOffsets 给出)
 *
 * W5:纯逻辑(只吃 Buffer),无 electron/fs/opentype 依赖,便于单测。
 * 规范参考:OpenType `name` 表(platformID/encodingID/languageID/nameID),
 * 取 nameID=1(Font Family)/ nameID=2(Font Subfamily),英文优先。
 */

const TTCF_MAGIC = 0x74746366; // 'ttcf'

/** name 表里我们要的两个 nameID */
const NAME_ID_FAMILY = 1;
const NAME_ID_SUBFAMILY = 2;
/** 优先用 typographic family/subfamily(nameID 16/17),它对变体分组更准 */
const NAME_ID_TYPO_FAMILY = 16;
const NAME_ID_TYPO_SUBFAMILY = 17;

export interface SfntNames {
  family: string;
  style: string;
}

/** 给定文件 buffer 是否 ttc */
export function isTtcBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32BE(0) === TTCF_MAGIC;
}

/**
 * 返回 ttc 内各子字体的表目录绝对偏移列表(非 ttc 抛错)。
 * 用于按 fontIndex 定位子字体的 name 表,而不必整体抽 sfnt。
 */
export function ttcSubfontDirOffsets(buf: Buffer): number[] {
  if (!isTtcBuffer(buf)) throw new Error('not a ttc');
  const numFonts = buf.readUInt32BE(8);
  const offsets: number[] = [];
  for (let i = 0; i < numFonts; i++) offsets.push(buf.readUInt32BE(12 + i * 4));
  return offsets;
}

/**
 * 从 sfnt 表目录(位于 dirOffset)定位 `name` 表,解析出 family/style。
 * dirOffset = 0 表示独立 sfnt(.ttf/.otf);.ttc 子字体传其表目录偏移。
 * 解析失败 / 无 name 表返回 null(调用方按"无名跳过"处理)。
 */
export function readSfntNames(buf: Buffer, dirOffset = 0): SfntNames | null {
  try {
    // sfnt 表目录:sfntVersion(4) numTables(2) ... 然后 numTables × {tag(4) checksum(4) offset(4) length(4)}
    const numTables = buf.readUInt16BE(dirOffset + 4);
    let nameTableOffset = -1;
    let nameTableLength = 0;
    for (let i = 0; i < numTables; i++) {
      const rec = dirOffset + 12 + i * 16;
      const tag = buf.toString('ascii', rec, rec + 4);
      if (tag === 'name') {
        nameTableOffset = buf.readUInt32BE(rec + 8); // 整文件绝对偏移
        nameTableLength = buf.readUInt32BE(rec + 12);
        break;
      }
    }
    if (nameTableOffset < 0 || nameTableOffset + nameTableLength > buf.length) return null;

    return parseNameTable(buf, nameTableOffset);
  } catch {
    return null;
  }
}

/**
 * 解析 name 表(format 0)。
 * 结构:format(2) count(2) stringOffset(2) + count × NameRecord{
 *   platformID(2) encodingID(2) languageID(2) nameID(2) length(2) offset(2)
 * },字符串区从 nameTableOffset + stringOffset 起。
 */
function parseNameTable(buf: Buffer, base: number): SfntNames | null {
  const count = buf.readUInt16BE(base + 2);
  const stringOffset = buf.readUInt16BE(base + 4);
  const stringsBase = base + stringOffset;

  // 每个 nameID 保留"最优"记录:按平台 + 语言打分,高分覆盖低分。
  // 这很关键 —— 苹方 PingFang.ttc 的 Mac(platform=1)记录是 ".PingFang SC" 内部名,
  // 真正可读的 "PingFang SC" 在 Windows(platform=3, en-US)记录里;必须优先后者。
  const best: Record<number, { value: string; score: number }> = {};

  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platformID = buf.readUInt16BE(rec);
    const encodingID = buf.readUInt16BE(rec + 2);
    const languageID = buf.readUInt16BE(rec + 4);
    const nameID = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const offset = buf.readUInt16BE(rec + 10);

    if (
      nameID !== NAME_ID_FAMILY &&
      nameID !== NAME_ID_SUBFAMILY &&
      nameID !== NAME_ID_TYPO_FAMILY &&
      nameID !== NAME_ID_TYPO_SUBFAMILY
    ) {
      continue;
    }

    const start = stringsBase + offset;
    if (start + length > buf.length) continue;
    const value = decodeNameString(buf, start, length, platformID, encodingID);
    if (!value) continue;

    const score = recordScore(platformID, languageID);
    const prev = best[nameID];
    if (!prev || score > prev.score) best[nameID] = { value, score };
  }

  const family = best[NAME_ID_FAMILY]?.value || '';
  const typoFamily = best[NAME_ID_TYPO_FAMILY]?.value || '';
  const style = best[NAME_ID_SUBFAMILY]?.value || '';
  const typoStyle = best[NAME_ID_TYPO_SUBFAMILY]?.value || '';

  const finalFamily = typoFamily || family;
  if (!finalFamily) return null;
  return { family: finalFamily, style: typoStyle || style || 'Regular' };
}

/**
 * name 记录优先级打分。
 * 优先 Windows(platform 3)英文 > Windows 其它语言 > Unicode(platform 0) >
 * Mac 英文(platform 1, lang 0)> Mac 其它。Windows 记录是跨平台最可读的拉丁名。
 */
function recordScore(platformID: number, languageID: number): number {
  if (platformID === 3) return languageID === 0x0409 ? 100 : 80; // Windows, en-US 最高
  if (platformID === 0) return 60; // Unicode
  if (platformID === 1) return languageID === 0 ? 50 : 30; // Mac, English(lang 0)
  return 10;
}

/**
 * 解码 name 字符串。
 * - platformID 0(Unicode)/ 3(Windows):UTF-16BE
 * - platformID 1(Macintosh,Roman):Latin1(近似;CJK Mac 字体其实有 Windows 记录优先命中)
 */
function decodeNameString(
  buf: Buffer,
  start: number,
  length: number,
  platformID: number,
  _encodingID: number,
): string {
  if (platformID === 0 || platformID === 3) {
    // UTF-16BE(Node 只支持 utf16le → 手工字节交换)
    return swapUtf16(buf.subarray(start, start + length));
  }
  // Mac Roman / 其它:按 latin1 近似
  return buf.toString('latin1', start, start + length).replace(/\0+$/, '');
}

/** UTF-16BE → string(Buffer 只支持 utf16le,手工字节交换) */
function swapUtf16(slice: Buffer): string {
  const swapped = Buffer.alloc(slice.length);
  for (let i = 0; i + 1 < slice.length; i += 2) {
    swapped[i] = slice[i + 1];
    swapped[i + 1] = slice[i];
  }
  return swapped.toString('utf16le').replace(/\0+$/, '');
}
