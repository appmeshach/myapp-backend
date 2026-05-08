import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type Props = {
  onContinue: () => void;
};

export default function TaglineScreen({ onContinue }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.tagline}>The stores you know, now online</Text>

      <Pressable style={styles.button} onPress={onContinue}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  tagline: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 32,
  },
  button: {
    backgroundColor: "#111111",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});