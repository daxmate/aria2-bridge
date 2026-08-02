// ========================================
// Aria2 Bridge — Service Worker
// ========================================

importScripts("js/i18n.js");

const _i18nReady = Aria2I18n.init();

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

// ========================================
// Config
// ========================================

async function loadConfig() {
  config = await chrome.storage.sync.get(DEFAULT_CONFIG);
  updateBadge();
}

// ========================================
// Aria2 RPC
// ========================================

/**
 * Call aria2 JSON-RPC method.
 * If rpcSecret is configured, prepends 'token:<secret>' as first param.
 */
async function aria2Rpc(method, params) {
  const effectiveParams = config.rpcSecret ? ["token:" + config.rpcSecret, ...params] : params;

  const body = {
    jsonrpc: "2.0",
    id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    method,
    params: effectiveParams,
  };

  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`aria2 error: ${result.error.message}`);
  }
  return result.result;
}

// ========================================
// Cookie helper
// ========================================

/**
 * Get Cookie header string for a URL via chrome.cookies API.
 * Returns empty string if no cookies or on error.
 */
async function getCookieString(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies || cookies.length === 0) return "";
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

// ========================================
// Build aria2 headers
// ========================================

/**
 * Build an array of HTTP header strings for aria2.addUri.
 * Includes User-Agent, Referer (if given), and Cookie (if available).
 */
async function buildHeaders(url, referer) {
  const headers = [];

  // Always pass browser User-Agent so servers see a realistic UA
  headers.push(`User-Agent: ${navigator.userAgent}`);

  if (referer) {
    headers.push(`Referer: ${referer}`);
  }

  // Cookies help with authenticated downloads (e.g. forum attachments)
  const cookie = await getCookieString(url);
  if (cookie) {
    headers.push(`Cookie: ${cookie}`);
  }

  return headers;
}

// ========================================
// Aria2 addUri with options
// ========================================

/**
 * Send a download URL to aria2 with optional per-download options.
 *
 * @param {string} url       - Download URL
 * @param {object} [options] - { dir, out, referer, headers }
 * @returns {Promise<string>} aria2 GID
 */
async function aria2AddUri(url, options = {}) {
  const params = [[url]];

  const rpcOpts = {};
  if (options.dir) rpcOpts.dir = options.dir;
  if (options.out) rpcOpts.out = options.out;

  // Merge explicitly provided headers with auto-built ones
  const effectiveHeaders = await buildHeaders(url, options.referer);
  if (options.headers && options.headers.length > 0) {
    effectiveHeaders.push(...options.headers);
  }
  if (effectiveHeaders.length > 0) {
    rpcOpts.header = effectiveHeaders;
  }

  if (Object.keys(rpcOpts).length > 0) {
    params.push(rpcOpts);
  }

  return aria2Rpc("aria2.addUri", params);
}

// ========================================
// Helpers
// ========================================

function shouldBypass(url) {
  try {
    const u = new URL(url);
    return config.bypassDomains.some(
      (domain) => u.hostname === domain || u.hostname.endsWith("." + domain)
    );
  } catch {
    return true;
  }
}

/**
 * Common MIME types → file extension mapping.
 * Used to guess a reasonable extension when the server doesn't
 * provide one in the URL or Content-Disposition header.
 */
const MIME_EXT_MAP = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/zip": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/x-7z-compressed": ".7z",
  "application/gzip": ".gz",
  "application/x-tar": ".tar",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "application/json": ".json",
  "application/xml": ".xml",
  "application/octet-stream": "",
};

/**
 * Guess file extension from MIME type.
 * Returns empty string if unknown.
 */
function guessExtFromMime(mime) {
  if (!mime) return "";
  const key = mime.toLowerCase().split(";")[0].trim();
  return MIME_EXT_MAP[key] || "";
}

/**
 * Extract a filename from URL or fallback path, optionally
 * appending an extension guessed from the MIME type if missing.
 *
 * @param {string} url      - The download URL
 * @param {string} [fallback] - Full path from chrome.downloads
 * @param {string} [mime]    - MIME type from Content-Type header
 * @returns {string|null} Suggested output filename, or null
 */
function extractFilename(url, fallback, mime) {
  let name = null;

  if (fallback) {
    const parts = fallback.replace(/\\/g, "/").split("/");
    name = parts.pop();
    if (!name) name = null;
  }

  if (!name) {
    try {
      const path = new URL(url).pathname;
      name = path.split("/").pop();
      if (!name || !name.includes(".")) name = null;
    } catch {}
  }

  // If we got a name but it has no extension, try appending one from MIME
  if (name && !name.includes(".") && mime) {
    const ext = guessExtFromMime(mime);
    if (ext) name += ext;
  }

  return name;
}

/**
 * 通过 content script（同源环境）获取下载 URL 的响应头。
 * 绕过 service worker fetch 的 CORS 限制，自动携带页面 Cookies。
 */
async function fetchDownloadHeadersFromTab(url, referrer) {
  if (!referrer) return {};
  try {
    const origin = new URL(url).origin;
    // 查找与 referrer 同源的标签页
    const tabs = await chrome.tabs.query({ url: origin + "/*" });
    for (const tab of tabs) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          action: "fetchDownloadHeaders",
          url,
        });
        if (result && result.contentType) return result;
      } catch {
        // 该标签页可能未加载 content script，继续下一个
      }
    }
  } catch {}
  return {};
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}

// ========================================
// Hugging Face — 获取模型文件列表
// ========================================

// 跳过常见的元数据文件
const HF_SKIP_PATTERNS = [
  /^\.gitattributes$/,
  /^\.gitignore$/,
  /^README\.md$/,
  /^LICENSE(\..*)?$/,
  /^CONTRIBUTING\.md$/,
  /^SECURITY\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^\.git\/.*/,
  /^\.huggingface$/,
  /^model_cards\/.*/,
];

function shouldSkipHfFile(path) {
  return HF_SKIP_PATTERNS.some((p) => p.test(path));
}

async function fetchHfFileList(modelId) {
  try {
    // modelId 如 "org/model"，API 路径需要保留 /
    const resp = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main?recursive=1`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const items = await resp.json();

    const files = [];
    for (const item of items) {
      if (item.type !== "file") continue;
      if (shouldSkipHfFile(item.path)) continue;

      const pathParts = item.path.split("/");
      const encodedPath = pathParts.map(encodeURIComponent).join("/");

      files.push({
        path: item.path,
        size: item.size,
        url: `https://huggingface.co/${modelId}/resolve/main/${encodedPath}`,
      });
    }

    return files;
  } catch (e) {
    console.error("[Aria2 Bridge] HF file list error:", e);
    return null;
  }
}

// ========================================
// Guard: prevent infinite loop when falling
// back to browser-native download.
// ========================================

let isSelfRedirect = false;

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
// ========================================

const REMOVED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const removedUrls = new Map(); // url -> timestamp

async function loadRemovedUrls() {
  try {
    const { removedUrls: saved } = await chrome.storage.session.get("removedUrls");
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
    await chrome.storage.session.set({
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

// 更新右键菜单语言
async function updateContextMenus() {
  await Aria2I18n.reload();
  try {
    chrome.contextMenus.update(MENU_ID_SEND, { title: Aria2I18n.t("menuSend") });
    chrome.contextMenus.update(MENU_ID_OPEN, { title: Aria2I18n.t("menuOpenAriaNg") });
    chrome.contextMenus.update(MENU_ID_HF_DOWNLOAD, { title: Aria2I18n.t("menuHfDownload") });
  } catch (e) {
    console.warn("[Aria2 Bridge] Failed to update context menus:", e.message);
  }
}

async function processDownload(url, referer) {
  if (!config.enabled) return;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (isRecentlyForwarded(url)) {
    console.log(`[Aria2 Bridge] Skip duplicate forward: ${url}`);
    return;
  }

  // 用户主动点击下载 → 清除“已删除”记忆，允许重新添加
  forgetRemoved(url);

  const options = { referer };

  const filename = extractFilename(url);
  if (filename) options.out = filename;

  await aria2AddUri(url, options);
  markForwarded(url);
}

// ========================================
// Download interception (fallback for
// JS-triggered downloads not caught by
// content script)
// ========================================

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  // Guard: skip our own fallback downloads
  if (isSelfRedirect) return;

  if (!config.enabled) return;
  const url = downloadItem.url;
  if (!url) return;

  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (shouldBypass(url)) return;
  if (downloadItem.fileSize > 0 && downloadItem.fileSize < 100) return;
  if (downloadItem.byExtensionId) return;

  // Cancel browser download
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.cancel(downloadItem.id, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  } catch {
    return; // too far along
  }

  // 清除浏览器下载记录，避免被取消的下载项残留在列表里
  // （否则删除 aria2 任务后，页面重试/用户重试会再次触发 onCreated → 任务“复活”）
  try {
    await chrome.downloads.erase(downloadItem.id);
  } catch {
    // erase 失败不影响主流程（例如状态不允许清除），忽略即可
  }

  // 去重：同一 URL 在短时间内（30s）不重复转发
  if (isRecentlyForwarded(url)) {
    console.log(`[Aria2 Bridge] Skip duplicate forward: ${url}`);
    return;
  }

  // 用户已删除过的任务：不自动重新添加（只有用户主动点击才放行）
  // 双重检查：本地记忆（轮询同步）+ 实时查询 aria2（堵住同步窗口期）
  if (isRemovedUrl(url) || (await isRemovedInAria2(url))) {
    console.log(`[Aria2 Bridge] Skip removed task re-add: ${url}`);
    return;
  }

  try {
    const options = {};
    let filename = extractFilename(url, downloadItem.filename, downloadItem.mime);

    // 如果提取到的文件名没有扩展名，尝试 HEAD 请求获取服务端文件名
    // 常见于 SPA 下载（税务发票等），URL 无后缀且浏览器 MIME 字段可能为空
    // 如果文件名没有扩展名，通过 content script（同源环境）获取响应头
    // 绕过 CORS 限制，且自动携带页面 Cookies → 能正确拿到 Content-Disposition
    if (!filename || !filename.includes(".")) {
      const headers = await fetchDownloadHeadersFromTab(url, downloadItem.referrer);
      if (headers.contentDisposition) {
        const d = headers.contentDisposition;
        // 优先取 filename*=UTF-8''xxx（RFC 5987），再取 filename="xxx"
        const starMatch = d.match(/filename\*\s*=\s*(?:UTF-8|ISO-8859-1)''([^;]+)/i);
        const plainMatch =
          d.match(/filename\s*=\s*"([^"]+)"/i) || d.match(/filename\s*=\s*([^;]+)/i);
        const cdName = starMatch
          ? decodeURIComponent(starMatch[1])
          : plainMatch
            ? plainMatch[1].trim()
            : null;
        if (cdName) {
          filename = cdName;
        }
      }
      // Content-Disposition 没有文件名 → 从 Content-Type 补扩展名
      if (filename && !filename.includes(".")) {
        const ext = guessExtFromMime(headers.contentType);
        if (ext) filename += ext;
      }
    }

    if (filename) options.out = filename;
    if (downloadItem.referrer) options.referer = downloadItem.referrer;

    await aria2AddUri(url, options);
    markForwarded(url);
    flashBadge("✓", "#4caf50");
    console.log(`[Aria2 Bridge] Download → aria2: ${url}`);
  } catch (err) {
    // aria2 down — restart browser download
    console.warn("[Aria2 Bridge] aria2 unreachable, restarting browser download:", err.message);
    isSelfRedirect = true;
    try {
      await chrome.downloads.download({
        url,
        filename: downloadItem.filename || undefined,
      });
    } finally {
      isSelfRedirect = false;
    }
  }
});

// ========================================
// Context menu
// ========================================

const MENU_ID_SEND = "aria2-bridge-send";
const MENU_ID_OPEN = "aria2-bridge-open-ariang";
const MENU_ID_HF_DOWNLOAD = "aria2-bridge-hf-download";

chrome.runtime.onInstalled.addListener(async () => {
  // 等待 i18n 初始化完成，确保菜单使用正确的语言
  await _i18nReady;

  chrome.contextMenus.create({
    id: MENU_ID_SEND,
    title: Aria2I18n.t("menuSend"),
    contexts: ["link", "image", "video", "audio"],
  });
  chrome.contextMenus.create({
    id: MENU_ID_OPEN,
    title: Aria2I18n.t("menuOpenAriaNg"),
    contexts: ["action"],
  });
  chrome.contextMenus.create({
    id: MENU_ID_HF_DOWNLOAD,
    title: Aria2I18n.t("menuHfDownload"),
    contexts: ["page"],
    documentUrlPatterns: ["https://huggingface.co/*"],
  });
});

/**
 * Build AriaNg URL with RPC settings passed via hash params.
 */
function buildAriaNgUrl() {
  // 没配 secret 时不传 hash 路由，让 AriaNg 用自己的 localStorage 中的设置
  // 否则每次打开都会用空 secret 覆盖用户手工保存的密钥
  if (!config.rpcSecret) {
    return chrome.runtime.getURL("aria-ng/index.html");
  }

  let protocol = "http";
  let host = "localhost";
  let port = "6800";
  let iface = "jsonrpc";

  try {
    const url = new URL(config.rpcUrl || "http://localhost:6800/jsonrpc");
    protocol = url.protocol.replace(":", "") || "http";
    host = url.hostname || "localhost";
    port = url.port || "6800";
    const match = url.pathname.match(/\/([^/]+)$/);
    if (match) iface = match[1];
  } catch {}

  const secret = btoa(config.rpcSecret).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return (
    chrome.runtime.getURL("aria-ng/index.html") +
    "#!/settings/rpc/set/" +
    encodeURIComponent(protocol) +
    "/" +
    encodeURIComponent(host) +
    "/" +
    encodeURIComponent(port) +
    "/" +
    encodeURIComponent(iface) +
    "/" +
    encodeURIComponent(secret)
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Menu: Open AriaNg
  if (info.menuItemId === MENU_ID_OPEN) {
    const url = buildAriaNgUrl();
    chrome.tabs.create({ url });
    return;
  }

  // Menu: Hugging Face — download all model files
  if (info.menuItemId === MENU_ID_HF_DOWNLOAD) {
    chrome.action.setBadgeBackgroundColor({ color: "#2196f3" });
    chrome.action.setBadgeText({ text: "···" });

    try {
      // 先从 content script 获取 model ID
      const idResponse = await chrome.tabs.sendMessage(tab.id, { action: "getHfModelId" });
      if (!idResponse || !idResponse.modelId) {
        flashBadge("✗", "#f44336");
        showNotification("Aria2 Bridge", Aria2I18n.t("notifHfModelIdFail"));
        return;
      }

      const modelId = idResponse.modelId;
      const files = await fetchHfFileList(modelId);

      if (!files || files.length === 0) {
        flashBadge("✗", "#f44336");
        showNotification("Aria2 Bridge", Aria2I18n.t("notifHfNoFiles"));
        return;
      }

      const modelName = modelId.split("/").pop() || modelId;

      // Badge 显示文件总数
      chrome.action.setBadgeText({ text: String(files.length) });

      // 批量发送
      const results = await Promise.allSettled(
        files.map((file) => {
          const outPath = modelName + "/" + file.path;
          return aria2AddUri(file.url, { out: outPath });
        })
      );

      const successCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.filter((r) => r.status === "rejected").length;

      flashBadge(failCount > 0 ? "⚠" : "✓", failCount > 0 ? "#ff9800" : "#4caf50");
      showNotification(
        "Aria2 Bridge — HF",
        failCount > 0
          ? Aria2I18n.t("notifHfPartial", [String(successCount), String(failCount)])
          : Aria2I18n.t("notifHfSuccess", [String(successCount)])
      );
    } catch (err) {
      console.warn("[Aria2 Bridge] HF context menu error:", err.message);
      flashBadge("✗", "#f44336");
      showNotification("Aria2 Bridge", Aria2I18n.t("notifHfError"));
    }
    return;
  }

  // Menu: Send to aria2
  const url = info.linkUrl || info.srcUrl;
  if (!url) return;

  const options = {};
  if (tab?.url) options.referer = tab.url;
  else if (info.pageUrl) options.referer = info.pageUrl;

  const filename = extractFilename(url);
  if (filename) options.out = filename;

  try {
    const gid = await aria2AddUri(url, options);
    const label = url.split("/").pop() || url;
    showNotification(Aria2I18n.t("notifSentTitle"), label);
    flashBadge("✓", "#4caf50");
    setTimeout(() => chrome.notifications.clear(gid), 3000);
  } catch (err) {
    showNotification(Aria2I18n.t("notifFailTitle"), err.message);
    flashBadge("✗", "#f44336");
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

function updateBadge() {
  if (config.enabled) {
    chrome.action.setBadgeText({ text: "" });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#888" });
  }
}

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
