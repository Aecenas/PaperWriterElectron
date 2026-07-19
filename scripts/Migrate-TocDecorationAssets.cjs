const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const JSZip = require("../apps/writer/electron/node_modules/jszip");
const { atomicWriteFile } = require("../apps/writer/electron/document-storage.cjs");

const TOC_BLOCK_PATTERN = /<(section|div)\b[^>]*\bdata-type=(['"])paper-toc\2[^>]*>[\s\S]*?<\/\1>/gi;
const SOURCE_PATTERN = /\bsrc=(['"])([^'"]+)\1/gi;

function isLegacyTocDecorationSource(value) {
  const source = String(value || "").trim();
  if (!/^(?:https?:|file:)/i.test(source)) return false;
  try {
    const url = new URL(source);
    const fileName = decodeURIComponent(url.pathname.split("/").pop() || "");
    return /^toc-title-signature(?:-[a-z0-9_-]+)?\.png$/i.test(fileName);
  } catch {
    return false;
  }
}

function replaceLegacyTocDecorationSources(html, packagedAssetPath) {
  let replacements = 0;
  const migratedHtml = String(html || "").replace(TOC_BLOCK_PATTERN, (tocBlock) => (
    tocBlock.replace(SOURCE_PATTERN, (full, quote, source) => {
      if (!isLegacyTocDecorationSource(source)) return full;
      replacements += 1;
      return `src=${quote}${packagedAssetPath}${quote}`;
    })
  ));
  return { html: migratedHtml, replacements };
}

async function listLetterpaperFiles(rootPath) {
  const files = [];
  const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".letterpaper")) files.push(entryPath);
    }
  };
  await visit(rootPath);
  return files.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function nextAvailableAssetPath(zip, basePath) {
  if (!zip.file(basePath)) return basePath;
  let index = 2;
  const extension = path.posix.extname(basePath);
  const stem = basePath.slice(0, -extension.length);
  while (zip.file(`${stem}-${index}${extension}`)) index += 1;
  return `${stem}-${index}${extension}`;
}

async function findIdenticalAsset(zip, expectedBytes, expectedHash) {
  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir || !entryPath.startsWith("assets/")) continue;
    const bytes = await entry.async("nodebuffer");
    if (bytes.length !== expectedBytes.length) continue;
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash === expectedHash) return entryPath;
  }
  return "";
}

async function migrateDocument(filePath, { rootPath, backupRoot, decorationBytes, decorationHash }) {
  const input = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(input);
  const documentEntry = zip.file("document.json");
  if (!documentEntry) throw new Error("缺少 document.json");
  const document = JSON.parse(await documentEntry.async("string"));
  const preferredAssetPath = `assets/toc-title-signature-${decorationHash.slice(0, 12)}.png`;
  const preview = replaceLegacyTocDecorationSources(document.html, preferredAssetPath);
  if (!preview.replacements) return { changed: false, replacements: 0 };

  let packagedAssetPath = await findIdenticalAsset(zip, decorationBytes, decorationHash);
  if (!packagedAssetPath) {
    packagedAssetPath = nextAvailableAssetPath(zip, preferredAssetPath);
    zip.file(packagedAssetPath, decorationBytes, { compression: "STORE", createFolders: false });
  }
  const migrated = replaceLegacyTocDecorationSources(document.html, packagedAssetPath);
  document.html = migrated.html;
  zip.file("document.json", JSON.stringify(document, null, 2), { compression: "STORE" });
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });

  const relativePath = path.relative(rootPath, filePath);
  const backupPath = path.join(backupRoot, relativePath);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(filePath, backupPath);
  await atomicWriteFile(filePath, output);
  return { changed: true, replacements: migrated.replacements, packagedAssetPath, backupPath };
}

async function main() {
  const rootPath = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) throw new Error("用法：node scripts/Migrate-TocDecorationAssets.cjs <文档文件夹> [备份文件夹]");
  const sourceAssetPath = path.resolve(__dirname, "../apps/writer/frontend/src/assets/decor/toc-title-signature.png");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.resolve(process.argv[3] || `${rootPath}-目录资源迁移备份-${timestamp}`);
  const decorationBytes = await fs.readFile(sourceAssetPath);
  const decorationHash = createHash("sha256").update(decorationBytes).digest("hex");
  const files = await listLetterpaperFiles(rootPath);
  const results = [];

  for (const filePath of files) {
    try {
      const result = await migrateDocument(filePath, {
        rootPath,
        backupRoot,
        decorationBytes,
        decorationHash,
      });
      results.push({ filePath, ...result });
    } catch (error) {
      results.push({ filePath, changed: false, error: error?.message || String(error) });
    }
  }

  const summary = {
    rootPath,
    backupRoot,
    scanned: results.length,
    changed: results.filter((result) => result.changed).length,
    unchanged: results.filter((result) => !result.changed && !result.error).length,
    failed: results.filter((result) => result.error).length,
    results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  isLegacyTocDecorationSource,
  replaceLegacyTocDecorationSources,
};
