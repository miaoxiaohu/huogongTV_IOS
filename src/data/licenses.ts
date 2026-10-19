/**
 * What this app is made of, and under which terms.
 *
 * The app is GPL-3.0, and the content protocol and the encryption handling
 * are ported from drpys - so both have to be named in the app itself, not
 * only in the repository. The TV app says the same thing in its settings.
 *
 * The list of libraries is checked against `package.json` by the offline
 * suite, so a dependency that is added later cannot slip into the app
 * without being named here.
 */

/** The terms the app is released under. */
export const APP_LICENSE = "GPL-3.0";

/** Where the source and the licenses live. */
export const REPOSITORY = "github.com/miaoxiaohu/huogongTV_IOS";

/** The part that came from another project. */
export const ATTRIBUTION = "内容协议与加密处理移植自 drpys（22261ad）。";

export interface LicenseEntry {
    /** The name of the package, exactly as it is called in `package.json`. */
    name: string;
    /** The terms it is under. */
    license: string;
}

/** The libraries the app ships with. */
export const LICENSES: LicenseEntry[] = [
    { name: "react-native", license: "MIT" },
    { name: "react", license: "MIT" },
    { name: "react-native-video", license: "MIT" },
    { name: "react-native-file-access", license: "MIT" },
    { name: "@react-native-async-storage/async-storage", license: "MIT" },
    { name: "axios", license: "MIT" },
];

/**
 * The text of the "开源许可" page.
 *
 * It is one string so the app and the test read the same words.
 */
export function licenseNotice(): string {
    const lines = [
        `本 iOS 版以 ${APP_LICENSE} 发布。`,
        ATTRIBUTION,
        ...LICENSES.map((entry) => `${entry.name}：${entry.license}`),
        `完整源码和许可证见 GitHub：${REPOSITORY}`,
    ];
    return lines.join("\n");
}
