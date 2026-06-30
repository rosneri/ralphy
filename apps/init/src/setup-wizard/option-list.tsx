import { Box, Text } from "ink";
import type { Option } from "./options";

export function OptionList({ options, highlight }: { options: Option[]; highlight: number }) {
  return (
    <Box flexDirection="column">
      {options.map((option, i) => (
        <Text key={option.value} {...(i === highlight ? { color: "green" } : {})}>
          {i === highlight ? "❯ " : "  "}
          {option.label}
        </Text>
      ))}
    </Box>
  );
}
