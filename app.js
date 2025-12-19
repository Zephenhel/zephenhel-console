/* global ethers */

const CONFIG = {
  feeBps: 100, // 1%
  chains: {
    bsc: {
      name: "BNB Chain",
      chainId: 56,
      hex: "0x38",
      native: "BNB",
      splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
      vault: "0x69BD92784b9ED63a40d2cf51b475Ba68B37bD59E"
    },
    eth: {
      name: "Ethereum",
      chainId: 1,
      hex: "0x1",
      native: "ETH",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
      vault: "0x886f915D21A5BC540E86655a89e6223981D875d8"
    },
    polygon: {
      name: "Polygon",
      chainId: 137,
      hex: "0x89",
      native: "MATIC",
      splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
      vault: "0xde07160A2eC236315Dd27e9600f88Ba26F86f06e"
    }
  }
};

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// Splitter ABI candidates (we will try multiple signatures safely)
const SPLITTER_ABI = [
  "function splitToken(address token,uint256 amount,address[] recipients,uint256[] percents)",
  "function splitToken(address token,uint256 amount,address[] recipients,uint256[] shares)",
  "function splitNative(uint256 amount,address[] recipients,uint256[] percents) payable",
  "function splitNative(address[] recipients,uint256[] percents) payable"
];

let provider, signer, user;
let tokenContract = null;
let tokenMeta = { symbol: "—", decimals: 18, priceUsd: null };
let detected = { percentScale: null, amountMode: null, method: null, nativeMethod: null };

const $ = (id) => document.getElementById(id);

function log(msg){
  const el = $("log");
  const t = new Date();
  const stamp = t.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  el.textContent += `[${stamp}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function setError(msg){
  const box = $("errBox");
  if(!msg){
    box.style.display = "none";
    box.textContent = "";
    return;
  }
  box.style.display = "block";
  box.textContent = msg;
}

function fmtAddr(a){
  if(!a) return "—";
  return a.slice(0,6) + "…" + a.slice(-4);
}

function onChainKey(){
  return $("selChain").value;
}

function chainCfg(){
  return CONFIG.chains[onChainKey()];
}

function soundEnabled(){
  return $("chkSound").checked;
}

/* ===== Sound FX (no external files) ===== */
let audioCtx = null;
function ensureAudio(){
  if(!soundEnabled()) return null;
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function pingRadar(){
  const ctx = ensureAudio();
  if(!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(880, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.18);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.20);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.22);
}
function coinDrops(n){
  const ctx = ensureAudio();
  if(!ctx) return;
  const base = ctx.currentTime;
  for(let i=0;i<n;i++){
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    const t = base + i*0.06;
    o.frequency.setValueAtTime(520 + (i%3)*140, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.055);
  }
}

/* ===== UI: recipients ===== */
function makeRecipientRow(addr="", pct="50"){
  const wrap = document.createElement("div");
  wrap.className = "recRow";

  const a = document.createElement("input");
  a.placeholder = "0xRecipient…";
  a.value = addr;
  a.spellcheck = false;

  const p = document.createElement("input");
  p.placeholder = "Percent";
  p.inputMode = "decimal";
  p.value = pct;

  const x = document.createElement("button");
  x.className = "iconBtn";
  x.textContent = "×";
  x.onclick = () => { wrap.remove(); updateTotals(); };

  a.oninput = updateTotals;
  p.oninput = updateTotals;

  wrap.appendChild(a);
  wrap.appendChild(p);
  wrap.appendChild(x);
  return wrap;
}

function recipientsList(){
  const rows = Array.from($("recipients").querySelectorAll(".recRow"));
  const recipients = [];
  const percents = [];
  for(const r of rows){
    const inputs = r.querySelectorAll("input");
    const addr = (inputs[0].value || "").trim();
    const pct = (inputs[1].value || "").trim();
    recipients.push(addr);
    percents.push(pct);
  }
  return { recipients, percents };
}

function updateTotals(){
  const { percents } = recipientsList();
  let sum = 0;
  for(const v of percents){
    const n = Number(v);
    if(Number.isFinite(n)) sum += n;
  }
  $("totalPill").textContent = `Total: ${sum.toFixed(2)}%`;
}

function normalizePercents(){
  const rows = Array.from($("recipients").querySelectorAll(".recRow"));
  let vals = rows.map(r => Number(r.querySelectorAll("input")[1].value));
  if(vals.some(v => !Number.isFinite(v) || v < 0)) return setError("Invalid percent values.");
  const sum = vals.reduce((a,b)=>a+b,0);
  if(sum <= 0) return setError("Percent sum must be > 0.");
  rows.forEach((r,i)=>{
    const p = r.querySelectorAll("input")[1];
    const n = (vals[i] / sum) * 100;
    p.value = (Math.round(n * 100) / 100).toString();
  });
  updateTotals();
}

/* ===== Wallet / network ===== */
async function connect(){
  setError("");
  if(!window.ethereum) return setError("MetaMask not found. Install MetaMask extension in Edge and refresh.");
  provider = new ethers.providers.Web3Provider(window.ethereum, "any");

  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  user = await signer.getAddress();

  pingRadar();

  $("pillWallet").textContent = `Wallet: ${fmtAddr(user)}`;
  $("btnConnect").textContent = "CONNECTED";
  $("btnConnect").classList.add("connected");
  $("btnConnect").disabled = true;

  log(`Connected: ${user}`);
  await refreshAll();

  window.ethereum.on("accountsChanged", async (accs)=>{
    if(!accs || !accs.length){
      location.reload();
      return;
    }
    user = accs[0];
    $("pillWallet").textContent = `Wallet: ${fmtAddr(user)}`;
    log(`Account changed: ${user}`);
    await refreshAll();
  });

  window.ethereum.on("chainChanged", async ()=>{
    detected = { percentScale:null, amountMode:null, method:null, nativeMethod:null };
    log(`Chain changed.`);
    await refreshAll();
  });
}

async function switchNetwork(){
  setError("");
  if(!window.ethereum) return setError("MetaMask not found.");
  const cfg = chainCfg();
  try{
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: cfg.hex }]
    });
  }catch(e){
    setError(`Could not switch network automatically. In MetaMask, switch to ${cfg.name} (chainId ${cfg.chainId}).`);
  }
}

/* ===== Contracts / token load ===== */
function splitterContract(){
  const cfg = chainCfg();
  $("teleSplitter").textContent = cfg.splitter;
  return new ethers.Contract(cfg.splitter, SPLITTER_ABI, signer || provider);
}

async function loadToken(){
  tokenContract = null;
  tokenMeta = { symbol:"—", decimals:18, priceUsd:null };
  $("teleSymbol").textContent = "—";
  $("teleDecimals").textContent = "—";
  $("teleTokenBal").textContent = "—";
  $("teleAllowance").textContent = "—";
  $("usdEst").textContent = "—";
  $("postFeeLine").textContent = "You send (auto-detect) —";

  const mode = $("selMode").value;
  if(mode !== "token") return;

  const addr = ($("inpToken").value || "").trim();
  if(!ethers.utils.isAddress(addr)){
    return;
  }

  tokenContract = new ethers.Contract(addr, ERC20_ABI, signer || provider);

  try{
    const [sym, dec] = await Promise.all([tokenContract.symbol(), tokenContract.decimals()]);
    tokenMeta.symbol = sym;
    tokenMeta.decimals = Number(dec);
    $("teleSymbol").textContent = sym;
    $("teleDecimals").textContent = String(dec);
    log(`Token loaded: ${sym} (decimals ${dec})`);
  }catch(e){
    log(`Token read failed (symbol/decimals). Some tokens may not implement symbol().`);
  }

  await fetchDexPrice(addr);
  await refreshBalances();
}

async function fetchDexPrice(tokenAddr){
  tokenMeta.priceUsd = null;
  try{
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const res = await fetch(url);
    const json = await res.json();
    const pairs = (json && json.pairs) ? json.pairs : [];
    // pick best liquidity
    pairs.sort((a,b)=> (Number(b.liquidity?.usd||0) - Number(a.liquidity?.usd||0)));
    const best = pairs[0];
    const p = best ? Number(best.priceUsd) : null;
    if(p && Number.isFinite(p)){
      tokenMeta.priceUsd = p;
      log(`PriceUsd: $${p}`);
    }
  }catch(e){
    // ignore
  }
  updateUsdEstimate();
}

function updateUsdEstimate(){
  const amt = Number(($("inpAmount").value || "").trim());
  if(!Number.isFinite(amt) || amt <= 0 || !tokenMeta.priceUsd){
    $("usdEst").textContent = "—";
    return;
  }
  const usd = amt * tokenMeta.priceUsd;
  $("usdEst").textContent = `$${usd.toFixed(2)}`;
}

async function refreshBalances(){
  if(!provider || !user) return;
  const cfg = chainCfg();
  const bal = await provider.getBalance(user);
  $("teleNative").textContent = `${ethers.utils.formatEther(bal)} ${cfg.native}`;

  if($("selMode").value === "token" && tokenContract){
    try{
      const [tb, allow] = await Promise.all([
        tokenContract.balanceOf(user),
        tokenContract.allowance(user, cfg.splitter)
      ]);
      $("teleTokenBal").textContent = `${ethers.utils.formatUnits(tb, tokenMeta.decimals)} ${tokenMeta.symbol}`;
      $("teleAllowance").textContent = `${ethers.utils.formatUnits(allow, tokenMeta.decimals)} ${tokenMeta.symbol}`;
    }catch(e){
      // ignore
    }
  }
}

async function refreshAll(){
  const cfg = chainCfg();
  $("pillNet").textContent = `Network: ${cfg.name} (chainId ${cfg.chainId})`;
  $("teleStatus").textContent = "Ready.";
  await refreshBalances();
  await loadToken();
  await detectIfPossible(); // attempt detection when possible
}

/* ===== Detection: percent scale + fee expectation ===== */
function makePercents(scale){
  // UI percents are human 0-100 (can be decimals)
  const { percents } = recipientsList();
  const nums = percents.map(v => Number(v));
  if(nums.some(n => !Number.isFinite(n))) throw new Error("Invalid percent values.");
  const sum = nums.reduce((a,b)=>a+b,0);
  if(sum <= 0) throw new Error("Percent sum must be > 0.");
  // normalize to exactly 100
  const norm = nums.map(n => (n/sum)*100);
  if(scale === 100){
    return norm.map(n => Math.round(n)); // integers
  }
  // 10000 basis points
  return norm.map(n => Math.round(n * 100));
}

function amountAdjusted(rawWei){
  return rawWei.mul(10000 - CONFIG.feeBps).div(10000);
}

async function tryCallStaticToken(splitter, method, tokenAddr, amountWei, recipients, percentsArr){
  // try callStatic via dynamic
  return splitter.callStatic[method](tokenAddr, amountWei, recipients, percentsArr);
}

async function detectIfPossible(){
  setError("");
  detected = { percentScale:null, amountMode:null, method:null, nativeMethod:null };
  $("teleDetected").textContent = "—";

  if(!provider || !user) return;

  const mode = $("selMode").value;
  const splitter = splitterContract();
  const { recipients } = recipientsList();
  const recOk = recipients.length >= 1 && recipients.every(a => ethers.utils.isAddress((a||"").trim()));
  if(!recOk) return;

  // amount is required for detection
  const amtStr = ($("inpAmount").value || "").trim();
  const amtNum = Number(amtStr);
  if(!Number.isFinite(amtNum) || amtNum <= 0) return;

  if(mode === "token"){
    const tokenAddr = ($("inpToken").value || "").trim();
    if(!ethers.utils.isAddress(tokenAddr)) return;

    const rawWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
    const netWei = amountAdjusted(rawWei);

    // find working method name (splitToken variant)
    const candidateMethods = ["splitToken"]; // same name, signature handled by ABI
    const scales = [100, 10000];
    const amountModes = ["raw", "net"]; // raw = send rawWei, net = send netWei

    for(const scale of scales){
      let perc;
      try{ perc = makePercents(scale); } catch(e){ continue; }
      for(const aMode of amountModes){
        const amtWei = (aMode === "raw") ? rawWei : netWei;
        for(const m of candidateMethods){
          try{
            await tryCallStaticToken(splitter, m, tokenAddr, amtWei, recipients, perc);
            detected = { percentScale: scale, amountMode: aMode, method: m, nativeMethod: null };
            $("teleDetected").textContent = `percentScale=${scale} • amountMode=${aMode}`;
            log(`Auto-detect OK: percentScale=${scale}, amountMode=${aMode}`);
            return;
          }catch(e){
            // keep trying
          }
        }
      }
    }

    // if none worked, show best guidance
    $("teleDetected").textContent = "Detection failed";
    log(`Auto-detect failed. Contract rejected callStatic with both percent scales and both amount modes.`);
  } else {
    // Native mode (optional): detect method shape
    // We will try two styles:
    // splitNative(amount, recipients, percents) payable
    // splitNative(recipients, percents) payable
    const scales = [100, 10000];
    for(const scale of scales){
      let perc;
      try{ perc = makePercents(scale); } catch(e){ continue; }
      try{
        const rawWei = ethers.utils.parseEther(amtStr);
        const netWei = amountAdjusted(rawWei);
        // try with amount param
        try{
          await splitter.callStatic.splitNative(netWei, recipients, perc, { value: netWei });
          detected = { percentScale: scale, amountMode: "net", method:null, nativeMethod:"splitNative(amount)" };
          $("teleDetected").textContent = `native • scale=${scale} • net`;
          log(`Native detect OK: splitNative(amount,...) scale=${scale}`);
          return;
        }catch(_e1){
          // try without amount param
          await splitter.callStatic.splitNative(recipients, perc, { value: netWei });
          detected = { percentScale: scale, amountMode: "net", method:null, nativeMethod:"splitNative()" };
          $("teleDetected").textContent = `native • scale=${scale} • net`;
          log(`Native detect OK: splitNative(recipients,...) scale=${scale}`);
          return;
        }
      }catch(e){
        // continue
      }
    }
  }
}

/* ===== Actions ===== */
async function approve(){
  setError("");
  if(!signer) return setError("Connect wallet first.");
  if($("selMode").value !== "token") return setError("Approve is only for token mode.");
  if(!tokenContract) return setError("Enter a valid token address.");

  const cfg = chainCfg();
  const amtStr = ($("inpAmount").value || "").trim();
  if(!amtStr) return setError("Enter an amount.");

  const rawWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);

  log(`Approving ${tokenMeta.symbol} for splitter ${cfg.splitter}…`);
  $("teleStatus").textContent = "Approving…";

  const tx = await tokenContract.connect(signer).approve(cfg.splitter, rawWei);
  log(`Approve tx: ${tx.hash}`);
  await tx.wait();
  log(`Approve confirmed ✅`);
  $("teleStatus").textContent = "Approve confirmed.";
  await refreshBalances();
}

async function execute(){
  setError("");
  if(!signer) return setError("Connect wallet first.");

  const cfg = chainCfg();
  const splitter = splitterContract();
  const { recipients } = recipientsList();
  const { percents } = recipientsList();

  // validate recipients
  if(recipients.length < 1) return setError("Add at least one recipient.");
  for(const a of recipients){
    if(!ethers.utils.isAddress((a||"").trim())) return setError(`Invalid recipient address: ${a}`);
  }

  const amtStr = ($("inpAmount").value || "").trim();
  const amtNum = Number(amtStr);
  if(!Number.isFinite(amtNum) || amtNum <= 0) return setError("Enter a valid amount.");

  // Ensure we have detection
  await detectIfPossible();
  if(!detected.percentScale || !detected.amountMode){
    return setError("Auto-detect failed. Check token address/amount/recipients and try again.");
  }

  // build percent array
  let percArr;
  try{
    percArr = makePercents(detected.percentScale);
  }catch(e){
    return setError(e.message);
  }

  $("teleStatus").textContent = "Executing…";

  if($("selMode").value === "token"){
    const tokenAddr = ($("inpToken").value || "").trim();
    if(!ethers.utils.isAddress(tokenAddr)) return setError("Invalid token address.");

    const rawWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
    const netWei = amountAdjusted(rawWei);

    const sendWei = (detected.amountMode === "raw") ? rawWei : netWei;
    $("postFeeLine").textContent = `You send (auto-detect) ${ethers.utils.formatUnits(sendWei, tokenMeta.decimals)} ${tokenMeta.symbol}`;

    log(`Executing splitToken… scale=${detected.percentScale}, amountMode=${detected.amountMode}`);
    try{
      // coin drops: one per recipient
      coinDrops(recipients.length);

      const tx = await splitter.connect(signer).splitToken(tokenAddr, sendWei, recipients, percArr);
      log(`Split tx: ${tx.hash}`);
      await tx.wait();
      log(`Split confirmed ✅`);
      $("teleStatus").textContent = "Split confirmed.";
      await refreshBalances();
    }catch(e){
      const msg = (e && e.message) ? e.message : String(e);
      log(`Split failed: ${msg}`);
      $("teleStatus").textContent = "Split failed.";
      setError("Split failed: " + msg);
    }
  } else {
    // Native split (optional)
    const rawWei = ethers.utils.parseEther(amtStr);
    const netWei = amountAdjusted(rawWei);
    try{
      coinDrops(recipients.length);

      if(detected.nativeMethod === "splitNative()"){
        const tx = await splitter.connect(signer).splitNative(recipients, percArr, { value: netWei });
        log(`Native split tx: ${tx.hash}`);
        await tx.wait();
      }else{
        const tx = await splitter.connect(signer).splitNative(netWei, recipients, percArr, { value: netWei });
        log(`Native split tx: ${tx.hash}`);
        await tx.wait();
      }
      log(`Native split confirmed ✅`);
      $("teleStatus").textContent = "Native split confirmed.";
      await refreshBalances();
    }catch(e){
      const msg = (e && e.message) ? e.message : String(e);
      log(`Native split failed: ${msg}`);
      $("teleStatus").textContent = "Native split failed.";
      setError("Native split failed: " + msg);
    }
  }
}

/* ===== MAX gas-safe (native only) ===== */
async function maxGasSafe(){
  setError("");
  if(!provider || !user) return setError("Connect wallet first.");
  if($("selMode").value !== "native"){
    return setError("MAX is for native only. For tokens, enter a token amount.");
  }
  const cfg = chainCfg();
  const bal = await provider.getBalance(user);

  // reserve gas buffer (chain-specific safe default)
  const reserve = ethers.utils.parseEther(
    cfg.chainId === 1 ? "0.003" : "0.001"
  );

  const safe = bal.gt(reserve) ? bal.sub(reserve) : ethers.constants.Zero;
  $("inpAmount").value = ethers.utils.formatEther(safe);
  log(`MAX (gas-safe) set: ${$("inpAmount").value} ${cfg.native}`);
  updateUsdEstimate();
  await detectIfPossible();
}

/* ===== UI wiring ===== */
function applyModeUI(){
  const mode = $("selMode").value;
  $("tokenBlock").style.display = (mode === "token") ? "block" : "none";
  $("btnApprove").disabled = (mode !== "token");
  $("gasHint").textContent = (mode === "native")
    ? "MAX reserves gas automatically."
    : "MAX is for native only. Tokens: enter amount.";
  $("modeHint").textContent = (mode === "native")
    ? "Native split sends coin value. Your contract may or may not support it."
    : "Token split uses Approve → Execute.";
}

function seedRecipients(){
  const root = $("recipients");
  root.innerHTML = "";
  root.appendChild(makeRecipientRow("", "50"));
  root.appendChild(makeRecipientRow("", "50"));
  updateTotals();
}

async function init(){
  seedRecipients();
  applyModeUI();

  const cfg = chainCfg();
  $("teleSplitter").textContent = cfg.splitter;
  $("pillNet").textContent = `Network: ${cfg.name} (chainId ${cfg.chainId})`;

  $("btnConnect").onclick = connect;
  $("btnSwitch").onclick = switchNetwork;

  $("selChain").onchange = async ()=>{
    detected = { percentScale:null, amountMode:null, method:null, nativeMethod:null };
    const c = chainCfg();
    $("teleSplitter").textContent = c.splitter;
    $("pillNet").textContent = `Network: ${c.name} (chainId ${c.chainId})`;
    log(`Chain selected: ${c.name}`);
    await refreshAll();
  };

  $("selMode").onchange = async ()=>{
    applyModeUI();
    detected = { percentScale:null, amountMode:null, method:null, nativeMethod:null };
    await loadToken();
    await detectIfPossible();
  };

  $("inpToken").oninput = async ()=>{
    await loadToken();
    await detectIfPossible();
  };

  $("inpAmount").oninput = async ()=>{
    setError("");
    updateUsdEstimate();
    await detectIfPossible();
  };

  $("btnAdd").onclick = ()=>{ $("recipients").appendChild(makeRecipientRow("", "0")); updateTotals(); };
  $("btnNormalize").onclick = ()=>{ setError(""); normalizePercents(); detectIfPossible(); };

  $("btnApprove").onclick = approve;
  $("btnExecute").onclick = execute;
  $("btnMax").onclick = maxGasSafe;

  $("btnRefresh").onclick = refreshAll;
  $("btnClear").onclick = ()=>{ $("log").textContent=""; log("Log cleared."); setError(""); };

  updateTotals();
  log("ZEPHENHEL CITADEL loaded.");
}

init();
