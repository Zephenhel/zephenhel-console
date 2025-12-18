(() => {
  const SPLITTERS = {
    bsc: { chainId: 56, name: "BSC Mainnet", addr: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c", dexscreenerChain: "bsc", native: "BNB" },
    eth: { chainId: 1, name: "Ethereum Mainnet", addr: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2", dexscreenerChain: "ethereum", native: "ETH" },
    polygon:{ chainId: 137, name: "Polygon Mainnet", addr: "0x05948E68137eC131E1f0E27028d09fa174679ED4", dexscreenerChain: "polygon", native: "MATIC"}
  };

  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];

  // function from your logs:
  const SPLITTER_ABI = [
    "function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external"
  ];

  const $ = (id) => document.getElementById(id);

  const logEl = $("log");
  const errBox = $("errBox");
  const connectBtn = $("connectBtn");
  const switchBtn = $("switchBtn");
  const chainMode = $("chainMode");
  const splitterAddr = $("splitterAddr");
  const tokenAddr = $("tokenAddr");
  const amountEl = $("amount");
  const maxBtn = $("maxBtn");
  const addRecipientBtn = $("addRecipient");
  const recipientsWrap = $("recipientsWrap");
  const pctTotalEl = $("pctTotal");
  const pctWarnEl = $("pctWarn");
  const approveBtn = $("approveBtn");
  const splitBtn = $("splitBtn");
  const netLabel = $("netLabel");
  const acctLabel = $("acctLabel");
  const dot = $("dot");
  const statusText = $("statusText");
  const nativeBal = $("nativeBal");
  const tokenBal = $("tokenBal");
  const tokSym = $("tokSym");
  const tokDec = $("tokDec");
  const priceUsdEl = $("priceUsd");
  const valueUsdEl = $("valueUsd");
  const allowanceEl= $("allowance");
  const clearLog = $("clearLog");

  let provider = null;
  let signer = null;
  let account = null;
  let currentChainId = null;

  let token = null;
  let tokenDecimals = 18;
  let tokenSymbol = "";
  let tokenPriceUsd = null;

  function now() {
    const d = new Date();
    return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  }
  function log(msg){
    logEl.textContent += `[${now()}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setErr(msg){
    if(!msg){
      errBox.style.display = "none";
      errBox.textContent = "";
      return;
    }
    errBox.style.display = "block";
    errBox.textContent = msg;
  }
  function setStatus(txt){ statusText.textContent = txt; }
  function shortAddr(a){ return a ? (a.slice(0,6) + "…" + a.slice(-4)) : "—"; }
  function hexChainId(n){ return "0x" + Number(n).toString(16); }

  // Sounds (no files)
  let audioCtx = null;
  function A(){ if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
  function radarPing(){
    try{
      const ctx=A(), t0=ctx.currentTime;
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type="sine";
      o.frequency.setValueAtTime(620,t0);
      o.frequency.exponentialRampToValueAtTime(1400,t0+0.08);
      o.frequency.exponentialRampToValueAtTime(780,t0+0.18);
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.exponentialRampToValueAtTime(0.18,t0+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0+0.24);
    }catch(e){}
  }
  function coinTicks(count){
    const n=Math.max(1,Math.min(18,count|0));
    try{
      const ctx=A(), base=ctx.currentTime;
      for(let i=0;i<n;i++){
        const o=ctx.createOscillator(), g=ctx.createGain();
        const t=base+i*0.06;
        o.type="triangle";
        o.frequency.setValueAtTime(900+(i%5)*90,t);
        g.gain.setValueAtTime(0.0001,t);
        g.gain.exponentialRampToValueAtTime(0.12,t+0.01);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.05);
        o.connect(g).connect(ctx.destination);
        o.start(t); o.stop(t+0.06);
      }
    }catch(e){}
  }

  function selectedMode(){ return chainMode.value; }
  function chainMatchesSelected(){
    const mode=selectedMode();
    return Number(currentChainId) === Number(SPLITTERS[mode].chainId);
  }

  function updateSplitterUI(){
    const mode=selectedMode();
    splitterAddr.value=SPLITTERS[mode].addr;
  }

  // Recipients UI
  function newRecipientRow(addr="", pct=""){
    const wrap=document.createElement("div");
    wrap.className="recipient";

    const addrInput=document.createElement("input");
    addrInput.className="input mono";
    addrInput.placeholder="Recipient address (0x...)";
    addrInput.value=addr;

    const pctInput=document.createElement("input");
    pctInput.className="input mono";
    pctInput.placeholder="%";
    pctInput.value=pct;

    const del=document.createElement("button");
    del.className="xbtn";
    del.type="button";
    del.textContent="×";
    del.onclick=()=>{wrap.remove(); refreshPct(); refreshButtons(); refreshUsdEstimate();};

    addrInput.oninput=()=>refreshButtons();
    pctInput.oninput=()=>{refreshPct(); refreshButtons(); refreshUsdEstimate();};

    wrap.appendChild(addrInput);
    wrap.appendChild(pctInput);
    wrap.appendChild(del);
    return wrap;
  }

  function getRecipients(){
    const rows=[...recipientsWrap.querySelectorAll(".recipient")];
    const recipients=[];
    const percents=[];
    for(const r of rows){
      const inputs=r.querySelectorAll("input");
      const a=(inputs[0].value||"").trim();
      const p=(inputs[1].value||"").trim();
      if(a.length) recipients.push(a);
      percents.push(Number(p||"0"));
    }
    return { recipients, percents };
  }

  function refreshPct(){
    const rows=[...recipientsWrap.querySelectorAll(".recipient")];
    let total=0;
    for(const r of rows){
      const p=Number((r.querySelectorAll("input")[1].value||"0").trim());
      total += (isFinite(p) ? p : 0);
    }
    pctTotalEl.textContent=String(total);
    pctWarnEl.style.display=(total===100)?"none":"block";
    return (total===100);
  }

  async function refreshBalances(){
    if(!provider||!account) return;
    const mode=selectedMode();
    const bal=await provider.getBalance(account);
    nativeBal.textContent=`${Number(ethers.utils.formatEther(bal)).toFixed(6)} ${SPLITTERS[mode].native}`;

    if(token){
      const tb=await token.balanceOf(account);
      const fmt=ethers.utils.formatUnits(tb, tokenDecimals);
      tokenBal.textContent=`${Number(fmt).toLocaleString(undefined,{maximumFractionDigits:6})} ${tokenSymbol}`.trim();
    } else tokenBal.textContent="—";
  }

  async function fetchDexscreenerPriceUsd(tokenAddress){
    const mode=selectedMode();
    const wantChain=SPLITTERS[mode].dexscreenerChain;
    try{
      const res=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if(!res.ok) return null;
      const data=await res.json();
      const pairs=data?.pairs||[];
      if(!pairs.length) return null;

      const matches=pairs.filter(p=>(p.chainId||"").toLowerCase()===wantChain);
      const list=matches.length?matches:pairs;
      list.sort((a,b)=>Number(b.liquidity?.usd||0)-Number(a.liquidity?.usd||0));
      const best=list[0];
      const price=Number(best.priceUsd);
      return isFinite(price)?price:null;
    }catch(e){ return null; }
  }

  function refreshUsdEstimate(){
    const amt=Number((amountEl.value||"0").trim());
    if(!tokenPriceUsd||!isFinite(tokenPriceUsd)||!isFinite(amt)||amt<=0){
      valueUsdEl.textContent="—"; return;
    }
    valueUsdEl.textContent="$"+(amt*tokenPriceUsd).toLocaleString(undefined,{maximumFractionDigits:2});
  }

  async function refreshTokenInfo(){
    setErr(null);
    token=null; tokenDecimals=18; tokenSymbol=""; tokenPriceUsd=null;

    tokSym.textContent="—";
    tokDec.textContent="—";
    priceUsdEl.textContent="—";
    valueUsdEl.textContent="—";
    allowanceEl.textContent="—";

    const t=(tokenAddr.value||"").trim();
    if(!t){ refreshButtons(); await refreshBalances(); return; }
    if(!ethers.utils.isAddress(t)){ setErr("Token address is not a valid 0x address."); refreshButtons(); return; }
    if(!provider){ refreshButtons(); return; }

    try{
      token=new ethers.Contract(t, ERC20_ABI, signer||provider);

      const decRaw=await token.decimals();
      tokenDecimals = Number(decRaw);
      tokenSymbol = await token.symbol();

      tokSym.textContent=tokenSymbol;
      tokDec.textContent=String(tokenDecimals);
      log(`Token loaded: ${tokenSymbol} (decimals ${tokenDecimals})`);
    }catch(e){
      token=null;
      setErr("Could not read token contract. Check chain + token address.");
      refreshButtons(); return;
    }

    const px=await fetchDexscreenerPriceUsd(t);
    tokenPriceUsd=px;
    priceUsdEl.textContent=px ? ("$"+px.toLocaleString(undefined,{maximumFractionDigits:8})) : "— (Dexscreener unavailable)";
    await refreshBalances();
    await refreshAllowance();
    refreshUsdEstimate();
    refreshButtons();
  }

  function amountToWei(){
    const raw=(amountEl.value||"0").trim();
    try{ return ethers.utils.parseUnits(raw, tokenDecimals); }
    catch(e){ return null; }
  }

  async function refreshAllowance(){
    if(!token || !account){ allowanceEl.textContent="—"; return; }
    const spender=SPLITTERS[selectedMode()].addr;
    try{
      const al=await token.allowance(account, spender);
      const fmt=ethers.utils.formatUnits(al, tokenDecimals);
      allowanceEl.textContent=`${Number(fmt).toLocaleString(undefined,{maximumFractionDigits:6})} ${tokenSymbol}`.trim();
    }catch(e){
      allowanceEl.textContent="—";
    }
  }

  function explainEthersError(e){
    const parts = [
      e?.error?.data?.message,
      e?.error?.message,
      e?.data?.message,
      e?.reason,
      e?.message
    ].filter(Boolean);

    const m = parts[0] || "Unknown error";

    if(String(m).toLowerCase().includes("user rejected")) return "Transaction rejected in MetaMask.";
    if(String(m).includes("UNPREDICTABLE_GAS_LIMIT")) return "Cannot estimate gas (revert). Usually wrong percent scale (100 vs 10000) or splitter rule not met.";
    if(String(m).includes("execution reverted")) return "Execution reverted by contract (rule not met). Often percent scale mismatch.";
    return String(m);
  }

  async function connect(){
    setErr(null);
    if(!window.ethereum){
      setErr("MetaMask not detected. Install/enable it in Edge and refresh.");
      return;
    }
    provider=new ethers.providers.Web3Provider(window.ethereum,"any");
    try{ await provider.send("eth_requestAccounts",[]); }
    catch(e){ setErr("Wallet connection rejected."); return; }

    signer=provider.getSigner();
    account=await signer.getAddress();
    const net=await provider.getNetwork();
    currentChainId=net.chainId;

    radarPing();
    acctLabel.textContent=shortAddr(account);
    netLabel.textContent=`${net.name} (chainId ${net.chainId})`;

    dot.className="dot " + (chainMatchesSelected() ? "good" : "warn");
    setStatus("Connected.");
    log(`Connected: ${account} on chainId ${net.chainId}`);

    window.ethereum.on?.("accountsChanged",()=>window.location.reload());
    window.ethereum.on?.("chainChanged",()=>window.location.reload());

    await refreshBalances();
    await refreshTokenInfo();
    refreshButtons();
  }

  async function switchNetworkToSelected(){
    const mode=selectedMode();
    const target=SPLITTERS[mode].chainId;
    try{
      await window.ethereum.request({
        method:"wallet_switchEthereumChain",
        params:[{ chainId: hexChainId(target) }]
      });
    }catch(e){
      setErr("Could not switch automatically. Switch in MetaMask and refresh.");
    }
  }

  async function approve(){
    setErr(null);
    if(!provider||!signer||!account) return;

    if(!chainMatchesSelected()){
      setErr("Wrong network selected. Click Switch Network then try again.");
      return;
    }
    if(!token){ setErr("Load a token first."); return; }

    const amt=amountToWei();
    if(!amt||amt.lte(0)){ setErr("Enter a valid token amount."); return; }

    const spender=SPLITTERS[selectedMode()].addr;

    try{
      setStatus("Sending approve…");
      log(`Approving ${tokenSymbol} for splitter ${spender}`);
      const tx=await token.connect(signer).approve(spender, amt);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();
      setStatus("Approve confirmed ✅");
      log("Approve confirmed ✅");
      await refreshAllowance();
      refreshButtons();
    }catch(e){
      setStatus("Approve failed.");
      const msg=explainEthersError(e);
      setErr(msg);
      log("Approve failed: "+msg);
    }
  }

  function scalePercents(percents, factor){
    return percents.map(p => Math.round(Number(p||0) * factor));
  }
  function sum(arr){ return arr.reduce((a,b)=>a+Number(b||0),0); }

  async function executeSplit(){
    setErr(null);
    if(!provider||!signer||!account) return;

    if(!chainMatchesSelected()){
      setErr("Wrong network. Click Switch Network then try again.");
      return;
    }
    if(!token){ setErr("Load a token first."); return; }

    const amt=amountToWei();
    if(!amt||amt.lte(0)){ setErr("Enter a valid token amount."); return; }

    const pctOk=refreshPct();
    if(!pctOk){ setErr("Percents must total exactly 100."); return; }

    const { recipients, percents } = getRecipients();
    if(recipients.length < 1){ setErr("Add at least one recipient."); return; }

    for(const r of recipients){
      if(!ethers.utils.isAddress(r)){ setErr("One recipient is not a valid 0x address."); return; }
    }

    // allowance check
    const spender=SPLITTERS[selectedMode()].addr;
    const al=await token.allowance(account, spender);
    if(al.lt(amt)){
      setErr("Allowance is too low. Click Approve first.");
      return;
    }

    const splitter = new ethers.Contract(spender, SPLITTER_ABI, signer);

    const attempt1 = percents.map(p => Math.round(Number(p||0))); // sum 100
    const attempt2 = scalePercents(percents, 100); // sum 10000

    try{
      setStatus("Preflight…");
      log(`Preflight callStatic (sum=${sum(attempt1)})`);
      await splitter.callStatic.splitToken(token.address, amt, recipients, attempt1);

      setStatus("Executing…");
      coinTicks(recipients.length);
      const tx = await splitter.splitToken(token.address, amt, recipients, attempt1);
      log(`Split tx: ${tx.hash}`);
      setStatus("Waiting confirmation…");
      await tx.wait();
      setStatus("Split complete ✅");
      log("Split complete ✅");
      await refreshBalances();
      await refreshAllowance();
      refreshButtons();
      return;

    } catch(e1){
      try{
        setStatus("Preflight…");
        log(`Preflight callStatic (auto x100, sum=${sum(attempt2)})`);
        await splitter.callStatic.splitToken(token.address, amt, recipients, attempt2);

        log("Auto-detected splitter expects basis points (10000). Using x100 percents.");
        setStatus("Executing…");
        coinTicks(recipients.length);
        const tx = await splitter.splitToken(token.address, amt, recipients, attempt2);
        log(`Split tx: ${tx.hash}`);
        setStatus("Waiting confirmation…");
        await tx.wait();
        setStatus("Split complete ✅");
        log("Split complete ✅");
        await refreshBalances();
        await refreshAllowance();
        refreshButtons();
        return;

      } catch(e2){
        setStatus("Split failed.");
        const msg = explainEthersError(e2);
        setErr(msg);
        log("Split failed: "+msg);
      }
    }
  }

  async function setMax(){
    setErr(null);
    if(!token || !account){ setErr("Connect wallet and load token first."); return; }
    try{
      const b = await token.balanceOf(account);
      const fmt = ethers.utils.formatUnits(b, tokenDecimals);
      amountEl.value = (Number(fmt)).toString();
      refreshUsdEstimate();
      refreshButtons();
      log("MAX set to token balance.");
    }catch(e){ setErr("Could not read token balance."); }
  }

  async function refreshButtons(){
    updateSplitterUI();

    const connected = !!account && !!provider && !!signer;
    const match = connected ? chainMatchesSelected() : false;

    if(!connected){
      dot.className="dot";
      connectBtn.textContent="Connect Wallet";
      switchBtn.style.display="none";
      approveBtn.disabled=true;
      splitBtn.disabled=true;
      return;
    }

    dot.className="dot " + (match ? "good" : "warn");
    connectBtn.textContent="Connected";
    switchBtn.style.display = match ? "none" : "inline-flex";

    const amt = amountToWei();
    const amtOk = amt && amt.gt(0);
    const pctOk = refreshPct();
    const tokenOk = !!token;

    approveBtn.disabled = !(connected && match && tokenOk && amtOk);
    splitBtn.disabled = !(connected && match && tokenOk && amtOk && pctOk);

    try{ await refreshBalances(); }catch(e){}
    refreshUsdEstimate();
  }

  function initRecipients(){
    recipientsWrap.innerHTML="";
    recipientsWrap.appendChild(newRecipientRow("", "50"));
    recipientsWrap.appendChild(newRecipientRow("", "50"));
    refreshPct();
  }

  // events
  chainMode.onchange = async () => {
    updateSplitterUI();
    setErr(null);
    if(provider){
      const net=await provider.getNetwork();
      currentChainId=net.chainId;
      netLabel.textContent=`${net.name} (chainId ${net.chainId})`;
      dot.className="dot " + (chainMatchesSelected() ? "good" : "warn");
    }
    await refreshTokenInfo();
    refreshButtons();
  };

  tokenAddr.addEventListener("change", refreshTokenInfo);
  tokenAddr.addEventListener("blur", refreshTokenInfo);
  amountEl.addEventListener("input", () => { refreshUsdEstimate(); refreshButtons(); });

  connectBtn.onclick = connect;
  switchBtn.onclick = switchNetworkToSelected;
  approveBtn.onclick = approve;
  splitBtn.onclick = executeSplit;
  maxBtn.onclick = setMax;

  addRecipientBtn.onclick = () => {
    recipientsWrap.appendChild(newRecipientRow("", "0"));
    refreshPct(); refreshButtons(); refreshUsdEstimate();
  };

  clearLog.onclick = () => { logEl.textContent=""; setErr(null); };

  // boot
  updateSplitterUI();
  initRecipients();
  setStatus("Ready. Connect wallet to begin.");
  log("Boot: ZEPHENHEL CITADEL loaded.");
})();
