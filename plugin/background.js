// ========================================
// Aria2 Bridge — Service Worker（入口）
// 模块划分见 lib/：
//   config.js       — 配置加载与 Badge 状态
//   rpc.js          — aria2 JSON-RPC 通信与文件名提取
//   removed.js      — 去重与已删除任务记忆
//   hf.js           — Hugging Face 一键下载
//   intercept.js    — 下载拦截（onCreated 兜底）
//   context-menu.js — 右键菜单与 AriaNg 入口
// ========================================

importScripts(
  "js/i18n.js",
  "lib/config.js",
  "lib/rpc.js",
  "lib/removed.js",
  "lib/hf.js",
  "lib/intercept.js",
  "lib/context-menu.js"
);

const _i18nReady = Aria2I18n.init();

// ========================================
// Message from content script
// ========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "download") {
    processDownload(message.url, message.referer)
      .then(() => {
        flashBadge("✓", "#4caf50");
        sendResponse({ success: true });
      })
      .catch((err) => {
        // aria2 down — fall back to browser-native download
        console.warn("[Aria2 Bridge] aria2 unreachable, falling back:", err.message);
        flashBadge("!", "#ff9800");
        isSelfRedirect = true;
        chrome.downloads.download({ url: message.url }).finally(() => {
          isSelfRedirect = false;
        });
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Update locale (from options page)
  if (message.action === "updateLocale") {
    updateContextMenus().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ========================================
// Toolbar action — 打开 AriaNg 管理界面（复用已有标签页）
// ========================================

chrome.action.onClicked.addListener(async () => {
  const baseUrl = chrome.runtime.getURL("aria-ng/index.html");

  // 查找已有的 AriaNg 标签页（tabs 权限支持按 URL 匹配）
  const tabs = await chrome.tabs.query({ url: baseUrl + "*" });

  if (tabs.length > 0) {
    // 已有 → 切换到第一个
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    // 找不到才新建
    const url = buildAriaNgUrl();
    chrome.tabs.create({ url });
  }
});

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
loadRemovedUrls().then(() => {
  // 启动时同步一次：把用户已删除的任务 URL 记入黑名单
  syncRemovedTasks();
});

// 定期同步：捕获用户在 AriaNg 里删除的任务（status=removed）
chrome.alarms.create("aria2-sync-removed", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "aria2-sync-removed") syncRemovedTasks();
});
