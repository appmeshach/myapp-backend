import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const placeholderItems = Array.from({ length: 8 }, (_, index) => index);

export default function OtherShoppersScreen({ navigation }: any) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={31} color="#111111" />
        </Pressable>

        <View style={styles.searchBar}>
          <Text style={styles.searchPlaceholder}>Search other shoppers</Text>
        </View>

        <Pressable style={styles.headerIconButton}>
          <Ionicons name="grid-outline" size={24} color="#111111" />
        </Pressable>

        <Pressable style={styles.headerIconButton}>
          <Ionicons name="options-outline" size={24} color="#111111" />
        </Pressable>
      </View>

      <View style={styles.headerDivider} />

      <ScrollView contentContainerStyle={styles.grid}>
        {placeholderItems.map((item) => (
          <View key={item} style={styles.card}>
            <View style={styles.imagePlaceholder} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  header: {
    height: TOP_SAFE_SPACE + 64,
    paddingTop: TOP_SAFE_SPACE + 12,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  backButton: {
    width: 30,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },

  searchBar: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#ECECEC",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginRight: 8,
  },

  searchPlaceholder: {
    fontSize: 16,
    color: "#9A9A9A",
  },

  headerIconButton: {
    width: 28,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },

  headerDivider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },

  grid: {
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 40,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  card: {
    width: "49%",
    marginBottom: 6,
  },

  imagePlaceholder: {
    width: "100%",
    aspectRatio: 1 / 1.15,
    backgroundColor: "#D9D9D9",
  },
});