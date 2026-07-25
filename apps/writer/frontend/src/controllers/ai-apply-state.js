import { useState } from "react";

export function useAiApplyState() {
  const [applyingAiBlockIndex, setApplyingAiBlockIndex] = useState(-1);
  const [
    manualFallbackAiBlockIndexes,
    setManualFallbackAiBlockIndexes,
  ] = useState([]);
  const [manualAiApply, setManualAiApply] = useState(null);
  const [aiApplyPreview, setAiApplyPreview] = useState(null);

  return {
    aiApplyPreview,
    applyingAiBlockIndex,
    manualAiApply,
    manualFallbackAiBlockIndexes,
    setAiApplyPreview,
    setApplyingAiBlockIndex,
    setManualAiApply,
    setManualFallbackAiBlockIndexes,
  };
}
