// ========================================
// Aria2 Bridge — 右键菜单与 AriaNg 入口
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
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
