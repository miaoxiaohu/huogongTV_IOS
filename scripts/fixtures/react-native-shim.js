/**
 * React Native, as far as the dialog needs it.
 *
 * Every component is an empty marker: the renderer treats anything that is
 * not a function as a host element, and the test reads the props.
 */
const host = (name) => ({ $$host: name, displayName: name });

const absolute = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 };

module.exports = {
    ActivityIndicator: host("ActivityIndicator"),
    Image: host("Image"),
    Modal: host("Modal"),
    Pressable: host("Pressable"),
    ScrollView: host("ScrollView"),
    Text: host("Text"),
    View: host("View"),
    StyleSheet: {
        create: (styles) => styles,
        absoluteFill: absolute,
        absoluteFillObject: absolute,
        flatten: (style) => style,
    },
};
