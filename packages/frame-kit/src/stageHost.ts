import { isFunction, isObject } from '@shared/utils/validation';

/**
 * The contract between a page's stage dialog and each package that shows a stage in it.
 *
 * Every published package bundles its own copy of the frame kit, so two packages on one page
 * share a dialog through this shape and its version, not through a shared runtime object.
 */
export const STAGE_HOST_VERSION = 1;

export type StagePresentation = 'modal' | 'drawer';

export type StageDismissReason = 'escape' | 'backdrop';

export type StageSize = {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
};

export type FramePermission = 'passkeys' | 'clipboard' | 'microphone' | 'payment';

export type FrameSpec = {
  /** The document to load. The frame's origin is the origin of this URL. */
  readonly url: string;
  readonly title: string;
  readonly permissions: readonly FramePermission[];
};

export type StageContent =
  | { readonly kind: 'frame'; readonly frame: HTMLIFrameElement }
  | { readonly kind: 'element'; readonly element: HTMLElement };

export type StageRequest = {
  readonly content: StageContent;
  /** The accessible name of the dialog while this stage is current. */
  readonly title: string;
  readonly presentation: StagePresentation;
  /** Called only while this stage is current. The owner decides whether to close it. */
  readonly onDismiss?: (reason: StageDismissReason) => void;
};

export interface Stage {
  /** A random value for this stage. Messages that act on the stage carry it. */
  readonly instance: string;
  isCurrent(): boolean;
  /**
   * Sets the size of the stage's content. A frame stage stays invisible until its first size.
   * An element stage measures itself, and a size given here replaces that measure.
   */
  resize(size: StageSize): void;
  /** True when the stage is on screen and nothing covers any part of it. */
  isUnobstructed(): boolean;
  close(): void;
}

export interface StageHost {
  readonly stageHostVersion: typeof STAGE_HOST_VERSION;
  /** Makes a frame inside the host. The host never moves it, because a moved frame reloads. */
  createFrame(spec: FrameSpec): HTMLIFrameElement;
  show(request: StageRequest): Stage;
}

export function isStageHost(value: unknown): value is StageHost {
  return (
    isObject(value) &&
    value.stageHostVersion === STAGE_HOST_VERSION &&
    isFunction(value.createFrame) &&
    isFunction(value.show)
  );
}
