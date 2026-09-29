import type { RegistrationSignerSetSelection } from '@shared/utils/registrationIntent';

type RegistrationSignerSetRequest = RegistrationSignerSetSelection;

export function registrationSignerSetRequestSelection(
  selection: RegistrationSignerSetRequest,
): RegistrationSignerSetSelection {
  return selection;
}
