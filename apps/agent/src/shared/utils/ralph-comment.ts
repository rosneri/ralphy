import { isRalphyComment } from "@ralphy/comms";

/** True when a Linear comment body was authored by Ralph itself.
 *
 *  Delegates to the unified recognizer in `@ralphy/core/detections`, which
 *  matches the fixed `🤖 Ralphy` title, the hidden `<!-- ralphy:… -->` marker,
 *  and the legacy emoji-led prefixes still present on already-posted comments.
 *  Recognising Ralphy's own comments keeps the mention/review scan from
 *  re-triggering on them. */
export function isRalphComment(body: string): boolean {
  return isRalphyComment(body);
}
