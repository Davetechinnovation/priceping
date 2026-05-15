# PricePing — Complete Bot Reference
Nigerian financial WhatsApp bot. AI-powered analyst + alert system.

## Commands (syntax → action)
| Syntax | Action |
|---|---|
| `Price BTC` | Live price (crypto/forex/NGX/US/commodity/futures/synthetic) |
| `Set ETH at 3000 above` | Alert when ETH ≥3000 (default direction: below) |
| `Set BTC 5% move` | Two-way volatility alert (upper + lower bounds) |
| `Alerts` / `My alerts` | List all alerts with #IDs, quota |
| `Delete 1` / `Delete 1 3` / `Delete all` | Remove by #ID (no quota refund) |
| `Watch TSLA` | Passive tracking (no trigger, view via `Watchlist`) |
| `Analyze SOL` | AI TA: RSI, MACD, EMA50/200, Bollinger, signals |
| `News AAPL` | AI-summarized top headlines |
| `Portfolio` | Pro: holdings → live PnL + AI comment |
| `Bought 2 ETH at 2600` | Pro: log buy → track unrealised PnL |
| `Sold ETH` / `Sold ETH at 3000` | Pro: close trade → win rate calc + AI reaction |
| `Trades` | Pro: open positions + recent closed |
| `Invite` | Get 6-digit referral code |
| `Redeem XYZ123` | Use friend's code → referrer gets +1 slot (max +3) |
| `Subscribe` | Free vs Pro comparison + current usage |
| `Upgrade` | Pro pricing (₦2,000/mo) + Paystack payment link |
| `Features` | Full capability listing |
| `Menu` / `Help` | Quick command reference + quota |
| `Name Sarah` | Set display name |
| `Status` | Bot uptime + user stats |

## Markets Supported
- **Crypto**: All CoinGecko coins (24/7)
- **Forex**: EURUSD, GBPUSD, USDJPY, USDNGN, all majors (24/5)
- **US Stocks**: NYSE/NASDAQ via Yahoo Finance (market hours)
- **NGX Stocks**: ZENITHBANK, MTNN, DANGCEM, GTCO, UBA, FBNH, etc. (09:30-14:30 WAT)
- **Commodities**: Gold (GC=F), Silver (SI=F), Crude (CL=F) via Yahoo
- **Futures/Perps**: Crypto perps (BTC perp) + traditional (S&P500 futures, Cocoa futures, Gold futures) via Yahoo search
- **Synthetics** (Deriv): V75, V100, BOOM1000/500/300, CRASH1000/500/300, JD10/25/50/100, RB100/200, STEP

## Tier Comparison
| Feature | Free | Pro (₦2,000/mo) |
|---|---|---|
| Alert quota | 3 per 12h | Unlimited |
| Price checks | ✅ | ✅ |
| Watchlist | 10 assets | Unlimited |
| AI Analysis | ❌ | ✅ Full TA |
| Portfolio + Trade Journal | ❌ | ✅ |
| SMS alerts | ❌ | ✅ |
| Daily brief (8AM) | Teaser only | Full |
| Move Detector | ❌ | Pro users notified |

## Alert System Rules
- Direction: `above` (price rises to target) or `below` (falls to target)
- Percent mode: `Set BTC 5% move` → auto-calculates upper = price × (1 + pct/100), lower = price × (1 − pct/100), both directions
- Delete does NOT refund quota. Alert IDs are permanent (never reused).
- Quota resets every 12h from first use. Pro = no limits.
- Free users get +1 slot per referral (max +3 total = 6 per 12h)
- Multi-asset: `Set alert for all of them` → AI creates one command per asset from lastAssets context

## Referral Program
- `Invite` → 6-digit code. Share it.
- `Redeem [CODE]` → referrer gets +1 bonus alert slot
- Max bonus: +3 slots (total 6/12h for free users)
- Cannot self-refer or redeem multiple codes

## Special AI Behaviors
1. **Math mode** (2-step): User gives formula → AI calculates → outputs `[{"command":"chat","args":["I calculated $X. Set alert for ASSET at $X?"]}]`. User confirms (yes/ok/sure/go ahead/correct) → AI immediately outputs set command. NO re-calculation on confirm.
2. **Context memory**: Last 5 user messages + last 5 assets tracked. Generic words (it/that/this/me/my/an/a) replaced with last asset. New assets prepended to front.
3. **Multi-asset**: If user says "all of them"/"the three" → generate command for EACH asset in lastAssets array.
4. **Tone**: Professional financial AI. Max 40 words per chat. Never repeat user's question. 1-2 emojis. Confident, direct, no fluff.
5. **Regex gating**: Direct commands (price/alerts/del/set at percent/analyze/news/status/subscribe/upgrade/features/trades/portfolio) parsed locally with zero tokens. Only ambiguous/natural language hits the AI.

## Scheduled Jobs
- Alerts check: crypto/forex every 30s, NGX every 5min (market hours), US stocks cache warm every 2min
- Daily Brief: 8:00 AM WAT (07:00 UTC) — full AI insight for Pro, teaser for Free
- Move Detector: every 15min — checks BTC/ETH/SOL/BNB/XRP/ADA/DOGE for 5% move in 60min → notifies interested Pro users
- Price history snapshot: every 5min for all active alert assets