import { Pressable, Text, View } from 'react-native';
import { useActivationPayment } from '../hooks/useActivationPayment';
import { paymentCopy } from '../state/activationPaymentState';

// Navigation follows the explicit authoritative entry; no internal IDs leave it.
export function ActivationPaymentCard({ movementNeedId, onContinueJourney }: {
  movementNeedId: string; onContinueJourney?: () => void;
}) {
  const model = useActivationPayment(movementNeedId);
  const busy = model.state === 'preparing_activation';
  const activated = model.fundedActivated || model.legacyCoordinationReady || model.state === 'activated';
  return <View style={{ padding: 24, gap: 16, marginTop: 20, backgroundColor: '#fff', borderRadius: 16 }}>
    <Text style={{ fontSize: 22, fontWeight: '600' }}>Movement activation</Text>
    {!model.signedIn ? <Text>Sign in to continue activation.</Text> : <>
      <Text accessibilityLiveRegion="polite">{activated ? paymentCopy.activated : paymentCopy[model.state]}</Text>
      <Text>Your live face check applies to you only. The platform checks whether activation can proceed.</Text>
      {!activated && model.state === 'payment_provider_unavailable' && <Text>Activation setup is not available in this build yet. You can try again later.</Text>}
      {!activated && <Pressable accessibilityRole="button" disabled={busy || !model.active}
        accessibilityState={{ disabled: busy || !model.active }} onPress={() => { void model.start(); }}
        style={{ padding: 14, backgroundColor: '#203e51', borderRadius: 8, opacity: busy ? 0.45 : 1 }}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>{busy ? 'Preparing activation' : model.state === 'idle' ? 'Continue activation' : 'Try activation again'}</Text>
      </Pressable>}
      {model.coordinationState === 'unavailable' && <Text>Movement coordination is unavailable. Try again.</Text>}
      {activated && onContinueJourney && <Pressable accessibilityRole="button"
        disabled={!model.active || model.coordinationState === 'opening'}
        accessibilityState={{ disabled: !model.active || model.coordinationState === 'opening' }}
        onPress={() => { void model.continueCoordination(onContinueJourney); }}>
        <Text>{model.coordinationState === 'opening' ? 'Opening movement coordination' : 'Continue to movement coordination'}</Text>
      </Pressable>}
    </>}
  </View>;
}
