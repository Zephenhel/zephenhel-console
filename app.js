/* ZEPHENHEL CITADEL — Upgraded Tri-Chain Splitter UI
   - Simple % UI (0–100) with auto contract conversion (bps 10000 first)
   - Token decimals/symbol read on-chain
   - USD estimate via Dexscreener
   - Radar ping on connect + coin-beat on execute (WebAudio; no external files)
   - Split function autodetect: splitToken/split/distribute
*/

const SPLITTER_BY_CHAIN = {
  56: { name:"BSC", native:"BNB", splitter:"0x928B75D0fA6382D4B742afB6e500C9458B4f502c" },
  1: { name:"ETH", native:"ETH", splitter:"0x56FeE96eF295Cf282490592403B9A3C1304b91d2" },
  137: { name:"POLYGON", native:"MATIC", splitter:"0x05948E68137eC131E1f0E27028d09fa174679ED4" }
};

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const SPLITTER_ABI = [
  "function splitToken(address token,uint256 amount,address[] recipients,uint256[] percents) external",
  "function split(address token,uint256 amount,address[] recipients,uint256[] percents) external",
  "function distribute(address token,uint256 amount,address[] recipients,uint256[] percents) external"
];

const $ = (id) => document.getElementById(id);
const logBox = $("logBox");

let provider = null;
let signer = null;
let user = null;
let chainId = null;
let chainCfg = null;
let splitterAddr = null;

let tokenAddr = null;
let token = null;
let tokenMeta = { symbol:null, decimals:18, priceUsd:null };
let tokenBalRaw = null;

let audioCtx = null;

function log(msg){
  const t = new Date().toLocaleTimeString();
  logBox.textContent = `[${t}] ${msg}\n` + logBox.textContent;
}

function banner(msg, kind=""){
  const b = $("banner");
  b.classList.remove("ok","err");
  if(kind) b.classList.add(kind);
  b.textContent = msg;
}

function short(a){
  if(!a) return "—";
  return a.slice(0,6) + "…" + a.slice(-4);
}

function fmtNum(x, dp=6){
  const n = Number(x);
  if(!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined,{maximumFractionDigits:dp});
}

function ensureAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === "suspended") audioCtx.resume();
}

function radarPing(){
  ensureAudio();
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(320, now);
  o.frequency.exponentialRampToValueAtTime(1500, now + 0.18);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(now);
  o.stop(now + 0.28);
}

function coinTick(at, pitch=880, vol=0.12){
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(pitch, at);
  o.frequency.exponentialRampToValueAtTime(pitch*0.55, at + 0.06);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(at);
  o.stop(at + 0.09);
}

function coinBeat(percents){
  ensureAudio();
  const now = audioCtx.currentTime;
  const hits = [];
  percents.forEach((p,i)=>{
    const pct = Math.max(0, Number(p)||0);
    const count = Math.max(1, Math.round(pct/10)); // 1–10
    for(let k=0;k<count;k++) hits.push(i);
  });
  const interval = 0.055;
  hits.forEach((i, idx)=>{
    const t = now + 0.02 + idx*interval;
    const pitch = 720 + i*80 + Math.random()*120;
    coinTick(t, pitch, 0.11);
  });
  const end = now + 0.02 + hits.length*interval + 0.06;
  coinTick(end, 520, 0.16);
  coinTick(end+0.03, 780, 0.12);
}

function isAddr(a){
  try { return ethers.utils.isAddress(a); } catch { return false; }
}

/* ---------- Recipients UI ---------- */
function addRecipientRow(address="", pct=""){
  const row = document.createElement("div");
  row.className = "recRow";
  row.innerHTML = `
    <input class="mono addr" placeholder="0x… recipient" spellcheck="false" value="${address}">
    <input class="pct" placeholder="%" inputmode="decimal" value="${pct}">
    <button class="btn btn-ghost rm" type="button">REMOVE</button>
  `;
  row.querySelector(".rm").onclick = () => { row.remove(); updateTotal(); };
  row.querySelector(".pct").addEventListener("input", updateTotal);
  row.querySelector(".addr").addEventListener("input", updateTotal);
  $("recipients").appendChild(row);
  updateTotal();
}

function getRecipients(){
  const rows = [...document.querySelectorAll("#recipients .recRow")];
  const recipients = [];
  const percents = [];
  for(const r of rows){
    const a = r.querySelector(".addr").value.trim();
    const p = Number(r.querySelector(".pct").value || 0);
    if(a.length){
      recipients.push(a);
      percents.push(p);
    }
  }
  return { recipients, percents };
}

function updateTotal(){
  const { percents } = getRecipients();
  const total = percents.reduce((s,x)=>s+(Number(x)||0),0);
  $("totalPercent").textContent = fmtNum(total, 2).replace(/\.00$/,"");
}

/* ---------- Chain + Wallet ---------- */
async function refreshChain(){
  if(!signer) return;
  chainId = await signer.getChainId();
  chainCfg = SPLITTER_BY_CHAIN[chainId] || null;

  if(!chainCfg){
    splitterAddr = null;
    $("chainChip").innerHTML = `CHAIN: <b>UNSUPPORTED (${chainId})</b>`;
    $("splitterChip").innerHTML = `SPLITTER: <b>—</b>`;
    $("statusLine").textContent = "Unsupported chain. Switch to BSC / ETH / Polygon.";
    banner("Unsupported network. Switch to BSC / Ethereum / Polygon.", "err");
    return;
  }

  splitterAddr = chainCfg.splitter;
  $("chainChip").innerHTML = `CHAIN: <b>${chainCfg.name}</b>`;
  $("splitterChip").innerHTML = `SPLITTER: <b>${short(splitterAddr)}</b>`;
  $("statusLine").textContent = `${chainCfg.name} ready.`;
  banner("Chain synced. Ready.", "ok");

  await refreshBalances();
  await refreshTokenInfo(); // refresh if token already entered
}

async function refreshBalances(){
  if(!provider || !user || !chainCfg) return;
  const nat = await provider.getBalance(user);
  $("walletAddr").textContent = user;
  $("nativeBalance").textContent = `${fmtNum(ethers.utils.formatEther(nat),6)} ${chainCfg.native}`;
}

/* ---------- Token + USD ---------- */
async function fetchDexPriceUsd(addr){
  try{
    const url = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
    const res = await fetch(url, { cache:"no-store" });
    if(!res.ok) return null;
    const data = await res.json();
    const pairs = data?.pairs || [];
    if(!pairs.length) return null;
    // Prefer matching chain, else highest liquidity
    const want = (chainId === 56) ? "bsc" : (chainId === 137) ? "polygon" : "ethereum";
    const same = pairs.filter(p => String(p.chainId||"").toLowerCase() === want);
    const list = same.length ? same : pairs;
    list.sort((a,b) => (Number(b?.liquidity?.usd)||0) - (Number(a?.liquidity?.usd)||0));
    const price = Number(list[0]?.priceUsd);
    return Number.isFinite(price) && price > 0 ? price : null;
  }catch{
    return null;
  }
}

function updateUsdEstimate(){
  const amt = Number($("amountInput").value || 0);
  if(!tokenMeta.priceUsd || !Number.isFinite(amt) || amt <= 0){
    $("usdEstimate").textContent = "—";
    return;
  }
  const est = amt * tokenMeta.priceUsd;
  $("usdEstimate").textContent = `≈ $${fmtNum(est,2)} USD`;
}

async function refreshTokenInfo(){
  tokenAddr = $("tokenAddress").value.trim();
  token = null;
  tokenBalRaw = null;
  tokenMeta = { symbol:null, decimals:18, priceUsd:null };

  $("tokenMeta").textContent = "—";
  $("tokenBalance").textContent = "—";
  $("usdEstimate").textContent = "—";

  if(!provider || !user) return;
  if(!isAddr(tokenAddr)) return;

  try{
    token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
    const [sym, dec, bal] = await Promise.all([
      token.symbol().catch(()=> "TOKEN"),
      token.decimals().catch(()=> 18),
      token.balanceOf(user).catch(()=> ethers.constants.Zero)
    ]);
    tokenMeta.symbol = sym;
    tokenMeta.decimals = dec;
    tokenBalRaw = bal;

    $("tokenMeta").textContent = `${sym} • decimals: ${dec}`;
    $("tokenBalance").textContent = `${fmtNum(ethers.utils.formatUnits(bal, dec),6)} ${sym}`;

    tokenMeta.priceUsd = await fetchDexPriceUsd(tokenAddr);
    updateUsdEstimate();

  }catch(e){
    banner("Token read failed. Check token address + chain.", "err");
    log(`Token read failed: ${e.message || e}`);
  }
}

/* ---------- Percent conversion + split call autodetect ---------- */
function toPercentsBps(percentsUI){
  // UI expects 0–100 total 100
  return percentsUI.map(p => Math.round((Number(p)||0) * 100)); // 50 -> 5000
}
function toPercents100(percentsUI){
  return percentsUI.map(p => Math.round(Number(p)||0)); // 50 -> 50
}

async function detectSplitterCall(splitterContract, tokenAddress, amountBN, recipients, percentsUI){
  // Try: bps(10000) first (most common), then 100-scale.
  const tries = [
    { label:"bps(10000)", vals: toPercentsBps(percentsUI) },
    { label:"percent(100)", vals: toPercents100(percentsUI) }
  ];

  const fns = ["splitToken", "split", "distribute"];

  for(const fn of fns){
    if(typeof splitterContract[fn] !== "function") continue;
    for(const t of tries){
      try{
        // callStatic to prevent sending a failing tx
        await splitterContract.callStatic[fn](tokenAddress, amountBN, recipients, t.vals);
        return { fn, mode:t.label, percents:t.vals };
      }catch(_){}
    }
  }
  return null;
}

/* ---------- Actions ---------- */
async function connect(){
  try{
    if(!window.ethereum) throw new Error("MetaMask not detected.");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    user = await signer.getAddress();

    $("walletChip").innerHTML = `WALLET: <b>${short(user)}</b>`;
    banner("Wallet connected. Citadel online.", "ok");
    log(`Connected: ${user}`);

    radarPing();
    await refreshChain();

    window.ethereum.on("chainChanged", async () => {
      log("Chain changed.");
      await refreshChain();
    });
    window.ethereum.on("accountsChanged", async (accs) => {
      user = accs && accs[0] ? accs[0] : null;
      $("walletChip").innerHTML = `WALLET: <b>${user ? short(user) : "DISCONNECTED"}</b>`;
      log("Account changed.");
      await refreshBalances();
      await refreshTokenInfo();
    });

  }catch(e){
    banner(`Connect failed: ${e.message}`, "err");
    log(`Connect failed: ${e.message}`);
  }
}

async function setMax(){
  try{
    ensureAudio(); // ensures sound can play later
    if(!token || !user) throw new Error("Connect wallet and enter a valid token first.");
    const balRaw = await token.balanceOf(user);
    tokenBalRaw = balRaw;
    const maxStr = ethers.utils.formatUnits(balRaw, tokenMeta.decimals);
    $("amountInput").value = maxStr;
    updateUsdEstimate();
    $("amountHint").textContent = `MAX set to token balance. Gas is paid in ${chainCfg?.native || "native coin"}.`;
    banner("MAX set.", "ok");
    log("MAX set from token balance.");
  }catch(e){
    banner(`MAX failed: ${e.message}`, "err");
    log(`MAX failed: ${e.message}`);
  }
}

async function approve(){
  try{
    ensureAudio();
    if(!signer || !user) throw new Error("Connect wallet first.");
    if(!token || !isAddr(tokenAddr)) throw new Error("Enter a valid token address.");
    if(!splitterAddr) throw new Error("Unsupported chain.");

    const amtStr = $("amountInput").value.trim();
    if(!amtStr || Number(amtStr) <= 0) throw new Error("Enter amount > 0.");

    const amt = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
    const tok = new ethers.Contract(tokenAddr, ERC20_ABI, signer);

    const allowance = await tok.allowance(user, splitterAddr);
    if(allowance.gte(amt)){
      banner("Approve not needed (allowance already sufficient).", "ok");
      log("Approve skipped: allowance already sufficient.");
      return;
    }

    banner("Sending approve…");
    log(`Approving ${tokenMeta.symbol} for splitter ${short(splitterAddr)}…`);
    const tx = await tok.approve(splitterAddr, amt);
    log(`Approve sent: ${tx.hash}`);
    await tx.wait();
    banner("Approve confirmed ✅", "ok");
    log("Approve confirmed ✅");
  }catch(e){
    banner(`Approve failed: ${e.message}`, "err");
    log(`Approve failed: ${e.message}`);
  }
}

async function executeSplit(){
  try{
    ensureAudio();
    if(!signer || !user) throw new Error("Connect wallet first.");
    if(!token || !isAddr(tokenAddr)) throw new Error("Enter a valid token address.");
    if(!splitterAddr) throw new Error("Unsupported chain.");

    const { recipients, percents } = getRecipients();
    if(recipients.length < 2) throw new Error("Add at least 2 recipients.");
    recipients.forEach(a => { if(!isAddr(a)) throw new Error(`Invalid recipient: ${a}`); });

    const total = percents.reduce((s,x)=>s+(Number(x)||0),0);
    if(Math.abs(total - 100) > 0.0001) throw new Error(`Total % must equal 100. Current: ${total}`);

    const amtStr = $("amountInput").value.trim();
    if(!amtStr || Number(amtStr) <= 0) throw new Error("Enter amount > 0.");
    const amt = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);

    // balance precheck
    const balRaw = tokenBalRaw ?? await token.balanceOf(user);
    if(balRaw.lt(amt)) throw new Error("Insufficient token balance.");

    const splitter = new ethers.Contract(splitterAddr, SPLITTER_ABI, signer);

    // Determine correct fn + percent mode via callStatic
    const found = await detectSplitterCall(splitter, tokenAddr, amt, recipients, percents);
    if(!found) throw new Error("Splitter call would revert. Percent mode/function mismatch.");

    coinBeat(percents);

    banner(`Executing split (${found.fn}, ${found.mode})…`);
    log(`Execute: fn=${found.fn} mode=${found.mode} recipients=${recipients.length}`);

    const tx = await splitter[found.fn](tokenAddr, amt, recipients, found.percents);
    log(`Split sent: ${tx.hash}`);
    await tx.wait();

    banner("Split complete ✅", "ok");
    log("Split confirmed ✅");

    await refreshTokenInfo();
  }catch(e){
    banner(`Split failed: ${e.message}`, "err");
    log(`Split failed: ${e.message}`);
  }
}

/* ---------- Init ---------- */
function init(){
  // Default recipients
  addRecipientRow("", "50");
  addRecipientRow("", "50");

  $("connectBtn").onclick = connect;
  $("addRecipientBtn").onclick = () => addRecipientRow("", "");
  $("maxBtn").onclick = setMax;
  $("approveBtn").onclick = approve;
  $("executeBtn").onclick = executeSplit;

  $("tokenAddress").addEventListener("input", () => {
    clearTimeout(window.__tokTimer);
    window.__tokTimer = setTimeout(refreshTokenInfo, 250);
  });

  $("amountInput").addEventListener("input", updateUsdEstimate);

  banner("System ready. Connect wallet to begin.");
  log("Citadel boot complete.");
}
init();
