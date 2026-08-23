import assert from "node:assert/strict";
import test from "node:test";
import { copySelectionAiPlainText } from "./selection-ai/clipboard.js";

test("selection AI native copy writes only the selected plain text MIME", () => {
  const anchorNode = {};
  const focusNode = {};
  const writes = [];
  let prevented = false;
  let cleared = false;
  const event = {
    currentTarget: {
      contains(node) {
        return node === anchorNode || node === focusNode;
      },
    },
    clipboardData: {
      clearData() {
        cleared = true;
      },
      setData(type, value) {
        writes.push([type, value]);
      },
    },
    preventDefault() {
      prevented = true;
    },
  };
  const selection = {
    anchorNode,
    focusNode,
    isCollapsed: false,
    toString: () => "确认后触发\n第二段",
  };

  assert.equal(copySelectionAiPlainText(event, selection), true);
  assert.equal(prevented, true);
  assert.equal(cleared, true);
  assert.deepEqual(writes, [["text/plain", "确认后触发\n第二段"]]);
});

test("selection AI copy leaves unrelated and collapsed selections untouched", () => {
  const insideNode = {};
  const outsideNode = {};
  let prevented = false;
  const event = {
    currentTarget: { contains: (node) => node === insideNode },
    clipboardData: { setData: () => assert.fail("must not write") },
    preventDefault: () => { prevented = true; },
  };

  assert.equal(copySelectionAiPlainText(event, {
    anchorNode: insideNode,
    focusNode: outsideNode,
    isCollapsed: false,
    toString: () => "outside",
  }), false);
  assert.equal(copySelectionAiPlainText(event, {
    anchorNode: insideNode,
    focusNode: insideNode,
    isCollapsed: true,
    toString: () => "",
  }), false);
  assert.equal(prevented, false);
});
