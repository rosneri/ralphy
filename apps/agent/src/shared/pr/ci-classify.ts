/**
 * Re-export shim. The gh retry policy and check classification moved to
 * `@ralphy/codehost` (issue #403 — one CodeHost adapter, one retry policy);
 * existing import sites keep compiling unchanged.
 */
export {
  classifyCheck,
  classifyGhBucket,
  NO_CHECKS_RE,
  PARTIAL_ACCESS_RE,
  runGhWithRetry,
  type RawCheck,
} from "@ralphy/codehost";
