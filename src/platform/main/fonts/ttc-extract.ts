/**
 * TTC(TrueType Collection)拆解 shim — L5-G7.1
 *
 * opentype.js@1.3.4 的 `parse()` 不认 `.ttc` 集合容器(直接抛
 * `Unsupported OpenType signature ttcf`)。但 Mac 所有主力中文字体(苹方 PingFang /
 * 黑体 STHeiti / 宋体 Songti / Hiragino)**全是 .ttc**。
 *
 * G7.0 兼容性验证(本机 2611 真实系统字体实测)证明:
 * - .ttc 直 parse 0/150 成功
 * - 但纯 JS 拆解(本模块)救回 47/49,**苹方 PingFang SC / 黑体 Heiti SC /
 *   Hiragino Sans GB 全部 `getPath('测')` 出真实字形**
 *
 * → 首版即支持 .ttc(用户拍板 D1,2026-06-20),零额外依赖。
 *   清单见 docs/RefactorV2/stages/L5G7-G7.0-opentype-compat-report.md。
 *
 * ── 原理 ──
 *
 * TTC 结构:
 *   TTCHeader:'ttcf'(4) majorVer(2) minorVer(2) numFonts(4)
 *             offsetTable[numFonts](4 each, 绝对偏移 → 各子字体的 sfnt 表目录)
 *   每个子字体的 sfnt 表目录:
 *     sfntVersion(4) numTables(2) searchRange(2) entrySelector(2) rangeShift(2)
 *     + numTables × TableRecord{ tag(4) checkSum(4) offset(4) length(4) }
 *       ← offset 是相对**整个 ttc 文件**的绝对偏移
 *
 * 因 table record 的 offset 绝对,无法直接切片(切完 offset 越界)。
 * 重组思路:新建一个独立 sfnt buffer = [新 sfnt 头 + 重定位后的表目录] + [各表数据原样拷贝]。
 * 重组后是合法独立 sfnt → opentype.parse 直接吃。
 *
 * W5:纯主进程逻辑模块,无 electron / fs 依赖(只吃 Buffer),便于单测。
 */

/** ttc magic 'ttcf' 的大端 uint32 */
const TTCF_MAGIC = 0x74746366; // 't','t','c','f'

/** 给定 buffer 是否为 ttc 容器(头 4 字节 == 'ttcf') */
export function isTtc(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32BE(0) === TTCF_MAGIC;
}

/** 读 ttc 头里的子字体数量(非 ttc 抛错) */
export function ttcFontCount(buf: Buffer): number {
  if (!isTtc(buf)) throw new Error('not a ttc (signature != ttcf)');
  return buf.readUInt32BE(8);
}

/**
 * 从 ttc buffer 抽出第 fontIndex 个子字体,重组为一个独立、合法的 sfnt ArrayBuffer。
 * 返回的 ArrayBuffer 可直接喂 `opentype.parse`。
 *
 * @throws 非 ttc / fontIndex 越界 / 结构损坏
 */
export function extractSfntFromTtc(buf: Buffer, fontIndex = 0): ArrayBuffer {
  if (!isTtc(buf)) throw new Error('not a ttc (signature != ttcf)');
  const numFonts = buf.readUInt32BE(8);
  if (fontIndex < 0 || fontIndex >= numFonts) {
    throw new Error(`ttc fontIndex ${fontIndex} out of range [0, ${numFonts})`);
  }

  // 第 fontIndex 个子字体的 sfnt 表目录偏移(TTCHeader 偏移 12 起,每项 4 字节)
  const dirOffset = buf.readUInt32BE(12 + fontIndex * 4);

  const sfntVersion = buf.readUInt32BE(dirOffset);
  const numTables = buf.readUInt16BE(dirOffset + 4);
  if (numTables === 0) throw new Error('ttc sub-font has 0 tables');

  // 读各表记录(offset 是整文件绝对偏移)
  interface Rec {
    tag: number;
    checksum: number;
    offset: number;
    length: number;
  }
  const records: Rec[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = dirOffset + 12 + i * 16;
    records.push({
      tag: buf.readUInt32BE(rec),
      checksum: buf.readUInt32BE(rec + 4),
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }

  // 新 sfnt 布局:头(12) + 表目录(16×numTables) + 各表数据(4 字节对齐)
  const headerSize = 12 + numTables * 16;
  let dataSize = 0;
  for (const r of records) dataSize += (r.length + 3) & ~3; // 4 对齐
  const out = new ArrayBuffer(headerSize + dataSize);
  const odv = new DataView(out);
  const outU8 = new Uint8Array(out);

  // sfnt 头(searchRange/entrySelector/rangeShift 按 OpenType 规范由 numTables 推)
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = Math.pow(2, entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;
  odv.setUint32(0, sfntVersion);
  odv.setUint16(4, numTables);
  odv.setUint16(6, searchRange);
  odv.setUint16(8, entrySelector);
  odv.setUint16(10, rangeShift);

  // 写表目录(重定位 offset)+ 拷各表数据
  let cursor = headerSize;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const rec = 12 + i * 16;
    odv.setUint32(rec, r.tag);
    odv.setUint32(rec + 4, r.checksum);
    odv.setUint32(rec + 8, cursor); // 新偏移(指向重组后的数据区)
    odv.setUint32(rec + 12, r.length);
    // 越界防御:源表数据必须在 buf 范围内
    if (r.offset + r.length > buf.length) {
      throw new Error(`ttc table record out of bounds (offset=${r.offset} len=${r.length})`);
    }
    outU8.set(buf.subarray(r.offset, r.offset + r.length), cursor);
    cursor += (r.length + 3) & ~3;
  }

  return out;
}
