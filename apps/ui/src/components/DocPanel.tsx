export const panelHeaderStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-surface)",
  fontWeight: 600,
  fontSize: 12,
};

export function DocPanel({
  title,
  expanded,
  content,
  loading,
  placeholder,
  onExpand,
}: {
  title: string;
  expanded: boolean;
  content: string | null;
  loading: boolean;
  placeholder: string;
  onExpand: () => void;
}) {
  if (!expanded) {
    return (
      <div
        onClick={onExpand}
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-surface)",
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          color: "var(--text-dim)",
        }}
      >
        {title}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={panelHeaderStyle}>{title}</div>
      {loading ? (
        <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>Loading...</div>
      ) : content && content.trim().length > 0 ? (
        <div
          style={{
            overflow: "auto",
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {content}
        </div>
      ) : (
        <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{placeholder}</div>
      )}
    </div>
  );
}
