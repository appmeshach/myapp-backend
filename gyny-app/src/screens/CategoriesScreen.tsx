import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Platform,
  StatusBar,
} from "react-native";
import { IS_SIGNED_IN } from "../api/client";
import { Ionicons } from "@expo/vector-icons";
import { categoryTree } from "../data/categoryTree";
import type { CategoryNode } from "../data/categoryTree";

import CategoryGridIcon from "../../assets/icons/categories/category-grid.svg";
import FilterBrandIcon from "../../assets/icons/categories/filter-brand.svg";
import FilterColorIcon from "../../assets/icons/categories/filter-color.svg";
import FilterSortIcon from "../../assets/icons/categories/filter-sort.svg";
import FilterFilterIcon from "../../assets/icons/categories/filter-filter.svg";
import FilterChevronDownIcon from "../../assets/icons/categories/filter-chevron-down.svg";


const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const mainCategories = Object.keys(categoryTree);
function getFilterIcon(label: string) {
  if (label === "Brand") return FilterBrandIcon;
  if (label === "Color") return FilterColorIcon;
  if (label === "Sort by") return FilterSortIcon;
  return FilterFilterIcon;
}

function isLeafNode(node: CategoryNode | string[]): node is string[] {
  return Array.isArray(node);
}

export default function CategoriesScreen() {
  const [selectedMainCategory, setSelectedMainCategory] = useState(
  "Fashion & Wearables"
);
const [categoryPaths, setCategoryPaths] = useState<Record<string, string[]>>({});
const [activeLeafFilter, setActiveLeafFilter] = useState<string | null>(null);
const currentPath = categoryPaths[selectedMainCategory] || [];

  const currentNode = useMemo(() => {
    let node: CategoryNode | string[] =
      categoryTree[selectedMainCategory as keyof typeof categoryTree] || {};

    for (const segment of currentPath) {
      if (!Array.isArray(node) && node[segment]) {
        node = node[segment] as CategoryNode | string[];
      }
    }

    return node;
  }, [selectedMainCategory, currentPath]);

  const isLastLevel = isLeafNode(currentNode);
  const showLeafScreen = isLastLevel && currentPath.length > 0;

  return (
    <View style={styles.screen}>
      <View style={styles.phoneFrame}>
        {!showLeafScreen ? (
          <>
            <View style={styles.topBar}>
              <Text style={styles.title}>CATEGORIES</Text>

              <View style={styles.topIcons}>
                <Image
                  source={require("../../assets/icons/search.png")}
                  style={styles.topIconImage}
                  resizeMode="contain"
                />

                <View style={styles.bellWrap}>
                  <Image
                    source={require("../../assets/icons/bell.png")}
                    style={styles.topIconImage}
                    resizeMode="contain"
                  />
                  <Text style={styles.badgeCount}>2</Text>
                </View>
              </View>
            </View>

            <View style={styles.content}>
              <View style={styles.leftMenu}>
  {mainCategories.map((category) => {
    const isActive = category === selectedMainCategory;

    return (
      <Pressable
        key={category}
        style={[
          styles.leftMenuItem,
          isActive && styles.leftMenuItemActive,
        ]}
        onPress={() => {
          setSelectedMainCategory(category);
          setActiveLeafFilter(null);
        }}
      >
        <Text
          style={[
            styles.leftMenuText,
            isActive && styles.leftMenuTextActive,
          ]}
        >
          {category}
        </Text>
      </Pressable>
    );
  })}
</View>

              <View style={styles.categoryGap} />

              <ScrollView
                style={styles.rightPane}
                contentContainerStyle={styles.rightPaneContent}
                showsVerticalScrollIndicator={false}
              >
                {currentPath.length > 0 && (
                  <Pressable
  style={styles.backRow}
  onPress={() => {
    setActiveLeafFilter(null);
    setCategoryPaths((prev) => ({
  ...prev,
  [selectedMainCategory]: currentPath.slice(0, -1),
}));
  }}
>
                    <Text style={styles.backText}>← Back</Text>
                  </Pressable>
                )}

                {!isLastLevel && (
                  <View style={styles.subcategoryGrid}>
                  {Object.keys(currentNode).map((item, index) => (
  <Pressable
    key={item}
    style={[
      styles.subcategoryItem,
      (index + 1) % 3 !== 0 && styles.subcategoryItemSpacing,
    ]}
    onPress={() =>
      setCategoryPaths((prev) => ({
        ...prev,
        [selectedMainCategory]: [...currentPath, item],
      }))
    }
  >
    <View style={styles.gridCirclePlaceholder} />
    <Text style={styles.subcategoryText}>{item}</Text>
  </Pressable>
))}
                  </View>
                )}

                {!isLastLevel &&
                  Object.keys(currentNode).length === 0 && (
                    <View style={styles.emptyStateWrap}>
                      <Text style={styles.emptyStateText}>
                        More category levels for this section will be added next.
                      </Text>
                    </View>
                  )}
              </ScrollView>
            </View>

            {!IS_SIGNED_IN && (
              <View style={styles.signInStrip}>
                <Text style={styles.signInText}>
                  Sign in for the best experience
                </Text>
                <Pressable style={styles.signUpButton}>
                  <Text style={styles.signUpButtonText}>Sign up</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={styles.leafHeader}>
              <Pressable
  style={styles.leafBackButton}
  onPress={() => {
    setActiveLeafFilter(null);
    setCategoryPaths((prev) => ({
  ...prev,
  [selectedMainCategory]: currentPath.slice(0, -1),
}));
  }}
>
                <Ionicons name="chevron-back" size={22} color="#111111" />
              </Pressable>

              <Pressable style={styles.leafSearchBar}>
                <Text style={styles.leafSearchPlaceholder}>
                  Search my orders: product...
                </Text>
              </Pressable>

              <Pressable style={styles.leafTopIconButton}>
  <CategoryGridIcon width={20} height={20} />
</Pressable>
            </View>

            <View style={styles.leafTopDivider} />

<View style={styles.leafSubcategoryBand}>
  <ScrollView
    horizontal
    scrollEnabled={true}
    nestedScrollEnabled={true}
    directionalLockEnabled={true}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.lastLevelRow}
    decelerationRate="fast"
    snapToAlignment="start"
  >
    {currentNode.map((item) => (
      <Pressable key={item} style={styles.lastLevelItem}>
        <View style={styles.leafCirclePlaceholder} />
        <Text style={styles.subcategoryText}>{item}</Text>
      </Pressable>
    ))}
  </ScrollView>
</View>

<View style={styles.leafBottomDivider} />

<View style={styles.filterRow}>
  {["Brand", "Color", "Sort by", "Filter"].map((label) => {
    const isActive = activeLeafFilter === label;
    const FilterIcon = getFilterIcon(label);

    return (
      <Pressable
        key={label}
        style={[styles.filterChip, isActive && styles.filterChipActive]}
        onPress={() =>
          setActiveLeafFilter((prev) => (prev === label ? null : label))
        }
      >
        <View style={styles.filterChipLeft}>
          <FilterIcon width={14} height={14} />

          <Text
            style={[
              styles.filterChipText,
              isActive && styles.filterChipTextActive,
            ]}
          >
            {label}
          </Text>
        </View>

        <FilterChevronDownIcon width={12} height={12} />
      </Pressable>
    );
  })}
</View>

            <View style={styles.leafBodyPlaceholder} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#EDEDED",
  },

  phoneFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    backgroundColor: "#F5F5F5",
  },

  topBar: {
  height: TOP_SAFE_SPACE + 68,
  paddingTop: TOP_SAFE_SPACE + 18,
  paddingHorizontal: 14,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: "#F5F5F5",
},
  title: {
  fontSize: 20,
  fontWeight: "900",
  color: "#111111",
  letterSpacing: 0.2,
},
  topIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topIconImage: {
  width: 25,
  height: 25,
},
  bellWrap: {
    position: "relative",
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeCount: {
    position: "absolute",
    top: -7,
    right: -7,
    fontSize: 10,
    fontWeight: "700",
    color: "#111111",
  },

  content: {
    flex: 1,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#D9D9D9",
  },

  leftMenu: {
  width: 112,
  minWidth: 112,
  maxWidth: 112,
  flexGrow: 0,
  flexShrink: 0,
  backgroundColor: "#F5F5F5",
  borderRightWidth: 0,
  overflow: "visible",
},
  leftMenuItem: {
  width: 112,
  flex: 1,
  paddingHorizontal: 6,
  justifyContent: "center",
  alignItems: "center",
  alignSelf: "flex-start",
  backgroundColor: "#F5F5F5",
  borderWidth: 1,
  borderColor: "#D0D0D0",
},
  leftMenuItemActive: {
  backgroundColor: "#FFFFFF",
  borderWidth: 1,
  borderColor: "#111111",
  zIndex: 2,
},
  leftMenuText: {
  fontSize: 10,
  lineHeight: 12,
  color: "#666666",
  textAlign: "center",
  width: 96,
},
  leftMenuTextActive: {
    color: "#111111",
    fontWeight: "700",
  },

  categoryGap: {
  width: 10,
  backgroundColor: "#E6E6E6",
  borderRightWidth: 1,
  borderRightColor: "#D9D9D9",
},

rightPane: {
  flex: 1,
  minWidth: 0,
  backgroundColor: "#F5F5F5",
},
  rightPaneContent: {
  paddingLeft: 6,
  paddingRight: 0,
  paddingTop: 12,
  paddingBottom: 90,
},

  backRow: {
    marginBottom: 8,
    paddingLeft: 2,
  },
  backText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111111",
  },

  subcategoryGrid: {
  width: 254,
  alignSelf: "flex-start",
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "flex-start",
  alignItems: "flex-start",
},
  subcategoryItem: {
  width: 70,
  alignItems: "center",
  marginBottom: 24,
},
subcategoryItemSpacing: {
  marginRight: 22,
},
  gridCirclePlaceholder: {
  width: 70,
  height: 70,
  borderRadius: 35,
  backgroundColor: "#D9D9D9",
  marginBottom: 8,
},

leafCirclePlaceholder: {
  width: 70,
  height: 70,
  borderRadius: 35,
  backgroundColor: "#D9D9D9",
  marginBottom: 3,
},
  subcategoryText: {
  fontSize: 10.5,
  lineHeight: 12,
  letterSpacing: -0.05,
  color: "#666666",
  textAlign: "center",
  width: 70,
},

  lastLevelRow: {
  paddingTop: 8,
  paddingLeft: 8,
  paddingRight: 8,
  paddingBottom: 8,
  alignItems: "flex-start",
},
  lastLevelItem: {
  width: 70,
  alignItems: "center",
  marginRight: 7,
},
  leafSubcategoryBand: {
  height: 107,
  justifyContent: "center",
},
  leafBottomDivider: {
    height: 1,
    backgroundColor: "#D9D9D9",
  },
  emptyStateWrap: {
    width: "100%",
    paddingTop: 40,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#666666",
    textAlign: "center",
    maxWidth: 220,
  },

  signInStrip: {
  backgroundColor: "#5A5454",
  height: 36,
  paddingHorizontal: 8,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},
  signInText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "500",
  },
  signUpButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  signUpButtonText: {
    color: "#111111",
    fontSize: 11,
    fontWeight: "700",
  },

  leafHeader: {
  height: 108,
  paddingHorizontal: 8,
  flexDirection: "row",
  alignItems: "flex-end",
  backgroundColor: "#F5F5F5",
},
  leafBackButton: {
  width: 24,
  height: 24,
  justifyContent: "center",
  alignItems: "center",
  marginBottom: 17,
  marginRight: 6,
},
  leafSearchBar: {
  width: 315,
  height: 42,
  borderRadius: 15,
  backgroundColor: "#E9E9E9",
  justifyContent: "center",
  paddingHorizontal: 14,
  marginBottom: 9,
  marginRight: 8,
},
  leafSearchPlaceholder: {
    fontSize: 12,
    color: "#9A9A9A",
  },
  leafTopIconButton: {
  width: 24,
  height: 28,
  justifyContent: "center",
  alignItems: "center",
  marginBottom: 16,
  marginRight: 0,
},
  leafTopDivider: {
    height: 1,
    backgroundColor: "#D9D9D9",
  },

  filterRow: {
  flexDirection: "row",
  paddingHorizontal: 8,
  marginTop: 4.5,
  justifyContent: "space-between",
},
  filterChip: {
  width: 88,
  height: 26,
  borderWidth: 0.5,
  borderColor: "#BEBEBE",
  paddingHorizontal: 5,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  backgroundColor: "#F5F5F5",
},
filterChipLeft: {
  flexDirection: "row",
  alignItems: "center",
},
  filterChipText: {
  fontSize: 12,
  lineHeight: 15,
  letterSpacing: 1.2,
  fontWeight: "600",
  color: "#555555",
  marginLeft: 4,
},
  filterChipActive: {
  borderColor: "#111111",
  backgroundColor: "#EFEFEF",
},

filterChipTextActive: {
  color: "#111111",
},

  leafBodyPlaceholder: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
});