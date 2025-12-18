/* global ethers */

(() => {
  // ========= Config (YOUR DEPLOYED ADDRESSES) =========
  const SPLITTERS = {
    56: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c", // BSC
    1: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2", // ETH
    137:"0x05948E68137eC131E1f0E27028d09fa174679ED4", // POLYGON
  };

  const VAULTS = {
    56: "0x69BD92784b9ED63a40d2cf51b475Ba68B37bD59E",
    1: "0x886f915D21A5BC540E86655a89e6223981D875d8",
    137:"0xde07160A2eC236315Dd27e9600f88Ba26F86f06e",
  };

  // Wrapped native for Dexscreener fallback pricing
  const WRAPPED = {
    56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
  };

  const NATIVE_SYMBOL = { 56:"BNB", 1:"ETH", 137:"MATIC" };

  // Your splitter platform fee (used for fee-adjust auto-try variants)
  const PLATFORM_FEE_BPS = 100; // 1%

  // ========= ABIs =========
  // Splitter ABI (supports token + native). If your splitter omits native or token, code guards it.
  const SPLITTER_ABI = [
    "function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external",
    "function splitNative(address[] recipients, uint256[] percents) external payable",
    "function platformFeeBps() view returns (uint256)", // optional
    "function platformFeePercent() view returns (uint256)", // optional
  ];

  const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  // Vault ABI (generic; calls are guarded if function missing)
  const VAULT_ABI = [
    "function createVault(address token, address beneficiary, uint256 amount, uint256 releaseTime, string label) external returns (uint256)",
    "function triggerVault(uint256 vaultId) external",
    "function inspectVault(uint256 vaultId) view returns (address owner,address token,address beneficiary,uint256 amount,uint256 releaseTime,bool released,string label)",
  ];

  // ========= DOM =========
  const $ = (id) => document.getElementById(id);

  const pillNet = $("pillNet");
  const pillWallet = $("pillWallet");
  const btnConnect = $("btnConnect");
  const btnSwitch = $("btnSwitch");

  const tabBtnSplit = $("tabBtnSplit");
  const tabBtnVault = $("tabBtnVault");
  const tabSplit = $("tabSplit");
  const tabVault = $("tabVault");

  const toggleSound = $("toggleSound");

  const selChain = $("selChain");
  const selSplitType = $("selSplitType");
  const inpToken = $("inpToken");
  const inpAmount = $("inpAmount");
  const btnMax = $("btnMax");
  const btnAddRecipient = $("btnAddRecipient");
  const btnNormalize = $("btnNormalize");
  const recipientsEl = $("recipients");
  const pillTotal = $("pillTotal");

  const btnApprove = $("btnApprove");
  const btnExecute = $("btnExecute");
  const btnRefresh = $("btnRefresh");
  const btnClearLog = $("btnClearLog");

  const errBox = $("errBox");

  const tvNative = $("tvNative");
  const tvNativeUsd = $("tvNativeUsd");
  const tvSymbol = $("tvSymbol");
  const tvDecimals = $("tvDecimals");
  const tvTokenBal = $("tvTokenBal");
  const tvTokenUsd = $("tvTokenUsd");
  const tvAllow = $("tvAllow");
  const tvSplitter = $("tvSplitter");
  const tvPlanned = $("tvPlanned");
  const tvReceive = $("tvReceive");
  const tvScale = $("tvScale");
  const tvScaleHint = $("tvScaleHint");

  const chipMode = $("chipMode");
  const chipStatus = $("chipStatus");
  const logEl = $("log");

  // Vault DOM
  const selVaultChain = $("selVaultChain");
  const inpVaultAddr = $("inpVaultAddr");
  const vaultToken = $("vaultToken");
  const vaultBeneficiary = $("vaultBeneficiary");
  const vaultAmount = $("vaultAmount");
  const vaultRelease = $("vaultRelease");
  const vaultLabel = $("vaultLabel");
  const vaultId = $("vaultId");
  const btnVaultApprove = $("btnVaultApprove");
  const btnVaultCreate = $("btnVaultCreate");
  const btnVaultInspect = $("btnVaultInspect");
  const btnVaultTrigger = $("btnVaultTrigger");
  const vaultErr = $("vaultErr");
  const vaultLog = $("vaultLog");

  // ========= State =========
  let provider, signer, account, chainId;
  let lastTokenMeta = null; // {symbol,decimals,name}
  let lastTokenPriceUsd = null; // number
  let lastNativePriceUsd = null; // number
  let lastDetectedScale = null; // {scale,totalMode}

  // ========= Audio (self-contained) =========
  function playRadarPing() {
    if (!toggleSound.checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.2);
      setTimeout(()=>ctx.close(), 350);
    } catch {}
  }

  function playCoinTicks(count) {
    if (!toggleSound.checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const base = ctx.currentTime;
      for (let i=0;i<count;i++){
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        const t = base + i*0.05;
        o.frequency.setValueAtTime(420 + (i%4)*80, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t+0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t+0.07);
      }
      setTimeout(()=>ctx.close(), 1200);
    } catch {}
  }

  // ========= Utils =========
  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    logEl.textContent += `[${ts}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function vLog(msg){
    const ts = new Date().toLocaleTimeString();
    vaultLog.textContent += `[${ts}] ${msg}\n`;
    vaultLog.scrollTop = vaultLog.scrollHeight;
  }

  function setError(text) {
    errBox.style.display = "block";
    errBox.textContent = text;
  }
  function clearError() {
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  function setVaultError(text){
    vaultErr.style.display = "block";
    vaultErr.textContent = text;
  }
  function clearVaultError(){
    vaultErr.style.display = "none";
    vaultErr.textContent = "";
  }

  function shortAddr(a){
    if(!a) return "—";
    return a.slice(0,6) + "…" + a.slice(-4);
  }

  function formatNum(x, d=6){
    if (x === null || x === undefined) return "—";
    const n = Number(x);
    if (!isFinite(n)) return "—";
    return n.toLocaleString(undefined, {maximumFractionDigits:d});
  }

  function parseAmountInput(){
    const s = (inpAmount.value || "").trim();
    if(!s) return null;
    const n = Number(s);
    if(!isFinite(n) || n<=0) return null;
    return n;
  }

  function clampRecipients(){
    const rows = [...recipientsEl.querySelectorAll(".recRow")];
    const data = rows.map(r => {
      const addr = r.querySelector(".recAddr").value.trim();
      const share = Number(r.querySelector(".recShare").value);
      return {addr, share};
    });
    return data;
  }

  function updateTotalPill(){
    const data = clampRecipients();
    const total = data.reduce((a,b)=>a+(isFinite(b.share)?b.share:0),0);
    pillTotal.textContent = `Total: ${formatNum(total,2)}%`;
    return total;
  }

  function ensureProvider(){
    if (!window.ethereum) {
      setError("MetaMask not found. Install MetaMask extension in Edge.");
      throw new Error("No ethereum provider");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  function getActiveSplitterAddress(){
    const cid = Number(selChain.value);
    return SPLITTERS[cid];
  }

  function getActiveVaultAddress(){
    const cid = Number(selVaultChain.value);
    return VAULTS[cid];
  }

  function currentChainLabel(){
    if(!chainId) return "—";
    if(chainId===56) return "BNB Chain (56)";
    if(chainId===1) return "Ethereum (1)";
    if(chainId===137) return "Polygon (137)";
    return `Chain ${chainId}`;
  }

  function setConnectedUI(isConnected){
    if(isConnected){
      btnConnect.textContent = "CONNECTED";
      btnConnect.classList.add("connected");
      btnConnect.disabled = true;
      pillWallet.textContent = `Wallet: ${shortAddr(account)}`;
    }else{
      btnConnect.textContent = "Connect";
      btnConnect.classList.remove("connected");
      btnConnect.disabled = false;
      pillWallet.textContent = "Wallet: Disconnected";
    }
  }

  // ========= Recipient UI =========
  function addRecipientRow(addr="", share=50){
    const row = document.createElement("div");
    row.className = "recRow";
    row.innerHTML = `
      <input class="recAddr" placeholder="0xRecipient..." value="${addr}"/>
      <input class="recShare" placeholder="%" inputmode="decimal" value="${share}"/>
      <button class="iconBtn recDel" title="Remove">×</button>
    `;
    row.querySelector(".recDel").addEventListener("click", () => {
      row.remove();
      updateTotalPill();
      updatePlanned();
    });
    row.querySelector(".recShare").addEventListener("input", () => {
      updateTotalPill();
      updatePlanned();
    });
    row.querySelector(".recAddr").addEventListener("input", () => {
      updatePlanned();
    });

    recipientsEl.appendChild(row);
    updateTotalPill();
  }

  function normalizeShares(){
    const rows = [...recipientsEl.querySelectorAll(".recRow")];
    const shares = rows.map(r => Number(r.querySelector(".recShare").value));
    const total = shares.reduce((a,b)=>a+(isFinite(b)?b:0),0);
    if(!isFinite(total) || total<=0) return;

    rows.forEach((r, i) => {
      const s = Number(r.querySelector(".recShare").value);
      const norm = (s/total)*100;
      r.querySelector(".recShare").value = (Math.round(norm*100)/100).toString();
    });

    // Fix rounding drift (force sum to 100.00)
    const rows2 = [...recipientsEl.querySelectorAll(".recRow")];
    const sum2 = rows2.reduce((a,r)=>a+Number(r.querySelector(".recShare").value||0),0);
    const diff = Math.round((100 - sum2)*100)/100;
    if(rows2.length){
      const last = rows2[rows2.length-1].querySelector(".recShare");
      last.value = (Math.round((Number(last.value)+diff)*100)/100).toString();
    }
    updateTotalPill();
    updatePlanned();
  }

  // ========= Price (Dexscreener) =========
  async function fetchDexPriceUSD(tokenAddr){
    try{
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`;
      const r = await fetch(url, {cache:"no-store"});
      const j = await r.json();
      const pairs = j.pairs || [];
      // pick highest liquidity pair that has priceUsd
      let best = null;
      for (const p of pairs){
        if(!p || !p.priceUsd) continue;
        const liq = p.liquidity && p.liquidity.usd ? Number(p.liquidity.usd) : 0;
        if(!best || liq > best.liq){
          best = { price: Number(p.priceUsd), liq };
        }
      }
      return best ? best.price : null;
    }catch{
      return null;
    }
  }

  // ========= Token Meta =========
  async function loadTokenMeta(tokenAddr){
    const c = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      c.symbol().catch(()=> "TOKEN"),
      c.decimals().catch(()=> 18),
    ]);
    return {symbol, decimals: Number(decimals)};
  }

  // ========= Scale detection (THIS FIXES YOUR REVERTS) =========
  // We build candidates:
  // scales: 10000 (bps) and 100 (simple percent)
  // totals: scale OR (scale - feeAdjust) if your contract expects 99% totals due to fee
  function buildPercentArray(userShares, scale, totalMode){
    // userShares are % numbers sum ~ 100
    // Convert to weights then allocate into integer units summing exactly to targetTotal
    const targetTotal = totalMode === "feeAdjusted"
      ? (scale === 10000 ? (10000 - PLATFORM_FEE_BPS) : (100 - 1))
      : scale;

    const weights = userShares.map(s => Math.max(0, Number(s)||0));
    const wsum = weights.reduce((a,b)=>a+b,0);
    if (wsum <= 0) return null;

    // initial floor allocation
    const raw = weights.map(w => (w/wsum)*targetTotal);
    const ints = raw.map(x => Math.floor(x));
    let diff = targetTotal - ints.reduce((a,b)=>a+b,0);

    // distribute remaining by largest fractional parts
    const fracs = raw.map((x,i)=>({i, f: x - Math.floor(x)})).sort((a,b)=>b.f-a.f);
    let idx = 0;
    while(diff > 0 && idx < fracs.length){
      ints[fracs[idx].i] += 1;
      diff -= 1;
      idx += 1;
      if(idx >= fracs.length) idx = 0;
    }

    return {percents: ints, targetTotal};
  }

  async function detectBestCall(splitter, tokenAddr, amountWei, recipients, userShares){
    // Try in this priority order (most common first):
    const candidates = [
      {scale:10000, totalMode:"normal"},
      {scale:100, totalMode:"normal"},
      {scale:10000, totalMode:"feeAdjusted"},
      {scale:100, totalMode:"feeAdjusted"},
    ];

    let lastErr = null;

    for (const c of candidates){
      const built = buildPercentArray(userShares, c.scale, c.totalMode);
      if(!built) continue;

      try{
        // callStatic preflight
        await splitter.callStatic.splitToken(tokenAddr, amountWei, recipients, built.percents);
        return { ok:true, ...c, percents: built.percents, targetTotal: built.targetTotal };
      } catch (e){
        lastErr = e;
        // continue
      }
    }

    // If none succeeded, return best info
    return { ok:false, err:lastErr };
  }

  async function detectBestCallNative(splitter, valueWei, recipients, userShares){
    const candidates = [
      {scale:10000, totalMode:"normal"},
      {scale:100, totalMode:"normal"},
      {scale:10000, totalMode:"feeAdjusted"},
      {scale:100, totalMode:"feeAdjusted"},
    ];

    let lastErr = null;

    for (const c of candidates){
      const built = buildPercentArray(userShares, c.scale, c.totalMode);
      if(!built) continue;

      try{
        await splitter.callStatic.splitNative(recipients, built.percents, { value: valueWei });
        return { ok:true, ...c, percents: built.percents, targetTotal: built.targetTotal };
      } catch (e){
        lastErr = e;
      }
    }
    return { ok:false, err:lastErr };
  }

  function prettyEthersError(e){
    if(!e) return "Unknown error.";
    const msg =
      e?.error?.message ||
      e?.data?.message ||
      e?.reason ||
      e?.message ||
      String(e);

    // clean up some noise
    return msg.replace("execution reverted:", "Execution reverted:")
              .replace("UNPREDICTABLE_GAS_LIMIT", "Cannot estimate gas")
              .slice(0, 420);
  }

  // ========= Telemetry update =========
  async function updateTelemetry(){
    try{
      if(!provider) return;
      const cid = Number(selChain.value);
      const splitterAddr = SPLITTERS[cid];
      tvSplitter.textContent = `Active splitter: ${splitterAddr}`;

      // Native balance
      if(account){
        const bal = await provider.getBalance(account);
        const n = Number(ethers.utils.formatEther(bal));
        tvNative.textContent = `${formatNum(n,6)} ${NATIVE_SYMBOL[cid] || "NATIVE"}`;

        // native price (dexscreener on wrapped)
        lastNativePriceUsd = await fetchDexPriceUSD(WRAPPED[cid]) ?? lastNativePriceUsd;
        if(lastNativePriceUsd){
          tvNativeUsd.textContent = `≈ $${formatNum(n*lastNativePriceUsd,2)} USD`;
        } else {
          tvNativeUsd.textContent = "≈ — USD";
        }
      }else{
        tvNative.textContent = "—";
        tvNativeUsd.textContent = "—";
      }

      // Split type
      const splitType = selSplitType.value;
      const tokenAddr = (inpToken.value||"").trim();
      const amt = parseAmountInput();

      if(splitType === "native"){
        tvSymbol.textContent = NATIVE_SYMBOL[cid] || "NATIVE";
        tvDecimals.textContent = "Decimals: 18";
        tvTokenBal.textContent = "—";
        tvTokenUsd.textContent = "—";
        tvAllow.textContent = "—";
      }else{
        if(ethers.utils.isAddress(tokenAddr)){
          lastTokenMeta = await loadTokenMeta(tokenAddr);
          tvSymbol.textContent = lastTokenMeta.symbol;
          tvDecimals.textContent = `Decimals: ${lastTokenMeta.decimals}`;

          if(account){
            const t = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
            const [balWei, allowWei] = await Promise.all([
              t.balanceOf(account).catch(()=>ethers.constants.Zero),
              t.allowance(account, splitterAddr).catch(()=>ethers.constants.Zero),
            ]);
            const bal = Number(ethers.utils.formatUnits(balWei, lastTokenMeta.decimals));
            const allow = Number(ethers.utils.formatUnits(allowWei, lastTokenMeta.decimals));
            tvTokenBal.textContent = `${formatNum(bal,6)} ${lastTokenMeta.symbol}`;
            tvAllow.textContent = `${formatNum(allow,6)} ${lastTokenMeta.symbol}`;

            lastTokenPriceUsd = await fetchDexPriceUSD(tokenAddr) ?? lastTokenPriceUsd;
            if(lastTokenPriceUsd){
              tvTokenUsd.textContent = `≈ $${formatNum(bal*lastTokenPriceUsd,2)} USD`;
            } else {
              tvTokenUsd.textContent = "≈ — USD";
            }
          }
        } else {
          tvSymbol.textContent = "—";
          tvDecimals.textContent = "Decimals: —";
          tvTokenBal.textContent = "—";
          tvTokenUsd.textContent = "—";
          tvAllow.textContent = "—";
        }
      }

      // Planned amount
      updatePlanned();
    } catch (e){
      log(`Telemetry update failed: ${prettyEthersError(e)}`);
    }
  }

  function updatePlanned(){
    const cid = Number(selChain.value);
    const splitType = selSplitType.value;
    const amt = parseAmountInput();

    if(!amt){
      tvPlanned.textContent = "—";
      tvReceive.textContent = "You receive (post-fee): —";
      return;
    }

    // Fee display
    const post = amt * 0.99;
    if(splitType === "native"){
      tvPlanned.textContent = `${formatNum(amt,6)} ${NATIVE_SYMBOL[cid]}`;
      tvReceive.textContent = `You receive (post-fee): ${formatNum(post,6)} ${NATIVE_SYMBOL[cid]}`;

      if(lastNativePriceUsd){
        $("tvTokenUsd").textContent = "";
      }
    } else {
      const sym = lastTokenMeta?.symbol || "TOKEN";
      tvPlanned.textContent = `${formatNum(amt,6)} ${sym}`;
      tvReceive.textContent = `You receive (post-fee): ${formatNum(post,6)} ${sym}`;
    }
  }

  // ========= Connect / Network =========
  async function connect(){
    clearError();
    ensureProvider();

    try{
      chipStatus.textContent = "Connecting…";
      const accts = await window.ethereum.request({ method:"eth_requestAccounts" });
      account = accts && accts[0] ? accts[0] : null;
      signer = provider.getSigner();
      const net = await provider.getNetwork();
      chainId = net.chainId;

      pillNet.textContent = `Network: ${currentChainLabel()}`;
      setConnectedUI(!!account);
      playRadarPing();
      log(`Connected: ${account} on chainId ${chainId}`);

      // sync selects to actual chain
      if([56,1,137].includes(chainId)){
        selChain.value = String(chainId);
        selVaultChain.value = String(chainId);
        inpVaultAddr.value = getActiveVaultAddress();
      }
      await updateTelemetry();
      chipStatus.textContent = "Ready.";
    } catch(e){
      chipStatus.textContent = "Connect failed.";
      setError(prettyEthersError(e));
    }
  }

  async function switchNetwork(){
    clearError();
    if(!window.ethereum) return;

    const target = Number(selChain.value);
    const paramsByChain = {
      56: { chainId:"0x38", chainName:"BNB Chain", nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18}, rpcUrls:["https://bsc-dataseed.binance.org/"], blockExplorerUrls:["https://bscscan.com/"] },
      1: { chainId:"0x1", chainName:"Ethereum Mainnet", nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18}, rpcUrls:["https://cloudflare-eth.com/"], blockExplorerUrls:["https://etherscan.io/"] },
      137:{ chainId:"0x89", chainName:"Polygon Mainnet", nativeCurrency:{name:"MATIC",symbol:"MATIC",decimals:18}, rpcUrls:["https://polygon-rpc.com/"], blockExplorerUrls:["https://polygonscan.com/"] },
    };

    try{
      chipStatus.textContent = "Switching network…";
      await window.ethereum.request({
        method:"wallet_switchEthereumChain",
        params:[{ chainId: paramsByChain[target].chainId }]
      });
      const net = await provider.getNetwork();
      chainId = net.chainId;
      pillNet.textContent = `Network: ${currentChainLabel()}`;
      log(`Switched to chainId ${chainId}`);
      chipStatus.textContent = "Ready.";
      await updateTelemetry();
    } catch (e){
      // If chain not added
      if (e && e.code === 4902){
        try{
          await window.ethereum.request({
            method:"wallet_addEthereumChain",
            params:[paramsByChain[target]]
          });
        } catch (e2){
          setError(prettyEthersError(e2));
        }
      } else {
        setError(prettyEthersError(e));
      }
      chipStatus.textContent = "Switch failed.";
    }
  }

  // ========= MAX =========
  async function setMax(){
    clearError();
    ensureProvider();
    if(!account){
      setError("Connect wallet first.");
      return;
    }
    const cid = Number(selChain.value);
    const splitType = selSplitType.value;

    try{
      if(splitType === "native"){
        const balWei = await provider.getBalance(account);
        // reserve gas: BSC ~0.003, ETH ~0.006, Polygon ~0.2 (MATIC) conservative
        const reserve = cid===56 ? "0.003" : cid===1 ? "0.006" : "0.2";
        const reserveWei = ethers.utils.parseEther(reserve);
        const maxWei = balWei.gt(reserveWei) ? balWei.sub(reserveWei) : ethers.constants.Zero;
        const max = Number(ethers.utils.formatEther(maxWei));
        inpAmount.value = max > 0 ? String(Math.floor(max*1e6)/1e6) : "0";
        log(`MAX reserved gas (${reserve} ${NATIVE_SYMBOL[cid]}).`);
      } else {
        const tokenAddr = (inpToken.value||"").trim();
        if(!ethers.utils.isAddress(tokenAddr)){
          setError("Enter a valid token address first.");
          return;
        }
        const meta = lastTokenMeta || await loadTokenMeta(tokenAddr);
        const t = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        const balWei = await t.balanceOf(account);
        const bal = Number(ethers.utils.formatUnits(balWei, meta.decimals));
        inpAmount.value = String(Math.floor(bal*1e6)/1e6);
        log("MAX set to token balance.");
      }
      updatePlanned();
    } catch(e){
      setError(prettyEthersError(e));
    }
  }

  // ========= Approve =========
  async function approve(){
    clearError();
    ensureProvider();
    if(!account) return setError("Connect wallet first.");

    const cid = Number(selChain.value);
    const splitterAddr = SPLITTERS[cid];
    const splitType = selSplitType.value;
    if(splitType === "native"){
      setError("Approve is only needed for token split (ERC20/BEP20).");
      return;
    }

    const tokenAddr = (inpToken.value||"").trim();
    if(!ethers.utils.isAddress(tokenAddr)) return setError("Enter a valid token address.");

    const amt = parseAmountInput();
    if(!amt) return setError("Enter a valid amount.");

    try{
      chipStatus.textContent = "Approving…";
      const meta = lastTokenMeta || await loadTokenMeta(tokenAddr);
      const t = new ethers.Contract(tokenAddr, ERC20_ABI, signer);

      const amountWei = ethers.utils.parseUnits(String(amt), meta.decimals);
      log(`Approving ${meta.symbol} for splitter ${splitterAddr}…`);

      const tx = await t.approve(splitterAddr, amountWei);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();
      log("Approve confirmed ✅");
      chipStatus.textContent = "Ready.";
      await updateTelemetry();
    } catch(e){
      chipStatus.textContent = "Approve failed.";
      setError(prettyEthersError(e));
    }
  }

  // ========= Execute Split =========
  async function executeSplit(){
    clearError();
    ensureProvider();
    if(!account) return setError("Connect wallet first.");

    const cid = Number(selChain.value);
    const splitterAddr = SPLITTERS[cid];
    const splitType = selSplitType.value;

    const recData = clampRecipients();
    if(recData.length < 1) return setError("Add at least 1 recipient.");

    // validate recipient addresses
    for(const r of recData){
      if(!ethers.utils.isAddress(r.addr)) return setError(`Invalid recipient address: ${r.addr || "(blank)"}`);
    }

    const total = updateTotalPill();
    if(Math.abs(total - 100) > 0.25){
      return setError("Total shares must be ~100%. Click Normalize.");
    }

    const userShares = recData.map(r => Number(r.share)||0);
    const recipients = recData.map(r => r.addr);

    const amt = parseAmountInput();
    if(!amt || amt<=0) return setError("Enter a valid amount.");

    const splitter = new ethers.Contract(splitterAddr, SPLITTER_ABI, signer);

    try{
      chipStatus.textContent = "Preflight…";
      log(`Auto-detecting percent scale for splitter ${splitterAddr}…`);

      if(splitType === "native"){
        // ensure function exists
        if(!splitter.functions.splitNative){
          return setError("This splitter contract does not expose splitNative().");
        }

        const valueWei = ethers.utils.parseEther(String(amt));

        const best = await detectBestCallNative(splitter, valueWei, recipients, userShares);
        if(!best.ok){
          chipStatus.textContent = "Preflight failed.";
          return setError(`Preflight failed: ${prettyEthersError(best.err)}`);
        }

        lastDetectedScale = best;
        tvScale.textContent = `${best.scale} (${best.totalMode === "feeAdjusted" ? "fee-adjusted" : "normal"})`;
        log(`Preflight OK ✅ scale=${best.scale}, mode=${best.totalMode}, total=${best.targetTotal}`);

        chipStatus.textContent = "Executing…";
        playCoinTicks(recipients.length);

        // safer gas
        let gasLimit;
        try{
          const est = await splitter.estimateGas.splitNative(recipients, best.percents, { value:valueWei });
          gasLimit = est.mul(120).div(100);
        } catch {
          gasLimit = ethers.BigNumber.from("600000");
        }

        const tx = await splitter.splitNative(recipients, best.percents, { value:valueWei, gasLimit });
        log(`SplitNative tx: ${tx.hash}`);
        await tx.wait();
        log("Split executed ✅");
        chipStatus.textContent = "Ready.";
        await updateTelemetry();
        return;
      }

      // TOKEN SPLIT
      if(!splitter.functions.splitToken){
        return setError("This splitter contract does not expose splitToken().");
      }

      const tokenAddr = (inpToken.value||"").trim();
      if(!ethers.utils.isAddress(tokenAddr)) return setError("Enter a valid token address.");

      const meta = lastTokenMeta || await loadTokenMeta(tokenAddr);
      const amountWei = ethers.utils.parseUnits(String(amt), meta.decimals);

      const best = await detectBestCall(splitter, tokenAddr, amountWei, recipients, userShares);
      if(!best.ok){
        chipStatus.textContent = "Preflight failed.";
        return setError(`Preflight failed: ${prettyEthersError(best.err)}`);
      }

      lastDetectedScale = best;
      tvScale.textContent = `${best.scale} (${best.totalMode === "feeAdjusted" ? "fee-adjusted" : "normal"})`;
      log(`Preflight OK ✅ scale=${best.scale}, mode=${best.totalMode}, total=${best.targetTotal}`);

      chipStatus.textContent = "Executing…";
      playCoinTicks(recipients.length);

      // safer gas
      let gasLimit;
      try{
        const est = await splitter.estimateGas.splitToken(tokenAddr, amountWei, recipients, best.percents);
        gasLimit = est.mul(120).div(100);
      } catch {
        gasLimit = ethers.BigNumber.from("900000");
      }

      const tx = await splitter.splitToken(tokenAddr, amountWei, recipients, best.percents, { gasLimit });
      log(`SplitToken tx: ${tx.hash}`);
      await tx.wait();
      log("Split executed ✅");
      chipStatus.textContent = "Ready.";
      await updateTelemetry();

    } catch(e){
      chipStatus.textContent = "Execute failed.";
      setError(prettyEthersError(e));
    }
  }

  // ========= UI Mode / Tabs =========
  function setModeUI(){
    const splitType = selSplitType.value;
    if(splitType === "native"){
      chipMode.textContent = "Mode: Native Split";
      $("amountHint").textContent = "Enter a native coin amount.";
      inpToken.disabled = true;
      inpToken.placeholder = "Not used for native split";
    }else{
      chipMode.textContent = "Mode: Token Split";
      $("amountHint").textContent = "Enter a token amount.";
      inpToken.disabled = false;
      inpToken.placeholder = "0x...";
    }
    updateTelemetry();
  }

  function openTab(which){
    if(which === "split"){
      tabBtnSplit.classList.add("active");
      tabBtnVault.classList.remove("active");
      tabSplit.classList.add("active");
      tabVault.classList.remove("active");
    } else {
      tabBtnVault.classList.add("active");
      tabBtnSplit.classList.remove("active");
      tabVault.classList.add("active");
      tabSplit.classList.remove("active");
    }
  }

  // ========= Vault (guarded) =========
  function parseUtcToUnix(s){
    // Expect "YYYY-MM-DD HH:MM"
    const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if(!m) return null;
    const [_,Y,Mo,D,H,Mi] = m;
    const dt = new Date(Date.UTC(Number(Y),Number(Mo)-1,Number(D),Number(H),Number(Mi),0));
    const t = Math.floor(dt.getTime()/1000);
    return isFinite(t) ? t : null;
  }

  async function vaultApprove(){
    clearVaultError();
    ensureProvider();
    if(!account) return setVaultError("Connect wallet first.");

    const cid = Number(selVaultChain.value);
    const vaultAddr = VAULTS[cid];
    inpVaultAddr.value = vaultAddr;

    const tokenAddr = (vaultToken.value||"").trim();
    if(!ethers.utils.isAddress(tokenAddr)) return setVaultError("Enter valid token address.");

    const amt = Number((vaultAmount.value||"").trim());
    if(!isFinite(amt) || amt<=0) return setVaultError("Enter valid amount.");

    try{
      const meta = await loadTokenMeta(tokenAddr);
      const t = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
      const amountWei = ethers.utils.parseUnits(String(amt), meta.decimals);

      vLog(`Approving ${meta.symbol} for vault ${vaultAddr}…`);
      const tx = await t.approve(vaultAddr, amountWei);
      vLog(`Approve tx: ${tx.hash}`);
      await tx.wait();
      vLog("Approve confirmed ✅");
    }catch(e){
      setVaultError(prettyEthersError(e));
    }
  }

  async function vaultCreate(){
    clearVaultError();
    ensureProvider();
    if(!account) return setVaultError("Connect wallet first.");

    const cid = Number(selVaultChain.value);
    const vaultAddr = VAULTS[cid];
    inpVaultAddr.value = vaultAddr;

    const tokenAddr = (vaultToken.value||"").trim();
    const ben = (vaultBeneficiary.value||"").trim();
    if(!ethers.utils.isAddress(tokenAddr)) return setVaultError("Enter valid token address.");
    if(!ethers.utils.isAddress(ben)) return setVaultError("Enter valid beneficiary address.");

    const amt = Number((vaultAmount.value||"").trim());
    if(!isFinite(amt) || amt<=0) return setVaultError("Enter valid amount.");

    const rel = parseUtcToUnix(vaultRelease.value||"");
    if(!rel) return setVaultError("Release time format must be: YYYY-MM-DD HH:MM (UTC)");

    try{
      const meta = await loadTokenMeta(tokenAddr);
      const amountWei = ethers.utils.parseUnits(String(amt), meta.decimals);

      const v = new ethers.Contract(vaultAddr, VAULT_ABI, signer);

      if(!v.functions.createVault){
        return setVaultError("Your vault contract ABI does not match createVault(). Paste your actual vault ABI and I’ll wire it perfectly.");
      }

      const label = (vaultLabel.value||"").trim();
      vLog(`Creating vault on chain ${cid}…`);
      const tx = await v.createVault(tokenAddr, ben, amountWei, rel, label);
      vLog(`Create tx: ${tx.hash}`);
      const rc = await tx.wait();
      vLog(`Create confirmed ✅ (tx mined)`);

      // best effort read event / return value not guaranteed
      vLog(`Tip: If your contract returns a vaultId, you can inspect it next.`);
    } catch(e){
      setVaultError(prettyEthersError(e));
    }
  }

  async function vaultInspect(){
    clearVaultError();
    ensureProvider();
    if(!account) return setVaultError("Connect wallet first.");

    const cid = Number(selVaultChain.value);
    const vaultAddr = VAULTS[cid];
    inpVaultAddr.value = vaultAddr;

    const id = Number((vaultId.value||"").trim());
    if(!isFinite(id) || id<0) return setVaultError("Enter a valid vault ID.");

    try{
      const v = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
      if(!v.functions.inspectVault){
        return setVaultError("Your vault contract ABI does not match inspectVault(). Paste your actual vault ABI and I’ll wire it perfectly.");
      }
      const info = await v.inspectVault(id);
      vLog(`Vault ${id}:`);
      vLog(`Owner: ${info.owner}`);
      vLog(`Token: ${info.token}`);
      vLog(`Beneficiary: ${info.beneficiary}`);
      vLog(`Amount (raw): ${info.amount.toString()}`);
      vLog(`ReleaseTime: ${info.releaseTime.toString()}`);
      vLog(`Released: ${info.released}`);
      vLog(`Label: ${info.label}`);
    } catch(e){
      setVaultError(prettyEthersError(e));
    }
  }

  async function vaultTrigger(){
    clearVaultError();
    ensureProvider();
    if(!account) return setVaultError("Connect wallet first.");

    const cid = Number(selVaultChain.value);
    const vaultAddr = VAULTS[cid];
    inpVaultAddr.value = vaultAddr;

    const id = Number((vaultId.value||"").trim());
    if(!isFinite(id) || id<0) return setVaultError("Enter a valid vault ID.");

    try{
      const v = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
      if(!v.functions.triggerVault){
        return setVaultError("Your vault contract ABI does not match triggerVault(). Paste your actual vault ABI and I’ll wire it perfectly.");
      }
      vLog(`Triggering vault ${id}…`);
      const tx = await v.triggerVault(id);
      vLog(`Trigger tx: ${tx.hash}`);
      await tx.wait();
      vLog("Trigger confirmed ✅");
    } catch(e){
      setVaultError(prettyEthersError(e));
    }
  }

  // ========= Events / init =========
  function init(){
    // Default recipients
    recipientsEl.innerHTML = "";
    addRecipientRow("", 50);
    addRecipientRow("", 50);

    // Default vault address
    inpVaultAddr.value = getActiveVaultAddress();

    // Tabs
    tabBtnSplit.addEventListener("click", () => openTab("split"));
    tabBtnVault.addEventListener("click", () => openTab("vault"));

    // Connect
    btnConnect.addEventListener("click", connect);
    btnSwitch.addEventListener("click", switchNetwork);

    // Splitters
    selChain.addEventListener("change", async () => {
      // update net label if already connected
      await updateTelemetry();
    });

    selSplitType.addEventListener("change", setModeUI);
    inpToken.addEventListener("input", async () => {
      lastTokenMeta = null;
      lastTokenPriceUsd = null;
      await updateTelemetry();
    });
    inpAmount.addEventListener("input", () => updatePlanned());

    btnMax.addEventListener("click", setMax);
    btnAddRecipient.addEventListener("click", () => addRecipientRow("", 0));
    btnNormalize.addEventListener("click", normalizeShares);

    btnApprove.addEventListener("click", approve);
    btnExecute.addEventListener("click", executeSplit);

    btnRefresh.addEventListener("click", updateTelemetry);
    btnClearLog.addEventListener("click", () => { logEl.textContent = ""; });

    // Vault
    selVaultChain.addEventListener("change", () => {
      inpVaultAddr.value = getActiveVaultAddress();
    });
    btnVaultApprove.addEventListener("click", vaultApprove);
    btnVaultCreate.addEventListener("click", vaultCreate);
    btnVaultInspect.addEventListener("click", vaultInspect);
    btnVaultTrigger.addEventListener("click", vaultTrigger);

    // MetaMask events
    if(window.ethereum){
      window.ethereum.on("accountsChanged", (accs) => {
        account = accs && accs[0] ? accs[0] : null;
        setConnectedUI(!!account);
        log(`Account changed: ${account || "disconnected"}`);
        updateTelemetry();
      });
      window.ethereum.on("chainChanged", async () => {
        ensureProvider();
        const net = await provider.getNetwork();
        chainId = net.chainId;
        pillNet.textContent = `Network: ${currentChainLabel()}`;
        log(`Chain changed: ${chainId}`);
        // sync selectors
        if([56,1,137].includes(chainId)){
          selChain.value = String(chainId);
          selVaultChain.value = String(chainId);
          inpVaultAddr.value = getActiveVaultAddress();
        }
        updateTelemetry();
      });
    }

    // initial UI
    pillNet.textContent = "Network: —";
    setConnectedUI(false);
    setModeUI();
    chipStatus.textContent = "Ready.";
    log("ZEPHENHEL CITADEL loaded. Connect wallet to begin.");
  }

  init();
})();
