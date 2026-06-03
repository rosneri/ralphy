import type { LinearIssue } from "../../src/shared/capabilities/linear-client";
import type { SetIndicator } from "@ralphy/types";
import type { CoordinatorDeps, MentionTrigger } from "../../src/runtime/coordinator";

export type { LinearIssue, SetIndicator };

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

export interface LinearClientLike {
  fetchTodo(): Promise<LinearIssue[]>;
  fetchInProgress(): Promise<LinearIssue[]>;
  fetchReview(): Promise<LinearIssue[]>;
  fetchMentions(): Promise<{ issue: LinearIssue; trigger: MentionTrigger }[]>;
  fetchDoneCandidates(): Promise<LinearIssue[]>;
  fetchComments(issueId: string): Promise<{ body: string }[]>;
  applyIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void>;
  removeIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void>;
  postComment(issue: LinearIssue, body: string): Promise<void>;
}

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
