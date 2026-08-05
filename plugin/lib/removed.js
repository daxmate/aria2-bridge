// ========================================
// Aria2 Bridge — 去重与已删除任务记忆
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
// ========================================

// ========================================
// Dedupe: avoid re-forwarding the same URL
// within a short window (page retries, user
// re-clicks, download manager retry, etc.)
// ========================================

const DEDUPE_WINDOW_MS = 30 * 1000;
const recentForwards = new Map(); // url -> timestamp

function isRecentlyForwarded(url) {
  const ts = recentForwards.get(url);
  if (!ts) return false;
  if (Date.now() - ts > DEDUPE_WINDOW_MS) {
    recentForwards.delete(url);
    return false;
  }
  return true;
}

function markForwarded(url) {
  recentForwards.set(url, Date.now());
  // 防止 Map 无限增长：定期清理过期条目
  if (recentForwards.size > 1000) {
    const now = Date.now();
    for (const [u, t] of recentForwards) {
      if (now - t > DEDUPE_WINDOW_MS) recentForwards.delete(u);
    }
  }
}

// ========================================
// Removed-task memory: never auto re-add a
// download the user has deleted. Only an
// explicit user action (content-script click)
// clears the memory and allows re-adding.
//
// ⚠️ 存储在 storage.local：跨浏览器重启保留。
// 之前用 storage.session，浏览器一重启黑名单就清空，
// 导致已删除任务在下次浏览器恢复会话时被重新添加。
// ========================================

const REMOVED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const removedUrls = new Map(); // url -> timestamp

async function loadRemovedUrls() {
  try {
    const { removedUrls: saved } = await chrome.storage.local.get("removedUrls");
    if (saved && typeof saved === "object") {
      const now = Date.now();
      for (const [u, t] of Object.entries(saved)) {
        if (now - t <= REMOVED_TTL_MS) removedUrls.set(u, t);
      }
    }
  } catch (e) {
    console.warn("[Aria2 Bridge] loadRemovedUrls error:", e.message);
  }
}

async function persistRemovedUrls() {
  try {
    await chrome.storage.local.set({
      removedUrls: Object.fromEntries(removedUrls),
    });
  } catch (e) {
    console.warn("[Aria2 Bridge] persistRemovedUrls error:", e.message);
  }
}

function isRemovedUrl(url) {
  const ts = removedUrls.get(url);
  if (!ts) return false;
  if (Date.now() - ts > REMOVED_TTL_MS) {
    removedUrls.delete(url);
    persistRemovedUrls();
    return false;
  }
  return true;
}

function markRemoved(url) {
  removedUrls.set(url, Date.now());
  persistRemovedUrls();
}

function forgetRemoved(url) {
  if (removedUrls.delete(url)) persistRemovedUrls();
}

/**
 * Real-time fallback: even if the local memory hasn't been
 * synced yet (polling window / browser restart cleared
 * storage.session), query aria2 directly to check whether
 * this URL currently sits in the stopped list with
 * status=removed (i.e. the user deleted it).
 */
async function isRemovedInAria2(url) {
  try {
    const stopped = await aria2Rpc("aria2.tellStopped", [0, 100]);
    for (const t of stopped) {
      if (t.status !== "removed") continue;
      for (const f of t.files || []) {
        for (const u of f.uris || []) {
          if (u.uri === url) {
            // 命中 → 记入本地记忆，避免下次重复查询
            markRemoved(url);
            return true;
          }
        }
      }
    }
    return false;
  } catch (e) {
    console.warn("[Aria2 Bridge] isRemovedInAria2 error:", e.message);
    return false;
  }
}

/**
 * Poll aria2 for tasks the user removed via AriaNg
 * (status=removed) and remember their URLs so the
 * onCreated fallback never re-adds them automatically.
 */
async function syncRemovedTasks() {
  try {
    const stopped = await aria2Rpc("aria2.tellStopped", [0, 200]);
    let changed = false;
    const now = Date.now();
    for (const t of stopped) {
      if (t.status !== "removed") continue;
      const urls = [];
      for (const f of t.files || []) {
        for (const u of f.uris || []) {
          if (u.uri.startsWith("http://") || u.uri.startsWith("https://")) {
            urls.push(u.uri);
          }
        }
      }
      if (urls.length === 0) continue;
      for (const url of urls) {
        if (!removedUrls.has(url)) {
          removedUrls.set(url, now);
          changed = true;
        }
      }
    }
    if (changed) persistRemovedUrls();
  } catch (e) {
    console.warn("[Aria2 Bridge] syncRemovedTasks error:", e.message);
  }
}
