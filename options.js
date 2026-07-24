// ========================================
// Aria2 Bridge — Options page
// ========================================

const DEFAULT_CONFIG = {
  rpcUrl: 'http://localhost:6800/jsonrpc',
  enabled: true,
  defaultDir: '',
  bypassDomains: []
};

const $ = (id) => document.getElementById(id);

// --- Load ---
async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_CONFIG);
  $('rpcUrl').value = data.rpcUrl;
  $('defaultDir').value = data.defaultDir;
  $('bypassDomains').value = (data.bypassDomains || []).join('\n');
  $('enabled').checked = data.enabled;
}

// --- Save ---
async function saveSettings() {
  const updates = {
    rpcUrl: $('rpcUrl').value.trim() || DEFAULT_CONFIG.rpcUrl,
    defaultDir: $('defaultDir').value.trim(),
    bypassDomains: $('bypassDomains').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    enabled: $('enabled').checked
  };

  return chrome.storage.sync.set(updates);
}

// --- Status feedback ---
function showStatus(message, type = 'success') {
  const el = $('status');
  el.textContent = message;
  el.className = type;
  setTimeout(() => { el.className = ''; }, 2500);
}

// --- Test RPC connection ---
async function testConnection() {
  const rpcUrl = $('rpcUrl').value.trim() || DEFAULT_CONFIG.rpcUrl;
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'aria2.getVersion',
        params: []
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return `连接成功 — aria2 ${data.result.version}`;
  } catch (err) {
    throw new Error(`连接失败: ${err.message}`);
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

// Test connection on double-click (hidden feature)
$('rpcUrl').addEventListener('dblclick', async () => {
  try {
    const msg = await testConnection();
    showStatus('✅ ' + msg, 'success');
  } catch (err) {
    showStatus('❌ ' + err.message, 'error');
  }
});

// --- Init ---
document.addEventListener('DOMContentLoaded', loadSettings);
