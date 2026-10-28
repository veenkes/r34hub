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
  activePost: null
};

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function syncUrlBarInPlace() {
  const srcSlug = state.source === 'all' ? 'rule34.xxx' : state.source;
  const params = new URLSearchParams();
  params.set('filter[sort]', state.sort);
  if (state.tags.trim()) params.set('tags', state.tags.trim());
  if (state.rating !== 'all') params.set('rating', state.rating);
  const pathStr = `/posts/${srcSlug}?${params.toString()}`;
  const ind = document.getElementById('live-route-indicator');
  if (ind) ind.textContent = `r34hub.app${pathStr}`;
  const badge = document.getElementById('feed-status-badge');
  if (badge) badge.textContent = `posts/${srcSlug}`;
  try {
    window.history.replaceState({}, '', pathStr);
  } catch (_) {}
  renderActiveTagPills();
}

function parseTagTokens() {
  return state.tags.trim().split(/\s+/).filter(Boolean);
}

window.toggleTagInPlace = function(tag, mode = 'include') {
  const clean = String(tag).replace(/^[+-]/, '').trim();
  if (!clean) return;
  let tokens = parseTagTokens().filter(t => t.replace(/^[+-]/, '') !== clean);
  if (mode === 'include') {
    tokens.push(clean);
  } else if (mode === 'exclude') {
    tokens.push(`-${clean}`);
  }
  state.tags = tokens.join(' ');
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  state.page = 1;
  syncUrlBarInPlace();
  loadPosts(false);
  showToast(mode === 'exclude' ? `⊘ Excluded -${clean} in-place` : `+ Added ${clean} to feed filter`);
};

window.removeTagToken = function(rawToken) {
  const tokens = parseTagTokens().filter(t => t !== rawToken);
  state.tags = tokens.join(' ');
  const input = document.getElementById('tag-search-input');
  if (input) input.value = state.tags;
  state.page = 1;
  syncUrlBarInPlace();
  loadPosts(false);
};

function renderActiveTagPills() {
  const bar = document.getElementById('active-tag-pills');
  const countEl = document.getElementById('active-filter-count');
  const tokens = parseTagTokens();
  if (countEl) countEl.textContent = String(tokens.length);
  if (!bar) return;

  if (!tokens.length) {
    bar.innerHTML = `<span class="text-[11px] text-zinc-500">Click + or ⊘ on any post tag to filter in-place</span>`;
    return;
  }

  bar.innerHTML = tokens.map(tok => {
    const isExcluded = tok.startsWith('-');
    const clean = tok.replace(/^[+-]/, '');
    return `
      <div class="inline-flex items-center rounded-lg border subtle-border overflow-hidden text-[11px] font-mono ${isExcluded ? 'bg-rose-950/40 text-rose-300' : 'bg-[#18181C] text-zinc-200'}">
        <span class="px-2 py-0.5">${isExcluded ? '−' : '+'} ${clean}</span>
        <button onclick="toggleTagInPlace('${clean.replace(/'/g, "\\'")}', '${isExcluded ? 'include' : 'exclude'}')" class="px-1.5 py-0.5 border-l subtle-border hover:bg-zinc-700 text-zinc-400 hover:text-white" title="Flip Include/Exclude">
          ${isExcluded ? '+' : '⊘'}
        </button>
        <button onclick="removeTagToken('${tok.replace(/'/g, "\\'")}')" class="px-1.5 py-0.5 border-l subtle-border hover:bg-rose-900/50 text-zinc-400 hover:text-white" title="Remove">
          ×
        </button>
      </div>
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
    if (txt) txt.textContent = `VIP Active (${prefix})`;
    if (btn) btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5';
    state.showAdsPreview = false;
    if (adToggle) adToggle.checked = false;
    if (topAd) topAd.classList.add('hidden');
  } else {
    if (txt) txt.textContent = 'Pro VIP • €4.97';
    if (btn) btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5';
    if (topAd) topAd.classList.toggle('hidden', !state.showAdsPreview);
  }
  renderSourcePills();
  renderGallery();
}

function renderSourcePills() {
  const container = document.getElementById('source-pills');
  const drawerList = document.getElementById('drawer-source-list');
  if (!container) return;

  const allItems = [{ id: 'all', name: 'All Boorus', isPremiumSource: false }, ...state.sources];

  container.innerHTML = allItems.map(s => {
    const active = state.source === s.id;
    const locked = s.isPremiumSource && !state.isPro;
    return `
      <button data-source="${s.id}" data-locked="${locked}" class="source-pill px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${active ? 'bg-[#222228] text-white border border-zinc-600' : 'bg-[#121215] border subtle-border text-zinc-400 hover:text-white'}">
        <span>${s.name}</span>
        ${locked ? '<span class="px-1 py-0.2 text-[9px] rounded bg-indigo-500/20 text-indigo-300 font-mono">PRO</span>' : ''}
      </button>
    `;
  }).join('');

  container.querySelectorAll('.source-pill').forEach(btn => {
    btn.addEventListener('click', () => selectSourceInPlace(btn.dataset.source, btn.dataset.locked === 'true'));
  });

  if (drawerList) {
    drawerList.innerHTML = allItems.map(s => {
      const active = state.source === s.id;
      const locked = s.isPremiumSource && !state.isPro;
      return `
        <button onclick="selectSourceInPlace('${s.id}', ${locked})" class="p-2 rounded-lg border text-left flex items-center justify-between ${active ? 'bg-[#222228] border-indigo-500 text-white' : 'bg-[#18181C] subtle-border text-zinc-300 hover:text-white'}">
          <span class="truncate">${s.name}</span>
          ${locked ? '<span class="text-[9px] px-1 rounded bg-indigo-500/20 text-indigo-300">PRO</span>' : ''}
        </button>
      `;
    }).join('');
  }
}

window.selectSourceInPlace = function(src, locked) {
  if (locked) {
    showToast('Pro VIP source — Activate your SHOP2- key to unlock all 11 Booru engines!');
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
  document.querySelectorAll('.rating-btn').forEach(b => {
    b.className = b.dataset.rating === rating
      ? 'rating-btn px-2.5 py-1 rounded-md font-medium bg-[#222228] text-white'
      : 'rating-btn px-2.5 py-1 rounded-md font-medium text-zinc-400 hover:text-white';
  });
  syncUrlBarInPlace();
  if (reload) loadPosts(false);
}

window.setSortInPlace = function(sort) {
  state.sort = sort;
  state.page = 1;
  document.querySelectorAll('.sort-btn').forEach(b => {
    b.className = b.dataset.sort === sort
      ? 'sort-btn px-2.5 py-1 rounded-md font-medium bg-[#222228] text-white'
      : 'sort-btn px-2.5 py-1 rounded-md font-medium text-zinc-400 hover:text-white';
  });
  syncUrlBarInPlace();
  loadPosts(false);
};

window.resetAllFilters = function() {
  state.tags = '';
  state.source = 'all';
  state.sort = 'score';
  state.page = 1;
  const input = document.getElementById('tag-search-input');
  if (input) input.value = '';
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
    }
  } catch (_) {
    window.open('https://candy.ai/?aff=r34hub', '_blank', 'noopener');
  }
};

window.toggleCardTags = function(postId) {
  const drawer = document.getElementById(`tags-drawer-${postId}`);
  const btn = document.getElementById(`tags-btn-${postId}`);
  if (!drawer) return;
  const isHidden = drawer.classList.contains('hidden');
  if (isHidden) {
    drawer.classList.remove('hidden');
    state.expandedTagCards.add(postId);
    if (btn) btn.innerHTML = `Tags (${drawer.dataset.count}) ▲`;
  } else {
    drawer.classList.add('hidden');
    state.expandedTagCards.delete(postId);
    if (btn) btn.innerHTML = `Tags (${drawer.dataset.count}) ⌄`;
  }
};

async function loadPosts(append = false) {
  if (state.isLoading) return;
  state.isLoading = true;

  const feedEl = document.getElementById('masonry-feed');
  const summaryEl = document.getElementById('feed-summary-text');
  const scrollText = document.getElementById('scroll-status-text');

  if (!append) {
    state.page = 1;
    state.hasMore = true;
    feedEl.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="masonry-item h-72 rounded-xl bg-[#121215] animate-pulse border subtle-border"></div>
    `).join('');
  } else if (scrollText) {
    scrollText.textContent = `Loading Page ${state.page} (+24 posts)...`;
  }

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
    const data = await res.json();
    const rawPosts = (data.posts || []).filter(p => !p.tags.some(t => state.blacklist.includes(t.toLowerCase())));

    if (append) {
      const existingIds = new Set(state.posts.map(p => p.id));
      const fresh = rawPosts.filter(p => !existingIds.has(p.id));
      state.posts = [...state.posts, ...fresh];
      if (fresh.length === 0) state.hasMore = false;
    } else {
      state.posts = rawPosts;
    }

    const lat = document.getElementById('api-latency-text');
    if (lat) lat.textContent = `${data.cached ? 'Cache' : 'Live'} • ${data.tookMs || 1}ms`;

    if (summaryEl) {
      summaryEl.textContent = `${state.posts.length} posts loaded (Page ${state.page}) • Sort: ${state.sort.toUpperCase()}`;
    }
    if (scrollText) {
      scrollText.textContent = state.hasMore
        ? `Auto-loading Page ${state.page + 1} (+24 posts) on scroll • Loaded ${state.posts.length} posts`
        : `End of current feed (${state.posts.length} posts loaded)`;
    }

    renderGallery();
    renderReels();
  } catch (err) {
    if (!append && feedEl) {
      feedEl.innerHTML = `<div class="col-span-full text-center py-12 text-zinc-400">Failed to fetch posts: ${err.message}</div>`;
    }
  } finally {
    state.isLoading = false;
  }
}

function buildSponsoredCardHTML(idx) {
  return `
    <div class="masonry-item rounded-xl overflow-hidden border subtle-border bg-[#121215] p-4 space-y-2.5">
      <div class="flex items-center justify-between text-[10px] font-mono uppercase text-zinc-400">
        <span>Sponsored • Native Zone 5489214</span>
        <span>CPA Partner</span>
      </div>
      <h3 class="text-sm font-semibold text-white">Interactive Character AI & Uncensored Roleplay</h3>
      <p class="text-xs text-zinc-400 leading-relaxed">Chat directly with any character tag or animate static illustrations in 60fps.</p>
      <div class="flex items-center gap-2 pt-1">
        <button onclick="triggerAdClick('infeed_native','candy_ai','native-${idx}','anime')" class="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs">
          Open AI Companion →
        </button>
        <button onclick="openProModal()" class="py-1.5 px-2.5 rounded-lg bg-[#18181C] hover:bg-[#222228] text-[11px] text-zinc-400 border subtle-border">
          Hide Ads
        </button>
      </div>
    </div>
  `;
}

function buildPostCardHTML(post, idx) {
  const isSaved = state.savedPosts.some(s => s.id === post.id);
  const isVideo = post.mediaType === 'video';
  const isExpanded = state.expandedTagCards.has(post.id) || idx === 0;
  const charTag = (post.characterTags && post.characterTags[0]) || post.tags[0] || 'character';

  const artistSet = new Set(post.artistTags || []);
  const charSet = new Set(post.characterTags || []);
  const copySet = new Set(post.copyrightTags || []);

  const tagPillsHtml = post.tags.slice(0, 18).map(t => {
    const safeTag = t.replace(/'/g, "\\'");
    let badgeDot = 'bg-zinc-500';
    if (artistSet.has(t)) badgeDot = 'bg-amber-400';
    else if (charSet.has(t)) badgeDot = 'bg-emerald-400';
    else if (copySet.has(t)) badgeDot = 'bg-indigo-400';

    return `
      <span class="inline-flex items-center rounded-md bg-[#09090B] border subtle-border text-[11px] font-mono text-zinc-300 overflow-hidden">
        <button onclick="toggleTagInPlace('${safeTag}','include')" class="px-1.5 py-0.5 hover:bg-emerald-950/60 hover:text-emerald-300 text-zinc-400" title="Include tag (+)">+</button>
        <button onclick="toggleTagInPlace('${safeTag}','include')" class="px-1.5 py-0.5 hover:text-white flex items-center gap-1 border-x subtle-border">
          <span class="w-1.5 h-1.5 rounded-full ${badgeDot}"></span>
          <span class="truncate max-w-[125px]">${t}</span>
        </button>
        <button onclick="toggleTagInPlace('${safeTag}','exclude')" class="px-1.5 py-0.5 hover:bg-rose-950/60 hover:text-rose-300 text-zinc-500" title="Exclude tag (⊘)">⊘</button>
      </span>
    `;
  }).join('');

  return `
    <article class="masonry-item rounded-xl overflow-hidden bg-[#121215] border subtle-border hover:border-zinc-700 transition">
      <!-- Media Preview -->
      <div class="relative cursor-pointer overflow-hidden bg-[#09090B]" onclick="openPostModal('${post.id}')">
        ${isVideo ? `
          <video
            src="${post.proxiedFileUrl}"
            poster="${post.proxiedPreviewUrl}"
            muted loop playsinline
            onmouseenter="this.play().catch(()=>{})"
            onmouseleave="this.pause()"
            class="w-full h-auto object-cover"
          ></video>
        ` : `
          <img
            src="${post.proxiedSampleUrl || post.proxiedPreviewUrl}"
            alt="${post.tags.slice(0, 4).join(', ')}"
            loading="lazy"
            onerror="if(this.src!==this.dataset.fallback){this.src=this.dataset.fallback}"
            data-fallback="${post.proxiedPreviewUrl}"
            class="w-full h-auto object-cover"
          />
        `}
        <div class="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none text-[10px] font-mono">
          <span class="px-2 py-0.5 rounded bg-black/75 backdrop-blur-md text-zinc-200 border border-white/10">
            ${post.sourceName}
          </span>
          <span class="px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-md text-zinc-300 border border-white/10 uppercase">
            ${post.fileExt} • ★ ${post.score}
          </span>
        </div>
      </div>

      <!-- Compact Action Bar -->
      <div class="p-2.5 space-y-2">
        <div class="flex items-center justify-between gap-1.5 text-xs">
          <div class="flex items-center gap-1">
            <button
              onclick="toggleSavePost('${post.id}')"
              class="px-2 py-1 rounded-lg ${isSaved ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'bg-[#18181C] text-zinc-300 hover:text-white border subtle-border'} text-[11px] font-medium transition"
            >
              ${isSaved ? '♥ Saved' : '♡ Save'}
            </button>
            <button
              id="tags-btn-${post.id}"
              onclick="toggleCardTags('${post.id}')"
              class="px-2 py-1 rounded-lg bg-[#18181C] hover:bg-[#222228] border subtle-border text-zinc-300 hover:text-white text-[11px] font-medium transition"
            >
              Tags (${post.tags.length}) ${isExpanded ? '▲' : '⌄'}
            </button>
          </div>

          <div class="flex items-center gap-1">
            <button
              onclick="triggerAdClick('post_chat_ai','candy_ai','${post.id}','${charTag.replace(/'/g, "\\'")}','${post.fileUrl}')"
              class="px-2 py-1 rounded-lg bg-[#18181C] hover:bg-indigo-600/20 border subtle-border text-indigo-300 text-[11px] font-medium transition"
              title="Chat with Character AI"
            >
              Chat AI
            </button>
            <button
              onclick="triggerAdClick('post_video_ai','nud3_video','${post.id}','${charTag.replace(/'/g, "\\'")}','${post.fileUrl}')"
              class="px-2 py-1 rounded-lg bg-[#18181C] hover:bg-indigo-600/20 border subtle-border text-zinc-300 text-[11px] font-medium transition"
              title="Animate into AI Video"
            >
              AI Video
            </button>
          </div>
        </div>

        <!-- In-Place Expandable Categorized Tags Drawer -->
        <div id="tags-drawer-${post.id}" data-count="${post.tags.length}" class="${isExpanded ? '' : 'hidden'} pt-2 border-t subtle-border space-y-1.5">
          <div class="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
            <span>IN-PLACE TAG FILTER (+ ADD / ⊘ BLOCK)</span>
            <span>${post.width}×${post.height}</span>
          </div>
          <div class="flex flex-wrap gap-1">
            ${tagPillsHtml}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderGallery() {
  const feedEl = document.getElementById('masonry-feed');
  if (!feedEl) return;
  if (!state.posts.length) {
    feedEl.innerHTML = `<div class="col-span-full text-center py-12 text-zinc-500">No posts matched your filter. Try switching Rating to "All" or clearing excluded tags.</div>`;
    return;
  }

  const freq = (state.adsConfig && state.adsConfig.infeedFrequency) || 8;
  const htmlParts = [];

  state.posts.forEach((post, idx) => {
    if (state.showAdsPreview && !state.isPro && idx > 0 && idx % freq === 0) {
      htmlParts.push(buildSponsoredCardHTML(idx));
    }
    htmlParts.push(buildPostCardHTML(post, idx));
  });

  feedEl.innerHTML = htmlParts.join('');
}

function renderReels() {
  const container = document.getElementById('reels-feed');
  if (!container) return;
  if (!state.posts.length) {
    container.innerHTML = `<div class="flex items-center justify-center h-full text-zinc-500">No posts loaded.</div>`;
    return;
  }

  container.innerHTML = state.posts.map((post, idx) => {
    const isVideo = post.mediaType === 'video';
    const charTag = (post.characterTags && post.characterTags[0]) || post.tags[0] || 'character';
    return `
      <div class="reels-slide relative flex items-center justify-center bg-black overflow-hidden" data-index="${idx}">
        ${isVideo ? `
          <video src="${post.proxiedFileUrl}" poster="${post.proxiedPreviewUrl}" controls loop muted playsinline class="max-h-full max-w-full object-contain"></video>
        ` : `
          <img src="${post.proxiedSampleUrl || post.proxiedPreviewUrl}" class="max-h-full max-w-full object-contain" loading="lazy" />
        `}
        <div class="absolute bottom-0 left-0 right-16 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="px-2 py-0.5 rounded bg-[#18181C] border subtle-border text-[11px] font-semibold text-white">${post.sourceName}</span>
            <span class="text-xs text-zinc-300 font-mono">★ ${post.score}</span>
          </div>
          <div class="flex flex-wrap gap-1 pointer-events-auto">
            ${post.tags.slice(0, 5).map(t => `
              <button onclick="toggleTagInPlace('${t.replace(/'/g, "\\'")}','include')" class="text-[11px] text-zinc-300 hover:text-white font-mono">#${t}</button>
            `).join(' ')}
          </div>
        </div>
        <div class="absolute right-3 bottom-6 flex flex-col items-center gap-2.5 z-10">
          <button onclick="toggleSavePost('${post.id}')" class="w-10 h-10 rounded-full bg-[#18181C]/90 border subtle-border flex items-center justify-center text-white text-xs">♥</button>
          <button onclick="openPostModal('${post.id}')" class="w-10 h-10 rounded-full bg-[#18181C]/90 border subtle-border flex items-center justify-center text-white text-xs">🏷️</button>
          <button onclick="triggerAdClick('reels_cta','candy_ai','${post.id}','${charTag.replace(/'/g, "\\'")}')" class="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">AI</button>
          <a href="${post.proxiedFileUrl}" download target="_blank" class="w-10 h-10 rounded-full bg-[#18181C]/90 border subtle-border flex items-center justify-center text-white text-xs">↓</a>
        </div>
      </div>
    `;
  }).join('');

  container.onscroll = () => {
    const idx = Math.round(container.scrollTop / container.clientHeight);
    document.getElementById('reels-counter').textContent = `${Math.min(state.posts.length, idx + 1)} / ${state.posts.length}`;
  };
}

function renderSavedPosts() {
  const grid = document.getElementById('saved-grid');
  const badge = document.getElementById('saved-count-badge');
  if (badge) badge.textContent = String(state.savedPosts.length);
  if (!grid) return;
  if (!state.savedPosts.length) {
    grid.innerHTML = `<div class="col-span-full p-8 text-center text-zinc-500 bg-[#121215] border subtle-border rounded-xl">No saved posts yet. Click "♡ Save" on any card in the feed.</div>`;
    return;
  }
  grid.innerHTML = state.savedPosts.map((p, i) => buildPostCardHTML(p, i)).join('');
}

window.toggleSavePost = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  const idx = state.savedPosts.findIndex(p => p.id === postId);
  if (idx >= 0) {
    state.savedPosts.splice(idx, 1);
    showToast('Removed from Saved Favorites');
  } else {
    state.savedPosts.unshift(post);
    showToast('Saved to Favorites');
  }
  localStorage.setItem('bp_saved', JSON.stringify(state.savedPosts));
  renderGallery();
  renderSavedPosts();
};

window.openPostModal = function(postId) {
  const post = state.posts.find(p => p.id === postId) || state.savedPosts.find(p => p.id === postId);
  if (!post) return;
  state.activePost = post;

  const mediaBox = document.getElementById('modal-media-container');
  if (post.mediaType === 'video') {
    mediaBox.innerHTML = `<video src="${post.proxiedFileUrl}" poster="${post.proxiedPreviewUrl}" controls autoplay loop class="max-h-[80vh] max-w-full object-contain"></video>`;
  } else {
    mediaBox.innerHTML = `<img src="${post.proxiedFileUrl || post.proxiedSampleUrl}" class="max-h-[80vh] max-w-full object-contain" />`;
  }

  document.getElementById('modal-source-badge').textContent = `${post.sourceName}`;
  document.getElementById('modal-score-badge').textContent = `★ ${post.score}`;
  document.getElementById('modal-dimensions').textContent = `${post.width} × ${post.height} (${String(post.fileExt).toUpperCase()})`;
  document.getElementById('modal-original-url').href = post.originalPostUrl;
  document.getElementById('modal-download-btn').href = post.proxiedFileUrl;

  const charTag = (post.characterTags && post.characterTags[0]) || post.tags[0] || 'character';
  document.getElementById('modal-ai-chat-btn').onclick = () => triggerAdClick('post_chat_ai', 'candy_ai', post.id, charTag, post.fileUrl);
  document.getElementById('modal-ai-video-btn').onclick = () => triggerAdClick('post_video_ai', 'nud3_video', post.id, charTag, post.fileUrl);

  const enc = encodeURIComponent(post.fileUrl);
  document.getElementById('modal-source-links').innerHTML = [
    { name: 'SauceNAO', url: `https://saucenao.com/search.php?url=${enc}` },
    { name: 'IQDB', url: `https://iqdb.org/?url=${enc}` },
    { name: 'Ascii2d', url: `https://ascii2d.net/search/url/${enc}` }
  ].map(s => `<a href="${s.url}" target="_blank" rel="noopener" class="px-2 py-1 rounded bg-[#09090B] border subtle-border text-zinc-300 hover:text-white">${s.name} ↗</a>`).join('');

  document.getElementById('modal-tags-list').innerHTML = post.tags.map(t => {
    const safeTag = t.replace(/'/g, "\\'");
    return `
      <span class="inline-flex items-center rounded bg-[#09090B] border subtle-border text-[11px] font-mono text-zinc-300">
        <button onclick="toggleTagInPlace('${safeTag}','include'); document.getElementById('post-modal').classList.add('hidden')" class="px-1.5 py-0.5 hover:text-emerald-300">+</button>
        <span class="px-1.5 py-0.5 border-x subtle-border">${t}</span>
        <button onclick="toggleTagInPlace('${safeTag}','exclude'); document.getElementById('post-modal').classList.add('hidden')" class="px-1.5 py-0.5 hover:text-rose-300">⊘</button>
      </span>
    `;
  }).join('');

  document.getElementById('modal-save-btn').onclick = () => window.toggleSavePost(post.id);
  document.getElementById('post-modal').classList.remove('hidden');
};

window.openProModal = function() {
  document.getElementById('pro-modal').classList.remove('hidden');
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
  document.getElementById('controls-bar').classList.toggle('hidden', tabId === 'saved');

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.className = btn.dataset.tab === tabId
      ? 'nav-tab px-3 py-1 rounded-lg text-xs font-medium transition bg-[#222228] text-white'
      : 'nav-tab px-3 py-1 rounded-lg text-xs font-medium transition text-zinc-400 hover:text-white flex items-center gap-1';
  });

  if (tabId === 'saved') renderSavedPosts();
};

async function initApp() {
  try {
    // Parse initial URL query if user opened /posts/rule34.xxx?filter[sort]=score
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('filter[sort]')) state.sort = urlParams.get('filter[sort]');
    if (urlParams.get('tags')) {
      state.tags = urlParams.get('tags');
      const input = document.getElementById('tag-search-input');
      if (input) input.value = state.tags;
    }

    const [srcRes, adsRes, tagRes] = await Promise.all([
      fetch('/api/sources').then(r => r.json()),
      fetch('/api/ads/config').then(r => r.json()).catch(() => ({})),
      fetch('/api/tags').then(r => r.json())
    ]);

    state.sources = srcRes.sources || [];
    state.adsConfig = adsRes.adsConfig || {};
    state.trendingTags = tagRes.trending || [];

    // Populate Drawer Trending Tags with + / ⊘ split buttons
    const drawerTags = document.getElementById('drawer-trending-tags');
    if (drawerTags && state.trendingTags.length) {
      drawerTags.innerHTML = state.trendingTags.map(t => `
        <span class="inline-flex items-center rounded-lg bg-[#18181C] border subtle-border text-xs font-mono text-zinc-200 overflow-hidden">
          <button onclick="toggleTagInPlace('${t.name}','include')" class="px-2 py-1 hover:bg-emerald-950/60 text-emerald-400">+</button>
          <span class="px-2 py-1 border-x subtle-border">${t.name}</span>
          <button onclick="toggleTagInPlace('${t.name}','exclude')" class="px-2 py-1 hover:bg-rose-950/60 text-rose-400">⊘</button>
        </span>
      `).join('');
    }

    if (state.licenseKey) {
      const verifyRes = await fetch(`/api/licenses/verify?key=${encodeURIComponent(state.licenseKey)}`).then(r => r.json()).catch(() => null);
      if (verifyRes && verifyRes.valid) {
        state.isPro = true;
      }
    }

    document.getElementById('saved-count-badge').textContent = String(state.savedPosts.length);
    document.getElementById('blacklist-textarea').value = state.blacklist.join('\n');

    updateProUI();
    syncUrlBarInPlace();
    await loadPosts(false);

    // Setup IntersectionObserver for seamless Infinite Scroll
    const sentinel = document.getElementById('infinite-scroll-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !state.isLoading && state.hasMore && state.activeTab === 'gallery') {
            state.page += 1;
            loadPosts(true);
          }
        });
      }, { rootMargin: '320px' });
      observer.observe(sentinel);
    }
  } catch (err) {
    console.error('Init error:', err);
  }
}

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
    if (!state.isLoading) {
      state.page += 1;
      loadPosts(true);
    }
  });

  // Live Autocomplete with + Include / ⊘ Exclude buttons
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
          <div class="px-3 py-2 hover:bg-[#18181C] flex items-center justify-between text-xs border-b subtle-border last:border-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-white">${t.name}</span>
              <span class="text-[10px] uppercase text-zinc-500">${t.category}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-zinc-500 mr-1">${Number(t.count).toLocaleString()}</span>
              <button onclick="toggleTagInPlace('${t.name.replace(/'/g, "\\'")}','include'); document.getElementById('tag-autocomplete').classList.add('hidden')" class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/30 font-mono text-[11px]">+ Add</button>
              <button onclick="toggleTagInPlace('${t.name.replace(/'/g, "\\'")}','exclude'); document.getElementById('tag-autocomplete').classList.add('hidden')" class="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/30 font-mono text-[11px]">⊘ Block</button>
            </div>
          </div>
        `).join('');
        autoBox.classList.remove('hidden');
      } catch (_) {
        autoBox.classList.add('hidden');
      }
    }, 180);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      autoBox.classList.add('hidden');
      state.tags = searchInput.value.trim();
      state.page = 1;
      syncUrlBarInPlace();
      loadPosts(false);
    }
  });

  document.getElementById('run-search-btn').addEventListener('click', () => {
    autoBox.classList.add('hidden');
    state.tags = searchInput.value.trim();
    state.page = 1;
    syncUrlBarInPlace();
    loadPosts(false);
  });

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
      showToast('Batch ZIP Downloader requires Pro VIP — Activate a SHOP2- key to unlock!');
      openProModal();
      return;
    }
    showToast(`Preparing Batch ZIP for ${state.posts.length} posts...`);
  });

  document.getElementById('close-post-modal').addEventListener('click', () => {
    document.getElementById('post-modal').classList.add('hidden');
    document.getElementById('modal-media-container').innerHTML = '';
  });

  document.getElementById('close-pro-modal').addEventListener('click', () => {
    document.getElementById('pro-modal').classList.add('hidden');
  });

  // License Key Activation via POST /api/licenses/activate
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
      document.getElementById('pro-modal').classList.add('hidden');
      updateProUI();
      showToast(`Activated ${data.plan} (${data.licenseKey}) — Ads hidden & all 11 Boorus unlocked!`);
    } else {
      showToast(data.error || 'Invalid license key');
    }
  });

  // Instant Crypto Checkout Simulation via POST /api/webhooks/payment
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
      document.getElementById('pro-modal').classList.add('hidden');
      updateProUI();
      showToast(`Minted & Activated Crypto Key: ${data.licenseKey}`);
    }
  });

  document.getElementById('save-blacklist-btn').addEventListener('click', () => {
    const lines = document.getElementById('blacklist-textarea').value
      .split('\n')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    state.blacklist = lines;
    localStorage.setItem('bp_blacklist', JSON.stringify(lines));
    showToast(`Updated tag blocklist (${lines.length} tags excluded)`);
    loadPosts(false);
  });

  document.getElementById('clear-saved-btn').addEventListener('click', () => {
    state.savedPosts = [];
    localStorage.setItem('bp_saved', '[]');
    renderSavedPosts();
    renderGallery();
  });
});
