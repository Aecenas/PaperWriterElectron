const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { getMinimumWindowSize, installWindowSizePolicy } = require("./window-size-policy.cjs");

test("minimum dimensions use half the available display in DIP", () => {
  for (const [width, height, expected] of [
    [1920, 1040, [960, 520]],
    [1280, 680, [640, 340]],
    [3840, 2120, [1920, 1060]],
    [1365, 729, [683, 365]],
  ]) {
    assert.deepEqual(getMinimumWindowSize({ workAreaSize: { width, height } }), expected);
  }
});

test("moving displays updates limits, grows undersized windows and releases screen listeners", () => {
  const screen = new EventEmitter();
  let display = { workAreaSize: { width: 1920, height: 1040 } };
  screen.getDisplayMatching = () => display;
  const window = new EventEmitter();
  let minimum = [0, 0];
  let size = [800, 450];
  let maximized = false;
  Object.assign(window, {
    isDestroyed: () => false,
    isMaximized: () => maximized,
    isFullScreen: () => false,
    isMinimized: () => false,
    getBounds: () => ({ x: 0, y: 0, width: size[0], height: size[1] }),
    getMinimumSize: () => minimum,
    setMinimumSize: (...value) => { minimum = value; },
    getSize: () => size,
    setSize: (...value) => { size = value; },
  });
  installWindowSizePolicy(window, screen);
  assert.deepEqual(size, [960, 520]);
  display = { workAreaSize: { width: 1280, height: 680 } };
  window.emit("move");
  assert.deepEqual(minimum, [640, 340]);
  assert.deepEqual(size, [960, 520]);
  maximized = true;
  display = { workAreaSize: { width: 3840, height: 2120 } };
  screen.emit("display-metrics-changed");
  assert.deepEqual(minimum, [1920, 1060]);
  assert.deepEqual(size, [960, 520]);
  maximized = false;
  window.emit("unmaximize");
  assert.deepEqual(size, [1920, 1060]);
  window.emit("closed");
  for (const event of ["display-metrics-changed", "display-added", "display-removed"]) {
    assert.equal(screen.listenerCount(event), 0);
  }
});
