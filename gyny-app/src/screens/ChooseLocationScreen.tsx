import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  StatusBar,
  TextInput,
} from "react-native";
import LocationBackIcon from "../../assets/icons/location/back.svg";
import StoreLocationIcon from "../../assets/icons/location/store-location.svg";
import UserLocationIcon from "../../assets/icons/location/user-location.svg";
import LocationCloseIcon from "../../assets/icons/location/close-circle.svg";
import LocationPlusIcon from "../../assets/icons/location/plus.svg";
import HistoryLocationIcon from "../../assets/icons/location/history-location.svg";

/*
  Later we will replace these Ionicons with your exact Figma SVG icons.

  Save Figma icons here:
  assets/icons/location/back.svg
  assets/icons/location/store-location.svg
  assets/icons/location/dropoff-location.svg
  assets/icons/location/close-circle.svg
  assets/icons/location/plus.svg
  assets/icons/location/history-location.svg
*/

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const savedLocationRows = [1, 2, 3];

export default function ChooseLocationScreen({ navigation, route }: any) {
  const storeName = route?.params?.storeName || "Shoprite";
  const [deliveryAddress, setDeliveryAddress] = useState(
    "Whiteoak estate, ologolo"
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <LocationBackIcon width={28} height={28} />
        </Pressable>

        <Text style={styles.headerTitle}>Choose location</Text>
      </View>

      <View style={styles.inputsArea}>
        <View style={styles.inputRow}>
          <View style={styles.sameWidthInput}>
  <StoreLocationIcon width={19} height={19} />

  <Text style={styles.sourceInputText} numberOfLines={1}>
    {storeName}
  </Text>
</View>

          <View style={styles.plusSpace} />
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.sameWidthInput, styles.deliveryInputActive]}>
            <UserLocationIcon width={19} height={19} />

            <TextInput
              style={styles.deliveryTextInput}
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
              placeholder="Input delivery address"
              placeholderTextColor="#999999"
            />

            <Pressable style={styles.smallCloseButton}>
              <LocationCloseIcon width={15} height={15} />
            </Pressable>
          </View>

          <Pressable style={styles.plusButton}>
            <LocationPlusIcon width={22} height={22} />
          </Pressable>
        </View>
      </View>

      <View style={styles.savedRowsArea}>
        {savedLocationRows.map((item) => (
          <Pressable key={item} style={styles.locationRow}>
            <View style={styles.historyIconWrap}>
              <HistoryLocationIcon width={27} height={27} />
            </View>

            <View style={styles.locationLine} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const INPUT_WIDTH = 282;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  header: {
    height: TOP_SAFE_SPACE + 78,
    paddingTop: TOP_SAFE_SPACE + 18,
    paddingLeft: 2,
    paddingRight: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  backButton: {
    width: 38,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },

  headerTitle: {
    fontSize: 23,
    fontWeight: "800",
    color: "#111111",
  },

  inputsArea: {
    paddingTop: 8,
    paddingLeft: 34,
    paddingRight: 20,
  },

  inputRow: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },

  sameWidthInput: {
    width: INPUT_WIDTH,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#ECECEC",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },

  deliveryInputActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#111111",
  },

  sourceInputText: {
    flex: 1,
    fontSize: 17,
    color: "#8A8A8A",
    marginLeft: 7,
  },

  deliveryTextInput: {
    flex: 1,
    height: 34,
    paddingVertical: 0,
    fontSize: 17,
    color: "#999999",
    marginLeft: 6,
  },

  smallCloseButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },

  plusSpace: {
    width: 36,
    height: 36,
    marginLeft: 8,
  },

  plusButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },

  savedRowsArea: {
    paddingTop: 34,
    paddingHorizontal: 28,
  },

  locationRow: {
    height: 72,
    flexDirection: "row",
    alignItems: "flex-start",
  },

  historyIconWrap: {
    width: 28,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  locationLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#BFBFBF",
    marginLeft: 0,
    marginTop: 37,
  },
});