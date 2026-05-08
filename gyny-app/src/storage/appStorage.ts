import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  hasCompletedFirstTimeSetup: "hasCompletedFirstTimeSetup",
};

export async function getHasCompletedFirstTimeSetup(): Promise<boolean> {
  const value = await AsyncStorage.getItem(KEYS.hasCompletedFirstTimeSetup);
  return value === "true";
}

export async function setHasCompletedFirstTimeSetup(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.hasCompletedFirstTimeSetup, String(value));
}