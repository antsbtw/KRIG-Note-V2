//# sourceURL=krig://sync-inject.js
// L5-B4.2:guest webview 端注入脚本(从 V1 直迁,命名空间 __mirro → __krig)
// 将在 sync-driver.injectSyncScript 内通过 executeJavaScript 注入到 webview。
//
// 占位 __KRIG_SIDE__ 在注入前替换为 'left' 或 'right'。
(function() {
  if (window.__krigSyncSetup) return;
  window.__krigSyncSetup = true;
  window.__krigSyncQueue = [];
  window.__krigSyncSide = '__KRIG_SIDE__';

  // ── Shared helpers (used by scroll sync and selection highlight) ──
  var blockTags = ['P','LI','TD','TH','BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6','FIGCAPTION','DT','DD'];

  function getBlockIndex(el) {
    var tag = el.tagName;
    var all = document.getElementsByTagName(tag);
    for (var i = 0; i < all.length; i++) {
      if (all[i] === el) return { tag: tag, index: i };
    }
    return null;
  }

  // ── Scroll sync (deltaY pixel sync + anchor correction after stop) ──
  window.__krigProgramScrollY = -1;
  window.__krigSmoothScrolling = false;
  var lastScrollY = window.scrollY;
  var scrollStopTimer = null;

  var priorityTags = ['H1','H2','H3','IMG'];

  function makeAnchorResult(el) {
    var tag = el.tagName;
    var all = document.getElementsByTagName(tag);
    for (var i = 0; i < all.length; i++) {
      if (all[i] === el) {
        var rect = el.getBoundingClientRect();
        var offsetRatio = 0;
        if (rect.height > 0) {
          offsetRatio = Math.max(0, Math.min(1, -rect.top / rect.height));
        }
        return { tag: tag, index: i, offsetRatio: offsetRatio };
      }
    }
    return null;
  }

  function findAnchor() {
    try {
      var halfH = window.innerHeight * 0.5;

      // Priority pass: find H1/H2/H3/IMG in upper half of viewport
      var bestPriority = null;
      var bestTop = halfH + 1;
      for (var t = 0; t < priorityTags.length; t++) {
        var els = document.getElementsByTagName(priorityTags[t]);
        for (var i = 0; i < els.length; i++) {
          var rect = els[i].getBoundingClientRect();
          if (rect.bottom > 0 && rect.top < halfH && rect.height > 0) {
            if (rect.top < bestTop) {
              bestTop = rect.top;
              bestPriority = els[i];
            }
          }
        }
      }
      if (bestPriority) {
        var result = makeAnchorResult(bestPriority);
        if (result) return result;
      }

      // Fallback: probe for any block element near top
      for (var probeY = 0; probeY <= 200; probeY += 20) {
        var probes = [0.1, 0.3, 0.5];
        for (var pi = 0; pi < probes.length; pi++) {
          var probeX = window.innerWidth * probes[pi];
          var hitEl = document.elementFromPoint(probeX, probeY);
          if (!hitEl) continue;
          var el = hitEl;
          while (el && el !== document.body && el !== document.documentElement) {
            if (blockTags.indexOf(el.tagName) >= 0) {
              var info = getBlockIndex(el);
              if (info) {
                var r = el.getBoundingClientRect();
                var off = 0;
                if (r.height > 0) {
                  off = Math.max(0, Math.min(1, -r.top / r.height));
                }
                return { tag: info.tag, index: info.index, offsetRatio: off };
              }
              break;
            }
            el = el.parentElement;
          }
        }
      }
    } catch(e) {}
    return null;
  }

  window.addEventListener('scroll', function() {
    var currentY = window.scrollY;

    if (window.__krigSmoothScrolling) {
      lastScrollY = currentY;
      return;
    }

    var progY = window.__krigProgramScrollY;
    if (progY >= 0 && Math.abs(currentY - progY) < 2) {
      window.__krigProgramScrollY = -1;
      lastScrollY = currentY;
      return;
    }
    window.__krigProgramScrollY = -1;

    var deltaY = currentY - lastScrollY;
    lastScrollY = currentY;
    if (deltaY !== 0) {
      window.__krigSyncQueue.push({ type: 'scroll-delta', deltaY: deltaY });
    }

    clearTimeout(scrollStopTimer);
    scrollStopTimer = setTimeout(function() {
      var anchor = findAnchor();
      if (anchor) {
        window.__krigSyncQueue.push({ type: 'scroll-anchor', anchor: anchor });
      } else {
        var maxScrollY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        var maxScrollX = Math.max(1, document.documentElement.scrollWidth - window.innerWidth);
        window.__krigSyncQueue.push({
          type: 'scroll-anchor',
          anchor: null,
          pctX: window.scrollX / maxScrollX,
          pctY: window.scrollY / maxScrollY
        });
      }
    }, 200);
  }, { passive: true });

  window.addEventListener('wheel', function() {
    if (window.__krigSmoothScrolling) {
      window.__krigSmoothScrolling = false;
    }
  }, { passive: true });
  window.addEventListener('touchstart', function() {
    if (window.__krigSmoothScrolling) {
      window.__krigSmoothScrolling = false;
    }
  }, { passive: true });

  // ── Input sync ──
  document.addEventListener('input', function(e) {
    if (window.__krigInputLock) return;
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !el.isContentEditable) return;

    var selector = buildSelector(el);
    if (!selector) return;

    window.__krigSyncQueue.push({
      type: 'input',
      selector: selector,
      value: el.value || el.textContent || '',
      inputType: el.type || '',
      checked: el.checked || false
    });
  }, true);

  document.addEventListener('change', function(e) {
    if (window.__krigInputLock) return;
    var el = e.target;
    if (!el || !el.tagName) return;

    var selector = buildSelector(el);
    if (!selector) return;

    window.__krigSyncQueue.push({
      type: 'input',
      selector: selector,
      value: el.value || '',
      inputType: el.type || '',
      checked: el.checked || false
    });
  }, true);

  // ── Click sync ──
  document.addEventListener('click', function(e) {
    if (window.__krigClickLock) return;
    var el = e.target;
    if (!el || !el.tagName) return;

    var link = el.closest ? el.closest('a[href]') : null;
    if (link) {
      // Link clicks 由 navigation sync 处理(避免双重导航)
      return;
    }

    var selector = buildSelector(el);
    if (!selector) return;

    setTimeout(function() {
      var toggleState = null;
      try {
        var toggle = el.closest ? (el.closest('[aria-expanded]') || el) : el;
        var expanded = toggle.getAttribute('aria-expanded');
        if (expanded !== null) {
          toggleState = { attr: 'aria-expanded', value: expanded };
        }

        if (!toggleState) {
          var controlled = null;
          var ariaControls = el.getAttribute('aria-controls');
          if (ariaControls) {
            controlled = document.getElementById(ariaControls);
          }
          if (!controlled) {
            controlled = el.nextElementSibling;
          }
          if (controlled) {
            var style = window.getComputedStyle(controlled);
            var isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            toggleState = { controlledSelector: buildSelector(controlled), visible: isVisible };
          }
        }
      } catch(ex) {}

      window.__krigSyncQueue.push({
        type: 'click',
        selector: selector,
        toggleState: toggleState
      });
    }, 50);
  }, true);

  // ── Selection highlight sync ──
  var selectionTimeout = null;
  document.addEventListener('selectionchange', function() {
    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(function() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        window.__krigSyncQueue.push({ type: 'selection', blocks: null });
        return;
      }
      var range = sel.getRangeAt(0);
      var blocks = [];
      var seen = {};

      for (var t = 0; t < blockTags.length; t++) {
        var els = document.getElementsByTagName(blockTags[t]);
        for (var i = 0; i < els.length; i++) {
          if (range.intersectsNode(els[i])) {
            var info = getBlockIndex(els[i]);
            if (info) {
              var key = info.tag + ':' + info.index;
              if (!seen[key]) { blocks.push(info); seen[key] = true; }
            }
          }
        }
      }
      if (blocks.length > 0) {
        window.__krigSyncQueue.push({ type: 'selection', blocks: blocks });
      }
    }, 200);
  });

  // ── Enter key on input ──
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;

    var selector = buildSelector(el);
    if (!selector) return;

    var value = el.value || '';
    if (value.trim()) {
      window.__krigSyncQueue.push({
        type: 'input-enter',
        selector: selector,
        value: value
      });
    }
  }, true);

  // ── Form submit sync ──
  document.addEventListener('submit', function(e) {
    if (window.__krigInputLock) return;
    var form = e.target;
    var selector = buildSelector(form);
    if (!selector) return;

    var formData = {};
    var inputs = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var name = inp.name || inp.id;
      if (name) {
        formData[name] = { value: inp.value || '', checked: inp.checked || false };
      }
    }

    window.__krigSyncQueue.push({
      type: 'submit',
      selector: selector,
      formData: formData
    });
  }, true);

  // ── Input focus/blur (right side only,触发 future translation popup placeholder)──
  if (window.__krigSyncSide === 'right') {
    document.addEventListener('focusin', function(e) {
      var el = e.target;
      if (!el || !el.tagName) return;
      var tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return;
      if (el.type === 'password' || el.type === 'hidden') return;

      var selector = buildSelector(el);
      if (!selector) return;

      var rect = el.getBoundingClientRect();
      window.__krigSyncQueue.push({
        type: 'input-focus',
        selector: selector,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        inputType: el.type || ''
      });
    }, true);

    document.addEventListener('focusout', function(e) {
      var el = e.target;
      if (!el || !el.tagName) return;
      var tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return;

      window.__krigSyncQueue.push({ type: 'input-blur' });
    }, true);
  }

  // ── Helper: build a robust CSS selector for an element ──
  function buildSelector(el) {
    try {
      if (el.id) return '#' + CSS.escape(el.id);

      var parts = [];
      var current = el;
      var depth = 0;
      while (current && current !== document.body && current !== document.documentElement && depth < 10) {
        var tag = current.tagName.toLowerCase();
        if (current.id) {
          parts.unshift('#' + CSS.escape(current.id));
          break;
        }
        var parent = current.parentElement;
        if (parent) {
          var siblings = parent.children;
          var index = 0;
          for (var i = 0; i < siblings.length; i++) {
            if (siblings[i] === current) { index = i + 1; break; }
          }
          parts.unshift(tag + ':nth-child(' + index + ')');
        } else {
          parts.unshift(tag);
        }
        current = parent;
        depth++;
      }
      var selector = parts.join(' > ');
      if (selector && document.querySelector(selector) === el) return selector;
      return null;
    } catch (e) {
      return null;
    }
  }
})();
