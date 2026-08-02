// ========================================
// Aria2 Bridge — Config（配置加载与 Badge 状态）
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
// ========================================

const DEFAULT_CONFIG = {
  rpcUrl: "http://localhost:6800/jsonrpc",
  rpcSecret: "",
  enabled: true,
  bypassDomains: [],
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
    ".nzb",
    ".csv",
    ".json",
    ".xml",
    ".psd",
    ".ai",
    ".skp",
    ".epub",
    ".mobi",
    ".cbr",
  ],
};

let config = {};

async function loadConfig() {
  config = await chrome.storage.sync.get(DEFAULT_CONFIG);
  updateBadge();
}

function updateBadge() {
  if (config.enabled) {
    chrome.action.setBadgeText({ text: "" });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#888" });
  }
}
