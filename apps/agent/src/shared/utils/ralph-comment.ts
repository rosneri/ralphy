/** True when a Linear comment body was authored by Ralph itself. Match by
 *  the distinctive emoji-prefixed lead used in every comment ralph posts;
 *  this avoids needing to know the Linear user identity at filter time. */
export function isRalphComment(body: string): boolean {
  const trimmed = body.trimStart();
  return /^(🤖|🔄|✅|✗|⚠|🔁|📋)\s*Ralphy?\b/.test(trimmed);
}
