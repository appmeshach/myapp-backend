import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { MovementFaceVerificationCard } from '../components/VerificationCards';
export default function MovementVerificationScreen() {
  const { movementNeedId } = useLocalSearchParams<{ movementNeedId?: string | string[] }>();
  const valid = typeof movementNeedId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(movementNeedId);
  return <ScrollView contentContainerStyle={{ padding: 20 }}><Stack.Screen options={{ title: 'Movement face check' }} />
    {valid ? <MovementFaceVerificationCard key={movementNeedId} movementNeedId={movementNeedId} />
      : <Text>Open a movement to view its face check.</Text>}
  </ScrollView>;
}
