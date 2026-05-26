import { useCallback, useState } from "react";
import { formatCost } from "../utils/format-cost";
import { Link } from "react-router-dom";
import { useTasks } from "../hooks/useTasks";
import { useSidecar } from "../context/Sidecar.context";


export function TaskListView() {
  const { connected, baseUrl } = useSidecar();
  const { tasks, loading, refresh } = useTasks();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (taskName: string) => {
      if (!baseUrl) return;
      await fetch(`${baseUrl}/tasks/${taskName}/delete`, { method: "DELETE" });
      setPendingDelete(null);
      refresh();
    },
    [baseUrl, refresh],
  );

  if (!connected) {
    return (
      <>
        <div className="header">
          <h1>Ralphy</h1>
        </div>
        <div className="container" style={{ textAlign: "center", paddingTop: 60 }}>
          <p style={{ color: "var(--text-dim)" }}>Connecting to sidecar...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="header">
        <h1>Ralphy</h1>
        <Link to="/tasks/new">
          <button className="primary">+ New Task</button>
        </Link>
      </div>
      <div className="container">
        {loading ? (
          <p style={{ color: "var(--text-dim)" }}>Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <p style={{ color: "var(--text-dim)", marginBottom: 12 }}>No tasks yet</p>
            <Link to="/tasks/new">
              <button className="primary">Create your first task</button>
            </Link>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-dim)" }}>
                <th style={{ textAlign: "left", padding: "8px 12px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 12px" }}>Status</th>
                <th style={{ textAlign: "left", padding: "8px 12px" }}>Progress</th>
                <th style={{ textAlign: "right", padding: "8px 12px" }}>Iterations</th>
                <th style={{ textAlign: "right", padding: "8px 12px" }}>Cost</th>
                <th style={{ textAlign: "left", padding: "8px 12px" }}>Status</th>
                <th style={{ padding: "8px 12px", width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.name}
                  style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <Link to={`/tasks/${task.name}`} style={{ fontWeight: 600 }}>
                      {task.name}
                    </Link>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{task.status}</span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {task.progress ? (
                      <ProgressBar checked={task.progress.checked} total={task.progress.total} />
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>--</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{task.iteration}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {formatCost(task.usage.total_cost_usd)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {task.isRunning ? <RunningIndicator /> : <StatusBadge status={task.status} />}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {pendingDelete === task.name ? (
                      <span style={{ display: "flex", gap: 4 }}>
                        <button
                          className="danger"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(task.name);
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(null);
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className="danger"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(task.name);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ProgressBar({ checked, total }: { checked: number; total: number }) {
  if (total === 0) return <span style={{ color: "var(--text-dim)" }}>--</span>;
  const pct = Math.round((checked / total) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 80,
          height: 6,
          background: "var(--border)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct === 100 ? "var(--success)" : "var(--accent)",
            borderRadius: 3,
          }}
        />
      </div>
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
        {checked}/{total}
      </span>
    </div>
  );
}

function RunningIndicator() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--accent)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--accent)",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
      Running
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "var(--accent)",
    completed: "var(--success)",
    blocked: "var(--warning)",
    failed: "var(--error)",
  };
  return (
    <span
      style={{
        color: colors[status] ?? "var(--text-dim)",
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {status}
    </span>
  );
}
