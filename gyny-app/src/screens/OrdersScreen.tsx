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
import OrdersFilterIcon from "../../assets/icons/orders/filter.svg";
import OrdersCustomerCareIcon from "../../assets/icons/orders/customer-care.svg";
import OrdersDeleteIcon from "../../assets/icons/orders/delete.svg";
import OrdersEmptyBoxIcon from "../../assets/icons/orders/empty-box.svg";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

/*
  TEMPORARY:
  Keep this true so we can design how orders look.
  Later, when real backend orders are connected, we will remove this and use real order data.
*/
const HAS_DEMO_ORDERS = true;

type OrderTab =
  | "All orders"
  | "In transit"
  | "Delivered"
  | "Inspection"
  | "Completed"
  | "Upgrade"
  | "Returns"
  | "Refund"
  | "Review";

const orderTabs: OrderTab[] = [
  "All orders",
  "In transit",
  "Delivered",
  "Inspection",
  "Completed",
  "Upgrade",
  "Returns",
  "Refund",
  "Review",
];

const demoOrders = [
  {
    id: "1",
    inspectionTime: "0:00",
    transitProgress: 0.46,
  },
  {
    id: "2",
    inspectionTime: "6:15",
    transitProgress: 0.48,
  },
  {
    id: "3",
    inspectionTime: "14:34",
    transitProgress: 1,
  },
];

export default function OrdersScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<OrderTab>("All orders");
  const [showTrackingMap, setShowTrackingMap] = useState(false);

  function openTrackingMap() {
    setShowTrackingMap(true);
  }

  function closeTrackingMap() {
    setShowTrackingMap(false);
  }

  function renderEmptyState() {
    return (
      <ScrollView contentContainerStyle={styles.emptyContent}>
        <Text style={styles.noteText}>add inspection into above section</Text>

        <View style={styles.emptyState}>
          <OrdersEmptyBoxIcon width={82} height={82} />

          <Text style={styles.emptyTitle}>No orders yet</Text>

          <Pressable
            style={styles.continueButton}
            onPress={() => navigation.navigate("Tabs", { screen: "Home" })}
          >
            <Text style={styles.continueButtonText}>Continue shopping</Text>
          </Pressable>
        </View>

        <Text style={styles.bottomNote}>
          same screen when no order has been placed for all orders to completed
        </Text>
      </ScrollView>
    );
  }

  function renderAllOrders() {
    return (
      <ScrollView contentContainerStyle={styles.ordersListContent}>
        {demoOrders.map((order) => (
          <View key={order.id} style={styles.allOrderRow}>
            <View style={styles.orderImagePlaceholder} />

            <Pressable style={styles.rowDotsButton}>
              <Ionicons name="ellipsis-vertical" size={22} color="#111111" />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    );
  }

  function renderInTransit() {
    return (
      <ScrollView contentContainerStyle={styles.ordersListContent}>
        {demoOrders.map((order) => (
          <Pressable
            key={order.id}
            style={styles.inTransitRow}
            onPress={openTrackingMap}
          >
            <View style={styles.orderImagePlaceholder} />

            <View style={styles.transitLineArea}>
              <View style={styles.transitTrack}>
                <View
                  style={[
                    styles.transitProgress,
                    { width: `${order.transitProgress * 100}%` },
                  ]}
                />

                <Ionicons
                  name="car-sport-outline"
                  size={13}
                  color="#111111"
                  style={[
                    styles.transitVehicleIcon,
                    { left: `${order.transitProgress * 100}%` },
                  ]}
                />
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  function renderDelivered() {
    return (
      <ScrollView contentContainerStyle={styles.ordersListContent}>
        {demoOrders.map((order) => (
          <View key={order.id} style={styles.deliveredRow}>
            <View style={styles.orderImagePlaceholder} />

            <View style={styles.deliveredInfoArea}>
              <Text style={styles.inspectionLabel}>Inspection Time</Text>
              <Text style={styles.inspectionTime}>{order.inspectionTime}</Text>
            </View>

            <Pressable style={styles.rowDotsButton}>
              <Ionicons name="ellipsis-vertical" size={22} color="#111111" />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    );
  }

  function renderCompleted() {
    return (
      <ScrollView contentContainerStyle={styles.ordersListContent}>
        {demoOrders.map((order) => (
          <View key={order.id} style={styles.completedRow}>
            <View style={styles.orderImagePlaceholder} />

            <View style={styles.completedActionArea}>
              <Pressable style={styles.rowDotsButtonCompleted}>
                <Ionicons name="ellipsis-vertical" size={22} color="#111111" />
              </Pressable>

              <Ionicons name="bag-check-outline" size={31} color="#111111" />
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }

  function renderTabContent() {
    if (!HAS_DEMO_ORDERS) {
      return renderEmptyState();
    }

    if (activeTab === "All orders") {
      return renderAllOrders();
    }

    if (activeTab === "In transit") {
      return renderInTransit();
    }

    if (activeTab === "Delivered") {
      return renderDelivered();
    }

    if (activeTab === "Completed") {
      return renderCompleted();
    }

    return renderEmptyState();
  }

  if (showTrackingMap) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={closeTrackingMap}>
            <Ionicons name="chevron-back" size={31} color="#111111" />
          </Pressable>

          <Pressable style={styles.searchBar}>
            <Text style={styles.searchPlaceholder}>
              Search my orders: product...
            </Text>
          </Pressable>

          <Pressable style={styles.headerIconButton}>
            <OrdersFilterIcon width={26} height={26} />
          </Pressable>
        </View>

        <View style={styles.headerDivider} />

        <View style={styles.tabsOuter}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
          >
            {orderTabs.map((tab) => {
              const isActive = activeTab === tab;

              return (
                <Pressable
                  key={tab}
                  style={styles.tabButton}
                  onPress={() => {
                    setActiveTab(tab);
                    setShowTrackingMap(false);
                  }}
                >
                  <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                    {tab}
                  </Text>

                  {isActive && <View style={styles.activeTicker} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.tabsDivider} />

        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapText}>Map displayed here</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={31} color="#111111" />
        </Pressable>

        <Pressable style={styles.searchBar}>
          <Text style={styles.searchPlaceholder}>
            Search my orders: product...
          </Text>
        </Pressable>

        <Pressable style={styles.headerIconButton}>
          <OrdersFilterIcon width={26} height={26} />
        </Pressable>

        <Pressable style={styles.headerIconButton}>
          <OrdersCustomerCareIcon width={24} height={24} />
        </Pressable>

        <Pressable style={styles.headerIconButton}>
          <OrdersDeleteIcon width={25} height={25} />
        </Pressable>
      </View>

      <View style={styles.headerDivider} />

      <View style={styles.tabsOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {orderTabs.map((tab) => {
            const isActive = activeTab === tab;

            return (
              <Pressable
                key={tab}
                style={styles.tabButton}
                onPress={() => {
                  setActiveTab(tab);
                  setShowTrackingMap(false);
                }}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {tab}
                </Text>

                {isActive && <View style={styles.activeTicker} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.tabsDivider} />

      {renderTabContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  header: {
    height: TOP_SAFE_SPACE + 66,
    paddingTop: TOP_SAFE_SPACE + 14,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  backButton: {
    width: 30,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },

  searchBar: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#ECECEC",
    justifyContent: "center",
    paddingHorizontal: 10,
    marginRight: 8,
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
    marginLeft: 2,
  },

  headerDivider: {
    height: 1,
    backgroundColor: "#D0D0D0",
  },

  tabsOuter: {
    height: 50,
    backgroundColor: "#FFFFFF",
  },

  tabsRow: {
    paddingLeft: 10,
    paddingRight: 0,
    alignItems: "center",
  },

  tabButton: {
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    position: "relative",
  },

  tabText: {
    fontSize: 16,
    fontWeight: "400",
    color: "#111111",
  },

  tabTextActive: {
    fontWeight: "800",
  },

  activeTicker: {
    position: "absolute",
    bottom: 0,
    width: 38,
    height: 5,
    backgroundColor: "#000000",
  },

  tabsDivider: {
    height: 1,
    backgroundColor: "#D0D0D0",
  },

  emptyContent: {
    minHeight: 650,
    paddingHorizontal: 30,
    paddingBottom: 80,
  },

  noteText: {
    fontSize: 17,
    color: "#111111",
    marginTop: 22,
    marginLeft: 2,
  },

  emptyState: {
    alignItems: "center",
    marginTop: 58,
  },

  emptyTitle: {
    fontSize: 20,
    color: "#666666",
    marginTop: 12,
    marginBottom: 26,
  },

  continueButton: {
    backgroundColor: "#000000",
    height: 34,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  continueButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },

  bottomNote: {
    fontSize: 18,
    lineHeight: 24,
    color: "#666666",
    marginTop: 112,
    maxWidth: 310,
  },

  ordersListContent: {
    paddingBottom: 80,
  },

  allOrderRow: {
    height: 95,
    borderBottomWidth: 1,
    borderBottomColor: "#8C8C8C",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 15,
    position: "relative",
  },

  inTransitRow: {
    height: 95,
    borderBottomWidth: 1,
    borderBottomColor: "#8C8C8C",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 15,
  },

  deliveredRow: {
    height: 95,
    borderBottomWidth: 1,
    borderBottomColor: "#8C8C8C",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 15,
    position: "relative",
  },

  completedRow: {
    height: 95,
    borderBottomWidth: 1,
    borderBottomColor: "#8C8C8C",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 15,
  },

  orderImagePlaceholder: {
    width: 114,
    height: 86,
    backgroundColor: "#DCE6EC",
  },

  rowDotsButton: {
    position: "absolute",
    right: 8,
    top: 22,
    width: 26,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },

  transitLineArea: {
    flex: 1,
    paddingLeft: 32,
    paddingRight: 8,
    justifyContent: "center",
  },

  transitTrack: {
    height: 4,
    backgroundColor: "#DADADA",
    borderRadius: 999,
    position: "relative",
  },

  transitProgress: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#000000",
    borderRadius: 999,
  },

  transitVehicleIcon: {
    position: "absolute",
    top: -7,
    marginLeft: -6,
  },

  deliveredInfoArea: {
    flex: 1,
    height: "100%",
    paddingLeft: 14,
    paddingRight: 4,
    justifyContent: "flex-end",
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "flex-end",
  },

  inspectionLabel: {
    fontSize: 14,
    color: "#111111",
    flex: 1,
  },

  inspectionTime: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111111",
    marginRight: 2,
  },

  completedActionArea: {
    flex: 1,
    height: "100%",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingRight: 9,
    position: "relative",
  },

  rowDotsButtonCompleted: {
    position: "absolute",
    top: 13,
    right: 6,
    width: 26,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },

  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  mapText: {
    fontSize: 20,
    fontWeight: "800",
    color: "#000000",
  },
});