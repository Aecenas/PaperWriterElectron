const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { registerResearchWebViewIpcHandlers } = require("./research-web-view-ipc.cjs");

const RESEARCH_WEB_VIEW_CHANNELS = [
  "research:web-view-bounds",
  "research:web-view-control",
  "research:web-view-destroy",
  "research:web-view-hide",
  "research:web-view-show",
];

function unavailableFacade() {
  return {
    show: () => ({ ok: false, unsupported: true }),
    updateBounds: () => ({ ok: false, unsupported: true }),
    hide: () => ({ ok: true }),
    control: () => ({ ok: false, unsupported: true }),
    destroy: () => ({ ok: true }),
  };
}

function createHarness(facade = unavailableFacade()) {
  const handlers = new Map();
  let activeFacade = facade;
  registerResearchWebViewIpcHandlers({
    ipcMain: {
      handle(channel, listener) {
        assert.equal(handlers.has(channel), false, `duplicate test handler: ${channel}`);
        handlers.set(channel, listener);
      },
    },
    webViewFacade: {
      show: (...args) => activeFacade.show(...args),
      updateBounds: (...args) => activeFacade.updateBounds(...args),
      hide: (...args) => activeFacade.hide(...args),
      control: (...args) => activeFacade.control(...args),
      destroy: (...args) => activeFacade.destroy(...args),
    },
  });
  return {
    handlers,
    setFacade: (value) => { activeFacade = value; },
  };
}

test("registers the complete research web-view IPC surface exactly once", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), RESEARCH_WEB_VIEW_CHANNELS);
});

test("forwards unchanged payloads and view ids to the single injected manager", async () => {
  const calls = [];
  const results = {
    show: { ok: true, id: "view-1" },
    updateBounds: { ok: true, bounds: { x: 10 } },
    hide: { ok: true, hidden: true },
    control: { ok: true, action: "reload" },
    destroy: { ok: true, destroyed: true },
  };
  const facade = Object.fromEntries(Object.keys(results).map((method) => [
    method,
    (value) => {
      calls.push([method, value]);
      return results[method];
    },
  ]));
  const harness = createHarness(facade);
  const payload = { viewId: "view-1", url: "https://example.com", nested: { keep: true } };

  assert.equal(await harness.handlers.get("research:web-view-show")({}, payload), results.show);
  assert.equal(await harness.handlers.get("research:web-view-bounds")({}, payload), results.updateBounds);
  assert.equal(await harness.handlers.get("research:web-view-hide")({}, "view-1"), results.hide);
  assert.equal(await harness.handlers.get("research:web-view-control")({}, payload), results.control);
  assert.equal(await harness.handlers.get("research:web-view-destroy")({}, "view-1"), results.destroy);
  assert.deepEqual(calls, [
    ["show", payload],
    ["updateBounds", payload],
    ["hide", "view-1"],
    ["control", payload],
    ["destroy", "view-1"],
  ]);
});

test("preserves default arguments and unavailable-manager fallbacks", async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.handlers.get("research:web-view-show")(), {
    ok: false,
    unsupported: true,
  });
  assert.deepEqual(await harness.handlers.get("research:web-view-bounds")(), {
    ok: false,
    unsupported: true,
  });
  assert.deepEqual(await harness.handlers.get("research:web-view-control")(), {
    ok: false,
    unsupported: true,
  });
  assert.deepEqual(await harness.handlers.get("research:web-view-hide")(), { ok: true });
  assert.deepEqual(await harness.handlers.get("research:web-view-destroy")(), { ok: true });

  const received = [];
  harness.setFacade({
    show: (payload) => { received.push(["show", payload]); },
    updateBounds: (payload) => { received.push(["updateBounds", payload]); },
    hide: (viewId) => { received.push(["hide", viewId]); },
    control: (payload) => { received.push(["control", payload]); },
    destroy: (viewId) => { received.push(["destroy", viewId]); },
  });
  await harness.handlers.get("research:web-view-show")();
  await harness.handlers.get("research:web-view-bounds")();
  await harness.handlers.get("research:web-view-hide")();
  await harness.handlers.get("research:web-view-control")();
  await harness.handlers.get("research:web-view-destroy")();
  assert.deepEqual(received, [
    ["show", {}],
    ["updateBounds", {}],
    ["hide", ""],
    ["control", {}],
    ["destroy", ""],
  ]);
});

test("main injects the research runtime web-view facade into the registrar", async () => {
  const source = await fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/research-web-view-ipc\.cjs"\)/);
  assert.match(
    source,
    /registerResearchWebViewIpcHandlers\(\{\s*ipcMain,\s*webViewFacade:\s*researchRuntime\.webViewFacade,\s*\}\)/,
  );
  assert.doesNotMatch(source, /ipcMain\.handle\("research:web-view-/);
  assert.match(source, /researchRuntime\.destroyWebViews\(\)/);
  assert.match(source, /researchRuntime\.shutdown\(\)/);
});
