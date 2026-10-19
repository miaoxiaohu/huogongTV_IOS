import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, palette } from "./components";

/** What a confirmation is about. */
export interface ConfirmRequest {
    /** The headline, e.g. "删除观看记录". */
    title: string;
    /** The line under it, e.g. what is about to change. */
    body: string;
    /** The label of the button that goes ahead. */
    okLabel?: string;
    /** The label of the button that backs out. */
    cancelLabel?: string;
    /** Runs when the user goes ahead. */
    onOk: () => void;
    /** An extra line under the body. */
    note?: string;
    /** Something the user can tick, e.g. "also restore the settings". */
    extra?: React.ReactNode;
}

/**
 * Asks before something is done that cannot be undone.
 *
 * The cancel button is the one that gets the focus first, so a remote control
 * that sends a stray "OK" does not throw the records away. The same rule as
 * the TV app's dialogs.
 */
export function Confirm({
    request,
    onClose,
}: {
    request: ConfirmRequest | null;
    onClose: () => void;
}) {
    const [busy, setBusy] = useState(false);
    if (!request) return null;
    const close = () => {
        setBusy(false);
        onClose();
    };
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={close}
            supportedOrientations={["portrait", "landscape"]}
        >
            <View style={s.backdrop}>
                <View style={s.panel}>
                    <Text style={s.title}>{request.title}</Text>
                    <ScrollView style={s.body}>
                        <Text style={s.bodyText}>{request.body}</Text>
                        {request.note ? (
                            <Text style={s.note}>{request.note}</Text>
                        ) : null}
                        {request.extra}
                    </ScrollView>
                    <View style={s.actions}>
                        <Button
                            label={request.cancelLabel || "取消"}
                            preferred
                            disabled={busy}
                            onPress={close}
                        />
                        <Button
                            label={request.okLabel || "确定"}
                            primary
                            disabled={busy}
                            onPress={() => {
                                setBusy(true);
                                try {
                                    request.onOk();
                                } catch (error) {
                                    // The dialog stays open, and the button works
                                    // again - a throw must not leave the user
                                    // with a dead dialog.
                                    setBusy(false);
                                    throw error;
                                }
                            }}
                        />
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "#000000C0",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
    },
    panel: {
        width: "100%",
        maxWidth: 560,
        maxHeight: "80%",
        backgroundColor: palette.panel,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: palette.border,
        padding: 22,
        gap: 18,
    },
    title: { color: palette.text, fontSize: 24, fontWeight: "700" },
    body: { maxHeight: 320 },
    bodyText: { color: palette.text, fontSize: 17, lineHeight: 26 },
    note: { color: palette.muted, fontSize: 15, lineHeight: 23, marginTop: 12 },
    actions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
});
