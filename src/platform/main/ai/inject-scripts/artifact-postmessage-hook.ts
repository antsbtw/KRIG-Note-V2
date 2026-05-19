/**
 * Claude Artifact postMessage Hook
 *
 * Reverse-engineering finding (2026-04-13):
 *   Artifact iframes (claudeusercontent.com / claudemcpcontent.com) speak a
 *   JSON-RPC 2.0 "MCP UI" protocol with the parent page. Observed iframe→parent
 *   methods: `ui/notifications/sandbox-proxy-ready`, `ui/initialize`,
 *   `ui/notifications/initialized`, `ui/notifications/size-changed`,
 *   `notifications/message`, etc. The parent replies to `ui/initialize`
 *   (request id=1) with the artifact source, and subsequent resource reads
 *   (`ui/resources/read` or similar) may also carry source.
 *
 * Strategy:
 *   - Hook Window.prototype.postMessage to catch parent→iframe and
 *     iframe→parent direct posts, keyed by whether the source/target window
 *     is an artifact iframe (not by targetOrigin string, since parent
 *     responses use '*').
 *   - Hook MessagePort.prototype.postMessage because many iframe apps
 *     upgrade to a MessageChannel after the initial handshake.
 *   - Capture-phase message listener on parent window, including e.ports
 *     so later MessagePort traffic is still visible.
 *
 * Electron origin workaround: rewrite any `app://` targetOrigin to `*` when
 * posting to a non-same-origin window, to keep artifact rendering working.
 *
 * Idempotent.
 */

export function getArtifactPostMessageHookScript(): string {
  // Bump this when the hook logic changes so old injected versions get
  // replaced on page reload (the guard would otherwise skip re-install).
  return `(function() {
  var HOOK_VERSION = 2;
  if (window.__krig_artifact_hook_version === HOOK_VERSION) return 'already_hooked';
  window.__krig_artifact_hook_version = HOOK_VERSION;
  window.__krig_artifact_hooked = true;

  var MAX_MESSAGES = 500;
  window.__krig_artifact_messages = window.__krig_artifact_messages || [];

  function isArtifactOrigin(origin) {
    if (typeof origin !== 'string') return false;
    return origin.indexOf('claudeusercontent.com') !== -1 ||
           origin.indexOf('claudemcpcontent.com') !== -1 ||
           origin.indexOf('claudeartifacts.com') !== -1;
  }

  function isArtifactWindow(w) {
    if (!w || w === window) return false;
    try {
      // Can't read cross-origin .location.href, but can enumerate iframes.
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === w) {
          var src = frames[i].src || '';
          return isArtifactOrigin(src);
        }
      }
    } catch (e) {}
    return false;
  }

  function safeClone(data) {
    try { return JSON.parse(JSON.stringify(data)); }
    catch (e) {
      try { return String(data); } catch (_) { return null; }
    }
  }

  function record(channel, direction, data, meta) {
    try {
      window.__krig_artifact_messages.push({
        ts: Date.now(),
        channel: channel, // 'window' | 'port'
        direction: direction,
        targetOrigin: meta && meta.targetOrigin || null,
        sourceOrigin: meta && meta.sourceOrigin || null,
        data: safeClone(data),
      });
      while (window.__krig_artifact_messages.length > MAX_MESSAGES) {
        window.__krig_artifact_messages.shift();
      }
    } catch (e) {}
  }

  // ─── Hook Window.prototype.postMessage ───
  try {
    var winProto = window.Window && window.Window.prototype;
    var origWinPost = winProto && winProto.postMessage;
    if (origWinPost) {
      winProto.postMessage = function(data, targetOrigin, transfer) {
        try {
          // 'this' is the target Window. Parent→iframe posts will have
          // this === some artifact iframe's contentWindow.
          var toArtifact = isArtifactWindow(this);
          // iframe→parent via e.source.postMessage(reply) — then 'this'
          // is the top window (= window), and we rely on the message-event
          // listener below to see the other direction.
          if (toArtifact) {
            record('window', 'out', data, { targetOrigin: targetOrigin });
          }
          if (typeof targetOrigin === 'string' && targetOrigin.indexOf('app://') === 0 && this !== window) {
            return origWinPost.call(this, data, '*', transfer);
          }
        } catch (e) {}
        return origWinPost.call(this, data, targetOrigin, transfer);
      };
    }
  } catch (e) {}

  // ─── Hook MessagePort.prototype.postMessage ───
  // Tag ports we've seen come from an artifact iframe message event so we
  // can label which direction a port message is going.
  var _artifactPorts = new WeakSet();
  try {
    var portProto = window.MessagePort && window.MessagePort.prototype;
    var origPortPost = portProto && portProto.postMessage;
    if (origPortPost) {
      portProto.postMessage = function(data, transferOrOpts) {
        try {
          if (_artifactPorts.has(this)) {
            record('port', 'out', data, null);
          }
        } catch (e) {}
        return origPortPost.apply(this, arguments);
      };
    }
  } catch (e) {}

  // ─── Hook window.fetch to catch artifact resource loads ───
  // The sandbox-proxy pattern: iframe asks parent (via port) to fetch an
  // artifact resource, parent uses its cookies to fetch and sends the body
  // back over the port. Capturing the fetch body directly is simpler than
  // decoding the port protocol.
  try {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = '';
      if (typeof input === 'string') url = input;
      else if (input && typeof input === 'object' && input.url) url = input.url;
      var interesting = typeof url === 'string' && (
        url.indexOf('/api/organizations/') !== -1 && url.indexOf('artifact') !== -1 ||
        url.indexOf('claudeusercontent.com') !== -1 ||
        url.indexOf('claudemcpcontent.com') !== -1 ||
        url.indexOf('claudeartifacts.com') !== -1
      );
      var p = origFetch.apply(this, arguments);
      if (interesting) {
        p.then(function(resp) {
          try {
            var clone = resp.clone();
            var ct = (clone.headers && clone.headers.get && clone.headers.get('content-type')) || '';
            if (ct.indexOf('json') !== -1) {
              clone.json().then(function(j) {
                record('fetch', 'in', { url: url, body: j }, { sourceOrigin: 'fetch' });
              }).catch(function(){});
            } else {
              clone.text().then(function(t) {
                record('fetch', 'in', { url: url, body: t }, { sourceOrigin: 'fetch' });
              }).catch(function(){});
            }
          } catch (e) {}
        }).catch(function(){});
      }
      return p;
    };
  } catch (e) {}

  // ─── Capture-phase message listener ───
  window.addEventListener('message', function(e) {
    try {
      var so = e.origin || '';
      var fromArtifact = isArtifactOrigin(so);
      if (fromArtifact) {
        record('window', 'in', e.data, { sourceOrigin: so });
        // If the iframe transferred any MessagePorts, tag them so future
        // port traffic is recorded in both directions.
        if (e.ports && e.ports.length) {
          for (var i = 0; i < e.ports.length; i++) {
            var p = e.ports[i];
            try {
              _artifactPorts.add(p);
              // Also listen on the port itself for inbound messages.
              (function(port) {
                port.addEventListener('message', function(pe) {
                  try { record('port', 'in', pe.data, null); } catch (_) {}
                }, true);
                try { port.start(); } catch (_) {}
              })(p);
            } catch (_) {}
          }
        }
      }
    } catch (err) {}
  }, true);

  return 'hooked';
})()`;
}

export function getArtifactReadScript(): string {
  return `(function() { return window.__krig_artifact_messages || []; })()`;
}
