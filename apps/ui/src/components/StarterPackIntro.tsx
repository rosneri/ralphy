import { Link } from "react-router-dom";
import { useIntro } from "../hooks/useIntro";

export function StarterPackIntro() {
  const intro = useIntro();

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "60px auto 0",
        textAlign: "center",
        padding: "0 24px",
      }}
    >
      <h2 style={{ marginBottom: 20, fontSize: 22, fontWeight: 700 }}>{intro.title}</h2>
      <p
        style={{
          color: "var(--text-dim)",
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        {intro.world}
      </p>
      <p
        style={{
          color: "var(--text-dim)",
          lineHeight: 1.6,
          marginBottom: 32,
        }}
      >
        {intro.story}
      </p>
      <Link to="/tasks/new">
        <button className="primary">Create your first task</button>
      </Link>
    </div>
  );
}
