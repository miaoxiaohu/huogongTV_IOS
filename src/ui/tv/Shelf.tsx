import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Series } from "../../domain/model";
import { Card, palette } from "../components";
import { TVFocusGuideView } from "./compat";

/**
 * One shelf: a row of shows under a heading.
 *
 * The TV app's home page is nothing but shelves. Here they sit at the top of
 * the grid and scroll away with it, so the grid keeps the whole screen and
 * the page reads the same way as the TV's.
 *
 * The focus guide is inert on this build - the app is an iOS app, and
 * react-native has no TV focus guide - but it is there for the day it
 * becomes a tvOS one.
 */
export function Shelf({
  title,
  items,
  width = 130,
  onOpen,
  onLongPress,
  onFocus,
}: {
  title: string;
  items: Series[];
  width?: number;
  onOpen: (item: Series) => void;
  onLongPress?: (item: Series) => void;
  onFocus?: () => void;
}) {
  if (items.length === 0) return null;
  const coverHeight = Math.round((width - 14) * 1.05);
  return (
    <View style={s.shelf}>
      <Text style={s.title}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        <TVFocusGuideView trapFocusLeft trapFocusRight style={s.row}>
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              width={width}
              coverHeight={coverHeight}
              titleHeight={48}
              onPress={() => onOpen(item)}
              onLongPress={onLongPress ? () => onLongPress(item) : undefined}
              onFocus={() => onFocus?.()}
            />
          ))}
        </TVFocusGuideView>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  shelf: { gap: 8, marginBottom: 14 },
  title: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 6,
  },
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 6 },
});
