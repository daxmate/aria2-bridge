// Hugging Face 一键下载测试：文件树获取、过滤、URL 编码、失败处理
import { test, expect } from "./fixtures.mjs";

test.describe("Hugging Face 下载", () => {
  // 在 SW 中替换 fetch 来模拟 HF API（扩展 SW 的 fetch 不受 page.route 拦截）
  async function mockHfApi(sw, tree) {
    return sw.evaluate(async (mockTree) => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (String(url).includes("huggingface.co/api/models/")) {
          return { ok: true, json: async () => mockTree };
        }
        return realFetch(url);
      };
      try {
        return await fetchHfFileList("org/model");
      } finally {
        globalThis.fetch = realFetch;
      }
    }, tree);
  }

  test("获取文件树：过滤元数据/目录，URL 正确编码", async ({ sw }) => {
    const files = await mockHfApi(sw, [
      { type: "file", path: "model.safetensors", size: 123456 },
      { type: "file", path: "config.json", size: 512 },
      { type: "file", path: "README.md", size: 1024 }, // 应过滤
      { type: "file", path: ".gitattributes", size: 100 }, // 应过滤
      { type: "file", path: "sub dir/weights.onnx", size: 99 }, // 路径含空格 → 编码
      { type: "directory", path: "sub dir", size: 0 }, // 目录应跳过
    ]);

    expect(files).not.toBeNull();
    expect(files.length).toBe(3);

    const model = files.find((f) => f.path === "model.safetensors");
    expect(model.url).toBe("https://huggingface.co/org/model/resolve/main/model.safetensors");
    expect(model.size).toBe(123456);

    const spaced = files.find((f) => f.path === "sub dir/weights.onnx");
    expect(spaced.url).toBe(
      "https://huggingface.co/org/model/resolve/main/sub%20dir/weights.onnx"
    );

    // 元数据被过滤
    expect(files.some((f) => f.path === "README.md")).toBe(false);
    expect(files.some((f) => f.path === ".gitattributes")).toBe(false);
  });

  test("API 失败（fetch 抛错）→ 返回 null", async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("network down");
      };
      try {
        return await fetchHfFileList("org/model");
      } finally {
        globalThis.fetch = realFetch;
      }
    });
    expect(result).toBeNull();
  });

  test("API 非 200 → 返回 null", async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
      });
      try {
        return await fetchHfFileList("org/model");
      } finally {
        globalThis.fetch = realFetch;
      }
    });
    expect(result).toBeNull();
  });
});
