import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type Props = {
  onStartShopping: () => void;
};

export default function RoleSelectScreen({ onStartShopping }: Props) {
  return (
    <View style={styles.container}>
      <Pressable style={styles.button} onPress={onStartShopping}>
        <Text style={styles.buttonText}>Start Shopping</Text>
      </Pressable>

      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Start Selling</Text>
      </Pressable>

      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Logistics</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#E9EEF1",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  button: {
    width: 220,
    backgroundColor: "#111111",
    paddingVertical: 14,
    borderRadius: 6,
    marginBottom: 16,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});