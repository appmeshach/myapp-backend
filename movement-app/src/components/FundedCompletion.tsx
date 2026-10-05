import { Pressable, Text, View } from 'react-native';
import { useFundedCompletion } from '../hooks/useFundedCompletion';
export function FundedCompletion({ movementNeedId }: { movementNeedId: string }) {
  const model = useFundedCompletion(movementNeedId), s = model.state.status;
  return <View style={{ gap: 12 }}>
    {model.state.busy ? <Text>Updating movement completion...</Text> : s ? <>
      <Text>{s.settlementState === 'settled' ? 'Movement completed and settled.' : s.settlementState === 'awaiting_confirmation' ? 'Waiting for requester completion confirmation.' : 'Movement is in progress.'}</Text>
      {s.canRequestCompletion && <Pressable accessibilityRole="button" onPress={() => { void model.requestCompletion(); }}><Text>Request movement completion</Text></Pressable>}
      {s.canConfirmCompletion && <Pressable accessibilityRole="button" onPress={() => { void model.confirmCompletion(); }}><Text>Confirm movement completion</Text></Pressable>}
    </> : <Text>Movement completion unavailable.</Text>}
    {model.state.error && <Text accessibilityLiveRegion="polite">Unable to update completion. Refresh and try again.</Text>}
    <Pressable accessibilityRole="button" disabled={model.state.busy} onPress={() => { void model.refresh(); }}><Text>Refresh movement completion</Text></Pressable>
  </View>;
}
