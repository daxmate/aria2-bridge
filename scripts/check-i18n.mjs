#!/usr/bin/env node
// Aria2 Bridge — i18n 校验：对比各语言 messages.json 的 key 一致性、非空、无占位符缺失
// 运行：npm run check:i18n（npm test 的 pretest 自动执行）
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(root, "plugin", "_locales");
const LOCALES = ["zh_CN", "en"];

function load(locale) {
  try {
    return JSON.parse(readFileSync(join(LOCALES_DIR, locale, "messages.json"), "utf8"));
  } catch (e) {
    console.error(`[check-i18n] 无法读取 ${locale}/messages.json: ${e.message}`);
    process.exit(1);
  }
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)]));
let errors = 0;

const fail = (msg) => {
  errors++;
  console.error(`  ✗ ${msg}`);
};

// 1. key 集合一致
const keys = LOCALES.map((l) => Object.keys(messages[l]).sort());
const base = keys[0];
for (let i = 1; i < keys.length; i++) {
  const missing = base.filter((k) => !keys[i].includes(k));
  const extra = keys[i].filter((k) => !base.includes(k));
  missing.forEach((k) => fail(`${LOCALES[i]} 缺少 key: ${k}`));
  extra.forEach((k) => fail(`${LOCALES[i]} 多出 key: ${k}`));
}

// 2. 每个 key 的 message 非空
for (const locale of LOCALES) {
  for (const [key, entry] of Object.entries(messages[locale])) {
    if (!entry || typeof entry.message !== "string" || !entry.message.trim()) {
      fail(`${locale}.${key} message 为空`);
    }
  }
}

// 3. 占位符引用完整性：message 中的 $name$ 必须在 placeholders 中声明
for (const locale of LOCALES) {
  for (const [key, entry] of Object.entries(messages[locale])) {
    const phRefs = [...(entry.message || "").matchAll(/\$([a-zA-Z]\w*)\$/g)].map((m) => m[1]);
    const declared = new Set(Object.keys(entry.placeholders || {}));
    for (const name of phRefs) {
      const content = entry.placeholders?.[name]?.content;
      const ok = declared.has(name) && /^\$\d+$/.test(content || "");
      if (!ok) fail(`${locale}.${key} 占位符 $${name}$ 未在 placeholders 中正确声明`);
    }
  }
}

// 4. 各语言占位符数量一致（同一 key 的替换参数个数应相同）
for (const key of base) {
  const counts = LOCALES.map((l) => (messages[l][key].message.match(/\$\d+\$/g) || []).length);
  if (new Set(counts).size > 1) {
    fail(`${key} 各语言占位符数量不一致: ${LOCALES.map((l, i) => `${l}=${counts[i]}`).join(", ")}`);
  }
}

if (errors > 0) {
  console.error(`[check-i18n] ${errors} 个问题`);
  process.exit(1);
}
console.log(`[check-i18n] OK — ${base.length} keys × ${LOCALES.length} locales`);
