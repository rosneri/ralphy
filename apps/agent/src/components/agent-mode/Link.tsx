import { Text, Transform } from "ink";
import { HYPERLINKS_SUPPORTED } from "./agent-mode-helpers";

/** Renders label as an OSC 8 terminal hyperlink via Transform (so Ink measures only the label width). */
export function Link({ url, label, color }: { url: string; label: string; color: string }) {
  if (!HYPERLINKS_SUPPORTED) return <Text color={color}>{label}</Text>;
  return (
    <Transform transform={(output) => `\x1b]8;;${url}\x07${output}\x1b]8;;\x07`}>
      <Text color={color} underline>
        {label}
      </Text>
    </Transform>
  );
}
