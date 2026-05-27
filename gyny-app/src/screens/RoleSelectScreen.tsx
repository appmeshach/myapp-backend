import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type Props = {
  onStartShopping: () => void;
};

export default function RoleSelectScreen({ onStartShopping }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>GYNY</Text>

      <Text style={styles.title}>Shop trusted stores near you</Text>

      <Text style={styles.subtitle}>
        Find products from real stores, choose your delivery address, and track
        your order from pickup to delivery.
      </Text>

      <Pressable style={styles.primaryButton} onPress={onStartShopping}>
        <Text style={styles.primaryButtonText}>Start Shopping</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  logo: {
    fontSize: 38,
    fontWeight: "900",
    color: "#111111",
    marginBottom: 14,
    letterSpacing: 1,
  },

  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    color: "#111111",
    textAlign: "center",
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#666666",
    textAlign: "center",
    marginBottom: 28,
    maxWidth: 320,
  },

  primaryButton: {
    width: 220,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },

  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});