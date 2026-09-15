import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMovementFaceVerification, useProfilePhotoVerification } from '../hooks/useVerification';
import type { MovementBiometricProvider, MovementPhotoPicker } from '../providers/movementBiometricProvider';
import { safeVerificationError, ownPaymentReadiness } from '../state/verificationState';
import type { VerificationError } from '../state/verificationState';
import { errorCopy, movementCopy, photoCopy } from './verificationCopy';

function Action({ title, onPress, disabled = false }: { title: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
export function ProfilePhotoVerificationCard({ picker }: { picker?: MovementPhotoPicker }) {
  const model = useProfilePhotoVerification(); const text = photoCopy(model.state);
  const [picking, setPicking] = useState(false); const [selectionError, setSelectionError] = useState<VerificationError | null>(null);
  const selection = useRef({ alive: true, busy: false });
  useEffect(() => {
    const lifecycle = { alive: true, busy: false }; selection.current = lifecycle;
    return () => { lifecycle.alive = false; };
  }, []);
  async function select() {
    const lifecycle = selection.current;
    if (!picker || lifecycle.busy || !lifecycle.alive) return;
    lifecycle.busy = true; setPicking(true); setSelectionError(null);
    try { const photo = await picker.pick(); if (photo && lifecycle.alive) await model.submit(photo); }
    catch (e) { if (lifecycle.alive) setSelectionError(safeVerificationError(e)); }
    finally { lifecycle.busy = false; if (lifecycle.alive) setPicking(false); }
  }
  const error = selectionError ?? model.state.error;
  return <View style={styles.card}>
    <Text style={styles.title}>{text.title}</Text>
    {!model.signedIn ? <Text>Sign in to manage your photo.</Text> : <>
      <Text accessibilityLiveRegion="polite">{model.state.loaded || model.state.phase !== 'none' ? text.body : 'Refresh to check your photo status.'}</Text>
      {text.label && <Text style={styles.label}>{text.label}</Text>}
      <Text style={styles.note}>A prepared photo is not identity verification. A live face check is required before movement activation.</Text>
      {error && <Text accessibilityLiveRegion="polite">{errorCopy[error]}</Text>}
      {!picker && <Text style={styles.note}>Photo selection is not available in this build yet.</Text>}
      <Action title={model.state.phase === 'none' ? 'Choose photo' : 'Replace photo'} onPress={() => { void select(); }}
        disabled={!picker || !model.state.loaded || picking || model.state.phase === 'submitting'} />
      <Action title="Refresh status" onPress={() => { void model.refresh(); }} disabled={model.state.phase === 'submitting'} />
    </>}
  </View>;
}
export function MovementFaceVerificationCard({ movementNeedId, provider }: { movementNeedId: string; provider?: MovementBiometricProvider }) {
  const model = useMovementFaceVerification(movementNeedId, provider); const text = movementCopy(model.state);
  return <View style={styles.card}>
    <Text style={styles.title}>{text.title}</Text>
    {!model.signedIn ? <Text>Sign in to view your movement check.</Text> : <>
      <Text accessibilityLiveRegion="polite">{text.body}</Text>
      {model.state.error && <Text accessibilityLiveRegion="polite">{errorCopy[model.state.error]}</Text>}
      {ownPaymentReadiness(model.state) === 'current_member_ready' && <Text style={styles.label}>Your check is ready</Text>}
      <Text style={styles.note}>This is your check only. The platform confirms all required checks before payment can begin.</Text>
      {text.canStart && <Action title={text.action} onPress={() => { void model.start(); }} disabled={!model.state.loaded} />}
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
