// ========================================
// Aria2 Bridge — 下载完成/失败系统通知
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
//
// 跟踪本扩展转发到 aria2 的任务（GID 列表，storage.session 持久化，
// SW 重启不丢），由 alarms 定时唤醒轮询 aria2.tellStatus：
//   complete → 系统通知「下载完成 + 文件名」
//   error    → 系统通知「下载失败 + 错误信息」
//   removed  → 用户在 AriaNg 删除的任务，静默移除跟踪
// 点击完成/失败通知 → 打开 AriaNg 管理面板（openAriaNg）
// ========================================

// 跟踪超时：24h 未完成的任务自动清理，防止列表无限膨胀
const NOTIFY_TRACK_TTL_MS = 24 * 60 * 60 * 1000;
// 通知 id 前缀：onClicked 据此识别「完成/失败」通知
const NOTIF_ID_PREFIX = "aria2-bridge-notify-";

const trackedDownloads = new Map(); // gid -> { name, url, addedAt }

async function loadTrackedDownloads() {
  try {
    const { trackedDownloads: saved } = await chrome.storage.session.get("trackedDownloads");
    if (saved && typeof saved === "object") {
      const now = Date.now();
      for (const [gid, info] of Object.entries(saved)) {
        if (now - (info.addedAt || 0) <= NOTIFY_TRACK_TTL_MS) {
          trackedDownloads.set(gid, info);
        }
      }
    }
  } catch (e) {
    console.warn("[Aria2 Bridge] loadTrackedDownloads error:", e.message);
  }
}

async function persistTrackedDownloads() {
  try {
    await chrome.storage.session.set({
      trackedDownloads: Object.fromEntries(trackedDownloads),
    });
  } catch (e) {
    console.warn("[Aria2 Bridge] persistTrackedDownloads error:", e.message);
  }
}

function trackDownload(gid, name, url) {
  if (!gid) return;
  trackedDownloads.set(gid, { name: name || "", url: url || "", addedAt: Date.now() });
  persistTrackedDownloads();
}

function untrackDownload(gid) {
  if (trackedDownloads.delete(gid)) persistTrackedDownloads();
}

// 完成/失败通知使用固定 id（NOTIF_ID_PREFIX + 状态 + gid），
// 点击事件据此识别并打开 AriaNg
function notifyDownloadComplete(gid, name) {
  const displayName = name || gid;
  chrome.notifications.create(NOTIF_ID_PREFIX + "complete-" + gid, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: Aria2I18n.t("notifCompleteTitle"),
    message: Aria2I18n.t("notifCompleteBody", [displayName]),
  });
}

function notifyDownloadError(gid, name, errorMessage) {
  const displayName = name || gid;
  chrome.notifications.create(NOTIF_ID_PREFIX + "error-" + gid, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: Aria2I18n.t("notifErrorTitle"),
    message: Aria2I18n.t("notifErrorBody", [displayName, errorMessage || ""]),
  });
}

/**
 * 轮询跟踪列表的任务状态（由 alarms 定时调用）。
 * 开关关闭 / 无跟踪任务时直接返回，不产生 RPC 请求。
 */
async function checkDownloadStatus() {
  if (!config.notifyDownloadComplete) return;
  if (trackedDownloads.size === 0) return;

  const now = Date.now();
  for (const [gid, info] of [...trackedDownloads]) {
    // 超时未完成：静默清理
    if (now - info.addedAt > NOTIFY_TRACK_TTL_MS) {
      untrackDownload(gid);
      continue;
    }

    let task;
    try {
      task = await aria2Rpc("aria2.tellStatus", [gid]);
    } catch (e) {
      // RPC 暂时失败（aria2 重启、通知开关变化等）：保留跟踪，下轮再查
      console.warn(`[Aria2 Bridge] tellStatus ${gid} error:`, e.message);
      continue;
    }

    const status = task && task.status;
    if (status === "complete") {
      notifyDownloadComplete(gid, info.name);
      untrackDownload(gid);
    } else if (status === "error") {
      notifyDownloadError(gid, info.name, task.errorMessage);
      untrackDownload(gid);
    } else if (status === "removed") {
      // 用户在 AriaNg 里删了任务：静默移除跟踪
      untrackDownload(gid);
    }
    // active / waiting / paused：继续等待下一轮
  }
}

// 点击完成/失败通知 → 打开 AriaNg 管理面板
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId && notificationId.startsWith(NOTIF_ID_PREFIX)) {
    openAriaNg();
  }
});
