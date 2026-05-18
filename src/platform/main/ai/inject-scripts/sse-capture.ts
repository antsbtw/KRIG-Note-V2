/**
 * SSE Capture — Inject Scripts
 *
 * Generates self-contained JavaScript to inject into AI pages.
 * Adapted from mirro-desktop's ai-bridge/sse-capture/inject-scripts.ts (verified).
 *
 * Strategy:
 * - ChatGPT: Detect conversation completion via /textdocs, then call
 *   GET /backend-api/conversation/{id} to retrieve full Markdown.
 * - Claude: Hook window.fetch to intercept incremental text_delta SSE.
 * - Gemini: Handled via CDP in main process (not here).
 *
 * Key design:
 * - Uses response.clone() so the AI page continues to work normally
 * - Idempotent: safe to inject multiple times (checks window.__krig_sse_hooked)
 * - Stores responses in window.__krig_sse_responses (read by main via executeJavaScript)
 *
 * Design doc: docs/web/WebBridge-设计.md §五
 */

/**
 * Generate the fetch hook script for a specific AI service.
 * Returns a self-contained IIFE string for webContents.executeJavaScript().
 */
export function getSSECaptureScript(
  serviceId: string,
  endpointPattern: string,
): string {
  return `(function() {
  // ─── Idempotent guard ───
  if (window.__krig_sse_hooked) return 'already_hooked';
  window.__krig_sse_hooked = true;
  window.__krig_sse_responses = window.__krig_sse_responses || [];

  var SERVICE_ID = ${JSON.stringify(serviceId)};
  var ENDPOINT_PATTERN = ${JSON.stringify(endpointPattern)};
  var MAX_RESPONSES = 20;

  // ─── ChatGPT: post-hoc conversation fetch ───
  // The conversation SSE goes through Service Worker, bypassing window.fetch.
  // Instead, we detect conversation completion via /textdocs,
  // then fetch the full conversation to extract the last assistant message.

  var _chatgptConversationsFetched = {};
  var _capturedAuthHeader = '';

  function resolveAssetPointer(fileId) {
    var id = fileId.replace('file-service://', '');
    var apiUrl = '/backend-api/files/' + id + '/download';
    var headers = {};
    if (_capturedAuthHeader) {
      headers['Authorization'] = _capturedAuthHeader;
    }
    return window.fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers,
    }).then(function(resp) {
      if (!resp.ok) return null;
      return resp.json();
    }).then(function(data) {
      if (data && data.download_url) return data.download_url;
      return null;
    }).catch(function() {
      return null;
    });
  }

  function fetchChatGPTConversation(conversationId, targetMessageId) {
    var cacheKey = conversationId + (targetMessageId ? ':' + targetMessageId : '');
    if (_chatgptConversationsFetched[cacheKey]) return;
    _chatgptConversationsFetched[cacheKey] = true;

    var apiUrl = '/backend-api/conversation/' + conversationId;
    var headers = {};
    if (_capturedAuthHeader) {
      headers['Authorization'] = _capturedAuthHeader;
    }

    window.fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers,
    }).then(function(resp) {
      if (!resp.ok) {
        delete _chatgptConversationsFetched[cacheKey];
        return null;
      }
      return resp.json();
    }).then(function(data) {
      if (!data || !data.mapping) return;

      var mapping = data.mapping;

      // Find root node (no parent)
      var rootId = null;
      var keys = Object.keys(mapping);
      for (var k = 0; k < keys.length; k++) {
        if (!mapping[keys[k]].parent) { rootId = keys[k]; break; }
      }

      // Walk tree following last child to collect ordered messages
      var orderedMessages = [];
      var currentId = rootId;
      while (currentId && mapping[currentId]) {
        var node = mapping[currentId];
        if (node.message) {
          orderedMessages.push(node.message);
        }
        var children = node.children || [];
        currentId = children.length > 0 ? children[children.length - 1] : null;
      }

      // Extract text + images from assistant messages
      function extractFromMessage(msg) {
        var textParts = [];
        var imageParts = [];
        var content = msg.content;
        if (content && content.parts) {
          for (var p = 0; p < content.parts.length; p++) {
            var part = content.parts[p];
            if (typeof part === 'string') {
              if (part.trim().length > 0) textParts.push(part);
            } else if (part && part.asset_pointer && part.content_type === 'image_asset_pointer') {
              imageParts.push(part);
            }
          }
        }
        if (msg.metadata) {
          if (msg.metadata.content_references) {
            var refs = msg.metadata.content_references;
            for (var cr = 0; cr < refs.length; cr++) {
              var ref = refs[cr];
              if (ref.safe_urls && ref.safe_urls.length > 0) {
                for (var su = 0; su < ref.safe_urls.length; su++) {
                  var safeUrl = ref.safe_urls[su];
                  if (safeUrl.indexOf('images.openai.com') !== -1 || safeUrl.indexOf('oaiusercontent.com') !== -1) {
                    imageParts.push({ _dalleUrl: safeUrl });
                  }
                }
              }
            }
          }
        }
        return { text: textParts, images: imageParts };
      }

      // Group into assistant turns
      var turns = [];
      var currentTurn = null;
      for (var oi = 0; oi < orderedMessages.length; oi++) {
        var om = orderedMessages[oi];
        var omRole = om.author ? om.author.role : 'unknown';
        if (omRole === 'assistant' || omRole === 'tool') {
          if (!currentTurn) currentTurn = { messages: [], messageIds: [] };
          currentTurn.messages.push(om);
          if (om.id) currentTurn.messageIds.push(om.id);
        } else {
          if (currentTurn && currentTurn.messages.length > 0) {
            turns.push(currentTurn);
          }
          currentTurn = null;
        }
      }
      if (currentTurn && currentTurn.messages.length > 0) {
        turns.push(currentTurn);
      }

      // Select turn
      var selectedTurn = null;
      if (targetMessageId) {
        for (var ti = 0; ti < turns.length; ti++) {
          if (turns[ti].messageIds.indexOf(targetMessageId) !== -1) {
            selectedTurn = turns[ti];
            break;
          }
        }
      }
      if (!selectedTurn && turns.length > 0) {
        selectedTurn = turns[turns.length - 1];
      }

      var lastMarkdown = '';
      var allImageParts = [];

      if (selectedTurn) {
        for (var si = selectedTurn.messages.length - 1; si >= 0; si--) {
          var smsg = selectedTurn.messages[si];
          var smsgRole = smsg.author ? smsg.author.role : 'unknown';
          if (smsgRole !== 'assistant') continue;
          var extracted = extractFromMessage(smsg);
          allImageParts = allImageParts.concat(extracted.images);
          if (extracted.text.length > 0 && !lastMarkdown) {
            lastMarkdown = extracted.text.join('\\n');
          }
        }
      }

      if (lastMarkdown || allImageParts.length > 0) {
        var hasImages = allImageParts.length > 0;
        var record = {
          id: 'conv-' + Date.now(),
          timestamp: Date.now(),
          service: 'chatgpt',
          markdown: lastMarkdown || '',
          streaming: hasImages,
          url: apiUrl,
        };
        window.__krig_sse_responses.push(record);
        while (window.__krig_sse_responses.length > MAX_RESPONSES) {
          window.__krig_sse_responses.shift();
        }

        if (hasImages) {
          var imgPromises = [];
          for (var ip = 0; ip < allImageParts.length; ip++) {
            (function(imgPart) {
              if (imgPart._dalleUrl) {
                imgPromises.push(Promise.resolve(imgPart._dalleUrl));
              } else if (imgPart.asset_pointer) {
                imgPromises.push(resolveAssetPointer(imgPart.asset_pointer));
              }
            })(allImageParts[ip]);
          }
          Promise.all(imgPromises).then(function(resolvedUrls) {
            var md = record.markdown;
            var urls = [];
            for (var x = 0; x < resolvedUrls.length; x++) {
              if (resolvedUrls[x]) urls.push(resolvedUrls[x]);
            }
            var urlIdx = 0;
            md = md.replace(/!\\[([^\\]]*)\\]\\(sandbox:[^)]+\\)/g, function(match, alt) {
              if (urlIdx < urls.length) {
                return '![' + alt + '](' + urls[urlIdx++] + ')';
              }
              return match;
            });
            while (urlIdx < urls.length) {
              md = md + '\\n\\n![image](' + urls[urlIdx++] + ')';
            }
            record.markdown = md;
            record.streaming = false;
          }).catch(function() {
            record.streaming = false;
          });
        }
      }
    }).catch(function() {
      delete _chatgptConversationsFetched[cacheKey];
    });
  }

  // ─── Claude: incremental SSE capture ───

  function parseClaude(eventType, dataStr) {
    if (eventType === 'message_stop') return { done: true };
    try {
      var obj = JSON.parse(dataStr);
      if (obj.type === 'content_block_delta' && obj.delta) {
        if (obj.delta.type === 'text_delta' && typeof obj.delta.text === 'string') {
          return { text: obj.delta.text, cumulative: false };
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function readSSEStream(body, url, requestId) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var record = {
      id: requestId,
      timestamp: Date.now(),
      service: SERVICE_ID,
      markdown: '',
      streaming: true,
      url: url,
    };

    window.__krig_sse_responses.push(record);
    while (window.__krig_sse_responses.length > MAX_RESPONSES) {
      window.__krig_sse_responses.shift();
    }

    function processChunk() {
      reader.read().then(function(result) {
        if (result.done) {
          record.streaming = false;
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        buffer = buffer.replace(/\\r\\n/g, '\\n');
        var events = buffer.split('\\n\\n');
        buffer = events.pop() || '';

        for (var i = 0; i < events.length; i++) {
          processSSEEvent(events[i], record);
        }
        processChunk();
      }).catch(function() {
        record.streaming = false;
      });
    }
    processChunk();
  }

  function processSSEEvent(raw, record) {
    var lines = raw.split('\\n');
    var eventType = '';
    var dataLines = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('event:') === 0) {
        eventType = line.substring(6).trim();
      } else if (line.indexOf('data:') === 0) {
        dataLines.push(line.substring(5).trim());
      }
    }

    if (dataLines.length === 0) return;
    var dataStr = dataLines.join('\\n');

    var parsed = parseClaude(eventType, dataStr);
    if (!parsed) return;

    if (parsed.done) {
      record.streaming = false;
      return;
    }
    if (parsed.text) {
      record.markdown += parsed.text;
    }
  }

  // ─── Fetch hook ───

  var _originalFetch = window.fetch;
  var _requestCounter = 0;

  window.fetch = function() {
    var args = arguments;
    var url = '';
    if (typeof args[0] === 'string') {
      url = args[0];
    } else if (args[0] && typeof args[0] === 'object' && args[0].url) {
      url = args[0].url;
    }

    // Capture Authorization header from ChatGPT requests
    if (SERVICE_ID === 'chatgpt' && url.indexOf('backend-api') !== -1) {
      var reqHeaders = null;
      if (args[1] && args[1].headers) {
        reqHeaders = args[1].headers;
      } else if (args[0] && typeof args[0] === 'object' && args[0].headers) {
        reqHeaders = args[0].headers;
      }
      if (reqHeaders) {
        var authVal = '';
        if (typeof reqHeaders.get === 'function') {
          authVal = reqHeaders.get('Authorization') || reqHeaders.get('authorization') || '';
        } else if (reqHeaders['Authorization']) {
          authVal = reqHeaders['Authorization'];
        } else if (reqHeaders['authorization']) {
          authVal = reqHeaders['authorization'];
        }
        if (authVal && authVal.indexOf('Bearer') !== -1) {
          _capturedAuthHeader = authVal;
        }
      }
    }

    return _originalFetch.apply(this, args).then(function(response) {
      // ChatGPT: detect completion via textdocs
      if (SERVICE_ID === 'chatgpt' && url.indexOf('/textdocs') !== -1) {
        var match = url.match(/\\/conversation\\/([a-f0-9-]+)\\/textdocs/);
        if (match) {
          var convId = match[1];
          setTimeout(function() { fetchChatGPTConversation(convId); }, 500);
        }
        return response;
      }

      // Claude: intercept SSE streams
      if (SERVICE_ID === 'claude' && url.indexOf(ENDPOINT_PATTERN) !== -1) {
        var method = 'GET';
        if (args[1] && args[1].method) method = args[1].method.toUpperCase();
        else if (args[0] && args[0].method) method = args[0].method.toUpperCase();

        if (method === 'POST') {
          var contentType = response.headers.get('content-type') || '';
          if (contentType.indexOf('text/event-stream') !== -1) {
            try {
              var clone = response.clone();
              if (clone.body) {
                var requestId = 'sse-' + Date.now() + '-' + (++_requestCounter);
                readSSEStream(clone.body, url, requestId);
              }
            } catch (e) {
              // Silent fail
            }
          }
        }
      }

      return response;
    }).catch(function(err) {
      throw err;
    });
  };

  // Expose for on-demand fetch from main process
  window.__krig_fetchConversation = function(conversationId, targetMessageId) {
    var cacheKey = conversationId + (targetMessageId ? ':' + targetMessageId : '');
    delete _chatgptConversationsFetched[cacheKey];
    fetchChatGPTConversation(conversationId, targetMessageId);
  };

  return 'hooked';
})()`;
}
