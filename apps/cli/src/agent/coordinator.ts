import type { LinearIssue, LinearFilter } from "./linear";
import type { AgentState } from "./state";

export interface IssueUpdater {
  /** Resolve a status name to its workflow-state ID, scoped to the issue's team. */
  resolveStateId: (issue: LinearIssue, stateName: string) => Promise<string | null>;
  postComment: (issue: LinearIssue, body: string) => Promise<void>;
  setState: (issue: LinearIssue, stateId: string) => Promise<void>;
  /** Resolve a label name to its label ID, scoped to the issue's team. */
  resolveLabelId?: (issue: LinearIssue, labelName: string) => Promise<string | null>;
  addLabel?: (issue: LinearIssue, labelId: string) => Promise<void>;
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
  /** Optional: returns the current iteration count for an active worker.
   *  Used to drive periodic progress comments on the Linear issue. */
  getIterationCount?: (changeName: string) => Promise<number>;
}

interface CoordinatorOptions {
  concurrency: number;
  filter: LinearFilter;
  inProgressStatus?: string | undefined;
  doneStatus?: string | undefined;
  /** Label to add to the issue on successful completion. */
  doneLabel?: string | undefined;
  postComments?: boolean | undefined;
  /** Post a progress comment every N task iterations (0 disables). */
  commentEveryIterations?: number | undefined;
}

interface ActiveWorker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  issue: LinearIssue;
  kill: () => void;
  /** Highest iteration count we've already posted a progress comment for. */
  lastReportedIteration: number;
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
    await this.reportProgress();
    return { found: issues.length, added };
  }

  private async reportProgress(): Promise<void> {
    const updater = this.deps.updater;
    const everyN = this.opts.commentEveryIterations ?? 0;
    if (
      everyN <= 0 ||
      !updater ||
      this.opts.postComments === false ||
      !this.deps.getIterationCount
    ) {
      return;
    }
    for (const w of this.workers) {
      let count: number;
      try {
        count = await this.deps.getIterationCount(w.changeName);
      } catch (err) {
        this.deps.onLog(
          `! iteration count read failed for ${w.issueIdentifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      if (count < everyN) continue;
      const currMilestone = Math.floor(count / everyN);
      const lastMilestone = Math.floor(w.lastReportedIteration / everyN);
      if (currMilestone <= lastMilestone) continue;
      try {
        await updater.postComment(
          w.issue,
          `🔄 Ralph progress update: iteration ${count} on \`${w.changeName}\``,
        );
        w.lastReportedIteration = count;
      } catch (err) {
        this.deps.onLog(
          `! Linear progress comment failed for ${w.issueIdentifier}: ${(err as Error).message}`,
          "red",
        );
      }
    }
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
      issue,
      kill: handle.kill,
      lastReportedIteration: 0,
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
    if (ok && this.opts.doneLabel) {
      await this.tagIssue(issue, this.opts.doneLabel);
    }
  }

  private async tagIssue(issue: LinearIssue, labelName: string): Promise<void> {
    const updater = this.deps.updater!;
    if (!updater.resolveLabelId || !updater.addLabel) {
      this.deps.onLog(
        `! Linear updater does not support labels (cannot tag ${issue.identifier} with '${labelName}')`,
        "yellow",
      );
      return;
    }
    try {
      const labelId = await updater.resolveLabelId(issue, labelName);
      if (!labelId) {
        this.deps.onLog(
          `! Linear label '${labelName}' not found for ${issue.identifier}`,
          "yellow",
        );
        return;
      }
      await updater.addLabel(issue, labelId);
      this.deps.onLog(`  → ${issue.identifier} tagged with '${labelName}'`, "gray");
    } catch (err) {
      this.deps.onLog(
        `! Linear label add failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
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
