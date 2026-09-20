import {
  Link,
  Redirect,
  Stack,
  router,
  useLocalSearchParams,
} from 'expo-router';

import { useEffect, useState } from 'react';

import {
  ScrollView,
  Text,
  View,
} from 'react-native';

import { ActivationPaymentCard } from '../components/ActivationPaymentCard';
import { MovementFaceVerificationCard } from '../components/VerificationCards';
import { getCurrentSession } from '../services/authService';

export default function MovementVerificationScreen() {
  const [sessionChecked, setSessionChecked] =
    useState(false);

  const [signedIn, setSignedIn] =
    useState(false);

  const params =
    useLocalSearchParams<{
      movementNeedId?: string | string[];
    }>();

  const { movementNeedId } = params;

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
    && typeof movementNeedId === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      movementNeedId,
    );

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
      }}
    >
      <Stack.Screen
        options={{
          title: 'Movement face check',
        }}
      />

      {valid ? (
        <>
          <MovementFaceVerificationCard
            key={movementNeedId}
            movementNeedId={movementNeedId}
            identityPhotoLink={
              <Link href="./identity-photo">
                Manage movement identity photo
              </Link>
            }
          />

          <ActivationPaymentCard
            key={`activation-${movementNeedId}`}
            movementNeedId={movementNeedId}
            onContinueJourney={() =>
              router.push({
                pathname: './movement-coordination',
                params: {
                  movementNeedId,
                },
              })
            }
          />
        </>
      ) : (
        <Text>
          Open a movement to view its face check.
        </Text>
      )}
    </ScrollView>
  );
}