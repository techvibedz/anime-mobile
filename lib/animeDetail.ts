export function shouldShowSynopsis(animeHref: string, synopsis: string | null | undefined): boolean {
  return !!synopsis && !/anime3rb\.com/i.test(animeHref);
}
