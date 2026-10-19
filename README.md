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

清晰度在「设置」里选（360P / 540P / 720P / 1080P），默认 540P。1080P 的一集约 13 MB，网络慢时优先选 360P。

## 同系列剧

详情页下面有「同系列剧」区块，列出同一部剧的其它季度，点进去直接换剧。

服务端没有任何接口能说明两部剧是同一部：所有 `/novel/series/` 路径都 404，公开详情页没有剧集字段，参考 APK 里也没有 `season` 字符串。每个季度就是一部独立的剧，区别只在标题里的季号。

所以只能从标题反推：拿去掉季号的标题去搜，只留下去掉季号后**完全一样**的那些。故意保守 —— 「变废为宝…」和「捡废为宝…」是两部不同的剧，两部都有第二季，模糊匹配会把它们错并到一起。

季号支持阿拉伯数字和中文数字（「第七季」「第一百零二季」），解析规则和电视端 `ContentRepository.seasonNumber` 一致，`scripts/verify-seasons.js` 逐条对照。

## 播放失败时

跟电视端一样，播放失败会自己重试：最多 3 次，间隔 1 秒、2.5 秒、5 秒，观看位置保留。只有用户手动重试才会把次数清零。

- 失败页上有「立即重试」「尝试 720P」「返回选集」「停止自动重试」四个按钮。
- 换回前台时如果还在失败状态，会立刻再试一次，不用等完整个延迟。
- 「这集没有视频」这种是事实的失败不重试 —— 重试只是浪费用户时间。

自动重试的时序和预算在 `src/data/recovery.ts` 里，`scripts/verify-recovery.js` 用假时钟把它整个验一遍。

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
| `verify-signer.js` | MD5 / SM3 哈希 | `node:crypto` |
| `verify-crypto.js` | AES-128/192/256、CBC、CTR、SHA-512 | `node:crypto` |
| `verify-base64.js` | base64 编解码 | Node `Buffer` |
| `verify-mediacrypto.js` | `key_seed` 解密播放地址、`spade_a` 派生内容密钥 | `MediaCrypto.kt` 的逐行独立转写 + 20 组真实响应 |
| `verify-cenc-unit.js` | `stco`/`co64`、`saio` v0/v1、子样本加密、双轨 | `node:crypto` 合成的 MP4 |
| `verify-api-retry.js` | 签名接口返回空 body 时的重试行为 | mock 掉 `fetch`，逐个响应喂进去 |
| `verify-recovery.js` | 播放失败自动重试的时序与预算 | 假时钟 |
| `verify-domain.js` | 续播定位、列表合并、服务地址校验、本地记录容错 | `ResumePlayback.target` 的 Kotlin 转写 |
| `verify-seasons.js` | 季号解析、同系列剧筛选 | `seasonNumber` / `seriesBaseTitle` 的 Kotlin 转写 |

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
