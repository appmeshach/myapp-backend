import { getPostActivationPeople, getPostActivationVehicle } from './movementService';
import { getPostActivationProfilePhoto } from './profilePhotoService';
import type { PostActivationPerson, PostActivationVehicle } from '../types/movement';

export type CoordinationPerson = Pick<PostActivationPerson, 'personNumber' | 'personRole' | 'firstName' | 'age' | 'verified' | 'rating' | 'completedMovements'> & { photoUri: string | null };
export type CoordinationReveal = { people: CoordinationPerson[]; vehicle: PostActivationVehicle | null };
export const validMovementNeed = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function imageData(blob: Blob, signal: AbortSignal): Promise<string | null> {
  if (!['image/jpeg','image/png','image/webp'].includes(blob.type) || blob.size <= 0 || blob.size > 5 * 1024 * 1024) return Promise.resolve(null);
  return new Promise(resolve => {
    const reader = new FileReader();
    const finish = (value: string | null) => { signal.removeEventListener('abort', cancel); resolve(value); };
    const cancel = () => { reader.abort(); finish(null); };
    reader.onload = () => finish(!signal.aborted && typeof reader.result === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(reader.result) ? reader.result : null);
    reader.onerror = () => finish(null); reader.onabort = () => finish(null);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { finish(null); return; }
    reader.readAsDataURL(blob);
  });
}
// No discovery, table SELECT, storage URL or persisted identity cache is used.
export async function loadMovementCoordination(need: string, signal: AbortSignal): Promise<CoordinationReveal | null> {
  if (!validMovementNeed(need)) return null;
  signal.throwIfAborted();
  const rows = await getPostActivationPeople(need);
  signal.throwIfAborted();
  if (!rows.length) return null;
  const roles = rows.map(p => p.personRole);
  const traveller = rows.length === 1 && roles[0] === 'offering_member';
  if (!traveller && !roles.every(r => r === 'primary_requester' || r === 'invited_participant')) throw new Error('unavailable');
  const people: CoordinationPerson[] = [];
  for (const p of rows) {
    if (!Number.isInteger(p.personNumber) || p.personNumber < 1 || typeof p.verified !== 'boolean'
      || (p.firstName !== null && typeof p.firstName !== 'string')
      || (p.age !== null && (!Number.isInteger(p.age) || p.age < 0))
      || (p.rating !== null && (typeof p.rating !== 'number' || !Number.isFinite(p.rating) || p.rating < 1 || p.rating > 5))
      || !Number.isInteger(p.completedMovements) || p.completedMovements < 0) throw new Error('unavailable');
    let photoUri: string | null = null;
    if (p.profilePhotoToken && /^[a-f0-9]{64}$/.test(p.profilePhotoToken) && p.profilePhotoExpiresAt && Date.parse(p.profilePhotoExpiresAt) > Date.now()) {
      try {
        const blob = await getPostActivationProfilePhoto(p.profilePhotoToken);
        signal.throwIfAborted();
        if (blob) photoUri = await imageData(blob, signal);
        if (Date.parse(p.profilePhotoExpiresAt) <= Date.now()) photoUri = null;
      } catch { /* Unavailable photo does not invent an image or reveal errors. */ }
    }
    signal.throwIfAborted();
    people.push({ personNumber: p.personNumber, personRole: p.personRole, firstName: p.firstName, age: p.age,
      verified: p.verified, rating: p.rating, completedMovements: p.completedMovements, photoUri });
  }
  const vehicle = traveller ? await getPostActivationVehicle(need) : null;
  signal.throwIfAborted();
  if (vehicle && (typeof vehicle.vehicleDisplayName !== 'string' || !vehicle.vehicleDisplayName.trim()
    || typeof vehicle.plateNumber !== 'string' || !vehicle.plateNumber.trim())) throw new Error('unavailable');
  return { people, vehicle: vehicle ? { vehicleDisplayName: vehicle.vehicleDisplayName, plateNumber: vehicle.plateNumber } : null };
}
