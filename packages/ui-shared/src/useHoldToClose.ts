import { useEffect, useState } from "react";
import { useApp, useInput, useStdin } from "ink";

export interface UseHoldToCloseArgs {
  /** True once the app has finished its work and is ready to tear down. */
  finished: boolean;
  /**
   * When true, hold the pane open on finish instead of unmounting at once, so
   * the operator can read whatever is on screen (an error, a usage limit, a
   * stop reason). Typically set for abnormal/error finishes only.
   */
  hold: boolean;
  /** Run just before unmounting — e.g. to force a process exit code. */
  onClose?: () => void;
}

/**
 * Shared "pause before the pane closes" mechanism for the Ink TUIs.
 *
 * Both the task loop (`ralph loop task`) and the agent (`ralph agent`) surface
 * failures from their own dependencies — a Linear poll error in the agent, a
 * gh/usage-limit failure in a task — and both must keep that reason readable
 * instead of unmounting and clearing the screen the instant work stops. This
 * hook is the single owner of that behavior so neither surface reimplements it.
 *
 * When `finished` flips true:
 *  - if `hold` AND the terminal can read a keypress (raw mode — an interactive
 *    TTY, not a piped `--from-agent` worker with stdin ignored), stay mounted
 *    and return `awaitingClose: true` so the caller can render a prompt; the
 *    app closes once the operator presses Enter.
 *  - otherwise close immediately.
 */
export function useHoldToClose({ finished, hold, onClose }: UseHoldToCloseArgs): {
  awaitingClose: boolean;
} {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [awaitingClose, setAwaitingClose] = useState(false);

  const close = (): void => {
    onClose?.();
    exit();
  };

  useEffect(() => {
    if (!finished) return;
    if (hold && isRawModeSupported) {
      setAwaitingClose(true);
      return;
    }
    close();
    // `close` is recreated every render; the gate above keeps this to one call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, hold, isRawModeSupported]);

  useInput(
    (_input, key) => {
      if (key.return) close();
    },
    { isActive: awaitingClose },
  );

  return { awaitingClose };
}
