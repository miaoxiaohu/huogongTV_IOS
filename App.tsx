import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Linking,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { BridgeProvider } from "./src/data/provider";
import { ApiProvider } from "./src/data/api";
import { loadState, saveLibrary, saveSettings, loadCatalogue, saveCatalogue } from "./src/data/storage";
import { Dirs } from "react-native-file-access";
import {
  CatalogueEntries,
  CatalogueIndex,
  CatalogueSnapshot,
  CATALOGUE_ROUTES,
  emptySnapshot,
} from "./src/data/catalogue";
import { buildCatalogue } from "./src/data/catalogueBuilder";
import {
  addedEpisodes,
  FavoriteUpdate,
  firstFavoriteUpdate,
  observeFavoriteUpdate,
  shouldCheck,
} from "./src/data/favorites";
import { rememberSearch, RecentSearch } from "./src/data/searchHistory";
import { clearHistory, clearSearches, removeHistory } from "./src/data/history";
import { licenseNotice } from "./src/data/licenses";
import {
  BackupData,
  decodeBackup,
  describeBackup,
  encodeBackup,
  mergeBackup,
  settingsFromBackup,
} from "./src/data/backup";
import { listBackups, readBackup, writeBackup } from "./src/data/storage";
import {
  AppUpdate,
  checkForUpdate,
  isNewer,
  readInstalledVersion,
  releasePage,
} from "./src/data/updates";
import {
  FRAME_MODES,
  PLAYBACK_SPEEDS,
  frameModeInfo,
  speedLabel,
} from "./src/data/playback";
import { FrameMode } from "./src/data/playback";
import { useCatalog } from "./src/data/useCatalog";
import {
  Detail,
  Library,
  Progress,
  SeasonEntry,
  Series,
  Settings,
  normalizeBaseUrl,
  resumeTarget,
} from "./src/domain/model";
import { Button, Check, Notice, palette } from "./src/ui/components";
import { Confirm, ConfirmRequest } from "./src/ui/Confirm";
import { Info } from "./src/ui/Info";
import { focusTV } from "./src/ui/tv/compat";
import { Player } from "./src/ui/Player";
import { DetailTV } from "./src/ui/tv/DetailTV";
import { GridHandle, GridPosition, TVGrid } from "./src/ui/tv/TVGrid";
import { Shelf } from "./src/ui/tv/Shelf";
import { tvInsets } from "./src/ui/tv/layout";
type Tab = "推荐" | "搜索" | "排行榜" | "收藏" | "最近观看" | "设置";
const tabs: Tab[] = ["推荐", "搜索", "排行榜", "收藏", "最近观看", "设置"];

/**
 * Something the user has to agree to before it happens.
 *
 * It is kept as data and not as a ready-made dialog, so the dialog always
 * reads the current state - a checkbox that was ticked is seen by the action
 * that runs when the button is pressed.
 */
type Pending =
  | { kind: "remove-record"; id: string; title: string }
  | { kind: "clear-searches" }
  | { kind: "clear-history" }
  | { kind: "restore"; backup: BackupData; name: string; withSettings: boolean };
const sample: Detail = {
  id: "test",
  title: "播放器测试 · Big Buck Bunny",
  cover: "",
  description: "",
  badge: "",
  tags: "",
  episodes: [{ id: "test", number: 1, title: "测试片" }],
};
export default function App() {
  const { width, height } = useWindowDimensions();
  const inset = tvInsets(width, height);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    baseUrl: "",
    token: "",
    category: "short",
    maxQuality: 540,
  });
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [category, setCategory] = useState<"short" | "comic">("short");
  const [maxQuality, setMaxQuality] = useState(540);
  const [library, setLibrary] = useState<Library>({
    favorites: [],
    progress: {},
    favoriteUpdates: {},
    searches: [],
    later: [],
    watched: [],
    hidden: [],
  });
  const libraryRef = useRef(library);
  const [tab, setTab] = useState<Tab>("推荐");
  const [detail, setDetail] = useState<Detail>();
  const [detailId, setDetailId] = useState("");
  const [seasons, setSeasons] = useState<SeasonEntry[]>([]);
  const [seasonsState, setSeasonsState] = useState<
    "loading" | "ready" | "failed"
  >("ready");
  // The local index of the whole library, so a search is not capped at the
  // ten rows the site renders.
  const [catalogue, setCatalogue] = useState<CatalogueSnapshot>(emptySnapshot());
  const [catalogueIndex, setCatalogueIndex] = useState<CatalogueIndex | null>(
    null
  );
  const [walk, setWalk] = useState({
    running: false,
    total: 0,
    route: "",
    gaps: 0,
  });
  // The quick actions, the way the TV app opens them on a long press.
  const [quick, setQuick] = useState<Series | null>(null);
  const autoPlayRef = useRef(false);
  // The favourites' update check.
  const [checking, setChecking] = useState(false);
  const [favoriteStatus, setFavoriteStatus] = useState("");
  // The backups that are lying around in the documents directory.
  const [backups, setBackups] = useState<string[]>([]);
  const [backupOpen, setBackupOpen] = useState(false);
  // The update check.
  const [updateState, setUpdateState] = useState("");
  const [pendingUpdate, setPendingUpdate] = useState<AppUpdate | null>(null);
  const [appVersion, setAppVersion] = useState("");
  // The search history.
  const [historyOpen, setHistoryOpen] = useState(false);
  // The confirmation dialog. Nothing is thrown away without asking first.
  const [pending, setPending] = useState<Pending | null>(null);
  // A page of text, e.g. the open source licenses.
  const [info, setInfo] = useState<{ title: string; body: string } | null>(null);
  const [play, setPlay] = useState<{
    detail: Detail;
    index: number;
    position: number;
    test?: boolean;
  }>();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [searchRun, setSearchRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [restoreGrid, setRestoreGrid] = useState(false);
  const [restoreEpisode, setRestoreEpisode] = useState<string>();
  const [focusArea, setFocusArea] = useState<"nav" | "content">("nav");
  const positions = useRef(
    Object.fromEntries(tabs.map((t) => [t, { index: 0 }])) as Record<
      Tab,
      GridPosition
    >
  );
  const grid = useRef<GridHandle>(null);
  const nav = useRef(new Map<Tab, View>());
  // The provider is built from the settings it actually reads. Building it
  // from the whole settings object would give it a new identity whenever the
  // speed or the picture mode changed, and the player would take that as a
  // new show and start the episode over.
  const provider = useMemo(
    () =>
      settings.baseUrl
        ? new BridgeProvider(settings)
        : new ApiProvider({
            category: settings.category ?? "short",
            maxQuality: settings.maxQuality ?? 540,
          }),
    [settings.baseUrl, settings.category, settings.maxQuality, settings.token]
  );
  const catalog = useCatalog(
    provider,
    tab === "搜索" ? submitted : null,
    ready && ["推荐", "搜索"].includes(tab),
    {
      mode: tab === "搜索" ? "search" : "home",
      catalogue: catalogueIndex,
      shelf: settings.category === "comic" ? "comic" : "short",
    }
  );
  // The hot board has its own pages: it is a board, not a catalogue, and it
  // follows the content type instead of the search.
  const ranking = useCatalog(provider, null, ready && tab === "排行榜", {
    mode: "ranking",
  });
  useEffect(() => {
    loadState()
      .then((data) => {
        setSettings(data.settings);
        setUrl(data.settings.baseUrl);
        setToken(data.settings.token);
        setCategory(data.settings.category ?? "short");
        setMaxQuality(data.settings.maxQuality ?? 540);
        setLibrary(data.library);
        libraryRef.current = data.library;
      })
      .catch(() => {
        setMessage("本地数据读取失败，将使用默认设置");
        setTab("设置");
      })
      .finally(() => setReady(true));
  }, []);

  // The local index of the whole library. It is read back at startup, and
  // the walk that fills it runs in the background.
  useEffect(() => {
    let live = true;
    loadCatalogue().then((snapshot) => {
      if (!live) return;
      setCatalogue(snapshot);
      setCatalogueIndex(new CatalogueIndex(snapshot.entries, snapshot.routes));
      // The walk starts by itself when there is nothing to search yet. It
      // carries on in the background, and it can be picked up again from the
      // search tab if it was interrupted.
      if (snapshot.entries.length === 0) void startWalk(false, snapshot);
    });
    return () => {
      live = false;
    };
  }, []);

  const walkCancelled = useRef(false);
  const walkRunning = useRef(false);
  useEffect(() => {
    walkCancelled.current = false;
    return () => {
      walkCancelled.current = true;
    };
  }, []);
  // The playback needs the network more than the walk does.
  useEffect(() => {
    if (play) walkCancelled.current = true;
  }, [play]);
  // The backups that are lying around are only worth listing when the user
  // goes to the settings.
  useEffect(() => {
    if (tab !== "设置") return;
    let live = true;
    listBackups().then((names) => {
      if (live) setBackups(names);
    });
    readInstalledVersion().then((installed) => {
      if (live) setAppVersion(installed.version);
    });
    return () => {
      live = false;
    };
  }, [tab]);
  async function startWalk(fromScratch: boolean, base?: CatalogueSnapshot) {
    if (walkRunning.current) return;
    // A self hosted service has no catalogue to walk.
    if (settings.baseUrl) {
      setMessage("这个来源没有片库目录，搜索只能用到站方的十条");
      return;
    }
    // The walk may have been stopped by the player; starting it again clears
    // that, or it would never run a second time.
    walkCancelled.current = false;
    // A full re-walk starts over, but the shows that are already held keep
    // serving: a stale index keeps answering while the rebuild runs behind
    // it, so the count never dips to zero.
    const held = base ?? catalogue;
    const start = fromScratch
      ? { ...held, cursor: {}, done: [] }
      : held;
    // The shows are merged by id, so a re-walk replaces the ones it sees
    // again instead of doubling the library, and the count on the screen
    // never dips while the index is refreshed.
    const entries = new CatalogueEntries(start.entries, start.routes);
    walkRunning.current = true;
    setWalk({
      running: true,
      total: entries.size,
      route: "",
      gaps: start.gaps.length,
    });
    const snapshotOf = (
      cursor: Record<string, number>,
      done: string[],
      gaps: string[]
    ) => ({
      entries: entries.entries,
      routes: entries.routes,
      cursor,
      done,
      gaps,
      savedAt: Date.now(),
    });
    try {
      const result = await buildCatalogue(
        (route, page) => provider.cataloguePage(route, page),
        {
          resume: start.cursor,
          done: start.done,
          isCancelled: () => walkCancelled.current,
          onPage: (step) => {
            // The checkpoint is written as the walk goes, so an interrupted
            // walk carries on instead of starting over.
            entries.add(step.fresh, step.route);
            const snapshot = snapshotOf(step.cursor, step.done, step.gaps);
            setCatalogue(snapshot);
            setCatalogueIndex(
              new CatalogueIndex(snapshot.entries, snapshot.routes)
            );
            setWalk({
              running: true,
              total: entries.size,
              route: step.route,
              gaps: step.gaps.length,
            });
            void saveCatalogue(snapshot).catch(() =>
              setMessage("片库索引保存失败，请检查电视存储空间")
            );
          },
        }
      );
      const snapshot = snapshotOf(result.cursor, result.done, result.gaps);
      await saveCatalogue(snapshot);
      setCatalogue(snapshot);
      setCatalogueIndex(new CatalogueIndex(snapshot.entries, snapshot.routes));
      walkRunning.current = false;
      setWalk({
        running: false,
        total: entries.size,
        route: "",
        gaps: result.gaps.length,
      });
      if (result.gaps.length > 0) {
        setMessage(`索引有 ${result.gaps.length} 页没抓到，可再走一次`);
      }
    } catch (error) {
      walkRunning.current = false;
      setWalk((old) => ({ ...old, running: false }));
      setMessage("片库索引没走完，可继续");
    }
  }

  /** Marks a show as watched through, or takes the mark back. */
  function setWatched(id: string, watched: boolean) {
    updateLibrary((old) => ({
      ...old,
      watched: watched
        ? Array.from(new Set([...old.watched, id]))
        : old.watched.filter((row) => row !== id),
    }));
  }

  /** Deletes the watching record of a show. The favourite stays. */
  function removeProgress(id: string) {
    updateLibrary((old) => removeHistory(old, id));
  }

  /**
   * Writes the local records into a file the user can keep.
   *
   * The file goes into the app's documents directory, which the Files app
   * can see, and the share sheet sends it wherever the user wants.
   */
  async function exportBackup() {
    setBusy(true);
    try {
      const text = encodeBackup(library, settings, Date.now());
      const name = `hongguotv-${new Date().toISOString().slice(0, 10)}.hongguotv.json`;
      const path = await writeBackup(name, text);
      setMessage(`已导出到 ${name}`);
      await Share.share({ url: "file://" + path, message: name });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "本机记录暂时无法导出，请重试"
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Reads a backup and asks before the records are put back.
   *
   * The preview says what is in the backup, so the user can see what is
   * about to change. The playback settings and the shelf are not restored
   * unless the user ticks that - the same rule as the TV app.
   */
  async function askRestore(name: string) {
    setBusy(true);
    try {
      const text = await readBackup(`${Dirs.DocumentDir}/${name}`);
      const backup = decodeBackup(text);
      setBackupOpen(false);
      setPending({ kind: "restore", backup, name, withSettings: false });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "这个备份读不出来，请换一个"
      );
    } finally {
      setBusy(false);
    }
  }

  /** Puts a backup back together with what is on the device. */
  async function applyBackup(backup: BackupData, restoreSettings: boolean) {
    setBusy(true);
    try {
      const merged = mergeBackup(libraryRef.current, backup);
      libraryRef.current = merged;
      setLibrary(merged);
      await saveLibrary(merged);
      if (restoreSettings) {
        const next = { ...settings, ...settingsFromBackup(backup.settings) };
        setSettings(next);
        setCategory(next.category === "comic" ? "comic" : "short");
        setMaxQuality(next.maxQuality ?? 540);
        await saveSettings(next);
      }
      setMessage("记录已合并恢复");
      setBackups([]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "这个备份读不出来，请换一个"
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Asks whether there is a newer build.
   *
   * The app cannot install one by itself - an iOS app is installed by the
   * user - so it says what is there and opens the release page.
   */
  async function checkUpdate() {
    setUpdateState("正在检查更新…");
    try {
      const installed = await readInstalledVersion();
      const update = await checkForUpdate();
      if (!isNewer(update, installed.build)) {
        setUpdateState(`已是最新版本 ${installed.version}`);
        return;
      }
      setUpdateState(
        `发现新版 ${update.versionName}（build ${update.versionCode}）· 按此打开下载页`
      );
      setPendingUpdate(update);
    } catch (error) {
      setUpdateState(
        error instanceof Error ? error.message : "无法检查更新，请稍后重试"
      );
    }
  }

  /** Plays a show from the quick actions, at the place it was left. */
  function playSeries(series: Series) {
    setQuick(null);
    startShow(series);
  }

  /** Opens a show the user was watching and starts it where they left. */
  function resumeShow(series: Series) {
    startShow(series);
  }

  /**
   * Opens a show and starts it by itself.
   *
   * The flag is a ref and not a state, because the detail effect does not
   * run again when the same show is opened a second time - a state flag would
   * stay armed and start the *next* show by itself.
   */
  function startShow(series: Series) {
    setRestoreEpisode(undefined);
    setError("");
    const loaded = detail && detail.id === series.id ? detail : undefined;
    if (loaded) {
      const target = resumeTarget(loaded, libraryRef.current.progress[loaded.id]);
      setPlay({ detail: loaded, index: target.index, position: target.position });
      return;
    }
    autoPlayRef.current = true;
    setDetailId(series.id);
  }

  /**
   * Marks a favourite's new episodes as seen.
   *
   * The badge would otherwise say 「有 N 集更新」 for ever: the count only
   * grows, and nothing ever moved the mark up.
   */
  function acknowledgeUpdate(detail: Detail) {
    const count = detail.episodes.length;
    if (count <= 0) return;
    const previous = library.favoriteUpdates[detail.id];
    if (!previous) return;
    updateLibrary((old) => ({
      ...old,
      favoriteUpdates: {
        ...old.favoriteUpdates,
        [detail.id]: observeFavoriteUpdate(previous, count, Date.now(), true),
      },
    }));
  }
  const updateLibrary = useCallback((update: (old: Library) => Library) => {
    const next = update(libraryRef.current);
    libraryRef.current = next;
    setLibrary(next);
    saveLibrary(next).catch(() =>
      setMessage("观看记录保存失败，请检查电视存储空间")
    );
  }, []);
  const record = useCallback(
    (p: Progress) =>
      updateLibrary((old) => ({
        ...old,
        progress: Object.fromEntries(
          Object.entries({ ...old.progress, [p.series.id]: p })
            .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
            .slice(0, 200)
        ),
      })),
    [updateLibrary]
  );
  useEffect(() => {
    if (!detailId) return;
    let live = true;
    setDetail(undefined);
    setBusy(true);
    setError("");
    provider
      .detail(detailId)
      .then((value) => {
        if (!live) return;
        setDetail(value);
        // The show asked to start by itself, so it starts.
        if (autoPlayRef.current) {
          autoPlayRef.current = false;
          const target = resumeTarget(value, libraryRef.current.progress[value.id]);
          setPlay({ detail: value, index: target.index, position: target.position });
        }
        // The user has seen this show, so its update is acknowledged: the
        // badge would otherwise say "there are new episodes" for ever.
        acknowledgeUpdate(value);
        // The other seasons of the same show are looked up once the show
        // itself is known, and they are not worth an error of their own.
        setSeasonsState("loading");
        const finder = provider.seasons?.(value);
        if (!finder) {
          setSeasonsState("ready");
          return;
        }
        finder
          .then((rows) => {
            if (live) {
              setSeasons(rows);
              setSeasonsState("ready");
            }
          })
          .catch(() => {
            if (live) setSeasonsState("failed");
          });
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [detailId, provider, refresh]);
  function closeDetail() {
    setRestoreGrid(true);
    setDetailId("");
    setDetail(undefined);
    setError("");
  }
  function changeTab(next: Tab) {
    if (next === tab && !detailId) return;
    setRestoreGrid(!!positions.current[next].id);
    setTab(next);
    setDetailId("");
    setDetail(undefined);
    setError("");
  }
  useEffect(() => {
    if (play) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (detailId) {
        closeDetail();
        return true;
      }
      if (focusArea === "content") {
        grid.current?.top();
        setRestoreGrid(false);
        focusTV(nav.current.get(tab));
        setFocusArea("nav");
        return true;
      }
      if (tab !== "推荐" && settings.baseUrl) {
        changeTab("推荐");
        setRestoreGrid(false);
        requestAnimationFrame(() => focusTV(nav.current.get("推荐")));
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [detailId, tab, settings.baseUrl, play, focusArea]);
  function open(item: Series) {
    setRestoreEpisode(undefined);
    setError("");
    setDetailId(item.id);
  }
  const exitPlayer = useCallback(() => {
    setPlay(undefined);
    setRestoreEpisode(
      libraryRef.current.progress[play?.detail.id || ""]?.episodeId
    );
  }, [play]);
  async function connect() {
    setConnecting(true);
    setMessage("");
    try {
      const next = {
        baseUrl: normalizeBaseUrl(url),
        token: token.trim(),
        category,
        maxQuality,
      };
      await new BridgeProvider(next).health();
      await saveSettings(next);
      setSettings(next);
      setUrl(next.baseUrl);
      setMessage("服务连接成功");
      positions.current = Object.fromEntries(
        tabs.map((t) => [t, { index: 0 }])
      ) as Record<Tab, GridPosition>;
      changeTab("推荐");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "连接失败");
    } finally {
      setConnecting(false);
    }
  }
  async function changeCategory(cat: "short" | "comic") {
    setCategory(cat);
    // Keep the stored service address. The input field may still be empty
    // because the app works without a server at all.
    const next = { ...settings, category: cat };
    await saveSettings(next);
    setSettings(next);
  }
  async function changeQuality(value: number) {
    setMaxQuality(value);
    const next = { ...settings, maxQuality: value };
    await saveSettings(next);
    setSettings(next);
  }
  async function changePlaybackSpeed(value: number) {
    const next = { ...settings, playbackSpeed: value };
    await saveSettings(next);
    setSettings(next);
  }
  async function changeFrameMode(value: FrameMode) {
    const next = { ...settings, frameMode: value };
    await saveSettings(next);
    setSettings(next);
  }
  async function changeAutoNext(on: boolean) {
    const next = { ...settings, autoNext: on };
    await saveSettings(next);
    setSettings(next);
  }
  function favorite(series: Series) {
    updateLibrary((old) => ({
      ...old,
      favorites: old.favorites.some((i) => i.id === series.id)
        ? old.favorites.filter((i) => i.id !== series.id)
        : [series, ...old.favorites],
      // A show that is no longer a favourite has no update to report.
      favoriteUpdates:
        old.favorites.some((i) => i.id === series.id)
          ? Object.fromEntries(
              Object.entries(old.favoriteUpdates).filter(
                ([id]) => id !== series.id
              )
            )
          : old.favoriteUpdates,
    }));
  }

  /**
   * Looks at every favourite and remembers how many episodes it has.
   *
   * The site does not say "this show grew", the only sign is that the count
   * went up. The requests are serial, because the endpoint that answers this
   * app is sensitive about how often it is called, and a show that was
   * looked at within the hour is left alone.
   */
  async function checkFavorites(force = false) {
    if (checking) return;
    const now = Date.now();
    const due = library.favorites.filter(
      (series) => shouldCheck(library.favoriteUpdates[series.id], now, force)
    );
    if (due.length === 0) {
      setFavoriteStatus("收藏刚刚查过，没有新的集数");
      return;
    }
    setChecking(true);
    setFavoriteStatus(`正在检查 ${due.length} 部…`);
    const observed: Record<string, FavoriteUpdate> = {};
    let done = 0;
    let failed = 0;
    for (const series of due) {
      try {
        const detail = await provider.detail(series.id);
        const count = detail.episodes.length;
        if (count > 0) {
          const previous = library.favoriteUpdates[series.id];
          observed[series.id] = previous
            ? observeFavoriteUpdate(previous, count, now)
            : firstFavoriteUpdate(count, now);
        }
        done++;
      } catch {
        // A show that cannot be reached is left as it was.
        failed++;
      }
    }
    // Only the shows that were looked at are written back, and only the ones
    // that are still favourites: the user may have un-favourited something
    // while the check was running.
    updateLibrary((old) => {
      const favoriteIds = new Set(old.favorites.map((s) => s.id));
      const merged = { ...old.favoriteUpdates };
      for (const [id, update] of Object.entries(observed)) {
        if (favoriteIds.has(id)) merged[id] = update;
      }
      return { ...old, favoriteUpdates: merged };
    });
    setChecking(false);
    const withUpdates = Object.entries(observed).filter(
      ([id, update]) =>
        library.favorites.some((s) => s.id === id) && addedEpisodes(update) > 0
    ).length;
    setFavoriteStatus(
      failed > 0
        ? `已检查 ${done}/${due.length} 部，${failed} 部失败，可再试一次`
        : withUpdates > 0
        ? `已检查 ${done} 部，${withUpdates} 部有更新`
        : `已检查 ${done} 部，没有更新`
    );
  }
  function search() {
    positions.current["搜索"] = { index: 0 };
    setRestoreGrid(false);
    if (!query.trim()) {
      setSubmitted("");
      return;
    }
    setRestoreGrid(true);
    // The search is remembered, with the shelf it was made in: the same word
    // means different things in the two.
    updateLibrary((old) => ({
      ...old,
      searches: rememberSearch(old.searches, query, category),
    }));
    setSearchRun((n) => n + 1);
    if (submitted === query.trim()) void catalog.refresh();
    else setSubmitted(query.trim());
  }

  /** Runs a search that was remembered. */
  function runRemembered(entry: RecentSearch) {
    setHistoryOpen(false);
    setQuery(entry.query);
    // The search belongs to a shelf, so the shelf has to change with it -
    // the provider reads the setting, not the button on the settings page.
    // Both changes go in together: two separate ones would ask the site
    // twice, once with the old shelf and once with the new.
    const next = { ...settings, category: entry.type };
    setSettings(next);
    setCategory(entry.type);
    if (entry.type !== settings.category) {
      void saveSettings(next).catch(() =>
        setMessage("分类设置保存失败，请重试")
      );
    }
    // The grid starts at the top, the same way a typed search does.
    positions.current["搜索"] = { index: 0 };
    setSubmitted(entry.query);
    setRestoreGrid(true);
    setSearchRun((n) => n + 1);
    if (submitted === entry.query) void catalog.refresh();
  }
  if (!ready)
    return (
      <View style={s.root}>
        <Notice message="正在加载…" busy />
      </View>
    );
  if (play)
    return (
      <View style={s.root}>
        <StatusBar hidden />
        <Player
          key={play.detail.id + ":" + play.index + ":" + play.position}
          detail={play.detail}
          initialIndex={play.index}
          initialPosition={play.position}
          provider={provider}
          onExit={exitPlayer}
          onProgress={record}
          maxQuality={maxQuality}
          playbackSpeed={settings.playbackSpeed ?? 1}
          frameMode={settings.frameMode ?? "fit"}
          autoNext={settings.autoNext ?? true}
          onChangeSpeed={(value) => void changePlaybackSpeed(value)}
          onChangeFrameMode={(value) => void changeFrameMode(value)}
          onTryLowerQuality={() => {
            void changeQuality(720).catch(() =>
              setMessage("清晰度设置保存失败，请重试")
            );
          }}
          test={play.test}
        />
      </View>
    );
  const recent = Object.values(library.progress).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  const shown =
    tab === "收藏"
      ? library.favorites.map((series) => {
          const added = addedEpisodes(library.favoriteUpdates[series.id] || {
            total: 0,
            seen: 0,
            checkedAt: 0,
          });
          return {
            ...series,
            badge: added > 0 ? `有 ${added} 集更新` : series.badge,
          };
        })
      : tab === "最近观看"
      ? recent.map((p) => ({
          ...p.series,
          badge: library.watched.includes(p.series.id)
            ? "整剧已看完"
            : `第 ${p.episodeNumber} 集 · ${
                p.completed ? "已看完" : Math.floor(p.position / 60) + " 分钟"
              }`,
        }))
      : tab === "排行榜"
      ? ranking.items.map((item) => ({
          ...item,
          // On a board the line under the poster is the heat, not the
          // episode count.
          badge: ranking.positions[item.id]?.heat || "热度暂无",
        }))
      : catalog.items.filter((item) => !library.hidden.includes(item.id));
  const shelfLabel = category === "short" ? "真人剧" : "漫剧";
  // The watch later list, the way the TV app keeps it.
  const later = library.later;
  // The shelves of the home page: what the user was watching, what grew, and
  // what they set aside.
  //
  // A finished episode is not filtered out: the app resumes at the next one,
  // so the show is exactly the one the user wants back. What is filtered out
  // is a show the user marked as watched through - that one is done with.
  const resumeShelf = recent
    .filter((p) => !library.watched.includes(p.series.id))
    .slice(0, 8)
    .map((p) => ({
      ...p.series,
      badge: `第 ${p.episodeNumber} 集 · ${
        p.completed ? "接着看下一集" : `${Math.floor(p.position / 60)} 分钟`
      }`,
    }));
  const updatedShelf = library.favorites
    .filter(
      (series) =>
        addedEpisodes(
          library.favoriteUpdates[series.id] || {
            total: 0,
            seen: 0,
            checkedAt: 0,
          }
        ) > 0
    )
    .slice(0, 8);
  // The walk is done when every catalogue reached its final page.
  const catalogueComplete = catalogue.done.length >= CATALOGUE_ROUTES.length;
  /**
   * The dialog for whatever the user has to agree to.
   *
   * It is built here and not stored, so the action always sees the state as
   * it is when the button is pressed - the checkbox in the restore preview
   * included.
   */
  const confirmRequest: ConfirmRequest | null = !pending
    ? null
    : pending.kind === "remove-record"
    ? {
        title: "删除观看记录",
        body: `删除《${pending.title}》的本机观看进度？收藏会保留。`,
        onOk: () => {
          removeProgress(pending.id);
          setPending(null);
        },
      }
    : pending.kind === "clear-searches"
    ? {
        title: "清空搜索历史",
        body: "清除本机保存的搜索词？",
        onOk: () => {
          updateLibrary(clearSearches);
          setPending(null);
        },
      }
    : pending.kind === "clear-history"
    ? {
        title: "清空观看记录",
        body: "将删除本机所有观看进度，收藏会保留。",
        onOk: () => {
          updateLibrary(clearHistory);
          setPending(null);
        },
      }
    : {
        title: "确认恢复本机记录",
        body: describeBackup(pending.backup),
        okLabel: "合并恢复",
        extra: (
          <Check
            label="同时恢复播放设置和内容分类"
            checked={pending.withSettings}
            onToggle={() =>
              setPending({ ...pending, withSettings: !pending.withSettings })
            }
          />
        ),
        onOk: () => {
          const { backup, withSettings } = pending;
          setPending(null);
          void applyBackup(backup, withSettings);
        },
      };
  return (
    <View
      style={[
        s.root,
        {
          paddingHorizontal: inset.horizontal,
          paddingVertical: inset.vertical,
        },
      ]}
    >
      <StatusBar hidden />
      <View style={s.header}>
        <Text style={s.brand}>红果 TV</Text>
        {!detailId ? (
          <View style={s.nav}>
            {tabs.map((t) => (
              <Button
                key={t}
                label={t}
                primary={tab === t}
                ref={(node) => {
                  if (node) nav.current.set(t, node);
                  else nav.current.delete(t);
                }}
                preferred={t === tab && !restoreGrid}
                onFocus={() => setFocusArea("nav")}
                onPress={() => changeTab(t)}
              />
            ))}
          </View>
        ) : (
          <Text style={s.muted}>剧集详情 · 返回键回到列表</Text>
        )}
      </View>
      {detailId ? (
        busy ? (
          <Notice message="正在加载剧集…" busy />
        ) : error ? (
          <Notice message={error} retry={() => setRefresh((n) => n + 1)} />
        ) : (
          detail && (
            <DetailTV
              key={detail.id}
              detail={detail}
              progress={library.progress[detail.id]}
              restoreEpisode={restoreEpisode}
              favorite={library.favorites.some((i) => i.id === detail.id)}
              onFavorite={() => {
                const { episodes: _, ...series } = detail;
                favorite(series);
              }}
              onPlay={(index, position) => setPlay({ detail, index, position })}
              onOpenSeries={(series) => {
                setRestoreEpisode(undefined);
                setError("");
                setDetailId(series.id);
              }}
              seasons={seasons}
              seasonsState={seasonsState}
            />
          )
        )
      ) : tab === "设置" ? (
        <ScrollView
          contentContainerStyle={s.settings}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.heroTitle}>红果 TV</Text>
          <Text style={s.description}>
            直接调用红果接口，无需额外服务器。也可连接自建内容服务。
          </Text>
          <Text style={s.label}>内容分类</Text>
          <View style={s.row}>
            <Button
              label="真人剧"
              primary={category === "short"}
              onPress={() => changeCategory("short")}
            />
            <Button
              label="漫剧"
              primary={category === "comic"}
              onPress={() => changeCategory("comic")}
            />
          </View>
          <Text style={[s.description, { marginTop: 8 }]}>
            清晰度越高，下载和解密的等待越久；网络较慢时可选 360P。
          </Text>
          <Text style={s.label}>清晰度</Text>
          <View style={s.row}>
            {[360, 540, 720, 1080].map((q) => (
              <Button
                key={q}
                label={`${q}P`}
                primary={maxQuality === q}
                onPress={() => changeQuality(q)}
              />
            ))}
          </View>
          <Text style={s.label}>默认倍速</Text>
          <View style={s.row}>
            {PLAYBACK_SPEEDS.map((value) => (
              <Button
                key={value}
                label={speedLabel(value)}
                primary={(settings.playbackSpeed ?? 1) === value}
                onPress={() => changePlaybackSpeed(value)}
              />
            ))}
          </View>
          <Text style={s.label}>画面模式</Text>
          <View style={s.row}>
            {FRAME_MODES.map((entry) => (
              <Button
                key={entry.mode}
                label={entry.label}
                primary={(settings.frameMode ?? "fit") === entry.mode}
                onPress={() => changeFrameMode(entry.mode)}
              />
            ))}
          </View>
          <Text style={[s.description, { marginTop: 8 }]}>
            {frameModeInfo(settings.frameMode ?? "fit").hint}。
          </Text>
          <Text style={s.label}>自动连播</Text>
          <View style={s.row}>
            <Button
              label="开启"
              primary={(settings.autoNext ?? true) === true}
              onPress={() => changeAutoNext(true)}
            />
            <Button
              label="关闭"
              primary={(settings.autoNext ?? true) === false}
              onPress={() => changeAutoNext(false)}
            />
          </View>
          <Text style={[s.description, { marginTop: 8 }]}>
            以下为可选：连接自建内容服务。
          </Text>
          <Text style={s.label}>服务地址</Text>
          <TextInput
            accessibilityLabel="服务地址"
            onFocus={() => (setEditing("url"), setFocusArea("content"))}
            onBlur={() => setEditing(undefined)}
            onSubmitEditing={connect}
            returnKeyType="done"
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.10:8787"
            placeholderTextColor="#747383"
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              s.input,
              editing === "url" && { borderColor: palette.accent },
            ]}
          />
          <Text style={s.label}>访问口令（服务未设置时留空）</Text>
          <TextInput
            accessibilityLabel="访问口令"
            onFocus={() => (setEditing("token"), setFocusArea("content"))}
            onBlur={() => setEditing(undefined)}
            onSubmitEditing={connect}
            returnKeyType="done"
            value={token}
            onChangeText={setToken}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              s.input,
              editing === "token" && { borderColor: palette.accent },
            ]}
          />
          <View style={s.row}>
            <Button
              label={connecting ? "正在连接…" : "连接并保存"}
              disabled={connecting}
              primary
              onPress={connect}
            />
            <Button
              label="测试播放器"
              onPress={() =>
                setPlay({ detail: sample, index: 0, position: 0, test: true })
              }
            />
          </View>
          <Text style={s.label}>片库</Text>
          <View style={s.row}>
            <Button
              label={`恢复隐藏推荐 · ${library.hidden.length} 部`}
              disabled={library.hidden.length === 0}
              onPress={() => {
                updateLibrary((old) => ({ ...old, hidden: [] }));
                setMessage("热门推荐已恢复");
              }}
            />
          </View>
          <Text style={s.label}>关于</Text>
          <View style={s.row}>
            <Button
              label={appVersion ? `版本与更新 · ${appVersion}` : "版本与更新"}
              onFocus={() => setFocusArea("content")}
              onPress={() => void checkUpdate()}
            />
            {pendingUpdate ? (
              <Button
                label={`下载 ${pendingUpdate.versionName}`}
                primary
                onPress={() => {
                  void Linking.openURL(releasePage(pendingUpdate.tag));
                }}
              />
            ) : null}
            <Button
              label="开源许可"
              onFocus={() => setFocusArea("content")}
              onPress={() =>
                setInfo({ title: "开源许可", body: licenseNotice() })
              }
            />
          </View>
          {updateState ? (
            <Text accessibilityLiveRegion="polite" style={s.feedback}>
              {updateState}
            </Text>
          ) : null}
          <Text style={s.label}>备份与恢复</Text>          <View style={s.row}>
            <Button
              label={busy ? "正在处理…" : "备份本机记录"}
              disabled={busy}
              onPress={() => void exportBackup()}
            />
            <Button
              label={backups.length ? `恢复（${backups.length}）` : "从备份恢复"}
              disabled={busy || backups.length === 0}
              onPress={() => {
                if (backups.length === 1) {
                  void askRestore(backups[0]);
                  return;
                }
                setBackupOpen((open) => !open);
              }}
            />
          </View>
          {backupOpen && backups.length > 1 ? (
            <View style={[s.row, { marginTop: 10 }]}>
              {backups.map((name) => (
                <Button
                  key={name}
                  label={name.replace(".hongguotv.json", "")}
                  onPress={() => void askRestore(name)}
                />
              ))}
            </View>
          ) : null}
          <Text style={[s.description, { marginTop: 8 }]}>
            备份是一个 json 文件，放在本 App 的「文件」目录里，可以用「文件」App 取走或放回。
            格式和电视端一样，两边的备份通用。恢复是合并：已有的收藏排在前面，只有更新的观看进度才会替换本机的。
          </Text>
          {!!message && (
            <Text accessibilityLiveRegion="polite" style={s.feedback}>
              {message}
            </Text>
          )}
          <Text style={s.note}>
            测试播放器使用 Blender 的 Big Buck Bunny
            公开样片。此测试不代表红果内容可用。{"\n"}
            收藏和观看记录仅保存在当前设备。{"\n"}本应用为个人非官方客户端。
          </Text>
        </ScrollView>
      ) : (
        <>
          {tab === "搜索" ? (
            <>
              <View style={s.search}>
                <TextInput
                  accessibilityLabel="搜索短剧"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="输入剧名或关键词（当前片库全量）"
                  placeholderTextColor="#747383"
                  onFocus={() => {
                    setEditing("search");
                    setFocusArea("content");
                  }}
                  onBlur={() => setEditing(undefined)}
                  onSubmitEditing={search}
                  returnKeyType="search"
                  style={[
                    s.input,
                    { flex: 1 },
                    editing === "search" && { borderColor: palette.accent },
                  ]}
                />
                <Button
                  label="搜索"
                  primary
                  onFocus={() => setFocusArea("content")}
                  onPress={search}
                />
                <Button
                  label="历史"
                  onFocus={() => setFocusArea("content")}
                  onPress={() => setHistoryOpen((open) => !open)}
                />
              </View>
              {historyOpen ? (
                <ScrollView
                  style={s.historyScroll}
                  contentContainerStyle={s.history}
                  keyboardShouldPersistTaps="handled"
                >
                  {library.searches.length === 0 ? (
                    <Text style={s.muted}>
                      搜索过的剧名会保存在这里，最多 20 条。
                    </Text>
                  ) : (
                    <>
                      <View style={s.row}>
                        {library.searches.map((entry) => (
                          <Button
                            key={`${entry.type}:${entry.query}`}
                            label={`${entry.type === "comic" ? "漫剧" : "真人剧"} · ${entry.query}`}
                            onFocus={() => setFocusArea("content")}
                            onPress={() => {
                              setHistoryOpen(false);
                              runRemembered(entry);
                            }}
                          />
                        ))}
                      </View>
                      <Button
                        label="清空历史"
                        onFocus={() => setFocusArea("content")}
                        onPress={() =>
                          setPending({ kind: "clear-searches" })
                        }
                      />
                    </>
                  )}
                </ScrollView>
              ) : null}
              <View style={s.heading}>
                <Text style={s.muted}>
                  {submitted
                    ? `站内找到 ${catalog.matchedCount} 部${
                        catalog.fuzzy ? "（按相近剧名找到）" : ""
                      }`
                    : walk.running
                    ? `正在建立片库索引 · 已收录 ${walk.total} 部`
                    : catalogue.entries.length
                    ? `片库共 ${catalogue.entries.length} 部${
                        walk.gaps ? `，有 ${walk.gaps} 页没抓到` : ""
                      }`
                    : "片库索引还没建立，搜索只能用到站方的十条"}
                </Text>
                <Button
                  label={
                    walk.running
                      ? "正在建立…"
                      : catalogueComplete
                      ? "更新索引"
                      : "续建索引"
                  }
                  disabled={walk.running}
                  onFocus={() => setFocusArea("content")}
                  onPress={() => void startWalk(catalogueComplete)}
                />
              </View>
            </>
          ) : tab === "排行榜" ? (
            <>
              <View style={s.heading}>
                <Text style={s.section}>{shelfLabel}热播榜</Text>
                <Button
                  label="刷新榜单"
                  onFocus={() => setFocusArea("content")}
                  onPress={ranking.refresh}
                />
              </View>
              <Text style={[s.muted, { marginBottom: 8 }]}>
                {ranking.busy
                  ? "正在读取最新榜单…"
                  : ranking.updatedText ||
                    `来源：红果${shelfLabel}热播榜`}
              </Text>
            </>
          ) : tab === "收藏" ? (
            <>
              <View style={s.heading}>
                <Text style={s.section}>我的收藏</Text>
                <Button
                  label={checking ? "正在检查…" : "检查更新"}
                  disabled={checking || library.favorites.length === 0}
                  onFocus={() => setFocusArea("content")}
                  onPress={() => void checkFavorites(true)}
                />
              </View>
              {favoriteStatus ? (
                <Text style={[s.muted, { marginBottom: 8 }]}>
                  {favoriteStatus}
                </Text>
              ) : null}
            </>
          ) : (
            <View style={s.heading}>
              <Text style={s.section}>{tab === "推荐" ? "今日热播" : tab}</Text>
              {tab === "推荐" && recent[0] ? (
                <Button
                  label={`续看：${recent[0].series.title.slice(0, 8)} · 第${
                    recent[0].episodeNumber
                  }集`}
                  onFocus={() => setFocusArea("content")}
                  onPress={() => open(recent[0].series)}
                />
              ) : (
                <View style={s.row}>
                  <Text style={s.muted}>{shown.length} 部短剧</Text>
                  {tab === "最近观看" && recent.length > 0 ? (
                    <Button
                      label="清空记录"
                      onFocus={() => setFocusArea("content")}
                      onPress={() => setPending({ kind: "clear-history" })}
                    />
                  ) : null}
                </View>
              )}
            </View>
          )}
          {
            <TVGrid
              key={
                tab + ":" + (tab === "搜索" ? submitted + ":" + searchRun : "")
              }
              ref={grid}
              items={shown}
              width={width - inset.horizontal * 2}
              position={positions.current[tab]}
              restore={restoreGrid}
              onFocus={() => setFocusArea("content")}
              onOpen={open}
              onLongPress={setQuick}
              busy={
                tab === "排行榜"
                  ? ranking.busy
                  : ["推荐", "搜索"].includes(tab) && catalog.busy
              }
              error={
                tab === "排行榜"
                  ? ranking.error
                  : ["推荐", "搜索"].includes(tab)
                  ? catalog.error
                  : undefined
              }
              more={tab === "排行榜" ? ranking.more : catalog.more}
              loadMore={
                tab === "排行榜"
                  ? ranking.loadMore
                  : ["推荐", "搜索"].includes(tab) &&
                    (tab !== "搜索" || !!submitted)
                  ? catalog.loadMore
                  : undefined
              }
              positions={tab === "排行榜" ? ranking.positions : undefined}
              header={
                tab === "推荐" ? (
                  <>
                    <Shelf
                      title="接着看"
                      items={resumeShelf}
                      onOpen={resumeShow}
                      onLongPress={setQuick}
                      onFocus={() => setFocusArea("content")}
                    />
                    <Shelf
                      title="收藏有更新"
                      items={updatedShelf}
                      onOpen={open}
                      onLongPress={setQuick}
                      onFocus={() => setFocusArea("content")}
                    />
                    <Shelf
                      title="稍后看"
                      items={later}
                      onOpen={open}
                      onLongPress={setQuick}
                      onFocus={() => setFocusArea("content")}
                    />
                  </>
                ) : null
              }
              empty={
                tab === "搜索"
                  ? submitted
                    ? "没有找到相关短剧，换个关键词试试"
                    : "输入关键词，发现下一部好剧"
                  : tab === "收藏"
                  ? "收藏喜欢的短剧，下次接着看"
                  : tab === "最近观看"
                  ? "开始播放后，这里会留下观看记录"
                  : tab === "排行榜"
                  ? "热播榜暂时取不到，稍后再试"
                  : "暂无内容"
              }
            />
          }
        </>
      )}
      {quick ? (
        <View style={s.quickBackdrop}>
          <View style={s.quickPanel}>
            <Text style={s.quickTitle} numberOfLines={2}>
              {quick.title}
            </Text>
            <View style={s.quickActions}>
              {tab === "最近观看" ? (
                <>
                  <Button
                    label="继续观看"
                    primary
                    onPress={() => playSeries(quick)}
                  />
                  <Button
                    label={
                      library.watched.includes(quick.id)
                        ? "恢复未看状态"
                        : "标记整剧已看"
                    }
                    onPress={() => {
                      const id = quick.id;
                      setWatched(id, !library.watched.includes(id));
                      setQuick(null);
                    }}
                  />
                  <Button
                    label="删除这条记录"
                    onPress={() => {
                      const target = quick;
                      setQuick(null);
                      setPending({
                        kind: "remove-record",
                        id: target.id,
                        title: target.title,
                      });
                    }}
                  />
                </>
              ) : (
                <>
                  <Button
                    label={
                      library.progress[quick.id] ? "继续观看" : "直接播放"
                    }
                    primary
                    onPress={() => playSeries(quick)}
                  />
                  <Button
                    label={
                      library.favorites.some((i) => i.id === quick.id)
                        ? "取消收藏"
                        : "收藏这部剧"
                    }
                    onPress={() => {
                      favorite(quick);
                      setQuick(null);
                    }}
                  />
                  <Button
                    label={
                      library.later.some((i) => i.id === quick.id)
                        ? "移出稍后看"
                        : "加入稍后看"
                    }
                    onPress={() => {
                      const target = quick;
                      updateLibrary((old) => ({
                        ...old,
                        later: (
                          old.later.some((i) => i.id === target.id)
                            ? old.later.filter((i) => i.id !== target.id)
                            : [target, ...old.later]
                        ).slice(0, 100),
                      }));
                      setQuick(null);
                    }}
                  />
                </>
              )}
              <Button
                label="查看剧集详情"
                onPress={() => {
                  const target = quick;
                  setQuick(null);
                  open(target);
                }}
              />
              {tab === "推荐" ? (
                <Button
                  label="不在热门推荐中显示"
                  onPress={() => {
                    const id = quick.id;
                    updateLibrary((old) => ({
                      ...old,
                      hidden: Array.from(new Set([...old.hidden, id])).slice(-500),
                    }));
                    setQuick(null);
                    setMessage("已从热门推荐中隐藏，可在设置里恢复");
                  }}
                />
              ) : null}
              <Button label="取消" onPress={() => setQuick(null)} />
            </View>
          </View>
        </View>
      ) : null}
      <Confirm
        request={confirmRequest}
        onClose={() => setPending(null)}
      />
      <Info
        title={info?.title || ""}
        body={info?.body || ""}
        onClose={() => setInfo(null)}
      />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    marginBottom: 12,
  },
  brand: { color: palette.accent, fontSize: 23, fontWeight: "800" },
  nav: { flexDirection: "row", gap: 8, flex: 1 },
  muted: { color: palette.muted, fontSize: 15 },
  quickBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000C0",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  quickPanel: {
    backgroundColor: palette.panel,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    maxWidth: 560,
  },
  quickTitle: { color: palette.text, fontSize: 20, fontWeight: "600" },
  quickActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  history: { gap: 10, marginBottom: 10 },
  historyScroll: { maxHeight: 150 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    marginBottom: 8,
    paddingHorizontal: 6,
  },
  section: { color: palette.text, fontSize: 21, fontWeight: "700" },
  heroTitle: { color: palette.text, fontSize: 26, fontWeight: "700" },
  description: { color: palette.muted, fontSize: 17, lineHeight: 25 },
  settings: { padding: 6, gap: 12, paddingBottom: 24 },
  label: { color: palette.text, fontSize: 17 },
  input: {
    color: palette.text,
    fontSize: 18,
    borderWidth: 2,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: palette.panel,
  },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  search: { flexDirection: "row", gap: 12, marginBottom: 12 },
  feedback: { color: palette.accent, fontSize: 17 },
  note: { color: palette.muted, fontSize: 15, lineHeight: 24, marginTop: 8 },
});
