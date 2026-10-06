import { Pressable, Text, View } from 'react-native';
import { useMovementEnd } from '../hooks/useMovementEnd';

export function MovementEnd({ movementNeedId }: { movementNeedId: string }) {
  const model = useMovementEnd(movementNeedId);
  const { status: s, busy, error } = model.state;
  return <View style={{ padding: 20, gap: 16 }}>
    <Text style={{ fontSize: 20 }}>Movement ending</Text>
    {busy ? <Text>Updating movement status...</Text> : s ? <>
      {s.endStatus === 'no_pending_end_request' && <>
        <Text>{s.journeyState === 'not_started' ? 'Ending before travel begins requires both people to agree that no travel took place.' : 'Both people must agree that the movement has ended.'}</Text>
        <Pressable accessibilityRole="button" onPress={() => { void model.requestEnd(); }}><Text>End movement</Text></Pressable>
      </>}
      {s.requestedByMe && <Text>{s.journeyState === 'not_started' ? 'Waiting for the other person to confirm that the movement will not take place.' : 'Waiting for the other person to confirm that the movement has ended.'}</Text>}
      {s.actionRequiredFromMe && <>
        <Text>{s.journeyState === 'not_started' ? 'The other person says this movement will not take place. Confirm only if travel has not started.' : 'The other person says the movement has ended.'}</Text>
        <Pressable accessibilityRole="button" onPress={() => { void model.confirmEnd(); }}><Text>Confirm movement ended</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void model.declineEnd(); }}><Text>Not yet</Text></Pressable>
      </>}
      {s.endStatus === 'completed' && <Text>Movement completed</Text>}
      {s.endStatus === 'mutual_no_travel' && <Text>Movement closed. No travel took place.</Text>}
      {s.fundingDisposition === 'released_to_me' && <Text>The held movement amount was returned to your Movement Balance.</Text>}
    </> : !error && <Text>Movement ending status unavailable.</Text>}
    {error && <Text accessibilityLiveRegion="polite">Unable to load movement ending status. Refresh and try again.</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void model.refresh(); }}><Text>Refresh movement ending status</Text></Pressable>
  </View>;
}
