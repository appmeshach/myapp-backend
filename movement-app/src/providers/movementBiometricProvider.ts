import type { FaceVerificationReceipt } from '../types/faceVerification';

// No provider secrets, references, session/media IDs, scores or result booleans.
// Future SDK-specific handles remain encapsulated inside the adapter instance.
export interface MovementBiometricProvider {
  isAvailable(): Promise<boolean>;
  start(movementNeedId: string): Promise<FaceVerificationReceipt>;
  presentCapture(): Promise<'submitted' | 'cancelled' | 'unavailable'>;
}
export const unavailableBiometricProvider: MovementBiometricProvider = Object.freeze({
  async isAvailable() { return false; },
  async start() { throw new Error('verification_unavailable'); },
  async presentCapture() { return 'unavailable' as const; },
});
// No env-based adapter selection or production fake. An audited future adapter
// calls startMyMovementFaceVerification and presents its SDK. SDK completion
// only means submitted; success always comes from the safe backend status RPC.
export interface MovementPhotoPicker { pick(): Promise<Blob | null> }
