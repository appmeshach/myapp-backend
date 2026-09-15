import { Image, Pressable, Text, View } from 'react-native';
import { useMovementCoordination } from '../hooks/useMovementCoordination';
import { MeetingJourney } from './MeetingJourney';
export function MovementCoordination({ movementNeedId }: { movementNeedId: string }) {
  const { state, refresh } = useMovementCoordination(movementNeedId);
  return <View style={{ gap: 20 }}>
    {state.phase !== 'ready' || !state.reveal ? <Text accessibilityLiveRegion="polite">{
      state.phase === 'signed_out' ? 'Sign in to view movement coordination.' : state.phase === 'loading' ? 'Loading movement coordination.'
        : state.phase === 'error' ? 'Unable to load coordination. Please try again.' : 'Movement coordination is unavailable.'
    }</Text> : <>
      <Text style={{ fontSize: 24, fontWeight: '600' }}>Movement activated</Text>
      <Text>People you are moving with</Text>
      {state.reveal.people.map(p => <View key={p.personNumber} style={{ padding: 20, gap: 8, backgroundColor: '#fff', borderRadius: 12 }}>
        {p.photoUri ? <Image source={{ uri: p.photoUri }} style={{ width: 160, height: 160, borderRadius: 12 }} accessibilityLabel="Verified profile photo" /> : <Text>Profile photo unavailable</Text>}
        {p.firstName && <Text style={{ fontSize: 20 }}>{p.firstName}</Text>}
        {p.age !== null && <Text>Age: {p.age}</Text>}
        {p.verified && <Text>Verified</Text>}
        {p.rating !== null && <Text>Rating: {p.rating}</Text>}
        <Text>Completed movements: {p.completedMovements}</Text>
      </View>)}
      {state.reveal.vehicle && <View style={{ padding: 20, gap: 8, backgroundColor: '#fff', borderRadius: 12 }}>
        <Text>Vehicle to expect</Text><Text>{state.reveal.vehicle.vehicleDisplayName}</Text><Text>{state.reveal.vehicle.plateNumber}</Text>
      </View>}
      <MeetingJourney movementNeedId={movementNeedId} />
      <Text>Chat and journey completion controls are not available in this build yet.</Text>
    </>}
    <Pressable accessibilityRole="button" disabled={state.phase === 'loading' || state.phase === 'signed_out'}
      onPress={() => { void refresh(); }} style={{ padding: 16 }}><Text>Refresh coordination</Text></Pressable>
  </View>;
}
