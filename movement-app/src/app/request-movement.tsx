import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
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

import { createMovementNeed } from '../services/movementService';

import {
  calculateRouteMatch,
  discoverOfferingMovementAvailability,
  type DiscoverableOfferingMovement,
  type RouteMatchReady,
} from '../services/offeringMovementService';

type TrustedLocation = {
  label: string;
  resolvedLocationReferenceId: string;
};

type DepartureOption = {
  label: string;
  value: string;
};

function buildDepartureOptions(): DepartureOption[] {
  const now = new Date();

  const firstOption = new Date(now);
  firstOption.setSeconds(0, 0);
  firstOption.setMinutes(
    firstOption.getMinutes() + 1,
  );

  const latestAllowed =
    now.getTime() + 24 * 60 * 60 * 1000;

  const options: DepartureOption[] = [];

  for (
    let time = firstOption.getTime();
    time <= latestAllowed;
    time += 60 * 1000
  ) {
    const date = new Date(time);

    options.push({
      value: date.toISOString(),
      label: date.toLocaleString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
  }

  return options;
}

export default function RequestMovementScreen() {
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

  const [originQuery, setOriginQuery] =
    useState('');

  const [destinationQuery, setDestinationQuery] =
    useState('');

  const [originSuggestions, setOriginSuggestions] =
    useState<MovementLocationSuggestion[]>([]);

  const [
    destinationSuggestions,
    setDestinationSuggestions,
  ] = useState<MovementLocationSuggestion[]>([]);

  const [origin, setOrigin] =
    useState<TrustedLocation | null>(null);

  const [destination, setDestination] =
    useState<TrustedLocation | null>(null);

    const [departure, setDeparture] =
    useState<DepartureOption | null>(null);

  const [departureOptions, setDepartureOptions] =
    useState<DepartureOption[]>([]);

  const [departurePickerOpen, setDeparturePickerOpen] =
    useState(false);

  const [peopleCountText, setPeopleCountText] =
    useState('1');

  const [requestId, setRequestId] =
    useState(() => Crypto.randomUUID());

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState('');

  const [offeredMovements, setOfferedMovements] =
    useState<DiscoverableOfferingMovement[]>([]);

  const [offeredMovementsLoading, setOfferedMovementsLoading] =
    useState(false);

  const [offeredMovementsMessage, setOfferedMovementsMessage] =
    useState('');

  const [activeMovementNeedId, setActiveMovementNeedId] =
    useState<string | null>(null);

  const [selectedAvailabilityId, setSelectedAvailabilityId] =
    useState<string | null>(null);

  const [requesterRouteMatch, setRequesterRouteMatch] =
    useState<RouteMatchReady | null>(null);

  const loadOfferedMovements = useCallback(async function loadOfferedMovements() {
    setOfferedMovementsLoading(true);
    setOfferedMovementsMessage('');
    try {
      const rows = await discoverOfferingMovementAvailability();
      setOfferedMovements(rows);
      if (rows.length === 0) {
        setOfferedMovementsMessage('No offered movements are available right now.');
      }
    } catch {
      setOfferedMovements([]);
      setOfferedMovementsMessage('Offered movements could not be loaded right now.');
    } finally {
      setOfferedMovementsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) {
      void loadOfferedMovements();
    }
  }, [signedIn, loadOfferedMovements]);

    async function checkOfferedMovement(
    availabilityId: string,
  ) {
    setMessage('');
    setRequesterRouteMatch(null);
    setSelectedAvailabilityId(
      availabilityId,
    );

    if (!activeMovementNeedId) {
      setMessage(
        'Create your movement request first. You can browse available movements before creating one, but a trusted request is required to check the route relationship.',
      );

      return;
    }

    setBusy(true);

    try {
      const match =
        await calculateRouteMatch(
          activeMovementNeedId,
          {
            availabilityId,
          },
        );

      setRequesterRouteMatch(match);

      const distanceKm =
        (
          match
            .straightLineDistanceFromRouteMeters
          / 1000
        ).toFixed(1);

      setMessage(
        `Your origin is approximately ${distanceKm} km from this movement's route.`,
      );
    } catch (error) {
      setRequesterRouteMatch(null);

      setMessage(
        error instanceof Error
          ? error.message
          : 'route_match_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

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

      setDestinationSuggestions(
        result.suggestions,
      );
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

    function openDeparturePicker() {
    setDepartureOptions(
      buildDepartureOptions(),
    );

    setDeparturePickerOpen(true);
  }

  async function submitMovementNeed() {
    setMessage('');

    if (!origin || !destination) {
      setMessage(
        'Choose a trusted origin and destination first.',
      );

      return;
    }

    if (!departure) {
      setMessage(
        'Choose your earliest departure time.',
      );

      return;
    }

    const peopleCount =
      Number(peopleCountText);

    if (
      !Number.isInteger(peopleCount)
      || peopleCount < 1
    ) {
      setMessage(
        'Enter a valid number of people.',
      );

      return;
    }

    setBusy(true);

    try {
      const created =
        await createMovementNeed({
          requestId,

          originLocationReferenceId:
            origin.resolvedLocationReferenceId,

          destinationLocationReferenceId:
            destination.resolvedLocationReferenceId,

          earliestDepartureAt:
            departure.value,

          latestDepartureAt:
            null,

          peopleCount,
        });

      setActiveMovementNeedId(
        created.movementNeedId,
      );

      setSelectedAvailabilityId(null);
      setRequesterRouteMatch(null);

      setMessage(
        'Movement request created. You can now privately check the route relationship of an available movement.',
      );

      setOrigin(null);
      setDestination(null);
      setOriginQuery('');
      setDestinationQuery('');
      setOriginSuggestions([]);
      setDestinationSuggestions([]);
      setDeparture(null);
      setPeopleCountText('1');

      setRequestId(
        Crypto.randomUUID(),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'movement_request_unavailable',
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
    <ScrollView
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>
        Request movement
      </Text>

      <Text style={styles.description}>
        Tell us where you need to move.
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>Available movements</Text>
        <Text style={styles.help}>
          Browse movement that members are already making.
        </Text>

        {offeredMovementsLoading && (
          <Text style={styles.help}>Loading available movements...</Text>
        )}
        {!!offeredMovementsMessage && (
          <Text style={styles.message}>{offeredMovementsMessage}</Text>
        )}

        {offeredMovements.map(movement => (
          <Pressable
            key={movement.availabilityId}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void checkOfferedMovement(
                movement.availabilityId,
              );
            }}
            style={[
              styles.offeredMovementCard,
              selectedAvailabilityId
                === movement.availabilityId
                && styles.offeredMovementCardSelected,
            ]}
          >
            <Text style={styles.confirmed}>
              {movement.originArea}
              {' \u2192 '}
              {movement.destinationArea}
            </Text>

            <Text style={styles.help}>
              Earliest:{' '}
              {new Date(
                movement.earliestDepartureAt,
              ).toLocaleString()}
            </Text>

            {movement.latestDepartureAt && (
              <Text style={styles.help}>
                Latest:{' '}
                {new Date(
                  movement.latestDepartureAt,
                ).toLocaleString()}
              </Text>
            )}

            <Text>
              {movement.remainingPlaces}{' '}
              {movement.remainingPlaces === 1
                ? 'place'
                : 'places'}{' '}
              available
            </Text>

            <Text>
              {movement.make}
              {movement.model
                ? ` ${movement.model}`
                : ''}
              {movement.year !== null
                ? ` \u2022 ${movement.year}`
                : ''}
            </Text>

            <Text>
              {movement.color}
            </Text>

            {selectedAvailabilityId
              === movement.availabilityId
              && requesterRouteMatch && (
                <>
                  <Text style={styles.confirmed}>
                    Route relationship
                  </Text>

                  <Text style={styles.help}>
                    Your origin is approximately{' '}
                    {(
                      requesterRouteMatch
                        .straightLineDistanceFromRouteMeters
                      / 1000
                    ).toFixed(1)}{' '}
                    km from this movement&apos;s route.
                  </Text>

                  <Text style={styles.help}>
                    This is an objective route fact, not an automatic acceptance or rejection.
                  </Text>
                </>
              )}
          </Pressable>
        ))}

        <Pressable
          accessibilityRole="button"
          disabled={offeredMovementsLoading}
          onPress={() => { void loadOfferedMovements(); }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Refresh available movements</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          Origin
        </Text>

        <TextInput
          accessibilityLabel="Movement request origin"
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

        {originSuggestions.map(
          suggestion => (
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
          ),
        )}

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
          accessibilityLabel="Movement request destination"
          value={destinationQuery}
          onChangeText={text => {
            setDestinationQuery(text);
            setDestination(null);
            setDestinationSuggestions([]);
          }}
          placeholder="Search where you need to go"
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

        {destinationSuggestions.map(
          suggestion => (
            <Pressable
              key={suggestion.selectionRequestId}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                void chooseDestination(
                  suggestion,
                );
              }}
              style={styles.suggestion}
            >
              <Text>
                {suggestion.declaredLabel}
              </Text>
            </Pressable>
          ),
        )}

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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose earliest departure"
          disabled={busy}
          onPress={openDeparturePicker}
          style={styles.pickerField}
        >
          <Text
            style={
              departure
                ? styles.pickerValue
                : styles.pickerPlaceholder
            }
          >
            {departure
              ? departure.label
              : 'Choose departure time'}
          </Text>

          <Text style={styles.pickerArrow}>
            ▼
          </Text>
        </Pressable>

        <Text style={styles.help}>
          Choose any time within the next 24 hours.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          Number of people
        </Text>

        <TextInput
          accessibilityLabel="Number of people"
          value={peopleCountText}
          onChangeText={setPeopleCountText}
          placeholder="1"
          keyboardType="number-pad"
          editable={!busy}
          style={styles.input}
        />

        <Text style={styles.help}>
          Count everyone who will actually travel.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={
          busy
          || !origin
          || !destination
          || !departure
          || !peopleCountText.trim()
        }
        onPress={() => {
          void submitMovementNeed();
        }}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>
          {busy
            ? 'Working...'
            : 'Request this movement'}
        </Text>
      </Pressable>

      <Modal
        visible={departurePickerOpen}
        animationType="slide"
        onRequestClose={() => {
          setDeparturePickerOpen(false);
        }}
      >
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <View>
              <Text style={styles.pickerTitle}>
                Choose departure time
              </Text>

              <Text style={styles.pickerSubtitle}>
                From the next minute up to 24 hours
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeparturePickerOpen(false);
              }}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>
                Close
              </Text>
            </Pressable>
          </View>

          <FlatList
            data={departureOptions}
            keyExtractor={option => option.value}
            initialNumToRender={30}
            windowSize={10}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDeparture(item);
                  setDeparturePickerOpen(false);
                  setMessage('');
                }}
                style={styles.timeOption}
              >
                <Text style={styles.timeOptionText}>
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>

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

  offeredMovementCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },

  offeredMovementCardSelected: {
    borderWidth: 2,
    borderColor: '#111',
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

  pickerField: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  pickerValue: {
    flex: 1,
    fontSize: 16,
  },

  pickerPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: '#777',
  },

  pickerArrow: {
    marginLeft: 12,
    fontSize: 12,
  },

  pickerContainer: {
    flex: 1,
    paddingTop: 24,
    paddingHorizontal: 20,
  },

  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    gap: 16,
  },

  pickerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },

  pickerSubtitle: {
    marginTop: 4,
    fontSize: 13,
  },

  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  closeButtonText: {
    fontWeight: '600',
  },

  timeOption: {
    minHeight: 50,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },

  timeOptionText: {
    fontSize: 16,
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
