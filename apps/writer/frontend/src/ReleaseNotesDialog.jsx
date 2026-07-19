import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { CURRENT_RELEASE_VERSION, RELEASE_NOTES, RELEASE_PHASES } from "./release-notes.js";

function formatReleaseDate(value) {
  return String(value || "").replaceAll("-", ".");
}

function focusableElements(container) {
  return container
    ? [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true")
    : [];
}

function releaseElementId(version) {
  return `release-note-${String(version || "").replaceAll(".", "-")}`;
}

export default function ReleaseNotesDialog({ open, currentVersion, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const scrollRef = useRef(null);
  const phaseRefs = useRef(new Map());
  const releaseRefs = useRef(new Map());
  const scrollFrameRef = useRef(0);
  const latestPhase = RELEASE_PHASES[0];
  const [activePhaseId, setActivePhaseId] = useState(latestPhase?.id || "");
  const [activeMajorVersion, setActiveMajorVersion] = useState(latestPhase?.latestRelease?.scale === "major" ? latestPhase.latestRelease.version : "");
  const displayedVersion = currentVersion || CURRENT_RELEASE_VERSION;

  const syncNavigationToScroll = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !RELEASE_NOTES.length) return;
    const scrollTop = scrollElement.getBoundingClientRect().top;
    const threshold = scrollTop + 32;
    let activePhase = RELEASE_PHASES[0];
    for (const phase of RELEASE_PHASES) {
      const element = phaseRefs.current.get(phase.id);
      if (!element) continue;
      if (element.getBoundingClientRect().top <= threshold) activePhase = phase;
      else break;
    }
    let activeRelease = null;
    for (const release of activePhase?.releases || []) {
      const element = releaseRefs.current.get(release.version);
      if (!element) continue;
      if (element.getBoundingClientRect().top <= threshold) activeRelease = release;
      else break;
    }
    setActivePhaseId(activePhase?.id || "");
    setActiveMajorVersion(activeRelease?.scale === "major" ? activeRelease.version : "");
  }, []);

  const handleTimelineScroll = useCallback(() => {
    if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      syncNavigationToScroll();
    });
  }, [syncNavigationToScroll]);

  const scrollToTarget = useCallback((target, phaseId, majorVersion = "") => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !target) return;
    const scrollRect = scrollElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = Math.max(0, scrollElement.scrollTop + targetRect.top - scrollRect.top - 16);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    setActivePhaseId(phaseId);
    setActiveMajorVersion(majorVersion);
    scrollElement.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  }, []);

  const handlePhaseClick = useCallback((phase) => {
    scrollToTarget(phaseRefs.current.get(phase.id), phase.id, "");
  }, [scrollToTarget]);

  const handleMajorReleaseClick = useCallback((release) => {
    scrollToTarget(releaseRefs.current.get(release.version), release.phaseId, release.version);
  }, [scrollToTarget]);

  useEffect(() => {
    if (!open) return undefined;
    const previousActiveElement = window.document.activeElement;
    setActivePhaseId(latestPhase?.id || "");
    setActiveMajorVersion(latestPhase?.latestRelease?.scale === "major" ? latestPhase.latestRelease.version : "");
    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      closeButtonRef.current?.focus();
      syncNavigationToScroll();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements(dialogRef.current);
      if (!elements.length) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }
      const activeElement = window.document.activeElement;
      const activeIndex = elements.indexOf(activeElement);
      const nextIndex = event.shiftKey
        ? (activeIndex <= 0 ? elements.length - 1 : activeIndex - 1)
        : (activeIndex < 0 || activeIndex === elements.length - 1 ? 0 : activeIndex + 1);
      event.preventDefault();
      elements[nextIndex]?.focus();
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = 0;
      window.document.removeEventListener("keydown", handleKeyDown, true);
      previousActiveElement?.focus?.();
    };
  }, [latestPhase, onClose, open, syncNavigationToScroll]);

  if (!open) return null;

  const firstDate = RELEASE_NOTES[RELEASE_NOTES.length - 1]?.date;
  const latestDate = RELEASE_NOTES[0]?.date;
  const totalMajor = RELEASE_PHASES.reduce((total, phase) => total + phase.majorCount, 0);
  const totalMinor = RELEASE_PHASES.reduce((total, phase) => total + phase.minorCount, 0);
  const content = (
    <div className="release-notes-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="release-notes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
        aria-describedby="release-notes-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="release-notes-header">
          <span className="release-notes-mark" aria-hidden="true"><History size={24} /></span>
          <div className="release-notes-heading">
            <p>JIANJIAN · RELEASE NOTES</p>
            <h2 id="release-notes-title">更新历史</h2>
            <span id="release-notes-description">回看笺间的每一次完善与改变</span>
          </div>
          <div className="release-notes-current" aria-label={`当前版本 ${displayedVersion}`}>
            <span>当前版本</span>
            <strong>V{displayedVersion}</strong>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="release-notes-close"
            onClick={onClose}
            aria-label="关闭更新历史"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>

        <div className="release-notes-body">
          <nav className="release-notes-phase-nav" aria-label="更新阶段">
            <header>
              <span>阶段列表</span>
              <small>{RELEASE_PHASES.length} 个阶段</small>
            </header>
            <div className="release-notes-phase-list">
              {RELEASE_PHASES.map((phase) => {
                const phaseActive = activePhaseId === phase.id;
                return (
                  <section key={phase.id} className={phaseActive ? "active" : undefined}>
                    <button
                      type="button"
                      className="release-notes-phase-button"
                      onClick={() => handlePhaseClick(phase)}
                      aria-current={phaseActive ? "location" : undefined}
                    >
                      <strong>{phase.title}</strong>
                      <span>{phase.versionRange}</span>
                    </button>
                    <div className="release-notes-major-list" aria-label={`${phase.title}的大版本`}>
                      {phase.majorReleases.map((release) => {
                        const releaseActive = activeMajorVersion === release.version;
                        return (
                          <button
                            key={release.version}
                            type="button"
                            className={releaseActive ? "active" : undefined}
                            onClick={() => handleMajorReleaseClick(release)}
                            aria-current={releaseActive ? "location" : undefined}
                            aria-controls={releaseElementId(release.version)}
                          >
                            <span>V{release.version}</span>
                            <small>{release.title}</small>
                          </button>
                        );
                      })}
                    </div>
                    <dl className="release-notes-phase-stats" aria-label={`${phase.title}的版本统计`}>
                      <div className="major">
                        <dt>大版本</dt>
                        <dd><strong>{phase.majorCount}</strong><span>个</span></dd>
                      </div>
                      <div className="minor">
                        <dt>小版本</dt>
                        <dd><strong>{phase.minorCount}</strong><span>个</span></dd>
                      </div>
                    </dl>
                  </section>
                );
              })}
            </div>
          </nav>

          <div ref={scrollRef} className="release-notes-scroll" onScroll={handleTimelineScroll}>
            <div className="release-notes-phase-groups">
              {RELEASE_PHASES.map((phase) => (
                <section
                  key={phase.id}
                  ref={(node) => {
                    if (node) phaseRefs.current.set(phase.id, node);
                    else phaseRefs.current.delete(phase.id);
                  }}
                  className="release-notes-phase-group"
                  aria-labelledby={`release-phase-${phase.id}`}
                >
                  <header className="release-notes-phase-heading">
                    <div>
                      <span>阶段</span>
                      <h3 id={`release-phase-${phase.id}`}>{phase.title}</h3>
                    </div>
                    <p>{phase.versionRange} · {phase.majorCount} 个大版本 · {phase.minorCount} 个小版本</p>
                  </header>
                  <ol className="release-notes-timeline">
                    {phase.releases.map((release) => {
                      const isCurrent = release.version === displayedVersion;
                      return (
                        <li
                          id={releaseElementId(release.version)}
                          key={release.version}
                          ref={(node) => {
                            if (node) releaseRefs.current.set(release.version, node);
                            else releaseRefs.current.delete(release.version);
                          }}
                          className={[isCurrent ? "current" : "", `scale-${release.scale}`].filter(Boolean).join(" ")}
                          data-phase-id={release.phaseId}
                          data-release-scale={release.scale}
                        >
                          <span className="release-notes-track" aria-hidden="true"><i /></span>
                          <article>
                            <header>
                              <div className="release-notes-version-row">
                                <strong>V{release.version}</strong>
                                <span className={`release-notes-scale-badge ${release.scale}`}>{release.scale === "major" ? "大版本" : "小版本"}</span>
                                {isCurrent ? <span className="release-notes-current-badge">当前</span> : null}
                              </div>
                              <time dateTime={release.date}>{formatReleaseDate(release.date)}</time>
                            </header>
                            <h3>{release.title}</h3>
                            <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                          </article>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          </div>
        </div>

        <footer className="release-notes-footer">
          <span>共 {RELEASE_NOTES.length} 个版本 · {RELEASE_PHASES.length} 个阶段 · {totalMajor} 个大版本 / {totalMinor} 个小版本</span>
          <span>{formatReleaseDate(firstDate)} — {formatReleaseDate(latestDate)}</span>
        </footer>
      </section>
    </div>
  );

  return createPortal(content, window.document.body);
}
