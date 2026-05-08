import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Image,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api/client";
import {
  addWishlistItem,
  getWishlistCount,
  isInWishlist,
  removeWishlistItem,
} from "../storage/wishlistStorage";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;
type Product = {
  id: string;
  store_id: string;
  store_name?: string;
  title: string;
  brief_detail?: string;
  description?: string;
  price_kobo: number;
  variants?: Array<{
    id: string;
    option_label: string;
    stock_qty: number;
    price_override_kobo?: number | null;
  }>;
};

type Props = {
  route: {
    params: {
      productId: string;
    };
  };
  navigation: any;
};

export default function ProductDetailScreen({ route, navigation }: Props) {
  const { productId } = route.params;

  const [status, setStatus] = useState("Loading product...");
  const [product, setProduct] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);
const [addBagMessage, setAddBagMessage] = useState("");
const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
const [qty, setQty] = useState(1);
const [showQtyPicker, setShowQtyPicker] = useState(false);
const [showFullDetails, setShowFullDetails] = useState(false);
const [wishlistCount, setWishlistCount] = useState(0);
const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    async function loadProduct() {
      try {
        const res = await api.get(`/products/${productId}`);
        const productData = res.data.product || res.data;
        const variants = res.data.variants || [];

        setProduct({ ...productData, variants });

        if (variants.length > 0) {
          setSelectedVariantId(variants[0].id);
        }

        setStatus("Loaded ✅");
      } catch (e) {
        console.error(e);
        setStatus("Failed to load product ❌");
      }
    }

        loadProduct();
getWishlistCount().then(setWishlistCount);
isInWishlist(productId).then(setIsLiked);
  }, [productId]);

    async function handleAddToBag() {
  if (!product) return;

  if (product.variants && product.variants.length > 0 && !selectedVariantId) {
    setAddBagMessage("Please choose a size before adding to bag.");
    return;
  }

  try {
    setAdding(true);
    setAddBagMessage("Adding item to bag...");

    await api.post("/cart/items", {
      store_id: product.store_id,
      product_id: product.id,
      variant_id: selectedVariantId,
      qty,
    });

    setAddBagMessage("Added to bag successfully.");
    navigation.navigate("Bag");
  } catch (e: any) {
    const serverMessage =
      e?.response?.data?.error ||
      e?.response?.data?.message ||
      "Failed to add to bag.";

    setAddBagMessage(`Error: ${serverMessage}`);
  } finally {
    setAdding(false);
  }
}

  if (!product) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.status}>{status}</Text>
      </View>
    );
  }

  const selectedVariant =
    product.variants?.find((v) => v.id === selectedVariantId) || null;

  const displayPrice =
  selectedVariant && selectedVariant.price_override_kobo != null
    ? selectedVariant.price_override_kobo
    : product.price_kobo;

async function handleAddToWishlist() {
  if (!product) return;

  if (isLiked) {
    await removeWishlistItem(product.id);
    setIsLiked(false);

    const count = await getWishlistCount();
    setWishlistCount(count);

    Alert.alert("Wishlist", "Item removed from wishlist.");
    return;
  }

  const result = await addWishlistItem({
  id: product.id,
  product_id: product.id,
  store_id: product.store_id,
  title: product.title,
  brief_detail:
    product.brief_detail ??
    selectedVariant?.option_label ??
    null,
  store_name: product.store_name ?? "Store",
  price_kobo: displayPrice,
  image_url: null,
});

  const count = await getWishlistCount();
  setWishlistCount(count);

  if (result.added) {
    setIsLiked(true);
  }

  Alert.alert("Wishlist", "Item added to wishlist.");
}

return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageSection}>
          <View style={styles.topIconsRow}>
            <Pressable style={styles.circleButton} onPress={() => navigation.goBack()}>
              <Image
                source={require("../../assets/icons/back-arrow.png")}
                style={styles.topIconImage}
                resizeMode="contain"
              />
            </Pressable>

            <View style={styles.rightIcons}>
              <Pressable style={styles.circleButton}>
                <Image
                  source={require("../../assets/icons/search.png")}
                  style={styles.topIconImage}
                  resizeMode="contain"
                />
              </Pressable>

              <Pressable style={styles.circleButton}>
                <Image
                  source={require("../../assets/icons/share.png")}
                  style={styles.topIconImage}
                  resizeMode="contain"
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.mainImagePlaceholder} />

          <View style={styles.imageCountPill}>
            <Text style={styles.imageCountText}>Items 1/7</Text>
          </View>

          <View style={styles.floatingHeart}>
  <Pressable onPress={handleAddToWishlist}>
    <Ionicons
  name={isLiked ? "heart" : "heart-outline"}
  size={22}
  color="#111111"
/>
  </Pressable>

  {wishlistCount > 0 && (
    <View style={styles.wishlistBadge}>
      <Text style={styles.wishlistBadgeText}>{wishlistCount}</Text>
    </View>
  )}
</View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbRow}
        >
          <View style={[styles.thumbBox, styles.thumbBoxActive]} />
          <View style={styles.thumbBox} />
          <View style={styles.thumbBox} />
          <View style={styles.thumbBox} />
          <View style={styles.thumbBox} />
          <View style={styles.thumbBox} />
          <View style={styles.thumbBox} />
        </ScrollView>

        <View style={styles.content}>
          <View style={styles.sizeHeaderRow}>
            <Text style={styles.sizeTitle}>Size</Text>
            <Pressable style={styles.sizeGuideBtn}>
  <Image
    source={require("../../assets/icons/ruler.png")}
    style={styles.sizeGuideIcon}
    resizeMode="contain"
  />
  <Text style={styles.sizeGuideText}>Size guide</Text>
</Pressable>
          </View>

          <View style={styles.sizeRow}>
            {product.variants && product.variants.length > 0 ? (
              product.variants.map((variant) => {
                const selected = selectedVariantId === variant.id;

                return (
                  <Pressable
                    key={variant.id}
                    style={[styles.sizeChip, selected && styles.sizeChipActive]}
                    onPress={() => setSelectedVariantId(variant.id)}
                  >
                    <Text
                      style={[
                        styles.sizeChipText,
                        selected && styles.sizeChipTextActive,
                      ]}
                    >
                      {variant.option_label}
                    </Text>
                  </Pressable>
                );
              })
            ) : (
              <>
                <View style={styles.sizeChip}><Text style={styles.sizeChipText}>S/36</Text></View>
                <View style={styles.sizeChip}><Text style={styles.sizeChipText}>M/38</Text></View>
                <View style={styles.sizeChip}><Text style={styles.sizeChipText}>L/40</Text></View>
                <View style={styles.sizeChip}><Text style={styles.sizeChipText}>XL/42</Text></View>
              </>
            )}
          </View>

                    <Text style={styles.productName} numberOfLines={1} ellipsizeMode="tail">
  {product.title}
</Text>

<Text style={styles.productBriefDetail} numberOfLines={1} ellipsizeMode="tail">
  {product.brief_detail || "No brief detail"}
</Text>

<Text style={styles.productStoreName} numberOfLines={1} ellipsizeMode="tail">
  {product.store_name || "Store"}
</Text>

          <View style={styles.productQtyRow}>
            <Text style={styles.qtyLabel}>Qty:</Text>

            <View style={styles.qtyWrap}>
              <Pressable
                style={styles.qtyDropdownButton}
                onPress={() => setShowQtyPicker((prev) => !prev)}
              >
                <Text style={styles.qtyDropdownText}>{qty}</Text>
                <Ionicons name="chevron-down" size={16} color="#111111" />
              </Pressable>

              {showQtyPicker && (
                <View style={styles.qtyPickerPanel}>
                  <ScrollView nestedScrollEnabled style={styles.qtyPickerScroll}>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
                      <Pressable
                        key={num}
                        style={styles.qtyOption}
                        onPress={() => {
                          setQty(num);
                          setShowQtyPicker(false);
                        }}
                      >
                        <Text style={styles.qtyOptionText}>{num}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>

          <Text style={styles.productPrice} numberOfLines={1} ellipsizeMode="tail">
            ₦{displayPrice / 100}
          </Text>

          <View style={styles.otherShoppingHeader}>
            <Text style={styles.otherShoppingTitle}>Others shopping</Text>
            <Text style={styles.otherShoppingSeeAll}>See all</Text>
          </View>

          <View style={styles.otherShoppingBox}>
            <View style={styles.otherShoppingSegment}>
              <View style={styles.diagonalLine} />
            </View>
            <View style={styles.otherShoppingSegment}>
              <View style={styles.diagonalLine} />
            </View>
            <View style={styles.otherShoppingSegment}>
              <View style={styles.diagonalLine} />
            </View>
            <View style={styles.otherShoppingSegment}>
              <View style={styles.diagonalLine} />
            </View>
          </View>
          <View style={styles.tabsRow}>
  <Pressable style={[styles.tabButton, styles.tabButtonActive]}>
    <Text style={[styles.tabText, styles.tabTextActive]}>Overview</Text>
  </Pressable>

  <Pressable style={styles.tabButton}>
    <Text style={styles.tabText}>Reviews</Text>
  </Pressable>

  <Pressable style={styles.tabButton}>
    <Text style={styles.tabText}>Description</Text>
  </Pressable>
</View>

<View style={styles.addressCard}>
  <Text style={styles.addressTitle}>Choose drop-off point</Text>
  <Text style={styles.addressText}>
    Select where you want this item delivered for easier handoff.
  </Text>
</View>

<View style={styles.reviewsPreviewCard}>
  <View style={styles.sectionHeaderRow}>
    <Text style={styles.sectionHeaderTitle}>Reviews</Text>
    <Text style={styles.sectionHeaderAction}>See all</Text>
  </View>

  <Text style={styles.reviewSnippet}>
    “Very neat product and fast delivery. Seller communication was good.”
  </Text>
</View>

<View style={styles.detailsCard}>
  <Text style={styles.detailsTitle}>Product details</Text>

  <Text
    style={styles.detailsText}
    numberOfLines={showFullDetails ? undefined : 3}
  >
    {product.description || "No product details yet."}
  </Text>

  <Pressable
    style={styles.viewMoreButton}
    onPress={() => setShowFullDetails((prev) => !prev)}
  >
    <Text style={styles.viewMoreButtonText}>
      {showFullDetails ? "View less" : "View more"}
    </Text>
  </Pressable>
</View>

<Pressable
  style={styles.storeCard}
  onPress={() => navigation.navigate("StoreDetail", { storeId: product.store_id })}
>
  <View style={styles.storeProfileRow}>
    <View style={styles.storeAvatarCircle} />

    <View style={styles.storeProfileTextArea}>
      <View style={styles.storeNameLine}>
        <Text style={styles.storeProfileName}>
          {product.store_name || "Shoprite"}
        </Text>
        <Ionicons name="chevron-forward" size={20} color="#111111" />
      </View>

      <View style={styles.storeMetaLine}>
        <Text style={styles.storeMetaText}>Store rating</Text>
        <Text style={styles.storeMetaSmall}>(3.9)</Text>

        <Text style={styles.storeMetaText}>Communication</Text>
        <Text style={styles.storeMetaSmall}>(4.2)</Text>
      </View>
    </View>
  </View>
</Pressable>

<View style={styles.moreLikeThisHeader}>
  <Text style={styles.moreLikeThisTitle}>All your faves are here</Text>
  <Text style={styles.sectionHeaderAction}>See all</Text>
</View>

<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={styles.recommendationRow}
>
  <View style={styles.recommendationCard} />
  <View style={styles.recommendationCard} />
  <View style={styles.recommendationCard} />
  <View style={styles.recommendationCard} />
</ScrollView>
        </View>
      </ScrollView>

            {addBagMessage ? (
        <View style={styles.addBagMessageWrap}>
          <Text style={styles.addBagMessageText}>{addBagMessage}</Text>
        </View>
      ) : null}

      <View style={styles.bottomBar}></View>

      <View style={styles.bottomBar}>
        <Pressable style={styles.bottomIconButton}>
          <Image
            source={require("../../assets/icons/home.png")}
            style={styles.bottomIconImage}
            resizeMode="contain"
          />
        </Pressable>

        <Pressable style={styles.bottomIconButton}>
          <Image
            source={require("../../assets/icons/chat.png")}
            style={styles.bottomIconImage}
            resizeMode="contain"
          />
        </Pressable>

        <Pressable style={styles.bottomIconButton}>
          <Image
            source={require("../../assets/icons/bag.png")}
            style={styles.bottomIconImage}
            resizeMode="contain"
          />
        </Pressable>

        <Pressable
  style={styles.addToBagButton}
  onPress={() => {
    console.log("ADD TO BAG BUTTON PRESSED");
    handleAddToBag();
  }}
  disabled={adding}
>
          <Text style={styles.addToBagText}>
            {adding ? "Adding..." : "Add to bag"}
          </Text>
        </Pressable>

        <Pressable style={styles.buyNowButton}>
          <Text style={styles.buyNowText}>Buy now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F5F5",
  },
  status: {
    color: "#555",
  },
  scrollContent: {
    paddingBottom: 120,
  },
    addBagMessageWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 78,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9D9D9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 1000,
  },
  addBagMessageText: {
    fontSize: 13,
    color: "#111111",
    textAlign: "center",
  },
  tabsRow: {
  height: 78,
  flexDirection: "row",
  alignItems: "flex-end",
  borderTopWidth: 24,
  borderBottomWidth: 1,
  borderTopColor: "#ECECEC",
  borderBottomColor: "#DDDDDD",
  marginTop: 10,
  marginBottom: 10,
},

tabButton: {
  flex: 1,
  alignItems: "center",
  justifyContent: "flex-end",
  paddingBottom: 10,
},

tabButtonActive: {
  borderBottomWidth: 2,
  borderBottomColor: "#111111",
},

tabText: {
  fontSize: 14,
  color: "#666666",
},

tabTextActive: {
  color: "#111111",
  fontWeight: "700",
},

addressCard: {
  backgroundColor: "transparent",
paddingVertical: 12,
borderBottomWidth: 1,
borderBottomColor: "#EAEAEA",
marginBottom: 10,
},

addressTitle: {
  fontSize: 15,
  fontWeight: "700",
  color: "#111111",
  marginBottom: 10,
},
viewMoreButton: {
  alignSelf: "center",
  marginTop: 10,
  borderWidth: 1,
  borderColor: "#111111",
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 6,
},

viewMoreButtonText: {
  fontSize: 13,
  color: "#111111",
},

addressText: {
  fontSize: 13,
  lineHeight: 20,
  color: "#5A5A5A",
},

reviewsPreviewCard: {
  backgroundColor: "transparent",
paddingVertical: 12,
borderBottomWidth: 1,
borderBottomColor: "#EAEAEA",
marginBottom: 10,
marginTop: 10,
},

sectionHeaderRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
},

sectionHeaderTitle: {
  fontSize: 16,
  fontWeight: "700",
  color: "#111111",
},

sectionHeaderAction: {
  fontSize: 13,
  color: "#777777",
},

reviewSnippet: {
  fontSize: 13,
  lineHeight: 20,
  color: "#4A4A4A",
},

detailsCard: {
  backgroundColor: "transparent",
paddingVertical: 12,
borderBottomWidth: 1,
borderBottomColor: "#EAEAEA",
marginBottom: 10,
marginTop: 10,
},

detailsTitle: {
  fontSize: 16,
  fontWeight: "700",
  color: "#111111",
  marginBottom: 10,
},

detailsText: {
  fontSize: 14,
  lineHeight: 22,
  color: "#444444",
},

storeCard: {
  backgroundColor: "#FFFFFF",
  paddingVertical: 8,
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderTopColor: "#E5E5E5",
  borderBottomColor: "#E5E5E5",
  marginTop: 0,
  marginBottom: 0,
},

storeProfileRow: {
  minHeight: 56,
  flexDirection: "row",
  alignItems: "center",
},

storeAvatarCircle: {
  width: 43,
  height: 43,
  borderRadius: 21.5,
  borderWidth: 1,
  borderColor: "#9B9B9B",
  backgroundColor: "#FFFFFF",
  marginRight: 10,
},

storeProfileTextArea: {
  flex: 1,
},

storeNameLine: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 4,
},

storeProfileName: {
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
  marginRight: 6,
},

storeMetaLine: {
  flexDirection: "row",
  alignItems: "center",
  flexWrap: "wrap",
},

storeMetaText: {
  fontSize: 15,
  color: "#111111",
  marginRight: 2,
},

storeMetaSmall: {
  fontSize: 12,
  color: "#111111",
  marginRight: 12,
},

moreLikeThisHeader: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
  marginTop: 10,
},

moreLikeThisTitle: {
  fontSize: 16,
  fontWeight: "700",
  color: "#111111",
},

recommendationRow: {
  paddingBottom: 10,
},

recommendationCard: {
  width: 130,
  height: 180,
  backgroundColor: "#E3E3E3",
  marginRight: 8,
  borderRadius: 8,
},

  imageSection: {
    backgroundColor: "#DCE6EC",
    height: 360 + TOP_SAFE_SPACE,
    position: "relative",
  },
  topIconsRow: {
    position: "absolute",
    top: TOP_SAFE_SPACE + 12,
    left: 12,
    right: 12,
    zIndex: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rightIcons: {
    flexDirection: "row",
    gap: 10,
  },
  circleButton: {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: "rgba(255,255,255,0.92)",
  alignItems: "center",
  justifyContent: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 1,
},
  topIconImage: {
    width: 19,
    height: 19,
  },
  mainImagePlaceholder: {
    flex: 1,
    backgroundColor: "#DCE6EC",
  },
  imageCountPill: {
    position: "absolute",
    left: 10,
    bottom: 12,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  imageCountText: {
    fontSize: 12,
    color: "#111111",
    fontWeight: "500",
  },
  floatingHeart: {
  position: "absolute",
  right: 12,
  bottom: 12,
  width: 38,
  height: 38,
  borderRadius: 19,
  backgroundColor: "rgba(255,255,255,0.92)",
  alignItems: "center",
  justifyContent: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 1,
},
  heartImage: {
    width: 20,
    height: 20,
  },
  wishlistBadge: {
  position: "absolute",
  top: -4,
  right: -4,
  backgroundColor: "#000000",
  borderRadius: 8,
  minWidth: 16,
  height: 16,
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 3,
},

wishlistBadgeText: {
  color: "#FFFFFF",
  fontSize: 10,
  fontWeight: "700",
},

  thumbRow: {
  paddingHorizontal: 0,
  paddingTop: 8,
  paddingBottom: 12,
  backgroundColor: "#F5F5F5",
},

  thumbBox: {
    width: 64,
    height: 64,
    backgroundColor: "#E2E8EC",
    marginRight: 0,
    borderWidth: 1,
    borderColor: "#D7D7D7",
  },
  thumbBoxActive: {
    borderColor: "#111111",
    borderWidth: 2,
    backgroundColor: "#DCE6EC",
  },

  content: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  sizeHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sizeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111111",
  },
  sizeGuideBtn: {
  width: 90,
  height: 26,
  backgroundColor: "#111111",
  borderRadius: 4,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 6,
},
sizeGuideIcon: {
  width: 20,
  height: 20,
  marginRight: 6,
  tintColor: "#FFFFFF",
},
  sizeGuideText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
  },
  sizeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  sizeChip: {
    borderWidth: 1,
    borderColor: "#777",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FFFFFF",
  },
  sizeChipActive: {
  borderColor: "#111111",
  borderWidth: 2,
  backgroundColor: "#FFFFFF",
},
  sizeChipText: {
    fontSize: 14,
    color: "#111111",
  },
  sizeChipTextActive: {
    fontWeight: "700",
  },

  productName: {
  fontSize: 19,
  lineHeight: 24,
  fontWeight: "700",
  color: "#111111",
  marginBottom: 10,
},

productBriefDetail: {
  fontSize: 14,
  lineHeight: 20,
  color: "#444444",
  marginBottom: 10,
},

productStoreName: {
  fontSize: 14,
  lineHeight: 20,
  color: "#555555",
  marginBottom: 12,
},

productQtyRow: {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 12,
  zIndex: 999,
},

productPrice: {
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
  marginBottom: 12,
},
    qtyWrap: {
  position: "relative",
  flexDirection: "row",
  alignItems: "center",
  zIndex: 999,
},
  qtyLabel: {
    fontSize: 14,
    marginRight: 8,
    color: "#444444",
  },
    qtyDropdownButton: {
    minWidth: 58,
    height: 32,
    borderWidth: 1,
    borderColor: "#999",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  qtyDropdownText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111111",
  },
    qtyPickerPanel: {
  position: "absolute",
  top: 38,
  right: 0,
  width: 72,
  maxHeight: 140,
  borderWidth: 1,
  borderColor: "#111111",
  backgroundColor: "#FFFFFF",
  zIndex: 999,
  elevation: 20,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.15,
  shadowRadius: 8,
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

  otherShoppingHeader: {
    marginTop: 4,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  otherShoppingTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#222222",
  },
  otherShoppingSeeAll: {
    fontSize: 14,
    color: "#666666",
  },
  otherShoppingBox: {
    height: 110,
    backgroundColor: "#F0F0F0",
    flexDirection: "row",
  },
  otherShoppingSegment: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  diagonalLine: {
    position: "absolute",
    width: 140,
    height: 1,
    backgroundColor: "#CFCFCF",
    top: 55,
    left: -20,
    transform: [{ rotate: "106.43deg" }],
  },

  bottomBar: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 71,
  backgroundColor: "#F5F5F5",
  borderTopWidth: 1,
  borderTopColor: "#E0E0E0",
  paddingHorizontal: 12,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},
  bottomIconButton: {
  width: 38,
  height: 38,
  alignItems: "center",
  justifyContent: "center",
},
  bottomIconImage: {
    width: 20,
    height: 20,
  },
  bottomMiniBadge: {
    position: "absolute",
    right: -2,
    top: 1,
    fontSize: 11,
    fontWeight: "700",
    color: "#111111",
  },
  addToBagButton: {
    width: 118,
    marginHorizontal: 6,
    height: 46,
    borderWidth: 1.5,
    borderColor: "#111111",
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  addToBagText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111111",
  },
  buyNowButton: {
    width: 118,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  buyNowText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});