import { describe, expect, test } from "bun:test";
import { fetchPrStatus, type PrStatusOk } from "../pr-status";
import type { CmdRunner } from "../agent/pr";

interface ResponseSpec {
  stdout?: string;
  stderr?: string;
  throw?: boolean;
}

function makeRunner(spec: ResponseSpec): CmdRunner {
  return {
    run: async (_cmd, _cwd) => {
      if (spec.throw) {
        const err = new Error("gh failed") as Error & { stderr?: string };
        err.stderr = spec.stderr ?? "";
        throw err;
      }
      return { stdout: spec.stdout ?? "", stderr: spec.stderr ?? "" };
    },
  };
}

function ghJson(payload: unknown): ResponseSpec {
  return { stdout: JSON.stringify(payload) };
}

describe("fetchPrStatus", () => {
  test("maps a clean open PR with passing checks", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        isDraft: false,
        mergeable: "MERGEABLE",
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
        autoMergeRequest: null,
        createdAt: "2026-05-01T10:00:00Z",
      }),
    );
    const r = (await fetchPrStatus("https://gh/foo/bar/pull/1", runner, "/wt")) as PrStatusOk;
    expect(r.kind).toBe("ok");
    expect(r.state).toBe("OPEN");
    expect(r.mergeable).toBe("MERGEABLE");
    expect(r.ciBucket).toBe("pass");
    expect(r.autoMergeEnabled).toBe(false);
    expect(r.createdAt).toBe("2026-05-01T10:00:00Z");
  });

  test("ciBucket=fail when any check failed", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        mergeable: "MERGEABLE",
        statusCheckRollup: [
          { status: "COMPLETED", conclusion: "SUCCESS" },
          { status: "COMPLETED", conclusion: "FAILURE" },
        ],
      }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.ciBucket).toBe("fail");
  });

  test("ciBucket=pending when any check is in progress", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        mergeable: "MERGEABLE",
        statusCheckRollup: [
          { status: "COMPLETED", conclusion: "SUCCESS" },
          { status: "IN_PROGRESS" },
        ],
      }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.ciBucket).toBe("pending");
  });

  test("ciBucket=pending when statusCheckRollup is null on an open PR", async () => {
    const runner = makeRunner(
      ghJson({ state: "OPEN", mergeable: "MERGEABLE", statusCheckRollup: null }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.ciBucket).toBe("pending");
  });

  test("ciBucket=pass when statusCheckRollup empty on a merged PR", async () => {
    const runner = makeRunner(
      ghJson({ state: "MERGED", mergeable: "UNKNOWN", statusCheckRollup: [] }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.ciBucket).toBe("pass");
    expect(r.state).toBe("MERGED");
  });

  test("legacy commit-status shape with state=PENDING is treated as pending", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        mergeable: "MERGEABLE",
        statusCheckRollup: [{ state: "SUCCESS" }, { state: "PENDING" }],
      }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.ciBucket).toBe("pending");
  });

  test("mergeable=CONFLICTING is preserved", async () => {
    const runner = makeRunner(
      ghJson({ state: "OPEN", mergeable: "CONFLICTING", statusCheckRollup: [] }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.mergeable).toBe("CONFLICTING");
  });

  test("mergeable=UNKNOWN is preserved", async () => {
    const runner = makeRunner(
      ghJson({ state: "OPEN", mergeable: "UNKNOWN", statusCheckRollup: [] }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.mergeable).toBe("UNKNOWN");
  });

  test("autoMergeEnabled=true when autoMergeRequest is present", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
        autoMergeRequest: { enabledAt: "2026-01-01T00:00:00Z" },
      }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.autoMergeEnabled).toBe(true);
  });

  test("autoMergeEnabled=false when autoMergeRequest is null", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
        autoMergeRequest: null,
      }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.autoMergeEnabled).toBe(false);
  });

  test("returns error sentinel on gh failure (uses first stderr line)", async () => {
    const runner = makeRunner({
      throw: true,
      stderr: "could not resolve host: api.github.com\nmore noise",
    });
    const r = await fetchPrStatus("u", runner, "/wt");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toBe("could not resolve host: api.github.com");
    }
  });

  test("returns error sentinel on malformed JSON", async () => {
    const runner = makeRunner({ stdout: "not json" });
    const r = await fetchPrStatus("u", runner, "/wt");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("parse error");
    }
  });

  test("isDraft is propagated", async () => {
    const runner = makeRunner(
      ghJson({
        state: "OPEN",
        isDraft: true,
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
      }),
    );
    const r = (await fetchPrStatus("u", runner, "/wt")) as PrStatusOk;
    expect(r.isDraft).toBe(true);
  });
});
