import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import BagHeaderIcon from "../../assets/icons/bag-header.svg";
import ProductCard from "../components/ProductCard";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

const demoProducts = Array.from({ length: 20 }, (_, index) => ({
  id: `new-arrival-${index}`,
  store_id: "demo-store",
  title: index % 2 === 0 ? "Bone straight human hair: Black..." : "Maggi: Pack",
  price_kobo: index % 2 === 0 ? 52300000 : 52300000,
  brief_detail: "Black, Size 23",
  store_name: index % 2 === 0 ? "Shoprite:Lagos" : "Shoprite",
}));

export default function NewArrivalsScreen({ navigation }: any) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.headerRow}>
            <View style={styles.leftHeader}>
              <Pressable style={styles.circleButton} onPress={() => navigation.goBack()}>
                <Ionicons name="chevron-back" size={23} color="#111111" />
              </Pressable>

              <Text style={styles.title}>New arrivals</Text>
            </View>

            <View style={styles.rightHeader}>
              <Pressable style={styles.circleButton}>
                <Ionicons name="search" size={19} color="#111111" />
              </Pressable>

              <Pressable style={styles.circleButton}>
                <BagHeaderIcon width={18} height={18} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.filterRow}>
          <Pressable style={styles.filterBox}>
            <Text style={styles.filterText}>Brand</Text>
            <Ionicons name="chevron-down" size={15} color="#555555" />
          </Pressable>

          <Pressable style={styles.filterBox}>
            <Text style={styles.filterText}>Price</Text>
            <Ionicons name="chevron-down" size={15} color="#555555" />
          </Pressable>

          <Pressable style={styles.filterBox}>
            <Text style={styles.filterText}>Size</Text>
            <Ionicons name="chevron-down" size={15} color="#555555" />
          </Pressable>
        </View>

        <View style={styles.grid}>
          {demoProducts.map((item, index) => (
            <View key={`${item.id}-${index}`} style={styles.gridItem}>
              <ProductCard
                product={item}
                onPress={() =>
                  navigation.navigate("ProductDetail", { productId: item.id })
                }
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  content: {
    paddingBottom: 36,
  },
  hero: {
    height: 260 + TOP_SAFE_SPACE,
    backgroundColor: "#DCE6EC",
    paddingTop: TOP_SAFE_SPACE + 16,
    paddingHorizontal: 12,
  },
  headerRow: {
    height: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  leftHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  rightHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  circleButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginLeft: 10,
    fontSize: 22,
    fontWeight: "800",
    color: "#303030",
  },
  filterRow: {
    height: 42,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  filterBox: {
    width: 82,
    height: 24,
    borderWidth: 1,
    borderColor: "#BEBEBE",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  filterText: {
    fontSize: 12,
    color: "#3A3A3A",
  },
  grid: {
    paddingHorizontal: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#F5F5F5",
  },
  gridItem: {
    width: "50%",
    paddingHorizontal: 4,
    marginBottom: 12,
  },
});