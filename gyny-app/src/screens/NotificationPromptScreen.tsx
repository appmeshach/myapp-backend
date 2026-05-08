import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

type Props = {
  onFinish: () => void;
};

export default function NotificationPromptScreen({ onFinish }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Allow notifications?</Text>

        <Pressable style={styles.primaryButton} onPress={onFinish}>
          <Text style={styles.primaryText}>Allow</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={onFinish}>
          <Text style={styles.secondaryText}>Don't allow</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    justifyContent: "flex-end",
    padding: 24,
  },
  card: {
    backgroundColor: "#3B3434",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 20,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryText: {
    color: "#111111",
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});