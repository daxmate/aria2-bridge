// ========================================
// Aria2 Bridge — 下载拦截（content script 消息 + onCreated 兜底）
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
// ========================================

// ========================================
// Guard: prevent infinite loop when falling
// back to browser-native download.
// ========================================

let isSelfRedirect = false;

// ========================================
// 一次性签名 token（JWT 形状）检测
// ========================================

// JWT 特征：query 参数值以 base64url 的 "eyJ"（JSON 开头 {"）打头，
// 含 1-2 个点分隔段（header.payload[.signature]）。这类 token 通常
// 一次性或短时效（如 ankiweb 的 ?t=eyJ...），浏览器请求发出即被消耗，
// 转发 aria2 重新请求必然失败 → 此类下载交给浏览器原生处理。
const JWT_TOKEN_PARAM_RE =
  /(?:[?&])[^=&#]+=eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?(?=&|$)/;

function hasJwtLikeToken(url) {
  try {
    return JWT_TOKEN_PARAM_RE.test(new URL(url).search);
  } catch {
    return false;
  }
}

/**
 * 阿里云 OSS 签名直链检测：query 同时含 OSSAccessKeyId 与 Signature。
 * 这类 URL 是服务器临时签发给浏览器的直链，CDN 可能按请求特征（UA/Referer/
 * Cookie）返回不同内容——实测 jiaoyanyun 的 CDN 对 aria2 的请求返回了损坏的
 * 旧缓存文件（同 URL 浏览器下载正常）。转发 aria2 不可靠 → 交给浏览器原生下载。
 */
function hasOssSignedUrl(url) {
  try {
    const params = new URL(url).searchParams;
    return params.has("OSSAccessKeyId") && params.has("Signature");
  } catch {
    return false;
  }
}

/**
 * 已知“签名直链资源站”：下载 URL 形态多样（OSS 直链 / API 中间跳转 URL /
 * 带 ticket/token 参数等），且 CDN 按请求特征（UA/Referer/Cookie）返回不同
 * 内容——实测 jiaoyanyun 的 CDN 对 aria2 请求返回过损坏的旧缓存文件，也
 * 出现过浏览器下载被取消、aria2 却拿不到文件的“点击落空”。这类站点的下载
 * 一律交给浏览器原生完成，不转发 aria2。
 */
const SIGNED_URL_SITES = ["jiaoyanyun.com", "speiyou.com"];

function isSignedUrlSite(url, referrer) {
  const hosts = [url, referrer].filter(Boolean).map((s) => {
    try {
      return new URL(s).hostname;
    } catch {
      return "";
    }
  });
  return hosts.some((host) =>
    SIGNED_URL_SITES.some((site) => host === site || host.endsWith("." + site))
  );
}

/**
 * 签名 URL 检测：JWT 一次性 token（ankiweb 类）、OSS 签名直链，或
 * 已知签名直链站点（jiaoyanyun 类，按 URL/Referrer 域名判断）。
 * 这类下载转发 aria2 重新请求不可靠（token 被消耗 / CDN 按请求特征返回
 * 不同内容）→ 不拦截，浏览器原生下载。
 */
function hasSignedUrlToken(url, referrer) {
  return hasJwtLikeToken(url) || hasOssSignedUrl(url) || isSignedUrlSite(url, referrer);
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

async function processDownload(url, referer, out) {
  if (!config.enabled) return;
  // 支持 http(s) 文件与 magnet 磁力链（aria2 原生支持）
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("magnet:"))
    return;
  // 签名 URL（JWT 一次性 token / OSS 签名直链）：转发 aria2 不可靠
  // （token 被消耗 / CDN 按请求特征返回不同内容），抛错 → 走 background 的
  // catch 回退浏览器下载（用户点击不落空）
  if (config.skipTokenDownloads && hasSignedUrlToken(url, referer)) {
    console.log(`[Aria2 Bridge] Skip signed URL: ${url}`);
    throw new Error("skip: signed URL");
  }
  if (isRecentlyForwarded(url)) {
    console.log(`[Aria2 Bridge] Skip duplicate forward: ${url}`);
    // 磁力链浏览器无法原生下载，静默跳过（已转发过 aria2）；http(s) 抛错回退
    if (url.startsWith("magnet:")) return;
    throw new Error("skip: duplicate forward");
  }

  // 用户主动点击下载 → 清除“已删除”记忆，允许重新添加
  forgetRemoved(url);

  // 查重：同 URL 任务已在 aria2 队列（active/waiting/paused）→ 不再重复添加
  if (await isAlreadyInQueue(url)) {
    console.log(`[Aria2 Bridge] Skip: already in aria2 queue: ${url}`);
    throw new Error("skip: already in aria2 queue");
  }

  const options = { referer };

  // 优先使用调用方指定的文件名（如夸克直链带签名参数，URL 本身无文件后缀）
  const filename = out || extractFilename(url);
  if (filename) options.out = filename;

  const gid = await aria2AddUri(url, options);
  // 跟踪该任务：下载完成/失败时发系统通知
  trackDownload(gid, filename, url);
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

  // ════════════════════════════════════════════════════════════════
  // 先检查、后取消（2026-08-06 结构性修复）
  //
  // 旧逻辑：先 cancel 浏览器下载，再做去重/黑名单/队列检查。一旦检查
  // 命中就静默 return —— 下载已被取消，既没进 aria2 也没恢复浏览器
  // 下载，用户点击“消失”（如 ankiweb 第二次点击、黑名单命中等）。
  //
  // 新逻辑：所有检查前置。任何 skip 都不取消浏览器下载，让它原生
  // 完成 —— 用户点击永不落空（要么 aria2、要么浏览器）。
  // ════════════════════════════════════════════════════════════════

  // 签名 URL（JWT 一次性 token / OSS 签名直链）：
  // 浏览器请求发出时 token 已被消耗 / CDN 按请求特征返回不同内容（如
  // jiaoyanyun 对 aria2 请求返回损坏的旧缓存文件），转发 aria2 不可靠
  // → 不拦截，浏览器原生下载。
  if (config.skipTokenDownloads && hasSignedUrlToken(url, downloadItem.referrer)) {
    console.log(`[Aria2 Bridge] Skip signed URL (browser download): ${url}`);
    return;
  }

  // 去重：同一 URL 在短时间内（30s）不重复转发
  if (isRecentlyForwarded(url)) {
    console.log(`[Aria2 Bridge] Skip duplicate forward (browser download): ${url}`);
    return;
  }

  // 用户已删除过的任务：不自动重新添加（只有用户主动点击才放行）
  // 双重检查：本地记忆（轮询同步）+ 实时查询 aria2（堵住同步窗口期）
  if (isRemovedUrl(url) || (await isRemovedInAria2(url))) {
    console.log(`[Aria2 Bridge] Skip removed task re-add (browser download): ${url}`);
    return;
  }

  // 队列查重：同 URL 任务已在 aria2（active/waiting/paused）→ 不重复添加
  if (await isAlreadyInQueue(url)) {
    console.log(`[Aria2 Bridge] Skip: already in aria2 queue (browser download): ${url}`);
    return;
  }

  // 所有检查通过 → 此时才取消浏览器下载并转发 aria2
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.cancel(downloadItem.id, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  } catch {
    return; // 下载已完成/无法取消 → 保持浏览器下载
  }

  // 清除浏览器下载记录，避免被取消的下载项残留在列表里
  // （否则删除 aria2 任务后，页面重试/用户重试会再次触发 onCreated → 任务“复活”)
  try {
    await chrome.downloads.erase(downloadItem.id);
  } catch {
    // erase 失败不影响主流程（例如状态不允许清除），忽略即可
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

    const gid = await aria2AddUri(url, options);
    // 跟踪该任务：下载完成/失败时发系统通知
    trackDownload(gid, filename, url);
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
// 队列查重：同 URL 任务已在 aria2（active/waiting/paused）→ true
// 防止同一 URL 被反复添加多个副本（历史教训：Vivaldi 下载管理器残留
// 项每次被恢复/重试都会触发 onCreated → 重复转发）
// ========================================

async function isAlreadyInQueue(url) {
  // 每个 RPC 方法单独容错：某个方法不可用（如部分 daemon 不支持
  // aria2.tellPaused）不应拖垮整个查重，至少 active+waiting 生效
  const groups = [];
  const calls = [
    ["aria2.tellActive", []],
    ["aria2.tellWaiting", [0, 1000]],
    ["aria2.tellPaused", [0, 1000]],
  ];
  for (const [method, args] of calls) {
    try {
      groups.push(await aria2Rpc(method, args));
    } catch (e) {
      console.warn(`[Aria2 Bridge] isAlreadyInQueue ${method} error:`, e.message);
    }
  }
  for (const tasks of groups) {
    // 某些 daemon/兼容层对未知方法返回 result: null 而非错误（如测试 mock）
    // → 跳过非数组，避免迭代 null 抛 TypeError 拖垮整个查重
    if (!Array.isArray(tasks)) continue;
    for (const t of tasks) {
      for (const f of t.files || []) {
        for (const u of f.uris || []) {
          if (u.uri === url) return true;
        }
      }
    }
  }
  return false;
}

// ========================================
// 清理残留下载记录：扩展拦截后 cancel 的下载项（USER_CANCELED）
// 如果 erase 失败会残留在浏览器下载管理器里，成为“重试种子”——
// 浏览器恢复会话/用户点重试时再次触发 onCreated → 任务复活。
// 启动时 + 定期清理，从源头消除残留。
// ========================================

async function cleanupStaleDownloads() {
  try {
    const items = await chrome.downloads.search({ state: "interrupted" });
    let erased = 0;
    for (const item of items) {
      // 只清理扩展自己 cancel 的（USER_CANCELED / USER_SHUTDOWN），
      // 不动其他原因中断的下载（可能用户想手动恢复）
      if (item.interruptReason !== "USER_CANCELED" && item.interruptReason !== "USER_SHUTDOWN") {
        continue;
      }
      try {
        await chrome.downloads.erase(item.id);
        erased++;
      } catch {
        // 单条失败忽略，继续清理其他
      }
    }
    if (erased > 0) {
      console.log(`[Aria2 Bridge] Cleaned ${erased} stale cancelled download(s)`);
    }
  } catch (e) {
    console.warn("[Aria2 Bridge] cleanupStaleDownloads error:", e.message);
  }
}
