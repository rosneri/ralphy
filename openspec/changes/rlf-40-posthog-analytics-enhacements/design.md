# Design — RLF-40 Posthog Analytics Enhancements

## Approach

We centralise the new context in the telemetry package rather than threading
extra props through every caller. `init()` populates a shared `defaultProps`
object once; `capture()` already spreads `defaultProps` into every event so the
new fields propagate automatically.

`captureError()` is a thin helper, not a new transport, so existing call sites
that already use `capture("…_failed", { error: msg })` continue to work without
churn — they can adopt the helper opportunistically.

## Module Boundaries

- `@ralphy/telemetry` gains a dependency on `@ralphy/version` so the package
  can read the version itself instead of every caller passing it.
- No public API breakage: `init`, `capture`, `setDefaultProperties`, and
  `shutdown` keep their existing signatures.

## Risks

- **Version is "unknown" in some dev contexts.** `getVersion()` already returns
  `"unknown"` when no workspace `package.json` is found; that propagates into
  events. That's acceptable — it's still better than no field at all.
- **`os.hostname()` may leak identifying info.** PostHog data is already
  per-installation (we mint a `distinctId`), so adding hostname is a small
  delta. Users who opt out via `RALPH_TELEMETRY=0` are unaffected.
