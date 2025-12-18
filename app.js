/* ZEPHENHEL CITADEL — GitHub Pages / Static Build
   - Metamask connect + BSC switch
   - Token intel (symbol/decimals), balance, allowance
   - Dexscreener USD estimate (best effort)
   - Formation recipients add/remove, total % must equal 100
   - Approve + Execute Split using your splitter contract
*/

const { ethers } = window.ethers;

const BSC_CHAIN_ID_HEX = "0x38"; // 56
const BSC_PARAMS = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org/"],
  blockExplorerUrls: ["https://bscscan.com/"],
};

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const SPLITTER_ABI = [
  // IMPORTANT: This must match your deployed splitter contract function name/signature.
  // If yours differs, tell me the exact function name + parameters and I’ll match it.
  "function splitToken(address token, uint256 amount, address[] recipients, uint256[] bps) external",
];

const el = (id) => document.getElementById(id);

const state = {
  provider: null,
  signer: null,
  account: null,
  chainId: null,

  token: {
    address: "",
    symbol: "",
    decimals: 18,
    priceUsd: null,
    dex: null,
  },

  splitterAddress: "",
  recipients: [],
  lastReceiptText: "",
  lastTxUrl: "",
};

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el("log").textContent = line + el("log").textContent;
}

function setWarn(text) {
  const box = el("warnBox");
  if (!text) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = text;
}

function shortAddr(a) {
  if (!a || a.length < 10) return a || "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function isAddress(a) {
  try { return ethers.utils.isAddress(a); } catch { return false; }
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function normalizeAmountInput(v) {
  // allow decimals in UI; we’ll parse with token decimals later
  return (v || "").toString().trim();
}

function pctTotal() {
  const sum = state.recipients.reduce((acc, r) => acc + (Number(r.pct) || 0), 0);
  return sum;
}

function renderTotalPct() {
  const t = pctTotal();
  el("totalPct").textContent = `${t}%`;
}

function addRecipient(addr = "", pct = "") {
  state.recipients.push({ addr, pct });
  renderRecipients();
}

function removeRecipient(i) {
  state.recipients.splice(i, 1);
  renderRecipients();
}

function renderRecipients() {
  const list = el("recipientsList");
  list.innerHTML = "";

  state.recipients.forEach((r, idx) => {
    const tile = document.createElement("div");
    tile.className = "tile";

    const addrWrap = document.createElement("div");
    addrWrap.className = "addr";
    const addrInput = document.createElement("input");
    addrInput.className = "smallinput";
    addrInput.placeholder = "Recipient address (0x...)";
    addrInput.value = r.addr;
    addrInput.addEventListener("input", (e) => {
      state.recipients[idx].addr = e.target.value.trim();
    });

    const addrBadge = document.createElement("div");
    addrBadge.className = "badge";
    addrBadge.textContent = isAddress(r.addr) ? "VALID" : "CHECK ADDRESS";

    addrInput.addEventListener("input", () => {
      addrBadge.textContent = isAddress(addrInput.value.trim()) ? "VALID" : "CHECK ADDRESS";
    });

    addrWrap.appendChild(addrInput);
    addrWrap.appendChild(addrBadge);

    const pctWrap = document.createElement("div");
    pctWrap.className = "pct";
    const pctInput = document.createElement("input");
    pctInput.className = "smallinput";
    pctInput.placeholder = "Percent";
    pctInput.inputMode = "numeric";
    pctInput.value = r.pct;
    pctInput.addEventListener("input", (e) => {
      const v = e.target.value.replace(/[^\d]/g, "");
      const n = clamp(Number(v || 0), 0, 100);
      e.target.value = v === "" ? "" : String(n);
      state.recipients[idx].pct = e.target.value;
      renderTotalPct();
    });

    const pctBadge = document.createElement("div");
    pctBadge.className = "badge";
    pctBadge.textContent = "WEIGHT";

    pctWrap.appendChild(pctInput);
    pctWrap.appendChild(pctBadge);

    const tools = document.createElement("div");
    tools.className = "tools";
    const rm = document.createElement("button");
    rm.className = "btn mini outline";
    rm.textContent = "REMOVE";
    rm.addEventListener("click", () => removeRecipient(idx));

    tools.appendChild(rm);

    tile.appendChild(addrWrap);
    tile.appendChild(pctWrap);
    tile.appendChild(tools);

    list.appendChild(tile);
  });

  renderTotalPct();
}

function equalize() {
  if (state.recipients.length === 0) return;
  const n = state.recipients.length;
  const base = Math.floor(100 / n);
  let rem = 100 - base * n;

  state.recipients = state.recipients.map((r, i) => {
    const add = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    return { ...r, pct: String(base + add) };
  });
  renderRecipients();
}

function clearRecipients() {
  state.recipients = [];
  renderRecipients();
}

async function ensureBsc() {
  if (!window.ethereum) throw new Error("MetaMask not found.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  state.chainId = chainId;

  if (chainId === BSC_CHAIN_ID_HEX) return true;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  } catch (err) {
    // If chain not added
    if (err && (err.code === 4902 || err.code === -32603)) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [BSC_PARAMS],
      });
    } else {
      throw err;
    }
  }
  return true;
}

async function connect() {
  setWarn("");
  if (!window.ethereum) {
    setWarn("MetaMask not detected. Install MetaMask extension and refresh.");
    return;
  }

  await ensureBsc();

  state.provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await state.provider.send("eth_requestAccounts", []);
  state.signer = state.provider.getSigner();
  state.account = await state.signer.getAddress();

  const net = await state.provider.getNetwork();
  state.chainId = "0x" + net.chainId.toString(16);

  el("accountPill").innerHTML = `Wallet: <b>${shortAddr(state.account)}</b>`;
  el("networkPill").innerHTML = `Network: <b>${net.chainId === 56 ? "BSC" : net.chainId}</b>`;
  log(`Wallet connected: ${state.account}`);
}

async function loadTokenMeta() {
  setWarn("");
  const tokenAddr = el("tokenAddress").value.trim();
  state.token.address = tokenAddr;

  if (!isAddress(tokenAddr)) {
    el("tokenSymbol").textContent = "—";
    el("tokenDecimals").textContent = "—";
    el("tokenPriceUsd").textContent = "—";
    el("usdEstimate").textContent = "—";
    el("dexReadout").textContent = "—";
    return;
  }

  try {
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, state.provider || new ethers.providers.JsonRpcProvider(BSC_PARAMS.rpcUrls[0]));
    const [sym, dec] = await Promise.all([token.symbol(), token.decimals()]);
    state.token.symbol = sym;
    state.token.decimals = Number(dec);

    el("tokenSymbol").textContent = sym;
    el("tokenDecimals").textContent = String(dec);
    log(`Token meta: ${sym} / decimals ${dec}`);

    await refreshDexscreener(tokenAddr);
    if (state.account && state.provider) {
      await refreshBalanceAndAllowance();
    }
    updateUsdEstimate();
  } catch (e) {
    log(`Token meta error: ${e.message || e}`);
    setWarn("Could not read token metadata. Check the token address (BEP20) and network (BSC).");
  }
}

async function refreshDexscreener(tokenAddr) {
  try {
    el("dexHint").textContent = "Price feed: Dexscreener (loading...)";
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Dexscreener HTTP ${res.status}`);
    const data = await res.json();

    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    // Choose best BSC pair by liquidity (USD)
    const bscPairs = pairs.filter(p => (p.chainId || "").toLowerCase() === "bsc");
    bscPairs.sort((a,b) => (Number(b?.liquidity?.usd||0) - Number(a?.liquidity?.usd||0)));
    const best = bscPairs[0] || pairs[0];

    if (!best) {
      state.token.priceUsd = null;
      state.token.dex = null;
      el("tokenPriceUsd").textContent = "—";
      el("dexReadout").textContent = "No pair found";
      el("dexHint").textContent = "Price feed: Dexscreener (no pair found)";
      return;
    }

    const priceUsd = Number(best.priceUsd || 0);
    state.token.priceUsd = priceUsd > 0 ? priceUsd : null;
    state.token.dex = best;

    el("tokenPriceUsd").textContent = state.token.priceUsd ? `$${state.token.priceUsd.toFixed(6)}` : "—";

    const liq = Number(best?.liquidity?.usd || 0);
    const vol = Number(best?.volume?.h24 || 0);
    const chg = Number(best?.priceChange?.h24 || 0);
    el("dexReadout").textContent =
      `Liq $${liq.toLocaleString()} • Vol24h $${vol.toLocaleString()} • Δ24h ${isFinite(chg)? chg.toFixed(2):"0"}%`;

    el("dexHint").textContent = "Price feed: Dexscreener (best pair selected)";
    log("Dexscreener intel updated.");
  } catch (e) {
    state.token.priceUsd = null;
    state.token.dex = null;
    el("tokenPriceUsd").textContent = "—";
    el("dexReadout").textContent = "Dex feed unavailable";
    el("dexHint").textContent = "Price feed: Dexscreener (unavailable)";
    log(`Dexscreener error: ${e.message || e}`);
  }
}

function updateUsdEstimate() {
  const amtRaw = normalizeAmountInput(el("amount").value);
  if (!amtRaw || !state.token.priceUsd) {
    el("usdEstimate").textContent = "—";
    return;
  }
  const n = Number(amtRaw);
  if (!isFinite(n) || n <= 0) {
    el("usdEstimate").textContent = "—";
    return;
  }
  const est = n * state.token.priceUsd;
  el("usdEstimate").textContent = `$${est.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

async function refreshBalanceAndAllowance() {
  try {
    const tokenAddr = state.token.address;
    const splitterAddr = el("splitterAddress").value.trim();
    if (!isAddress(tokenAddr) || !isAddress(splitterAddr) || !state.account || !state.provider) return;

    const token = new ethers.Contract(tokenAddr, ERC20_ABI, state.provider);
    const [bal, alw] = await Promise.all([
      token.balanceOf(state.account),
      token.allowance(state.account, splitterAddr),
    ]);

    const dec = state.token.decimals || 18;
    const balFmt = ethers.utils.formatUnits(bal, dec);
    const alwFmt = ethers.utils.formatUnits(alw, dec);

    el("balanceReadout").textContent = `${Number(balFmt).toLocaleString(undefined,{maximumFractionDigits:6})} ${state.token.symbol || ""}`;
    el("allowanceReadout").textContent = `${Number(alwFmt).toLocaleString(undefined,{maximumFractionDigits:6})} ${state.token.symbol || ""}`;
    log("Balance + allowance updated.");
  } catch (e) {
    log(`Balance/allowance error: ${e.message || e}`);
  }
}

function validateInputs() {
  const splitterAddr = el("splitterAddress").value.trim();
  const tokenAddr = el("tokenAddress").value.trim();
  const amountRaw = normalizeAmountInput(el("amount").value);

  if (!state.account) return "Connect wallet first.";
  if (!isAddress(splitterAddr)) return "Enter a valid Splitter Contract address (BSC).";
  if (!isAddress(tokenAddr)) return "Enter a valid Token Contract address (BEP20).";
  if (!amountRaw) return "Enter an amount.";
  if (!state.recipients.length) return "Add at least 1 recipient.";

  const sum = pctTotal();
  if (sum !== 100) return "Total percent must equal 100.";

  for (const r of state.recipients) {
    if (!isAddress(r.addr)) return `Invalid recipient address: ${r.addr}`;
    const p = Number(r.pct);
    if (!isFinite(p) || p <= 0) return "Each recipient percent must be > 0.";
  }

  // amount parse check
  const n = Number(amountRaw);
  if (!isFinite(n) || n <= 0) return "Amount must be a positive number.";

  return null;
}

function buildBpsArray() {
  // Convert % to basis points (100% => 10000)
  // We'll map 1% => 100 bps. Example: 50% => 5000 bps
  const bps = state.recipients.map(r => Math.round(Number(r.pct) * 100));
  const sum = bps.reduce((a,b)=>a+b,0);

  // Fix rounding drift to exactly 10000 by adjusting the last entry
  const drift = 10000 - sum;
  if (bps.length > 0 && drift !== 0) bps[bps.length - 1] += drift;

  return bps;
}

async function approve() {
  setWarn("");
  const err = validateInputs();
  if (err) { setWarn(err); return; }

  const splitterAddr = el("splitterAddress").value.trim();
  const tokenAddr = el("tokenAddress").value.trim();
  const amountRaw = normalizeAmountInput(el("amount").value);

  try {
    await ensureBsc();

    const token = new ethers.Contract(tokenAddr, ERC20_ABI, state.signer);
    const amount = ethers.utils.parseUnits(amountRaw, state.token.decimals || 18);

    log(`Approving splitter ${shortAddr(splitterAddr)} for ${amountRaw} ${state.token.symbol}...`);
    const tx = await token.approve(splitterAddr, amount);
    log(`Approve tx sent: ${tx.hash}`);

    await tx.wait();
    log("Approve confirmed.");

    await refreshBalanceAndAllowance();
  } catch (e) {
    log(`Approve failed: ${e.message || e}`);
    setWarn(`Approve failed: ${e.message || e}`);
  }
}

async function split() {
  setWarn("");
  const err = validateInputs();
  if (err) { setWarn(err); return; }

  const splitterAddr = el("splitterAddress").value.trim();
  const tokenAddr = el("tokenAddress").value.trim();
  const amountRaw = normalizeAmountInput(el("amount").value);

  try {
    await ensureBsc();

    const splitter = new ethers.Contract(splitterAddr, SPLITTER_ABI, state.signer);
    const amount = ethers.utils.parseUnits(amountRaw, state.token.decimals || 18);

    const recipients = state.recipients.map(r => r.addr.trim());
    const bps = buildBpsArray();

    log(`Split execution started...`);
    log(`Token: ${tokenAddr}`);
    log(`Amount: ${amountRaw} ${state.token.symbol}`);
    log(`Recipients: ${recipients.length} • BPS total: ${bps.reduce((a,b)=>a+b,0)}`);

    const tx = await splitter.splitToken(tokenAddr, amount, recipients, bps);
    log(`Split tx sent: ${tx.hash}`);

    const receipt = await tx.wait();
    log(`Split confirmed in block ${receipt.blockNumber}`);

    // Receipt UI
    const txUrl = `https://bscscan.com/tx/${tx.hash}`;
    state.lastTxUrl = txUrl;
    el("txLink").href = txUrl;
    el("txLink").style.display = "inline-flex";

    const lines = [];
    lines.push(`ZEPHENHEL CITADEL — PROOF-OF-OUTCOME`);
    lines.push(`────────────────────────────────────`);
    lines.push(`TX: ${tx.hash}`);
    lines.push(`Token: ${tokenAddr} (${state.token.symbol || "?"})`);
    lines.push(`Amount: ${amountRaw}`);
    if (state.token.priceUsd) {
      const est = Number(amountRaw) * state.token.priceUsd;
      if (isFinite(est)) lines.push(`USD Estimate: $${est.toLocaleString(undefined,{maximumFractionDigits:2})}`);
    }
    lines.push(`Fee: 1%`);
    lines.push(`Recipients:`);
    state.recipients.forEach((r, i) => {
      lines.push(` ${i+1}. ${r.addr} — ${r.pct}%`);
    });
    lines.push(`Time: ${new Date().toLocaleString()}`);

    const text = lines.join("\n");
    state.lastReceiptText = text;
    el("receiptBox").textContent = text;

    await refreshBalanceAndAllowance();
  } catch (e) {
    log(`Split failed: ${e.message || e}`);
    setWarn(`Split failed: ${e.message || e}

If this says the function/signature is wrong, send me your splitter contract function name + parameters and I will match the ABI exactly.`);
  }
}

async function onChainChanged() {
  try {
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    state.chainId = chainId;
    el("networkPill").innerHTML = `Network: <b>${chainId === BSC_CHAIN_ID_HEX ? "BSC" : chainId}</b>`;
    log(`Chain changed: ${chainId}`);
    if (state.account && state.provider) {
      await refreshBalanceAndAllowance();
    }
  } catch {}
}

async function onAccountsChanged(accs) {
  const a = accs && accs[0];
  if (!a) {
    state.account = null;
    el("accountPill").innerHTML = `Wallet: <b>Disconnected</b>`;
    log("Wallet disconnected.");
    return;
  }
  state.account = a;
  el("accountPill").innerHTML = `Wallet: <b>${shortAddr(a)}</b>`;
  log(`Account changed: ${a}`);
  if (state.token.address) await refreshBalanceAndAllowance();
}

function copyReceipt() {
  const txt = state.lastReceiptText || "";
  if (!txt) { setWarn("No receipt to copy yet."); return; }
  navigator.clipboard.writeText(txt).then(() => {
    log("Receipt copied.");
  }).catch(() => {
    setWarn("Clipboard blocked by browser. Select + copy manually from the receipt box.");
  });
}

function wireUI() {
  el("connectBtn").addEventListener("click", connect);
  el("switchBscBtn").addEventListener("click", async () => {
    try { await ensureBsc(); await onChainChanged(); } catch(e){ setWarn(e.message || String(e)); }
  });

  el("tokenAddress").addEventListener("change", loadTokenMeta);
  el("tokenAddress").addEventListener("blur", loadTokenMeta);

  el("splitterAddress").addEventListener("change", refreshBalanceAndAllowance);
  el("splitterAddress").addEventListener("blur", refreshBalanceAndAllowance);

  el("amount").addEventListener("input", () => {
    updateUsdEstimate();
  });

  el("addRecipientBtn").addEventListener("click", () => addRecipient("", ""));
  el("equalizeBtn").addEventListener("click", equalize);
  el("clearBtn").addEventListener("click", clearRecipients);

  el("approveBtn").addEventListener("click", approve);
  el("splitBtn").addEventListener("click", split);

  el("copyReceiptBtn").addEventListener("click", copyReceipt);

  // Start with 2 recipients like your screenshot (easy workflow)
  if (state.recipients.length === 0) {
    addRecipient("", "50");
    addRecipient("", "50");
  }

  // Metamask listeners
  if (window.ethereum) {
    window.ethereum.on("chainChanged", onChainChanged);
    window.ethereum.on("accountsChanged", onAccountsChanged);
  }

  log("Citadel boot complete. Click CONNECT WALLET.");
}

wireUI();
