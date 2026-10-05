import assert from "node:assert/strict";
import {
  parseMangalikChapter,
  parseMangalikChapters,
  parseMangalikDetail,
  parseMangalikHome,
  parseMangalikSearch,
} from "./mangalik";

// Trimmed snippets from live mangalik.net pages (2026-10) — same classes and
// structure, fewer items, CSS/comments stripped.

const HOME = `
<div class="page-listing-item"><div class="row row-eq-height">
<div class="col-6 col-md-2 badge-pos-1">
    <div class="page-item-detail manga">
        <div id="manga-item-168334" class="item-thumb c-image-hover" data-post-id="168334">
            <a href="https://mangalik.net/manga/reincarnated-as-the-strongest/" title="Reincarnated as the Strongest">
                <img width="175" height="238" src="https://io.mangalik.net/wp-content/uploads/2026/01/download-6-175x238.jpeg" class="img-responsive" alt="download-6"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5"><a href="https://mangalik.net/manga/reincarnated-as-the-strongest/">Reincarnated as the Strongest</a></h3></div>
            <div class="meta-item rating"><div class="post-total-rating"><span class="score font-meta total_votes">4.5</span></div></div>
            <div class="list-chapter">
                <div class="chapter-item">
                    <span class="chapter font-meta"><a href="https://mangalik.net/manga/reincarnated-as-the-strongest/32/" class="btn-link"> 32 </a></span>
                    <span class="post-on font-meta"><span class="c-new-tag"><a href="https://mangalik.net/manga/reincarnated-as-the-strongest/32/" title="ساعتين ago"><img src="https://io.mangalik.net/wp-content/themes/madara/images/new.gif" alt="ساعتين ago"></a></span></span>
                </div>
                <div class="chapter-item">
                    <span class="chapter font-meta"><a href="https://mangalik.net/manga/reincarnated-as-the-strongest/31/" class="btn-link"> 31 </a></span>
                </div>
            </div>
        </div>
    </div>
</div>
<div class="col-6 col-md-2 badge-pos-1">
    <div class="page-item-detail manga">
        <div id="manga-item-184142" class="item-thumb c-image-hover" data-post-id="184142">
            <a href="https://mangalik.net/manga/the-final-boss-wants-to-die/" title="The Final Boss Wants to Die">
                <img width="175" height="238" src="data:image/gif;base64,R0lGOD" data-src="https://io.mangalik.net/wp-content/uploads/2026/08/boss-175x238.jpg" class="img-responsive" alt="boss"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5"><a href="https://mangalik.net/manga/the-final-boss-wants-to-die/">The Final Boss Wants to Die</a></h3></div>
            <div class="list-chapter">
                <div class="chapter-item">
                    <span class="chapter font-meta"><a href="https://mangalik.net/manga/the-final-boss-wants-to-die/21/" class="btn-link"> 21 </a></span>
                </div>
            </div>
        </div>
    </div>
</div>
</div></div>`;

const POPULAR = `
<div class="page-listing-item"><div class="row row-eq-height">
<div class="col-6 col-md-2 badge-pos-1">
    <div class="page-item-detail manga">
        <div class="item-thumb c-image-hover" data-post-id="186137">
            <a href="https://mangalik.net/manga/roxana/" title="Roxana">
                <img src="https://io.mangalik.net/wp-content/uploads/2026/10/cover-1-193x278.jpeg" alt="cover"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5"><a href="https://mangalik.net/manga/roxana/">Roxana</a></h3></div>
            <div class="list-chapter">
                <div class="chapter-item">
                    <span class="chapter font-meta"><a href="https://mangalik.net/manga/roxana/3/" class="btn-link"> 3 </a></span>
                </div>
            </div>
        </div>
    </div>
</div>
</div></div>`;

const NEW_MANGA = `
<div class="page-item-detail manga">
    <div class="item-thumb c-image-hover">
        <a href="https://mangalik.net/manga/clockwork-lovers/" title="Clockwork Lovers">
            <img src="https://io.mangalik.net/wp-content/uploads/2026/10/clock-193x278.jpg" alt="clock"/>
        </a>
    </div>
    <div class="item-summary">
        <div class="post-title font-title"><h3 class="h5"><a href="https://mangalik.net/manga/clockwork-lovers/">Clockwork Lovers</a></h3></div>
        <div class="list-chapter">
            <div class="chapter-item">
                <span class="chapter font-meta"><a href="https://mangalik.net/manga/clockwork-lovers/7/" class="btn-link"> 7 </a></span>
            </div>
        </div>
    </div>
</div>`;

const SEARCH = `
<div class="row c-tabs-item__content">
    <div class="col-4 col-12 col-md-2">
        <div class="tab-thumb c-image-hover">
            <a href="https://mangalik.net/manga/one-piece-strong-world-0/" title="One Piece Strong World 0">
                <img width="193" height="130" src="https://io.mangalik.net/wp-content/uploads/2023/08/www.google.com_-1.jpeg" class="img-responsive" alt="www.google.com"/>
            </a>
        </div>
    </div>
    <div class="col-8 col-12 col-md-10">
        <div class="tab-summary">
            <div class="post-title"><h3 class="h4"><a href="https://mangalik.net/manga/one-piece-strong-world-0/">One Piece Strong World 0</a></h3></div>
            <div class="post-content">
                <div class="post-content_item mg_genres nofloat">
                    <div class="summary-heading"><h5>Genres</h5></div>
                    <div class="summary-content"><a href="https://mangalik.net/manga-genre/action/">اكشن</a>, <a href="https://mangalik.net/manga-genre/shonen/">شونين</a></div>
                </div>
                <div class="post-content_item mg_status nofloat">
                    <div class="summary-heading"><h5>الحالة</h5></div>
                    <div class="summary-content">OnGoing</div>
                </div>
            </div>
        </div>
        <div class="tab-meta">
            <div class="meta-item latest-chap">
                <span class="font-meta">Latest chapter </span>
                <span class="font-meta chapter"><a href="https://mangalik.net/manga/one-piece-strong-world-0/2/">2</a></span>
            </div>
            <div class="meta-item rating"><div class="post-total-rating"><span class="score font-meta total_votes">4</span></div></div>
        </div>
    </div>
</div>
<div class="row c-tabs-item__content">
    <div class="col-4 col-12 col-md-2">
        <div class="tab-thumb c-image-hover">
            <a href="https://mangalik.net/manga/one-piece-log-book-omake/" title="One Piece Log Book Omake">
                <img width="193" height="278" data-src="https://io.mangalik.net/wp-content/uploads/2023/08/large_20619-193x278.jpg" src="data:image/gif;base64,R0lGOD" class="img-responsive" alt="large_20619"/>
            </a>
        </div>
    </div>
    <div class="col-8 col-12 col-md-10">
        <div class="tab-summary">
            <div class="post-title"><h3 class="h4"><a href="https://mangalik.net/manga/one-piece-log-book-omake/">One Piece Log Book Omake</a></h3></div>
            <div class="post-content">
                <div class="post-content_item mg_status nofloat">
                    <div class="summary-heading"><h5>الحالة</h5></div>
                    <div class="summary-content">مكتملة</div>
                </div>
            </div>
        </div>
    </div>
</div>`;

const DETAIL = `
<div class="post-title">
    <h1>
        The Cold-Blooded Warrior                    </h1>
</div>
<div class="tab-summary">
    <div class="summary_image">
        <a href="https://mangalik.net/manga/the-cold-blooded-warrior/">
            <img width="193" height="278" src="https://io.mangalik.net/wp-content/uploads/2025/06/warrior-193x278.jpg" class="img-responsive" alt="cover"/>
        </a>
    </div>
    <div class="summary_content">
        <div class="post-rating">
            <div class="post-total-rating"><span class="score font-meta total_votes">4.3</span></div>
        </div>
        <div class="post-content_item">
            <div class="summary-heading"><h5>المؤلف</h5></div>
            <div class="summary-content"><div class="author-content">Updating</div></div>
        </div>
        <div class="post-content_item">
            <div class="summary-heading"><h5>التصنيف</h5></div>
            <div class="summary-content">
                <div class="genres-content"><a href="https://mangalik.net/manga-genre/action/">اكشن</a>, <a href="https://mangalik.net/manga-genre/fantasy/">فنتازيا</a></div>
            </div>
        </div>
        <div class="post-content_item">
            <div class="summary-heading"><h5>النوع</h5></div>
            <div class="summary-content">مانجا</div>
        </div>
        <div class="post-status">
            <div class="post-content_item">
                <div class="summary-heading"><h5>سنة الانتاج</h5></div>
                <div class="summary-content">2024</div>
            </div>
            <div class="post-content_item">
                <div class="summary-heading"><h5>الحالة</h5></div>
                <div class="summary-content">OnGoing</div>
            </div>
        </div>
    </div>
</div>
<div class="c-blog__heading"><h2 class="h4">القصة</h2></div>
<div class="description-summary">
    <div class="summary__content ">
        <p>هان جاي وو&#8230; أحد أشرس اللاعبين في لعبة منقذ البشرية.</p>
    </div>
</div>
<div class="listing-chapters_wrap">
    <ul class="main version-chap">
        <li class="wp-manga-chapter  ">
            <a href="https://mangalik.net/manga/the-cold-blooded-warrior/73/">73</a>
            <span class="chapter-release-date"><span class="c-new-tag"><a href="https://mangalik.net/manga/the-cold-blooded-warrior/73/" title="ساعة واحدة ago"><img src="https://io.mangalik.net/wp-content/themes/madara/images/new.gif" alt="ساعة واحدة ago"></a></span></span>
        </li>
        <li class="wp-manga-chapter  ">
            <a href="https://mangalik.net/manga/the-cold-blooded-warrior/72/">72</a>
            <span class="chapter-release-date"><i>سبتمبر 10, 2026</i></span>
        </li>
        <li class="wp-manga-chapter  ">
            <a href="https://mangalik.net/manga/the-cold-blooded-warrior/71/">71</a>
            <span class="chapter-release-date"><i>سبتمبر 9, 2026</i></span>
        </li>
    </ul>
</div>`;

const CHAPTER = `
<div class="entry-content">
    <img src="https://io.mangalik.net/wp-content/app/lekmanganet/lekmanga.png" alt="مانجا ليك Mangalek"/>
    <div class="reading-content">
        <input type="hidden" id="wp-manga-current-chap" data-id="671103" value="3"/>
        <div class="page-break no-gaps">
            <img id="image-0" src="https://tempsolo.mangalik.net/manga/arb5/data/manga_6ac29a55cd25a/fccef02/image-01.jpg" class="wp-manga-chapter-img">
        </div>
        <div class="page-break no-gaps">
            <img id="image-1" src="data:image/gif;base64,R0lGOD" data-src="https://tempsolo.mangalik.net/manga/arb5/data/manga_6ac29a55cd25a/fccef02/image-02.jpg" class="wp-manga-chapter-img">
        </div>
        <div class="page-break no-gaps">
            <img id="image-2" src="https://tempsolo.mangalik.net/manga/arb5/data/manga_6ac29a55cd25a/fccef02/image-03.jpg" class="wp-manga-chapter-img">
        </div>
    </div>
    <div class="ad"><img src="https://wingsmob.com/1/banner.gif" class="img-responsive"></div>
    <div class="manga-discussion"><img src="https://io.mangalik.net/wp-content/uploads/avatar-60.jpeg" class="avatar avatar-60 photo"></div>
</div>`;

const TITLE = "<title>مانجا Roxana 3 مترجم</title>";

async function main() {
  // Home: latest rail from the front page, popular + new-manga rails from the
  // listing pages; no hero on the site, so featured backfills from latest.
  const home = parseMangalikHome(HOME, POPULAR, NEW_MANGA);
  assert.ok(home);
  assert.deepEqual(home.sections.map((s) => [s.id, s.kind, s.title]), [
    ["latest", "latest", "أحدث الفصول"],
    ["popular", "ranked", "الأكثر قراءة"],
    ["new", "grid", "مانجا جديدة"],
  ]);
  const latest = home.sections[0]!;
  assert.equal(latest.items.length, 2);
  assert.equal(latest.items[0]?.id, "reincarnated-as-the-strongest");
  assert.equal(latest.items[0]?.title, "Reincarnated as the Strongest");
  assert.equal(latest.items[0]?.cover, "https://io.mangalik.net/wp-content/uploads/2026/01/download-6-175x238.jpeg");
  assert.equal(latest.items[0]?.latest, "الفصل 32");
  assert.equal(latest.items[0]?.rating, "4.5");
  // Lazy placeholder: data-src wins over the base64 src.
  assert.equal(latest.items[1]?.cover, "https://io.mangalik.net/wp-content/uploads/2026/08/boss-175x238.jpg");
  assert.equal(latest.items[1]?.latest, "الفصل 21");
  assert.equal(home.featured.length, 2);
  assert.equal(home.featured[0]?.title, "Reincarnated as the Strongest");
  assert.equal(home.sections[1]?.items[0]?.id, "roxana");
  assert.equal(home.sections[1]?.items[0]?.latest, "الفصل 3");
  assert.equal(home.sections[2]?.items[0]?.id, "clockwork-lovers");

  // Search rows: slug id, absolute cover, status label, latest chapter.
  const found = parseMangalikSearch(SEARCH);
  assert.equal(found.length, 2);
  assert.equal(found[0]?.title, "One Piece Strong World 0");
  assert.equal(found[0]?.id, "one-piece-strong-world-0");
  assert.equal(found[0]?.cover, "https://io.mangalik.net/wp-content/uploads/2023/08/www.google.com_-1.jpeg");
  assert.equal(found[0]?.status, "مستمر");
  assert.equal(found[0]?.latest, "الفصل 2");
  assert.equal(found[0]?.rating, "4");
  assert.equal(found[1]?.status, "مكتمل");
  assert.equal(found[1]?.cover, "https://io.mangalik.net/wp-content/uploads/2023/08/large_20619-193x278.jpg");
  assert.equal(found[1]?.latest, null);

  // Detail: metadata, synopsis, and the chapter list exactly as served
  // (newest-first) with dates (new-tag title fallback included).
  const detail = parseMangalikDetail(DETAIL, "the-cold-blooded-warrior");
  assert.ok(detail);
  assert.equal(detail.title, "The Cold-Blooded Warrior");
  assert.equal(detail.id, "the-cold-blooded-warrior");
  assert.equal(detail.cover, "https://io.mangalik.net/wp-content/uploads/2025/06/warrior-193x278.jpg");
  assert.equal(detail.type, "مانجا");
  assert.equal(detail.status, "مستمر");
  assert.equal(detail.rating, "4.3");
  assert.equal(detail.year, "2024");
  // "Updating" is Madara's empty placeholder, not an author.
  assert.equal(detail.author, null);
  assert.deepEqual(detail.genres, ["اكشن", "فنتازيا"]);
  assert.ok(detail.synopsis?.includes("أشرس اللاعبين"));
  assert.deepEqual(detail.chapters.map((c) => [c.id, c.number]), [
    ["73", "73"],
    ["72", "72"],
    ["71", "71"],
  ]);
  assert.equal(detail.chapters[0]?.date, "ساعة واحدة ago");
  assert.equal(detail.chapters[1]?.date, "سبتمبر 10, 2026");
  assert.equal(detail.latest, "الفصل 73");

  // Reader: ordered absolute chapter pages only — header logo, ad and avatar
  // images are filtered out.
  const base = "https://mangalik.net/manga/roxana/3/";
  const reader = parseMangalikChapter(TITLE + CHAPTER, base);
  assert.ok(reader);
  assert.deepEqual(reader.pages, [
    "https://tempsolo.mangalik.net/manga/arb5/data/manga_6ac29a55cd25a/fccef02/image-01.jpg",
    "https://tempsolo.mangalik.net/manga/arb5/data/manga_6ac29a55cd25a/fccef02/image-02.jpg",
    "https://tempsolo.mangalik.net/manga/arb5/data/manga_6ac29a55cd25a/fccef02/image-03.jpg",
  ]);
  assert.equal(reader.title, "مانجا Roxana 3 مترجم");

  // Parsers never throw on junk and degrade to empty/null.
  assert.equal(parseMangalikHome(""), null);
  assert.equal(parseMangalikHome("<p>no cards</p>"), null);
  assert.deepEqual(parseMangalikSearch(""), []);
  assert.equal(parseMangalikDetail("", "x"), null);
  assert.equal(parseMangalikDetail("<div>no title</div>", "x"), null);
  assert.deepEqual(parseMangalikChapter('<div class="reading-content"><img class="wp-manga-chapter-img" src="data:image/gif;base64,x" data-lazy-src="/first.jpg"><img class="wp-manga-chapter-img" data-original="/second.jpg"></div>', base)?.pages,
    [new URL("/first.jpg", base).toString(), new URL("/second.jpg", base).toString()]);
  assert.equal(parseMangalikChapter("", base), null);
  assert.equal(parseMangalikChapter('<div class="reading-content"><img src="https://x/logo.png"></div>', base), null);
  assert.deepEqual(parseMangalikChapters(""), []);

  console.log("mangalik source tests passed");
}

void main();
