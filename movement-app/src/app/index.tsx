import { useEffect, useState } from 'react';

import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Link } from 'expo-router';

import {
  getCurrentSession,
  signInWithEmail,
  signOut,
} from '../services/authService';

export default function Index() {
  const [email, setEmail] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [signedIn, setSignedIn] =
    useState(false);

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState('');

  useEffect(() => {
    let active = true;

    void getCurrentSession()
      .then(session => {
        if (!active) {
          return;
        }

        setSignedIn(!!session);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setSignedIn(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSignIn() {
    setBusy(true);
    setMessage('');

    try {
      await signInWithEmail(
        email,
        password,
      );

      setSignedIn(true);
      setPassword('');
      setMessage('Signed in.');
    } catch (error) {
      setSignedIn(false);

      setMessage(
        error instanceof Error
          ? error.message
          : 'Sign in failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setMessage('');

    try {
      await signOut();

      setSignedIn(false);
      setEmail('');
      setPassword('');
      setMessage('Signed out.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Sign out failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Movement
      </Text>

      {!signedIn ? (
        <View style={styles.authSection}>
          <Text style={styles.sectionTitle}>
            Sign in
          </Text>

          <TextInput
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!busy}
            style={styles.input}
          />

          <TextInput
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            editable={!busy}
            style={styles.input}
          />

          <Pressable
            accessibilityRole="button"
            disabled={
              busy
              || !email.trim()
              || !password
            }
            onPress={() => {
              void handleSignIn();
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {busy
                ? 'Signing in...'
                : 'Sign in'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.authSection}>
          <Text>
            Signed in
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void handleSignOut();
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              Sign out
            </Text>
          </Pressable>
        </View>
      )}

      {!!message && (
        <Text style={styles.message}>
          {message}
        </Text>
      )}

            {signedIn && (
        <>
          <Link href="./offer-movement">
  Offer movement I am already making
</Link>

<Link href="./request-movement">
  Request movement I need
</Link>

<Link href="./identity-photo">
            Manage movement identity photo
          </Link>

          <Link href="./movement-verification">
            Movement face checks
          </Link>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
  },

  authSection: {
    width: '100%',
    maxWidth: 420,
    gap: 12,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },

  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },

  button: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#111',
  },

  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },

  message: {
    fontSize: 14,
  },
});