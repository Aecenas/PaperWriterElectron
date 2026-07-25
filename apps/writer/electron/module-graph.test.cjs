const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = __dirname;
const IGNORED_DIRECTORIES = new Set(["node_modules"]);
const LOCAL_REQUIRE_PATTERN = /\brequire\(\s*["'](\.[^"']*)["']\s*\)/g;

function collectRuntimeModules(directory = SOURCE_ROOT) {
  const modules = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        modules.push(...collectRuntimeModules(path.join(directory, entry.name)));
      }
    } else if (
      entry.isFile()
      && entry.name.endsWith(".cjs")
      && !entry.name.endsWith(".test.cjs")
      && entry.name !== "preload.cjs"
    ) {
      modules.push(path.normalize(path.join(directory, entry.name)));
    }
  }
  return modules.sort();
}

function resolveLocalModule(importerPath, request) {
  const resolved = path.resolve(path.dirname(importerPath), request);
  const candidates = path.extname(resolved)
    ? [resolved]
    : [resolved, `${resolved}.cjs`, path.join(resolved, "index.cjs")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || "";
}

function buildModuleGraph() {
  const modules = collectRuntimeModules();
  const graph = new Map(modules.map((modulePath) => [modulePath, []]));
  for (const modulePath of modules) {
    const source = fs.readFileSync(modulePath, "utf8");
    const dependencies = [...source.matchAll(LOCAL_REQUIRE_PATTERN)]
      .map((match) => resolveLocalModule(modulePath, match[1]))
      .filter((dependency) => dependency && graph.has(path.normalize(dependency)))
      .map((dependency) => path.normalize(dependency));
    graph.set(modulePath, [...new Set(dependencies)].sort());
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

test("Electron runtime modules keep an acyclic local require graph", () => {
  const cycles = findCycles(buildModuleGraph()).map((cycle) => (
    cycle.map((modulePath) => path.relative(SOURCE_ROOT, modulePath).replaceAll("\\", "/")).join(" -> ")
  ));
  assert.deepEqual(cycles, []);
});
