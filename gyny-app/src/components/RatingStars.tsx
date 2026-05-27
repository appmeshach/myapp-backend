import React from "react";
import { View } from "react-native";
import StarIcon from "../../assets/icons/reviews/star.svg";

type RatingStarsProps = {
  rating: number;
  size?: number;
  gap?: number;
};

export default function RatingStars({
  rating,
  size = 18,
  gap = 2,
}: RatingStarsProps) {
  const stars = [1, 2, 3, 4, 5];

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {stars.map((starNumber) => {
        const rawFill = rating - (starNumber - 1);
        const fillPercent = Math.max(0, Math.min(1, rawFill));

        return (
          <View
            key={starNumber}
            style={{
              width: size,
              height: size,
              marginRight: starNumber === 5 ? 0 : gap,
              backgroundColor: "#FFFFFF",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: size * fillPercent,
                backgroundColor: "#111111",
              }}
            />

            <View
              style={{
                width: size,
                height: size,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StarIcon width={size * 0.78} height={size * 0.78} />
            </View>
          </View>
        );
      })}
    </View>
  );
}