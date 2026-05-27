import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  StatusBar,
  ScrollView,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const TOP_SAFE_SPACE =
  Platform.OS === "android" ? StatusBar.currentHeight || 24 : 0;

type SizeCountry = "NG size" | "EU size" | "US size" | "JP size" | "China size";

const sizeOptions: SizeCountry[] = [
  "NG size",
  "EU size",
  "US size",
  "JP size",
  "China size",
];

const countryTableLabels: Record<SizeCountry, string> = {
  "NG size": "NG",
  "EU size": "EU",
  "US size": "US",
  "JP size": "JP",
  "China size": "China",
};

const tableColumns = [
  "Collar size",
  "Shoulder",
  "Bust size",
  "Waist size",
  "Hem size",
  "Cuff size",
  "Length",
  "Sleeve length",
];

const sizeTableRows = [
  {
    id: "xs",
    size: "XS",
    country: {
      "NG size": "6",
      "EU size": "34",
      "US size": "2",
      "JP size": "5",
      "China size": "155/80A",
    },
    collar: "34",
    shoulder: "36",
    bust: "82",
    waist: "64",
    hem: "88",
    cuff: "18",
    length: "58",
    sleeve: "55",
  },
  {
    id: "s",
    size: "S",
    country: {
      "NG size": "8",
      "EU size": "36",
      "US size": "4",
      "JP size": "7",
      "China size": "160/84A",
    },
    collar: "35",
    shoulder: "37",
    bust: "86",
    waist: "68",
    hem: "92",
    cuff: "19",
    length: "60",
    sleeve: "56",
  },
  {
    id: "m",
    size: "M",
    country: {
      "NG size": "10",
      "EU size": "38",
      "US size": "6",
      "JP size": "9",
      "China size": "165/88A",
    },
    collar: "36",
    shoulder: "38",
    bust: "90",
    waist: "72",
    hem: "96",
    cuff: "20",
    length: "62",
    sleeve: "57",
  },
  {
    id: "l",
    size: "L",
    country: {
      "NG size": "12",
      "EU size": "40",
      "US size": "8",
      "JP size": "11",
      "China size": "170/92A",
    },
    collar: "37",
    shoulder: "39",
    bust: "94",
    waist: "76",
    hem: "100",
    cuff: "21",
    length: "64",
    sleeve: "58",
  },
  {
    id: "xl",
    size: "XL",
    country: {
      "NG size": "14",
      "EU size": "42",
      "US size": "10",
      "JP size": "13",
      "China size": "175/96A",
    },
    collar: "38",
    shoulder: "40",
    bust: "98",
    waist: "80",
    hem: "104",
    cuff: "22",
    length: "66",
    sleeve: "59",
  },
];

const measurementGuide = [
  {
    number: 1,
    title: "Collar",
    description: "Measure around the base of the neck where the collar sits.",
  },
  {
    number: 2,
    title: "Shoulder",
    description: "Measure across the back from one shoulder seam to the other.",
  },
  {
    number: 3,
    title: "Bust",
    description: "Measure around the fullest part of the chest area.",
  },
  {
    number: 4,
    title: "Waist",
    description: "Measure around the natural waistline.",
  },
  {
    number: 5,
    title: "Hem",
    description: "Measure across the bottom opening of the clothing item.",
  },
  {
    number: 6,
    title: "Cuff",
    description: "Measure around the sleeve opening or wrist opening.",
  },
  {
    number: 7,
    title: "Length",
    description: "Measure from the highest shoulder point down to the bottom hem.",
  },
  {
    number: 8,
    title: "Sleeve length",
    description: "Measure from the shoulder seam down to the sleeve opening.",
  },
];

export default function SizeGuideScreen({ navigation }: any) {
  const [unit, setUnit] = useState<"cmkg" | "inlb">("cmkg");
  const [selectedSizeOption, setSelectedSizeOption] =
  useState<SizeCountry>("NG size");
  const [showSizeDropdown, setShowSizeDropdown] = useState(false);
  const selectedCountryLabel = countryTableLabels[selectedSizeOption];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
  <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
    <Ionicons name="chevron-back" size={32} color="#111111" />
  </Pressable>

  <Text style={styles.title}>Size measurement</Text>
</View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.controlsRow}>
          <View style={styles.dropdownWrap}>
            <Pressable
              style={styles.dropdownButton}
              onPress={() => setShowSizeDropdown((prev) => !prev)}
            >
              <Text style={styles.dropdownText}>{selectedSizeOption}</Text>
              <Ionicons name="chevron-down" size={14} color="#111111" />
            </Pressable>

            {showSizeDropdown && (
              <View style={styles.dropdownPanel}>
                {sizeOptions.map((option) => (
                  <Pressable
                    key={option}
                    style={styles.dropdownOption}
                    onPress={() => {
                      setSelectedSizeOption(option);
                      setShowSizeDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownOptionText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.unitToggle}>
            <Pressable
              style={[styles.unitButton, unit === "cmkg" && styles.unitButtonActive]}
              onPress={() => setUnit("cmkg")}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  unit === "cmkg" && styles.unitButtonTextActive,
                ]}
              >
                cm, kg
              </Text>
            </Pressable>

            <Pressable
              style={[styles.unitButton, unit === "inlb" && styles.unitButtonActive]}
              onPress={() => setUnit("inlb")}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  unit === "inlb" && styles.unitButtonTextActive,
                ]}
              >
                in, lb
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.tableOuter}>
  <View style={styles.fixedTableColumns}>
    <View style={styles.fixedHeaderRow}>
      <View style={styles.tableHeaderCellSmall}>
        <Text style={styles.tableHeaderText}>{selectedCountryLabel}</Text>
      </View>

      <View style={styles.tableHeaderCellSmall}>
        <Text style={styles.tableHeaderText}>Size</Text>
      </View>
    </View>

    {sizeTableRows.map((row) => (
      <View key={row.id} style={styles.fixedDataRow}>
        <View style={styles.tableDataCellSmall}>
          <Text style={styles.tableDataText}>
            {row.country[selectedSizeOption]}
          </Text>
        </View>

        <View style={styles.tableDataCellSmall}>
          <Text style={styles.tableDataText}>{row.size}</Text>
        </View>
      </View>
    ))}
  </View>

  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <View>
      <View style={styles.tableHeaderRow}>
        {tableColumns.map((column) => (
          <View key={column} style={styles.tableHeaderCell}>
            <Text style={styles.tableHeaderText}>{column}</Text>
          </View>
        ))}
      </View>

      {sizeTableRows.map((row) => (
        <View key={row.id} style={styles.tableDataRow}>
          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.collar}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.shoulder}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.bust}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.waist}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.hem}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.cuff}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.length}</Text>
          </View>

          <View style={styles.tableDataCell}>
            <Text style={styles.tableDataText}>{row.sleeve}</Text>
          </View>
        </View>
      ))}
    </View>
  </ScrollView>
</View>

        <View style={styles.sectionDivider} />

        <View style={styles.guideSection}>
          <Text style={styles.guideTitle}>Item measurement guide</Text>

          <View style={styles.measurementImageWrap}>
  <Image
    source={require("../../assets/images/size-guide/measurement-guide.png")}
    style={styles.measurementGuideImage}
    resizeMode="contain"
  />
</View>

          <View style={styles.measurementList}>
            {measurementGuide.map((item) => (
              <View key={item.number} style={styles.measurementItem}>
                <View style={styles.numberCircle}>
                  <Text style={styles.numberText}>{item.number}</Text>
                </View>

                <Text style={styles.measurementText}>
                  <Text style={styles.measurementBold}>{item.title}: </Text>
                  {item.description}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <Pressable style={styles.modelSection}>
          <View style={styles.modelAvatar} />

          <View style={styles.modelTextArea}>
            <Text style={styles.modelTitle}>Model is wearing: M(US: 9)</Text>
            <Text style={styles.modelSubtitle} numberOfLines={1}>
              Height: 170.0, Bust size: 90.2...
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={27} color="#111111" />
        </Pressable>

        <View style={styles.finalLine} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  header: {
  height: TOP_SAFE_SPACE + 74,
  paddingTop: TOP_SAFE_SPACE + 18,
  paddingLeft: 2,
  paddingRight: 18,
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: "#FFFFFF",
},

backButton: {
  width: 38,
  height: 34,
  alignItems: "center",
  justifyContent: "center",
  marginRight: 8,
},

title: {
  fontSize: 21,
  fontWeight: "800",
  color: "#111111",
},

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 0,
  },

  controlsRow: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 20,
  },

  dropdownWrap: {
    position: "relative",
    zIndex: 30,
  },

  dropdownButton: {
    height: 25,
    borderWidth: 1,
    borderColor: "#111111",
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  dropdownText: {
    fontSize: 16,
    color: "#111111",
    marginRight: 3,
  },

  dropdownPanel: {
    position: "absolute",
    top: 28,
    left: 0,
    width: 112,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#111111",
    zIndex: 40,
  },

  dropdownOption: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },

  dropdownOptionText: {
    fontSize: 14,
    color: "#111111",
  },

  unitToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#111111",
  },

  unitButton: {
    height: 25,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },

  unitButtonActive: {
    backgroundColor: "#000000",
  },

  unitButtonText: {
    fontSize: 15,
    color: "#111111",
    fontWeight: "600",
  },

  unitButtonTextActive: {
    color: "#FFFFFF",
  },

  tableOuter: {
  height: 260,
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderTopColor: "#BDBDBD",
  borderBottomColor: "#E0E0E0",
  flexDirection: "row",
  backgroundColor: "#FFFFFF",
},

fixedTableColumns: {
  width: 108,
  backgroundColor: "#FFFFFF",
},

fixedHeaderRow: {
  height: 35,
  flexDirection: "row",
},

fixedDataRow: {
  height: 45,
  flexDirection: "row",
},

tableHeaderRow: {
  height: 35,
  flexDirection: "row",
},

tableDataRow: {
  height: 45,
  flexDirection: "row",
},

tableHeaderCellSmall: {
  width: 54,
  height: 35,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderRightColor: "#CFCFCF",
  borderBottomColor: "#CFCFCF",
  justifyContent: "center",
  alignItems: "center",
},

tableDataCellSmall: {
  width: 54,
  height: 45,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderRightColor: "#CFCFCF",
  borderBottomColor: "#E5E5E5",
  justifyContent: "center",
  alignItems: "center",
},

tableHeaderCell: {
  width: 100,
  height: 35,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderRightColor: "#CFCFCF",
  borderBottomColor: "#CFCFCF",
  justifyContent: "center",
  alignItems: "center",
  paddingHorizontal: 4,
},

tableDataCell: {
  width: 100,
  height: 45,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderRightColor: "#CFCFCF",
  borderBottomColor: "#E5E5E5",
  justifyContent: "center",
  alignItems: "center",
  paddingHorizontal: 4,
},

tableHeaderText: {
  fontSize: 13,
  fontWeight: "700",
  color: "#111111",
  textAlign: "center",
},

tableDataText: {
  fontSize: 13,
  color: "#111111",
  textAlign: "center",
},

  sectionDivider: {
    height: 10,
    backgroundColor: "#ECECEC",
  },

  guideSection: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingTop: 22,
    paddingBottom: 18,
  },

  guideTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111111",
    marginBottom: 22,
  },
  measurementImageWrap: {
  width: "100%",
  height: 190,
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 10,
},

measurementGuideImage: {
  width: "100%",
  height: "100%",
},

  shirtGuideArea: {
    height: 190,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    marginBottom: 10,
  },

  shirtBox: {
    width: 140,
    height: 150,
    position: "relative",
  },

  shirtBody: {
    position: "absolute",
    left: 37,
    top: 35,
    width: 66,
    height: 100,
    borderWidth: 1,
    borderColor: "#999999",
    backgroundColor: "#FFFFFF",
  },

  shirtSleeveLeft: {
    position: "absolute",
    left: 8,
    top: 42,
    width: 36,
    height: 38,
    borderWidth: 1,
    borderColor: "#999999",
    transform: [{ rotate: "-10deg" }],
  },

  shirtSleeveRight: {
    position: "absolute",
    right: 8,
    top: 42,
    width: 36,
    height: 38,
    borderWidth: 1,
    borderColor: "#999999",
    transform: [{ rotate: "10deg" }],
  },

  shirtBodyBack: {
    position: "absolute",
    left: 32,
    top: 32,
    width: 68,
    height: 103,
    borderWidth: 1,
    borderColor: "#999999",
    backgroundColor: "#FFFFFF",
  },

  shirtSleeveRightBack: {
    position: "absolute",
    right: 3,
    top: 42,
    width: 36,
    height: 38,
    borderWidth: 1,
    borderColor: "#999999",
    transform: [{ rotate: "10deg" }],
  },

  redMeasureLine: {
    position: "absolute",
    height: 2,
    backgroundColor: "#FF2A1A",
  },

  redVerticalLine: {
    position: "absolute",
    width: 2,
    backgroundColor: "#FF2A1A",
  },

  shoulderLine: {
    left: 39,
    top: 27,
    width: 62,
  },

  chestLine: {
    left: 39,
    top: 77,
    width: 62,
  },

  waistLine: {
    left: 39,
    bottom: 8,
    width: 62,
  },

  lengthLine: {
    left: 67,
    top: 37,
    height: 96,
  },

  sleeveLine: {
    right: 4,
    top: 35,
    width: 38,
    transform: [{ rotate: "10deg" }],
  },

  measurementList: {
    marginTop: 4,
  },

  measurementItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },

  numberCircle: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginTop: 2,
  },

  numberText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  measurementText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: "#111111",
  },

  measurementBold: {
    fontWeight: "800",
  },

  modelSection: {
    height: 112,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  modelAvatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: "#D9D9D9",
    marginRight: 12,
  },

  modelTextArea: {
    flex: 1,
  },

  modelTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111111",
    marginBottom: 8,
  },

  modelSubtitle: {
    fontSize: 15,
    color: "#111111",
  },

  finalLine: {
    height: 1,
    backgroundColor: "#CFCFCF",
  },
});