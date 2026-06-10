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
  /** Script the checks status for a PR ref (default all-pass). */
  setChecksStatus(prRef: string, status: CiStatus): void;
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
  const checksByRef = new Map<string, CiStatus>();
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
    setChecksStatus(prRef, status) {
      checksByRef.set(prRef, status);
    },
    async getPullRequestState(url) {
      calls.push({ method: "getPullRequestState", args: [url] });
      return stateByUrl.get(url) ?? "open";
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
  };
}
