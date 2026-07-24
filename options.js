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
    return `✅ 连接成功 — aria2 ${data.result.version}`;
  } catch (err) {
    throw new Error(`❌ 连接失败: ${err.message}`);
  }
}

// --- Event handlers ---
$('saveBtn').addEventListener('click', async () => {
  try {
    await saveSettings();
    showStatus('✅ 设置已保存', 'success');
  } catch (err) {
    showStatus('❌ 保存失败: ' + err.message, 'error');
  }
});

$('testBtn').addEventListener('click', async () => {
  const btn = $('testBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 测试中...';
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
  showStatus('↻ 已恢复默认设置', 'info');
});

// Also keep the old dblclick test on RPC URL for power users
$('openAriaNgBtn').addEventListener('click', () => {
  const url = chrome.runtime.getURL('aria-ng/index.html');
  chrome.tabs.create({ url });
});

$('rpcUrl').addEventListener('dblclick', async () => {
  $('testBtn').click();
});

// --- Init ---
document.addEventListener('DOMContentLoaded', loadSettings);
