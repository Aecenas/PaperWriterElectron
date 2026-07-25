import { createBrowserAiApi } from "./browser-bridge/ai-runtime.js";
import { createBrowserDocumentWorkspaceApi } from "./browser-bridge/document-workspace.js";
import { createBrowserResearchApi } from "./browser-bridge/research-runtime.js";
import { createBrowserWindowApi } from "./browser-bridge/window-runtime.js";

const browserBridge = {
  isElectron: false,
  ...createBrowserWindowApi(),
  ...createBrowserAiApi(),
  ...createBrowserDocumentWorkspaceApi(),
  ...createBrowserResearchApi(),
};

export { browserBridge };
export const bridge = globalThis.window?.paperWriter ?? browserBridge;
