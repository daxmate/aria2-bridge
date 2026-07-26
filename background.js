// ========================================
// Aria2 Bridge — Service Worker
// ========================================

const DEFAULT_CONFIG = {
  rpcUrl: 'http://localhost:6800/jsonrpc',
  rpcSecret: '',
  enabled: true,
  defaultDir: '',
  bypassDomains: [],
  downloadExts: [
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.webm',
    '.iso', '.dmg', '.exe', '.msi', '.apk', '.deb', '.rpm',
    '.torrent', '.nzb',
    '.csv', '.json', '.xml',
    '.psd', '.ai', '.skp',
    '.epub', '.mobi', '.cbr'
  ]
};

let config = {};

// ========================================
// Config
// ========================================

async function loadConfig() {
  config = await chrome.storage.sync.get(DEFAULT_CONFIG);
  updateBadge();
}

async function saveConfig(updates) {
  await chrome.storage.sync.set(updates);
  Object.assign(config, updates);
  updateBadge();
}

// ========================================
// Aria2 RPC
// ========================================

/**
 * Call aria2 JSON-RPC method.
 * If rpcSecret is configured, prepends 'token:<secret>' as first param.
 */
async function aria2Rpc(method, params) {
  const effectiveParams = config.rpcSecret
    ? ['token:' + config.rpcSecret, ...params]
    : params;

  const body = {
    jsonrpc: '2.0',
    id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    method,
    params: effectiveParams
  };

  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`aria2 error: ${result.error.message}`);
  }
  return result.result;
}

// ========================================
// Cookie helper
// ========================================

/**
 * Get Cookie header string for a URL via chrome.cookies API.
 * Returns empty string if no cookies or on error.
 */
async function getCookieString(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies || cookies.length === 0) return '';
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

// ========================================
// Build aria2 headers
// ========================================

/**
 * Build an array of HTTP header strings for aria2.addUri.
 * Includes User-Agent, Referer (if given), and Cookie (if available).
 */
async function buildHeaders(url, referer) {
  const headers = [];

  // Always pass browser User-Agent so servers see a realistic UA
  headers.push(`User-Agent: ${navigator.userAgent}`);

  if (referer) {
    headers.push(`Referer: ${referer}`);
  }

  // Cookies help with authenticated downloads (e.g. forum attachments)
  const cookie = await getCookieString(url);
  if (cookie) {
    headers.push(`Cookie: ${cookie}`);
  }

  return headers;
}

// ========================================
// Aria2 addUri with options
// ========================================

/**
 * Send a download URL to aria2 with optional per-download options.
 *
 * @param {string} url       - Download URL
 * @param {object} [options] - { dir, out, referer, headers }
 * @returns {Promise<string>} aria2 GID
 */
async function aria2AddUri(url, options = {}) {
  const params = [[url]];

  const rpcOpts = {};
  if (options.dir) rpcOpts.dir = options.dir;
  if (options.out) rpcOpts.out = options.out;

  // Merge explicitly provided headers with auto-built ones
  const effectiveHeaders = await buildHeaders(url, options.referer);
  if (options.headers && options.headers.length > 0) {
    effectiveHeaders.push(...options.headers);
  }
  if (effectiveHeaders.length > 0) {
    rpcOpts.header = effectiveHeaders;
  }

  if (Object.keys(rpcOpts).length > 0) {
    params.push(rpcOpts);
  }

  return aria2Rpc('aria2.addUri', params);
}

// ========================================
// Helpers
// ========================================

function shouldBypass(url) {
  try {
    const u = new URL(url);
    return config.bypassDomains.some(domain =>
      u.hostname === domain || u.hostname.endsWith('.' + domain)
    );
  } catch {
    return true;
  }
}

function extractFilename(url, fallback) {
  if (fallback) {
    const parts = fallback.replace(/\\/g, '/').split('/');
    const name = parts.pop();
    if (name) return name;
  }
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').pop();
    if (name && name.includes('.')) return name;
  } catch {}
  return null;
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message
  });
}

// ========================================
// Guard: prevent infinite loop when falling
// back to browser-native download.
// ========================================

let isSelfRedirect = false;

// ========================================
// Message from content script
// ========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    processDownload(message.url, message.referer)
      .then(() => {
        flashBadge('✓', '#4caf50');
        sendResponse({ success: true });
      })
      .catch((err) => {
        // aria2 down — fall back to browser-native download
        console.warn('[Aria2 Bridge] aria2 unreachable, falling back:', err.message);
        flashBadge('!', '#ff9800');
        isSelfRedirect = true;
        chrome.downloads.download({ url: message.url }).finally(() => {
          isSelfRedirect = false;
        });
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

async function processDownload(url, referer) {
  if (!config.enabled) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  const options = { referer };
  if (config.defaultDir) options.dir = config.defaultDir;

  const filename = extractFilename(url);
  if (filename) options.out = filename;

  await aria2AddUri(url, options);
}

// ========================================
// Download interception (fallback for
// JS-triggered downloads not caught by
// content script)
// ========================================

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  // Guard: skip our own fallback downloads
  if (isSelfRedirect) return;

  if (!config.enabled) return;
  const url = downloadItem.url;
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  if (shouldBypass(url)) return;
  if (downloadItem.fileSize > 0 && downloadItem.fileSize < 100) return;
  if (downloadItem.byExtensionId) return;

  // Cancel browser download
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.cancel(downloadItem.id, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  } catch {
    return; // too far along
  }

  try {
    const options = {};
    const filename = extractFilename(url, downloadItem.filename);
    if (filename) options.out = filename;
    if (downloadItem.referrer) options.referer = downloadItem.referrer;
    if (config.defaultDir) options.dir = config.defaultDir;

    await aria2AddUri(url, options);
    flashBadge('✓', '#4caf50');
    console.log(`[Aria2 Bridge] Download → aria2: ${url}`);
  } catch (err) {
    // aria2 down — restart browser download
    console.warn('[Aria2 Bridge] aria2 unreachable, restarting browser download:', err.message);
    isSelfRedirect = true;
    try {
      await chrome.downloads.download({
        url,
        filename: downloadItem.filename || undefined
      });
    } finally {
      isSelfRedirect = false;
    }
  }
});

// ========================================
// Context menu
// ========================================

const MENU_ID_SEND = 'aria2-bridge-send';
const MENU_ID_OPEN = 'aria2-bridge-open-ariang';
const MENU_ID_HF_DOWNLOAD = 'aria2-bridge-hf-download';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID_SEND,
    title: '用 Aria2 下载',
    contexts: ['link', 'image', 'video', 'audio']
  });
  chrome.contextMenus.create({
    id: MENU_ID_OPEN,
    title: '📊 打开 AriaNg 管理面板',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: MENU_ID_HF_DOWNLOAD,
    title: '📥 下载该模型所有文件到 Aria2',
    contexts: ['page'],
    documentUrlPatterns: ['https://huggingface.co/*']
  });
});

/**
 * Build AriaNg URL with RPC settings passed via hash params.
 */
function buildAriaNgUrl() {
  let protocol = 'http';
  let host = 'localhost';
  let port = '6800';
  let iface = 'jsonrpc';
  let secret = '';

  try {
    const url = new URL(config.rpcUrl || 'http://localhost:6800/jsonrpc');
    protocol = url.protocol.replace(':', '') || 'http';
    host = url.hostname || 'localhost';
    port = url.port || '6800';
    const match = url.pathname.match(/\/([^/]+)$/);
    if (match) iface = match[1];
  } catch {}

  if (config.rpcSecret) {
    secret = btoa(config.rpcSecret)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // 用 AriaNg 的路径式路由，比 query 参数更稳定
  // 能避免 chrome-extension:// 协议下 $location.search() 的解析问题
  const hashPath = '#!/settings/rpc/set/' +
    encodeURIComponent(protocol) + '/' +
    encodeURIComponent(host) + '/' +
    encodeURIComponent(port) + '/' +
    encodeURIComponent(iface) +
    (secret ? '/' + encodeURIComponent(secret) : '');

  return chrome.runtime.getURL('aria-ng/index.html') + hashPath;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Menu: Open AriaNg
  if (info.menuItemId === MENU_ID_OPEN) {
    const url = buildAriaNgUrl();
    chrome.tabs.create({ url });
    return;
  }

  // Menu: Hugging Face — download all model files
  if (info.menuItemId === MENU_ID_HF_DOWNLOAD) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getHfFileList' });
      if (!response || !response.files || response.files.length === 0) {
        showNotification('Aria2 Bridge', '未找到可下载的模型文件');
        return;
      }

      const modelName = response.modelId.split('/').pop() || response.modelId;
      const baseDir = config.defaultDir || undefined;
      let count = 0;

      for (const file of response.files) {
        try {
          // 以模型名作为子目录，保持原始路径结构
          const outPath = modelName + '/' + file.path;
          await aria2AddUri(file.url, { dir: baseDir, out: outPath });
          count++;
        } catch (err) {
          console.warn('[Aria2 Bridge] HF file failed:', file.path, err.message);
        }
      }

      showNotification('Aria2 Bridge — HF 下载', `已发送 ${count}/${response.files.length} 个文件到 aria2`);
      flashBadge('✓', '#4caf50');
    } catch (err) {
      console.warn('[Aria2 Bridge] HF context menu error:', err.message);
      showNotification('Aria2 Bridge', '获取 HF 文件列表失败，请刷新页面后重试');
    }
    return;
  }


  // Menu: Send to aria2
  const url = info.linkUrl || info.srcUrl;
  if (!url) return;

  const options = {};
  if (tab?.url) options.referer = tab.url;
  else if (info.pageUrl) options.referer = info.pageUrl;

  const filename = extractFilename(url);
  if (filename) options.out = filename;
  if (config.defaultDir) options.dir = config.defaultDir;

  try {
    const gid = await aria2AddUri(url, options);
    const label = url.split('/').pop() || url;
    showNotification('Aria2 Bridge — 已发送', label);
    flashBadge('✓', '#4caf50');
    setTimeout(() => chrome.notifications.clear(gid), 3000);
  } catch (err) {
    showNotification('Aria2 Bridge — 发送失败', err.message);
    flashBadge('✗', '#f44336');
  }
});

// ========================================
// Toolbar action — 打开 AriaNg 管理界面
// ========================================

chrome.action.onClicked.addListener(async () => {
  const url = buildAriaNgUrl();
  chrome.tabs.create({ url });
});

function updateBadge() {
  if (config.enabled) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888' });
  }
}

/**
 * Briefly flash a status badge icon then restore normal state.
 * Used for download feedback when the user isn't looking at the page.
 */
let badgeFlashTimer = null;

function flashBadge(text, color) {
  if (badgeFlashTimer) clearTimeout(badgeFlashTimer);

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });

  badgeFlashTimer = setTimeout(() => {
    updateBadge();
    badgeFlashTimer = null;
  }, 1500);
}

// ========================================
// Config sync
// ========================================

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    config[key] = newValue;
  }
  updateBadge();
});

// ========================================
// Init
// ========================================

loadConfig();
