import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MODULE_EXTENSIONS = new Set([".js", ".jsx"]);
const STATIC_IMPORT_PATTERN = /\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']/g;

async function collectSourceModules(directory = SOURCE_ROOT) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      modules.push(...await collectSourceModules(entryPath));
    } else if (
      entry.isFile()
      && MODULE_EXTENSIONS.has(path.extname(entry.name))
      && !entry.name.endsWith(".test.js")
    ) {
      modules.push(entryPath);
    }
  }
  return modules.sort();
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function resolveLocalModule(importerPath, request) {
  if (!request.startsWith(".")) return "";
  const cleanRequest = request.split("?")[0].split("#")[0];
  const resolved = path.resolve(path.dirname(importerPath), cleanRequest);
  const extension = path.extname(resolved);
  if (extension && !MODULE_EXTENSIONS.has(extension)) return "";

  const candidates = extension
    ? [resolved]
    : [
        resolved,
        ...[...MODULE_EXTENSIONS].map((candidateExtension) => `${resolved}${candidateExtension}`),
        ...[...MODULE_EXTENSIONS].map((candidateExtension) => path.join(resolved, `index${candidateExtension}`)),
      ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return path.normalize(candidate);
  }
  return "";
}

async function buildModuleGraph() {
  const modules = await collectSourceModules();
  const graph = new Map(modules.map((modulePath) => [path.normalize(modulePath), []]));
  for (const modulePath of modules) {
    const source = await readFile(modulePath, "utf8");
    const dependencies = [];
    for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
      const dependency = await resolveLocalModule(modulePath, match[1]);
      if (dependency && graph.has(dependency)) dependencies.push(dependency);
    }
    graph.set(path.normalize(modulePath), [...new Set(dependencies)].sort());
  }
  return graph;
}

function findCycles(graph) {
  const completed = new Set();
  const active = new Set();
  const stack = [];
  const cycles = [];

  function visit(modulePath) {
    if (completed.has(modulePath)) return;
    if (active.has(modulePath)) {
      const start = stack.indexOf(modulePath);
      cycles.push([...stack.slice(start), modulePath]);
      return;
    }
    active.add(modulePath);
    stack.push(modulePath);
    for (const dependency of graph.get(modulePath) || []) visit(dependency);
    stack.pop();
    active.delete(modulePath);
    completed.add(modulePath);
  }

  for (const modulePath of graph.keys()) visit(modulePath);
  return cycles;
}

test("frontend source modules keep an acyclic relative-import graph", async () => {
  const graph = await buildModuleGraph();
  const cycles = findCycles(graph).map((cycle) => (
    cycle.map((modulePath) => path.relative(SOURCE_ROOT, modulePath).replaceAll("\\", "/")).join(" -> ")
  ));
  assert.deepEqual(cycles, []);
});
