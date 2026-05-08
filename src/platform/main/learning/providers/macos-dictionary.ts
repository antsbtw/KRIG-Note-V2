/**
 * macOS 原生词典 provider(L5-B3.20a)
 *
 * V1 → V2 直迁:src/main/learning/providers/macos-dictionary.ts(94 行,行为不变)
 *
 * 通过 swift CLI 调 CoreServices `DCSCopyTextDefinition`(macOS Dictionary.app 的内核
 * API)。需要系统装 Xcode Command Line Tools(swift 命令);未装时 spawn 失败,
 * 静默返 null,让 dictionary-service 走 Google fallback(决策 Q5 = A)。
 *
 * 平台限制:`process.platform !== 'darwin'` 直接返 null。Windows / Linux 词典 provider
 * 留 Phase D。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LookupResult {
  word: string;
  definition: string;
  phonetic?: string;
  source: string;
}

const SWIFT_SCRIPT = `
import Foundation
import CoreServices

let word = CommandLine.arguments[1]
let nsWord = word as NSString
let range = CFRangeMake(0, nsWord.length)

var results: [[String: String]] = []

if let dicts = DCSGetActiveDictionaries()?.takeUnretainedValue() as? [DCSDictionary] {
  for dict in dicts {
    if let def = DCSCopyTextDefinition(dict, nsWord, range) {
      let text = def.takeRetainedValue() as String
      let name = DCSDictionaryGetName(dict)?.takeUnretainedValue() as String? ?? "Unknown"
      results.append(["dict": name, "definition": text])
    }
  }
}

if results.isEmpty {
  if let def = DCSCopyTextDefinition(nil, nsWord, range) {
    let text = def.takeRetainedValue() as String
    results.append(["dict": "Default", "definition": text])
  }
}

if results.isEmpty {
  print("[]")
} else {
  if let jsonData = try? JSONSerialization.data(withJSONObject: results),
     let jsonStr = String(data: jsonData, encoding: .utf8) {
    print(jsonStr)
  } else {
    print("[]")
  }
}
`;

interface DictEntry {
  dict: string;
  definition: string;
}

export async function macosLookup(word: string): Promise<LookupResult | null> {
  if (process.platform !== 'darwin') return null;

  try {
    const { stdout } = await execFileAsync('swift', ['-e', SWIFT_SCRIPT, word], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '[]') return null;

    let entries: DictEntry[];
    try {
      entries = JSON.parse(trimmed);
    } catch {
      return { word, definition: trimmed, source: 'macOS Dictionary' };
    }

    if (entries.length === 0) return null;

    const definition = entries
      .map((e) => (entries.length > 1 ? `【${e.dict}】\n${e.definition}` : e.definition))
      .join('\n\n');

    return {
      word,
      definition,
      source: entries.map((e) => e.dict).join(', '),
    };
  } catch {
    return null;
  }
}
