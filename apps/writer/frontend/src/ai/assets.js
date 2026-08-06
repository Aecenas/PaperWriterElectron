import { AI_PROVIDER_ICON_ASSETS } from "../ai-settings/provider-icons.js";

export const AI_ASSETS = Object.freeze({
  aiEmptyMark: new URL("../assets/icons/jianjian-ai-empty.png", import.meta.url).href,
  aiComposerMark: new URL("../assets/icons/jianjian-ai-composer.png", import.meta.url).href,
  ...AI_PROVIDER_ICON_ASSETS,
});
