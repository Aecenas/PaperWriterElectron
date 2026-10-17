export function connectExternalDocumentRequests({
  requestPort,
  openDocumentPath,
  onError,
}) {
  if (typeof requestPort.takeExternalDocumentRequests !== "function"
    || typeof requestPort.onExternalDocumentRequest !== "function") {
    return { ready: Promise.resolve(), dispose() {} };
  }
  let disposed = false;
  let requested = false;
  let inFlight = null;

  const drain = () => {
    requested = true;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      while (requested && !disposed) {
        requested = false;
        const requests = await requestPort.takeExternalDocumentRequests();
        for (const request of requests || []) {
          if (disposed) return;
          try {
            if (request.error) throw new Error(request.error);
            await openDocumentPath(request.path);
          } catch (error) {
            onError(error);
          }
        }
      }
    })().catch(onError).finally(() => {
      inFlight = null;
      if (requested && !disposed) void drain();
    });
    return inFlight;
  };

  // Subscribe before pulling, so a new OS request during the pull is not lost.
  const unsubscribe = requestPort.onExternalDocumentRequest(drain);
  return {
    ready: drain(),
    dispose() {
      disposed = true;
      unsubscribe?.();
    },
  };
}
