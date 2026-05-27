import React, { useEffect, useRef, useState } from "react";
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
  Modal,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DropoffLocationIcon from "../../assets/icons/location/dropoff-location.svg";
import EditLocationIcon from "../../assets/icons/location/edit-location.svg";
import ProductInfoSizeGuideIcon from "../../assets/icons/product-info/size-guide.svg";
import ProductInfoReportIcon from "../../assets/icons/product-info/report.svg";
import ProductInfoLightIcon from "../../assets/icons/product-info/light.svg";
import ProductInfoChevronRightIcon from "../../assets/icons/product-info/chevron-right.svg";
import ProductInfoCloseIcon from "../../assets/icons/product-info/close-circle.svg";
import RatingStars from "../components/RatingStars";
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
const [showProductInfo, setShowProductInfo] = useState(false);
const [showStoreHours, setShowStoreHours] = useState(false);
const [wishlistCount, setWishlistCount] = useState(0);
const [isLiked, setIsLiked] = useState(false);
const [selectedImageIndex, setSelectedImageIndex] = useState(0);
const [showStickyTabs, setShowStickyTabs] = useState(false);
const [activeStickyTab, setActiveStickyTab] = useState<
  "Overview" | "Reviews" | "Description"
>("Overview");
const pickupSlideAnim = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
  const animation = Animated.loop(
    Animated.sequence([
      Animated.timing(pickupSlideAnim, {
        toValue: 1,
        duration: 8500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(pickupSlideAnim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ])
  );

  animation.start();

  return () => {
    animation.stop();
  };
}, [pickupSlideAnim]);

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

    const imageVariants = Array.from({ length: 7 }, (_, index) => index);
    const collapsedReviews = [
  {
    id: "1",
    name: "Terhide: Green/M",
    date: "Apr 15, 2026",
    rating: 4.6,
    text: "Very nice product it was delivered on time and i like the seller",
  },
  {
    id: "2",
    name: "Amaka: Black/L",
    date: "Apr 12, 2026",
    rating: 3.8,
    text: "The item matched what I saw and the delivery was smooth.",
  },
  {
    id: "3",
    name: "Daniel: Blue/M",
    date: "Apr 10, 2026",
    rating: 4.2,
    text: "Good quality for the price. Seller communication was clear.",
  },
  {
    id: "4",
    name: "Bisi: White/S",
    date: "Apr 8, 2026",
    rating: 3.5,
    text: "I like the fit and the item came in good condition.",
  },
];

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
      <ScrollView
  contentContainerStyle={styles.scrollContent}
  scrollEventThrottle={16}
  onScroll={(event) => {
  const y = event.nativeEvent.contentOffset.y;

  setShowStickyTabs(y > 430);

  if (y > 1120) {
    setActiveStickyTab("Description");
  } else if (y > 760) {
    setActiveStickyTab("Reviews");
  } else {
    setActiveStickyTab("Overview");
  }
}}
>
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
            <Text style={styles.imageCountText}>
  Items {selectedImageIndex + 1}/{imageVariants.length}
</Text>
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
  {imageVariants.map((itemIndex) => {
    const isSelected = selectedImageIndex === itemIndex;

    return (
      <Pressable
        key={itemIndex}
        style={[styles.thumbBox, isSelected && styles.thumbBoxActive]}
        onPress={() => setSelectedImageIndex(itemIndex)}
      />
    );
  })}
</ScrollView>

        <View style={styles.content}>
          <View style={styles.sizeHeaderRow}>
            <Text style={styles.sizeTitle}>Size</Text>
            <Pressable
  style={styles.sizeGuideBtn}
  onPress={() => navigation.navigate("SizeGuide")}
>
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

  <Pressable onPress={() => navigation.navigate("OtherShoppers")}>
    <Text style={styles.otherShoppingSeeAll}>See all</Text>
  </Pressable>
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

          <View style={styles.afterOtherShoppingDivider} />
          

<Pressable
  style={styles.deliverySection}
  onPress={() =>
    navigation.navigate("ChooseLocation", {
      storeName: product.store_name || "Store",
      storeAddress: "Store address will show here",
    })
  }
>
  <Text style={styles.deliveryTitle}>Choose Address</Text>

  <View style={styles.dropoffInputBox}>
  <DropoffLocationIcon width={22} height={22} />

  <Text style={styles.dropoffInputText}>Dropoff location</Text>

  <EditLocationIcon width={18} height={18} />
</View>
</Pressable>

<View style={styles.fullWidthSectionDivider} />

<Pressable
  style={styles.storeTimingSection}
  onPress={() => setShowStoreHours(true)}
>
  <View style={styles.storeHoursRow}>
    <View style={styles.storeHoursTitleRow}>
      <Text style={styles.storeHoursTitle}>Store hours</Text>
      <Ionicons name="chevron-forward" size={20} color="#111111" />
    </View>

    <ProductInfoLightIcon width={22} height={22} />
  </View>

  <Text style={styles.storeHoursText}>Monday: 9:00 AM - 8:00 PM</Text>
  <Text style={styles.storeHoursText}>Tuesday: 9:00 AM - 8:00 PM</Text>
</Pressable>

<View style={styles.fullWidthSectionDivider} />

<View style={styles.pickupEstimateSection}>
  <Animated.Text
    numberOfLines={1}
    style={[
      styles.pickupEstimateText,
      {
        transform: [
          {
            translateX: pickupSlideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [360, -520],
            }),
          },
        ],
      },
    ]}
  >
    Estimated pickup: 5–10 mins after order confirmation
  </Animated.Text>
</View>

<View style={styles.fullWidthSectionDivider} />

<Pressable
  style={styles.reviewsPreviewCard}
  onPress={() => navigation.navigate("ProductReviews")}
>
  <View style={styles.reviewHeaderRow}>
    <View style={styles.reviewHeaderLeft}>
      <Text style={styles.reviewTitle}>Reviews</Text>

      <View style={styles.verifiedBadge}>
        <Text style={styles.verifiedBadgeText}>
          All from verified purchases
        </Text>
      </View>
    </View>

    <Ionicons name="chevron-forward" size={22} color="#111111" />
  </View>

  <ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={styles.reviewImageStrip}
>
  <View style={styles.reviewImageTile} />
  <View style={styles.reviewImageTile} />
  <View style={styles.reviewImageTile} />
  <View style={styles.reviewImageTile} />
  <View style={styles.reviewImageTile} />
  <View style={styles.reviewImageTile} />
  <View style={styles.reviewImageTile} />
</ScrollView>

  <View style={styles.collapsedReviewsList}>
  {collapsedReviews.map((review, index) => (
    <View
      key={review.id}
      style={[
        styles.reviewPreviewBody,
        index < collapsedReviews.length - 1 && styles.reviewPreviewBodyBorder,
      ]}
    >
      <View style={styles.reviewerAvatar} />

      <View style={styles.reviewPreviewTextArea}>
        <View style={styles.reviewerTopRow}>
          <View>
            <Text style={styles.reviewerName}>{review.name}</Text>

            <View style={styles.starRow}>
  <RatingStars rating={review.rating} size={14} gap={2} />
</View>
          </View>

          <Text style={styles.reviewDate}>{review.date}</Text>
        </View>

        <Text style={styles.reviewPreviewText}>{review.text}</Text>
      </View>
    </View>
  ))}
</View>
</Pressable>

<Pressable
  style={styles.productInfoCard}
  onPress={() => setShowProductInfo(true)}
>
  <View style={styles.productInfoHeaderRow}>
  <View style={styles.productInfoTitleRow}>
    <Text style={styles.productInfoTitle}>Product Info...</Text>
    <ProductInfoChevronRightIcon width={22} height={22} />
  </View>

  <ProductInfoLightIcon width={22} height={22} />
</View>

  <Text style={styles.productInfoPreviewText} numberOfLines={1}>
    Specification | material: cotton
  </Text>

  <Text style={styles.productInfoPreviewText} numberOfLines={1}>
    Description | {product.description || "This is a bone straight human hair product..."}
  </Text>

  <View style={styles.productInfoFooterRow}>
  <View style={styles.sizeGuideMiniBadge}>
    <ProductInfoSizeGuideIcon width={60} height={18} />
  </View>

  <View style={styles.reportRow}>
    <ProductInfoReportIcon width={17} height={17} />
    <Text style={styles.reportText}>Report</Text>
  </View>
</View>
</Pressable>

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

      <Modal
  visible={showStoreHours}
  transparent
  animationType="slide"
  onRequestClose={() => setShowStoreHours(false)}
>
  <View style={styles.storeHoursModalOverlay}>
    <Pressable
      style={styles.storeHoursBackdrop}
      onPress={() => setShowStoreHours(false)}
    />

    <View style={styles.storeHoursSheet}>
      <View style={styles.storeHoursSheetHeader}>
        <Text style={styles.storeHoursSheetTitle}>Store hours</Text>

        <Pressable
          style={styles.storeHoursCloseButton}
          onPress={() => setShowStoreHours(false)}
        >
          <ProductInfoCloseIcon width={22} height={22} />
        </Pressable>
      </View>

      <View style={styles.storeHoursSheetBody}>
        <Text style={styles.storeHoursSheetText}>Monday: 9:00 AM - 8:00 PM</Text>
        <Text style={styles.storeHoursSheetText}>Tuesday: 9:00 AM - 8:00 PM</Text>
        <Text style={styles.storeHoursSheetText}>Wednesday: 9:00 AM - 8:00 PM</Text>
        <Text style={styles.storeHoursSheetText}>Thursday: 9:00 AM - 8:00 PM</Text>
        <Text style={styles.storeHoursSheetText}>Friday: 9:00 AM - 8:00 PM</Text>
        <Text style={styles.storeHoursSheetText}>Saturday: 10:00 AM - 7:00 PM</Text>
        <Text style={styles.storeHoursSheetText}>Sunday: Closed</Text>
      </View>
    </View>
  </View>
</Modal>
      
      <Modal
  visible={showProductInfo}
  transparent
  animationType="slide"
  onRequestClose={() => setShowProductInfo(false)}
>
  <View style={styles.productInfoModalOverlay}>
    <Pressable
      style={styles.productInfoBackdrop}
      onPress={() => setShowProductInfo(false)}
    />

    <View style={styles.productInfoSheet}>
      <View style={styles.productInfoSheetHeader}>
        <Text style={styles.productInfoSheetTitle}>Product information</Text>

        <Pressable
  style={styles.productInfoCloseButton}
  onPress={() => setShowProductInfo(false)}
>
  <ProductInfoCloseIcon width={22} height={22} />
</Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.productInfoSheetContent}
      >
        <View style={styles.productInfoSection}>
          <Text style={styles.productInfoSectionTitle}>Description</Text>
          <Text style={styles.productInfoSectionText}>
            {product.description || "A short paragraph about the item."}
          </Text>
        </View>

        <View style={styles.productInfoSectionDivider} />

        <View style={styles.productInfoSection}>
          <Text style={styles.productInfoSectionTitle}>Key features</Text>
          <Text style={styles.productInfoSectionText}>Main feature 1</Text>
          <Text style={styles.productInfoSectionText}>Main feature 2</Text>
          <Text style={styles.productInfoSectionText}>Main feature 3</Text>
        </View>

        <View style={styles.productInfoSectionDivider} />

        <View style={styles.productInfoSection}>
          <Text style={styles.productInfoSectionTitle}>Specifications</Text>
          <Text style={styles.productInfoSectionText}>Brand:</Text>
          <Text style={styles.productInfoSectionText}>Material: cotton</Text>
          <Text style={styles.productInfoSectionText}>Color:</Text>
          <Text style={styles.productInfoSectionText}>Size:</Text>
          <Text style={styles.productInfoSectionText}>Condition:</Text>
        </View>

        <View style={styles.productInfoSectionDivider} />

        <View style={styles.productInfoSection}>
          <Text style={styles.productInfoSectionTitle}>What’s included</Text>
          <Text style={styles.productInfoSectionText}>- Item</Text>
          <Text style={styles.productInfoSectionText}>- Packaging</Text>
          <Text style={styles.productInfoSectionText}>- Accessories if available</Text>
        </View>

        <View style={styles.productInfoSectionDivider} />

        <View style={styles.productInfoSection}>
          <Text style={styles.productInfoSectionTitle}>
            Usage / care instructions
          </Text>
          <Text style={styles.productInfoSectionText}>
            Use, wash, store, or maintain this item according to the seller’s
            instructions.
          </Text>
        </View>

        <View style={styles.productInfoSectionDivider} />

        <View style={styles.productInfoSection}>
          <Text style={styles.productInfoSectionTitle}>
            Return / inspection note
          </Text>
          <Text style={styles.productInfoSectionText}>
            This item enters a 24-hour inspection window after delivery. Returns
            are only allowed if the item is damaged, defective, or different from
            the listing.
          </Text>
        </View>
      </ScrollView>
    </View>
  </View>
</Modal>
      {showStickyTabs && (
  <View style={styles.stickyTabsHeader}>
    <Pressable style={styles.stickyBackButton} onPress={() => navigation.goBack()}>
      <Image
        source={require("../../assets/icons/back-arrow.png")}
        style={styles.stickyHeaderIcon}
        resizeMode="contain"
      />
    </Pressable>

    <View style={styles.stickyTabsRow}>
      <Pressable
  style={
    activeStickyTab === "Overview"
      ? styles.stickyTabButtonActive
      : styles.stickyTabButton
  }
>
  <Text
    style={
      activeStickyTab === "Overview"
        ? styles.stickyTabTextActive
        : styles.stickyTabText
    }
  >
    Overview
  </Text>
</Pressable>

<Pressable
  style={
    activeStickyTab === "Reviews"
      ? styles.stickyTabButtonActive
      : styles.stickyTabButton
  }
>
  <Text
    style={
      activeStickyTab === "Reviews"
        ? styles.stickyTabTextActive
        : styles.stickyTabText
    }
  >
    Reviews
  </Text>
</Pressable>

<Pressable
  style={
    activeStickyTab === "Description"
      ? styles.stickyTabButtonActive
      : styles.stickyTabButton
  }
>
  <Text
    style={
      activeStickyTab === "Description"
        ? styles.stickyTabTextActive
        : styles.stickyTabText
    }
  >
    Description
  </Text>
</Pressable>
    </View>

    <Pressable style={styles.stickyIconButton}>
      <Image
        source={require("../../assets/icons/search.png")}
        style={styles.stickyHeaderIcon}
        resizeMode="contain"
      />
    </Pressable>

    <Pressable style={styles.stickyIconButton}>
      <Image
        source={require("../../assets/icons/share.png")}
        style={styles.stickyHeaderIcon}
        resizeMode="contain"
      />
    </Pressable>
  </View>
)}

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

deliverySection: {
  backgroundColor: "#FFFFFF",
  paddingTop: 8,
  paddingBottom: 12,
  borderBottomWidth: 1,
  borderBottomColor: "#E5E5E5",
  marginHorizontal: -12,
  paddingHorizontal: 12,
},

deliveryTitle: {
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
  marginBottom: 8,
},

dropoffInputBox: {
  height: 35,
  backgroundColor: "#E4F4FC",
  borderRadius: 3,
  borderWidth: 1,
  borderColor: "#C8DDE8",
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 12,
},

dropoffInputText: {
  flex: 1,
  fontSize: 18,
  color: "#666666",
  marginLeft: 10,
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

reviewsPreviewCard: {
  backgroundColor: "#FFFFFF",
  borderBottomWidth: 10,
  borderBottomColor: "#ECECEC",
  marginHorizontal: -12,
},
reviewHeaderRow: {
  height: 45,
  paddingHorizontal: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},

reviewHeaderLeft: {
  flexDirection: "row",
  alignItems: "center",
},

reviewTitle: {
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
  marginRight: 6,
},

verifiedBadge: {
  backgroundColor: "#083245",
  paddingHorizontal: 4,
  paddingVertical: 2,
},

verifiedBadgeText: {
  fontSize: 10,
  color: "#FFFFFF",
  fontWeight: "700",
},

reviewImageStrip: {
  height: 64,
  backgroundColor: "#DFF2FB",
  flexDirection: "row",
},

reviewImageTile: {
  width: 88,
  height: 64,
  backgroundColor: "#DFF2FB",
  borderRightWidth: 1,
  borderRightColor: "#D0E4EE",
},

collapsedReviewsList: {
  backgroundColor: "#FFFFFF",
},

reviewPreviewBody: {
  flexDirection: "row",
  paddingHorizontal: 12,
  paddingTop: 12,
  paddingBottom: 12,
  backgroundColor: "#FFFFFF",
},

reviewPreviewBodyBorder: {
  borderBottomWidth: 1,
  borderBottomColor: "#E2E2E2",
},

reviewerAvatar: {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: "#D9D9D9",
  marginRight: 8,
},

reviewPreviewTextArea: {
  flex: 1,
},

reviewerTopRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 6,
},

reviewerName: {
  fontSize: 12,
  color: "#444444",
  fontWeight: "700",
},

starRow: {
  flexDirection: "row",
  marginTop: 2,
},

reviewDate: {
  fontSize: 13,
  color: "#111111",
},

reviewPreviewText: {
  fontSize: 18,
  lineHeight: 23,
  color: "#666666",
  paddingRight: 6,
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

storeCard: {
  backgroundColor: "#FFFFFF",
  paddingVertical: 8,
  paddingHorizontal: 12,
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderTopColor: "#E5E5E5",
  borderBottomColor: "#E5E5E5",
  marginTop: 0,
  marginBottom: 0,
  marginHorizontal: -12,
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
  afterOtherShoppingDivider: {
  height: 10,
  backgroundColor: "#ECECEC",
  marginTop: 8,
  marginBottom: 0,
  marginHorizontal: -12,
},

fullWidthSectionDivider: {
  height: 10,
  backgroundColor: "#ECECEC",
  marginHorizontal: -12,
},
storeTimingSection: {
  backgroundColor: "#FFFFFF",
  marginHorizontal: -12,
  paddingHorizontal: 12,
  paddingTop: 12,
  paddingBottom: 12,
},

storeHoursRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
},

storeHoursTitleRow: {
  flexDirection: "row",
  alignItems: "center",
},

storeHoursTitle: {
  fontSize: 19,
  fontWeight: "800",
  color: "#111111",
  marginRight: 4,
},

storeHoursText: {
  fontSize: 18,
  lineHeight: 25,
  color: "#555555",
},

pickupEstimateSection: {
  height: 35,
  backgroundColor: "#FFFFFF",
  marginHorizontal: -12,
  overflow: "hidden",
  justifyContent: "center",
},

pickupEstimateText: {
  fontSize: 18,
  fontWeight: "800",
  color: "#B73232",
  width: 520,
},

storeHoursModalOverlay: {
  flex: 1,
  justifyContent: "flex-end",
},

storeHoursBackdrop: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0)",
},

storeHoursSheet: {
  height: 340,
  backgroundColor: "#FFFFFF",
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: "#D0D0D0",
},

storeHoursSheetHeader: {
  height: 58,
  backgroundColor: "#ECECEC",
  alignItems: "center",
  justifyContent: "center",
  borderBottomWidth: 1,
  borderBottomColor: "#CFCFCF",
},

storeHoursSheetTitle: {
  fontSize: 22,
  fontWeight: "800",
  color: "#111111",
},

storeHoursCloseButton: {
  position: "absolute",
  right: 18,
  top: 18,
  width: 22,
  height: 22,
  alignItems: "center",
  justifyContent: "center",
},

storeHoursSheetBody: {
  paddingHorizontal: 16,
  paddingTop: 20,
},

storeHoursSheetText: {
  fontSize: 18,
  lineHeight: 24,
  color: "#666666",
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
  stickyTabsHeader: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: TOP_SAFE_SPACE + 44,
  paddingTop: TOP_SAFE_SPACE,
  backgroundColor: "#FFFFFF",
  flexDirection: "row",
  alignItems: "center",
  borderBottomWidth: 1,
  borderBottomColor: "#E5E5E5",
  zIndex: 2000,
  elevation: 20,
},

stickyBackButton: {
  width: 42,
  height: 44,
  alignItems: "center",
  justifyContent: "center",
},

stickyHeaderIcon: {
  width: 20,
  height: 20,
},

stickyTabsRow: {
  flex: 1,
  height: 44,
  flexDirection: "row",
  alignItems: "center",
},

stickyTabButton: {
  height: 44,
  justifyContent: "center",
  alignItems: "center",
  marginRight: 14,
},

stickyTabButtonActive: {
  height: 44,
  justifyContent: "center",
  alignItems: "center",
  marginRight: 14,
  borderBottomWidth: 4,
  borderBottomColor: "#000000",
},

stickyTabText: {
  fontSize: 17,
  fontWeight: "800",
  color: "#777777",
},

stickyTabTextActive: {
  fontSize: 17,
  fontWeight: "800",
  color: "#111111",
},

stickyIconButton: {
  width: 34,
  height: 44,
  alignItems: "center",
  justifyContent: "center",
},
productInfoCard: {
  backgroundColor: "#FFFFFF",
  paddingTop: 10,
  paddingBottom: 10,
  borderBottomWidth: 10,
  borderBottomColor: "#ECECEC",
  marginHorizontal: -12,
  paddingHorizontal: 12,
},

productInfoHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
},

productInfoTitleRow: {
  flexDirection: "row",
  alignItems: "center",
},

productInfoTitle: {
  fontSize: 20,
  fontWeight: "800",
  color: "#111111",
  marginRight: 4,
},

productInfoPreviewText: {
  fontSize: 16,
  lineHeight: 25,
  color: "#111111",
},

productInfoFooterRow: {
  marginTop: 12,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},

sizeGuideMiniBadge: {
  height: 18,
  justifyContent: "center",
  alignItems: "center",
},

sizeGuideMiniBadgeText: {
  color: "#FFFFFF",
  fontSize: 9,
  fontWeight: "700",
},

reportRow: {
  flexDirection: "row",
  alignItems: "center",
},

reportText: {
  fontSize: 13,
  color: "#111111",
  fontWeight: "700",
  marginLeft: 2,
},

productInfoModalOverlay: {
  flex: 1,
  justifyContent: "flex-end",
},

productInfoBackdrop: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0)",
},

productInfoSheet: {
  height: 615,
  backgroundColor: "#FFFFFF",
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: "#D0D0D0",
},

productInfoSheetHeader: {
  height: 64,
  backgroundColor: "#ECECEC",
  alignItems: "center",
  justifyContent: "center",
  borderBottomWidth: 1,
  borderBottomColor: "#CFCFCF",
},

productInfoSheetTitle: {
  fontSize: 22,
  fontWeight: "800",
  color: "#111111",
},

productInfoCloseButton: {
  position: "absolute",
  right: 18,
  top: 20,
  width: 22,
  height: 22,
  alignItems: "center",
  justifyContent: "center",
},

productInfoSheetContent: {
  paddingBottom: 12,
},

productInfoSection: {
  backgroundColor: "#FFFFFF",
  paddingHorizontal: 12,
  paddingTop: 14,
  paddingBottom: 24,
},

productInfoSectionTitle: {
  fontSize: 20,
  fontWeight: "800",
  color: "#222222",
  marginBottom: 4,
},

productInfoSectionText: {
  fontSize: 18,
  lineHeight: 24,
  color: "#444444",
},

productInfoSectionDivider: {
  height: 10,
  backgroundColor: "#ECECEC",
},
});