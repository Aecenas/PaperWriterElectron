const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createUnresponsiveCloseGuard,
} = require("./unresponsive-close-guard.cjs");

function createHarness({ response = 0 } = {}) {
  const timers = new Map();
  const prompts = [];
  const logs = [];
  let timerId = 0;
  let closePending = false;
  let forceCloseCount = 0;
  const window = { isDestroyed: () => false };
  const guard = createUnresponsiveCloseGuard({
    getWindow: () => window,
    isCloseRequestInFlight: () => closePending,
    showMessageBox: async (_window, options) => {
      prompts.push(options);
      return { response };
    },
    forceClose: () => { forceCloseCount += 1; },
    writeDebugLog: async (event) => { logs.push(event); },
    graceMs: 25,
    setTimer(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  });
  return {
    guard,
    logs,
    prompts,
    timers,
    forceCloseCount: () => forceCloseCount,
    setClosePending(value) { closePending = value; },
    async runNextTimer() {
      const [id, callback] = timers.entries().next().value || [];
      if (!callback) return false;
      timers.delete(id);
      await callback();
      return true;
    },
  };
}

test("an unresponsive renderer receives a grace period only after close is requested", async () => {
  const harness = createHarness();
  harness.guard.markUnresponsive();
  assert.equal(harness.timers.size, 0);

  harness.setClosePending(true);
  harness.guard.closeRequested();
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.prompts.length, 0);

  await harness.runNextTimer();
  assert.equal(harness.prompts.length, 1);
  assert.deepEqual(harness.prompts[0].buttons, ["继续等待", "强制退出"]);
  assert.equal(harness.forceCloseCount(), 0);
  assert.equal(harness.timers.size, 1, "waiting schedules another full grace period");
});

test("becoming responsive or canceling close retires the grace timer", () => {
  const harness = createHarness();
  harness.setClosePending(true);
  harness.guard.markUnresponsive();
  assert.equal(harness.timers.size, 1);

  harness.guard.markResponsive();
  assert.equal(harness.timers.size, 0);

  harness.guard.markUnresponsive();
  harness.setClosePending(false);
  harness.guard.closeSettled();
  assert.equal(harness.timers.size, 0);
});

test("force exit is explicit and still requires an active unresponsive close request", async () => {
  const harness = createHarness({ response: 1 });
  harness.setClosePending(true);
  harness.guard.markUnresponsive();
  await harness.runNextTimer();
  assert.equal(harness.forceCloseCount(), 1);
  assert.deepEqual(harness.logs, ["renderer:unresponsive-close:forced"]);

  const recovered = createHarness({ response: 1 });
  recovered.setClosePending(true);
  recovered.guard.markUnresponsive();
  recovered.guard.markResponsive();
  await recovered.runNextTimer();
  assert.equal(recovered.forceCloseCount(), 0);
});
