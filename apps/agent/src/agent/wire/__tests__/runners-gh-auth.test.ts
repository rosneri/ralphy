/**
 * Ralphy routes all GitHub operations through gh's own auth: the git/gh
 * subprocess runners must spawn with `GITHUB_TOKEN` stripped (so a stray
 * app-level token — e.g. auto-loaded from a project `.env` — can't shadow gh's
 * `GH_TOKEN` / keyring login) while keeping `GH_TOKEN` intact. `bunGitRunner`
 * and `bunCmdRunner` share the same `ghAuthEnv()` path; this spawns a real `sh`
 * through the cmd runner to assert what every spawned git/gh child inherits.
 */
import { describe, expect, test, afterEach } from "bun:test";
import { bunCmdRunner } from "../runners";

const origGithub = process.env["GITHUB_TOKEN"];
const origGh = process.env["GH_TOKEN"];

afterEach(() => {
  if (origGithub === undefined) delete process.env["GITHUB_TOKEN"];
  else process.env["GITHUB_TOKEN"] = origGithub;
  if (origGh === undefined) delete process.env["GH_TOKEN"];
  else process.env["GH_TOKEN"] = origGh;
});

describe("git/gh runners use gh auth (scrub GITHUB_TOKEN, keep GH_TOKEN)", () => {
  test("drops GITHUB_TOKEN and keeps GH_TOKEN for spawned children", async () => {
    process.env["GITHUB_TOKEN"] = "app-secret-should-be-dropped";
    process.env["GH_TOKEN"] = "gh-login-should-be-kept";
    const { stdout } = await bunCmdRunner.run(
      ["sh", "-c", 'printf "%s|%s" "${GH_TOKEN:-}" "${GITHUB_TOKEN:-<unset>}"'],
      process.cwd(),
    );
    const [gh, github] = stdout.split("|");
    expect(gh).toBe("gh-login-should-be-kept");
    expect(github).toBe("<unset>");
  });
});
