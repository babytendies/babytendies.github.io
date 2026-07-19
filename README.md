# Baby Tendies — website

Static site for **Baby Tendies** (BabyTendies) on **RobinhoodChain**.
Hold BabyTendies → a 3% tax feeds the tray → holders get auto-fed real **$TENDIES**.

## Files
- `index.html` — page structure & content
- `styles.css` — retro Breaking-News theme: teal + red + gold + cream (Anton + Nunito), fully responsive
- `app.js` — live reward-contract reads, $TENDIES pricing via DexScreener, wallet checker
- `media/` — logo.png (badge), banner.jpg (news banner), RobinhoodChain icon, `og-image.jpg` (1200x630 social preview)

## ⚙️ Before going live — set your values
Open **`app.js`** and edit the `CONFIG` block:

```js
const CONFIG = {
  RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
  DISTRIBUTOR_ADDRESS: "0x...",   // 🔴 your deployed Baby Tendies reward distributor
  REWARD_TOKEN: "0x45242320DBB855EeA8Fd36804C6487E10E97FCF9", // $TENDIES (already set)
  REWARD_DECIMALS: 18,
  REWARD_SYMBOL: "$TENDIES",
  REFRESH_MS: 45000,
};
```
Also set the **BabyTendies token address** in `index.html` (the `<code id="contractAddr">` line in the Tokenomics section).

Until a real (non-zero) `DISTRIBUTOR_ADDRESS` is set, the Tendie Tracker shows
"Not deployed yet" and the checker is disabled — no errors, layout intact.
The **$TENDIES price still shows live** from DexScreener regardless.

## What it reads
**Tendie Tracker (dashboard)** — live from the reward distributor:
| Stat | Source |
|------|--------|
| Total $TENDIES fed to holders | `totalDistributed()` |
| On the tray (pending pool) | `totalDividends() − totalDistributed()` |
| Total committed rewards | `totalDividends()` |
| Fed holders | `shareholderCount()` |
| Min. feed interval | `minPeriod()` |
| $TENDIES price + 24h change | DexScreener API (deepest-liquidity pair) |

**My Tendies (checker)** reads `shares(addr).totalRealised` (received),
`getUnpaidEarnings(addr)` (pending), `shares(addr).amount` (eligible balance),
`getLastClaimTime(addr)`. All amounts shown in $TENDIES and USD.

## 🔗 Social preview
Full Open Graph + Twitter card tags are in `<head>`; `media/og-image.jpg` is a
1200x630 preview built from the banner. **Replace `YOUR-DOMAIN.com`** in the
`og:*`, `twitter:image`, and `canonical` tags with your live domain (crawlers
need an absolute URL). Regenerate the image after a banner change:
```bash
convert -size 1200x630 xc:'#035a76' \
  \( media/banner.jpg -resize 1200x \) -gravity center -composite \
  -quality 88 media/og-image.jpg
```

## Run locally
```bash
python3 -m http.server 8080   # then open http://localhost:8080
```
Deploy the folder to any static host. Needs browser access to the RobinhoodChain
RPC and the DexScreener API.

> Note: $TENDIES is a separate third-party token used only as the reward asset.
