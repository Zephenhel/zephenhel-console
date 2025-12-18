/* ZEPHENHEL CITADEL — Tri-Chain Split UI (GitHub Pages)
   - BSC / ETH / POLY support
   - Token info + USD estimate via Dexscreener
   - Dynamic recipients + percent validation
   - Approve + Execute Split
*/

const CHAINS = {
  ETH: {
    key: "ETH",
    name: "Ethereum",
    chainId: 1,
    hex: "0x1",
    native: "ETH",
    explorer: "https://etherscan.io",
    splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    mmParams: null,
  },
  BSC: {
    key: "BSC",
    name: "BSC",
    chainId: 56,
    hex: "0x38",
    native: "BNB",
    explorer: "https://bscscan.com",
    splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
    mmParams: {
      chainId: "0x38",
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.binance.org/"],
      blockExplorerUrls: ["https://bscscan.com"],
    }
  },
  POLY: {
    key: "POLY",
    name: "Polygon",
    chainId: 137,
    hex: "0x89",
    native: "MATIC",
    explorer: "https://polygonscan.com",
    splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
    mmParams: {
      chainId: "0x89",
      chainName: "Polygon Mainnet",
      nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
      rpcUrls: ["https://polygon-rpc.com/"],
      blockExplorerUrls: ["https://polygonscan.com"],
    }
  }
};

let provider = null;
let signer = null;
let account = null;
let currentChain = null;

// Cache
let lastTokenMeta = null; // { address, symbol, decimals, name }
let lastTokenBalRaw = null; // BigNumber
let lastNativeBalRaw = null; // BigNumber
let lastUsd = null; // number

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

/*
  Splitter ABI — we include common candidates and choose the first that exists on-chain.
  Your contract only needs to match ONE of these for split to work.
*/
const SPLITTER_ABI = [
  // Most common signatures
  "function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external",
  "function splitERC20(address token, uint256 amount, address[] recipients, uint256[] percents) external",
  "function split(address token, uint256 amount, address[] recipients, uint256[] percents) external",
  "function executeSplit(address token, uint256 amount, address[] recipients, uint256[] percents) external"
];

function el(id){ return document.getElementById(id); }

function log(msg){
  const box = el("log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  box.textContent = line + box.textContent;
}

function showWarn(msg){
  const w = el("warnBox");
  w.style.display = "block";
  w.textContent = msg;
}
function clearWarn(){
  const w = el("warnBox");
  w.style.display = "none";
  w.textContent = "";
}

function shortAddr(a){
  if(!a) return "—";
  return a.slice(0,6) + "…" + a.slice(-4);
}

function isAddr(x){
  return /^0x[a-fA-F0-9]{40}$/.test((x||"").trim());
}

function toNum(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function setChainUI(){
  el("chainPill").textContent = `Chain: ${currentChain ? currentChain.name : "—"}`;
  el("splitterPill").textContent = `Splitter: ${currentChain ? shortAddr(currentChain.splitter) : "—"}`;
}

function detectChain(chainId){
  for(const k of Object.keys(CHAINS)){
    if(CHAINS[k].chainId === chainId) return CHAINS[k];
  }
  return null;
}

async function ensureProvider(){
  if(!window.ethereum) throw new Error("MetaMask not found.");
  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  return provider;
}

async function connect(){
  clearWarn();
  await ensureProvider();

  const accs = await provider.send("eth_requestAccounts", []);
  account = accs?.[0] || null;
  signer = provider.getSigner();

  const net = await provider.getNetwork();
  currentChain = detectChain(net.chainId);

  if(!currentChain){
    setChainUI();
    showWarn("Unsupported network. Please switch to BSC / Ethereum / Polygon.");
  } else {
    setChainUI();
  }

  el("walletLine").textContent = account ? `${account} (${currentChain ? currentChain.name : "Unknown"})` : "Disconnected";
  log(`Connected: ${account || "—"}`);
  await refreshBalances();
}

async function switchChain(){
  if(!window.ethereum) return;
  clearWarn();

  // Cycle chains: BSC -> ETH -> POLY -> BSC
  const order = ["BSC","ETH","POLY"];
  const curKey = currentChain?.key || "BSC";
  const idx = order.indexOf(curKey);
  const nextKey = order[(idx+1) % order.length];
  const target = CHAINS[nextKey];

  try{
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.hex }]
    });
  }catch(err){
    // If chain not added, add it (BSC/POLY commonly)
    if(err?.code === 4902 && target.mmParams){
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [target.mmParams]
      });
    } else {
      throw err;
    }
  }
}

async function refreshBalances(){
  if(!provider || !account) return;

  const net = await provider.getNetwork();
  currentChain = detectChain(net.chainId);
  setChainUI();

  // Native balance
  const nat = await provider.getBalance(account);
  lastNativeBalRaw = nat;

  const sym = currentChain?.native || "NATIVE";
  el("nativeBalLine").textContent = `${Number(ethers.utils.formatEther(nat)).toFixed(6)} ${sym}`;

  // Token details
  await refreshTokenInfoAndBalance();
}

async function refreshTokenInfoAndBalance(){
  lastTokenMeta = null;
  lastTokenBalRaw = null;
  lastUsd = null;

  el("tokenMeta").textContent = "—";
  el("tokenBal").textContent = "—";
  el("usdLine").textContent = "≈ $—";

  const tokenAddr = el("tokenAddress").value.trim();
  if(!isAddr(tokenAddr)) return;

  try{
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

    const [name, symbol, decimals, balRaw] = await Promise.all([
      token.name().catch(()=> "Token"),
      token.symbol().catch(()=> "TKN"),
      token.decimals().catch(()=> 18),
      token.balanceOf(account).catch(()=> ethers.constants.Zero),
    ]);

    lastTokenMeta = { address: tokenAddr, name, symbol, decimals };
    lastTokenBalRaw = balRaw;

    el("tokenMeta").textContent = `${name} • ${symbol} • ${decimals} decimals`;
    el("tokenBal").textContent = `Balance: ${Number(ethers.utils.formatUnits(balRaw, decimals)).toFixed(6)} ${symbol}`;

    await refreshUsdPrice(tokenAddr);

  }catch(e){
    log(`Token read failed: ${e.message || e}`);
    showWarn("Could not read token info. Check token address and network.");
  }
}

async function refreshUsdPrice(tokenAddr){
  try{
    // Dexscreener token endpoint
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const r = await fetch(url);
    const j = await r.json();

    const pairs = j?.pairs || [];
    if(!pairs.length) return;

    // pick pair that matches chain
    const want = currentChain?.key === "BSC" ? "bsc" : (currentChain?.key === "POLY" ? "polygon" : "ethereum");
    const match = pairs.find(p => (p.chainId || "").toLowerCase() === want) || pairs[0];

    const priceUsd = Number(match?.priceUsd || 0);
    if(!Number.isFinite(priceUsd) || priceUsd <= 0) return;

    lastUsd = priceUsd;

    // Show USD estimate for amount too (if typed)
    updateUsdEstimate();

  }catch(e){
    // silent (CORS or missing)
  }
}

function updateUsdEstimate(){
  const usdLine = el("usdLine");
  const amt = toNum(el("amount").value);

  if(!lastUsd || !Number.isFinite(lastUsd) || lastUsd <= 0){
    usdLine.textContent = "≈ $—";
    return;
  }

  // If token known, use token amount * priceUsd
  if(lastTokenMeta){
    const est = amt * lastUsd;
    usdLine.textContent = `≈ $${est.toFixed(2)} USD`;
  } else {
    usdLine.textContent = `≈ $—`;
  }
}

// -------- Recipients UI --------

function addRecipientRow(addr="", pct=""){
  const wrap = el("recipients");
  const row = document.createElement("div");
  row.className = "recRow";

  row.innerHTML = `
    <input class="input recAddr" placeholder="0x… recipient address" value="${addr}"/>
    <input class="input recPct" type="number" step="any" placeholder="%" value="${pct}"/>
    <button class="btn btn-ghost smallBtn recRemove" type="button">REMOVE</button>
  `;

  row.querySelector(".recRemove").addEventListener("click", () => {
    row.remove();
    updateTotalPct();
  });
  row.querySelector(".recPct").addEventListener("input", updateTotalPct);
  row.querySelector(".recAddr").addEventListener("input", updateTotalPct);

  wrap.appendChild(row);
  updateTotalPct();
}

function getRecipients(){
  const rows = Array.from(document.querySelectorAll("#recipients .recRow"));
  const recipients = [];
  const percents = [];

  for(const r of rows){
    const a = r.querySelector(".recAddr").value.trim();
    const p = toNum(r.querySelector(".recPct").value);

    recipients.push(a);
    percents.push(p);
  }
  return { recipients, percents };
}

function updateTotalPct(){
  const { percents } = getRecipients();
  const total = percents.reduce((s,x)=>s + (Number.isFinite(x)?x:0), 0);
  el("totalPct").textContent = total.toFixed(2).replace(/\.00$/,"");
}

// -------- MAX button --------

async function handleMax(){
  clearWarn();

  const tokenAddr = el("tokenAddress").value.trim();

  // Token MAX (safe; gas is native)
  if(isAddr(tokenAddr)){
    if(!lastTokenMeta || lastTokenMeta.address.toLowerCase() !== tokenAddr.toLowerCase()){
      await refreshTokenInfoAndBalance();
    }
    if(!lastTokenMeta || !lastTokenBalRaw){
      showWarn("Token balance not available. Check token address.");
      return;
    }
    const maxStr = ethers.utils.formatUnits(lastTokenBalRaw, lastTokenMeta.decimals);
    el("amount").value = maxStr;
    updateUsdEstimate();
    el("amountHint").textContent = `MAX set to token balance. Gas is paid in ${currentChain?.native || "native coin"}.`;
    return;
  }

  // Future-proof native MAX (if you later add native mode)
  if(!lastNativeBalRaw){
    await refreshBalances();
  }
  if(!lastNativeBalRaw){
    showWarn("Connect wallet first.");
    return;
  }

  // Reserve gas buffer
  let reserve;
  if(currentChain?.key === "BSC") reserve = ethers.utils.parseEther("0.003");
  else if(currentChain?.key === "POLY") reserve = ethers.utils.parseEther("0.30");
  else reserve = ethers.utils.parseEther("0.0015");

  const avail = lastNativeBalRaw.sub(reserve);
  if(avail.lte(0)){
    showWarn("Not enough native balance after gas reserve.");
    el("amount").value = "0";
    return;
  }

  el("amount").value = ethers.utils.formatEther(avail);
  el("amountHint").textContent = `MAX reserved gas (${ethers.utils.formatEther(reserve)} ${currentChain?.native || ""}).`;
}

// -------- Approve + Split --------

async function approve(){
  clearWarn();
  if(!signer || !account) return showWarn("Connect wallet first.");
  if(!currentChain) return showWarn("Unsupported network.");

  const tokenAddr = el("tokenAddress").value.trim();
  if(!isAddr(tokenAddr)) return showWarn("Enter a valid token address.");

  const amountStr = el("amount").value;
  const amtNum = toNum(amountStr);
  if(amtNum <= 0) return showWarn("Enter an amount > 0.");

  if(!lastTokenMeta || lastTokenMeta.address.toLowerCase() !== tokenAddr.toLowerCase()){
    await refreshTokenInfoAndBalance();
  }
  if(!lastTokenMeta) return showWarn("Could not read token metadata.");

  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const splitterAddr = currentChain.splitter;

  const amount = ethers.utils.parseUnits(amountStr, lastTokenMeta.decimals);

  // Check allowance
  const allowance = await token.allowance(account, splitterAddr);
  if(allowance.gte(amount)){
    log("Approve not needed (allowance already sufficient).");
    return;
  }

  log(`Approving ${lastTokenMeta.symbol} for splitter ${shortAddr(splitterAddr)}…`);
  const tx = await token.approve(splitterAddr, amount);
  log(`Approve tx sent: ${tx.hash}`);
  await tx.wait();
  log("Approve confirmed ✅");
}

function normalizePercentsToInts(percents){
  // Contract usually expects integer percents (sum=100)
  // We'll round to whole numbers. If you use decimals in your contract, tell me and I’ll switch it.
  return percents.map(p => Math.round(toNum(p)));
}

function validateInputs(){
  const tokenAddr = el("tokenAddress").value.trim();
  if(!isAddr(tokenAddr)) return "Enter a valid token address.";

  const amt = toNum(el("amount").value);
  if(!(amt > 0)) return "Enter an amount > 0.";

  const { recipients, percents } = getRecipients();
  if(recipients.length < 2) return "Add at least 2 recipients.";

  for(const a of recipients){
    if(!isAddr(a)) return "One or more recipient addresses are invalid.";
  }

  const pcts = normalizePercentsToInts(percents);
  const total = pcts.reduce((s,x)=>s+x,0);
  if(total !== 100) return `Total percent must equal 100. (Current: ${total})`;

  return null;
}

async function callSplitter(tokenAddr, amountBN, recipients, percentsInt){
  const splitter = new ethers.Contract(currentChain.splitter, SPLITTER_ABI, signer);

  // Try available function names in order, first that exists on-chain
  const candidates = ["splitToken","splitERC20","split","executeSplit"];

  for(const name of candidates){
    if(typeof splitter[name] === "function"){
      try{
        log(`Calling ${name}(token, amount, recipients, percents)…`);
        const tx = await splitter[name](tokenAddr, amountBN, recipients, percentsInt);
        return tx;
      }catch(e){
        // If function exists but reverts, surface it.
        // If it doesn't exist, ethers typically throws "is not a function" earlier.
        throw e;
      }
    }
  }
  throw new Error("No supported split function found on this splitter contract.");
}

async function split(){
  clearWarn();
  if(!signer || !account) return showWarn("Connect wallet first.");
  if(!currentChain) return showWarn("Unsupported network.");

  const err = validateInputs();
  if(err) return showWarn(err);

  const tokenAddr = el("tokenAddress").value.trim();
  const amountStr = el("amount").value;

  if(!lastTokenMeta || lastTokenMeta.address.toLowerCase() !== tokenAddr.toLowerCase()){
    await refreshTokenInfoAndBalance();
  }
  if(!lastTokenMeta) return showWarn("Could not read token metadata.");

  const amountBN = ethers.utils.parseUnits(amountStr, lastTokenMeta.decimals);

  // Optional preflight: ensure amount <= balance
  if(lastTokenBalRaw && amountBN.gt(lastTokenBalRaw)){
    return showWarn("Amount exceeds token balance.");
  }

  const { recipients, percents } = getRecipients();
  const percentsInt = normalizePercentsToInts(percents);

  try{
    log(`Executing split on ${currentChain.name}…`);
    const tx = await callSplitter(tokenAddr, amountBN, recipients, percentsInt);
    log(`Split tx sent: ${tx.hash}`);
    await tx.wait();
    log("Split confirmed ✅");
    await refreshBalances();
  }catch(e){
    const msg = e?.error?.message || e?.data?.message || e?.message || String(e);
    log(`Split failed: ${msg}`);
    showWarn(`Split failed: ${msg}`);
  }
}

// -------- Events --------

async function init(){
  // default recipient rows
  addRecipientRow("", "50");
  addRecipientRow("", "50");

  el("connectBtn").addEventListener("click", () => connect().catch(e => showWarn(e.message || String(e))));
  el("switchBtn").addEventListener("click", () => switchChain().catch(e => showWarn(e.message || String(e))));
  el("addRecipientBtn").addEventListener("click", () => addRecipientRow("", ""));

  el("maxBtn").addEventListener("click", () => handleMax().catch(e => showWarn(e.message || String(e))));
  el("approveBtn").addEventListener("click", () => approve().catch(e => showWarn(e.message || String(e))));
  el("splitBtn").addEventListener("click", () => split().catch(e => showWarn(e.message || String(e))));

  el("tokenAddress").addEventListener("input", () => {
    // Debounce-lite
    setTimeout(() => refreshTokenInfoAndBalance().catch(()=>{}), 250);
  });

  el("amount").addEventListener("input", updateUsdEstimate);

  // MetaMask listeners
  if(window.ethereum){
    window.ethereum.on("accountsChanged", async (accs) => {
      account = accs?.[0] || null;
      log(`Account changed: ${account || "—"}`);
      el("walletLine").textContent = account ? `${account} (${currentChain ? currentChain.name : "—"})` : "Disconnected";
      await refreshBalances().catch(()=>{});
    });

    window.ethereum.on("chainChanged", async () => {
      log("Chain changed.");
      await ensureProvider();
      const net = await provider.getNetwork();
      currentChain = detectChain(net.chainId);
      setChainUI();
      await refreshBalances().catch(()=>{});
    });
  }

  setChainUI();
  log("Citadel online. Connect wallet to begin.");
}

init();
