// ========================================
// Aria2 Bridge — Options page
// ========================================

const DEFAULT_EXTS = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.webm',
  '.iso', '.dmg', '.exe', '.msi', '.apk', '.deb', '.rpm',
  '.torrent', '.nzb',
  '.csv', '.json', '.xml',
  '.psd', '.ai', '.skp',
  '.epub', '.mobi', '.cbr'
];

const DEFAULT_CONFIG = {
  rpcUrl: 'http://localhost:6800/jsonrpc',
  rpcSecret: '',
  enabled: true,
  defaultDir: '',
  bypassDomains: [],
  downloadExts: DEFAULT_EXTS
};

const $ = (id) => document.getElementById(id);

// --- i18n ---

function applyI18n() {
  // Replace textContent of elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });

  // Replace placeholder of inputs with data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.placeholder = msg;
  });

  // Set document title
  const titleKey = document.querySelector('title')?.getAttribute('data-i18n');
  if (titleKey) {
    const titleMsg = chrome.i18n.getMessage(titleKey);
    if (titleMsg) document.title = titleMsg;
  }
}

// --- Load ---
async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_CONFIG);
  $('rpcUrl').value = data.rpcUrl;
  $('rpcSecret').value = data.rpcSecret || '';
  $('defaultDir').value = data.defaultDir;
  $('bypassDomains').value = (data.bypassDomains || []).join('\n');
  $('downloadExts').value = (data.downloadExts || DEFAULT_EXTS).join('\n');
  $('enabled').checked = data.enabled;
}

// --- Save ---
async function saveSettings() {
  const updates = {
    rpcUrl: $('rpcUrl').value.trim() || DEFAULT_CONFIG.rpcUrl,
    rpcSecret: $('rpcSecret').value.trim(),
    defaultDir: $('defaultDir').value.trim(),
    bypassDomains: $('bypassDomains').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    downloadExts: $('downloadExts').value
      .split('\n')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.startsWith('.'))
      .filter(Boolean),
    enabled: $('enabled').checked
  };

  // If downloadExts is empty after cleaning, keep default
  if (updates.downloadExts.length === 0) {
    updates.downloadExts = DEFAULT_EXTS;
  }

  await chrome.storage.sync.set(updates);
}

// --- Status feedback ---
function showStatus(message, type = 'success') {
  const el = $('status');
  el.textContent = message;
  el.className = type;
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.className = ''; }, 3000);
}

function showTestResult(message, type = 'success') {
  const el = $('testResult');
  el.textContent = message;
  el.style.display = 'inline-block';
  el.style.color = type === 'success' ? '#155724' : type === 'warn' ? '#856404' : '#721c24';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// --- Test RPC connection ---
async function testConnection() {
  const rpcUrl = $('rpcUrl').value.trim() || DEFAULT_CONFIG.rpcUrl;
  const rpcSecret = $('rpcSecret').value.trim();

  const params = rpcSecret
    ? ['token:' + rpcSecret]
    : [];

  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'aria2.getVersion',
        params
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return chrome.i18n.getMessage('optionsTestSuccess', [data.result.version]);
  } catch (err) {
    throw new Error(chrome.i18n.getMessage('optionsTestFail', [err.message]));
  }
}

// --- Event handlers ---
$('saveBtn').addEventListener('click', async () => {
  try {
    await saveSettings();
    showStatus(chrome.i18n.getMessage('optionsSaveSuccess'), 'success');
  } catch (err) {
    showStatus(chrome.i18n.getMessage('optionsSaveFail', [err.message]), 'error');
  }
});

$('testBtn').addEventListener('click', async () => {
  const btn = $('testBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = chrome.i18n.getMessage('optionsTestConnecting');
  showTestResult('');

  try {
    const msg = await testConnection();
    showTestResult(msg, 'success');
  } catch (err) {
    showTestResult(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

$('resetBtn').addEventListener('click', async () => {
  await chrome.storage.sync.clear();
  await loadSettings();
  showStatus(chrome.i18n.getMessage('optionsResetDone'), 'info');
});

// Also keep the old dblclick test on RPC URL for power users
$('openAriaNgBtn').addEventListener('click', async () => {
  const data = await chrome.storage.sync.get(DEFAULT_CONFIG);

  // Parse RPC URL into components for AriaNg command hash
  let protocol = 'http';
  let host = 'localhost';
  let port = '6800';
  let iface = 'jsonrpc';
  let secret = '';

  try {
    const url = new URL(data.rpcUrl || DEFAULT_CONFIG.rpcUrl);
    protocol = url.protocol.replace(':', '') || 'http';
    host = url.hostname || 'localhost';
    port = url.port || '6800';
    // Extract interface from path
    const match = url.pathname.match(/\/([^/]+)$/);
    if (match) iface = match[1];
  } catch {}

  if (data.rpcSecret) {
    // URL-safe base64 (matches AriaNg's base64.urlencode)
    secret = btoa(data.rpcSecret)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  const hash = '#/settings/rpc/set' +
    '?protocol=' + encodeURIComponent(protocol) +
    '&host=' + encodeURIComponent(host) +
    '&port=' + encodeURIComponent(port) +
    '&interface=' + encodeURIComponent(iface) +
    '&secret=' + encodeURIComponent(secret);

  const base = chrome.runtime.getURL('aria-ng/index.html');
  chrome.tabs.create({ url: base + hash });
});

$('rpcUrl').addEventListener('dblclick', async () => {
  $('testBtn').click();
});

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  loadSettings();
});