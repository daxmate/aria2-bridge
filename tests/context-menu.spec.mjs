// 右键菜单测试：菜单创建、语言切换更新、纯函数（文件名提取/白名单）
import { test, expect } from "./fixtures.mjs";

test.describe("右键菜单", () => {
  test("四个菜单项创建成功", async ({ sw }) => {
    // chrome.contextMenus 没有枚举 API：用重复 id 创建报错来验证菜单已存在
    const check = (id) =>
      sw.evaluate(
        (menuId) =>
          new Promise((resolve) => {
            chrome.contextMenus.create({ id: menuId, title: "probe", contexts: ["link"] }, () =>
              resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)
            );
          }),
        id
      );

    // SW 冷启动时 onInstalled 可能还没建完菜单 → 轮询等就绪
    await expect
      .poll(async () => /duplicate/i.test((await check("aria2-bridge-send")) || ""))
      .toBe(true);
    const openErr = await check("aria2-bridge-open-ariang");
    expect(openErr).toMatch(/duplicate/i);
    const hfErr = await check("aria2-bridge-hf-download");
    expect(hfErr).toMatch(/duplicate/i);
    const quarkErr = await check("aria2-bridge-quark-download");
    expect(quarkErr).toMatch(/duplicate/i);
  });

  test("切换语言 → 菜单标题实时更新", async ({ sw, setupConfig }) => {
    // 中文环境：updateLocale 应把菜单更新为中文标题
    // 注意：SW 无法向自己 sendMessage，直接调用 updateContextMenus()（listener 内部逻辑）
    await setupConfig({ locale: "zh_CN" });
    const zhCalls = await sw.evaluate(async () => {
      const calls = [];
      const orig = chrome.contextMenus.update;
      chrome.contextMenus.update = function (id, opts) {
        calls.push({ id, title: opts.title });
        return orig.call(this, id, opts);
      };
      await updateContextMenus();
      return calls;
    });
    const zhSend = zhCalls.find((c) => c.id === "aria2-bridge-send");
    expect(zhSend.title).toBe("用 Aria2 下载");

    // 切到英文：标题应变为英文
    await setupConfig({ locale: "en" });
    const enCalls = await sw.evaluate(async () => {
      const calls = [];
      const orig = chrome.contextMenus.update;
      chrome.contextMenus.update = function (id, opts) {
        calls.push({ id, title: opts.title });
        return orig.call(this, id, opts);
      };
      await updateContextMenus();
      return calls;
    });
    const enSend = enCalls.find((c) => c.id === "aria2-bridge-send");
    expect(enSend.title).toBe("Download with Aria2");
  });
});

test.describe("纯函数", () => {
  test("extractFilename：URL 路径 / fallback / MIME 补扩展名", async ({ sw }) => {
    const cases = await sw.evaluate(() => {
      return {
        fromUrl: extractFilename("https://example.com/download/pack.zip"),
        fromUrlNoName: extractFilename("https://example.com/download/"),
        fromFallback: extractFilename(
          "https://example.com/dl?id=1",
          "/Users/x/Downloads/report.pdf"
        ),
        mimeGuess: extractFilename("https://example.com/dl?id=1", "report", "application/pdf"),
        noMimeGuess: extractFilename("https://example.com/dl?id=1", "report", ""),
        mimeUnknown: extractFilename(
          "https://example.com/dl?id=1",
          "report",
          "application/octet-stream"
        ),
      };
    });
    expect(cases.fromUrl).toBe("pack.zip");
    expect(cases.fromUrlNoName).toBeNull();
    expect(cases.fromFallback).toBe("report.pdf");
    expect(cases.mimeGuess).toBe("report.pdf"); // 无扩展名 + PDF MIME → 补 .pdf
    expect(cases.noMimeGuess).toBe("report"); // 无 MIME 不加
    expect(cases.mimeUnknown).toBe("report"); // 未知 MIME 不加
  });

  test("shouldBypass：白名单域名（含子域名）匹配", async ({ sw, setupConfig }) => {
    await setupConfig({ bypassDomains: ["example.com", "cdn.test.org"] });
    const cases = await sw.evaluate(() => ({
      exact: shouldBypass("https://example.com/a.zip"),
      sub: shouldBypass("https://sub.example.com/a.zip"),
      other: shouldBypass("https://other.org/a.zip"),
      cdn: shouldBypass("https://x.cdn.test.org/f.bin"),
      invalid: shouldBypass("not-a-url"),
    }));
    expect(cases.exact).toBe(true);
    expect(cases.sub).toBe(true);
    expect(cases.cdn).toBe(true);
    expect(cases.other).toBe(false);
    expect(cases.invalid).toBe(true); // URL 解析失败 → 保守放行
  });

  test("shouldSkipHfFile：过滤元数据文件", async ({ sw }) => {
    const results = await sw.evaluate(() => ({
      gitattributes: shouldSkipHfFile(".gitattributes"),
      readme: shouldSkipHfFile("README.md"),
      license: shouldSkipHfFile("LICENSE"),
      model: shouldSkipHfFile("model.safetensors"),
      config: shouldSkipHfFile("config.json"),
      nested: shouldSkipHfFile("sub/model.onnx"),
    }));
    expect(results.gitattributes).toBe(true);
    expect(results.readme).toBe(true);
    expect(results.license).toBe(true);
    expect(results.model).toBe(false);
    expect(results.config).toBe(false);
    expect(results.nested).toBe(false);
  });

  test("aria2AddUri 接受 magnet URI（右键菜单发送磁力底层验证）", async ({
    sw,
    mock,
    setupConfig,
  }) => {
    // 纯函数 describe 没有 beforeEach setupConfig → 显式指向 mock RPC
    await setupConfig();
    // 右键菜单发送磁力无协议过滤（info.linkUrl 原样转发）；这里验证 RPC 层不阻塞 magnet:
    const gid = await sw.evaluate(() =>
      aria2AddUri("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ubuntu.iso")
    );
    expect(gid).toMatch(/^gid-mock-/);
    const add = (await mock.addUris())[0];
    expect(add.params[0][0]).toMatch(/^magnet:\?xt=urn:btih:/);
    // 磁力不需要 out（无文件名）；仅默认 User-Agent header
    expect(add.params[1].out).toBeUndefined();
    expect(add.params[1].referer).toBeUndefined();
    expect(add.params[1].header).toBeDefined();
  });
});
