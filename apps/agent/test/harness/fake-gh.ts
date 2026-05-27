import type { CmdRunner } from "../../src/agent/pr";

export interface ScriptedPr {
  branch: string;
  prUrl: string;
  number?: number;
  state?: "OPEN" | "MERGED" | "CLOSED";
  baseRefName?: string;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus?: string;
  checks?: { name: string; conclusion: string; status: string }[];
  draft?: boolean;
}

export interface FakeGh {
  runner: CmdRunner;
  /** Argv log for every `gh` invocation. */
  calls: { argv: string[]; cwd: string }[];
  script: (pr: ScriptedPr) => void;
  byBranch: () => ReadonlyMap<string, ScriptedPr>;
}

export function createFakeGh(): FakeGh {
  const prs = new Map<string, ScriptedPr>();
  const byUrl = new Map<string, ScriptedPr>();
  const calls: { argv: string[]; cwd: string }[] = [];

  const script = (pr: ScriptedPr): void => {
    const full: ScriptedPr = {
      number: 1,
      state: "OPEN",
      baseRefName: "main",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      checks: [],
      ...pr,
    };
    prs.set(pr.branch, full);
    byUrl.set(pr.prUrl, full);
  };

  const runner: CmdRunner = {
    run: async (argv, cwd) => {
      calls.push({ argv, cwd });
      if (argv[0] !== "gh") {
        throw new Error("scripted shim: only gh calls supported", { cause: { argv } });
      }
      const sub = argv[1];
      const sub2 = argv[2];
      if (sub === "pr" && sub2 === "create") {
        const headIdx = argv.indexOf("--head");
        const branch = headIdx >= 0 ? argv[headIdx + 1] : undefined;
        const pr = branch ? prs.get(branch) : undefined;
        if (!pr) {
          throw new Error(`scripted shim: no rule for \`gh pr create\` (branch=${branch ?? "?"})`);
        }
        return { stdout: pr.prUrl + "\n", stderr: "" };
      }
      if (sub === "pr" && sub2 === "view") {
        const target = argv[3] ?? "";
        const pr = byUrl.get(target) ?? [...prs.values()].find((p) => p.prUrl === target);
        if (!pr) {
          throw new Error(`scripted shim: no rule for \`gh pr view ${target}\``);
        }
        return {
          stdout: JSON.stringify({ ...pr, isDraft: Boolean(pr.draft ?? false) }),
          stderr: "",
        };
      }
      if (sub === "pr" && sub2 === "edit") {
        const target = argv[3];
        const pr = byUrl.get(target ?? "");
        if (!pr) throw new Error(`scripted shim: no rule for \`gh pr edit ${target ?? ""}\``);
        const baseIdx = argv.indexOf("--base");
        if (baseIdx >= 0) {
          const v = argv[baseIdx + 1];
          if (v !== undefined) pr.baseRefName = v;
        }
        return { stdout: "", stderr: "" };
      }
      if (sub === "pr" && sub2 === "close") {
        const target = argv[3];
        const pr = byUrl.get(target ?? "");
        if (!pr) throw new Error(`scripted shim: no rule for \`gh pr close ${target ?? ""}\``);
        pr.state = "CLOSED";
        return { stdout: "", stderr: "" };
      }
      if (sub === "pr" && sub2 === "merge") {
        const target = argv[3];
        const pr = byUrl.get(target ?? "");
        if (!pr) throw new Error(`scripted shim: no rule for \`gh pr merge ${target ?? ""}\``);
        pr.state = "MERGED";
        return { stdout: "", stderr: "" };
      }
      if (sub === "api") {
        throw new Error(`scripted shim: no rule for \`gh api ${argv.slice(2).join(" ")}\``);
      }
      throw new Error(`scripted shim: no rule for \`${argv.join(" ")}\``);
    },
  };

  return { runner, calls, script, byBranch: () => prs };
}
