// Horizontal ScrollView that starts at the RIGHT edge, for Arabic reading order.
// The app is locked LTR (app/_layout.tsx), so this mirrors the ScrollView and
// un-mirrors each child — the same trick FlatList `inverted` uses (and what the
// manga tab's rails already do). The first child sits on the right, scrolling
// reveals the rest to the left, and short content hugs the right edge.
import { Children, forwardRef, type ReactNode } from "react";
import { ScrollView, View, type ScrollViewProps } from "react-native";

const MIRROR = { transform: [{ scaleX: -1 }] };

export const RtlRow = forwardRef<ScrollView, ScrollViewProps & { children: ReactNode }>(function RtlRow(
  { children, style, ...rest },
  ref,
) {
  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} {...rest} style={[MIRROR, style]}>
      {Children.map(children, (child) => (child == null || child === false ? null : <View style={MIRROR}>{child}</View>))}
    </ScrollView>
  );
});
