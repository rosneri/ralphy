/** True when a Linear comment body was authored by Ralph itself. Match by
 *  the distinctive emoji-prefixed lead used in every comment ralph posts;
 *  this avoids needing to know the Linear user identity at filter time.
 *  Keep the lead set in sync with every emoji Ralphy posts (started 🤖,
 *  progress 🔄, done ✅, failed ✗/❌, stuck ⚠, revise-ack 🔁, plan-ready 📋,
 *  reminder ⏰) — a missing lead lets a comment-type getX indicator match
 *  Ralphy's own wording (e.g. the reminder's "Approve to continue"). */
export function isRalphComment(body: string): boolean {
  const trimmed = body.trimStart();
  return /^(🤖|🔄|✅|✗|❌|⚠|🔁|📋|⏰)\s*Ralphy?\b/.test(trimmed);
}
