import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMovementFaceVerification, useProfilePhotoVerification } from '../hooks/useVerification';
import type { MovementBiometricProvider, MovementPhotoPicker, PhotoSource, SelectedMovementPhoto } from '../providers/movementBiometricProvider';
import { safeVerificationError } from '../state/verificationState';
import type { VerificationError } from '../state/verificationState';
import { errorCopy, movementCopy, photoCopy } from './verificationCopy';

function Action({ title, onPress, disabled = false }: { title: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
export function ProfilePhotoVerificationCard({ picker }: { picker?: MovementPhotoPicker }) {
  const model = useProfilePhotoVerification(); const text = photoCopy(model.state);
  const [picking, setPicking] = useState(false); const [selectionError, setSelectionError] = useState<VerificationError | null>(null);
  const [draft, setDraft] = useState<SelectedMovementPhoto | null>(null);
  const [permissionSource, setPermissionSource] = useState<PhotoSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const selection = useRef({ alive: true, busy: false, uploading: false,
    accountGeneration: model.accountGeneration, abort: new AbortController(), draft: null as SelectedMovementPhoto | null });
  useEffect(() => {
    const lifecycle = { alive: true, busy: false, uploading: false,
      accountGeneration: model.accountGeneration, abort: new AbortController(), draft: null as SelectedMovementPhoto | null }; selection.current = lifecycle;
    setDraft(null); setPicking(false); setUploading(false); setSelectionError(null); setPermissionSource(null);
    return () => { lifecycle.alive = false; lifecycle.abort.abort();
      if (!lifecycle.uploading) lifecycle.draft?.release(); };
  }, [model.accountGeneration]);
  async function select(source: PhotoSource) {
    const lifecycle = selection.current;
    if (!picker || lifecycle.busy || !lifecycle.alive || lifecycle.accountGeneration !== model.accountGeneration || !model.signedIn || !model.state.loaded) return;
    lifecycle.abort = new AbortController(); const signal = lifecycle.abort.signal;
    lifecycle.busy = true; setPicking(true); setSelectionError(null); setPermissionSource(null);
    try {
      const result = await picker.pick(source, signal);
      if (!lifecycle.alive || signal.aborted) { if (result?.kind === 'selected') result.selected.release(); return; }
      if (result?.kind === 'permission_denied') setPermissionSource(source);
      if (result?.kind === 'selected') {
        lifecycle.draft?.release(); lifecycle.draft = result.selected; setDraft(result.selected);
      }
    }
    catch (e) { if (lifecycle.alive) setSelectionError(safeVerificationError(e)); }
    finally { lifecycle.busy = false; if (lifecycle.alive) setPicking(false); }
  }
  function cancelSelection() {
    const lifecycle = selection.current;
    if (lifecycle.uploading) return;
    lifecycle.abort.abort(); lifecycle.draft?.release(); lifecycle.draft = null;
    setDraft(null); setSelectionError(null); setPermissionSource(null);
  }
  async function upload() {
    const lifecycle = selection.current; const chosen = lifecycle.draft;
    if (!chosen || !lifecycle.alive || lifecycle.busy || lifecycle.accountGeneration !== model.accountGeneration || !model.signedIn) return;
    lifecycle.busy = true; lifecycle.uploading = true; setUploading(true); setSelectionError(null);
    try {
      const accepted = await model.submit(chosen.photo);
      if (accepted && lifecycle.alive) {
        chosen.release(); lifecycle.draft = null;
        if (lifecycle.alive) setDraft(null);
      }
    } catch (e) { if (lifecycle.alive) setSelectionError(safeVerificationError(e)); }
    finally {
      lifecycle.busy = false; lifecycle.uploading = false;
      if (!lifecycle.alive) { chosen.release(); lifecycle.draft = null; }
      else setUploading(false);
    }
  }
  const error = selectionError ?? model.state.error;
  // Hide the old account's local draft immediately, before effect cleanup runs.
  const currentDraft = selection.current.accountGeneration === model.accountGeneration ? draft : null;
  return <View style={styles.card}>
    <Text style={styles.title}>{text.title}</Text>
    {!model.signedIn ? <Text>Sign in to manage your photo.</Text> : <>
      <Text accessibilityLiveRegion="polite">{uploading ? 'Uploading photo…' : currentDraft ? 'Review your selected photo before uploading.'
        : model.state.loaded || model.state.phase !== 'none' ? text.body : 'Refresh to check your photo status.'}</Text>
      {!currentDraft && text.label && <Text style={styles.label}>{text.label}</Text>}
      <Text style={styles.note}>A prepared photo is not identity verification. A live face check is required before movement activation.</Text>
      {error && <Text accessibilityLiveRegion="polite">{errorCopy[error]}</Text>}
      {permissionSource && <Text accessibilityLiveRegion="polite">{permissionSource === 'camera'
        ? 'Camera permission was not granted. You can allow it in device settings or choose a photo instead.'
        : 'Photo access was not granted. You can allow it in device settings and try again.'}</Text>}
      {!picker && <Text style={styles.note}>Photo selection is not available in this build yet.</Text>}
      <Action title="Choose photo" onPress={() => { void select('library'); }}
        disabled={!picker || !model.state.loaded || picking || uploading || model.state.phase === 'submitting'} />
      <Action title="Take photo" onPress={() => { void select('camera'); }}
        disabled={!picker || !model.state.loaded || picking || uploading || model.state.phase === 'submitting'} />
      {currentDraft && <>
        <Image source={{ uri: currentDraft.previewUri }} accessibilityLabel="Selected photo preview" style={{ width: 220, height: 220, borderRadius: 12 }} />
        <Text style={styles.note}>Uploading replaces your movement identity photo. A new live face check will be required.</Text>
        <Action title={model.state.phase === 'verified' ? 'Replace and upload' : 'Upload photo'} onPress={() => { void upload(); }} disabled={uploading || picking} />
      </>}
      {(currentDraft || picking) && <Action title="Cancel selection" onPress={cancelSelection} disabled={uploading} />}
      <Action title="Refresh status" onPress={() => { void model.refresh(); }} disabled={uploading || model.state.phase === 'submitting'} />
    </>}
  </View>;
}
export function MovementFaceVerificationCard({ movementNeedId, provider, identityPhotoLink }: {
  movementNeedId: string; provider?: MovementBiometricProvider; identityPhotoLink?: ReactNode;
}) {
  const model = useMovementFaceVerification(movementNeedId, provider); const text = movementCopy(model.state);
  return <View style={styles.card}>
    <Text style={styles.title}>{text.title}</Text>
    {!model.signedIn ? <Text>Sign in to view your movement check.</Text> : <>
      <Text accessibilityLiveRegion="polite">{model.state.loaded ? text.body : 'Loading your movement check…'}</Text>
      {model.state.error && <Text accessibilityLiveRegion="polite">{errorCopy[model.state.error]}</Text>}
      <Text style={styles.note}>This is your check only. Payment remains subject to the platform's activation checks.</Text>
      <Text style={styles.note}>Your movement identity photo must be prepared before a live face check can start. Check its status if you cannot start.</Text>
      {identityPhotoLink}
      {text.canStart && <Action title={text.action} onPress={() => { void model.start(); }} disabled={!model.state.loaded} />}
      {['starting','provider_session_ready'].includes(model.state.phase) && <Action title="Cancel check" onPress={model.cancel} />}
      <Action title="Refresh status" onPress={() => { void model.refresh(); }} disabled={['starting','provider_session_ready'].includes(model.state.phase)} />
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 24, gap: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#dce2e8' },
  title: { fontSize: 22, fontWeight: '600', color: '#182b3a' }, note: { color: '#52616d', lineHeight: 21 },
  label: { color: '#245d49', fontWeight: '600' }, button: { padding: 14, borderRadius: 8, backgroundColor: '#203e51' },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600' }, disabled: { opacity: 0.45 },
});
