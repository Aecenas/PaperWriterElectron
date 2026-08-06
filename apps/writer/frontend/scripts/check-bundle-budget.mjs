import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(frontendRoot, "dist");
const budgets = Object.freeze({
  total: 125 * MiB,
  javascript: 12 * MiB,
  largestJavascript: 1.5 * MiB,
  stylesheets: 0.6 * MiB,
  fonts: 22 * MiB,
  images: 92 * MiB,
});

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function formatMiB(bytes) {
  return `${(bytes / MiB).toFixed(2)} MiB`;
}

const files = await walk(distRoot).catch((error) => {
  throw new Error(`Cannot inspect frontend dist; run npm run build first. ${error.message}`);
});
const records = await Promise.all(files.map(async (filePath) => ({
  filePath,
  relativePath: path.relative(distRoot, filePath).replaceAll("\\", "/"),
  size: (await stat(filePath)).size,
})));
const sourceMaps = records.filter(({ relativePath }) => relativePath.endsWith(".map"));
const sum = (predicate) => records
  .filter(({ relativePath }) => predicate(relativePath.toLowerCase()))
  .reduce((total, { size }) => total + size, 0);
const metrics = {
  total: records.reduce((total, { size }) => total + size, 0),
  javascript: sum((name) => name.endsWith(".js") || name.endsWith(".mjs")),
  largestJavascript: Math.max(0, ...records
    .filter(({ relativePath }) => /\.(?:m?js)$/i.test(relativePath))
    .map(({ size }) => size)),
  stylesheets: sum((name) => name.endsWith(".css")),
  fonts: sum((name) => /\.(?:ttf|otf|woff2?)$/.test(name)),
  images: sum((name) => /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(name)),
};

const failures = [];
for (const [name, budget] of Object.entries(budgets)) {
  if (metrics[name] > budget) {
    failures.push(`${name}: ${formatMiB(metrics[name])} > ${formatMiB(budget)}`);
  }
}
if (sourceMaps.length) {
  failures.push(`source maps are not distributable: ${sourceMaps.map(({ relativePath }) => relativePath).join(", ")}`);
}

process.stdout.write([
  "Frontend bundle budget:",
  ...Object.entries(metrics).map(([name, bytes]) => `  ${name}: ${formatMiB(bytes)} / ${formatMiB(budgets[name])}`),
].join("\n") + "\n");

if (failures.length) {
  throw new Error(`Frontend bundle budget exceeded:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}
