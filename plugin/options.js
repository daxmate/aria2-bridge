// ========================================
// Aria2 Bridge — Options page
// ========================================

const DEFAULT_CONFIG = {
  rpcUrl: "http://localhost:6800/jsonrpc",
  rpcSecret: "",
  enabled: true,
  interceptMagnet: true,
  notifyDownloadComplete: true,
  bypassDomains: [],
  locale: "auto",
  downloadExts: [
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".bz2",
    ".xz",
    ".zst",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".mp3",
    ".mp4",
    ".avi",
    ".mkv",
    ".mov",
    ".flv",
    ".wmv",
    ".webm",
    ".iso",
    ".dmg",
    ".exe",
    ".msi",
    ".apk",
    ".deb",
    ".rpm",
    ".torrent",
    ".psd",
    ".ai",
    ".skp",
    ".epub",
    ".mobi",
    ".cbr",
  ],
};

const $ = (id) => document.getElementById(id);
const t = function (key, subs) {
  return Aria2I18n ? Aria2I18n.t(key, subs) : chrome.i18n.getMessage(key, subs) || key;
};

// --- i18n ---

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    const key = el.getAttribute("data-i18n");
    const msg = t(key);
    if (msg) el.textContent = msg;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    const key = el.getAttribute("data-i18n-placeholder");
    const msg = t(key);
    if (msg) el.placeholder = msg;
  });

  const titleEl = document.querySelector("title");
  const titleKey = titleEl && titleEl.getAttribute("data-i18n");
  if (titleKey) {
    const titleMsg = t(titleKey);
    if (titleMsg) document.title = titleMsg;
  }
}

// --- Load ---
async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_CONFIG);
  $("rpcUrl").value = data.rpcUrl || "";
  $("rpcSecret").value = data.rpcSecret || "";
  $("bypassDomains").value = (data.bypassDomains || []).join("\n");
  $("downloadExts").value = (data.downloadExts || []).join("\n");
  $("enabled").checked = data.enabled;
  $("interceptMagnet").checked = data.interceptMagnet;
  $("notifyDownloadComplete").checked = data.notifyDownloadComplete;
  $("localeSelect").value = data.locale || "auto";
}

// --- Save ---
async function saveSettings() {
  const updates = {
    rpcUrl: $("rpcUrl").value.trim() || "http://localhost:6800/jsonrpc",
    rpcSecret: $("rpcSecret").value,
    bypassDomains: $("bypassDomains")
      .value.split("\n")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean),
    downloadExts: $("downloadExts")
      .value.split("\n")
      .map(function (s) {
        return s.trim().toLowerCase();
      })
      .filter(Boolean)
      .map(function (s) {
        return s.startsWith(".") ? s : "." + s;
      }),
    enabled: $("enabled").checked,
    interceptMagnet: $("interceptMagnet").checked,
    notifyDownloadComplete: $("notifyDownloadComplete").checked,
    locale: $("localeSelect").value,
  };

  await chrome.storage.sync.set(updates);
  return updates;
}

// --- Init ---
document.addEventListener("DOMContentLoaded", async function () {
  await Aria2I18n.init();
  applyI18n();
  await loadSettings();

  // 语言变更 → 即时保存 + 热生效
  $("localeSelect").addEventListener("change", async function () {
    await saveSettings();
    await Aria2I18n.reload();
    applyI18n();
    try {
      await chrome.runtime.sendMessage({ action: "updateLocale" });
    } catch (e) {
      /* background not ready, ignore */
    }
  });

  // 自动保存其余字段
  $("rpcUrl").addEventListener("change", saveSettings);
  $("rpcSecret").addEventListener("change", saveSettings);
  $("bypassDomains").addEventListener("change", saveSettings);
  $("downloadExts").addEventListener("change", saveSettings);
  $("enabled").addEventListener("change", saveSettings);
  $("interceptMagnet").addEventListener("change", saveSettings);
  $("notifyDownloadComplete").addEventListener("change", saveSettings);
});
