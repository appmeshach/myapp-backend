import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";

type Props = {
  onDone: () => void;
};

export default function SplashScreen({ onDone }: Props) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDone();
    }, 1200);

    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>GYNY</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 2,
  },
});