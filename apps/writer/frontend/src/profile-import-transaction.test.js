import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPreparedProfileImport,
} from "./settings/profile-import-transaction.js";

function preparedResult() {
  return {
    ok: true,
    prepared: true,
    transactionToken: "transaction-1",
    preferences: { theme: "imported" },
    templates: { templates: [{ id: "imported" }] },
  };
}

test("prepared profile import applies renderer state before committing main-process config", async () => {
  const calls = [];
  const result = await applyPreparedProfileImport({
    bridge: {
      async commitProfileImport(payload) {
        calls.push(["commit", payload]);
        return { ok: true, committed: true };
      },
      async rollbackProfileImport(payload) {
        calls.push(["rollback", payload]);
        return { ok: true };
      },
    },
    prepared: preparedResult(),
    sections: { preferences: true, templates: true },
    previousPreferences: { theme: "local" },
    previousTemplates: { templates: [{ id: "local" }] },
    async onApplyPreferences(value) {
      calls.push(["preferences", value]);
    },
    async onApplyTemplates(value) {
      calls.push(["templates", value]);
    },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(calls, [
    ["preferences", { theme: "imported" }],
    ["templates", { templates: [{ id: "imported" }] }],
    ["commit", { transactionToken: "transaction-1" }],
  ]);
});

test("renderer template failure discards prepared main config and restores attempted local state", async () => {
  const calls = [];
  let preferences = { theme: "local" };
  let templates = { templates: [{ id: "local" }] };
  await assert.rejects(
    applyPreparedProfileImport({
      bridge: {
        async commitProfileImport() {
          calls.push(["commit"]);
          return { ok: true, committed: true };
        },
        async rollbackProfileImport(payload) {
          calls.push(["rollback", payload]);
          return { ok: true, rolledBack: true };
        },
      },
      prepared: preparedResult(),
      sections: { preferences: true, templates: true },
      previousPreferences: preferences,
      previousTemplates: templates,
      async onApplyPreferences(value) {
        preferences = value;
        calls.push(["preferences", value.theme]);
      },
      async onApplyTemplates(value) {
        templates = value;
        calls.push(["templates", value.templates[0].id]);
        if (value.templates[0].id === "imported") {
          throw new Error("renderer template write failed");
        }
      },
    }),
    /renderer template write failed/,
  );
  assert.deepEqual(preferences, { theme: "local" });
  assert.deepEqual(templates, { templates: [{ id: "local" }] });
  assert.equal(calls.some(([type]) => type === "commit"), false);
  assert.deepEqual(calls.slice(-3), [
    ["rollback", { transactionToken: "transaction-1" }],
    ["templates", "local"],
    ["preferences", "local"],
  ]);
});

test("main commit failure rolls renderer state back in reverse order", async () => {
  const calls = [];
  await assert.rejects(
    applyPreparedProfileImport({
      bridge: {
        async commitProfileImport() {
          calls.push("commit");
          throw new Error("main commit failed");
        },
        async rollbackProfileImport() {
          calls.push("main-rollback");
          return { ok: true };
        },
      },
      prepared: preparedResult(),
      sections: { preferences: true, templates: true },
      previousPreferences: { theme: "local" },
      previousTemplates: { templates: [{ id: "local" }] },
      async onApplyPreferences(value) {
        calls.push(`preferences:${value.theme}`);
      },
      async onApplyTemplates(value) {
        calls.push(`templates:${value.templates[0].id}`);
      },
    }),
    /main commit failed/,
  );
  assert.deepEqual(calls, [
    "preferences:imported",
    "templates:imported",
    "commit",
    "main-rollback",
    "templates:local",
    "preferences:local",
  ]);
});

test("all rollback steps run even if one rollback operation fails", async () => {
  const calls = [];
  await assert.rejects(
    applyPreparedProfileImport({
      bridge: {
        async commitProfileImport() {
          throw new Error("commit failed");
        },
        async rollbackProfileImport() {
          calls.push("main-rollback");
          throw new Error("main rollback failed");
        },
      },
      prepared: preparedResult(),
      sections: { preferences: true, templates: true },
      previousPreferences: { theme: "local" },
      previousTemplates: { templates: [{ id: "local" }] },
      async onApplyPreferences(value) {
        calls.push(`preferences:${value.theme}`);
      },
      async onApplyTemplates(value) {
        calls.push(`templates:${value.templates[0].id}`);
      },
    }),
    /主进程配置回滚：main rollback failed/,
  );
  assert.deepEqual(calls.slice(-3), [
    "main-rollback",
    "templates:local",
    "preferences:local",
  ]);
});
