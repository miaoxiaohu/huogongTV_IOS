/**
 * The failure messages the app shows.
 *
 * They are constants because the player has to tell a per-episode fact
 * ("this episode has no video") from a transport problem ("the connection
 * hiccuped"), and a reworded literal would silently break that distinction.
 */

export const PLAYER_UNAVAILABLE = "播放接口暂不可用";
export const PLAYBACK_INFO_EMPTY = "播放信息为空";
export const NO_PLAYBACK_RESOURCE = "没有播放资源";
export const NO_USABLE_QUALITY = "没有可用清晰度";
export const BAD_PLAYBACK_ADDRESS = "播放地址格式异常";
export const NO_PUBLIC_SOURCE = "该剧集暂无公开播放资源";
export const BAD_CONTENT_KEY = "内容密钥格式异常";
export const EMPTY_CONTENT = "视频内容为空";
