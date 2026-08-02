// ========================================
// Aria2 Bridge — 下载拦截（content script 消息 + onCreated 兜底）
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
// ========================================

// ========================================
// Guard: prevent infinite loop when falling
// back to browser-native download.
// ========================================

let isSelfRedirect = false;

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
