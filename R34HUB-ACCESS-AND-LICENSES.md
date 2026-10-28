# R34Hub (`r34hub.app`) & HubCloud (`hubcloud.dev`) — Master Access, Licensing & Monetization Credentials

**Owner Email:** `emildv.work@gmail.com`  
**Admin Control Center:** `/admin`  
**Decoy SFW Billing Storefront (`HubCloud.dev`):** `/hubcloud`  
**Main In-Place Feed (`R34Hub.app`):** `/` (`/posts/rule34.xxx?filter[sort]=score`)  

---

## 1. Master Admin & Webhook Credentials

| Parameter | Value |
| :--- | :--- |
| **Owner Account Email** | `emildv.work@gmail.com` |
| **Admin Master Token** | `R34HUB-ADMIN-9F4A8821-EMIL` |
| **Webhook Signing Secret (`WEBHOOK_SECRET`)** | `whsec_r34hub_live_8f92a4c7e1b093d6f5a2c8e4` |
| **Stripe / Sell.app / Crypto Webhook Endpoint** | `POST /api/webhooks/payment` |
| **Checkout Session Creator Endpoint** | `POST /api/checkout/create` |
| **License Activation Endpoint** | `POST /api/licenses/activate` |
| **License Verification Endpoint** | `GET /api/licenses/verify?key=SHOP2-...` |
| **Admin Bulk Key Generator (1–50 keys)** | `POST /api/admin/licenses/generate` |
| **Admin Key Revoke / Restore** | `POST /api/admin/licenses/revoke` |
| **Live Ad & CPA Click Tracker** | `POST /api/ads/click` |
| **Persistent Database Path** | `/workspace/booru-pulse/data/monetization-db.json` |

---

## 2. Pre-Generated License Keys (15 Active Keys Ready for Immediate Use)

### A. 5 Lifetime Owner / VIP Master License Keys (€199.99 Tier — Never Expire, 5 Devices Each)
1. `SHOP2-OWNER-VIP-9F4A-8821` *(Primary Owner Master Key)*
2. `SHOP2-LIFETIME-PRO-7C2E-4190` *(Stripe / Ghost Pool)*
3. `PATREON-FOUNDER-VIP-3A8D-5512` *(Patreon VIP Bridge)*
4. `SLX-CRYPTO-LIFE-6B1F-9043` *(Sell.app / NowPayments Crypto Pool)*
5. `SHOP2-MASTER-ROOT-0E9D-7777` *(Root Reserve Master Key)*

### B. 5 Annual Pro License Keys (365 Days — €59.99/yr / €4.97/mo)
6. `SHOP2-ANNUAL-EUR-4D1A-2026`
7. `SHOP2-ANNUAL-EUR-8E3B-6419`
8. `SHOP2-ANNUAL-EUR-1F9C-3820`
9. `PATREON-ANNUAL-PRO-5A2D-7104`
10. `SLX-ANNUAL-XMR-9C4E-8291`

### C. 5 Monthly / 30-Day Pro License Keys (30 Days — €7.00/mo or €12.99 One-Time)
11. `SHOP2-MONTHLY-EUR-2B7F-1940`
12. `SHOP2-MONTHLY-EUR-6A3C-5082`
13. `SHOP2-MONTHLY-EUR-9E1D-4471`
14. `PATREON-MONTHLY-VIP-3D8A-6129`
15. `SLX-30DAYS-USDT-7F5B-3318`

---

## 3. Configured AI Companion CPA Offers & Display Ad Zones

### In-Post AI CPA Rotator (`PostChatWithAi` buttons on every post & lightbox)
- **Candy.ai:** `https://candy.ai/?aff=r34hub&subid={post_id}&char={character_tag}` (`$45–$65 CPA / 40% RevShare`)
- **CrushOn.ai:** `https://crushon.ai/?ref=r34hub&subid={post_id}` (`$35 CPA`)
- **SpicyChat.ai:** `https://spicychat.ai/?ref=r34hub&tag={character_tag}` (`$30 CPA`)
- **Nud3.me (AI Video Animator):** `https://nud3.me/animate?ref=r34hub&imageUrl={media_url}` (`$50 CPA / 35% RevShare`)

### Display & Native Ad Zones (Auto-Hidden When User Activates Any `SHOP2-` / `PATREON-` / `SLX-` Key)
- `zone_desktop_top` — ExoClick Zone `5489210` (`728×90 Leaderboard`)
- `zone_infeed_native` — ExoClick / CrakRevenue Zone `5489214` (`Native Masonry Card every 8 posts`)
- `zone_reels_slide` — TrafficJunky Zone `5489218` (`Every 6th vertical Reel swipe`)
- `zone_mobile_sticky` — ExoClick Zone `5489222` (`300×50 Mobile Bottom Banner`)
