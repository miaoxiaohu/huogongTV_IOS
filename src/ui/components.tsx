import React, { forwardRef, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { Series } from "../domain/model";
export const palette = {
  bg: "#101016",
  panel: "#1C1C26",
  muted: "#A8A7B7",
  text: "#FAF8F6",
  accent: "#FF694F",
  border: "#32313F",
};
export const Button = forwardRef<
  View,
  {
    label: string;
    onPress: () => void;
    primary?: boolean;
    preferred?: boolean;
    disabled?: boolean;
    style?: ViewStyle;
    onFocus?: () => void;
    onBlur?: () => void;
    testID?: string;
    focusable?: boolean;
  }
>(function Button(
  {
    label,
    onPress,
    primary = false,
    preferred = false,
    disabled = false,
    style,
    onFocus,
    onBlur,
    testID,
    focusable,
  },
  ref
) {
  const [focused, setFocused] = useState(false);
  const preferredUsed = useRef(false);
  return (
    <Pressable
      ref={ref}
      testID={testID}
      focusable={focusable}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferred && !preferredUsed.current}
      disabled={disabled}
      onFocus={() => {
        preferredUsed.current = true;
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      onPress={onPress}
      style={[
        s.button,
        primary && s.primary,
        focused && s.focused,
        disabled && { opacity: 0.35 },
        style,
      ]}
    >
      <Text style={[s.buttonText, focused && { color: palette.bg }]}>
        {label}
      </Text>
    </Pressable>
  );
});
export const Card = forwardRef<
  View,
  {
    item: Series;
    width: number;
    coverHeight: number;
    titleHeight: number;
    onPress: () => void;
    onFocus: () => void;
    preferred?: boolean;
    /** The place on a hot board, when the card is on one. */
    rank?: number | null;
    /** A long press, for the quick actions. */
    onLongPress?: () => void;
  }
>(function Card(
  {
    item,
    width,
    coverHeight,
    titleHeight,
    onPress,
    onFocus,
    preferred,
    rank,
    onLongPress,
  },
  ref
) {
  const [focused, setFocused] = useState(false);
  const preferredUsed = useRef(false);
  const [broken, setBroken] = useState(false);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={
        rank === undefined
          ? `${item.title}，${item.badge}`
          : `第 ${rank ?? "暂无"} 名，${item.title}，${item.badge}`
      }
      hasTVPreferredFocus={preferred && !preferredUsed.current}
      onFocus={() => {
        preferredUsed.current = true;
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={[s.card, { width }, focused && s.cardFocus]}
    >
      <View style={[s.cover, { height: coverHeight }]}>
        {item.cover && !broken ? (
          <Image
            source={{ uri: item.cover }}
            resizeMode="cover"
            onError={() => setBroken(true)}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Text style={s.placeholder}>红果</Text>
        )}
        {rank === undefined ? null : (
          <View style={[s.rank, (rank ?? 99) <= 3 && s.rankTop]}>
            <Text style={s.rankText}>
              {rank ? `第 ${rank} 名` : "名次暂无"}
            </Text>
          </View>
        )}
        <View style={s.badge}>
          <Text numberOfLines={1} style={s.badgeText}>
            {item.badge || "短剧"}
          </Text>
        </View>
      </View>
      <Text numberOfLines={2} style={[s.title, { height: titleHeight }]}>
        {item.title}
      </Text>
    </Pressable>
  );
});
export function Notice({
  message,
  busy = false,
  retry,
  retryLabel = "重试",
  note,
  actions,
}: {
  message: string;
  busy?: boolean;
  retry?: () => void;
  /** The label of the retry button. */
  retryLabel?: string;
  /** A smaller line under the message, e.g. what is about to happen next. */
  note?: string;
  /** Extra buttons, e.g. "try a lower quality" next to "retry". */
  actions?: React.ReactNode;
}) {
  return (
    <View style={s.notice}>
      {busy && <ActivityIndicator color={palette.accent} size="large" />}
      <Text style={s.noticeText}>{message}</Text>
      {note ? <Text style={s.noticeNote}>{note}</Text> : null}
      {retry && (
        <Button label={retryLabel} onPress={retry} primary preferred />
      )}
      {actions}
    </View>
  );
}
const s = StyleSheet.create({
  button: {
    backgroundColor: palette.panel,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  primary: { backgroundColor: "#BA3E2A" },
  focused: { backgroundColor: "#FFE5DC", borderColor: palette.accent },
  buttonText: { color: palette.text, fontSize: 16, fontWeight: "600" },
  card: {
    margin: 6,
    padding: 4,
    borderWidth: 3,
    borderColor: "transparent",
    borderRadius: 14,
  },
  cardFocus: { borderColor: palette.accent, backgroundColor: "#29212A" },
  cover: {
    borderRadius: 9,
    overflow: "hidden",
    backgroundColor: palette.panel,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: { color: "#7D4350", fontSize: 28, fontWeight: "bold" },
  badge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    left: 0,
    backgroundColor: "#000000A0",
    padding: 8,
  },
  badgeText: { color: "#fff", fontSize: 14 },
  rank: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: "#1C1F27",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderTopLeftRadius: 8,
  },
  rankTop: { backgroundColor: palette.accent },
  rankText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  title: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    marginTop: 10,
  },
  caption: { color: palette.muted, fontSize: 12, marginTop: 5 },
  notice: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 36,
    gap: 22,
  },
  noticeNote: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  noticeText: {
    color: palette.muted,
    fontSize: 19,
    textAlign: "center",
    maxWidth: 600,
    lineHeight: 30,
  },
});
