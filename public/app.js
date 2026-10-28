function readStoredProMeta() {
  try {
    return JSON.parse(localStorage.getItem('r34hub_pro_meta') || localStorage.getItem('booru_pulse_pro_v1') || 'null');
  } catch (_) {
    return null;
  }
}

function readStoredProKey() {
  const direct = (localStorage.getItem('bp_license') || localStorage.getItem('r34hub_license_key') || '').trim();
  if (direct) return direct;
  const meta = readStoredProMeta();
  if (meta && meta.key) return String(meta.key).trim();
  return '';
}

const initialProKey = readStoredProKey();
const initialIsPro = Boolean(initialProKey || localStorage.getItem('r34hub_pro_v1') === '1');

const state = {
  activeTab: 'home',
  source: 'rule34xxx',
  tags: '',
  rating: localStorage.getItem('bp_pref_defaultRating') || 's',
  sort: 'score',
  media: 'all',
  gridDensity: localStorage.getItem('bp_grid_density') || 'm',
  autoplayReels: localStorage.getItem('bp_pref_autoplayReels') !== '0',
  searchHistory: JSON.parse(localStorage.getItem('bp_search_history') || '[]'),
  pinnedSearches: JSON.parse(localStorage.getItem('bp_pinned_searches') || '[]'),
  collections: JSON.parse(localStorage.getItem('bp_collections_v1') || '["Favorites","Characters","Videos"]'),
  postCollections: JSON.parse(localStorage.getItem('bp_post_collections_v1') || '{}'),
  activeCollection: 'All',
  modalUseHd: false,
  page: 1,
  isLoading: false,
  hasMore: true,
  posts: [],
  expandedTagCards: new Set(),
  sources: [],
  trendingTags: [],
  adsConfig: null,
  isPro: initialIsPro,
  licenseKey: initialProKey,
  proMeta: readStoredProMeta(),
  savedPosts: JSON.parse(localStorage.getItem('bp_saved') || '[]'),
  blacklist: JSON.parse(localStorage.getItem('bp_blacklist') || '["lowres","watermark"]'),
  showAdsPreview: !initialIsPro,
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

const SORT_LABEL = { score: 'Popular', latest: 'New', video: 'Video', no_ai: 'No AI', random: 'Random', trending: 'Popular' };
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
  if (state.source === 'multiboard') return 'Multi-Board';
  if (state.source === 'all' || state.source === 'rule34xxx' || state.source === 'rule34.xxx') return 'Rule34.xxx';
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
  if (path === '/grid' || path.startsWith('/grid/') || path.startsWith('/tag/')) return 'gallery';
  if (path === '/saved' || path.startsWith('/saved/')) return 'saved';
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings';
  return 'home';
}

function feedQuery() {
  const params = new URLSearchParams();
  if (state.sort && state.sort !== 'score') params.set('filter[sort]', state.sort);
  if (state.tags.trim()) params.set('tags', state.tags.trim());
  if (state.rating && state.rating !== 's') params.set('rating', state.rating);
  if (state.media && state.media !== 'all') params.set('media', state.media);
  return params.toString();
}

function hrefForTab(tabId) {
  if (tabId === 'saved') return '/saved';
  if (tabId === 'settings') return '/settings';
  if (tabId === 'gallery' || tabId === 'reels') {
    const slug = encodeURIComponent((state.source === 'all' || state.source === 'rule34xxx') ? 'rule34.xxx' : state.source);
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
  const targetId = where === 'sheet'
    ? 'sheet-search-mount'
    : where === 'feed'
      ? 'feed-search-mount'
      : 'home-search-mount';
  const mount = document.getElementById(targetId);
  if (block && mount && block.parentElement !== mount) mount.appendChild(block);
}

function scrollFeedToTop() {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } catch (_) {
    window.scrollTo(0, 0);
  }
  if (document.documentElement) document.documentElement.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;
}

function showBrowseAndReload() {
  state.page = 1;
  scrollFeedToTop();
  const sheet = document.getElementById('search-sheet');
  const keepSearch = Boolean(sheet && !sheet.classList.contains('hidden'));
  if (!browsingPosts()) {
    location.assign(hrefForTab('reels'));
    return;
  }
  if (!keepSearch) closeSearchMenu();
  syncUrlBarInPlace();
  loadPosts(false);
}

function syncUrlBarInPlace() {
  const badge = document.getElementById('feed-status-badge');
  if (badge) badge.textContent = sourceLabel();
  renderActiveTagPills();
  if (!browsingPosts()) return;
  const slug = encodeURIComponent((state.source === 'all' || state.source === 'rule34xxx') ? 'rule34.xxx' : state.source);
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
  const tagSlug = (location.pathname.match(/^\/tag\/([^/]+)/) || [])[1];
  if (tagSlug) {
    state.tags = decodeURIComponent(tagSlug).replace(/\+/g, ' ');
  }
  const slug = (location.pathname.match(/^\/(?:posts|grid)\/([^/]+)/) || [])[1];
  if (slug) {
    const cleanSlug = decodeURIComponent(slug);
    state.source = (cleanSlug === 'rule34.xxx' || cleanSlug === 'all') ? 'rule34xxx' : cleanSlug;
  }
  const urlParams = new URLSearchParams(window.location.search);
  const sort = urlParams.get('filter[sort]');
  if (sort) state.sort = sort;
  const rating = urlParams.get('rating');
  if (rating) state.rating = rating;
  const media = urlParams.get('media');
  if (media) state.media = media;
  const qTag = urlParams.get('tags') || urlParams.get('q');
  if (qTag) state.tags = qTag;
  paintChoice('.media-btn', 'media', state.media);
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
  if (state.source !== 'rule34xxx' && state.source !== 'all') filters += 1;
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

window.dismissTopAdBanner = function() {
  sessionStorage.setItem('bp_top_ad_dismissed', '1');
  syncChrome();
};

function syncChrome() {
  const topAd = document.getElementById('top-ad-banner');
  const posts = document.getElementById('posts-chrome');
  if (posts) posts.classList.toggle('hidden', !browsingPosts());
  if (topAd) topAd.classList.add('hidden');
}

function saveProSession(key, meta = {}) {
  const cleanKey = String(key || '').trim().toUpperCase();
  if (!cleanKey) return;
  state.isPro = true;
  state.licenseKey = cleanKey;
  state.showAdsPreview = false;
  state.proMeta = Object.assign({ key: cleanKey, plan: meta.plan || 'Annual Pro', tier: meta.tier || 'annual', email: meta.email || '', expiresAt: meta.expiresAt || '' }, meta);
  localStorage.setItem('bp_license', cleanKey);
  localStorage.setItem('r34hub_license_key', cleanKey);
  localStorage.setItem('r34hub_pro_v1', '1');
  localStorage.setItem('r34hub_pro_meta', JSON.stringify(state.proMeta));
}

function syncProStateFromStorage() {
  const storedKey = readStoredProKey();
  const proFlag = localStorage.getItem('r34hub_pro_v1') === '1';
  if (storedKey || proFlag) {
    state.isPro = true;
    state.licenseKey = storedKey || state.licenseKey || 'R34PRO-ACTIVE';
    state.proMeta = readStoredProMeta() || state.proMeta;
    state.showAdsPreview = false;
  } else {
    state.isPro = false;
    state.licenseKey = '';
    state.proMeta = null;
  }
}

window.logoutPro = function() {
  state.isPro = false;
  state.licenseKey = '';
  state.proMeta = null;
  state.showAdsPreview = true;
  localStorage.removeItem('bp_license');
  localStorage.removeItem('r34hub_license_key');
  localStorage.removeItem('r34hub_pro_v1');
  localStorage.removeItem('r34hub_pro_meta');
  localStorage.removeItem('booru_pulse_pro_v1');
  const licInput = document.getElementById('license-input');
  if (licInput) licInput.value = '';
  updateProUI();
  closeProModal();
  closeSideMenu();
  showToast('Logged out of Pro');
};

function updateProUI() {
  syncProStateFromStorage();
  const btn = document.getElementById('pro-cta-btn');
  const txt = document.getElementById('pro-cta-text');
  const topAd = document.getElementById('top-ad-banner');
  const aadsSlot = document.getElementById('aads-unit-slot');
  const adToggle = document.getElementById('toggle-ads-preview');
  const navBadge = document.getElementById('nav-pro-badge');
  const navLogout = document.getElementById('nav-logout-btn');
  const sideAcc = document.getElementById('side-pro-account');
  const sideKeyLbl = document.getElementById('side-pro-key-label');
  const activeProPanel = document.getElementById('active-pro-panel');
  const proPurchaseBlock = document.getElementById('pro-purchase-block');
  const proSigninForm = document.getElementById('pro-signin-form');
  const modalProKey = document.getElementById('modal-pro-key');
  const modalProPlan = document.getElementById('modal-pro-plan');

  if (state.isPro) {
    const keyStr = state.licenseKey || 'R34PRO-ACTIVE';
    if (btn) btn.classList.add('hidden');
    if (navBadge) navBadge.classList.remove('hidden');
    if (navLogout) navLogout.classList.remove('hidden');
    if (sideAcc) sideAcc.classList.remove('hidden');
    if (sideKeyLbl) sideKeyLbl.textContent = keyStr;
    if (activeProPanel) activeProPanel.classList.remove('hidden');
    if (proPurchaseBlock) proPurchaseBlock.classList.add('hidden');
    if (proSigninForm) proSigninForm.classList.add('hidden');
    if (modalProKey) modalProKey.textContent = keyStr;
    if (modalProPlan) modalProPlan.textContent = (state.proMeta && state.proMeta.plan) || 'Pro Active';
    state.showAdsPreview = false;
    if (topAd) topAd.classList.add('hidden');
    if (aadsSlot) aadsSlot.classList.add('hidden');
  } else {
    if (txt) txt.textContent = 'Premium · €3.99';
    if (btn) {
      btn.classList.remove('hidden');
      btn.classList.remove('is-vip');
    }
    if (navBadge) navBadge.classList.add('hidden');
    if (navLogout) navLogout.classList.add('hidden');
    if (sideAcc) sideAcc.classList.add('hidden');
    if (activeProPanel) activeProPanel.classList.add('hidden');
    if (proPurchaseBlock) proPurchaseBlock.classList.remove('hidden');
    if (proSigninForm) proSigninForm.classList.remove('hidden');
    if (aadsSlot) aadsSlot.classList.remove('hidden');
  }
  syncChrome();
  if (adToggle) {
    adToggle.checked = state.showAdsPreview;
    adToggle.disabled = state.isPro;
  }
  renderSourcePills();
  if (state.activeTab === 'gallery' && state.posts.length) renderGallery();
  if (state.activeTab === 'reels' && state.posts.length) renderReels();
}

function faviconUrl(domain) {
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
}

function sourceItems() {
  const defaultR34 = { id: 'rule34xxx', name: 'Rule34.xxx', domain: 'rule34.xxx', isPremiumSource: false };
  const multiItem = { id: 'multiboard', name: 'Multi-Board (Top 4)', domain: '', isPremiumSource: false };
  if (!state.sources || !state.sources.length) return [defaultR34, multiItem];
  const r34 = state.sources.find(s => s.id === 'rule34xxx') || defaultR34;
  return [r34, multiItem, ...state.sources.filter(s => s.id !== 'rule34xxx')];
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
  const homeLbl = document.getElementById('home-domain-label');
  if (homeLbl) homeLbl.textContent = current.name;
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
  document.body.classList.remove('domain-menu-open');
}

window.toggleDomainMenu = function(menuId, button) {
  const menu = document.getElementById(menuId);
  const willOpen = menu && menu.classList.contains('hidden');
  closeDomainMenus();
  const autoBox = document.getElementById('tag-autocomplete');
  if (autoBox) autoBox.classList.add('hidden');
  if (willOpen && menu) {
    menu.classList.remove('hidden');
    if (button) button.setAttribute('aria-expanded', 'true');
    document.body.classList.add('domain-menu-open');
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
  const mbBtn = document.getElementById('multiboard-pill-btn');
  if (mbBtn) mbBtn.classList.toggle('is-on', state.source === 'multiboard');
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
  { label: 'Video', sort: 'video', tags: '' }
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

window.openVideoGridShortcut = function() {
  state.media = 'video';
  state.page = 1;
  paintChoice('.media-btn', 'media', 'video');
  if (state.activeTab !== 'gallery') {
    applyPage('gallery');
  } else {
    showBrowseAndReload();
  }
};

function renderHomeBoards() {
  const dirGrid = document.getElementById('home-directory-grid');
  if (dirGrid && state.sources && state.sources.length) {
    const SCALE_MAP = {
      rule34xxx: '8.4M+ posts',
      danbooru: '7.6M+ posts',
      yandere: '1.1M+ HD',
      e621: '4.5M+ posts',
      paheal: '5.9M+ posts',
      konachan: '380K+ walls',
      safebooru: '4.6M+ safe',
      xbooru: '1.3M+ posts',
      tbib: '9.2M+ mirror',
      sakugabooru: '260K+ clips',
      aibooru: '620K+ AI'
    };
    dirGrid.innerHTML = state.sources.filter(s => s.id !== 'multiboard').map(source => {
      const locked = Boolean(source.isPremiumSource && !state.isPro);
      const fav = source.domain
        ? `<img src="${esc(faviconUrl(source.domain))}" alt="" width="18" height="18" referrerpolicy="no-referrer">`
        : '';
      const active = state.source === source.id;
      return `
        <button type="button" class="home-board-chip ${active ? 'is-on' : ''}" onclick="selectSourceInPlace('${esc(source.id)}', ${locked})">
          <div class="home-board-chip-top">
            ${fav}
            <strong>${esc(source.name)}</strong>
            ${locked ? '<span class="lock">Pro</span>' : '<span class="board-status-dot" title="Online"></span>'}
          </div>
          <div class="home-board-chip-meta">
            <span>${esc(SCALE_MAP[source.id] || '1M+ posts')}</span>
            <span>Grid →</span>
          </div>
        </button>`;
    }).join('');
  }

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
        <div class="board-block-header">
          <button type="button" class="board-head" onclick="selectSourceInPlace('${esc(source.id)}', ${locked})">
            ${fav}<span>${esc(source.domain || source.name)}</span>${locked ? '<span class="lock">Pro</span>' : ''}
          </button>
          <button type="button" class="btn btn-tiny btn-ghost" onclick="selectSourceInPlace('${esc(source.id)}', ${locked})">Open Grid →</button>
        </div>
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
  scrollFeedToTop();
  paintChoice('.rating-btn', 'rating', rating);
  if (reload && browsingPosts()) showBrowseAndReload();
  else if (browsingPosts()) syncUrlBarInPlace();
}

window.setSortInPlace = function(sort) {
  state.sort = sort;
  if (sort === 'video') {
    state.media = 'video';
    paintChoice('.media-btn', 'media', 'video');
  }
  state.page = 1;
  scrollFeedToTop();
  paintChoice('.sort-btn', 'sort', sort);
  if (browsingPosts()) showBrowseAndReload();
};

window.resetAllFilters = function() {
  state.tags = '';
  state.source = 'rule34xxx';
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


const clientFeedCache = new Map();
let activeFeedController = null;
let activeAutocompleteController = null;

window.setMediaFilter = function(media) {
  state.media = media || 'all';
  state.page = 1;
  scrollFeedToTop();
  paintChoice('.media-btn', 'media', state.media);
  if (browsingPosts()) showBrowseAndReload();
};

window.setGridDensity = function(density) {
  if (!['s', 'm', 'l'].includes(density)) density = 'm';
  state.gridDensity = density;
  localStorage.setItem('bp_grid_density', density);
  document.body.classList.remove('grid-density-s', 'grid-density-m', 'grid-density-l');
  document.body.classList.add(`grid-density-${density}`);
  document.querySelectorAll('.density-btn').forEach(btn => btn.classList.toggle('is-on', btn.dataset.density === density));
  const sel = document.getElementById('pref-grid-density');
  if (sel) sel.value = density;
};

function recordSearchHistory(query) {
  const clean = String(query || '').trim();
  if (!clean) return;
  state.searchHistory = [clean, ...state.searchHistory.filter(q => q !== clean)].slice(0, 12);
  localStorage.setItem('bp_search_history', JSON.stringify(state.searchHistory));
  renderSearchHistoryBar();
}

window.removeSearchHistoryItem = function(query) {
  state.searchHistory = state.searchHistory.filter(q => q !== query);
  localStorage.setItem('bp_search_history', JSON.stringify(state.searchHistory));
  renderSearchHistoryBar();
};

window.clearSearchHistory = function() {
  state.searchHistory = [];
  localStorage.setItem('bp_search_history', '[]');
  renderSearchHistoryBar();
};

window.togglePinCurrentSearch = function() {
  const input = document.getElementById('tag-search-input');
  const q = ((input && input.value) || state.tags || '').trim();
  if (!q) {
    showToast('Type a tag query first to pin it');
    return;
  }
  const idx = state.pinnedSearches.findIndex(item => item.q === q && item.source === state.source);
  if (idx >= 0) {
    state.pinnedSearches.splice(idx, 1);
    showToast('Removed pinned search');
  } else {
    state.pinnedSearches.unshift({ q, source: state.source, rating: state.rating });
    state.pinnedSearches = state.pinnedSearches.slice(0, 10);
    showToast(`Pinned search: ${q}`);
  }
  localStorage.setItem('bp_pinned_searches', JSON.stringify(state.pinnedSearches));
  renderSearchHistoryBar();
};

window.applySavedSearchChip = function(q, src, rating) {
  state.tags = q || '';
  if (src) state.source = src;
  if (rating) {
    state.rating = rating;
    paintChoice('.rating-btn', 'rating', rating);
  }
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !state.tags);
  showBrowseAndReload();
};

function renderSearchHistoryBar() {
  const bar = document.getElementById('search-history-bar');
  if (!bar) return;
  const parts = [];
  state.pinnedSearches.forEach(item => {
    parts.push(`
      <span class="token" style="border-color:rgba(245,158,11,0.5);background:rgba(245,158,11,0.1);">
        <button type="button" style="border:0;color:#fbbf24;font-weight:650;display:inline-flex;align-items:center;gap:4px;" onclick="applySavedSearchChip('${esc(item.q)}','${esc(item.source)}','${esc(item.rating)}')">${icon('star')} ${esc(item.q)}</button>
        <button type="button" onclick="togglePinSearchByQuery('${esc(item.q)}','${esc(item.source)}')" title="Unpin">${icon('close')}</button>
      </span>`);
  });
  state.searchHistory.slice(0, 8).forEach(q => {
    parts.push(`
      <span class="token">
        <button type="button" style="border:0;color:var(--text);display:inline-flex;align-items:center;gap:4px;" onclick="applySavedSearchChip('${esc(q)}')">${icon('clock')} ${esc(q)}</button>
        <button type="button" onclick="removeSearchHistoryItem('${esc(q)}')" title="Remove">${icon('close')}</button>
      </span>`);
  });
  if (state.searchHistory.length > 0) {
    parts.push(`<button type="button" class="linkish" style="font-size:11px;padding:2px 6px;" onclick="clearSearchHistory()">Clear history</button>`);
  }
  bar.innerHTML = parts.join('');
  updateBackupSummaryStats();
}

window.togglePinSearchByQuery = function(q, src) {
  state.pinnedSearches = state.pinnedSearches.filter(item => !(item.q === q && item.source === src));
  localStorage.setItem('bp_pinned_searches', JSON.stringify(state.pinnedSearches));
  renderSearchHistoryBar();
};
async function loadPosts(append = false, silent = false) {
  if (state.isLoading && (append || silent)) return;
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
      media: state.media || 'all',
      page: String(state.page),
      limit: '24'
    });
    const cacheKey = q.toString();
    if (!append && !silent && state.sort !== 'random' && clientFeedCache.has(cacheKey)) {
      data = clientFeedCache.get(cacheKey);
    } else {
      if (!append && !silent && activeFeedController) {
        try { activeFeedController.abort(); } catch (_) {}
      }
      const controller = new AbortController();
      if (!append && !silent) activeFeedController = controller;
      const res = await fetch(`/api/posts?${cacheKey}`, { signal: controller.signal });
      const rawText = await res.text();
      try {
        data = JSON.parse(rawText);
      } catch (_) {
        throw new Error('The boards are busy — please try again');
      }
      if (!res.ok) throw new Error((data && data.error) || 'The boards did not answer');
      if (data && Array.isArray(data.posts) && data.posts.length > 0 && state.sort !== 'random') {
        clientFeedCache.set(cacheKey, data);
        if (clientFeedCache.size > 40) {
          const oldest = clientFeedCache.keys().next().value;
          clientFeedCache.delete(oldest);
        }
      }
    }
    if (token !== state.queryToken) return;
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
      if (!same && state.activeTab === 'gallery') {
        renderGallery();
        if (!silent) scrollFeedToTop();
      }
      if (state.activeTab === 'reels') {
        if (silent && prefix) appendReels(rawPosts.slice(slides.length));
        else if (!same) {
          renderReels();
          if (!silent) scrollFeedToTop();
        }
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
    if (spinner) spinner.classList.toggle('is-done', !state.hasMore);
    paintReelsStatus();
    const deepPostId = new URLSearchParams(location.search).get('post');
    if (deepPostId && !state.deepPostOpened && state.posts.some(p => String(p.id) === String(deepPostId))) {
      state.deepPostOpened = true;
      setTimeout(() => openPostModal(deepPostId), 150);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
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

window.blockTagPermanent = function(tag) {
  const clean = String(tag || '').trim().toLowerCase();
  if (!clean) return;
  if (!state.blacklist.includes(clean)) {
    state.blacklist.push(clean);
    localStorage.setItem('bp_blacklist', JSON.stringify(state.blacklist));
    renderBlacklistChips();
    const area = document.getElementById('blacklist-textarea');
    if (area) area.value = state.blacklist.join('\n');
  }
  showToast(`Blocked tag: ${clean}`);
  if (browsingPosts()) loadPosts(false);
};

function tagChip(tag, post) {
  const kind = post ? tagDot(post, tag) : '';
  return `<span class="tag ${kind}">
    <button type="button" data-include="${esc(tag)}" title="Search / Include ${esc(tag)}"><i class="${kind}"></i>${esc(tag)}</button>
    <button type="button" class="tag-block" data-exclude="${esc(tag)}" title="Exclude (-${esc(tag)}) from search" aria-label="Exclude ${esc(tag)}">${icon('minus')}</button>
    <button type="button" class="tag-block" onclick="event.stopPropagation();blockTagPermanent('${esc(tag)}')" title="Block ${esc(tag)} permanently" aria-label="Block ${esc(tag)}">${icon('ban')}</button>
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
      <button type="button" class="player-btn" data-player-fs aria-label="Fullscreen" title="Fullscreen">${icon('fullscreen')}</button>
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
let lastPrerollAt = 0;

function maybeShowVideoPreroll(containerEl, onComplete) {
  onComplete();
  return;
  const now = Date.now();
  // Show pre-roll at most once every 5 minutes so video browsing stays smooth
  if (lastPrerollAt > 0 && now - lastPrerollAt < 300000) {
    onComplete();
    return;
  }
  videoPlayCount += 1;
  lastPrerollAt = now;
  if (containerEl.querySelector('.preroll-overlay')) return;
  trackAdImpression('video_preroll');
  const activeTag = parseTagTokens()[0] || 'hentai';
  const overlay = document.createElement('div');
  overlay.className = 'preroll-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:6;background:rgba(9,9,11,0.94);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;text-align:center;gap:10px;';
  overlay.innerHTML = `
    <span class="meta-badge" style="margin:0;background:rgba(225,29,72,0.22);border-color:rgba(225,29,72,0.55);color:#fda4af;font-weight:700;">18+ Sponsored · Video starts in <b data-preroll-sec>2</b>s</span>
    ${buildAnimated300x250BannerHtml(videoPlayCount, { id: 'nud3_video', partner: 'NUD3.ME 18+ AI', title: '18+ AI Undress & Hentai Video Animator', cta: 'Open 18+ AI Studio →' }, activeTag)}
    <div style="display:flex;gap:8px;margin-top:4px;">
      <button type="button" class="btn btn-primary btn-tiny" style="background:#e11d48;color:#fff;font-weight:700;" data-preroll-cta>${icon('spark')} Open 18+ AI Studio</button>
      <button type="button" class="btn btn-ghost btn-tiny" data-preroll-skip>Skip (2)</button>
    </div>
  `;
  overlay.addEventListener('click', e => e.stopPropagation());
  containerEl.appendChild(overlay);

  const secEl = overlay.querySelector('[data-preroll-sec]');
  const skipBtn = overlay.querySelector('[data-preroll-skip]');
  const ctaBtn = overlay.querySelector('[data-preroll-cta]');
  let left = 2;
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
  const fsBtn = root.querySelector('[data-player-fs]');
  if (!video) return;
  if (fsBtn) {
    fsBtn.addEventListener('click', event => {
      event.stopPropagation();
      const target = root.requestFullscreen ? root : video;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (target.requestFullscreen) {
        target.requestFullscreen().catch(() => {});
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    });
  }
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

window.onGridVideoMeta = function(video) {
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const media = video.closest('.card-media');
  if (!media) return;
  const durText = media.querySelector('[data-video-dur] .dur-text');
  if (durText) durText.textContent = fmtTime(video.duration);
  const ctrlTime = media.querySelector('[data-v-time]');
  if (ctrlTime) ctrlTime.textContent = `0:00 / ${fmtTime(video.duration)}`;
};

window.onGridVideoTimeUpdate = function(video) {
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const media = video.closest('.card-media');
  if (!media) return;
  const prog = media.querySelector('.v-progress');
  if (prog && !prog.dataset.scrubbing) {
    prog.value = String(((video.currentTime / video.duration) * 100).toFixed(1));
  }
  const ctrlTime = media.querySelector('[data-v-time]');
  if (ctrlTime) ctrlTime.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
};

window.onGridVideoScrub = function(input, event) {
  if (event) event.stopPropagation();
  const media = input && input.closest('.card-media');
  const video = media && media.querySelector('video.grid-video');
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = (Number(input.value) / 100) * video.duration;
  const ctrlTime = media.querySelector('[data-v-time]');
  if (ctrlTime) ctrlTime.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
};

window.toggleGridVideoMute = function(btn, event) {
  if (event) event.stopPropagation();
  const media = btn && btn.closest('.card-media');
  const video = media && media.querySelector('video.grid-video');
  if (!video) return;
  video.muted = !video.muted;
  mediaMuted = video.muted;
  btn.innerHTML = icon(video.muted ? 'mute' : 'volume');
  btn.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
};

window.fullscreenGridVideo = function(btn, event) {
  if (event) event.stopPropagation();
  const media = btn && btn.closest('.card-media');
  const video = media && media.querySelector('video.grid-video');
  if (!video) return;
  if (video.paused) playCardVideo(media, false);
  if (video.requestFullscreen) {
    video.requestFullscreen().catch(() => {});
  } else if (video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  }
};

window.onGridVideoPlayState = function(video, playing) {
  if (!video) return;
  const media = video.closest('.card-media');
  if (!media) return;
  media.classList.toggle('is-playing', Boolean(playing));
  media.querySelectorAll('.play-badge, [data-v-play]').forEach(btn => {
    btn.innerHTML = icon(playing ? 'pause' : 'play');
    btn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  });
};

window.onGridVideoError = function(video) {
  if (!video) return;
  const direct = video.getAttribute('data-src') || '';
  const proxy = video.getAttribute('data-proxy-src') || '';
  const sample = video.getAttribute('data-sample') || '';
  if (video.dataset.fallbackStep !== '1' && direct && video.src !== direct) {
    video.dataset.fallbackStep = '1';
    video.src = direct;
    video.load();
    if (video.closest('.card-media.is-playing')) video.play().catch(() => {});
    return;
  }
  if (video.dataset.fallbackStep !== '2' && proxy && video.src !== proxy) {
    video.dataset.fallbackStep = '2';
    video.src = proxy;
    video.load();
    if (video.closest('.card-media.is-playing')) video.play().catch(() => {});
    return;
  }
  if (video.dataset.fallbackStep !== '3' && sample && video.src !== sample) {
    video.dataset.fallbackStep = '3';
    video.src = sample;
    video.load();
  }
};

function stopCardVideo(media) {
  if (!media) return;
  media.classList.remove('is-playing');
  const video = media.querySelector('video.card-video');
  if (video) {
    try { video.pause(); } catch (_) {}
  }
  const btn = media.querySelector('.play-badge');
  if (btn) {
    btn.innerHTML = icon('play');
    btn.setAttribute('aria-label', 'Play video');
  }
}

function stopAllCardVideos(except) {
  document.querySelectorAll('.card-media.is-playing').forEach(media => {
    if (media !== except) stopCardVideo(media);
  });
}

function enforceMaxConcurrentGridVideos(maxPlaying = 4) {
  const playing = Array.from(document.querySelectorAll('.card-media.is-playing'));
  if (playing.length > maxPlaying) {
    playing.slice(0, playing.length - maxPlaying).forEach(m => stopCardVideo(m));
  }
}

function playCardVideo(media, allowConcurrent = false) {
  if (!media) return;
  let video = media.querySelector('video.card-video');
  if (!video) {
    const fileUrl = media.dataset.file || '';
    const proxyUrl = media.dataset.proxyFile || '';
    if (!fileUrl && !proxyUrl) return;
    video = document.createElement('video');
    video.className = 'card-video grid-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'metadata';
    video.src = proxyUrl || fileUrl;
    video.setAttribute('data-src', fileUrl);
    video.setAttribute('data-proxy-src', proxyUrl);
    media.appendChild(video);
  }
  if (!allowConcurrent) {
    enforceMaxConcurrentGridVideos(3);
  } else {
    enforceMaxConcurrentGridVideos(4);
  }
  video.muted = true;
  media.classList.add('is-playing');
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      onGridVideoError(video);
    });
  }
}

function toggleCardVideo(media) {
  if (!media) return;
  const video = media.querySelector('video.card-video');
  if (media.classList.contains('is-playing') && video && !video.paused) {
    stopCardVideo(media);
  } else {
    playCardVideo(media, false);
  }
}

let gridVideoObserver = null;
function observeGridVideos() {
  if (!('IntersectionObserver' in window)) return;
  if (!gridVideoObserver) {
    gridVideoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const video = entry.target;
        const media = video.closest('.card-media');
        if (!media) return;
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) {
          if (media.classList.contains('is-playing') && !media.dataset.manualPlay) {
            stopCardVideo(media);
          }
          return;
        }
        if (state.autoplayReels && entry.intersectionRatio >= 0.45) {
          const activeCount = document.querySelectorAll('.card-media.is-playing').length;
          if (activeCount < 4) {
            playCardVideo(media, true);
          }
        }
      });
    }, { threshold: [0, 0.35, 0.55] });
  }
  document.querySelectorAll('#masonry-feed video.grid-video, #saved-feed video.grid-video').forEach(video => {
    if (video.dataset.observed !== '1') {
      video.dataset.observed = '1';
      gridVideoObserver.observe(video);
    }
  });
}

const ADULT_FALLBACK_THUMBS = [
  {
    full: 'https://img.xbooru.com/images/257/66ade81490698aa620f16b9eddc415ef.jpeg',
    thumb: 'https://xbooru.com/thumbnails/257/thumbnail_66ade81490698aa620f16b9eddc415ef.jpg',
    tag: '1girl'
  },
  {
    full: 'https://img.xbooru.com/images/457/513ed2466c54fe4feaea546d8e33519c.jpeg',
    thumb: 'https://xbooru.com/thumbnails/457/thumbnail_513ed2466c54fe4feaea546d8e33519c.jpg',
    tag: 'beach'
  },
  {
    full: 'https://img.xbooru.com/images/457/27d2e5faf95f990fd83a597d4b6b6c89.jpeg',
    thumb: 'https://xbooru.com/thumbnails/457/thumbnail_27d2e5faf95f990fd83a597d4b6b6c89.jpg',
    tag: 'anime'
  },
  {
    full: 'https://img.xbooru.com/images/197/97326a8dbb4c7e078cee43925c28a1cf.jpeg',
    thumb: 'https://xbooru.com/thumbnails/197/thumbnail_97326a8dbb4c7e078cee43925c28a1cf.jpg',
    tag: 'raven'
  },
  {
    full: 'https://img.xbooru.com/images/596/11ca5c595d31212d56d2dd0f0f23357a.jpeg',
    thumb: 'https://xbooru.com/thumbnails/596/thumbnail_11ca5c595d31212d56d2dd0f0f23357a.jpg',
    tag: 'waifu'
  },
  {
    full: 'https://img.xbooru.com/images/539/705acd796bbb6d0bf5fa34c1f049d335.jpeg',
    thumb: 'https://xbooru.com/thumbnails/539/thumbnail_705acd796bbb6d0bf5fa34c1f049d335.jpg',
    tag: 'fantasy'
  },
  {
    full: 'https://img.xbooru.com/images/684/c98c0125b12a8ec6d7beedcd224c930c.jpeg',
    thumb: 'https://xbooru.com/thumbnails/684/thumbnail_c98c0125b12a8ec6d7beedcd224c930c.jpg',
    tag: 'anthro'
  }
];

window.useAdFallback = function(img) {
  if (!img) return;
  const proxy = img.getAttribute('data-proxy');
  if (proxy && img.dataset.proxied !== '1') {
    img.dataset.proxied = '1';
    img.src = proxy;
    return;
  }
  const fb = img.getAttribute('data-fallback');
  if (fb && img.dataset.fbUsed !== '1') {
    img.dataset.fbUsed = '1';
    img.src = fb;
  }
};

function isStaticImagePost(post) {
  if (!post || post.mediaType !== 'image') return false;
  const ext = String(post.fileExt || '').toLowerCase();
  if (['mp4', 'webm', 'gif', 'mov', 'mkv', 'm4v', 'zip'].includes(ext)) return false;
  const still = cardStill(post);
  if (!still || !still.src || looksLikeVideo(still.src)) return false;
  // Require a static image extension on either previewUrl, sampleUrl, or fileUrl so extensionless video streams are never picked
  const checkUrl = post.previewUrl || post.sampleUrl || post.fileUrl || '';
  return /\.(jpe?g|png|webp)(\?|$)/i.test(checkUrl);
}

function pickAdultAdArtwork(idx = 0) {
  const fbItem = ADULT_FALLBACK_THUMBS[Math.floor(idx / 3) % ADULT_FALLBACK_THUMBS.length];
  const guaranteedThumb = `/api/media?url=${encodeURIComponent(fbItem.thumb)}&referer=${encodeURIComponent('https://xbooru.com/')}`;
  const proxyFull = `/api/media?url=${encodeURIComponent(fbItem.full)}&referer=${encodeURIComponent('https://xbooru.com/')}`;

  const explicitImages = (state.posts || []).filter(p => p.rating === 'e' && isStaticImagePost(p));
  if (explicitImages.length) {
    const chosen = explicitImages[(idx * 3 + 1) % explicitImages.length];
    const shown = cardStill(chosen);
    const charTag = (chosen.characterTags && chosen.characterTags[0]) || (chosen.tags && chosen.tags[0]) || fbItem.tag;
    const primarySrc = shown.proxy || chosen.proxiedSampleUrl || chosen.proxiedPreviewUrl || shown.src || proxyFull;
    return {
      src: primarySrc,
      proxy: chosen.proxiedPreviewUrl || guaranteedThumb,
      fallback: guaranteedThumb,
      tag: charTag
    };
  }

  return {
    src: proxyFull,
    proxy: guaranteedThumb,
    fallback: guaranteedThumb,
    tag: fbItem.tag
  };
}


const ADULT_ANIMATED_GIFS = [
  'https://img.xbooru.com/images/614/4cafc8978d09a231f587490fd6e704a0.gif',
  'https://img.xbooru.com/images/643/18d4f0c2765ec4da5f31aed92a8b691c.gif',
  'https://img.xbooru.com/images/634/cfe2ba342ff9f37834b4ff831a148c9d.gif',
  'https://img.xbooru.com/images/161/47cbdfdc948fdb36eaa94fc76816a545.gif',
  'https://img.xbooru.com/images/23/68905846ed0393f8ae89bb4fbb390fe3.gif',
  'https://img.xbooru.com/images/307/8b0670db3dfd97069177a13b5780a865.gif',
  'https://img.xbooru.com/images/514/5801ffe974b24cbb229c65c08d9b768f.gif'
];

function pickAnimated18PlusGif(idx = 0) {
  // Also check if current feed has any explicit .gif posts
  const feedGifs = (state.posts || []).filter(p => p && p.rating === 'e' && String(p.fileExt || '').toLowerCase() === 'gif' && p.fileUrl);
  if (feedGifs.length) {
    const chosen = feedGifs[idx % feedGifs.length];
    const proxy = chosen.proxiedFileUrl || `/api/media?url=${encodeURIComponent(chosen.fileUrl)}&referer=${encodeURIComponent('https://xbooru.com/')}`;
    return { src: chosen.fileUrl, proxy };
  }
  const rawGif = ADULT_ANIMATED_GIFS[idx % ADULT_ANIMATED_GIFS.length];
  const proxyGif = `/api/media?url=${encodeURIComponent(rawGif)}&referer=${encodeURIComponent('https://xbooru.com/')}`;
  return { src: rawGif, proxy: proxyGif };
}

function buildAnimated300x250BannerHtml(idx, offer, activeTag) {
  const anim = pickAnimated18PlusGif(idx);
  const badgeText = (offer && (offer.partner || offer.name)) || 'NUD3.ME 18+ AI';
  const titleText = (offer && offer.title) || '18+ AI Undress & Hentai Video Animator';
  const ctaText = (offer && offer.cta) || 'Open 18+ Partner →';
  const offerId = (offer && offer.id) || 'nud3_video';
  return `
    <div onclick="triggerAdClick('infeed_native','${esc(offerId)}','anim-300x250-${idx}','${esc(activeTag || 'hentai')}')" style="position:relative;width:300px;height:250px;overflow:hidden;border-radius:10px;border:1px solid rgba(225,29,72,0.5);background:#09090b;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.45);">
      <img
        src="${esc(anim.src)}"
        data-proxy="${esc(anim.proxy)}"
        alt="18+ Animated Ad"
        referrerpolicy="no-referrer"
        onerror="useProxy(this)"
        style="width:100%;height:100%;object-fit:cover;display:block;"
      />
      <div style="position:absolute;top:8px;left:8px;right:8px;display:flex;align-items:center;justify-content:space-between;gap:6px;pointer-events:none;">
        <span style="background:rgba(225,29,72,0.94);color:#fff;font-weight:900;font-size:10px;padding:2px 8px;border-radius:4px;letter-spacing:0.04em;">18+ ANIMATED AD</span>
        <span style="background:rgba(9,9,11,0.85);color:#f4f4f5;font-weight:700;font-size:10px;padding:2px 7px;border-radius:4px;">${esc(badgeText)}</span>
      </div>
      <div style="position:absolute;left:0;right:0;bottom:0;padding:28px 10px 10px;background:linear-gradient(180deg,transparent 0%,rgba(9,9,11,0.92) 55%,#09090b 100%);display:flex;flex-direction:column;gap:6px;pointer-events:none;">
        <div style="color:#fff;font-weight:800;font-size:12px;line-height:1.25;text-align:left;">${esc(titleText)}</div>
        <span style="display:block;background:#e11d48;color:#fff;font-weight:800;font-size:11px;padding:6px 10px;border-radius:6px;text-align:center;">${esc(ctaText)}</span>
      </div>
    </div>`;
}

function buildSponsoredCardHTML(idx = 16) {
  const anim = pickAnimated18PlusGif(idx);
  const offers = [
    { id: 'candy_ai', name: 'Candy.ai', title: 'Interactive AI Character Chat & Roleplay', cta: 'Open Chat' },
    { id: 'nud3_video', name: 'Nud3 Studio', title: 'AI Character Motion & Video Animator', cta: 'Try Studio' },
    { id: 'spicychat_ai', name: 'SpicyChat', title: 'Community Character AI Roleplay', cta: 'Explore' }
  ];
  const offer = offers[Math.floor(idx / AD_INTERVAL) % offers.length];
  return `
    <article class="masonry-item card is-in is-ad-card" style="--d:${idx % 8};border-color:rgba(255,255,255,0.08);background:#12131a;">
      <div class="card-media" onclick="triggerAdClick('infeed_native','${esc(offer.id)}','grid-ad-${idx}','anime')">
        <img
          src="${esc(anim.src)}"
          data-proxy="${esc(anim.proxy)}"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onerror="useProxy(this)"
        />
        <div class="card-float">
          <span class="pill" style="background:rgba(17,17,24,0.82);color:#a1a1aa;font-weight:600;">Sponsored</span>
          <span class="pill">${esc(offer.name)}</span>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:0;padding:20px 10px 8px;background:linear-gradient(180deg,transparent,rgba(9,9,13,0.92));color:#e4e4e7;font-size:12px;font-weight:600;line-height:1.3;">
          ${esc(offer.title)}
        </div>
      </div>
      <div class="card-body">
        <button type="button" class="btn btn-tiny btn-ghost" onclick="triggerAdClick('infeed_native','${esc(offer.id)}','grid-ad-${idx}','anime')">
          ${icon('spark')}<span class="btn-label">${esc(offer.cta)}</span>
        </button>
        <button type="button" class="btn btn-tiny btn-primary" style="background:rgba(16,185,129,0.18);border-color:rgba(16,185,129,0.45);color:#34d399;" onclick="openProModal()" title="Unlock R34Hub Pro — Zero Ads & Original HD">
          <span class="btn-label">Go Pro · No Ads</span>
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


function shortBoardName(post) {
  const raw = String((post && (post.sourceName || post.source)) || 'Board');
  if (/paheal/i.test(raw)) return 'Paheal';
  if (/xbooru/i.test(raw)) return 'XBooru';
  if (/rule34/i.test(raw)) return 'Rule34';
  if (/danbooru/i.test(raw)) return 'Danbooru';
  if (/yande/i.test(raw)) return 'Yande.re';
  if (/konachan/i.test(raw)) return 'Konachan';
  if (/safebooru/i.test(raw)) return 'Safebooru';
  if (/sakuga/i.test(raw)) return 'Sakuga';
  if (/e621|e926/i.test(raw)) return 'e621';
  if (/tbib/i.test(raw)) return 'TBIB';
  if (/aibooru/i.test(raw)) return 'AIBooru';
  return raw.split(' ')[0];
}

function buildPostCardHTML(post, idx) {
  const isSaved = state.savedPosts.some(s => s.id === post.id);
  const isVideo = post.mediaType === 'video' || /\.(mp4|webm)(\?|$)/i.test(post.fileUrl || '');
  const shown = cardStill(post);
  const eager = idx < 8;
  const tags = post.tags || [];
  const videoSrc = post.proxiedFileUrl || post.fileUrl || post.proxiedSampleUrl || post.sampleUrl || '';

  return `
    <article class="masonry-item card is-in ${isVideo ? 'is-video-card' : ''}" style="--d:${idx % 8}">
      <div class="card-media" data-open="${esc(post.id)}" data-file="${esc(post.fileUrl || '')}" data-proxy-file="${esc(post.proxiedFileUrl || '')}" onmouseenter="if(window.matchMedia('(hover:hover)').matches && this.querySelector('video.grid-video')) playCardVideo(this, true)" onmouseleave="if(window.matchMedia('(hover:hover)').matches && this.querySelector('video.grid-video') && !state.autoplayReels) stopCardVideo(this)">
        <img
          class="card-thumb"
          src="${esc(shown.src)}"
          data-proxy="${esc(shown.proxy)}"
          alt=""
          loading="${eager ? 'eager' : 'lazy'}"
          decoding="async"
          ${eager ? 'fetchpriority="high"' : ''}
          referrerpolicy="no-referrer"
          onerror="useProxy(this)"
        />
        ${isVideo ? `
          <video
            class="card-video grid-video"
            src="${esc(videoSrc)}"
            poster="${esc(shown.src)}"
            data-src="${esc(post.fileUrl || '')}"
            data-proxy-src="${esc(post.proxiedFileUrl || '')}"
            data-sample="${esc(post.proxiedSampleUrl || post.sampleUrl || '')}"
            muted
            loop
            playsinline
            webkit-playsinline
            preload="metadata"
            onloadedmetadata="onGridVideoMeta(this)"
            ontimeupdate="onGridVideoTimeUpdate(this)"
            onplay="onGridVideoPlayState(this, true)"
            onpause="onGridVideoPlayState(this, false)"
            onerror="onGridVideoError(this)"
          ></video>
          <button type="button" class="play-badge" data-preview aria-label="Play or pause video">${icon('play')}</button>
          <div class="grid-video-controls" onclick="event.stopPropagation()">
            <button type="button" class="gv-btn" data-v-play data-preview aria-label="Play or pause video">${icon('play')}</button>
            <input type="range" class="v-progress" min="0" max="100" step="0.1" value="0" aria-label="Video progress" oninput="onGridVideoScrub(this, event)" onclick="event.stopPropagation()" />
            <span class="gv-time" data-v-time>0:00</span>
            <button type="button" class="gv-btn" data-v-mute aria-label="Unmute video" onclick="toggleGridVideoMute(this, event)">${icon('mute')}</button>
            <button type="button" class="gv-btn" data-v-fs aria-label="Fullscreen video" onclick="fullscreenGridVideo(this, event)">${icon('fullscreen')}</button>
          </div>
        ` : ''}
        <div class="card-float">
          <span class="pill">${esc(shortBoardName(post))}</span>
          <div style="display:flex;align-items:center;gap:4px;">
            ${isVideo ? `<span class="pill video-dur-pill" data-video-dur>${icon('play')} <span class="dur-text">VIDEO</span></span>` : ''}
            <span class="pill">${icon('star')} ${esc(formatScore(post.score))}</span>
          </div>
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

const AD_INTERVAL = 16;
function trackAdImpression(placement = 'infeed_native') {
  if (state.isPro) return;
  fetch('/api/ads/impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placement, board: state.source || 'rule34xxx' })
  }).catch(() => {});
}


function cardsHtml(posts, offset) {
  const parts = [];
  posts.forEach((post, i) => {
    const idx = offset + i;
    if (state.showAdsPreview && !state.isPro && idx > 0 && idx % AD_INTERVAL === 0) { trackAdImpression("grid_native"); parts.push(buildSponsoredCardHTML(idx)); }
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
      : `<div class="empty">
      <h2>0 posts matched on ${esc(sourceLabel())}</h2>
      <p>Current filter: Rating <strong>${esc(RATING_LABEL[state.rating] || state.rating)}</strong>${state.tags ? ` · Tags: <strong>${esc(state.tags)}</strong>` : ''}</p>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:14px;">
        ${state.rating !== 'all' ? '<button class="btn btn-primary" type="button" onclick="setRating(\'all\', true)">Switch Rating to All (18+)</button>' : ''}
        ${state.source !== 'multiboard' ? `<button class="btn btn-ghost" type="button" onclick="selectSourceInPlace('multiboard', false)">${icon('layers')} Search Across All Boards</button>` : ''}
        <button class="btn btn-ghost" type="button" onclick="resetAllFilters()">Reset Filters</button>
      </div>
    </div>`;
    return;
  }
  if (Number.isInteger(options.appendFrom)) {
    feedEl.querySelectorAll('.skel-pending').forEach(node => node.remove());
    feedEl.insertAdjacentHTML('beforeend', cardsHtml(state.posts.slice(options.appendFrom), options.appendFrom));
  } else {
    feedEl.innerHTML = cardsHtml(state.posts, 0);
  }
  rescueSlowImages();
  observeGridVideos();
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
        <span class="reel-meta"><span class="meta-badge" style="margin:0;font-size:11px;">${esc(shortBoardName(post))}</span></span>
        <a class="icon-btn" href="${esc(post.proxiedFileUrl || post.fileUrl || '#')}" download aria-label="Download">${icon('download')}</a>
        <a class="icon-btn" href="${esc(post.originalPostUrl || '#')}" target="_blank" rel="noopener" aria-label="Source">${icon('external')}</a>
        <button type="button" class="icon-btn" data-share="${esc(post.id)}" aria-label="Share">${icon('share')}</button>
        <button type="button" class="tags-toggle" data-tag-sheet="${esc(post.id)}">Tags ${icon('chevron')}</button>
      </div>
    </article>`;
}

function paintReelsStatus() {
  const counter = document.getElementById('reels-counter');
  const status = document.getElementById('reels-status');
  const spinner = document.getElementById('reels-spinner');
  if (counter) counter.textContent = `${state.posts.length} posts`;
  if (spinner) {
    spinner.classList.toggle('is-on', state.isLoading && state.activeTab === 'reels');
    spinner.classList.toggle('is-done', !state.hasMore);
  }
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
  const anim = pickAnimated18PlusGif(idx);
  const activeTag = parseTagTokens()[0] || 'anime';
  const offers = [
    {
      id: 'candy_ai',
      partner: 'Candy.ai',
      title: `Interactive Character Chat (${activeTag.replace(/_/g, ' ')})`,
      sub: 'Roleplay and chat with custom anime & game characters in your browser.',
      cta: 'Open Chat'
    },
    {
      id: 'nud3_video',
      partner: 'Nud3 Studio',
      title: 'AI Character Motion & Video Studio',
      sub: 'Turn static character illustrations into smooth 60fps animations.',
      cta: 'Try Studio'
    },
    {
      id: 'crushon_ai',
      partner: 'CrushOn.ai',
      title: 'Unfiltered Character Roleplay AI',
      sub: 'Instant browser roleplay with 200,000+ community anime characters.',
      cta: 'Explore'
    }
  ];
  const offer = offers[Math.floor(idx / AD_INTERVAL) % offers.length];
  return `
    <article class="reel post-card is-ad" data-kind="ad" data-ad-slot="${idx}">
      <div class="native-ad-row" onclick="triggerAdClick('infeed_native','${esc(offer.id)}','reel-ad-${idx}','${esc(activeTag)}')">
        <img
          class="native-ad-thumb"
          src="${esc(anim.src)}"
          data-proxy="${esc(anim.proxy)}"
          alt=""
          referrerpolicy="no-referrer"
          onerror="useProxy(this)"
        />
        <div class="native-ad-copy">
          <div class="native-ad-kicker">
            <span class="meta-badge" style="margin:0;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#a1a1aa;font-size:10px;font-weight:600;">Sponsored · ${esc(offer.partner)}</span>
            <button type="button" class="btn btn-tiny btn-ghost" style="min-height:32px;padding:3px 8px;" onclick="event.stopPropagation();openProModal()">Hide ads</button>
          </div>
          <h3>${esc(offer.title)}</h3>
          <p>${esc(offer.sub)}</p>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button type="button" class="btn btn-tiny btn-ghost" onclick="event.stopPropagation();triggerAdClick('infeed_native','${esc(offer.id)}','reel-ad-${idx}','${esc(activeTag)}')">${icon('spark')} <span>${esc(offer.cta)}</span></button>
            <button type="button" class="btn btn-tiny btn-ghost" onclick="event.stopPropagation();openProModal()">Pro · No Ads</button>
          </div>
        </div>
      </div>
    </article>`;
}

function reelsHtmlWithAds(posts, startOffset) {
  const parts = [];
  posts.forEach((post, i) => {
    const idx = startOffset + i;
    if (state.showAdsPreview && !state.isPro && idx > 0 && idx % AD_INTERVAL === 0) {
      trackAdImpression("reels_native");
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
    container.innerHTML = `<div class="empty">
      <h2>0 posts matched on ${esc(sourceLabel())}</h2>
      <p>Current filter: Rating <strong>${esc(RATING_LABEL[state.rating] || state.rating)}</strong>${state.tags ? ` · Tags: <strong>${esc(state.tags)}</strong>` : ''}</p>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:14px;">
        ${state.rating !== 'all' ? '<button class="btn btn-primary" type="button" onclick="setRating(\'all\', true)">Switch Rating to All (18+)</button>' : ''}
        ${state.source !== 'multiboard' ? `<button class="btn btn-ghost" type="button" onclick="selectSourceInPlace('multiboard', false)">${icon('layers')} Search Across All Boards</button>` : ''}
        <button class="btn btn-ghost" type="button" onclick="resetAllFilters()">Reset Filters</button>
      </div>
    </div>`;
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

function updateBackupSummaryStats() {
  const el = document.getElementById('backup-summary-stats');
  if (!el) return;
  el.textContent = `${state.savedPosts.length} Saved Posts · ${state.collections.length} Collections · ${state.blacklist.length} Blocked Tags · ${state.pinnedSearches.length} Pinned Searches`;
}

function renderCollectionsBar() {
  const bar = document.getElementById('collections-bar');
  const modalSel = document.getElementById('modal-collection-select');
  const allFolders = ['All', ...state.collections];
  if (bar) {
    bar.innerHTML = allFolders.map(folder => {
      const count = folder === 'All'
        ? state.savedPosts.length
        : state.savedPosts.filter(p => (state.postCollections[p.id] || 'Favorites') === folder || (folder === 'Videos' && p.mediaType === 'video')).length;
      const isCustom = !['All', 'Favorites', 'Characters', 'Videos'].includes(folder);
      return `
        <button type="button" class="filter-pill${state.activeCollection === folder ? ' is-on' : ''}" onclick="selectSavedCollection('${esc(folder)}')">
          ${icon('folder')} <span>${esc(folder)}</span> <span class="count">${count}</span>
        </button>
        ${isCustom ? `<button type="button" class="icon-btn bare" style="width:36px;height:36px;" onclick="deleteCustomCollection('${esc(folder)}')" aria-label="Delete folder ${esc(folder)}" title="Delete folder">${icon('trash')}</button>` : ''}`;
    }).join('');
  }
  if (modalSel) {
    const curFolder = (state.activePost && state.postCollections[state.activePost.id]) || 'Favorites';
    modalSel.innerHTML = state.collections.map(f => `<option value="${esc(f)}"${f === curFolder ? ' selected' : ''}>${esc(f)}</option>`).join('') + '<option value="__new__">+ New Folder…</option>';
  }
  const pinWrap = document.getElementById('saved-pinned-wrap');
  const pinList = document.getElementById('saved-pinned-list');
  if (pinWrap && pinList) {
    pinWrap.classList.toggle('hidden', !state.pinnedSearches.length);
    pinList.innerHTML = state.pinnedSearches.map(item => `
      <button type="button" class="filter-pill" onclick="applySavedSearchChip('${esc(item.q)}','${esc(item.source)}','${esc(item.rating)}')">
        ${icon('star')} <span>${esc(item.q)}</span>
      </button>
    `).join('');
  }
  updateBackupSummaryStats();
}

window.deleteCustomCollection = function(folder) {
  state.collections = state.collections.filter(f => f !== folder);
  localStorage.setItem('bp_collections_v1', JSON.stringify(state.collections));
  if (state.activeCollection === folder) state.activeCollection = 'All';
  renderCollectionsBar();
  renderSavedPosts();
  showToast(`Removed folder: ${folder}`);
};

window.selectSavedCollection = function(folder) {
  state.activeCollection = folder || 'All';
  renderSavedPosts();
};

window.promptNewCollection = function() {
  const name = (window.prompt('New collection folder name:') || '').trim();
  if (!name) return;
  if (!state.collections.includes(name)) {
    state.collections.push(name);
    localStorage.setItem('bp_collections_v1', JSON.stringify(state.collections));
  }
  state.activeCollection = name;
  renderCollectionsBar();
  renderSavedPosts();
  showToast(`Created folder: ${name}`);
};

window.assignPostCollection = function(folder) {
  if (!state.activePost) return;
  if (folder === '__new__') {
    const custom = (window.prompt('New collection folder name:') || '').trim();
    if (!custom) {
      renderCollectionsBar();
      return;
    }
    if (!state.collections.includes(custom)) {
      state.collections.push(custom);
      localStorage.setItem('bp_collections_v1', JSON.stringify(state.collections));
    }
    folder = custom;
  }
  state.postCollections[state.activePost.id] = folder;
  localStorage.setItem('bp_post_collections_v1', JSON.stringify(state.postCollections));
  if (!state.savedPosts.some(p => p.id === state.activePost.id)) {
    state.savedPosts.unshift(state.activePost);
    localStorage.setItem('bp_saved', JSON.stringify(state.savedPosts));
    paintSaveButtons(state.activePost.id, true);
  }
  renderCollectionsBar();
  showToast(`Saved to ${folder}`);
};

function renderSavedPosts() {
  const grid = document.getElementById('saved-grid');
  const badge = document.getElementById('saved-count-badge');
  if (badge) badge.textContent = String(state.savedPosts.length);
  renderCollectionsBar();
  if (!grid) return;
  const qInput = document.getElementById('saved-search-input');
  const q = ((qInput && qInput.value) || '').trim().toLowerCase();
  let list = state.savedPosts.slice();
  if (state.activeCollection && state.activeCollection !== 'All') {
    list = list.filter(p => (state.postCollections[p.id] || 'Favorites') === state.activeCollection || (state.activeCollection === 'Videos' && p.mediaType === 'video'));
  }
  if (q) {
    list = list.filter(p => (p.tags || []).some(t => String(t).toLowerCase().includes(q)) || String(p.sourceName || p.source || '').toLowerCase().includes(q));
  }
  if (!list.length) {
    grid.innerHTML = '<div class="empty"><h2>No saved posts in this view</h2><p>Use Save on any post or pick another collection folder above.</p></div>';
    return;
  }
  grid.innerHTML = list.map((post, i) => buildPostCardHTML(post, i + 4)).join('');
  rescueSlowImages();
}

function renderBlacklistChips() {
  const box = document.getElementById('blacklist-chips');
  if (!box) return;
  box.innerHTML = state.blacklist.map(tag => `
    <span class="token is-excluded">
      <span style="display:inline-flex;align-items:center;gap:4px;">${icon('ban')} ${esc(tag)}</span>
      <button type="button" onclick="unblockTagPermanent('${esc(tag)}')" title="Unblock">${icon('close')}</button>
    </span>
  `).join('');
  updateBackupSummaryStats();
}

window.unblockTagPermanent = function(tag) {
  state.blacklist = state.blacklist.filter(t => t !== tag);
  localStorage.setItem('bp_blacklist', JSON.stringify(state.blacklist));
  const area = document.getElementById('blacklist-textarea');
  if (area) area.value = state.blacklist.join('\n');
  renderBlacklistChips();
  showToast(`Unblocked: ${tag}`);
  if (browsingPosts()) loadPosts(false);
};

window.saveUserPref = function(key, val) {
  if (key === 'defaultRating') {
    localStorage.setItem('bp_pref_defaultRating', String(val));
    setRating(String(val), true);
    showToast(`Default rating set to ${RATING_LABEL[val] || val}`);
  } else if (key === 'autoplayReels') {
    state.autoplayReels = Boolean(val);
    localStorage.setItem('bp_pref_autoplayReels', val ? '1' : '0');
    showToast(val ? 'Reels video autoplay enabled' : 'Reels video set to click-to-play');
  }
};

window.exportUserDataJson = function() {
  const backup = {
    app: 'R34Hub',
    exportedAt: new Date().toISOString(),
    savedPosts: state.savedPosts,
    collections: state.collections,
    postCollections: state.postCollections,
    blacklist: state.blacklist,
    searchHistory: state.searchHistory,
    pinnedSearches: state.pinnedSearches,
    prefs: {
      defaultRating: localStorage.getItem('bp_pref_defaultRating') || 's',
      gridDensity: state.gridDensity,
      autoplayReels: state.autoplayReels
    }
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `r34hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 200);
  showToast('Exported R34Hub backup (.json)');
};

let pendingImportData = null;

window.previewImportUserDataJson = function(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || '{}'));
      pendingImportData = data;
      const sCount = Array.isArray(data.savedPosts) ? data.savedPosts.length : 0;
      const cCount = Array.isArray(data.collections) ? data.collections.length : 0;
      const bCount = Array.isArray(data.blacklist) ? data.blacklist.length : 0;
      const dateStr = data.exportedAt ? String(data.exportedAt).slice(0, 10) : 'backup file';
      const previewEl = document.getElementById('backup-import-preview');
      const infoEl = document.getElementById('backup-import-info');
      if (infoEl) infoEl.textContent = `Found ${sCount} saved posts, ${cCount} folders, ${bCount} blocked tags (${dateStr}). Choose how to import:`;
      if (previewEl) previewEl.classList.remove('hidden');
    } catch (_) {
      showToast('Invalid backup JSON file');
    }
  };
  reader.readAsText(file);
};

window.applyPendingImport = function(mode = 'merge') {
  if (!pendingImportData) return;
  const data = pendingImportData;
  if (Array.isArray(data.savedPosts)) {
    if (mode === 'replace') {
      state.savedPosts = data.savedPosts;
    } else {
      const existingIds = new Set(state.savedPosts.map(p => p.id));
      state.savedPosts = [...state.savedPosts, ...data.savedPosts.filter(p => p && !existingIds.has(p.id))];
    }
    localStorage.setItem('bp_saved', JSON.stringify(state.savedPosts));
  }
  if (Array.isArray(data.collections)) {
    state.collections = mode === 'replace' ? data.collections : [...new Set([...state.collections, ...data.collections])];
    localStorage.setItem('bp_collections_v1', JSON.stringify(state.collections));
  }
  if (data.postCollections && typeof data.postCollections === 'object') {
    state.postCollections = mode === 'replace' ? data.postCollections : Object.assign({}, data.postCollections, state.postCollections);
    localStorage.setItem('bp_post_collections_v1', JSON.stringify(state.postCollections));
  }
  if (Array.isArray(data.blacklist)) {
    state.blacklist = mode === 'replace' ? data.blacklist : [...new Set([...state.blacklist, ...data.blacklist])];
    localStorage.setItem('bp_blacklist', JSON.stringify(state.blacklist));
    const area = document.getElementById('blacklist-textarea');
    if (area) area.value = state.blacklist.join('\n');
  }
  if (Array.isArray(data.searchHistory)) {
    state.searchHistory = mode === 'replace' ? data.searchHistory : [...new Set([...state.searchHistory, ...data.searchHistory])].slice(0, 12);
    localStorage.setItem('bp_search_history', JSON.stringify(state.searchHistory));
  }
  if (Array.isArray(data.pinnedSearches)) {
    state.pinnedSearches = mode === 'replace' ? data.pinnedSearches : [...state.pinnedSearches, ...data.pinnedSearches].slice(0, 10);
    localStorage.setItem('bp_pinned_searches', JSON.stringify(state.pinnedSearches));
  }
  cancelPendingImport();
  renderBlacklistChips();
  renderSearchHistoryBar();
  renderSavedPosts();
  showToast(`Backup ${mode === 'replace' ? 'replaced' : 'merged'} successfully!`);
};

window.cancelPendingImport = function() {
  pendingImportData = null;
  const previewEl = document.getElementById('backup-import-preview');
  if (previewEl) previewEl.classList.add('hidden');
  const fileIn = document.getElementById('backup-file-input');
  if (fileIn) fileIn.value = '';
};

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
    if (state.savedPosts.length === 3) maybeShowSmartProBooster('saved_3');
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
  if (post.mediaType === 'video' || /\.(mp4|webm)(\?|$)/i.test(post.fileUrl || '')) {
    const player = document.createElement('div');
    player.className = 'player custom-video-player';
    player.dataset.file = post.fileUrl || '';
    player.dataset.proxyFile = post.proxiedFileUrl || '';
    const poster = cardStill(post);
    player.innerHTML = playerInner(poster.src, poster.proxy);
    box.appendChild(player);
    const video = player.querySelector('video');
    bindPlayer(player);
    video.muted = mediaMuted;
    loadVideo(video, post.proxiedFileUrl || post.fileUrl || '', post.fileUrl || post.proxiedFileUrl || '', true);
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
  const hdUrl = state.modalUseHd ? (post.fileUrl || sharp || still) : (sharp || still);
  const hdProxy = state.modalUseHd ? (post.proxiedFileUrl || sharpProxy(post)) : (sharpProxy(post) || post.proxiedPreviewUrl || '');
  img.setAttribute('data-proxy', hdProxy);
  img.src = hdUrl;
  img.onclick = () => window.toggleModalZoom();
  frame.appendChild(img);
  box.appendChild(frame);
}

window.toggleModalZoom = function() {
  const img = document.querySelector('#modal-media-container img.modal-media');
  if (!img) return;
  const zoomed = img.classList.toggle('is-zoomed');
  const btn = document.getElementById('modal-zoom-btn');
  if (btn) btn.classList.toggle('is-on', zoomed);
};

window.toggleModalHdQuality = function() {
  state.modalUseHd = !state.modalUseHd;
  const btn = document.getElementById('modal-hd-btn');
  if (btn) btn.classList.toggle('is-on', state.modalUseHd);
  if (state.activePost) showModalMedia(state.activePost);
  showToast(state.modalUseHd ? 'Switched to Original HD resolution' : 'Switched to fast Sample resolution');
};

window.stepModalPost = function(delta) {
  if (!state.activePost) return;
  const pool = state.activeTab === 'saved' ? state.savedPosts : state.posts;
  if (!pool || !pool.length) return;
  const idx = pool.findIndex(p => p.id === state.activePost.id);
  if (idx < 0) return;
  const nextIdx = idx + delta;
  if (nextIdx >= 0 && nextIdx < pool.length) {
    openPostModal(pool[nextIdx].id);
    if (nextIdx >= pool.length - 3 && state.activeTab !== 'saved' && state.hasMore && !state.isLoading) {
      state.page += 1;
      loadPosts(true);
    }
  }
};


function renderRelatedPostsInModal(post) {
  const wrap = document.getElementById('modal-related-wrap');
  const box = document.getElementById('modal-related-posts');
  if (!box || !wrap) return;
  const postTags = new Set((post.tags || []).map(t => String(t).toLowerCase()));
  const candidates = (state.posts || [])
    .filter(p => p && p.id !== post.id && cardStill(p).src)
    .map(p => {
      const overlap = (p.tags || []).reduce((acc, t) => acc + (postTags.has(String(t).toLowerCase()) ? 1 : 0), 0);
      return { p, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  const picked = candidates.slice(0, 4).map(x => x.p);
  if (!picked.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  box.innerHTML = picked.map(rel => {
    const shown = cardStill(rel);
    return `
      <button type="button" onclick="openPostModal('${esc(rel.id)}')" style="border:1px solid var(--line);border-radius:8px;overflow:hidden;padding:0;background:#09090b;aspect-ratio:1/1;position:relative;" title="${esc(rel.sourceName || rel.source)} #${esc(rel.rawId || rel.id)}">
        <img src="${esc(shown.src)}" data-proxy="${esc(shown.proxy)}" onerror="useProxy(this)" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />
      </button>`;
  }).join('');
}

window.openBoardsCompareModal = async function() {
  const modal = document.getElementById('boards-compare-modal');
  const body = document.getElementById('boards-compare-body');
  if (!modal || !body) return;
  modal.classList.remove('hidden');
  body.innerHTML = '<div class="fine">Loading board metrics…</div>';
  try {
    const res = await fetch('/api/boards/compare');
    const data = await res.json();
    const list = (data && data.boards) || state.sources || [];
    body.innerHTML = [
      `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.35);">
        <div>
          <strong style="color:#34d399;font-size:14px;">Multi-Board Parallel Aggregator (Top 4)</strong>
          <div style="font-size:12px;color:var(--muted);">Queries Rule34, Danbooru, Yande.re &amp; Safebooru/XBooru simultaneously with automatic MD5 deduplication.</div>
        </div>
        <button type="button" class="btn btn-tiny btn-primary" onclick="closeBoardsCompareModal();selectSourceInPlace('multiboard', false)">Switch →</button>
      </div>`,
      ...list.map(b => {
        const locked = Boolean(b.isPremiumSource && !state.isPro);
        return `
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-radius:12px;background:var(--surface);border:1px solid var(--line);">
            <div style="display:flex;align-items:center;gap:10px;min-width:200px;flex:1;">
              <img src="${esc(faviconUrl(b.domain))}" alt="" width="20" height="20" style="border-radius:4px;" referrerpolicy="no-referrer" />
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <strong style="color:#fff;font-size:14px;">${esc(b.name)}</strong>
                  <span class="meta-badge" style="margin:0;font-size:10px;">${esc(b.scale || '1M+ posts')}</span>
                  ${locked ? '<span class="lock">Pro</span>' : '<span class="meta-badge" style="margin:0;font-size:10px;color:#34d399;">Free</span>'}
                </div>
                <div style="font-size:12px;color:var(--muted);">${esc(b.focus || b.description || '')} • <span style="color:#7dd3fc;">~${esc(b.avgLatencyMs || 220)}ms (${esc(b.speedRating || 'Fast')})</span></div>
              </div>
            </div>
            <button type="button" class="btn btn-tiny ${state.source === b.id ? 'btn-primary' : 'btn-ghost'}" onclick="closeBoardsCompareModal();selectSourceInPlace('${esc(b.id)}', ${locked})">${state.source === b.id ? 'Active ✓' : 'Open Board →'}</button>
          </div>`;
      })
    ].join('');
  } catch (_) {
    body.innerHTML = '<div class="fine">Could not load board comparison.</div>';
  }
};


window.activateSettingsKey = async function() {
  const input = document.getElementById('settings-license-input');
  const key = ((input && input.value) || '').trim();
  if (!key) {
    showToast('Please enter a license key');
    return;
  }
  const res = await fetch('/api/licenses/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  });
  const data = await res.json();
  if (data.ok && data.valid) {
    saveProSession(data.licenseKey, {
      plan: data.plan,
      tier: data.tier,
      email: data.email,
      expiresAt: data.expiresAt
    });
    updateProUI();
    showToast('Pro license activated! Ads are off.');
  } else {
    showToast(data.error || 'Invalid license key');
  }
};

window.closeBoardsCompareModal = function() {
  const modal = document.getElementById('boards-compare-modal');
  if (modal) modal.classList.add('hidden');
};


let sessionModalOpens = 0;

function maybeShowSmartProBooster(reason = 'power_user') {
  if (state.isPro) return;
  if (sessionStorage.getItem('r34hub_pro_booster_shown') === '1') return;
  sessionStorage.setItem('r34hub_pro_booster_shown', '1');
  const existing = document.getElementById('smart-pro-booster');
  if (existing) existing.remove();
  const card = document.createElement('aside');
  card.id = 'smart-pro-booster';
  card.style.cssText = 'position:fixed;right:16px;bottom:20px;z-index:2100;width:min(360px,calc(100vw - 32px));padding:14px 16px;border-radius:16px;background:linear-gradient(180deg,#141926,#0e111a);border:1.5px solid rgba(16,185,129,0.5);box-shadow:0 20px 50px rgba(0,0,0,0.75);color:#f3f4f6;display:flex;flex-direction:column;gap:8px;';
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span style="font-size:11px;font-weight:800;color:#34d399;text-transform:uppercase;letter-spacing:0.05em;">⚡ R34Hub Pro — Power User Offer</span>
      <button type="button" onclick="this.closest('#smart-pro-booster').remove()" style="border:0;background:transparent;color:#9ca3af;font-size:16px;line-height:1;padding:4px;cursor:pointer;" aria-label="Dismiss">×</button>
    </div>
    <div style="font-size:13px;font-weight:700;color:#fff;line-height:1.35;">Unlock 100% Ad-Free Browsing, Original 4K HD Streams & Unlimited Collections</div>
    <div style="font-size:12px;color:#9ca3af;">Instant crypto key activation across 5 devices — from <strong style="color:#34d399;">€3.99/mo</strong> or <strong style="color:#fff;">€5.60 for 30 Days</strong>.</div>
    <div style="display:flex;gap:8px;margin-top:4px;">
      <a href="/premium" class="btn btn-tiny btn-primary" style="flex:1;justify-content:center;background:#10b981;color:#04130d;font-weight:800;min-height:38px;">Upgrade with Crypto →</a>
      <button type="button" class="btn btn-tiny btn-ghost" style="min-height:38px;" onclick="this.closest('#smart-pro-booster').remove()">Later</button>
    </div>
  `;
  document.body.appendChild(card);
}

window.shareActiveModalPost = async function(channel = 'copy') {
  const post = state.activePost;
  if (!post) return;
  const boardSlug = encodeURIComponent((post.source === 'all' || post.source === 'rule34xxx') ? 'rule34.xxx' : (post.source || 'rule34.xxx'));
  const topTag = (post.characterTags && post.characterTags[0]) || (post.copyrightTags && post.copyrightTags[0]) || (post.tags && post.tags[0]) || '';
  const shareUrl = `${location.origin}/grid/${boardSlug}${topTag ? '?q=' + encodeURIComponent(topTag) + '&' : '?'}post=${encodeURIComponent(post.id)}`;
  const shareTitle = `${topTag ? topTag.replace(/_/g, ' ') + ' — ' : ''}${shortBoardName(post)} HD on R34Hub`;

  if (channel === 'x') {
    const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(xUrl, '_blank', 'noopener');
    return;
  }
  if (channel === 'reddit') {
    const rUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}`;
    window.open(rUrl, '_blank', 'noopener');
    return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Shareable deep link copied to clipboard!');
  } catch (_) {
    showToast(shareUrl);
  }
};

window.openPostModal = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  state.activePost = post;
  showModalMedia(post);
  document.getElementById('modal-source-badge').textContent = shortBoardName(post);
  const titleEl = document.getElementById('modal-post-title');
  if (titleEl) titleEl.textContent = `${shortBoardName(post)} #${post.rawId || post.id}`;
  document.getElementById('modal-score-badge').innerHTML = `${icon('star')} ${esc(post.score || 0)}`;
  document.getElementById('modal-dimensions').textContent = `${post.width || '?'} × ${post.height || '?'} · ${String(post.fileExt || '').toUpperCase()}`;
  document.getElementById('modal-original-url').href = post.originalPostUrl || '#';
  const cleanExt = String(post.fileExt || 'jpg').toLowerCase();
  const dlFilename = `r34hub_${post.source || 'board'}_${post.rawId || post.id}.${cleanExt}`;
  const dlBase = post.proxiedFileUrl || (post.fileUrl ? `/api/media?url=${encodeURIComponent(post.fileUrl)}` : '#');
  document.getElementById('modal-download-btn').href = dlBase.includes('/api/media?') ? `${dlBase}&download=1&filename=${encodeURIComponent(dlFilename)}` : dlBase;
  document.getElementById('modal-download-btn').setAttribute('download', dlFilename);
  renderCollectionsBar();
  const saved = state.savedPosts.some(s => s.id === post.id);
  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.classList.toggle('btn-primary', saved);
  saveBtn.classList.toggle('btn-ghost', !saved);
  setSlot(saveBtn, saved ? 'heart-fill' : 'heart', saved ? 'Saved' : 'Save');
  saveBtn.onclick = () => window.toggleSavePost(post.id);

  const charTag = (post.characterTags && post.characterTags[0]) || (post.tags && post.tags[0]) || 'character';
  const promptBox = document.getElementById('modal-ai-prompt-box');
  if (promptBox) promptBox.classList.add('hidden');
  const promptBtn = document.getElementById('modal-ai-prompt-btn');
  if (promptBtn) {
    promptBtn.onclick = async () => {
      const cleanTags = (post.tags || []).slice(0, 18).map(t => String(t).replace(/_/g, ' '));
      const promptText = ['masterpiece, best quality, ultra-detailed', ...cleanTags].join(', ');
      if (promptBox) {
        promptBox.textContent = promptText;
        promptBox.classList.remove('hidden');
      }
      try {
        await navigator.clipboard.writeText(promptText);
        showToast('AI Prompt copied to clipboard!');
      } catch (_) {
        showToast('AI Prompt generated below');
      }
    };
  }
  const simBtn = document.getElementById('modal-ai-similar-btn');
  if (simBtn) {
    simBtn.onclick = () => {
      const topTags = [
        ...(post.characterTags || []).slice(0, 1),
        ...(post.copyrightTags || []).slice(0, 1),
        ...(post.tags || []).filter(t => !['1girl', 'solo', 'highres'].includes(t)).slice(0, 2)
      ].filter(Boolean);
      const query = [...new Set(topTags)].slice(0, 2).join(' ') || charTag;
      closePostModal();
      state.tags = query;
      const input = document.getElementById('tag-search-input');
      if (input) input.value = query;
      showBrowseAndReload();
      showToast(`Similar posts: ${query}`);
    };
  }
  const aiChatBtn = document.getElementById('modal-ai-chat-btn');
  if (aiChatBtn) aiChatBtn.onclick = () => triggerAdClick('post_chat_ai', 'candy_ai', post.id, charTag, post.fileUrl);
  const aiVidBtn = document.getElementById('modal-ai-video-btn');
  if (aiVidBtn) aiVidBtn.onclick = () => triggerAdClick('post_video_ai', 'nud3_video', post.id, charTag, post.fileUrl);

  const enc = encodeURIComponent(post.fileUrl || '');
  document.getElementById('modal-source-links').innerHTML = [
    { name: 'SauceNAO', url: `https://saucenao.com/search.php?url=${enc}` },
    { name: 'IQDB', url: `https://iqdb.org/?url=${enc}` },
    { name: 'Ascii2d', url: `https://ascii2d.net/search/url/${enc}` }
  ].map(s => `<a class="btn btn-tiny btn-ghost" href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join('');

  const tags = post.tags || [];
  const tagCount = document.getElementById('modal-tag-count');
  if (tagCount) tagCount.textContent = String(tags.length);
  renderRelatedPostsInModal(post);
  document.getElementById('modal-tags-list').innerHTML = tagGroupsHtml(post);
  document.getElementById('post-modal').classList.remove('hidden');
  sessionModalOpens += 1;
  if (sessionModalOpens === 6) maybeShowSmartProBooster('modal_6');
};

window.closePostModal = function() {
  const modal = document.getElementById('post-modal');
  if (modal) modal.classList.add('hidden');
  const box = document.getElementById('modal-media-container');
  if (box) box.replaceChildren();
};

window.openProModal = function() {
  location.assign('/premium');
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
  else if (browsingPosts()) placeSearch('feed');
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
  scrollFeedToTop();
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
  if (!location.pathname.startsWith('/tag/') && !new URLSearchParams(location.search).get('q')) {
    document.title = titles[tabId] || titles.home;
  }
  if (tabId === 'home') placeSearch('home');
  else if (browsingPosts()) placeSearch('feed');
  const vReels = document.getElementById('view-btn-reels');
  const vGrid = document.getElementById('view-btn-gallery');
  if (vReels) vReels.classList.toggle('is-on', tabId === 'reels');
  if (vGrid) vGrid.classList.toggle('is-on', tabId === 'gallery');
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
  const homePop = document.getElementById('home-popular-tags');
  if (homePop && state.trendingTags.length) {
    homePop.innerHTML = state.trendingTags.slice(0, 8).map(t => `
      <button type="button" class="filter-pill" onclick="applySavedSearchChip('${esc(t.name)}')">${esc(String(t.name).replace(/_/g, ' '))}</button>
    `).join('');
  }
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
    setGridDensity(state.gridDensity);
    renderSearchHistoryBar();
    renderBlacklistChips();
    renderCollectionsBar();
    const urlParams = new URLSearchParams(window.location.search);
    const magicKey = urlParams.get('activate_key');
    if (magicKey) {
      saveProSession(magicKey.trim().toUpperCase(), { plan: 'Pro Membership' });
      urlParams.delete('activate_key');
      const cleanQs = urlParams.toString();
      try {
        window.history.replaceState({}, '', location.pathname + (cleanQs ? '?' + cleanQs : ''));
      } catch (_) {}
    }
    updateProUI();
    if (state.licenseKey) {
      fetch(`/api/licenses/verify?key=${encodeURIComponent(state.licenseKey)}`)
        .then(r => r.json())
        .then(verifyRes => {
          if (verifyRes && verifyRes.valid) {
            saveProSession(verifyRes.key || state.licenseKey, {
              plan: verifyRes.planName || verifyRes.plan,
              tier: verifyRes.tier,
              email: verifyRes.ownerEmail || verifyRes.email,
              expiresAt: verifyRes.expiresAt
            });
            updateProUI();
            if (magicKey) showToast('Pro membership activated!');
          } else if (verifyRes && (verifyRes.status === 'revoked' || verifyRes.status === 'expired')) {
            logoutPro();
          }
        })
        .catch(() => {});
    }
    window.addEventListener('storage', () => updateProUI());
    window.addEventListener('pageshow', () => updateProUI());
    window.addEventListener('focus', () => updateProUI());
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
  if (!event.target.closest('.search')) {
    const autoBox = document.getElementById('tag-autocomplete');
    if (autoBox) autoBox.classList.add('hidden');
  }
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

  const INSTANT_TAG_DICTIONARY = [
    { name: 'genshin_impact', count: 322135, category: 'copyright' },
    { name: 'blue_archive', count: 248900, category: 'copyright' },
    { name: 'hololive', count: 294500, category: 'copyright' },
    { name: 'zenless_zone_zero', count: 89400, category: 'copyright' },
    { name: 'honkai:_star_rail', count: 158200, category: 'copyright' },
    { name: 'frieren', count: 64200, category: 'character' },
    { name: 'fern_(sousou_no_frieren)', count: 41200, category: 'character' },
    { name: 'raiden_shogun', count: 84500, category: 'character' },
    { name: 'yae_miko', count: 62100, category: 'character' },
    { name: 'furina_(genshin_impact)', count: 54900, category: 'character' },
    { name: 'hu_tao_(genshin_impact)', count: 78300, category: 'character' },
    { name: 'ganyu_(genshin_impact)', count: 74100, category: 'character' },
    { name: 'nahida_(genshin_impact)', count: 51200, category: 'character' },
    { name: 'kafka_(honkai:_star_rail)', count: 44800, category: 'character' },
    { name: 'firefly_(honkai:_star_rail)', count: 39200, category: 'character' },
    { name: 'acheron_(honkai:_star_rail)', count: 31500, category: 'character' },
    { name: 'ellen_joe', count: 28400, category: 'character' },
    { name: 'zhu_yuan', count: 24100, category: 'character' },
    { name: 'jane_doe_(zenless_zone_zero)', count: 22900, category: 'character' },
    { name: 'asuna_(blue_archive)', count: 68400, category: 'character' },
    { name: 'kisaki_(blue_archive)', count: 34900, category: 'character' },
    { name: 'shiroko_(blue_archive)', count: 45200, category: 'character' },
    { name: 'yuuka_(blue_archive)', count: 43100, category: 'character' },
    { name: '2b_(nier:automata)', count: 94200, category: 'character' },
    { name: 'tifa_lockhart', count: 88700, category: 'character' },
    { name: 'makima_(chainsaw_man)', count: 56400, category: 'character' },
    { name: 'power_(chainsaw_man)', count: 48900, category: 'character' },
    { name: 'yor_forger', count: 59200, category: 'character' },
    { name: 'hinata_hyuga', count: 67500, category: 'character' },
    { name: 'nami_(one_piece)', count: 53800, category: 'character' },
    { name: 'nico_robin', count: 44100, category: 'character' },
    { name: 'marika_(elden_ring)', count: 29400, category: 'character' },
    { name: 'ranni_the_witch', count: 38700, category: 'character' },
    { name: 'd.va_(overwatch)', count: 72400, category: 'character' },
    { name: 'mercy_(overwatch)', count: 68900, category: 'character' },
    { name: 'widowmaker', count: 54200, category: 'character' },
    { name: 'tracer_(overwatch)', count: 51800, category: 'character' },
    { name: 'ahri_(league_of_legends)', count: 63400, category: 'character' },
    { name: 'jinx_(league_of_legends)', count: 47200, category: 'character' },
    { name: 'overwatch', count: 142000, category: 'copyright' },
    { name: 'naruto', count: 164000, category: 'copyright' },
    { name: 'one_piece', count: 148000, category: 'copyright' },
    { name: 'pokemon', count: 310000, category: 'copyright' },
    { name: 'fate/grand_order', count: 412000, category: 'copyright' },
    { name: 'azur_lane', count: 268000, category: 'copyright' },
    { name: 'nikke:_goddess_of_victory', count: 92400, category: 'copyright' },
    { name: 'wuthering_waves', count: 46800, category: 'copyright' },
    { name: 'cyberpunk', count: 48900, category: 'general' },
    { name: 'animated', count: 412000, category: 'meta' },
    { name: 'video', count: 195000, category: 'meta' },
    { name: 'highres', count: 3250000, category: 'meta' },
    { name: 'ai_generated', count: 580000, category: 'meta' },
    { name: '1girl', count: 4850000, category: 'general' },
    { name: 'solo', count: 3920000, category: 'general' },
    { name: 'long_hair', count: 3100000, category: 'general' },
    { name: 'breasts', count: 2850000, category: 'general' },
    { name: 'thighhighs', count: 1420000, category: 'general' },
    { name: 'swimsuit', count: 980000, category: 'general' },
    { name: 'bikini', count: 860000, category: 'general' },
    { name: 'bunny_girl', count: 420000, category: 'general' },
    { name: 'maid', count: 510000, category: 'general' }
  ];

  const searchInput = document.getElementById('tag-search-input');
  const autoBox = document.getElementById('tag-autocomplete');
  let debounceTimer;
  let activeSuggestIndex = -1;
  let currentSuggestions = [];

  function paintAutocompleteRows(tags, isNegated, matchQuery) {
    currentSuggestions = tags;
    activeSuggestIndex = -1;
    if (!tags.length) {
      autoBox.classList.add('hidden');
      return;
    }
    autoBox.innerHTML = tags.map((t, idx) => {
      const count = Number(t.count) || 0;
      const countLabel = count.toLocaleString();
      const cat = t.category || 'general';
      return `
      <div class="suggest-row" data-suggest-idx="${idx}" onclick="if(!event.target.closest('button')) toggleTagInPlace('${esc(t.name)}', '${isNegated ? 'exclude' : 'include'}')">
        <div class="suggest-copy" style="display:flex;align-items:center;gap:6px;">
          <span class="cat-dot ${esc(cat)}"></span>
          <div>
            <strong>${isNegated ? '-' : ''}${esc(t.name)}</strong>
            <div class="hint">${esc(cat)}</div>
          </div>
        </div>
        <div class="tag-actions">
          <span class="suggest-count" title="${esc(countLabel)} posts">${esc(formatScore(count))}</span>
          <button type="button" class="btn btn-tiny btn-ghost" data-include="${esc(t.name)}" title="Include tag">${icon('plus')} Add</button>
          <button type="button" class="btn btn-tiny btn-ghost" data-exclude="${esc(t.name)}" title="Exclude (-tag)">${icon('minus')} Hide</button>
        </div>
      </div>`;
    }).join('');
    autoBox.classList.remove('hidden');
  }

  function updateAutocomplete() {
    const val = searchInput.value;
    document.getElementById('clear-search-btn').classList.toggle('hidden', !val.trim());
    clearTimeout(debounceTimer);
    const trimmed = val.trim();
    if (!trimmed) {
      // On focus with empty input, show top 8 trending / instant tags immediately
      paintAutocompleteRows((state.trendingTags.length ? state.trendingTags : INSTANT_TAG_DICTIONARY).slice(0, 8), false, '');
      return;
    }
    const rawLastToken = trimmed.split(/\s+/).pop() || '';
    const isNegated = rawLastToken.startsWith('-');
    const lastWord = rawLastToken.replace(/^[+-]/, '').toLowerCase();
    if (!lastWord) {
      autoBox.classList.add('hidden');
      return;
    }

    // 1. Instant 0ms local dictionary + loaded feed tags match
    const localPool = new Map();
    INSTANT_TAG_DICTIONARY.forEach(t => {
      if (t.name.toLowerCase().includes(lastWord)) localPool.set(t.name, t);
    });
    (state.trendingTags || []).forEach(t => {
      if (t.name.toLowerCase().includes(lastWord) && !localPool.has(t.name)) localPool.set(t.name, t);
    });
    (state.posts || []).forEach(p => {
      (p.tags || []).forEach(tagName => {
        if (tagName.toLowerCase().includes(lastWord) && !localPool.has(tagName)) {
          localPool.set(tagName, { name: tagName, count: p.score || 100, category: tagDot(p, tagName) || 'general' });
        }
      });
    });
    const instantMatches = Array.from(localPool.values())
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(lastWord) ? 1 : 0;
        const bStarts = b.name.toLowerCase().startsWith(lastWord) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return (b.count || 0) - (a.count || 0);
      })
      .slice(0, 10);

    if (instantMatches.length) {
      paintAutocompleteRows(instantMatches, isNegated, lastWord);
    }

    if (lastWord.length < 2) return;

    // 2. Remote /api/tags enrichment with AbortController
    debounceTimer = setTimeout(async () => {
      try {
        if (activeAutocompleteController) {
          try { activeAutocompleteController.abort(); } catch (_) {}
        }
        activeAutocompleteController = new AbortController();
        const res = await fetch(`/api/tags?q=${encodeURIComponent(lastWord)}`, { signal: activeAutocompleteController.signal });
        const data = await res.json();
        const remoteTags = (data && data.tags) || [];
        remoteTags.forEach(t => localPool.set(t.name, t));
        const merged = Array.from(localPool.values())
          .sort((a, b) => (b.count || 0) - (a.count || 0))
          .slice(0, 10);
        paintAutocompleteRows(merged, isNegated, lastWord);
      } catch (err) {
        if (!err || err.name !== 'AbortError') {
          if (!instantMatches.length) autoBox.classList.add('hidden');
        }
      }
    }, 150);
  }

  searchInput.addEventListener('input', updateAutocomplete);
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) updateAutocomplete();
  });

  function runSearch() {
    autoBox.classList.add('hidden');
    state.tags = searchInput.value.trim();
    if (state.tags) recordSearchHistory(state.tags);
    state.page = 1;
    closeSearchMenu();
    showBrowseAndReload();
  }
  searchInput.addEventListener('keydown', e => {
    const rows = autoBox.querySelectorAll('.suggest-row');
    if (!autoBox.classList.contains('hidden') && rows.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestIndex = (activeSuggestIndex + 1) % rows.length;
        rows.forEach((r, i) => r.classList.toggle('is-active', i === activeSuggestIndex));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestIndex = (activeSuggestIndex - 1 + rows.length) % rows.length;
        rows.forEach((r, i) => r.classList.toggle('is-active', i === activeSuggestIndex));
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && activeSuggestIndex >= 0 && currentSuggestions[activeSuggestIndex]) {
        e.preventDefault();
        const rawLast = (searchInput.value.trim().split(/\s+/).pop() || '');
        const neg = rawLast.startsWith('-');
        toggleTagInPlace(currentSuggestions[activeSuggestIndex].name, neg ? 'exclude' : 'include');
        autoBox.classList.add('hidden');
        return;
      }
    }
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
    scrollFeedToTop();
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

  let touchStartX = 0;
  let touchStartY = 0;
  const modalStageEl = document.querySelector('#post-modal .modal-stage');
  if (modalStageEl) {
    modalStageEl.addEventListener('touchstart', e => {
      if (!e.touches || e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    modalStageEl.addEventListener('touchend', e => {
      if (!e.changedTouches || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) stepModalPost(1);
        else stepModalPost(-1);
      }
    }, { passive: true });
  }

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
      saveProSession(data.licenseKey, {
        plan: data.plan,
        tier: data.tier,
        email: data.email,
        expiresAt: data.expiresAt
      });
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
    const postModal = document.getElementById('post-modal');
    const modalOpen = Boolean(postModal && !postModal.classList.contains('hidden'));
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
      closeBoardsCompareModal();
      return;
    }
    if (!eventTargetIsField(e.target) && e.key === '/') {
      e.preventDefault();
      openSearchMenu();
      return;
    }
    if (modalOpen && !eventTargetIsField(e.target)) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        stepModalPost(-1);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        stepModalPost(1);
        return;
      }
      if (e.key === 's' || e.key === 'S' || e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (state.activePost) toggleSavePost(state.activePost.id);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleModalZoom();
        return;
      }
    }
    if (state.activeTab !== 'reels' || modalOpen || eventTargetIsField(e.target)) return;
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

document.addEventListener('scroll', () => {
  document.querySelectorAll('.card-media.is-playing').forEach(media => {
    const rect = media.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) stopCardVideo(media);
  });
  pumpGallery();
  rescueSlowImages();
}, { passive: true, capture: true });
