import { Box, Text } from "ink";
import type { FeedEvent, ToolInputSummary } from "@ralphy/engine/feed-events";
import type { ReactNode } from "react";

const INDENT = 2;

function SessionLine({ event }: { event: Extract<FeedEvent, { type: "session" }> }) {
  return (
    <Box>
      <Text color="gray">── </Text>
      <Text bold>{event.model}</Text>
      <Text color="gray"> ({event.sessionId}…)</Text>
    </Box>
  );
}

function SessionUnknown({ event }: { event: Extract<FeedEvent, { type: "session-unknown" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text color="red">✗ </Text>
      <Text bold>UNKNOWN</Text>
      <Text dimColor> ({event.sessionId}…) - see --log</Text>
    </Box>
  );
}

function ThinkingLine({ event }: { event: Extract<FeedEvent, { type: "thinking" }> }) {
  if (event.preview) {
    return (
      <Box paddingLeft={INDENT}>
        <Text color="white">💭 </Text>
        <Text dimColor>{event.preview.split("\n")[0]}</Text>
      </Box>
    );
  }
  return (
    <Box paddingLeft={INDENT}>
      <Text color="white">💭</Text>
    </Box>
  );
}

function TextLine({ event }: { event: Extract<FeedEvent, { type: "text" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text>{event.text}</Text>
    </Box>
  );
}

const summaryEmoji: Record<ToolInputSummary["kind"], string> = {
  file: "📄",
  command: "$",
  search: "🔍",
  url: "🌐",
  prompt: "💬",
  edit: "✏️ ",
  write: "📝",
  raw: "",
};

const summaryRenderers: Record<ToolInputSummary["kind"], (s: ToolInputSummary) => ReactNode> = {
  file: (s) => (
    <>
      <Text color="white"> {summaryEmoji.file}</Text>
      <Text dimColor> {(s as Extract<ToolInputSummary, { kind: "file" }>).name}</Text>
    </>
  ),
  command: (s) => (
    <>
      <Text color="white"> {summaryEmoji.command}</Text>
      <Text dimColor> {(s as Extract<ToolInputSummary, { kind: "command" }>).text}</Text>
    </>
  ),
  search: (s) => {
    const { pattern, path } = s as Extract<ToolInputSummary, { kind: "search" }>;
    return (
      <>
        <Text color="white"> {summaryEmoji.search}</Text>
        <Text dimColor>
          {" "}
          {pattern}
          {path ? ` in ${path}` : ""}
        </Text>
      </>
    );
  },
  url: (s) => (
    <>
      <Text color="white"> {summaryEmoji.url}</Text>
      <Text dimColor> {(s as Extract<ToolInputSummary, { kind: "url" }>).url}</Text>
    </>
  ),
  prompt: (s) => (
    <>
      <Text color="white"> {summaryEmoji.prompt}</Text>
      <Text dimColor> {(s as Extract<ToolInputSummary, { kind: "prompt" }>).text}</Text>
    </>
  ),
  edit: () => (
    <>
      <Text color="white"> {summaryEmoji.edit}</Text>
      <Text dimColor> edit</Text>
    </>
  ),
  write: () => (
    <>
      <Text color="white"> {summaryEmoji.write}</Text>
      <Text dimColor> write</Text>
    </>
  ),
  raw: (s) => <Text dimColor> {(s as Extract<ToolInputSummary, { kind: "raw" }>).text}</Text>,
};

function ToolStartLine({ event }: { event: Extract<FeedEvent, { type: "tool-start" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text color="cyan">▶ {event.name}</Text>
      {event.summary ? summaryRenderers[event.summary.kind](event.summary) : null}
    </Box>
  );
}

function ToolResultPreview({
  event,
}: {
  event: Extract<FeedEvent, { type: "tool-result-preview" }>;
}) {
  return (
    <Box flexDirection="column" paddingLeft={INDENT + 2}>
      {event.lines.map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}
      {event.truncated ? <Text dimColor>… ({event.truncated} more lines)</Text> : null}
    </Box>
  );
}

function TurnStartLine() {
  return (
    <Box paddingLeft={INDENT}>
      <Text bold>▶ turn started</Text>
    </Box>
  );
}

function TurnDoneLine({ event }: { event: Extract<FeedEvent, { type: "turn-done" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text color="green">✓ done</Text>
      {event.inputTokens !== undefined && (
        <Text dimColor>
          {" "}
          in={event.inputTokens} out={event.outputTokens ?? 0}
        </Text>
      )}
    </Box>
  );
}

function formatCost(usd: number): string {
  return (Math.round(usd * 100) / 100).toFixed(2);
}

function ResultLine({ event }: { event: Extract<FeedEvent, { type: "result" }> }) {
  const info = [
    `cost=$${formatCost(event.cost)}`,
    `time=${Math.round((event.timeMs / 1000) * 10) / 10}s`,
    `turns=${event.turns}`,
    `in=${event.inputTokens}`,
    `out=${event.outputTokens}`,
    `cached=${event.cached}`,
  ].join("  ");

  return (
    <Box paddingLeft={INDENT}>
      <Text color="green">✓ done</Text>
      <Text dimColor> {info}</Text>
    </Box>
  );
}

function ResultErrorLine({ event }: { event: Extract<FeedEvent, { type: "result-error" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text color="red" bold>
        ✗ Error
      </Text>
      <Text color="red"> {event.message}</Text>
    </Box>
  );
}

function ErrorLine({ event }: { event: Extract<FeedEvent, { type: "error" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text color="red">error: </Text>
      <Text>{event.message}</Text>
    </Box>
  );
}

function RateLimitLine({ event }: { event: Extract<FeedEvent, { type: "rate-limit" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text color="red" bold>
        ✗ Rate limit reached
      </Text>
      <Text color="red"> {event.message}</Text>
    </Box>
  );
}

function InterruptedLine({ event }: { event: Extract<FeedEvent, { type: "interrupted" }> }) {
  return (
    <Box flexDirection="column" paddingLeft={INDENT}>
      <Box>
        <Text color="red" bold>
          ✗ Stream interrupted
        </Text>
        <Text dimColor> (no result received)</Text>
      </Box>
      <Text dimColor>
        turns={event.turns} tools={event.tools}
      </Text>
    </Box>
  );
}

function AgentLine({ event }: { event: Extract<FeedEvent, { type: "agent" }> }) {
  return (
    <Box paddingLeft={INDENT}>
      <Text dimColor>⊳ agent: {event.description}</Text>
    </Box>
  );
}

export function FeedLine({ event, verbose }: { event: FeedEvent; verbose?: boolean | undefined }) {
  switch (event.type) {
    case "session":
      return <SessionLine event={event} />;
    case "session-unknown":
      return <SessionUnknown event={event} />;
    case "agent":
      return <AgentLine event={event} />;
    case "thinking":
      return <ThinkingLine event={event} />;
    case "text":
      return <TextLine event={event} />;
    case "tool-start":
      return <ToolStartLine event={event} />;
    case "tool-end":
      return null;
    case "tool-result-preview":
      if (!verbose) return null;
      return <ToolResultPreview event={event} />;
    case "turn-start":
      return <TurnStartLine />;
    case "turn-done":
      return <TurnDoneLine event={event} />;
    case "result":
      return <ResultLine event={event} />;
    case "result-error":
      return <ResultErrorLine event={event} />;
    case "error":
      return <ErrorLine event={event} />;
    case "rate-limit":
      return <RateLimitLine event={event} />;
    case "interrupted":
      return <InterruptedLine event={event} />;
    case "raw":
      return <Text dimColor>{event.text}</Text>;
  }
}
