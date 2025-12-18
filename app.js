const SPLITTER_ABI_CANDIDATES = [
  // name variations (same params)
  "function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external",
  "function split(address token, uint256 amount, address[] recipients, uint256[] percents) external",
  "function distribute(address token, uint256 amount, address[] recipients, uint256[] percents) external",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const CHAINS = {
  BSC: {
    key: "BSC",
    name: "BSC",
    chainIdHex: "0x38",
    dexChain: "bsc",
    splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
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
    dexChain: "ethereum",
    splitter: "PASTE_YOUR_ETH_SPLITTER_ADDRESS_HERE",
    rpcAddParams: null
  },
  POLY: {
    key: "POLY",
    name: "Polygon",
    chainIdHex: "0x89",
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

const $ = (id) => document.getElementById(id);

const networkSelect = $("networkSelect");
const connectBtn = $("connectBtn");
const switchBtn = $("switchBtn");
const visitDexBtn = $("visitDexBtn");

const walletStatus = $("walletStatus");
const splitterAddress = $("splitterAddress");
const splitterShort = $("splitterShort");

const tokenAddress = $("tokenAddress");
const tokenAmount = $("tokenAmount");
const usdEstimate = $("usdEstimate");

const tokenSymbol = $("tokenSymbol");
const tokenDecimals = $("tokenDecimals");
const tokenPrice = $("tokenPrice");

const tokenBalance = $("tokenBalance");
const tokenBalanceUsd = $("tokenBalanceUsd");

const allowanceEl = $("allowance");
const approvalState = $("approvalState");

const recipientsWrap = $("recipients");
const addRecipientBtn = $("addRecipientBtn");
const evenSplitBtn = $("evenSplitBtn");
const autoFixBtn = $("autoFixBtn");
const savePresetBtn = $("savePresetBtn");
const loadPresetBtn = $("loadPresetBtn");
const clearRecipientsBtn = $("clearRecipientsBtn");
const totalPct = $("totalPct");

const approveBtn = $("approveBtn");
const splitBtn = $("splitBtn");

const refreshIntelBtn = $("refreshIntelBtn");
const clearLogBtn = $("clearLogBtn");
const logBox = $("log");

let currentChain = CHAINS.BSC;

let provider = null;
let signer = null;
let userAddress = null;

let tokenCache = {
  address: null,
  decimals: 18,
  symbol: null,
  priceUsd: null
};

function log(msg, type="info"){
  const t = new Date().toLocaleTimeString();
  const icon = type === "err" ? "✖" : type === "ok" ? "✔" : type === "warn" ? "!" : "•";
  logBox.textContent += `[${t}] ${icon} ${msg}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function setBadge(text, kind="dim"){
  approvalState.textContent = text;
  approvalState.style.color =
    kind === "ok" ? "var(--ok)" :
    kind === "bad" ? "var(--bad)" :
    kind === "warn" ? "var(--warn)" :
    "var(--muted)";
}

function shortAddr(a){
  if(!a) return "—";
  return a.slice(0,6) + "…" + a.slice(-4);
}

function isAddr(a){
  try { return ethers.utils.isAddress(a); } catch { return false; }
}

async function ensureMetaMask(){
  if(!window.ethereum){
    alert("MetaMask not detected. Please install/enable MetaMask then refresh.");
    log("MetaMask not detected.", "err");
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
    if(e && e.code === 4902 && chain.rpcAddParams){
      try{
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [chain.rpcAddParams]
        });
        return true;
      }catch(addErr){
        log(`Add chain failed: ${addErr.message || addErr}`, "err");
        return false;
      }
    }
    log(`Switch chain failed: ${e.message || e}`, "err");
    return false;
  }
}

function setChain(key){
  currentChain = CHAINS[key];
  splitterAddress.value = currentChain.splitter;
  splitterShort.textContent = shortAddr(currentChain.splitter);
  tokenCache.address = null;
  renderTokenIntelBlank();
  renderWalletIntelBlank();
  renderApprovalBlank();
  updateUsdEstimateOnly();
  log(`Network selected: ${currentChain.name}`, "info");
}

function renderTokenIntelBlank(){
  tokenSymbol.textContent = "—";
  tokenDecimals.textContent = "—";
  tokenPrice.textContent = "—";
}
function renderWalletIntelBlank(){
  tokenBalance.textContent = "—";
  tokenBalanceUsd.textContent = "—";
}
function renderApprovalBlank(){
  allowanceEl.textContent = "—";
  setBadge("—", "dim");
}

async function connectWallet(){
  if(!await ensureMetaMask()) return;

  const ok = await switchToChain(currentChain);
  if(!ok) return;

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = await signer.getAddress();

  walletStatus.textContent = shortAddr(userAddress);
  walletStatus.style.color = "var(--ok)";
  connectBtn.textContent = "CONNECTED";
  connectBtn.disabled = true;

  log(`Connected wallet: ${userAddress}`, "ok");

  window.ethereum.on("accountsChanged", () => location.reload());
  window.ethereum.on("chainChanged", () => location.reload());

  await refreshAllIntel();
}

async function fetchDexPriceUsd(token){
  try{
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    const data = await res.json();
    const pairs = data?.pairs || [];
    const p =
      pairs.find(x => (x.chainId || "").toLowerCase() === currentChain.dexChain) ||
      pairs[0];
    return p?.priceUsd ? Number(p.priceUsd) : null;
  }catch{
    return null;
  }
}

async function refreshTokenIntel(){
  const addr = (tokenAddress.value || "").trim();
  if(!isAddr(addr)){
    tokenCache.address = null;
    renderTokenIntelBlank();
    updateUsdEstimateOnly();
    return;
  }

  try{
    if(!provider) provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    const token = new ethers.Contract(addr, ERC20_ABI, provider);

    const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol()]);
    tokenCache.address = addr;
    tokenCache.decimals = decimals;
    tokenCache.symbol = symbol;

    tokenSymbol.textContent = symbol;
    tokenDecimals.textContent = String(decimals);
    tokenPrice.textContent = "Loading…";

    const price = await fetchDexPriceUsd(addr);
    tokenCache.priceUsd = price;
    tokenPrice.textContent = price ? `$${price}` : "N/A";

    updateUsdEstimateOnly();
  }catch(e){
    log(`Token intel failed: ${e.message || e}`, "err");
    tokenCache.address = null;
    renderTokenIntelBlank();
  }
}

async function refreshWalletIntel(){
  if(!userAddress || !provider) return;
  const addr = (tokenAddress.value || "").trim();
  if(!isAddr(addr) || !tokenCache.address){
    renderWalletIntelBlank();
    return;
  }
  try{
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const balWei = await token.balanceOf(userAddress);
    const bal = Number(ethers.utils.formatUnits(balWei, tokenCache.decimals));
    tokenBalance.textContent = `${bal.toLocaleString(undefined,{maximumFractionDigits:6})} ${tokenCache.symbol||""}`;

    if(tokenCache.priceUsd){
      const usd = bal * tokenCache.priceUsd;
      tokenBalanceUsd.textContent = usd.toLocaleString(undefined,{style:"currency",currency:"USD"});
    } else tokenBalanceUsd.textContent = "N/A";
  }catch(e){
    log(`Wallet balance failed: ${e.message || e}`, "err");
    renderWalletIntelBlank();
  }
}

async function refreshAllowanceIntel(){
  if(!userAddress || !provider) return;
  const addr = (tokenAddress.value || "").trim();
  if(!isAddr(addr) || !tokenCache.address){
    renderApprovalBlank();
    return;
  }
  try{
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const allowanceWei = await token.allowance(userAddress, currentChain.splitter);
    const allowance = Number(ethers.utils.formatUnits(allowanceWei, tokenCache.decimals));
    allowanceEl.textContent = allowance.toLocaleString(undefined,{maximumFractionDigits:6});

    const needed = Number(tokenAmount.value || 0);
    if(!needed || needed <= 0){ setBadge("ENTER AMOUNT","warn"); return; }
    setBadge(allowance >= needed ? "APPROVED" : "APPROVE NEEDED", allowance >= needed ? "ok" : "bad");
  }catch(e){
    log(`Allowance failed: ${e.message || e}`, "err");
    renderApprovalBlank();
  }
}

async function refreshAllIntel(){
  await refreshTokenIntel();
  await refreshWalletIntel();
  await refreshAllowanceIntel();
}

function updateUsdEstimateOnly(){
  const amt = Number(tokenAmount.value || 0);
  if(!amt || amt <= 0){ usdEstimate.textContent = "$0.00"; return; }
  if(!tokenCache.priceUsd){ usdEstimate.textContent = "USD: N/A"; return; }
  usdEstimate.textContent = (amt * tokenCache.priceUsd).toLocaleString(undefined,{style:"currency",currency:"USD"});
}

function getRows(){ return Array.from(recipientsWrap.querySelectorAll(".rec-row")); }

function calcTotal(){
  let t=0;
  for(const r of getRows()) t += Number(r.querySelector(".pct").value || 0);
  totalPct.textContent = `${t}%`;
  totalPct.style.color = (t===100) ? "var(--ok)" : "var(--gold2)";
  return t;
}

function addRecipientRow(address="", pct=""){
  const row = document.createElement("div");
  row.className="rec-row";
  row.innerHTML = `
    <input class="input mono addr" placeholder="Recipient 0x..." value="${address}" />
    <input class="input pct" type="number" min="0" max="100" step="1" placeholder="%" value="${pct}" />
    <button class="btn btn-ghost remove">REMOVE</button>
  `;
  row.querySelector(".remove").addEventListener("click", ()=>{ row.remove(); calcTotal(); });
  row.querySelector(".pct").addEventListener("input", ()=>calcTotal());
  recipientsWrap.appendChild(row);
  calcTotal();
}

function evenSplit(){
  const rows=getRows(); if(!rows.length) return;
  const base=Math.floor(100/rows.length);
  let rem=100-base*rows.length;
  for(const r of rows){
    const v=base+(rem>0?1:0);
    if(rem>0) rem--;
    r.querySelector(".pct").value=v;
  }
  calcTotal();
}

function autoFixTo100(){
  const rows=getRows(); if(!rows.length) return;
  let p=rows.map(r=>Math.max(0,Number(r.querySelector(".pct").value||0)));
  let sum=p.reduce((a,b)=>a+b,0);
  if(sum===0){ evenSplit(); return; }
  let norm=p.map(x=>(x/sum)*100);
  let rounded=norm.map(x=>Math.floor(x));
  let rsum=rounded.reduce((a,b)=>a+b,0);
  let leftover=100-rsum;
  const frac=norm.map((x,i)=>({i,f:x-Math.floor(x)})).sort((a,b)=>b.f-a.f);
  for(let k=0;k<leftover;k++) rounded[frac[k%frac.length].i]+=1;
  rows.forEach((r,i)=>r.querySelector(".pct").value=rounded[i]);
  calcTotal();
}

function clearRecipients(){ recipientsWrap.innerHTML=""; calcTotal(); }

function validateInputs(){
  if(!signer || !userAddress) return {ok:false,msg:"Connect wallet first."};
  if(!isAddr(currentChain.splitter)) return {ok:false,msg:"Splitter address missing for this chain."};

  const token=(tokenAddress.value||"").trim();
  if(!isAddr(token)) return {ok:false,msg:"Invalid token address."};

  const amtStr=String(tokenAmount.value||"");
  const amtNum=Number(amtStr);
  if(!amtStr || !amtNum || amtNum<=0) return {ok:false,msg:"Enter an amount > 0."};

  const rows=getRows();
  if(rows.length<1) return {ok:false,msg:"Add at least 1 recipient."};

  const recipients=[], percents=[];
  for(const r of rows){
    const a=(r.querySelector(".addr").value||"").trim();
    const p=Number(r.querySelector(".pct").value||0);
    if(!isAddr(a)) return {ok:false,msg:"One recipient address is invalid."};
    if(p<=0) return {ok:false,msg:"Each recipient % must be > 0."};
    recipients.push(a);
    percents.push(p);
  }

  const total=percents.reduce((a,b)=>a+b,0);
  if(total!==100) return {ok:false,msg:`Total % must equal 100. Current: ${total}.`};

  return {ok:true, token, amtStr, recipients, percents};
}

async function approve(){
  const v=validateInputs(); if(!v.ok) return alert(v.msg);
  try{
    approveBtn.disabled=true; approveBtn.textContent="APPROVING…";
    const token=new ethers.Contract(v.token, ERC20_ABI, signer);
    const amountWei=ethers.utils.parseUnits(v.amtStr, tokenCache.decimals);
    const tx=await token.approve(currentChain.splitter, amountWei);
    log(`Approve sent: ${tx.hash}`);
    await tx.wait();
    log("Approve confirmed.","ok");
    await refreshAllowanceIntel();
    alert("Approve confirmed.");
  }catch(e){
    log(`Approve failed: ${e.message||e}`,"err");
    alert(`Approve failed: ${e.message||e}`);
  }finally{
    approveBtn.disabled=false; approveBtn.textContent="APPROVE";
  }
}

/** Try (method x scale) with callStatic first to find a combination that won't revert */
async function findWorkingSplitCall(splitter, token, amountWei, recipients, percents100){
  // Two percent modes: 100-scale and 10000-bps
  const percentsBps = percents100.map(p => Math.round(p * 100));

  const tries = [
    { label: "percents=100", percents: percents100 },
    { label: "percents=bps(10000)", percents: percentsBps },
  ];

  for (const abi of SPLITTER_ABI_CANDIDATES) {
    const c = new ethers.Contract(splitter.address, [abi], splitter.signer);
    const fnName = Object.keys(c.interface.functions)[0].split("(")[0];

    for (const t of tries) {
      try{
        await c.callStatic[fnName](token, amountWei, recipients, t.percents);
        return { contract: c, fnName, percents: t.percents, mode: t.label };
      }catch(e){
        // keep trying
      }
    }
  }
  return null;
}

async function split(){
  const v=validateInputs(); if(!v.ok) return alert(v.msg);

  try{
    splitBtn.disabled=true; splitBtn.textContent="EXECUTING…";

    const splitter = new ethers.Contract(currentChain.splitter, SPLITTER_ABI_CANDIDATES, signer);
    const amountWei = ethers.utils.parseUnits(v.amtStr, tokenCache.decimals);

    log("Testing splitter call (auto-detect signature + percent units)…","warn");
    const found = await findWorkingSplitCall(splitter, v.token, amountWei, v.recipients, v.percents);

    if(!found){
      log("No compatible splitter function found OR it still reverts. This means the on-chain contract expects different params/logic.", "err");
      alert("Split failed: Contract reverted. Your splitter likely uses a different function signature (or requires % in a different format).");
      return;
    }

    log(`Detected: ${found.fnName} with ${found.mode}`, "ok");

    const tx = await found.contract[found.fnName](v.token, amountWei, v.recipients, found.percents);
    log(`Split sent: ${tx.hash}`);
    await tx.wait();
    log("Split confirmed.","ok");
    alert("Split confirmed.");
  }catch(e){
    log(`Split failed: ${e.message||e}`,"err");
    alert(`Split failed: ${e.message||e}`);
  }finally{
    splitBtn.disabled=false; splitBtn.textContent="EXECUTE SPLIT";
  }
}

function savePreset(){
  const rows=getRows().map(r=>({
    address:(r.querySelector(".addr").value||"").trim(),
    pct:Number(r.querySelector(".pct").value||0)
  }));
  const payload={chain:currentChain.key, token:(tokenAddress.value||"").trim(), recipients:rows};
  localStorage.setItem("zephenhel_citadel_preset", JSON.stringify(payload));
  log("Preset saved.","ok");
  alert("Preset saved.");
}

function loadPreset(){
  const raw=localStorage.getItem("zephenhel_citadel_preset");
  if(!raw) return alert("No preset saved yet.");
  try{
    const payload=JSON.parse(raw);
    if(payload.chain && CHAINS[payload.chain]){
      networkSelect.value=payload.chain;
      setChain(payload.chain);
    }
    if(payload.token) tokenAddress.value=payload.token;
    clearRecipients();
    (payload.recipients||[]).forEach(r=>addRecipientRow(r.address||"", r.pct||""));
    calcTotal();
    log("Preset loaded.","ok");
    refreshAllIntel();
  }catch{
    alert("Preset corrupted.");
  }
}

function openDex(){
  const t=(tokenAddress.value||"").trim();
  if(!isAddr(t)) return alert("Enter token address first.");
  window.open(`https://dexscreener.com/${currentChain.dexChain}/${t}`,"_blank");
}

function init(){
  addRecipientRow("", "");
  addRecipientRow("", "");
  setChain(networkSelect.value);

  connectBtn.addEventListener("click", connectWallet);
  switchBtn.addEventListener("click", async ()=>{ const ok=await switchToChain(currentChain); if(ok) log(`Switched to ${currentChain.name}.`,"ok"); });
  visitDexBtn.addEventListener("click", openDex);

  networkSelect.addEventListener("change", ()=>{
    setChain(networkSelect.value);
    if(userAddress){
      connectBtn.disabled=false;
      connectBtn.textContent="CONNECT WALLET";
      walletStatus.textContent="Disconnected";
      walletStatus.style.color="var(--muted)";
      provider=null; signer=null; userAddress=null;
      log("Network changed. Reconnect wallet.","warn");
    }
  });

  tokenAddress.addEventListener("input", ()=>refreshAllIntel());
  tokenAmount.addEventListener("input", async ()=>{
    updateUsdEstimateOnly();
    await refreshAllowanceIntel();
  });

  addRecipientBtn.addEventListener("click", ()=>addRecipientRow("", ""));
  evenSplitBtn.addEventListener("click", evenSplit);
  autoFixBtn.addEventListener("click", autoFixTo100);
  clearRecipientsBtn.addEventListener("click", ()=>{ clearRecipients(); addRecipientRow("", ""); addRecipientRow("", ""); });

  savePresetBtn.addEventListener("click", savePreset);
  loadPresetBtn.addEventListener("click", loadPreset);

  approveBtn.addEventListener("click", approve);
  splitBtn.addEventListener("click", split);

  refreshIntelBtn.addEventListener("click", refreshAllIntel);
  clearLogBtn.addEventListener("click", ()=>logBox.textContent="");

  log("Boot complete. Connect → Token → Amount → Recipients → Approve → Execute.","ok");
}

init();
