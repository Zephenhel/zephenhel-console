/* ZEPHENHEL CITADEL — Tri-Chain Splitter UI (GitHub Pages)
   - Networks: BSC / ETH / POLY
   - Connect + auto-switch chain
   - ERC20 approve -> splitter
   - Execute split using splitter contract function below
   - DexScreener USD estimate
*/

/* ========= 1) CONFIG: YOUR SPLITTER ADDRESSES ========= */
const CHAINS = {
  BSC: {
    key: "BSC",
    name: "BSC",
    chainIdHex: "0x38",
    chainIdDec: 56,
    native: "BNB",
    dexChain: "bsc",
    splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c", // <-- your BSC splitter (from your screenshot)
    rpcAddParams: {
      chainId: "0x38",
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.binance.org/"],
      blockExplorerUrls: ["https://bscscan.com/"]
    }
  },
  ETH: {
    key: "ETH",
    name: "Ethereum",
    chainIdHex: "0x1",
    chainIdDec: 1,
    native: "ETH",
    dexChain: "ethereum",
    splitter: "PASTE_YOUR_ETH_SPLITTER_ADDRESS_HERE",
    rpcAddParams: null // MetaMask always has ETH
  },
  POLY: {
    key: "POLY",
    name: "Polygon",
    chainIdHex: "0x89",
    chainIdDec: 137,
    native: "MATIC",
    dexChain: "polygon",
    splitter: "PASTE_YOUR_POLYGON_SPLITTER_ADDRESS_HERE",
    rpcAddParams: {
      chainId: "0x89",
      chainName: "Polygon",
      nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
      rpcUrls: ["https://polygon-rpc.com/"],
      blockExplorerUrls: ["https://polygonscan.com/"]
    }
  }
};

/* ========= 2) SPLITTER CONTRACT CALL (MATCH YOUR CONTRACT) =========
   Your prior version “worked”, so keep the same function shape.
   This UI calls:
     splitter.splitToken(token, amountWei, recipients[], percents[])
   If your function name differs, change SPLIT_FN below + ABI fragment.
*/
const SPLIT_FN = "splitToken";
const SPLITTER_ABI = [
  `function ${SPLIT_FN}(address token, uint256 amount, address[] calldata recipients, uint256[] calldata percents) external`,
];

/* ERC20 ABI */
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

/* ========= UI ELEMENTS ========= */
const el = (id) => document.getElementById(id);

const networkSelect = el("networkSelect");
const connectBtn = el("connectBtn");
const walletStatus = el("walletStatus");
const splitterAddress = el("splitterAddress");
const tokenAddress = el("tokenAddress");
const tokenAmount = el("tokenAmount");
const tokenMeta = el("tokenMeta");
const usdEstimate = el("usdEstimate");
const usdHint = el("usdHint");
const recipientsWrap = el("recipients");
const addRecipientBtn = el("addRecipientBtn");
const totalPct = el("totalPct");
const approveBtn = el("approveBtn");
const splitBtn = el("splitBtn");
const logBox = el("log");
const clearLogBtn = el("clearLogBtn");

let provider, signer, userAddress;
let currentChain = CHAINS.BSC;
let tokenCache = { address: null, decimals: 18, symbol: "TOKEN", priceUsd: null };

/* ========= HELPERS ========= */
function log(msg, type="info"){
  const t = new Date().toLocaleTimeString();
  const prefix = type === "err" ? "✖" : type === "ok" ? "✔" : "•";
  logBox.textContent += `[${t}] ${prefix} ${msg}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function shortAddr(a){
  if(!a) return "";
  return a.slice(0,6) + "…" + a.slice(-4);
}

function setWalletStatus(text, ok=false){
  walletStatus.textContent = text;
  walletStatus.style.color = ok ? "var(--ok)" : "var(--text)";
}

function isAddr(a){
  try { return ethers.utils.isAddress(a); } catch { return false; }
}

function getRecipientRows(){
  return Array.from(recipientsWrap.querySelectorAll(".rec-row"));
}

function calcTotalPct(){
  let total = 0;
  for(const row of getRecipientRows()){
    const pct = Number(row.querySelector(".pct").value || 0);
    total += pct;
  }
  totalPct.textContent = `${total}%`;
  totalPct.style.color = (total === 100) ? "var(--ok)" : "var(--gold2)";
  return total;
}

function addRecipientRow(address="", pct=""){
  const row = document.createElement("div");
  row.className = "rec-row";

  row.innerHTML = `
    <input class="input mono addr" type="text" placeholder="Recipient 0x..." value="${address}" />
    <input class="input pct" type="number" min="0" max="100" step="1" placeholder="%" value="${pct}" />
    <button class="btn btn-ghost remove">REMOVE</button>
  `;

  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    calcTotalPct();
    updateUsdEstimate();
  });

  row.querySelector(".pct").addEventListener("input", () => {
    calcTotalPct();
    updateUsdEstimate();
  });
  row.querySelector(".addr").addEventListener("input", () => updateUsdEstimate());

  recipientsWrap.appendChild(row);
  calcTotalPct();
}

/* ========= NETWORK SWITCH ========= */
async function ensureMetaMask(){
  if(!window.ethereum){
    log("MetaMask not detected. Install/enable it, then refresh.", "err");
    alert("MetaMask not detected. Please install/enable MetaMask and refresh.");
    return false;
  }
  return true;
}

async function switchToChain(chain){
  if(!await ensureMetaMask()) return false;

  try{
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainIdHex }]
    });
    return true;
  }catch(e){
    // If chain not added (BSC/Polygon), try add
    if(e && (e.code === 4902) && chain.rpcAddParams){
      try{
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [chain.rpcAddParams]
        });
        return true;
      }catch(addErr){
        log(`Could not add ${chain.name}: ${addErr.message || addErr}`, "err");
        return false;
      }
    }
    log(`Could not switch to ${chain.name}: ${e.message || e}`, "err");
    return false;
  }
}

/* ========= CONNECT ========= */
async function connect(){
  if(!await ensureMetaMask()) return;

  const ok = await switchToChain(currentChain);
  if(!ok) return;

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = await signer.getAddress();

  setWalletStatus(shortAddr(userAddress), true);
  connectBtn.textContent = "CONNECTED";
  connectBtn.disabled = true;

  log(`Wallet connected: ${userAddress}`, "ok");

  // React to account/network changes
  window.ethereum.on("accountsChanged", async (accounts) => {
    if(!accounts || !accounts.length){
      location.reload();
      return;
    }
    userAddress = accounts[0];
    setWalletStatus(shortAddr(userAddress), true);
    log(`Account changed: ${userAddress}`, "info");
    tokenCache.address = null;
    await refreshTokenMeta();
  });

  window.ethereum.on("chainChanged", async () => {
    log("Chain changed. Reloading to resync.", "info");
    location.reload();
  });

  await refreshTokenMeta();
}

/* ========= TOKEN META + DEXSCREENER PRICE ========= */
async function fetchDexPriceUsd(chainSlug, token){
  try{
    const url = `https://api.dexscreener.com/latest/dex/tokens/${token}`;
    const res = await fetch(url);
    const data = await res.json();
    const pairs = (data && data.pairs) ? data.pairs : [];
    // pick first pair that matches the chain
    const p = pairs.find(x => (x.chainId || "").toLowerCase() === chainSlug.toLowerCase())
           || pairs.find(x => (x.chainId || "").toLowerCase().includes(chainSlug.toLowerCase()))
           || pairs[0];

    if(p && p.priceUsd) return Number(p.priceUsd);
  }catch(e){
    // ignore
  }
  return null;
}

async function refreshTokenMeta(){
  const addr = (tokenAddress.value || "").trim();
  if(!isAddr(addr)){
    tokenMeta.textContent = "Token — Decimals — Price —";
    tokenCache = { address: null, decimals: 18, symbol: "TOKEN", priceUsd: null };
    updateUsdEstimate();
    return;
  }

  if(tokenCache.address && tokenCache.address.toLowerCase() === addr.toLowerCase()){
    updateUsdEstimate();
    return;
  }

  try{
    if(!signer){
      // allow reading without connect? try public provider via MetaMask if possible
      provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      signer = provider.getSigner();
    }
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol()]);
    tokenCache.address = addr;
    tokenCache.decimals = decimals;
    tokenCache.symbol = symbol;

    tokenMeta.textContent = `${symbol} — Decimals: ${decimals} — Price: loading…`;

    const price = await fetchDexPriceUsd(currentChain.dexChain, addr);
    tokenCache.priceUsd = price;

    tokenMeta.textContent = `${symbol} — Decimals: ${decimals} — Price: ${price ? `$${price}` : "N/A"}`;
    log(`Token loaded: ${symbol} (decimals ${decimals}) | price ${price ? `$${price}` : "N/A"}`, "ok");

    updateUsdEstimate();
  }catch(e){
    log(`Token meta error: ${e.message || e}`, "err");
    tokenMeta.textContent = "Token — Decimals — Price —";
    tokenCache = { address: null, decimals: 18, symbol: "TOKEN", priceUsd: null };
    updateUsdEstimate();
  }
}

function updateUsdEstimate(){
  const amt = Number(tokenAmount.value || 0);
  const price = tokenCache.priceUsd;
  if(!amt || amt <= 0 || !price){
    usdEstimate.textContent = "$0.00";
    usdHint.textContent = price ? "Enter amount" : "Price unavailable (DexScreener)";
    return;
  }
  const est = amt * price;
  usdEstimate.textContent = est.toLocaleString(undefined, { style:"currency", currency:"USD" });
  usdHint.textContent = `≈ ${amt} ${tokenCache.symbol} @ $${price}`;
}

/* ========= APPROVE + SPLIT ========= */
function validateSplitInputs(){
  const token = (tokenAddress.value || "").trim();
  if(!isAddr(token)) return { ok:false, msg:"Invalid token address." };

  const amt = tokenAmount.value;
  if(!amt || Number(amt) <= 0) return { ok:false, msg:"Enter an amount > 0." };

  const rows = getRecipientRows();
  if(rows.length < 1) return { ok:false, msg:"Add at least 1 recipient." };

  const recipients = [];
  const percents = [];
  for(const r of rows){
    const a = (r.querySelector(".addr").value || "").trim();
    const p = Number(r.querySelector(".pct").value || 0);

    if(!isAddr(a)) return { ok:false, msg:"One of the recipient addresses is invalid." };
    if(p <= 0) return { ok:false, msg:"Each recipient must have a percent > 0." };

    recipients.push(a);
    percents.push(p);
  }

  const total = percents.reduce((x,y)=>x+y,0);
  if(total !== 100) return { ok:false, msg:`Total percent must equal 100. Current: ${total}.` };

  return { ok:true, token, amt: String(amt), recipients, percents };
}

async function approve(){
  if(!signer) return alert("Connect wallet first.");
  const v = validateSplitInputs();
  if(!v.ok) return alert(v.msg);

  try{
    approveBtn.disabled = true;
    approveBtn.textContent = "APPROVING…";

    const token = new ethers.Contract(v.token, ERC20_ABI, signer);
    const amountWei = ethers.utils.parseUnits(v.amt, tokenCache.decimals);

    // Approve EXACT amount (simple + safe)
    const tx = await token.approve(currentChain.splitter, amountWei);
    log(`Approve sent: ${tx.hash}`, "info");
    await tx.wait();
    log("Approve confirmed.", "ok");
    alert("Approve confirmed.");
  }catch(e){
    log(`Approve failed: ${e.message || e}`, "err");
    alert(`Approve failed: ${e.message || e}`);
  }finally{
    approveBtn.disabled = false;
    approveBtn.textContent = "APPROVE";
  }
}

async function executeSplit(){
  if(!signer) return alert("Connect wallet first.");
  const v = validateSplitInputs();
  if(!v.ok) return alert(v.msg);

  try{
    splitBtn.disabled = true;
    splitBtn.textContent = "EXECUTING…";

    const amountWei = ethers.utils.parseUnits(v.amt, tokenCache.decimals);

    const splitter = new ethers.Contract(currentChain.splitter, SPLITTER_ABI, signer);

    // If your splitter uses a different function name/signature,
    // change SPLIT_FN + SPLITTER_ABI at the top.
    const tx = await splitter[SPLIT_FN](v.token, amountWei, v.recipients, v.percents);
    log(`Split sent: ${tx.hash}`, "info");
    await tx.wait();
    log("Split confirmed.", "ok");
    alert("Split confirmed.");
  }catch(e){
    log(`Split failed: ${e.message || e}`, "err");
    alert(`Split failed: ${e.message || e}`);
  }finally{
    splitBtn.disabled = false;
    splitBtn.textContent = "EXECUTE SPLIT";
  }
}

/* ========= INIT ========= */
function setChain(key){
  currentChain = CHAINS[key];
  splitterAddress.value = currentChain.splitter;
  log(`Network set: ${currentChain.name}`, "info");
  tokenCache.address = null; // force refresh
  refreshTokenMeta();
}

function init(){
  // default recipients (you can remove these anytime)
  addRecipientRow("", "");
  addRecipientRow("", "");

  setChain(networkSelect.value);

  networkSelect.addEventListener("change", async () => {
    setChain(networkSelect.value);

    // if already connected, switch chain immediately
    if(userAddress){
      connectBtn.disabled = false;
      connectBtn.textContent = "CONNECT";
      setWalletStatus("Disconnected", false);
      provider = null; signer = null; userAddress = null;
      await connect();
    }
  });

  connectBtn.addEventListener("click", connect);
  addRecipientBtn.addEventListener("click", () => addRecipientRow("", ""));
  approveBtn.addEventListener("click", approve);
  splitBtn.addEventListener("click", executeSplit);

  tokenAddress.addEventListener("input", () => refreshTokenMeta());
  tokenAmount.addEventListener("input", () => updateUsdEstimate());

  clearLogBtn.addEventListener("click", () => logBox.textContent = "");

  splitterAddress.value = currentChain.splitter;

  log("Boot complete. Select network → Connect → Paste token → Set recipients → Approve → Execute.", "ok");
}

init();
