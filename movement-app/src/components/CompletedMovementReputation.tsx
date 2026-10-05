import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCompletedMovementReputation } from '../hooks/useCompletedMovementReputation';
function RatingPanel({ movementNeedId }: { movementNeedId: string }) {
  const { state, select, submit, refresh } = useCompletedMovementReputation(movementNeedId);
  if (state.busy && !state.target) return <Text>Loading rating options...</Text>;
  if (!state.target) return <View><Text>Rating is unavailable for this movement.</Text>
    <Pressable accessibilityRole="button" onPress={() => { void refresh(); }}><Text>Retry rating options</Text></Pressable></View>;
  const target = state.target;
  return <View style={{ gap: 8 }}>
    <Text>{target.firstName ?? (target.personRole === 'offering_member' ? 'The person who offered the movement' : 'The person who requested the movement')}</Text>
    {target.alreadyRated ? <Text>Submitted: {target.myStars} out of 5 stars</Text> : <>
      <Text>Choose a rating from 1 to 5 stars.</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>{[1, 2, 3, 4, 5].map(stars => <Pressable key={stars} accessibilityRole="button"
        accessibilityLabel={`${stars} ${stars === 1 ? 'star' : 'stars'}`} accessibilityState={{ selected: state.selected === stars, disabled: state.busy }}
        disabled={state.busy} onPress={() => select(stars)}><Text>{state.selected === stars ? '★' : '☆'} {stars}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" disabled={state.busy || state.selected === null} onPress={() => { void submit(); }}><Text>{state.busy ? 'Submitting...' : 'Submit rating'}</Text></Pressable>
    </>}
    {state.error && <Text accessibilityLiveRegion="polite">The rating could not be saved. Please retry.</Text>}
  </View>;
}
export function CompletedMovementReputation({ movementNeedId }: { movementNeedId: string }) {
  const [open, setOpen] = useState(false);
  return open ? <RatingPanel movementNeedId={movementNeedId} /> : <Pressable accessibilityRole="button" onPress={() => setOpen(true)}><Text>View rating options</Text></Pressable>;
}
