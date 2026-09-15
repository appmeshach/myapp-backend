import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { ProfilePhotoVerificationCard } from '../components/VerificationCards';
import { expoMovementPhotoPicker } from '../providers/expoMovementPhotoPicker';
export default function IdentityPhotoScreen() {
  return <ScrollView contentContainerStyle={{ padding: 20 }}><Stack.Screen options={{ title: 'Movement identity photo' }} />
    <ProfilePhotoVerificationCard picker={expoMovementPhotoPicker} />
  </ScrollView>;
}
