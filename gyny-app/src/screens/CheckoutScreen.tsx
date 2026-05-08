import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api/client";

type CheckoutItem = {
  id: string;
  title: string;
  brief_detail?: string | null;
  image_url?: string | null;
  qty: number;
  price_kobo: number;
};

type Props = {
  route: {
    params: {
      cartItemIds: string[];
      selectedTotalKobo: number;
      selectedCount: number;
      items: CheckoutItem[];
    };
  };
  navigation: any;
};

export default function CheckoutScreen({ route, navigation }: Props) {
  const { cartItemIds, selectedTotalKobo, selectedCount, items } = route.params;

  const [deliveryType, setDeliveryType] = React.useState("home");
const [deliveryLocation, setDeliveryLocation] = React.useState("");
const [placingOrder, setPlacingOrder] = React.useState(false);

const deliveryFeeKobo = 125000;

const finalTotalKobo = selectedTotalKobo + deliveryFeeKobo;
async function handlePlaceOrder() {
  try {
    setPlacingOrder(true);

    const res = await api.post("/checkout/from-cart", {
      cart_item_ids: cartItemIds,
    });

    const checkoutGroup = res.data.checkout_group;
    const firstOrder = res.data.orders?.[0];

    navigation.navigate("CheckoutSuccess", {
      checkoutGroupId: checkoutGroup.checkout_group_id,
      orderId: firstOrder.order_id,
      grandTotalKobo: checkoutGroup.grand_total_kobo,
    });
  } catch (e: any) {
    const serverMessage =
      e?.response?.data?.error ||
      e?.response?.data?.message ||
      "Could not place order.";

    Alert.alert("Order failed", serverMessage);
  } finally {
    setPlacingOrder(false);
  }
}

  return (
  <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={26} color="#111111" />
        </Pressable>

        <Text style={styles.headerTitle}>ORDER CONFIRMATION</Text>

        <Pressable style={styles.headerIconButton}>
          <Ionicons name="search-outline" size={28} color="#111111" />
        </Pressable>
      </View>

      <View style={styles.divider} />

      <View style={styles.imageStrip}>
  {items.map((item) => (
    <View key={item.id} style={styles.imageBox}>
      {item.image_url ? (
        <Image
          source={{ uri: item.image_url }}
          style={styles.productImage}
          resizeMode="cover"
        />
      ) : null}
    </View>
  ))}
</View>

      <View style={styles.divider} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Delivery Address</Text>

        {["home", "landmark", "office", "junction"].map((type) => (
          <Pressable
            key={type}
            style={styles.deliveryOption}
            onPress={() => setDeliveryType(type)}
          >
            <View
              style={[
                styles.radioOuter,
                deliveryType === type && styles.radioOuterActive,
              ]}
            >
              {deliveryType === type && <View style={styles.radioInner} />}
            </View>

            <Text style={styles.deliveryText}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Text>
          </Pressable>
        ))}

        {deliveryLocation ? (
          <View style={styles.selectedLocationRow}>
            <Text style={styles.selectedLocationText}>
              {deliveryLocation}
            </Text>

            <Ionicons name="location-outline" size={18} color="#555555" />
          </View>
        ) : null}

        <Pressable
          style={styles.changeAddressButton}
          onPress={() =>
            setDeliveryLocation("Whiteoak Estate, Ologolo, Lekki.")
          }
        >
          <Text style={styles.changeAddressText}>
            {deliveryLocation
              ? "＋ Change Delivery Address"
              : "＋ Choose Location"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Payment method</Text>
        <View style={styles.paymentCircle} />
        <View style={styles.paymentCircle} />
        <View style={styles.paymentCircle} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Order Summary</Text>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Items total</Text>
          <Text style={styles.summaryValue}>₦{selectedTotalKobo / 100}</Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Delivery fee</Text>
          <Text style={styles.summaryValue}>₦{deliveryFeeKobo / 100}</Text>
        </View>

        <Text style={styles.detailsPlaceholder}>
          Details should be added in this frame
        </Text>
      </View>
    </ScrollView>

    <View style={styles.footer}>
      <Text style={styles.totalText}>Total(₦{finalTotalKobo / 100})</Text>

      <Pressable
  style={[
    styles.placeOrderButton,
    placingOrder && { opacity: 0.6 },
  ]}
  onPress={handlePlaceOrder}
  disabled={placingOrder}
>
  <Text style={styles.placeOrderText}>
    {placingOrder ? "Placing..." : `Place order(${selectedCount})`}
  </Text>
</Pressable>
    </View>
  </View>
);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  headerTitle: {
  marginLeft: 50,
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
},
scrollContent: {
  paddingBottom: 90,
},

selectedLocationRow: {
  flexDirection: "row",
  alignItems: "center",
  marginTop: 4,
  marginBottom: 12,
},

selectedLocationText: {
  fontSize: 16,
  color: "#666666",
  marginRight: 8,
},

paymentCircle: {
  width: 19,
  height: 19,
  borderRadius: 9.5,
  borderWidth: 1,
  borderColor: "#777777",
  marginBottom: 14,
},

detailsPlaceholder: {
  fontSize: 17,
  fontWeight: "800",
  color: "#111111",
  marginTop: 28,
},
  imageStrip: {
  flexDirection: "row",
  paddingHorizontal: 16,
  paddingVertical: 10,
  gap: 10,
},

imageBox: {
  width: 70,
  height: 70,
  backgroundColor: "#DCE6EC",
},
productImage: {
  width: "100%",
  height: "100%",
},
  divider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },
  deliveryOption: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 10,
},

radioOuter: {
  width: 18,
  height: 18,
  borderRadius: 9,
  borderWidth: 1,
  borderColor: "#111111",
  marginRight: 10,
  alignItems: "center",
  justifyContent: "center",
},

radioOuterActive: {
  borderColor: "#000000",
},

radioInner: {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: "#000000",
},

deliveryText: {
  fontSize: 16,
  color: "#111111",
},
  section: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
    backgroundColor: "#F7F7F7",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111111",
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 16,
    color: "#666666",
    marginBottom: 10,
  },
  backButton: {
  position: "absolute",
  left: 12,
  top: 74,
},
  header: {
  height: 121,
  paddingTop: 74,
  paddingHorizontal: 12,
  flexDirection: "row",
  alignItems: "flex-start",
},

headerIconButton: {
  position: "absolute",
  right: 12,
  top: 74,
  width: 28,
  height: 28,
  alignItems: "center",
  justifyContent: "center",
},
  changeAddressButton: {
    alignSelf: "flex-start",
    backgroundColor: "#000000",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  changeAddressText: {
    color: "#7ED0FF",
    fontSize: 16,
    fontWeight: "700",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  summaryLabel: {
    fontSize: 16,
    color: "#666666",
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111111",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 72,
    borderTopWidth: 1,
    borderTopColor: "#CFCFCF",
    backgroundColor: "#F7F7F7",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  totalText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111111",
  },
  placeOrderButton: {
    width: 170,
    height: 38,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
  },
  placeOrderText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});