import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";

type Props = {
  onContinue: () => void;
};

const locations = [
  "Lagos",
  "Abuja",
  "Kano",
  "Delta",
  "Rivers",
  "Imo",
  "Akwa Ibom",
  "Edo",
];

export default function LocationScreen({ onContinue }: Props) {
  const [selected, setSelected] = useState("Lagos");

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Choose location</Text>

        {locations.map((item) => (
          <Pressable
            key={item}
            style={styles.row}
            onPress={() => setSelected(item)}
          >
            <View style={[styles.checkbox, selected === item && styles.checked]} />
            <Text style={styles.label}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.button} onPress={onContinue}>
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scrollContent: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: "#999",
    marginRight: 12,
  },
  checked: {
    backgroundColor: "#111111",
  },
  label: {
    fontSize: 18,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#E5E5E5",
    backgroundColor: "#FFFFFF",
  },
  button: {
    backgroundColor: "#111111",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});