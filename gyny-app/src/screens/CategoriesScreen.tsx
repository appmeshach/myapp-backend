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


const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const mainCategories = Object.keys(categoryTree);

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
              <ScrollView
                style={styles.leftMenu}
                contentContainerStyle={styles.leftMenuContent}
                showsVerticalScrollIndicator={false}
              >
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
              </ScrollView>

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
                  {Object.keys(currentNode).map((item) => (
  <Pressable
    key={item}
    style={styles.subcategoryItem}
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
                <Ionicons name="grid-outline" size={20} color="#111111" />
              </Pressable>
            </View>

            <View style={styles.leafTopDivider} />

<View style={styles.leafSubcategoryBand}>
  <ScrollView
  horizontal
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

    return (
      <Pressable
        key={label}
        style={[styles.filterChip, isActive && styles.filterChipActive]}
        onPress={() =>
          setActiveLeafFilter((prev) => (prev === label ? null : label))
        }
      >
        <Text
          style={[styles.filterChipText, isActive && styles.filterChipTextActive]}
        >
          {label}
        </Text>
        <Ionicons
          name="chevron-down"
          size={14}
          color={isActive ? "#111111" : "#555555"}
        />
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
  width: 98,
  backgroundColor: "#F5F5F5",
  borderRightWidth: 1,
  borderRightColor: "#BDBDBD",
},
  leftMenuContent: {
    paddingBottom: 20,
  },
  leftMenuItem: {
  height: 62,
  paddingHorizontal: 6,
  justifyContent: "center",
  alignItems: "center",
  borderBottomWidth: 1,
  borderBottomColor: "#BDBDBD",
},
  leftMenuItemActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#111111",
  },
  leftMenuText: {
    fontSize: 10,
    lineHeight: 12,
    color: "#666666",
    textAlign: "center",
  },
  leftMenuTextActive: {
    color: "#111111",
    fontWeight: "700",
  },

  rightPane: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  rightPaneContent: {
  paddingHorizontal: 8,
  paddingTop: 13,
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
  width: "100%",
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "space-between",
  alignItems: "flex-start",
},
  subcategoryItem: {
  width: "32%",
  alignItems: "center",
  marginBottom: 22,
},
  gridCirclePlaceholder: {
  width: 70,
  height: 70,
  borderRadius: 35,
  backgroundColor: "#D9D9D9",
  marginBottom: 7,
},

leafCirclePlaceholder: {
  width: 70,
  height: 70,
  borderRadius: 35,
  backgroundColor: "#D9D9D9",
  marginBottom: 3,
},
  subcategoryText: {
  fontSize: 11,
  lineHeight: 13,
  letterSpacing: -0.05,
  color: "#666666",
  textAlign: "center",
  width: 78,
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
  paddingHorizontal: 12,
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
  marginRight: 14,
},
  leafSearchBar: {
  width: 329,
  height: 42,
  borderRadius: 15,
  backgroundColor: "#E9E9E9",
  justifyContent: "center",
  paddingHorizontal: 14,
  marginBottom: 9,
  marginRight: 20,
},
  leafSearchPlaceholder: {
    fontSize: 12,
    color: "#9A9A9A",
  },
  leafTopIconButton: {
  width: 20,
  height: 20,
  justifyContent: "center",
  alignItems: "center",
  marginBottom: 19,
},
  leafTopDivider: {
    height: 1,
    backgroundColor: "#D9D9D9",
  },

  filterRow: {
  flexDirection: "row",
  paddingHorizontal: 8,
  marginTop: 4.5,
},
  filterChip: {
  width: 100,
  height: 26,
  borderWidth: 0.5,
  borderColor: "#BEBEBE",
  paddingHorizontal: 8,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  backgroundColor: "#F5F5F5",
  marginRight: 5,
},
  filterChipText: {
    fontSize: 12.08,
    lineHeight: 15.6,
    letterSpacing: 1.5,
    fontWeight: "600",
    color: "#555555",
    marginRight: 6,
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