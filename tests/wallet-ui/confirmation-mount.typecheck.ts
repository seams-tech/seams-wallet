import type {
  ConfirmationSurfaceHandle,
  ConfirmSurfaceModel,
} from '@/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';

declare const handle: ConfirmationSurfaceHandle;
declare const model: ConfirmSurfaceModel;

handle.update(model);
// @ts-expect-error The renderer accepts a complete model, never a controller patch.
handle.update({ appearance: model.appearance });
// @ts-expect-error Appearance is required for every render.
handle.update({ content: model.content });
// @ts-expect-error Raw controller fields cannot replace the normalized content branch.
handle.update({ ...model, loading: true });
