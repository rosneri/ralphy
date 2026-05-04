import type { LinearIssue, LinearFilter } from "./linear";
import type { AgentState } from "./state";

export interface IssueUpdater {
  /** Resolve a status name to its workflow-state ID, scoped to the issue's team. */
  resolveStateId: (issue: LinearIssue, stateName: string) => Promise<string | null>;
  postComment: (issue: LinearIssue, body: string) => Promise<void>;
  setState: (issue: LinearIssue, stateId: string) => Promise<void>;
}

export interface CoordinatorDeps {
  fetchIssues: (filter: LinearFilter) => Promise<LinearIssue[]>;
  scaffold: (issue: LinearIssue) => Promise<string>;
  spawnWorker: (
    changeName: string,
    issue: LinearIssue,
  ) => { exited: Promise<number>; kill: () => void };
  loadState: () => Promise<AgentState>;
  saveState: (state: AgentState) => Promise<void>;
  onLog: (text: string, color?: string) => void;
  onWorkersChanged: () => void;
  /** Optional: when present, the coordinator updates the Linear issue on start/exit. */
  updater?: IssueUpdater;
}

interface CoordinatorOptions {
  concurrency: number;
  filter: LinearFilter;
  inProgressStatus?: string | undefined;
  doneStatus?: string | undefined;
  postComments?: boolean | undefined;
}

interface ActiveWorker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  kill: () => void;
}

export class AgentCoordinator {
  private workers: ActiveWorker[] = [];
  private pendingIds = new Set<string>();
  private queue: LinearIssue[] = [];
  private state: AgentState | null = null;
  private stopped = false;

  constructor(
    private readonly deps: CoordinatorDeps,
    private readonly opts: CoordinatorOptions,
  ) {}

  get activeCount(): number {
    return this.workers.length;
  }
  get queuedCount(): number {
    return this.queue.length;
  }
  get activeWorkers(): readonly ActiveWorker[] {
    return this.workers;
  }

  async init(): Promise<void> {
    this.state = await this.deps.loadState();
  }

  async pollOnce(): Promise<{ found: number; added: number }> {
    if (this.stopped) return { found: 0, added: 0 };

    let issues: LinearIssue[];
    try {
      issues = await this.deps.fetchIssues(this.opts.filter);
    } catch (err) {
      this.deps.onLog(`! Linear poll failed: ${(err as Error).message}`, "red");
      return { found: 0, added: 0 };
    }

    const state = this.state!;
    const seen = new Set(state.processedIssueIds);
    const queued = new Set(this.queue.map((i) => i.id));
    const active = new Set(this.workers.map((w) => w.issueId));

    let added = 0;
    for (const issue of issues) {
      if (seen.has(issue.id)) continue;
      if (queued.has(issue.id)) continue;
      if (active.has(issue.id)) continue;
      if (this.pendingIds.has(issue.id)) continue;
      this.queue.push(issue);
      added += 1;
    }

    state.lastPollAt = new Date().toISOString();
    await this.deps.saveState(state);

    this.spawnNext();
    return { found: issues.length, added };
  }

  spawnNext(): void {
    if (this.stopped || !this.state) return;
    while (
      this.workers.length + this.pendingIds.size < this.opts.concurrency &&
      this.queue.length > 0
    ) {
      const issue = this.queue.shift()!;
      this.pendingIds.add(issue.id);
      void this.launchWorker(issue);
    }
  }

  private async launchWorker(issue: LinearIssue): Promise<void> {
    let changeName: string;
    try {
      changeName = await this.deps.scaffold(issue);
    } catch (err) {
      this.pendingIds.delete(issue.id);
      this.deps.onLog(
        `! scaffold failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
      this.spawnNext();
      return;
    }

    if (this.stopped) {
      this.pendingIds.delete(issue.id);
      return;
    }

    this.deps.onLog(`▶ ${issue.identifier} → ${changeName} (worker started)`, "cyan");
    const handle = this.deps.spawnWorker(changeName, issue);
    const worker: ActiveWorker = {
      changeName,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      kill: handle.kill,
    };
    this.workers.push(worker);
    this.pendingIds.delete(issue.id);
    this.deps.onWorkersChanged();

    void this.notifyStarted(issue, changeName);

    void handle.exited.then((code) => {
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) this.workers.splice(idx, 1);
      const ok = code === 0;
      this.deps.onLog(
        `${ok ? "✓" : "✗"} ${issue.identifier} → ${changeName} exited (code ${code})`,
        ok ? "green" : "red",
      );
      if (ok && this.state && !this.state.processedIssueIds.includes(issue.id)) {
        this.state.processedIssueIds.push(issue.id);
        void this.deps.saveState(this.state);
      }
      void this.notifyExited(issue, changeName, code);
      this.deps.onWorkersChanged();
      this.spawnNext();
    });
  }

  private async notifyStarted(issue: LinearIssue, changeName: string): Promise<void> {
    const updater = this.deps.updater;
    if (!updater) return;
    if (this.opts.postComments !== false) {
      try {
        await updater.postComment(
          issue,
          `🤖 Ralph started working on this issue. Tracking change: \`${changeName}\``,
        );
      } catch (err) {
        this.deps.onLog(
          `! Linear comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
      }
    }
    if (this.opts.inProgressStatus) {
      await this.moveIssue(issue, this.opts.inProgressStatus);
    }
  }

  private async notifyExited(issue: LinearIssue, changeName: string, code: number): Promise<void> {
    const updater = this.deps.updater;
    if (!updater) return;
    const ok = code === 0;
    if (this.opts.postComments !== false) {
      const body = ok
        ? `✅ Ralph completed work on this issue. Change: \`${changeName}\``
        : `✗ Ralph exited with code ${code} on this issue. Change: \`${changeName}\``;
      try {
        await updater.postComment(issue, body);
      } catch (err) {
        this.deps.onLog(
          `! Linear comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
      }
    }
    if (ok && this.opts.doneStatus) {
      await this.moveIssue(issue, this.opts.doneStatus);
    }
  }

  private async moveIssue(issue: LinearIssue, stateName: string): Promise<void> {
    const updater = this.deps.updater!;
    try {
      const stateId = await updater.resolveStateId(issue, stateName);
      if (!stateId) {
        this.deps.onLog(
          `! Linear state '${stateName}' not found for ${issue.identifier}`,
          "yellow",
        );
        return;
      }
      await updater.setState(issue, stateId);
      this.deps.onLog(`  → ${issue.identifier} moved to '${stateName}'`, "gray");
    } catch (err) {
      this.deps.onLog(
        `! Linear state move failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
    }
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.workers) {
      try {
        w.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
