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
  if (!browsingPosts()) switchTab('reels');
  syncUrlBarInPlace();
  if (!state.isLoading) loadPosts(false);
}

function syncUrlBarInPlace() {
  const badge = document.getElementById('feed-status-badge');
  if (badge) badge.textContent = sourceLabel();
  renderActiveTagPills();
  if (!browsingPosts()) {
    if (state.activeTab === 'home') {
      try { window.history.replaceState({}, '', '/'); } catch (_) {}
    }
    return;
  }
  const srcSlug = state.source === 'all' ? 'rule34.xxx' : state.source;
  const params = new URLSearchParams();
  params.set('filter[sort]', state.sort);
  if (state.tags.trim()) params.set('tags', state.tags.trim());
  if (state.rating !== 'all') params.set('rating', state.rating);
  try {
    window.history.replaceState({}, '', `/posts/${srcSlug}?${params.toString()}`);
  } catch (_) {}
}

function parseTagTokens() {
  return state.tags.trim().split(/\s+/).filter(Boolean);
}

function readUrlState() {
  const slug = (location.pathname.match(/^\/posts\/([^/]+)/) || [])[1];
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
  if (countEl) countEl.textContent = String(filters);
  if (!bar) return;
  if (!tokens.length) {
    bar.innerHTML = '<span class="hint">Click a tag to add it. Block hides that tag from the feed.</span>';
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
  paintSearchDot();
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
  menu.querySelectorAll('[data-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeDomainMenus();
      selectSourceInPlace(btn.dataset.source, btn.dataset.locked === 'true');
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

const HOME_ORDER = ['rule34xxx', 'paheal', 'danbooru', 'e621', 'yandere', 'konachan', 'safebooru', 'sakugabooru'];
const FEATURE_SHORTCUTS = [
  ['Popular', 'score', ''],
  ['New', 'latest', ''],
  ['Video', 'video', ''],
  ['No AI', 'no_ai', '']
];
let homeBoardKey = '';
const featuredCache = new Map();

function homeSources() {
  const rank = id => {
    const index = HOME_ORDER.indexOf(id);
    return index === -1 ? 50 : index;
  };
  return state.sources.slice().sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

function featureCardHtml(sourceId, locked, label, sort, tags, index) {
  return `
    <li class="feature-card">
      <button type="button" data-feature-source="${esc(sourceId)}" data-feature-locked="${locked ? 'true' : 'false'}" data-feature-sort="${esc(sort)}" data-feature-tags="${esc(tags)}">
        <figure>
          <span class="feature-media" data-feature-slot="${index}"></span>
          <figcaption>${esc(label)}</figcaption>
        </figure>
      </button>
    </li>`;
}

function renderHomeBoards() {
  const homeBoards = document.getElementById('home-boards');
  if (!homeBoards) return;
  const key = homeSources().map(source => `${source.id}:${source.isPremiumSource ? 1 : 0}`).join('|') + (state.isPro ? ':pro' : '');
  if (key === homeBoardKey) return;
  homeBoardKey = key;
  homeBoards.innerHTML = homeSources().map(source => {
    const locked = Boolean(source.isPremiumSource && !state.isPro);
    const fav = source.domain
      ? `<img src="${esc(faviconUrl(source.domain))}" alt="" width="20" height="20" referrerpolicy="no-referrer">`
      : '';
    const cards = FEATURE_SHORTCUTS.map(([label, sort, tags], index) => featureCardHtml(source.id, locked, label, sort, tags, index)).join('');
    return `
      <section class="board-block">
        <button type="button" class="board-head" onclick="selectSourceInPlace('${esc(source.id)}', ${locked})">
          ${fav}<span>${esc(source.domain || source.name)}</span>${locked ? '<span class="lock">Pro</span>' : ''}
        </button>
        <ol class="feature-row" data-feature-row="${esc(source.id)}">${cards}</ol>
      </section>`;
  }).join('');
  observeFeaturedRows();
}

function featuredRating(sourceId) {
  if (sourceId === 'paheal' || sourceId === 'rule34xxx' || sourceId === 'xbooru') return 'all';
  return 's';
}

function paintFeatured(row, posts) {
  const slots = row.querySelectorAll('[data-feature-slot]');
  posts.forEach((post, index) => {
    const slot = slots[index];
    if (!slot || slot.querySelector('img')) return;
    const src = stillUrl(post);
    if (!src) return;
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    if (post.proxiedPreviewUrl) img.dataset.proxy = post.proxiedPreviewUrl;
    img.addEventListener('error', () => useProxy(img));
    img.src = src;
    slot.appendChild(img);
  });
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
    const q = new URLSearchParams({
      source: sourceId,
      tags: '',
      rating: featuredRating(sourceId),
      sort: 'score',
      page: '1',
      limit: '8'
    });
    const res = await fetch(`/api/posts?${q.toString()}`);
    const data = await res.json();
    const posts = (data.posts || []).filter(post => post.mediaType !== 'video' && stillUrl(post)).slice(0, 4);
    featuredCache.set(sourceId, posts);
    if (row.isConnected) paintFeatured(row, posts);
  } catch (_) {
    row.dataset.featureLoaded = '';
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

window.selectSourceInPlace = function(src, locked) {
  if (locked) {
    showToast('That board is part of Pro.');
    openProModal();
    return;
  }
  state.source = src;
  state.page = 1;
  if ((src === 'paheal' || src === 'rule34xxx' || src === 'xbooru') && state.rating === 's') {
    setRating('all', false);
  }
  renderSourcePills();
  showBrowseAndReload();
};

function setRating(rating, reload = true) {
  state.rating = rating;
  state.page = 1;
  paintChoice('.rating-btn', 'rating', rating);
  if (reload) showBrowseAndReload();
  else syncUrlBarInPlace();
}

window.setSortInPlace = function(sort) {
  state.sort = sort;
  state.page = 1;
  paintChoice('.sort-btn', 'sort', sort);
  showBrowseAndReload();
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
    if (summaryEl) summaryEl.textContent = 'Asking the boards…';
    if (state.activeTab === 'gallery' && feedEl) {
      feedEl.innerHTML = Array.from({ length: 8 }, () => '<div class="masonry-item skel"></div>').join('');
    }
    const reelBox = document.getElementById('reels-feed');
    if (state.activeTab === 'reels' && reelBox) {
      reelBox.innerHTML = '<div class="reel skel-reel"></div><div class="reel skel-reel"></div>';
    }
  } else if (append && scrollText) {
    scrollText.textContent = 'Loading more…';
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
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'The boards did not answer');
    const blocked = new Set(state.blacklist.map(t => t.toLowerCase()));
    const rawPosts = (data.posts || []).filter(p => !(p.tags || []).some(t => blocked.has(String(t).toLowerCase())));

    state.lastPartial = Boolean(data.partial);
    if (append) {
      const existingIds = new Set(state.posts.map(p => p.id));
      const fresh = rawPosts.filter(p => !existingIds.has(p.id));
      state.posts = state.posts.concat(fresh);
      if (fresh.length === 0 && !data.partial) state.hasMore = false;
      if (state.activeTab === 'gallery') renderGallery({ appendFrom: previousCount });
      if (state.activeTab === 'reels' && fresh.length) appendReels(fresh);
    } else {
      const same = silent
        && state.posts.length === rawPosts.length
        && state.posts.every((post, index) => post.id === rawPosts[index].id);
      const slides = [...document.querySelectorAll('#reels-feed .reel')];
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

function looksLikeVideo(url) {
  return /\.(mp4|webm|mkv|mov|m4v)(?:$|\?)/i.test(String(url || ''));
}

function sharpUrl(post) {
  const preview = post.previewUrl || '';
  const sample = post.sampleUrl || '';
  const file = post.fileUrl || '';
  const sampleIsStill = sample && sample !== preview && !looksLikeVideo(sample);
  if (post.mediaType === 'video') return sampleIsStill ? sample : (preview || post.proxiedPreviewUrl || '');
  if (sampleIsStill) return sample;
  if (file && file !== preview && !looksLikeVideo(file)) return file;
  return sample || file || preview || post.proxiedSampleUrl || '';
}

function sharpProxy(post) {
  const sampleIsStill = post.sampleUrl && post.sampleUrl !== post.previewUrl && !looksLikeVideo(post.sampleUrl);
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
  toggles.forEach(btn => btn.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }));
  if (muteBtn) muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    mediaMuted = video.muted;
    paintMute();
  });
  root.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target.closest('.player-bar, [data-player-toggle]')) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
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
  loadVideo(video, media.dataset.file || '', media.dataset.proxyFile || '', true);
}

function toggleCardVideo(media) {
  if (!media) return;
  if (media.classList.contains('is-playing')) stopCardVideo(media);
  else playCardVideo(media);
}

function buildSponsoredCardHTML() {
  return `
    <aside class="masonry-item sponsor">
      <div class="kicker">Sponsored</div>
      <h3>AI character chat</h3>
      <p>Open a chat from the kind of character you are browsing.</p>
      <div class="sponsor-actions">
        <button type="button" class="btn btn-primary btn-tiny" onclick="triggerAdClick('infeed_native','candy_ai','native','anime')">Open</button>
        <button type="button" class="btn btn-ghost btn-tiny" onclick="openProModal()">Remove ads</button>
      </div>
    </aside>
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
  const preview = stillUrl(post);
  const proxy = post.proxiedPreviewUrl || '';
  const eager = idx < 4;
  const tags = post.tags || [];

  return `
    <article class="masonry-item card">
      <div class="card-media" data-open="${esc(post.id)}"${isVideo ? ` data-kind="video" data-file="${esc(post.fileUrl || '')}" data-proxy-file="${esc(post.proxiedFileUrl || '')}"` : ''}>
        <img
          src="${esc(preview)}"
          data-proxy="${esc(proxy)}"
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

function cardsHtml(posts, offset) {
  const freq = (state.adsConfig && state.adsConfig.infeedFrequency) || 8;
  const parts = [];
  posts.forEach((post, i) => {
    const idx = offset + i;
    if (state.showAdsPreview && !state.isPro && idx > 0 && idx % freq === 0) parts.push(buildSponsoredCardHTML());
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
    feedEl.insertAdjacentHTML('beforeend', cardsHtml(state.posts.slice(options.appendFrom), options.appendFrom));
    return;
  }
  feedEl.innerHTML = cardsHtml(state.posts, 0);
}

function frameStyle(post) {
  const ratio = ratioStyle(post);
  return ratio || 'aspect-ratio:3 / 4';
}

function reelSlideHtml(post, index) {
  const isVideo = post.mediaType === 'video';
  const still = stillUrl(post);
  const sharp = sharpUrl(post);
  const eager = index < 2;
  const saved = state.savedPosts.some(s => s.id === post.id);
  const charTag = (post.characterTags && post.characterTags[0]) || (post.tags || [])[0] || 'character';
  const imageProxy = eager ? (sharpProxy(post) || post.proxiedPreviewUrl || '') : (post.proxiedPreviewUrl || '');
  const ratio = frameStyle(post);
  const media = isVideo
    ? `<div class="player">${playerInner(eager ? (sharp || still) : still, eager ? (sharpProxy(post) || post.proxiedPreviewUrl || '') : (post.proxiedPreviewUrl || ''))}</div>`
    : `<img class="reel-still" style="${ratio}" src="${esc(eager ? (sharp || still) : still)}" data-proxy="${esc(imageProxy)}" alt="" referrerpolicy="no-referrer" onerror="useProxy(this)" />`;
  return `
    <article class="reel" data-id="${esc(post.id)}" data-kind="${isVideo ? 'video' : 'image'}" data-file="${esc(post.fileUrl || '')}" data-proxy-file="${esc(post.proxiedFileUrl || '')}" data-full="${esc(sharp)}" data-proxy-full="${esc(sharpProxy(post))}" data-still="${esc(still)}" data-proxy-still="${esc(post.proxiedPreviewUrl || '')}">
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
  if (reelsPumpQueued || state.activeTab !== 'reels' || state.isLoading || !state.hasMore || state.lastPartial || !state.posts.length) return;
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

function appendReels(posts) {
  const container = document.getElementById('reels-feed');
  if (!container || !posts.length) return;
  const start = container.querySelectorAll('.reel').length;
  container.insertAdjacentHTML('beforeend', posts.map((post, index) => reelSlideHtml(post, start + index)).join(''));
  observeReelSlides([...container.querySelectorAll('.reel')].slice(start));
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
  container.innerHTML = state.posts.map((post, index) => reelSlideHtml(post, index)).join('');
  observeReelSlides([...container.querySelectorAll('.reel')]);
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
  document.body.classList.toggle('nav-scrolled', state.activeTab === 'reels' && window.scrollY > 0);
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
    if (!video.getAttribute('src')) loadVideo(video, slide.dataset.file || '', slide.dataset.proxyFile || '', !prefersReducedMotion());
    else if (!prefersReducedMotion()) video.play().catch(() => {});
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
    const poster = sharpUrl(post) || stillUrl(post);
    player.innerHTML = playerInner(poster, sharpProxy(post) || post.proxiedPreviewUrl || '');
    box.appendChild(player);
    const video = player.querySelector('video');
    bindPlayer(player);
    video.muted = mediaMuted;
    loadVideo(video, post.fileUrl || '', post.proxiedFileUrl || '', !prefersReducedMotion());
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
  const active = document.querySelector('.reel.is-active video');
  if (active && active.getAttribute('src') && state.activeTab === 'reels' && !prefersReducedMotion()) {
    active.play().catch(() => {});
  }
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

window.switchTab = function(tabId) {
  if (!['home', 'gallery', 'reels', 'saved', 'settings'].includes(tabId)) tabId = 'home';
  state.activeTab = tabId;
  document.body.classList.toggle('mode-home', tabId === 'home');
  document.body.classList.toggle('mode-reels', tabId === 'reels');
  document.body.classList.toggle('nav-scrolled', tabId === 'reels' && window.scrollY > 0);
  document.body.classList.toggle('mode-grid', tabId === 'gallery');
  document.body.classList.toggle('mode-saved', tabId === 'saved');
  ['home', 'gallery', 'reels', 'saved', 'settings'].forEach(t => {
    const sec = document.getElementById(`tab-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tabId);
  });
  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.toggle('is-on', btn.dataset.tab === tabId));
  document.querySelectorAll('.mob-nav-btn').forEach(btn => btn.classList.toggle('is-on', btn.dataset.mob === tabId));
  closeSideMenu();
  closeSearchMenu();
  closeTagSheet();
  syncChrome();
  if (tabId === 'home') placeSearch('home');
  if (tabId !== 'reels') document.querySelectorAll('#reels-feed .reel').forEach(deactivateReel);
  stopAllCardVideos();
  if (tabId === 'saved') renderSavedPosts();
  if (tabId === 'gallery' && state.posts.length) renderGallery();
  if (tabId === 'reels' && state.posts.length) renderReels();
  if (browsingPosts()) {
    syncUrlBarInPlace();
    if (!state.posts.length && !state.isLoading) loadPosts(false);
  } else if (tabId === 'home') {
    try { window.history.replaceState({}, '', '/'); } catch (_) {}
  }
};

function renderTrendingTags() {
  const drawerTags = document.getElementById('drawer-trending-tags');
  if (!drawerTags) return;
  drawerTags.innerHTML = state.trendingTags.map(t => tagChip(t.name)).join('');
}

async function initApp() {
  readUrlState();
  const deepLink = /^\/posts\//.test(location.pathname);
  switchTab(deepLink ? 'reels' : 'home');
  renderSourcePills();
  const postsReady = deepLink ? loadPosts(false) : Promise.resolve();
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
    await postsReady;
    const sentinel = document.getElementById('infinite-scroll-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !state.isLoading && state.hasMore && state.posts.length && state.activeTab === 'gallery') {
            state.page += 1;
            loadPosts(true);
          }
        });
      }, { rootMargin: '480px' });
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
    toggleTagInPlace(include.dataset.include, 'include');
    const box = document.getElementById('tag-autocomplete');
    if (box) box.classList.add('hidden');
    if (inModal) closePostModal();
    if (include.closest('#tag-sheet, #search-sheet')) closeSearchMenu();
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
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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
        autoBox.innerHTML = tags.map(t => `
          <div class="suggest-row">
            <div>
              <strong>${esc(t.name)}</strong>
              <div class="hint">${esc(t.category || '')} · ${Number(t.count || 0).toLocaleString()}</div>
            </div>
            <div class="tag-actions">
              <button type="button" class="btn btn-tiny btn-ghost" data-include="${esc(t.name)}">Add</button>
              <button type="button" class="btn btn-tiny btn-ghost" data-exclude="${esc(t.name)}">${icon('block')} Hide</button>
            </div>
          </div>
        `).join('');
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
    const res = await fetch('/api/webhooks/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'nowpayments_xmr',
        event: 'payment_status:finished',
        plan: state.selectedPlan,
        email: 'emildv.work@gmail.com'
      })
    });
    const data = await res.json();
    if (data.ok) {
      state.isPro = true;
      state.licenseKey = data.licenseKey;
      localStorage.setItem('bp_license', data.licenseKey);
      closeProModal();
      updateProUI();
      showToast('Crypto key is active.');
    }
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
}, { passive: true, capture: true });
