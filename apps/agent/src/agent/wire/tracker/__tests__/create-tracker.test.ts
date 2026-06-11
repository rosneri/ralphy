/**
 * `createTracker` selection test (issue #403): the factory is the single
 * `tracker.kind` read — assert each backend comes out with the right
 * capability shape (attachments present on Linear, null on GitHub; synthesized
 * label indicators on GitHub; config indicators on Linear) so downstream code
 * can feature-test instead of branching on kind.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { markersOf } from "@ralphy/types";
import { parseAgentArgs } from "../../../../cli";
import { loadRalphyConfig } from "../../../config";
import { createTracker, type CreateTrackerInput } from "../create-tracker";

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "create-tracker-"));
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function makeInput(workflow: unknown): Promise<CreateTrackerInput> {
  await Bun.write(join(tempDir, "WORKFLOW.md"), `---\n${YAML.stringify(workflow)}---\n`);
  const cfg = await loadRalphyConfig(tempDir);
  const args = await parseAgentArgs([]);
  return {
    cfg,
    args,
    apiKey: "fake-key",
    projectRoot: tempDir,
    useWorktree: false,
    cmdRunner: { run: async () => ({ stdout: "", stderr: "" }) },
    onLog: () => {},
    diag: () => {},
    team: cfg.linear.team,
    assignee: undefined,
    anyAssignee: undefined,
    scope: { requireAllLabels: [] },
    ticketNumbers: [],
    cwdByChange: new Map(),
    stalePingedAt: new Map(),
    lastHandledReviewActivity: new Map(),
    resolvePrUrlForIssue: async () => null,
  };
}

const LINEAR_WORKFLOW = {
  concurrency: 1,
  linear: {
    team: "ENG",
    indicators: {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "Done" },
    },
  },
};

const GITHUB_WORKFLOW = {
  concurrency: 1,
  tracker: { kind: "github" },
  github: { issues: { repo: "owner/repo", label: "ralph" } },
};

describe("createTracker — the single tracker.kind read", () => {
  test("linear: attachments capability present, config indicators, Linear creds gate", async () => {
    const bundle = createTracker(await makeInput(LINEAR_WORKFLOW));
    expect(bundle.tracker.attachments).not.toBeNull();
    expect(bundle.credentialsReady).toBe(true);
    expect(markersOf(bundle.indicators.setDone!)).toEqual([{ type: "status", value: "Done" }]);
  });

  test("github: attachments is null (comment-embedded spec sink instead), synthesized label indicators", async () => {
    const bundle = createTracker(await makeInput(GITHUB_WORKFLOW));
    expect(bundle.tracker.attachments).toBeNull();
    expect(bundle.credentialsReady).toBe(true);
    const done = markersOf(bundle.indicators.setDone!);
    expect(done).toHaveLength(1);
    expect(done[0]!.type).toBe("label");
    // The synthesized todo bucket carries the configured pickup label.
    expect(bundle.indicators.getTodo?.filter).toEqual([{ type: "label", value: "ralph" }]);
  });

  test("github: blockers are advisory (empty refresh), PR links ride the identifier search", async () => {
    const bundle = createTracker(await makeInput(GITHUB_WORKFLOW));
    expect(await bundle.tracker.fetchBlockers("12")).toEqual([]);
  });
});
