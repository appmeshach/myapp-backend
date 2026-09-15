import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { MovementCoordination } from '../components/MovementCoordination';
import { validMovementNeed } from '../services/coordinationService';
export default function MovementCoordinationScreen() {
  const params = useLocalSearchParams<{ movementNeedId?: string | string[] }>();
  const valid = Object.keys(params).every(key => key === 'movementNeedId') && validMovementNeed(params.movementNeedId);
  return <ScrollView contentContainerStyle={{ padding: 20 }}><Stack.Screen options={{ title: 'Movement coordination' }} />
    {valid ? <MovementCoordination key={params.movementNeedId as string} movementNeedId={params.movementNeedId as string} /> : <Text>Movement coordination is unavailable.</Text>}
  </ScrollView>;
}
