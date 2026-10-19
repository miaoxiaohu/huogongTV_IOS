import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  Text,
  View,
} from "react-native";
import { TVFocusGuideView, focusTV, useTVEventHandler } from "./tv/compat";
import Video, { VideoRef } from "react-native-video";
import { ContentProvider, Detail, Playback, Progress } from "../domain/model";
import { FrameMode } from "../data/playback";
import { RecoveryController, formatClock } from "../data/recovery";
import {
  FRAME_MODES,
  PLAYBACK_SPEEDS,
  SleepTimer,
  frameModeInfo,
  normalizeFrameMode,
  normalizeSpeed,
  speedLabel,
} from "../data/playback";
import { Button, Notice, palette } from "./components";
import { seekPosition, tvInsets } from "./tv/layout";
const clock = formatClock;
export function Player({
  detail,
  initialIndex,
  initialPosition,
  provider,
  onExit,
  onProgress,
  onTryLowerQuality,
  maxQuality = 1080,
  playbackSpeed = 1,
  frameMode = "fit",
  onChangeSpeed,
  onChangeFrameMode,
  autoNext = true,
  test = false,
}: {
  detail: Detail;
  initialIndex: number;
  initialPosition: number;
  provider: ContentProvider;
  onExit: () => void;
  onProgress: (p: Progress) => void;
  /** Drop to a lower quality and play again, the way the TV app does. */
  onTryLowerQuality?: () => void;
  /** The quality ceiling currently in force, so "try 720P" can be hidden. */
  maxQuality?: number;
  /** The speed the player starts at. */
  playbackSpeed?: number;
  /** How the picture fills the screen. */
  frameMode?: FrameMode;
  onChangeSpeed?: (speed: number) => void;
  onChangeFrameMode?: (mode: FrameMode) => void;
  /** Whether the next episode starts by itself. */
  autoNext?: boolean;
  test?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const inset = tvInsets(width, height);
  const main = useRef<View>(null);
  const [panel, setPanel] = useState(false);
  const scrub = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSeek = useRef(0);
  const seekRef = useRef((delta: number) => {});
  function stopScrub() {
    if (scrub.current) clearInterval(scrub.current);
    scrub.current = null;
  }
  useEffect(() => stopScrub, []);
  function reveal() {
    setControlsVisible(true);
    setInteraction((n) => n + 1);
  }
  function closePanel() {
    setPanel(false);
    setSettingsOpen(false);
    requestAnimationFrame(() => focusTV(main.current));
  }
  const [index, setIndex] = useState(initialIndex);
  const [source, setSource] = useState<Playback>();
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在准备播放…");
  const [position, setPosition] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const [retry, setRetry] = useState(0);
  const [finished, setFinished] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interaction, setInteraction] = useState(0);
  const showControls = controlsVisible || paused || panel || !!error || !source;
  const video = useRef<VideoRef>(null);
  const progress = useRef({
    position: initialPosition,
    duration: 0,
    completed: false,
  });
  const seekStart = useRef(initialPosition);
  const lastSaved = useRef(0);
  // The recovery controller is created before `refresh` exists, so it calls
  // it through a ref.
  const refreshRef = useRef<() => void>(() => {});
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const episode = detail.episodes[index];

  // Automatic playback recovery, the way the TV app does it: a failure that
  // looks like a transport problem is retried on its own a few times, with a
  // growing delay, and the watching position is kept.
  const [autoRecovery, setAutoRecovery] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const recoveryRef = useRef<RecoveryController | null>(null);
  if (!recoveryRef.current) {
    recoveryRef.current = new RecoveryController({
      onRetry: () => refreshRef.current(),
      onNote: (note) => setRecoveryNote(note),
      onState: (armed) => setAutoRecovery(armed),
    });
  }
  const recovery = recoveryRef.current;
  const save = useCallback(() => {
    if (test) return;
    const { episodes: _, ...series } = detail;
    onProgressRef.current({
      series,
      episodeId: episode.id,
      episodeNumber: episode.number,
      ...progress.current,
      updatedAt: Date.now(),
    });
  }, [detail, episode, test]);

  /** A playback failure: show it, and retry it when it is worth retrying. */
  function fail(message: string) {
    setError(message);
    if (test) return;
    recovery.fail(message, progress.current.position);
  }

  /** The user asked for a retry: the budget starts over. */
  function manualRetry() {
    recovery.manual();
    refresh();
  }

  function stopAutoRecovery() {
    recovery.cancel();
  }

  /** Play again in a lower quality, the way the TV app offers it. */
  function tryLowerQuality() {
    if (!onTryLowerQuality) return;
    recovery.manual();
    seekStart.current = progress.current.position;
    onTryLowerQuality();
  }

  useEffect(() => {
    let live = true;
    setSource(undefined);
    setError("");
    setBuffering(false);
    setStatus("正在准备播放…");
    // A new attempt starts, but the recovery budget survives it: only a
    // retry the user asked for puts the budget back to the start.
    recovery.begin();
    const request = test
      ? Promise.resolve({
          uri: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          headers: {},
        })
      : provider.resolve(episode.id, retry > 0, (progress) => {
          if (live) setStatus(progress.message);
        });
    request
      .then((value) => {
        if (live) setSource(value);
      })
      .catch((e) => {
        if (live) fail(e.message);
      });
    return () => {
      live = false;
    };
  }, [episode.id, provider, retry, test]);
  useEffect(() => () => recovery.dispose(), []);
  useEffect(() => () => save(), [save]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        stopScrub();
        setPaused(true);
        save();
        return;
      }
      // Coming back to the app is the moment a connection that was down
      // usually works again, so the recovery does not have to wait.
      recovery.poke(progress.current.position);
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel) {
        closePanel();
        return true;
      }
      stopScrub();
      save();
      onExit();
      return true;
    });
    return () => {
      subscription.remove();
      back.remove();
    };
  }, [save, onExit, panel]);
  useTVEventHandler((event) => {
    const type = event.eventType;
    if (["focus", "blur", "select", "longSelect"].includes(type)) return;
    if (type === "longLeft" || type === "longRight") {
      if (event.eventKeyAction === 1) {
        stopScrub();
        return;
      }
      if (panel || error || scrub.current) return;
      const delta = type === "longRight" ? 10 : -10;
      reveal();
      seekRef.current(delta);
      scrub.current = setInterval(() => {
        reveal();
        seekRef.current(delta);
      }, 300);
      return;
    }
    if (event.eventKeyAction === 0) return;
    if (type === "playPause") {
      togglePlayback();
      return;
    }
    if (panel || error) return;
    if (type === "left" || type === "right") {
      reveal();
      seek(type === "right" ? 10 : -10);
    }
    if (type === "up") reveal();
    if (type === "down") {
      reveal();
      setPanel(true);
    }
  });
  useEffect(() => {
    if (!source || paused || panel || error || buffering) return;
    const timer = setTimeout(() => setControlsVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [source, paused, panel, error, buffering, interaction]);
  function switchEpisode(next: number) {
    if (next < 0 || next >= detail.episodes.length) return;
    stopScrub();
    recovery.reset();
    save();
    pendingSeek.current = 0;
    setSource(undefined);
    seekStart.current = 0;
    lastSaved.current = 0;
    setFinished(false);
    setPaused(false);
    setRetry(0);
    setIndex(next);
  }
  useEffect(() => {
    progress.current = {
      position: seekStart.current,
      duration: 0,
      completed: false,
    };
    setPosition(seekStart.current);
    setDuration(0);
  }, [index]);
  function refresh() {
    seekStart.current = progress.current.position;
    setFinished(false);
    setPaused(false);
    setRetry((n) => n + 1);
  }
  refreshRef.current = refresh;
  function togglePlayback() {
    reveal();
    if (!source || error) return;
    if (finished) {
      seekStart.current = 0;
      progress.current.completed = false;
      progress.current.position = 0;
      refresh();
    } else setPaused((value) => !value);
  }
  function seek(delta: number) {
    if (!source || error || !duration) return;
    const value = seekPosition(progress.current.position, delta, duration);
    pendingSeek.current = Date.now();
    video.current?.seek(value);
    progress.current.position = value;
    progress.current.completed = false;
    setFinished(false);
    setPosition(value);
  }
  seekRef.current = seek;

  // -----------------------------------------------------------------------
  // The playback preferences
  // -----------------------------------------------------------------------
  const sleepTimer = useRef(new SleepTimer());
  const timerChoice = useRef(0);
  const [speed, setSpeed] = useState(normalizeSpeed(playbackSpeed));
  const [frame, setFrame] = useState(normalizeFrameMode(frameMode));
  const [timerLabel, setTimerLabel] = useState("关闭");
  const [timerActive, setTimerActive] = useState(false);
  const [sleepStopped, setSleepStopped] = useState(false);
  useEffect(() => {
    setSpeed(normalizeSpeed(playbackSpeed));
  }, [playbackSpeed]);
  useEffect(() => {
    setFrame(normalizeFrameMode(frameMode));
  }, [frameMode]);
  /** The timer runs on a clock of its own, so the label can be refreshed. */
  useEffect(() => {
    if (!timerActive) return;
    const tick = setInterval(() => {
      setTimerLabel(sleepTimer.current.label());
      if (sleepTimer.current.poll()) {
        // The timer ran out: the playback stops where it is.
        setPaused(true);
        setSleepStopped(true);
        setTimerActive(false);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [timerActive]);
  function cycleSpeed() {
    const next = PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(speed) + 1) % PLAYBACK_SPEEDS.length];
    setSpeed(next);
    onChangeSpeed?.(next);
  }
  function cycleFrame() {
    const modes = FRAME_MODES.map((entry) => entry.mode);
    const next = modes[(modes.indexOf(frame) + 1) % modes.length];
    setFrame(next);
    onChangeFrameMode?.(next);
  }
  function cycleTimer() {
    // 关闭, then the minute choices, then the episode choices.
    const choices: Array<() => void> = [
      () => sleepTimer.current.cancel(),
      () => sleepTimer.current.afterMinutes(15),
      () => sleepTimer.current.afterMinutes(30),
      () => sleepTimer.current.afterMinutes(60),
      () => sleepTimer.current.afterMinutes(90),
      () => sleepTimer.current.afterEpisodes(1),
      () => sleepTimer.current.afterEpisodes(3),
      () => sleepTimer.current.afterEpisodes(5),
    ];
    const current = timerChoice.current;
    const next = (current + 1) % choices.length;
    timerChoice.current = next;
    choices[next]();
    setTimerLabel(sleepTimer.current.label());
    setTimerActive(sleepTimer.current.active);
    setSleepStopped(false);
  }
  function playFromStart() {
    seekStart.current = 0;
    progress.current.completed = false;
    progress.current.position = 0;
    setPosition(0);
    setFinished(false);
    setPaused(false);
    refresh();
  }
  return (
    <View style={s.screen}>
      {source && !error && (
        <Video
          key={`${episode.id}:${retry}`}
          ref={video}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode={frameModeInfo(frame).resizeMode}
          rate={speed}
          paused={paused}
          controls={false}
          playInBackground={false}
          playWhenInactive={false}
          progressUpdateInterval={1000}
          onLoad={(data) => {
            setDuration(data.duration);
            progress.current.duration = data.duration;
            if (seekStart.current > 0)
              video.current?.seek(
                Math.min(seekStart.current, Math.max(0, data.duration - 1))
              );
          }}
          onBuffer={(data) => setBuffering(data.isBuffering)}
          onSeek={() => {
            pendingSeek.current = 0;
          }}
          onProgress={(data) => {
            if (pendingSeek.current && Date.now() - pendingSeek.current < 1500)
              return;
            progress.current.position = data.currentTime;
            setPosition(data.currentTime);
            if (Date.now() - lastSaved.current > 5000) {
              lastSaved.current = Date.now();
              save();
            }
          }}
          onEnd={() => {
            stopScrub();
            progress.current.completed = true;
            save();
            // The sleep timer counts the episodes too, and it can also be
            // waiting for the minutes to run out.
            if (sleepTimer.current.episodeEnded()) {
              setPaused(true);
              setSleepStopped(true);
              setTimerActive(false);
              setTimerLabel("关闭");
              return;
            }
            if (!autoNext) {
              setFinished(true);
              setPaused(true);
              return;
            }
            if (index + 1 < detail.episodes.length) switchEpisode(index + 1);
            else {
              setFinished(true);
              setPaused(true);
            }
          }}
          onError={() => {
            stopScrub();
            fail("播放失败，可重试或切换清晰度。");
          }}
        />
      )}
      <TVFocusGuideView
        style={StyleSheet.absoluteFill}
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        trapFocusDown
      >
        <Pressable
          ref={main}
          style={{ flex: 1 }}
          focusable={!panel && !error}
          hasTVPreferredFocus={!panel && !error}
          accessibilityRole="button"
          accessibilityLabel={
            paused ? "视频已暂停，按确认继续播放" : "视频播放中，按确认暂停"
          }
          onPress={togglePlayback}
        />
      </TVFocusGuideView>
      {showControls && (
        <View
          pointerEvents="none"
          style={[
            s.top,
            { paddingHorizontal: inset.horizontal, paddingTop: inset.vertical },
          ]}
        >
          <Text style={s.title} numberOfLines={2}>
            {detail.title}
          </Text>
          <Text style={s.subtitle}>
            {episode.title}
            {test ? " · 公开测试片" : ` / 共 ${detail.episodes.length} 集`}
          </Text>
        </View>
      )}
      <View pointerEvents={error ? "auto" : "none"} style={s.center}>
        {error ? (
          <Notice
            message={error}
            note={recoveryNote}
            retry={manualRetry}
            retryLabel="立即重试"
            actions={
              <View style={s.failureActions}>
                {onTryLowerQuality && maxQuality > 720 ? (
                  <Button label="尝试 720P" onPress={tryLowerQuality} />
                ) : null}
                <Button
                  label="返回选集"
                  onPress={() => {
                    save();
                    onExit();
                  }}
                />
                {autoRecovery ? (
                  <Button label="停止自动重试" onPress={stopAutoRecovery} />
                ) : null}
              </View>
            }
          />
        ) : !source ? (
          <Text style={s.buffer}>{status}</Text>
        ) : buffering ? (
          <Text style={s.buffer}>正在缓冲…</Text>
        ) : finished ? (
          <Text style={s.buffer}>本剧已播放完</Text>
        ) : null}
      </View>
      {showControls && (
        <View
          style={[
            s.bottom,
            {
              paddingHorizontal: inset.horizontal,
              paddingBottom: inset.vertical,
            },
          ]}
          pointerEvents={panel ? "auto" : "none"}
        >
          <View style={s.track}>
            <View
              style={[
                s.fill,
                {
                  width: `${
                    duration ? Math.min(100, (position / duration) * 100) : 0
                  }%`,
                },
              ]}
            />
          </View>
          <View style={s.time}>
            <Text style={s.subtitle}>
              {clock(position)} / {clock(duration)}
              {paused ? " · 已暂停" : ""}
              {sleepStopped ? " · 定时停止已生效" : ""}
            </Text>
            <Text style={s.subtitle}>
              {source?.quality ? `${source.quality} · ` : ""}
              {speedLabel(speed)} · {frameModeInfo(frame).label}
              {timerActive ? ` · 定时 ${timerLabel}` : ""}
              {autoNext ? " · 自动连播" : ""}
            </Text>
          </View>
          {panel ? (
            <TVFocusGuideView
              autoFocus
              trapFocusLeft
              trapFocusRight
              trapFocusUp
              trapFocusDown
              style={s.controls}
            >
              {settingsOpen ? (
                <>
                  <Button
                    label={`倍速 · ${speedLabel(speed)}`}
                    onPress={cycleSpeed}
                  />
                  <Button
                    label={`画面 · ${frameModeInfo(frame).label}`}
                    onPress={cycleFrame}
                  />
                  <Button
                    label={`定时 · ${timerLabel}`}
                    onPress={cycleTimer}
                  />
                  <Button
                    label="从头播放"
                    onPress={() => {
                      playFromStart();
                      closePanel();
                    }}
                  />
                  <Button
                    label="返回"
                    onPress={() => setSettingsOpen(false)}
                  />
                </>
              ) : (
                <>
                  <Button
                    label="上一集"
                    disabled={index === 0 || test}
                    onPress={() => {
                      switchEpisode(index - 1);
                      closePanel();
                    }}
                  />
                  <Button
                    label={
                      finished ? "重新播放" : paused ? "继续播放" : "暂停"
                    }
                    primary
                    preferred
                    onPress={() => {
                      togglePlayback();
                      closePanel();
                    }}
                  />
                  <Button
                    label="下一集"
                    disabled={index === detail.episodes.length - 1 || test}
                    onPress={() => {
                      switchEpisode(index + 1);
                      closePanel();
                    }}
                  />
                  <Button
                    label="播放设置"
                    onPress={() => setSettingsOpen(true)}
                  />
                  <Button
                    label="返回选集"
                    onPress={() => {
                      save();
                      onExit();
                    }}
                  />
                </>
              )}
            </TVFocusGuideView>
          ) : (
            <Text style={s.hint}>
              确认 播放/暂停　 ·　 左右 快进/退 10 秒，长按连续　 ·　 下键
              更多操作
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#050507" },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
    gap: 6,
    backgroundColor: "#101016D0",
  },
  title: { color: palette.text, fontSize: 24, fontWeight: "600" },
  subtitle: { color: palette.muted, fontSize: 15 },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#101016E0",
    paddingTop: 16,
  },
  track: { height: 3, backgroundColor: palette.border, borderRadius: 3 },
  fill: { height: 3, backgroundColor: palette.accent },
  time: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 12,
  },
  controls: { flexDirection: "row", gap: 12, justifyContent: "center" },
  failureActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
  },
  hint: { fontSize: 15, color: palette.text, textAlign: "center" },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  buffer: {
    color: palette.text,
    fontSize: 20,
    backgroundColor: "#101016D0",
    padding: 20,
    borderRadius: 14,
  },
});
