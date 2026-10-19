import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, palette } from "./components";
import { Pending, confirmWords } from "./confirmations";
import { TVFocusGuideView } from "./tv/compat";

/**
 * Asks before something is done that cannot be undone.
 *
 * The dialog is mounted only while there is something to ask about, and it
 * keeps the "already done" flag per request: a new request is a new dialog,
 * so its buttons are usable again.
 *
 * The cancel button comes first, so the one that is read first is the one
 * that backs out. The `preferred` flag on it is a tvOS thing - on a phone it
 * does nothing, and the order of the buttons is what carries the meaning.
 */
export function Confirm({
    pending,
    onClose,
    onOk,
    extra,
}: {
    /** What the user has to agree to, or null when there is nothing to ask. */
    pending: Pending | null;
    onClose: () => void;
    onOk: (pending: Pending) => void;
    /** Something the user can tick, e.g. "also restore the settings". */
    extra?: (pending: Pending) => React.ReactNode;
}) {
    const [done, setDone] = useState<Pending | null>(null);
    const [failure, setFailure] = useState<{ pending: Pending; text: string } | null>(
        null
    );
    // Both of these are derived from the request and not stored beside it: a
    // new request is a new dialog, so it can never inherit the "already
    // done" flag of the one before it.
    const busy = !!pending && done === pending;
    const error = failure && pending && failure.pending === pending ? failure.text : "";
    if (!pending) return null;
    const words = confirmWords(pending);
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={onClose}
            supportedOrientations={["portrait", "landscape"]}
        >
            <View accessibilityViewIsModal style={s.backdrop}>
                <View style={s.panel}>
                    <Text style={s.title}>{words.title}</Text>
                    <ScrollView style={s.body}>
                        <Text style={s.bodyText}>{words.body}</Text>
                        {extra ? extra(pending) : null}
                    </ScrollView>
                    {error ? <Text style={s.error}>{error}</Text> : null}
                    <TVFocusGuideView style={s.actions}>
                        <Button
                            label="取消"
                            preferred
                            disabled={busy}
                            onPress={onClose}
                        />
                        <Button
                            label={words.okLabel}
                            primary
                            disabled={busy}
                            onPress={() => {
                                setDone(pending);
                                setFailure(null);
                                try {
                                    onOk(pending);
                                } catch (problem) {
                                    // The dialog stays open and the button works
                                    // again. The failure is shown here instead
                                    // of being thrown into the void, where it
                                    // would take the app down with it.
                                    setDone(null);
                                    setFailure({
                                        pending,
                                        text:
                                            problem instanceof Error
                                                ? problem.message
                                                : "这一步没能做完，请再试一次",
                                    });
                                }
                            }}
                        />
                    </TVFocusGuideView>
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
    error: { color: palette.accent, fontSize: 15, lineHeight: 22 },
    actions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
});
