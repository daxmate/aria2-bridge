// ========================================
// Aria2 Bridge — Service Worker
// ========================================

const DEFAULT_CONFIG = {
  rpcUrl: 'http://localhost:6800/jsonrpc',
  enabled: true,
  defaultDir: '',
  bypassDomains: []
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

async function aria2Rpc(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    method,
    params
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

async function aria2AddUri(url, options = {}) {
  const params = [[url]];

  const rpcOpts = {};
  if (options.dir) rpcOpts.dir = options.dir;
  if (options.out) rpcOpts.out = options.out;
  if (options.referer) rpcOpts.referer = options.referer;
  if (options.headers && options.headers.length > 0) {
    rpcOpts.header = options.headers;
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
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        // aria2 down — fall back to browser-native download
        console.warn('[Aria2 Bridge] aria2 unreachable, falling back:', err.message);
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

  const options = {};
  if (referer) options.referer = referer;
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

const MENU_ID = 'aria2-bridge-send';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '用 Aria2 下载',
    contexts: ['link', 'image', 'video', 'audio']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
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
    setTimeout(() => chrome.notifications.clear(gid), 3000);
  } catch (err) {
    showNotification('Aria2 Bridge — 发送失败', err.message);
  }
});

// ========================================
// Toolbar action toggle
// ========================================

chrome.action.onClicked.addListener(async () => {
  config.enabled = !config.enabled;
  await saveConfig({ enabled: config.enabled });
});

function updateBadge() {
  if (config.enabled) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888' });
  }
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
