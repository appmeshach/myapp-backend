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
import RatingStars from "../components/RatingStars";
import ImageFilterIcon from "../../assets/icons/reviews/image-filter.svg";
import CommentFilterIcon from "../../assets/icons/reviews/comment-filter.svg";
import HelpfulIcon from "../../assets/icons/reviews/helpful.svg";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const reviews = [
  { id: "1", hasPhotos: true },
  { id: "2", hasPhotos: false },
  { id: "3", hasPhotos: true },
  { id: "4", hasPhotos: false },
];

export default function ProductReviewsScreen({ navigation }: any) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={32} color="#111111" />
        </Pressable>

        <Text style={styles.headerTitle}>Reviews</Text>
      </View>

      <View style={styles.fixedTopContent}>
        <View style={styles.ratingSummary}>
          <Text style={styles.bigRating}>4.6</Text>

          <View style={styles.bigStarRow}>
  <RatingStars rating={4.6} size={22} gap={2} />
</View>

          <View style={styles.ratingBreakdown}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>True to product</Text>
              <Text style={styles.breakdownValue}>3.7</Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Communication</Text>
              <Text style={styles.breakdownValue}>4.3</Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Buyer experience</Text>
              <Text style={styles.breakdownValue}>3.2</Text>
            </View>
          </View>
        </View>

        <View style={styles.filterRow}>
          <Pressable style={styles.filterButton}>
            <Text style={styles.filterText}>Sort by default</Text>
            <Ionicons name="chevron-down" size={15} color="#111111" />
          </Pressable>

          <Pressable style={styles.filterButton}>
            <Text style={styles.filterText}>All ratings</Text>
            <Ionicons name="chevron-down" size={15} color="#111111" />
          </Pressable>

          <Pressable style={styles.filterButtonSmall}>
            <ImageFilterIcon width={18} height={18} />
            <Text style={styles.filterText}>(1764)</Text>
          </Pressable>

          <Pressable style={styles.filterButtonSmall}>
            <CommentFilterIcon width={18} height={18} />
            <Text style={styles.filterText}>(341)</Text>
          </Pressable>
        </View>

        </View>

<ScrollView contentContainerStyle={styles.reviewListContent}>
        {reviews.map((item) => (
          <View key={item.id} style={styles.reviewCard}>
            <View style={styles.reviewTopRow}>
              <View style={styles.reviewAvatar} />

              <View style={styles.reviewUserInfo}>
                <Text style={styles.reviewUser}>Terhide: Lagos</Text>
                <Text style={styles.reviewPurchase}>Purchased:Green/M</Text>
              </View>

              <Text style={styles.reviewDate}>Apr 15, 2026</Text>
            </View>

            {item.hasPhotos ? (
  <View style={styles.reviewPhotoGrid}>
    <View style={styles.largeReviewPhoto} />

    <View style={styles.smallPhotoColumn}>
      <View style={styles.smallReviewPhoto} />
      <View style={styles.smallReviewPhoto} />
    </View>
  </View>
) : null}

            <Text style={styles.reviewText}>
              Ordered 3 xxx but too short, ordered another one & it was 3 xxxl
              but was perfect fit. Long length, second photo is the one that is
              perfect fit, everything else on order was perfectly thank you, fast
              delivery
            </Text>

            <View style={styles.itemRatedRow}>
              <Text style={styles.itemRatedText}>Item rated:</Text>

              <View style={styles.smallStarRow}>
  <RatingStars rating={3.7} size={14} gap={2} />
</View>

              <View style={styles.helpfulArea}>
                <HelpfulIcon width={19} height={19} />
                <Text style={styles.helpfulText}>Helpful (37)</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={styles.bottomIconButton}>
          <Ionicons name="home-outline" size={30} color="#111111" />
        </Pressable>

        <Pressable style={styles.bottomIconButton}>
          <Ionicons name="chatbox-outline" size={28} color="#111111" />
        </Pressable>

        <Pressable style={styles.bottomIconButton}>
          <View>
            <Ionicons name="bag-outline" size={29} color="#111111" />
            <Text style={styles.bagCount}>1</Text>
          </View>
        </Pressable>

        <Pressable style={styles.addToBagButton}>
          <Text style={styles.addToBagText}>Add to bag</Text>
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
    backgroundColor: "#FFFFFF",
  },

  header: {
    height: TOP_SAFE_SPACE + 72,
    paddingTop: TOP_SAFE_SPACE + 18,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  backButton: {
  width: 38,
  height: 36,
  alignItems: "center",
  justifyContent: "center",
  marginRight: 8,
},

  headerTitle: {
    fontSize: 23,
    fontWeight: "800",
    color: "#111111",
  },

  ratingSummary: {
    height: 76,
    backgroundColor: "#F7F3F4",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },

  bigRating: {
    fontSize: 34,
    fontWeight: "800",
    color: "#111111",
    marginRight: 10,
  },

  bigStarRow: {
    flexDirection: "row",
    marginRight: 12,
  },

  ratingBreakdown: {
    flex: 1,
  },

  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  breakdownLabel: {
    fontSize: 13,
    color: "#777777",
  },

  breakdownValue: {
    fontSize: 13,
    color: "#777777",
  },

  filterRow: {
  height: 40,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: 6,
  borderBottomWidth: 1,
  borderBottomColor: "#CFCFCF",
},

  filterButton: {
  height: 27,
  borderWidth: 1,
  borderColor: "#888888",
  paddingHorizontal: 5,
  flexDirection: "row",
  alignItems: "center",
},

  filterButtonSmall: {
  height: 27,
  borderWidth: 1,
  borderColor: "#888888",
  paddingHorizontal: 5,
  flexDirection: "row",
  alignItems: "center",
},

  filterText: {
    fontSize: 13,
    color: "#111111",
  },

  reviewCard: {
    paddingHorizontal: 7,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#CFCFCF",
  },

  reviewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  reviewAvatar: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: "#D9D9D9",
    marginRight: 8,
  },

  reviewUserInfo: {
    flex: 1,
  },

  reviewUser: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111111",
  },

  reviewPurchase: {
    fontSize: 13,
    color: "#111111",
  },

  reviewDate: {
    fontSize: 13,
    color: "#111111",
  },

  reviewPhotoGrid: {
    height: 164,
    flexDirection: "row",
    marginBottom: 8,
  },
fixedTopContent: {
  backgroundColor: "#FFFFFF",
},

reviewListContent: {
  paddingBottom: 90,
},
  largeReviewPhoto: {
    flex: 1,
    backgroundColor: "#D9D9D9",
    marginRight: 2,
  },

  smallPhotoColumn: {
    width: 143,
  },

  smallReviewPhoto: {
    flex: 1,
    backgroundColor: "#D9D9D9",
    marginBottom: 2,
  },

  reviewText: {
    fontSize: 14,
    lineHeight: 18,
    color: "#000000",
    marginBottom: 12,
  },

  itemRatedRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  itemRatedText: {
    fontSize: 13,
    color: "#111111",
    marginRight: 4,
  },

  smallStarRow: {
    flexDirection: "row",
  },

  helpfulArea: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
  },

  helpfulText: {
    fontSize: 13,
    color: "#111111",
    marginLeft: 4,
  },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 71,
    backgroundColor: "#FFFFFF",
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

  bagCount: {
    position: "absolute",
    right: -4,
    bottom: -2,
    fontSize: 12,
    fontWeight: "800",
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