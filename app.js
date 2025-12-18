/* ZEPHENHEL CITADEL — Tri-chain Splitter + Vault shell (Edge/MetaMask) */

const { ethers } = window;
if (!ethers) alert("Ethers failed to load. Check index.html CDN.");

// ====== YOUR DEPLOYED ADDRESSES ======
const SPLITTER_BY_CHAIN = {
  56: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c", // BSC
  1: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2", // ETH
  137: "0x05948E68137eC131E1f0E27028d09fa174679ED4", // POLY
};

const VAULT_BY_CHAIN = {
  56: "0x69BD92784b9ED63a40d2cf51b475Ba68B37bD59E", // BSC inheritance
  1: "0x886f915D21A5BC540E86655a89e6223981D875d8", // ETH inheritance
  137: "0xde07160A2eC236315Dd27e9600f88Ba26F86f06e", // POLY inheritance
};

// ====== CHAINS (for switch) ======
const CHAINS = {
  56: { name: "BNB Chain", chainIdHex: "0x38" },
  1: { name: "Ethereum", chainIdHex: "0x1" },
  137: { name: "Polygon", chainIdHex: "0x89" },
};

// ====== Minimal ABIs for splitter + ERC20 ======
// We will auto-try common function signatures.
// Splitter contract could be:
// splitToken(token, amount, recipients, percents/bps)
// splitNative(recipients, percents/bps) OR splitNative(amount, recipients, percents/bps)
//
// We'll attempt multiple possibilities in order.
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const SPLITTER_ABI_CANDIDATES = {
  splitTokenA: ["function splitToken(address token,uint256 amount,address[] recipients,uint256[] percents)"],
  splitTokenB: ["function splitToken(address token,uint256 amount,address[] recipients,uint256[] bps)"],
  splitTokenC: ["function splitToken(address token,uint256 amount,address[] recipients,uint16[] bps)"],
  splitNativeA:["function splitNative(address[] recipients,uint256[] percents) payable"],
  splitNativeB:["function splitNative(address[] recipients,uint256[] bps) payable"],
  splitNativeC:["function splitNative(uint256 amount,address[] recipients,uint256[] bps) payable"],
  splitNativeD:["function splitNative(uint256 amount,address[] recipients,uint256[] percents) payable"],
};

// ====== UI refs ======
const el = (id) => document.getElementById(id);

const btnConnect = el("btnConnect");
const btnSwitch = el("btnSwitch");
const pillNet = el("pillNet");
const pillWallet = el("pillWallet");

const modeToken = el("modeToken");
const modeNative = el("modeNative");
const tokenModeFields = el("tokenModeFields");

const tokenAddress = el("tokenAddress");
const amountInput = el("amount");
const btnMax = el("btnMax");
const maxHint = el("maxHint");

const usdEstimate = el("usdEstimate");
const postFeeLine = el("postFeeLine");

const recipientsBox = el("recipients");
const btnAddRecipient = el("btnAddRecipient");
const totalPct = el("totalPct");

const btnApprove = el("btnApprove");
const btnExecute = el("btnExecute");

const nativeBal = el("nativeBal");
const tokenSym = el("tokenSym");
const tokenDec = el("tokenDec");
const tokenBal = el("tokenBal");
const allowanceEl = el("allowance");
const spenderAddr = el("spenderAddr");

const btnRefresh = el("btnRefresh");
const btnClearLog = el("btnClearLog");
const logEl = el("log");

const errBox = el("errBox");
const tagSplitter = el("tagSplitter");

const chkSound = el("chkSound");

// Tabs
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const tab = t.dataset.tab;
    el("tab-split").style.display = (tab === "split") ? "" : "none";
    el("tab-vault").style.display = (tab === "vault") ? "" : "none";
  });
});

// Vault
const vaultAddress = el("vaultAddress");
const vaultAbi = el("vaultAbi");
const btnLoadVault = el("btnLoadVault");
const vaultActions = el("vaultActions");
const vaultLog = el("vaultLog");
const vaultErr = el("vaultErr");
const btnClearVaultLog = el("btnClearVaultLog");

btnClearVaultLog.addEventListener("click", () => vaultLog.textContent = "");

// ====== State ======
let provider, signer, userAddr, chainId;
let currentSplitterAddr = null;
let currentVaultAddr = null;

let isNativeMode = false;

// For token info
let currentToken = null;
let currentTokenMeta = { symbol: null, decimals: 18 };

// Fee assumptions: we auto-detect by probing.
const DEFAULT_PLATFORM_FEE_BPS = 100; // 1%
// Native max gas reserve
let GAS_RESERVE_NATIVE = ethers.utils.parseEther("0.003"); // matches your earlier note (0.003 BNB)

// ====== Sound (WebAudio) ======
let audioCtx = null;
function ensureAudio() {
  if (!chkSound.checked) return null;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function beep({freq=440, dur=0.08, type="sine", gain=0.08, when=0}={}) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function radarPing() {
  // quick “ping sweep”
  beep({freq: 520, dur: 0.05, type:"sine", gain:0.10, when:0});
  beep({freq: 740, dur: 0.06, type:"sine", gain:0.10, when:0.06});
  beep({freq: 980, dur: 0.07, type:"sine", gain:0.10, when:0.13});
}
function coinBeat(count=2) {
  // “coins falling” = multiple little clicks with varying pitch
  const n = Math.max(1, Math.min(24, count));
  for (let i=0;i<n;i++){
    const f = 520 + (i%6)*90 + (Math.random()*40);
    beep({freq:f, dur:0.03, type:"triangle", gain:0.08, when:i*0.05});
  }
}

// ====== Helpers ======
function shortAddr(a){
  if (!a) return "—";
  return a.slice(0,6)+"…"+a.slice(-4);
}
function log(msg){
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function showError(msg){
  errBox.style.display = "";
  errBox.textContent = msg;
}
function clearError(){
  errBox.style.display = "none";
  errBox.textContent = "";
}
function vLog(msg){
  const time = new Date().toLocaleTimeString();
  vaultLog.textContent += `[${time}] ${msg}\n`;
  vaultLog.scrollTop = vaultLog.scrollHeight;
}
function showVaultError(msg){
  vaultErr.style.display = "";
  vaultErr.textContent = msg;
}
function clearVaultError(){
  vaultErr.style.display = "none";
  vaultErr.textContent = "";
}

function validAddress(a){
  try { return ethers.utils.isAddress(a); } catch { return false; }
}

function parseAmount(valueStr, decimals=18){
  const s = (valueStr||"").trim();
  if (!s) return null;
  try {
    return ethers.utils.parseUnits(s, decimals);
  } catch {
    return null;
  }
}

function formatUnitsSafe(x, decimals=18, maxFrac=6){
  try {
    const s = ethers.utils.formatUnits(x, decimals);
    const [i,f] = s.split(".");
    if (!f) return i;
    return i + "." + f.slice(0, maxFrac);
  } catch {
    return "—";
  }
}

async function getChainState(){
  chainId = await signer.getChainId();
  currentSplitterAddr = SPLITTER_BY_CHAIN[chainId] || null;
  currentVaultAddr = VAULT_BY_CHAIN[chainId] || null;

  pillNet.textContent = `Network: ${CHAINS[chainId]?.name || ("chainId "+chainId)}`;
  tagSplitter.textContent = `Splitter: ${currentSplitterAddr ? shortAddr(currentSplitterAddr) : "Unsupported network"}`;

  vaultAddress.value = currentVaultAddr || "";
  btnLoadVault.disabled = !currentVaultAddr;

  if (!currentSplitterAddr) {
    log("Unsupported network. Switch to BSC (56), Ethereum (1), or Polygon (137).");
  }
}

function setConnectedUI(connected){
  if (connected) {
    btnConnect.textContent = "CONNECTED";
    btnConnect.classList.add("connected");
    btnConnect.disabled = true;
  } else {
    btnConnect.textContent = "Connect";
    btnConnect.classList.remove("connected");
    btnConnect.disabled = false;
  }
}

function ensureRecipientsMin(){
  if (getRecipients().length === 0) {
    addRecipientRow("", 50);
    addRecipientRow("", 50);
  }
}

function getRecipients(){
  const rows = [...recipientsBox.querySelectorAll(".row")];
  return rows.map(r => ({
    address: r.querySelector(".addr").value.trim(),
    pct: Number(r.querySelector(".pct").value || 0)
  }));
}
function setTotalPct(){
  const rs = getRecipients();
  const sum = rs.reduce((a,b)=>a + (isFinite(b.pct)?b.pct:0), 0);
  totalPct.textContent = `${sum.toFixed(2)}%`;
}

function addRecipientRow(addr="", pct=50){
  const row = document.createElement("div");
  row.className = "row";

  const a = document.createElement("input");
  a.className = "addr";
  a.placeholder = "0xRecipient…";
  a.value = addr;
  a.spellcheck = false;

  const p = document.createElement("input");
  p.className = "pct";
  p.type = "number";
  p.min = "0";
  p.max = "100";
  p.step = "0.01";
  p.value = String(pct);

  const del = document.createElement("button");
  del.className = "iconbtn";
  del.textContent = "×";
  del.title = "Remove";

  a.addEventListener("input", validateAll);
  p.addEventListener("input", () => { setTotalPct(); validateAll(); });

  del.addEventListener("click", () => {
    row.remove();
    setTotalPct();
    validateAll();
  });

  row.appendChild(a);
  row.appendChild(p);
  row.appendChild(del);

  recipientsBox.appendChild(row);
  setTotalPct();
}

// ====== Mode switching ======
modeToken.addEventListener("click", () => {
  isNativeMode = false;
  modeToken.classList.add("active");
  modeNative.classList.remove("active");
  tokenModeFields.style.display = "";
  maxHint.textContent = "MAX is for native only. For tokens, enter a token amount.";
  validateAll();
});
modeNative.addEventListener("click", () => {
  isNativeMode = true;
  modeNative.classList.add("active");
  modeToken.classList.remove("active");
  tokenModeFields.style.display = "none";
  maxHint.textContent = "MAX uses your native balance minus reserved gas (default 0.003).";
  validateAll();
});

btnAddRecipient.addEventListener("click", () => {
  addRecipientRow("", 0);
  validateAll();
});

// ====== Connect / Switch ======
btnConnect.addEventListener("click", connectWallet);
btnSwitch.addEventListener("click", async () => {
  if (!window.ethereum) return alert("MetaMask not detected.");
  // rotate between chains
  const options = [56,1,137];
  const idx = Math.max(0, options.indexOf(chainId));
  const next = options[(idx+1) % options.length];
  await switchTo(next);
});

async function switchTo(targetChainId){
  try{
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAINS[targetChainId].chainIdHex }]
    });
  }catch(e){
    alert("Switch failed. Try switching inside MetaMask.");
  }
}

async function connectWallet(){
  clearError();
  if (!window.ethereum) return alert("MetaMask not detected.");

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddr = await signer.getAddress();

  pillWallet.textContent = `Wallet: ${shortAddr(userAddr)}`;
  setConnectedUI(true);
  radarPing();

  await getChainState();

  log(`Connected: ${userAddr} (chainId ${chainId})`);
  ensureRecipientsMin();
  await refreshTelemetry();
  validateAll();

  // listeners
  window.ethereum.on("accountsChanged", async (accs) => {
    if (!accs || !accs.length) {
      userAddr = null;
      pillWallet.textContent = "Wallet: Disconnected";
      setConnectedUI(false);
      return;
    }
    userAddr = accs[0];
    pillWallet.textContent = `Wallet: ${shortAddr(userAddr)}`;
    log(`Account changed: ${userAddr}`);
    await refreshTelemetry();
    validateAll();
  });

  window.ethereum.on("chainChanged", async () => {
    // force refresh chain state
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();
    chainId = await signer.getChainId();
    await getChainState();
    log(`Network changed. Now chainId ${chainId}`);
    await refreshTelemetry();
    validateAll();
  });
}

// ====== Dexscreener USD estimate ======
async function fetchDexUsd(chainId, tokenAddr){
  // best-effort: Dexscreener pair search by token
  // endpoint uses chain name: bsc / ethereum / polygon
  const chainName =
    chainId === 56 ? "bsc" :
    chainId === 1 ? "ethereum" :
    chainId === 137 ? "polygon" : null;

  if (!chainName) return null;

  try{
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!j || !j.pairs || !j.pairs.length) return null;

    // pick best pair on this chain by liquidity USD
    const pairs = j.pairs.filter(p => (p.chainId || "").toLowerCase() === chainName);
    const best = (pairs.length ? pairs : j.pairs).sort((a,b) => (b.liquidity?.usd||0) - (a.liquidity?.usd||0))[0];
    const price = Number(best.priceUsd || 0);
    if (!isFinite(price) || price <= 0) return null;
    return price;
  }catch{
    return null;
  }
}

// ====== Telemetry ======
btnRefresh.addEventListener("click", refreshTelemetry);
btnClearLog.addEventListener("click", () => logEl.textContent = "");

async function refreshTelemetry(){
  if (!signer || !userAddr) return;

  clearError();

  // native balance
  const bal = await provider.getBalance(userAddr);
  const sym = chainId === 56 ? "BNB" : chainId === 137 ? "MATIC" : "ETH";
  nativeBal.textContent = `${formatUnitsSafe(bal, 18, 6)} ${sym}`;

  // splitter address
  spenderAddr.textContent = currentSplitterAddr ? `Spender: ${currentSplitterAddr}` : "Spender: —";

  // token info if token mode + valid address
  if (!isNativeMode && validAddress(tokenAddress.value.trim())) {
    const tAddr = tokenAddress.value.trim();
    currentToken = new ethers.Contract(tAddr, ERC20_ABI, signer);

    try{
      const [s, d] = await Promise.all([currentToken.symbol(), currentToken.decimals()]);
      currentTokenMeta.symbol = s;
      currentTokenMeta.decimals = d;
      tokenSym.textContent = s;
      tokenDec.textContent = String(d);

      const [tb, al] = await Promise.all([
        currentToken.balanceOf(userAddr),
        currentToken.allowance(userAddr, currentSplitterAddr || ethers.constants.AddressZero)
      ]);

      tokenBal.textContent = `${formatUnitsSafe(tb, d, 6)} ${s}`;
      allowanceEl.textContent = `${formatUnitsSafe(al, d, 6)} ${s}`;

      // USD estimate
      const px = await fetchDexUsd(chainId, tAddr);
      const amt = parseFloat(amountInput.value || "0");
      if (px && isFinite(amt) && amt > 0) {
        const usd = amt * px;
        usdEstimate.textContent = `$${usd.toFixed(2)}`;
      } else {
        usdEstimate.textContent = "$—";
      }
    }catch(e){
      tokenSym.textContent = "—";
      tokenDec.textContent = "—";
      tokenBal.textContent = "—";
      allowanceEl.textContent = "—";
      usdEstimate.textContent = "$—";
      log(`Token read failed: ${e?.message || e}`);
    }
  } else {
    // native mode or invalid token
    tokenSym.textContent = isNativeMode ? "(native)" : "—";
    tokenDec.textContent = isNativeMode ? "18" : "—";
    tokenBal.textContent = "—";
    allowanceEl.textContent = "—";

    // USD estimate for native
    const amt = parseFloat(amountInput.value || "0");
    if (isNativeMode && amt > 0) {
      // Dexscreener token endpoint for native isn't consistent; leave blank.
      usdEstimate.textContent = "$—";
    } else {
      usdEstimate.textContent = "$—";
    }
  }

  updatePostFeePreview();
}

function updatePostFeePreview(){
  const feePct = 1; // UI display only
  const amt = parseFloat(amountInput.value || "0");
  if (!isFinite(amt) || amt <= 0) {
    postFeeLine.textContent = "You receive (post-fee): —";
    return;
  }
  const net = amt * (1 - feePct/100);
  postFeeLine.textContent = `You receive (post-fee): ${net.toFixed(6).replace(/0+$/,"").replace(/\.$/,"")}`;
}

// react to inputs
tokenAddress.addEventListener("input", async () => {
  validateAll();
  await refreshTelemetry();
});
amountInput.addEventListener("input", async () => {
  validateAll();
  updatePostFeePreview();
  await refreshTelemetry();
});

// ====== MAX (native only, reserve gas) ======
btnMax.addEventListener("click", async () => {
  if (!signer || !userAddr) return;
  if (!isNativeMode) {
    showError("MAX is only for native. For tokens, enter a token amount.");
    return;
  }
  clearError();
  const bal = await provider.getBalance(userAddr);
  const spendable = bal.sub(GAS_RESERVE_NATIVE);
  if (spendable.lte(0)) {
    showError("Not enough native balance after gas reserve.");
    return;
  }
  amountInput.value = ethers.utils.formatEther(spendable);
  updatePostFeePreview();
  await refreshTelemetry();
  validateAll();
});

// ====== Validation ======
function validateAll(){
  clearError();

  const connected = !!(signer && userAddr);
  btnExecute.disabled = true;
  btnApprove.disabled = true;

  if (!connected) return;

  if (!currentSplitterAddr) {
    showError("Unsupported network. Switch to BSC / Ethereum / Polygon.");
    return;
  }

  const rs = getRecipients();
  if (rs.length < 1) {
    showError("Add at least one recipient.");
    return;
  }

  // addresses valid
  for (const r of rs) {
    if (!validAddress(r.address)) {
      showError("One or more recipient addresses are invalid.");
      return;
    }
  }

  // percent sum
  const sum = rs.reduce((a,b)=>a + (isFinite(b.pct)?b.pct:0), 0);
  if (Math.abs(sum - 100) > 0.01) {
    showError("Recipient percents must total 100.00%.");
    return;
  }

  // amount
  const amt = (amountInput.value || "").trim();
  if (!amt || Number(amt) <= 0) {
    showError("Enter an amount greater than 0.");
    return;
  }

  // token mode requires token address
  if (!isNativeMode) {
    if (!validAddress(tokenAddress.value.trim())) {
      showError("Enter a valid token contract address.");
      return;
    }
    btnApprove.disabled = false;
  } else {
    // native mode = no approve
    btnApprove.disabled = true;
  }

  btnExecute.disabled = false;
}

// ====== Approve (tokens) ======
btnApprove.addEventListener("click", async () => {
  clearError();
  if (!currentToken || !currentSplitterAddr) {
    showError("Load a valid token address first.");
    return;
  }
  try{
    const dec = currentTokenMeta.decimals ?? 18;
    const amtUnits = parseAmount(amountInput.value, dec);
    if (!amtUnits) throw new Error("Bad amount for token decimals.");

    log(`Approving ${currentTokenMeta.symbol || "token"} for splitter ${shortAddr(currentSplitterAddr)}…`);
    const tx = await currentToken.approve(currentSplitterAddr, amtUnits);
    log(`Approve tx sent: ${tx.hash}`);
    await tx.wait();
    log("Approve confirmed ✅");
    await refreshTelemetry();
  }catch(e){
    showError(`Approve failed: ${humanErr(e)}`);
    log(`Approve failed: ${humanErr(e)}`);
  }
});

// ====== Percent scale auto-detection ======
function buildPercentsArray(scale, feeBpsAdjust=false){
  // user enters 0-100 percents
  const rs = getRecipients();
  const pcts = rs.map(r => r.pct);

  // if scale is 100 => send raw percents with 2 decimals folded? we keep integers
  // if scale is 10000 => basis points
  // if fee adjust => total becomes (scale - feeBps)
  let raw;

  if (scale === 10000) {
    raw = pcts.map(x => Math.round(x * 100)); // 50 -> 5000 bps
  } else if (scale === 100) {
    raw = pcts.map(x => Math.round(x)); // 50 -> 50
  } else {
    // generic: scale across 100
    raw = pcts.map(x => Math.round(x * (scale/100)));
  }

  // normalize rounding drift so sum matches expected
  const expected = feeBpsAdjust ? (scale - DEFAULT_PLATFORM_FEE_BPS) : scale;
  let sum = raw.reduce((a,b)=>a+b,0);
  let delta = expected - sum;
  if (delta !== 0) {
    // push delta into the largest share
    let idx = 0;
    for (let i=1;i<raw.length;i++){
      if (raw[i] > raw[idx]) idx = i;
    }
    raw[idx] += delta;
  }

  return raw;
}

async function tryCallStaticSplit({tokenAddr, amountUnits, recipients, percentsArr, valueWei, variantName}){
  const abi = SPLITTER_ABI_CANDIDATES[variantName];
  const c = new ethers.Contract(currentSplitterAddr, abi, signer);

  if (variantName.startsWith("splitToken")) {
    return await c.callStatic.splitToken(tokenAddr, amountUnits, recipients, percentsArr, { value: valueWei || 0 });
  } else {
    // native variants
    if (variantName === "splitNativeC" || variantName === "splitNativeD") {
      return await c.callStatic.splitNative(amountUnits, recipients, percentsArr, { value: valueWei });
    } else {
      return await c.callStatic.splitNative(recipients, percentsArr, { value: valueWei });
    }
  }
}

async function sendSplitTx({tokenAddr, amountUnits, recipients, percentsArr, valueWei, variantName}){
  const abi = SPLITTER_ABI_CANDIDATES[variantName];
  const c = new ethers.Contract(currentSplitterAddr, abi, signer);

  if (variantName.startsWith("splitToken")) {
    return await c.splitToken(tokenAddr, amountUnits, recipients, percentsArr);
  } else {
    if (variantName === "splitNativeC" || variantName === "splitNativeD") {
      return await c.splitNative(amountUnits, recipients, percentsArr, { value: valueWei });
    } else {
      return await c.splitNative(recipients, percentsArr, { value: valueWei });
    }
  }
}

// ====== Execute Split (auto-detect scale + fee) ======
btnExecute.addEventListener("click", async () => {
  clearError();
  if (!signer || !userAddr) return;

  try{
    const rs = getRecipients();
    const recipients = rs.map(r => ethers.utils.getAddress(r.address));
    if (!currentSplitterAddr) throw new Error("Unsupported network.");

    const soundCount = recipients.length;

    if (!isNativeMode) {
      // token split
      const tAddr = tokenAddress.value.trim();
      if (!validAddress(tAddr)) throw new Error("Invalid token address.");
      const dec = currentTokenMeta.decimals ?? 18;
      const amtUnits = parseAmount(amountInput.value, dec);
      if (!amtUnits) throw new Error("Invalid amount for token.");

      log(`Preflight: splitToken(token=${shortAddr(tAddr)}, amount=${formatUnitsSafe(amtUnits, dec, 6)}, recipients=${recipients.length})…`);

      // Try combos:
      // - scale 10000 total 10000
      // - scale 10000 total 9900 (fee adjust)
      // - scale 100 total 100
      const scalesToTry = [
        { scale: 10000, feeAdj: false },
        { scale: 10000, feeAdj: true },
        { scale: 100, feeAdj: false },
      ];

      const variants = ["splitTokenA", "splitTokenB", "splitTokenC"];

      let chosen = null;

      for (const v of variants){
        for (const s of scalesToTry){
          const perc = buildPercentsArray(s.scale, s.feeAdj);
          const sum = perc.reduce((a,b)=>a+b,0);
          log(`Preflight callStatic using ${v} scale=${s.scale} feeAdj=${s.feeAdj} sum=${sum}…`);
          try{
            await tryCallStaticSplit({
              tokenAddr: tAddr,
              amountUnits: amtUnits,
              recipients,
              percentsArr: perc,
              variantName: v
            });
            chosen = { variant: v, percents: perc, scale: s.scale, feeAdj: s.feeAdj };
            log(`Preflight OK ✅ using ${v} scale=${s.scale} feeAdj=${s.feeAdj}`);
            break;
          }catch(e){
            // keep trying
          }
        }
        if (chosen) break;
      }

      if (!chosen) {
        throw new Error("Preflight failed for all percent scales. This usually means the splitter expects a different percent rule or additional constraints.");
      }

      coinBeat(soundCount);

      log(`Sending split tx…`);
      const tx = await sendSplitTx({
        tokenAddr: tAddr,
        amountUnits: amtUnits,
        recipients,
        percentsArr: chosen.percents,
        variantName: chosen.variant
      });

      log(`Split tx sent: ${tx.hash}`);
      await tx.wait();
      log("Split confirmed ✅");
      await refreshTelemetry();

    } else {
      // native split
      const amtWei = ethers.utils.parseEther(String(amountInput.value));
      if (amtWei.lte(0)) throw new Error("Amount must be > 0.");

      log(`Preflight: splitNative(amount=${ethers.utils.formatEther(amtWei)}, recipients=${recipients.length})…`);

      const scalesToTry = [
        { scale: 10000, feeAdj: false },
        { scale: 10000, feeAdj: true },
        { scale: 100, feeAdj: false },
      ];
      const variants = ["splitNativeA","splitNativeB","splitNativeC","splitNativeD"];

      let chosen = null;

      for (const v of variants){
        for (const s of scalesToTry){
          const perc = buildPercentsArray(s.scale, s.feeAdj);
          const sum = perc.reduce((a,b)=>a+b,0);
          log(`Preflight callStatic using ${v} scale=${s.scale} feeAdj=${s.feeAdj} sum=${sum}…`);
          try{
            await tryCallStaticSplit({
              amountUnits: amtWei,
              recipients,
              percentsArr: perc,
              valueWei: amtWei,
              variantName: v
            });
            chosen = { variant: v, percents: perc, scale: s.scale, feeAdj: s.feeAdj };
            log(`Preflight OK ✅ using ${v} scale=${s.scale} feeAdj=${s.feeAdj}`);
            break;
          }catch(e){
            // keep trying
          }
        }
        if (chosen) break;
      }

      if (!chosen) {
        throw new Error("Preflight failed for all native split variants. The contract might use a different function name/signature.");
      }

      coinBeat(soundCount);

      log(`Sending native split tx…`);
      const tx = await sendSplitTx({
        amountUnits: amtWei,
        recipients,
        percentsArr: chosen.percents,
        valueWei: amtWei,
        variantName: chosen.variant
      });

      log(`Split tx sent: ${tx.hash}`);
      await tx.wait();
      log("Split confirmed ✅");
      await refreshTelemetry();
    }

  }catch(e){
    const m = humanErr(e);
    showError(`Split failed: ${m}`);
    log(`Split failed: ${m}`);
  }
});

function humanErr(e){
  const msg =
    e?.error?.message ||
    e?.data?.message ||
    e?.reason ||
    e?.message ||
    String(e);

  // common MetaMask message cleanup
  if (msg.includes("UNPREDICTABLE_GAS_LIMIT")) return "Cannot estimate gas (likely revert). Check percent scale / fee / rules.";
  if (msg.includes("execution reverted")) return msg;
  if (msg.includes("Internal JSON-RPC error")) return "Internal JSON-RPC error (often revert). Preflight passed? If yes, try again or increase gas.";
  return msg;
}

// ====== Vault: ABI-driven loader (so it can work with YOUR exact contract) ======
btnLoadVault.addEventListener("click", async () => {
  clearVaultError();
  try{
    if (!signer || !userAddr) throw new Error("Connect wallet first.");
    const vAddr = vaultAddress.value.trim();
    if (!validAddress(vAddr)) throw new Error("Invalid vault address.");

    let abi;
    try{
      abi = JSON.parse(vaultAbi.value.trim());
      if (!Array.isArray(abi)) throw new Error("ABI must be a JSON array.");
    }catch{
      throw new Error("Paste a valid ABI JSON array.");
    }

    const vault = new ethers.Contract(vAddr, abi, signer);
    vaultActions.innerHTML = "";

    // detect some common function names and build quick buttons
    const fns = abi.filter(x => x.type === "function").map(x => x.name);
    vLog(`Vault ABI loaded. Detected ${fns.length} functions.`);

    // Build a simple “function caller” dropdown for anything
    const wrap = document.createElement("div");
    wrap.className = "statbox";

    const selLabel = document.createElement("div");
    selLabel.className = "label";
    selLabel.textContent = "Call a function";

    const sel = document.createElement("select");
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select function…";
    sel.appendChild(opt0);

    for (const fn of fns){
      const o = document.createElement("option");
      o.value = fn;
      o.textContent = fn;
      sel.appendChild(o);
    }

    const argsLabel = document.createElement("div");
    argsLabel.className = "label";
    argsLabel.style.marginTop = "10px";
    argsLabel.textContent = "Args (JSON array)";

    const args = document.createElement("textarea");
    args.rows = 3;
    args.placeholder = `[ ] or ["0x...", 30]`;

    const btnRead = document.createElement("button");
    btnRead.className = "btn ghost";
    btnRead.textContent = "Call (read)";

    const btnWrite = document.createElement("button");
    btnWrite.className = "btn gold";
    btnWrite.textContent = "Send (write)";

    const row = document.createElement("div");
    row.className = "actions";
    row.style.marginTop = "10px";
    row.appendChild(btnRead);
    row.appendChild(btnWrite);

    wrap.appendChild(selLabel);
    wrap.appendChild(sel);
    wrap.appendChild(argsLabel);
    wrap.appendChild(args);
    wrap.appendChild(row);
    vaultActions.appendChild(wrap);

    btnRead.addEventListener("click", async () => {
      clearVaultError();
      try{
        const fn = sel.value;
        if (!fn) throw new Error("Select a function.");
        const a = JSON.parse(args.value || "[]");
        vLog(`read ${fn}(${JSON.stringify(a)})`);
        const out = await vault[fn](...a);
        vLog(`→ ${stringifyOut(out)}`);
      }catch(e){
        showVaultError(humanErr(e));
        vLog(`read failed: ${humanErr(e)}`);
      }
    });

    btnWrite.addEventListener("click", async () => {
      clearVaultError();
      try{
        const fn = sel.value;
        if (!fn) throw new Error("Select a function.");
        const a = JSON.parse(args.value || "[]");
        vLog(`write ${fn}(${JSON.stringify(a)})`);
        const tx = await vault[fn](...a);
        vLog(`tx: ${tx.hash}`);
        await tx.wait();
        vLog(`confirmed ✅`);
      }catch(e){
        showVaultError(humanErr(e));
        vLog(`write failed: ${humanErr(e)}`);
      }
    });

  }catch(e){
    showVaultError(humanErr(e));
  }
});

function stringifyOut(out){
  try{
    if (out?._isBigNumber) return out.toString();
    if (Array.isArray(out)) return JSON.stringify(out.map(x => x?._isBigNumber ? x.toString() : x));
    if (typeof out === "object") {
      const c = {};
      for (const k of Object.keys(out)) {
        const v = out[k];
        c[k] = v?._isBigNumber ? v.toString() : v;
      }
      return JSON.stringify(c);
    }
    return String(out);
  }catch{
    return String(out);
  }
}

// ====== Boot ======
btnLoadVault.disabled = true;
setConnectedUI(false);
ensureRecipientsMin();
validateAll();

// Enable vault loader after connect
(function init(){
  if (!window.ethereum) {
    showError("MetaMask not detected. Install MetaMask extension (Edge) and refresh.");
    return;
  }
  // try to show chain if already available (without requesting)
  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  provider.getNetwork().then(n => {
    chainId = n.chainId;
    pillNet.textContent = `Network: ${CHAINS[chainId]?.name || ("chainId "+chainId)}`;
  }).catch(()=>{});
})();

// enable vault load button when connected & address exists
setInterval(() => {
  btnLoadVault.disabled = !(signer && userAddr && validAddress(vaultAddress.value.trim()));
}, 500);
