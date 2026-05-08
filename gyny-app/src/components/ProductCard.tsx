import React from "react";
import { Pressable, StyleSheet, Text, View, Image, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  addWishlistItem,
  getWishlistCount,
  isInWishlist,
  removeWishlistItem,
} from "../storage/wishlistStorage";
import { api } from "../api/client";

type Product = {
  id: string;
  store_id: string;
  title: string;
  price_kobo: number;
  brief_detail?: string | null;
  store_name?: string | null;
};

type Props = {
  product: Product;
  onPress?: () => void;
  variant?: "grid" | "horizontal";
  onWishlistChange?: (count: number) => void;
};

export default function ProductCard({
  product,
  onPress,
  variant = "grid",
  onWishlistChange,
}: Props) {
  const isHorizontal = variant === "horizontal";
const [isLiked, setIsLiked] = React.useState(false);

React.useEffect(() => {
  isInWishlist(product.id).then(setIsLiked);
}, [product.id]);

  async function handleHeartPress() {
  if (isLiked) {
    await removeWishlistItem(product.id);
    setIsLiked(false);

    const count = await getWishlistCount();
    onWishlistChange?.(count);

    Alert.alert("Wishlist", "Item removed from wishlist.");
    return;
  }

  const result = await addWishlistItem({
  id: product.id,
  product_id: product.id,
  store_id: product.store_id,
  title: product.title,
  brief_detail: product.brief_detail || null,
  store_name: product.store_name || "Store",
  price_kobo: product.price_kobo,
  image_url: null,
});

  const count = await getWishlistCount();
  onWishlistChange?.(count);

  if (result.added) {
    setIsLiked(true);
  }

  Alert.alert("Wishlist", "Item added to wishlist.");
}

async function handleAddToBag() {
  try {
    await api.post("/cart/items", {
      store_id: product.store_id,
      product_id: product.id,
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
}

  return (
    <View style={styles.card}>
      <Pressable style={styles.imageWrap} onPress={onPress}>
        <View
          style={[
            styles.imagePlaceholder,
            isHorizontal ? styles.imageHorizontal : styles.imageGrid,
          ]}
        />

        <Pressable
  style={styles.heartButton}
  onPress={(event) => {
    event.stopPropagation();
    handleHeartPress();
  }}
>
          <Ionicons
  name={isLiked ? "heart" : "heart-outline"}
  size={17}
  color="#111111"
/>
        </Pressable>

        
              
      </Pressable>

      <View style={styles.detailsArea}>
  <View style={styles.storePill}>
    <Text style={styles.storePillText} numberOfLines={1}>
      {product.store_name || "Store"}
    </Text>
  </View>

  <Text style={styles.title} numberOfLines={2}>
    {product.title}
  </Text>

        <Text style={styles.qtyText}>Qty: 1</Text>
        <Text style={styles.price}>₦{product.price_kobo / 100}</Text>

        <View style={styles.actionRow}>
          <Pressable
  style={styles.addToBagButton}
  onPress={(event) => {
    event.stopPropagation();
    handleAddToBag();
  }}
>
            <Image
              source={require("../../assets/icons/add-to-bag-full.png")}
              style={styles.addToBagImage}
              resizeMode="contain"
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    backgroundColor: "transparent",
  },
  imageWrap: {
    position: "relative",
    width: "100%",
    marginBottom: 6,
    overflow: "hidden",
  },
  imagePlaceholder: {
    width: "100%",
    backgroundColor: "#D9E3E8",
  },
  imageGrid: {
    width: "100%",
    aspectRatio: 205 / 250,
  },
  imageHorizontal: {
    width: "100%",
    aspectRatio: 152 / 250,
  },
  heartButton: {
    position: "absolute",
    top: 7,
    right: 7,
    zIndex: 2,
    width: 28,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.68)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  storePill: {
  alignSelf: "flex-start",
  width: 86,
  height: 13,
  backgroundColor: "#7D1427",
  marginBottom: 4,
  justifyContent: "center",
  alignItems: "center",
},
  storePillText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  detailsArea: {
    backgroundColor: "#F5F5F5",
    paddingTop: 0,
    paddingBottom: 0,
  },
  title: {
    fontSize: 12,
    lineHeight: 14,
    color: "#111111",
    marginBottom: 2,
  },
  qtyText: {
    fontSize: 11,
    color: "#666666",
    marginBottom: 2,
  },
  price: {
  fontSize: 14,
  fontWeight: "700",
  color: "#7D1427",
  marginBottom: 4,
},
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginTop: 0,
  },
  cardPressed: {
    opacity: 0.92,
  },
  addToBagButton: {
    alignSelf: "flex-start",
  },
  addToBagImage: {
    width: 92,
    height: 26,
  },
});