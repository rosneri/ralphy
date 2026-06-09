import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldChangeForIssue, type TicketAttachment } from "../agent/scaffold";
import type { TrackedIssue } from "@ralphy/tracker";

const BASE_ISSUE: TrackedIssue = {
  id: "test-id",
  identifier: "TST-1",
  title: "Test Issue",
  description: "A test issue description.",
  url: "https://linear.app/test/issue/TST-1",
  state: { name: "Todo", type: "unstarted" },
  assignee: null,
  project: null,
  labels: [],
  priority: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
};

let tempDir: string;
let tasksDir: string;
let statesDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "scaffold-test-"));
  tasksDir = join(tempDir, "openspec", "changes");
  statesDir = join(tempDir, ".ralph", "tasks");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function readProposal(changeName: string): Promise<string> {
  return Bun.file(join(tasksDir, changeName, "proposal.md")).text();
}

async function readTasks(changeName: string): Promise<string> {
  return Bun.file(join(tasksDir, changeName, "tasks.md")).text();
}

describe("scaffoldChangeForIssue — Implementation tasks target tasks.md, not design.md", () => {
  test("the Implementation planning item points the agent at this tasks.md file", async () => {
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE);
    const tasks = await readTasks(name);
    // Prefix preserved for the existing agent.test.ts assertion.
    expect(tasks).toContain("Append an `## Implementation` section");
    // Regression: the instruction must explicitly anchor the section to tasks.md
    // and warn against appending it to design.md (the bug this guards against).
    expect(tasks).toContain("this tasks.md file");
    expect(tasks).toContain("NOT in design.md");
  });

  test("the design.md planning item forbids putting a task checklist in design.md", async () => {
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE);
    const tasks = await readTasks(name);
    expect(tasks).toContain("design.md holds prose and tables ONLY — never a task checklist");
  });
});

describe("scaffoldChangeForIssue — ticket attachments", () => {
  test("no Ticket Attachments section when no attachments provided", async () => {
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE);
    const proposal = await readProposal(name);
    expect(proposal).not.toContain("## Ticket Attachments");
  });

  test("no Ticket Attachments section when empty array provided", async () => {
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE, [], "", []);
    const proposal = await readProposal(name);
    expect(proposal).not.toContain("## Ticket Attachments");
  });

  test("renders Ticket Attachments section with titled link", async () => {
    const attachments: TicketAttachment[] = [
      { url: "https://uploads.linear.app/abc123/wireframe.png", title: "Wireframe" },
    ];
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE, [], "", attachments);
    const proposal = await readProposal(name);
    expect(proposal).toContain("## Ticket Attachments");
    expect(proposal).toContain("- [Wireframe](https://uploads.linear.app/abc123/wireframe.png)");
  });

  test("renders fallback title 'Attachment' when title is null", async () => {
    const attachments: TicketAttachment[] = [
      { url: "https://uploads.linear.app/abc123/img.jpg", title: null },
    ];
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE, [], "", attachments);
    const proposal = await readProposal(name);
    expect(proposal).toContain("- [Attachment](https://uploads.linear.app/abc123/img.jpg)");
  });

  test("renders multiple attachments", async () => {
    const attachments: TicketAttachment[] = [
      { url: "https://uploads.linear.app/abc/img1.png", title: "Screenshot" },
      { url: "https://uploads.linear.app/abc/img2.png", title: null },
      { url: "https://uploads.linear.app/abc/doc.pdf", title: "Spec PDF" },
    ];
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE, [], "", attachments);
    const proposal = await readProposal(name);
    expect(proposal).toContain("## Ticket Attachments");
    expect(proposal).toContain("- [Screenshot](https://uploads.linear.app/abc/img1.png)");
    expect(proposal).toContain("- [Attachment](https://uploads.linear.app/abc/img2.png)");
    expect(proposal).toContain("- [Spec PDF](https://uploads.linear.app/abc/doc.pdf)");
  });

  test("Ticket Attachments section appears before Steering", async () => {
    const attachments: TicketAttachment[] = [
      { url: "https://uploads.linear.app/x/img.png", title: "Image" },
    ];
    const name = await scaffoldChangeForIssue(tasksDir, statesDir, BASE_ISSUE, [], "", attachments);
    const proposal = await readProposal(name);
    const attachmentsIdx = proposal.indexOf("## Ticket Attachments");
    const steeringIdx = proposal.indexOf("## Steering");
    expect(attachmentsIdx).toBeGreaterThan(-1);
    expect(steeringIdx).toBeGreaterThan(-1);
    expect(attachmentsIdx).toBeLessThan(steeringIdx);
  });
});
