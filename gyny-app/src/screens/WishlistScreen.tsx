import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getWishlistItems,
  removeWishlistItem,
  WishlistItem,
} from "../storage/wishlistStorage";
import { api } from "../api/client";

const demoWishlistItems = [
  {
    id: "1",
    title: "Bone straight human hair.",
    brief_detail: "Black 16 inches",
    store_name: "Bohair",
    price_kobo: 523000,
  },
  {
    id: "2",
    title: "Maggi",
    brief_detail: "Pack",
    store_name: "Shoprite",
    price_kobo: 100000,
  },
  {
    id: "3",
    title: "Mable Wrapper.",
    brief_detail: "Black Size 23",
    store_name: "Madam Prestige",
    price_kobo: 2300000,
  },
];

export default function WishlistScreen({ navigation }: any) {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [openMenuItemId, setOpenMenuItemId] = useState<string | null>(null);
  useEffect(() => {
  async function loadWishlist() {
    const savedItems = await getWishlistItems();
    setItems(savedItems);
  }

  const unsubscribe = navigation.addListener("focus", loadWishlist);

  loadWishlist();

  return unsubscribe;
}, [navigation]);

  async function deleteItem(productId: string) {
  setOpenMenuItemId(null);
  const nextItems = await removeWishlistItem(productId);
  setItems(nextItems);
}

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>WISHLIST</Text>

          <View style={styles.headerIcons}>
            <Ionicons name="search-outline" size={28} color="#111111" />
            <Ionicons name="notifications-outline" size={26} color="#111111" />
          </View>
        </View>

        <View style={styles.headerDivider} />

        {items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="heart-outline" size={44} color="#777777" />
            </View>

            <Text style={styles.emptyText}>
              Items added to your Wishlist will be saved here.
            </Text>

            <Pressable
              style={styles.startShoppingButton}
              onPress={() => navigation.navigate("Home")}
            >
              <Text style={styles.startShoppingText}>Start Shopping</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.productCount}>{items.length} PRODUCTS</Text>
            <View style={styles.headerDivider} />

            {items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.imagePlaceholder} />

                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle} numberOfLines={1} ellipsizeMode="tail">
                    {item.title}
                  </Text>

                  <Text style={styles.itemBrief} numberOfLines={1} ellipsizeMode="tail">
                    {item.brief_detail}
                  </Text>

                  <Text style={styles.storeName} numberOfLines={1} ellipsizeMode="tail">
                    {item.store_name}
                  </Text>

                  <Text style={styles.priceText}>₦{item.price_kobo / 100}</Text>

                  <Pressable
                    style={styles.addToBagButton}
                    onPress={async () => {
  if (!item.store_id) {
    Alert.alert("Add to bag failed", "Store information is missing for this item.");
    return;
  }

  try {
    await api.post("/cart/items", {
      store_id: item.store_id,
      product_id: item.product_id,
      variant_id: null,
      qty: 1,
    });

    Alert.alert("Bag", "Item added to bag.");
  } catch (e: any) {
    const serverMessage =
      e?.response?.data?.error ||
      e?.response?.data?.message ||
      "Could not add item to bag.";

    Alert.alert("Add to bag failed", serverMessage);
  }
}}
                  >
                    <Text style={styles.addToBagText}>Add to Bag</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={styles.itemOptionsButton}
                  onPress={() =>
                    setOpenMenuItemId((prev) => (prev === item.id ? null : item.id))
                  }
                >
                  <Ionicons name="ellipsis-vertical" size={18} color="#111111" />
                </Pressable>

                {openMenuItemId === item.id && (
                  <View style={styles.itemMenu}>
                    <Pressable
                      style={styles.itemMenuOption}
                      onPress={() => {
                        setOpenMenuItemId(null);
                        Alert.alert("Share", "Share option will be connected later.");
                      }}
                    >
                      <Text style={styles.itemMenuText}>Share</Text>
                    </Pressable>

                    <Pressable
                      style={styles.itemMenuOption}
                      onPress={() => deleteItem(item.product_id)}
                    >
                      <Text style={[styles.itemMenuText, styles.deleteMenuText]}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
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
    height: 121,
    paddingTop: 74,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 23.93,
    fontWeight: "700",
    color: "#111111",
  },
  headerIcons: {
    flexDirection: "row",
    gap: 16,
  },
  headerDivider: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },
  productCount: {
    fontSize: 21.08,
    lineHeight: 27.3,
    letterSpacing: -0.1,
    color: "#666666",
    fontWeight: "500",
    paddingHorizontal: 12,
    paddingTop: 15,
    paddingBottom: 13,
  },

  emptyContainer: {
    alignItems: "center",
    paddingTop: 135,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: "#777777",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 16,
    lineHeight: 22,
    color: "#666666",
    textAlign: "center",
    marginBottom: 150,
  },
  startShoppingButton: {
    width: "86%",
    height: 46,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  startShoppingText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },

  itemRow: {
    minHeight: 120,
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
    flexDirection: "row",
    paddingVertical: 10,
    position: "relative",
  },
  imagePlaceholder: {
    width: 90,
    height: 140,
    backgroundColor: "#DCE6EC",
    marginLeft: 12,
    marginRight: 10,
  },
  itemInfo: {
    flex: 1,
    paddingRight: 42,
  },
  itemTitle: {
    fontSize: 13.66,
    lineHeight: 17.7,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 8,
  },
  itemBrief: {
    fontSize: 13.49,
    lineHeight: 17.5,
    fontWeight: "600",
    color: "#444444",
    marginBottom: 8,
  },
  storeName: {
    fontSize: 13.49,
    lineHeight: 17.5,
    fontWeight: "600",
    color: "#666666",
    marginBottom: 10,
  },
  priceText: {
    fontSize: 16.55,
    lineHeight: 21.4,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 8,
  },
  addToBagButton: {
    width: 104,
    height: 31,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  addToBagText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  itemOptionsButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
    padding: 4,
  },
  itemMenu: {
    position: "absolute",
    right: 34,
    bottom: 26,
    width: 105,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9D9D9",
    zIndex: 999,
    elevation: 10,
  },
  itemMenuOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
  itemMenuText: {
    fontSize: 13,
    color: "#111111",
    fontWeight: "600",
  },
  deleteMenuText: {
    color: "#B00020",
  },
});