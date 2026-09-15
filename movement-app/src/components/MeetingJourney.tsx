import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useMeetingJourney } from '../hooks/useMeetingJourney';
function PlaceEditor({ text, save }: { text: string; save(text: string): Promise<void> }) {
  const [draft, setDraft] = useState(text);
  return <View style={{ gap: 8 }}><TextInput accessibilityLabel="Meeting point" value={draft} onChangeText={setDraft} maxLength={200} placeholder="Human-readable meeting place" />
    <Pressable accessibilityRole="button" disabled={!draft.trim()} onPress={() => { void save(draft); }}><Text>{text ? 'Change meeting point' : 'Set meeting point'}</Text></Pressable></View>;
}
export function MeetingJourney({ movementNeedId }: { movementNeedId: string }) {
  const model = useMeetingJourney(movementNeedId); const s = model.state.status;
  return <View style={{ padding: 20, gap: 16 }}>
    <Text style={{ fontSize: 20 }}>Meeting point</Text>
    {model.state.busy ? <Text>Updating coordination...</Text> : s ? <>
      <Text>{s.meetingPointText ?? 'No meeting point has been set yet.'}</Text>
      {s.canEditMeetingPoint && <PlaceEditor key={s.meetingPointRevision ?? 'new'} text={s.meetingPointText ?? ''} save={model.save} />}
      <Text style={{ fontSize: 20 }}>Journey</Text>
      <Text>{s.journeyState === 'in_progress' ? 'Journey started' : s.journeyState === 'completed' ? 'Journey completed' : s.startRequestedAt ? 'Waiting for start confirmation' : 'Journey has not started.'}</Text>
      {s.canRequestStart && <Pressable accessibilityRole="button" onPress={() => { void model.requestStart(); }}><Text>Start journey</Text></Pressable>}
      {s.canConfirmStart && <Pressable accessibilityRole="button" onPress={() => { void model.confirmStart(); }}><Text>Confirm start</Text></Pressable>}
    </> : <Text>Meeting point and journey status unavailable.</Text>}
    {model.state.error && <Text accessibilityLiveRegion="polite">{model.state.error === 'conflict' ? 'The meeting point changed. Refresh before trying again.' : 'Unable to update coordination. Refresh and try again.'}</Text>}
    <Pressable accessibilityRole="button" disabled={model.state.busy} onPress={() => { void model.refresh(); }}><Text>Refresh meeting point and journey</Text></Pressable>
  </View>;
}
