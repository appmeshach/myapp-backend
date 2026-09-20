import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
} from 'react-native';

import { ProfilePhotoVerificationCard } from '../components/VerificationCards';
import { expoMovementPhotoPicker } from '../providers/expoMovementPhotoPicker';
import { getCurrentSession } from '../services/authService';

export default function IdentityPhotoScreen() {
  const [sessionChecked, setSessionChecked] =
    useState(false);

  const [signedIn, setSignedIn] =
    useState(false);

  useEffect(() => {
    let active = true;

    void getCurrentSession()
      .then(session => {
        if (!active) {
          return;
        }

        setSignedIn(!!session);
        setSessionChecked(true);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setSignedIn(false);
        setSessionChecked(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!sessionChecked) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text>Checking sign in...</Text>
      </View>
    );
  }

  if (!signedIn) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
      }}
    >
      <Stack.Screen
        options={{
          title: 'Movement identity photo',
        }}
      />

      <ProfilePhotoVerificationCard
        picker={expoMovementPhotoPicker}
      />
    </ScrollView>
  );
}