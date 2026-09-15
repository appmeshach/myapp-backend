import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { MovementFaceVerificationCard } from '../components/VerificationCards';
export default function MovementVerificationScreen() {
  const params = useLocalSearchParams<{ movementNeedId?: string | string[] }>();
  const { movementNeedId } = params;
  const valid = Object.keys(params).every(key => key === 'movementNeedId')
    && typeof movementNeedId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(movementNeedId);
  return <ScrollView contentContainerStyle={{ padding: 20 }}><Stack.Screen options={{ title: 'Movement face check' }} />
    {valid ? <MovementFaceVerificationCard key={movementNeedId} movementNeedId={movementNeedId}
      identityPhotoLink={<Link href="./identity-photo">Manage movement identity photo</Link>} />
      : <Text>Open a movement to view its face check.</Text>}
  </ScrollView>;
}
