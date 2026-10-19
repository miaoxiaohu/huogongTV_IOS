/**
 * A very small React stand-in.
 *
 * The dialog is the one piece of the app that cannot be checked by reading
 * it: whether its buttons are usable depends on what happened the last time
 * it was open, and that only shows up when it is actually rendered and
 * pressed. So it is rendered here, with a hook store that survives from one
 * render to the next - which is exactly the behaviour that decides whether
 * the second dialog works.
 *
 * What is here is what the dialog needs: `useState`, `useRef`, `useEffect`,
 * `forwardRef` and the element factory. It is not a React.
 */
const path = require("path");
const { mockModule } = require("../transpile");

/** The hook records, one per component instance, keyed by its place in the tree. */
let store = new Map();
/** The record the hooks are being written into. */
let current = null;

const Fragment = Symbol.for("react.fragment");

function hooksFor(key) {
    if (!store.has(key)) {
        store.set(key, { state: [], refs: [], effects: [], cursor: 0 });
    }
    return store.get(key);
}

/**
 * The slot a hook takes in this render.
 *
 * The cursor is reset before every render of a component, so the same hook
 * always gets the same slot - that is what makes the state survive from one
 * render to the next.
 */
function nextSlot(hooks, list) {
    const index = hooks.cursor++;
    if (list.length <= index) list[index] = {};
    return list[index];
}

function useState(initial) {
    const hooks = current;
    const slot = nextSlot(hooks, hooks.state);
    if (!("value" in slot)) {
        slot.value = typeof initial === "function" ? initial() : initial;
    }
    const set = (value) => {
        slot.value = typeof value === "function" ? value(slot.value) : value;
    };
    return [slot.value, set];
}

function useRef(initial) {
    const hooks = current;
    const slot = nextSlot(hooks, hooks.refs);
    if (!("current" in slot)) slot.current = initial;
    return slot;
}

function useEffect(fn) {
    if (current) current.effects.push(fn);
}

function forwardRef(fn) {
    const wrapped = (props) => fn(props, props && props.ref);
    wrapped.displayName = fn.name;
    return wrapped;
}

/** Builds an element. The automatic runtime passes the children in the props. */
function jsx(type, props) {
    return { type, props: props || {} };
}

function createElement(type, props, ...children) {
    const merged = { ...(props || {}) };
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return { type, props: merged };
}

/**
 * Renders a tree and returns every host element in it, in the order they
 * appear. A host element is anything that is not a function component.
 */
function render(element) {
    const out = [];
    walk(element, "", out);
    for (const record of store.values()) {
        for (const effect of record.effects.splice(0)) effect();
    }
    return out;
}

function walk(element, path, out) {
    if (element === null || element === undefined || typeof element === "boolean") {
        return;
    }
    // A string or a number is text, not an element.
    if (typeof element === "string" || typeof element === "number") {
        return;
    }
    if (Array.isArray(element)) {
        element.forEach((child, index) => walk(child, path + "." + index, out));
        return;
    }
    if (element.type === Fragment) {
        walk(element.props.children, path + ".f", out);
        return;
    }
    if (typeof element.type === "function") {
        const key = path + "@" + (element.type.displayName || element.type.name || "fn");
        const saved = current;
        const hooks = hooksFor(key);
        hooks.cursor = 0;
        current = hooks;
        let result;
        try {
            result = element.type(element.props);
        } finally {
            current = saved;
        }
        walk(result, key + "/", out);
        return;
    }
    out.push({ type: element.type, props: element.props });
    walk(element.props.children, path + ".c", out);
}

/** Forgets every hook, as a fresh app would. */
function reset() {
    store = new Map();
    current = null;
}

/**
 * Puts the stand-ins in place of React, the JSX runtime and React Native.
 */
function install(cache) {
    mockModule("react", __filename);
    mockModule(
        "react/jsx-runtime",
        path.join(__dirname, "react-jsx-runtime-shim.js")
    );
    mockModule(
        "react-native",
        path.join(__dirname, "react-native-shim.js")
    );
    return cache;
}

/** The buttons of a rendered tree, in the order they appear. */
function buttons(tree) {
    return tree.filter(
        (element) =>
            element.props &&
            element.props.accessibilityRole === "button" &&
            element.props.accessibilityLabel
    );
}

module.exports = {
    Fragment,
    forwardRef,
    useState,
    useRef,
    useEffect,
    createElement,
    jsx,
    render,
    reset,
    install,
    buttons,
};
