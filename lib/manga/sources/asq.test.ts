import assert from "node:assert/strict";
import { madaraSearchPath } from "../madara";
import {
  parseAsqChapter,
  parseAsqChapters,
  parseAsqDetail,
  parseAsqFeatured,
  parseAsqHome,
  parseAsqSearch,
} from "./asq";

// Trimmed snippets from the live pages (3asq.online, 2026-10) — same classes
// and structure, just fewer items and no surrounding CSS/comments.

const HOME = `
<div id="manga-popular-slider-4" class="widget manga-widget widget-manga-popular-slider"><div class="widget__inner"><div class="popular-slider style-3">
<div class="slider__item">
    <div class="item__wrap ">
        <div class="slider__thumb"><div class="slider__thumb_item c-image-hover">
            <span class="manga-title-badges hot badge-round"><span class="text">3asq</span></span>
            <a href="https://3asq.online/manga/one-piece/">
                <img width="125" height="180" src="https://3asq.online/wp-content/uploads/2019/04/v1-1-125x180.jpg" class="img-responsive" alt="v1"/><div class="slider-overlay"></div>
            </a>
        </div></div>
        <div class="slider__content"><div class="slider__content_item">
            <div class="post-title font-title"><h4><a href="https://3asq.online/manga/one-piece/">One Piece</a></h4></div>
            <div class="post-on font-meta"><span>26 سبتمبر، 2026</span></div>
            <div class="chapter-item ">
                <span class="chapter "><a href="https://3asq.online/manga/one-piece/1194/">1194</a></span>
                <span class="chapter "><a href="https://3asq.online/manga/one-piece/1193/">1193</a></span>
            </div>
        </div></div>
    </div>
</div>
<div class="slider__item ">
    <div class="item__wrap ">
        <div class="slider__thumb"><div class="slider__thumb_item c-image-hover">
            <span class="manga-title-badges hot badge-round"><span class="text">3asq</span></span>
            <a href="https://3asq.online/manga/hunter-x-hunter/">
                <img width="125" height="180" src="https://3asq.online/wp-content/uploads/2019/03/cover_250x350-125x180.jpg" class="img-responsive" alt="cover_250x350"/>
            </a>
        </div></div>
        <div class="slider__content"><div class="slider__content_item">
            <div class="post-title font-title"><h4><a href="https://3asq.online/manga/hunter-x-hunter/">Hunter X Hunter</a></h4></div>
            <div class="chapter-item "><span class="chapter "><a href="https://3asq.online/manga/hunter-x-hunter/410/">410</a></span></div>
        </div></div>
    </div>
</div>
</div></div></div>
<div class="c-blog__heading style-2 font-heading "><h1 class="h4">أحدث الفصول</h1></div>
<div id="loop-content" class="page-content-listing item-default "><div class="page-listing-item"><div class="row row-eq-height">
<div class="col-12 col-md-4 badge-pos-1">
    <div class="page-item-detail manga  ">
        <div id="manga-item-23659" class="item-thumb hover-details c-image-hover" data-post-id="23659">
            <a href="https://3asq.online/manga/dig-it/" title="Dig It">
                <img width="175" height="238" src="https://3asq.online/wp-content/uploads/2026/09/dig-175x238.jpg" class="img-responsive" alt="dig"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5">
                <a href="https://x.com/Almubd3_Sama" target="_blank"><span class="manga-title-badges custom badge-round"><span class="text">ICE CREAM</span></span></a>
                <a href="https://3asq.online/manga/dig-it/">Dig It</a>
            </h3></div>
            <div class="meta-item rating"><div class="post-total-rating allow_vote"><i class="ion-ios-star ratings_stars rating_current"></i><span class="score font-meta total_votes">5</span></div></div>
            <div class="list-chapter">
                <div class="chapter-item ">
                    <span class="chapter font-meta"><a href="https://3asq.online/manga/dig-it/15-5/" class="btn-link"> 15.5 </a></span>
                    <span class="post-on font-meta"><span class="timediff">منذ 3 ساعات</span><span class="views"><i class="fa fa-eye"></i> 23</span></span>
                </div>
            </div>
        </div>
    </div><!-- .page-item-detail -->
</div>
<div class="col-12 col-md-4 badge-pos-1">
    <div class="page-item-detail manga  ">
        <div id="manga-item-23678" class="item-thumb hover-details c-image-hover" data-post-id="23678">
            <a href="https://3asq.online/manga/haha-to-iu-jubaku/" title="Haha to Iu Jubaku">
                <img width="175" height="238" src="data:image/gif;base64,R0lGOD" data-src="https://3asq.online/wp-content/uploads/2026/09/picsart-175x238.jpg" class="img-responsive" alt="picsart"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5"><a href="https://3asq.online/manga/haha-to-iu-jubaku/">Haha to Iu Jubaku</a></h3></div>
            <div class="list-chapter"><div class="chapter-item ">
                <span class="chapter font-meta"><a href="https://3asq.online/manga/haha-to-iu-jubaku/1/" class="btn-link"> 1 </a></span>
                <span class="post-on font-meta"><span class="timediff">منذ ساعة</span></span>
            </div></div>
        </div>
    </div><!-- .page-item-detail -->
</div>
</div></div></div>`;

const POPULAR = `
<div class="row row-eq-height">
<div class="col-12 col-md-6 badge-pos-1">
    <div class="page-item-detail manga  ">
        <div id="manga-item-1965" class="item-thumb hover-details c-image-hover" data-post-id="1965">
            <a href="https://3asq.online/manga/one-piece/" title="One Piece">
                <img width="175" height="238" src="https://3asq.online/wp-content/uploads/2019/04/v1-1-175x238.jpg" class="img-responsive" alt="v1"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5">
                <span class="manga-title-badges hot badge-round"><span class="text">3asq</span></span>
                <a href="https://3asq.online/manga/one-piece/">One Piece</a>
            </h3></div>
            <div class="meta-item rating"><div class="post-total-rating allow_vote"><span class="score font-meta total_votes">4.7</span></div></div>
            <div class="list-chapter"><div class="chapter-item ">
                <span class="chapter font-meta"><a href="https://3asq.online/manga/one-piece/1194/" class="btn-link"> 1194 </a></span>
                <span class="post-on font-meta"><span class="timediff">26 سبتمبر، 2026</span><span class="views"><i class="fa fa-eye"></i> 57,626</span></span>
            </div></div>
        </div>
    </div><!-- .page-item-detail -->
</div>
<div class="col-12 col-md-6 badge-pos-1">
    <div class="page-item-detail manga  ">
        <div id="manga-item-1901" class="item-thumb hover-details c-image-hover" data-post-id="1901">
            <a href="https://3asq.online/manga/berserk/" title="Berserk">
                <img width="175" height="238" src="https://3asq.online/wp-content/uploads/2019/04/00-175x238.jpg" class="img-responsive" alt="00"/>
            </a>
        </div>
        <div class="item-summary">
            <div class="post-title font-title"><h3 class="h5"><a href="https://3asq.online/manga/berserk/">Berserk</a></h3></div>
            <div class="meta-item rating"><div class="post-total-rating allow_vote"><span class="score font-meta total_votes">5</span></div></div>
            <div class="list-chapter"><div class="chapter-item ">
                <span class="chapter font-meta"><a href="https://3asq.online/manga/berserk/380/" class="btn-link"> 380 </a></span>
            </div></div>
        </div>
    </div><!-- .page-item-detail -->
</div>
</div>`;

const SEARCH = `
<div class="row c-tabs-item__content">
    <div class="col-4 col-md-2">
        <div class="tab-thumb c-image-hover">
            <a href="https://3asq.online/manga/one-piece-french/" title="One Piece (French)">
                <img width="193" height="278" src="https://3asq.online/wp-content/uploads/2019/04/v1-1-193x278.jpg" class="img-responsive" alt="v1"/>
            </a>
        </div>
    </div>
    <div class="col-8 col-md-10">
        <div class="tab-summary">
            <div class="post-title"><h3 class="h4"><a href="https://3asq.online/manga/one-piece-french/">One Piece (French)</a></h3></div>
            <div class="post-content">
                <div class="post-content_item mg_status nofloat">
                    <div class="summary-heading"><h5>الحالة</h5></div>
                    <div class="summary-content">
                        مستمرة                            </div>
                </div>
            </div>
        </div>
        <div class="tab-meta">
            <div class="meta-item latest-chap">
                <span class="font-meta">أحدث فصل </span>
                <span class="font-meta chapter"><a href="https://3asq.online/manga/one-piece-french/1109/">1109</a></span>
            </div>
            <div class="meta-item rating"><div class="post-total-rating allow_vote"><span class="score font-meta total_votes">4.3</span></div></div>
        </div>
    </div>
</div>
<div class="row c-tabs-item__content">
    <div class="col-4 col-md-2">
        <div class="tab-thumb c-image-hover">
            <a href="https://3asq.online/manga/one-piece-english/" title="One Piece (English)">
                <img width="193" height="278" data-src="https://3asq.online/wp-content/uploads/2019/04/v1-1-125x180.jpg" src="data:image/gif;base64,R0lGOD" class="img-responsive" alt="v1"/>
            </a>
        </div>
    </div>
    <div class="col-8 col-md-10">
        <div class="tab-summary">
            <div class="post-title"><h3 class="h4"><a href="https://3asq.online/manga/one-piece-english/">One Piece (English)</a></h3></div>
            <div class="post-content">
                <div class="post-content_item mg_status nofloat"><div class="summary-heading"><h5>الحالة</h5></div><div class="summary-content">مكتملة</div></div>
            </div>
        </div>
        <div class="tab-meta">
            <div class="meta-item latest-chap">
                <span class="font-meta">أحدث فصل </span>
                <span class="font-meta chapter"><a href="https://3asq.online/manga/one-piece-english/chapter0/">chapter0</a></span>
            </div>
        </div>
    </div>
</div>`;

const DETAIL = `
<div class="post-1965 wp-manga type-wp-manga status-publish">
<div class="profile-manga summary-layout-2">
    <div class="post-title">
        <span class="manga-title-badges hot badge-round"><span class="text">3asq</span></span>
        <h1>
            One Piece                    </h1>
    </div>
    <div class="tab-summary ">
        <div class="summary_image">
            <a href="https://3asq.online/manga/one-piece/">
                <img width="1304" height="2048" src="https://3asq.online/wp-content/uploads/2019/04/v1-1.jpg" class="img-responsive" alt="v1"/>        </a>
        </div>
<div class="summary_content_wrap">
    <div class="summary_content">
        <div class="post-content">
             <div class="post-rating">
	<div class="post-total-rating allow_vote"><i class="ion-ios-star ratings_stars rating_current"></i><span class="score font-meta total_votes">4.7</span></div></div>
<div class="post-content_item">
	<div class="summary-heading"><h5>التقييم</h5></div>
	<div class="summary-content vote-details" vocab="https://schema.org/"><span> متوسط <span property="ratingValue" id="averagerate"> 4.7</span> </span> من مجموع <span id="countrate">14252</span> صوت	</div>
</div>
<div class="post-content_item">
	<div class="summary-heading"><h5>الكاتب</h5></div>
	<div class="summary-content">
		<div class="author-content">
			<a href="https://3asq.online/manga-author/eiichiro-oda/" rel="tag">Eiichiro Oda</a>		</div>
	</div>
</div>
<div class="post-content_item">
	<div class="summary-heading"><h5>التصنيفات</h5></div>
	<div class="summary-content">
		<div class="genres-content">
			<a href="https://3asq.online/manga-genre/action/" rel="tag">أكشن</a>, <a href="https://3asq.online/manga-genre/fantasy/" rel="tag">خيال</a>, <a href="https://3asq.online/manga-genre/adventure/" rel="tag">مغامرة</a>		</div>
	</div>
</div>
<div class="post-content_item">
	<div class="summary-heading"><h5>النوع</h5></div>
	<div class="summary-content">مانجا</div>
</div>
<div class="post-status">
<div class="post-content_item">
	<div class="summary-heading"><h5>سنة الإصدار</h5></div>
	<div class="summary-content"><a href="https://3asq.online/manga-release/1997/" rel="tag">1997</a>	</div>
</div>
<div class="post-content_item">
	<div class="summary-heading"><h5>الحالة</h5></div>
	<div class="summary-content">
		مستمرة	</div>
</div>
</div>
<div class="manga-excerpt summary__content show-more">
    <p>تتمحور القصة حول مغامرات طاقم قراصنة قبعة القش بقيادة مونكي دي لوفي.</p>
</div>
        </div>
    </div>
</div>
    </div>
</div>
</div>`;

const CHAPTERS = `
<div class="page-content-listing single-page"><div class="listing-chapters_wrap cols-1  ">
<ul class="main version-chap no-volumn">
<li class="wp-manga-chapter    ">
    <a href="https://3asq.online/manga/one-piece/1194/">1194 - مغامرة جديدة</a>
    <span class="chapter-release-date"><span class="timediff"><i>26 سبتمبر، 2026</i></span><span class="views"><i class="fa fa-eye"></i> 57,632</span></span>
</li>
<li class="wp-manga-chapter    ">
    <a href="https://3asq.online/manga/one-piece/1193/">1193 - بداية المعركة</a>
    <span class="chapter-release-date"><span class="timediff"><i>10 سبتمبر، 2026</i></span></span>
</li>
<li class="wp-manga-chapter    ">
    <a href="https://3asq.online/manga/one-piece/24.1/">24.1</a>
</li>
<li class="wp-manga-chapter    ">
    <a href="https://3asq.online/manga/one-piece/خاص/">خاص</a>
</li>
</ul>
</div></div>`;

const CHAPTER = `
<div class="entry-content"><img src="https://3asq.online/wp-content/uploads/2020/01/logo.png" class="site-logo"/>
<div class="reading-content">
    <input type="hidden" id="wp-manga-current-chap" data-id="22560" value="1194"/>
    <div class="page-break ">
        <img id="image-0" src=" /wp-content/uploads/WP-manga/data/manga_5ca2daf920c76/f324d297/1194_01.jpg" class="wp-manga-chapter-img">
    </div>
    <div class="page-break ">
        <img id="image-1" src="data:image/gif;base64,R0lGOD" data-src="https://3asq.online/wp-content/uploads/WP-manga/data/manga_5ca2daf920c76/f324d297/1194_02.jpg" class="wp-manga-chapter-img">
    </div>
</div>
<div class="manga-discussion"><img src="https://3asq.online/wp-content/uploads/2026/10/avatar-150x150.jpeg" class="avatar avatar-60 photo"/></div>`;

async function main() {
  // Home: carousel → featured, latest rail → "latest" section, popular listing
  // → "ranked" section.
  const home = parseAsqHome(HOME, POPULAR);
  assert.equal(home.featured.length, 2);
  assert.equal(home.featured[0]?.title, "One Piece");
  assert.equal(home.featured[0]?.id, "https://3asq.online/manga/one-piece/");
  assert.equal(home.featured[0]?.cover, "https://3asq.online/wp-content/uploads/2019/04/v1-1-125x180.jpg");
  assert.equal(home.featured[0]?.latest, "الفصل 1194");
  assert.equal(home.featured[1]?.title, "Hunter X Hunter");
  assert.deepEqual(home.sections.map((s) => [s.id, s.kind]), [
    ["latest", "latest"],
    ["popular", "ranked"],
  ]);
  const homeLatest = home.sections[0]!;
  assert.equal(homeLatest.items.length, 2);
  assert.equal(homeLatest.items[0]?.title, "Dig It");
  assert.equal(homeLatest.items[0]?.id, "https://3asq.online/manga/dig-it/");
  assert.equal(homeLatest.items[0]?.latest, "الفصل 15.5");
  assert.equal(homeLatest.items[0]?.rating, "5");
  assert.equal(homeLatest.items[1]?.cover, "https://3asq.online/wp-content/uploads/2026/09/picsart-175x238.jpg");
  const homePopular = home.sections[1]!;
  assert.equal(homePopular.items[0]?.title, "One Piece");
  assert.equal(homePopular.items[0]?.rating, "4.7");
  assert.equal(homePopular.items[0]?.latest, "الفصل 1194");

  // Without the carousel, featured backfills from the latest rail.
  const noCarousel = parseAsqHome(`
    <div class="page-item-detail manga  "><div class="item-thumb"><a href="https://3asq.online/manga/solo/"><img src="https://3asq.online/c.jpg"/></a></div>
    <div class="post-title"><h3><a href="https://3asq.online/manga/solo/">Solo</a></h3></div>
    <div class="list-chapter"><div class="chapter-item"><span class="chapter"><a href="https://3asq.online/manga/solo/3/">3</a></span></div></div></div>`);
  assert.equal(noCarousel.featured.length, 1);
  assert.equal(noCarousel.featured[0]?.title, "Solo");
  assert.equal(parseAsqFeatured("").length, 0);

  // Search rows.
  const found = parseAsqSearch(SEARCH);
  assert.equal(found.length, 2);
  assert.equal(found[0]?.title, "One Piece (French)");
  assert.equal(found[0]?.id, "https://3asq.online/manga/one-piece-french/");
  assert.equal(found[0]?.status, "مستمر");
  assert.equal(found[0]?.rating, "4.3");
  assert.equal(found[0]?.latest, "الفصل 1109");
  assert.equal(found[1]?.status, "مكتمل");
  assert.equal(found[1]?.cover, "https://3asq.online/wp-content/uploads/2019/04/v1-1-125x180.jpg");

  // Detail metadata.
  const id = "https://3asq.online/manga/one-piece/";
  const detail = parseAsqDetail(DETAIL, id, CHAPTERS);
  assert.equal(detail.title, "One Piece");
  assert.equal(detail.id, id);
  assert.equal(detail.cover, "https://3asq.online/wp-content/uploads/2019/04/v1-1.jpg");
  assert.deepEqual(detail.genres, ["أكشن", "خيال", "مغامرة"]);
  assert.equal(detail.status, "مستمر");
  assert.equal(detail.type, "مانجا");
  assert.equal(detail.rating, "4.7");
  assert.equal(detail.author, "Eiichiro Oda");
  assert.equal(detail.year, "1997");
  assert.ok(detail.synopsis?.includes("قراصنة قبعة القش"));

  // Chapters: newest-first as served, numbers intact, absolute ids.
  assert.deepEqual(detail.chapters.map((c) => c.number), ["1194", "1193", "24.1", "خاص"]);
  assert.equal(detail.chapters[0]?.id, "https://3asq.online/manga/one-piece/1194/");
  assert.equal(detail.chapters[0]?.title, "مغامرة جديدة");
  assert.equal(detail.chapters[0]?.date, "26 سبتمبر، 2026");
  assert.equal(detail.chapters[2]?.title, null);
  assert.equal(parseAsqDetail(DETAIL, id).chapters.length, 0);
  assert.deepEqual(parseAsqChapters(""), []);

  // Reader: ordered absolute pages, data-src preferred, junk filtered.
  const base = "https://3asq.online/manga/one-piece/1194/";
  const reader = parseAsqChapter(CHAPTER, base);
  assert.deepEqual(reader.pages, [
    "https://3asq.online/wp-content/uploads/WP-manga/data/manga_5ca2daf920c76/f324d297/1194_01.jpg",
    "https://3asq.online/wp-content/uploads/WP-manga/data/manga_5ca2daf920c76/f324d297/1194_02.jpg",
  ]);

  assert.deepEqual(parseAsqChapter(`<div class="reading-content">
    <img class="wp-manga-chapter-img" src="data:image/gif;base64,x" data-lazy-src="/page-1.jpg?token=abc&amp;x=2">
    <img class="wp-manga-chapter-img" data-original="/page-2.jpg">
    <img class="wp-manga-chapter-img" data-srcset="/small.jpg 400w, /large.jpg 1600w">
  </div>`, base).pages, ["https://3asq.online/page-1.jpg?token=abc&x=2", "https://3asq.online/page-2.jpg", "https://3asq.online/large.jpg"]);

  // Madara query builder: empty text = whole catalog, filters map to the
  // site's own advanced-search params (verified live on 3asq), page N uses
  // /page/N/. This is what powers "search by filter only".
  assert.equal(madaraSearchPath("", [], undefined, 1), "/?s=&post_type=wp-manga");
  assert.equal(
    madaraSearchPath("one piece", ["action"], { status: "مستمر", sort: "latest" }, 2),
    "/page/2/?s=one%20piece&post_type=wp-manga&genre%5B%5D=action&status%5B%5D=on-going&m_orderby=latest",
  );
  assert.equal(
    madaraSearchPath("", [], { status: "معلق", sort: "title" }, 1),
    "/?s=&post_type=wp-manga&status%5B%5D=on-hold&m_orderby=alphabet",
  );
  // Unknown statuses/sorts are omitted instead of producing a broken query.
  assert.equal(madaraSearchPath("", [], { status: "أي شيء" }, 1), "/?s=&post_type=wp-manga");
  // Mangalik type filter rides the genre taxonomy with op=1 (AND) so a genre
  // selection can't widen the results into OR semantics.
  assert.equal(
    madaraSearchPath("", [], undefined, 1, "مانهوا"),
    "/?s=&post_type=wp-manga&genre%5B%5D=%D9%85%D8%A7%D9%86%D9%87%D9%88%D8%A7&op=1",
  );
  assert.equal(
    madaraSearchPath("", ["action"], { status: "مستمر" }, 1, "مانجا"),
    "/?s=&post_type=wp-manga&genre%5B%5D=action&genre%5B%5D=%D9%85%D8%A7%D9%86%D8%AC%D8%A7&op=1&status%5B%5D=on-going",
  );

  // Parsing must never throw on missing fields.
  assert.deepEqual(parseAsqHome(""), { featured: [], sections: [] });
  assert.deepEqual(parseAsqSearch(""), []);
  const blankDetail = parseAsqDetail("", id);
  assert.equal(blankDetail.title, "");
  assert.deepEqual(blankDetail.genres, []);
  assert.deepEqual(blankDetail.chapters, []);
  assert.deepEqual(parseAsqChapter("", base), { pages: [] });

  console.log("asq source tests passed");
}

void main();
