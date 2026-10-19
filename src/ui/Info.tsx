import React from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, palette } from "./components";

/**
 * A page of text the user asked for, e.g. the open source licenses.
 *
 * The TV app shows the same thing in a dialog with one button on it.
 */
export function Info({
    title,
    body,
    onClose,
}: {
    title: string;
    body: string;
    onClose: () => void;
}) {
    if (!title) return null;
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={onClose}
            supportedOrientations={["portrait", "landscape"]}
        >
            <View style={s.backdrop}>
                <View style={s.panel}>
                    <Text style={s.title}>{title}</Text>
                    <ScrollView style={s.body}>
                        <Text style={s.bodyText}>{body}</Text>
                    </ScrollView>
                    <View style={s.actions}>
                        <Button label="关闭" preferred onPress={onClose} />
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
    body: { maxHeight: 380 },
    bodyText: { color: palette.text, fontSize: 16, lineHeight: 26 },
    actions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
});
