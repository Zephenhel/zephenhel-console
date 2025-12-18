/* global ethers */

const $ = (id) => document.getElementById(id);

let provider, signer, userAddress = null;
let activeChainId = null;

const SPLITTERS = {
  // Mainnets (your provided addresses)
  1: { name: "Ethereum", symbol: "ETH", splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2" },
  56: { name: "BSC", symbol: "BNB", splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c" },
  137: { name: "Polygon", symbol: "MATIC", splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4" },

  // Testnets — we do NOT know your deployed splitter here, so we warn clearly.
  97: { name: "BSC Testnet", symbol: "tBNB", splitter: null }
};

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// Try both common splitter signatures (because your earlier versions varied)
const SPLITTER_ABI_A = [
  "function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external"
];
const SPLITTER_ABI_B = [
  "function splitToken(address token, uint256 amount, address[] recipients, uint256[] shares) external"
];

function short(addr){
  return addr ? addr.slice(0,6) + "…" + addr.slice(-4) : "";
}

function now(){
  const d = new Date();
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
}

function log(line){
  const el = $("log");
  el.textContent = `[${now()}] ${line}\n` + el.textContent;
}

function banner(msg, type="info"){
  const el = $("statusBar");
  el.textContent = msg;
  el.style.borderColor =
    type === "ok" ? "rgba(107,255,179,.35)" :
    type === "err" ? "rgba(255,107,107,.35)" :
                     "rgba(246,196,83,.22)";
  el.style.color =
    type === "ok" ? "rgba(107,255,179,.95)" :
    type === "err" ? "rgba(255,107,107,.95)" :
                     "rgba(168,171,191,.95)";
}

function isAddress(v){
  try { ethers.utils.getAddress(v); return true; } catch { return false; }
}

function getChainMeta(chainId){
  return SPLITTERS[chainId] || { name:`Chain ${chainId}`, symbol:"NATIVE", splitter:null };
}

/* ----- Sounds (WebAudio) ----- */
let audioCtx = null;
function ac(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep({freq=880, dur=0.08, gain=0.08, type="sine"}){
  const ctx = ac();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g); g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur);
}

function radarPing(){
  // Two quick pings + a tail
  beep({freq: 780, dur: 0.06, gain: 0.08, type:"sine"});
  setTimeout(()=>beep({freq: 980, dur: 0.06, gain: 0.07, type:"sine"}), 90);
  setTimeout(()=>beep({freq: 520, dur: 0.10, gain: 0.05, type:"triangle"}), 200);
}

function coinDrop(count){
  // “count” drops, each is a quick chime
  const drops = Math.max(1, Math.min(24, count || 1));
  for(let i=0;i<drops;i++){
    setTimeout(()=>{
      beep({freq: 1200, dur: 0.03, gain: 0.06, type:"triangle"});
      setTimeout(()=>beep({freq: 900, dur: 0.05, gain: 0.05, type:"sine"}), 35);
    }, i * 110);
  }
}

/* ----- Recipients UI ----- */
function recipientsData(){
  const rows = [...document.querySelectorAll(".recRow")];
  const recipients = [];
  const percents = [];
  for(const r of rows){
    const a = r.querySelector(".addr").value.trim();
    const p = r.querySelector(".pct").value.trim();
    recipients.push(a);
    percents.push(p);
  }
  return { recipients, percents };
}

function updateTotal(){
  const { percents } = recipientsData();
  const total = percents.reduce((s,v)=> s + (parseFloat(v)||0), 0);
  $("totalPill").textContent = `Total: ${total.toFixed(2)}%`;
  $("totalPill").style.borderColor = Math.abs(total - 100) < 0.0001 ? "rgba(107,255,179,.35)" : "rgba(255,107,107,.35)";
  $("totalPill").style.color = Math.abs(total - 100) < 0.0001 ? "rgba(107,255,179,.95)" : "rgba(255,107,107,.95)";
  return total;
}

function addRecipientRow(addr="", pct=""){
  const wrap = $("recipients");
  const row = document.createElement("div");
  row.className = "recRow";
  row.innerHTML = `
    <div class="field" style="margin:0">
      <label>Recipient address</label>
      <input class="addr" placeholder="0x…" value="${addr}" />
    </div>
    <div class="field" style="margin:0">
      <label>Percent</label>
      <input class="pct" placeholder="0" value="${pct}" />
    </div>
    <div>
      <label style="visibility:hidden">x</label>
      <button class="btn" type="button">Remove</button>
    </div>
  `;
  row.querySelector(".btn").onclick = () => { row.remove(); updateTotal(); updateEstimates(); };
  row.querySelector(".pct").addEventListener("input", ()=>{ updateTotal(); updateEstimates(); });
  row.querySelector(".addr").addEventListener("input", ()=>{ updateEstimates(); });
  wrap.appendChild(row);
  updateTotal();
  updateEstimates();
}

/* ----- Chain / Splitter ----- */
async function refreshChain(){
  if(!window.ethereum) return;
  const chainHex = await window.ethereum.request({ method: "eth_chainId" });
  activeChainId = parseInt(chainHex, 16);

  const meta = getChainMeta(activeChainId);
  $("netPill").textContent = `Network: ${meta.name} (chainId ${activeChainId})`;

  // Splitter address logic
  if(meta.splitter){
    $("splitterAddr").value = meta.splitter;
    $("splitterNote").textContent = "Using your deployed splitter for this chain.";
    $("splitterNote").style.color = "rgba(107,255,179,.85)";
  } else {
    $("splitterAddr").value = "";
    $("splitterNote").textContent = "No splitter configured for this chain. Switch to ETH/BSC/Polygon, or deploy a testnet splitter and add its address.";
    $("splitterNote").style.color = "rgba(255,107,107,.9)";
  }

  await refreshBalances();
  await refreshTokenInfo();
}

async function refreshBalances(){
  try{
    if(!provider || !userAddress) return;
    const meta = getChainMeta(activeChainId);
    const bal = await provider.getBalance(userAddress);
    const fmt = ethers.utils.formatEther(bal);
    $("nativeBal").textContent = `${Number(fmt).toFixed(5)} ${meta.symbol}`;
  }catch(e){
    log(`Native balance read failed: ${e.message}`);
  }
}

/* ----- Token Info + USD (DexScreener) ----- */
let token = null;
let tokenDecimals = 18;
let tokenSymbol = "";
let tokenPriceUsd = null;

async function dexPriceUsd(tokenAddr){
  try{
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    const pairs = (j && j.pairs) ? j.pairs : [];
    // pick best liquidity (rough heuristic)
    pairs.sort((a,b)=> (Number(b.liquidity?.usd||0) - Number(a.liquidity?.usd||0)));
    const best = pairs[0];
    const price = best ? Number(best.priceUsd || 0) : 0;
    return price > 0 ? price : null;
  }catch{
    return null;
  }
}

async function refreshTokenInfo(){
  $("tokSymbol").textContent = "—";
  $("tokDecimals").textContent = "—";
  $("tokBal").textContent = "—";
  $("usdEst").textContent = "—";
  tokenPriceUsd = null;

  const t = $("tokenAddr").value.trim();
  const splitter = $("splitterAddr").value.trim();

  if(!provider || !userAddress) return;
  if(!t || !isAddress(t)) return;
  if(!splitter || !isAddress(splitter)) return;

  try{
    token = new ethers.Contract(ethers.utils.getAddress(t), ERC20_ABI, signer);

    tokenSymbol = await token.symbol();
    tokenDecimals = await token.decimals();

    $("tokSymbol").textContent = tokenSymbol;
    $("tokDecimals").textContent = String(tokenDecimals);

    const bal = await token.balanceOf(userAddress);
    const balFmt = ethers.utils.formatUnits(bal, tokenDecimals);
    $("tokBal").textContent = `${Number(balFmt).toFixed(6)} ${tokenSymbol}`;

    tokenPriceUsd = await dexPriceUsd(ethers.utils.getAddress(t));
    updateEstimates();
    log(`Token info loaded: ${tokenSymbol} (decimals ${tokenDecimals})`);

  }catch(e){
    banner(`Token read failed: ${e.message}`, "err");
    log(`Token read failed: ${e.message}`);
  }
}

function updateEstimates(){
  const amt = parseFloat(($("amount").value || "").trim());
  if(!tokenPriceUsd || !amt || !isFinite(amt) || amt <= 0){
    $("usdEst").textContent = tokenPriceUsd ? "$0.00" : "—";
    return;
  }
  const totalUsd = amt * tokenPriceUsd;
  $("usdEst").textContent = `$${totalUsd.toFixed(2)}`;

  // We can also compute per-recipient estimate (not shown as separate fields, but we log it)
  const { recipients, percents } = recipientsData();
  const valid = recipients.filter(a=>isAddress(a)).length;
  if(valid > 0){
    // nothing extra printed; kept simple
  }
}

/* ----- Connect / Switch ----- */
async function connect(){
  try{
    if(!window.ethereum){
      throw new Error("MetaMask not detected in Edge. Make sure the extension is installed in THIS browser profile.");
    }

    // Edge reliability: request permissions first
    await window.ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }]
    });

    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    $("acctPill").textContent = `Wallet: ${short(userAddress)}`;
    banner("Wallet connected. Citadel online.", "ok");
    log(`Connected: ${userAddress}`);
    radarPing();

    // listeners
    window.ethereum.on("chainChanged", async () => {
      log("Chain changed.");
      await refreshChain();
    });
    window.ethereum.on("accountsChanged", async (accs) => {
      userAddress = accs && accs[0] ? accs[0] : null;
      $("acctPill").textContent = `Wallet: ${userAddress ? short(userAddress) : "Disconnected"}`;
      log("Account changed.");
      await refreshChain();
    });

    await refreshChain();

  }catch(e){
    banner(`Connect failed: ${e.message}`, "err");
    log(`Connect failed: ${e.message}`);
  }
}

async function switchNetwork(){
  // Cycles among ETH -> BSC -> Polygon
  const order = [56, 1, 137];
  const i = Math.max(0, order.indexOf(activeChainId));
  const next = order[(i + 1) % order.length];

  try{
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + next.toString(16) }]
    });
  }catch(e){
    banner(`Switch failed: ${e.message}`, "err");
    log(`Switch failed: ${e.message}`);
  }
}

/* ----- Actions: MAX / Approve / Split ----- */
async function setMax(){
  try{
    if(!token || !userAddress) return banner("Connect wallet and load token first.", "err");
    const bal = await token.balanceOf(userAddress);
    const fmt = ethers.utils.formatUnits(bal, tokenDecimals);
    $("amount").value = Number(fmt).toFixed(6);
    updateEstimates();
    log("MAX set to token balance (gas is separate in native coin).");
  }catch(e){
    banner(`MAX failed: ${e.message}`, "err");
    log(`MAX failed: ${e.message}`);
  }
}

function validateInputs(){
  const splitter = $("splitterAddr").value.trim();
  const tokenAddr = $("tokenAddr").value.trim();
  const amount = ($("amount").value || "").trim();

  if(!provider || !userAddress) return "Connect wallet first.";
  if(!splitter || !isAddress(splitter)) return "No valid splitter contract for this network (switch chain).";
  if(!tokenAddr || !isAddress(tokenAddr)) return "Enter a valid token contract address (0x…).";

  const total = updateTotal();
  if(Math.abs(total - 100) > 0.0001) return "Percent total must equal 100.";

  const { recipients, percents } = recipientsData();
  if(recipients.length < 1) return "Add at least one recipient.";
  for(const a of recipients){
    if(!isAddress(a)) return `Invalid recipient address: ${a || "(empty)"}`;
  }
  for(const p of percents){
    const n = Number(p);
    if(!isFinite(n) || n <= 0) return "Each percent must be > 0.";
  }
  const amt = Number(amount);
  if(!isFinite(amt) || amt <= 0) return "Enter a valid amount > 0.";

  return null;
}

async function approve(){
  const err = validateInputs();
  if(err) return banner(err, "err");

  try{
    const splitter = ethers.utils.getAddress($("splitterAddr").value.trim());
    const tokenAddr = ethers.utils.getAddress($("tokenAddr").value.trim());
    const amt = $("amount").value.trim();

    const t = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
    const wei = ethers.utils.parseUnits(amt, tokenDecimals);

    banner("Sending approve…", "info");
    log(`Approving ${tokenSymbol || "token"} for splitter ${short(splitter)}…`);

    const tx = await t.approve(splitter, wei);
    log(`Approve tx: ${tx.hash}`);
    await tx.wait();

    banner("Approve confirmed ✅", "ok");
    log("Approve confirmed ✅");
  }catch(e){
    banner(`Approve failed: ${e.message}`, "err");
    log(`Approve failed: ${e.message}`);
  }
}

async function trySplitWith(abi){
  const splitterAddr = ethers.utils.getAddress($("splitterAddr").value.trim());
  const tokenAddr = ethers.utils.getAddress($("tokenAddr").value.trim());
  const amt = $("amount").value.trim();

  const { recipients, percents } = recipientsData();
  const recs = recipients.map(a => ethers.utils.getAddress(a.trim()));
  const pcs = percents.map(p => Math.round(Number(p))); // SIMPLE integer % (no decimals)
  const total = pcs.reduce((s,v)=>s+v,0);

  if(total !== 100){
    throw new Error("Percents must be whole numbers totaling 100 (e.g., 50/50, 34/33/33).");
  }

  const contract = new ethers.Contract(splitterAddr, abi, signer);

  // amount in token decimals
  const wei = ethers.utils.parseUnits(amt, tokenDecimals);

  // estimateGas to fail fast with a clearer error
  await contract.estimateGas.splitToken(tokenAddr, wei, recs, pcs);

  const tx = await contract.splitToken(tokenAddr, wei, recs, pcs);
  return tx;
}

async function split(){
  const err = validateInputs();
  if(err) return banner(err, "err");

  try{
    banner("Executing split…", "info");
    log("Executing split…");

    const drops = document.querySelectorAll(".recRow").length;
    coinDrop(drops);

    // Try signature A first, then B
    let tx;
    try{
      tx = await trySplitWith(SPLITTER_ABI_A);
    }catch(eA){
      log(`Split attempt A failed: ${eA.message}`);
      tx = await trySplitWith(SPLITTER_ABI_B);
    }

    log(`Split tx: ${tx.hash}`);
    await tx.wait();

    banner("Split complete ✅", "ok");
    log("Split complete ✅");

    await refreshTokenInfo();
  }catch(e){
    banner(`Split failed: ${e.message}`, "err");
    log(`Split failed: ${e.message}`);
  }
}

/* ----- Wire up UI ----- */
function init(){
  $("btnConnect").onclick = connect;
  $("btnSwitch").onclick = switchNetwork;
  $("btnAdd").onclick = () => addRecipientRow("", "");
  $("btnClear").onclick = () => { $("log").textContent = ""; banner("Log cleared.", "info"); };

  $("btnMax").onclick = setMax;
  $("btnApprove").onclick = approve;
  $("btnSplit").onclick = split;

  $("tokenAddr").addEventListener("change", refreshTokenInfo);
  $("amount").addEventListener("input", updateEstimates);

  // starter rows
  addRecipientRow("", "50");
  addRecipientRow("", "50");

  banner("Ready. Connect wallet to begin.", "info");
  log("Citadel loaded. Awaiting wallet connection…");
}
init();
