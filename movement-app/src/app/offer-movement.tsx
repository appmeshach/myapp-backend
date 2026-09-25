import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
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

import {
  calculateRouteMatch,
  createOfferingMovementIntent,
  generateOfferingRoute,
  openOfferingMovementAvailability,
  type RouteMatchReady,
} from '../services/offeringMovementService';

import {
  createMovementOffer,
  discoverMaskedMovementNeeds,
} from '../services/movementService';

import type {
  MaskedMovementNeed,
} from '../types/movement';

import {
  listMyActiveVehicles,
  type ActiveVehicle,
} from '../services/vehicleService';

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

  const [departure, setDeparture] =
    useState<DepartureOption | null>(null);

  const [
    departureOptions,
    setDepartureOptions,
  ] = useState<DepartureOption[]>([]);

  const [
    departurePickerOpen,
    setDeparturePickerOpen,
  ] = useState(false);

  const [requestId, setRequestId] =
    useState(() => Crypto.randomUUID());

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [
    offeringMovementIntentId,
    setOfferingMovementIntentId,
  ] = useState<string | null>(null);

  const [
    movementNeeds,
    setMovementNeeds,
  ] = useState<MaskedMovementNeed[]>([]);

  const [
    vehicles,
    setVehicles,
  ] = useState<ActiveVehicle[]>([]);

  const [
    selectedMovementNeedId,
    setSelectedMovementNeedId,
  ] = useState<string | null>(null);

  const [
    selectedVehicleId,
    setSelectedVehicleId,
  ] = useState<string | null>(null);

  const [availabilityId, setAvailabilityId] =
    useState<string | null>(null);

  const [availabilityRequestId, setAvailabilityRequestId] =
    useState(() => Crypto.randomUUID());

  const [seatsText, setSeatsText] =
    useState('1');

  const [
    routeMatch,
    setRouteMatch,
  ] = useState<RouteMatchReady | null>(null);

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

  function openDeparturePicker() {
    setDepartureOptions(
      buildDepartureOptions(),
    );

    setDeparturePickerOpen(true);
  }

  async function submitMovement() {
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
            departure.value,

          latestDepartureAt:
            null,
        });

      const route =
        await generateOfferingRoute(
          created.offeringMovementIntentId,
        );

      if (route.state === 'ready') {
        setOfferingMovementIntentId(
          created.offeringMovementIntentId,
        );

        setAvailabilityId(null);
        setAvailabilityRequestId(Crypto.randomUUID());
        setSelectedMovementNeedId(null);
        setSelectedVehicleId(null);
        setRouteMatch(null);
        setSeatsText('1');
        setMovementNeeds([]);
        setVehicles([]);
        setRequestId(Crypto.randomUUID());

        try {
          const activeVehicles = await listMyActiveVehicles();
          setVehicles(activeVehicles);
          setMessage(
            activeVehicles.length === 0
              ? 'Movement declared and trusted route created. Register an active vehicle before making this movement available.'
              : 'Movement declared and trusted route created. Choose your vehicle and available places to make this movement available.',
          );
        } catch {
          setMessage(
            'Movement declared and trusted route created, but active vehicles could not be loaded right now.',
          );
        }

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

  async function openAvailability() {
    setMessage('');

    if (busy || availabilityId) {
      return;
    }

    if (!offeringMovementIntentId || !selectedVehicleId) {
      setMessage('Declare your movement and choose an active vehicle first.');
      return;
    }

    const places = Number(seatsText);
    if (!Number.isInteger(places) || places < 1) {
      setMessage('Enter a valid number of available places.');
      return;
    }

    const vehicle = vehicles.find(item => item.vehicleId === selectedVehicleId);
    if (!vehicle || places > vehicle.seatCapacity) {
      setMessage('Available places cannot exceed this vehicle capacity.');
      return;
    }

    setBusy(true);
    try {
      const result = await openOfferingMovementAvailability({
        requestId: availabilityRequestId,
        offeringMovementIntentId,
        vehicleId: selectedVehicleId,
        totalPlaces: places,
      });
      setAvailabilityId(result.availabilityId);
      setMessage(
        'Your movement is now available. You can also review current movement requests below.',
      );

      try {
        setMovementNeeds(await discoverMaskedMovementNeeds());
      } catch {
        setMessage(
          'Your movement is now available. Current movement requests could not be refreshed right now.',
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'offering_movement_availability_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkRouteMatch() {
    setMessage('');
    setRouteMatch(null);

    if (
      !offeringMovementIntentId
      || !selectedMovementNeedId
      || !availabilityId
    ) {
      setMessage(
        'Make your movement available and choose a movement request first.',
      );

      return;
    }

    setBusy(true);

    try {
      const match =
        await calculateRouteMatch(
          selectedMovementNeedId,
          {
            offeringMovementIntentId,
          },
        );

      setRouteMatch(match);

      const distanceKm =
        (
          match
            .straightLineDistanceFromRouteMeters
          / 1000
        ).toFixed(1);

      setMessage(
        `The requester origin is approximately ${distanceKm} km from your route. Review this relationship and decide whether you want to make the offer.`,
      );
    } catch (error) {
      setRouteMatch(null);

      setMessage(
        error instanceof Error
          ? error.message
          : 'route_match_unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmMovementOffer() {
    setMessage('');

    if (
      !routeMatch
      || !selectedMovementNeedId
      || !availabilityId
    ) {
      setMessage(
        'Check the route relationship before creating the offer.',
      );

      return;
    }

    const seats =
      Number(seatsText);

    if (
      !Number.isInteger(seats)
      || seats < 1
    ) {
      setMessage(
        'Enter a valid number of seats.',
      );

      return;
    }

    setBusy(true);

    try {
      await createMovementOffer({
        movementNeedId:
          selectedMovementNeedId,

        routeMatchEvidenceId:
          routeMatch.routeMatchEvidenceId,

        availabilityId,

        seatsOffered:
          seats,

        proposedPickupArea:
          null,

        proposedDropoffArea:
          null,

        estimatedArrivalMinutes:
          null,
      });

      setMessage(
        'Movement offer created. Your movement remains available while places remain.',
      );

      setSelectedMovementNeedId(null);
      setRouteMatch(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'movement_offer_unavailable',
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

      <Pressable
        accessibilityRole="button"
        disabled={
          busy
          || !origin
          || !destination
          || !departure
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

      {offeringMovementIntentId && (
        <>
          <View style={styles.section}>
            <Text style={styles.label}>
              Vehicle
            </Text>

            {vehicles.length === 0 ? (
              <Text style={styles.help}>
                No active vehicle is available.
              </Text>
            ) : (
              vehicles.map(vehicle => (
                <Pressable
                  key={vehicle.vehicleId}
                  accessibilityRole="button"
                  disabled={busy || !!availabilityId}
                  onPress={() => {
                    setSelectedVehicleId(
                      vehicle.vehicleId,
                    );
                  }}
                  style={[
                    styles.optionCard,
                    selectedVehicleId
                      === vehicle.vehicleId
                      && styles.optionCardSelected,
                  ]}
                >
                  <Text style={styles.optionTitle}>
                    {vehicle.make}
                    {' '}
                    {vehicle.model}
                  </Text>

                  <Text style={styles.help}>
                    {vehicle.color}
                    {vehicle.year
                      ? ` • ${vehicle.year}`
                      : ''}
                  </Text>

                  <Text style={styles.help}>
                    Seat capacity:{' '}
                    {vehicle.seatCapacity}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>
              Available places
            </Text>

            <TextInput
              accessibilityLabel="Available places"
              value={seatsText}
              onChangeText={setSeatsText}
              keyboardType="number-pad"
              editable={!busy && !availabilityId}
              style={styles.input}
            />
          </View>

          {!availabilityId ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy || !selectedVehicleId || !seatsText.trim()}
              onPress={() => {
                void openAvailability();
              }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                {busy ? 'Working...' : 'Make movement available'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.confirmed}>
              Movement availability opened. Vehicle and total places are fixed for this movement.
            </Text>
          )}

          {availabilityId && (
            <>
              <View style={styles.section}>
                <Text style={styles.label}>
                  Current movement requests
                </Text>

                {movementNeeds.length === 0 ? (
                  <Text style={styles.help}>
                    No movement requests are currently available. Your movement remains available for compatible requesters.
                  </Text>
                ) : (
                  movementNeeds.map(need => (
                    <Pressable
                      key={need.movementNeedId}
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        setSelectedMovementNeedId(
                          need.movementNeedId,
                        );

                        setRouteMatch(null);
                      }}
                      style={[
                        styles.optionCard,
                        selectedMovementNeedId
                          === need.movementNeedId
                          && styles.optionCardSelected,
                      ]}
                    >
                      <Text style={styles.optionTitle}>
                        {need.originArea}
                        {' → '}
                        {need.destinationArea}
                      </Text>

                      <Text style={styles.help}>
                        {need.peopleCount}{' '}
                        {need.peopleCount === 1
                          ? 'person'
                          : 'people'}
                      </Text>

                      <Text style={styles.help}>
                        Earliest:{' '}
                        {new Date(
                          need.earliestDepartureAt,
                        ).toLocaleString()}
                      </Text>

                      {need.commonMovementArea && (
                        <Text style={styles.help}>
                          Area:{' '}
                          {need.commonMovementArea}
                        </Text>
                      )}

                      <Text style={styles.help}>
                        Identity verified:{' '}
                        {need.identityVerified
                          ? 'Yes'
                          : 'No'}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={
                  busy
                  || !selectedMovementNeedId
                  || !availabilityId
                  || !seatsText.trim()
                }
                onPress={() => {
                  void checkRouteMatch();
                }}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>
                  {busy
                    ? 'Working...'
                    : 'Check route relationship'}
                </Text>
              </Pressable>

              {routeMatch && (
                <View style={styles.section}>
                  <Text style={styles.label}>
                    Route relationship
                  </Text>

                  <Text style={styles.description}>
                    Requester origin is approximately{' '}
                    {(
                      routeMatch
                        .straightLineDistanceFromRouteMeters
                      / 1000
                    ).toFixed(1)}{' '}
                    km from your route.
                  </Text>

                  <Text style={styles.help}>
                    There is no maximum-distance rule. You decide whether this movement works for you.
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      void confirmMovementOffer();
                    }}
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonText}>
                      {busy
                        ? 'Working...'
                        : 'Confirm and create offer'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </>
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

  optionCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },

  optionCardSelected: {
    borderWidth: 2,
    borderColor: '#111',
  },

  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },

  guard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});