# HongguoTV iOS

红果 TV iOS 版（React Native 0.81.5），支持 iPhone / iPad。

## 构建

本项目使用 GitHub Actions 自动构建未签名 `.ipa`，可配合 [Sideloadly](https://sideloadly.io) 或 [AltStore](https://altstore.io) 安装到真机。

构建产物在每次 CI 运行结束后通过 Artifacts 下载。

## 开发

```bash
npm install
cd ios && pod install && cd ..
npx react-native start
```

## 技术栈

- React Native 0.81.5
- React 19.1.0
- react-native-video 6.19.3
- @react-native-async-storage/async-storage 2.2.0
