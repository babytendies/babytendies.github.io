/* ============================================================
   BABY TENDIES · front-end logic
   Reads the reward DividendDistributor live from RobinhoodChain,
   pays holders in $TENDIES, prices it via DexScreener, and powers
   the wallet reward checker.
   ============================================================ */

/* ---------------------------------------------------------------
   CONFIG  ⚙️  change these to your real deployed values.
   --------------------------------------------------------------- */
const CONFIG = {
  RPC_URL: "https://rpc.mainnet.chain.robinhood.com",

  // 🔴 PLACEHOLDER: replace with the real Baby Tendies DividendDistributor address.
  DISTRIBUTOR_ADDRESS: "0x97164784b52fd5dEAc1b146BDaFB304434B691B3",

  // Reward token paid to holders: $TENDIES on RobinhoodChain (18 decimals).
  REWARD_TOKEN: "0x45242320DBB855EeA8Fd36804C6487E10E97FCF9",
  REWARD_DECIMALS: 18,
  REWARD_SYMBOL: "$TENDIES",

  // Auto-refresh interval (ms). 0 = off.
  REFRESH_MS: 45000,
};

/* Minimal ABI: only the read-only views the site needs. */
const DISTRIBUTOR_ABI = [
  "function totalDistributed() view returns (uint256)",
  "function totalDividends() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function shareholderCount() view returns (uint256)",
  "function minPeriod() view returns (uint256)",
  "function rewardThreshold() view returns (uint256)",
  "function getUnpaidEarnings(address) view returns (uint256)",
  "function getLastClaimTime(address) view returns (uint256)",
  "function shares(address) view returns (uint256 amount, uint256 totalExcluded, uint256 totalRealised)",
];

/* --------------------------- State --------------------------- */
let provider = null;
let distributor = null;
let tendiesUsd = 0;
let tendiesChange24 = null;
const isPlaceholder = /^0x0+$/.test(CONFIG.DISTRIBUTOR_ADDRESS);

/* --------------------------- Helpers --------------------------- */
const $ = (id) => document.getElementById(id);

function tokNumber(bnLike) {
  try { return Number(ethers.formatUnits(bnLike, CONFIG.REWARD_DECIMALS)); }
  catch { return 0; }
}

function fmtTok(bnLike) {
  const n = tokNumber(bnLike);
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 });
}

function fmtUsd(tokAmount) {
  if (!tendiesUsd || !tokAmount) return "≈ $0.00";
  const usd = tokAmount * tendiesUsd;
  return "≈ $" + usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: usd < 1000 ? 2 : 0 });
}

function fmtPrice(p) {
  if (!p) return "unavailable";
  if (p >= 1) return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  // small prices: show enough significant digits
  return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 4 });
}

function fmtInt(bnLike) { try { return Number(bnLike).toLocaleString(); } catch { return "0"; } }

function fmtDuration(seconds) {
  const s = Number(seconds);
  if (!s) return "Instant";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} hrs`;
  return `${(s / 86400).toFixed(1)} days`;
}

function timeAgo(tsSeconds) {
  const ts = Number(tsSeconds);
  if (!ts) return { abs: "Never", rel: "No feed yet" };
  const d = new Date(ts * 1000);
  const diff = Math.floor(Date.now() / 1000) - ts;
  let rel;
  if (diff < 60) rel = "just now";
  else if (diff < 3600) rel = `${Math.floor(diff / 60)} min ago`;
  else if (diff < 86400) rel = `${Math.floor(diff / 3600)} hrs ago`;
  else rel = `${Math.floor(diff / 86400)} days ago`;
  return { abs: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }), rel };
}

function setStatus(state, msg) {
  const dot = $("rpcDot");
  dot.className = "dot" + (state === "ok" ? " ok" : state === "err" ? " err" : "");
  $("rpcStatus").textContent = msg;
}

/* --------------------------- Price feed (DexScreener) --------------------------- */
async function loadTendiesPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CONFIG.REWARD_TOKEN}`, { cache: "no-store" });
    const data = await res.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    // pick the deepest-liquidity pair for the truest price
    let best = null;
    for (const p of pairs) {
      const liq = p?.liquidity?.usd || 0;
      if (!best || liq > (best?.liquidity?.usd || 0)) best = p;
    }
    if (best?.priceUsd) {
      tendiesUsd = Number(best.priceUsd);
      tendiesChange24 = (best.priceChange && typeof best.priceChange.h24 === "number") ? best.priceChange.h24 : null;
    }
  } catch { /* keep last known */ }

  const priceEl = $("statTendiesPrice");
  const changeEl = $("statTendiesChange");
  if (tendiesUsd) {
    priceEl.textContent = fmtPrice(tendiesUsd);
    if (tendiesChange24 !== null) {
      const up = tendiesChange24 >= 0;
      changeEl.textContent = `${up ? "▲" : "▼"} ${Math.abs(tendiesChange24).toFixed(2)}% (24h)`;
      changeEl.className = "vstat-sub " + (up ? "up" : "down");
    } else {
      changeEl.textContent = "Live from DexScreener";
    }
  } else {
    priceEl.textContent = "unavailable";
  }
}

/* --------------------------- Provider --------------------------- */
function initProvider() {
  provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  distributor = new ethers.Contract(CONFIG.DISTRIBUTOR_ADDRESS, DISTRIBUTOR_ABI, provider);
}

/* --------------------------- Dashboard --------------------------- */
async function loadDashboard() {
  if (isPlaceholder) {
    setStatus("err", "Reward contract not set yet. Add the distributor address in app.js to go live.");
    const awaiting = '<span class="await">Not deployed yet</span>';
    ["statTotalTok", "statPoolTok", "statCommittedTok", "statHolders", "statMinPeriod"].forEach((id) => {
      $(id).innerHTML = awaiting;
    });
    $("statTotalUsd").textContent = "Awaiting contract";
    $("statPoolUsd").textContent = "Awaiting contract";
    $("statCommittedUsd").textContent = "Awaiting contract";
    return;
  }

  setStatus("", "Reading the tray…");
  try {
    const [totalDist, totalDiv, holders, minPeriod] = await Promise.all([
      distributor.totalDistributed(),
      distributor.totalDividends(),
      distributor.shareholderCount(),
      distributor.minPeriod(),
    ]);

    const poolBn = totalDiv > totalDist ? totalDiv - totalDist : 0n;

    $("statTotalTok").innerHTML = `${fmtTok(totalDist)} <em>$TENDIES</em>`;
    $("statTotalUsd").textContent = fmtUsd(tokNumber(totalDist));

    $("statPoolTok").innerHTML = `${fmtTok(poolBn)} <em>$TENDIES</em>`;
    $("statPoolUsd").textContent = fmtUsd(tokNumber(poolBn));

    $("statCommittedTok").innerHTML = `${fmtTok(totalDiv)} <em>$TENDIES</em>`;
    $("statCommittedUsd").textContent = fmtUsd(tokNumber(totalDiv));

    $("statHolders").textContent = fmtInt(holders);
    $("statMinPeriod").textContent = fmtDuration(minPeriod);

    setStatus("ok", "Live on RobinhoodChain · updated " + new Date().toLocaleTimeString());
  } catch (err) {
    console.error(err);
    setStatus("err", "Couldn't reach the reward contract. Check the RPC or address, then Refresh.");
  }
}

/* --------------------------- Wallet checker --------------------------- */
async function checkWallet() {
  const raw = $("walletInput").value.trim();
  const hint = $("checkerHint");
  const results = $("checkerResults");

  if (!ethers.isAddress(raw)) {
    hint.textContent = "That doesn't look like a valid 0x wallet address.";
    hint.className = "checker-hint err";
    results.hidden = true;
    return;
  }
  if (isPlaceholder) {
    hint.textContent = "The reward contract hasn't been set yet. Add it in app.js to enable lookups.";
    hint.className = "checker-hint err";
    results.hidden = true;
    return;
  }

  const addr = ethers.getAddress(raw);
  hint.textContent = "Checking the highchair…";
  hint.className = "checker-hint";
  $("checkBtn").disabled = true;

  try {
    const [unpaid, lastClaim, shareData] = await Promise.all([
      distributor.getUnpaidEarnings(addr),
      distributor.getLastClaimTime(addr),
      distributor.shares(addr),
    ]);

    const realised = shareData.totalRealised;
    const shareAmount = shareData.amount;

    $("resReceivedTok").innerHTML = `${fmtTok(realised)} <em>$TENDIES</em>`;
    $("resReceivedUsd").textContent = fmtUsd(tokNumber(realised));

    $("resPendingTok").innerHTML = `${fmtTok(unpaid)} <em>$TENDIES</em>`;
    $("resPendingUsd").textContent = fmtUsd(tokNumber(unpaid));

    $("resShares").textContent = Number(ethers.formatUnits(shareAmount, 18))
      .toLocaleString(undefined, { maximumFractionDigits: 0 }) + " BABYTENDIES";

    const t = timeAgo(lastClaim);
    $("resLastClaim").textContent = t.abs;
    $("resLastClaimRel").textContent = t.rel;

    results.hidden = false;
    hint.textContent = `Showing tendies for ${addr.slice(0, 6)}…${addr.slice(-4)}`;
  } catch (err) {
    console.error(err);
    hint.textContent = "Lookup failed. The address may not be a holder, or the RPC is down.";
    hint.className = "checker-hint err";
    results.hidden = true;
  } finally {
    $("checkBtn").disabled = false;
  }
}

/* --------------------------- Nav / UI --------------------------- */
function initUI() {
  const nav = $("nav");
  window.addEventListener("scroll", () => nav.classList.toggle("scrolled", window.scrollY > 20));

  const toggle = $("navToggle");
  const links = $("navLinks");
  toggle.addEventListener("click", () => {
    links.classList.toggle("open");
    toggle.classList.toggle("open");
  });
  links.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => { links.classList.remove("open"); toggle.classList.remove("open"); })
  );

  $("checkBtn").addEventListener("click", checkWallet);
  $("walletInput").addEventListener("keydown", (e) => { if (e.key === "Enter") checkWallet(); });
  $("refreshBtn").addEventListener("click", async () => { await loadTendiesPrice(); await loadDashboard(); });

  const copyBtn = $("copyContract");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const addr = $("contractAddr").textContent.trim();
      try { await navigator.clipboard.writeText(addr); }
      catch {
        const t = document.createElement("textarea");
        t.value = addr; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
      }
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied ✓";
      copyBtn.classList.add("copied");
      setTimeout(() => { copyBtn.textContent = original; copyBtn.classList.remove("copied"); }, 1600);
    });
  }
}

/* --------------------------- Floating tendie/rocket emoji field --------------------------- */
function initParticles() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = $("fx");
  const ctx = canvas.getContext("2d");
  const EMOJI = ["🍗", "🍟", "🚀", "🍼", "💚"];
  let w, h, bits;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.min(26, Math.floor((w * h) / 70000));
    bits = Array.from({ length: count }, (_, i) => spawn(i));
  }
  function spawn(i) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 16 + 16,
      vy: Math.random() * 0.4 + 0.12,
      vx: (Math.random() - 0.5) * 0.2,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.01,
      a: Math.random() * 0.35 + 0.15,
      e: EMOJI[i % EMOJI.length],
    };
  }
  function tick() {
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.y += b.vy; b.x += b.vx; b.rot += b.vr;
      if (b.y > h + 30) { b.y = -30; b.x = Math.random() * w; }
      ctx.save();
      ctx.globalAlpha = b.a;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.font = `${b.size}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.e, 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener("resize", resize);
  resize();
  tick();
}

/* --------------------------- Boot --------------------------- */
(async function boot() {
  initUI();
  initParticles();
  initProvider();
  await loadTendiesPrice();
  await loadDashboard();
  if (CONFIG.REFRESH_MS > 0) {
    setInterval(async () => { await loadTendiesPrice(); await loadDashboard(); }, CONFIG.REFRESH_MS);
  }
})();
