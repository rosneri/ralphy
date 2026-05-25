import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSidecar } from "../context/Sidecar.context";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

export function NewTaskView() {
  const { baseUrl } = useSidecar();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState("claude");
  const [model, setModel] = useState("sonnet");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    if (!nameEdited) {
      setName(slugify(value));
    }
  };

  const handleNameChange = (value: string) => {
    setNameEdited(true);
    setName(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), prompt: prompt.trim(), engine, model }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      navigate(`/tasks/${name.trim()}`);
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="header">
        <h1>
          <Link to="/" style={{ color: "var(--text-dim)" }}>
            Ralphy
          </Link>
          {" / "}
          New Task
        </h1>
      </div>
      <div className="container" style={{ maxWidth: 640 }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", marginBottom: 4, color: "var(--text-dim)" }}>
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder="Describe what you want the agent to do..."
              rows={6}
              required
            />
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: 4, color: "var(--text-dim)" }}>
                Engine
              </label>
              <select value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: 4, color: "var(--text-dim)" }}>
                Model
              </label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="haiku">Haiku</option>
                <option value="sonnet">Sonnet</option>
                <option value="opus">Opus</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 4, color: "var(--text-dim)" }}>
              Task Name
            </label>
            <input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="auto-generated from prompt"
              required
            />
          </div>

          {error && <p style={{ color: "var(--error)" }}>{error}</p>}

          <div style={{ display: "flex", gap: 12 }}>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? "Creating..." : "Create Task"}
            </button>
            <Link to="/">
              <button type="button">Cancel</button>
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
