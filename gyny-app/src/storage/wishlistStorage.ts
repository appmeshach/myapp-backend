import AsyncStorage from "@react-native-async-storage/async-storage";

export type WishlistItem = {
  id: string;
  product_id: string;
  title: string;
  brief_detail?: string | null;
  store_id?: string | null;
store_name?: string | null;
price_kobo: number;
  image_url?: string | null;
};

const WISHLIST_KEY = "app_wishlist_items";

export async function getWishlistItems(): Promise<WishlistItem[]> {
  const raw = await AsyncStorage.getItem(WISHLIST_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function addWishlistItem(item: WishlistItem) {
  const current = await getWishlistItems();

  const alreadyExists = current.some(
    (wishlistItem) => wishlistItem.product_id === item.product_id
  );

  if (alreadyExists) {
    return {
      added: false,
      items: current,
    };
  }

  const next = [item, ...current];
  await AsyncStorage.setItem(WISHLIST_KEY, JSON.stringify(next));

  return {
    added: true,
    items: next,
  };
}

export async function removeWishlistItem(productId: string) {
  const current = await getWishlistItems();

  const next = current.filter(
    (wishlistItem) => wishlistItem.product_id !== productId
  );

  await AsyncStorage.setItem(WISHLIST_KEY, JSON.stringify(next));
  return next;
}

export async function getWishlistCount() {
  const items = await getWishlistItems();
  return items.length;
}
export async function isInWishlist(productId: string) {
  const items = await getWishlistItems();
  return items.some((item) => item.product_id === productId);
}