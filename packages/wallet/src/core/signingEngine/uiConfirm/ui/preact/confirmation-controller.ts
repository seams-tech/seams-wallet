import type { AppearanceConfig } from '@/core/types/seams';
import type { ConfirmUIUpdate } from '../confirm-ui-types';
import {
  normalizeConfirmationModel,
  type ConfirmationCallbacks,
  type ConfirmationPresentationInput,
} from '../confirmation-model';
import {
  mountConfirmationSurface,
  type ConfirmSurfaceModel,
  type ConfirmationSurfaceHandle,
} from './mountConfirmationSurface';
import type { TreeNode } from '../transaction-display/tree';

export type ConfirmationSurfaceController = {
  readonly element: HTMLElement;
  readonly variant: 'modal' | 'drawer';
  update(update: ConfirmUIUpdate): void;
  setTree(tree: TreeNode | null): void;
  close(): void;
  dispose(): void;
};

export type CreateConfirmationSurfaceControllerInput = {
  parent: HTMLElement;
  variant: 'modal' | 'drawer';
  context: 'standalone' | 'wallet-iframe';
  appearance: AppearanceConfig;
  presentation: ConfirmationPresentationInput;
  tree: TreeNode | null;
  callbacks: ConfirmationCallbacks;
  onClosed: () => void;
};

class MountedConfirmationController implements ConfirmationSurfaceController {
  readonly element: HTMLElement;
  readonly variant: 'modal' | 'drawer';
  private readonly surface: ConfirmationSurfaceHandle;
  private readonly callbacks: ConfirmationCallbacks;
  private appearance: AppearanceConfig;
  private presentation: ConfirmationPresentationInput;
  private tree: TreeNode | null;
  private currentModel: ConfirmSurfaceModel;

  constructor(input: CreateConfirmationSurfaceControllerInput) {
    this.variant = input.variant;
    this.callbacks = input.callbacks;
    this.appearance = input.appearance;
    this.presentation = input.presentation;
    this.tree = input.tree;
    this.currentModel = this.normalize();
    this.surface = mountConfirmationSurface({
      parent: input.parent,
      presentation: { variant: input.variant, context: input.context },
      model: this.currentModel,
      onClosed: input.onClosed,
    });
    this.element = this.surface.element;
  }

  update(update: ConfirmUIUpdate): void {
    this.presentation = mergeConfirmationPresentation(this.presentation, update);
    if (update.appearance) this.appearance = update.appearance;
    this.currentModel = this.normalize();
    this.surface.update(this.currentModel);
  }

  setTree(tree: TreeNode | null): void {
    this.tree = tree;
    this.currentModel = this.normalize();
    this.surface.update(this.currentModel);
  }

  close(): void {
    this.surface.close();
  }

  dispose(): void {
    this.surface.dispose();
  }

  private normalize(): ConfirmSurfaceModel {
    const result = normalizeConfirmationModel({
      presentation: this.presentation,
      appearance: this.appearance,
      tree: this.tree,
      callbacks: this.callbacks,
    });
    if (!result.ok) {
      throw new Error(`Cannot render confirmation surface: ${result.error}`);
    }
    return result.model;
  }
}

function mergeConfirmationPresentation(
  current: ConfirmationPresentationInput,
  update: ConfirmUIUpdate,
): ConfirmationPresentationInput {
  return {
    model: hasOwn(update, 'model') ? update.model : current.model,
    securityContext: hasOwn(update, 'securityContext')
      ? update.securityContext
      : current.securityContext,
    loading: hasOwn(update, 'loading') ? update.loading : current.loading,
    title: hasOwn(update, 'title') ? update.title : current.title,
    body: hasOwn(update, 'body') ? update.body : current.body,
    errorMessage: hasOwn(update, 'errorMessage') ? update.errorMessage : current.errorMessage,
    confirmText: hasOwn(update, 'confirmText') ? update.confirmText : current.confirmText,
    cancelText: hasOwn(update, 'cancelText') ? update.cancelText : current.cancelText,
    signingAuthMode: hasOwn(update, 'signingAuthMode')
      ? update.signingAuthMode
      : current.signingAuthMode,
    emailOtpPrompt: hasOwn(update, 'emailOtpPrompt')
      ? update.emailOtpPrompt
      : current.emailOtpPrompt,
    nearExplorerUrl: hasOwn(update, 'nearExplorerUrl')
      ? update.nearExplorerUrl
      : current.nearExplorerUrl,
    tempoExplorerUrl: hasOwn(update, 'tempoExplorerUrl')
      ? update.tempoExplorerUrl
      : current.tempoExplorerUrl,
    evmExplorerUrl: hasOwn(update, 'evmExplorerUrl')
      ? update.evmExplorerUrl
      : current.evmExplorerUrl,
  };
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function createConfirmationSurfaceController(
  input: CreateConfirmationSurfaceControllerInput,
): ConfirmationSurfaceController {
  return new MountedConfirmationController(input);
}
