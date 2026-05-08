import React, { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  StyleSheet,
  Pressable,
  View,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Image,
  Platform,
  StatusBar,
} from "react-native";
import { api, IS_SIGNED_IN } from "../api/client";
import ProductCard from "../components/ProductCard";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

type Product = {
  id: string;
  store_id: string;
  title: string;
  price_kobo: number;
  brief_detail?: string | null;
  store_name?: string | null;
};

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const TOP_SAFE_SPACE = Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const heroSlides = [
  { id: "1", color: "#B78D59" },
  { id: "2", color: "#AFC2CE" },
  { id: "3", color: "#D3A88F" },
  { id: "4", color: "#95AF9F" },
  { id: "5", color: "#BDAFDD" },
  { id: "6", color: "#C996AD" },
];

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const heroScrollRef = useRef<ScrollView>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [featured, setFeatured] = useState<Product[]>([]);
  const [latest, setLatest] = useState<Product[]>([]);
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [isHorizontalDragging, setIsHorizontalDragging] = useState(false);

  async function loadHome() {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/home");
      setFeatured(res.data.featured_products || []);
      setLatest(res.data.latest_products || []);
    } catch (e) {
      console.error("HOME LOAD ERROR:", e);
      setError("Could not load home feed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHome();
  }, []);

  function handleHeroScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
  const offsetX = event.nativeEvent.contentOffset.x;
  const index = Math.round(offsetX / SCREEN_WIDTH);
  setActiveHeroIndex(index);
}

function getDotSizeStyle(index: number) {
  if (index === activeHeroIndex) {
    return styles.dotSmall;
  }

  if (index === activeHeroIndex + 1) {
    return styles.dotMedium;
  }

  return styles.dotLarge;
}

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingLogo}>GYNY</Text>
        <Text style={styles.helperText}>Loading home...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingLogo}>GYNY</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={loadHome}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const combinedProducts = [...featured, ...latest];

const uniqueProducts = combinedProducts.filter(
  (product, index, self) =>
    index === self.findIndex((p) => p.id === product.id)
);

const repeatedProducts = Array.from({ length: 24 }, (_, index) => {
  return uniqueProducts[index % uniqueProducts.length];
}).filter(Boolean);

const repeatedLatest = Array.from({ length: 16 }, (_, index) => {
  return latest[index % latest.length];
}).filter(Boolean);

const firstGrid = repeatedProducts.slice(0, 12);
const secondGrid = repeatedProducts;
const newArrivalsProducts = repeatedLatest;

  return (
    <ScrollView
  style={styles.container}
  contentContainerStyle={styles.content}
  nestedScrollEnabled={true}
>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <Text style={styles.brand}>GYNY</Text>

          <View style={styles.heroIcons}>
  <Image
    source={require("../../assets/icons/bell.png")}
    style={styles.bellImage}
    resizeMode="contain"
  />
  <Text style={styles.badgeCount}>2</Text>
</View>
        </View>

        <Pressable style={styles.searchBar}>
          <Text style={styles.searchPlaceholder} numberOfLines={1}>
            Search for stores and products
          </Text>
          <View style={styles.cameraIconWrap}>
  <Ionicons name="camera-outline" size={20} color="#555555" />
</View>
        </Pressable>

        <ScrollView
  ref={heroScrollRef}
  horizontal
  pagingEnabled
  scrollEnabled={true}
  nestedScrollEnabled={true}
  directionalLockEnabled={true}
  showsHorizontalScrollIndicator={false}
  onScroll={handleHeroScroll}
  scrollEventThrottle={16}
  style={styles.heroCarousel}
>
          {heroSlides.map((slide) => (
            <View
              key={slide.id}
              style={[styles.heroImage, { backgroundColor: slide.color }]}
            />
          ))}
        </ScrollView>

        <View style={styles.dotsRow}>
  {heroSlides.map((_, index) => (
    <View
      key={index}
      style={[
        styles.dot,
        getDotSizeStyle(index),
      ]}
    />
  ))}
</View>
      </View>

      {/* First grid */}
      <View style={styles.gridSection}>
        <View style={styles.grid}>
          {firstGrid.map((item, index) => (
  <View key={`first-grid-${item.id}-${index}`} style={styles.gridItem}>
              <ProductCard
  product={item}
  onPress={() =>
    navigation.navigate("ProductDetail", { productId: item.id })
  }
/>
            </View>
          ))}
        </View>
      </View>

      {!IS_SIGNED_IN && (
        <View style={styles.signInStrip}>
          <Text style={styles.signInText}>Sign in for the best experience</Text>
          <Pressable style={styles.signUpButton}>
            <Text style={styles.signUpButtonText}>Sign up</Text>
          </Pressable>
        </View>
      )}

      {/* Lower section */}
      <View style={styles.lowerSectionHeader}>
  <Text style={styles.lowerSectionTitle}>All your faves are here</Text>

  <Pressable
  style={styles.seeAllButton}
  onPress={() => navigation.navigate("NewArrivals")}
>
    <Text style={styles.seeAll}>See all</Text>
  </Pressable>
</View>

<ScrollView
  horizontal
  nestedScrollEnabled={true}
  directionalLockEnabled={true}
  pagingEnabled={false}
  scrollEnabled={true}
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={styles.horizontalSectionContent}
>
  {secondGrid.map((item, index) => (
    <View key={`lower-${item.id}-${index}`} style={styles.horizontalCardWrap}>
      <ProductCard
        product={item}
        onPress={() =>
          navigation.navigate("ProductDetail", { productId: item.id })
        }
      />
    </View>
  ))}
</ScrollView>

{/* Vertical break section */}
<View style={styles.verticalBreakHeader}>
  <Text style={styles.verticalBreakTitle}>Recommended for you</Text>
</View>

<View style={styles.gridSection}>
  <View style={styles.grid}>
    {secondGrid.slice(0, 12).map((item, index) => (
  <View key={`recommended-${item.id}-${index}`} style={styles.gridItem}>
        <ProductCard
          product={item}
          onPress={() =>
            navigation.navigate("ProductDetail", { productId: item.id })
          }
        />
      </View>
    ))}
  </View>
</View>

{/* New arrivals horizontal */}
<View style={styles.newArrivalsHeader}>
  <Text style={styles.newArrivalsTitle}>New arrivals</Text>

  <Pressable
  style={styles.seeAllButton}
  onPress={() => navigation.navigate("NewArrivals")}
>
    <Text style={styles.seeAll}>See all</Text>
  </Pressable>
</View>

<ScrollView
  horizontal
  nestedScrollEnabled={true}
  directionalLockEnabled={true}
  pagingEnabled={false}
  scrollEnabled={true}
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={styles.horizontalSectionContent}
  onScrollBeginDrag={() => setIsHorizontalDragging(true)}
  onScrollEndDrag={() => setIsHorizontalDragging(false)}
  onMomentumScrollEnd={() => setIsHorizontalDragging(false)}
>
  {newArrivalsProducts.map((item, index) => (
  <View key={`latest-${item.id}-${index}`} style={styles.horizontalCardWrap}>
      <ProductCard
        product={item}
        onPress={() => {
  if (isHorizontalDragging) return;

  navigation.navigate("ProductDetail", { productId: item.id });
}}
      />
    </View>
  ))}
</ScrollView>

{!IS_SIGNED_IN && (
  <View style={styles.signInStripBottom}>
    <Text style={styles.signInText}>Sign in for the best experience</Text>
    <Pressable style={styles.signUpButton}>
      <Text style={styles.signUpButtonText}>Sign up</Text>
    </Pressable>
  </View>
)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  horizontalSectionContent: {
  paddingLeft: 6,
  paddingRight: 6,
  paddingBottom: 8,
},
verticalBreakHeader: {
  marginTop: 16,
  paddingHorizontal: 12,
  marginBottom: 16,
},
cameraIconWrap: {
  height: 32,
  justifyContent: "center",
  alignItems: "center",
  marginTop: 1,
},
bellImage: {
  width: 23,
  height: 24.44,
},

verticalBreakTitle: {
  fontSize: 17,
  fontWeight: "700",
  color: "#3A3A3A",
},

horizontalCardWrap: {
  width: 170,
  marginRight: 7,
  marginBottom: 16,
},
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    backgroundColor: "#F3F3F3",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingLogo: {
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 12,
  },
  helperText: {
    fontSize: 16,
    color: "#555",
  },
  errorText: {
    fontSize: 16,
    color: "#B91C1C",
    marginBottom: 16,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#111111",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  hero: {
    width: "100%",
    paddingTop: 0,
    marginBottom: 13,
  },
  heroTopRow: {
  position: "absolute",
  top: TOP_SAFE_SPACE + 10,
  left: 16,
  right: 16,
  zIndex: 3,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
},
  brand: {
  fontSize: 28,
  lineHeight: 32,
  fontWeight: "900",
  color: "#111111",
},
  heroIcons: {
  position: "relative",
  width: 23,
  height: 24.44,
  justifyContent: "center",
  alignItems: "center",
  marginTop: 8,
  marginLeft: -2,
},
  badgeCount: {
    position: "absolute",
    top: -6,
    right: -2,
    fontSize: 11,
    fontWeight: "700",
    color: "#111111",
  },
  searchBar: {
  position: "absolute",
  top: TOP_SAFE_SPACE + 51,
  left: 20,
  right: 20,
  height: 38,
  backgroundColor: "rgba(255,255,255,0.84)",
  borderRadius: 19,
  zIndex: 3,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: 14,
  paddingVertical: 0,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 6,
  elevation: 2,
},
  searchPlaceholder: {
  flex: 1,
  fontSize: 13,
  color: "#8A8A8A",
  paddingRight: 8,
  },
  heroCarousel: {
    width: SCREEN_WIDTH,
  },
  heroImage: {
  width: SCREEN_WIDTH,
  height: 344 + TOP_SAFE_SPACE,
},
  dotsRow: {
  position: "absolute",
  bottom: 11,
  width: "100%",
  flexDirection: "row",
  justifyContent: "center",
  alignItems: "center",
},
  dot: {
  borderRadius: 999,
  marginHorizontal: 3,
  backgroundColor: "#FFFFFF",
  opacity: 0.95,
},
dotSmall: {
  width: 5,
  height: 5,
},
dotMedium: {
  width: 7,
  height: 7,
},
dotLarge: {
  width: 9,
  height: 9,
},

  gridSection: {
    paddingHorizontal: 6,
    marginTop: 0,
    backgroundColor: "#F5F5F5",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  gridItem: {
    width: "50%",
    paddingHorizontal: 4,
    marginBottom: 12,
  },

  signInStrip: {
    marginTop: 4,
    backgroundColor: "#545454",
    height: 40,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  signInStripBottom: {
    marginTop: 0,
    backgroundColor: "#5A5454",
    height: 40,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  signInText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
  },
  signUpButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signUpButtonText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "700",
  },

  lowerSectionHeader: {
    marginTop: 12,
    paddingHorizontal: 6,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
  },
  lowerSectionTitle: {
  fontSize: 18,
  fontWeight: "700",
  color: "#2E2E2E",
},
  newArrivalsHeader: {
    marginTop: 12,
    paddingHorizontal: 6,
    paddingBottom: 0,
    marginBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#E6E6E6",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
  },
  newArrivalsTitle: {
  fontSize: 18,
  fontWeight: "700",
  color: "#2E2E2E",
},
  seeAll: {
  fontSize: 13,
  color: "#7D1427",
  fontWeight: "600",
},
seeAllButton: {
  paddingVertical: 8,
  paddingLeft: 12,
},
});