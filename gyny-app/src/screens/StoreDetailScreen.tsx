import React, { useState } from "react";
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
import CustomerCareIcon from "../../assets/icons/customer-care.svg";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

type StoreTab = "Items" | "Categories" | "New arrivals" | "Reviews";

export default function StoreDetailScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<StoreTab>("Categories");
  const [showStoreInfo, setShowStoreInfo] = useState(false);

  const tabs: StoreTab[] = ["Items", "Categories", "New arrivals", "Reviews"];

  return (
    <View style={styles.screen}>
      <View style={styles.topArea}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={29} color="#111111" />
          </Pressable>

          <Pressable style={styles.searchBar}>
            <Text style={styles.searchPlaceholder}>Search in this store</Text>
          </Pressable>

          <Pressable style={styles.headerIconButton}>
            <Ionicons name="share-social-outline" size={23} color="#111111" />
          </Pressable>

          <Pressable style={styles.headerIconButton}>
            <Ionicons name="ellipsis-vertical" size={23} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.storeInfoRow}>
          <View style={styles.storeAvatar} />

          <Pressable
  style={styles.storeNameWrap}
  onPress={() => setShowStoreInfo(true)}
>
  <Text style={styles.storeName}>Shoprite</Text>
  <View style={styles.storeArrowWrap}>
    <Ionicons name="chevron-forward" size={22} color="#111111" />
  </View>
</Pressable>

          <Pressable style={styles.chatButton}>
            <CustomerCareIcon width={24} height={24} />
          </Pressable>
        </View>

        <View style={styles.tabsRow}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab;

            return (
              <Pressable
                key={tab}
                style={styles.tabButton}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {tab}
                </Text>

                {isActive && <View style={styles.activeUnderline} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.emptySpace} />
      </ScrollView>

      <View style={styles.floatingControls}>
        <Pressable style={styles.glassButton}>
          <Ionicons name="swap-vertical-outline" size={16} color="#555555" />
          <Text style={styles.glassButtonText}>Sort by</Text>
        </Pressable>

        <Pressable style={styles.glassButton}>
          <Ionicons name="options-outline" size={16} color="#555555" />
          <Text style={styles.glassButtonText}>Filter</Text>
        </Pressable>
      </View>
      {showStoreInfo && (
  <View style={styles.storeInfoOverlay}>
    <Pressable
      style={styles.storeInfoBackdrop}
      onPress={() => setShowStoreInfo(false)}
    />

    <View style={styles.storeInfoSheet}>
      <View style={styles.storeInfoHeader}>
        <Text style={styles.storeInfoTitle}>Shoprite</Text>

        <Pressable
          style={styles.storeInfoCloseButton}
          onPress={() => setShowStoreInfo(false)}
        >
          <Ionicons name="close" size={18} color="#111111" />
        </Pressable>
      </View>

      <View style={styles.storeInfoDivider} />

      <Text style={styles.storeInfoItem}>Store icon</Text>
      <Text style={styles.storeInfoItem}>Store rating</Text>
      <Text style={styles.storeInfoItem}>Store location</Text>
      <Text style={styles.storeInfoItem}>Communication</Text>
    </View>
  </View>
)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  topArea: {
    paddingTop: TOP_SAFE_SPACE + 12,
    backgroundColor: "#FFFFFF",
  },

  headerRow: {
    height: 42,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
  },

  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },

  searchBar: {
    flex: 1,
    height: 37,
    borderRadius: 12,
    backgroundColor: "#EDEBEB",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginRight: 10,
  },

  searchPlaceholder: {
    fontSize: 16,
    color: "#9A9A9A",
  },

  headerIconButton: {
    width: 31,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },

  storeInfoRow: {
    height: 82,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  storeAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#9B9B9B",
    backgroundColor: "#FFFFFF",
    marginRight: 10,
  },

  storeNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  storeName: {
    fontSize: 25,
    fontWeight: "800",
    color: "#000000",
    marginRight: 8,
  },
  storeArrowWrap: {
  marginTop: 3,
},

  chatButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },

  tabsRow: {
  height: 42,
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderColor: "#BDBDBD",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-around",
},

  tabButton: {
  height: "100%",
  minWidth: 78,
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
},

  tabText: {
    fontSize: 16,
    color: "#111111",
    fontWeight: "400",
  },

  tabTextActive: {
    fontWeight: "800",
  },

  activeUnderline: {
    position: "absolute",
    bottom: 0,
    width: 36,
    height: 5,
    backgroundColor: "#000000",
  },

  content: {
    minHeight: 680,
    paddingBottom: 120,
  },

  emptySpace: {
    height: 520,
  },

  floatingControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 62,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },

  glassButton: {
    height: 30,
    paddingHorizontal: 12,
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: "rgba(4,4,4,0.35)",
    backgroundColor: "rgba(255,255,255,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },

  glassButtonText: {
    marginLeft: 5,
    fontSize: 13,
    letterSpacing: 2,
    color: "#555555",
    fontWeight: "500",
  },
  storeInfoOverlay: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 999,
},

storeInfoBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.05)",
},

storeInfoSheet: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  minHeight: 280,
  backgroundColor: "#D9D9D9",
  borderTopLeftRadius: 8,
  borderTopRightRadius: 8,
  paddingTop: 12,
  paddingHorizontal: 12,
  paddingBottom: 28,
},

storeInfoHeader: {
  height: 44,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},

storeInfoTitle: {
  fontSize: 24,
  fontWeight: "800",
  color: "#000000",
},

storeInfoCloseButton: {
  width: 24,
  height: 24,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#111111",
  alignItems: "center",
  justifyContent: "center",
},

storeInfoDivider: {
  height: 1,
  backgroundColor: "#8E8E8E",
  marginHorizontal: -12,
  marginBottom: 12,
},

storeInfoItem: {
  fontSize: 18,
  color: "#111111",
  marginBottom: 22,
},
});