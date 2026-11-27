import type { StagePresentation, StageSize } from './stageHost';

/** The space that a centred stage keeps free on each side of the visual viewport. */
const STAGE_INSET_CSS_PX = 16;
/** Below this room, a centred stage fills the visual viewport instead. */
const STAGE_MIN_CSS_PX = 280;
/** The size at which a stage lays out before its first measure. */
const PROVISIONAL_SIZE: StageSize = { widthCssPx: 560, heightCssPx: 320 };
/** The largest size that a stage accepts from its content, before the viewport clamps it. */
const STAGE_MAX_CSS_PX = 4096;

export type StageViewport = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type StageBox = {
  readonly kind: 'provisional' | 'centred' | 'fill';
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** The widest that an element stage can lay out. */
  readonly roomWidth: number;
};

/** The visual viewport in the coordinates of a fixed-position element. */
export function readStageViewport(view: Window): StageViewport {
  const visual = view.visualViewport;
  if (!visual) return { left: 0, top: 0, width: view.innerWidth, height: view.innerHeight };
  return { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height };
}

export function isStageSize(value: StageSize): boolean {
  const { widthCssPx, heightCssPx } = value;
  return (
    Number.isFinite(widthCssPx) &&
    Number.isFinite(heightCssPx) &&
    widthCssPx > 0 &&
    heightCssPx > 0 &&
    widthCssPx <= STAGE_MAX_CSS_PX &&
    heightCssPx <= STAGE_MAX_CSS_PX
  );
}

/**
 * Where a stage goes. A drawer fills the visual viewport and its content draws the sheet. A modal
 * stage is centred and clamped to the viewport less the inset; when that room is too small for a
 * usable card, it fills the viewport. A stage with no size yet gets the provisional box.
 */
export function stageBox(
  viewport: StageViewport,
  presentation: StagePresentation,
  size: StageSize | null,
): StageBox {
  const roomWidth = Math.max(0, Math.floor(viewport.width - 2 * STAGE_INSET_CSS_PX));
  const roomHeight = Math.max(0, Math.floor(viewport.height - 2 * STAGE_INSET_CSS_PX));
  const kind = size ? 'centred' : 'provisional';
  if (
    presentation === 'drawer' ||
    roomWidth < STAGE_MIN_CSS_PX ||
    roomHeight < STAGE_MIN_CSS_PX
  ) {
    return {
      kind: size ? 'fill' : 'provisional',
      left: Math.round(viewport.left),
      top: Math.round(viewport.top),
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      roomWidth: Math.round(viewport.width),
    };
  }
  const wanted = size ?? PROVISIONAL_SIZE;
  const width = Math.min(Math.ceil(wanted.widthCssPx), roomWidth);
  const height = Math.min(Math.ceil(wanted.heightCssPx), roomHeight);
  return {
    kind,
    left: Math.round(viewport.left + (viewport.width - width) / 2),
    top: Math.round(viewport.top + (viewport.height - height) / 2),
    width,
    height,
    roomWidth,
  };
}

export function sameStageBox(left: StageBox | null, right: StageBox): boolean {
  return (
    left !== null &&
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}
