import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { api } from "../api/client";
import {
  getOrderStatusLabel,
  getOrderStatusColors,
} from "../utils/orderStatus";

type Props = {
  route: {
    params: {
      orderId: string;
    };
  };
};

export default function OrderDetailScreen({ route }: Props) {
  const { orderId } = route.params;

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  async function loadOrder() {
    try {
      setLoading(true);
      const res = await api.get(`/profile/orders/${orderId}`);
      setOrder(res.data.order);
      setItems(res.data.items || []);
    } catch (e) {
      console.error("ORDER DETAIL ERROR:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function handleAcceptOrder() {
    try {
      setActing(true);

      await api.post(
        `/buyer/orders/${orderId}/accept`,
        {},
        {
          headers: {
            "Idempotency-Key": `accept-${orderId}`,
          },
        }
      );

      Alert.alert("Success", "Order accepted successfully.");
      await loadOrder();
    } catch (e) {
      console.error("ACCEPT ORDER ERROR:", e);
      Alert.alert("Error", "Could not accept order.");
    } finally {
      setActing(false);
    }
  }

  async function handleOpenDispute() {
    try {
      setActing(true);

      await api.post(`/buyer/orders/${orderId}/dispute`, {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
      });

      Alert.alert("Success", "Dispute opened successfully.");
      await loadOrder();
    } catch (e) {
      console.error("OPEN DISPUTE ERROR:", e);
      Alert.alert("Error", "Could not open dispute.");
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading order...</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.container}>
        <Text>Order not found</Text>
      </View>
    );
  }

  const colors = getOrderStatusColors(order.state);
  const canReview = order.state === "INSPECTION_ACTIVE";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Order Detail</Text>

      <Text style={styles.section}>Order Info</Text>
      <Text style={styles.infoText}>ID: {order.id}</Text>

      <View style={[styles.badge, { backgroundColor: colors.bg }]}>
        <Text style={[styles.badgeText, { color: colors.text }]}>
          {getOrderStatusLabel(order.state)}
        </Text>
      </View>

      <Text style={styles.infoText}>Total: ₦{order.total_amount_kobo / 100}</Text>

      {canReview && (
        <View style={styles.actionBox}>
          <Pressable
            style={[styles.primaryButton, acting && styles.disabled]}
            onPress={handleAcceptOrder}
            disabled={acting}
          >
            <Text style={styles.primaryButtonText}>
              {acting ? "Processing..." : "Accept Order"}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, acting && styles.disabled]}
            onPress={handleOpenDispute}
            disabled={acting}
          >
            <Text style={styles.secondaryButtonText}>Open Dispute</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.section}>Items</Text>

      {items.map((item) => (
        <View key={item.id} style={styles.itemCard}>
          <Text style={styles.itemTitle}>{item.title}</Text>

          {item.variant_label ? (
            <Text style={styles.variant}>{item.variant_label}</Text>
          ) : null}

          <Text>Qty: {item.qty}</Text>
          <Text>Price: ₦{item.unit_price_kobo / 100}</Text>
          <Text>Total: ₦{item.line_total_kobo / 100}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#F7F7F7",
    paddingBottom: 40,
    flexGrow: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 16,
  },
  section: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 18,
    fontWeight: "700",
  },
  infoText: {
    marginBottom: 8,
    fontSize: 15,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "700",
  },
  actionBox: {
    marginTop: 12,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: "#111111",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#B91C1C",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#B91C1C",
    fontSize: 16,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.6,
  },
  itemCard: {
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  variant: {
    fontSize: 13,
    color: "#666",
    marginBottom: 6,
  },
});