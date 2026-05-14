/**
 * Glob matching for `boundaries.never_touch`. Supports the subset of glob
 * syntax we actually use in WORKFLOW.md: `*`, `**`, and `?`. Anchored to
 * the repo root — patterns are matched against forward-slash paths.
 */
function globToRegex(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**` matches across path separators
        re += ".*";
        i++;
        // consume an optional trailing slash so `dist/**` matches `dist/foo`
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

export interface BoundaryViolation {
  file: string;
  pattern: string;
}

export function findBoundaryViolations(
  changedFiles: readonly string[],
  patterns: readonly string[],
): BoundaryViolation[] {
  if (patterns.length === 0 || changedFiles.length === 0) return [];
  const compiled = patterns.map((p) => ({ pattern: p, re: globToRegex(p) }));
  const out: BoundaryViolation[] = [];
  for (const file of changedFiles) {
    const norm = file.replace(/\\/g, "/");
    for (const { pattern, re } of compiled) {
      if (re.test(norm)) {
        out.push({ file: norm, pattern });
        break;
      }
    }
  }
  return out;
}
