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
  <div id="section">section target</div>
</body>
</html>`;

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
