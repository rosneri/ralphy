export const MIN_TAIL_LINES = 3;

export interface TailLayoutInput {
  termHeight: number;
  activeCount: number;
  steeringActive: boolean;
  hasPauseBanner: boolean;
  hasCurrentTask: boolean;
  hasCmd: boolean;
  hasPhasePipeline: boolean;
  subtasksPanel: { visible: boolean; rendered: number };
  hasProgressBar: boolean;
}

export interface TailLayout {
  focusedTailLines: number;
  showOutputTail: boolean;
}

const HEADER_ROWS = 5;
const POLL_ROW = 7;
const TASKS_BOX_ROWS = 5;
const PAUSE_BANNER_ROWS = 3;
const CARD_CHROME_ROWS = 8;
const STEERING_BOX_ROWS = 3;
const SIBLING_ROWS = 4;

export function computeFocusedTailLayout(input: TailLayoutInput): TailLayout {
  const {
    termHeight,
    activeCount,
    steeringActive,
    hasPauseBanner,
    hasCurrentTask,
    hasCmd,
    hasPhasePipeline,
    subtasksPanel,
    hasProgressBar,
  } = input;

  const siblings = Math.max(0, activeCount - 1);
  const overhead =
    HEADER_ROWS +
    POLL_ROW +
    (activeCount > 1 ? TASKS_BOX_ROWS : 0) +
    (hasPauseBanner ? PAUSE_BANNER_ROWS : 0) +
    CARD_CHROME_ROWS +
    (steeringActive ? STEERING_BOX_ROWS : 0) +
    (hasCurrentTask ? 1 : 0) +
    (hasCmd ? 1 : 0) +
    (hasPhasePipeline ? 1 : 0) +
    (subtasksPanel.visible ? 1 + subtasksPanel.rendered : 0) +
    (hasProgressBar ? 1 : 0) +
    siblings * SIBLING_ROWS;

  const focusedTailLines = Math.max(0, (termHeight || 0) - overhead);
  const showOutputTail = focusedTailLines >= MIN_TAIL_LINES;
  return { focusedTailLines, showOutputTail };
}
