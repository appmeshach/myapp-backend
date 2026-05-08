import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeIcon from "../../assets/icons/bottom-tabs/home.svg";
import HomeActiveIcon from "../../assets/icons/bottom-tabs/home-active.svg";

import CategoriesIcon from "../../assets/icons/bottom-tabs/categories.svg";
import CategoriesActiveIcon from "../../assets/icons/bottom-tabs/categories-active.svg";

import BagIcon from "../../assets/icons/bottom-tabs/bag.svg";
import BagActiveIcon from "../../assets/icons/bottom-tabs/bag-active.svg";

import WishlistIcon from "../../assets/icons/bottom-tabs/wishlist.svg";
import WishlistActiveIcon from "../../assets/icons/bottom-tabs/wishlist-active.svg";

import AccountIcon from "../../assets/icons/bottom-tabs/account.svg";
import AccountActiveIcon from "../../assets/icons/bottom-tabs/account-active.svg";

import SplashScreen from "../screens/SplashScreen";
import TaglineScreen from "../screens/TaglineScreen";
import RoleSelectScreen from "../screens/RoleSelectScreen";
import LocationScreen from "../screens/LocationScreen";
import NotificationPromptScreen from "../screens/NotificationPromptScreen";
import HomeScreen from "../screens/HomeScreen";
import CategoriesScreen from "../screens/CategoriesScreen";
import BagScreen from "../screens/BagScreen";
import WishlistScreen from "../screens/WishlistScreen";
import AccountScreen from "../screens/AccountScreen";
import ProductDetailScreen from "../screens/ProductDetailScreen";
import CheckoutSuccessScreen from "../screens/CheckoutSuccessScreen";
import OrderDetailScreen from "../screens/OrderDetailScreen";
import CheckoutScreen from "../screens/CheckoutScreen";
import NewArrivalsScreen from "../screens/NewArrivalsScreen";
import StoreDetailScreen from "../screens/StoreDetailScreen";

import {
  getHasCompletedFirstTimeSetup,
  setHasCompletedFirstTimeSetup,
} from "../storage/appStorage";

type AppPhase =
  | "BOOTING"
  | "FIRST_SPLASH"
  | "FIRST_TAGLINE"
  | "ROLE_SELECT"
  | "LOCATION"
  | "NOTIFICATIONS"
  | "RETURNING_SPLASH"
  | "RETURNING_TAGLINE"
  | "MAIN";

type MainTabsParamList = {
  Home: undefined;
  Categories: undefined;
  Bag: undefined;
  Wishlist: undefined;
  Account: undefined;
};

type RootStackParamList = {
  Tabs: undefined;
  ProductDetail: { productId: string };
  NewArrivals: undefined;
  StoreDetail: { storeId?: string };
  OrderDetail: { orderId: string };
  Checkout: {
  cartItemIds: string[];
  selectedTotalKobo: number;
  selectedCount: number;
  items: {
    id: string;
    title: string;
    brief_detail?: string | null;
    qty: number;
    price_kobo: number;
  }[];
};

  CheckoutSuccess: {
    checkoutGroupId: string;
    orderId: string;
    grandTotalKobo: number;
  };
};

const Tab = createBottomTabNavigator<MainTabsParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,

        tabBarActiveTintColor: "#7D1427",
tabBarInactiveTintColor: "#6E6E6E",

        tabBarStyle: {
          height: 82,
paddingTop: 10,
paddingBottom: 18,
backgroundColor: "#FFFFFF",
borderTopWidth: 0,
borderTopLeftRadius: 28,
borderTopRightRadius: 28,

          elevation: 14,

          shadowColor: "#000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
        },

        tabBarLabelStyle: {
  fontSize: 11,
  fontWeight: "500",
  marginTop: -2,
  paddingBottom: 2,
},

        tabBarIcon: ({ focused }) => {
  const iconSize = 30;

  if (route.name === "Home") {
    const Icon = focused ? HomeActiveIcon : HomeIcon;
    return <Icon width={iconSize} height={iconSize} />;
  }

  if (route.name === "Categories") {
    const Icon = focused ? CategoriesActiveIcon : CategoriesIcon;
    return <Icon width={iconSize} height={iconSize} />;
  }

  if (route.name === "Bag") {
    const Icon = focused ? BagActiveIcon : BagIcon;
    return <Icon width={iconSize} height={iconSize} />;
  }

  if (route.name === "Wishlist") {
    const Icon = focused ? WishlistActiveIcon : WishlistIcon;
    return <Icon width={iconSize} height={iconSize} />;
  }

  if (route.name === "Account") {
    const Icon = focused ? AccountActiveIcon : AccountIcon;
    return <Icon width={iconSize} height={iconSize} />;
  }

  return null;
},
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Categories" component={CategoriesScreen} />
      <Tab.Screen name="Bag" component={BagScreen} />
      <Tab.Screen name="Wishlist" component={WishlistScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

function MainStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        animation: "slide_from_right",
        gestureEnabled: true,
      }}
    >
      <Stack.Screen
        name="Tabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />

      <Stack.Screen
  name="ProductDetail"
  component={ProductDetailScreen}
  options={{
    headerShown: false,
  }}
/>

<Stack.Screen
  name="NewArrivals"
  component={NewArrivalsScreen}
  options={{
    headerShown: false,
  }}
/>
<Stack.Screen
  name="StoreDetail"
  component={StoreDetailScreen}
  options={{
    headerShown: false,
  }}
/>

      <Stack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{
          title: "Order detail",
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
  name="Checkout"
  component={CheckoutScreen}
  options={{
    headerShown: false,
  }}
/>

      <Stack.Screen
        name="CheckoutSuccess"
        component={CheckoutSuccessScreen}
        options={{
          title: "",
          headerShadowVisible: false,
        }}
      />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const [phase, setPhase] = useState<AppPhase>("BOOTING");

  useEffect(() => {
    async function bootstrap() {
      const hasCompleted = await getHasCompletedFirstTimeSetup();

      if (hasCompleted) {
        setPhase("RETURNING_SPLASH");
      } else {
        setPhase("FIRST_SPLASH");
      }
    }

    bootstrap();
  }, []);

  async function finishFirstTimeSetup() {
    await setHasCompletedFirstTimeSetup(true);
    setPhase("MAIN");
  }

  if (phase === "BOOTING") {
    return null;
  }

  return (
    <NavigationContainer>
      {phase === "FIRST_SPLASH" && (
        <SplashScreen onDone={() => setPhase("FIRST_TAGLINE")} />
      )}

      {phase === "FIRST_TAGLINE" && (
        <TaglineScreen onContinue={() => setPhase("ROLE_SELECT")} />
      )}

      {phase === "ROLE_SELECT" && (
        <RoleSelectScreen onStartShopping={() => setPhase("LOCATION")} />
      )}

      {phase === "LOCATION" && (
        <LocationScreen onContinue={() => setPhase("NOTIFICATIONS")} />
      )}

      {phase === "NOTIFICATIONS" && (
        <NotificationPromptScreen onFinish={finishFirstTimeSetup} />
      )}

      {phase === "RETURNING_SPLASH" && (
        <SplashScreen onDone={() => setPhase("RETURNING_TAGLINE")} />
      )}

      {phase === "RETURNING_TAGLINE" && (
        <TaglineScreen onContinue={() => setPhase("MAIN")} />
      )}

      {phase === "MAIN" && <MainStack />}
    </NavigationContainer>
  );
}