export const INIT_HELP = [
  "ralphy init — create or edit WORKFLOW.md with an interactive setup wizard",
  "",
  "Usage: ralphy init [options]",
  "",
  "Runs a short wizard (quick / permissive / customized) and writes WORKFLOW.md",
  "to the project root. If WORKFLOW.md already exists, offers to edit it.",
  "",
  "Options:",
  "  --project-root <path>   Directory to treat as the project root (default: detected)",
  "  --workflow <path>       Path to read / write WORKFLOW.md (default: <project>/WORKFLOW.md)",
  "  --help, -h              Show this help message",
].join("\n");
