const SPLITTER_ADDR_BSC = "0x928B75D0fA6382D4B742afB6e500C9458B4f502c";
const BSC_CHAIN_ID_HEX = "0x38";

const SPLITTER_ABI = [
  "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const $ = (id) => document.getElementById(id);

let provider = null;
let signer = null;
let userAddress = null;
let tokenMeta = { decimals: 18, symbol: "TOKEN", priceUsd: null, pairUrl: null };

function now() { return new Date().toLocaleTimeString(); }
function log(msg) {
  const el = $("log");
  const line = `[${now()}] ${msg}\n`;
  el.textContent = line + (el.textContent || "");
}
function setStatus(msg, isErr=false) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = isErr ? "#ffb3b3" : "";
}
function short(addr) { return addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : ""; }
function setWalletPill(connected) {
  const pill = $("pillWallet");
  if (connected) {
    pill.classList.remove("warn"); pill.classList.add("ok");
    pill.innerHTML = `Wallet: <b>${short(userAddress)}</b>`;
  } else {
    pill.classList.remove("ok"); pill.classList.add("warn");
    pill.innerHTML = `Wallet: <b>Disconnected</b>`;
  }
}
function setNetworkPill(label) { $("pillNetwork").innerHTML = `Network: <b>${label}</b>`; }

function formatUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

async function refreshChain() {
  if (!window.ethereum) { setNetworkPill("No Wallet"); return; }
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  setNetworkPill(chainId === BSC_CHAIN_ID_HEX ? "BSC" : `Wrong (${chainId})`);
}

async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask not detected.");
  if (!window.ethers) throw new Error("ethers not loaded (CDN blocked?).");

  setStatus("Requesting wallet connection…");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  userAddress = accounts?.[0] || null;

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  signer = provider.getSigner();

  setWalletPill(!!userAddress);
  log(`Connected: ${userAddress}`);

  await refreshChain();
  setStatus("Connected. Ready.");
}

async function switchToBsc() {
  if (!window.ethereum) return;
  try {
    setStatus("Switching to BSC…");
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
    await refreshChain();
    setStatus("BSC selected. Ready.");
    log("Switched to BSC.");
  } catch (e) {
    if (e?.code === 4902) {
      const params = [{
        chainId: BSC_CHAIN_ID_HEX,
        chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-dataseed.binance.org/"],
        blockExplorerUrls: ["https://bscscan.com/"],
      }];
      await window.ethereum.request({ method: "wallet_addEthereumChain", params });
      await refreshChain();
      setStatus("BSC added + selected.");
      log("BSC added + selected.");
    } else {
      throw new Error(e?.message || String(e));
    }
  }
}

// DexScreener: best pair by highest liquidity.usd
async function fetchDexScreenerPriceUsd_BSC(tokenAddress) {
  const addr = (tokenAddress || "").trim();
  if (!addr) return null;

  const url = `https://api.dexscreener.com/token-pairs/v1/bsc/${addr}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);

  const pairs = await res.json();
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  const best = pairs
    .filter(p => p && p.priceUsd && p.liquidity && typeof p.liquidity.usd === "number")
    .sort((a, b) => (b.liquidity.usd || 0) - (a.liquidity.usd || 0))[0];

  if (!best) return null;

  return {
    priceUsd: Number(best.priceUsd),
    pairUrl: best.url,
    dexId: best.dexId,
    liquidityUsd: best.liquidity.usd,
    baseSymbol: best.baseToken?.symbol,
  };
}

async function loadTokenMeta() {
  if (!signer) { setStatus("Connect wallet first.", true); return; }

  const tokenAddr = $("tokenAddress").value.trim();
  if (!ethers.utils.isAddress(tokenAddr)) {
    tokenMeta = { decimals: 18, symbol: "TOKEN", priceUsd: null, pairUrl: null };
    $("tokenUsd").textContent = "≈ —";
    return;
  }

  setStatus("Reading token metadata…");
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);

  let decimals = 18, symbol = "TOKEN";
  try { decimals = await token.decimals(); } catch {}
  try { symbol = await token.symbol(); } catch {}

  let priceUsd = null, pairUrl = null;
  try {
    const info = await fetchDexScreenerPriceUsd_BSC(tokenAddr);
    if (info) { priceUsd = info.priceUsd; pairUrl = info.pairUrl; }
  } catch (e) {
    log(`DexScreener price fetch failed: ${e?.message || e}`);
  }

  tokenMeta = { decimals, symbol, priceUsd, pairUrl };
  setStatus(`Token loaded: ${symbol} (decimals ${decimals})`);
  log(`Token meta: ${symbol}, decimals=${decimals}, priceUsd=${priceUsd ?? "n/a"}`);

  await updateUsdEstimate();
}

async function updateUsdEstimate() {
  const usdEl = $("tokenUsd");
  const amtStr = $("tokenAmount").value.trim();
  const amt = Number(amtStr);

  if (!amtStr || !Number.isFinite(amt) || amt <= 0) {
    usdEl.textContent = "≈ —";
    return;
  }

  if (!tokenMeta.priceUsd) {
    usdEl.textContent = `≈ — (no DexScreener price)`;
    return;
  }

  const totalUsd = amt * tokenMeta.priceUsd;
  usdEl.textContent =
    `≈ ${formatUsd(totalUsd)} (${formatUsd(tokenMeta.priceUsd)} / ${tokenMeta.symbol})` +
    (tokenMeta.pairUrl ? ` • Pair: ${tokenMeta.pairUrl}` : "");
}

// ---------- Recipient rows UI ----------
function makeRecipientRow(addressVal = "", percentVal = "") {
  const row = document.createElement("div");
  row.className = "recRow";

  const addr = document.createElement("input");
  addr.className = "inp";
  addr.placeholder = "Recipient address (0x...)";
  addr.value = addressVal;

  const pct = document.createElement("input");
  pct.className = "inp";
  pct.placeholder = "%";
  pct.inputMode = "numeric";
  pct.value = percentVal;

  const rm = document.createElement("button");
  rm.className = "btn small";
  rm.textContent = "REMOVE";

  rm.addEventListener("click", () => {
    row.remove();
    updatePercentTotal();
  });

  addr.addEventListener("input", updatePercentTotal);
  pct.addEventListener("input", updatePercentTotal);

  row.appendChild(addr);
  row.appendChild(pct);
  row.appendChild(rm);

  return row;
}

function addRecipientRow(addressVal = "", percentVal = "") {
  $("recipientsBox").appendChild(makeRecipientRow(addressVal, percentVal));
  updatePercentTotal();
}

function updatePercentTotal() {
  const totalEl = $("pctTotal");
  const rows = Array.from($("recipientsBox").children);

  let total = 0;
  for (const r of rows) {
    const pctInput = r.children[1];
    const pct = Number((pctInput.value || "").trim());
    if (Number.isFinite(pct)) total += pct;
  }

  totalEl.textContent = `Total: ${Math.round(total * 100) / 100}%`;

  totalEl.classList.remove("ok", "bad");
  if (rows.length === 0) totalEl.classList.add("bad");
  else if (Math.abs(total - 100) < 0.0001) totalEl.classList.add("ok");
  else totalEl.classList.add("bad");
}

function readRecipientsFromRows() {
  const rows = Array.from($("recipientsBox").children);
  if (rows.length === 0) throw new Error("Add at least 1 recipient.");

  const accounts = [];
  const shares = [];
  let total = 0;

  for (const r of rows) {
    const addr = (r.children[0].value || "").trim();
    const pctStr = (r.children[1].value || "").trim();
    const pct = Number(pctStr);

    if (!ethers.utils.isAddress(addr)) throw new Error(`Invalid recipient address: ${addr || "(blank)"}`);
    if (!Number.isFinite(pct) || pct <= 0) throw new Error(`Invalid percent for ${short(addr)}: ${pctStr || "(blank)"}`);

    const pctInt = Math.round(pct);
    accounts.push(addr);
    shares.push(pctInt);
    total += pctInt;
  }

  if (total !== 100) throw new Error(`Percents must total 100. Current total: ${total}`);
  return { accounts, shares };
}

// ---------- approve + split ----------
async function buildAmountBaseUnits() {
  const amtStr = $("tokenAmount").value.trim();
  if (!amtStr) throw new Error("Enter token amount.");
  const amountBaseUnits = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
  if (amountBaseUnits.lte(0)) throw new Error("Amount must be > 0.");
  return amountBaseUnits;
}

async function approveIfNeeded() {
  if (!signer || !userAddress) throw new Error("Connect wallet first.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId !== BSC_CHAIN_ID_HEX) throw new Error("Wrong network. Switch to BSC.");

  const tokenAddr = $("tokenAddress").value.trim();
  if (!ethers.utils.isAddress(tokenAddr)) throw new Error("Enter a valid token address.");

  const amount = await buildAmountBaseUnits();

  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const allowance = await token.allowance(userAddress, SPLITTER_ADDR_BSC);

  if (allowance.gte(amount)) {
    log("Approve not needed (allowance already sufficient).");
    setStatus("Approve not needed.");
    return;
  }

  setStatus("Approving token spend…");
  log(`Approving splitter ${short(SPLITTER_ADDR_BSC)}…`);
  const tx = await token.approve(SPLITTER_ADDR_BSC, amount);
  log(`Approve tx: ${tx.hash}`);
  await tx.wait();
  log(`Approve confirmed: ${tx.hash}`);
  setStatus("Approved. Ready to split.");
}

async function splitTokens() {
  if (!signer || !userAddress) throw new Error("Connect wallet first.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId !== BSC_CHAIN_ID_HEX) throw new Error("Wrong network. Switch to BSC.");

  const tokenAddr = $("tokenAddress").value.trim();
  if (!ethers.utils.isAddress(tokenAddr)) throw new Error("Enter a valid token address.");

  const { accounts, shares } = readRecipientsFromRows();
  const amount = await buildAmountBaseUnits();

  const ok = confirm(
    `Split ${$("tokenAmount").value} ${tokenMeta.symbol} to ${accounts.length} recipient(s) on BSC?\n\n` +
    `Contract: ${SPLITTER_ADDR_BSC}`
  );
  if (!ok) return;

  setStatus("Submitting split transaction…");
  const splitter = new ethers.Contract(SPLITTER_ADDR_BSC, SPLITTER_ABI, signer);

  const tx = await splitter.depositAndDistribute(tokenAddr, accounts, shares, amount);
  log(`Split tx: ${tx.hash}`);
  const receipt = await tx.wait();
  log(`Split confirmed: ${tx.hash} (status ${receipt.status})`);
  setStatus("Split complete ✅");
}

function wire() {
  $("splitterAddr").textContent = SPLITTER_ADDR_BSC;

  $("btnConnect").addEventListener("click", async () => {
    try { await connectWallet(); }
    catch (e) { setStatus(e?.message || String(e), true); log(`Connect error: ${e?.message || e}`); }
  });

  $("btnSwitchBsc").addEventListener("click", async () => {
    try { await switchToBsc(); }
    catch (e) { setStatus(e?.message || String(e), true); log(`Switch error: ${e?.message || e}`); }
  });

  $("tokenAddress").addEventListener("change", async () => {
    try { await loadTokenMeta(); }
    catch (e) { setStatus(e?.message || String(e), true); log(`Token meta error: ${e?.message || e}`); }
  });

  $("tokenAmount").addEventListener("input", async () => {
    try { await updateUsdEstimate(); }
    catch (e) { log(`USD update error: ${e?.message || e}`); }
  });

  $("btnApprove").addEventListener("click", async () => {
    try { await approveIfNeeded(); }
    catch (e) { setStatus(e?.message || String(e), true); log(`Approve error: ${e?.message || e}`); }
  });

  $("btnSplit").addEventListener("click", async () => {
    try { await splitTokens(); }
    catch (e) { setStatus(e?.message || String(e), true); log(`Split error: ${e?.message || e}`); }
  });

  $("btnAddRecipient").addEventListener("click", () => addRecipientRow());

  // Start with 2 rows
  addRecipientRow("", "50");
  addRecipientRow("", "50");

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accs) => {
      userAddress = accs?.[0] || null;
      setWalletPill(!!userAddress);
      log(userAddress ? `Account changed: ${userAddress}` : "Disconnected.");
    });
    window.ethereum.on("chainChanged", () => {
      refreshChain().catch(() => {});
      log("Network changed.");
    });
  }

  log("Boot complete. Click CONNECT WALLET.");
}

window.addEventListener("DOMContentLoaded", () => {
  $("log").textContent = "";
  if (!window.ethereum) {
    setStatus("MetaMask not detected. Install/enable MetaMask.", true);
    log("MetaMask not detected.");
    return;
  }
  wire();
  refreshChain().catch(() => {});
  setWalletPill(false);
});
