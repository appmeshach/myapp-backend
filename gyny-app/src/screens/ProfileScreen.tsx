import React from "react";
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

export default function ProfileScreen({ navigation }: any) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={31} color="#111111" />
        </Pressable>

        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.photoRow}>
        <Text style={styles.rowTitle}>Photo</Text>

        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>A</Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowTitle}>Name</Text>
        <Text style={styles.rowValue}>Adih Terhide</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowTitle}>Gender</Text>
        <Text style={styles.rowValue}>Male</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowTitle}>Birth Year</Text>
        <Text style={styles.rowValue}>12-12-1999</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowTitle}>Email</Text>
        <Text style={styles.rowValue}>meshachadih@gmail.com</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowTitle}>Phone number</Text>
        <Text style={styles.rowValue}>07037227551</Text>
      </View>

      <Pressable style={styles.sizeRow}>
        <Text style={styles.sizeText}>My Size</Text>
        <Ionicons name="chevron-forward" size={31} color="#111111" />
      </Pressable>

      <View style={styles.editButtonWrap}>
        <Pressable style={styles.editButton}>
          <Text style={styles.editButtonText}>Edit Profile</Text>
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
    height: TOP_SAFE_SPACE + 70,
    paddingTop: TOP_SAFE_SPACE + 22,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F7F7F7",
  },

  backButton: {
    width: 30,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },

  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111111",
  },

  divider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },

  photoRow: {
    height: 84,
    paddingHorizontal: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
    backgroundColor: "#F7F7F7",
  },

  avatarCircle: {
    width: 61,
    height: 61,
    borderRadius: 30.5,
    borderWidth: 1,
    borderColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },

  avatarText: {
    fontSize: 48,
    lineHeight: 53,
    fontWeight: "900",
    color: "#000000",
  },

  infoRow: {
    minHeight: 91,
    paddingHorizontal: 36,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
    backgroundColor: "#F7F7F7",
  },

  rowTitle: {
    fontSize: 18,
    fontWeight: "500",
    color: "#111111",
    marginBottom: 16,
  },

  rowValue: {
    fontSize: 18,
    fontWeight: "400",
    color: "#111111",
  },

  sizeRow: {
    height: 57,
    paddingHorizontal: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
    backgroundColor: "#F7F7F7",
  },

  sizeText: {
    fontSize: 18,
    fontWeight: "500",
    color: "#111111",
  },

  editButtonWrap: {
    alignItems: "center",
    paddingTop: 32,
  },

  editButton: {
    height: 30,
    paddingHorizontal: 18,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },

  editButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});