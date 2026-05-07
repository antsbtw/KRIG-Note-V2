//# sourceURL=krig://google-translate-inject.js
// L5-B4.2:Google Translate widget 启动器(从 V1 直迁,命名空间 __mirro → __krig)
// 占位 __KRIG_TARGET_LANG__ 在注入前替换(translate-driver 内做)
(function() {
  var TARGET_LANG = '__KRIG_TARGET_LANG__';

  // Language changed on an already-injected page — switch via cookie + select
  if (window.__krigTranslateInjected) {
    window.__krigSwitchLog = (window.__krigSwitchLog || []);
    window.__krigSwitchLog.push('reinject for lang ' + TARGET_LANG + ' (was ' + window.__krigCurrentLang + ')');
    if (window.__krigCurrentLang === TARGET_LANG) {
      window.__krigSwitchLog.push('same lang,skip');
      return;
    }
    window.__krigCurrentLang = TARGET_LANG;

    document.cookie = 'googtrans=/auto/' + TARGET_LANG + '; path=/';

    var select = document.querySelector('#google_translate_element select');
    window.__krigSwitchLog.push('select found: ' + !!select + ', options: ' + (select ? select.options.length : 0));
    if (select) {
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === TARGET_LANG) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change'));
          window.__krigSwitchLog.push('select 切到 ' + TARGET_LANG + ' (idx ' + i + ') + dispatchChange');
          return;
        }
      }
      window.__krigSwitchLog.push('select 没找到 ' + TARGET_LANG + ' option,fallback re-init widget');
    }

    var el = document.getElementById('google_translate_element');
    if (el) el.innerHTML = '';
    new google.translate.TranslateElement({
      pageLanguage: 'auto',
      includedLanguages: 'zh-CN,ja,ko,en',
      autoDisplay: false,
      layout: google.translate.TranslateElement.InlineLayout.SIMPLE
    }, 'google_translate_element');

    setTimeout(function() {
      var sel = document.querySelector('#google_translate_element select');
      if (sel) {
        for (var j = 0; j < sel.options.length; j++) {
          if (sel.options[j].value === TARGET_LANG) {
            sel.selectedIndex = j;
            sel.dispatchEvent(new Event('change'));
            window.__krigSwitchLog.push('500ms 后 re-init select 切到 ' + TARGET_LANG);
            break;
          }
        }
      }
    }, 500);
    return;
  }

  // First injection on this page
  window.__krigTranslateInjected = true;
  window.__krigCurrentLang = TARGET_LANG;

  document.cookie = 'googtrans=/auto/' + TARGET_LANG + '; path=/';

  var div = document.createElement('div');
  div.id = 'google_translate_element';
  div.style.display = 'none';
  document.body.appendChild(div);

  window.googleTranslateElementInit = function() {
    new google.translate.TranslateElement({
      pageLanguage: 'auto',
      includedLanguages: 'zh-CN,ja,ko,en',
      autoDisplay: false,
      layout: google.translate.TranslateElement.InlineLayout.SIMPLE
    }, 'google_translate_element');

    setTimeout(function() {
      var select = document.querySelector('#google_translate_element select');
      if (select) {
        for (var i = 0; i < select.options.length; i++) {
          if (select.options[i].value === TARGET_LANG) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change'));
            break;
          }
        }
      }
    }, 500);
  };

  // 注:element.js 由 main 进程 executeJavaScript 注入(避 CSP),renderer 无需 <script src>

  var style = document.createElement('style');
  style.textContent = [
    '#google_translate_element { display: none !important; }',
    '.skiptranslate { display: none !important; }',
    '.goog-te-banner-frame { display: none !important; }',
    'body { top: 0 !important; position: static !important; }',
  ].join('\n');
  document.head.appendChild(style);

  // 防 Google Translate 覆盖背景色(保暗色主题一致)
  var bgObs = new MutationObserver(function() {
    if (document.body && document.body.style.backgroundColor) {
      document.body.style.removeProperty('background-color');
    }
  });
  if (document.body) {
    bgObs.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      bgObs.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    });
  }
})();
