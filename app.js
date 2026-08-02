(function () {
  "use strict";

  const ANILIST_URL = "https://graphql.anilist.co";

  const MEDIA_FIELDS_SMALL = `
    id
    idMal
    title { romaji english }
    coverImage { extraLarge large color }
    format status episodes averageScore season seasonYear
    nextAiringEpisode { airingAt episode }
  `;

  const MEDIA_FIELDS = `
    id
    idMal
    title { romaji english native }
    coverImage { extraLarge large color }
    bannerImage description genres format status episodes duration
    season seasonYear averageScore popularity trending
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { airingAt episode }
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english }
          coverImage { large }
          format status episodes averageScore
        }
      }
    }
  `;

  const app = document.getElementById("app");
  const searchInput = document.getElementById("nav-search-input");
  const searchForm = document.getElementById("nav-search-form");

  let currentPage = { destroy: null };

  function makeEmbedUrl(episode, anilistId, lang = "sub", malId = null) {
    const idType = malId ? "mal" : "ani";
    const id = malId || anilistId;
    return `https://megavid.buzz/${idType}/${id}/${episode}/${lang}?color=%23e63946&autoplay=true`;
  }

  async function gql(query, variables = {}) {
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data;
  }

  async function browseAnime(
    page = 1,
    perPage = 20,
    sort = "TRENDING_DESC",
    format = null,
  ) {
    const q = `query($page:Int,$perPage:Int,$sort:[MediaSort],$format:MediaFormat){Page(page:$page,perPage:$perPage){pageInfo{total currentPage lastPage hasNextPage}media(type:ANIME,sort:$sort,format:$format){${MEDIA_FIELDS_SMALL}}}}`;
    const variables = { page, perPage, sort: [sort] };
    if (format) variables.format = format;
    return (await gql(q, variables)).Page;
  }

  async function getTrending(page = 1, perPage = 20) {
    return browseAnime(page, perPage, "TRENDING_DESC");
  }

  async function getPopular(page = 1, perPage = 20) {
    return browseAnime(page, perPage, "POPULARITY_DESC");
  }

  async function getRecentlyUpdated(page = 1, perPage = 20) {
    const q = `query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){pageInfo{total currentPage lastPage hasNextPage}airingSchedules(sort:TIME_DESC,notYetAired:false){episode airingAt media{${MEDIA_FIELDS_SMALL}}}}}`;
    const data = await gql(q, { page, perPage });
    const seen = new Set();
    const unique = [];
    for (const s of data.Page.airingSchedules) {
      if (s.media && !seen.has(s.media.id)) {
        seen.add(s.media.id);
        unique.push({ ...s.media, latestEpisode: s.episode });
      }
    }
    return { media: unique, pageInfo: data.Page.pageInfo };
  }

  async function searchAnime(
    searchQuery,
    page = 1,
    perPage = 20,
    format = null,
    sort = "SEARCH_MATCH",
  ) {
    const q = `query($page:Int,$perPage:Int,$search:String,$format:MediaFormat,$sort:[MediaSort]){Page(page:$page,perPage:$perPage){pageInfo{total currentPage lastPage hasNextPage}media(type:ANIME,search:$search,format:$format,sort:$sort){${MEDIA_FIELDS_SMALL}}}}`;
    const variables = { page, perPage, search: searchQuery, sort: [sort] };
    if (format) variables.format = format;
    return (await gql(q, variables)).Page;
  }

  async function getAnimeById(id) {
    const q = `query($id:Int){Media(id:$id,type:ANIME){${MEDIA_FIELDS}}}`;
    return (await gql(q, { id: parseInt(id) })).Media;
  }

  async function getTopAiring(page = 1, perPage = 10) {
    const q = `query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(type:ANIME,status:RELEASING,sort:POPULARITY_DESC){id title{romaji english} coverImage{extraLarge large} bannerImage description genres format status episodes averageScore nextAiringEpisode{airingAt episode}}}}`;
    return (await gql(q, { page, perPage })).Page.media;
  }

  const KEYS = {
    watchlist: "anicult_watchlist",
    history: "anicult_history",
    progress: "anicult_progress",
    dubCache: "anicult_dub_cache",
  };

  function storageGet(key) {
    try {
      const r = localStorage.getItem(key);
      return r ? JSON.parse(r) : null;
    } catch {
      return null;
    }
  }
  function storageSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getDubCache() {
    return storageGet(KEYS.dubCache) || {};
  }

  function setDubCached(id, episode, isAvailable) {
    if (typeof episode === "boolean") {
      isAvailable = episode;
      episode = 1;
    }
    const cache = getDubCache();
    const epKey = id + "_" + (episode || 1);
    cache[epKey] = { available: isAvailable, timestamp: Date.now() };
    if (!isAvailable) {
      const currentMax = cache[id + "_max_dub"];
      cache[id + "_max_dub"] = Math.min(
        currentMax !== undefined ? currentMax : 9999,
        (episode || 1) - 1,
      );
    }
    if (!isAvailable || episode === 1 || cache[id] === undefined) {
      cache[id] = { available: isAvailable, timestamp: Date.now() };
    }
    storageSet(KEYS.dubCache, cache);
  }

  function isDubCached(id, episode = null) {
    const cache = getDubCache();
    if (episode) {
      const epEntry = cache[id + "_" + episode];
      if (epEntry !== undefined) {
        if (typeof epEntry === "boolean") return epEntry;
        if (typeof epEntry === "object" && epEntry !== null) return epEntry.available;
      }
      const maxDub = cache[id + "_max_dub"];
      if (maxDub !== undefined && episode > maxDub) {
        return false;
      }
    }
    const entry = cache[id];
    if (entry === undefined) return null;
    if (typeof entry === "boolean") return entry;
    if (typeof entry === "object" && entry !== null) return entry.available;
    return null;
  }

  function probeDub(anime, episode = 1) {
    const cached = isDubCached(anime.id, episode);
    if (cached !== null) return Promise.resolve(cached);

    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = makeEmbedUrl(episode, anime.id, "dub", anime.idMal || null);
      document.body.appendChild(iframe);

      let settled = false;
      function cleanup(res) {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMsg);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        setDubCached(anime.id, episode, res);
        resolve(res);
      }

      function onMsg(e) {
        const d = e.data;
        if (!d || d.channel !== "kisskh") return;
        if (e.source !== iframe.contentWindow) return;
        if (
          d.event === "error" ||
          d.event === "unavailable" ||
          d.event === "no_source"
        ) {
          cleanup(false);
        } else if (
          d.event === "ready" ||
          d.event === "play" ||
          d.event === "loaded" ||
          d.event === "init"
        ) {
          cleanup(true);
        }
      }

      window.addEventListener("message", onMsg);

      setTimeout(() => {
        cleanup(false);
      }, 2000);
    });
  }

  function getWatchlist() {
    return storageGet(KEYS.watchlist) || [];
  }
  function addToWatchlist(anime) {
    const list = getWatchlist();
    if (list.find((a) => a.id === anime.id)) return list;
    const entry = {
      id: anime.id,
      title: anime.title,
      coverImage: anime.coverImage,
      format: anime.format,
      episodes: anime.episodes,
      averageScore: anime.averageScore,
      addedAt: Date.now(),
    };
    const updated = [entry, ...list];
    storageSet(KEYS.watchlist, updated);
    return updated;
  }
  function removeFromWatchlist(id) {
    const list = getWatchlist().filter((a) => a.id !== id);
    storageSet(KEYS.watchlist, list);
    return list;
  }
  function isInWatchlist(id) {
    return getWatchlist().some((a) => a.id === id);
  }

  function getHistory() {
    return storageGet(KEYS.history) || [];
  }
  function addToHistory(entry) {
    if (!entry.episode || isNaN(entry.episode) || entry.episode <= 0)
      return getHistory();
    const history = getHistory();
    const filtered = history.filter(
      (h) => !(h.animeId === entry.animeId && h.episode === entry.episode),
    );
    const newEntry = {
      animeId: entry.animeId,
      title: entry.title,
      coverImage: entry.coverImage,
      episode: entry.episode,
      timestamp: Date.now(),
    };
    const updated = [newEntry, ...filtered].slice(0, 200);
    storageSet(KEYS.history, updated);
    return updated;
  }
  function clearHistory() {
    storageSet(KEYS.history, []);
  }

  function getProgress(animeId) {
    const p = storageGet(KEYS.progress) || {};
    return p[animeId] || 0;
  }
  function setProgress(animeId, episode) {
    if (!episode || isNaN(episode) || episode <= 0) return;
    const p = storageGet(KEYS.progress) || {};
    p[animeId] = Math.max(p[animeId] || 0, episode);
    storageSet(KEYS.progress, p);
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function stripHtml(html) {
    return html
      ? html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]*>/g, "")
      : "No description available.";
  }

  function title(anime) {
    return anime.title.english || anime.title.romaji;
  }
  function cover(anime) {
    return anime.coverImage.extraLarge || anime.coverImage.large;
  }
  function epText(anime) {
    if (anime.nextAiringEpisode)
      return "Ep " + (anime.nextAiringEpisode.episode - 1);
    return anime.episodes ? anime.episodes + " eps" : null;
  }

  const icons = {
    arrowLeft: (s = 16) =>
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>`,
    arrowRight: (s = 16) =>
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>`,
    alert: (s = 16) =>
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    clock: (s = 16) =>
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  };

  function cardHtml(anime) {
    const t = title(anime);
    const img = cover(anime);
    const score = anime.averageScore;
    const fmt = anime.format;
    const ep = epText(anime);
    const isDub = isDubCached(anime.id) === true;
    return `<a href="#/anime/${anime.id}" class="card" id="card-${anime.id}">
      <div class="card-image">
        <img src="${esc(img)}" alt="${esc(t)}" loading="lazy">
        ${score ? `<span class="card-score">${score}%</span>` : ""}
        ${fmt ? `<span class="card-format">${esc(fmt)}</span>` : ""}
        ${isDub ? `<span class="card-dub">DUB</span>` : ""}
        ${ep ? `<span class="card-ep">${esc(ep)}</span>` : ""}
      </div>
      <div class="card-body"><div class="card-title">${esc(t)}</div></div>
    </a>`;
  }

  function parseHash() {
    const hash = location.hash.slice(1) || "/";
    const [path, qs] = hash.split("?");
    const params = new URLSearchParams(qs || "");
    return { path, params };
  }

  async function route() {
    if (currentPage.destroy) {
      currentPage.destroy();
      currentPage = { destroy: null };
    }
    const { path, params } = parseHash();

    app.innerHTML = `<div class="loading"><div class="loading-spinner"></div><div>Loading...</div></div>`;

    try {
      if (path === "/" || path === "") await renderHome();
      else if (path === "/search") await renderSearch(params);
      else if (path.startsWith("/anime/"))
        await renderAnimeDetail(path.split("/")[2]);
      else if (path.startsWith("/watch/")) {
        const parts = path.split("/");
        await renderWatch(parts[2], parseInt(parts[3]) || 1);
      } else if (path === "/watchlist") renderWatchlist();
      else if (path === "/history") renderHistory();
      else if (path === "/about") renderAbout();
      else
        app.innerHTML = `<div class="empty"><div class="empty-title">404</div><div class="empty-text">Page not found</div><a href="#/" class="btn btn-primary">Go Home</a></div>`;
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="empty"><div class="empty-title">Something went wrong</div><div class="empty-text">${esc(err.message)}</div><a href="#/" class="btn btn-primary">Go Home</a></div>`;
    }

    window.scrollTo(0, 0);
  }

  async function renderHome() {
    const [topAiring, trending, recent, popular] = await Promise.all([
      getTopAiring(),
      getTrending(1, 20),
      getRecentlyUpdated(1, 20),
      getPopular(1, 20),
    ]);

    let html = "";

    if (topAiring.length > 0) {
      html += `<div class="hero-slideshow" id="hero-slideshow">`;
      topAiring.forEach((anime, i) => {
        const t = title(anime);
        const bg = anime.bannerImage || cover(anime);
        const desc = stripHtml(anime.description || "");
        const nxt = anime.nextAiringEpisode;
        const aired = nxt ? nxt.episode - 1 : anime.episodes || "?";
        let airMeta = "";
        if (nxt) {
          const diff = nxt.airingAt * 1000 - Date.now();
          airMeta =
            diff > 0
              ? `Next Ep ${nxt.episode} in ${formatCountdown(nxt.airingAt)}`
              : `Next Ep ${nxt.episode} soon`;
        }
        html += `<div class="hero-slide ${i === 0 ? "active" : ""}" data-index="${i}">
          <div class="hero-slide-bg" style="background-image:url('${esc(bg)}')"></div>
          <div class="hero-slide-overlay"></div>
          <div class="hero-slide-content">
            <div class="hero-rank">#${i + 1}</div>
            <div class="hero-slide-main">
              <div class="hero-slide-cover"><img src="${esc(cover(anime))}" alt="${esc(t)}"></div>
              <div class="hero-slide-info">
                <div class="hero-slide-badge">Now Airing</div>
                <div class="hero-slide-title">${esc(t)}</div>
                <div class="hero-slide-tags">
                  ${(anime.genres || [])
                    .slice(0, 3)
                    .map((g) => `<span>${esc(g)}</span>`)
                    .join("")}
                  ${anime.averageScore ? `<span class="tag-accent">${anime.averageScore}%</span>` : ""}
                </div>
                <div class="hero-slide-desc">${esc(desc)}</div>
                <div class="hero-slide-meta">${anime.format || "TV"} · ${aired} eps aired${airMeta ? " · " + esc(airMeta) : ""}</div>
                <div class="hero-slide-actions">
                  <a href="#/anime/${anime.id}" class="btn btn-primary">View Details</a>
                  ${aired > 0 ? `<a href="#/watch/${anime.id}/1" class="btn btn-outline">Watch Now</a>` : ""}
                </div>
              </div>
            </div>
          </div>
        </div>`;
      });
      html += `<button class="hero-arrow prev" id="hero-prev" aria-label="Previous slide">${icons.arrowLeft(18)}</button>`;
      html += `<button class="hero-arrow next" id="hero-next" aria-label="Next slide">${icons.arrowRight(18)}</button>`;
      html += `<div class="hero-dots">${topAiring
        .map(
          (_, i) =>
            `<button class="hero-dot ${i === 0 ? "active" : ""}" data-dot="${i}" aria-label="Slide ${i + 1}"></button>`,
        )
        .join("")}</div>`;
      html += `</div>`;
    }

    html += `<section class="section"><div class="section-header"><h2 class="section-title">Trending Now</h2><a href="#/search?sort=TRENDING_DESC" class="section-link">View All</a></div><div class="scroll-row">${trending.media.map(cardHtml).join("")}</div></section>`;

    html += `<section class="section"><div class="section-header"><h2 class="section-title">Recently Updated</h2><a href="#/search?sort=UPDATED_AT_DESC" class="section-link">View All</a></div><div class="scroll-row">${recent.media.map(cardHtml).join("")}</div></section>`;

    html += `<section class="section"><div class="section-header"><h2 class="section-title">All Time Popular</h2><a href="#/search?sort=POPULARITY_DESC" class="section-link">View All</a></div><div id="popular-grid" class="grid">${popular.media.map(cardHtml).join("")}</div><div id="popular-loader" style="text-align:center;padding:2rem;color:var(--text-muted)"></div></section>`;

    app.innerHTML = html;

    let heroIndex = 0;
    let heroTimer = null;
    const heroCount = topAiring.length;
    const slides = document.querySelectorAll(".hero-slide");
    const dots = document.querySelectorAll(".hero-dot");
    const slideshowEl = document.getElementById("hero-slideshow");

    function showSlide(n) {
      heroIndex = (n + heroCount) % heroCount;
      slides.forEach((s, i) => s.classList.toggle("active", i === heroIndex));
      dots.forEach((d, i) => d.classList.toggle("active", i === heroIndex));
    }

    function startHero() {
      clearInterval(heroTimer);
      heroTimer = setInterval(() => showSlide(heroIndex + 1), 3000);
    }

    if (slideshowEl && heroCount > 1) {
      const prevBtn = document.getElementById("hero-prev");
      const nextBtn = document.getElementById("hero-next");
      if (prevBtn)
        prevBtn.addEventListener("click", () => {
          showSlide(heroIndex - 1);
          startHero();
        });
      if (nextBtn)
        nextBtn.addEventListener("click", () => {
          showSlide(heroIndex + 1);
          startHero();
        });
      dots.forEach((d) =>
        d.addEventListener("click", () => {
          showSlide(parseInt(d.dataset.dot));
          startHero();
        }),
      );
      slideshowEl.addEventListener("mouseenter", () =>
        clearInterval(heroTimer),
      );
      slideshowEl.addEventListener("mouseleave", startHero);

      let touchStartX = null;
      slideshowEl.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].clientX;
        startHero();
      });
      slideshowEl.addEventListener("touchend", (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(dx) > 40) {
          showSlide(heroIndex + (dx < 0 ? 1 : -1));
          startHero();
        }
      });
      startHero();
    }

    let popPage = 2;
    let popHasNext = popular.pageInfo.hasNextPage;
    let popLoading = false;
    const loader = document.getElementById("popular-loader");
    const grid = document.getElementById("popular-grid");

    async function loadMorePopular() {
      if (popLoading || !popHasNext) return;
      popLoading = true;
      loader.textContent = "Loading more...";
      try {
        const data = await getPopular(popPage, 20);
        if (data) {
          grid.insertAdjacentHTML(
            "beforeend",
            data.media.map(cardHtml).join(""),
          );
          popHasNext = data.pageInfo.hasNextPage;
          popPage++;
        }
      } catch (e) {
        console.error(e);
      }
      popLoading = false;
      loader.textContent = "";
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMorePopular();
      },
      { rootMargin: "200px" },
    );

    if (loader) observer.observe(loader);
    currentPage.destroy = () => {
      if (heroTimer) clearInterval(heroTimer);
      observer.disconnect();
    };
  }

  async function renderSearch(params) {
    const q = params.get("q") || "";
    const page = parseInt(params.get("page")) || 1;
    const format = params.get("format") || "";
    const sort = params.get("sort") || (q ? "SEARCH_MATCH" : "TRENDING_DESC");
    const dub = params.get("dub") === "1" || params.get("dubbed") === "1";

    let result;
    if (q) result = await searchAnime(q, page, 24, format || null, sort);
    else result = await browseAnime(page, 24, sort, format || null);

    if (dub && result && result.media) {
      const unknownItems = result.media.filter(
        (a) => isDubCached(a.id) === null,
      );
      if (unknownItems.length > 0) {
        await Promise.all(unknownItems.map((a) => probeDub(a)));
      }
      result.media = result.media.filter((a) => isDubCached(a.id) === true);
    }

    const sortOpts = [
      { v: "SEARCH_MATCH", l: "Relevance" },
      { v: "TRENDING_DESC", l: "Trending" },
      { v: "POPULARITY_DESC", l: "Popularity" },
      { v: "SCORE_DESC", l: "Score" },
      { v: "START_DATE_DESC", l: "Newest" },
      { v: "UPDATED_AT_DESC", l: "Recently Updated" },
    ];
    const fmtOpts = [
      { v: "", l: "All Formats" },
      { v: "TV", l: "TV" },
      { v: "MOVIE", l: "Movie" },
      { v: "OVA", l: "OVA" },
      { v: "ONA", l: "ONA" },
      { v: "SPECIAL", l: "Special" },
    ];

    function buildUrl(overrides) {
      const p = {
        q,
        page: String(page),
        format,
        sort,
        dub: dub ? "1" : "",
        ...overrides,
      };
      const sp = new URLSearchParams();
      Object.entries(p).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
      return "#/search?" + sp.toString();
    }

    let html = `<h1 class="section-title" style="margin-bottom:16px">${q ? `Results for "${esc(q)}"` : "Browse Anime"}</h1>`;
    html += `<div class="filters">`;
    sortOpts.forEach((o) => {
      html += `<a href="${buildUrl({ sort: o.v, page: "1" })}" class="btn btn-sm ${sort === o.v ? "btn-primary" : "btn-outline"}">${o.l}</a>`;
    });
    html += `<span style="color:var(--text-dim)">|</span>`;
    fmtOpts.forEach((o) => {
      html += `<a href="${buildUrl({ format: o.v, page: "1" })}" class="btn btn-sm ${format === o.v ? "btn-primary" : "btn-outline"}">${o.l}</a>`;
    });
    html += `<span style="color:var(--text-dim)">|</span>`;
    html += `<a href="${buildUrl({ dub: dub ? "" : "1", page: "1" })}" class="btn btn-sm ${dub ? "btn-primary" : "btn-outline"}">${dub ? "✓ Dubbed" : "Dubbed"}</a>`;
    html += `</div>`;

    if (result.media.length === 0) {
      html += `<div class="empty"><div class="empty-title">No results found</div><div class="empty-text">Try a different search term or filter</div></div>`;
    } else {
      html += `<div class="grid grid-wide">${result.media
        .map((a) => {
          const t = title(a),
            img = cover(a),
            s = a.averageScore,
            ep = epText(a),
            isDub = isDubCached(a.id) === true;
          return `<a href="#/anime/${a.id}" class="card" id="search-card-${a.id}">
          <div class="card-image"><img src="${esc(img)}" alt="${esc(t)}" loading="lazy">
            ${s ? `<span class="card-score">${s}%</span>` : ""}
            ${a.format ? `<span class="card-format">${esc(a.format)}</span>` : ""}
            ${isDub ? `<span class="card-dub">DUB</span>` : ""}
            ${ep ? `<span class="card-ep">${esc(ep)}</span>` : ""}
          </div>
          <div class="card-body"><div class="card-title">${esc(t)}</div></div>
        </a>`;
        })
        .join("")}</div>`;
    }

    if (result.pageInfo) {
      html += `<div class="pagination">`;
      if (page > 1)
        html += `<a href="${buildUrl({ page: String(page - 1) })}" class="page-btn">Previous</a>`;
      Array.from(
        { length: Math.min(result.pageInfo.lastPage || 1, 10) },
        (_, i) => i + 1,
      )
        .filter(
          (p) =>
            p === 1 ||
            p === (result.pageInfo.lastPage || 1) ||
            Math.abs(p - page) <= 2,
        )
        .forEach((p) => {
          html += `<a href="${buildUrl({ page: String(p) })}" class="page-btn ${p === page ? "page-btn-active" : ""}">${p}</a>`;
        });
      if (result.pageInfo.hasNextPage)
        html += `<a href="${buildUrl({ page: String(page + 1) })}" class="page-btn">Next</a>`;
      html += `</div>`;
    }

    app.innerHTML = html;
  }

  async function renderAnimeDetail(id) {
    const anime = await getAnimeById(id);
    const t = title(anime);
    const engT = anime.title.english;
    const nativeT = anime.title.native;
    const altT =
      engT && anime.title.romaji !== engT ? anime.title.romaji : nativeT || "";
    const img = cover(anime);
    const banner = anime.bannerImage || img;
    const nextEp = anime.nextAiringEpisode?.episode;
    const nextEpDate = anime.nextAiringEpisode?.airingAt;
    const totalKnown = anime.episodes || nextEp || 0;
    const studio = anime.studios?.nodes?.[0]?.name || "Unknown";
    const desc = stripHtml(anime.description);
    const watched = getProgress(anime.id);
    const inList = isInWatchlist(anime.id);
    const status = anime.status || "";
    const isAiring = status === "RELEASING";
    const airedEps = isAiring && nextEp ? nextEp - 1 : anime.episodes || 0;

    const relations = (anime.relations?.edges || []).filter((e) =>
      ["SEQUEL", "PREQUEL", "SIDE_STORY", "PARENT"].includes(e.relationType),
    );

    let ctaHtml = "";
    if (totalKnown > 0 && airedEps > 0) {
      const resumeEp = watched + 1;
      if (watched > 0 && resumeEp <= airedEps) {
        ctaHtml = `<a href="#/watch/${anime.id}/${resumeEp}" class="btn btn-primary">Continue Ep ${resumeEp}</a>`;
      } else if (watched > 0) {
        ctaHtml = `<a href="#/watch/${anime.id}/1" class="btn btn-primary">Rewatch Ep 1</a>`;
      } else {
        ctaHtml = `<a href="#/watch/${anime.id}/1" class="btn btn-primary">Start Watching</a>`;
      }
    }

    let html = "";

    html += `<div class="detail-hero">
      <div class="detail-hero-bg" style="background-image:url('${esc(banner)}')"></div>
      <div class="detail-hero-overlay"></div>
      <div class="detail-hero-content">
        <div class="detail-hero-cover"><img src="${esc(img)}" alt="${esc(t)}"></div>
        <div class="detail-hero-info">
          <div class="detail-hero-title">${esc(t)}</div>
          ${altT ? `<div class="detail-hero-alt-title">${esc(altT)}</div>` : ""}
          <div class="detail-hero-tags">
            ${(anime.genres || [])
              .slice(0, 4)
              .map((g) => `<span>${esc(g)}</span>`)
              .join("")}
            ${anime.averageScore ? `<span class="tag-accent">${anime.averageScore}%</span>` : ""}
            ${isDubCached(anime.id) === true ? `<span class="tag-accent tag-dub">DUB</span>` : ""}
            ${statusBadge(status)}
          </div>
          <div class="detail-hero-desc">${esc(desc)}</div>
          <div class="detail-hero-actions">
            ${ctaHtml}
            <button class="btn ${inList ? "btn-danger" : "btn-outline"}" id="watchlist-btn">${inList ? "Remove from Watchlist" : "Add to Watchlist"}</button>
          </div>
        </div>
      </div>
    </div>`;

    html += `<div class="detail-body">`;

    html += `<div class="detail-stats">`;
    const stats = [
      {
        label: "Score",
        value: anime.averageScore ? anime.averageScore + "%" : "—",
        cls: "accent",
      },
      { label: "Format", value: anime.format || "—" },
      {
        label: "Status",
        value: status.replace(/_/g, " ") || "—",
        cls: isAiring ? "green" : status === "FINISHED" ? "blue" : "",
      },
      {
        label: "Episodes",
        value: anime.episodes ? String(anime.episodes) : nextEp ? "?" : "—",
      },
      {
        label: "Duration",
        value: anime.duration ? anime.duration + " min" : "—",
      },
      {
        label: "Season",
        value: anime.season
          ? anime.season + " " + (anime.seasonYear || "")
          : "—",
      },
      { label: "Studio", value: esc(studio) },
    ];
    stats.forEach((s) => {
      html += `<div class="detail-stat"><div class="detail-stat-label">${s.label}</div><div class="detail-stat-value${s.cls ? " " + s.cls : ""}">${s.value}</div></div>`;
    });
    html += `</div>`;

    html += `<div class="detail-section">
      <div class="detail-synopsis expandable" id="synopsis">${esc(desc)}</div>
    </div>`;

    if (totalKnown > 0) {
      const progressPct = anime.episodes
        ? Math.round((watched / anime.episodes) * 100)
        : 0;
      html += `<div class="detail-section"><div class="detail-section-title">Episodes</div>`;
      html += `<div class="ep-progress">
        <span class="ep-progress-text">${watched} ${isAiring && nextEp ? "of " + (nextEp - 1) : anime.episodes ? "of " + anime.episodes : ""} watched</span>
        <div class="ep-progress-bar"><div class="ep-progress-fill" style="width:${progressPct}%"></div></div>
      </div>`;

      if (isAiring && nextEp && nextEpDate) {
        const diff = nextEpDate * 1000 - Date.now();
        if (diff > 0) {
          const days = Math.floor(diff / 86400000);
          const hours = Math.floor((diff % 86400000) / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          const countdown =
            days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`;
          const dateStr = new Date(nextEpDate * 1000).toLocaleDateString(
            undefined,
            {
              weekday: "short",
              month: "short",
              day: "numeric",
            },
          );
          html += `<div class="next-ep-banner">
            <div class="next-ep-info">
              <div class="next-ep-label">${icons.clock(12)} Next Episode</div>
              <div class="next-ep-title">Episode ${nextEp} airs in <strong>${countdown}</strong></div>
            </div>
            <div class="next-ep-date">${dateStr}</div>
          </div>`;
        }
      }
      html += `<div class="episodes-grid">`;
      for (let i = 1; i <= totalKnown; i++) {
        const isUpcoming = nextEp && i >= nextEp && status !== "FINISHED";
        const isNextEp = nextEp && i === nextEp && status !== "FINISHED";
        const isAired = !isUpcoming;
        const isWatched = i <= watched;

        let cls = "ep-btn";
        let attrs = "";
        let airLabel = "";

        if (isWatched) {
          cls += " ep-btn-watched";
          attrs = `href="#/watch/${anime.id}/${i}"`;
        } else if (isAired || !isUpcoming) {
          cls += " ep-btn-aired";
          attrs = `href="#/watch/${anime.id}/${i}"`;
        } else {
          cls += " ep-btn-upcoming";
          if (isNextEp && nextEpDate) {
            const diff = nextEpDate * 1000 - Date.now();
            if (diff > 0) {
              const days = Math.floor(diff / 86400000);
              const hours = Math.floor((diff % 86400000) / 3600000);
              if (days < 1) {
                airLabel = hours > 0 ? `${hours}h` : "<1h";
                cls += " ep-btn-today";
              } else {
                airLabel = `${days}d`;
              }
            }
          }
        }

        const isSoon =
          airLabel && nextEpDate && nextEpDate * 1000 - Date.now() < 86400000;
        if (attrs) {
          html += `<a ${attrs} class="${cls}" id="ep-${i}">${i}${airLabel ? `<div class="ep-air-date${isSoon ? " today-date" : " upcoming-date"}">${esc(airLabel)}</div>` : ""}</a>`;
        } else {
          html += `<span class="${cls}" id="ep-${i}">${i}${airLabel ? `<div class="ep-air-date upcoming-date">${esc(airLabel)}</div>` : ""}</span>`;
        }
      }
      html += `</div></div>`;
    }

    if (relations.length > 0) {
      html += `<div class="detail-section related-section"><div class="detail-section-title">Related</div><div class="scroll-row">${relations
        .map((rel) => {
          const r = rel.node,
            rT = title(r);
          return `<a href="#/anime/${r.id}" class="card">
          <div class="card-image"><img src="${esc(r.coverImage.large)}" alt="${esc(rT)}" loading="lazy">
            ${r.averageScore ? `<span class="card-score">${r.averageScore}%</span>` : ""}
            <span class="related-badge">${esc(rel.relationType.replace(/_/g, " "))}</span>
          </div>
          <div class="card-body"><div class="card-title">${esc(rT)}</div></div>
        </a>`;
        })
        .join("")}</div></div>`;
    }

    html += `</div>`;
    app.innerHTML = html;

    const synEl = document.getElementById("synopsis");
    if (synEl && synEl.scrollHeight > synEl.clientHeight) {
      synEl.addEventListener("click", () => synEl.classList.toggle("expanded"));
    }

    const btn = document.getElementById("watchlist-btn");
    let currentInList = inList;
    btn.addEventListener("click", () => {
      if (currentInList) {
        removeFromWatchlist(anime.id);
        btn.textContent = "Add to Watchlist";
        btn.className = "btn btn-outline";
        currentInList = false;
      } else {
        addToWatchlist(anime);
        btn.textContent = "Remove from Watchlist";
        btn.className = "btn btn-danger";
        currentInList = true;
      }
    });
  }

  function statusBadge(s) {
    const map = {
      FINISHED: { cls: "finished", label: "Finished" },
      RELEASING: { cls: "airing", label: "Airing" },
      NOT_YET_RELEASED: { cls: "upcoming", label: "Unreleased" },
      HIATUS: { cls: "dim", label: "Hiatus" },
      CANCELLED: { cls: "dim", label: "Cancelled" },
    };
    const m = map[s];
    if (!m) return "";
    return `<span class="status-badge ${m.cls}">${m.label}</span>`;
  }

  function formatCountdown(airingAt) {
    const diff = airingAt * 1000 - Date.now();
    if (diff <= 0) return "Airing now";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  }

  async function renderWatch(id, episode) {
    const anime = await getAnimeById(id);
    const t = title(anime);
    const totalEps =
      anime.episodes ||
      (anime.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : 0);
    const nextEp = anime.nextAiringEpisode?.episode;
    const nextEpDate = anime.nextAiringEpisode?.airingAt;
    const isAiring = anime.status === "RELEASING";
    const notYetReleased = anime.status === "NOT_YET_RELEASED";
    const epUnreleased = isAiring && nextEp && episode >= nextEp;
    const canWatch = !notYetReleased && !epUnreleased;

    if (canWatch) {
      addToHistory({
        animeId: anime.id,
        title: t,
        coverImage: anime.coverImage,
        episode,
      });
      setProgress(anime.id, episode);
    }

    let sources = [],
      activeSource = 0,
      loading = true,
      error = null,
      embedUrl = "",
      currentLang = "sub",
      isDubAvailable = isDubCached(anime.id);

    if (isDubAvailable === null && canWatch) {
      isDubAvailable = await probeDub(anime);
    } else {
      isDubAvailable = isDubAvailable === true;
    }

    if (!isDubAvailable) currentLang = "sub";

    function unavailableHtml() {
      if (notYetReleased) {
        return `<div class="player-unavailable">
          <div class="unavailable-icon">${icons.clock(36)}</div>
          <div class="unavailable-title">Not Available Yet</div>
          <div class="unavailable-text">"${esc(t)}" has not been released online yet. It will be added to AniCult as soon as it airs on streaming platforms.</div>
        </div>`;
      }
      if (epUnreleased) {
        return `<div class="player-unavailable">
          <div class="unavailable-icon">${icons.clock(36)}</div>
          <div class="unavailable-title">Episode ${episode} hasn't aired yet</div>
          <div class="unavailable-countdown">Airs in <span id="countdown-timer">${esc(formatCountdown(nextEpDate))}</span></div>
          <div class="unavailable-text">This episode becomes available here as soon as it airs on streaming platforms.</div>
        </div>`;
      }
      return `<div class="player-unavailable">
        <div class="unavailable-icon">${icons.alert(36)}</div>
        <div class="unavailable-title">No Video Sources</div>
        <div class="unavailable-text">This title isn't currently available on streaming platforms. It will be added as soon as it becomes available.</div>
      </div>`;
    }

    function render() {
      let html = `<div class="player-container">`;

      html += `<div class="player-info"><div>
        <a href="#/anime/${anime.id}" class="player-title">${esc(t)}</a>
        <div class="player-episode">Episode ${episode}</div>
      </div><div class="player-nav">`;
      if (episode > 1 && (!isAiring || !nextEp || episode - 1 < nextEp))
        html += `<a href="#/watch/${anime.id}/${episode - 1}" class="btn btn-outline btn-sm">${icons.arrowLeft()} Prev</a>`;
      if (episode < totalEps && (!isAiring || !nextEp || episode + 1 < nextEp))
        html += `<a href="#/watch/${anime.id}/${episode + 1}" class="btn btn-primary btn-sm">Next ${icons.arrowRight()}</a>`;
      html += `</div></div>`;

      html += `<div class="player-wrapper">`;
      if (loading && canWatch) {
        html += `<div class="loading"><div class="loading-spinner"></div><div>Finding video sources...</div></div>`;
      } else if (!canWatch) {
        html += unavailableHtml();
      } else if (embedUrl) {
        html += `<iframe src="${esc(embedUrl)}" allowfullscreen loading="lazy" allow="autoplay; fullscreen"></iframe>`;
        html += `<div class="episode-badge">Episode ${episode}</div>`;
      } else {
        html += unavailableHtml();
      }
      html += `</div>`;

      if (isAiring && nextEp && nextEpDate && !epUnreleased) {
        const diff = nextEpDate * 1000 - Date.now();
        if (diff > 0) {
          html += `<div class="watch-countdown">
            <div class="watch-countdown-label">${icons.clock(14)} Next Episode ${nextEp}</div>
            <div class="watch-countdown-timer">airs in <span id="next-ep-countdown">${esc(formatCountdown(nextEpDate))}</span></div>
          </div>`;
        }
      }

      if (canWatch) {
        if (isDubAvailable) {
          html += `<div class="player-lang-toggle">
            <button class="lang-btn ${currentLang === "sub" ? "lang-btn-active" : ""}" data-lang="sub">Sub</button>
            <button class="lang-btn ${currentLang === "dub" ? "lang-btn-active" : ""}" data-lang="dub">Dub</button>
          </div>`;
        } else {
          html += `<div class="player-lang-toggle">
            <span class="lang-btn lang-btn-active" style="cursor:default">Subtitled</span>
          </div>`;
        }
      }

      if (sources.length > 2) {
        html += `<div class="player-source-list">`;
        sources.forEach((s, i) => {
          html += `<button class="player-source-btn ${i === activeSource ? "player-source-btn-active" : ""}" data-source-index="${i}">${esc(s.name)}</button>`;
        });
        html += `</div>`;
      }

      if (error) {
        html += `<div class="embed-error">${esc(error)} <button class="btn btn-outline btn-sm" id="retry-btn">Retry</button></div>`;
      }

      if (!loading && !embedUrl && canWatch) {
        html += `<div class="player-url-input"><input type="text" id="custom-embed-url" placeholder="Or paste an embed URL..." /><button class="btn btn-primary btn-sm" id="load-custom-url">Load</button></div>`;
      }

      if (totalEps > 0) {
        html += `<div style="margin-top:24px"><h3 class="episodes-title" style="margin-bottom:12px">Episodes</h3><div class="episodes-grid">`;
        for (let i = 1; i <= totalEps; i++) {
          const isUpcoming = nextEp && i >= nextEp && isAiring;
          const isWatched = i <= getProgress(anime.id);
          let cls = "ep-btn";
          if (i === episode) cls += " ep-btn-current";
          else if (isWatched) cls += " ep-btn-watched";
          else if (!isUpcoming) cls += " ep-btn-aired";
          else cls += " ep-btn-upcoming";
          if (isUpcoming) {
            html += `<span class="${cls}" title="Not yet aired">${i}</span>`;
          } else {
            html += `<a href="#/watch/${anime.id}/${i}" class="${cls}">${i}</a>`;
          }
        }
        html += `</div></div>`;
      }

      html += `</div>`;
      app.innerHTML = html;

      document.querySelectorAll("[data-source-index]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.sourceIndex);
          if (idx !== activeSource) {
            activeSource = idx;
            embedUrl = sources[idx].url;
            render();
          }
        });
      });

      document.querySelectorAll("[data-lang]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const lang = btn.dataset.lang;
          if (lang !== currentLang) {
            currentLang = lang;
            discoverSources();
          }
        });
      });

      const loadBtn = document.getElementById("load-custom-url");
      if (loadBtn) {
        loadBtn.addEventListener("click", () => {
          const input = document.getElementById("custom-embed-url");
          if (input && input.value.trim()) {
            embedUrl = input.value.trim();
            sources.push({ id: "custom", name: "Custom", url: embedUrl });
            activeSource = sources.length - 1;
            render();
          }
        });
      }

      const retryBtn = document.getElementById("retry-btn");
      if (retryBtn) retryBtn.addEventListener("click", discoverSources);
    }

    function onPlayerMessage(e) {
      const d = e.data;
      if (!d || d.channel !== "kisskh") return;
      const iframe = app.querySelector("iframe");
      if (!iframe || e.source !== iframe.contentWindow) return;
      if (d.event === "complete") {
        if (
          episode < totalEps &&
          (!isAiring || !nextEp || episode + 1 < nextEp)
        ) {
          location.hash = `#/watch/${anime.id}/${episode + 1}`;
        }
      } else if (d.event === "error" && !error) {
        if (currentLang === "dub") {
          setDubCached(anime.id, false);
          isDubAvailable = false;
          currentLang = "sub";
          discoverSources();
          return;
        }
        error =
          d.message || "The video failed to load. Please try another source.";
        render();
      }
    }

    function discoverSources() {
      if (!canWatch) {
        loading = false;
        render();
        return;
      }
      loading = true;
      error = null;
      embedUrl = "";
      sources = [];
      activeSource = 0;

      const malId = anime.idMal || null;
      const subUrl = makeEmbedUrl(episode, id, "sub", malId);
      sources = [{ id: "sub", name: "Sub", url: subUrl }];
      if (isDubAvailable) {
        const dubUrl = makeEmbedUrl(episode, id, "dub", malId);
        sources.push({ id: "dub", name: "Dub", url: dubUrl });
      }
      const langIdx = sources.findIndex((s) => s.id === currentLang);
      activeSource = langIdx >= 0 ? langIdx : 0;
      embedUrl = sources[activeSource].url;
      loading = false;
      render();
    }

    render();

    const showCountdown = isAiring && nextEp && nextEpDate;
    const timer = showCountdown
      ? setInterval(() => {
          let alive = false;
          const a = document.getElementById("countdown-timer");
          if (a) {
            a.textContent = formatCountdown(nextEpDate);
            alive = true;
          }
          const b = document.getElementById("next-ep-countdown");
          if (b) {
            b.textContent = formatCountdown(nextEpDate);
            alive = true;
          }
          if (!alive) clearInterval(timer);
        }, 1000)
      : null;
    window.addEventListener("message", onPlayerMessage);
    currentPage.destroy = () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("message", onPlayerMessage);
    };
    discoverSources();
  }

  function renderWatchlist() {
    const list = getWatchlist();
    let html = `<h1 class="section-title" style="margin-bottom:24px">My Watchlist</h1>`;

    if (list.length === 0) {
      html += `<div class="empty"><div class="empty-title">Your watchlist is empty</div><div class="empty-text">Find anime you like and add them to your list.</div><a href="#/" class="btn btn-primary">Browse Anime</a></div>`;
    } else {
      html += `<div class="grid grid-wide">${list
        .map((a) => {
          const t = title(a),
            img = cover(a),
            s = a.averageScore,
            fmt = a.format;
          const eps = a.episodes || 0,
            watched = getProgress(a.id);
          return `<div class="card" style="position:relative" id="watchlist-card-${a.id}">
          <a href="#/anime/${a.id}">
            <div class="card-image">
              <img src="${esc(img)}" alt="${esc(t)}">
              ${s ? `<span class="card-score">${s}%</span>` : ""}
              ${fmt ? `<span class="card-format">${esc(fmt)}</span>` : ""}
            </div>
            <div class="card-body">
              <div class="card-title" style="margin-bottom:4px">${esc(t)}</div>
              <div class="watchlist-progress">Progress: ${watched} / ${eps || "?"}</div>
            </div>
          </a>
          <button class="wl-remove-btn" data-id="${a.id}">Remove</button>
        </div>`;
        })
        .join("")}</div>`;
    }

    app.innerHTML = html;
    document.querySelectorAll(".wl-remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeFromWatchlist(parseInt(btn.dataset.id));
        renderWatchlist();
      });
    });
  }

  function renderHistory() {
    const historyList = getHistory();
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><h1 class="section-title">Watch History</h1>`;
    if (historyList.length > 0)
      html += `<button class="btn btn-outline btn-sm" id="clear-history-btn">Clear History</button>`;
    html += `</div>`;

    if (historyList.length === 0) {
      html += `<div class="empty"><div class="empty-title">No watch history</div><div class="empty-text">Anime you watch will show up here.</div><a href="#/" class="btn btn-primary">Browse Anime</a></div>`;
    } else {
      const latest = historyList[0];
      if (latest) {
        html += `<div class="continue-card" id="continue-watching-card">
          <div class="history-thumb"><img src="${esc(latest.coverImage.extraLarge || latest.coverImage.large)}" alt="${esc(latest.title)}"></div>
          <div class="history-info">
            <div class="continue-label">Continue Watching</div>
            <h2 class="history-title" style="font-size:16px;font-weight:600">${esc(latest.title)}</h2>
            <div class="history-ep">Episode ${latest.episode}</div>
          </div>
          <div><a href="#/watch/${latest.animeId}/${latest.episode}" class="btn btn-primary btn-sm">Resume Ep ${latest.episode}</a></div>
        </div>`;
      }

      html += `<div>${historyList
        .map((item, i) => {
          const ft = new Date(item.timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return `<div class="history-item" id="history-item-${i}">
          <div class="history-thumb"><img src="${esc(item.coverImage.extraLarge || item.coverImage.large)}" alt="${esc(item.title)}"></div>
          <div class="history-info">
            <a href="#/anime/${item.animeId}" class="history-title" style="font-weight:600;display:block">${esc(item.title)}</a>
            <div class="history-ep">Episode ${item.episode}</div>
            <div class="history-time">${ft}</div>
          </div>
          <div class="history-actions"><a href="#/watch/${item.animeId}/${item.episode}" class="btn btn-outline btn-sm">Watch Again</a></div>
        </div>`;
        })
        .join("")}</div>`;
    }

    app.innerHTML = html;
    const clearBtn = document.getElementById("clear-history-btn");
    if (clearBtn)
      clearBtn.addEventListener("click", () => {
        clearHistory();
        renderHistory();
      });
  }

  function renderAbout() {
    const discordIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;
    const githubIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;

    let html = `<div class="about">`;
    html += `<h1 class="section-title" style="margin-bottom:8px">About AniCult</h1>`;
    html += `<p class="about-text">AniCult is a free, ad-free anime streaming experience that runs entirely in your browser. Browse anime powered by AniList, stream instantly through the built-in player, and track your watchlist, history, and episode progress with no account or sign-up required.</p>`;

    html += `<h2 class="about-subtitle">What's Inside</h2>`;
    html += `<ul class="about-list">`;
    html += `<li>Trending, popular, and recently updated anime refreshed directly from AniList</li>`;
    html += `<li>Search with format filters (TV, Movie, OVA, ONA, Special) and 6 sort options</li>`;
    html += `<li>Sub/Dub player with autoplay, auto-next, and error retry support</li>`;
    html += `<li>Watchlist, watch history, and episode progress saved locally in your browser</li>`;
    html += `<li>Fully responsive design built for both desktop and mobile devices</li>`;
    html += `</ul>`;

    html += `<div class="about-connect">`;
    html += `<div class="about-card-col">`;
    html += `<div class="about-dev-header"><span class="about-dev-badge">Founded by</span></div>`;
    html += `<div class="about-discord">`;
    html += `<img class="about-discord-banner" src="https://cdn.discordapp.com/banners/1455877276007796738/a_5d74cf1372c78893f1ac6c1f3170a7ba.gif?size=1024" alt="Dacca Cult banner" loading="lazy">`;
    html += `<div class="about-discord-body">`;
    html += `<img class="about-discord-icon" src="https://cdn.discordapp.com/icons/1455877276007796738/b863a4836ae39be4a9afbecd969504c5.png?size=256" alt="Dacca Cult icon" loading="lazy">`;
    html += `<div class="about-discord-name">Dacca Cult</div>`;
    html += `<div class="about-discord-meta"><span>237 members</span><span class="about-sep">&middot;</span><span class="about-online"><i class="presence-dot"></i>27 online</span></div>`;
    html += `<p class="about-discord-desc">We value freedom of speech, ensuring a welcoming space for community bonding with dedicated rooms for various discussions.</p>`;
    html += `<a href="https://discord.gg/rsC4V32GZa" target="_blank" rel="noopener noreferrer" class="btn btn-primary">${discordIcon}Join Server</a>`;
    html += `</div></div></div>`;
    html += `<div class="about-card-col">`;
    html += `<div class="about-dev-header"><span class="about-dev-badge">Main Developer of AniCult</span></div>`;
    html += `<a class="about-row" href="https://github.com/aluukill/AniCult" target="_blank" rel="noopener noreferrer">${githubIcon}<span class="about-card-text"><span class="about-link-title">Source on GitHub</span><span class="about-link-text">Star the project, report issues, or contribute</span></span></a>`;
    html += `<a class="about-row" href="https://linktr.ee/aluukill" target="_blank" rel="noopener noreferrer"><img class="about-social-logo" src="https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/logos/linktree-hrggdeqdzll06zjl9h6j.png/linktree-bafynmeua3noot52xbu71.png?_a=DATAiZAAZAA0" alt="Linktree" loading="lazy"><span class="about-card-text"><span class="about-link-title">Linktree</span><span class="about-link-text">@aluukill</span></span></a>`;
    html += `<a class="about-row" href="https://syedtanvir.vercel.app" target="_blank" rel="noopener noreferrer"><img class="about-portfolio-logo" src="https://syedtanvir.vercel.app/assets/icon.png" alt="Portfolio" loading="lazy"><span class="about-card-text"><span class="about-link-title">Portfolio</span><span class="about-link-text">syedtanvir.vercel.app</span></span></a>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    app.innerHTML = html;
  }

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) {
      location.hash = "/search?q=" + encodeURIComponent(q);
      searchInput.value = "";
    }
  });

  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("nav-links");
  function closeMenu() {
    navLinks.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  });
  navLinks.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".nav") && navLinks.classList.contains("open"))
      closeMenu();
  });

  window.addEventListener("hashchange", () => {
    if (navLinks.classList.contains("open")) closeMenu();
    route();
  });
  route();
})();
