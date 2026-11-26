import {
  THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  THRESHOLD_ED25519_CLIENT_PARTICIPANT_ID,
  THRESHOLD_ED25519_RELAYER_PARTICIPANT_ID,
  normalizeThresholdEd25519ParticipantId,
  normalizeThresholdEd25519ParticipantIds,
} from '@shared/threshold/participants';

export function parseThresholdEd25519ParticipantIds2p(input: {
  THRESHOLD_ED25519_CLIENT_PARTICIPANT_ID?: unknown;
  THRESHOLD_ED25519_RELAYER_PARTICIPANT_ID?: unknown;
}): { clientParticipantId: number; relayerParticipantId: number; participantIds2p: number[] } {
  const clientIdRaw = input.THRESHOLD_ED25519_CLIENT_PARTICIPANT_ID;
  const relayerIdRaw = input.THRESHOLD_ED25519_RELAYER_PARTICIPANT_ID;
  const clientId =
    clientIdRaw === undefined ? null : normalizeThresholdEd25519ParticipantId(clientIdRaw);
  if (clientIdRaw !== undefined && !clientId) {
    throw new Error('THRESHOLD_ED25519_CLIENT_PARTICIPANT_ID must be an integer in [1,65535]');
  }
  const relayerId =
    relayerIdRaw === undefined ? null : normalizeThresholdEd25519ParticipantId(relayerIdRaw);
  if (relayerIdRaw !== undefined && !relayerId) {
    throw new Error('THRESHOLD_ED25519_RELAYER_PARTICIPANT_ID must be an integer in [1,65535]');
  }

  const clientParticipantId = clientId ?? THRESHOLD_ED25519_CLIENT_PARTICIPANT_ID;
  const relayerParticipantId = relayerId ?? THRESHOLD_ED25519_RELAYER_PARTICIPANT_ID;
  if (clientParticipantId === relayerParticipantId) {
    throw new Error(
      'THRESHOLD_ED25519_CLIENT_PARTICIPANT_ID must differ from THRESHOLD_ED25519_RELAYER_PARTICIPANT_ID',
    );
  }

  const participantIds2p = normalizeThresholdEd25519ParticipantIds([
    clientParticipantId,
    relayerParticipantId,
  ]) || [...THRESHOLD_ED25519_2P_PARTICIPANT_IDS];

  return { clientParticipantId, relayerParticipantId, participantIds2p };
}
