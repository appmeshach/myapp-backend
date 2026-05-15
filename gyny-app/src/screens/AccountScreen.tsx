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
import OrdersIcon from "../../assets/icons/account/orders.svg";
import MessagesIcon from "../../assets/icons/account/messages.svg";
import SharedIcon from "../../assets/icons/account/shared.svg";
import DiscountsIcon from "../../assets/icons/account/discounts.svg";
import MyStoresIcon from "../../assets/icons/account/my-stores.svg";
import SettingsIcon from "../../assets/icons/account/settings.svg";
import SupportIcon from "../../assets/icons/account/support.svg";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

type AccountMenuItem = {
  label: string;
  Icon: React.ElementType;
  onPress?: () => void;
};

export default function AccountScreen({ navigation }: any) {
  const menuItems: AccountMenuItem[] = [
  {
  label: "Orders",
  Icon: OrdersIcon,
  onPress: () => {
    navigation.navigate("Orders");
  },
},
  {
    label: "Messages",
    Icon: MessagesIcon,
  },
  {
    label: "Shared",
    Icon: SharedIcon,
  },
  {
    label: "Discounts",
    Icon: DiscountsIcon,
  },
  {
    label: "My stores",
    Icon: MyStoresIcon,
  },
  {
    label: "Settings",
    Icon: SettingsIcon,
  },
  {
    label: "Support",
    Icon: SupportIcon,
  },
];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>ACCOUNT</Text>

          <Pressable style={styles.searchButton}>
            <Ionicons name="search-outline" size={31} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.headerDivider} />

        <Pressable style={styles.profileRow} onPress={() => navigation.navigate("Profile")}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>A</Text>
          </View>

          <View style={styles.profileTextArea}>
            <Text style={styles.profileName}>Adih Terhide</Text>
            <Text style={styles.profilePhone}>07037227551</Text>
          </View>

          <Ionicons name="chevron-forward" size={37} color="#000000" />
        </Pressable>

        <View style={styles.sectionDivider} />

        {menuItems.map((item) => (
          <Pressable
            key={item.label}
            style={styles.menuRow}
            onPress={item.onPress}
          >
            <View style={styles.menuLeft}>
  <View style={styles.menuIconBox}>
    <item.Icon width={27} height={27} />
  </View>

  <Text style={styles.menuLabel}>{item.label}</Text>
</View>

            <Ionicons name="chevron-forward" size={25} color="#111111" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },

  container: {
    backgroundColor: "#F7F7F7",
    paddingBottom: 120,
  },

  header: {
    height: TOP_SAFE_SPACE + 80,
    paddingTop: TOP_SAFE_SPACE + 30,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerTitle: {
    fontSize: 21,
    fontWeight: "800",
    color: "#111111",
  },

  searchButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },

  headerDivider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },

  profileRow: {
    height: 125,
    backgroundColor: "#F7F7F7",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
  },

  avatarCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
    borderColor: "#777777",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  avatarText: {
    fontSize: 55,
    lineHeight: 60,
    fontWeight: "900",
    color: "#000000",
  },

  profileTextArea: {
    flex: 1,
  },

  profileName: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    color: "#000000",
    marginBottom: 7,
  },

  profilePhone: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    color: "#000000",
  },

  sectionDivider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },

  menuRow: {
    height: 62,
    backgroundColor: "#F7F7F7",
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  menuLeft: {
  flexDirection: "row",
  alignItems: "center",
},

menuIconBox: {
  width: 27,
  height: 27,
  alignItems: "center",
  justifyContent: "center",
},

  menuLabel: {
    marginLeft: 18,
    fontSize: 23,
    fontWeight: "500",
    color: "#111111",
  },
});