// ========================================
// Aria2 Bridge — 夸克网盘客户端 UA 注入
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
// ========================================
// drive.quark.cn/1/clouddrive/file/download（pr=ucpro&fr=pc）是夸克**客户端** API，
// 服务器校验 User-Agent —— 非夸克客户端 UA 返回 404 混淆接口。
// 页面上下文 fetch 无法设置 User-Agent（forbidden header），
// 因此用 MV3 declarativeNetRequest 在网络层改写该接口请求的 UA。

const QUARK_UA_RULE_ID = 1001;

// 与网盘直链下载助手（panlinker）官方远程配置一致的夸克客户端 UA
const QUARK_CLIENT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch";

// 匹配夸克 PC 客户端 API（file/download 与 share/sharepage/token 均需客户端 UA）
const QUARK_API_URL_FILTER = "||drive-pc.quark.cn/1/clouddrive/";

/**
 * 注册/刷新动态规则：把夸克直链接口的 User-Agent 改写为夸克客户端 UA。
 * 幂等：先移除旧规则再添加（SW 每次启动都会调用）。
 */
async function registerQuarkUaRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [QUARK_UA_RULE_ID],
      addRules: [
        {
          id: QUARK_UA_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "user-agent", operation: "set", value: QUARK_CLIENT_UA }],
          },
          condition: {
            urlFilter: QUARK_API_URL_FILTER,
            resourceTypes: ["xmlhttprequest"],
          },
        },
      ],
    });
    console.log("[Aria2 Bridge] Quark UA rule registered");
    return true;
  } catch (e) {
    console.warn("[Aria2 Bridge] Failed to register Quark UA rule:", e.message);
    return false;
  }
}
