// ========================================
// Aria2 Bridge — Options page
// ========================================

const DEFAULT_CONFIG = {
  rpcUrl: 'http://localhost:6800/jsonrpc',
  rpcSecret: '',
  enabled: true,
  defaultDir: '',
  bypassDomains: [],
  locale: 'auto'
};

const $ = (id) => document.getElementById(id);
const t = function (key, subs) {
  return Aria2I18n ? Aria2I18n.t(key, subs) : chrome.i18n.getMessage(key, subs) || key;
};

// --- i18n ---

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    var msg = t(key);
    if (msg) el.textContent = msg;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-placeholder');
    var msg = t(key);
    if (msg) el.placeholder = msg;
  });

  var titleEl = document.querySelector('title');
  var titleKey = titleEl && titleEl.getAttribute('data-i18n');
  if (titleKey) {
    var titleMsg = t(titleKey);
    if (titleMsg) document.title = titleMsg;
  }
}

// --- Load ---
async function loadSettings() {
  var data = await chrome.storage.sync.get(DEFAULT_CONFIG);
  $('rpcUrl').value = data.rpcUrl;
  $('rpcSecret').value = data.rpcSecret || '';
  $('defaultDir').value = data.defaultDir;
  $('bypassDomains').value = (data.bypassDomains || []).join('\n');
  $('enabled').checked = data.enabled;
  $('localeSelect').value = data.locale || 'auto';
}

// --- Save ---
async function saveSettings() {
  var updates = {
    rpcUrl: $('rpcUrl').value.trim() || DEFAULT_CONFIG.rpcUrl,
    rpcSecret: $('rpcSecret').value.trim(),
    defaultDir: $('defaultDir').value.trim(),
    bypassDomains: $('bypassDomains').value
      .split('\n')
      .map(function (s) { return s.trim(); })
      .filter(Boolean),
    enabled: $('enabled').checked,
    locale: $('localeSelect').value
  };

  await chrome.storage.sync.set(updates);
  return updates;
}

// --- Status feedback ---
function showStatus(message, type) {
  if (!type) type = 'success';
  var el = $('status');
  el.textContent = message;
  el.className = type;
  clearTimeout(el._timeout);
  el._timeout = setTimeout(function () { el.className = ''; }, 3000);
}

function showTestResult(message, type) {
  if (!type) type = 'success';
  var el = $('testResult');
  el.textContent = message;
  el.style.display = 'inline-block';
  el.style.color = type === 'success' ? '#155724' : type === 'warn' ? '#856404' : '#721c24';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(function () { el.style.display = 'none'; }, 5000);
}

// --- Test RPC connection ---
async function testConnection() {
  var rpcUrl = $('rpcUrl').value.trim() || DEFAULT_CONFIG.rpcUrl;
  var rpcSecret = $('rpcSecret').value.trim();
  var params = rpcSecret ? ['token:' + rpcSecret] : [];

  try {
    var resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'aria2.getVersion',
        params: params
      })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return t('optionsTestSuccess', [data.result.version]);
  } catch (err) {
    throw new Error(t('optionsTestFail', [err.message]));
  }
}

// --- Event handlers ---

$('saveBtn').addEventListener('click', async function () {
  try {
    var updates = await saveSettings();
    showStatus(t('optionsSaveSuccess'), 'success');

    // 语言变了 → 热生效
    var prevLocale = $('localeSelect').dataset._originalLocale || 'auto';
    if (updates.locale !== prevLocale) {
      await Aria2I18n.reload();
      applyI18n();
      try {
        await chrome.runtime.sendMessage({ action: 'updateLocale' });
      } catch (e) { /* background not ready, ignore */ }
      $('localeSelect').dataset._originalLocale = updates.locale;
    }
  } catch (err) {
    showStatus(t('optionsSaveFail', [err.message]), 'error');
  }
});

$('testBtn').addEventListener('click', async function () {
  var btn = $('testBtn');
  var originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('optionsTestConnecting');
  showTestResult('');

  try {
    var msg = await testConnection();
    showTestResult(msg, 'success');
  } catch (err) {
    showTestResult(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

$('resetBtn').addEventListener('click', async function () {
  await chrome.storage.sync.clear();
  location.reload();
});

// AriaNg button
$('openAriaNgBtn').addEventListener('click', async function () {
  var data = await chrome.storage.sync.get(DEFAULT_CONFIG);

  var protocol = 'http';
  var host = 'localhost';
  var port = '6800';
  var iface = 'jsonrpc';
  var secret = '';

  try {
    var url = new URL(data.rpcUrl || DEFAULT_CONFIG.rpcUrl);
    protocol = url.protocol.replace(':', '') || 'http';
    host = url.hostname || 'localhost';
    port = url.port || '6800';
    var match = url.pathname.match(/\/([^/]+)$/);
    if (match) iface = match[1];
  } catch (e) {}

  if (data.rpcSecret) {
    secret = btoa(data.rpcSecret)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  var hash = '#/settings/rpc/set' +
    '?protocol=' + encodeURIComponent(protocol) +
    '&host=' + encodeURIComponent(host) +
    '&port=' + encodeURIComponent(port) +
    '&interface=' + encodeURIComponent(iface) +
    '&secret=*** + encodeURIComponent(secret);

  var base = chrome.runtime.getURL('aria-ng/index.html');
  chrome.tabs.create({ url: base + hash });
});

$('rpcUrl').addEventListener('dblclick', function () {
  $('testBtn').click();
});

// --- Init ---
document.addEventListener('DOMContentLoaded', async function () {
  await Aria2I18n.init();
  applyI18n();
  await loadSettings();
  $('localeSelect').dataset._originalLocale = $('localeSelect').value;
});
