/**
 * React Native, as far as the dialog needs it.
 *
 * Every component is an empty marker: the renderer treats anything that is
 * not a function as a host element, and the test reads the props.
 */
const host = (name) => ({ $$host: name, displayName: name });

const absolute = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 };

const noop = { remove: () => {} };

module.exports = {
    ActivityIndicator: host("ActivityIndicator"),
    AppState: { addEventListener: () => noop, currentState: "active" },
    BackHandler: { addEventListener: () => noop, exitApp: () => {} },
    Image: host("Image"),
    Linking: { openURL: async () => true },
    Modal: host("Modal"),
    Platform: { OS: "ios", isTV: false, select: (spec) => spec.ios },
    Pressable: host("Pressable"),
    ScrollView: host("ScrollView"),
    Text: host("Text"),
    View: host("View"),
    useWindowDimensions: () => ({
        width: 390,
        height: 844,
        scale: 3,
        fontScale: 1,
    }),
    StyleSheet: {
        create: (styles) => styles,
        absoluteFill: absolute,
        absoluteFillObject: absolute,
        flatten: (style) => style,
    },
};
