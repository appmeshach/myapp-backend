import { Pressable, Text, View } from 'react-native';
import { useCompletedMovements } from '../hooks/useCompletedMovements';
import type { CompletedMovementRecovery } from '../services/completedMovementService';
import { CompletedMovementReputation } from './CompletedMovementReputation';

function settlementCopy(row: CompletedMovementRecovery): string {
  switch (row.settlementStatus) {
    case 'pending_amount': return row.settlementIsForMe ? 'Pending calculation' : 'Pending calculation for the person who offered the movement';
    case 'pending_settlement': return row.settlementIsForMe ? 'Awaiting settlement' : 'Awaiting settlement for the person who offered the movement';
    case 'settled': return row.settlementIsForMe ? 'Settled' : 'Settled for the person who offered the movement';
    case 'failed': return 'Settlement could not be completed';
  }
}

export function CompletedMovements() {
  const { state, refresh } = useCompletedMovements();
  return <View style={{ gap: 12, paddingVertical: 16 }}>
    <Text style={{ fontSize: 20, fontWeight: '600' }}>Completed movements</Text>
    {state.phase === 'signed_out' && <Text>Sign in to view completed movements.</Text>}
    {state.phase === 'loading' && <Text>Loading completed movements...</Text>}
    {state.phase === 'error' && <Text accessibilityLiveRegion="polite">Completed movements could not be loaded. Please retry.</Text>}
    {state.phase === 'ready' && state.rows.length === 0 && <Text>No completed movements yet.</Text>}
    {state.phase === 'ready' && state.rows.map(row => <View key={row.movementNeedId} style={{ gap: 8, padding: 16, backgroundColor: '#fff', borderRadius: 12 }}>
      <Text>{row.originArea}{' → '}{row.destinationArea}</Text>
      <Text>Completed {new Date(row.completedAt).toLocaleString()}</Text>
      <Text>{row.settlementIsForMe ? 'Settlement for you' : 'Settlement'}</Text>
      <Text>{settlementCopy(row)}</Text>
      {row.settledAt && <Text>Settled {new Date(row.settledAt).toLocaleString()}</Text>}
      <CompletedMovementReputation movementNeedId={row.movementNeedId} />
    </View>)}
    {state.phase !== 'signed_out' && <Pressable accessibilityRole="button" disabled={state.phase === 'loading'} onPress={() => { void refresh(); }}>
      <Text>{state.phase === 'error' ? 'Retry completed movements' : 'Refresh completed movements'}</Text>
    </Pressable>}
  </View>;
}
