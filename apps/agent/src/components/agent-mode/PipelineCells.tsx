import { Box, Text } from "ink";
import { PIPELINE_NODES, STATUS_GLYPH, type PipelineNodeStatus } from "../task-pipeline";
import {
  NODE_LABELS,
  NODE_CELL_WIDTH,
  PIPELINE_CONNECTOR,
  glyphColor,
} from "./agent-mode-helpers";

/**
 * Render the six pipeline cells — either the node labels (header row) or the
 * per-status glyphs (a ticket row). Both modes use identical cell widths and
 * connectors, so the header labels align over the glyphs in every row.
 */
export function PipelineCells({
  glyphs,
}: {
  /** Per-node statuses to render as glyphs, or `null` to render the labels. */
  glyphs: PipelineNodeStatus[] | null;
}) {
  return (
    <Box>
      {PIPELINE_NODES.map((node, i) => {
        const isHeader = glyphs === null;
        const status = isHeader ? null : glyphs[i]!;
        const content = isHeader ? NODE_LABELS[node] : STATUS_GLYPH[status!];
        return (
          <Box key={node}>
            {i > 0 && <Text dimColor>{PIPELINE_CONNECTOR}</Text>}
            <Box width={NODE_CELL_WIDTH} justifyContent="center">
              {isHeader ? (
                <Text dimColor>{content}</Text>
              ) : (
                <Text color={glyphColor(status!)}>{content}</Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
