import type { LinearIssue } from "../../src/shared/capabilities/linear-client";
import type { IssueTrackerProvider } from "@ralphy/tracker";
import type { CoordinatorDeps } from "../../src/runtime/coordinator";

export type { LinearIssue };

/** One scripted engine turn played back by `scripted-engine.ts`. */
export interface ScenarioStep {
  kind: "message" | "tool_call" | "tool_result" | "diff" | "exit";
  payload: unknown;
}

/** Seed data for a Linear issue used by `FakeLinear.seed`. */
export interface SeedIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string;
  state?: { name: string; type: string };
  labels?: string[];
  priority?: number;
  createdAt?: string;
  blockedByIds?: string[];
  project?: { id: string; name: string } | null;
  assignee?: { id: string; email: string | null; name: string } | null;
  /** Initial comments seeded onto the issue. Honored by `comment` markers. */
  comments?: { body: string; author?: string }[];
}

export interface FakeLinearComment {
  body: string;
  author: string;
  at: Date;
  source?: "linear" | "github" | "github-review";
}

export interface AppliedLog {
  setInProgress: string[];
  setDone: string[];
  setPrReady: string[];
  setError: string[];
  clearReview: string[];
}

/**
 * Back-compat alias for the promoted {@link IssueTrackerProvider} interface
 * (RLF-223 M1). `FakeLinear` implements this; the canonical method bag now
 * lives in `@ralphy/tracker`.
 */
export type LinearClientLike = IssueTrackerProvider;

export interface HarnessCtx {
  coordDeps: CoordinatorDeps;
  linear: {
    client: LinearClientLike;
    applied: AppliedLog;
    seed: (issue: SeedIssue) => LinearIssue;
    setLabels: (id: string, labels: string[]) => void;
    setStatus: (id: string, name: string, type: string) => void;
    pushComment: (issueId: string, body: string, author?: string) => void;
    pushMention: (
      issueId: string,
      source: "linear" | "github" | "github-review",
      body: string,
      at: Date,
    ) => void;
    comments: (issueId: string) => readonly FakeLinearComment[];
    issues: () => readonly LinearIssue[];
  };
  runWorkerToCompletion: () => Promise<void>;
  cleanup: () => Promise<void>;
}
