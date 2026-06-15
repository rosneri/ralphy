/**
 * `@ralphy/codehost/testing` — in-memory {@link CodeHost} fake. Orchestration
 * tests (coordinator, post-task, comment-sync) script PR states and CI buckets
 * here instead of replaying `gh` CLI transcripts.
 */

import type {
  CiStatus,
  CodeHost,
  CreatePullRequestOptions,
  MergeStrategy,
  PullRequestDetails,
  PullRequestState,
} from "./types";

export interface FakeCodeHostCall {
  method: keyof CodeHost;
  args: unknown[];
}

export interface FakeCodeHost extends CodeHost {
  /** Every port call in order, for assertions. */
  readonly calls: FakeCodeHostCall[];
  /** Script the state returned for a PR URL (default "open"). */
  setPullRequestState(url: string, state: PullRequestState): void;
  /** Script the richer details probe for a PR URL. Any omitted field falls
   *  back to a sensible default (scripted/`"open"` state, empty branch/title,
   *  the URL itself). */
  setPullRequestDetails(url: string, details: Partial<PullRequestDetails>): void;
  /** Script the checks status for a PR ref (default all-pass). */
  setChecksStatus(prRef: string, status: CiStatus): void;
  /** Script the open PR URL returned for a branch (default: the PR created
   *  through the port for that branch, else null). */
  setOpenPullRequestForBranch(branch: string, url: string): void;
  /** Script repo auto-merge capability for a PR URL (default null). */
  setAutoMergeAllowed(prUrl: string, allowed: boolean | null): void;
  /** Script the HEAD SHA returned by {@link CodeHost.headSha} (default "HEAD"). */
  setHeadSha(sha: string): void;
  /** Script {@link CodeHost.isAncestor} (default true). */
  setIsAncestor(value: boolean): void;
  /** Script the file list returned by {@link CodeHost.changedFiles} for a diff
   *  range (default []). */
  setChangedFiles(range: string, files: string[]): void;
  /** Script the raw `git status --porcelain` output (default ""). */
  setWorkingTreeStatus(status: string): void;
  /** Script the commit count returned by {@link CodeHost.countCommitsAhead} for
   *  a range (default 0). */
  setCommitsAhead(range: string, count: number): void;
  /** PRs created through the port, keyed by branch. */
  readonly createdByBranch: Map<string, { url: string; options: CreatePullRequestOptions }>;
  /** Auto-merge enablements, ready transitions, and merges by URL. */
  readonly autoMergeEnabled: Map<string, MergeStrategy>;
  readonly readied: Set<string>;
  readonly merged: Map<string, MergeStrategy>;
}

const PASS: CiStatus = { bucket: "pass", failedRunIds: [], failedCheckNames: [] };

export function createFakeCodeHost(): FakeCodeHost {
  const calls: FakeCodeHostCall[] = [];
  const stateByUrl = new Map<string, PullRequestState>();
  const detailsByUrl = new Map<string, Partial<PullRequestDetails>>();
  const checksByRef = new Map<string, CiStatus>();
  const openPrByBranch = new Map<string, string>();
  const autoMergeByUrl = new Map<string, boolean | null>();
  const changedFilesByRange = new Map<string, string[]>();
  const commitsAheadByRange = new Map<string, number>();
  let headShaValue = "HEAD";
  let isAncestorValue = true;
  let workingTreeStatusValue = "";
  const createdByBranch = new Map<string, { url: string; options: CreatePullRequestOptions }>();
  const autoMergeEnabled = new Map<string, MergeStrategy>();
  const readied = new Set<string>();
  const merged = new Map<string, MergeStrategy>();
  let prCounter = 0;

  return {
    calls,
    createdByBranch,
    autoMergeEnabled,
    readied,
    merged,
    setPullRequestState(url, state) {
      stateByUrl.set(url, state);
    },
    setPullRequestDetails(url, details) {
      detailsByUrl.set(url, details);
    },
    setChecksStatus(prRef, status) {
      checksByRef.set(prRef, status);
    },
    setOpenPullRequestForBranch(branch, url) {
      openPrByBranch.set(branch, url);
    },
    setAutoMergeAllowed(prUrl, allowed) {
      autoMergeByUrl.set(prUrl, allowed);
    },
    setHeadSha(sha) {
      headShaValue = sha;
    },
    setIsAncestor(value) {
      isAncestorValue = value;
    },
    setChangedFiles(range, files) {
      changedFilesByRange.set(range, files);
    },
    setWorkingTreeStatus(status) {
      workingTreeStatusValue = status;
    },
    setCommitsAhead(range, count) {
      commitsAheadByRange.set(range, count);
    },
    async getPullRequestState(url) {
      calls.push({ method: "getPullRequestState", args: [url] });
      return stateByUrl.get(url) ?? "open";
    },
    async getPullRequestDetails(url) {
      calls.push({ method: "getPullRequestDetails", args: [url] });
      const scripted = detailsByUrl.get(url) ?? {};
      return {
        state: scripted.state ?? stateByUrl.get(url) ?? "open",
        headRefName: scripted.headRefName ?? "",
        title: scripted.title ?? "",
        url: scripted.url ?? url,
      };
    },
    async getChecksStatus(prRef) {
      calls.push({ method: "getChecksStatus", args: [prRef] });
      return checksByRef.get(prRef) ?? PASS;
    },
    async createPullRequest(options) {
      calls.push({ method: "createPullRequest", args: [options] });
      const existing = createdByBranch.get(options.branch);
      if (existing) return existing.url;
      prCounter += 1;
      const url = `https://github.com/fake/repo/pull/${prCounter}`;
      createdByBranch.set(options.branch, { url, options });
      stateByUrl.set(url, "open");
      return url;
    },
    async findOpenPullRequestForBranch(branch) {
      calls.push({ method: "findOpenPullRequestForBranch", args: [branch] });
      return openPrByBranch.get(branch) ?? createdByBranch.get(branch)?.url ?? null;
    },
    async isAutoMergeAllowed(prUrl) {
      calls.push({ method: "isAutoMergeAllowed", args: [prUrl] });
      return autoMergeByUrl.has(prUrl) ? (autoMergeByUrl.get(prUrl) ?? null) : null;
    },
    async markReady(url) {
      calls.push({ method: "markReady", args: [url] });
      readied.add(url);
    },
    async enableAutoMerge(url, strategy) {
      calls.push({ method: "enableAutoMerge", args: [url, strategy] });
      autoMergeEnabled.set(url, strategy);
    },
    async merge(url, strategy) {
      calls.push({ method: "merge", args: [url, strategy] });
      merged.set(url, strategy);
      stateByUrl.set(url, "merged");
    },
    async headSha(cwd) {
      calls.push({ method: "headSha", args: [cwd] });
      return headShaValue;
    },
    async isAncestor(ancestor, descendant, cwd) {
      calls.push({ method: "isAncestor", args: [ancestor, descendant, cwd] });
      return isAncestorValue;
    },
    async fetchBranch(branch, cwd) {
      calls.push({ method: "fetchBranch", args: [branch, cwd] });
    },
    async pullBranch(branch, cwd) {
      calls.push({ method: "pullBranch", args: [branch, cwd] });
    },
    async abortMerge(cwd) {
      calls.push({ method: "abortMerge", args: [cwd] });
    },
    async changedFiles(range, cwd) {
      calls.push({ method: "changedFiles", args: [range, cwd] });
      return changedFilesByRange.get(range) ?? [];
    },
    async workingTreeStatus(cwd) {
      calls.push({ method: "workingTreeStatus", args: [cwd] });
      return workingTreeStatusValue;
    },
    async countCommitsAhead(range, cwd) {
      calls.push({ method: "countCommitsAhead", args: [range, cwd] });
      return commitsAheadByRange.get(range) ?? 0;
    },
  };
}
