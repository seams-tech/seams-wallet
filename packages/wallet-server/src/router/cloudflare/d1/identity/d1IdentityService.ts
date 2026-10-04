import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import type { IdentityStore } from '../../../../core/IdentityStore';
import type { RouterApiIdentityService } from '../../../framework/authServicePort';

type ListIdentitiesInput = Parameters<RouterApiIdentityService['listIdentities']>[0];
type ListIdentitiesResult = Awaited<ReturnType<RouterApiIdentityService['listIdentities']>>;
type LinkIdentityInput = Parameters<RouterApiIdentityService['linkIdentity']>[0];
type LinkIdentityResult = Awaited<ReturnType<RouterApiIdentityService['linkIdentity']>>;
type UnlinkIdentityInput = Parameters<RouterApiIdentityService['unlinkIdentity']>[0];
type UnlinkIdentityResult = Awaited<ReturnType<RouterApiIdentityService['unlinkIdentity']>>;
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export class CloudflareD1IdentityService {
  private readonly identityStore: IdentityStore;

  constructor(input: { readonly identityStore: IdentityStore }) {
    this.identityStore = input.identityStore;
  }

  async listIdentities(input: ListIdentitiesInput): Promise<ListIdentitiesResult> {
    try {
      const userId = toOptionalTrimmedString(input.userId);
      if (!userId) return failure('invalid_args', 'Missing userId');
      const subjects = await this.identityStore.listSubjectsByUserId(userId);
      return { ok: true, subjects };
    } catch (error: unknown) {
      return failure('internal', errorMessage(error) || 'Failed to list identities');
    }
  }

  async linkIdentity(input: LinkIdentityInput): Promise<LinkIdentityResult> {
    try {
      const userId = toOptionalTrimmedString(input.userId);
      const subject = toOptionalTrimmedString(input.subject);
      if (!userId) return failure('invalid_args', 'Missing userId');
      if (!subject) return failure('invalid_args', 'Missing subject');
      return await this.identityStore.linkSubjectToUserId({
        userId,
        subject,
        allowMoveIfSoleIdentity: Boolean(input.allowMoveIfSoleIdentity),
      });
    } catch (error: unknown) {
      return failure('internal', errorMessage(error) || 'Failed to link identity');
    }
  }

  async unlinkIdentity(input: UnlinkIdentityInput): Promise<UnlinkIdentityResult> {
    try {
      const userId = toOptionalTrimmedString(input.userId);
      const subject = toOptionalTrimmedString(input.subject);
      if (!userId) return failure('invalid_args', 'Missing userId');
      if (!subject) return failure('invalid_args', 'Missing subject');
      return await this.identityStore.unlinkSubjectFromUserId({ userId, subject });
    } catch (error: unknown) {
      return failure('internal', errorMessage(error) || 'Failed to unlink identity');
    }
  }
}
