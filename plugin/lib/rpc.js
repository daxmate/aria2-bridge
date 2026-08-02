// ========================================
// Aria2 Bridge — RPC（aria2 JSON-RPC 通信与文件名提取）
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
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

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}
