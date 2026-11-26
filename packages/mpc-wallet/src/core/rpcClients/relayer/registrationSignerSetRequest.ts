import type { RegistrationSignerSetSelection } from '@shared/utils/registrationSignerPlan';

type RegistrationSignerSetRequest = RegistrationSignerSetSelection;

export function registrationSignerSetRequestSelection(
  selection: RegistrationSignerSetRequest,
): RegistrationSignerSetSelection {
  return selection;
}
