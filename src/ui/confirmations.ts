/**
 * The things the user has to agree to before they happen.
 *
 * They are kept as data and not as a ready-made dialog, so the dialog always
 * reads the state as it is when the button is pressed - the checkbox in the
 * restore preview included.
 *
 * The words and the effect of each one live here and not in the screen, so
 * they can be checked without a device: the offline suite reads this file and
 * compares it with the TV app's own wording and behaviour.
 */
import { Library } from "../domain/model";
import { BackupData, describeBackup } from "../data/backup";
import { clearHistory, clearSearches, removeHistory } from "../data/history";

export type Pending =
    | { kind: "remove-record"; id: string; title: string }
    | { kind: "clear-searches" }
    | { kind: "clear-history" }
    | {
          kind: "restore";
          backup: BackupData;
          name: string;
          withSettings: boolean;
      };

/** What the dialog says. */
export interface ConfirmWords {
    title: string;
    body: string;
    /** The label of the button that goes ahead. */
    okLabel: string;
}

/**
 * The words on the dialog for a pending action.
 *
 * The TV app's `tvTools.confirm` says the same things:
 * "删除观看记录" / "删除《X》的本机观看进度？收藏会保留。" and
 * "清空观看记录" / "将删除本机所有观看进度，收藏会保留。"
 * Its buttons are "取消" and "确认" - and the cancel one is the one that
 * gets the focus.
 */
export function confirmWords(pending: Pending): ConfirmWords {
    switch (pending.kind) {
        case "remove-record":
            return {
                title: "删除观看记录",
                body: `删除《${pending.title}》的本机观看进度？收藏会保留。`,
                okLabel: "确认",
            };
        case "clear-searches":
            return {
                title: "清空搜索历史",
                body: "清除本机保存的搜索词？",
                okLabel: "确认",
            };
        case "clear-history":
            return {
                title: "清空观看记录",
                body: "将删除本机所有观看进度，收藏会保留。",
                okLabel: "确认",
            };
        case "restore":
            return {
                title: "确认恢复本机记录",
                body: describeBackup(pending.backup),
                okLabel: "合并恢复",
            };
    }
}

/**
 * What the action does to the local records.
 *
 * A restore is not in here: it merges a backup, and that is the caller's job
 * because the settings travel with the records and not inside them.
 */
export function applyPendingToLibrary(
    pending: Pending,
    library: Library
): Library {
    switch (pending.kind) {
        case "remove-record":
            return removeHistory(library, pending.id);
        case "clear-searches":
            return clearSearches(library);
        case "clear-history":
            return clearHistory(library);
        case "restore":
            return library;
    }
}

/**
 * Whether the playback settings and the shelf come back with the records.
 *
 * The TV app's dialog has a box for it and it starts unticked, so a restore
 * on a different device does not carry the old device's speed along.
 */
export function pendingRestoresSettings(pending: Pending): boolean {
    return pending.kind === "restore" && pending.withSettings;
}
