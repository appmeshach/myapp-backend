import {
  Redirect,
  Stack,
  useLocalSearchParams,
} from 'expo-router';

import { useEffect, useState } from 'react';

import {
  ScrollView,
  Text,
  View,
} from 'react-native';

import { MovementCoordination } from '../components/MovementCoordination';
import { getCurrentSession } from '../services/authService';
import { validMovementNeed } from '../services/coordinationService';

export default function MovementCoordinationScreen() {
  const [sessionChecked, setSessionChecked] =
    useState(false);

  const [signedIn, setSignedIn] =
    useState(false);

  const params =
    useLocalSearchParams<{
      movementNeedId?: string | string[];
    }>();

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

  const valid =
    Object.keys(params).every(
      key => key === 'movementNeedId',
    )
    && validMovementNeed(
      params.movementNeedId,
    );

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
      }}
    >
      <Stack.Screen
        options={{
          title: 'Movement coordination',
        }}
      />

      {valid ? (
        <MovementCoordination
          key={params.movementNeedId as string}
          movementNeedId={
            params.movementNeedId as string
          }
        />
      ) : (
        <Text>
          Movement coordination is unavailable.
        </Text>
      )}
    </ScrollView>
  );
}