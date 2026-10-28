const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '10m',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

const USER_AGENT = 'BooruPulse/1.0 (https://boorupulse.app; contact@boorupulse.app)';

// In-memory TTL Cache
class SimpleCache {
  constructor(ttlMs = 300000) {
    this.store = new Map();
    this.ttlMs = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }
  get(key) {
    const item = this.store.get(key);
    if (!item) {
      this.misses++;
      return null;
    }
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return item.value;
  }
  set(key, value, customTtlMs) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (customTtlMs || this.ttlMs)
    });
  }
  stats() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses
    };
  }
}

const postCache = new SimpleCache(5 * 60 * 1000); // 5 min
const tagCache = new SimpleCache(10 * 60 * 1000); // 10 min

// Small previews only. Full images stay on the upstream CDN.
const MEDIA_CACHE_BYTES = 48 * 1024 * 1024;
const MEDIA_CACHE_ITEM = 350 * 1024;
const mediaCache = new Map();
let mediaCacheBytes = 0;

function takeMediaCache(url) {
  const hit = mediaCache.get(url);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    mediaCache.delete(url);
    mediaCacheBytes -= hit.buf.length;
    return null;
  }
  mediaCache.delete(url);
  mediaCache.set(url, hit);
  return hit;
}

function putMediaCache(url, buf, contentType) {
  if (!buf || buf.length === 0 || buf.length > MEDIA_CACHE_ITEM) return;
  while (mediaCacheBytes + buf.length > MEDIA_CACHE_BYTES && mediaCache.size) {
    const oldest = mediaCache.keys().next().value;
    const old = mediaCache.get(oldest);
    mediaCache.delete(oldest);
    mediaCacheBytes -= old.buf.length;
  }
  mediaCache.set(url, {
    buf,
    contentType,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000
  });
  mediaCacheBytes += buf.length;
}

function isBlockedMediaHost(hostname) {
  let host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0' || host === 'metadata.google.internal') return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) host = mapped[1];
  if (/^\d+$/.test(host)) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true;
    return false;
  }
  if (host.includes(':')) {
    const head = host.split(':')[0];
    if (/^f[cd]/.test(head) || /^fe[89ab]/.test(head)) return true;
  }
  return false;
}

async function resolvesToBlockedHost(hostname) {
  if (isBlockedMediaHost(hostname)) return true;
  if (net.isIP(hostname)) return false;
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some(record => isBlockedMediaHost(record.address));
  } catch (err) {
    return false;
  }
}

// Runtime Config & Monetization State
const appConfig = {
  activeBrandId: 'r34hub',
  brands: [
    {
      id: 'boorupulse',
      name: 'BooruPulse',
      domain: 'boorupulse.app',
      decoyDomain: 'pulsemedia.dev',
      tagline: 'Next-Gen Multi-Booru Discovery & Reels Engine',
      badge: 'Recommended Hybrid',
      whyItWorks: 'Clean tech/media brand name; safe for Stripe decoy software positioning while instantly recognizable to anime/booru fans.'
    },
    {
      id: 'pixvault',
      name: 'PixVault',
      domain: 'pixvault.io',
      decoyDomain: 'pixvaultcloud.com',
      tagline: 'Cloud Media Aggregator & Tag Indexing Suite',
      badge: 'Best for Stripe / SaaS',
      whyItWorks: '100% neutral SaaS name (like RefinedSoft). Passes Stripe & Merchant-of-Record compliance checks as a "Cloud Bookmark & Image Indexing Tool".'
    },
    {
      id: 'tagdeck',
      name: 'TagDeck',
      domain: 'tagdeck.app',
      decoyDomain: 'tagdeckhq.com',
      tagline: 'Power-User Booru Client & Tag Deck Manager',
      badge: 'Best Utility Brand',
      whyItWorks: 'Positions the app like TweetDeck for tag-based image boards — ideal for selling Pro power-user features (collections, blacklists, sync).'
    },
    {
      id: 'nekostream',
      name: 'NekoStream',
      domain: 'nekostream.gg',
      decoyDomain: 'nekostudio.org',
      tagline: 'Swipe-First Anime & Booru Vertical Feed',
      badge: 'Best Viral / TikTok Style',
      whyItWorks: 'Appeals to mobile & anime/vtuber demographics; ".gg" domain gives gaming/community vibes with high organic retention.'
    },
    {
      id: 'r34hub',
      name: 'R34Hub',
      domain: 'r34hub.app',
      decoyDomain: 'hubcloud.dev',
      tagline: 'Ultimate Rule 34 & Adult Booru Search Engine',
      badge: 'Best SEO Traffic',
      whyItWorks: 'Maximum direct SEO keyword match for adult traffic, but requires a separate neutral domain (like refinedsoft.com) to accept card payments.'
    }
  ],
  booruCredentials: {
    'rule34.xxx': {
      userId: process.env.R34_USER_ID || '',
      apiKey: process.env.R34_API_KEY || ''
    },
    'gelbooru.com': {
      userId: process.env.GELBOORU_USER_ID || '',
      apiKey: process.env.GELBOORU_API_KEY || ''
    }
  },
  monetization: {
    adsEnabled: true,
    adFrequency: 6, // Inject 1 native ad card every 6 posts
    aiButtonOnPosts: true,
    aiAffiliateUrl: 'https://candy.ai?via=boorupulse',
    aiRemixUrl: 'https://nud3.me/pornify?r=boorupulse',
    stripeDecoyPortalUrl: 'https://www.refinedsoft.com/shop-premium-features-discord-role/#/portal/signup/6881f5fb9c83c40001487e13/monthly',
    sellAppCryptoUrl: 'https://refinedsoft.sell.app/product/premium-monthly-crypto?payment_method=XMR',
    plans: [
      {
        id: 'monthly',
        name: 'Monthly Pro',
        priceEur: 6.99,
        billingText: 'Billed monthly via Stripe / Ghost Portal',
        badge: 'Popular',
        stripeMethod: 'Ghost CMS + Stripe Checkout (EUR)',
        cryptoDiscountPercent: 15
      },
      {
        id: 'yearly',
        name: 'Yearly Pro',
        priceEur: 4.97,
        totalEur: 59.64,
        billingText: 'Billed €59.64/yr (Save 4 months)',
        badge: 'Best Value',
        stripeMethod: 'Ghost CMS + Stripe Checkout (EUR)',
        cryptoDiscountPercent: 20
      },
      {
        id: '30days',
        name: '30-Day Pass',
        priceEur: 12.99,
        billingText: 'One-time payment (No auto-renew)',
        badge: 'One-Time',
        stripeMethod: 'Sell.app Storefront (Card / Crypto)',
        cryptoDiscountPercent: 15
      },
      {
        id: 'lifetime',
        name: 'Lifetime VIP',
        priceEur: 199.99,
        billingText: 'One-time payment — Forever access',
        badge: 'Ultimate',
        stripeMethod: 'Sell.app Storefront (Card / XMR / USDT)',
        cryptoDiscountPercent: 25
      }
    ],
    sponsoredCards: [
      {
        id: 'ad-ai-companion',
        title: 'Create Your Custom AI Waifu & Chat Uncensored',
        subtitle: 'Turn any Booru tag or character into an interactive voice & image AI companion.',
        cta: 'Try Free AI Chat →',
        badge: 'SPONSORED • AI PARTNER',
        partner: 'Candy.ai / SpicyChat CPA ($45–$80/sale)',
        url: 'https://candy.ai?via=boorupulse',
        gradient: 'from-fuchsia-600/30 via-purple-900/40 to-indigo-950/80',
        accent: '#e879f9'
      },
      {
        id: 'ad-nutaku',
        title: 'Top 18+ Anime Gacha & RPG Games (Browser/Mobile)',
        subtitle: 'No install needed. Claim 2,000 free gems with code PULSE26.',
        cta: 'Play Instant Web RPG →',
        badge: 'SPONSORED • GAMING CPA',
        partner: 'Nutaku / CrakRevenue ($5–$15/signup)',
        url: 'https://www.nutaku.net/',
        gradient: 'from-rose-600/30 via-amber-900/40 to-zinc-950/80',
        accent: '#fb7185'
      },
      {
        id: 'ad-vpn',
        title: 'ISP Blocking Rule34 or e621? Unlock Ultra-Fast Browsing',
        subtitle: 'Stealth WireGuard VPN + Built-in AdGuard for 78% off.',
        cta: 'Activate Stealth VPN →',
        badge: 'SPONSORED • PRIVACY',
        partner: 'Proton / NordVPN Affiliate ($30+/sale)',
        url: 'https://protonvpn.com/',
        gradient: 'from-emerald-600/30 via-teal-900/40 to-slate-950/80',
        accent: '#34d399'
      }
    ]
  }
};

// Valid Demo/Issued Licenses in Memory
const issuedLicenses = new Map([
  ['SHOP2-DEMO-EUR-2026', { platform: 'Ghost + Stripe (refinedsoft.com style)', plan: 'Yearly Pro (€59.64/yr)', email: 'demo@boorupulse.app', createdAt: new Date().toISOString() }],
  ['CRYPTO-XMR-VIP-2026', { platform: 'Sell.app Crypto (XMR/USDT)', plan: 'Lifetime VIP (€199.99)', email: 'vip@boorupulse.app', createdAt: new Date().toISOString() }],
  ['PATREON-SUPPORTER-01', { platform: 'Patreon Membership', plan: 'Monthly Pro (€7.00/mo)', email: 'patron@boorupulse.app', createdAt: new Date().toISOString() }]
]);

// Supported Booru Sources Catalog
const SOURCES = [
  {
    id: 'danbooru',
    name: 'Danbooru',
    domain: 'danbooru.donmai.us',
    engine: 'Danbooru 2',
    nsfw: true,
    freeTier: true,
    status: 'live',
    description: 'Largest curated anime & game illustration board with rich artist/character tags.',
    color: '#3b82f6'
  },
  {
    id: 'paheal',
    name: 'Rule34 Paheal',
    domain: 'rule34.paheal.net',
    engine: 'Shimmie2 XML',
    nsfw: true,
    freeTier: true,
    status: 'live',
    description: '6.5M+ Rule 34 posts. Open API without mandatory API keys.',
    color: '#10b981'
  },
  {
    id: 'e621',
    name: 'e621 / e926',
    domain: 'e621.net',
    engine: 'e621 JSON',
    nsfw: true,
    freeTier: true,
    status: 'live',
    description: 'High-speed JSON API with rich metadata, scores, and WebM/MP4 animations.',
    color: '#f59e0b'
  },
  {
    id: 'yandere',
    name: 'Yande.re',
    domain: 'yande.re',
    engine: 'Moebooru',
    nsfw: true,
    freeTier: true,
    status: 'live',
    description: 'High-resolution official art, scans, and illustrations.',
    color: '#ec4899'
  },
  {
    id: 'konachan',
    name: 'Konachan',
    domain: 'konachan.com',
    engine: 'Moebooru',
    nsfw: true,
    freeTier: true,
    status: 'live',
    description: 'Anime wallpapers and wide-aspect high-res artwork.',
    color: '#8b5cf6'
  },
  {
    id: 'safebooru',
    name: 'Safebooru',
    domain: 'safebooru.org',
    engine: 'Gelbooru 0.2',
    nsfw: false,
    freeTier: true,
    status: 'live',
    description: 'Strictly SFW anime & gaming image board — great for clean default landing pages.',
    color: '#06b6d4'
  },
  {
    id: 'sakugabooru',
    name: 'Sakugabooru',
    domain: 'sakugabooru.com',
    engine: 'Moebooru',
    nsfw: false,
    freeTier: true,
    status: 'live',
    description: ' dedicated to high-frame-rate anime key animation MP4 videos & loops.',
    color: '#14b8a6'
  },
  {
    id: 'xbooru',
    name: 'XBooru',
    domain: 'xbooru.com',
    engine: 'Gelbooru 0.2',
    nsfw: true,
    freeTier: false,
     isPremiumSource: true,
    status: 'live',
    description: 'Explicit Gelbooru-based adult board (works without API key).',
    color: '#f43f5e'
  },
  {
    id: 'tbib',
    name: 'TBIB (Big ImageBoard)',
    domain: 'tbib.org',
    engine: 'Gelbooru 0.2',
    nsfw: true,
    freeTier: false,
    isPremiumSource: true,
    status: 'live',
    description: '9.7M+ posts mirror board running Gelbooru 0.2 JSON API.',
    color: '#a855f7'
  },
  {
    id: 'aibooru',
    name: 'AIBooru',
    domain: 'aibooru.online',
    engine: 'Danbooru 2',
    nsfw: true,
    freeTier: false,
    isPremiumSource: true,
    status: 'live',
    description: 'Dedicated AI-generated anime & character artwork board.',
    color: '#6366f1'
  },
  {
    id: 'rule34xxx',
    name: 'Rule34.xxx',
    domain: 'rule34.xxx',
    engine: 'Gelbooru 0.2 (Key Pool + Fallback)',
    nsfw: true,
    freeTier: true,
    status: 'hybrid',
    description: 'Uses managed API key pool if configured in Admin, or auto-routes via Paheal + XBooru.',
    color: '#22c55e'
  }
];

function getMediaType(url = '', ext = '') {
  const cleanExt = (ext || url.split('?')[0].split('.').pop() || '').toLowerCase();
  if (['mp4', 'webm'].includes(cleanExt)) return 'video';
  if (cleanExt === 'gif') return 'gif';
  return 'image';
}

function normalizeRating(r, sensitiveIsSafe = true) {
  const v = String(r || '').toLowerCase();
  if (v === 'g' || v === 'general' || v === 'safe') return 's';
  if (v === 'e' || v === 'explicit') return 'e';
  if (v === 'q' || v === 'questionable' || v === 'sensitive') return 'q';
  if (v === 's') return sensitiveIsSafe ? 's' : 'q';
  return 'q';
}

function isMotionPost(post) {
  if (post.mediaType === 'video' || post.mediaType === 'gif') return true;
  const ext = String(post.fileExt || '').toLowerCase();
  return ['gif', 'mp4', 'webm', 'mkv', 'mov', 'm4v'].includes(ext);
}

function makeProxyUrl(url, refererDomain) {
  if (!url) return '';
  return `/api/media?url=${encodeURIComponent(url)}&referer=${encodeURIComponent('https://' + refererDomain + '/')}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 1. Danbooru2 Adapter (danbooru.donmai.us, aibooru.online)
async function fetchDanbooru2(baseDomain, { tags = '', rating = 'all', sort = 'latest', page = 1, limit = 24 }) {
  const tagParts = [];
  if (tags.trim()) {
    // Danbooru allows max 2 tags on free tier
    const userTags = tags.trim().split(/\s+/).slice(0, 2);
    tagParts.push(...userTags);
  }
  if (tagParts.length < 2) {
    if (rating === 's') tagParts.push('rating:general');
    else if (rating === 'q') tagParts.push('rating:questionable');
    else if (rating === 'e') tagParts.push('rating:explicit');
  }
  if (tagParts.length < 2) {
    if (sort === 'score' || sort === 'trending') tagParts.push('order:score');
    else if (sort === 'video') tagParts.push('animated');
  }

  const q = new URLSearchParams({
    limit: String(Math.min(limit, 40)),
    page: String(page)
  });
  if (tagParts.length > 0) {
    q.set('tags', tagParts.slice(0, 2).join(' '));
  }

  const url = `https://${baseDomain}/posts.json?${q.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${baseDomain} HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data
    .filter(p => p && (p.file_url || p.large_file_url || p.preview_file_url))
    .map(p => {
      const fileUrl = p.file_url || p.large_file_url || p.preview_file_url;
      const sampleUrl = p.large_file_url || fileUrl;
      const previewUrl = p.preview_file_url || sampleUrl;
      const allTags = (p.tag_string || '').split(/\s+/).filter(Boolean);
      return {
        id: `${baseDomain}-${p.id}`,
        rawId: p.id,
        source: baseDomain === 'aibooru.online' ? 'aibooru' : 'danbooru',
        sourceName: baseDomain === 'aibooru.online' ? 'AIBooru' : 'Danbooru',
        sourceDomain: baseDomain,
        previewUrl,
        sampleUrl,
        fileUrl,
        proxiedPreviewUrl: makeProxyUrl(previewUrl, baseDomain),
        proxiedSampleUrl: makeProxyUrl(sampleUrl, baseDomain),
        proxiedFileUrl: makeProxyUrl(fileUrl, baseDomain),
        mediaType: getMediaType(fileUrl, p.file_ext),
        fileExt: p.file_ext || fileUrl.split('.').pop(),
        width: p.image_width || 1000,
        height: p.image_height || 1000,
        score: p.score || p.fav_count || 0,
        rating: normalizeRating(p.rating, false),
        tags: allTags.slice(0, 35),
        artistTags: (p.tag_string_artist || '').split(/\s+/).filter(Boolean),
        characterTags: (p.tag_string_character || '').split(/\s+/).filter(Boolean),
        copyrightTags: (p.tag_string_copyright || '').split(/\s+/).filter(Boolean),
        createdAt: p.created_at || new Date().toISOString(),
        originalPostUrl: `https://${baseDomain}/posts/${p.id}`,
        sourceRef: p.source || ''
      };
    });
}

// 2. e621 / e926 Adapter
async function fetchE621({ tags = '', rating = 'all', sort = 'latest', page = 1, limit = 24 }) {
  const host = rating === 's' ? 'e926.net' : 'e621.net';
  const tagParts = [];
  if (tags.trim()) tagParts.push(...tags.trim().split(/\s+/).slice(0, 4));
  if (rating === 's') tagParts.push('rating:s');
  else if (rating === 'q') tagParts.push('rating:q');
  else if (rating === 'e') tagParts.push('rating:e');

  if (sort === 'score' || sort === 'trending') tagParts.push('order:score');
  else if (sort === 'video') tagParts.push('animated');
  else if (sort === 'no_ai') tagParts.push('-ai_generated');

  const q = new URLSearchParams({
    limit: String(Math.min(limit, 40)),
    page: String(page)
  });
  if (tagParts.length > 0) q.set('tags', tagParts.join(' '));

  const url = `https://${host}/posts.json?${q.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
  const json = await res.json();
  const posts = json && Array.isArray(json.posts) ? json.posts : [];

  return posts
    .filter(p => p && p.file && p.file.url)
    .map(p => {
      const fileUrl = p.file.url;
      const sampleUrl = (p.sample && p.sample.url) || fileUrl;
      const previewUrl = (p.preview && p.preview.url) || sampleUrl;
      const tagsObj = p.tags || {};
      const general = tagsObj.general || [];
      const artist = tagsObj.artist || [];
      const character = tagsObj.character || [];
      const copyright = tagsObj.copyright || [];
      const species = tagsObj.species || [];
      const allTags = [...character, ...copyright, ...artist, ...species, ...general].slice(0, 35);
      return {
        id: `e621-${p.id}`,
        rawId: p.id,
        source: 'e621',
        sourceName: 'e621',
        sourceDomain: 'e621.net',
        previewUrl,
        sampleUrl,
        fileUrl,
        proxiedPreviewUrl: makeProxyUrl(previewUrl, 'e621.net'),
        proxiedSampleUrl: makeProxyUrl(sampleUrl, 'e621.net'),
        proxiedFileUrl: makeProxyUrl(fileUrl, 'e621.net'),
        mediaType: getMediaType(fileUrl, p.file.ext),
        fileExt: p.file.ext || 'jpg',
        width: p.file.width || 1000,
        height: p.file.height || 1000,
        score: (p.score && p.score.total) || p.fav_count || 0,
        rating: normalizeRating(p.rating),
        tags: allTags,
        artistTags: artist,
        characterTags: character,
        copyrightTags: copyright,
        createdAt: p.created_at || new Date().toISOString(),
        originalPostUrl: `https://e621.net/posts/${p.id}`,
        sourceRef: (p.sources && p.sources[0]) || ''
      };
    });
}

// 3. Moebooru Adapter (yande.re, konachan.com, sakugabooru.com)
async function fetchMoebooru(sourceId, baseDomain, sourceName, { tags = '', rating = 'all', sort = 'latest', page = 1, limit = 24 }) {
  const tagParts = [];
  if (tags.trim()) tagParts.push(...tags.trim().split(/\s+/));
  if (rating === 's') tagParts.push('rating:s');
  else if (rating === 'q') tagParts.push('rating:q');
  else if (rating === 'e') tagParts.push('rating:e');

  if (sort === 'score' || sort === 'trending') tagParts.push('order:score');
  else if (sort === 'video') tagParts.push('animated');

  const q = new URLSearchParams({
    limit: String(Math.min(limit, 40)),
    page: String(page),
    tags: tagParts.join(' ')
  });

  const host = baseDomain === 'sakugabooru.com' ? 'www.sakugabooru.com' : baseDomain;
  const url = `https://${host}/post.json?${q.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${baseDomain} HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data
    .filter(p => p && (p.file_url || p.sample_url || p.preview_url))
    .map(p => {
      const fixUrl = u => (!u ? '' : u.startsWith('//') ? `https:${u}` : u);
      const fileUrl = fixUrl(p.file_url || p.sample_url || p.preview_url);
      const sampleUrl = fixUrl(p.sample_url || fileUrl);
      const previewUrl = fixUrl(p.preview_url || sampleUrl);
      const allTags = (p.tags || '').split(/\s+/).filter(Boolean);
      return {
        id: `${sourceId}-${p.id}`,
        rawId: p.id,
        source: sourceId,
        sourceName,
        sourceDomain: baseDomain,
        previewUrl,
        sampleUrl,
        fileUrl,
        proxiedPreviewUrl: makeProxyUrl(previewUrl, baseDomain),
        proxiedSampleUrl: makeProxyUrl(sampleUrl, baseDomain),
        proxiedFileUrl: makeProxyUrl(fileUrl, baseDomain),
        mediaType: getMediaType(fileUrl, p.file_ext),
        fileExt: p.file_ext || fileUrl.split('?')[0].split('.').pop() || 'jpg',
        width: p.width || 1200,
        height: p.height || 900,
        score: p.score || 0,
        rating: normalizeRating(p.rating),
        tags: allTags.slice(0, 35),
        artistTags: p.author ? [p.author] : [],
        characterTags: [],
        copyrightTags: [],
        createdAt: p.created_at ? new Date(p.created_at * 1000).toISOString() : new Date().toISOString(),
        originalPostUrl: `https://${host}/post/show/${p.id}`,
        sourceRef: p.source || ''
      };
    });
}

// 4. Gelbooru 0.2 JSON Adapter (safebooru.org, xbooru.com, tbib.org, rule34.xxx, gelbooru.com)
async function fetchGelbooru02(sourceId, baseDomain, sourceName, { tags = '', rating = 'all', sort = 'latest', page = 1, limit = 24 }) {
  const tagParts = [];
  if (tags.trim()) tagParts.push(...tags.trim().split(/\s+/));
  if (sourceId !== 'safebooru') {
    if (rating === 's') tagParts.push('rating:general');
    else if (rating === 'q') tagParts.push('rating:questionable');
    else if (rating === 'e') tagParts.push('rating:explicit');
  }
  if (sort === 'score' || sort === 'trending') tagParts.push('sort:score');
  else if (sort === 'video') tagParts.push('animated');
  else if (sort === 'no_ai') tagParts.push('-ai_generated');

  const q = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    limit: String(Math.min(limit, 40)),
    pid: String(Math.max(0, page - 1))
  });
  if (tagParts.length > 0) q.set('tags', tagParts.join(' '));

  let apiHost = baseDomain;
  if (baseDomain === 'rule34.xxx') {
    apiHost = 'api.rule34.xxx';
    const creds = appConfig.booruCredentials['rule34.xxx'];
    if (creds && creds.userId && creds.apiKey) {
      q.set('user_id', creds.userId);
      q.set('api_key', creds.apiKey);
    }
  } else if (baseDomain === 'gelbooru.com') {
    const creds = appConfig.booruCredentials['gelbooru.com'];
    if (creds && creds.userId && creds.apiKey) {
      q.set('user_id', creds.userId);
      q.set('api_key', creds.apiKey);
    }
  }

  const url = `https://${apiHost}/index.php?${q.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${baseDomain} HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.includes('Missing authentication')) {
    throw new Error(`${baseDomain} requires API key`);
  }
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.post) ? parsed.post : []);

  return items.map(p => {
    let fileUrl = p.file_url || '';
    let sampleUrl = p.sample_url || '';
    let previewUrl = p.preview_url || '';

    if (!fileUrl && p.directory && p.image) {
      if (baseDomain === 'safebooru.org') {
        fileUrl = `https://safebooru.org/images/${p.directory}/${p.image}`;
        sampleUrl = p.sample ? `https://safebooru.org/samples/${p.directory}/sample_${p.image.replace(/\.[^.]+$/, '.jpg')}` : fileUrl;
        previewUrl = `https://safebooru.org/thumbnails/${p.directory}/thumbnail_${p.image.replace(/\.[^.]+$/, '.jpg')}`;
      } else if (baseDomain === 'tbib.org') {
        fileUrl = `https://tbib.org/images/${p.directory}/${p.image}`;
        sampleUrl = fileUrl;
        previewUrl = `https://tbib.org/thumbnails/${p.directory}/thumbnail_${p.image.replace(/\.[^.]+$/, '.jpg')}`;
      }
    }

    const allTags = (p.tags || '').split(/\s+/).filter(Boolean);
    return {
      id: `${sourceId}-${p.id}`,
      rawId: p.id,
      source: sourceId,
      sourceName,
      sourceDomain: baseDomain,
      previewUrl: previewUrl || sampleUrl || fileUrl,
      sampleUrl: sampleUrl || fileUrl,
      fileUrl: fileUrl || sampleUrl,
      proxiedPreviewUrl: makeProxyUrl(previewUrl || sampleUrl || fileUrl, baseDomain),
      proxiedSampleUrl: makeProxyUrl(sampleUrl || fileUrl, baseDomain),
      proxiedFileUrl: makeProxyUrl(fileUrl || sampleUrl, baseDomain),
      mediaType: getMediaType(fileUrl || p.image),
      fileExt: (fileUrl || p.image || 'jpg').split('?')[0].split('.').pop(),
      width: Number(p.width) || 1000,
      height: Number(p.height) || 1000,
      score: Number(p.score) || 0,
      rating: sourceId === 'safebooru' ? 's' : normalizeRating(p.rating),
      tags: allTags.slice(0, 35),
      artistTags: [],
      characterTags: [],
      copyrightTags: [],
      createdAt: p.change ? new Date(Number(p.change) * 1000).toISOString() : new Date().toISOString(),
      originalPostUrl: `https://${baseDomain}/index.php?page=post&s=view&id=${p.id}`,
      sourceRef: p.source || ''
    };
  });
}

// 5. Rule34 Paheal Shimmie2 XML Adapter (works without any API keys!)
async function fetchPaheal({ tags = '', rating = 'all', sort = 'latest', page = 1, limit = 24 }) {
  if (rating === 's' || rating === 'q') return [];
  const requested = tags.trim().split(/\s+/).filter(Boolean);
  if (sort === 'video' && !requested.some(tag => /^(animated|gif|mp4|webm|video)$/i.test(tag))) {
    requested.unshift('animated');
  }
  if ((sort === 'score' || sort === 'trending') && !requested.some(tag => /^order:/i.test(tag))) {
    requested.unshift('order:score');
  }
  const cleanTags = requested.slice(0, 3).join(' ');
  // Paheal ignores `offset` and repeats page 1. `page` is 1-based and does advance.
  const q = new URLSearchParams({
    limit: String(Math.min(limit, 40)),
    page: String(Math.max(1, page))
  });
  if (cleanTags) q.set('tags', cleanTags);

  const url = `https://rule34.paheal.net/api/danbooru/find_posts?${q.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`rule34.paheal.net HTTP ${res.status}`);
  const xml = await res.text();

  const posts = [];
  const tagRegex = /<post\s+([^>]+?)\/?>/g;
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const attrStr = match[1];
    const attrs = {};
    const attrRegex = /(\w+)=['"]([^'"]*)['"]/g;
    let aMatch;
    while ((aMatch = attrRegex.exec(attrStr)) !== null) {
      attrs[aMatch[1]] = aMatch[2];
    }
    if (attrs.id && attrs.file_url) {
      const fileName = attrs.file_name || '';
      const extMatch = fileName.match(/\.([a-zA-Z0-9]+)(?:;|$)/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const allTags = (attrs.tags || '').split(/\s+/).filter(Boolean);
      if (sort === 'no_ai' && allTags.some(t => t.toLowerCase().includes('ai_generated') || t.toLowerCase() === 'ai')) {
        continue;
      }
      if (sort === 'video' && !['mp4', 'webm', 'gif'].includes(ext)) {
        continue;
      }
      posts.push({
        id: `paheal-${attrs.id}`,
        rawId: attrs.id,
        source: 'paheal',
        sourceName: 'Rule34 Paheal',
        sourceDomain: 'rule34.paheal.net',
        previewUrl: attrs.preview_url || attrs.file_url,
        sampleUrl: attrs.file_url,
        fileUrl: attrs.file_url,
        proxiedPreviewUrl: makeProxyUrl(attrs.preview_url || attrs.file_url, 'rule34.paheal.net'),
        proxiedSampleUrl: makeProxyUrl(attrs.file_url, 'rule34.paheal.net'),
        proxiedFileUrl: makeProxyUrl(attrs.file_url, 'rule34.paheal.net'),
        mediaType: getMediaType(attrs.file_url, ext),
        fileExt: ext,
        width: Number(attrs.width) || 1000,
        height: Number(attrs.height) || 1000,
        score: Number(attrs.score) || 0,
        rating: 'e',
        tags: allTags.slice(0, 35),
        artistTags: [],
        characterTags: [],
        copyrightTags: [],
        createdAt: attrs.date || new Date().toISOString(),
        originalPostUrl: `https://rule34.paheal.net/post/view/${attrs.id}`,
        sourceRef: attrs.source || ''
      });
    }
  }
  return posts;
}

// Unified Router for a single source
async function fetchFromSource(sourceId, params) {
  switch (sourceId) {
    case 'danbooru':
      return fetchDanbooru2('danbooru.donmai.us', params);
    case 'aibooru':
      return fetchDanbooru2('aibooru.online', params);
    case 'e621':
      return fetchE621(params);
    case 'yandere':
      return fetchMoebooru('yandere', 'yande.re', 'Yande.re', params);
    case 'konachan':
      return fetchMoebooru('konachan', 'konachan.com', 'Konachan', params);
    case 'sakugabooru':
      return fetchMoebooru('sakugabooru', 'sakugabooru.com', 'Sakugabooru', params);
    case 'safebooru':
      return fetchGelbooru02('safebooru', 'safebooru.org', 'Safebooru', params);
    case 'xbooru':
      return fetchGelbooru02('xbooru', 'xbooru.com', 'XBooru', params);
    case 'tbib':
      return fetchGelbooru02('tbib', 'tbib.org', 'TBIB', params);
    case 'paheal':
      return fetchPaheal(params);
    case 'rule34xxx': {
      const creds = appConfig.booruCredentials['rule34.xxx'];
      const hasKey = Boolean(creds && creds.userId && creds.apiKey);
      if (hasKey) {
        try {
          return await fetchGelbooru02('rule34xxx', 'rule34.xxx', 'Rule34.xxx', params);
        } catch (err) {
          // Fall through to the open mirrors.
        }
      }
      const [pahealPosts, xbooruPosts] = await Promise.allSettled([
        fetchPaheal(params),
        fetchGelbooru02('xbooru', 'xbooru.com', 'Rule34 Mirror (XBooru)', params)
      ]);
      const merged = [
        ...(pahealPosts.status === 'fulfilled' ? pahealPosts.value : []),
        ...(xbooruPosts.status === 'fulfilled' ? xbooruPosts.value : [])
      ];
      return merged.map(p => ({
        ...p,
        sourceName: `${p.sourceName} (R34 Pool)`
      }));
    }
    default:
      return fetchDanbooru2('danbooru.donmai.us', params);
  }
}

// API: Get Sources & Brand Config
app.get('/api/sources', (req, res) => {
  res.json({
    sources: SOURCES,
    activeBrand: appConfig.brands.find(b => b.id === appConfig.activeBrandId) || appConfig.brands[0],
    brands: appConfig.brands,
    cacheStats: postCache.stats()
  });
});

function interleaveLists(lists) {
  const posts = [];
  const maxLen = lists.reduce((n, list) => Math.max(n, list.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i]) posts.push(list[i]);
    }
  }
  return posts;
}

function finalizePosts(posts, sort, limit, rating = 'all') {
  let next = posts.filter(post => !rating || rating === 'all' || post.rating === rating);
  if (sort === 'no_ai') {
    next = next.filter(p => !p.tags.some(t => /ai_generated|^ai$/i.test(t)));
  }
  if (sort === 'video') next = next.filter(isMotionPost);
  if (sort === 'score' || sort === 'trending') {
    next = next.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  return next.slice(0, limit);
}

// One slow board must not hold the whole feed. Return what answered inside the budget.
async function gatherSources(targetSources, params, budgetMs) {
  const lists = targetSources.map(() => null);
  const jobs = targetSources.map((sourceId, index) =>
    fetchFromSource(sourceId, params)
      .then(value => {
        lists[index] = Array.isArray(value) ? value : [];
      })
      .catch(() => {
        lists[index] = [];
      })
  );
  const allDone = Promise.all(jobs);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await Promise.race([allDone, wait(budgetMs)]);
  const readyPosts = lists.reduce((n, list) => n + (list ? list.length : 0), 0);
  if (readyPosts < 8) await Promise.race([allDone, wait(1800)]);
  return { lists, allDone };
}

// API: Unified Posts Aggregator
app.get('/api/posts', async (req, res) => {
  const source = String(req.query.source || 'all');
  const tags = String(req.query.tags || '');
  const rating = String(req.query.rating || 's'); // 's', 'q', 'e', 'all'
  const sort = String(req.query.sort || 'latest'); // 'latest', 'score', 'trending', 'video', 'no_ai'
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(48, Math.max(8, parseInt(req.query.limit || '24', 10)));

  const cacheKey = `posts:${source}:${tags}:${rating}:${sort}:${page}:${limit}`;
  const cached = postCache.get(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', cached.partial ? 'no-store' : 'public, max-age=60, stale-while-revalidate=120');
    return res.json({
      ...cached,
      cached: true,
      cacheStats: postCache.stats()
    });
  }

  const startTime = Date.now();
  try {
    let posts = [];
    const sourceBreakdown = {};
    let partial = false;

    if (source === 'all') {
      let targetSources = ['safebooru', 'danbooru', 'konachan', 'yandere', 'e621'];
      if (sort === 'video') {
        targetSources = ['sakugabooru', 'danbooru', 'e621', 'paheal'];
      } else if (rating === 'e' || rating === 'all') {
        targetSources = ['danbooru', 'xbooru', 'e621', 'yandere', 'paheal'];
      }

      const perSourceLimit = Math.min(20, Math.max(8, Math.ceil(limit / 2)));
      const gathered = await gatherSources(
        targetSources,
        { tags, rating, sort, page, limit: perSourceLimit },
        2200
      );
      const settled = gathered.lists.map(list => list || []);
      settled.forEach((list, idx) => {
        sourceBreakdown[targetSources[idx]] = list.length;
      });
      posts = interleaveLists(settled);
      partial = gathered.lists.some(list => list === null);
      if (partial) {
        gathered.allDone.then(() => {
          const fullLists = gathered.lists.map(list => list || []);
          const fullPosts = finalizePosts(interleaveLists(fullLists), sort, limit, rating);
          if (!fullPosts.length) return;
          const breakdown = {};
          targetSources.forEach((id, idx) => {
            breakdown[id] = fullLists[idx].length;
          });
          postCache.set(cacheKey, {
            source,
            tags,
            rating,
            sort,
            page,
            count: fullPosts.length,
            tookMs: Date.now() - startTime,
            sourceBreakdown: breakdown,
            partial: false,
            posts: fullPosts
          });
        }).catch(() => {});
      }
    } else {
      posts = await fetchFromSource(source, { tags, rating, sort, page, limit });
      sourceBreakdown[source] = posts.length;
    }

    posts = finalizePosts(posts, sort, limit, rating);

    const payload = {
      source,
      tags,
      rating,
      sort,
      page,
      count: posts.length,
      tookMs: Date.now() - startTime,
      sourceBreakdown,
      partial,
      posts
    };

    if (posts.length > 0) {
      postCache.set(cacheKey, payload, partial ? 12000 : undefined);
    }

    res.setHeader('Cache-Control', partial ? 'no-store' : 'public, max-age=60, stale-while-revalidate=120');
    res.json({
      ...payload,
      cached: false,
      cacheStats: postCache.stats()
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || 'Failed to fetch posts',
      source,
      posts: []
    });
  }
});

// API: Live Tag Autocomplete & Trending Tags
const TRENDING_TAGS = [
  { name: 'genshin_impact', count: 322135, category: 'copyright' },
  { name: 'blue_archive', count: 248900, category: 'copyright' },
  { name: 'hololive', count: 294500, category: 'copyright' },
  { name: 'zenless_zone_zero', count: 89400, category: 'copyright' },
  { name: 'honkai:_star_rail', count: 158200, category: 'copyright' },
  { name: 'frieren', count: 64200, category: 'character' },
  { name: 'overwatch', count: 142000, category: 'copyright' },
  { name: 'cyberpunk', count: 48900, category: 'general' },
  { name: 'animated', count: 412000, category: 'meta' },
  { name: '1girl', count: 4850000, category: 'general' }
];

app.get('/api/tags', async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.json({ tags: TRENDING_TAGS, trending: TRENDING_TAGS });
  }

  const cacheKey = `tags:${query}`;
  const cached = tagCache.get(cacheKey);
  if (cached) return res.json({ tags: cached, cached: true });

  try {
    const catMap = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta' };
    const [danRes, yandRes] = await Promise.allSettled([
      fetchWithTimeout(`https://danbooru.donmai.us/tags.json?search[name_matches]=${encodeURIComponent(query)}*&search[order]=count&limit=10`),
      fetchWithTimeout(`https://yande.re/tag.json?name=${encodeURIComponent(query)}&order=count&limit=6`)
    ]);

    const merged = new Map();
    if (danRes.status === 'fulfilled' && danRes.value.ok) {
      const arr = await danRes.value.json();
      if (Array.isArray(arr)) {
        arr.forEach(t => {
          merged.set(t.name, {
            name: t.name,
            count: t.post_count || 0,
            category: catMap[t.category] || 'general'
          });
        });
      }
    }
    if (yandRes.status === 'fulfilled' && yandRes.value.ok) {
      const arr = await yandRes.value.json();
      if (Array.isArray(arr)) {
        arr.forEach(t => {
          if (!merged.has(t.name)) {
            merged.set(t.name, {
              name: t.name,
              count: t.count || 0,
              category: catMap[t.type] || 'general'
            });
          }
        });
      }
    }

    const result = Array.from(merged.values()).sort((a, b) => b.count - a.count).slice(0, 12);
    tagCache.set(cacheKey, result);
    res.json({ tags: result, cached: false });
  } catch (err) {
    res.json({ tags: TRENDING_TAGS.filter(t => t.name.includes(query)) });
  }
});

// Follow a few public redirects. A public host must not bounce the proxy onto a private address.
async function fetchMediaUpstream(startUrl, headers) {
  let current = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch (err) {
      return { blocked: true };
    }
    if (!/^https?:$/.test(parsed.protocol) || await resolvesToBlockedHost(parsed.hostname)) {
      return { blocked: true };
    }
    const upstream = await fetchWithTimeout(current, { headers, redirect: 'manual' }, 12000);
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (upstream.body && typeof upstream.body.cancel === 'function') {
        upstream.body.cancel().catch(() => {});
      }
      if (!location) return { blocked: true };
      current = new URL(location, current).href;
      continue;
    }
    return { upstream, finalUrl: current };
  }
  return { blocked: true };
}

// Streams upstream media. Small previews are cached; large files are not buffered first.
app.get('/api/media', async (req, res) => {
  const targetUrl = String(req.query.url || '');
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    return res.status(400).send('Invalid media URL');
  }
  if (!/^https?:$/.test(parsedUrl.protocol) || isBlockedMediaHost(parsedUrl.hostname)) {
    return res.status(400).send('Invalid media URL');
  }

  if (!req.headers.range) {
    const hit = takeMediaCache(targetUrl);
    if (hit) {
      res.setHeader('Content-Type', hit.contentType);
      res.setHeader('Content-Length', String(hit.buf.length));
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).end(hit.buf);
    }
  }

  const referer = String(req.query.referer || `${parsedUrl.protocol}//${parsedUrl.hostname}/`);
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
    'Referer': referer
  };
  if (req.headers.range) headers.Range = req.headers.range;

  let fetched;
  try {
    fetched = await fetchMediaUpstream(targetUrl, headers);
  } catch (err) {
    if (!res.headersSent) res.redirect(targetUrl);
    return;
  }
  if (!fetched || fetched.blocked) return res.status(400).send('Invalid media URL');
  const upstream = fetched.upstream;

  try {
    if (!upstream.ok && upstream.status !== 206) {
      return res.redirect(targetUrl);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('text/html')) return res.redirect(targetUrl);

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');

    const len = Number(upstream.headers.get('content-length') || 0);
    const cacheable = !req.headers.range && upstream.status === 200 && len > 0 && len <= MEDIA_CACHE_ITEM && /^image\//.test(contentType);
    if (cacheable) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      putMediaCache(targetUrl, buf, contentType);
      res.setHeader('Content-Length', String(buf.length));
      return res.end(buf);
    }

    if (len) res.setHeader('Content-Length', String(len));
    if (upstream.body && typeof Readable.fromWeb === 'function') {
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => {
        if (!res.headersSent) res.redirect(targetUrl);
        else res.end();
      });
      stream.pipe(res);
      return;
    }

    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    if (!res.headersSent) res.redirect(targetUrl);
  }
});

// API: Monetization, Stripe Investigation Blueprint & Admin Configuration
app.get('/api/monetization/config', (req, res) => {
  res.json({
    activeBrandId: appConfig.activeBrandId,
    activeBrand: appConfig.brands.find(b => b.id === appConfig.activeBrandId) || appConfig.brands[0],
    brands: appConfig.brands,
    monetization: appConfig.monetization,
    credentialsConfigured: {
      'rule34.xxx': Boolean(appConfig.booruCredentials['rule34.xxx'].apiKey),
      'gelbooru.com': Boolean(appConfig.booruCredentials['gelbooru.com'].apiKey)
    },
    r34AppInvestigation: {
      usesStripe: true,
      currency: 'EUR (€)',
      ownerJurisdiction: 'Spain (Alejandro Akbal)',
      decoyDomain: 'https://www.refinedsoft.com',
      previousDecoyDomain: 'https://shop.akbal.dev',
      cmsPlatform: 'Ghost CMS v6.73 + Ghost Portal (Native Stripe Checkout & Stripe Automatic Tax)',
      stripeTierId: '6881f5fb9c83c40001487e13',
      stripeProductTitle: 'Premium features & Discord role',
      oneTimeAndCryptoPlatform: 'https://refinedsoft.sell.app (Sell.app storefront for 30-day €12.99, Lifetime €199.99, and Monero/XMR)',
      authBackend: 'https://pocketbase.r34.app (PocketBase with prefixed license keys: SHOP2-, SHOP-, PATREON-, SLX-, KOFI-)',
      plans: [
        { name: 'Monthly', price: '€7.00 / month', processor: 'Ghost Portal -> Stripe Checkout (refinedsoft.com)' },
        { name: 'Yearly', price: '€59.64 / year (€4.97/mo)', processor: 'Ghost Portal -> Stripe Checkout (refinedsoft.com)' },
        { name: '30 Days', price: '€12.99 one-time', processor: 'Sell.app -> Stripe / Crypto (refinedsoft.sell.app)' },
        { name: 'Lifetime', price: '€199.99 one-time', processor: 'Sell.app -> Stripe / Crypto (refinedsoft.sell.app)' }
      ]
    }
  });
});

app.post('/api/monetization/config', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { activeBrandId, adsEnabled, adFrequency, aiButtonOnPosts, r34UserId, r34ApiKey, gelUserId, gelApiKey } = req.body || {};
  if (activeBrandId && appConfig.brands.some(b => b.id === activeBrandId)) {
    appConfig.activeBrandId = activeBrandId;
  }
  if (typeof adsEnabled === 'boolean') appConfig.monetization.adsEnabled = adsEnabled;
  if (adFrequency) appConfig.monetization.adFrequency = Number(adFrequency);
  if (typeof aiButtonOnPosts === 'boolean') appConfig.monetization.aiButtonOnPosts = aiButtonOnPosts;
  if (typeof r34UserId === 'string') appConfig.booruCredentials['rule34.xxx'].userId = r34UserId.trim();
  if (typeof r34ApiKey === 'string') appConfig.booruCredentials['rule34.xxx'].apiKey = r34ApiKey.trim();
  if (typeof gelUserId === 'string') appConfig.booruCredentials['gelbooru.com'].userId = gelUserId.trim();
  if (typeof gelApiKey === 'string') appConfig.booruCredentials['gelbooru.com'].apiKey = gelApiKey.trim();

  res.json({
    ok: true,
    activeBrand: appConfig.brands.find(b => b.id === appConfig.activeBrandId),
    monetization: appConfig.monetization
  });
});


// ============================================================================
// R34HUB MONETIZATION, LICENSING, DECOY BILLING (HUBCLOUD.DEV) & AD CPA ENGINE
// ============================================================================
const fs = require("fs");
const DB_PATH = path.join(__dirname, "data", "monetization-db.json");

function loadMonetizationDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    }
  } catch (err) {
    console.error("Failed to read monetization-db.json:", err.message);
  }
  return {
    owner: {
      email: "",
      adminToken: "",
      webhookSecret: "",
      primaryDomain: "r34hub.app",
      decoyDomain: "hubcloud.dev"
    },
    paymentConfig: { plans: {} },
    adsConfig: { adsEnabled: true, cpaOffers: [], adZones: {}, telemetry: { totalClicks: 0, estimatedCpaRevenueEur: 0, estimatedBannerRevenueEur: 0, byPlacement: {}, recentClicks: [] } },
    licenses: [],
    orders: []
  };
}

function paymentConfigForAdmin(config) {
  const copy = Object.assign({}, config || {});
  delete copy.nowPaymentsApiKey;
  return copy;
}

function saveMonetizationDb(db) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write monetization-db.json:", err.message);
  }
}

let monDb = loadMonetizationDb();

function secretMatches(sent, expected) {
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res) {
  const sent = String(req.get('x-admin-token') || req.query.token || '').trim();
  const expected = process.env.R34HUB_ADMIN_TOKEN || (monDb.owner && monDb.owner.adminToken) || '';
  if (!secretMatches(sent, expected)) {
    res.status(401).json({ ok: false, error: 'Admin token required' });
    return false;
  }
  return true;
}

function requireWebhook(req, res) {
  const sent = String(req.get('x-webhook-secret') || (req.body && req.body.secret) || '').trim();
  const expected = process.env.R34HUB_WEBHOOK_SECRET || (monDb.owner && monDb.owner.webhookSecret) || '';
  if (!secretMatches(sent, expected)) {
    res.status(401).json({ ok: false, error: 'Webhook secret required' });
    return false;
  }
  return true;
}

function generateLicenseKeyString(prefix = "SHOP2", tierCode = "PRO") {
  const cleanPrefix = ["SHOP2", "PATREON", "SLX"].includes(String(prefix).toUpperCase())
    ? String(prefix).toUpperCase()
    : "SHOP2";
  const b1 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const b2 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const b3 = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${cleanPrefix}-${b1}-${b2}-${b3}`;
}

function buildLicenseEmailHtml({ email, licenseKey, planName, priceEur, expiresAt, gateway }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#09090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#121215;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;">
    <div style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">HubCloud.dev • R34Hub.app Digital Fulfillment</div>
    <h2 style="margin:0 0 12px;color:#ffffff;font-size:20px;">Your Pro VIP License Key is Ready</h2>
    <p style="margin:0 0 16px;color:#d4d4d8;font-size:14px;line-height:1.5;">
      Thank you for your purchase (${planName} — €${Number(priceEur).toFixed(2)} via ${gateway}). Copy your activation key below and paste it into the <strong>R34Hub Pro VIP</strong> modal on <a href="https://r34hub.app" style="color:#818cf8;">r34hub.app</a>:
    </p>
    <div style="background:#09090b;border:1px solid rgba(129,140,248,0.35);border-radius:12px;padding:16px;text-align:center;margin-bottom:18px;">
      <div style="font-size:11px;color:#a1a1aa;margin-bottom:4px;">LICENSE KEY (MAX 5 DEVICES)</div>
      <div style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:0.06em;color:#ffffff;">${licenseKey}</div>
    </div>
    <table style="width:100%;font-size:12px;color:#a1a1aa;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">
      <tr><td>Account Email:</td><td style="text-align:right;color:#e4e4e7;">${email}</td></tr>
      <tr><td>Unlocked Perks:</td><td style="text-align:right;color:#34d399;">Zero Ads • All 11 Boorus • Batch ZIP • AI Priority</td></tr>
      <tr><td>Valid Until:</td><td style="text-align:right;color:#e4e4e7;">${String(expiresAt).slice(0, 10)}</td></tr>
    </table>
  </div>
</body>
</html>`;
}

// 1. License Key Engine (/api/licenses/*)
app.post("/api/licenses/activate", (req, res) => {
  monDb = loadMonetizationDb();
  const rawKey = String((req.body && (req.body.key || req.body.licenseKey)) || "").trim().toUpperCase();
  if (!rawKey) {
    return res.status(400).json({ ok: false, valid: false, error: "Please enter a license key." });
  }

  const record = monDb.licenses.find(l => l.key.toUpperCase() === rawKey);

  if (!record) {
    return res.status(404).json({ ok: false, valid: false, error: "License key not found." });
  }
  if (record.status === "revoked") {
    return res.status(403).json({ ok: false, valid: false, error: "This license key has been revoked by the administrator." });
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
    record.status = "expired";
    saveMonetizationDb(monDb);
    return res.status(403).json({ ok: false, valid: false, error: "This license key has expired. Please renew at HubCloud.dev." });
  }
  if (record.devicesUsed >= (record.maxDevices || 5)) {
    return res.status(403).json({ ok: false, valid: false, error: `Device limit reached (${record.devicesUsed}/${record.maxDevices} devices active).` });
  }

  record.devicesUsed = Math.min(record.maxDevices || 5, (record.devicesUsed || 0) + 1);
  record.lastActivatedAt = new Date().toISOString();
  saveMonetizationDb(monDb);

  return res.json({
    ok: true,
    valid: true,
    licenseKey: record.key,
    platform: record.prefix === "SLX" ? "Sell.app / Crypto" : record.prefix === "PATREON" ? "Patreon VIP" : "HubCloud.dev (Stripe EUR)",
    plan: record.planName,
    tier: record.tier,
    email: record.email,
    devicesUsed: record.devicesUsed,
    maxDevices: record.maxDevices || 5,
    expiresAt: record.expiresAt,
    license: record,
    profile: {
      adFree: true,
      proSourcesUnlocked: true,
      batchDownload: true,
      aiVideoPriority: true,
      cloudSync: true,
      unlimitedBlacklist: true
    }
  });
});

app.get("/api/licenses/verify", (req, res) => {
  monDb = loadMonetizationDb();
  const rawKey = String(req.query.key || "").trim().toUpperCase();
  if (!rawKey) return res.status(400).json({ valid: false, error: "Missing key query parameter" });
  const record = monDb.licenses.find(l => l.key.toUpperCase() === rawKey);
  if (!record) return res.status(404).json({ valid: false, status: "not_found", error: "License key not found" });
  const expired = record.expiresAt && new Date(record.expiresAt).getTime() < Date.now();
  const status = record.status === "revoked" ? "revoked" : expired ? "expired" : "active";
  res.json({
    valid: status === "active",
    status,
    key: record.key,
    prefix: record.prefix,
    tier: record.tier,
    planName: record.planName,
    ownerEmail: record.email,
    devicesUsed: record.devicesUsed,
    maxDevices: record.maxDevices || 5,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt
  });
});

// Backwards-compatible verify endpoint
app.post("/api/monetization/verify-license", (req, res) => {
  monDb = loadMonetizationDb();
  const rawKey = String((req.body && (req.body.licenseKey || req.body.key)) || "").trim().toUpperCase();
  const record = monDb.licenses.find(l => l.key.toUpperCase() === rawKey);
  if (!record || record.status !== "active") {
    return res.status(401).json({ valid: false, error: "Invalid or revoked license key." });
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
    return res.status(401).json({ valid: false, error: "This license key has expired." });
  }
  if ((record.devicesUsed || 0) >= (record.maxDevices || 5)) {
    return res.status(403).json({ valid: false, error: "Device limit reached." });
  }
  record.devicesUsed = Math.min(record.maxDevices || 5, (record.devicesUsed || 0) + 1);
  record.lastActivatedAt = new Date().toISOString();
  saveMonetizationDb(monDb);
  return res.json({
    valid: true,
    licenseKey: record.key,
    platform: record.prefix === "SLX" ? "Sell.app Crypto" : "HubCloud.dev (Stripe EUR)",
    plan: record.planName,
    tier: record.tier,
    email: record.email,
    expiresAt: record.expiresAt
  });
});

// Admin: Generate 1 to 50 keys
app.post("/api/admin/licenses/generate", (req, res) => {
  monDb = loadMonetizationDb();
  if (!requireAdmin(req, res)) return;
  const {
    count = 1,
    plan = "annual",
    prefix = "SHOP2",
    email = "",
    notes = "Generated in Admin Control Center"
  } = req.body || {};

  const num = Math.min(50, Math.max(1, parseInt(count, 10) || 1));
  const planMap = {
    "30d": { tier: "monthly", days: 30, name: "30-Day Monthly Pro (€7.00/mo)", priceEur: 7.00 },
    "monthly": { tier: "monthly", days: 30, name: "30-Day Monthly Pro (€7.00/mo)", priceEur: 7.00 },
    "365d": { tier: "annual", days: 365, name: "365-Day Annual Pro (€59.99/yr)", priceEur: 59.99 },
    "annual": { tier: "annual", days: 365, name: "365-Day Annual Pro (€59.99/yr)", priceEur: 59.99 },
    "lifetime": { tier: "lifetime", days: 36500, name: "Lifetime Owner / VIP Master (€199.99)", priceEur: 199.99 }
  };
  const chosen = planMap[plan] || planMap.annual;
  const now = new Date();
  const expiresAt = chosen.tier === "lifetime"
    ? "2099-12-31T23:59:59.000Z"
    : new Date(now.getTime() + chosen.days * 86400000).toISOString();

  const generated = [];
  for (let i = 0; i < num; i++) {
    const key = generateLicenseKeyString(prefix, chosen.tier);
    const item = {
      key,
      prefix: String(prefix).toUpperCase(),
      tier: chosen.tier,
      planName: chosen.name,
      priceEur: chosen.priceEur,
      email: String(email).trim() || "buyer@r34hub.app",
      status: "active",
      devicesUsed: 0,
      maxDevices: 5,
      createdAt: now.toISOString(),
      expiresAt,
      notes
    };
    monDb.licenses.unshift(item);
    generated.push(item);
  }
  saveMonetizationDb(monDb);

  const first = generated[0];
  const emailReceiptHtml = buildLicenseEmailHtml({
    email: first.email,
    licenseKey: first.key,
    planName: first.planName,
    priceEur: first.priceEur,
    expiresAt: first.expiresAt,
    gateway: "Admin Direct Issuance"
  });

  res.json({
    ok: true,
    count: generated.length,
    keys: generated,
    emailReceiptHtml
  });
});

// Admin: Revoke or Reactivate a key
app.post("/api/admin/licenses/revoke", (req, res) => {
  monDb = loadMonetizationDb();
  if (!requireAdmin(req, res)) return;
  const { key = "", action = "toggle" } = req.body || {};
  const cleanKey = String(key).trim().toUpperCase();
  const record = monDb.licenses.find(l => l.key.toUpperCase() === cleanKey);
  if (!record) return res.status(404).json({ ok: false, error: "License key not found" });

  if (action === "revoke") record.status = "revoked";
  else if (action === "activate") record.status = "active";
  else record.status = record.status === "revoked" ? "active" : "revoked";

  saveMonetizationDb(monDb);
  res.json({ ok: true, license: record });
});

// 2. Payment Webhooks & Checkout Simulation (/api/checkout/create & /api/webhooks/payment)
app.post("/api/checkout/create", (req, res) => {
  const body = req.body || {};
  const plan = body.plan || "annual";
  const provider = body.provider || "stripe";
  const email = String(body.email || "").trim();
  const cryptoCurrency = body.cryptoCurrency || "XMR";
  const planLookup = {
    monthly: { id: "monthly", name: "Monthly Pro", tier: "monthly", amountEur: 7.00, days: 30 },
    yearly: { id: "annual", name: "Annual Pro (€4.97/mo)", tier: "annual", amountEur: 59.99, days: 365 },
    annual: { id: "annual", name: "Annual Pro (€4.97/mo)", tier: "annual", amountEur: 59.99, days: 365 },
    "30days": { id: "30d_pass", name: "30-Day One-Time Pass", tier: "monthly", amountEur: 12.99, days: 30 },
    "30d_pass": { id: "30d_pass", name: "30-Day One-Time Pass", tier: "monthly", amountEur: 12.99, days: 30 },
    lifetime: { id: "lifetime", name: "Lifetime VIP Master Pass", tier: "lifetime", amountEur: 199.99, days: 36500 }
  };
  const selected = planLookup[plan] || planLookup.annual;
  const isCrypto = provider === "crypto" || provider === "nowpayments";
  const finalAmountEur = isCrypto ? Number((selected.amountEur * 0.8).toFixed(2)) : selected.amountEur;
  const sessionId = `cs_live_${crypto.randomBytes(8).toString("hex")}`;

  res.json({
    ok: true,
    sessionId,
    provider: isCrypto ? `nowpayments_${cryptoCurrency.toLowerCase()}` : provider === "sellapp" ? "sellapp" : "stripe_hubcloud",
    plan: selected.id,
    planName: selected.name,
    tier: selected.tier,
    email,
    amountEur: finalAmountEur,
    currency: "EUR",
    cryptoDiscountApplied: isCrypto ? "20% OFF" : null,
    statementDescriptor: "HUBCLOUD.DEV * CLOUD SYNC",
    checkoutUrl: `/hubcloud?session=${sessionId}&plan=${selected.id}&provider=${encodeURIComponent(provider)}&email=${encodeURIComponent(email)}`
  });
});

app.post("/api/webhooks/payment", (req, res) => {
  monDb = loadMonetizationDb();
  if (!requireWebhook(req, res)) return;
  const {
    provider = "stripe_hubcloud",
    event = "checkout.session.completed",
    plan = "annual",
    email = "",
    amountEur
  } = req.body || {};

  const isCrypto = String(provider).includes("crypto") || String(provider).includes("nowpayments") || String(provider).includes("xmr");
  const prefix = isCrypto ? "SLX" : String(provider).includes("patreon") ? "PATREON" : "SHOP2";

  const planLookup = {
    monthly: { tier: "monthly", name: "30-Day Monthly Pro (€7.00/mo)", priceEur: 7.00, days: 30 },
    yearly: { tier: "annual", name: "365-Day Annual Pro (€59.99/yr)", priceEur: 59.99, days: 365 },
    annual: { tier: "annual", name: "365-Day Annual Pro (€59.99/yr)", priceEur: 59.99, days: 365 },
    "30days": { tier: "monthly", name: "30-Day One-Time Pass (€12.99)", priceEur: 12.99, days: 30 },
    "30d_pass": { tier: "monthly", name: "30-Day One-Time Pass (€12.99)", priceEur: 12.99, days: 30 },
    lifetime: { tier: "lifetime", name: "Lifetime VIP Master Pass (€199.99)", priceEur: 199.99, days: 36500 }
  };
  const chosen = planLookup[plan] || planLookup.annual;
  const finalPrice = typeof amountEur === "number" ? amountEur : (isCrypto ? Number((chosen.priceEur * 0.8).toFixed(2)) : chosen.priceEur);
  const now = new Date();
  const expiresAt = chosen.tier === "lifetime"
    ? "2099-12-31T23:59:59.000Z"
    : new Date(now.getTime() + chosen.days * 86400000).toISOString();

  const licenseKey = generateLicenseKeyString(prefix, chosen.tier);
  const licenseRecord = {
    key: licenseKey,
    prefix,
    tier: chosen.tier,
    planName: chosen.name,
    priceEur: finalPrice,
    email: String(email).trim() || "buyer@r34hub.app",
    status: "active",
    devicesUsed: 1,
    maxDevices: 5,
    createdAt: now.toISOString(),
    expiresAt,
    notes: `Auto-minted via ${provider} (${event})`
  };
  monDb.licenses.unshift(licenseRecord);

  const orderRecord = {
    orderId: `ord_${crypto.randomBytes(4).toString("hex")}`,
    provider,
    event,
    email: licenseRecord.email,
    plan: chosen.tier,
    planName: chosen.name,
    amountEur: finalPrice,
    currency: isCrypto ? "EUR (Crypto -20%)" : "EUR",
    licenseKey,
    status: "paid",
    createdAt: now.toISOString()
  };
  monDb.orders.unshift(orderRecord);
  saveMonetizationDb(monDb);

  const emailReceiptHtml = buildLicenseEmailHtml({
    email: licenseRecord.email,
    licenseKey,
    planName: chosen.name,
    priceEur: finalPrice,
    expiresAt,
    gateway: isCrypto ? "NowPayments / Sell.app Crypto" : "HubCloud.dev (Stripe EUR)"
  });

  res.json({
    ok: true,
    order: orderRecord,
    license: licenseRecord,
    licenseKey,
    platform: isCrypto ? "NowPayments / Sell.app Crypto" : "HubCloud.dev (Stripe EUR)",
    emailReceiptHtml
  });
});

// Keep checkout-demo routed to webhook minting
app.post("/api/monetization/checkout-demo", (req, res) => {
  if (!requireWebhook(req, res)) return;
  const { planId = "annual", method = "stripe", email = "" } = req.body || {};
  req.body = {
    provider: method === "crypto" ? "nowpayments_xmr" : "stripe_hubcloud",
    event: method === "crypto" ? "payment_status:finished" : "checkout.session.completed",
    plan: planId,
    email
  };
  monDb = loadMonetizationDb();
  const isCrypto = method === "crypto";
  const prefix = isCrypto ? "SLX" : "SHOP2";
  const licenseKey = generateLicenseKeyString(prefix, planId);
  const now = new Date();
  const expiresAt = planId === "lifetime" ? "2099-12-31T23:59:59.000Z" : new Date(now.getTime() + 365 * 86400000).toISOString();
  const rec = {
    key: licenseKey,
    prefix,
    tier: planId === "lifetime" ? "lifetime" : planId === "monthly" ? "monthly" : "annual",
    planName: planId === "lifetime" ? "Lifetime VIP (€199.99)" : planId === "monthly" ? "Monthly Pro (€7.00/mo)" : "Annual Pro (€59.99/yr)",
    priceEur: planId === "lifetime" ? 199.99 : planId === "monthly" ? 7.00 : 59.99,
    email,
    status: "active",
    devicesUsed: 1,
    maxDevices: 5,
    createdAt: now.toISOString(),
    expiresAt,
    notes: "Checkout Simulation"
  };
  monDb.licenses.unshift(rec);
  monDb.orders.unshift({
    orderId: `ord_${crypto.randomBytes(4).toString("hex")}`,
    provider: isCrypto ? "nowpayments_xmr" : "stripe_hubcloud",
    event: "checkout.session.completed",
    email,
    plan: rec.tier,
    amountEur: rec.priceEur,
    currency: "EUR",
    licenseKey,
    status: "paid",
    createdAt: now.toISOString()
  });
  saveMonetizationDb(monDb);
  res.json({
    ok: true,
    licenseKey,
    platform: isCrypto ? "Sell.app Crypto (XMR / USDT)" : "HubCloud.dev + Stripe EUR",
    plan: rec.planName,
    email,
    createdAt: rec.createdAt
  });
});

// 3. Ad Networks & AI CPA Affiliate Rotator (/api/ads/config, /api/ads/click, /api/admin/ads/update, /api/admin/stats)
app.get("/api/ads/config", (req, res) => {
  monDb = loadMonetizationDb();
  res.json({
    ok: true,
    adsConfig: monDb.adsConfig
  });
});

app.post("/api/ads/click", (req, res) => {
  monDb = loadMonetizationDb();
  const {
    placement = "post_chat_ai",
    offerId = "candy_ai",
    postId = "post-0",
    tag = "anime",
    mediaUrl = ""
  } = req.body || {};

  const tel = monDb.adsConfig.telemetry || {
    totalClicks: 0,
    estimatedCpaRevenueEur: 0,
    estimatedBannerRevenueEur: 0,
    byPlacement: {},
    recentClicks: []
  };

  tel.totalClicks = (tel.totalClicks || 0) + 1;
  tel.byPlacement[placement] = (tel.byPlacement[placement] || 0) + 1;

  const offers = monDb.adsConfig.cpaOffers || [];
  let chosenOffer = offers.find(o => o.id === offerId) || offers.find(o => o.placement === placement) || offers[0];

  const epc = chosenOffer ? (chosenOffer.epcUsd || 1.2) : 0.85;
  tel.estimatedCpaRevenueEur = Number(((tel.estimatedCpaRevenueEur || 0) + epc).toFixed(2));

  let targetUrl = chosenOffer ? chosenOffer.urlTemplate : "https://candy.ai/?aff=r34hub";
  targetUrl = targetUrl
    .replace("{post_id}", encodeURIComponent(postId))
    .replace("{character_tag}", encodeURIComponent(tag))
    .replace("{media_url}", encodeURIComponent(mediaUrl));

  tel.recentClicks = tel.recentClicks || [];
  tel.recentClicks.unshift({
    id: `clk_${crypto.randomBytes(3).toString("hex")}`,
    placement,
    offerId: chosenOffer ? chosenOffer.id : offerId,
    postId,
    tag,
    targetUrl,
    timestamp: new Date().toISOString()
  });
  tel.recentClicks = tel.recentClicks.slice(0, 30);
  monDb.adsConfig.telemetry = tel;
  saveMonetizationDb(monDb);

  res.json({
    ok: true,
    targetUrl,
    telemetry: tel
  });
});

app.post("/api/admin/ads/update", (req, res) => {
  monDb = loadMonetizationDb();
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};

  if (typeof body.adsEnabled === "boolean") monDb.adsConfig.adsEnabled = body.adsEnabled;
  if (body.infeedFrequency) monDb.adsConfig.infeedFrequency = Number(body.infeedFrequency);
  if (body.reelsFrequency) monDb.adsConfig.reelsFrequency = Number(body.reelsFrequency);

  if (Array.isArray(body.cpaOffers)) {
    body.cpaOffers.forEach(updated => {
      const existing = monDb.adsConfig.cpaOffers.find(o => o.id === updated.id);
      if (existing) {
        if (updated.affiliateId !== undefined) existing.affiliateId = updated.affiliateId;
        if (updated.urlTemplate !== undefined) existing.urlTemplate = updated.urlTemplate;
        if (updated.ctaText !== undefined) existing.ctaText = updated.ctaText;
        if (typeof updated.active === "boolean") existing.active = updated.active;
      }
    });
  }

  if (body.adZones && typeof body.adZones === "object") {
    Object.keys(body.adZones).forEach(zoneKey => {
      if (monDb.adsConfig.adZones[zoneKey]) {
        Object.assign(monDb.adsConfig.adZones[zoneKey], body.adZones[zoneKey]);
      }
    });
  }

  if (body.paymentConfig && typeof body.paymentConfig === "object") {
    Object.assign(monDb.paymentConfig, body.paymentConfig);
  }

  saveMonetizationDb(monDb);
  res.json({
    ok: true,
    adsConfig: monDb.adsConfig,
    paymentConfig: paymentConfigForAdmin(monDb.paymentConfig)
  });
});

app.get("/api/admin/stats", (req, res) => {
  monDb = loadMonetizationDb();
  if (!requireAdmin(req, res)) return;
  const activeLicenses = monDb.licenses.filter(l => l.status === "active");
  const subRevenue = monDb.orders.reduce((acc, o) => acc + (Number(o.amountEur) || 0), 0);
  const cpaRev = (monDb.adsConfig.telemetry && monDb.adsConfig.telemetry.estimatedCpaRevenueEur) || 0;
  const bannerRev = (monDb.adsConfig.telemetry && monDb.adsConfig.telemetry.estimatedBannerRevenueEur) || 0;

  res.json({
    ok: true,
    owner: {
      email: monDb.owner && monDb.owner.email,
      primaryDomain: monDb.owner && monDb.owner.primaryDomain,
      decoyDomain: monDb.owner && monDb.owner.decoyDomain
    },
    summary: {
      totalLicenses: monDb.licenses.length,
      activeLicenses: activeLicenses.length,
      lifetimeCount: monDb.licenses.filter(l => l.tier === "lifetime").length,
      annualCount: monDb.licenses.filter(l => l.tier === "annual").length,
      monthlyCount: monDb.licenses.filter(l => l.tier === "monthly").length,
      totalOrders: monDb.orders.length,
      subscriptionRevenueEur: Number(subRevenue.toFixed(2)),
      estimatedCpaRevenueEur: Number(cpaRev.toFixed(2)),
      estimatedBannerRevenueEur: Number(bannerRev.toFixed(2)),
      totalRevenueEur: Number((subRevenue + cpaRev + bannerRev).toFixed(2))
    },
    paymentConfig: paymentConfigForAdmin(monDb.paymentConfig),
    adsConfig: monDb.adsConfig,
    licenses: monDb.licenses,
    orders: monDb.orders
  });
});

// HTML Page Routes for /admin, /hubcloud, and /posts/*
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/hubcloud", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hubcloud.html"));
});

function sendIndex(_req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
}

app.get("/posts/:source", sendIndex);
app.get(["/grid", "/grid/:source", "/saved", "/settings"], sendIndex);

app.get("/api/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, service: "r34hub" });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 500;
  res.status(status).json({
    ok: false,
    error: status >= 500 ? "Server error" : "Request failed"
  });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`R34Hub server running at http://0.0.0.0:${PORT}`);
  });
}
module.exports = app;
