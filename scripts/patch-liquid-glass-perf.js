// react-native-liquid-glassmorphism captures the whole window with a software
// draw on EVERY frame something behind the glass moves (i.e. every scroll
// frame). Measured on the emulator, scrolling Home: 28–39% janky frames with
// the stock capture vs 1.9% without glass. Patch the installed Android source
// after every npm install:
//
//  1. captureScale 2 → 3: ~2.25x fewer pixels per capture. The backdrop is
//     blurred anyway; 3 keeps the refraction readable (4 got muddy).
//  2. REGION capture: instead of software-drawing the whole window, each glass
//     view registers its on-screen rect (+ a margin for blur/refraction) and
//     the shared capture draws the root once per merged region, clipped. Glass
//     covers small strips (top bar, tab bar, a few buttons), so most drawing is
//     clipped away.
//
// Deliberately NOT throttled: an earlier version captured at most every 40ms,
// which made the glass backdrop visibly lag behind the content while scrolling
// (it "caught up" a moment later). Every frame is captured.
//
// Idempotent: re-running on an already-patched file is a no-op.

const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(
  __dirname, "..", "node_modules", "react-native-liquid-glassmorphism",
  "android", "src", "main", "java", "com", "liquidglassmorphism",
);
const viewFile = path.join(dir, "LiquidGlassmorphismView.kt");
const sharedFile = path.join(dir, "SharedBackdrop.kt");

if (!fs.existsSync(viewFile) || !fs.existsSync(sharedFile)) {
  console.warn(`[patch-liquid-glass-perf] sources not found, skipping: ${dir}`);
  process.exit(0);
}

function patch(file, edits) {
  let src = fs.readFileSync(file, "utf8");
  if (src.includes("PANTOUFA_PERF_PATCH")) return false;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`[patch-liquid-glass-perf] anchor not found in ${path.basename(file)}:\n${from}`);
    src = src.replace(from, to);
  }
  fs.writeFileSync(file, src);
  return true;
}

const viewPatched = patch(viewFile, [
  [
    "  private val captureScale = 2\n",
    "  private val captureScale = 3 // PANTOUFA_PERF_PATCH (was 2)\n",
  ],
  [
    "    val failure = cap.captureIfNeeded(root, root.drawingTime)\n",
    "    // PANTOUFA_PERF_PATCH: register where this glass sits (root coords) so the\n" +
    "    // shared capture only software-draws the regions behind glass.\n" +
    "    getLocationInWindow(locThis)\n" +
    "    root.getLocationInWindow(locRoot)\n" +
    "    val rl = locThis[0] - locRoot[0]\n" +
    "    val rt = locThis[1] - locRoot[1]\n" +
    "    cap.updateRegion(this, rl, rt, rl + width, rt + height)\n" +
    "    val failure = cap.captureIfNeeded(root, root.drawingTime)\n",
  ],
]);

const sharedPatched = patch(sharedFile, [
  [
    "import android.graphics.Color\n",
    "import android.graphics.Color\n" +
    "import android.graphics.Rect\n" +
    "import android.os.SystemClock\n",
  ],
  [
    "  /** Live glass views under this root. The bitmap dies with the last one. */\n",
    "  // PANTOUFA_PERF_PATCH: per-view regions [l, t, r, b, stampMs] in root px.\n" +
    "  private val regions = WeakHashMap<View, LongArray>()\n" +
    "  private val regionMarginPx = 96 // blur + refraction sample outside the view\n" +
    "  private val regionTtlMs = 600L // drop paused / off-screen views' regions\n" +
    "\n" +
    "  fun updateRegion(v: View, l: Int, t: Int, r: Int, b: Int) {\n" +
    "    val now = SystemClock.uptimeMillis()\n" +
    "    val a = regions[v]\n" +
    "    if (a == null) regions[v] = longArrayOf(l.toLong(), t.toLong(), r.toLong(), b.toLong(), now)\n" +
    "    else { a[0] = l.toLong(); a[1] = t.toLong(); a[2] = r.toLong(); a[3] = b.toLong(); a[4] = now }\n" +
    "  }\n" +
    "\n" +
    "  /** Fresh regions, inflated by the margin, clamped and merged where they overlap. */\n" +
    "  private fun mergedRegions(rootW: Int, rootH: Int): List<Rect> {\n" +
    "    val now = SystemClock.uptimeMillis()\n" +
    "    val out = ArrayList<Rect>()\n" +
    "    for (a in regions.values) {\n" +
    "      if (now - a[4] > regionTtlMs) continue\n" +
    "      val r = Rect(\n" +
    "        (a[0].toInt() - regionMarginPx).coerceAtLeast(0),\n" +
    "        (a[1].toInt() - regionMarginPx).coerceAtLeast(0),\n" +
    "        (a[2].toInt() + regionMarginPx).coerceAtMost(rootW),\n" +
    "        (a[3].toInt() + regionMarginPx).coerceAtMost(rootH),\n" +
    "      )\n" +
    "      if (r.width() > 0 && r.height() > 0) out.add(r)\n" +
    "    }\n" +
    "    var merged = true\n" +
    "    while (merged) {\n" +
    "      merged = false\n" +
    "      loop@ for (i in out.indices) for (j in i + 1 until out.size) {\n" +
    "        if (Rect.intersects(out[i], out[j])) { out[i].union(out[j]); out.removeAt(j); merged = true; break@loop }\n" +
    "      }\n" +
    "    }\n" +
    "    return out\n" +
    "  }\n" +
    "\n" +
    "  /** Live glass views under this root. The bitmap dies with the last one. */\n",
  ],
  [
    "      root.draw(c)\n      null\n",
    "      // PANTOUFA_PERF_PATCH: draw only behind glass (whole root as fallback).\n" +
    "      val parts = mergedRegions(root.width, root.height)\n" +
    "      if (parts.isEmpty()) {\n" +
    "        root.draw(c)\n" +
    "      } else {\n" +
    "        for (part in parts) {\n" +
    "          c.save()\n" +
    "          c.clipRect(part)\n" +
    "          root.draw(c)\n" +
    "          c.restore()\n" +
    "        }\n" +
    "      }\n" +
    "      null\n",
  ],
]);

console.log(
  `[patch-liquid-glass-perf] view: ${viewPatched ? "applied" : "already applied"}, ` +
    `shared: ${sharedPatched ? "applied" : "already applied"}`,
);
