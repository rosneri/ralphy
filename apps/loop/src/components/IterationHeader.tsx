import { Box, Text } from "ink";

interface IterationHeaderProps {
  iteration: number;
  time: string;
}

export function IterationHeader({ iteration, time }: IterationHeaderProps) {
  return (
    <Box>
      <Text color="gray">{"─── "}</Text>
      <Text bold color="cyan">
        #{iteration}
      </Text>
      <Text color="gray"> {time} </Text>
      <Text color="gray">{"───"}</Text>
    </Box>
  );
}
