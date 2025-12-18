const SPLITTER_DEFAULT_BSC = "0x928B75D0fA6382D4B742afB6e500C9458B4f502c";
const BSC_CHAIN_ID_HEX = "0x38";

const SPLITTER_ABI = [
  "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const $ = (id) => document.getElementById(id);

let provider, signer, account;
let tokenMeta = { symbol: "—", decimals: 18, priceUsd: null };

function log(msg){
  const el = $("log");
  const t = new Date().toLocaleTimeString();
  el.textContent += `[${t}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function setWarn(msg){
  const w = $("warn");
  if (!msg) { w.hidden = true; w.textContent = ""; return; }
  w.hidden = false;
  w.textContent = msg;
  log("WARN: " + msg);
}
function setMmChip(){
  const has = !!window.ethereum;
  $("mmChip").innerHTML = `MetaMask: <b>${has ? "YES" : "NO"}</b>`;
  if (!has) setWarn("MetaMask not detected. Make sure extension is enabled and you are not in Private/Incognito.");
}
function setNetChip(chainIdHex){
  const ok = chainIdHex === BSC_CHAIN_ID_HEX;
  $("netChip").innerHTML = `Chain: <b>${chainIdHex ? (ok ? "BSC" : chainIdHex) : "—"}</b>`;
}
function setAcctChip(addr){
  $("acctChip").innerHTML = `Wallet: <b>${addr ? addr.slice(0,6)+"…"+addr.slice(-4) : "DISCONNECTED"}</b>`;
}

function addRow(addr="", pct=""){
  const wrap = $("list");
  const row = document.createElement("div");
  row.className = "item";
  row.innerHTML = `
    <div>
      <div class="miniLabel">Address</div>
      <input class="addr" placeholder="0x..." spellcheck="false" value="${addr}"/>
    </div>
    <div>
      <div class="miniLabel">Percent</div>
      <input class="pct" placeholder="%" inputmode="numeric" value="${pct}"/>
    </div>
    <div>
      <button class="btn mini del">REMOVE</button>
    </div>
  `;
  row.querySelector(".del").onclick = () => { row.remove(); updateTotal(); };
  row.querySelector(".pct").addEventListener("input", () => {
    const el = row.querySelector(".pct");
    el.value = el.value.replace(/[^\d]/g,"");
    updateTotal();
  });
  wrap.appendChild(row);
  updateTotal();
}

function rows(){
  return [...document.querySelectorAll(".item")].map(r => ({
    addr: r.querySelector(".addr").value.trim(),
    pct: Number(r.querySelector(".pct").value.trim() || "0"),
  }));
}
function updateTotal(){
  const t = rows().reduce((a,x)=>a+(Number.isFinite(x.pct)?x.pct:0),0);
  $("total").textContent = `${t}%`;
  return t;
}

async function ensureEthers(){
  // ethers is loaded async from CDN; wait briefly
  for (let i=0;i<40;i++){
    if (window.ethers) return true;
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error("Ethers library did not load. Try hard refresh (Ctrl+Shift+R).");
}

async function ensureBsc(){
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  setNetChip(chainId);
  if (chainId === BSC_CHAIN_ID_HEX) return;

  log("Switching chain to BSC…");
  try{
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  }catch(e){
    if (e?.code === 4902){
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BSC_CHAIN_ID_HEX,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-dataseed.binance.org/"],
          blockExplorerUrls: ["https://bscscan.com/"],
        }],
      });
    } else {
      throw e;
    }
  }
  const chainId2 = await window.ethereum.request({ method: "eth_chainId" });
  setNetChip(chainId2);
}

async function connect(){
  setWarn("");
  try{
    await ensureEthers();
    setMmChip();

    if (!window.ethereum) return;

    await ensureBsc();

    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    account = await signer.getAddress();
    setAcctChip(account);
    log("Connected: " + account);

    await refreshTokenPanels();
  }catch(e){
    setWarn(e?.message || String(e));
  }
}

async function fetchDexPriceUsd_BSC(tokenAddr){
  try{
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const bscPairs = pairs.filter(p => (p.chainId || "").toLowerCase() === "bsc");
    bscPairs.sort((a,b)=>Number(b?.liquidity?.usd||0)-Number(a?.liquidity?.usd||0));
    const best = bscPairs[0] || pairs[0];
    const p = Number(best?.priceUsd || 0);
    return Number.isFinite(p) && p > 0 ? p : null;
  }catch{
    return null;
  }
}

function updateUsd(){
  const amt = Number(($("amount").value || "").trim());
  if (!Number.isFinite(amt) || amt <= 0 || !tokenMeta.priceUsd){
    $("usd").textContent = "$—";
    return;
  }
  const v = amt * tokenMeta.priceUsd;
  $("usd").textContent = "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function refreshTokenPanels(){
  const tokenAddr = $("token").value.trim();
  const splitterAddr = $("splitter").value.trim();

  $("bal").textContent = "—";
  $("alw").textContent = "—";

  if (!provider || !account) return;
  if (!tokenAddr || !ethers.utils.isAddress(tokenAddr)){
    $("tokenMeta").textContent = "Token: — • Decimals: — • Price: —";
    return;
  }

  try{
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
    const [sym, dec] = await Promise.all([token.symbol(), token.decimals()]);
    tokenMeta.symbol = sym;
    tokenMeta.decimals = Number(dec);

    const [bal, alw, price] = await Promise.all([
      token.balanceOf(account),
      (ethers.utils.isAddress(splitterAddr) ? token.allowance(account, splitterAddr) : Promise.resolve(ethers.constants.Zero)),
      fetchDexPriceUsd_BSC(tokenAddr)
    ]);

    tokenMeta.priceUsd = price;

    $("tokenMeta").textContent =
      `Token: ${sym} • Decimals: ${tokenMeta.decimals} • Price: ${price ? "$"+price.toFixed(6) : "—"}`;

    $("bal").textContent = `${ethers.utils.formatUnits(bal, tokenMeta.decimals)} ${sym}`;
    $("alw").textContent = ethers.utils.formatUnits(alw, tokenMeta.decimals);

    updateUsd();
    log(`Token loaded: ${sym} (dec ${tokenMeta.decimals})`);
  }catch(e){
    setWarn("Could not load token data. Check token address and that you are on BSC.");
  }
}

function buildArrays(){
  const splitterAddr = $("splitter").value.trim();
  const tokenAddr = $("token").value.trim();
  const amountStr = ($("amount").value || "").trim();

  if (!account) throw new Error("Connect wallet first.");
  if (!ethers.utils.isAddress(splitterAddr)) throw new Error("Invalid splitter address.");
  if (!ethers.utils.isAddress(tokenAddr)) throw new Error("Invalid token address.");
  if (!amountStr) throw new Error("Enter amount.");

  const total = updateTotal();
  if (total !== 100) throw new Error(`Recipient total must be 100%. Current: ${total}%`);

  const recs = rows();
  if (recs.length < 1) throw new Error("Add at least 1 recipient.");

  const accounts = [];
  const shares = [];
  for (const r of recs){
    if (!ethers.utils.isAddress(r.addr)) throw new Error(`Bad recipient address: ${r.addr}`);
    if (!Number.isFinite(r.pct) || r.pct <= 0) throw new Error("Each recipient percent must be > 0.");
    accounts.push(r.addr);
    shares.push(Math.round(r.pct));
  }

  const amount = ethers.utils.parseUnits(amountStr, tokenMeta.decimals);
  return { splitterAddr, tokenAddr, accounts, shares, amount };
}

async function approve(){
  setWarn("");
  try{
    await ensureBsc();
    const { splitterAddr, tokenAddr, amount } = buildArrays();

    const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
    const alw = await token.allowance(account, splitterAddr);
    if (alw.gte(amount)){
      setWarn("Allowance already sufficient. You can EXECUTE SPLIT.");
      return;
    }

    log("Sending approve…");
    const tx = await token.approve(splitterAddr, amount);
    setWarn(`Approve sent: ${tx.hash}`);
    await tx.wait();
    setWarn("Approve confirmed. Now EXECUTE SPLIT.");
    await refreshTokenPanels();
  }catch(e){
    setWarn(e?.message || String(e));
  }
}

async function executeSplit(){
  setWarn("");
  try{
    await ensureBsc();
    const { splitterAddr, tokenAddr, accounts, shares, amount } = buildArrays();

    const splitter = new ethers.Contract(splitterAddr, SPLITTER_ABI, signer);
    log("Executing split…");
    const tx = await splitter.depositAndDistribute(tokenAddr, accounts, shares, amount);

    const receiptBox = $("receipt");
    const receiptText = $("receiptText");
    const txLink = $("txLink");

    receiptBox.hidden = false;
    txLink.style.display = "inline-flex";
    txLink.href = `https://bscscan.com/tx/${tx.hash}`;

    const amtHuman = ethers.utils.formatUnits(amount, tokenMeta.decimals);
    const lines = [];
    lines.push("ZEPHENHEL CITADEL — RECEIPT");
    lines.push("──────────────────────────");
    lines.push(`TX: ${tx.hash}`);
    lines.push(`Splitter: ${splitterAddr}`);
    lines.push(`Token: ${tokenAddr} (${tokenMeta.symbol})`);
    lines.push(`Amount: ${amtHuman}`);
    if (tokenMeta.priceUsd){
      const est = Number(amtHuman) * tokenMeta.priceUsd;
      if (Number.isFinite(est)) lines.push(`USD Estimate: $${est.toLocaleString(undefined,{maximumFractionDigits:2})}`);
    }
    lines.push("Fee: 1% (enforced by splitter contract)");
    lines.push("Recipients:");
    accounts.forEach((a,i)=> lines.push(` ${i+1}. ${a} — ${shares[i]}%`));
    lines.push(`Time: ${new Date().toLocaleString()}`);

    receiptText.textContent = lines.join("\n");

    setWarn(`Split sent: ${tx.hash}`);
    await tx.wait();
    setWarn("Split confirmed ✅");
    await refreshTokenPanels();
  }catch(e){
    setWarn(e?.message || String(e));
  }
}

function copyReceipt(){
  const t = $("receiptText").textContent || "";
  if (!t) return;
  navigator.clipboard.writeText(t).then(()=> setWarn("Receipt copied.")).catch(()=> setWarn("Clipboard blocked."));
}

function boot(){
  // hard fail visibility
  window.addEventListener("error", (e) => {
    setWarn("Runtime error: " + (e?.message || "unknown"));
  });

  $("splitter").value = SPLITTER_DEFAULT_BSC;

  // Start with 2 rows so you SEE it’s alive
  addRow("", "50");
  addRow("", "50");

  $("connectBtn").addEventListener("click", connect);
  $("switchBtn").addEventListener("click", async () => { try { await ensureBsc(); } catch(e){ setWarn(e?.message||String(e)); }});
  $("addBtn").addEventListener("click", () => addRow("", ""));
  $("approveBtn").addEventListener("click", approve);
  $("splitBtn").addEventListener("click", executeSplit);
  $("copyBtn").addEventListener("click", copyReceipt);
  $("clearLog").addEventListener("click", () => { $("log").textContent=""; });

  $("token").addEventListener("change", refreshTokenPanels);
  $("amount").addEventListener("input", updateUsd);
  $("splitter").addEventListener("change", refreshTokenPanels);

  setMmChip();
  setNetChip(null);
  setAcctChip(null);
  log("Citadel online. Waiting for CONNECT.");

  if (window.ethereum){
    window.ethereum.on("accountsChanged", (accs) => {
      account = accs?.[0] || null;
      setAcctChip(account);
      log("Account changed.");
      refreshTokenPanels();
    });
    window.ethereum.on("chainChanged", (cid) => {
      setNetChip(cid);
      log("Chain changed: " + cid);
      refreshTokenPanels();
    });
  }
}

document.addEventListener("DOMContentLoaded", boot);
