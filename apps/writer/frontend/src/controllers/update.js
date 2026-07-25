import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge.js";
import {
  UPDATE_AUTO_CHECK_INTERVAL_MS,
  UPDATE_RESULT_RESET_MS,
  getLastAutoUpdateCheckAt,
  saveLastAutoUpdateCheckAt,
} from "../app-update-policy.js";

export function useUpdateState() {
  return useState({ status: "idle", message: "尚未检查更新" });
}

export function useUpdateFlowRefs() {
  const updateFlowRef = useRef({ active: false, handled: "" });
  const updateResultResetTimerRef = useRef(0);
  return { updateFlowRef, updateResultResetTimerRef };
}

export function useUpdateAutoCheckRef() {
  return useRef(false);
}

export function useClearUpdateResultReset(updateResultResetTimerRef) {
  return useCallback(() => {
    if (!updateResultResetTimerRef.current) {
      return;
    }
    window.clearTimeout(updateResultResetTimerRef.current);
    updateResultResetTimerRef.current = 0;
  }, []);
}

export function useScheduleUpdateResultReset(
  clearUpdateResultReset,
  updateResultResetTimerRef,
  setUpdateState,
) {
  return useCallback((state) => {
    clearUpdateResultReset();
    if (!["none", "dev", "error", "browser"].includes(state?.status)) {
      return;
    }
    updateResultResetTimerRef.current = window.setTimeout(() => {
      updateResultResetTimerRef.current = 0;
      setUpdateState((current) => (
        current?.status === state.status
          ? { status: "idle", message: "尚未检查更新", version: current?.version }
          : current
      ));
    }, UPDATE_RESULT_RESET_MS);
  }, [clearUpdateResultReset]);
}

export function handleUpdateStateEvent(state, {
  clearUpdateResultReset,
  setUpdateState,
  showStatus,
  scheduleUpdateResultReset,
  updateFlowRef,
  updateBridge = bridge,
}) {
  clearUpdateResultReset();
  setUpdateState(state);
  if (state?.message) {
    showStatus(state.message, state.status === "error" ? "warning" : "success");
  }
  scheduleUpdateResultReset(state);
  if (!updateFlowRef.current.active) {
    return;
  }
  if (state?.status === "available" && updateFlowRef.current.handled !== "available") {
    updateFlowRef.current.handled = "available";
    updateBridge.downloadUpdate?.();
    return;
  }
  if (state?.status === "downloaded" && updateFlowRef.current.handled !== "downloaded") {
    updateFlowRef.current.handled = "downloaded";
    updateBridge.installUpdate?.();
    return;
  }
  if (["none", "error", "dev"].includes(state?.status)) {
    updateFlowRef.current = { active: false, handled: state.status };
  }
}

export function useUpdateEventsLifecycle({
  clearUpdateResultReset,
  scheduleUpdateResultReset,
  setUpdateState,
  showStatus,
  updateFlowRef,
}) {
  useEffect(() => {
    let mounted = true;
    bridge.getUpdateState?.().then((state) => {
      if (mounted && state) {
        setUpdateState(state);
        scheduleUpdateResultReset(state);
      }
    });
    const unsubscribe = bridge.onUpdateState?.((state) => {
      handleUpdateStateEvent(state, {
        clearUpdateResultReset,
        setUpdateState,
        showStatus,
        scheduleUpdateResultReset,
        updateFlowRef,
      });
    });
    return () => {
      mounted = false;
      clearUpdateResultReset();
      unsubscribe?.();
    };
  }, [clearUpdateResultReset, scheduleUpdateResultReset, showStatus]);
}

export function useRunUpdateAction({
  clearUpdateResultReset,
  scheduleUpdateResultReset,
  setUpdateState,
  showStatus,
  updateFlowRef,
  updateStatus,
}) {
  return useCallback(async () => {
    clearUpdateResultReset();
    if (updateStatus === "checking" || updateStatus === "downloading") {
      return;
    }
    if (updateStatus === "downloaded") {
      updateFlowRef.current = { active: true, handled: "" };
      updateFlowRef.current.handled = "downloaded";
      await bridge.installUpdate?.();
      return;
    }
    if (updateStatus === "available") {
      updateFlowRef.current = { active: true, handled: "" };
      updateFlowRef.current.handled = "available";
      const state = await bridge.downloadUpdate?.();
      if (state) {
        setUpdateState(state);
      }
      return;
    }
    updateFlowRef.current = { active: false, handled: "" };
    const state = await bridge.checkForUpdates?.();
    if (state) {
      setUpdateState(state);
      showStatus(state.message || "更新检查完成", state.status === "error" ? "warning" : "success");
      if (["none", "error", "dev", "available", "downloaded", "browser"].includes(state.status)) {
        updateFlowRef.current = { active: false, handled: state.status };
      }
      scheduleUpdateResultReset(state);
    }
  }, [clearUpdateResultReset, scheduleUpdateResultReset, showStatus, updateStatus]);
}

export function isAutomaticUpdateCheckThrottled(
  lastCheckedAt,
  now,
  interval = UPDATE_AUTO_CHECK_INTERVAL_MS,
) {
  return Boolean(lastCheckedAt && now - lastCheckedAt < interval);
}

export function useUpdateAutoCheckLifecycle({
  scheduleUpdateResultReset,
  setUpdateState,
  updateAutoCheckedRef,
}) {
  useEffect(() => {
    if (updateAutoCheckedRef.current) {
      return;
    }
    updateAutoCheckedRef.current = true;
    const lastCheckedAt = getLastAutoUpdateCheckAt();
    if (
      lastCheckedAt
      && isAutomaticUpdateCheckThrottled(lastCheckedAt, Date.now())
    ) {
      return;
    }
    saveLastAutoUpdateCheckAt();
    bridge.checkForUpdates?.().then((state) => {
      if (state) {
        setUpdateState(state);
        scheduleUpdateResultReset(state);
      }
    }).catch((error) => {
      bridge.debugLog?.("renderer:update:auto-check:error", { message: error?.message });
    });
  }, [scheduleUpdateResultReset]);
}
