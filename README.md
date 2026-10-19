# HongguoTV iOS

红果 TV iOS 版（React Native 0.81.5），支持 iPhone / iPad。

直接调用红果接口，不需要中间服务器。

## 构建

本项目使用 GitHub Actions 自动构建未签名 `.ipa`，可配合 [Sideloadly](https://sideloadly.io) 或 [AltStore](https://altstore.io) 安装到真机。

构建产物在每次 CI 运行结束后通过 Artifacts 下载。

CI 在编译前会先做三道检查：源码按 Metro 使用的 Babel 预设解析一遍、TypeScript 类型检查、哈希与 AES 的回归测试。这几步只要几秒，能省下八分钟的 xcodebuild。

## 播放

红果的签名播放器返回的是 CENC 加密的 MP4，iOS 自己解不了，AVPlayer 也读不了 `data:` / `blob:`。所以 App 会：

1. 用原生下载把加密的 MP4 存到本地（不经过 JS 桥传输文件内容）；
2. 读文件头，把 `encv` 改回 `hvc1`、`sinf` 改成 `free`；
3. 用 AES-CTR 逐样本解密；
4. 写成普通 MP4，用 `file://` 交给播放器。

整个过程按 512 KB 分块进行，内存占用与视频大小无关。文件按「剧集 + 清晰度」缓存在应用缓存目录里，重看时直接复用。

清晰度在「设置」里选（360P / 540P / 720P / 1080P），默认 540P。1080P 的一集约 13 MB，网络慢时优先选 360P。

## 开发

```bash
npm install
cd ios && pod install && cd ..
npx react-native start
```

## 验证脚本

```bash
npm run check                    # 解析 + 类型检查 + 哈希/AES 回归
node scripts/verify-signer.js --live   # 实网：首页 / 详情 / 签名流
node scripts/verify-cenc.js      # 实网：下载并解密，用 ffprobe / ffmpeg 验证
node scripts/verify-media.js     # 实网：跑完整发布链路，产物与整块解密逐字节比对
```

`verify-cenc.js` 与 `verify-media.js` 都带对照组：加密原件必须解不出画面，解密后的文件必须能解出画面。

## 技术栈

- React Native 0.81.5
- React 19.1.0
- react-native-video 6.19.3
- react-native-file-access 4.0.4
- @react-native-async-storage/async-storage 2.2.0
