import React, { useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { TVFocusGuideView } from "./compat";
import { Detail, Progress, SeasonEntry, Series, resumeTarget } from "../../domain/model";
import { Button, palette } from "../components";
import { EPISODE_GROUP_SIZE } from "./layout";

export function DetailTV({
  detail,
  progress,
  favorite,
  onFavorite,
  onPlay,
  onOpenSeries,
  seasons,
  seasonsState = "ready",
  restoreEpisode,
}: {
  detail: Detail;
  progress?: Progress;
  favorite: boolean;
  onFavorite: () => void;
  onPlay: (index: number, position: number) => void;
  /** Opens another season of the same show. */
  onOpenSeries?: (series: Series) => void;
  /** Every season that was found, the current one included. */
  seasons?: SeasonEntry[];
  seasonsState?: "loading" | "ready" | "failed";
  restoreEpisode?: string;
}) {
  const current = detail.episodes.findIndex(
    (e) => e.id === (restoreEpisode || progress?.episodeId)
  );
  const [group, setGroup] = useState(
    Math.floor(Math.max(0, current) / EPISODE_GROUP_SIZE)
  );
  const [expanded, setExpanded] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const episodeTop = useRef(0);
  const target = resumeTarget(detail, progress);
  const others = (seasons || []).filter((entry) => entry.series.id !== detail.id);
  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={{ padding: 6, paddingBottom: 20 }}
    >
      <View style={s.hero}>
        <Image source={{ uri: detail.cover }} style={s.cover} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={s.title} numberOfLines={2}>
            {detail.title}
          </Text>
          <Text style={s.muted} numberOfLines={1}>
            {detail.badge} · {detail.tags}
          </Text>
          <Text style={s.description} numberOfLines={expanded ? undefined : 2}>
            {detail.description}
          </Text>
          <View style={s.row}>
            <Button
              label={progress ? "继续观看" : "开始播放"}
              primary
              preferred={!restoreEpisode}
              onFocus={() =>
                scroll.current?.scrollTo({ y: 0, animated: false })
              }
              onPress={() => onPlay(target.index, target.position)}
            />
            <Button
              label={favorite ? "已收藏 ✓" : "＋ 收藏"}
              onPress={onFavorite}
            />
            <Button
              label={expanded ? "收起简介" : "完整简介"}
              onPress={() => setExpanded(!expanded)}
            />
          </View>
        </View>
      </View>
      <View
        onLayout={(e) => {
          episodeTop.current = e.nativeEvent.layout.y;
        }}
      >
        <Text style={s.section}>选集 · {detail.episodes.length} 集</Text>
        <TVFocusGuideView trapFocusLeft trapFocusRight style={s.row}>
          {Array.from(
            { length: Math.ceil(detail.episodes.length / EPISODE_GROUP_SIZE) },
            (_, i) => (
              <Button
                key={i}
                label={`${i * EPISODE_GROUP_SIZE + 1}–${Math.min(
                  (i + 1) * EPISODE_GROUP_SIZE,
                  detail.episodes.length
                )}`}
                primary={group === i}
                onPress={() => setGroup(i)}
                onFocus={() =>
                  scroll.current?.scrollTo({
                    y: episodeTop.current,
                    animated: false,
                  })
                }
              />
            )
          )}
        </TVFocusGuideView>
        <TVFocusGuideView autoFocus style={[s.row, { marginTop: 12 }]}>
          {detail.episodes
            .slice(group * EPISODE_GROUP_SIZE, (group + 1) * EPISODE_GROUP_SIZE)
            .map((e, i) => (
              <Button
                key={e.id}
                label={String(e.number)}
                style={{ width: 72 }}
                primary={progress?.episodeId === e.id}
                preferred={restoreEpisode === e.id}
                onPress={() => onPlay(group * EPISODE_GROUP_SIZE + i, 0)}
                onFocus={() =>
                  scroll.current?.scrollTo({
                    y: episodeTop.current,
                    animated: false,
                  })
                }
              />
            ))}
        </TVFocusGuideView>
      </View>
      {seasonsState === "loading" ? (
        <Text style={[s.muted, { marginTop: 18 }]}>正在查找同系列剧…</Text>
      ) : seasonsState === "failed" ? (
        <Text style={[s.muted, { marginTop: 18 }]}>暂未找到同系列剧</Text>
      ) : others.length > 0 ? (
        <View style={{ marginTop: 18 }}>
          <Text style={s.section}>
            同系列剧 · 共 {others.length} 部其它季度
          </Text>
          {others.map((entry) => (
            <SeasonRow
              key={entry.series.id}
              entry={entry}
              onPress={() => onOpenSeries?.(entry.series)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * One season in the list.
 *
 * A vertical list with the poster on the left, not a grid: a grid of season
 * cards pulls the eye away from the episode grid above it and looks like
 * another page's content.
 */
function SeasonRow({
  entry,
  onPress,
}: {
  entry: SeasonEntry;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [broken, setBroken] = useState(false);
  const meta = entry.series.badge
    ? `第 ${entry.season} 季 · ${entry.series.badge}`
    : `第 ${entry.season} 季`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`第 ${entry.season} 季，${entry.series.title}，${entry.series.badge}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[s.season, focused && s.seasonFocus]}
    >
      {entry.series.cover && !broken ? (
        <Image
          source={{ uri: entry.series.cover }}
          resizeMode="cover"
          onError={() => setBroken(true)}
          style={s.seasonCover}
        />
      ) : (
        <View style={[s.seasonCover, s.seasonPlaceholder]}>
          <Text style={s.muted}>红果</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 6 }}>
        <Text numberOfLines={1} style={s.seasonTitle}>
          {entry.series.title}
        </Text>
        <Text numberOfLines={1} style={s.muted}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}
const s = StyleSheet.create({
  hero: { flexDirection: "row", gap: 24, marginBottom: 18 },
  cover: { width: 130, height: 176, borderRadius: 10 },
  title: {
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "700",
    color: palette.text,
  },
  muted: { fontSize: 15, color: palette.muted },
  description: { fontSize: 17, lineHeight: 24, color: palette.muted },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  section: {
    fontSize: 20,
    fontWeight: "600",
    color: palette.text,
    marginBottom: 10,
  },
  season: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 8,
    borderRadius: 10,
    marginBottom: 8,
  },
  seasonFocus: { backgroundColor: palette.panel },
  seasonCover: { width: 74, height: 98, borderRadius: 8 },
  seasonPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
  },
  seasonTitle: { fontSize: 18, fontWeight: "600", color: palette.text },
});
