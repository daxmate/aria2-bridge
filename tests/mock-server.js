// Aria2 Bridge Mock Server — 模拟 aria2 JSON-RPC + 测试页面 + 下载路由
// 独立进程运行（playwright webServer），通过 __mock 控制端点与测试交互
const http = require("http");
const PORT = process.env.MOCK_PORT || 18951;

const state = {
  // failMode: null | 'error'(RPC 返回 error) | 'http500' | 'timeout'(挂起不响应)
  failMode: null,
  errorMessage: "Mock aria2 error",
  // tellStopped 返回的任务列表（测试 removed 场景）
  stopped: [],
  // tellStatus 返回的任务（gid → aria2 任务对象），测试下载完成/失败通知用
  tasks: {},
  requests: [],
};

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function collectBody(req, cb) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => cb(body));
}

const TEST_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Aria2 Bridge Mock Test Page</title></head>
<body>
  <h1>Mock Test Page</h1>
  <a id="link-zip" href="/files/pack.zip">pack.zip</a>
  <a id="link-pdf" href="/files/doc.pdf">doc.pdf</a>
  <a id="link-json" href="/files/data.json">data.json</a>
  <a id="link-plain" href="/page">plain page</a>
  <a id="link-hash" href="#section">hash link</a>
  <a id="link-dlattr" href="/spa-download" download>spa download</a>
  <a id="link-mid" href="/files/mid.zip" download>mid.zip</a>
  <a id="link-bin" href="/hold.bin">hold.bin</a>
  <a id="link-magnet" href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ubuntu-24.04.iso">magnet link</a>
  <div id="section">section target</div>
</body>
</html>`;

// ---- 夸克网盘模拟页面（测试 quark.js 直链提取链路）----
// 模拟夸克 React 页面：.file-list 元素挂 __reactFiber$ 属性（fiber 结构）
// noselect=1 → selectedRowKeys 为空（未勾选场景）
function quarkPageHtml(noSelect) {
  const selected = noSelect ? "[]" : '["fid-1", "fid-2"]';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Quark Drive Mock</title></head>
<body>
  <div class="file-list" id="file-list"></div>
  <script>
    // 测试覆盖：quark.js 的 API 指向 mock server（同源，避免跨域 CORS）
    window.__QUARK_API_BASE__ = "http://127.0.0.1:${PORT}/quark-api";
  </script>
  <script src="/quark.js"></script>
  <script>
    // 模拟夸克页面的文件列表数据（React fiber 的 props）
    const fileList = [
      { fid: "fid-1", file_name: "report.pdf", size: 12345 },
      { fid: "fid-2", file_name: "data.zip", size: 67890 },
      { fid: "fid-3", file_name: "photo.jpg", size: 1000 }
    ];
    // 分享页场景：文件带 share_fid_token（pathname 以 /s/ 开头）
    if (/^\\/s\\//.test(location.pathname)) {
      fileList.forEach((f) => { f.share_fid_token = "share-token-" + f.fid; f.pdir_fid = "0"; });
    }
    const selectedRowKeys = ${selected};
    // 构造 fiber 链：DOM 元素 → __reactFiber$xxx → return(组件 fiber, props 含 list/selectedRowKeys)
    const fiber = {
      return: {
        type: function FileListComponent() {},
        stateNode: null,
        props: { list: fileList, selectedRowKeys: selectedRowKeys }
      }
    };
    const el = document.getElementById("file-list");
    el["__reactFiber$mock"] = fiber;
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  // ---- 控制端点 ----
  if (req.url.startsWith("/__mock/")) {
    collectBody(req, (body) => {
      if (req.url === "/__mock/config" && req.method === "POST") {
        const cfg = JSON.parse(body || "{}");
        Object.assign(state, cfg);
        sendJson(res, 200, { ok: true, state });
      } else if (req.url === "/__mock/requests" && req.method === "GET") {
        sendJson(res, 200, { requests: state.requests });
      } else if (req.url === "/__mock/reset" && req.method === "POST") {
        state.requests = [];
        state.failMode = null;
        state.stopped = [];
        state.tasks = {};
        state.quarkShareSortCalls = 0;
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 404, { error: "unknown mock endpoint" });
      }
    });
    return;
  }

  // ---- 静态测试页面 ----
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(TEST_PAGE);
    return;
  }
  if (req.method === "GET" && req.url === "/page") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!DOCTYPE html><html><body><h1>Plain Page</h1><p>no downloads here</p></body></html>");
    return;
  }

  // ---- 夸克网盘模拟页面 ----
  if (req.method === "GET" && req.url.startsWith("/quark")) {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/quark") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(quarkPageHtml(url.searchParams.get("noselect") === "1"));
      return;
    }
    if (url.pathname === "/quark.js") {
      const fs = require("fs");
      const path = require("path");
      const js = fs.readFileSync(path.join(__dirname, "..", "plugin", "quark.js"), "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(js);
      return;
    }
  }

  // ---- 请求头回显（测试 DNR 改 UA 用）----
  if (req.method === "GET" && req.url === "/echo") {
    sendJson(res, 200, req.headers);
    return;
  }

  // ---- 夸克分享页模拟（/s/xxx 路径 → quark.js 检测为分享页）----
  if (req.method === "GET" && /^\/s\//.test(req.url)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(quarkPageHtml(false));
    return;
  }

  // ---- 夸克 API mock（/quark-api/* → 模拟 drive-pc.quark.cn 接口）----
  if (req.url.startsWith("/quark-api/")) {
    const path = req.url.replace("/quark-api", "/1/clouddrive");
    // 用临时 server 逻辑：直接按 path 分发
    if (req.method === "POST" && path.includes("/file/download")) {
      collectBody(req, (body) => {
        const parsed = JSON.parse(body || "{}");
        // 文件名映射：fid-1→report.pdf, fid-2→data.zip, saved-1→report.pdf, saved-2→data.zip
        const NAME_MAP = {
          "fid-1": "report.pdf",
          "fid-2": "data.zip",
          "saved-1": "report.pdf",
          "saved-2": "data.zip",
        };
        sendJson(res, 200, {
          code: 0,
          data: (parsed.fids || []).map((fid) => ({
            fid,
            file_name: NAME_MAP[fid] || "file-" + fid + ".zip",
            download_url: `https://mock-cdn.quark.cn/dl/${NAME_MAP[fid] || fid}?sign=abc`,
            size: 12345,
          })),
        });
      });
      return;
    }
    if (req.method === "GET" && path.includes("/share/sharepage/detail")) {
      // 分享页当前目录文件列表（模拟 /s/share123#/list/share/dir123 场景）
      sendJson(res, 200, {
        code: 0,
        data: {
          list: [
            {
              fid: "fid-1",
              file_name: "report.pdf",
              size: 12345,
              file: true,
              share_fid_token: "st-1",
              pdir_fid: "dir123",
            },
            {
              fid: "fid-2",
              file_name: "data.zip",
              size: 67890,
              file: true,
              share_fid_token: "st-2",
              pdir_fid: "dir123",
            },
          ],
        },
        metadata: { _total: 2 },
      });
      return;
    }
    if (req.method === "POST" && path.includes("/share/sharepage/token")) {
      collectBody(req, (body) => {
        sendJson(res, 200, { code: 0, data: { stoken: "mock-stoken-abc" } });
      });
      return;
    }
    if (req.method === "POST" && path.includes("/share/sharepage/save")) {
      collectBody(req, (body) => {
        sendJson(res, 200, { code: 0, data: { task_id: "mock-task-1" } });
      });
      return;
    }
    if (req.method === "GET" && path.includes("/task")) {
      sendJson(res, 200, { code: 0, data: { status: 2 } });
      return;
    }
    if (req.method === "GET" && path.includes("/file/sort")) {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const pdir = url.searchParams.get("pdir_fid");
      if (pdir === "0") {
        // 根目录：包含"来自：分享"文件夹
        sendJson(res, 200, {
          code: 0,
          data: { list: [{ fid: "folder-share", file_name: "来自：分享", file_type: 0 }] },
          metadata: { _total: 1 },
        });
        return;
      }
      if (pdir === "folder-share") {
        // 转存目标文件夹：第一次（转存前）为空，之后（转存后）返回转存文件
        // 用 state 记录查询次数，模拟"转存后出现新文件"
        state.quarkShareSortCalls = (state.quarkShareSortCalls || 0) + 1;
        const list =
          state.quarkShareSortCalls > 1
            ? [
                { fid: "saved-1", file_name: "report.pdf", size: 12345 },
                { fid: "saved-2", file_name: "data.zip", size: 67890 },
              ]
            : [];
        sendJson(res, 200, { code: 0, data: { list }, metadata: { _total: list.length } });
        return;
      }
      sendJson(res, 200, { code: 0, data: { list: [] }, metadata: { _total: 0 } });
      return;
    }
    if (req.method === "POST" && path.includes("/file?")) {
      collectBody(req, (body) => {
        sendJson(res, 200, { code: 0, data: { fid: "folder-share" } });
      });
      return;
    }
    sendJson(res, 404, { error: "unknown quark api: " + path });
    return;
  }

  // ---- 普通文件下载（点击拦截测试用，体积 > 100B 避免被小文件规则跳过） ----
  if (req.method === "GET" && req.url.startsWith("/files/")) {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const ext = url.pathname.split(".").pop() || "bin";
    const mime =
      ext === "zip"
        ? "application/zip"
        : ext === "pdf"
          ? "application/pdf"
          : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": "256",
    });
    res.end(Buffer.alloc(256, ext.charCodeAt(0)));
    return;
  }

  // ---- SPA 下载：无后缀 URL + Content-Disposition 中文文件名（RFC 5987） ----
  // 挂起模式：下载保持进行中，保证 onCreated 的 cancel 成功
  // HEAD 也要响应：content script 的 fetchDownloadHeaders 用 HEAD 探文件名
  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/spa-download") {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E4%BB%B6.pdf",
      "Content-Length": "10485760",
    });
    if (req.method === "HEAD") {
      // HEAD 探文件名：无 body，立即结束（挂起 body 会卡住 content script 的连接）
      res.end();
      return;
    }
    res.write(Buffer.alloc(1024, 0x41));
    return; // GET 保持挂起
  }

  // ---- 挂起下载：大 Content-Length 但只发 1KB 后保持连接 ----
  // 用于 onCreated 兜底测试：下载永远进行中，保证 chrome.downloads.cancel 成功
  if (req.method === "GET" && req.url === "/hold.bin") {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": "10485760",
    });
    res.write(Buffer.alloc(1024, 0x42));
    // 故意不 end()，连接保持挂起
    return;
  }

  // ---- aria2 JSON-RPC ----
  if (req.method === "POST" && req.url.endsWith("/jsonrpc")) {
    collectBody(req, (body) => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        /* ignore */
      }
      state.requests.push({
        method: parsed.method,
        params: parsed.params,
        body: parsed,
        headers: req.headers,
      });

      if (state.failMode === "http500") {
        sendJson(res, 500, { error: "Internal Server Error" });
        return;
      }
      if (state.failMode === "timeout") {
        // 不响应，连接挂起
        return;
      }
      if (state.failMode === "error") {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: 1, message: state.errorMessage },
        });
        return;
      }

      let result = null;
      switch (parsed.method) {
        case "aria2.addUri":
          result = "gid-mock-" + Math.random().toString(36).slice(2, 10);
          break;
        case "aria2.tellStopped":
          result = state.stopped;
          break;
        case "aria2.tellStatus":
          // 未在 tasks 中注入的任务视为已删除（removed），与 aria2 删除后行为一致
          result = state.tasks[parsed.params[0]] || {
            gid: parsed.params[0],
            status: "removed",
          };
          break;
        case "aria2.getVersion":
          result = { version: "1.37.0", enabledFeatures: ["async-dns"] };
          break;
      }
      sendJson(res, 200, { jsonrpc: "2.0", id: parsed.id, result });
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[aria2-bridge mock] http://127.0.0.1:${PORT}`);
});
