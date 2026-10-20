# HongguoTV iOS

红果 TV iOS 版（React Native 0.81.5），支持 iPhone / iPad。

直接调用红果接口，不需要中间服务器。

## 构建

本项目使用 GitHub Actions 自动构建未签名 `.ipa`，可配合 [Sideloadly](https://sideloadly.io) 或 [AltStore](https://altstore.io) 安装到真机。

构建产物在每次 CI 运行结束后通过 Artifacts 下载。

CI 在编译前会先做三道检查：源码按 Metro 使用的 Babel 预设解析一遍、TypeScript 类型检查、离线验证套件（签名、加密、base64、媒体密钥、CENC 解析器、重试行为）。这几步只要十几秒，能省下八分钟的 xcodebuild。

## 播放

红果的签名播放器返回的是 CENC 加密的 MP4，iOS 自己解不了，AVPlayer 也读不了 `data:` / `blob:`。所以 App 会：

1. 用原生下载把加密的 MP4 存到本地（不经过 JS 桥传输文件内容）；
2. 读文件头，把 `encv` 改回 `hvc1`、`sinf` 改成 `free`；
3. 用 AES-CTR 逐样本解密；
4. 写成普通 MP4，用 `file://` 交给播放器。

整个过程按 512 KB 分块进行，内存占用与视频大小无关。文件按「剧集 + 清晰度」缓存在应用缓存目录里，重看时直接复用。

缓存有上限：最多 256 MB 或 16 集，超了就从最旧的一集开始删（正在播的那一集永远不删）。不然看完一整部 86 集的剧，缓存就是 1 GB 上下。

清晰度在「设置」里选（360P / 540P / 720P / 1080P），默认 540P。1080P 的一集约 13 MB，网络慢时优先选 360P。

**下一集会在本集快结束时提前下载**（剩 30 秒时开始，倍速也算在内），所以自动连播时不用等下载解密。规则和电视端 `PrefetchPolicy.kt` 一致。

## 热播榜

顶部有「排行榜」标签页，跟着内容分类走：真人剧看真人剧榜，漫剧看漫剧榜（站方的漫剧榜和 AI 剧榜合成一个）。海报左上角是名次，前三名用强调色，底部一行是热度。

榜单数据在站点的延迟加载调用里（`data-fn-args` 属性）。但**有 42% 的响应只给渲染好的卡片、不给延迟数据**（2026-10-19 实测 12 次里 5 次），所以两条路都读了：延迟数据优先，卡片兜底。两条路在真实页面上给出的结果完全一致（20 部、5 页、名次 1/21/41、热度相同）。

热度按数值排序，跨榜单合并后重新编号（站方的名次是各榜各算的，两个榜放一页会同时出现两个「第 1 名」）。读不出热度的那一行排在最后，不猜数字。

## 同系列剧

详情页下面有「同系列剧」区块，列出同一部剧的其它季度，点进去直接换剧。

服务端没有任何接口能说明两部剧是同一部：所有 `/novel/series/` 路径都 404，公开详情页没有剧集字段，参考 APK 里也没有 `season` 字符串。每个季度就是一部独立的剧，区别只在标题里的季号。

所以只能从标题反推：拿去掉季号的标题去搜，只留下去掉季号后**完全一样**的那些。故意保守 —— 「变废为宝…」和「捡废为宝…」是两部不同的剧，两部都有第二季，模糊匹配会把它们错并到一起。

季号支持阿拉伯数字和中文数字（「第七季」「第一百零二季」），解析规则和电视端 `ContentRepository.seasonNumber` 一致，`scripts/verify-seasons.js` 逐条对照。

## 备份与恢复

设置页里可以**备份本机记录**和**从备份恢复**。备份是一个 json 文件，放在本 App 的「文件」目录里（「文件」App 能看到，也能取走或放回），备份完可以直接用分享面板发出去。

**格式和电视端一样，两边的备份通用。** 令牌不出设备。恢复是**合并**：已有的收藏排在前面，只有更新的观看进度才会替换本机的（拿一个旧备份回来不会把已经看到一半的进度冲掉）。

恢复之前会先弹一个确认框，写清楚这个备份里有什么（几部收藏、几条观看记录、几条搜索、几部稍后看、几部已隐藏推荐）和合并的规则。**播放设置和内容分类默认不跟着恢复**，要恢复得自己勾 —— 换台设备时不希望把上一台的倍速也带过来。

## 会先问一句

会丢东西的操作一律先问一句，跟电视端一样，弹窗里**「取消」排在前面**（电视端还会把焦点停在「取消」上），误按不会把记录弄丢：

- 删除一条观看记录（「删除观看记录」/「删除《X》的本机观看进度？收藏会保留。」）
- 清空搜索历史（「清空搜索历史」/「清除本机保存的搜索词？」）
- 清空全部观看记录（「将删除本机所有观看进度，收藏会保留。」）

删掉一条观看记录时，它那条「整剧已看完」的标记也跟着走 —— 留着的话下次打开这部剧会显示成已经看完。「清空全部观看记录」在「最近观看」页的标题右边，收藏、稍后看、隐藏推荐和搜索历史都不动。

规则和电视端 `LibraryIndex.removeHistory` / `clearHistory` 一致，`scripts/verify-history.js` 逐条对照。

弹窗本身也是测的：用一个小的 React 替身（`scripts/fixtures/react-shim.js`）把弹窗真的渲染出来、真的按下去，验它**第二次打开时按钮还是好的** —— 这条是补上的：弹窗原来常驻挂载，第一次按「确认」之后「已经做过」的标志就留在了组件里，之后每个弹窗的两个按钮都是禁用的，而在 iOS 上这个弹窗退不出去。

现在这个标志是**从请求派生**的，而且**弹窗一关就清掉**：新请求必然是新弹窗，同一个请求再打开一次也是新弹窗。套件把这三种情况都验了（改回去就会变红）。

设置页还有「开源许可」，列出 App 自己的条款（GPL-3.0）、内容协议和加密处理移植自 drpys 的出处，以及**每一个**直接依赖的许可证。`scripts/verify-history.js` 会读 `package.json`，所以以后加了依赖却忘了写进这个页面，测试会失败。

## 长按卡片

在列表里长按一部剧，会弹出快捷操作：**直接播放 / 继续观看**、**收藏这部剧 / 取消收藏**、**加入稍后看 / 移出稍后看**、**查看剧集详情**。

在「最近观看」里长按是另一套：**继续观看**、**标记整剧已看 / 恢复未看状态**、**删除这条记录**（收藏会保留，删之前会先问一句）。标了「整剧已看完」的剧会从首页的「接着看」里消失。

在「推荐」里长按多一项：**不在热门推荐中显示**。设置页有「恢复隐藏推荐」。

首页顶部是三排货架（和电视端一个节奏）：**接着看**（最近在看的，卡片上写着停在哪一集）、**收藏有更新**（集数变多的）、**稍后看**。货架是网格的表头，会跟着一起往上滚，所以下面就是今日热播的网格——和电视端一样是一屏竖向滚动。

## 搜索

站方的搜索页**只给十条**，而且忽略十七种翻页参数 —— 十条是站方的上限，不是客户端的短板（Android 那边也测到过同样的结论）。

但站方的**片库目录**是能翻的：三条目录各 34 页 × 24 行，共 2400 部。App 会在后台把目录走一遍存到本地，搜索就以本地索引为主，站方那十条只用来补位。

- 搜索框下面写着索引的进度：已收录多少部、有没有页没抓到。
- 走查被打断（退出 App、页面超时）不会从头再来：游标存着，下次接着走。
- 走查是串行请求 —— 并发只换来速度，换来被限流。
- 播放时走查会停，播放比走查更需要网络。

排序是分级的，不是「包含就算」：完全相同 → 前缀匹配 → 包含 → 标签命中（「总裁」是《雾锁情迷》的标签，标题里没有）。

打错字也有兜底：字面没结果时才启用，而且**只对四个字以上的词**——两个字错一个字就是另一个词，给一个自信的错误答案比给一个空页面糟得多。兜底找到的会标出来「按相近剧名找到」。

规则和电视端一致（`CatalogueIndex.kt`），`scripts/verify-catalogue.js` 把 Kotlin 自己的测试用例逐条搬过来验。

## 收藏有更新

收藏页有「检查更新」按钮：逐部查一遍收藏的剧，比对集数有没有变。变了的会标成「有 N 集更新」。

站方不会说「这部剧多了三集」，唯一的信号是集数变多了，所以看的是**水位线**——目录临时缩水不算更新，而且水位线只涨不跌。一部剧最多一小时查一次（站方对这个接口的调用频率敏感），请求是串行的。

规则和电视端 `FavoriteUpdate` 一致，`scripts/verify-favorites.js` 用 Kotlin 的逐行转写整个验一遍。

搜索页有「历史」按钮，记住最近 20 条搜索。**同一个词在不同分类下是两条不同的记录** ——「都市」在漫剧里和在真人剧里不是一回事。

## 版本与更新

设置页有「版本与更新」。打一个 `ios-v*` 的 tag，CI 会把这一版**发布成 release**，并附上一份清单（`update.json`）;App 读的是最新 release 的那份清单，所以「有没有新版」这件事不用问站方。

App 读自己的 `Info.plist` 拿版本号，不用在两处各写一份。清单格式和电视端一样，两边互相认得。

iOS 的包得用户自己装，所以 App 只报「发现新版 X」并打开下载页，不自己装。

## 播放设置

播放器面板里有「播放设置」二级面板，设置页里也能改默认值：

- **倍速** 0.75× / 1× / 1.25× / 1.5× / 1.75× / 2×
- **画面模式** 完整画面（保留比例与全部内容）/ 等比铺满（会裁掉部分画面与字幕）/ 拉伸铺满（比例会变）
- **定时停止** 15 / 30 / 60 / 90 分钟，或再播完 1 / 3 / 5 集
- **从头播放**
- **自动连播** 开关

定时停止跑在自己的时钟上，和倍速无关；到点后停在原处，观看位置照常保存。

规则和电视端一致（`PlaybackSpeed.kt` / `PlaybackComfort.kt`），`scripts/verify-playback.js` 用 Kotlin 的逐行转写把定时器整个验一遍。

## 播放失败时

跟电视端一样，播放失败会自己重试：最多 3 次，间隔 1 秒、2.5 秒、5 秒，观看位置保留。只有用户手动重试才会把次数清零。

- 失败页上有「立即重试」「尝试 720P」「返回选集」「停止自动重试」四个按钮。
- 换回前台时如果还在失败状态，会立刻再试一次，不用等完整个延迟。
- 「这集没有视频」这种是事实的失败不重试 —— 重试只是浪费用户时间。

自动重试的时序和预算在 `src/data/recovery.ts` 里，`scripts/verify-recovery.js` 用假时钟把它整个验一遍。

## 为什么会闪退：原生侧挂载的模块名

原生侧启动时按名字挂载根视图，JS 侧按名字注册 App，两个名字必须一样。

`ios/HongguoTV/AppDelegate.swift` 写的是 `withModuleName: "HongguoTVTemp"`，而 `app.json` 里 `name` 是 `HongguoTV`，`index.js` 注册的也是后者。两边对不上时，`AppRegistry` 的 `invariant` 会抛 `"HongguoTVTemp" has not been registered`，RN 在生产环境把它升级成 `RCTFatal`（`RCTAssert.h` 里写明这些调用在生产环境不会被编掉、默认就让 App 崩），进程直接被终止 —— **点开就闪退，屏幕上什么也没有**。

同一个名字散在三个文件里，所以 `scripts/verify-ios-app.js` 把它们对着查：原生挂载的名字 = `app.json` 的 `name` = `PRODUCT_NAME`；`PRODUCT_BUNDLE_IDENTIFIER` 展开后 = `src/data/updates.ts` 里的 `PACKAGE_NAME`（更新清单要靠它认出这是哪个 App）；`CFBundleDisplayName` = `app.json` 的 `displayName`；`UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` 必须开着（备份文件要靠它们才能在「文件」App 里进出）；站点是 https 时 `NSAllowsArbitraryLoads` 才能是 false。

## 开发

```bash
npm install
cd ios && pod install && cd ..
npx react-native start
```

## 验证脚本

离线套件（不联网、不需要 ffmpeg，CI 每次都跑）：

```bash
npm run check        # 解析 + 类型检查 + 全部离线套件
```

| 脚本 | 验什么 | 对照组 |
| --- | --- | --- |
| `verify-ios-app.js` | 原生挂载的模块名、bundle id、图标名、文件共享开关、传输安全策略 | `app.json` + `AppDelegate.swift` + `Info.plist` + `project.pbxproj` |
| `verify-signer.js` | MD5 / SM3 哈希 | `node:crypto` |
| `verify-crypto.js` | AES-128/192/256、CBC、CTR、SHA-512 | `node:crypto` |
| `verify-base64.js` | base64 编解码 | Node `Buffer` |
| `verify-mediacrypto.js` | `key_seed` 解密播放地址、`spade_a` 派生内容密钥 | `MediaCrypto.kt` 的逐行独立转写 + 20 组真实响应 |
| `verify-cenc-unit.js` | `stco`/`co64`、`saio` v0/v1、子样本加密、双轨 | `node:crypto` 合成的 MP4 |
| `verify-api-retry.js` | 签名接口返回空 body 时的重试行为 | mock 掉 `fetch`，逐个响应喂进去 |
| `verify-recovery.js` | 播放失败自动重试的时序与预算 | 假时钟 |
| `verify-domain.js` | 续播定位、列表合并、服务地址校验、本地记录容错 | `ResumePlayback.target` 的 Kotlin 转写 |
| `verify-seasons.js` | 季号解析、同系列剧筛选 | `seasonNumber` / `seriesBaseTitle` 的 Kotlin 转写 |
| `verify-rank.js` | 热播榜解析、热度读取、跨榜合并 | `HotRank` 的 Kotlin 转写 + 真实响应裁剪成的卡片 |
| `verify-playback.js` | 倍速、画面模式、定时停止 | `PlaybackSpeed` / `SleepTimer` 的 Kotlin 转写 |
| `verify-catalogue.js` | 本地索引的搜索排序、错字兜底、目录走查 | `CatalogueIndex` / `CatalogueBuilder` 的 Kotlin 用例 |
| `verify-cache.js` | 媒体缓存的上限与清理 | 真目录 + 文件系统 mock |
| `verify-favorites.js` | 收藏的集数水位线 | `FavoriteUpdate` 的 Kotlin 转写 |
| `verify-search-history.js` | 搜索历史的上限与去重 | `SearchHistory` 的 Kotlin 用例 |
| `verify-history.js` | 观看记录的删除与清空、确认弹窗的每一句和它的按钮、备份预览的计数、依赖许可证的完整性 | `LibraryIndex` 的 Kotlin 用例 + `package.json` + 一个小的 React 替身 |
| `verify-backup.js` | 备份的编码、解码与合并 | `LibraryBackup` 的 Kotlin 转写 |
| `verify-updates.js` | 版本清单的校验与新旧比较 | 手写的清单样本 |

实网套件（需要服务器在线，跑 CI 会不稳，手动执行）：

```bash
npm run check:live                 # 7 集：签名流、bytevc2 筛选、清晰度上限、公版兜底、端到端解密
node scripts/verify-signer.js --live   # 实网：首页 / 详情 / 签名流
node scripts/verify-cenc.js      # 实网：下载并解密，用 ffprobe / ffmpeg 验证
node scripts/verify-media.js     # 实网：跑完整发布链路，产物与整块解密逐字节比对
```

`verify-cenc.js` 与 `verify-media.js` 都带对照组：加密原件必须解不出画面，解密后的文件必须能解出画面。

### 两个必须知道的线上行为

**签名接口会偶发返回 HTTP 200 空 body。** Kotlin 版在注释里记着同一件事，它的做法是直接降级到公版播放器——但公版只托管每部剧的前 3 集，等于一次空响应就让用户看不了这一集。这里改成**重试**：每次重试都用全新的设备身份和全新签名（共享身份恰恰是被服务端静默封禁的那种），空 body 或非 JSON 会被重试，HTTP 错误状态则不重试——那是服务端真正的回答。

**`fallback_api` 每取一次给的就是一份新材料。** 同一个 URL 再取一次，`key_seed` 和 CDN 地址全变；`video_model` 每次也给出不同的 `fallback_api`。所以取流必须只取一次，取到的 `key_seed` 和 `main_url` 必须配对使用。

## 技术栈

- React Native 0.81.5
- React 19.1.0
- react-native-video 6.19.3
- react-native-file-access 4.0.4
- @react-native-async-storage/async-storage 2.2.0
- axios 1.13.6
