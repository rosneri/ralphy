import type { AgentParsedArgs } from "../../cli";
import type { RalphyConfig } from "../config";
import type { AgentCoordinator } from "../coordinator";
import type { CmdRunner } from "../pr";
import type { GitRunner } from "../worktree";
import { resolveBaselineCommands } from "@ralphy/workflow";
import { runBaselineGate } from "../baseline/gate";
import {
  findOpenIssueByLabel,
  createIssue,
  updateIssueDescription,
} from "../../shared/capabilities/linear-client/issues";
import { fetchTeamIdByKey } from "../../shared/capabilities/linear-client/labels-and-projects";

interface BaselineInput {
  args: AgentParsedArgs;
  cfg: RalphyConfig;
  apiKey: string;
  team: string | undefined;
  projectRoot: string;
  cmdRunner: CmdRunner;
  gitRunner: GitRunner;
  coord: AgentCoordinator;
  onLog: (text: string, color?: string) => void;
  resolveLabelIdForTeam: (teamKey: string, labelName: string) => Promise<string | null>;
}

export function createBaselineGateRunner(input: BaselineInput): () => Promise<void> {
  const {
    args,
    cfg,
    apiKey,
    team,
    projectRoot,
    cmdRunner,
    gitRunner,
    coord,
    onLog,
    resolveLabelIdForTeam,
  } = input;
  const baselineCfg = cfg.preExistingErrorCheck;
  const baselineCommands = resolveBaselineCommands(cfg);
  const baselineEnabled = (args.preExistingErrorCheck ?? baselineCfg.enabled) === true;
  return async function runBaselineGateOnce(): Promise<void> {
    if (!baselineEnabled) return;
    await runBaselineGate({
      enabled: true,
      commands: baselineCommands,
      baseBranch: baselineCfg.baseBranch,
      outputCharLimit: baselineCfg.outputCharLimit,
      cwd: projectRoot,
      cmdRunner,
      gitRunner,
      coordinator: coord,
      ...(team && apiKey
        ? {
            linear: {
              findOpen: () => findOpenIssueByLabel(apiKey, team, baselineCfg.label),
              create: async (title, description) => {
                const teamId = await fetchTeamIdByKey(apiKey, team);
                if (!teamId) throw new Error("Linear team not found");
                let labelIds: string[] | undefined;
                try {
                  const labelId = await resolveLabelIdForTeam(team, baselineCfg.label);
                  if (labelId) labelIds = [labelId];
                } catch {
                  // non-fatal
                }
                return createIssue(apiKey, {
                  teamId,
                  title,
                  description,
                  ...(labelIds ? { labelIds } : {}),
                });
              },
              updateDescription: (id, description) =>
                updateIssueDescription(apiKey, id, description),
            },
          }
        : {}),
      onLog,
    });
  };
}
