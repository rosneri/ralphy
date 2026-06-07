/** True when a Linear comment body was authored by Ralph itself. Match by
 *  the distinctive emoji-prefixed lead used in every comment ralph posts;
 *  this avoids needing to know the Linear user identity at filter time.
 *  Keep the lead set in sync with every emoji Ralphy posts (started 🤖,
 *  progress 🔄, done ✅, failed ✗/❌, stuck ⚠, revise-ack 🔁, plan-ready 📋,
 *  reminder ⏰) — a missing lead lets a comment-type getX indicator match
 *  Ralphy's own wording (e.g. the reminder's "Approve to continue"). */
export function isRalphComment(body: string): boolean {
  const trimmed = body.trimStart();
  if (/^(🤖|🔄|✅|✗|❌|⚠|🔁|📋|⏰)\s*Ralphy?\b/.test(trimmed)) return true;
  // The mention-ack (buildMentionAckComment) breaks the "<emoji> Ralphy"
  // shape: it leads with "👀 Got it, <mentioner>! …" / "👀 Acknowledged! …".
  // Recognize it explicitly so Ralphy never re-picks-up its own ack as a
  // fresh mention — otherwise the scan re-acks every poll cycle (LIT-408).
  return /^👀\s*(Got it\b|Acknowledged\b)/.test(trimmed);
}
