import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

export default function SizeGuideScreen({ navigation }: any) {
  const [unit, setUnit] = useState<"cmkg" | "inlb">("cmkg");

  return (
    <View style={styles.screen}>
      <View style={styles.imageArea}>
        <View style={styles.topIconsRow}>
          <Pressable style={styles.circleButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={28} color="#111111" />
          </Pressable>

          <View style={styles.rightIcons}>
            <Pressable style={styles.circleButton}>
              <Ionicons name="search-outline" size={23} color="#111111" />
            </Pressable>

            <Pressable style={styles.circleButton}>
              <Ionicons name="share-social-outline" size={22} color="#111111" />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.title}>Size measurement</Text>

          <Pressable style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Ionicons name="close-outline" size={22} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.controlsRow}>
          <Pressable style={styles.dropdownButton}>
            <Text style={styles.dropdownText}>NG size</Text>
            <Ionicons name="chevron-down" size={14} color="#111111" />
          </Pressable>

          <View style={styles.unitToggle}>
            <Pressable
              style={[styles.unitButton, unit === "cmkg" && styles.unitButtonActive]}
              onPress={() => setUnit("cmkg")}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  unit === "cmkg" && styles.unitButtonTextActive,
                ]}
              >
                cm, kg
              </Text>
            </Pressable>

            <Pressable
              style={[styles.unitButton, unit === "inlb" && styles.unitButtonActive]}
              onPress={() => setUnit("inlb")}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  unit === "inlb" && styles.unitButtonTextActive,
                ]}
              >
                in, lb
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.emptyMeasurementArea} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },

  imageArea: {
    height: 230 + TOP_SAFE_SPACE,
    backgroundColor: "#DCE6EC",
  },

  topIconsRow: {
    position: "absolute",
    top: TOP_SAFE_SPACE + 12,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  rightIcons: {
    flexDirection: "row",
    gap: 12,
  },

  circleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },

  sheet: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    marginTop: -1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },

  sheetHeader: {
    height: 62,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },

  title: {
    fontSize: 21,
    fontWeight: "800",
    color: "#111111",
  },

  closeButton: {
    position: "absolute",
    right: 14,
    top: 18,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },

  controlsRow: {
    height: 42,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  dropdownButton: {
    height: 25,
    borderWidth: 1,
    borderColor: "#111111",
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  dropdownText: {
    fontSize: 16,
    color: "#111111",
    marginRight: 4,
  },

  unitToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#111111",
  },

  unitButton: {
    height: 25,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },

  unitButtonActive: {
    backgroundColor: "#000000",
  },

  unitButtonText: {
    fontSize: 15,
    color: "#111111",
    fontWeight: "600",
  },

  unitButtonTextActive: {
    color: "#FFFFFF",
  },

  divider: {
    height: 1,
    backgroundColor: "#999999",
  },

  emptyMeasurementArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
});