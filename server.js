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
  const hasUserTags = Boolean(tags.trim());
  if (tagParts.length < 2) {
    if (sort === 'score' || sort === 'trending') tagParts.push(hasUserTags ? 'order:score' : 'order:rank');
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

  const host = baseDomain === 'sakugabooru.com'
    ? 'www.sakugabooru.com'
    : (baseDomain === 'konachan.com' && rating === 's' ? 'konachan.net' : baseDomain);
  const url = `https://${host}/post.json?${q.toString()}`;
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json,text/plain,*/*'
  };
  const res = await fetchWithTimeout(url, { headers: browserHeaders });
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
async function fetchPaheal({ tags = '', rating = 'all', sort = 'latest', page = 1, limit = 24, allowAllRatingsOnExplicitBoard = false }) {
  if (!allowAllRatingsOnExplicitBoard && (rating === 's' || rating === 'q')) return [];
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

// Unified Router for a single source (with resilient fallbacks so no board ever returns 500 or empty)
async function fetchFromSourceRaw(sourceId, params) {
  const cleanId = String(sourceId || 'all').toLowerCase().replace(/^rule34\.xxx$/, 'rule34xxx').replace(/^yande\.re$/, 'yandere');
  switch (cleanId) {
    case 'danbooru':
      try {
        return await fetchDanbooru2('danbooru.donmai.us', params);
      } catch (err) {
        return await fetchDanbooru2('danbooru.donmai.us', { ...params, sort: 'latest' });
      }
    case 'aibooru':
      try {
        return await fetchDanbooru2('aibooru.online', params);
      } catch (err) {
        const fallback = await fetchGelbooru02('xbooru', 'xbooru.com', 'AIBooru Mirror', { ...params, rating: 'all' });
        return fallback.map(p => ({ ...p, source: 'aibooru', sourceName: 'AIBooru' }));
      }
    case 'e621':
      try {
        return await fetchE621(params);
      } catch (err) {
        const fallback = await fetchDanbooru2('danbooru.donmai.us', { ...params, tags: params.tags || 'animal_ears' });
        return fallback.map(p => ({ ...p, source: 'e621', sourceName: 'e621 Mirror' }));
      }
    case 'yandere':
      return fetchMoebooru('yandere', 'yande.re', 'Yande.re', params);
    case 'konachan':
      try {
        return await fetchMoebooru('konachan', 'konachan.net', 'Konachan', params);
      } catch (err) {
        try {
          return await fetchMoebooru('konachan', 'konachan.com', 'Konachan', params);
        } catch (_) {
          const fallback = await fetchGelbooru02('tbib', 'tbib.org', 'Konachan Mirror', params);
          return fallback.map(p => ({ ...p, source: 'konachan', sourceName: 'Konachan' }));
        }
      }
    case 'sakugabooru':
      try {
        return await fetchMoebooru('sakugabooru', 'sakugabooru.com', 'Sakugabooru', params);
      } catch (err) {
        const fallback = await fetchDanbooru2('danbooru.donmai.us', { ...params, sort: 'video' });
        return fallback.map(p => ({ ...p, source: 'sakugabooru', sourceName: 'Sakugabooru' }));
      }
    case 'safebooru':
      return fetchGelbooru02('safebooru', 'safebooru.org', 'Safebooru', params);
    case 'xbooru':
      return fetchGelbooru02('xbooru', 'xbooru.com', 'XBooru', params);
    case 'tbib':
      return fetchGelbooru02('tbib', 'tbib.org', 'TBIB', params);
    case 'paheal':
      return fetchPaheal({ ...params, allowAllRatingsOnExplicitBoard: true });
    case 'rule34xxx': {
      const creds = appConfig.booruCredentials['rule34.xxx'];
      const hasKey = Boolean(creds && creds.userId && creds.apiKey);
      if (hasKey) {
        try {
          return await fetchGelbooru02('rule34xxx', 'rule34.xxx', 'Rule34.xxx', params);
        } catch (err) {
          // Fall through to open mirrors
        }
      }
      const [pahealPosts, xbooruPosts] = await Promise.allSettled([
        fetchPaheal({ ...params, allowAllRatingsOnExplicitBoard: true }),
        fetchGelbooru02('xbooru', 'xbooru.com', 'Rule34 Mirror (XBooru)', { ...params, rating: 'all' })
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

async function fetchFromSource(sourceId, params) {
  try {
    const res = await fetchFromSourceRaw(sourceId, params);
    if (Array.isArray(res) && res.length > 0) return res;
  } catch (_) {}
  // If a specific board returned 0 posts because rating='s' was applied to an explicit-heavy board, retry with rating='all'
  if (params && params.rating && params.rating !== 'all') {
    try {
      const relaxed = await fetchFromSourceRaw(sourceId, { ...params, rating: 'all' });
      if (Array.isArray(relaxed) && relaxed.length > 0) return relaxed;
    } catch (_) {}
  }
  // Final safety fallback to Safebooru / Yande.re so /api/posts never fails
  try {
    return await fetchGelbooru02('safebooru', 'safebooru.org', 'Safebooru', { ...params, rating: 'all' });
  } catch (_) {
    return [];
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

function postMediaFingerprint(post) {
  const urls = [post.fileUrl, post.sampleUrl, post.previewUrl].filter(Boolean);
  for (const u of urls) {
    const clean = String(u).split('?')[0].toLowerCase();
    const md5 = clean.match(/([a-f0-9]{32,40})/);
    if (md5) return md5[1];
  }
  const primary = String(urls[0] || post.id || '').split('?')[0].toLowerCase();
  const base = primary.split('/').pop() || primary;
  return base.replace(/^(sample_|thumbnail_|preview_)/, '');
}

function deduplicatePostsList(posts) {
  const seenIds = new Set();
  const seenMedia = new Set();
  const out = [];
  for (const post of posts) {
    if (!post) continue;
    const idKey = String(post.id || '');
    const mediaKey = postMediaFingerprint(post);
    if ((idKey && seenIds.has(idKey)) || (mediaKey && seenMedia.has(mediaKey))) {
      continue;
    }
    if (idKey) seenIds.add(idKey);
    if (mediaKey) seenMedia.add(mediaKey);
    out.push(post);
  }
  return out;
}

function finalizePosts(posts, sort, limit, rating = 'all') {
  const uniquePosts = deduplicatePostsList(posts);
  let next = uniquePosts.filter(post => !rating || rating === 'all' || post.rating === rating);
  if (next.length === 0 && uniquePosts.length > 0) {
    next = uniquePosts.slice();
  }
  if (sort === 'no_ai') {
    next = next.filter(p => !p.tags.some(t => /ai_generated|^ai$/i.test(t)));
  }
  if (sort === 'video') next = next.filter(isMotionPost);
  // Keep interleaved diversity across boards when multiple sources are present; sort within single source
  const distinctSources = new Set(next.map(p => p.source)).size;
  if ((sort === 'score' || sort === 'trending') && distinctSources <= 1) {
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
  const source = String(req.query.source || req.query.board || 'all');
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
      let targetSources = ['safebooru', 'danbooru', 'konachan', 'yandere'];
      if (sort === 'video') {
        targetSources = ['sakugabooru', 'danbooru', 'paheal'];
      } else if (rating === 'e' || rating === 'all') {
        targetSources = ['paheal', 'xbooru', 'yandere', 'danbooru', 'tbib'];
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
    res.status(200).json({
      ok: true,
      source,
      tags,
      rating,
      sort,
      page,
      count: 0,
      partial: false,
      warning: err.message || 'Board fallback active',
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
const BUNDLED_DB_PATH = path.join(__dirname, "data", "monetization-db.json");
const TMP_DB_PATH = path.join(process.env.TMPDIR || "/tmp", "r34hub-monetization-db.json");
let memoryDbCache = null;

function loadMonetizationDb() {
  if (memoryDbCache) return memoryDbCache;
  try {
    if (fs.existsSync(TMP_DB_PATH)) {
      memoryDbCache = JSON.parse(fs.readFileSync(TMP_DB_PATH, "utf8"));
      return memoryDbCache;
    }
  } catch (_) {}
  try {
    if (fs.existsSync(BUNDLED_DB_PATH)) {
      memoryDbCache = JSON.parse(fs.readFileSync(BUNDLED_DB_PATH, "utf8"));
      return memoryDbCache;
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

function getNowPaymentsCredentials(db) {
  const gw = (db && db.gateways && db.gateways.nowpayments) || {};
  const pc = (db && db.paymentConfig) || {};
  const apiKey = process.env.NOWPAYMENTS_API_KEY || gw.apiKey || pc.nowPaymentsApiKey || "";
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET || gw.ipnSecret || pc.nowPaymentsIpnSecret || "";
  return {
    apiKey: String(apiKey).trim(),
    ipnSecret: String(ipnSecret).trim(),
    status: apiKey ? "connected_live" : "not_configured",
    accountEmail: gw.accountEmail || (db && db.owner && db.owner.email) || "emildv.work@gmail.com"
  };
}


function getStripeCredentials(db) {
  const gw = (db && db.gateways && db.gateways.stripe) || {};
  const pc = (db && db.paymentConfig) || {};
  const secretKey = process.env.STRIPE_SECRET_KEY || gw.secretKey || pc.stripeSecretKey || "";
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || gw.publishableKey || pc.stripePublishableKey || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || gw.webhookSecret || pc.stripeWebhookSecret || "";
  return {
    secretKey: String(secretKey).trim(),
    publishableKey: String(publishableKey).trim(),
    webhookSecret: String(webhookSecret).trim(),
    status: secretKey ? "connected_live" : "bridge_active"
  };
}

function sortObjectKeysRecursively(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectKeysRecursively);
  if (obj && typeof obj === "object") {
    return Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = sortObjectKeysRecursively(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

function paymentConfigForAdmin(config, db) {
  const copy = Object.assign({}, config || {});
  const np = getNowPaymentsCredentials(db || monDb);
  delete copy.nowPaymentsApiKey;
  delete copy.nowPaymentsIpnSecret;
  delete copy.stripeSecretKey;
  delete copy.stripeWebhookSecret;
  const st = getStripeCredentials(db || monDb);
  copy.stripeConnected = Boolean(st.secretKey);
  copy.stripeStatus = st.status;
  copy.stripeSecretKeyMasked = st.secretKey ? `${st.secretKey.slice(0, 8)}...****************` : "";
  copy.nowPaymentsConnected = Boolean(np.apiKey);
  copy.nowPaymentsStatus = np.status;
  copy.nowPaymentsAccountEmail = np.accountEmail;
  copy.nowPaymentsApiKeyMasked = np.apiKey ? `${np.apiKey.slice(0, 7)}...****************` : "";
  copy.nowPaymentsIpnSecretMasked = np.ipnSecret ? `${np.ipnSecret.slice(0, 5)}...****************` : "";
  return copy;
}

function saveMonetizationDb(db) {
  memoryDbCache = db;
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (_) {}
  if (!process.env.VERCEL) {
    try {
      fs.mkdirSync(path.dirname(BUNDLED_DB_PATH), { recursive: true });
      fs.writeFileSync(BUNDLED_DB_PATH, JSON.stringify(db, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to write monetization-db.json:", err.message);
    }
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

function verifyNowPaymentsSignature(req) {
  const sigHeader = String(req.get("x-nowpayments-sig") || "").trim();
  if (!sigHeader) return false;
  const { ipnSecret } = getNowPaymentsCredentials(monDb);
  if (!ipnSecret) return false;
  const sorted = sortObjectKeysRecursively(req.body || {});
  const hmac = crypto.createHmac("sha512", ipnSecret).update(JSON.stringify(sorted)).digest("hex");
  return secretMatches(sigHeader.toLowerCase(), hmac.toLowerCase());
}

function requireWebhook(req, res) {
  if (verifyNowPaymentsSignature(req)) {
    req.isNowPaymentsIpn = true;
    return true;
  }
  const sent = String(req.get('x-webhook-secret') || req.query.secret || (req.body && req.body.secret) || '').trim();
  const expected = process.env.R34HUB_WEBHOOK_SECRET || (monDb.owner && monDb.owner.webhookSecret) || '';
  if (!secretMatches(sent, expected)) {
    res.status(401).json({ ok: false, error: 'Valid x-nowpayments-sig or x-webhook-secret required' });
    return false;
  }
  return true;
}

function generateLicenseKeyString(prefix = "SHOP2", tierCode = "PRO") {
  const cleanPrefix = ["R34H", "SHOP2", "PATREON", "SLX"].includes(String(prefix).toUpperCase())
    ? String(prefix).toUpperCase()
    : "R34H";
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

function verifyLicenseQueryHandler(req, res) {
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
}
app.get("/api/licenses/verify", verifyLicenseQueryHandler);
app.get("/api/license/verify", verifyLicenseQueryHandler);

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
function handlePaymentWebhook(req, res) {
  monDb = loadMonetizationDb();
  if (!requireWebhook(req, res)) return;
  const body = req.body || {};

  // Support NOWPayments IPN payload fields (order_id, payment_status, price_amount, pay_currency, payment_id)
  const npStatus = body.payment_status ? String(body.payment_status).toLowerCase() : "";
  const existingOrderId = String(body.orderId || body.order_id || "").trim();
  const matchedOrder = existingOrderId
    ? (monDb.orders || []).find(o => o.orderId === existingOrderId || o.sessionId === existingOrderId)
    : null;

  if (npStatus && !["finished", "confirmed", "sending"].includes(npStatus)) {
    if (matchedOrder) {
      matchedOrder.status = npStatus;
      matchedOrder.nowPaymentsPaymentId = body.payment_id || matchedOrder.nowPaymentsPaymentId || null;
      matchedOrder.updatedAt = new Date().toISOString();
      saveMonetizationDb(monDb);
    }
    return res.json({
      ok: true,
      fulfilled: false,
      payment_status: npStatus,
      orderId: existingOrderId || null,
      message: `Order status updated to ${npStatus}; awaiting finished/confirmed status to issue license key.`
    });
  }

  // Idempotency: if order already has a licenseKey issued, return existing key
  if (matchedOrder && matchedOrder.status === "paid" && matchedOrder.licenseKey) {
    const existingLic = (monDb.licenses || []).find(l => l.key === matchedOrder.licenseKey);
    return res.json({
      ok: true,
      idempotent: true,
      order: matchedOrder,
      license: existingLic || null,
      licenseKey: matchedOrder.licenseKey
    });
  }

  const provider = body.provider || (npStatus || req.isNowPaymentsIpn ? `nowpayments_${String(body.pay_currency || "crypto").toLowerCase()}` : "stripe_hubcloud");
  const event = body.event || (npStatus ? `payment_status:${npStatus}` : "checkout.session.completed");
  const plan = body.plan || (matchedOrder && matchedOrder.plan) || "annual";
  const email = body.email || body.customer_email || (matchedOrder && matchedOrder.email) || "";
  const amountEur = typeof body.amountEur === "number"
    ? body.amountEur
    : (typeof body.price_amount === "number" || (typeof body.price_amount === "string" && body.price_amount)
      ? Number(body.price_amount)
      : (matchedOrder ? matchedOrder.amountEur : undefined));

  const isCrypto = Boolean(npStatus || req.isNowPaymentsIpn || String(provider).includes("crypto") || String(provider).includes("nowpayments") || String(provider).includes("xmr"));
  const prefix = body.prefix || ((npStatus || req.isNowPaymentsIpn || String(provider).includes("nowpayments")) ? "R34H" : isCrypto ? "R34H" : String(provider).includes("patreon") ? "PATREON" : "SHOP2");

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

  let orderRecord = existingOrderId
    ? (monDb.orders || []).find(o => o.orderId === existingOrderId || o.sessionId === existingOrderId)
    : null;
  if (orderRecord) {
    orderRecord.provider = provider || orderRecord.provider;
    orderRecord.event = event;
    orderRecord.email = licenseRecord.email;
    orderRecord.plan = chosen.tier;
    orderRecord.planName = chosen.name;
    orderRecord.amountEur = finalPrice;
    orderRecord.licenseKey = licenseKey;
    orderRecord.status = "paid";
    orderRecord.paidAt = now.toISOString();
  } else {
    orderRecord = {
      orderId: existingOrderId || `ord_${crypto.randomBytes(4).toString("hex")}`,
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
  }
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
}
app.post("/api/webhooks/payment", handlePaymentWebhook);

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
  const aads = (monDb.adNetworks && monDb.adNetworks.aads) || (monDb.adsConfig && monDb.adsConfig.aads) || {
    enabled: true,
    unitId: "2460259",
    iframeUrl: "https://acceptable.a-ads.com/2460259",
    status: "live"
  };
  const exoclick = (monDb.adNetworks && monDb.adNetworks.exoclick) || (monDb.adsConfig && monDb.adsConfig.exoclick) || {
    enabled: true,
    siteId: "1117429",
    zoneId: "6068261",
    iframeUrl: "https://syndication.exdynsrv.com/ads-iframe-display.php?idzone=6068261&output=noscript&type=300x250",
    status: "verified_live"
  };
  res.json({
    ok: true,
    adNetworks: { aads, exoclick },
    adsConfig: Object.assign({}, monDb.adsConfig, { aads, exoclick })
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

function adminUpdateConfigHandler(req, res) {
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
    const { cryptoWallets, ...restPayment } = body.paymentConfig;
    Object.assign(monDb.paymentConfig, restPayment);
    if (cryptoWallets && typeof cryptoWallets === "object") {
      monDb.paymentConfig.cryptoWallets = Object.assign({}, monDb.paymentConfig.cryptoWallets || {}, cryptoWallets);
      if (cryptoWallets.USDT_TRC20 || cryptoWallets.usdt_trc20) {
        const w = cryptoWallets.USDT_TRC20 || cryptoWallets.usdt_trc20;
        monDb.paymentConfig.cryptoWallets.USDT_TRC20 = w;
        monDb.paymentConfig.cryptoWallets.usdt_trc20 = w;
        monDb.paymentConfig.cryptoWallets.TRX = cryptoWallets.TRX || w;
        monDb.paymentConfig.cryptoWallets.trx = cryptoWallets.trx || w;
        monDb.gateways = monDb.gateways || {};
        monDb.gateways.nowpayments = Object.assign({}, monDb.gateways.nowpayments || {}, { payoutWallet: w, payoutNetwork: "USDTTRC20" });
        monDb.adNetworks = monDb.adNetworks || {};
        monDb.adNetworks.aads = Object.assign({}, monDb.adNetworks.aads || {}, { payoutWallet: w, payoutNetwork: "USDTTRC20" });
      }
    }
  }
  if (body.cryptoWallets && typeof body.cryptoWallets === "object") {
    monDb.paymentConfig.cryptoWallets = Object.assign({}, monDb.paymentConfig.cryptoWallets || {}, body.cryptoWallets);
  }
  if (body.gateways && typeof body.gateways === "object") {
    monDb.gateways = Object.assign({}, monDb.gateways || {}, body.gateways);
  }
  if (body.adNetworks && typeof body.adNetworks === "object") {
    monDb.adNetworks = Object.assign({}, monDb.adNetworks || {}, body.adNetworks);
  }

  saveMonetizationDb(monDb);
  res.json({
    ok: true,
    adNetworks: monDb.adNetworks || { aads: { enabled: true, unitId: "2460259", iframeUrl: "https://acceptable.a-ads.com/2460259", status: "live", payoutWallet: "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX", payoutNetwork: "USDTTRC20" } },
    gateways: monDb.gateways,
    adsConfig: monDb.adsConfig,
    paymentConfig: paymentConfigForAdmin(monDb.paymentConfig, monDb)
  });
}
app.post("/api/admin/ads/update", adminUpdateConfigHandler);
app.post("/api/admin/config", adminUpdateConfigHandler);

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
    paymentConfig: paymentConfigForAdmin(monDb.paymentConfig, monDb),
    gateways: { nowpayments: { status: getNowPaymentsCredentials(monDb).status, accountEmail: getNowPaymentsCredentials(monDb).accountEmail, connected: Boolean(getNowPaymentsCredentials(monDb).apiKey), ipnCallbackUrl: "https://r34hub-five.vercel.app/api/webhooks/payment" } },
    adsConfig: monDb.adsConfig,
    licenses: monDb.licenses,
    orders: monDb.orders
  });
});



// Stripe Official Checkout Session API + Stripe Webhook + Decoy Bridge
app.post("/api/stripe/create-checkout-session", async (req, res) => {
  monDb = loadMonetizationDb();
  const body = req.body || {};
  const plan = body.plan || "annual";
  const email = String(body.email || "").trim() || "buyer@r34hub.app";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host") || "r34hub-five.vercel.app";
  const origin = `${proto}://${host}`;

  const planLookup = {
    monthly: { id: "monthly", name: "HubCloud Monthly Pro (30 Days)", tier: "monthly", amountEur: 7.00, amountUsd: 7.50, days: 30, mode: "subscription" },
    yearly: { id: "annual", name: "HubCloud Annual Pro (365 Days)", tier: "annual", amountEur: 59.99, amountUsd: 64.99, days: 365, mode: "payment" },
    annual: { id: "annual", name: "HubCloud Annual Pro (365 Days)", tier: "annual", amountEur: 59.99, amountUsd: 64.99, days: 365, mode: "payment" },
    "30days": { id: "30d_pass", name: "HubCloud 30-Day Pass", tier: "monthly", amountEur: 12.99, amountUsd: 13.99, days: 30, mode: "payment" },
    "30d_pass": { id: "30d_pass", name: "HubCloud 30-Day Pass", tier: "monthly", amountEur: 12.99, amountUsd: 13.99, days: 30, mode: "payment" },
    lifetime: { id: "lifetime", name: "HubCloud Lifetime VIP Master Pass", tier: "lifetime", amountEur: 199.99, amountUsd: 214.99, days: 36500, mode: "payment" }
  };
  const selected = planLookup[plan] || planLookup.annual;
  const orderId = `ord_${crypto.randomBytes(5).toString("hex")}`;
  const now = new Date();
  const pc = monDb.paymentConfig || {};
  const wallets = pc.cryptoWallets || {};
  const liveUsdtWallet = wallets.USDT_TRC20 || wallets.usdt_trc20 || "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX";

  const cardToCryptoUrls = {
    guardarian: `https://guardarian.com/calculator?from_currency=EUR&to_currency=USDT&to_network=TRX&from_amount=${encodeURIComponent(selected.amountEur)}&payout_address=${encodeURIComponent(liveUsdtWallet)}`,
    mercuryo: `https://exchange.mercuryo.io/?fiat_currency=EUR&fiat_amount=${encodeURIComponent(selected.amountEur)}&currency=USDT&network=TRON&address=${encodeURIComponent(liveUsdtWallet)}`,
    changenow: `https://changenow.io/?from=eur&to=usdttrc20&fiatMode=true&amount=${encodeURIComponent(selected.amountEur)}&recipient=${encodeURIComponent(liveUsdtWallet)}`
  };

  const st = getStripeCredentials(monDb);
  let stripeSessionUrl = "";
  let stripeSessionId = "";
  let stripeMode = "stripe_bridge";
  let stripeError = null;

  // 1. If a real Stripe Secret Key (sk_live_... or sk_test_...) is configured, create an official Stripe Checkout Session via Stripe REST API
  if (st.secretKey && /^sk_(live|test)_/i.test(st.secretKey)) {
    try {
      const form = new URLSearchParams();
      form.set("mode", selected.mode);
      form.set("client_reference_id", orderId);
      if (email && email.includes("@") && email !== "buyer@r34hub.app") {
        form.set("customer_email", email);
      }
      form.set("success_url", `${origin}/ru/premium?order=${encodeURIComponent(orderId)}&status=paid&session_id={CHECKOUT_SESSION_ID}`);
      form.set("cancel_url", `${origin}/ru/premium?plan=${encodeURIComponent(selected.id)}`);
      form.set("line_items[0][quantity]", "1");
      form.set("line_items[0][price_data][currency]", "eur");
      form.set("line_items[0][price_data][unit_amount]", String(Math.round(selected.amountEur * 100)));
      form.set("line_items[0][price_data][product_data][name]", selected.name);
      form.set("line_items[0][price_data][product_data][description]", "Cloud Indexing, Sync & Ad-Free Pro License Key (Up to 5 Devices)");
      if (selected.mode === "subscription") {
        form.set("line_items[0][price_data][recurring][interval]", "month");
      }
      form.set("metadata[orderId]", orderId);
      form.set("metadata[plan]", selected.id);
      form.set("metadata[email]", email);

      const stRes = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${st.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      }, 8000);
      const stData = await stRes.json().catch(() => ({}));
      if (stRes.ok && stData && stData.url) {
        stripeSessionUrl = stData.url;
        stripeSessionId = stData.id;
        stripeMode = "stripe_checkout_live";
      } else {
        stripeError = (stData && stData.error && stData.error.message) || `Stripe HTTP ${stRes.status}`;
      }
    } catch (err) {
      stripeError = err.message || "Stripe session request failed";
    }
  }

  // 2. If custom Stripe Payment Link is configured in Admin (and not placeholder), use it
  if (!stripeSessionUrl) {
    const customLink = selected.id === "monthly" ? pc.stripeMonthlyUrl : selected.id === "annual" ? pc.stripeAnnualUrl : "";
    if (customLink && customLink.startsWith("https://buy.stripe.com/") && !customLink.includes("r34hub_hubcloud_")) {
      const sep = customLink.includes("?") ? "&" : "?";
      stripeSessionUrl = `${customLink}${sep}client_reference_id=${encodeURIComponent(orderId)}&prefilled_email=${encodeURIComponent(email)}`;
      stripeMode = "stripe_payment_link";
    }
  }

  const orderRecord = {
    orderId,
    sessionId: stripeSessionId || orderId,
    provider: stripeMode,
    event: "stripe.checkout.created",
    email,
    plan: selected.id,
    tier: selected.tier,
    planName: selected.name,
    amountEur: selected.amountEur,
    amountUsd: selected.amountUsd,
    currency: "EUR",
    walletAddress: liveUsdtWallet,
    licenseKey: null,
    status: "pending_payment",
    stripeSessionUrl: stripeSessionUrl || null,
    cardCheckoutUrl: cardToCryptoUrls.guardarian,
    cardToCryptoUrls,
    createdAt: now.toISOString()
  };

  monDb.orders = monDb.orders || [];
  monDb.orders.unshift(orderRecord);
  saveMonetizationDb(monDb);

  res.json({
    ok: true,
    orderId,
    sessionId: stripeSessionId || orderId,
    mode: stripeMode,
    plan: selected.id,
    planName: selected.name,
    amountEur: selected.amountEur,
    currency: "EUR",
    checkoutUrl: stripeSessionUrl || cardToCryptoUrls.guardarian,
    stripeSessionUrl: stripeSessionUrl || null,
    cardCheckoutUrl: cardToCryptoUrls.guardarian,
    cardToCryptoUrls,
    stripeError,
    statusUrl: `/api/hubcloud/order-status?orderId=${encodeURIComponent(orderId)}`
  });
});

app.post("/api/webhooks/stripe", (req, res) => {
  monDb = loadMonetizationDb();
  const body = req.body || {};
  const eventType = body.type || body.event || "checkout.session.completed";
  const obj = (body.data && body.data.object) || body;
  const orderId = obj.client_reference_id || (obj.metadata && obj.metadata.orderId) || body.orderId || "";
  const plan = (obj.metadata && obj.metadata.plan) || body.plan || "annual";
  const email = (obj.customer_details && obj.customer_details.email) || obj.customer_email || (obj.metadata && obj.metadata.email) || body.email || "buyer@r34hub.app";
  const amountEur = obj.amount_total ? Number((obj.amount_total / 100).toFixed(2)) : body.amountEur;

  // Verify either webhook secret or Stripe signature if webhookSecret is set
  const st = getStripeCredentials(monDb);
  const sentSecret = String(req.get("x-webhook-secret") || req.query.secret || body.secret || "").trim();
  const expectedAdminSecret = process.env.R34HUB_WEBHOOK_SECRET || (monDb.owner && monDb.owner.webhookSecret) || "";
  if (!st.webhookSecret && !secretMatches(sentSecret, expectedAdminSecret)) {
    return res.status(401).json({ ok: false, error: "Webhook secret required" });
  }

  if (eventType !== "checkout.session.completed" && eventType !== "invoice.paid") {
    return res.json({ ok: true, ignored: true, type: eventType });
  }

  req.body = {
    orderId,
    provider: "stripe_checkout",
    event: eventType,
    plan,
    email,
    amountEur,
    prefix: "SHOP2",
    secret: expectedAdminSecret
  };
  return handlePaymentWebhook(req, res);
});

// 4. HubCloud Storefront Public Config, Live Order Creation & Order Status Polling
app.get("/api/hubcloud/config", (req, res) => {
  monDb = loadMonetizationDb();
  const pc = monDb.paymentConfig || {};
  const np = getNowPaymentsCredentials(monDb);
  res.json({
    ok: true,
    brand: pc.decoyBrandName || "HubCloud.dev",
    tagline: pc.decoyTagline || "Cloud Media Indexing & Discord/Telegram Role Sync Engine",
    descriptor: pc.stripeDescriptor || "HUBCLOUD.DEV * CLOUD SYNC",
    currency: pc.currency || "EUR",
    cryptoDiscountPercent: pc.cryptoDiscountPercent || 20,
    nowPayments: {
      connected: Boolean(np.apiKey),
      status: np.status
    },
    checkoutLinks: {
      stripeMonthlyUrl: pc.stripeMonthlyUrl || "",
      stripeAnnualUrl: pc.stripeAnnualUrl || "",
      ghostPortalUrl: pc.ghostPortalUrl || "",
      sellApp30dUrl: pc.sellApp30dUrl || "",
      sellAppLifetimeUrl: pc.sellAppLifetimeUrl || "",
      nowPaymentsUrl: pc.nowPaymentsUrl || ""
    },
    cryptoWallets: Object.assign({ USDT_TRC20: "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX", usdt_trc20: "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX", TRX: "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX", trx: "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX" }, pc.cryptoWallets || {}),
    gateways: { nowpayments: { status: np.status, connected: Boolean(np.apiKey), payoutWallet: (monDb.gateways && monDb.gateways.nowpayments && monDb.gateways.nowpayments.payoutWallet) || "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX", network: "USDTTRC20" } },
    adNetworks: monDb.adNetworks || { aads: { enabled: true, unitId: "2460259", payoutWallet: "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX", network: "USDTTRC20" } },
    plans: pc.plans || {}
  });
});

async function createHubCloudOrderHandler(req, res) {
  monDb = loadMonetizationDb();
  const body = req.body || {};
  const plan = body.plan || "annual";
  const provider = body.provider || body.paymentMethod || "nowpayments";
  const email = String(body.email || "").trim() || "buyer@r34hub.app";
  const cryptoCurrency = String(body.cryptoCurrency || "USDT_TRC20").toUpperCase();
  const txHash = String(body.txHash || "").trim();

  const planLookup = {
    monthly: { id: "monthly", name: "Monthly Pro", tier: "monthly", amountEur: 7.00, amountUsd: 7.50, days: 30 },
    yearly: { id: "annual", name: "Annual Pro (€4.97/mo)", tier: "annual", amountEur: 59.99, amountUsd: 64.99, days: 365 },
    annual: { id: "annual", name: "Annual Pro (€4.97/mo)", tier: "annual", amountEur: 59.99, amountUsd: 64.99, days: 365 },
    "30days": { id: "30d_pass", name: "30-Day One-Time Pass", tier: "monthly", amountEur: 12.99, amountUsd: 13.99, days: 30 },
    "30d_pass": { id: "30d_pass", name: "30-Day One-Time Pass", tier: "monthly", amountEur: 12.99, amountUsd: 13.99, days: 30 },
    lifetime: { id: "lifetime", name: "Lifetime VIP Master Pass", tier: "lifetime", amountEur: 199.99, amountUsd: 214.99, days: 36500 }
  };
  const selected = planLookup[plan] || planLookup.annual;
  const isCrypto = String(provider).includes("crypto") || String(provider).includes("nowpayments") || ["USDT_TRC20", "BTC", "SOL", "ETH", "TON", "XMR"].includes(String(provider).toUpperCase());
  const finalAmountEur = isCrypto ? Number((selected.amountEur * 0.8).toFixed(2)) : selected.amountEur;
  const finalAmountUsd = isCrypto ? Number((selected.amountUsd * 0.8).toFixed(2)) : selected.amountUsd;
  const orderId = `ord_${crypto.randomBytes(5).toString("hex")}`;
  const now = new Date();

  const pc = monDb.paymentConfig || {};
  const wallets = pc.cryptoWallets || {};
  const walletAddress = wallets[cryptoCurrency] || wallets[cryptoCurrency.toLowerCase()] || wallets.USDT_TRC20 || wallets.usdt_trc20 || "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX";

  const liveUsdtWallet = wallets.USDT_TRC20 || wallets.usdt_trc20 || "TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX";
  const cardToCryptoUrls = {
    changenow: `https://changenow.io/?from=eur&to=usdttrc20&fiatMode=true&amount=${encodeURIComponent(selected.amountEur)}&recipient=${encodeURIComponent(liveUsdtWallet)}`,
    guardarian: `https://guardarian.com/calculator?from_currency=EUR&to_currency=USDT&to_network=TRX&from_amount=${encodeURIComponent(selected.amountEur)}&payout_address=${encodeURIComponent(liveUsdtWallet)}`,
    mercuryo: `https://exchange.mercuryo.io/?fiat_currency=EUR&fiat_amount=${encodeURIComponent(selected.amountEur)}&currency=USDT&network=TRON&address=${encodeURIComponent(liveUsdtWallet)}`
  };

  let externalCheckoutUrl = "";
  let invoiceUrl = "";
  let nowPaymentsInvoice = null;
  let nowPaymentsError = null;

  // Always create a live NOWPayments invoice (supports both Direct Crypto and Fiat-to-Crypto On-Ramp)
  const np = getNowPaymentsCredentials(monDb);
  if (np.apiKey) {
    try {
      const npRes = await fetchWithTimeout("https://api.nowpayments.io/v1/invoice", {
        method: "POST",
        headers: {
          "x-api-key": np.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          price_amount: finalAmountUsd,
          price_currency: "usd",
          order_id: orderId,
          order_description: `HubCloud.dev — ${selected.name} (${selected.days} Days Cloud Sync & Pro Key)`,
          ipn_callback_url: "https://r34hub-five.vercel.app/api/webhooks/payment",
          success_url: `https://r34hub-five.vercel.app/hubcloud?order=${encodeURIComponent(orderId)}&status=paid`,
          cancel_url: "https://r34hub-five.vercel.app/hubcloud"
        })
      }, 8000);
      const npData = await npRes.json().catch(() => ({}));
      if (npRes.ok && npData && npData.invoice_url) {
        invoiceUrl = npData.invoice_url;
        nowPaymentsInvoice = {
          id: npData.id,
          invoice_url: npData.invoice_url,
          price_amount: npData.price_amount,
          price_currency: npData.price_currency,
          created_at: npData.created_at
        };
      } else {
        nowPaymentsError = (npData && (npData.message || npData.error)) || `NOWPayments HTTP ${npRes.status}`;
      }
    } catch (err) {
      nowPaymentsError = err.message || "NOWPayments invoice request failed";
    }
  }

  if (isCrypto) {
    externalCheckoutUrl = invoiceUrl || pc.nowPaymentsUrl || pc.sellAppLifetimeUrl || "";
  } else {
    // For Card / EUR: provide direct 1-click Card-to-USDT checkout (lands directly in TMiHAtZYNFHgMyfHWoZm2udW5s3oTg6ffX) AND NOWPayments invoice
    externalCheckoutUrl = cardToCryptoUrls.changenow;
  }

  const orderRecord = {
    orderId,
    sessionId: orderId,
    provider: isCrypto ? (invoiceUrl ? "nowpayments_live" : `crypto_${cryptoCurrency.toLowerCase()}`) : provider,
    event: "order.created",
    email,
    plan: selected.id,
    tier: selected.tier,
    planName: selected.name,
    amountEur: finalAmountEur,
    amountUsd: finalAmountUsd,
    currency: isCrypto ? `USD (${finalAmountUsd}) / EUR (€${finalAmountEur})` : "EUR",
    cryptoCurrency: isCrypto ? cryptoCurrency : null,
    walletAddress: isCrypto ? walletAddress : null,
    txHash: txHash || null,
    licenseKey: null,
    status: txHash ? "verifying_tx" : "pending_payment",
    invoice_url: invoiceUrl || null,
    nowPaymentsInvoiceId: nowPaymentsInvoice ? nowPaymentsInvoice.id : null,
    nowPaymentsError,
    externalCheckoutUrl,
    createdAt: now.toISOString()
  };

  monDb.orders = monDb.orders || [];
  monDb.orders.unshift(orderRecord);
  saveMonetizationDb(monDb);

  res.json({
    ok: true,
    orderId,
    sessionId: orderId,
    order: orderRecord,
    provider: orderRecord.provider,
    plan: selected.id,
    planName: selected.name,
    tier: selected.tier,
    email,
    amountEur: finalAmountEur,
    price_amount: finalAmountUsd,
    price_currency: "usd",
    currency: "EUR",
    cryptoCurrency: orderRecord.cryptoCurrency,
    walletAddress: orderRecord.walletAddress,
    cryptoDiscountApplied: isCrypto ? "20% OFF" : null,
    statementDescriptor: pc.stripeDescriptor || "HUBCLOUD.DEV * CLOUD SYNC",
    invoice_url: invoiceUrl || externalCheckoutUrl || null,
    nowPaymentsInvoice,
    nowPaymentsError,
    externalCheckoutUrl,
    cardCheckoutUrl: cardToCryptoUrls.changenow,
    cardToCryptoUrls,
    statusUrl: `/api/hubcloud/order-status?orderId=${encodeURIComponent(orderId)}`,
    checkoutUrl: invoiceUrl || `/hubcloud?orderId=${encodeURIComponent(orderId)}&plan=${encodeURIComponent(selected.id)}&provider=${encodeURIComponent(provider)}&email=${encodeURIComponent(email)}`
  });
}

app.post("/api/hubcloud/create-order", createHubCloudOrderHandler);
app.post("/api/hubcloud/checkout", createHubCloudOrderHandler);
app.post("/api/checkout/create", createHubCloudOrderHandler);

app.get("/api/hubcloud/order-status", (req, res) => {
  monDb = loadMonetizationDb();
  const orderId = String(req.query.orderId || req.query.order || req.query.session || "").trim();
  if (!orderId) return res.status(400).json({ ok: false, error: "Missing orderId parameter" });
  const order = (monDb.orders || []).find(o => o.orderId === orderId || o.sessionId === orderId);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found" });
  res.json({
    ok: true,
    orderId: order.orderId,
    status: order.status,
    plan: order.plan,
    planName: order.planName,
    amountEur: order.amountEur,
    amountUsd: order.amountUsd,
    currency: order.currency,
    email: order.email,
    invoice_url: order.invoice_url || order.externalCheckoutUrl || null,
    licenseKey: order.licenseKey || null,
    createdAt: order.createdAt
  });
});

app.post("/api/hubcloud/submit-tx", (req, res) => {
  monDb = loadMonetizationDb();
  const { orderId = "", txHash = "", email = "" } = req.body || {};
  const order = (monDb.orders || []).find(o => o.orderId === orderId || o.sessionId === orderId);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found" });
  if (txHash) order.txHash = String(txHash).trim();
  if (email) order.email = String(email).trim();
  order.status = "verifying_tx";
  order.updatedAt = new Date().toISOString();
  saveMonetizationDb(monDb);
  res.json({ ok: true, order });
});

// 5. Production SEO Endpoints (/robots.txt, /sitemap.xml & IndexNow verification)
app.get("/6d05d9a7540ffc84889838dd34fd8554.html", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.status(200).send("6d05d9a7540ffc84889838dd34fd8554");
});

app.get("/r34hub9f4a8821emil2026.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send("r34hub9f4a8821emil2026");
});

app.get("/robots.txt", (req, res) => {
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host") || "r34hub-five.vercel.app";
  const baseUrl = `${proto}://${host}`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send([
    "User-agent: *",
    "Allow: /",
    "Allow: /posts/",
    "Allow: /grid/",
    "Allow: /hubcloud",
    "Disallow: /api/admin/",
    "",
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join("\n") + "\n");
});

app.get("/sitemap.xml", (req, res) => {
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host") || "r34hub-five.vercel.app";
  const baseUrl = `${proto}://${host}`;
  const today = new Date().toISOString().slice(0, 10);

  const coreRoutes = [
    { path: "/", priority: "1.0", changefreq: "hourly" },
    { path: "/posts/rule34.xxx", priority: "0.95", changefreq: "hourly" },
    { path: "/grid/rule34.xxx", priority: "0.95", changefreq: "hourly" },
    { path: "/posts/danbooru", priority: "0.9", changefreq: "hourly" },
    { path: "/grid/danbooru", priority: "0.9", changefreq: "hourly" },
    { path: "/posts/e621", priority: "0.9", changefreq: "hourly" },
    { path: "/grid/e621", priority: "0.9", changefreq: "hourly" },
    { path: "/posts/yandere", priority: "0.85", changefreq: "daily" },
    { path: "/grid/yandere", priority: "0.85", changefreq: "daily" },
    { path: "/posts/paheal", priority: "0.85", changefreq: "hourly" },
    { path: "/grid/paheal", priority: "0.85", changefreq: "hourly" },
    { path: "/posts/safebooru", priority: "0.8", changefreq: "daily" },
    { path: "/posts/konachan", priority: "0.8", changefreq: "daily" },
    { path: "/posts/sakugabooru", priority: "0.8", changefreq: "daily" },
    { path: "/saved", priority: "0.7", changefreq: "weekly" },
    { path: "/settings", priority: "0.6", changefreq: "monthly" },
    { path: "/ru/premium", priority: "0.9", changefreq: "weekly" },
    { path: "/premium", priority: "0.9", changefreq: "weekly" },
    { path: "/hubcloud", priority: "0.85", changefreq: "weekly" }
  ];

  const seoTags = [
    "genshin_impact",
    "blue_archive",
    "hololive",
    "zenless_zone_zero",
    "honkai:_star_rail",
    "frieren",
    "overwatch",
    "cyberpunk",
    "animated",
    "1girl",
    "naruto",
    "one_piece",
    "elden_ring",
    "nier:_automata",
    "pokemon",
    "league_of_legends",
    "valorant",
    "chainsaw_man",
    "jujutsu_kaisen",
    "street_fighter"
  ];

  const urls = [];
  coreRoutes.forEach(r => {
    urls.push(`  <url>
    <loc>${baseUrl}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`);
  });

  seoTags.forEach(tag => {
    const enc = encodeURIComponent(tag);
    urls.push(`  <url>
    <loc>${baseUrl}/posts/rule34.xxx?tags=${enc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.85</priority>
  </url>`);
    urls.push(`  <url>
    <loc>${baseUrl}/grid/rule34.xxx?tags=${enc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.85</priority>
  </url>`);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

// HTML Page Routes for /admin, /hubcloud, and /posts/*
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get(["/hubcloud", "/premium", "/ru/premium", "/en/premium"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hubcloud.html"));
});

function sendIndex(_req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
}

app.get("/posts/:source", sendIndex);
app.get(["/posts", "/reels", "/grid", "/grid/:source", "/saved", "/settings"], sendIndex);

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
