import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseElectronDocumentContextMenu,
  installElectronDocumentContextMenuBridge,
} from "./editor/document-context-menu-bridge.js";

test("Electron document context requests are routed only to their canvas", () => {
  let listener = null;
  let disposed = false;
  const inside = {};
  const outside = {};
  const canvas = {
    contains: (target) => target === inside,
  };
  const received = [];
  const bridge = {
    isElectron: true,
    onDocumentContextMenuRequest(callback) {
      listener = callback;
      return () => { disposed = true; };
    },
  };
  const dispose = installElectronDocumentContextMenuBridge({
    bridge,
    documentObject: {
      elementFromPoint: (x) => (x < 500 ? inside : outside),
    },
    getCanvas: () => canvas,
    onContextMenu: (event) => received.push(event),
  });

  listener({ x: 40.4, y: 80.6 });
  listener({ x: 500, y: 80 });
  listener({ x: 700, y: 80 });
  listener({ x: "invalid", y: 80 });

  assert.equal(received.length, 1);
  assert.equal(received[0].clientX, 40);
  assert.equal(received[0].clientY, 81);
  assert.equal(received[0].target, inside);
  assert.equal(received[0].currentTarget, canvas);
  assert.doesNotThrow(() => {
    received[0].preventDefault();
    received[0].stopPropagation();
  });
  dispose();
  assert.equal(disposed, true);
});

test("browser canvases keep their direct DOM context menu path", () => {
  assert.equal(canUseElectronDocumentContextMenu(null), false);
  assert.equal(canUseElectronDocumentContextMenu({ isElectron: false }), false);
  assert.equal(canUseElectronDocumentContextMenu({ isElectron: true }), false);
  assert.equal(canUseElectronDocumentContextMenu({
    isElectron: true,
    onDocumentContextMenuRequest() {},
  }), true);
});
