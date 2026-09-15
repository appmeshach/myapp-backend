import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { MovementPhotoPicker, SelectedMovementPhoto } from './movementBiometricProvider';

const MAX_BYTES = 5 * 1024 * 1024;
const supported = ['image/jpeg', 'image/png', 'image/webp'];
const options: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false,
  base64: false, exif: false, quality: 1,
};
function close(blob: Blob | undefined) { (blob as (Blob & { close?(): void }) | undefined)?.close?.(); }
function releasePreview(uri: string) {
  if (Platform.OS === 'web' && uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
function header(blob: Blob, signal: AbortSignal): Promise<ArrayBuffer> {
  const part = blob.slice(0, 12);
  // React Native's Blob uses FileReader; browsers also support arrayBuffer().
  if (typeof part.arrayBuffer === 'function') return part.arrayBuffer().finally(() => close(part));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const finish = () => { signal.removeEventListener('abort', abort); close(part); };
    reader.onload = () => { const result = reader.result; finish();
      if (result instanceof ArrayBuffer) resolve(result); else reject(new Error('photo_invalid')); };
    reader.onerror = reader.onabort = () => { finish(); reject(new Error('photo_invalid')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { finish(); reject(new Error('photo_invalid')); return; }
    try { reader.readAsArrayBuffer(part); } catch { finish(); reject(new Error('photo_invalid')); }
  });
}
function matches(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  return bytes.length >= 12 && [82,73,70,70].every((v,i) => bytes[i] === v)
    && [87,69,66,80].every((v,i) => bytes[i+8] === v);
}

// Only called with an asset returned by the system picker, never a route/input URI.
export async function prepareSelectedPhoto(asset: ImagePicker.ImagePickerAsset, signal: AbortSignal): Promise<SelectedMovementPhoto> {
  let original: Blob | undefined; let photo: Blob | undefined;
  try {
    if (signal.aborted || !asset || (asset.type && asset.type !== 'image') || !asset.uri
      || !/^(file:\/\/|content:\/\/|blob:)/i.test(asset.uri)) throw new Error('photo_invalid');
    if (asset.fileSize !== undefined && asset.fileSize > MAX_BYTES) throw new Error('photo_too_large');
    if (asset.fileSize !== undefined && asset.fileSize <= 0) throw new Error('photo_invalid');
    const extension = (asset.uri.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]
      ?? asset.fileName?.match(/\.([a-z0-9]+)$/i)?.[1])?.toLowerCase();
    const byExtension: Record<string,string> = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp' };
    const type = asset.mimeType?.toLowerCase() || byExtension[extension ?? ''];
    if (!supported.includes(type)) throw new Error('photo_invalid');
    if (Platform.OS === 'web' && asset.file) original = asset.file;
    else {
      const response = await fetch(asset.uri, { signal });
      if (!response.ok) throw new Error('photo_invalid');
      original = await response.blob();
    }
    if (signal.aborted || !original.size) throw new Error('photo_invalid');
    if (original.size > MAX_BYTES) throw new Error('photo_too_large');
    // Actual header must match the proposed upload MIME. HEIC is never relabeled.
    if (!matches(new Uint8Array(await header(original, signal)), type) || signal.aborted) throw new Error('photo_invalid');
    photo = original.type === type ? original : original.slice(0, original.size, type);
    let released = false;
    return { photo, previewUri: asset.uri, release() {
      if (released) return; released = true;
      if (photo !== original) close(photo); close(original);
      releasePreview(asset.uri);
    } };
  } catch (error) {
    if (photo !== original) close(photo); close(original);
    if (asset?.uri) releasePreview(asset.uri);
    throw new Error(error instanceof Error && error.message === 'photo_too_large' ? 'photo_too_large' : 'photo_invalid');
  }
}

export const expoMovementPhotoPicker: MovementPhotoPicker = {
  async pick(source, signal) {
    try {
      if (signal.aborted) return null;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (signal.aborted) return null;
        if (!permission.granted) return { kind: 'permission_denied' };
      }
      // The system photo-library picker needs no broad library permission for images.
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return null;
      if (signal.aborted) { result.assets.forEach(asset => releasePreview(asset.uri)); return null; }
      if (result.assets.length !== 1) throw new Error('photo_invalid');
      return { kind: 'selected', selected: await prepareSelectedPhoto(result.assets[0], signal) };
    } catch (error) {
      if (signal.aborted) return null;
      if (error && typeof error === 'object' && 'code' in error && [
        'E_PERMISSION_MISSING', 'ERR_MISSING_CAMERA_PERMISSION', 'ERR_USER_REJECTED_PERMISSIONS',
      ].includes(String(error.code))) return { kind: 'permission_denied' };
      throw new Error(error instanceof Error && error.message === 'photo_too_large' ? 'photo_too_large' : 'photo_invalid');
    }
  },
};
