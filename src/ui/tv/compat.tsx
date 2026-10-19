/**
 * TV focus compatibility layer.
 *
 * `TVFocusGuideView`, `useTVEventHandler` and `View.requestTVFocus` ship in
 * react-native-tvos, not in plain react-native. Importing them straight from
 * "react-native" makes the bundle resolve them to `undefined` and the app
 * crashes on the first render on iPhone/iPad.
 *
 * These shims use the real implementation when the platform provides one and
 * degrade to a plain View / no-op otherwise, so the same source builds for
 * both tvOS and regular iOS.
 */
import * as React from "react";
import * as ReactNative from "react-native";
import { View, ViewProps } from "react-native";

export type TVEvent = {
  eventType: string;
  eventKeyAction?: number;
};

const native = ReactNative as unknown as {
  TVFocusGuideView?: React.ComponentType<Record<string, unknown>>;
  useTVEventHandler?: (handler: (event: TVEvent) => void) => void;
};

type GuideProps = ViewProps & {
  children?: React.ReactNode;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  autoFocus?: boolean;
};

function PlainFocusGuide(props: GuideProps) {
  // The trapFocus* flags are tvOS-only; drop them so plain View stays quiet.
  const {
    trapFocusLeft,
    trapFocusRight,
    trapFocusUp,
    trapFocusDown,
    autoFocus,
    children,
    ...rest
  } = props;
  return <View {...rest}>{children}</View>;
}

export const TVFocusGuideView =
  native.TVFocusGuideView ?? PlainFocusGuide;

/**
 * Registers a TV remote handler. On platforms without a remote the handler
 * simply never fires.
 */
export function useTVEventHandler(handler: (event: TVEvent) => void): void {
  const impl = native.useTVEventHandler;
  // `impl` is fixed for the lifetime of the process, so this stays a stable
  // hook call even though it looks conditional.
  if (impl) impl(handler);
}

/** Moves the remote focus to `node` when the platform supports it. */
export function focusTV(node: unknown): void {
  const target = node as { requestTVFocus?: () => void } | null | undefined;
  if (target && typeof target.requestTVFocus === "function") {
    target.requestTVFocus();
  }
}
