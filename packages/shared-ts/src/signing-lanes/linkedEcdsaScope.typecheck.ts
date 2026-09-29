import { type LinkedDeviceEcdsaNormalSigningScopeV1 } from './linkedEcdsaScope';
declare const scope: LinkedDeviceEcdsaNormalSigningScopeV1;
declare const publicIdentity: object;

const withOwnerPublicIdentity = { ...scope, publicIdentity };
// @ts-expect-error linked lane scope cannot carry owner public identity
const invalidPublicIdentityScope: LinkedDeviceEcdsaNormalSigningScopeV1 = withOwnerPublicIdentity;
void invalidPublicIdentityScope;

const wrongCurve = { ...scope, keyFamily: 'ed25519' };
// @ts-expect-error ECDSA linked scope cannot select the Ed25519 branch
const invalidCurveScope: LinkedDeviceEcdsaNormalSigningScopeV1 = wrongCurve;
void invalidCurveScope;
