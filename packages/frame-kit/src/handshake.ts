import { hasExactKeys } from '@shared/utils/exactKeys';
import { isNonEmptyString } from '@shared/utils/validation';

/** The protocol that a page and a frame speak over the port. Versions match exactly. */
export type FrameProtocol = {
  readonly name: string;
  readonly version: string;
};

type FrameConnectMessage = {
  readonly kind: 'frame_kit_connect_v1';
  readonly protocol: string;
  readonly version: string;
};

type FrameReadyMessage = {
  readonly kind: 'frame_kit_ready_v1';
  readonly protocol: string;
  readonly version: string;
};

type FrameRefusedMessage = {
  readonly kind: 'frame_kit_refused_v1';
  readonly protocol: string;
  readonly reason: 'version';
  /** The version that the frame speaks. */
  readonly version: string;
};

const MAX_FIELD_LENGTH = 128;

function isField(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_FIELD_LENGTH;
}

export function connectMessage(protocol: FrameProtocol): FrameConnectMessage {
  return { kind: 'frame_kit_connect_v1', protocol: protocol.name, version: protocol.version };
}

export function readyMessage(protocol: FrameProtocol): FrameReadyMessage {
  return { kind: 'frame_kit_ready_v1', protocol: protocol.name, version: protocol.version };
}

export function refusedMessage(protocol: FrameProtocol): FrameRefusedMessage {
  return {
    kind: 'frame_kit_refused_v1',
    protocol: protocol.name,
    reason: 'version',
    version: protocol.version,
  };
}

export function parseConnectMessage(value: unknown): FrameConnectMessage | null {
  if (!hasExactKeys(value, ['kind', 'protocol', 'version'])) return null;
  const { kind, protocol, version } = value;
  if (kind !== 'frame_kit_connect_v1' || !isField(protocol) || !isField(version)) return null;
  return { kind, protocol, version };
}

/** A reply on the port, for this protocol only. */
export function parseReplyMessage(
  value: unknown,
  protocolName: string,
): FrameReadyMessage | FrameRefusedMessage | null {
  if (hasExactKeys(value, ['kind', 'protocol', 'version'])) {
    const { kind, protocol, version } = value;
    if (kind === 'frame_kit_ready_v1' && protocol === protocolName && isField(version)) {
      return { kind, protocol, version };
    }
    return null;
  }
  if (hasExactKeys(value, ['kind', 'protocol', 'reason', 'version'])) {
    const { kind, protocol, reason, version } = value;
    if (
      kind === 'frame_kit_refused_v1' &&
      protocol === protocolName &&
      reason === 'version' &&
      isField(version)
    ) {
      return { kind, protocol, reason, version };
    }
  }
  return null;
}
