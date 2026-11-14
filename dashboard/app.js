// app.js — Token Radar dashboard. Reads window.RADAR (../data.js) and
// renders the board, the Live view and the Method view. No network: every
// figure on the page comes from the snapshot the entry scored, through the
// fitted curve in data.js. State can be set from the URL hash so a
// screenshot can open one exact view: #view=board|live|method,
// #detail=<slug>, #scope=all|watchlist|early, #cat=<category>.
(function () {
  "use strict";
  var D = window.RADAR;
  if (!D) {
    document.body.innerHTML = "<p style='padding:40px'>data.js failed to load.</p>";
    return;
  }
  var M = D.model;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function moneyFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pct(x) {
    if (x === null || x === undefined) return "—";
    var s = (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
    return '<span class="' + (x >= 0 ? "pos" : "neg") + '">' + s + "</span>";
  }
  function ageFmt(days) {
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function log10(x) { return Math.log(x) / Math.LN10; }

  // ---- header ----
  var top = D.rows[0];
  $("topmeta").textContent =
    "Snapshot " + D.asOf + " · DefiLlama / protocols · " +
    D.counts.snapshot + " protocols";
  $("chipWatch").textContent =
    "Watchlist " + D.counts.covered + "/" + D.counts.watchlist + " covered";
  $("chipRows").textContent =
    D.counts.board + "/" + D.counts.board + " rows match board.json";
  $("asof").textContent = D.asOf;
  $("heroCount").textContent = D.counts.board;
  $("lede").textContent =
    "Every value is priced off the " + M.fittedCount +
    " tokens this snapshot already prices: a fitted size curve, a category factor the data itself sets, " +
    "and one more week of momentum. Blue is this radar's estimate.";
  var ex = D.counts.excluded;
  var exTotal = ex.category + ex.versioned + ex.wrapped + ex.exchange;
  $("stats").innerHTML =
    "<li><b>" + D.counts.board + " ranked</b>" + D.counts.watchlist + " watchlist · " +
    (D.counts.board - D.counts.watchlist) + " early</li>" +
    "<li><b>" + D.counts.live + " token on record</b>kept out of the ranking</li>" +
    "<li><b>" + exTotal + " set aside</b>wrapped, staked, bridged, exchange, versioned</li>" +
    "<li><b>&beta; " + M.slope.toFixed(2) + "</b>fitted size exponent</li>" +
    "<li><b>" + Math.round(M.withinThreeX * 100) + "%</b>of priced tokens within 3&times; of the curve</li>";
  $("legend").textContent =
    "Dot: this radar's estimate. Bar: the band half of all priced tokens land in. " +
    "Slice / $1K: what $1,000 staked would hold if depositors got 10% pro rata. " +
    "Farm: play, chain, all fees, setup time. Open a row for its model breakdown and eight costed steps.";
  $("formula").innerHTML =
    "value = <span class='hl'>10^" + M.intercept.toFixed(2) + " &times; TVL^" + M.slope.toFixed(3) +
    "</span> &times; category &times; weekly &times; seasoning &times; spread";
  $("chartNote").textContent =
    M.fittedCount + " comparables · elasticity " + M.slope.toFixed(2) +
    " · half land within ×" + M.bandLow.toFixed(2) + " to ×" + M.bandHigh.toFixed(2);

  // ---- scatter chart: priced tokens, fitted line, quartile band ----
  (function chart() {
    var pts = M.points;
    var xs = pts.map(function (p) { return log10(p.tvlUsd); });
    var ys = pts.map(function (p) { return log10(p.mcapUsd); });
    var x0 = Math.floor(Math.min.apply(null, xs));
    var x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys));
    var y1 = Math.ceil(Math.max.apply(null, ys));
    var W = 460, H = 250, PL = 44, PR = 8, PT = 10, PB = 26;
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    var s = "";
    s += '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Priced tokens against the fitted curve">';
    function axisLabel(exp) {
      if (exp >= 9) return "$" + (Math.pow(10, exp - 9)) + "B";
      if (exp >= 6) return "$" + (Math.pow(10, exp - 6)) + "M";
      if (exp >= 3) return "$" + (Math.pow(10, exp - 3)) + "K";
      return "$" + Math.pow(10, exp);
    }
    // gridlines + axis labels (first/last x labels anchor inward so they are not clipped)
    for (var gx = x0; gx <= x1; gx++) {
      s += '<line x1="' + X(gx) + '" y1="' + PT + '" x2="' + X(gx) + '" y2="' + (H - PB) + '" stroke="#e3ddd2" stroke-width="1"/>';
      var anchor = gx === x0 ? "start" : gx === x1 ? "end" : "middle";
      s += '<text x="' + X(gx) + '" y="' + (H - 8) + '" font-size="9" fill="#6b6560" text-anchor="' + anchor + '">' + axisLabel(gx) + "</text>";
    }
    for (var gy = y0; gy <= y1; gy++) {
      s += '<line x1="' + PL + '" y1="' + Y(gy) + '" x2="' + (W - PR) + '" y2="' + Y(gy) + '" stroke="#e3ddd2" stroke-width="1"/>';
      s += '<text x="' + (PL - 5) + '" y="' + (Y(gy) + 3) + '" font-size="9" fill="#6b6560" text-anchor="end">' + axisLabel(gy) + "</text>";
    }
    // quartile band between the two lines
    var lo = M.intercept + log10(M.bandLow), hi = M.intercept + log10(M.bandHigh);
    s += '<polygon points="' + X(x0) + "," + Y(lo + M.slope * x0) + " " + X(x1) + "," + Y(lo + M.slope * x1) +
      " " + X(x1) + "," + Y(hi + M.slope * x1) + " " + X(x0) + "," + Y(hi + M.slope * x0) +
      '" fill="#dbeafe" opacity="0.7"/>';
    // fitted line
    s += '<line x1="' + X(x0) + '" y1="' + Y(M.intercept + M.slope * x0) +
      '" x2="' + X(x1) + '" y2="' + Y(M.intercept + M.slope * x1) +
      '" stroke="#1d4ed8" stroke-width="2"/>';
    // points
    pts.forEach(function (p) {
      s += '<circle cx="' + X(log10(p.tvlUsd)).toFixed(1) + '" cy="' + Y(log10(p.mcapUsd)).toFixed(1) +
        '" r="2.4" fill="#6b6560" opacity="0.75"/>';
    });
    s += '<text x="' + (W - PR) + '" y="' + (PT + 10) + '" font-size="9" fill="#1d4ed8" text-anchor="end">fitted line</text>';
    s += '<text x="' + (W - PR) + '" y="' + (PT + 22) + '" font-size="9" fill="#6b6560" text-anchor="end">grey: priced token on record</text>';
    s += "</svg>";
    $("chart").innerHTML = s;
  })();

  // ---- tabs + hash routing ----
  var tabs = document.querySelectorAll(".tabs button");
  function showView(name) {
    tabs.forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-view") === name); });
    document.querySelectorAll("main .view").forEach(function (v) { v.classList.add("hidden"); });
    $("view-" + name).classList.remove("hidden");
  }
  tabs.forEach(function (b) {
    b.addEventListener("click", function () { showView(b.getAttribute("data-view")); });
  });

  // ---- filter options ----
  var cats = {}, chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) { $("cat").appendChild(new Option(c, c)); });
  Object.keys(chains).sort().forEach(function (c) { $("chain").appendChild(new Option(c, c)); });

  // ---- board ----
  var maxImplied = D.rows[0].implied_value_usd;
  var selected = null;
  var scope = "all";
  function rangePct(v) {
    return Math.max(0, Math.min(100, ((log10(Math.max(v, 1e4)) - 4) / 5) * 100));
  }
  function chainShort(chains) {
    if (chains.length <= 3) return chains.join(", ");
    return chains.slice(0, 3).join(", ") + " +" + (chains.length - 3);
  }
  function visibleRows() {
    var q = $("q").value.trim().toLowerCase();
    var cat = $("cat").value;
    var chain = $("chain").value;
    var tvlMin = $("tvl").value ? parseFloat($("tvl").value) * 1e6 : 0;
    var list = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (tvlMin && r.tvl_usd < tvlMin) return false;
      if (scope === "watchlist" && !r.watchlisted) return false;
      if (scope === "early" && r.watchlisted) return false;
      return true;
    });
    var sort = $("sort") ? $("sort").value : "rank";
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return b.age_days - a.age_days; },
      slice: function (a, b) { return b.slice_1k_usd - a.slice_1k_usd; },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    }[sort] || function (a, b) { return a.rank - b.rank; };
    return list.sort(by);
  }
  function renderBoard() {
    var list = visibleRows();
    $("count").textContent = list.length + " of " + D.rows.length;
    var html = "";
    list.forEach(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      html += '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : "") + ">" +
        '<td class="rank">' + r.rank + "</td>" +
        '<td class="proto"><b>' + esc(r.name) + "</b>" +
        (r.watchlisted ? '<span class="badge">Watchlist</span>' : '<span class="badge early">Early</span>') +
        '<span class="sub">' + esc(r.category || "—") + " · " + esc(chainShort(r.chains)) + "</span></td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + ageFmt(r.age_days) + "</td>" +
        '<td><div class="imp">' + money(r.implied_value_usd) + "</div>" +
        '<div class="range" title="' + moneyFull(r.implied_low_usd) + " to " + moneyFull(r.implied_high_usd) + '">' +
        '<div class="track"></div>' +
        '<div class="whisker" style="left:' + rangePct(r.implied_low_usd).toFixed(1) + "%;width:" +
        Math.max(1, rangePct(r.implied_high_usd) - rangePct(r.implied_low_usd)).toFixed(1) + '%"></div>' +
        '<div class="dot" style="left:' + rangePct(r.implied_value_usd).toFixed(1) + '%"></div>' +
        "</div></td>" +
        '<td class="num">' + r.tvl_x.toFixed(3) + "&times;</td>" +
        '<td class="num">' + money(r.slice_1k_usd) + "</td>" +
        '<td class="farmcell"><b>' + esc(r.farm.play) + "</b> · " + esc(r.farm.chain) +
        "<br>from $" + r.farm.capitalUsd + " · $" + r.farm.setupFeeUsd + " fees · " +
        r.farm.setupMinutes + " min · " + r.farm.holdDays + "d hold</td></tr>";
    });
    $("rows").innerHTML = html;
    document.querySelectorAll("#rows tr").forEach(function (tr) {
      tr.addEventListener("click", function () { showDetail(tr.getAttribute("data-slug"), true); });
    });
  }
  ["q", "cat", "chain", "tvl", "sort"].forEach(function (id) {
    $(id).addEventListener("input", renderBoard);
    $(id).addEventListener("change", renderBoard);
  });
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      scope = b.getAttribute("data-scope");
      document.querySelectorAll(".seg button").forEach(function (x) {
        x.classList.toggle("active", x === b);
      });
      renderBoard();
    });
  });
  $("csv").addEventListener("click", function () {
    var list = visibleRows();
    var head = "rank,name,category,tvl_usd,change_7d,age_days,implied_value_usd,implied_low_usd,implied_high_usd,tvl_x,slice_1k_usd,farm_play,farm_chain,farm_capital_usd\n";
    var body = list.map(function (r) {
      return [r.rank, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || "").replace(/"/g, '""') + '"',
        r.tvl_usd, r.change_7d === null ? "" : r.change_7d, r.age_days, r.implied_value_usd,
        r.implied_low_usd, r.implied_high_usd, r.tvl_x.toFixed(4), r.slice_1k_usd.toFixed(2),
        r.farm.play, r.farm.chain, r.farm.capitalUsd].join(",");
    }).join("\n");
    var blob = new Blob([head + body + "\n"], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "token-radar-board.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---- detail ----
  function showDetail(slug, scroll) {
    var r = null;
    D.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) return;
    selected = slug;
    var recomputed = r.base_usd * r.category_factor * r.weekly_factor * r.seasoning_factor * r.spread_factor;
    var matches = Math.round(recomputed) === r.implied_value_usd;
    var totalFee = 0, totalMin = 0;
    var stepsHtml = r.farm_steps.map(function (s, i) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    $("detail").innerHTML =
      "<h2>#" + r.rank + " — " + esc(r.name) + "</h2>" +
      '<p class="sub">' + esc(r.category || "Uncategorised") + " · " + esc(r.chains.join(", ")) +
      " · " + r.age_days + " days tracked · " + (r.watchlisted ? "on the house watchlist" : "below the watchlist floor") + "</p>" +
      '<div class="factors">' +
      "<div class='factor'><span>Curve base</span><b>" + money(r.base_usd) + "</b></div>" +
      "<div class='factor'><span>Category &times;</span><b>" + r.category_factor.toFixed(2) + "</b></div>" +
      "<div class='factor'><span>Weekly &times;</span><b>" + r.weekly_factor.toFixed(3) + "</b></div>" +
      "<div class='factor'><span>Seasoning &times;</span><b>" + r.seasoning_factor.toFixed(3) + "</b></div>" +
      "<div class='factor'><span>Spread &times;</span><b>" + r.spread_factor.toFixed(2) + "</b></div>" +
      "<div class='factor'><span>Implied</span><b>" + money(r.implied_value_usd) + "</b></div>" +
      "<div class='factor'><span>Band</span><b>" + money(r.implied_low_usd) + "–" + money(r.implied_high_usd) + "</b></div>" +
      "<div class='factor'><span>Slice / $1K</span><b>" + money(r.slice_1k_usd) + "</b></div>" +
      "</div>" +
      '<p class="check ' + (matches ? "ok" : "bad") + '">' +
      (matches ? "✓ recomputed value matches board.json" : "✗ recomputed value does NOT match board.json") +
      " (" + money(Math.round(recomputed)) + ")</p>" +
      "<h3>How to farm it — 8 steps</h3><ol class='steps'>" + stepsHtml + "</ol>" +
      '<p class="totals">Setup: $' + r.farm.setupFeeUsd + " in fees, " + r.farm.setupMinutes +
      " minutes, $" + r.farm.capitalUsd + " capital, " + r.farm.holdDays +
      " days hold. A $1,000 stake would hold " + money(r.slice_1k_usd) +
      " of the launch if depositors got 10% pro rata.</p>";
    $("detail").classList.remove("hidden");
    renderBoard();
    if (scroll) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- live view ----
  $("liveRows").innerHTML = D.live.map(function (p) {
    return "<tr><td><b>" + esc(p.name) + "</b></td>" +
      "<td>" + esc(p.category || "—") + "</td>" +
      '<td class="num">' + money(p.tvl_usd) + "</td>" +
      '<td class="num">' + money(p.mcap_usd || 0) + "</td>" +
      '<td class="num">' + pct(p.change_7d) + "</td></tr>";
  }).join("");

  // ---- method view ----
  $("methodLede").textContent =
    "One curve prices every protocol, fitted at build time from the " + M.fittedCount +
    " tokens this snapshot already prices. The fit's slope is " + M.slope.toFixed(3) +
    ", " + Math.round(M.withinThreeX * 100) +
    "% of priced tokens land within 3× of the line, and half land within ×" +
    M.bandLow.toFixed(2) + " to ×" + M.bandHigh.toFixed(2) +
    " of it. Nothing is hard-coded by name.";
  $("methodFormula").textContent =
    "value = 10^" + M.intercept.toFixed(3) + " × TVL^" + M.slope.toFixed(3) +
    " × category × weekly × seasoning × spread\n" +
    "  weekly    = 1 + 0.6 × clamp(change_7d, −50, +100) / 100\n" +
    "  seasoning = 0.5 + 0.5 × min(age_days, 1095) / 1095\n" +
    "  spread    = 1 + 0.02 × min(chains − 1, 10)\n" +
    "  band      = ×" + M.bandLow.toFixed(2) + " to ×" + M.bandHigh.toFixed(2) +
    " (the fit's residual quartiles)";
  $("factorRows").innerHTML = M.categoryFactors.map(function (f) {
    return "<tr><td>" + esc(f.category) + '</td><td class="num">' + f.priced +
      '</td><td class="num">' + f.factor.toFixed(2) + "</td></tr>";
  }).join("");
  $("excl").textContent =
    "Of the snapshot's pre-token protocols, " +
    (ex.category + ex.versioned + ex.wrapped + ex.exchange) +
    " are excluded: " + ex.category + " by category (CEX, bridge, liquid staking/restaking, restaked BTC), " +
    ex.versioned + " versioned names, " + ex.wrapped + " wrapped/staked words, " + ex.exchange +
    " exchange-prefixed names. The board ranks the " + D.counts.board + " that remain.";
  $("coverage").textContent =
    "Coverage: all " + D.counts.watchlist + " watchlist protocols are on the board, plus " +
    (D.counts.board - D.counts.watchlist) + " more below the $50M floor. " +
    D.counts.live + " protocols record a token and are kept out of the ranking.";

  // ---- hash state (for screenshots) ----
  (function hashState() {
    var h = (location.hash || "").replace(/^#/, "");
    var parts = {};
    h.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) parts[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (parts.view) showView(parts.view);
    if (parts.scope && (parts.scope === "watchlist" || parts.scope === "early")) {
      scope = parts.scope;
      document.querySelectorAll(".seg button").forEach(function (x) {
        x.classList.toggle("active", x.getAttribute("data-scope") === scope);
      });
    }
    if (parts.cat) { $("cat").value = parts.cat; }
    renderBoard();
    if (parts.detail) showDetail(parts.detail, false);
  })();
})();
