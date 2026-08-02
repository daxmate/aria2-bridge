// ========================================
// Aria2 Bridge — Hugging Face 一键下载
// 被 background.js importScripts 加载，与其余 lib/*.js 共享 SW 全局作用域
// ========================================

// 跳过常见的元数据文件
const HF_SKIP_PATTERNS = [
  /^\.gitattributes$/,
  /^\.gitignore$/,
  /^README\.md$/,
  /^LICENSE(\..*)?$/,
  /^CONTRIBUTING\.md$/,
  /^SECURITY\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^\.git\/.*/,
  /^\.huggingface$/,
  /^model_cards\/.*/,
];

function shouldSkipHfFile(path) {
  return HF_SKIP_PATTERNS.some((p) => p.test(path));
}

async function fetchHfFileList(modelId) {
  try {
    // modelId 如 "org/model"，API 路径需要保留 /
    const resp = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main?recursive=1`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const items = await resp.json();

    const files = [];
    for (const item of items) {
      if (item.type !== "file") continue;
      if (shouldSkipHfFile(item.path)) continue;

      const pathParts = item.path.split("/");
      const encodedPath = pathParts.map(encodeURIComponent).join("/");

      files.push({
        path: item.path,
        size: item.size,
        url: `https://huggingface.co/${modelId}/resolve/main/${encodedPath}`,
      });
    }

    return files;
  } catch (e) {
    console.error("[Aria2 Bridge] HF file list error:", e);
    return null;
  }
}
