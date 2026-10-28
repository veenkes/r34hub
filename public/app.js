const state = {
  activeTab: 'gallery',
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
  reelObserver: null
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

function formatTook(ms) {
  const n = Number(ms) || 0;
  if (n < 1000) return `${n} ms`;
  return `${(n / 1000).toFixed(1)} s`;
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

function syncUrlBarInPlace() {
  const srcSlug = state.source === 'all' ? 'rule34.xxx' : state.source;
  const params = new URLSearchParams();
  params.set('filter[sort]', state.sort);
  if (state.tags.trim()) params.set('tags', state.tags.trim());
  if (state.rating !== 'all') params.set('rating', state.rating);
  const pathStr = `/posts/${srcSlug}?${params.toString()}`;
  const badge = document.getElementById('feed-status-badge');
  if (badge) badge.textContent = sourceLabel();
  try {
    window.history.replaceState({}, '', pathStr);
  } catch (_) {}
  renderActiveTagPills();
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
  syncUrlBarInPlace();
  loadPosts(false);
  showToast(mode === 'exclude' ? `Hiding ${clean}` : `Showing ${clean}`);
};

window.removeTagToken = function(rawToken) {
  state.tags = parseTagTokens().filter(t => t !== rawToken).join(' ');
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !state.tags);
  state.page = 1;
  syncUrlBarInPlace();
  loadPosts(false);
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
    if (topAd) topAd.classList.toggle('hidden', !state.showAdsPreview);
  }
  if (adToggle) {
    adToggle.checked = state.showAdsPreview;
    adToggle.disabled = state.isPro;
  }
  renderSourcePills();
  if (state.posts.length) renderGallery();
}

function renderSourcePills() {
  const container = document.getElementById('source-pills');
  const drawerList = document.getElementById('drawer-source-list');
  if (!container) return;
  const allItems = [{ id: 'all', name: 'All boards', isPremiumSource: false }, ...state.sources];
  container.innerHTML = allItems.map(s => {
    const active = state.source === s.id;
    const locked = Boolean(s.isPremiumSource && !state.isPro);
    return `
      <button type="button" data-source="${esc(s.id)}" data-locked="${locked}" class="chip source-pill${active ? ' is-on' : ''}">
        <span>${esc(s.name)}</span>
        ${locked ? '<span class="lock">Pro</span>' : ''}
      </button>
    `;
  }).join('');
  container.querySelectorAll('.source-pill').forEach(btn => {
    btn.addEventListener('click', () => selectSourceInPlace(btn.dataset.source, btn.dataset.locked === 'true'));
  });
  if (drawerList) {
    drawerList.innerHTML = allItems.map(s => {
      const active = state.source === s.id;
      const locked = Boolean(s.isPremiumSource && !state.isPro);
      return `
        <button type="button" class="choice${active ? ' is-on' : ''}" onclick="selectSourceInPlace('${esc(s.id)}', ${locked})">
          ${esc(s.name)}${locked ? ' · Pro' : ''}
        </button>
      `;
    }).join('');
  }
}

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
  syncUrlBarInPlace();
  loadPosts(false);
};

function setRating(rating, reload = true) {
  state.rating = rating;
  state.page = 1;
  paintChoice('.rating-btn', 'rating', rating);
  syncUrlBarInPlace();
  if (reload) loadPosts(false);
}

window.setSortInPlace = function(sort) {
  state.sort = sort;
  state.page = 1;
  paintChoice('.sort-btn', 'sort', sort);
  syncUrlBarInPlace();
  loadPosts(false);
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
  syncUrlBarInPlace();
  loadPosts(false);
  closeFilterDrawer();
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
  button.textContent = hidden ? 'Tags' : 'Hide tags';
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

  if (!append && !silent && feedEl) {
    state.page = 1;
    state.hasMore = true;
    feedEl.innerHTML = Array.from({ length: 8 }, () => '<div class="masonry-item skel"></div>').join('');
    if (summaryEl) summaryEl.textContent = 'Asking the boards…';
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
      renderGallery({ appendFrom: previousCount });
    } else {
      const same = silent
        && state.posts.length === rawPosts.length
        && state.posts.every((post, index) => post.id === rawPosts[index].id);
      state.posts = rawPosts;
      if (!rawPosts.length && !data.partial) state.hasMore = false;
      if (!same) renderGallery();
    }
    if (state.activeTab === 'reels') renderReels();

    if (summaryEl) {
      const bits = [`${state.posts.length} posts`, SORT_LABEL[state.sort] || state.sort, RATING_LABEL[state.rating] || state.rating];
      if (data.cached) bits.push('cached');
      else if (data.tookMs) bits.push(formatTook(data.tookMs));
      summaryEl.textContent = data.partial && state.posts.length < 8
        ? `${state.posts.length} posts · still loading slower boards`
        : bits.join(' · ');
    }
    if (scrollText) {
      scrollText.textContent = state.hasMore ? 'Scroll to load more' : `End of this feed · ${state.posts.length} posts`;
    }
  } catch (err) {
    if (!append && !silent && feedEl) {
      feedEl.innerHTML = `<div class="empty"><h2>The boards did not answer</h2><p>${esc(err.message)}</p><button class="btn btn-primary" type="button" onclick="loadPosts(false)">Try again</button></div>`;
    }
    if (summaryEl && !silent) summaryEl.textContent = 'Could not load the feed';
  } finally {
    state.isLoading = false;
    if (spinner) spinner.classList.remove('is-on');
  }

  if (data && data.partial && !append && state.partialFills < 2 && token === state.queryToken) {
    state.partialFills += 1;
    setTimeout(() => {
      if (token === state.queryToken) loadPosts(false, true);
    }, 1400);
  }
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

function buildPostCardHTML(post, idx) {
  const isSaved = state.savedPosts.some(s => s.id === post.id);
  const isVideo = post.mediaType === 'video';
  const expanded = state.expandedTagCards.has(post.id);
  const preview = post.previewUrl || post.proxiedPreviewUrl || '';
  const proxy = post.proxiedPreviewUrl || '';
  const eager = idx < 4;
  const tagsHtml = (post.tags || []).slice(0, 18).map(t => `
    <span class="tag">
      <button type="button" data-include="${esc(t)}"><i class="${tagDot(post, t)}"></i>${esc(t)}</button>
      <button type="button" data-exclude="${esc(t)}" title="Hide posts with this tag">Block</button>
    </span>
  `).join('');

  return `
    <article class="masonry-item card">
      <div class="card-media" data-open="${esc(post.id)}">
        <img
          src="${esc(preview)}"
          data-proxy="${esc(proxy)}"
          alt=""
          style="${ratioStyle(post)}"
          loading="${eager ? 'eager' : 'lazy'}"
          decoding="async"
          ${eager ? 'fetchpriority="high"' : ''}
          referrerpolicy="no-referrer"
          onerror="useProxy(this)"
        />
        <div class="card-float">
          <span class="pill">${esc(post.sourceName || 'Board')}</span>
          <span class="pill">${isVideo ? 'Video · ' : ''}★ ${esc(post.score || 0)}</span>
        </div>
      </div>
      <div class="card-body">
        <button type="button" class="btn btn-tiny ${isSaved ? 'btn-primary' : 'btn-ghost'}" data-save="${esc(post.id)}">${isSaved ? 'Saved' : 'Save'}</button>
        <button type="button" class="btn btn-tiny btn-ghost" data-tags="${esc(post.id)}">${expanded ? 'Hide tags' : 'Tags'}</button>
      </div>
      <div id="tags-drawer-${cssId(post.id)}" class="tags${expanded ? '' : ' hidden'}">${tagsHtml}</div>
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

function renderReels() {
  const container = document.getElementById('reels-feed');
  if (!container) return;
  if (state.reelObserver) state.reelObserver.disconnect();
  if (!state.posts.length) {
    container.innerHTML = '<div class="empty"><h2>No posts yet</h2></div>';
    return;
  }
  container.innerHTML = state.posts.map(post => {
    const isVideo = post.mediaType === 'video';
    const preview = post.previewUrl || post.proxiedPreviewUrl || '';
    const full = post.sampleUrl || post.proxiedSampleUrl || preview;
    const charTag = (post.characterTags && post.characterTags[0]) || (post.tags && post.tags[0]) || 'character';
    return `
      <article class="reel" data-kind="${isVideo ? 'video' : 'image'}" data-file="${esc(post.fileUrl || '')}" data-proxy-file="${esc(post.proxiedFileUrl || '')}" data-full="${esc(full)}" data-proxy-full="${esc(post.proxiedSampleUrl || '')}">
        ${isVideo ? `
          <video class="reel-media" poster="${esc(preview)}" preload="none" controls muted loop playsinline></video>
        ` : `
          <img class="reel-media" src="${esc(preview)}" data-proxy="${esc(post.proxiedPreviewUrl || '')}" alt="" referrerpolicy="no-referrer" onerror="useProxy(this)" />
        `}
        <div class="reel-meta">
          <div class="pill">${esc(post.sourceName || '')} · ★ ${esc(post.score || 0)}</div>
          <div class="tag-row" style="margin-top:8px">
            ${(post.tags || []).slice(0, 5).map(t => `<button type="button" class="btn btn-tiny btn-ghost" data-include="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>
        </div>
        <div class="reel-actions">
          <button type="button" class="icon-btn" data-save="${esc(post.id)}" aria-label="Save">♥</button>
          <button type="button" class="icon-btn" data-open="${esc(post.id)}" aria-label="Tags">#</button>
          <button type="button" class="icon-btn accent" onclick="triggerAdClick('reels_cta','candy_ai','${esc(post.id)}','${esc(charTag)}')">AI</button>
          <a class="icon-btn" href="${esc(post.proxiedFileUrl || post.fileUrl || '#')}" download aria-label="Download">↓</a>
        </div>
      </article>
    `;
  }).join('');

  const counter = document.getElementById('reels-counter');
  if (counter) counter.textContent = `1 / ${state.posts.length}`;
  container.onscroll = () => {
    const height = container.clientHeight || 1;
    const idx = Math.round(container.scrollTop / height);
    if (counter) counter.textContent = `${Math.min(state.posts.length, idx + 1)} / ${state.posts.length}`;
  };

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) activateReel(entry.target);
      else deactivateReel(entry.target);
    });
  }, { root: container, threshold: [0.6] });
  container.querySelectorAll('.reel').forEach(slide => observer.observe(slide));
  state.reelObserver = observer;
}

function activateReel(slide) {
  if (slide.dataset.kind === 'video') {
    const video = slide.querySelector('video');
    if (video && !video.getAttribute('src')) {
      video.src = slide.dataset.file || slide.dataset.proxyFile;
      video.onerror = () => {
        if (slide.dataset.proxyFile && video.src !== new URL(slide.dataset.proxyFile, location.origin).href) {
          video.onerror = null;
          video.src = slide.dataset.proxyFile;
        }
      };
      video.play().catch(() => {});
    }
    return;
  }
  const img = slide.querySelector('img');
  if (!img || img.dataset.upgraded === '1' || !slide.dataset.full || slide.dataset.full === img.getAttribute('src')) return;
  const full = new Image();
  full.referrerPolicy = 'no-referrer';
  full.onload = () => {
    img.src = full.src;
    img.dataset.upgraded = '1';
  };
  full.onerror = () => {
    if (slide.dataset.proxyFull && full.dataset.tried !== '1') {
      full.dataset.tried = '1';
      full.src = slide.dataset.proxyFull;
    }
  };
  full.src = slide.dataset.full;
}

function deactivateReel(slide) {
  const video = slide.querySelector('video');
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
    if (btn.classList.contains('icon-btn')) return;
    btn.classList.toggle('btn-primary', on);
    btn.classList.toggle('btn-ghost', !on);
    btn.textContent = on ? 'Saved' : 'Save';
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
    saveBtn.textContent = idx < 0 ? 'Saved' : 'Save';
  }
};

function showModalMedia(post) {
  const box = document.getElementById('modal-media-container');
  box.replaceChildren();
  if (post.mediaType === 'video') {
    const video = document.createElement('video');
    video.className = 'modal-media';
    video.poster = post.previewUrl || post.proxiedPreviewUrl || '';
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.src = post.fileUrl || post.proxiedFileUrl;
    video.onerror = () => {
      video.onerror = null;
      if (post.proxiedFileUrl) video.src = post.proxiedFileUrl;
    };
    box.appendChild(video);
    return;
  }
  const img = document.createElement('img');
  img.className = 'modal-media';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  const preview = post.previewUrl || post.proxiedPreviewUrl || '';
  const sample = post.sampleUrl || post.proxiedSampleUrl || preview;
  img.src = preview;
  img.onerror = () => useProxy(img);
  img.setAttribute('data-proxy', post.proxiedPreviewUrl || '');
  box.appendChild(img);
  if (!sample || sample === preview) return;
  const full = new Image();
  full.referrerPolicy = 'no-referrer';
  full.onload = () => { img.src = full.src; };
  full.onerror = () => {
    if (post.proxiedSampleUrl && full.dataset.tried !== '1') {
      full.dataset.tried = '1';
      full.src = post.proxiedSampleUrl;
    }
  };
  full.src = sample;
}

window.openPostModal = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  state.activePost = post;
  showModalMedia(post);
  document.getElementById('modal-source-badge').textContent = post.sourceName || 'Board';
  document.getElementById('modal-score-badge').textContent = `Score ${post.score || 0}`;
  document.getElementById('modal-dimensions').textContent = `${post.width || '?'} × ${post.height || '?'} · ${String(post.fileExt || '').toUpperCase()}`;
  document.getElementById('modal-original-url').href = post.originalPostUrl || '#';
  document.getElementById('modal-download-btn').href = post.proxiedFileUrl || post.fileUrl || '#';
  const saved = state.savedPosts.some(s => s.id === post.id);
  document.getElementById('modal-save-btn').textContent = saved ? 'Saved' : 'Save';
  document.getElementById('modal-save-btn').onclick = () => window.toggleSavePost(post.id);

  const charTag = (post.characterTags && post.characterTags[0]) || (post.tags && post.tags[0]) || 'character';
  document.getElementById('modal-ai-chat-btn').onclick = () => triggerAdClick('post_chat_ai', 'candy_ai', post.id, charTag, post.fileUrl);
  document.getElementById('modal-ai-video-btn').onclick = () => triggerAdClick('post_video_ai', 'nud3_video', post.id, charTag, post.fileUrl);

  const enc = encodeURIComponent(post.fileUrl || '');
  document.getElementById('modal-source-links').innerHTML = [
    { name: 'SauceNAO', url: `https://saucenao.com/search.php?url=${enc}` },
    { name: 'IQDB', url: `https://iqdb.org/?url=${enc}` },
    { name: 'Ascii2d', url: `https://ascii2d.net/search/url/${enc}` }
  ].map(s => `<a class="btn btn-tiny btn-ghost" href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join('');

  document.getElementById('modal-tags-list').innerHTML = (post.tags || []).map(t => `
    <span class="tag">
      <button type="button" data-include="${esc(t)}">${esc(t)}</button>
      <button type="button" data-exclude="${esc(t)}">Block</button>
    </span>
  `).join('');
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

window.switchTab = function(tabId) {
  state.activeTab = tabId;
  ['gallery', 'reels', 'saved'].forEach(t => {
    const sec = document.getElementById(`tab-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tabId);
  });
  const controls = document.getElementById('controls-bar');
  if (controls) controls.classList.toggle('hidden', tabId === 'saved');
  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.toggle('is-on', btn.dataset.tab === tabId));
  document.querySelectorAll('.mob-nav-btn').forEach(btn => btn.classList.toggle('is-on', btn.dataset.mob === tabId));
  if (tabId === 'saved') renderSavedPosts();
  if (tabId === 'reels') renderReels();
};

function renderTrendingTags() {
  const drawerTags = document.getElementById('drawer-trending-tags');
  if (!drawerTags) return;
  drawerTags.innerHTML = state.trendingTags.map(t => `
    <span class="tag">
      <button type="button" data-include="${esc(t.name)}">${esc(t.name)}</button>
      <button type="button" data-exclude="${esc(t.name)}">Block</button>
    </span>
  `).join('');
}

async function initApp() {
  readUrlState();
  renderSourcePills();
  syncUrlBarInPlace();
  const postsReady = loadPosts(false);
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
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSavePost(save.dataset.save);
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
    return;
  }
  const exclude = event.target.closest('[data-exclude]');
  if (exclude) {
    const inModal = Boolean(exclude.closest('#post-modal'));
    toggleTagInPlace(exclude.dataset.exclude, 'exclude');
    const box = document.getElementById('tag-autocomplete');
    if (box) box.classList.add('hidden');
    if (inModal) closePostModal();
    return;
  }
  const remove = event.target.closest('[data-remove-tag]');
  if (remove) {
    removeTagToken(remove.dataset.removeTag);
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
              <button type="button" class="btn btn-tiny btn-ghost" data-exclude="${esc(t.name)}">Block</button>
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
    syncUrlBarInPlace();
    loadPosts(false);
  }
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') runSearch();
  });
  document.getElementById('run-search-btn').addEventListener('click', runSearch);
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
      if (btn.classList.contains('icon-btn')) return;
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-ghost');
      btn.textContent = 'Save';
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePostModal();
      closeProModal();
      closeFilterDrawer();
      return;
    }
    if (state.activeTab !== 'reels') return;
    const container = document.getElementById('reels-feed');
    if (!container || eventTargetIsField(e.target)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      container.scrollBy({ top: container.clientHeight, behavior: 'smooth' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      container.scrollBy({ top: -container.clientHeight, behavior: 'smooth' });
    }
  });
});

function eventTargetIsField(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
}
