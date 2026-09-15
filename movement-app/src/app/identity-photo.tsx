import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { ProfilePhotoVerificationCard } from '../components/VerificationCards';
export default function IdentityPhotoScreen() {
  return <ScrollView contentContainerStyle={{ padding: 20 }}><Stack.Screen options={{ title: 'Movement identity photo' }} />
    <ProfilePhotoVerificationCard />
  </ScrollView>;
}
