/**
 * useSearch — 搜索 hook(L5-C3)
 *
 * V1 → V2 改写:src/plugins/ebook/hooks/useSearch.ts(87 行)。
 * 改动:接 host 命令式 API 而不是直 renderer ref(decoupling — view 不感知
 * renderer 细节,通过 hostRef.searchText / hostRef.goToSearchResult 调)。
 *
 * Debounce 300ms(对齐 V1)。
 *
 * 用法(view 端):
 *   const { visible, results, currentIndex, openSearch, ...handlers } = useSearch(hostRef);
 *   <SearchBar visible={visible} results={results} ... handlers />
 *   keymap 'Cmd+F' → openSearch()
 */

import { useState, useCallback, useRef } from 'react';
import type { EBookHostHandle, SearchResult } from '../Host';

const SEARCH_DEBOUNCE_MS = 300;

export function useSearch(hostRef: React.RefObject<EBookHostHandle | null>) {
  const [visible, setVisible] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateTo = useCallback(
    (result: SearchResult) => {
      hostRef.current?.goToSearchResult(result);
    },
    [hostRef],
  );

  const handleSearch = useCallback(
    (query: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(async () => {
        const host = hostRef.current;
        if (!host || !query.trim()) {
          setResults([]);
          setCurrentIndex(0);
          host?.clearSearch();
          return;
        }
        const r = await host.searchText(query.trim());
        setResults(r);
        setCurrentIndex(0);
        if (r.length > 0) navigateTo(r[0]);
      }, SEARCH_DEBOUNCE_MS);
    },
    [hostRef, navigateTo],
  );

  const handleNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (currentIndex + 1) % results.length;
    setCurrentIndex(next);
    navigateTo(results[next]);
  }, [results, currentIndex, navigateTo]);

  const handlePrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (currentIndex - 1 + results.length) % results.length;
    setCurrentIndex(prev);
    navigateTo(results[prev]);
  }, [results, currentIndex, navigateTo]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setResults([]);
    setCurrentIndex(0);
    hostRef.current?.clearSearch();
  }, [hostRef]);

  const openSearch = useCallback(() => {
    setVisible(true);
  }, []);

  return {
    visible,
    results,
    currentIndex,
    openSearch,
    handleSearch,
    handleNext,
    handlePrev,
    handleClose,
  };
}
