import React, { useEffect, useState } from "react";
import {
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { api } from "../api/client";
import {
  getOrderStatusLabel,
  getOrderStatusColors,
} from "../utils/orderStatus";

type Order = {
  id: string;
  state: string;
  total_amount_kobo: number;
  created_at: string;
  store_name?: string;
};

export default function AccountScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);

  async function loadOrders() {
    try {
      setLoading(true);
      const res = await api.get("/profile/orders");
      setOrders(res.data.orders || []);
    } catch (e) {
      console.error("LOAD ORDERS ERROR:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>My Orders</Text>

      {loading ? (
        <Text>Loading orders...</Text>
      ) : orders.length === 0 ? (
        <Text>No orders yet.</Text>
      ) : (
        orders.map((order) => {
          const colors = getOrderStatusColors(order.state);

          return (
            <Pressable
              key={order.id}
              style={styles.card}
              onPress={() =>
                navigation.navigate("OrderDetail", { orderId: order.id })
              }
            >
              <View style={styles.topRow}>
                <Text style={styles.orderId}>Order: {order.id}</Text>
                <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                  <Text style={[styles.badgeText, { color: colors.text }]}>
                    {getOrderStatusLabel(order.state)}
                  </Text>
                </View>
              </View>

              <Text style={styles.text}>
                Total: ₦{order.total_amount_kobo / 100}
              </Text>

              {order.store_name ? (
                <Text style={styles.text}>Store: {order.store_name}</Text>
              ) : null}

              <Text style={styles.date}>
                {new Date(order.created_at).toLocaleString()}
              </Text>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#F7F7F7",
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  orderId: {
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  text: {
    fontSize: 15,
    marginBottom: 4,
  },
  date: {
    marginTop: 8,
    fontSize: 13,
    color: "#666",
  },
});