import type { ReactNode } from "react";
import { FlatList, View } from "react-native";
import type { MangaCard } from "../lib/manga/types";
import type { useCardLayout } from "../lib/cardLayout";
import { upgradeMangaCover } from "../lib/manga/cover";
import { openMangaDetail } from "../lib/manga/nav";
import { MangaCardTile } from "./MangaUI";

export function MangaGrid({ cards, metrics, bottomInset, footer, empty, corner, subtitle }: {
  cards: MangaCard[];
  metrics: ReturnType<typeof useCardLayout>;
  bottomInset: number;
  footer?: ReactNode;
  empty?: ReactNode;
  corner?: (card: MangaCard) => ReactNode;
  subtitle?: (card: MangaCard) => string | undefined;
}) {
  return (
    <FlatList
      key={`${metrics.layout}:${metrics.columns}`}
      data={cards}
      numColumns={metrics.columns}
      keyExtractor={(card) => `${card.source}:${card.id}`}
      renderItem={({ item }) => (
        <MangaCardTile image={upgradeMangaCover(item.cover)} title={item.title}
          width={metrics.cardWidth} layout={metrics.layout}
          subtitle={subtitle?.(item) ?? [item.type, item.latest].filter(Boolean).join(" · ")} topRight={corner?.(item)}
          onPress={() => openMangaDetail(item)} />
      )}
      columnWrapperStyle={metrics.columns > 1 ? { gap: 12, flexDirection: "row-reverse" } : undefined}
      style={{ flex: 1 }}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: bottomInset + 32, flexGrow: 1 }}
      ListFooterComponent={footer ? <>{footer}</> : null}
      ListEmptyComponent={empty ? <>{empty}</> : null}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      removeClippedSubviews={false}
      initialNumToRender={12} maxToRenderPerBatch={9} windowSize={5}
      showsVerticalScrollIndicator={false}
    />
  );
}
