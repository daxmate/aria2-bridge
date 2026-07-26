// ========================================
// Aria2 Bridge — Options page
// ========================================

const DEFAULT_CONFIG = {
  enabled: true,
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
  $('bypassDomains').value = (data.bypassDomains || []).join('\n');
  $('enabled').checked = data.enabled;
  $('localeSelect').value = data.locale || 'auto';
}

// --- Save ---
async function saveSettings() {
  var updates = {
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

// --- Init ---
document.addEventListener('DOMContentLoaded', async function () {
  await Aria2I18n.init();
  applyI18n();
  await loadSettings();

  // 语言变更 → 即时保存 + 热生效
  $('localeSelect').addEventListener('change', async function () {
    var updates = await saveSettings();
    await Aria2I18n.reload();
    applyI18n();
    try {
      await chrome.runtime.sendMessage({ action: 'updateLocale' });
    } catch (e) { /* background not ready, ignore */ }
  });

  // 自动保存其余字段
  $('bypassDomains').addEventListener('change', saveSettings);
  $('enabled').addEventListener('change', saveSettings);
});
