import { Pressable, Text, View } from 'react-native';
import { useMovementDispute } from '../hooks/useMovementDispute';
export function MovementDispute({ movementNeedId }: { movementNeedId: string }) {
  const { state, refresh, openDispute } = useMovementDispute(movementNeedId);
  const s = state.status;
  return <View style={{ gap: 12 }}>
    {s?.active ? <Text accessibilityLiveRegion="polite">This movement is under review. The held movement amount remains on hold.</Text>
      : s?.canOpen ? <>
        <Text>Report a problem with this movement</Text>
        <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => { void openDispute('unable_to_agree'); }} style={{ padding: 16 }}>
          <Text>We cannot agree about this movement</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => { void openDispute('movement_concern'); }} style={{ padding: 16 }}>
          <Text>Report another movement concern</Text>
        </Pressable>
      </> : null}
    {state.error && <Text accessibilityLiveRegion="polite">Movement review is unavailable.</Text>}
    {(s || state.error) && <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => { void refresh(); }} style={{ padding: 16 }}><Text>Refresh movement review</Text></Pressable>}
  </View>;
}
