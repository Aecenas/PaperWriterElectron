import {
  DEFAULT_WRITING_ASSISTANCE_CONFIG,
  applyReplacementTransaction,
  changedRangesFromTransaction,
  issueIntersectsRanges,
  mapWritingIssue,
  normalizeWritingAssistanceConfig,
  rangesForAffectedBlocks,
  scanWritingIssues,
} from "./model.js";
import { publishWritingIssues } from "./extension.js";

function visibleIssues(issues, ignored) {
  return issues.filter((issue) => !ignored.has(issue.id));
}

export class WritingAssistanceSession {
  constructor({
    editorId = "",
    config = DEFAULT_WRITING_ASSISTANCE_CONFIG,
    onIssuesChange,
    debounceMs = 120,
  } = {}) {
    this.editorId = String(editorId || "");
    this.config = normalizeWritingAssistanceConfig(config);
    this.onIssuesChange = typeof onIssuesChange === "function" ? onIssuesChange : null;
    this.debounceMs = Math.max(0, Number(debounceMs) || 0);
    this.editor = null;
    this.issues = [];
    this.ignored = new Set();
    this.pendingTimer = null;
    this.handleTransaction = this.handleTransaction.bind(this);
  }

  attach(editor) {
    if (this.editor === editor) return this;
    this.detach();
    this.editor = editor || null;
    this.editor?.on?.("transaction", this.handleTransaction);
    this.rescan();
    return this;
  }

  detach() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.editor?.off?.("transaction", this.handleTransaction);
    this.editor = null;
    this.issues = [];
    this.ignored.clear();
  }

  setConfig(config) {
    this.config = normalizeWritingAssistanceConfig(config);
    this.ignored.clear();
    return this.rescan();
  }

  resetDocument() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.issues = [];
    this.ignored.clear();
    return this.rescan();
  }

  handleTransaction({ transaction } = {}) {
    if (!transaction?.docChanged) return;
    const mappedIgnored = new Set();
    const mappedIssues = this.issues.map((issue) => {
      const mapped = mapWritingIssue(issue, transaction.mapping);
      if (mapped && this.ignored.has(issue.id)) mappedIgnored.add(mapped.id);
      return mapped;
    }).filter(Boolean);
    this.issues = mappedIssues;
    this.ignored = mappedIgnored;

    const changedRanges = changedRangesFromTransaction(transaction);
    const affectedRanges = rangesForAffectedBlocks(transaction.doc, changedRanges);
    this.issues = this.issues.filter((issue) => !issueIntersectsRanges(issue, affectedRanges));

    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    const scan = () => {
      this.pendingTimer = null;
      if (!this.editor || this.editor.isDestroyed) return;
      const incremental = scanWritingIssues({
        doc: this.editor.state.doc,
        config: this.config,
        ranges: affectedRanges,
      });
      this.issues = [...this.issues, ...incremental].sort((left, right) => left.from - right.from);
      this.publish();
    };
    if (this.debounceMs > 0) this.pendingTimer = setTimeout(scan, this.debounceMs);
    else scan();
  }

  rescan() {
    if (!this.editor || this.editor.isDestroyed) {
      this.issues = [];
      this.publish();
      return [];
    }
    this.issues = scanWritingIssues({
      doc: this.editor.state.doc,
      config: this.config,
    });
    this.publish();
    return this.getIssues();
  }

  publish() {
    const current = this.getIssues();
    publishWritingIssues(this.editor, current);
    this.onIssuesChange?.(current, {
      editorId: this.editorId,
      total: this.issues.length,
      ignored: this.ignored.size,
    });
  }

  getIssues({ includeIgnored = false } = {}) {
    return includeIgnored ? [...this.issues] : visibleIssues(this.issues, this.ignored);
  }

  ignoreOnce(issueId) {
    const issue = this.issues.find((candidate) => candidate.id === issueId);
    if (!issue) return false;
    this.ignored.add(issue.id);
    this.publish();
    return true;
  }

  jumpTo(issueId) {
    const issue = this.issues.find((candidate) => candidate.id === issueId);
    if (!issue || !this.editor) return false;
    return this.editor.chain().focus().setTextSelection({ from: issue.from, to: issue.to }).scrollIntoView().run();
  }

  replaceOnce(issueId) {
    const issue = this.issues.find((candidate) => candidate.id === issueId);
    return issue ? applyReplacementTransaction(this.editor, [issue]) : false;
  }

  replaceAll(issueId) {
    const selected = this.issues.find((candidate) => candidate.id === issueId);
    if (!selected) return false;
    const matching = this.issues.filter((issue) => (
      issue.ruleId === selected.ruleId
      && issue.actual === selected.actual
      && issue.preferred === selected.preferred
    ));
    return applyReplacementTransaction(this.editor, matching);
  }
}

export function createWritingAssistanceSession(options) {
  return new WritingAssistanceSession(options);
}
