/* Zephenhel Console — GitHub Pages friendly
   - BSC network check + switch
   - ERC-20 multi-transfer splitter OR native BNB splitter
   - 1% platform fee
   - Dexscreener USD price + value estimate
*/

const BSC_CHAIN_ID_HEX = "0x38";
const BSC_CHAIN_ID_DEC = 56;

const FEE_BPS = 100; // 1% = 100 basis points
const FEE_WALLET = "0x0000000000000000000000000000000000000000"; // <<< REPLACE THIS

// Minimal ERC20 ABI
const ERC20_ABI = [
  { "constant": true, "inputs": [], "name": "symbol", "outputs": [{ "name": "", "type": "string" }], "type": "function" },
  { "constant": true, "inputs": [], "name": "decimals", "outputs": [{ "name": "", "type": "uint8" }], "type": "function" },
  { "constant": false, "inputs": [{ "name": "to", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "transfer", "outputs": [{ "name": "", "type": "bool" }], "type": "function" },
];

const $ = (id) => document.getElementById(id);

let provider = null;
let signer = null;
let walletAddress = null;
let currentChainId = null;

let loadedToken = {
  address: "",
  symbol: "",
  decimals: null,
  priceUsd: null
};

function setStatus(msg, isError=false) {
  const el = $("statusText");
  el.textContent = msg;
  el.classList.toggle("muted", !isError);
  el.style.color = isError ? "var(--danger)" : "";
}

function fmt(n, d=6) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function parseFloatSafe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isAddressLike(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

/* ---------- UI: recipients ---------- */

function recipientsFromUI() {
  const rows = [...document.querySelectorAll(".recRow")];
  return rows.map((row) => {
    const addr = row.querySelector(".addrInput").value.trim();
    const pct = parseFloatSafe(row.querySelector(".pctInput").value);
    return { address: addr, pct: pct ?? 0 };
  });
}

function updatePctTotal() {
  const recs = recipientsFromUI();
  const total = recs.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  $("pctTotal").textContent = `${fmt(total, 4)}%`;
  return total;
}

function addRecipientRow(addr="", pct="") {
  const wrap = $("recipientsList");
  const row = document.createElement("div");
  row.className = "recRow";
  row.innerHTML = `
    <input class="addrInput" placeholder="Recipient 0x..." spellcheck="false" value="${addr}" />
    <input class="pctInput" placeholder="%" inputmode="decimal" value="${pct}" />
    <button class="iconBtn" title="Remove">×</button>
  `;
  row.querySelector(".iconBtn").onclick = () => {
    row.remove();
    updatePctTotal();
    updateSummary();
  };
  row.querySelector(".addrInput").addEventListener("input", () => {
    updateSummary();
  });
  row.querySelector(".pctInput").addEventListener("input", () => {
    updatePctTotal();
    updateSummary();
  });
  wrap.appendChild(row);
  updatePctTotal();
  updateSummary();
}

function normalizeTo100() {
  const recs = recipientsFromUI();
  if (recs.length === 0) return;
  const total = recs.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  if (total <= 0) {
    const even = 100 / recs.length;
    document.querySelectorAll(".pctInput").forEach((el) => el.value = fmt(even, 6));
  } else {
    document.querySelectorAll(".recRow").forEach((row, i) => {
      const pctEl = row.querySelector(".pctInput");
      const pct = Number(recs[i].pct) || 0;
      pctEl.value = fmt((pct / total) * 100, 6);
    });
  }
  updatePctTotal();
  updateSummary();
}

/* ---------- Network + wallet ---------- */

async function detectNetwork() {
  if (!window.ethereum) return null;
  const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
  currentChainId = parseInt(chainIdHex, 16);
  $("networkPill").innerHTML = `Network: <b>${currentChainId === BSC_CHAIN_ID_DEC ? "BSC" : "Unknown ("+currentChainId+")"}</b>`;
  return currentChainId;
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("MetaMask not detected. Install MetaMask, then refresh.", true);
    return;
  }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await detectNetwork();

    // Ethers v5 is not guaranteed on pages; use window.ethereum directly
    // We'll do raw RPC signing via MetaMask for txs (no ethers dependency)
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    walletAddress = accounts?.[0] || null;

    $("walletPill").innerHTML = `Wallet: <b>${walletAddress ? walletAddress.slice(0,6)+"…"+walletAddress.slice(-4) : "Disconnected"}</b>`;
    setStatus("Wallet connected. Ready.");

    // refresh price/value display
    await refreshPriceAndValue();
  } catch (e) {
    setStatus(`Connect failed: ${e?.message || e}`, true);
  }
}

async function switchToBSC() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
    await detectNetwork();
    setStatus("Switched to BSC.");
    await refreshPriceAndValue();
  } catch (e) {
    setStatus(`Switch failed: ${e?.message || e}`, true);
  }
}

// “Disconnect” on web is basically UI reset (MetaMask controls actual connection)
function disconnectUI() {
  walletAddress = null;
  $("walletPill").innerHTML = `Wallet: <b>Disconnected</b>`;
  setStatus("Disconnected (UI). Click CONNECT WALLET to reconnect.");
}

/* ---------- ERC-20 helpers (raw eth_call + sendTransaction) ---------- */

async function ethCall(to, data) {
  return await window.ethereum.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
}

function toHex(n) {
  return "0x" + BigInt(n).toString(16);
}

function pad32(hexNo0x) {
  return hexNo0x.padStart(64, "0");
}

function encodeAddress(addr) {
  return pad32(addr.toLowerCase().replace(/^0x/, ""));
}

function encodeUint256(bi) {
  return pad32(BigInt(bi).toString(16));
}

// keccak256 selectors hardcoded for symbol(), decimals(), transfer(address,uint256)
const SEL_SYMBOL = "0x95d89b41";
const SEL_DECIMALS = "0x313ce567";
const SEL_TRANSFER = "0xa9059cbb";

function hexToUtf8(hex) {
  // best effort for symbol strings
  try {
    hex = hex.replace(/^0x/, "");
    const bytes = [];
    for (let i=0;i<hex.length;i+=2) bytes.push(parseInt(hex.slice(i,i+2),16));
    const str = new TextDecoder().decode(new Uint8Array(bytes));
    return str.replace(/\u0000/g, "").trim();
  } catch { return ""; }
}

async function loadTokenMeta() {
  const addr = $("tokenAddress").value.trim();
  if (!isAddressLike(addr)) {
    setStatus("Enter a valid ERC-20 token address (0x...).", true);
    return;
  }
  try {
    if (currentChainId !== BSC_CHAIN_ID_DEC) {
      setStatus("Please switch to BSC first.", true);
      return;
    }

    // decimals
    const decHex = await ethCall(addr, SEL_DECIMALS);
    const dec = parseInt(decHex, 16);

    // symbol (could be bytes32 or string; we try string decode)
    const symHex = await ethCall(addr, SEL_SYMBOL);
    let sym = "";
    // If it's returned as a string ABI, it contains offset/length; we’ll attempt to parse length at word 2.
    const clean = symHex.replace(/^0x/, "");
    if (clean.length >= 128) {
      const len = parseInt(clean.slice(64, 128), 16);
      const dataStart = 128;
      const dataHex = "0x" + clean.slice(dataStart, dataStart + len*2);
      sym = hexToUtf8(dataHex) || "";
    } else {
      sym = hexToUtf8(symHex) || "";
    }

    loadedToken.address = addr;
    loadedToken.decimals = Number.isFinite(dec) ? dec : 18;
    loadedToken.symbol = sym || "TOKEN";

    $("tokenDecimals").value = String(loadedToken.decimals);
    $("tokenSymbol").value = loadedToken.symbol;

    setStatus(`Loaded token: ${loadedToken.symbol} (decimals ${loadedToken.decimals}).`);
    await refreshPriceAndValue();
  } catch (e) {
    setStatus(`Token load failed: ${e?.message || e}`, true);
  }
}

function amountToBaseUnits(amountFloat, decimals) {
  // Convert decimal string/float to integer base units safely using BigInt
  const s = String(amountFloat).trim();
  if (!s || s === ".") throw new Error("Invalid amount");
  const [a,b=""] = s.split(".");
  const whole = BigInt(a || "0");
  const frac = (b + "0".repeat(decimals)).slice(0, decimals);
  const fracBi = BigInt(frac || "0");
  return whole * (10n ** BigInt(decimals)) + fracBi;
}

function baseUnitsToAmountStr(units, decimals) {
  const bi = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = bi / base;
  const frac = bi % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/,"");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

/* ---------- Dexscreener price ---------- */

async function fetchDexscreenerPriceUsd(tokenAddr) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const pairs = j?.pairs;
    if (!pairs || !pairs.length) return null;

    // Prefer BSC pairs if available
    const bscPair = pairs.find(p => (p?.chainId || "").toLowerCase() === "bsc") || pairs[0];
    const price = bscPair?.priceUsd;
    const n = Number(price);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function refreshPriceAndValue() {
  const mode = $("modeSelect").value;
  const amount = parseFloatSafe($("amountInput").value);

  let price = null;

  if (mode === "erc20") {
    const tokenAddr = $("tokenAddress").value.trim();
    if (isAddressLike(tokenAddr)) {
      price = await fetchDexscreenerPriceUsd(tokenAddr);
    }
  } else {
    // BNB mode: you *can* wire a BNB USD source later; for now show —
    price = null;
  }

  loadedToken.priceUsd = price;
  $("priceUsd").textContent = price ? `$${fmt(price, 6)}` : "$—";

  if (price && amount !== null) {
    $("valueUsd").textContent = `$${fmt(price * amount, 2)}`;
  } else {
    $("valueUsd").textContent = "$—";
  }

  updateSummary();
}

/* ---------- Preview + execute ---------- */

function computeSplitPlan() {
  const mode = $("modeSelect").value;
  const amountStr = $("amountInput").value.trim();
  const amount = parseFloatSafe(amountStr);
  if (amount === null || amount <= 0) throw new Error("Enter a valid amount > 0.");

  const recs = recipientsFromUI();
  if (recs.length === 0) throw new Error("Add at least 1 recipient.");

  for (const r of recs) {
    if (!isAddressLike(r.address)) throw new Error(`Invalid recipient address: ${r.address || "(blank)"}`);
    if (!Number.isFinite(r.pct) || r.pct < 0) throw new Error("Percent must be a number >= 0.");
  }

  const totalPct = recs.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  if (Math.abs(totalPct - 100) > 0.0001) {
    throw new Error(`Percentages must total 100%. Current total: ${fmt(totalPct, 6)}%`);
  }

  const fee = amount * (FEE_BPS / 10000);
  const distributable = amount - fee;
  if (distributable <= 0) throw new Error("Amount is too small after fee.");

  return { mode, amount, fee, distributable, recs };
}

function updateSummary() {
  try {
    const totalPct = updatePctTotal();
    const amount = parseFloatSafe($("amountInput").value);
    if (amount === null || amount <= 0) {
      $("feeAmount").textContent = "—";
      $("distributedAmount").textContent = "—";
      return;
    }
    const fee = amount * (FEE_BPS / 10000);
    const dist = amount - fee;

    const mode = $("modeSelect").value;
    const sym = (mode === "bnb") ? "BNB" : ($("tokenSymbol").value.trim() || "TOKEN");

    $("feeAmount").textContent = `${fmt(fee, 8)} ${sym}`;
    $("distributedAmount").textContent = `${fmt(dist, 8)} ${sym}`;

  } catch {
    // ignore
  }
}

function renderPreview(plan) {
  const sym = plan.mode === "bnb" ? "BNB" : ($("tokenSymbol").value.trim() || "TOKEN");
  const lines = [];
  lines.push(`MODE: ${plan.mode.toUpperCase()}`);
  lines.push(`TOTAL AMOUNT: ${plan.amount} ${sym}`);
  lines.push(`FEE (1%): ${fmt(plan.fee, 10)} ${sym} -> ${FEE_WALLET}`);
  lines.push(`DISTRIBUTABLE: ${fmt(plan.distributable, 10)} ${sym}`);
  lines.push("");
  lines.push("RECIPIENTS:");
  for (const r of plan.recs) {
    const amt = plan.distributable * (r.pct / 100);
    lines.push(`- ${r.address} | ${fmt(r.pct, 6)}% => ${fmt(amt, 10)} ${sym}`);
  }
  $("previewBox").textContent = lines.join("\n");
}

async function sendNativeBNB(to, valueWeiHex) {
  const tx = {
    from: walletAddress,
    to,
    value: valueWeiHex,
  };
  return await window.ethereum.request({ method: "eth_sendTransaction", params: [tx] });
}

async function sendErc20Transfer(tokenAddr, to, amountBaseUnits) {
  // data = transfer(to, amount)
  const data =
    SEL_TRANSFER +
    encodeAddress(to) +
    encodeUint256(amountBaseUnits);

  const tx = {
    from: walletAddress,
    to: tokenAddr,
    data,
    // value omitted
  };
  return await window.ethereum.request({ method: "eth_sendTransaction", params: [tx] });
}

async function executeSplit() {
  if (!walletAddress) {
    setStatus("Connect your wallet first.", true);
    return;
  }
  if (currentChainId !== BSC_CHAIN_ID_DEC) {
    setStatus("Wrong network. Switch to BSC first.", true);
    return;
  }
  if (!isAddressLike(FEE_WALLET) || FEE_WALLET === "0x0000000000000000000000000000000000000000") {
    setStatus("Set your FEE_WALLET address in app.js first, then commit and redeploy.", true);
    return;
  }

  let plan;
  try {
    plan = computeSplitPlan();
  } catch (e) {
    setStatus(e.message || String(e), true);
    return;
  }

  // Confirm-ish by previewing
  renderPreview(plan);

  const sym = plan.mode === "bnb" ? "BNB" : ($("tokenSymbol").value.trim() || "TOKEN");

  try {
    setStatus(`Executing split… MetaMask will prompt multiple transactions.`);
    $("executeBtn").disabled = true;

    if (plan.mode === "bnb") {
      // Convert BNB amounts to wei
      const wei = (amt) => {
        // 18 decimals
        return toHex(amountToBaseUnits(String(amt), 18));
      };

      // 1) fee transfer
      await sendNativeBNB(FEE_WALLET, wei(plan.fee));

      // 2) recipients transfers
      for (const r of plan.recs) {
        const amt = plan.distributable * (r.pct / 100);
        await sendNativeBNB(r.address, wei(amt));
      }

    } else {
      const tokenAddr = $("tokenAddress").value.trim();
      if (!isAddressLike(tokenAddr)) {
        throw new Error("ERC-20 mode requires a valid token address.");
      }

      // decimals: read from UI (AUTO should have been loaded, but allow manual)
      const dec = parseInt($("tokenDecimals").value, 10);
      const decimals = Number.isFinite(dec) ? dec : 18;

      // Convert total amounts to base units
      const feeUnits = amountToBaseUnits(String(plan.fee), decimals);

      // 1) fee transfer
      await sendErc20Transfer(tokenAddr, FEE_WALLET, feeUnits);

      // 2) recipients transfers
      for (const r of plan.recs) {
        const amt = plan.distributable * (r.pct / 100);
        const units = amountToBaseUnits(String(amt), decimals);
        await sendErc20Transfer(tokenAddr, r.address, units);
      }
    }

    setStatus(`Split complete ✅ (${sym}).`);
  } catch (e) {
    setStatus(`Execution failed: ${e?.message || e}`, true);
  } finally {
    $("executeBtn").disabled = false;
  }
}

/* ---------- Event wiring ---------- */

function wireEvents() {
  $("connectBtn").onclick = connectWallet;
  $("switchBscBtn").onclick = switchToBSC;
  $("disconnectBtn").onclick = disconnectUI;

  $("addRecipientBtn").onclick = () => addRecipientRow("", "");
  $("normalizeBtn").onclick = normalizeTo100;

  $("loadTokenBtn").onclick = loadTokenMeta;

  $("amountInput").addEventListener("input", async () => {
    updateSummary();
    await refreshPriceAndValue();
  });

  $("tokenAddress").addEventListener("input", async () => {
    // price refresh when token changes
    await refreshPriceAndValue();
  });

  $("modeSelect").addEventListener("change", async () => {
    const mode = $("modeSelect").value;
    const tokenFields = (mode === "erc20");
    $("tokenAddress").disabled = !tokenFields;
    $("tokenSymbol").disabled = !tokenFields;
    $("tokenDecimals").disabled = !tokenFields;
    $("loadTokenBtn").disabled = !tokenFields;

    await refreshPriceAndValue();
    updateSummary();
  });

  $("previewBtn").onclick = () => {
    try {
      const plan = computeSplitPlan();
      renderPreview(plan);
      setStatus("Preview ready. If it looks correct, click EXECUTE SPLIT.");
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
  };

  $("executeBtn").onclick = executeSplit;

  // MetaMask event listeners
  if (window.ethereum) {
    window.ethereum.on("chainChanged", async () => {
      await detectNetwork();
      await refreshPriceAndValue();
    });
    window.ethereum.on("accountsChanged", async (accounts) => {
      walletAddress = accounts?.[0] || null;
      $("walletPill").innerHTML = `Wallet: <b>${walletAddress ? walletAddress.slice(0,6)+"…"+walletAddress.slice(-4) : "Disconnected"}</b>`;
      await refreshPriceAndValue();
    });
  }
}

async function init() {
  wireEvents();

  // Start with 2 recipient rows
  addRecipientRow("", "50");
  addRecipientRow("", "50");

  if (window.ethereum) {
    await detectNetwork();
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts?.[0]) {
      walletAddress = accounts[0];
      $("walletPill").innerHTML = `Wallet: <b>${walletAddress.slice(0,6)+"…"+walletAddress.slice(-4)}</b>`;
      setStatus("Wallet detected. Ready.");
    } else {
      setStatus("System initialized. Awaiting wallet connection and command execution.");
    }
  } else {
    $("networkPill").innerHTML = `Network: <b>—</b>`;
    setStatus("MetaMask not detected. Install MetaMask, then refresh.", true);
  }

  // default mode
  $("modeSelect").dispatchEvent(new Event("change"));
  updateSummary();
}

init();
