// ========================================
// Aria2 Bridge — 夸克网盘直链提取（页面上下文脚本）
// ========================================
// 本脚本由 content script 以 <script src="chrome-extension://.../quark.js">
// 注入夸克网盘页面（MAIN world），因此可以访问页面的 React fiber 内部变量，
// 而 content script（ISOLATED world）无法访问这些变量。
// 与 content script 通过 window.postMessage 双向通信。
//
// 支持两种页面：
//   1. 我的网盘（/list）：从 fiber 读勾选文件 → POST file/download {fids}
//   2. 分享页（/s/xxx）：分享页文件列表不在 React fiber 里（实测），
//      改为「下载当前目录全部文件」：URL hash 取目录 fid →
//      POST sharepage/token 换 stoken → GET sharepage/detail 拿列表 →
//      POST file/download {fids, pwd_id, stoken, fids_token} → 直链
//
// ⚠️ 分享页关键点（2026-08-02 真实页面实测验证）：
//   - 分享链接 #/list/share/<fid> 的 fid 是【目录】fid，detail 必须带
//     pdir_fid=<该fid> 才能列出文件（用根目录会拿到文件夹而非 mp3）
//   - 直链必须带文件的 share_fid_token（fids_token），缺了返回 403
//   - 分享页文件列表数据不在 fiber 的 memoizedProps 里，必须走 API

// ========================================
// 接口地址（夸克 PC 客户端域名）
// ========================================

const QUARK_API_BASE =
  (typeof window !== "undefined" && window.__QUARK_API_BASE__) ||
  "https://drive-pc.quark.cn/1/clouddrive";
const QUARK_DOWNLOAD_API = `${QUARK_API_BASE}/file/download?pr=ucpro&fr=pc`;
const QUARK_SHARE_TOKEN_API = `${QUARK_API_BASE}/share/sharepage/token?pr=ucpro&fr=pc`;
const QUARK_SHARE_DETAIL_API = `${QUARK_API_BASE}/share/sharepage/detail?pr=ucpro&fr=pc`;

// ========================================
// 模块 A: 穿透 React fiber（我的网盘用）
// ========================================

function findReact(dom, traverseUp = 0) {
  const key = Object.keys(dom).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
  if (!key) return null;
  const domFiber = dom[key];
  if (!domFiber) return null;

  const GetCompFiber = (fiber) => {
    let parentFiber = fiber.return;
    while (typeof parentFiber.type === "string") {
      parentFiber = parentFiber.return;
    }
    return parentFiber;
  };
  let compFiber = GetCompFiber(domFiber);
  for (let i = 0; i < traverseUp; i++) {
    compFiber = GetCompFiber(compFiber);
  }
  return compFiber.stateNode || compFiber;
}

// ========================================
// 模块 B: 获取选中的文件列表（我的网盘用）
// ========================================

function getSelectedQuarkFiles() {
  try {
    const reactDom = document.getElementsByClassName("file-list")[0];
    if (!reactDom) return [];
    const reactObj = findReact(reactDom);
    const props = reactObj?.props;
    if (!props) return [];

    const fileList = props.list || [];
    const selectedKeys = props.selectedRowKeys || [];
    return fileList.filter((val) => selectedKeys.includes(val.fid));
  } catch (e) {
    return [];
  }
}

// ========================================
// 页面类型检测：分享页 vs 我的网盘
// ========================================

function isQuarkSharePage() {
  const path = location.pathname;
  return /^\/s\//.test(path) || /^\/share\//.test(path);
}

// 分享页参数：从 URL 提取 pwd_id + 当前目录 fid
// URL 形如 pan.quark.cn/s/<pwd_id>#/list/share/<dir_fid>
function getQuarkShareParams() {
  const pwdMatch = location.pathname.match(/\/s\/([a-zA-Z0-9]+)/);
  const dirMatch = location.hash.match(/\/list\/share\/([a-zA-Z0-9]+)/);
  if (!pwdMatch) return null;
  const urlParams = new URLSearchParams(location.search);
  return {
    pwdId: pwdMatch[1],
    dirFid: dirMatch ? dirMatch[1] : "0",
    passcode: urlParams.get("passcode") || urlParams.get("pwd") || "",
  };
}

// ========================================
// 通用请求（页面上下文 fetch，自动携带登录 Cookie）
// ========================================

async function quarkFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      ...(options.headers || {}),
    },
  });

  // 非 2xx：HTTP 层失败，提前抛出友好错误
  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }
  const res = await response.json();
  if (res.code !== 0) {
    if (res.code === 31001) {
      throw new Error("请先登录夸克网盘！");
    }
    throw new Error(res.message || "请求失败");
  }
  return res;
}

// ========================================
// 分享页直链（无需转存，实测验证）
// ========================================

async function getQuarkShareToken(pwdId, passcode = "") {
  const res = await quarkFetch(QUARK_SHARE_TOKEN_API, {
    method: "POST",
    body: JSON.stringify({
      pwd_id: pwdId,
      passcode: passcode || "",
      support_visit_limit_private_share: true,
    }),
  });
  const stoken = res.data?.stoken;
  if (!stoken) {
    throw new Error("未获取到分享令牌");
  }
  return stoken;
}

/**
 * 获取分享页当前目录的文件列表。
 * @param {string} pwdId - 分享码
 * @param {string} stoken - 分享令牌
 * @param {string} dirFid - 当前目录 fid（URL hash 里的 fid）
 */
async function getQuarkShareFileList(pwdId, stoken, dirFid = "0") {
  const params = new URLSearchParams({
    pr: "ucpro",
    fr: "pc",
    uc_param_str: "",
    ver: "2",
    pwd_id: pwdId,
    stoken,
    pdir_fid: dirFid,
    force: "0",
    _page: "1",
    _size: "100",
    _fetch_banner: "1",
    _fetch_share: "1",
    _fetch_total: "1",
    _sort: "file_type:asc,file_name:asc",
  });
  const res = await quarkFetch(`${QUARK_SHARE_DETAIL_API}&${params.toString()}`);
  return res.data?.list || [];
}

// ========================================
// 模块 C: 请求直链
// ========================================

/**
 * 获取下载直链。
 * @param {string[]} fids - 文件 fid
 * @param {object} [shareCtx] - 分享上下文 { pwdId, stoken, fidsToken[] }
 * @returns {Promise<Array>} 含 download_url / file_name 的数组
 */
async function getQuarkDownloadLinks(fids, shareCtx = null) {
  const body = { fids };
  if (shareCtx) {
    body.pwd_id = shareCtx.pwdId;
    body.stoken = shareCtx.stoken;
    if (shareCtx.fidsToken && shareCtx.fidsToken.length > 0) {
      body.fids_token = shareCtx.fidsToken;
    }
  }
  const res = await quarkFetch(QUARK_DOWNLOAD_API, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data || [];
}

// ========================================
// 消息监听：content script → 本脚本 → content script
// ========================================

window.addEventListener("message", async function (event) {
  // 只响应 content script 发来的指令（同一 window 的 postMessage）
  if (event.data && event.data.type === "FETCH_QUARK_LINKS") {
    try {
      let files;
      let data;

      if (isQuarkSharePage()) {
        // ---- 分享页：下载当前目录全部文件（不走 fiber，走 API）----
        const shareParams = getQuarkShareParams();
        if (!shareParams) {
          window.postMessage({ type: "QUARK_ERROR", message: "无法识别分享链接" }, "*");
          return;
        }
        const stoken = await getQuarkShareToken(shareParams.pwdId, shareParams.passcode);
        const list = await getQuarkShareFileList(shareParams.pwdId, stoken, shareParams.dirFid);
        files = list.filter((f) => f.file !== false); // 只要文件，跳过文件夹
        if (files.length === 0) {
          window.postMessage({ type: "QUARK_ERROR", message: "当前目录没有可下载的文件" }, "*");
          return;
        }
        data = await getQuarkDownloadLinks(
          files.map((f) => f.fid),
          {
            pwdId: shareParams.pwdId,
            stoken,
            fidsToken: files.map((f) => f.share_fid_token || f.fid_token).filter(Boolean),
          }
        );
      } else {
        // ---- 我的网盘：从 fiber 读勾选文件 → 直接取直链 ----
        files = getSelectedQuarkFiles();
        if (files.length === 0) {
          window.postMessage({ type: "QUARK_ERROR", message: "no-selection" }, "*");
          return;
        }
        data = await getQuarkDownloadLinks(files.map((f) => f.fid));
      }

      window.postMessage(
        {
          type: "QUARK_SUCCESS",
          data: data,
          files: files,
        },
        "*"
      );
    } catch (e) {
      window.postMessage({ type: "QUARK_ERROR", message: e.message }, "*");
    }
  }
});
