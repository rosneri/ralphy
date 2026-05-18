import { useState } from "react";
import type { ProgressItem } from "../hooks/useTaskStream";

interface ProgressListProps {
  items: ProgressItem[];
}

export function toggleSection(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function ProgressList({ items }: ProgressListProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  if (items.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>
        No progress items yet. Items appear after the plan phase.
      </div>
    );
  }

  const sections = new Map<string, ProgressItem[]>();
  for (const item of items) {
    const key = item.section || "Tasks";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(item);
  }

  return (
    <div style={{ overflow: "auto", flex: 1, padding: "8px 0" }}>
      {Array.from(sections.entries()).map(([section, sectionItems]) => {
        const isExpanded = expanded.has(section);
        const doneCount = sectionItems.filter((it) => it.checked).length;
        return (
          <div key={section} style={{ marginBottom: 8 }}>
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setExpanded((prev) => toggleSection(prev, section))}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 12px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-dim)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span style={{ display: "inline-block", width: 10 }}>
                {isExpanded ? "▾" : "▸"}
              </span>
              <span style={{ flex: 1 }}>{section}</span>
              <span style={{ fontWeight: 500 }}>
                {doneCount} / {sectionItems.length}
              </span>
            </button>
            {isExpanded &&
              sectionItems.map((item, i) => (
                <div
                  key={`${section}-${i}`}
                  style={{
                    padding: "3px 12px",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    color: item.checked ? "var(--text-dim)" : "var(--text)",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      color: item.checked ? "var(--success)" : "var(--text-dim)",
                    }}
                  >
                    {item.checked ? "[x]" : "[ ]"}
                  </span>
                  <span
                    style={{
                      textDecoration: item.checked ? "line-through" : "none",
                      opacity: item.checked ? 0.6 : 1,
                    }}
                  >
                    {item.text}
                  </span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
