import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Redirect } from 'expo-router';

import { getCurrentSession } from '../services/authService';

import {
  recoverSelectedLocation,
  resolveSelectedLocation,
  searchMovementLocations,
  selectMovementLocation,
  type MovementLocationSuggestion,
} from '../services/locationService';

import {
  createOfferingMovementIntent,
  generateOfferingRoute,
} from '../services/offeringMovementService';

type TrustedLocation = {
  label: string;
  resolvedLocationReferenceId: string;
};

export default function OfferMovementScreen() {
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

  const [originQuery, setOriginQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');

  const [originSuggestions, setOriginSuggestions] =
    useState<MovementLocationSuggestion[]>([]);

  const [destinationSuggestions, setDestinationSuggestions] =
    useState<MovementLocationSuggestion[]>([]);

  const [origin, setOrigin] =
    useState<TrustedLocation | null>(null);

  const [destination, setDestination] =
    useState<TrustedLocation | null>(null);

    const [departureText, setDepartureText] = useState('');

  const [requestId, setRequestId] =
    useState(() => Crypto.randomUUID());

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function searchOrigin() {
    setBusy(true);
    setMessage('');

    try {
      const result =
        await searchMovementLocations(originQuery);

      setOriginSuggestions(result.suggestions);
    } catch (error) {
      setOriginSuggestions([]);

      setMessage(
        error instanceof Error
          ? error.message
          : 'location_search_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  async function searchDestination() {
    setBusy(true);
    setMessage('');

    try {
      const result =
        await searchMovementLocations(destinationQuery);

      setDestinationSuggestions(result.suggestions);
    } catch (error) {
      setDestinationSuggestions([]);

      setMessage(
        error instanceof Error
          ? error.message
          : 'location_search_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  async function trustSuggestion(
    suggestion: MovementLocationSuggestion,
  ): Promise<TrustedLocation> {
    let selected;

    try {
      selected =
        await selectMovementLocation(
          suggestion.selectionProof,
        );
    } catch {
      selected =
        await recoverSelectedLocation(
          suggestion.selectionRequestId,
        );
    }

    const resolved =
      await resolveSelectedLocation(
        selected.locationReferenceId,
      );

    return {
      label: selected.declaredLabel,
      resolvedLocationReferenceId:
        resolved.resolvedLocationReferenceId,
    };
  }

  async function chooseOrigin(
    suggestion: MovementLocationSuggestion,
  ) {
    setBusy(true);
    setMessage('');

    try {
      const trusted =
        await trustSuggestion(suggestion);

      setOrigin(trusted);
      setOriginQuery(trusted.label);
      setOriginSuggestions([]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'location_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  async function chooseDestination(
    suggestion: MovementLocationSuggestion,
  ) {
    setBusy(true);
    setMessage('');

    try {
      const trusted =
        await trustSuggestion(suggestion);

      setDestination(trusted);
      setDestinationQuery(trusted.label);
      setDestinationSuggestions([]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'location_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitMovement() {
    setMessage('');

    if (!origin || !destination) {
      setMessage(
        'Choose a trusted origin and destination first.',
      );
      return;
    }

    const departure =
      new Date(departureText);

    if (
      !departureText.trim()
      || !Number.isFinite(departure.getTime())
    ) {
      setMessage(
        'Enter a valid departure date and time.',
      );
      return;
    }

    setBusy(true);

    try {
      const created =
        await createOfferingMovementIntent({
                    requestId,

          originLocationReferenceId:
            origin.resolvedLocationReferenceId,

          destinationLocationReferenceId:
            destination.resolvedLocationReferenceId,

          earliestDepartureAt:
            departure.toISOString(),

          latestDepartureAt:
            null,
        });

      const route =
        await generateOfferingRoute(
          created.offeringMovementIntentId,
        );

            if (route.state === 'ready') {
        setMessage(
          'Movement declared and trusted route created.',
        );

        setRequestId(
          Crypto.randomUUID(),
        );

        return;
      }

      setMessage(
        route.state === 'route_generation_in_progress'
          ? `Route generation is already in progress. Retry after ${route.retryAfterSeconds} seconds.`
          : `Route generation is temporarily limited. Retry after ${route.retryAfterSeconds} seconds.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'movement_declaration_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

    if (!sessionChecked) {
    return (
      <View style={styles.guard}>
        <Text>Checking sign in...</Text>
      </View>
    );
  }

  if (!signedIn) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>
        Offer movement
      </Text>

      <Text style={styles.description}>
        Declare movement you are already making.
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>
          Origin
        </Text>

        <TextInput
          accessibilityLabel="Movement origin"
          value={originQuery}
          onChangeText={text => {
            setOriginQuery(text);
            setOrigin(null);
            setOriginSuggestions([]);
          }}
          placeholder="Search where you are leaving from"
          autoCapitalize="words"
          editable={!busy}
          style={styles.input}
        />

        <Pressable
          accessibilityRole="button"
          disabled={
            busy
            || !originQuery.trim()
          }
          onPress={() => {
            void searchOrigin();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            Search origin
          </Text>
        </Pressable>

        {originSuggestions.map(suggestion => (
          <Pressable
            key={suggestion.selectionRequestId}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void chooseOrigin(suggestion);
            }}
            style={styles.suggestion}
          >
            <Text>
              {suggestion.declaredLabel}
            </Text>
          </Pressable>
        ))}

        {origin && (
          <Text style={styles.confirmed}>
            Selected: {origin.label}
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          Destination
        </Text>

        <TextInput
          accessibilityLabel="Movement destination"
          value={destinationQuery}
          onChangeText={text => {
            setDestinationQuery(text);
            setDestination(null);
            setDestinationSuggestions([]);
          }}
          placeholder="Search where you are going"
          autoCapitalize="words"
          editable={!busy}
          style={styles.input}
        />

        <Pressable
          accessibilityRole="button"
          disabled={
            busy
            || !destinationQuery.trim()
          }
          onPress={() => {
            void searchDestination();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            Search destination
          </Text>
        </Pressable>

        {destinationSuggestions.map(suggestion => (
          <Pressable
            key={suggestion.selectionRequestId}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void chooseDestination(suggestion);
            }}
            style={styles.suggestion}
          >
            <Text>
              {suggestion.declaredLabel}
            </Text>
          </Pressable>
        ))}

        {destination && (
          <Text style={styles.confirmed}>
            Selected: {destination.label}
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          Earliest departure
        </Text>

        <TextInput
          accessibilityLabel="Earliest departure"
          value={departureText}
          onChangeText={setDepartureText}
          placeholder="Example: 2026-09-19 18:30"
          editable={!busy}
          style={styles.input}
        />

        <Text style={styles.help}>
          Enter your local departure date and time.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={
          busy
          || !origin
          || !destination
          || !departureText.trim()
        }
        onPress={() => {
          void submitMovement();
        }}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>
          {busy
            ? 'Working...'
            : 'Declare this movement'}
        </Text>
      </Pressable>

      {!!message && (
        <Text style={styles.message}>
          {message}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 24,
  },

  title: {
    fontSize: 28,
    fontWeight: '700',
  },

  description: {
    fontSize: 16,
  },

  section: {
    gap: 10,
  },

  label: {
    fontSize: 17,
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
  },

  buttonText: {
    fontWeight: '600',
  },

  suggestion: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },

  confirmed: {
    fontWeight: '600',
  },

  help: {
    fontSize: 13,
  },

  primaryButton: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#111',
  },

  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },

    message: {
    fontSize: 15,
  },

  guard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});