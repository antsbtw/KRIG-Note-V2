/**
 * IconsTabPanel — callout Icons tab 字面全库分组 + 搜索(D023 Step 5.8 emoji-mart 同款)
 *
 * 字面结构(对齐 emoji-mart 字面视觉):
 *   ┌─ search box (sticky top)
 *   ├─ category nav bar (1 row chips: Callouts + 42 lucide categories)
 *   └─ scroll area (vertical):
 *      ├─ "Callouts" section (68 置顶,字面 callout-icons.ts)
 *      ├─ "accessibility" section ... (42 lucide categories,每个 chunk 字面 IntersectionObserver lazy render)
 *      └─ "Others" section (249 无 meta 字面 alias/deprecated icon 字面兜底)
 *
 * 字面渲染策略:
 * - 68 Callouts 字面用静态 LucideIcons[Pascal] export(快路径,字面 Vite tree-shake 入主 bundle)
 * - 1884 其他 icon 字面用 lucide 字面 `<DynamicIcon name={kebab}>`(lazy chunk)
 * - 字面每 section 字面 IntersectionObserver 字面仅渲滚动到视口内的 chunk
 *   (字面初次 mount 字面只渲 Callouts + 视口附近 1-2 个 category;
 *    字面其他 category 字面 placeholder div 保留 scrollHeight,字面进入视口时 render icons)
 *
 * 字面搜索:
 * - 字面 query 字面非空时,字面全局过滤 manifest(tags + name + categories)
 * - 字面匹配结果字面单 flat grid 显示(字面绕过 category 分组,字面对齐 emoji-mart 搜索同款)
 *
 * 字面点击 category chip:
 * - 字面 scrollIntoView({ behavior: 'smooth' }) 字面平滑滚到对应 section
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { CALLOUT_ICON_PICKS } from './callout-icons';
import lucideManifest from './lucide-manifest.json';

interface Props {
  onPick: (iconName: string) => void;
}

interface ManifestIcon {
  pascalName: string;
  tags: ReadonlyArray<string>;
  categories: ReadonlyArray<string>;
}

interface ManifestType {
  version: string;
  builtAt: string;
  iconCount: number;
  iconsWithMeta: number;
  iconsWithoutMeta: number;
  categories: ReadonlyArray<string>;
  icons: Record<string, ManifestIcon>;
}

const MANIFEST = lucideManifest as ManifestType;

// 字面 Pascal → kebab 反向 map(给静态 path 回头查 kebab 字面交给 DynamicIcon 用)
// 字面构建一次性,模块 init 字面 ~30ms。
const PASCAL_TO_KEBAB = new Map<string, string>();
for (const [kebab, info] of Object.entries(MANIFEST.icons)) {
  PASCAL_TO_KEBAB.set(info.pascalName, kebab);
}

interface Section {
  id: string;
  title: string;
  icons: Array<{ kebab: string; pascalName: string; isStatic: boolean; tooltip: string }>;
}

/** 字面按 category 字面 group icon,字面 Callouts 字面置顶,字面无 meta 字面归入 "Others" */
function buildSections(): Section[] {
  const calloutsKebabs = new Set<string>();
  const calloutLabelByKebab = new Map<string, string>();

  for (const pick of CALLOUT_ICON_PICKS) {
    const kebab = PASCAL_TO_KEBAB.get(pick.name);
    if (kebab) {
      calloutsKebabs.add(kebab);
      calloutLabelByKebab.set(kebab, pick.label);
    }
  }

  // 字面 Callouts section 字面用 CALLOUT_ICON_PICKS 原序(用户字面 Notion 风格高频排序)
  const callouts: Section = {
    id: 'callouts',
    title: 'Callouts',
    icons: CALLOUT_ICON_PICKS.flatMap((pick) => {
      const kebab = PASCAL_TO_KEBAB.get(pick.name);
      if (!kebab) return [];
      return [{ kebab, pascalName: pick.name, isStatic: true, tooltip: pick.label }];
    }),
  };

  // 字面每个 lucide category 字面 chunk
  const byCategory = new Map<string, Section>();
  for (const cat of MANIFEST.categories) {
    byCategory.set(cat, { id: cat, title: cat, icons: [] });
  }

  const others: Section = { id: 'others', title: 'Others', icons: [] };

  for (const [kebab, info] of Object.entries(MANIFEST.icons)) {
    if (calloutsKebabs.has(kebab)) continue; // 字面已进 Callouts 不重复
    if (info.categories.length === 0) {
      others.icons.push({
        kebab,
        pascalName: info.pascalName,
        isStatic: false,
        tooltip: info.pascalName,
      });
      continue;
    }
    // 字面 icon 字面归入字面第一个 category(emoji-mart 字面同款,字面避免重复出现)
    const primary = info.categories[0];
    const section = byCategory.get(primary);
    if (section) {
      section.icons.push({
        kebab,
        pascalName: info.pascalName,
        isStatic: false,
        tooltip: info.pascalName,
      });
    }
  }

  // 字面每 section 字面按 name 排序,字面浏览字面字母序更直觉
  for (const section of byCategory.values()) {
    section.icons.sort((a, b) => a.pascalName.localeCompare(b.pascalName));
  }
  others.icons.sort((a, b) => a.pascalName.localeCompare(b.pascalName));

  const result: Section[] = [callouts];
  for (const cat of MANIFEST.categories) {
    const section = byCategory.get(cat);
    if (section && section.icons.length > 0) result.push(section);
  }
  if (others.icons.length > 0) result.push(others);
  return result;
}

function matchesQuery(
  kebab: string,
  info: ManifestIcon,
  q: string,
): boolean {
  if (kebab.includes(q)) return true;
  if (info.pascalName.toLowerCase().includes(q)) return true;
  if (info.tags.some((t) => t.toLowerCase().includes(q))) return true;
  if (info.categories.some((c) => c.toLowerCase().includes(q))) return true;
  return false;
}

/** 静态 lucide-react named export lookup(Pascal name) */
function getStaticLucideIcon(pascalName: string): LucideIcons.LucideIcon | null {
  const exported = (LucideIcons as unknown as Record<string, unknown>)[pascalName];
  if (!exported || typeof exported !== 'object') return null;
  return exported as LucideIcons.LucideIcon;
}

interface IconCellProps {
  kebab: string;
  pascalName: string;
  tooltip: string;
  isStatic: boolean;
  onClick: () => void;
}

function IconCell({ kebab: _kebab, pascalName, tooltip, isStatic, onClick }: IconCellProps) {
  // 字面静态 path 字面优先(68 Callouts + 字面用户 search 命中后字面已 cache 的 icon)
  if (isStatic) {
    const StaticIcon = getStaticLucideIcon(pascalName);
    if (StaticIcon) {
      return (
        <button type="button" className="krig-icons-tab__cell" title={tooltip} onClick={onClick}>
          <StaticIcon size={20} aria-hidden />
        </button>
      );
    }
  }
  // 字面动态 path:DynamicIcon 字面 useEffect lazy 加载(首帧字面 null,加载完字面 mount svg)
  return (
    <button type="button" className="krig-icons-tab__cell" title={tooltip} onClick={onClick}>
      <DynamicIcon name={_kebab as IconName} size={20} aria-hidden />
    </button>
  );
}

interface SectionViewProps {
  section: Section;
  onPick: (pascalName: string) => void;
  setRef: (id: string, el: HTMLDivElement | null) => void;
}

/** 字面 section 字面 IntersectionObserver lazy render(visible 才渲 icon,字面其他字面 placeholder) */
function SectionView({ section, onPick, setRef }: SectionViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(section.id === 'callouts'); // Callouts 字面首屏可见,字面立即 render

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      // 字面 rootMargin 200px 字面让滚到视口前 200px 就开始渲(平滑滚动字面无空白闪烁)
      { root: el.closest('.krig-icons-tab__scroll'), rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // 字面 placeholder 字面 height 字面按 grid 行数估算(8 列 * 40px / 行 + 36px title)
  const estimatedRows = Math.ceil(section.icons.length / 8);
  const placeholderHeight = estimatedRows * 40 + 36;

  return (
    <div
      ref={(el) => {
        ref.current = el;
        setRef(section.id, el);
      }}
      className="krig-icons-tab__section"
      data-section-id={section.id}
    >
      <div className="krig-icons-tab__section-title">{section.title}</div>
      {visible ? (
        <div className="krig-icons-tab__section-grid">
          {section.icons.map((icon) => (
            <IconCell
              key={icon.kebab}
              kebab={icon.kebab}
              pascalName={icon.pascalName}
              tooltip={icon.tooltip}
              isStatic={icon.isStatic}
              onClick={() => onPick(icon.pascalName)}
            />
          ))}
        </div>
      ) : (
        <div
          className="krig-icons-tab__section-placeholder"
          style={{ height: placeholderHeight }}
          aria-hidden
        />
      )}
    </div>
  );
}

export function IconsTabPanel({ onPick }: Props) {
  const [query, setQuery] = useState('');
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => buildSections(), []);

  // 字面搜索结果(query 字面非空时字面绕过分组)
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    // 字面置顶 Callouts pick(若命中字面用 pick label/keywords 字面再匹配一遍,字面用户体验字面优先)
    const calloutHits: Array<{ kebab: string; pascalName: string; isStatic: boolean; tooltip: string }> = [];
    const otherHits: Array<{ kebab: string; pascalName: string; isStatic: boolean; tooltip: string }> = [];
    const calloutsKebabs = new Set<string>();

    for (const pick of CALLOUT_ICON_PICKS) {
      const kebab = PASCAL_TO_KEBAB.get(pick.name);
      if (!kebab) continue;
      calloutsKebabs.add(kebab);
      const hitName = pick.name.toLowerCase().includes(q);
      const hitLabel = pick.label.toLowerCase().includes(q);
      const hitKw = pick.keywords.some((k) => k.toLowerCase().includes(q));
      if (hitName || hitLabel || hitKw) {
        calloutHits.push({ kebab, pascalName: pick.name, isStatic: true, tooltip: pick.label });
      }
    }

    for (const [kebab, info] of Object.entries(MANIFEST.icons)) {
      if (calloutsKebabs.has(kebab)) continue;
      if (matchesQuery(kebab, info, q)) {
        otherHits.push({ kebab, pascalName: info.pascalName, isStatic: false, tooltip: info.pascalName });
      }
    }

    // 字面 sort other hits by pascalName,字面 callout hits 字面保留原 pick 序(高频置顶)
    otherHits.sort((a, b) => a.pascalName.localeCompare(b.pascalName));

    return [...calloutHits, ...otherHits];
  }, [query]);

  const setRef = (id: string, el: HTMLDivElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  };

  const jumpToSection = (id: string) => {
    const el = sectionRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="krig-icons-tab">
      <input
        type="text"
        className="krig-icons-tab__search"
        placeholder="Search icons…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* category 导航条(字面 query 非空时字面隐藏) */}
      {!searchResults && (
        <div className="krig-icons-tab__category-nav" aria-label="Icon categories">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="krig-icons-tab__category-chip"
              onClick={() => jumpToSection(section.id)}
              title={section.title}
            >
              {section.title}
            </button>
          ))}
        </div>
      )}

      {/* 滚动区:字面 search 字面单 flat grid,字面无 search 字面分 section */}
      <div ref={scrollRef} className="krig-icons-tab__scroll">
        {searchResults ? (
          searchResults.length === 0 ? (
            <div className="krig-icons-tab__empty">No icons match &ldquo;{query}&rdquo;</div>
          ) : (
            <div className="krig-icons-tab__section-grid">
              {searchResults.map((icon) => (
                <IconCell
                  key={icon.kebab}
                  kebab={icon.kebab}
                  pascalName={icon.pascalName}
                  tooltip={icon.tooltip}
                  isStatic={icon.isStatic}
                  onClick={() => onPick(icon.pascalName)}
                />
              ))}
            </div>
          )
        ) : (
          sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              onPick={onPick}
              setRef={setRef}
            />
          ))
        )}
      </div>
    </div>
  );
}
