/* AvianVisitors - bird collage frontend.
 *
 * Three views over BirdNET-Pi detections:
 *   collage  - mask-packed cluster of species illustrations, sized by
 *              count. Layout normalises so every bird always fits on
 *              every viewport.
 *   stats    - per-species mark on a time x count plot.
 *   atlas    - grid of every species ever detected, with detail modal.
 *
 * Lives at $HOME/BirdNET-Pi/avian/frontend/ on the Pi; install_services.sh
 * symlinks $HOME/BirdNET-Pi/avian -> $EXTRACTED/avian, so this file loads
 * from http://birdnet.local/avian/frontend/apt.js with the collage at
 * http://birdnet.local/avian/ (via the redirect at /avian/index.html).
 *
 * All API calls are relative - they target the PHP shims in ../api/
 * served by BirdNET-Pi's existing Caddy + PHP-FPM stack. No frontend
 * configuration needed; works out of the box on any BirdNET-Pi host.
 */
(function () {
  'use strict';

  function api(action, qs) {
    return '../api/birdnet-api.php?action=' + action + (qs ? '&' + qs : '');
  }
  function media(file, qs) {
    return '../api/' + file + (qs ? '?' + qs : '');
  }
  var IMG_VERSION = '1';

  function readLS(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fetchJson(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u);
      return r.json();
    });
  }

  // ---- State ----
  var DATA = { recent: null, lifelist: null };
  var MASKS = null, DIMS = null;
  var currentHours = +readLS('av:window', '24') || 24;
  var currentView = +readLS('av:view', '0') || 0;

  // ---- Boot ----
  Promise.all([
    fetchJson('./masks.json').then(function (j) { MASKS = j; }),
    fetchJson('./dims.json').then(function (j) { DIMS = j; }),
  ]).then(function () {
    bindUI();
    refreshAll();
    setInterval(refreshRecent, 60000);
  }).catch(function (e) {
    console.error('boot failed', e);
    var c = document.getElementById('collage');
    if (c) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'collage failed to load: ' + e.message;
      c.appendChild(p);
    }
  });

  // ---- UI ----
  function $(id) { return document.getElementById(id); }
  function syncPill(container) {
    if (!container) return;
    var pill = container.querySelector('.seg-pill');
    var active = container.querySelector('button[aria-current="true"]');
    if (!pill || !active) return;
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }
  function syncAllPills() {
    [$('slider'), $('winPick'), $('atlasSort')].forEach(syncPill);
  }
  function setView(i) {
    i = Math.max(0, Math.min(2, i));
    currentView = i;
    writeLS('av:view', String(i));
    var views = $('views');
    if (views) views.style.transform = 'translateX(-' + (i * 100) + '%)';
    var slider = $('slider');
    if (slider) {
      [].slice.call(slider.querySelectorAll('button')).forEach(function (b) {
        b.setAttribute('aria-current', +b.dataset.i === i ? 'true' : 'false');
      });
      syncPill(slider);
    }
    if (i === 0) renderCollageFromData();
    if (i === 1) drawHistograms();
    if (i === 2) renderAtlas();
  }
  function bindUI() {
    var slider = $('slider');
    var winPick = $('winPick');
    var atlasEl = $('atlasSort');

    if (slider) [].slice.call(slider.querySelectorAll('button')).forEach(function (b) {
      b.addEventListener('click', function () { setView(+b.dataset.i); });
    });

    if (winPick) [].slice.call(winPick.querySelectorAll('button')).forEach(function (b) {
      b.setAttribute('aria-current', (+b.dataset.h === currentHours) ? 'true' : 'false');
      b.addEventListener('click', function () {
        [].slice.call(winPick.querySelectorAll('button')).forEach(function (x) {
          x.setAttribute('aria-current', x === b ? 'true' : 'false');
        });
        currentHours = +b.dataset.h;
        writeLS('av:window', String(currentHours));
        syncPill(winPick);
        refreshRecent();
      });
    });

    if (atlasEl) [].slice.call(atlasEl.querySelectorAll('button')).forEach(function (b) {
      b.addEventListener('click', function () {
        [].slice.call(atlasEl.querySelectorAll('button')).forEach(function (x) {
          x.setAttribute('aria-current', x === b ? 'true' : 'false');
        });
        writeLS('av:atlasSort', b.dataset.sort);
        syncPill(atlasEl);
        renderAtlas();
      });
    });

    var aboutLink = $('aboutLink');
    var aboutModal = $('about-modal');
    if (aboutLink && aboutModal) {
      aboutLink.addEventListener('click', function () { aboutModal.setAttribute('aria-hidden', 'false'); });
    }
    document.querySelectorAll('#about-modal [data-close]').forEach(function (el) {
      el.addEventListener('click', function () { aboutModal && aboutModal.setAttribute('aria-hidden', 'true'); });
    });

    // Alpha-mask hover hit-testing for the collage. .gtile is
    // pointer-events:none so the bounding boxes don't intercept events;
    // we sample the bird's pixel under the cursor instead.
    var collageEl = $('collage');
    if (collageEl) {
      collageEl.addEventListener('mousemove', function (e) { collageHover(e, collageEl); });
      collageEl.addEventListener('mouseleave', function () {
        document.querySelectorAll('.gtile.is-hover').forEach(function (t) { t.classList.remove('is-hover'); });
      });
      collageEl.addEventListener('click', function (e) { collageClick(e, collageEl); });
    }

    var rT;
    window.addEventListener('resize', function () {
      clearTimeout(rT);
      rT = setTimeout(function () {
        syncAllPills();
        renderCollageFromData();
        drawHistograms();
        var views = $('views');
        if (views) views.style.transform = 'translateX(-' + (currentView * 100) + '%)';
      }, 120);
    });

    // Initial view position + pill sync
    var views = $('views');
    if (views) views.style.transform = 'translateX(-' + (currentView * 100) + '%)';
    if (slider) [].slice.call(slider.querySelectorAll('button')).forEach(function (b) {
      b.setAttribute('aria-current', +b.dataset.i === currentView ? 'true' : 'false');
    });
    setTimeout(syncAllPills, 60);
  }

  // ---- Hover hit-testing: find which tile's mask is under the cursor ----
  // .gtile rectangles overlap, so :hover would light the wrong bird. We
  // walk the placed tiles topmost-first, transform the cursor into each
  // tile's mask space, and pick the one whose mask cell is "on".
  var lastHoverTile = null;
  function hitTest(e, container) {
    var rect = container.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var tiles = container.querySelectorAll('.gtile');
    for (var i = tiles.length - 1; i >= 0; i--) {
      var t = tiles[i];
      var bx = t.offsetLeft, by = t.offsetTop, bw = t.offsetWidth, bh = t.offsetHeight;
      if (x < bx || x > bx + bw || y < by || y > by + bh) continue;
      var slug = t.dataset.slug;
      var mask = MASKS && MASKS[slug];
      if (!mask) return t;
      var mx = ((x - bx) / bw * mask.w) | 0;
      var my = ((y - by) / bh * mask.h) | 0;
      var idx = my * mask.w + mx;
      var byte = atob(mask.bits).charCodeAt(idx >> 3);
      if ((byte >> (7 - (idx & 7))) & 1) return t;
    }
    return null;
  }
  function collageHover(e, container) {
    var hit = hitTest(e, container);
    if (hit === lastHoverTile) return;
    if (lastHoverTile) lastHoverTile.classList.remove('is-hover');
    if (hit) hit.classList.add('is-hover');
    lastHoverTile = hit;
    container.style.cursor = hit ? 'pointer' : 'default';
  }
  function collageClick(e, container) {
    var hit = hitTest(e, container);
    if (!hit) return;
    var sci = hit.dataset.sci;
    var record = ((DATA.recent && DATA.recent.species) || []).find(function (s) { return s.sci === sci; });
    if (record) openDetail(record);
  }

  // ---- Data fetch ----
  function refreshAll() {
    var h = currentHours;
    return Promise.all([
      fetchJson(api('lifelist')).catch(function () { return null; }),
      fetchJson(api('recent', 'hours=' + h)).catch(function () { return null; }),
    ]).then(function (parts) {
      DATA.lifelist = parts[0];
      if (parts[1] && h === currentHours) DATA.recent = parts[1];
      renderCollageFromData();
      drawHistograms();
      if (currentView === 2) renderAtlas();
    });
  }
  function refreshRecent() {
    var h = currentHours;
    return fetchJson(api('recent', 'hours=' + h)).then(function (j) {
      if (h !== currentHours) return;
      DATA.recent = j;
      renderCollageFromData();
      drawHistograms();
    }).catch(function () {});
  }

  // ---- Slug + mask helpers ----
  var maskCache = {};
  function loadMask(slug) {
    if (!MASKS) return null;
    if (maskCache[slug]) return maskCache[slug];
    var rec = MASKS[slug];
    if (!rec) return null;
    var bytes = atob(rec.bits);
    var w = rec.w, h = rec.h;
    var cells = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var b = bytes.charCodeAt(i >> 3);
        if ((b >> (7 - (i & 7))) & 1) cells.push([x, y]);
      }
    }
    return (maskCache[slug] = { w: w, h: h, cells: cells });
  }
  function slugify(sci) {
    return sci.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function aspect(sci) {
    var d = DIMS && DIMS[slugify(sci)];
    return d ? d[0] / d[1] : 1.4;
  }
  function imgUrl(sci, com) {
    return media('cutout.php', 'sci=' + encodeURIComponent(sci) +
      (com ? '&com=' + encodeURIComponent(com) : '') +
      '&v=' + IMG_VERSION);
  }

  // ---- Collage layout (mask-aware, viewport-budget) ----
  function tuning(n) {
    return {
      packingBudgetFrac: n <= 4 ? 0.46 : n <= 12 ? 0.40 : n <= 24 ? 0.34 : 0.28,
      countExp: 0.65,
      minTileAreaFrac: n <= 8 ? 0.0100 : n <= 20 ? 0.0075 : 0.0055,
      ellipseAspectBias: 2.1,
    };
  }
  var GRID_STRIDE = 4;

  function maskPack(tiles, W, H, ellipseBias) {
    var GW = Math.ceil(W / GRID_STRIDE) + 2;
    var GH = Math.ceil(H / GRID_STRIDE) + 2;
    var grid = new Uint8Array(GW * GH);

    function cellRange(t, tx, ty, c) {
      var sx = t.fullW / t.mask.w, sy = t.fullH / t.mask.h;
      var x0 = (tx + c[0] * sx) / GRID_STRIDE | 0;
      var y0 = (ty + c[1] * sy) / GRID_STRIDE | 0;
      var x1 = (tx + (c[0] + 1) * sx) / GRID_STRIDE | 0;
      var y1 = (ty + (c[1] + 1) * sy) / GRID_STRIDE | 0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      if (x1 >= GW) x1 = GW - 1; if (y1 >= GH) y1 = GH - 1;
      return [x0, y0, x1, y1];
    }
    function collides(t, tx, ty) {
      var cs = t.mask.cells;
      for (var i = 0; i < cs.length; i++) {
        var r = cellRange(t, tx, ty, cs[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) if (grid[off + gx]) return true;
        }
      }
      return false;
    }
    function stamp(t, tx, ty) {
      var cs = t.mask.cells;
      for (var i = 0; i < cs.length; i++) {
        var r = cellRange(t, tx, ty, cs[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) grid[off + gx] = 1;
        }
      }
    }

    var rand = mulberry32(0x9E3779B1);
    var placed = [];
    var comX = W / 2, comY = H / 2;
    tiles.sort(function (a, b) { return (b.fullW * b.fullH) - (a.fullW * a.fullH); });
    for (var ti = 0; ti < tiles.length; ti++) {
      var t = tiles[ti];
      var bestCost = Infinity, best = null;
      var rings = Math.max(W, H);
      for (var r = 0; r < rings; r += GRID_STRIDE * 2) {
        var step = Math.max(1, r * 0.05);
        var samples = r === 0 ? 1 : Math.max(8, Math.floor(r * 0.6));
        for (var s = 0; s < samples; s++) {
          var ang = (s / samples) * Math.PI * 2;
          var px = comX + Math.cos(ang) * r * ellipseBias - t.fullW / 2;
          var py = comY + Math.sin(ang) * r - t.fullH / 2;
          if (collides(t, px, py)) continue;
          var dxx = (px + t.fullW / 2 - comX);
          var dyy = (py + t.fullH / 2 - comY);
          var cost = Math.hypot(dxx / ellipseBias, dyy) + rand() * step * 0.5;
          if (cost < bestCost) { bestCost = cost; best = { x: px, y: py }; }
        }
        if (best && r > 0) break;
      }
      if (best) { t.x = best.x; t.y = best.y; stamp(t, best.x, best.y); placed.push(t); }
      else { t.x = -99999; t.y = -99999; placed.push(t); }
    }
    return placed;
  }
  function mulberry32(a) {
    return function () {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function renderCollageFromData() {
    renderCollage((DATA.recent && DATA.recent.species) || []);
  }
  function renderCollage(items) {
    var collage = $('collage');
    if (!collage) return;
    collage.innerHTML = '';
    if (!items.length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'no birds heard in this window.';
      collage.appendChild(p);
      return;
    }
    var W = collage.clientWidth, H = collage.clientHeight;
    if (!W || !H) { setTimeout(function () { renderCollage(items); }, 80); return; }

    var T = tuning(items.length);
    var vpArea = W * H;
    var budget = vpArea * T.packingBudgetFrac;
    var minArea = vpArea * T.minTileAreaFrac;

    var tiles = items.map(function (s) {
      var slug = slugify(s.sci || '');
      var mask = loadMask(slug);
      if (!mask) return null;
      var n = +s.n; if (!n || isNaN(n)) n = 1;
      return { mask: mask, data: s, slug: slug, ar: aspect(s.sci), score: Math.pow(Math.max(1, n), T.countExp) };
    }).filter(Boolean);

    if (!tiles.length) return;

    var sumScore = tiles.reduce(function (a, t) { return a + t.score; }, 0) || 1;
    tiles.forEach(function (t) { t.area = Math.max(minArea, budget * t.score / sumScore); });
    var sumA = tiles.reduce(function (a, t) { return a + t.area; }, 0);
    if (sumA > budget) {
      var fixedSum = tiles.filter(function (t) { return t.area <= minArea + 1e-9; })
        .reduce(function (a, t) { return a + t.area; }, 0);
      var flexSum = sumA - fixedSum;
      var flexBudget = Math.max(0, budget - fixedSum);
      var shrink = flexSum > 0 ? Math.min(1, flexBudget / flexSum) : 1;
      tiles.forEach(function (t) { if (t.area > minArea + 1e-9) t.area *= shrink; });
    }
    tiles.forEach(function (t) {
      t.fullW = Math.sqrt(t.area * t.ar);
      t.fullH = t.fullW / t.ar;
    });

    var placed = maskPack(tiles, W, H, T.ellipseAspectBias);
    function bounds(a) {
      var L = Infinity, R = -Infinity, T2 = Infinity, B = -Infinity;
      a.forEach(function (t) {
        if (t.x < -1000) return;
        if (t.x < L) L = t.x;
        if (t.x + t.fullW > R) R = t.x + t.fullW;
        if (t.y < T2) T2 = t.y;
        if (t.y + t.fullH > B) B = t.y + t.fullH;
      });
      return { L: L, R: R, T: T2, B: B };
    }
    var b = bounds(placed);
    for (var it = 0; it < 10; it++) {
      var miss = placed.some(function (t) { return t.x < -1000; });
      var over = b.L < 0 || b.T < 0 || b.R > W || b.B > H;
      if (!miss && !over) break;
      var scale = 0.93;
      if (over) {
        var clW = b.R - b.L, clH = b.B - b.T;
        var sx = (W * 0.96) / Math.max(clW, W * 0.96);
        var sy = (H * 0.94) / Math.max(clH, H * 0.94);
        scale = Math.min(scale, sx, sy);
      }
      tiles.forEach(function (t) { t.fullW *= scale; t.fullH *= scale; });
      placed = maskPack(tiles, W, H, T.ellipseAspectBias);
      b = bounds(placed);
    }
    var dx = W / 2 - (b.L + b.R) / 2, dy = H / 2 - (b.T + b.B) / 2;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      placed.forEach(function (t) { if (t.x > -1000) { t.x += dx; t.y += dy; } });
    }

    placed.forEach(function (t) {
      var s = t.data;
      var label = s.com || s.sci;
      var btn = document.createElement('button');
      btn.className = 'gtile';
      btn.type = 'button';
      btn.dataset.sci = s.sci;
      btn.dataset.slug = t.slug;
      btn.setAttribute('aria-label', label);
      btn.title = label + ' · ' + (+s.n || 0) + ' calls';
      btn.style.left = t.x + 'px';
      btn.style.top = t.y + 'px';
      btn.style.width = t.fullW + 'px';
      btn.style.height = t.fullH + 'px';
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = label;
      img.src = imgUrl(s.sci, s.com);
      btn.appendChild(img);
      collage.appendChild(btn);
    });
  }

  // ---- Stats: per-species mark on a time x count plot ----
  function drawHistograms() {
    var tl = $('statsTimeline');
    if (!tl) return;
    var sp = ((DATA.recent && DATA.recent.species) || []).slice();
    if (!sp.length) {
      tl.innerHTML = '';
      var p = document.createElement('div');
      p.className = 'stats-tl-empty';
      p.textContent = 'no detections in this window';
      tl.appendChild(p);
      return;
    }
    var now = Date.now();
    var windowStart = currentHours >= 1000000 ? now - 90 * 24 * 3600000 : now - currentHours * 3600000;
    var windowSpan = Math.max(1, now - windowStart);
    sp.sort(function (a, b) { return (+b.n || 0) - (+a.n || 0); });
    var W = tl.clientWidth || window.innerWidth;
    var cap = Math.max(4, Math.floor(W / 28));
    if (sp.length > cap) sp = sp.slice(0, cap);
    var maxN = sp.reduce(function (m, s) { return Math.max(m, +s.n || 0); }, 1);
    tl.innerHTML = '';
    var plot = document.createElement('div');
    plot.className = 'stats-tl-plot';
    sp.forEach(function (s) {
      var ts = Date.parse((s.last_seen || '').replace(' ', 'T'));
      var leftPct = isNaN(ts) ? 50 : ((Math.max(windowStart, Math.min(now, ts)) - windowStart) / windowSpan) * 100;
      var n = +s.n || 0;
      var bottomPct = (n / maxN) * 50;
      var mark = document.createElement('div');
      mark.className = 'stats-tl-mark';
      mark.style.left = leftPct.toFixed(1) + '%';
      mark.style.bottom = bottomPct.toFixed(1) + '%';
      mark.dataset.sci = s.sci;
      mark.title = (s.com || s.sci) + ' · ' + n + ' calls';
      plot.appendChild(mark);
    });
    tl.appendChild(plot);
  }

  // ---- Atlas: grid of bird-card per species ----
  function renderAtlas() {
    var grid = $('atlasGrid');
    if (!grid) return;
    var sp = ((DATA.lifelist && DATA.lifelist.species) || []).slice();
    grid.innerHTML = '';
    if (!sp.length) {
      var empty = document.createElement('div');
      empty.className = 'atlas-empty';
      var p1 = document.createElement('p');
      p1.textContent = 'No birds detected yet.';
      var p2 = document.createElement('p');
      p2.className = 'hint';
      p2.textContent = 'The atlas fills up as BirdNET-Pi identifies new species.';
      empty.appendChild(p1); empty.appendChild(p2);
      grid.appendChild(empty);
      return;
    }
    var sort = readLS('av:atlasSort', 'count');
    if (sort === 'recent') {
      sp.sort(function (a, b) {
        return Date.parse((b.last_seen || '').replace(' ', 'T')) - Date.parse((a.last_seen || '').replace(' ', 'T'));
      });
    } else if (sort === 'alpha') {
      sp.sort(function (a, b) { return (a.com || a.sci).localeCompare(b.com || b.sci); });
    } else {
      sp.sort(function (a, b) { return (+b.n || 0) - (+a.n || 0); });
    }

    sp.forEach(function (s) {
      var card = document.createElement('button');
      card.className = 'bird-card';
      card.type = 'button';
      card.dataset.sci = s.sci;

      var stat = document.createElement('div');
      stat.className = 'stat';
      var n = document.createElement('span');
      n.className = 'n'; n.textContent = String(+s.n || 0);
      var lbl = document.createElement('span');
      lbl.className = 'lbl'; lbl.textContent = (+s.n || 0) === 1 ? 'call' : 'calls';
      stat.appendChild(n); stat.appendChild(lbl);

      var wrap = document.createElement('div');
      wrap.className = 'img-wrap';
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = s.com || s.sci;
      img.src = imgUrl(s.sci, s.com);
      wrap.appendChild(img);

      var h3 = document.createElement('h3');
      h3.textContent = s.com || s.sci;
      var sci = document.createElement('p');
      sci.className = 'sci';
      var em = document.createElement('em');
      em.textContent = s.sci;
      sci.appendChild(em);

      card.appendChild(stat);
      card.appendChild(wrap);
      card.appendChild(h3);
      card.appendChild(sci);
      card.addEventListener('click', function () { openDetail(s); });
      grid.appendChild(card);
    });
  }

  // ---- Detail modal ----
  function openDetail(s) {
    var sci = s.sci || s;
    var rec = ((DATA.lifelist && DATA.lifelist.species) || []).find(function (x) { return x.sci === sci; }) || s;
    var label = rec.com || sci;

    var modal = $('detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'detail-modal';
      modal.setAttribute('role', 'dialog');
      document.body.appendChild(modal);
    }
    modal.innerHTML =
      '<div class="modal-backdrop" data-close="1"></div>' +
      '<div class="detail-card">' +
      '  <button type="button" class="modal-close" data-close="1" aria-label="close">×</button>' +
      '  <img class="detail-img" alt="">' +
      '  <h2 class="detail-title"></h2>' +
      '  <p class="detail-sci"><em></em></p>' +
      '  <p class="detail-stats"></p>' +
      '  <audio class="detail-audio" controls></audio>' +
      '  <img class="detail-spec" alt="spectrogram">' +
      '</div>';
    var card = modal.querySelector('.detail-card');
    card.querySelector('.detail-img').src = imgUrl(sci, rec.com);
    card.querySelector('.detail-img').alt = label;
    card.querySelector('.detail-title').textContent = label;
    card.querySelector('.detail-sci em').textContent = sci;
    card.querySelector('.detail-stats').textContent =
      (+rec.n || 0) + ' calls · last heard ' + (rec.last_seen || '-');
    card.querySelector('.detail-audio').src = media('recording.php', 'sci=' + encodeURIComponent(sci));
    card.querySelector('.detail-spec').src = media('spectrogram.php', 'sci=' + encodeURIComponent(sci));
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { modal.setAttribute('aria-hidden', 'true'); });
    });
  }
})();
