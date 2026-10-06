import { Pressable, Text, View } from 'react-native';
import { useFundedCompletion } from '../hooks/useFundedCompletion';
export function FundedCompletion({ movementNeedId }: { movementNeedId: string }) {
  const model = useFundedCompletion(movementNeedId), s = model.state.status;
  return <View style={{ gap: 12 }}>
    {model.state.busy ? <Text>Updating movement completion...</Text> : s ? <>
      <Text>{s.settlementState === 'settled' ? 'Movement completed and settled.' : s.disputeActive ? 'This movement is under review. The held movement amount remains on hold.' : s.settlementState === 'awaiting_confirmation' ? 'Waiting for requester completion confirmation.' : 'Movement is in progress.'}</Text>
      {s.responseDeadlineAt && s.settlementState === 'awaiting_confirmation' && <>
        <Text>Requester response deadline: {s.responseDeadlineAt}</Text>
        <Text>If no dispute is made before the response period ends, the movement will be treated as completed.</Text>
      </>}
      {s.canRequestCompletion && <Pressable accessibilityRole="button" onPress={() => { void model.requestCompletion(); }}><Text>Request movement completion</Text></Pressable>}
      {s.canConfirmCompletion && <Pressable accessibilityRole="button" onPress={() => { void model.confirmCompletion(); }}><Text>Confirm completed</Text></Pressable>}
      {s.canDisputeCompletion && <Pressable accessibilityRole="button" onPress={() => { void model.disputeCompletion(); }}><Text>Dispute</Text></Pressable>}
    </> : <Text>Movement completion unavailable.</Text>}
    {model.state.error && <Text accessibilityLiveRegion="polite">Unable to update completion. Refresh and try again.</Text>}
    <Pressable accessibilityRole="button" disabled={model.state.busy} onPress={() => { void model.refresh(); }}><Text>Refresh movement completion</Text></Pressable>
  </View>;
}
