import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type Props = {
  route: {
    params: {
      checkoutGroupId: string;
      orderId: string;
      grandTotalKobo: number;
    };
  };
  navigation: any;
};

export default function CheckoutSuccessScreen({ route, navigation }: Props) {
  const { checkoutGroupId, orderId, grandTotalKobo } = route.params;

  return (
  <View style={styles.screen}>
    {/* HEADER */}
    <View style={styles.header}>
  <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
    <Text style={styles.backArrow}>←</Text>
  </Pressable>

  <Text style={styles.headerTitle}>ORDER CONFIRMED</Text>
</View>

    <View style={styles.divider} />

    {/* SUCCESS TEXT */}
    <View style={styles.section}>
      <Text style={styles.successText}>You’re all set, John</Text>
    </View>

    <View style={styles.divider} />

    {/* DETAILS */}
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Details</Text>
      <Text style={styles.detailText}>Adih Terhide</Text>
      <Text style={styles.detailText}>07037227551</Text>
    </View>

    <View style={styles.divider} />

    {/* DELIVERY ADDRESS */}
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Delivery Address</Text>
      <Text style={styles.detailText}>
        Whiteoak Estate, Ologolo, Lekki.
      </Text>
    </View>

    <View style={styles.divider} />

    {/* PAYMENT */}
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Payment method</Text>
      <Text style={styles.detailText}>Opay</Text>

      <Text style={styles.totalLabel}>Total</Text>
      <Text style={styles.totalValue}>
        ₦{grandTotalKobo / 100}
      </Text>
    </View>

    {/* BUTTON */}
    <View style={styles.buttonContainer}>
      <Pressable
  style={styles.button}
  onPress={() =>
    navigation.navigate("OrderDetail", {
      orderId,
    })
  }
>
        <Text style={styles.buttonText}>View Order Receipt</Text>
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

  header: {
  height: 121,
  paddingTop: 74,
  paddingHorizontal: 12,
  flexDirection: "row",
  alignItems: "flex-start",
},

backButton: {
  width: 28,
  height: 28,
  alignItems: "center",
  justifyContent: "center",
},

backArrow: {
  fontSize: 28,
  color: "#111111",
  lineHeight: 28,
},

headerTitle: {
  marginLeft: 10,
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
},

  divider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },

  section: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  successText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111111",
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111111",
    marginBottom: 10,
  },

  detailText: {
    fontSize: 16,
    color: "#666666",
    marginBottom: 6,
  },

  totalLabel: {
    marginTop: 10,
    fontSize: 16,
    color: "#666666",
  },

  totalValue: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111111",
    marginTop: 4,
  },

  buttonContainer: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 100,
  alignItems: "center",
},

  button: {
    width: "85%",
    height: 45,
    backgroundColor: "#777777",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});