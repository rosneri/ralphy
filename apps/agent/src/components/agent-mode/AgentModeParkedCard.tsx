import { Box, Text } from "ink";
import { pipelineStages, statusLabel, type TicketRow } from "../task-pipeline";
import { fmtElapsed, trunc } from "../agent-mode-format";
import { prLabel } from "./agent-mode-helpers";
import { LabeledBox } from "./LabeledBox";
import { Link } from "./Link";
import { PipelineCells } from "./PipelineCells";

/** Read-only card for a focused ticket with no live worker: pipeline, state,
 *  age since first recovery failure, and PR link. */
export function AgentModeParkedCard({
  row,
  now,
  termWidth,
}: {
  row: TicketRow;
  now: number;
  termWidth: number;
}) {
  let age = "–";
  if (row.recovery?.firstFailedAt) {
    const failedAt = Date.parse(row.recovery.firstFailedAt);
    if (!Number.isNaN(failedAt)) age = fmtElapsed(now - failedAt);
  }
  const prUrl = row.prUrl ?? null;
  const cardLabelWidth =
    (prUrl ? prLabel(prUrl).length + 3 : 0) + row.identifier.length + 2;
  const cardLabelNode = (
    <>
      <Text color="gray"> </Text>
      {prUrl && <Link url={prUrl} label={prLabel(prUrl)} color="green" />}
      {prUrl && <Text color="gray"> · </Text>}
      <Link url={row.url} label={row.identifier} color="cyan" />
      <Text color="gray"> </Text>
    </>
  );
  return (
    <LabeledBox
      key={row.id}
      labelNode={cardLabelNode}
      labelVisualWidth={cardLabelWidth}
      borderColor="gray"
      flexDirection="column"
      paddingX={1}
      width={termWidth}
    >
      <Text color="white" bold>
        {trunc(row.title, Math.max(20, termWidth - 20))}
      </Text>
      <Box marginTop={0}>
        <PipelineCells glyphs={pipelineStages(row).map((s) => s.status)} />
        <Text color="white">
          {"  "}
          {statusLabel(row)}
        </Text>
      </Box>
      <Box gap={2} marginTop={0}>
        <Text dimColor>parked · no live worker</Text>
        <Text dimColor>│</Text>
        <Text dimColor>age {age}</Text>
        {prUrl && (
          <>
            <Text dimColor>│</Text>
            <Link url={prUrl} label={prLabel(prUrl)} color="green" />
          </>
        )}
      </Box>
    </LabeledBox>
  );
}
