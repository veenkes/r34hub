const state = {
  activeTab: 'home',
  source: 'all',
  tags: '',
  rating: 's',
  sort: 'score',
  page: 1,
  isLoading: false,
  hasMore: true,
  posts: [],
  expandedTagCards: new Set(),
  sources: [],
  trendingTags: [],
  adsConfig: null,
  isPro: false,
  licenseKey: localStorage.getItem('bp_license') || '',
  savedPosts: JSON.parse(localStorage.getItem('bp_saved') || '[]'),
  blacklist: JSON.parse(localStorage.getItem('bp_blacklist') || '["lowres","watermark"]'),
  showAdsPreview: true,
  selectedPlan: 'annual',
  activePost: null,
  queryToken: 0,
  partialFills: 0,
  partialStall: 0,
  lastPartial: false,
  reelObserver: null,
  reelsLoadObserver: null,
  featureObserver: null
};

const SORT_LABEL = { score: 'Popular', latest: 'New', video: 'Video', no_ai: 'No AI', trending: 'Popular' };
const RATING_LABEL = { s: 'Safe', q: 'Questionable', e: 'Explicit', all: 'All ratings' };

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function formatScore(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 10000) return String(n);
  if (abs < 1000000) {
    const text = (abs / 1000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0$/, '');
    return `${sign}${text}k`;
  }
  const text = (abs / 1000000).toFixed(abs >= 100000000 ? 0 : 1).replace(/\.0$/, '');
  return `${sign}${text}m`;
}

function sourceLabel() {
  if (state.source === 'all') return 'All boards';
  const found = state.sources.find(s => s.id === state.source);
  return found ? found.name : state.source;
}

function paintChoice(selector, key, value) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.classList.toggle('is-on', btn.dataset[key] === value);
  });
}

function browsingPosts() {
  return state.activeTab === 'gallery' || state.activeTab === 'reels';
}

function pageForPath() {
  const path = location.pathname;
  if (path.startsWith('/posts/')) return 'reels';
  if (path === '/grid' || path.startsWith('/grid/')) return 'gallery';
  if (path === '/saved' || path.startsWith('/saved/')) return 'saved';
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings';
  return 'home';
}

function feedQuery() {
  const params = new URLSearchParams();
  if (state.sort && state.sort !== 'score') params.set('filter[sort]', state.sort);
  if (state.tags.trim()) params.set('tags', state.tags.trim());
  if (state.rating && state.rating !== 's') params.set('rating', state.rating);
  return params.toString();
}

function hrefForTab(tabId) {
  if (tabId === 'saved') return '/saved';
  if (tabId === 'settings') return '/settings';
  if (tabId === 'gallery' || tabId === 'reels') {
    const slug = encodeURIComponent(state.source === 'all' ? 'rule34.xxx' : state.source);
    const query = feedQuery();
    const base = tabId === 'gallery' ? '/grid/' : '/posts/';
    return base + slug + (query ? `?${query}` : '');
  }
  return '/';
}

function paintSearchDot() {
  const dot = document.getElementById('search-dot');
  const countEl = document.getElementById('active-filter-count');
  if (!dot || !countEl) return;
  dot.classList.toggle('hidden', countEl.textContent === '0');
}

function placeSearch(where) {
  const block = document.getElementById('search-block');
  const mount = document.getElementById(where === 'sheet' ? 'sheet-search-mount' : 'home-search-mount');
  if (block && mount && block.parentElement !== mount) mount.appendChild(block);
}

function showBrowseAndReload() {
  state.page = 1;
  const sheet = document.getElementById('search-sheet');
  const keepSearch = Boolean(sheet && !sheet.classList.contains('hidden'));
  if (!browsingPosts()) {
    location.assign(hrefForTab('reels'));
    return;
  }
  if (!keepSearch) closeSearchMenu();
  syncUrlBarInPlace();
  if (!state.isLoading) loadPosts(false);
}

function syncUrlBarInPlace() {
  const badge = document.getElementById('feed-status-badge');
  if (badge) badge.textContent = sourceLabel();
  renderActiveTagPills();
  if (!browsingPosts()) return;
  const slug = encodeURIComponent(state.source === 'all' ? 'rule34.xxx' : state.source);
  const query = feedQuery();
  const base = state.activeTab === 'gallery' ? '/grid/' : '/posts/';
  try {
    window.history.replaceState({}, '', `${base}${slug}${query ? `?${query}` : ''}`);
  } catch (_) {}
}

function parseTagTokens() {
  return state.tags.trim().split(/\s+/).filter(Boolean);
}

function readUrlState() {
  const slug = (location.pathname.match(/^\/(?:posts|grid)\/([^/]+)/) || [])[1];
  if (slug && decodeURIComponent(slug) !== 'rule34.xxx') state.source = decodeURIComponent(slug);
  const urlParams = new URLSearchParams(window.location.search);
  const sort = urlParams.get('filter[sort]');
  if (sort) state.sort = sort;
  const rating = urlParams.get('rating');
  if (rating) state.rating = rating;
  if (urlParams.get('tags')) state.tags = urlParams.get('tags');
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  paintChoice('.rating-btn', 'rating', state.rating);
  paintChoice('.sort-btn', 'sort', state.sort);
}

window.toggleTagInPlace = function(tag, mode = 'include') {
  const clean = String(tag).replace(/^[+-]/, '').trim();
  if (!clean) return;
  let tokens = parseTagTokens().filter(t => t.replace(/^[+-]/, '') !== clean);
  if (mode === 'include') tokens.push(clean);
  else if (mode === 'exclude') tokens.push(`-${clean}`);
  state.tags = tokens.join(' ');
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !state.tags);
  state.page = 1;
  showBrowseAndReload();
  closeTagSheet();
  showToast(mode === 'exclude' ? `Hiding ${clean}` : `Showing ${clean}`);
};

window.removeTagToken = function(rawToken) {
  state.tags = parseTagTokens().filter(t => t !== rawToken).join(' ');
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !state.tags);
  state.page = 1;
  showBrowseAndReload();
};

function renderActiveTagPills() {
  const bar = document.getElementById('active-tag-pills');
  const countEl = document.getElementById('active-filter-count');
  const tokens = parseTagTokens();
  let filters = tokens.length;
  if (state.rating !== 's') filters += 1;
  if (state.sort !== 'score') filters += 1;
  if (state.source !== 'all') filters += 1;
  if (countEl) {
    countEl.textContent = String(filters);
    countEl.classList.toggle('is-zero', filters === 0);
  }
  const boardName = document.getElementById('sheet-board-name');
  if (boardName) boardName.textContent = sourceLabel();
  renderQuickTags();
  paintSearchDot();
  if (!bar) return;
  bar.classList.toggle('is-empty', !tokens.length);
  if (!tokens.length) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = tokens.map(tok => {
    const isExcluded = tok.startsWith('-');
    const clean = tok.replace(/^[+-]/, '');
    return `
      <span class="token${isExcluded ? ' is-excluded' : ''}">
        <span>${isExcluded ? 'Hide' : 'Only'} ${esc(clean)}</span>
        <button type="button" data-${isExcluded ? 'include' : 'exclude'}="${esc(clean)}" title="${isExcluded ? 'Show this tag' : 'Hide this tag'}">${isExcluded ? 'Show' : 'Hide'}</button>
        <button type="button" data-remove-tag="${esc(tok)}" title="Remove">×</button>
      </span>
    `;
  }).join('');
}

function syncChrome() {
  const topAd = document.getElementById('top-ad-banner');
  const posts = document.getElementById('posts-chrome');
  if (posts) posts.classList.toggle('hidden', !browsingPosts());
  if (!topAd) return;
  const show = !state.isPro && state.showAdsPreview && browsingPosts();
  topAd.classList.toggle('hidden', !show);
}

function updateProUI() {
  const btn = document.getElementById('pro-cta-btn');
  const txt = document.getElementById('pro-cta-text');
  const topAd = document.getElementById('top-ad-banner');
  const adToggle = document.getElementById('toggle-ads-preview');
  if (state.isPro) {
    const prefix = (state.licenseKey || 'SHOP2').split('-')[0];
    if (txt) txt.textContent = `Pro on · ${prefix}`;
    if (btn) btn.classList.add('is-vip');
    state.showAdsPreview = false;
    if (topAd) topAd.classList.add('hidden');
  } else {
    if (txt) txt.textContent = 'Pro · €4.97';
    if (btn) btn.classList.remove('is-vip');
  }
  syncChrome();
  if (adToggle) {
    adToggle.checked = state.showAdsPreview;
    adToggle.disabled = state.isPro;
  }
  renderSourcePills();
  if (state.activeTab === 'gallery' && state.posts.length) renderGallery();
}

function faviconUrl(domain) {
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
}

function sourceItems() {
  return [{ id: 'all', name: 'All boards', domain: '', isPremiumSource: false }, ...state.sources];
}

function domainOptionHtml(source) {
  const active = state.source === source.id;
  const locked = Boolean(source.isPremiumSource && !state.isPro);
  const iconHtml = source.domain
    ? `<img src="${esc(faviconUrl(source.domain))}" alt="" width="20" height="20" referrerpolicy="no-referrer">`
    : '<span class="domain-fallback">All</span>';
  return `
    <button type="button" data-source="${esc(source.id)}" data-locked="${locked}" class="domain-option${active ? ' is-on' : ''}">
      ${iconHtml}
      <span>${esc(source.name)}</span>
      ${locked ? '<span class="lock">Pro</span>' : ''}
    </button>`;
}

function paintDomainButtons() {
  const current = sourceItems().find(source => source.id === state.source) || sourceItems()[0];
  document.querySelectorAll('[data-domain-icon]').forEach(img => {
    if (current.domain) {
      img.src = faviconUrl(current.domain);
      img.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
  });
  document.querySelectorAll('[data-domain-fallback]').forEach(el => {
    el.hidden = Boolean(current.domain);
  });
  const badge = document.getElementById('feed-status-badge');
  if (badge) badge.textContent = current.name;
  const visit = document.getElementById('visit-board');
  if (visit) {
    if (current.domain) {
      visit.href = `https://${current.domain}/`;
      visit.classList.remove('hidden');
    } else {
      visit.classList.add('hidden');
    }
  }
}

function closeDomainMenus() {
  document.querySelectorAll('.domain-menu').forEach(menu => menu.classList.add('hidden'));
  document.querySelectorAll('.domain-btn').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

window.toggleDomainMenu = function(menuId, button) {
  const menu = document.getElementById(menuId);
  const willOpen = menu && menu.classList.contains('hidden');
  closeDomainMenus();
  if (willOpen && menu) {
    menu.classList.remove('hidden');
    if (button) button.setAttribute('aria-expanded', 'true');
  }
};

function bindDomainMenu(menu) {
  if (!menu) return;
  const pickOnly = menu.id === 'home-domain-menu';
  menu.querySelectorAll('[data-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeDomainMenus();
      const locked = btn.dataset.locked === 'true';
      if (pickOnly) selectHomeSource(btn.dataset.source, locked);
      else selectSourceInPlace(btn.dataset.source, locked);
    });
  });
}

function renderSourcePills() {
  const allItems = sourceItems();
  const html = allItems.map(domainOptionHtml).join('');
  ['source-pills', 'home-domain-menu'].forEach(id => {
    const menu = document.getElementById(id);
    if (!menu) return;
    menu.innerHTML = html;
    bindDomainMenu(menu);
  });
  paintDomainButtons();
  renderHomeBoards();
  const drawerList = document.getElementById('drawer-source-list');
  if (drawerList) {
    drawerList.innerHTML = allItems.map(source => {
      const active = state.source === source.id;
      const locked = Boolean(source.isPremiumSource && !state.isPro);
      return `
        <button type="button" class="choice${active ? ' is-on' : ''}" onclick="selectSourceInPlace('${esc(source.id)}', ${locked})">
          ${esc(source.name)}${locked ? ' · Pro' : ''}
        </button>`;
    }).join('');
  }
}

const HOME_ORDER = ['rule34xxx', 'danbooru', 'yandere'];
const FEATURE_SHORTCUTS = [
  { label: 'Trending', sort: 'score', tags: '' },
  { label: 'New', sort: 'latest', tags: '' },
  { label: 'No AI', sort: 'no_ai', tags: '', fetchSort: 'score', fetchTags: '-ai_generated' },
  // { label: 'Video', sort: 'video', tags: '' }
];
let homeBoardKey = '';
const featuredCache = new Map();
const featuredSeen = new Set();
let featureClaim = Promise.resolve();

function homeSources() {
  const byId = new Map(state.sources.map(source => [source.id, source]));
  return HOME_ORDER.map(id => byId.get(id)).filter(Boolean);
}

function featureCardHtml(sourceId, locked, item, index) {
  return `
    <li class="feature-card">
      <button type="button" data-feature-source="${esc(sourceId)}" data-feature-locked="${locked ? 'true' : 'false'}" data-feature-sort="${esc(item.sort)}" data-feature-tags="${esc(item.tags)}" aria-label="${esc(item.label)}">
        <figure>
          <span class="feature-media" data-feature-slot="${index}"></span>
          <figcaption>${esc(item.label)}</figcaption>
        </figure>
      </button>
    </li>`;
}

function fitFeatureRow(row) {
  if (!row || !row.isConnected) return;
  const count = row.querySelectorAll('.feature-card').length;
  row.dataset.count = String(count);
  const section = row.closest('.board-block');
  if (!count && section) section.remove();
}

function renderHomeBoards() {
  const homeBoards = document.getElementById('home-boards');
  if (!homeBoards) return;
  const key = homeSources().map(source => `${source.id}:${source.isPremiumSource ? 1 : 0}`).join('|') + (state.isPro ? ':pro' : '');
  if (key === homeBoardKey) return;
  homeBoardKey = key;
  featuredSeen.clear();
  featuredCache.clear();
  featureClaim = Promise.resolve();
  homeBoards.innerHTML = homeSources().map(source => {
    const locked = Boolean(source.isPremiumSource && !state.isPro);
    const fav = source.domain
      ? `<img src="${esc(faviconUrl(source.domain))}" alt="" width="20" height="20" referrerpolicy="no-referrer">`
      : '';
    return `
      <section class="board-block">
        <button type="button" class="board-head" onclick="selectSourceInPlace('${esc(source.id)}', ${locked})">
          ${fav}<span>${esc(source.domain || source.name)}</span>${locked ? '<span class="lock">Pro</span>' : ''}
        </button>
        <ol class="feature-row" data-feature-row="${esc(source.id)}" data-count="0"></ol>
      </section>`;
  }).join('');
  observeFeaturedRows();
}

function featuredRating(sourceId) {
  if (sourceId === 'paheal' || sourceId === 'rule34xxx' || sourceId === 'xbooru') return 'all';
  return 's';
}

function paintFeatured(row, items) {
  const sourceId = row.dataset.featureRow;
  const locked = Boolean(row.closest('.board-block') && row.closest('.board-block').querySelector('.lock'));
  const usable = (items || []).filter(item => item && item.post && cardStill(item.post).src);
  if (!usable.length) {
    const section = row.closest('.board-block');
    if (section) section.remove();
    return;
  }
  row.innerHTML = usable.map((item, index) => featureCardHtml(sourceId, locked, item, index)).join('');
  row.dataset.count = String(usable.length);
  usable.forEach((item, index) => {
    const slot = row.querySelector(`[data-feature-slot="${index}"]`);
    if (!slot) return;
    const shown = cardStill(item.post);
    const img = document.createElement('img');
    img.alt = item.label;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    if (shown.proxy) img.dataset.proxy = shown.proxy;
    img.addEventListener('error', () => {
      if (img.getAttribute('data-proxy') && img.dataset.proxied !== '1') {
        useProxy(img);
        return;
      }
      const card = img.closest('.feature-card');
      if (card) card.remove();
      fitFeatureRow(row);
    });
    img.src = shown.src;
    slot.appendChild(img);
  });
}

function featureImageKey(post) {
  let src = cardStill(post).src || post.fileUrl || post.sampleUrl || post.previewUrl || '';
  try {
    const parsed = new URL(src, 'http://r34hub.local');
    const inner = parsed.searchParams.get('url');
    if (inner) src = inner;
  } catch (_) {}
  const path = String(src).split('?')[0].toLowerCase();
  const hash = path.match(/[a-f0-9]{40}|[a-f0-9]{32}/);
  return hash ? hash[0] : path;
}

function bestFeaturePost(posts, shortcut, used) {
  const wantVideo = shortcut.sort === 'video';
  const list = (posts || []).filter(post => {
    if (used && (used.has(post.id) || used.has(featureImageKey(post)))) return false;
    const shown = cardStill(post);
    if (!shown.src || looksLikeVideo(shown.src)) return false;
    if (shortcut.sort === 'no_ai' && (post.tags || []).some(tag => /ai_generated|^ai$/i.test(tag))) return false;
    if (wantVideo) return post.mediaType === 'video' || looksLikeVideo(post.fileUrl || post.sampleUrl || '');
    return post.mediaType !== 'video';
  });
  if (!list.length) return null;
  if (shortcut.sort === 'latest' || !list.some(post => Number(post.score) > 0)) return list[0];
  return list.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0];
}

function claimFeaturePost(posts, shortcut) {
  const job = featureClaim.then(() => {
    const post = bestFeaturePost(posts, shortcut, featuredSeen);
    if (!post) return null;
    featuredSeen.add(post.id);
    const key = featureImageKey(post);
    if (key) featuredSeen.add(key);
    return post;
  });
  featureClaim = job.then(() => {}, () => {});
  return job;
}

async function loadFeaturedRow(row) {
  const sourceId = row.dataset.featureRow;
  if (!sourceId || row.dataset.featureLoaded === '1') return;
  row.dataset.featureLoaded = '1';
  if (featuredCache.has(sourceId)) {
    paintFeatured(row, featuredCache.get(sourceId));
    return;
  }
  try {
    const batches = await Promise.all(FEATURE_SHORTCUTS.map(async shortcut => {
      const q = new URLSearchParams({
        source: sourceId,
        tags: shortcut.fetchTags || shortcut.tags,
        rating: featuredRating(sourceId),
        sort: shortcut.fetchSort || shortcut.sort,
        page: '1',
        limit: '16'
      });
      try {
        const res = await fetch(`/api/posts?${q.toString()}`);
        if (!res.ok) return { shortcut, posts: [] };
        const data = await res.json();
        return { shortcut, posts: data.posts || [] };
      } catch (_) {
        return { shortcut, posts: [] };
      }
    }));
    const items = [];
    for (const { shortcut, posts } of batches) {
      const post = await claimFeaturePost(posts, shortcut);
      if (!post) continue;
      items.push({ label: shortcut.label, sort: shortcut.sort, tags: shortcut.tags, post });
    }
    featuredCache.set(sourceId, items);
    if (row.isConnected) paintFeatured(row, items);
  } catch (_) {
    const section = row.closest('.board-block');
    if (section) section.remove();
  }
}

function observeFeaturedRows() {
  const rows = [...document.querySelectorAll('[data-feature-row]')];
  if (!rows.length || !('IntersectionObserver' in window)) {
    rows.forEach(loadFeaturedRow);
    return;
  }
  if (state.featureObserver) state.featureObserver.disconnect();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadFeaturedRow(entry.target);
    });
  }, { rootMargin: '240px' });
  state.featureObserver = observer;
  rows.forEach(row => observer.observe(row));
}

window.openBoard = function(id, locked, sort) {
  if (sort) {
    state.sort = sort;
    paintChoice('.sort-btn', 'sort', sort);
  }
  selectSourceInPlace(id, locked);
};

window.openFeature = function(id, locked, sort, tags) {
  state.tags = tags || '';
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !state.tags);
  if (sort) {
    state.sort = sort;
    paintChoice('.sort-btn', 'sort', sort);
  }
  selectSourceInPlace(id, locked);
};

window.selectHomeSource = function(src, locked) {
  if (locked) {
    showToast('That board is part of Pro.');
    openProModal();
    return;
  }
  state.source = src;
  renderSourcePills();
};

window.selectSourceInPlace = function(src, locked) {
  if (locked) {
    showToast('That board is part of Pro.');
    openProModal();
    return;
  }
  state.source = src;
  state.page = 1;
  renderSourcePills();
  showBrowseAndReload();
};

function setRating(rating, reload = true) {
  state.rating = rating;
  state.page = 1;
  paintChoice('.rating-btn', 'rating', rating);
  if (reload && browsingPosts()) showBrowseAndReload();
  else if (browsingPosts()) syncUrlBarInPlace();
}

window.setSortInPlace = function(sort) {
  state.sort = sort;
  state.page = 1;
  paintChoice('.sort-btn', 'sort', sort);
  if (browsingPosts()) showBrowseAndReload();
};

window.resetAllFilters = function() {
  state.tags = '';
  state.source = 'all';
  state.sort = 'score';
  state.rating = 's';
  state.page = 1;
  const input = document.getElementById('tag-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.add('hidden');
  paintChoice('.rating-btn', 'rating', 's');
  paintChoice('.sort-btn', 'sort', 'score');
  renderSourcePills();
  showBrowseAndReload();
  closeFilterDrawer();
};

window.openHomeFeed = function(opts = {}) {
  if (opts.sort) {
    state.sort = opts.sort;
    paintChoice('.sort-btn', 'sort', opts.sort);
  }
  if (opts.rating) {
    state.rating = opts.rating;
    paintChoice('.rating-btn', 'rating', opts.rating);
  }
  if (opts.tags != null) {
    state.tags = opts.tags;
    const input = document.getElementById('tag-search-input');
    if (input) input.value = opts.tags;
  }
  closeSideMenu();
  closeSearchMenu();
  showBrowseAndReload();
};

window.triggerAdClick = async function(placement, offerId, postId, tag, mediaUrl = '') {
  try {
    const res = await fetch('/api/ads/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placement, offerId, postId, tag, mediaUrl })
    });
    const data = await res.json();
    if (data && data.targetUrl) {
      window.open(data.targetUrl, '_blank', 'noopener');
      return;
    }
  } catch (_) {}
  window.open('https://candy.ai/?aff=r34hub', '_blank', 'noopener');
};

window.toggleCardTags = function(postId, button) {
  const card = button && button.closest('article');
  const drawer = card && card.querySelector('.tags');
  if (!drawer) return;
  drawer.classList.toggle('hidden');
  const hidden = drawer.classList.contains('hidden');
  if (hidden) state.expandedTagCards.delete(postId);
  else state.expandedTagCards.add(postId);
  button.classList.toggle('is-on', !hidden);
  button.setAttribute('aria-expanded', hidden ? 'false' : 'true');
};

function cssId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function cssAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function ratioStyle(post) {
  const w = Number(post.width) || 0;
  const h = Number(post.height) || 0;
  if (w < 2 || h < 2) return '';
  return `aspect-ratio:${w} / ${h}`;
}

function useProxy(img) {
  const proxy = img.getAttribute('data-proxy');
  if (!proxy || img.dataset.proxied === '1') return;
  img.dataset.proxied = '1';
  img.src = proxy;
}
window.useProxy = useProxy;

async function loadPosts(append = false, silent = false) {
  if (state.isLoading) return;
  if (silent && state.page !== 1) return;
  state.isLoading = true;
  if (!silent) {
    state.queryToken += 1;
    state.partialFills = 0;
  }
  const token = state.queryToken;
  const feedEl = document.getElementById('masonry-feed');
  const summaryEl = document.getElementById('feed-summary-text');
  const scrollText = document.getElementById('scroll-status-text');
  const spinner = document.getElementById('scroll-spinner');
  if (spinner) spinner.classList.add('is-on');
  const previousCount = state.posts.length;

  if (!append && !silent) {
    state.page = 1;
    state.hasMore = true;
    state.partialStall = 0;
    if (summaryEl) summaryEl.textContent = 'Asking the boards…';
    if (state.activeTab === 'gallery' && feedEl) {
      feedEl.innerHTML = Array.from({ length: 8 }, () => '<div class="masonry-item skel"></div>').join('');
    }
    const reelBox = document.getElementById('reels-feed');
    if (state.activeTab === 'reels' && reelBox) {
      reelBox.innerHTML = '<div class="reel skel-reel"></div><div class="reel skel-reel"></div>';
    }
  } else if (append) {
    if (scrollText) scrollText.textContent = 'Loading more…';
    if (state.activeTab === 'gallery' && feedEl) {
      feedEl.insertAdjacentHTML('beforeend', Array.from({ length: 4 }, () => '<div class="masonry-item skel skel-pending"></div>').join(''));
    }
  }

  let data = null;
  try {
    const q = new URLSearchParams({
      source: state.source,
      tags: state.tags,
      rating: state.rating,
      sort: state.sort,
      page: String(state.page),
      limit: '24'
    });
    const res = await fetch(`/api/posts?${q.toString()}`);
    const rawText = await res.text();
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      throw new Error('The boards are busy — please try again');
    }
    if (!res.ok) throw new Error((data && data.error) || 'The boards did not answer');
    const blocked = new Set(state.blacklist.map(t => t.toLowerCase()));
    const rawFiltered = (data.posts || []).filter(p => !(p.tags || []).some(t => blocked.has(String(t).toLowerCase())));
    const rawPosts = [];
    const batchSeenIds = new Set();
    const batchSeenMedia = new Set();
    for (const p of rawFiltered) {
      const mk = featureImageKey(p);
      if (batchSeenIds.has(p.id) || (mk && batchSeenMedia.has(mk))) continue;
      batchSeenIds.add(p.id);
      if (mk) batchSeenMedia.add(mk);
      rawPosts.push(p);
    }

    state.lastPartial = Boolean(data.partial);
    if (append) {
      const existingIds = new Set(state.posts.map(p => p.id));
      const existingMedia = new Set(state.posts.map(p => featureImageKey(p)).filter(Boolean));
      const fresh = rawPosts.filter(p => {
        const mk = featureImageKey(p);
        if (existingIds.has(p.id) || (mk && existingMedia.has(mk))) return false;
        existingIds.add(p.id);
        if (mk) existingMedia.add(mk);
        return true;
      });
      state.posts = state.posts.concat(fresh);
      if (fresh.length === 0) {
        // One repeated or filtered-out page is not the end of the board.
        if ((state.partialStall += 1) >= 3) state.hasMore = false;
      } else {
        state.partialStall = 0;
      }
      if (state.activeTab === 'gallery') renderGallery({ appendFrom: previousCount });
      if (state.activeTab === 'reels' && fresh.length) appendReels(fresh);
    } else {
      const same = silent
        && state.posts.length === rawPosts.length
        && state.posts.every((post, index) => post.id === rawPosts[index].id);
      const slides = [...document.querySelectorAll('#reels-feed .reel[data-id]')];
      const prefix = slides.length > 0 && slides.every((slide, index) => rawPosts[index] && slide.dataset.id === String(rawPosts[index].id));
      state.posts = rawPosts;
      if (!rawPosts.length && !data.partial) state.hasMore = false;
      if (!same && state.activeTab === 'gallery') renderGallery();
      if (state.activeTab === 'reels') {
        if (silent && prefix) appendReels(rawPosts.slice(slides.length));
        else if (!same) renderReels();
      }
    }

    if (summaryEl) {
      const bits = [`${state.posts.length} posts`, SORT_LABEL[state.sort] || state.sort, RATING_LABEL[state.rating] || state.rating];
      summaryEl.textContent = data.partial && state.posts.length < 8
        ? `${state.posts.length} posts · still loading`
        : bits.join(' · ');
    }
    if (scrollText) {
      scrollText.textContent = state.hasMore ? 'Scroll to load more' : `End of this feed · ${state.posts.length} posts`;
    }
    paintReelsStatus();
  } catch (err) {
    if (!append && !silent && feedEl) {
      feedEl.innerHTML = `<div class="empty"><h2>The boards did not answer</h2><p>${esc(err.message)}</p><button class="btn btn-primary" type="button" onclick="loadPosts(false)">Try again</button></div>`;
    }
    document.querySelectorAll('#masonry-feed .skel-pending').forEach(node => node.remove());
    if (summaryEl && !silent) summaryEl.textContent = 'Could not load the feed';
  } finally {
    state.isLoading = false;
    if (spinner) spinner.classList.remove('is-on');
    paintReelsStatus();
  }

  if (data && data.partial && !append && state.partialFills < 2 && token === state.queryToken) {
    state.partialFills += 1;
    setTimeout(() => {
      if (token === state.queryToken) loadPosts(false, true);
    }, 1400);
  } else if (state.activeTab === 'reels') {
    pumpReels();
  } else if (state.activeTab === 'gallery') {
    pumpGallery();
  }
}

function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function setSlot(btn, iconName, label) {
  if (!btn) return;
  const slot = btn.querySelector('.ico-slot');
  if (slot) slot.innerHTML = icon(iconName);
  const text = btn.querySelector('.btn-label');
  if (text && label != null) text.textContent = label;
  if (btn.classList.contains('icon-btn')) btn.classList.toggle('is-on', iconName === 'heart-fill');
}

function stillUrl(post) {
  return post.previewUrl || post.proxiedPreviewUrl || '';
}

function directIsBlocked(url) {
  return /donmai\.us|e621\.net|e926\.net|konachan\.(com|net)/i.test(String(url || ''));
}

function displayStill(post) {
  const direct = stillUrl(post);
  const proxy = post.proxiedPreviewUrl || '';
  if (directIsBlocked(direct) && proxy) return { src: proxy, proxy: '' };
  return { src: direct, proxy };
}

function isDisplayStill(post, url) {
  if (!url || looksLikeVideo(url)) return false;
  // Some boards serve the mp4 with no extension. Never put that file in an img.
  if (post && post.mediaType === 'video' && url === post.fileUrl) return false;
  return true;
}

function cardStill(post) {
  const preview = isDisplayStill(post, post.previewUrl) ? post.previewUrl : '';
  const sample = isDisplayStill(post, post.sampleUrl) ? post.sampleUrl : '';
  let direct = sample || preview;
  let proxy = sample ? (post.proxiedSampleUrl || '') : (post.proxiedPreviewUrl || '');
  const previewProxy = post.proxiedPreviewUrl || '';
  if (looksLikeVideo(direct) || (post.mediaType === 'video' && direct === post.fileUrl)) {
    direct = preview;
    proxy = previewProxy;
  }
  if (!direct) direct = previewProxy;
  if (direct && directIsBlocked(direct)) {
    const src = proxy || previewProxy;
    const fallback = previewProxy && previewProxy !== src ? previewProxy : '';
    return { src, proxy: fallback };
  }
  const fallback = proxy && proxy !== direct ? proxy : (previewProxy && previewProxy !== direct ? previewProxy : '');
  return { src: direct || fallback, proxy: fallback };
}

function looksLikeVideo(url) {
  return /\.(mp4|webm|mkv|mov|m4v)(?:$|\?)/i.test(String(url || ''));
}

function sharpUrl(post) {
  const preview = post.previewUrl || '';
  const sample = post.sampleUrl || '';
  const file = post.fileUrl || '';
  const sampleIsStill = isDisplayStill(post, sample) && sample !== preview;
  if (post.mediaType === 'video') return sampleIsStill ? sample : (isDisplayStill(post, preview) ? preview : (post.proxiedPreviewUrl || ''));
  if (sampleIsStill) return sample;
  if (file && file !== preview && !looksLikeVideo(file)) return file;
  return sample || file || preview || post.proxiedSampleUrl || '';
}

function sharpProxy(post) {
  const sampleIsStill = isDisplayStill(post, post.sampleUrl) && post.sampleUrl !== post.previewUrl;
  if (post.mediaType === 'video') return sampleIsStill ? (post.proxiedSampleUrl || '') : (post.proxiedPreviewUrl || '');
  if (sampleIsStill) return post.proxiedSampleUrl || '';
  if (post.fileUrl && post.fileUrl !== post.previewUrl && !looksLikeVideo(post.fileUrl)) return post.proxiedFileUrl || '';
  return post.proxiedSampleUrl || post.proxiedPreviewUrl || '';
}

function sameUrl(a, b) {
  if (!a || !b) return false;
  try { return new URL(a, location.href).href === new URL(b, location.href).href; }
  catch (_) { return a === b; }
}

function loadVideo(video, file, proxy, autoplay) {
  const start = () => { if (autoplay) video.play().catch(() => {}); };
  video.onerror = () => {
    if (!proxy || video.dataset.tried === '1' || sameUrl(video.currentSrc || video.src, proxy)) return;
    video.dataset.tried = '1';
    video.src = proxy;
    start();
  };
  video.src = file || proxy;
  start();
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let mediaMuted = true;

function tagChip(tag, post) {
  const kind = post ? tagDot(post, tag) : '';
  return `<span class="tag ${kind}">
    <button type="button" data-include="${esc(tag)}"><i class="${kind}"></i>${esc(tag)}</button>
    <button type="button" class="tag-block" data-exclude="${esc(tag)}" title="Hide this tag" aria-label="Hide ${esc(tag)}">${icon('block')}</button>
  </span>`;
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function playerInner(poster, proxy) {
  return `
    <img class="player-poster" alt="" referrerpolicy="no-referrer" src="${esc(poster || '')}" data-proxy="${esc(proxy || '')}" onerror="useProxy(this)" />
    <video muted loop playsinline webkit-playsinline preload="metadata"></video>
    <button type="button" class="player-play" data-player-toggle aria-label="Play">${icon('play')}</button>
    <div class="player-bar">
      <button type="button" class="player-btn" data-player-toggle aria-label="Play">${icon('play')}</button>
      <input class="player-range" type="range" min="0" max="1000" value="0" step="1" aria-label="Progress" />
      <span class="player-time">0:00</span>
      <button type="button" class="player-btn" data-player-mute aria-label="Unmute">${icon('mute')}</button>
    </div>`;
}

function playerSource(root) {
  const reel = root.closest('.reel');
  return {
    file: root.dataset.file || (reel && reel.dataset.file) || '',
    proxy: root.dataset.proxyFile || (reel && reel.dataset.proxyFile) || ''
  };
}

let videoPlayCount = 0;

function maybeShowVideoPreroll(containerEl, onComplete) {
  if (state.isPro || !state.showAdsPreview || !containerEl) {
    onComplete();
    return;
  }
  videoPlayCount += 1;
  if (videoPlayCount !== 1 && videoPlayCount % 3 !== 1) {
    onComplete();
    return;
  }
  if (containerEl.querySelector('.preroll-overlay')) return;
  const aadsId = (state.adsConfig && state.adsConfig.aads && state.adsConfig.aads.unitId) || '2460259';
  const exoZoneId = (state.adsConfig && state.adsConfig.exoclick && state.adsConfig.exoclick.zoneId) || '6068261';
  const art = pickAdultAdArtwork(videoPlayCount);
  const activeTag = parseTagTokens()[0] || art.tag || 'hentai';
  const overlay = document.createElement('div');
  overlay.className = 'preroll-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:6;background:rgba(9,9,11,0.94);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;text-align:center;gap:10px;';
  overlay.innerHTML = `
    <span class="meta-badge" style="margin:0;background:rgba(225,29,72,0.22);border-color:rgba(225,29,72,0.55);color:#fda4af;font-weight:700;">🔞 18+ NSFW AD · Video starts in <b data-preroll-sec>3</b>s</span>
    <div style="font-size:16px;font-weight:700;color:#fff;">Uncensored 18+ AI Undress & Hentai Video Chat</div>
    <div style="font-size:12px;color:#d4d4d8;max-width:320px;">Turn any character into an explicit 18+ interactive animation or roleplay chat.</div>
    <div style="width:300px;height:250px;overflow:hidden;border-radius:10px;border:1px solid var(--line);background:#000;display:flex;align-items:center;justify-content:center;">
      <iframe src="https://syndication.exdynsrv.com/ads-iframe-display.php?idzone=${esc(exoZoneId)}&output=noscript&type=300x250" width="300" height="250" scrolling="no" marginwidth="0" marginheight="0" frameborder="0" title="ExoClick 18+ Pre-Roll"></iframe>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px;">
      <button type="button" class="btn btn-primary btn-tiny" style="background:#e11d48;color:#fff;font-weight:700;" data-preroll-cta>🔞 Open 18+ AI Studio →</button>
      <button type="button" class="btn btn-ghost btn-tiny" data-preroll-skip disabled>Skip (3)</button>
    </div>
  `;
  overlay.addEventListener('click', e => e.stopPropagation());
  containerEl.appendChild(overlay);

  const secEl = overlay.querySelector('[data-preroll-sec]');
  const skipBtn = overlay.querySelector('[data-preroll-skip]');
  const ctaBtn = overlay.querySelector('[data-preroll-cta]');
  let left = 3;
  const finish = () => {
    clearInterval(timer);
    overlay.remove();
    onComplete();
  };
  ctaBtn.addEventListener('click', () => {
    triggerAdClick('post_video_ai', 'nud3_video', 'preroll', activeTag);
    finish();
  });
  skipBtn.addEventListener('click', finish);
  const timer = setInterval(() => {
    left -= 1;
    if (secEl) secEl.textContent = String(Math.max(0, left));
    if (left <= 0) {
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.textContent = 'Play video ▶';
      }
      finish();
    } else if (skipBtn) {
      skipBtn.textContent = `Skip (${left})`;
    }
  }, 1000);
}

function togglePlayer(root) {
  const video = root && root.querySelector('video');
  if (!video) return;
  if (!video.getAttribute('src')) {
    const source = playerSource(root);
    maybeShowVideoPreroll(root, () => {
      loadVideo(video, source.file, source.proxy, true);
    });
    return;
  }
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function bindPlayer(root) {
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  const video = root.querySelector('video');
  const range = root.querySelector('.player-range');
  const time = root.querySelector('.player-time');
  const toggles = root.querySelectorAll('[data-player-toggle]');
  const muteBtn = root.querySelector('[data-player-mute]');
  if (!video) return;
  video.muted = mediaMuted;
  video.playsInline = true;

  function paintPlay() {
    const playing = !video.paused && !video.ended;
    root.classList.toggle('is-playing', playing);
    toggles.forEach(btn => {
      btn.innerHTML = icon(playing ? 'pause' : 'play');
      btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    });
  }
  function paintMute() {
    if (!muteBtn) return;
    muteBtn.innerHTML = icon(video.muted ? 'mute' : 'volume');
    muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  }
  function paintTime() {
    if (time) time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    if (range && video.duration && !range.dataset.scrub) {
      range.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
  }
  toggles.forEach(btn => btn.addEventListener('click', () => togglePlayer(root)));
  if (muteBtn) muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    mediaMuted = video.muted;
    paintMute();
  });
  root.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target.closest('.player-bar, [data-player-toggle]')) return;
    togglePlayer(root);
  });
  video.addEventListener('play', paintPlay);
  video.addEventListener('pause', paintPlay);
  video.addEventListener('timeupdate', paintTime);
  video.addEventListener('loadedmetadata', paintTime);
  if (range) {
    const release = () => { delete range.dataset.scrub; };
    range.addEventListener('pointerdown', event => {
      range.dataset.scrub = '1';
      if (range.setPointerCapture) range.setPointerCapture(event.pointerId);
    });
    range.addEventListener('pointerup', release);
    range.addEventListener('pointercancel', release);
    range.addEventListener('lostpointercapture', release);
    range.addEventListener('input', () => {
      if (!video.duration) return;
      video.currentTime = (Number(range.value) / 1000) * video.duration;
      paintTime();
    });
  }
  paintPlay();
  paintMute();
}

function stopCardVideo(media) {
  if (!media) return;
  media.classList.remove('is-playing');
  const video = media.querySelector('video.card-video');
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

function stopAllCardVideos(except) {
  document.querySelectorAll('.card-media.is-playing').forEach(media => {
    if (media !== except) stopCardVideo(media);
  });
}

function playCardVideo(media) {
  if (!media || media.dataset.kind !== 'video') return;
  const existing = media.querySelector('video.card-video');
  if (media.classList.contains('is-playing') && existing) {
    existing.play().catch(() => {});
    return;
  }
  stopAllCardVideos(media);
  const video = document.createElement('video');
  video.className = 'card-video';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  media.appendChild(video);
  media.classList.add('is-playing');
  maybeShowVideoPreroll(media, () => {
    loadVideo(video, media.dataset.file || '', media.dataset.proxyFile || '', true);
  });
}

function toggleCardVideo(media) {
  if (!media) return;
  if (media.classList.contains('is-playing')) stopCardVideo(media);
  else playCardVideo(media);
}

const ADULT_FALLBACK_THUMBS = [
  'https://xbooru.com/images/257/66ade81490698aa620f16b9eddc415ef.jpeg',
  'https://xbooru.com/images/105/513ed2466c54fe4feaea546d8e33519c.jpeg',
  'https://xbooru.com/images/136/276a23befae5fb9d516c394229ece0c7.png',
  'https://xbooru.com/images/129/693397d7d43639a89e9bcaab439c2d6b.png',
  'https://xbooru.com/images/131/6e67b0bbe2adfeba20fb28cbff1e4dbb.jpeg',
  'https://xbooru.com/images/105/27d2e5faf95f990fd83a597d4b6b6c89.jpeg'
];

function pickAdultAdArtwork(idx = 0) {
  // Only use feed posts if they are explicitly rated 'e'; otherwise always use our dedicated 18+ adult artwork pool so ads are 18+ even when the feed is on Safe ('s') default!
  const explicitPosts = (state.posts || []).filter(p => p && p.rating === 'e' && !looksLikeVideo(cardStill(p).src));
  if (explicitPosts.length) {
    const chosen = explicitPosts[(idx * 3 + 1) % explicitPosts.length];
    const shown = cardStill(chosen);
    const charTag = (chosen.characterTags && chosen.characterTags[0]) || (chosen.tags && chosen.tags[0]) || 'waifu';
    return {
      src: shown.src,
      proxy: shown.proxy || chosen.proxiedPreviewUrl || '',
      tag: charTag
    };
  }
  const rawUrl = ADULT_FALLBACK_THUMBS[Math.floor(idx / 3) % ADULT_FALLBACK_THUMBS.length];
  const proxied = `/api/media?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent('https://xbooru.com/')}`;
  return { src: rawUrl, proxy: proxied, tag: 'hentai_waifu' };
}

function buildSponsoredCardHTML(idx = 12) {
  const aadsId = String((state.adsConfig && state.adsConfig.aads && state.adsConfig.aads.unitId) || '2460259');
  const exoZoneId = String((state.adsConfig && state.adsConfig.exoclick && state.adsConfig.exoclick.zoneId) || '6068261');
  const art = pickAdultAdArtwork(idx);
  const offers = [
    { id: 'candy_ai', name: 'Candy.ai 18+', title: 'Uncensored 18+ NSFW AI Waifu Sex Chat', cta: 'Chat 18+ Uncensored' },
    { id: 'nud3_video', name: 'Nud3.me 18+', title: 'AI Undress & 18+ Hentai Video Animator', cta: 'Undress / Animate 18+' },
    { id: 'spicychat_ai', name: 'SpicyChat 18+', title: 'No-Filter 18+ Adult Roleplay & Voice AI', cta: 'Start 18+ Roleplay' }
  ];
  const offer = offers[Math.floor(idx / 12) % offers.length];
  return `
    <article class="masonry-item card is-in is-ad-card" style="--d:${idx % 8}">
      <div class="card-media" onclick="triggerAdClick('infeed_native','${esc(offer.id)}','grid-ad-${idx}','${esc(art.tag)}')">
        <img
          src="${esc(art.src)}"
          data-proxy="${esc(art.proxy)}"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onerror="useProxy(this)"
        />
        <div class="card-float">
          <span class="pill" style="background:rgba(225,29,72,0.88);color:#fff;font-weight:700;">18+ NSFW AD</span>
          <span class="pill">${esc(offer.name)}</span>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:0;padding:24px 10px 10px;background:linear-gradient(180deg,transparent,rgba(0,0,0,0.92));color:#fff;font-size:12px;font-weight:650;line-height:1.3;">
          ${esc(offer.title)}
        </div>
      </div>
      <div style="width:100%;height:250px;overflow:hidden;background:#09090b;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:center;">
        <iframe src="https://syndication.exdynsrv.com/ads-iframe-display.php?idzone=${esc(exoZoneId)}&output=noscript&type=300x250" width="300" height="250" scrolling="no" marginwidth="0" marginheight="0" frameborder="0" loading="lazy" title="ExoClick 18+ Ad"></iframe>
      </div>
      <div class="card-body">
        <button type="button" class="btn btn-tiny btn-primary" onclick="triggerAdClick('infeed_native','${esc(offer.id)}','grid-ad-${idx}','${esc(art.tag)}')">
          ${icon('spark')}<span class="btn-label">${esc(offer.cta)}</span>
        </button>
        <button type="button" class="btn btn-tiny btn-ghost" onclick="openProModal()">
          <span class="btn-label">Hide ads</span>
        </button>
      </div>
    </article>
  `;
}

function tagDot(post, tag) {
  if ((post.artistTags || []).includes(tag)) return 'artist';
  if ((post.characterTags || []).includes(tag)) return 'character';
  if ((post.copyrightTags || []).includes(tag)) return 'series';
  return '';
}

function tagGroups(post) {
  const artist = post.artistTags || [];
  const character = post.characterTags || [];
  const copyright = post.copyrightTags || [];
  const known = new Set([...artist, ...character, ...copyright]);
  const general = (post.tags || []).filter(tag => !known.has(tag));
  return [
    ['Artist', artist],
    ['Character', character],
    ['Copyright', copyright],
    ['General', general]
  ].filter(([, list]) => list.length);
}

function tagGroupsHtml(post) {
  const groups = tagGroups(post);
  if (!groups.length) return '<p class="hint">No tags on this post.</p>';
  return groups.map(([label, list]) => `
    <section class="tag-group">
      <h3>${esc(label)}</h3>
      <div class="tag-well">${list.map(tag => tagChip(tag, post)).join('')}</div>
    </section>
  `).join('');
}

function buildPostCardHTML(post, idx) {
  const isSaved = state.savedPosts.some(s => s.id === post.id);
  const isVideo = post.mediaType === 'video';
  const shown = cardStill(post);
  const eager = idx < 8;
  const tags = post.tags || [];

  return `
    <article class="masonry-item card is-in" style="--d:${idx % 8}">
      <div class="card-media" data-open="${esc(post.id)}"${isVideo ? ` data-kind="video" data-file="${esc(post.fileUrl || '')}" data-proxy-file="${esc(post.proxiedFileUrl || '')}"` : ''}>
        <img
          src="${esc(shown.src)}"
          data-proxy="${esc(shown.proxy)}"
          alt=""
          loading="${eager ? 'eager' : 'lazy'}"
          decoding="async"
          ${eager ? 'fetchpriority="high"' : ''}
          referrerpolicy="no-referrer"
          onerror="useProxy(this)"
        />
        ${isVideo ? `<button type="button" class="play-badge" data-preview aria-label="Play preview">${icon('play')}</button>` : ''}
        <div class="card-float">
          <span class="pill">${esc(post.sourceName || 'Board')}</span>
          <span class="pill">${isVideo ? icon('play') : ''}${icon('star')} ${esc(formatScore(post.score))}</span>
        </div>
      </div>
      <div class="card-body">
        <button type="button" class="btn btn-tiny ${isSaved ? 'btn-primary' : 'btn-ghost'}" data-save="${esc(post.id)}">
          <span class="ico-slot">${icon(isSaved ? 'heart-fill' : 'heart')}</span>
          <span class="btn-label">${isSaved ? 'Saved' : 'Save'}</span>
        </button>
        <button type="button" class="btn btn-tiny btn-ghost" data-tag-sheet="${esc(post.id)}">
          ${icon('tag')}<span class="btn-label">Tags ${tags.length}</span>
        </button>
      </div>
    </article>
  `;
}

const AD_INTERVAL = 12;

function cardsHtml(posts, offset) {
  const parts = [];
  posts.forEach((post, i) => {
    const idx = offset + i;
    if (state.showAdsPreview && !state.isPro && idx > 0 && idx % AD_INTERVAL === 0) parts.push(buildSponsoredCardHTML(idx));
    parts.push(buildPostCardHTML(post, idx));
  });
  return parts.join('');
}

function renderGallery(options = {}) {
  const feedEl = document.getElementById('masonry-feed');
  if (!feedEl) return;
  if (!state.posts.length) {
    feedEl.innerHTML = state.lastPartial
      ? '<div class="empty"><h2>Still asking the boards</h2><p>The faster ones will show up in a moment.</p></div>'
      : '<div class="empty"><h2>Nothing matched</h2><p>Try All ratings, another board, or clear the tags.</p><button class="btn btn-primary" type="button" onclick="resetAllFilters()">Clear filters</button></div>';
    return;
  }
  if (Number.isInteger(options.appendFrom)) {
    feedEl.querySelectorAll('.skel-pending').forEach(node => node.remove());
    feedEl.insertAdjacentHTML('beforeend', cardsHtml(state.posts.slice(options.appendFrom), options.appendFrom));
  } else {
    feedEl.innerHTML = cardsHtml(state.posts, 0);
  }
  rescueSlowImages();
}

let galleryPumpQueued = false;
function pumpGallery() {
  if (galleryPumpQueued || state.activeTab !== 'gallery' || state.isLoading || !state.hasMore || !state.posts.length) return;
  const sentinel = document.getElementById('infinite-scroll-sentinel');
  if (!sentinel) return;
  if (sentinel.getBoundingClientRect().top > window.innerHeight + 1000) return;
  galleryPumpQueued = true;
  state.page += 1;
  Promise.resolve(loadPosts(true)).finally(() => { galleryPumpQueued = false; });
}

function rescueSlowImages() {
  document.querySelectorAll('#masonry-feed img, #saved-grid img').forEach(img => {
    if (img.dataset.rescue === '1' || img.naturalWidth > 0) return;
    const box = img.getBoundingClientRect();
    const near = box.bottom > -120 && box.top < window.innerHeight + 400;
    if (!near) return;
    img.dataset.rescue = '1';
    const swap = () => {
      if (img.naturalWidth > 0) return;
      useProxy(img);
    };
    if (img.complete) swap();
    else setTimeout(swap, 1800);
  });
}

function frameStyle(post) {
  const ratio = ratioStyle(post);
  return ratio || 'aspect-ratio:3 / 4';
}

function reelSlideHtml(post, index) {
  const isVideo = post.mediaType === 'video';
  const poster = isVideo ? cardStill(post) : null;
  const still = poster ? poster.src : stillUrl(post);
  const sharp = poster ? poster.src : sharpUrl(post);
  const fullProxy = poster ? poster.proxy : sharpProxy(post);
  const stillProxy = poster ? poster.proxy : (post.proxiedPreviewUrl || '');
  const eager = index < 2;
  const saved = state.savedPosts.some(s => s.id === post.id);
  const charTag = (post.characterTags && post.characterTags[0]) || (post.tags || [])[0] || 'character';
  const imageProxy = eager ? (fullProxy || stillProxy) : stillProxy;
  const ratio = frameStyle(post);
  const media = isVideo
    ? `<div class="player">${playerInner(poster.src, poster.proxy)}</div>`
    : `<img class="reel-still" style="${ratio}" src="${esc(eager ? (sharp || still) : still)}" data-proxy="${esc(imageProxy)}" alt="" referrerpolicy="no-referrer" onerror="useProxy(this)" />`;
  return `
    <article class="reel" data-id="${esc(post.id)}" data-kind="${isVideo ? 'video' : 'image'}" data-file="${esc(post.fileUrl || '')}" data-proxy-file="${esc(post.proxiedFileUrl || '')}" data-full="${esc(sharp)}" data-proxy-full="${esc(fullProxy)}" data-still="${esc(still)}" data-proxy-still="${esc(stillProxy)}">
      <div class="reel-stage${isVideo ? '' : ' is-still'}"${isVideo ? ` style="${ratio}"` : ''}${isVideo ? '' : ` data-open="${esc(post.id)}"`}>
        ${media}
      </div>
      <div class="reel-bar">
        <button type="button" class="icon-btn${saved ? ' is-on' : ''}" data-save="${esc(post.id)}" aria-label="${saved ? 'Saved' : 'Save'}">${icon(saved ? 'heart-fill' : 'heart')}</button>
        <a class="icon-btn" href="${esc(post.proxiedFileUrl || post.fileUrl || '#')}" download aria-label="Download">${icon('download')}</a>
        <a class="icon-btn" href="${esc(post.originalPostUrl || '#')}" target="_blank" rel="noopener" aria-label="Source">${icon('external')}</a>
        <button type="button" class="icon-btn" data-share="${esc(post.id)}" aria-label="Share">${icon('share')}</button>
        <button type="button" class="icon-btn accent" aria-label="AI chat" onclick="triggerAdClick('reels_cta','candy_ai','${esc(post.id)}','${esc(charTag)}')">${icon('spark')}</button>
        <button type="button" class="tags-toggle" data-tag-sheet="${esc(post.id)}">Tags ${icon('chevron')}</button>
      </div>
    </article>`;
}

function paintReelsStatus() {
  const counter = document.getElementById('reels-counter');
  const status = document.getElementById('reels-status');
  const spinner = document.getElementById('reels-spinner');
  if (counter) counter.textContent = `${state.posts.length} posts`;
  if (spinner) spinner.classList.toggle('is-on', state.isLoading && state.activeTab === 'reels');
  if (!status) return;
  if (state.isLoading && state.activeTab === 'reels' && state.posts.length) status.textContent = 'Loading more…';
  else if (!state.hasMore) status.textContent = 'End of this feed';
  else status.textContent = 'Scroll to load more';
}

let reelsPumpQueued = false;
function pumpReels() {
  if (reelsPumpQueued || state.activeTab !== 'reels' || state.isLoading || !state.hasMore || !state.posts.length) return;
  // Let the first page finish its silent refill before asking for the next one.
  if (state.lastPartial && state.page === 1 && state.partialFills < 2) return;
  const sentinel = document.getElementById('reels-sentinel');
  if (!sentinel) return;
  if (sentinel.getBoundingClientRect().top > window.innerHeight + 900) return;
  reelsPumpQueued = true;
  state.page += 1;
  Promise.resolve(loadPosts(true)).finally(() => { reelsPumpQueued = false; });
}

function mountReelStill(slide, sharp) {
  const img = slide.querySelector('img.reel-still');
  if (!img) return;
  const target = sharp ? (slide.dataset.full || slide.dataset.still || '') : (slide.dataset.still || '');
  if (!target || sameUrl(img.getAttribute('src'), target)) return;
  img.dataset.proxied = '';
  img.setAttribute('data-proxy', (sharp ? slide.dataset.proxyFull : slide.dataset.proxyStill) || slide.dataset.proxyStill || '');
  img.src = target;
}

function mountReelPoster(slide, sharp) {
  const poster = slide.querySelector('.player-poster');
  if (!poster) return;
  const target = sharp ? (slide.dataset.full || slide.dataset.still || '') : (slide.dataset.still || '');
  if (!target || sameUrl(poster.getAttribute('src'), target)) return;
  poster.dataset.proxied = '';
  poster.setAttribute('data-proxy', (sharp ? slide.dataset.proxyFull : slide.dataset.proxyStill) || '');
  poster.src = target;
}

function warmReelNeighbors(slide) {
  [slide.previousElementSibling, slide.nextElementSibling].forEach(el => {
    if (!el || !el.classList.contains('reel') || el.dataset.kind === 'video') return;
    mountReelStill(el, true);
  });
}

function observeReelSlides(slides) {
  if (!state.reelObserver) {
    state.reelObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const slide = entry.target;
        if (slide.dataset.kind === 'video') mountReelPoster(slide, true);
        else mountReelStill(slide, true);
      });
    }, { rootMargin: '700px 0px' });
  }
  slides.forEach(slide => state.reelObserver.observe(slide));
}

function bindReelsLoader() {
  const sentinel = document.getElementById('reels-sentinel');
  if (!sentinel) return;
  if (state.reelsLoadObserver) state.reelsLoadObserver.disconnect();
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) pumpReels();
  }, { rootMargin: '900px' });
  observer.observe(sentinel);
  state.reelsLoadObserver = observer;
}

function buildNativeReelAdHtml(idx) {
  const aadsId = (state.adsConfig && state.adsConfig.aads && state.adsConfig.aads.unitId) || '2460259';
  const exoZoneId = (state.adsConfig && state.adsConfig.exoclick && state.adsConfig.exoclick.zoneId) || '6068261';
  const art = pickAdultAdArtwork(idx);
  const activeTag = parseTagTokens()[0] || art.tag || 'hentai';
  const offers = [
    {
      id: 'candy_ai',
      partner: 'Candy.ai 18+ NSFW',
      title: `Uncensored 18+ AI Sex Chat & Voice with ${activeTag.replace(/_/g, ' ')}`,
      sub: 'Send explicit prompts, custom kinks, and receive live 18+ NSFW photos & voice messages.',
      cta: 'Start 18+ Uncensored Chat →',
      tags: ['18+_nsfw', 'uncensored_ai', 'sex_chat', 'custom_waifu']
    },
    {
      id: 'nud3_video',
      partner: 'Nud3.me 18+ AI Studio',
      title: '18+ AI Undress & Hentai Video Generator',
      sub: 'Turn any Rule34 or anime image into an explicit 60fps 18+ animated video in one click.',
      cta: 'Animate / Undress 18+ Now →',
      tags: ['18+_video', 'ai_undress', 'animated_nsfw', 'rule34_ai']
    },
    {
      id: 'crushon_ai',
      partner: 'CrushOn.ai 18+ Unfiltered',
      title: 'Zero-Filter 18+ Hentai & Erotic Roleplay AI',
      sub: 'No censorship, no NSFW blocks. Roleplay any scenario with 200,000+ adult anime characters.',
      cta: 'Play 18+ Roleplay Free →',
      tags: ['18+_roleplay', 'no_filter', 'hentai_chat', 'explicit']
    }
  ];
  const offer = offers[Math.floor(idx / AD_INTERVAL) % offers.length];
  return `
    <article class="reel post-card is-ad" data-kind="ad" data-ad-slot="${idx}">
      <div class="reel-stage is-still" style="position:relative;background:#09090b;overflow:hidden;">
        <div style="position:relative;aspect-ratio:4 / 5;max-height:520px;width:100%;overflow:hidden;cursor:pointer;" onclick="triggerAdClick('infeed_native','${esc(offer.id)}','reel-ad-${idx}','${esc(activeTag)}')">
          <img
            class="reel-still"
            style="width:100%;height:100%;object-fit:cover;display:block;filter: contrast(1.05);"
            src="${esc(art.src)}"
            data-proxy="${esc(art.proxy)}"
            alt=""
            referrerpolicy="no-referrer"
            onerror="useProxy(this)"
          />
          <div style="position:absolute;top:12px;left:12px;right:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span class="pill" style="background:rgba(225,29,72,0.92);color:#fff;font-weight:700;padding:4px 10px;border-radius:999px;font-size:11px;letter-spacing:0.04em;">🔞 18+ NSFW SPONSORED POST</span>
            <span class="pill" style="background:rgba(9,9,11,0.8);color:#e4e4e7;padding:4px 10px;border-radius:999px;font-size:11px;">${esc(offer.partner)}</span>
          </div>
          <div style="position:absolute;left:0;right:0;bottom:0;padding:48px 16px 16px;background:linear-gradient(180deg,transparent 0%,rgba(9,9,11,0.88) 45%,#09090b 100%);">
            <h3 style="margin:0 0 6px;font-size:18px;color:#fff;font-weight:700;line-height:1.25;">${esc(offer.title)}</h3>
            <p style="margin:0 0 12px;font-size:13px;color:#d4d4d8;line-height:1.45;">${esc(offer.sub)}</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
              ${offer.tags.map(t => `<span class="meta-badge" style="margin:0;background:rgba(225,29,72,0.18);border-color:rgba(225,29,72,0.4);color:#fda4af;font-size:11px;">#${esc(t)}</span>`).join('')}
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-primary" style="flex:1;background:#e11d48;color:#fff;font-weight:700;" onclick="event.stopPropagation();triggerAdClick('infeed_native','${esc(offer.id)}','reel-ad-${idx}','${esc(activeTag)}')">${esc(offer.cta)}</button>
              <button type="button" class="btn btn-ghost" onclick="event.stopPropagation();openProModal()">Hide 18+ Ads</button>
            </div>
          </div>
        </div>
        <div style="width:100%;padding:10px 0;background:#09090b;border-top:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:8px;">
          <iframe src="https://syndication.exdynsrv.com/ads-iframe-display.php?idzone=${esc(exoZoneId)}&output=noscript&type=300x250" width="300" height="250" scrolling="no" marginwidth="0" marginheight="0" frameborder="0" loading="lazy" title="ExoClick 18+ Ad"></iframe>
          <iframe data-aa="${esc(aadsId)}" src="//acceptable.a-ads.com/${esc(aadsId)}" style="border:0px;padding:0;width:100%;max-width:468px;height:60px;overflow:hidden;background-color:transparent;" loading="lazy" title="A-ADS 18+"></iframe>
        </div>
      </div>
      <div class="reel-bar">
        <button type="button" class="icon-btn accent" aria-label="18+ AI chat" onclick="triggerAdClick('reels_cta','${esc(offer.id)}','reel-ad-${idx}','${esc(activeTag)}')">${icon('spark')}</button>
        <button type="button" class="icon-btn" aria-label="Animate 18+" onclick="triggerAdClick('post_video_ai','nud3_video','reel-ad-${idx}','${esc(activeTag)}')">${icon('wand')}</button>
        <span class="reel-meta">18+ Adult Partner · ${esc(offer.partner)}</span>
        <button type="button" class="tags-toggle" onclick="openProModal()">Pro · No Ads ${icon('chevron')}</button>
      </div>
    </article>`;
}

function reelsHtmlWithAds(posts, startOffset) {
  const parts = [];
  posts.forEach((post, i) => {
    const idx = startOffset + i;
    if (state.showAdsPreview && !state.isPro && idx > 0 && idx % AD_INTERVAL === 0) {
      parts.push(buildNativeReelAdHtml(idx));
    }
    parts.push(reelSlideHtml(post, idx));
  });
  return parts.join('');
}

function appendReels(posts) {
  const container = document.getElementById('reels-feed');
  if (!container || !posts.length) return;
  const start = container.querySelectorAll('.reel[data-id]').length;
  const prevTotal = container.querySelectorAll('.reel').length;
  container.insertAdjacentHTML('beforeend', reelsHtmlWithAds(posts, start));
  observeReelSlides([...container.querySelectorAll('.reel[data-id]')].slice(start));
  paintReelsStatus();
}

function renderReels() {
  const container = document.getElementById('reels-feed');
  if (!container) return;
  if (!state.posts.length) {
    container.innerHTML = '<div class="empty"><h2>No posts yet</h2></div>';
    paintReelsStatus();
    bindReelsLoader();
    return;
  }
  container.innerHTML = reelsHtmlWithAds(state.posts, 0);
  observeReelSlides([...container.querySelectorAll('.reel[data-id]')]);
  bindReelsLoader();
  paintReelsStatus();
  requestAnimationFrame(() => {
    syncActiveReel();
    pumpReels();
  });
}

window.addEventListener('scroll', onReelsPageScroll, { passive: true });

let reelScrollRaf = 0;
function onReelsPageScroll() {
  document.body.classList.toggle('nav-scrolled', (state.activeTab === 'reels' || state.activeTab === 'gallery') && window.scrollY > 0);
  if (state.activeTab !== 'reels') return;
  if (reelScrollRaf) return;
  reelScrollRaf = requestAnimationFrame(() => {
    reelScrollRaf = 0;
    syncActiveReel();
    pumpReels();
  });
}

function syncActiveReel() {
  const slides = document.querySelectorAll('#reels-feed .reel');
  if (!slides.length) return;
  const focus = window.innerHeight * 0.42;
  let current = null;
  slides.forEach(slide => {
    const box = slide.getBoundingClientRect();
    if (box.top <= focus && box.bottom >= focus) current = slide;
  });
  if (!current) current = slides[0].getBoundingClientRect().top > focus ? slides[0] : slides[slides.length - 1];
  if (current.classList.contains('is-active')) {
    if (current.dataset.kind !== 'video' || current.querySelector('video')?.getAttribute('src')) return;
  }
  activateReel(current);
}

function activateReel(slide) {
  if (!slide) return;
  document.querySelectorAll('.reel.is-active').forEach(other => {
    if (other !== slide) deactivateReel(other);
  });
  slide.classList.add('is-active');
  if (slide.dataset.kind === 'video') {
    const video = slide.querySelector('video');
    const player = slide.querySelector('.player');
    if (!video || !player) return;
    mountReelPoster(slide, true);
    bindPlayer(player);
    video.muted = mediaMuted;
    return;
  }
  mountReelStill(slide, true);
  warmReelNeighbors(slide);
}

function deactivateReel(slide) {
  if (!slide) return;
  slide.classList.remove('is-active');
  if (slide.dataset.kind !== 'video') return;
  const video = slide.querySelector('video');
  const player = slide.querySelector('.player');
  if (player) player.classList.remove('is-playing');
  if (!video || !video.getAttribute('src')) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function renderSavedPosts() {
  const grid = document.getElementById('saved-grid');
  const badge = document.getElementById('saved-count-badge');
  if (badge) badge.textContent = String(state.savedPosts.length);
  if (!grid) return;
  if (!state.savedPosts.length) {
    grid.innerHTML = '<div class="empty"><h2>Nothing saved</h2><p>Use Save on a post. It stays in this browser.</p></div>';
    return;
  }
  grid.innerHTML = state.savedPosts.map((post, i) => buildPostCardHTML(post, i + 4)).join('');
  rescueSlowImages();
}

function paintSaveButtons(postId, on) {
  document.querySelectorAll('[data-save]').forEach(btn => {
    if (btn.dataset.save !== postId) return;
    if (btn.classList.contains('icon-btn')) {
      btn.innerHTML = icon(on ? 'heart-fill' : 'heart');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-label', on ? 'Saved' : 'Save');
      return;
    }
    btn.classList.toggle('btn-primary', on);
    btn.classList.toggle('btn-ghost', !on);
    setSlot(btn, on ? 'heart-fill' : 'heart', on ? 'Saved' : 'Save');
  });
}

window.toggleSavePost = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  const idx = state.savedPosts.findIndex(p => p.id === postId);
  if (idx >= 0) {
    state.savedPosts.splice(idx, 1);
    showToast('Removed from saved');
  } else {
    state.savedPosts.unshift(post);
    showToast('Saved in this browser');
  }
  localStorage.setItem('bp_saved', JSON.stringify(state.savedPosts));
  paintSaveButtons(postId, idx < 0);
  const badge = document.getElementById('saved-count-badge');
  if (badge) badge.textContent = String(state.savedPosts.length);
  if (state.activeTab === 'saved') renderSavedPosts();
  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn && state.activePost && state.activePost.id === postId) {
    const savedNow = idx < 0;
    saveBtn.classList.toggle('btn-primary', savedNow);
    saveBtn.classList.toggle('btn-ghost', !savedNow);
    setSlot(saveBtn, savedNow ? 'heart-fill' : 'heart', savedNow ? 'Saved' : 'Save');
  }
};

function showModalMedia(post) {
  const box = document.getElementById('modal-media-container');
  box.replaceChildren();
  stopAllCardVideos();
  document.querySelectorAll('.reel.is-active video').forEach(video => video.pause());
  if (post.mediaType === 'video') {
    const player = document.createElement('div');
    player.className = 'player';
    player.dataset.file = post.fileUrl || '';
    player.dataset.proxyFile = post.proxiedFileUrl || '';
    const poster = cardStill(post);
    player.innerHTML = playerInner(poster.src, poster.proxy);
    box.appendChild(player);
    const video = player.querySelector('video');
    bindPlayer(player);
    video.muted = mediaMuted;
    return;
  }
  const sharp = sharpUrl(post);
  const still = stillUrl(post);
  const frame = document.createElement('div');
  frame.className = 'stage-frame';
  const img = document.createElement('img');
  img.className = 'modal-media';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.setAttribute('data-proxy', sharpProxy(post) || post.proxiedPreviewUrl || '');
  img.onerror = () => useProxy(img);
  if (still && sharp && still !== sharp) {
    const blur = document.createElement('img');
    blur.className = 'stage-blur';
    blur.alt = '';
    blur.referrerPolicy = 'no-referrer';
    blur.src = still;
    frame.appendChild(blur);
    img.addEventListener('load', () => blur.remove(), { once: true });
  }
  img.src = sharp || still;
  frame.appendChild(img);
  box.appendChild(frame);
}

window.openPostModal = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  state.activePost = post;
  showModalMedia(post);
  document.getElementById('modal-source-badge').textContent = post.sourceName || 'Board';
  document.getElementById('modal-score-badge').innerHTML = `${icon('star')} ${esc(post.score || 0)}`;
  document.getElementById('modal-dimensions').textContent = `${post.width || '?'} × ${post.height || '?'} · ${String(post.fileExt || '').toUpperCase()}`;
  document.getElementById('modal-original-url').href = post.originalPostUrl || '#';
  document.getElementById('modal-download-btn').href = post.proxiedFileUrl || post.fileUrl || '#';
  const saved = state.savedPosts.some(s => s.id === post.id);
  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.classList.toggle('btn-primary', saved);
  saveBtn.classList.toggle('btn-ghost', !saved);
  setSlot(saveBtn, saved ? 'heart-fill' : 'heart', saved ? 'Saved' : 'Save');
  saveBtn.onclick = () => window.toggleSavePost(post.id);

  const charTag = (post.characterTags && post.characterTags[0]) || (post.tags && post.tags[0]) || 'character';
  document.getElementById('modal-ai-chat-btn').onclick = () => triggerAdClick('post_chat_ai', 'candy_ai', post.id, charTag, post.fileUrl);
  document.getElementById('modal-ai-video-btn').onclick = () => triggerAdClick('post_video_ai', 'nud3_video', post.id, charTag, post.fileUrl);

  const enc = encodeURIComponent(post.fileUrl || '');
  document.getElementById('modal-source-links').innerHTML = [
    { name: 'SauceNAO', url: `https://saucenao.com/search.php?url=${enc}` },
    { name: 'IQDB', url: `https://iqdb.org/?url=${enc}` },
    { name: 'Ascii2d', url: `https://ascii2d.net/search/url/${enc}` }
  ].map(s => `<a class="btn btn-tiny btn-ghost" href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join('');

  const tags = post.tags || [];
  const tagCount = document.getElementById('modal-tag-count');
  if (tagCount) tagCount.textContent = String(tags.length);
  document.getElementById('modal-tags-list').innerHTML = tagGroupsHtml(post);
  document.getElementById('post-modal').classList.remove('hidden');
};

window.closePostModal = function() {
  const modal = document.getElementById('post-modal');
  if (modal) modal.classList.add('hidden');
  const box = document.getElementById('modal-media-container');
  if (box) box.replaceChildren();
};

window.openProModal = function() {
  document.getElementById('pro-modal').classList.remove('hidden');
};

window.closeProModal = function() {
  document.getElementById('pro-modal').classList.add('hidden');
};

window.openFilterDrawer = function() {
  document.getElementById('filter-drawer-backdrop').classList.remove('hidden');
};

window.closeFilterDrawer = function() {
  document.getElementById('filter-drawer-backdrop').classList.add('hidden');
};

window.openSideMenu = function() {
  document.getElementById('side-menu').classList.remove('hidden');
};

window.closeSideMenu = function() {
  const menu = document.getElementById('side-menu');
  if (menu) menu.classList.add('hidden');
};

window.openSearchMenu = function() {
  placeSearch('sheet');
  document.getElementById('search-sheet').classList.remove('hidden');
  const input = document.getElementById('tag-search-input');
  if (input) input.focus();
};

window.closeSearchMenu = function() {
  const sheet = document.getElementById('search-sheet');
  if (sheet) sheet.classList.add('hidden');
  if (state.activeTab === 'home') placeSearch('home');
};

window.openTagSheet = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  const body = document.getElementById('tag-sheet-body');
  const sheet = document.getElementById('tag-sheet');
  if (!post || !body || !sheet) return;
  body.innerHTML = tagGroupsHtml(post);
  sheet.classList.remove('hidden');
};

window.closeTagSheet = function() {
  const sheet = document.getElementById('tag-sheet');
  if (sheet) sheet.classList.add('hidden');
};

window.sharePost = async function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  const url = post.originalPostUrl || location.href;
  const title = `${post.sourceName || 'Post'} ${post.id}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (_) {}
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch (_) {
    showToast(url);
  }
};

function applyPage(tabId, opts = {}) {
  if (!['home', 'gallery', 'reels', 'saved', 'settings'].includes(tabId)) tabId = 'home';
  state.activeTab = tabId;
  const mode = tabId === 'gallery' ? 'mode-grid' : tabId === 'reels' ? 'mode-reels' : tabId === 'saved' ? 'mode-saved' : tabId === 'home' ? 'mode-home' : '';
  document.body.className = mode;
  document.documentElement.dataset.page = tabId;
  ['home', 'gallery', 'reels', 'saved', 'settings'].forEach(name => {
    const sec = document.getElementById(`tab-${name}`);
    if (sec) sec.classList.toggle('hidden', name !== tabId);
  });
  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.toggle('is-on', btn.dataset.tab === tabId));
  document.querySelectorAll('.mob-nav-btn').forEach(btn => btn.classList.toggle('is-on', btn.dataset.mob === tabId));
  closeSideMenu();
  if (!opts.keepSearch) closeSearchMenu();
  closeTagSheet();
  syncChrome();
  const heading = document.getElementById('feed-heading');
  if (heading) heading.textContent = tabId === 'gallery' ? 'Grid' : 'Posts';
  const titles = { home: 'R34Hub — Search every board in one feed', reels: 'Posts — R34Hub', gallery: 'Grid — R34Hub', saved: 'Saved — R34Hub', settings: 'Settings — R34Hub' };
  document.title = titles[tabId] || titles.home;
  if (tabId === 'home') placeSearch('home');
  if (tabId !== 'reels') document.querySelectorAll('#reels-feed .reel').forEach(deactivateReel);
  stopAllCardVideos();
  if (tabId === 'saved') renderSavedPosts();
  if (tabId === 'gallery' && state.posts.length) {
    renderGallery();
    requestAnimationFrame(pumpGallery);
  }
  if (tabId === 'reels' && state.posts.length) renderReels();
  if (browsingPosts()) {
    syncUrlBarInPlace();
    if (!state.posts.length && !state.isLoading) loadPosts(false);
  }
}

window.switchTab = function(tabId) {
  if (!['home', 'gallery', 'reels', 'saved', 'settings'].includes(tabId)) tabId = 'home';
  if (pageForPath() === tabId) {
    closeSideMenu();
    return;
  }
  location.assign(hrefForTab(tabId));
};

function renderQuickTags() {
  const box = document.getElementById('sheet-trending-tags');
  const section = document.getElementById('sheet-quick');
  if (section) section.classList.toggle('hidden', !state.trendingTags.length);
  if (!box) return;
  const active = new Set(parseTagTokens().map(token => token.replace(/^[+-]/, '')));
  box.innerHTML = state.trendingTags.map(tag => `
    <button type="button" class="quick-tag${active.has(tag.name) ? ' is-on' : ''}" data-include="${esc(tag.name)}">
      ${esc(String(tag.name).replace(/_/g, ' '))}<small>${formatScore(tag.count)}</small>
    </button>
  `).join('');
}

function renderTrendingTags() {
  const drawerTags = document.getElementById('drawer-trending-tags');
  if (drawerTags) drawerTags.innerHTML = state.trendingTags.map(t => tagChip(t.name)).join('');
  renderQuickTags();
}

async function initApp() {
  readUrlState();
  const tab = pageForPath();
  applyPage(tab);
  renderSourcePills();
  const savedBadge = document.getElementById('saved-count-badge');
  if (savedBadge) savedBadge.textContent = String(state.savedPosts.length);
  try {
    const [srcRes, adsRes, tagRes] = await Promise.all([
      fetch('/api/sources').then(r => r.json()),
      fetch('/api/ads/config').then(r => r.json()).catch(() => ({})),
      fetch('/api/tags').then(r => r.json())
    ]);
    state.sources = srcRes.sources || [];
    state.adsConfig = adsRes.adsConfig || {};
    state.trendingTags = tagRes.trending || [];
    renderTrendingTags();
    const blacklist = document.getElementById('blacklist-textarea');
    if (blacklist) blacklist.value = state.blacklist.join('\n');
    updateProUI();
    if (state.licenseKey) {
      fetch(`/api/licenses/verify?key=${encodeURIComponent(state.licenseKey)}`)
        .then(r => r.json())
        .then(verifyRes => {
          if (verifyRes && verifyRes.valid) {
            state.isPro = true;
            updateProUI();
          }
        })
        .catch(() => {});
    }
    const sentinel = document.getElementById('infinite-scroll-sentinel');
    if (tab === 'gallery' && sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) pumpGallery();
        });
      }, { rootMargin: '1000px' });
      observer.observe(sentinel);
    }
  } catch (err) {
    console.error('Init error:', err);
  }
}

document.addEventListener('click', event => {
  if (!event.target.closest('.domain-wrap')) closeDomainMenus();
  const featureBtn = event.target.closest('[data-feature-source]');
  if (featureBtn) {
    openFeature(
      featureBtn.dataset.featureSource,
      featureBtn.dataset.featureLocked === 'true',
      featureBtn.dataset.featureSort,
      featureBtn.dataset.featureTags || ''
    );
    return;
  }
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSavePost(save.dataset.save);
    return;
  }
  const tagSheetBtn = event.target.closest('[data-tag-sheet]');
  if (tagSheetBtn) {
    openTagSheet(tagSheetBtn.dataset.tagSheet);
    return;
  }
  const shareBtn = event.target.closest('[data-share]');
  if (shareBtn) {
    sharePost(shareBtn.dataset.share);
    return;
  }
  const tagsBtn = event.target.closest('[data-tags]');
  if (tagsBtn) {
    toggleCardTags(tagsBtn.dataset.tags, tagsBtn);
    return;
  }
  const include = event.target.closest('[data-include]');
  if (include) {
    const inModal = Boolean(include.closest('#post-modal'));
    const quick = include.closest('.quick-tag');
    if (quick && parseTagTokens().includes(include.dataset.include)) {
      removeTagToken(include.dataset.include);
      return;
    }
    toggleTagInPlace(include.dataset.include, 'include');
    const box = document.getElementById('tag-autocomplete');
    if (box) box.classList.add('hidden');
    if (inModal) closePostModal();
    if (include.closest('#tag-sheet') || (include.closest('#search-sheet') && !quick)) closeSearchMenu();
    return;
  }
  const exclude = event.target.closest('[data-exclude]');
  if (exclude) {
    const inModal = Boolean(exclude.closest('#post-modal'));
    toggleTagInPlace(exclude.dataset.exclude, 'exclude');
    const box = document.getElementById('tag-autocomplete');
    if (box) box.classList.add('hidden');
    if (inModal) closePostModal();
    if (exclude.closest('#tag-sheet, #search-sheet')) closeSearchMenu();
    return;
  }
  const remove = event.target.closest('[data-remove-tag]');
  if (remove) {
    removeTagToken(remove.dataset.removeTag);
    return;
  }
  const previewBtn = event.target.closest('[data-preview]');
  if (previewBtn) {
    event.preventDefault();
    toggleCardVideo(previewBtn.closest('.card-media'));
    return;
  }
  const open = event.target.closest('[data-open]');
  if (open) openPostModal(open.dataset.open);
});

document.addEventListener('DOMContentLoaded', () => {
  initApp();

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      switchTab(btn.dataset.tab);
    });
  });
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => setRating(btn.dataset.rating, true));
  });
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => setSortInPlace(btn.dataset.sort));
  });

  document.getElementById('open-filter-drawer-btn').addEventListener('click', openFilterDrawer);
  document.getElementById('close-filter-drawer-btn').addEventListener('click', closeFilterDrawer);
  document.getElementById('apply-drawer-btn').addEventListener('click', closeFilterDrawer);
  document.getElementById('manual-load-more-btn').addEventListener('click', () => {
    if (!state.isLoading && state.hasMore) {
      state.page += 1;
      loadPosts(true);
    }
  });

  const searchInput = document.getElementById('tag-search-input');
  const autoBox = document.getElementById('tag-autocomplete');
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    document.getElementById('clear-search-btn').classList.toggle('hidden', !val);
    clearTimeout(debounceTimer);
    if (!val) {
      autoBox.classList.add('hidden');
      return;
    }
    const lastWord = val.split(/\s+/).pop().replace(/^[+-]/, '');
    if (lastWord.length < 2) {
      autoBox.classList.add('hidden');
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags?q=${encodeURIComponent(lastWord)}`);
        const data = await res.json();
        const tags = data.tags || [];
        if (!tags.length) {
          autoBox.classList.add('hidden');
          return;
        }
        autoBox.innerHTML = tags.map(t => {
          const count = Number(t.count) || 0;
          const countLabel = count.toLocaleString();
          return `
          <div class="suggest-row">
            <div class="suggest-copy">
              <strong>${esc(t.name)}</strong>
              ${t.category ? `<div class="hint">${esc(t.category)}</div>` : ''}
            </div>
            <div class="tag-actions">
              <span class="suggest-count" title="${esc(countLabel)} posts">${esc(formatScore(count))}</span>
              <button type="button" class="btn btn-tiny btn-ghost" data-include="${esc(t.name)}">Add</button>
              <button type="button" class="btn btn-tiny btn-ghost" data-exclude="${esc(t.name)}">${icon('block')} Hide</button>
            </div>
          </div>`;
        }).join('');
        autoBox.classList.remove('hidden');
      } catch (_) {
        autoBox.classList.add('hidden');
      }
    }, 160);
  });

  function runSearch() {
    autoBox.classList.add('hidden');
    state.tags = searchInput.value.trim();
    state.page = 1;
    closeSearchMenu();
    showBrowseAndReload();
  }
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') runSearch();
  });
  document.getElementById('run-search-btn').addEventListener('click', runSearch);
  const homeGo = document.getElementById('home-go-btn');
  if (homeGo) homeGo.addEventListener('click', runSearch);
  const shareFeed = document.getElementById('share-feed-btn');
  if (shareFeed) {
    shareFeed.addEventListener('click', async () => {
      const url = location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Posts', url });
          return;
        } catch (_) {}
      }
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
      } catch (_) {
        showToast(url);
      }
    });
  }
  document.getElementById('clear-search-btn').addEventListener('click', () => {
    searchInput.value = '';
    document.getElementById('clear-search-btn').classList.add('hidden');
    state.tags = '';
    state.page = 1;
    syncUrlBarInPlace();
    loadPosts(false);
  });

  document.getElementById('toggle-ads-preview').addEventListener('change', e => {
    state.showAdsPreview = e.target.checked;
    const topAd = document.getElementById('top-ad-banner');
    if (topAd && !state.isPro) topAd.classList.toggle('hidden', !state.showAdsPreview);
    renderGallery();
  });

  document.getElementById('batch-download-btn').addEventListener('click', () => {
    if (!state.isPro) {
      showToast('Page download is part of Pro.');
      openProModal();
      return;
    }
    showToast(`Preparing ${state.posts.length} files…`);
  });

  document.getElementById('close-post-modal').addEventListener('click', closePostModal);
  document.getElementById('close-pro-modal').addEventListener('click', closeProModal);

  document.querySelectorAll('.plan').forEach(card => {
    card.addEventListener('click', () => {
      state.selectedPlan = card.dataset.plan;
      document.querySelectorAll('.plan').forEach(other => other.classList.toggle('is-on', other === card));
    });
  });

  document.getElementById('verify-license-btn').addEventListener('click', async () => {
    const key = document.getElementById('license-input').value.trim();
    const res = await fetch('/api/licenses/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
    if (data.ok && data.valid) {
      state.isPro = true;
      state.licenseKey = data.licenseKey;
      localStorage.setItem('bp_license', data.licenseKey);
      closeProModal();
      updateProUI();
      showToast('Pro is on. Ads are hidden.');
    } else {
      showToast(data.error || 'That key did not work');
    }
  });

  document.getElementById('sim-crypto-checkout-btn').addEventListener('click', async () => {
    const res = await fetch('/api/checkout/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: state.selectedPlan, provider: 'crypto' })
    });
    const data = await res.json().catch(() => ({}));
    if (data.checkoutUrl) {
      location.href = data.checkoutUrl;
      return;
    }
    showToast('Checkout did not start');
  });

  document.getElementById('save-blacklist-btn').addEventListener('click', () => {
    state.blacklist = document.getElementById('blacklist-textarea').value
      .split('\n')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    localStorage.setItem('bp_blacklist', JSON.stringify(state.blacklist));
    showToast(`Hiding ${state.blacklist.length} tags`);
    loadPosts(false);
  });

  document.getElementById('clear-saved-btn').addEventListener('click', () => {
    state.savedPosts = [];
    localStorage.setItem('bp_saved', '[]');
    renderSavedPosts();
    document.querySelectorAll('[data-save]').forEach(btn => {
      if (btn.classList.contains('icon-btn')) {
        btn.innerHTML = icon('heart');
        btn.classList.remove('is-on');
        btn.setAttribute('aria-label', 'Save');
        return;
      }
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-ghost');
      setSlot(btn, 'heart', 'Save');
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const side = document.getElementById('side-menu');
      const search = document.getElementById('search-sheet');
      const tags = document.getElementById('tag-sheet');
      if (side && !side.classList.contains('hidden')) { closeSideMenu(); return; }
      if (search && !search.classList.contains('hidden')) { closeSearchMenu(); return; }
      if (tags && !tags.classList.contains('hidden')) { closeTagSheet(); return; }
      closePostModal();
      closeProModal();
      closeFilterDrawer();
      return;
    }
    if (state.activeTab !== 'reels' || eventTargetIsField(e.target)) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const slides = [...document.querySelectorAll('#reels-feed .reel')];
    if (!slides.length) return;
    const focus = window.innerHeight * 0.42;
    let index = slides.findIndex(slide => {
      const box = slide.getBoundingClientRect();
      return box.top <= focus && box.bottom >= focus;
    });
    if (index < 0) index = 0;
    const next = slides[index + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

function eventTargetIsField(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
}

document.addEventListener('pointerover', event => {
  const media = event.target.closest && event.target.closest('.card-media[data-kind="video"]');
  if (!media || event.pointerType === 'touch' || prefersReducedMotion()) return;
  const from = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.card-media');
  if (from === media) return;
  playCardVideo(media);
}, true);

document.addEventListener('pointerout', event => {
  const media = event.target.closest && event.target.closest('.card-media[data-kind="video"]');
  if (!media || event.pointerType === 'touch') return;
  const to = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.card-media');
  if (to === media) return;
  stopCardVideo(media);
}, true);

document.addEventListener('scroll', () => {
  document.querySelectorAll('.card-media.is-playing').forEach(media => {
    const rect = media.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) stopCardVideo(media);
  });
  pumpGallery();
  rescueSlowImages();
}, { passive: true, capture: true });
