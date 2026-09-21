export const SURFACE_RESIZE_BEGIN_EVENT = 'seams-surface-resize-begin';

export type SurfaceResizeDriver = {
  /** 0 renders the pre-change height, 1 the post-change height. */
  setProgress(progress: number): void;
  /** The change is fully applied: release the clamp and commit the DOM. */
  finish(): void;
};

export type SurfaceResizeBeginDetail = {
  /** Diagnostics label: a tree node id, `file-content-mode`, `confirm-body`. */
  readonly reason?: string;
  /** Signed change in the announcing element's height, in CSS px. */
  readonly deltaCssPx: number;
  /** Take over the motion. Returns null once someone else already has. */
  claim(): SurfaceResizeDriver | null;
};

export type SurfaceResizeBeginListener = (event: CustomEvent<SurfaceResizeBeginDetail>) => void;

export function dispatchSurfaceResizeBegin(
  target: EventTarget,
  detail: SurfaceResizeBeginDetail,
): boolean {
  return target.dispatchEvent(
    new CustomEvent<SurfaceResizeBeginDetail>(SURFACE_RESIZE_BEGIN_EVENT, {
      bubbles: true,
      composed: true,
      detail,
    }),
  );
}

export function addSurfaceResizeBeginListener(
  target: EventTarget,
  listener: SurfaceResizeBeginListener,
  options?: boolean | AddEventListenerOptions,
): () => void {
  const handler = listener as EventListener;
  target.addEventListener(SURFACE_RESIZE_BEGIN_EVENT, handler, options);
  return () => target.removeEventListener(SURFACE_RESIZE_BEGIN_EVENT, handler, options);
}
