import { Box, Text } from "ink";

/** Box with a centered label embedded in the top border: ╭─── LABEL ───╮ */
export function LabeledBox({
  label,
  labelNode,
  labelVisualWidth,
  borderColor = "gray",
  width,
  children,
  ...rest
}: {
  label?: string;
  labelNode?: React.ReactNode;
  labelVisualWidth?: number;
  borderColor?: string;
  width: number;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Box>, "borderStyle" | "borderTop" | "borderColor" | "width">) {
  const innerWidth = Math.max(0, width - 2);
  const visualLen = labelVisualWidth ?? (label ? label.length + 2 : 0);
  const dashes = Math.max(0, innerWidth - visualLen);
  const left = Math.floor(dashes / 2);
  const right = dashes - left;
  return (
    <Box flexDirection="column" width={width}>
      {labelNode ? (
        <Box flexDirection="row">
          <Text color={borderColor}>{`╭${"─".repeat(left)}`}</Text>
          {labelNode}
          <Text color={borderColor}>{`${"─".repeat(right)}╮`}</Text>
        </Box>
      ) : (
        <Text
          color={borderColor}
        >{`╭${"─".repeat(left)} ${label ?? ""} ${"─".repeat(right)}╮`}</Text>
      )}
      <Box borderStyle="round" borderTop={false} borderColor={borderColor} width={width} {...rest}>
        {children}
      </Box>
    </Box>
  );
}
