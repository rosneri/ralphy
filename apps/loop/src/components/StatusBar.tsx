import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";

interface StatusBarProps {
  iteration: number;
  costUsd: number;
  startedAt: number;
  engine: string;
  model: string;
  isRunning: boolean;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function Sep() {
  return <Text color="gray"> │ </Text>;
}

export function StatusBar({
  iteration,
  costUsd,
  startedAt,
  engine,
  model,
  isRunning,
}: StatusBarProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [isRunning, startedAt]);

  const bar = "─".repeat(52);

  return (
    <Box flexDirection="column">
      <Text color="gray">{bar}</Text>
      <Box>
        <Text> </Text>
        {isRunning ? <Spinner label="" /> : <Text color="green">✓</Text>}
        <Text> </Text>
        <Text>iter </Text>
        <Text bold>{iteration}</Text>
        {costUsd > 0 && (
          <>
            <Sep />
            <Text color="magenta">${costUsd.toFixed(2)}</Text>
          </>
        )}
        <Sep />
        <Text dimColor>{formatElapsed(elapsed)}</Text>
        <Sep />
        <Text dimColor>
          {engine}/{model}
        </Text>
      </Box>
      <Text color="gray">{bar}</Text>
    </Box>
  );
}
