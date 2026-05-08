import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { api } from "../api/client";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  addWishlistItem,
  removeWishlistItem,
  isInWishlist,
} from "../storage/wishlistStorage";

type CartItem = {
  id: string;
  product_id: string;
  variant_id?: string | null;
  variant_label?: string | null;
brief_detail?: string | null;
image_url?: string | null;
title: string;
  qty: number;
  price_kobo: number;
  line_total_kobo: number;
};

type StoreGroup = {
  store_id: string;
  store_name: string;
  currency: string;
  subtotal_kobo: number;
  items: CartItem[];
};

export default function BagScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
const [checkingOut, setCheckingOut] = useState(false);
const [stores, setStores] = useState<StoreGroup[]>([]);
const [grandTotal, setGrandTotal] = useState(0);
const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
const [openQtyItemId, setOpenQtyItemId] = useState<string | null>(null);
const [openMenuItemId, setOpenMenuItemId] = useState<string | null>(null);
const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});

  async function loadCart() {
  try {
    setLoading(true);
    const res = await api.get("/cart");
    setStores(res.data.stores || []);
    const allItems = (res.data.stores || []).flatMap((s: any) => s.items);

const map: Record<string, boolean> = {};

for (const item of allItems) {
  const liked = await isInWishlist(item.product_id);
  map[item.product_id] = liked;
}

setLikedMap(map);
    setGrandTotal(res.data.grand_total_kobo || 0);
    setSelectedItems({});
  } catch (e) {
    console.error("CART LOAD ERROR:", e);
  } finally {
    setLoading(false);
  }
}

async function updateItemQty(itemId: string, nextQty: number) {
  if (nextQty < 1) return;

  try {
    await api.patch(`/cart/items/${itemId}`, {
      qty: nextQty,
    });
    setOpenQtyItemId(null);
    await loadCart();
  } catch (e) {
    console.error("UPDATE ITEM QTY ERROR:", e);
    Alert.alert("Update failed", "Could not update item quantity.");
  }
}

  async function removeItem(itemId: string) {
  try {
    setOpenMenuItemId(null);
    await api.delete(`/cart/items/${itemId}`);
    await loadCart();
  } catch (e) {
    console.error("REMOVE ITEM ERROR:", e);
    Alert.alert("Delete failed", "Could not remove item from bag.");
  }
}

    function toggleItem(itemId: string) {
    setSelectedItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  }

  async function handleCheckout() {
  if (selectedItemIds.length === 0) {
    Alert.alert("Select items", "Please select at least one item to checkout.");
    return;
  }

  const selectedItemsData = stores.flatMap((store) =>
  store.items
    .filter((item) => selectedItems[item.id])
    .map((item) => ({
      id: item.id,
      title: item.title,
      brief_detail: item.brief_detail,
      image_url: item.image_url || null,
      qty: item.qty,
      price_kobo: item.price_kobo,
    }))
);

navigation.navigate("Checkout", {
  cartItemIds: selectedItemIds,
  selectedTotalKobo: selectedTotal,
  selectedCount,
  items: selectedItemsData,
});
}

  useEffect(() => {
  const unsubscribe = navigation.addListener("focus", () => {
    loadCart();
  });

  return unsubscribe;
}, [navigation]);

    const selectedTotal = stores.reduce((total, store) => {
    return (
      total +
      store.items.reduce((sum, item) => {
        if (selectedItems[item.id]) {
          return sum + item.line_total_kobo;
        }
        return sum;
      }, 0)
    );
  }, 0);

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;
  const selectedItemIds = Object.keys(selectedItems).filter(
  (itemId) => selectedItems[itemId]
);

  return (
  <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.bagHeader}>
  <Text style={styles.bagHeaderTitle}>SHOPPING BAG</Text>

  <Pressable style={styles.bagHeaderIconButton}>
    <Ionicons name="search-outline" size={28} color="#111111" />
  </Pressable>
</View>

<View style={styles.headerDivider} />

{!loading && stores.length > 0 && (
  <>
    <Text style={styles.productCountText}>
      {stores.reduce((sum, store) => sum + store.items.length, 0)} PRODUCTS
    </Text>

    <View style={styles.headerDivider} />
  </>
)}

      {loading ? (
        <Text>Loading bag...</Text>
      ) : stores.length === 0 ? (
  <View style={styles.emptyContainer}>
    <View style={styles.emptyIconBox} />

    <Text style={styles.emptyTitle}>
      Your Shopping Bag Is Empty
    </Text>

    <Text style={styles.emptySubtitle}>
      Looks like you haven't added anything yet.
    </Text>

    <Pressable
  style={styles.emptyPrimaryButton}
  onPress={() => navigation.navigate("Home")}
>
      <Text style={styles.emptyPrimaryButtonText}>
        Start Shopping
      </Text>
    </Pressable>

    <Pressable
  style={styles.emptySecondaryButton}
  onPress={() => navigation.navigate("Wishlist")}
>
      <Text style={styles.emptySecondaryButtonText}>
        See Wishlist
      </Text>
    </Pressable>
  </View>
) : (
        <>
          {stores.map((store) => (
            <View key={store.store_id} style={styles.storeCard}>

              {store.items.map((item) => (
  <View key={item.id} style={styles.itemRow}>
    <Pressable
      onPress={() => toggleItem(item.id)}
      style={styles.checkbox}
    >
      <View
        style={[
          styles.checkboxInner,
          selectedItems[item.id] && styles.checkboxChecked,
        ]}
      />
    </Pressable>

    <View style={styles.imagePlaceholder} />

    <View style={styles.itemInfo}>
      <Text style={styles.itemTitle} numberOfLines={1} ellipsizeMode="tail">
  {item.title}
</Text>

<Text style={styles.variantText} numberOfLines={1} ellipsizeMode="tail">
  {item.brief_detail || item.variant_label || "No detail"}
</Text>

<Text style={styles.bagStoreName} numberOfLines={1} ellipsizeMode="tail">
  {store.store_name || "Store"}
</Text>

      <View style={styles.qtyRow}>
  <Text style={styles.qtyLabel}>Qty:</Text>

  <View style={styles.qtyWrap}>
    <Pressable
      style={styles.qtyDropdownButton}
      onPress={() =>
        setOpenQtyItemId((prev) => (prev === item.id ? null : item.id))
      }
    >
      <Text style={styles.qtyDropdownText}>{item.qty}</Text>
      <Text style={styles.qtyChevron}>⌄</Text>
    </Pressable>

    {openQtyItemId === item.id && (
      <View style={styles.qtyPickerPanel}>
        <ScrollView nestedScrollEnabled style={styles.qtyPickerScroll}>
          {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
            <Pressable
              key={num}
              style={styles.qtyOption}
              onPress={() => updateItemQty(item.id, num)}
            >
              <Text style={styles.qtyOptionText}>{num}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    )}
  </View>
</View>

<Text style={styles.priceText}>
  ₦{item.price_kobo / 100}
</Text>

    </View>

    <View style={styles.itemActionColumn}>
  <Pressable
  style={styles.itemHeartButton}
  onPress={async () => {
  const liked = likedMap[item.product_id];

  if (liked) {
    await removeWishlistItem(item.product_id);

    setLikedMap((prev) => ({
      ...prev,
      [item.product_id]: false,
    }));

    Alert.alert("Wishlist", "Item removed from wishlist.");
    return;
  }

  const result = await addWishlistItem({
    id: item.product_id,
    product_id: item.product_id,
    title: item.title,
    brief_detail: item.brief_detail || item.variant_label || null,
    store_name: store.store_name || "Store",
    price_kobo: item.price_kobo,
    image_url: item.image_url || null,
  });

  if (result.added) {
    setLikedMap((prev) => ({
      ...prev,
      [item.product_id]: true,
    }));
  }

  Alert.alert("Wishlist", "Item added to wishlist.");
}}
>
  <Ionicons
  name={likedMap[item.product_id] ? "heart" : "heart-outline"}
  size={18}
  color="#111111"
/>
</Pressable>

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
      onPress={() => removeItem(item.id)}
    >
      <Text style={[styles.itemMenuText, styles.deleteMenuText]}>
        Delete
      </Text>
    </Pressable>
  </View>
)}
</View>
  </View>
))}

              
            </View>
          ))}

        
        </>
      )}
              </ScrollView>

      {!loading && stores.length > 0 && (
        <View style={styles.footer}>
          <Text style={styles.grandTotal}>
            Total: ₦{selectedTotal / 100}
          </Text>

          <Pressable
            style={[
              styles.checkoutButton,
              (checkingOut || selectedCount === 0) && styles.disabled,
            ]}
            onPress={handleCheckout}
            disabled={checkingOut || selectedCount === 0}
          >
            <Text style={styles.checkoutButtonText}>
              {checkingOut
                ? "Processing..."
                : `CHECKOUT (${selectedCount})`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#F7F7F7",
    paddingBottom: 130,
  },
  screen: {
  flex: 1,
  backgroundColor: "#F7F7F7",
},
  bagHeader: {
  height: 121,
  paddingTop: 74,
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
},
bagHeaderTitle: {
  fontSize: 23.93,
  fontWeight: "700",
  color: "#111111",
},
bagHeaderIconButton: {
  width: 28,
  height: 28,
  alignItems: "center",
  justifyContent: "center",
  marginRight: -4,
},

headerDivider: {
  height: 1,
  backgroundColor: "#CFCFCF",
  marginHorizontal: -16,
},

productCountText: {
  fontSize: 21.08,
  lineHeight: 27.3,
  letterSpacing: -0.1,
  color: "#111111",
  fontWeight: "500",
  paddingTop: 15,
  paddingBottom: 13,
},
  qtyRow: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 20,
},
qtyLabel: {
  fontSize: 13,
  color: "#666666",
  marginRight: 8,
},
qtyWrap: {
  position: "relative",
},
qtyDropdownButton: {
  minWidth: 42,
  height: 22,
  borderWidth: 1,
  borderColor: "#111111",
  backgroundColor: "#FFFFFF",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: 6,
},
qtyDropdownText: {
  fontSize: 11,
  fontWeight: "600",
  color: "#111111",
},
qtyChevron: {
  fontSize: 11,
  color: "#111111",
  marginLeft: 4,
  marginTop: -8,
},
qtyPickerPanel: {
  position: "absolute",
  top: 32,
  left: 0,
  width: 64,
  maxHeight: 140,
  borderWidth: 1,
  borderColor: "#CFCFCF",
  backgroundColor: "#FFFFFF",
  zIndex: 999,
  elevation: 8,
},
qtyPickerScroll: {
  maxHeight: 140,
},
qtyOption: {
  paddingVertical: 10,
  alignItems: "center",
  borderBottomWidth: 1,
  borderBottomColor: "#EEEEEE",
},
qtyOptionText: {
  fontSize: 14,
  color: "#111111",
},
itemActionColumn: {
  position: "absolute",
  top: 0,
  right: 16,
  bottom: 18,
  justifyContent: "space-between",
  alignItems: "center",
},

itemHeartButton: {
  padding: 4,
},

itemOptionsButton: {
  padding: 4,
},
  storeCard: {
  backgroundColor: "#F7F7F7",
  paddingVertical: 8,
  marginBottom: 8,
},
  itemRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  position: "relative",
  minHeight: 165,
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: "#E5E5E5",
},
  
  imagePlaceholder: {
  width: 115,
  height: 175,
  backgroundColor: "#DCE6EC",
  marginRight: 11,
},
    checkbox: {
  width: 30,
  height: 22.14,
  marginRight: 20,
  marginTop: 70,
  borderWidth: 1,
  borderColor: "#111111",
  backgroundColor: "#FFFFFF",
  alignItems: "center",
  justifyContent: "center",
},
checkboxInner: {
  width: 20,
  height: 14.39,
  borderWidth: 1,
  borderColor: "#111111",
  backgroundColor: "#FFFFFF",
},
checkboxChecked: {
  backgroundColor: "#111111",
},
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
  fontSize: 13.66,
  lineHeight: 17.7,
  letterSpacing: -0.06,
  fontWeight: "700",
  color: "#111111",
  marginBottom: 20,
},
  variantText: {
  fontSize: 13.49,
  lineHeight: 17.5,
  letterSpacing: -0.06,
  fontWeight: "600",
  color: "#444444",
  marginBottom: 20,
},
bagStoreName: {
  fontSize: 13.49,
  lineHeight: 17.5,
  letterSpacing: -0.06,
  fontWeight: "600",
  color: "#666666",
  marginBottom: 20,
},
  priceText: {
  fontSize: 16.55,
  lineHeight: 21.4,
  letterSpacing: -0.08,
  fontWeight: "600",
  color: "#111111",
  marginBottom: 9,
},
  footer: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "#FFFFFF",
  paddingHorizontal: 16,
  paddingTop: 12,
  paddingBottom: 18,
  borderTopWidth: 1,
  borderTopColor: "#E5E5E5",
},
  grandTotal: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 12,
  },
  checkoutButton: {
    backgroundColor: "#111111",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  checkoutButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  emptyContainer: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingTop: 80,
},

emptyIconBox: {
  width: 90,
  height: 90,
  backgroundColor: "#EAEAEA",
  borderRadius: 45,
  marginBottom: 20,
},

emptyTitle: {
  fontSize: 18,
  fontWeight: "700",
  color: "#111111",
  marginBottom: 8,
},

emptySubtitle: {
  fontSize: 14,
  color: "#666666",
  textAlign: "center",
  marginBottom: 24,
},

emptyPrimaryButton: {
  width: "80%",
  backgroundColor: "#111111",
  paddingVertical: 14,
  borderRadius: 10,
  alignItems: "center",
  marginBottom: 12,
},

emptyPrimaryButtonText: {
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: "700",
},

emptySecondaryButton: {
  width: "80%",
  paddingVertical: 14,
  borderRadius: 10,
  alignItems: "center",
  borderWidth: 1,
  borderColor: "#111111",
},

emptySecondaryButtonText: {
  fontSize: 16,
  fontWeight: "600",
  color: "#111111",
},
itemMenu: {
  position: "absolute",
  right: 0,
  bottom: 32,
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
  disabled: {
    opacity: 0.6,
  },
});