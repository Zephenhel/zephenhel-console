/* global ethers */

(() => {
  // Your deployed splitters
  const SPLITTERS = {
    bsc: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
    eth: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    polygon: "0x05948E68137eC131E1f0E27028d09fa174679ED4"
  };

  const CHAIN = {
    bsc: { chainId: 56, hex: "0x38", name: "BNB Chain", native: "BNB", gasReserve: "0.003", legacyGas: true },
    eth: { chainId: 1, hex: "0x1", name: "Ethereum", native: "ETH", gasReserve: "0.005", legacyGas: false },
    polygon: { chainId: 137, hex: "0x89", name: "Polygon", native: "MATIC", gasReserve: "0.02", legacyGas: true }
  };

  const PLATFORM_FEE_PCT = 1; // display + optional feeAdjust attempt
  const TOTAL_CANDIDATES = [10000, 9900]; // basis-points total candidates
  const FEE_ADJUST = [false, true]; // try sending amount, then 99% of amount

  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner,address spender) view returns (uint256)",
    "function approve(address spender,uint256 amount) returns (bool)"
  ];

  const SPLITTER_ABI = [
    "function splitToken(address token,uint256 amount,address[] recipients,uint256[] percents) external",
    "function splitNative(address[] recipients,uint256[] percents) external payable"
  ];

  const $ = (id) => document.getElementById(id);

  const netPill = $("netPill");
  const acctPill = $("acctPill");
  const connectBtn = $("connectBtn");
  const switchBtn = $("switchBtn");

  const networkSel = $("networkSel");
  const tokenAddr = $("tokenAddr");
  const amountIn = $("amount");
  const maxBtn = $("maxBtn");

  const recList = $("recList");
  const addRecBtn = $("addRecBtn");
  const totalPill = $("totalPill");

  const approveBtn = $("approveBtn");
  const splitBtn = $("splitBtn");

  const errBox = $("errBox");
  const logEl = $("log");
  const clearLogBtn = $("clearLogBtn");
  const liveBtn = $("liveBtn");

  const walletBalEl = $("walletBal");
  const tokSymEl = $("tokSym");
  const tokDecEl = $("tokDec");
  const tokBalEl = $("tokBal");
  const allowEl = $("allow");
  const splitterAddrEl = $("splitterAddr");

  const usdEstEl = $("usdEst");
  const postFeeAmtEl = $("postFeeAmt");
  const gasHint = $("gasHint");
  const soundToggle = $("soundToggle");

  let provider, signer;
  let account = null;
  let currentNetKey = "bsc";
  let activeChainId = null;

  let token = null;
  let tokenMeta = { symbol: "-", decimals: 18 };
  let tokenPriceUSD = null;

  // default recipients
  let recipients = [
    { addr: "", pct: 50 },
    { addr: "", pct: 50 }
  ];

  function log(msg) {
    const t = new Date().toLocaleTimeString();
    logEl.textContent += `[${t}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function showError(msg) { errBox.hidden = false; errBox.textContent = msg; }
  function clearError() { errBox.hidden = true; errBox.textContent = ""; }

  function fmtAddr(a){ return a ? `${a.slice(0,6)}…${a.slice(-4)}` : "—"; }
  function isAddr(a){ try{ return ethers.utils.isAddress(a); } catch { return false; } }
  function toFloatSafe(s){ const v = Number(String(s).replace(/,/g,"")); return Number.isFinite(v)?v:0; }

  function tokenIsNative(){ return tokenAddr.value.trim() === ""; }
  function nativeSymbol(){ return CHAIN[currentNetKey].native; }

  function setTopPills(){
    const c = CHAIN[currentNetKey];
    netPill.textContent = `Network: ${c.name} (chainId ${c.chainId})`;
    acctPill.textContent = account ? `Wallet: ${fmtAddr(account)}` : `Wallet: Disconnected`;
    splitterAddrEl.textContent = SPLITTERS[currentNetKey];

    // button state
    if (account) {
      connectBtn.textContent = "Connected";
      connectBtn.disabled = true;
    } else {
      connectBtn.textContent = "Connect";
      connectBtn.disabled = false;
    }
  }

  function setGasHint(){
    const reserve = CHAIN[currentNetKey].gasReserve;
    gasHint.textContent = tokenIsNative()
      ? `MAX reserves gas (${reserve} ${nativeSymbol()}).`
      : `MAX is for native only. For tokens, enter a token amount.`;
  }

  function prettyErr(e){
    const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || String(e);
    return msg.replace(/\s+/g," ").trim();
  }

  function mustBeOnSelectedChain(){
    const expected = CHAIN[currentNetKey].chainId;
    if (activeChainId !== expected) {
      throw new Error(`Wrong network. You are on chainId ${activeChainId}, but ${CHAIN[currentNetKey].name} is ${expected}. Click Switch Network.`);
    }
  }

  function renderRecipients(){
    recList.innerHTML = "";
    recipients.forEach((r, idx) => {
      const row = document.createElement("div");
      row.className = "recRow";

      const addr = document.createElement("input");
      addr.className = "in";
      addr.placeholder = "0xRecipient…";
      addr.value = r.addr;
      addr.oninput = () => { recipients[idx].addr = addr.value.trim(); };

      const pct = document.createElement("input");
      pct.className = "in";
      pct.placeholder = "Percent";
      pct.inputMode = "decimal";
      pct.value = String(r.pct ?? "");
      pct.oninput = () => {
        recipients[idx].pct = toFloatSafe(pct.value);
        updateTotal();
        updateEstimates();
      };

      const rm = document.createElement("button");
      rm.className = "xbtn";
      rm.textContent = "✕";
      rm.onclick = () => {
        recipients.splice(idx,1);
        renderRecipients();
        updateTotal();
        updateEstimates();
      };

      row.appendChild(addr);
      row.appendChild(pct);
      row.appendChild(rm);
      recList.appendChild(row);
    });
  }

  function updateTotal(){
    const total = recipients.reduce((a,r)=>a + (Number(r.pct)||0),0);
    totalPill.textContent = `Total: ${total.toFixed(2)}%`;
    return total;
  }

  function validateRecipients(){
    if (recipients.length < 1) throw new Error("Add at least 1 recipient.");
    const total = recipients.reduce((a,r)=>a + (Number(r.pct)||0),0);
    if (Math.abs(total - 100) > 0.0001) throw new Error("Total percent must equal 100.");
    const bad = recipients.find(r => !isAddr(r.addr));
    if (bad) throw new Error("One or more recipient addresses are invalid.");
  }

  function buildBps(requiredTotal){
    const pcts = recipients.map(r => Number(r.pct)||0);
    const raw = pcts.map(p => Math.floor((p/100)*requiredTotal));
    let sum = raw.reduce((a,b)=>a+b,0);
    let rem = requiredTotal - sum;

    const order = pcts.map((p,i)=>({p,i})).sort((a,b)=>b.p-a.p);
    let k = 0;
    while (rem > 0) {
      raw[order[k % order.length].i] += 1;
      rem--; k++;
    }
    return raw.map(x => ethers.BigNumber.from(x));
  }

  async function fetchDexPriceUSD(tokenAddress){
    try{
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const data = await r.json();
      const pairs = Array.isArray(data.pairs) ? data.pairs : [];
      const chainName = currentNetKey === "bsc" ? "bsc" : (currentNetKey === "eth" ? "ethereum" : "polygon");
      const best = pairs.find(p => String(p.chainId||"").toLowerCase() === chainName) || pairs[0];
      const px = best?.priceUsd ? Number(best.priceUsd) : null;
      return Number.isFinite(px) ? px : null;
    } catch { return null; }
  }

  function updateEstimates(){
    const amt = toFloatSafe(amountIn.value);
    if (!(amt > 0)) { usdEstEl.textContent="—"; postFeeAmtEl.textContent="—"; return; }
    const post = amt * (1 - PLATFORM_FEE_PCT/100);
    postFeeAmtEl.textContent = `${post.toFixed(6)} ${tokenMeta.symbol} (post-fee est)`;
    usdEstEl.textContent = tokenPriceUSD ? `$${(amt*tokenPriceUSD).toFixed(2)}` : "—";
  }

  async function ensureProvider(){
    if (!window.ethereum) { showError("MetaMask not detected."); return false; }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();
    return true;
  }

  async function refreshWalletAndToken(){
    if (!provider || !account) return;
    setTopPills(); setGasHint();

    const bal = await provider.getBalance(account);
    walletBalEl.textContent = `${ethers.utils.formatEther(bal)} ${nativeSymbol()}`;

    if (tokenIsNative()){
      token = null;
      tokenMeta = { symbol: nativeSymbol(), decimals: 18 };
      tokSymEl.textContent = nativeSymbol();
      tokDecEl.textContent = "18";
      tokBalEl.textContent = `${ethers.utils.formatEther(bal)} ${nativeSymbol()}`;
      allowEl.textContent = "— (native)";
      tokenPriceUSD = null;
      updateEstimates();
      return;
    }

    const tAddr = tokenAddr.value.trim();
    if (!isAddr(tAddr)) return;

    token = new ethers.Contract(tAddr, ERC20_ABI, signer);
    const [sym, dec] = await Promise.all([token.symbol(), token.decimals()]);
    tokenMeta = { symbol: sym, decimals: Number(dec) };
    tokSymEl.textContent = sym;
    tokDecEl.textContent = String(dec);

    const [tbal, alw] = await Promise.all([
      token.balanceOf(account),
      token.allowance(account, SPLITTERS[currentNetKey])
    ]);
    tokBalEl.textContent = `${ethers.utils.formatUnits(tbal, dec)} ${sym}`;
    allowEl.textContent = `${ethers.utils.formatUnits(alw, dec)} ${sym}`;

    tokenPriceUSD = await fetchDexPriceUSD(tAddr);
    log(`Token loaded: ${sym} (decimals ${dec})${tokenPriceUSD ? ` • $${tokenPriceUSD}` : ""}`);
    updateEstimates();
  }

  async function connect(){
    clearError();
    if (!(await ensureProvider())) return;

    const accts = await provider.send("eth_requestAccounts", []);
    account = accts?.[0] || null;

    const net = await provider.getNetwork();
    activeChainId = net.chainId;

    // auto-select net key
    currentNetKey = activeChainId === 56 ? "bsc" : (activeChainId === 1 ? "eth" : (activeChainId === 137 ? "polygon" : currentNetKey));
    networkSel.value = currentNetKey;

    log(`Connected: ${account} on chainId ${activeChainId}`);
    setTopPills(); setGasHint();
    await refreshWalletAndToken();
  }

  async function switchNetwork(){
    clearError();
    const target = CHAIN[currentNetKey];
    try{
      await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: target.hex }] });
      window.location.reload();
    } catch(e){
      showError(`Switch failed: ${prettyErr(e)}`);
    }
  }

  async function setMax(){
    clearError();
    try{
      if (!account) throw new Error("Connect wallet first.");
      mustBeOnSelectedChain();
      if (!tokenIsNative()) throw new Error("MAX is for native coin only (leave token blank).");

      const bal = await provider.getBalance(account);
      const reserve = ethers.utils.parseEther(CHAIN[currentNetKey].gasReserve);
      const max = bal.gt(reserve) ? bal.sub(reserve) : ethers.BigNumber.from(0);
      amountIn.value = ethers.utils.formatEther(max);
      updateEstimates();
      log(`MAX set (reserved ${CHAIN[currentNetKey].gasReserve} ${nativeSymbol()} for gas)`);
    } catch(e){
      showError(`MAX failed: ${prettyErr(e)}`);
    }
  }

  async function approve(){
    clearError();
    try{
      if (!account) throw new Error("Connect wallet first.");
      mustBeOnSelectedChain();
      if (tokenIsNative()) throw new Error("Approve not needed for native.");
      if (!token) throw new Error("Enter a valid token address.");

      const amt = toFloatSafe(amountIn.value);
      if (!(amt > 0)) throw new Error("Enter an amount > 0.");

      const parsed = ethers.utils.parseUnits(String(amt), tokenMeta.decimals);
      log(`Approving ${tokenMeta.symbol} for splitter ${SPLITTERS[currentNetKey]}…`);

      const tx = await token.approve(SPLITTERS[currentNetKey], parsed);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();
      log(`Approve confirmed ✅`);
      await refreshWalletAndToken();
    } catch(e){
      showError(`Approve failed: ${prettyErr(e)}`);
      log(`Approve failed: ${prettyErr(e)}`);
    }
  }

  function parseAmountBN(uiAmount, feeAdjust){
    const amt = Number(uiAmount);
    if (!(amt > 0)) throw new Error("Enter an amount > 0.");
    const sendAmt = feeAdjust ? (amt * (1 - PLATFORM_FEE_PCT/100)) : amt;
    return tokenIsNative()
      ? ethers.utils.parseEther(String(sendAmt))
      : ethers.utils.parseUnits(String(sendAmt), tokenMeta.decimals);
  }

  // FORCE legacy gas price on BSC/Polygon (MetaMask/Edge stability)
  async function gasOverrides(){
    const cfg = CHAIN[currentNetKey];
    const o = {};
    if (cfg.legacyGas) {
      const gp = await provider.getGasPrice();
      o.gasPrice = gp.mul(12).div(10); // +20% to avoid underpriced / stuck tx
    }
    return o;
  }

  async function sendWithFallback(contract, fnName, args, overrides){
    // 1) normal contract call
    try{
      return await contract[fnName](...args, overrides);
    } catch(e){
      // 2) raw sendTransaction fallback (bypasses some MetaMask wrapper weirdness)
      log(`Contract call failed, trying raw tx fallback… (${prettyErr(e)})`);
      const data = contract.interface.encodeFunctionData(fnName, args);
      const txReq = {
        to: contract.address,
        data,
        ...overrides
      };
      if (overrides?.value) txReq.value = overrides.value;
      return await signer.sendTransaction(txReq);
    }
  }

  async function split(){
    clearError();
    try{
      if (!account) throw new Error("Connect wallet first.");
      mustBeOnSelectedChain();
      validateRecipients();

      const recAddrs = recipients.map(r => r.addr);
      const splitter = new ethers.Contract(SPLITTERS[currentNetKey], SPLITTER_ABI, signer);

      if (!tokenIsNative() && !token) throw new Error("Enter a valid token address.");

      // sanity: ensure balance + allowance cover entered amount
      if (!tokenIsNative()){
        const uiAmt = toFloatSafe(amountIn.value);
        const wantBN = ethers.utils.parseUnits(String(uiAmt), tokenMeta.decimals);
        const [bal, alw] = await Promise.all([
          token.balanceOf(account),
          token.allowance(account, SPLITTERS[currentNetKey])
        ]);
        if (bal.lt(wantBN)) throw new Error("Insufficient token balance.");
        if (alw.lt(wantBN)) log("Warning: allowance < amount. Approve again if execute fails.");
      }

      const baseOv = await gasOverrides();

      // Try combinations until one works
      let lastErr = null;
      for (const total of TOTAL_CANDIDATES){
        const bps = buildBps(total);

        for (const feeAdjust of FEE_ADJUST){
          try{
            const amountBN = parseAmountBN(amountIn.value, feeAdjust);

            log(`Attempt: total=${total}, feeAdjust=${feeAdjust ? "ON" : "OFF"}`);

            // callStatic preflight (with from/value)
            if (tokenIsNative()){
              await splitter.callStatic.splitNative(recAddrs, bps, { from: account, value: amountBN });
            } else {
              await splitter.callStatic.splitToken(token.address, amountBN, recAddrs, bps, { from: account });
            }
            log(`Preflight OK ✅`);

            // estimate gas with strong multiplier; fallback if estimate fails
            let gasLimit;
            try{
              const est = tokenIsNative()
                ? await splitter.estimateGas.splitNative(recAddrs, bps, { value: amountBN, ...baseOv })
                : await splitter.estimateGas.splitToken(token.address, amountBN, recAddrs, bps, { ...baseOv });

              gasLimit = est.mul(18).div(10); // 1.8x
              log(`Gas est=${est.toString()} → gasLimit=${gasLimit.toString()}`);
            } catch(ge){
              gasLimit = ethers.BigNumber.from(tokenIsNative() ? "800000" : "1100000");
              log(`estimateGas failed → fallback gasLimit=${gasLimit.toString()} (${prettyErr(ge)})`);
            }

            const overrides = { gasLimit, ...baseOv };
            if (tokenIsNative()) overrides.value = amountBN;

            // execute
            const tx = tokenIsNative()
              ? await sendWithFallback(splitter, "splitNative", [recAddrs, bps], overrides)
              : await sendWithFallback(splitter, "splitToken", [token.address, amountBN, recAddrs, bps], overrides);

            log(`TX sent: ${tx.hash}`);
            await tx.wait();
            log(`Split complete ✅ (total=${total}, feeAdjust=${feeAdjust ? "ON" : "OFF"})`);

            await refreshWalletAndToken();
            return;
          } catch(e){
            lastErr = e;
            log(`Failed: ${prettyErr(e)}`);
          }
        }
      }

      throw new Error(`All attempts failed. Last error: ${prettyErr(lastErr)}`);
    } catch(e){
      showError(`Split failed: ${prettyErr(e)}`);
      log(`Split failed: ${prettyErr(e)}`);
    }
  }

  function wire(){
    renderRecipients();
    updateTotal();
    updateEstimates();
    setTopPills();
    setGasHint();

    connectBtn.onclick = connect;
    switchBtn.onclick = switchNetwork;

    networkSel.onchange = async () => {
      currentNetKey = networkSel.value;
      setTopPills(); setGasHint();
      tokenPriceUSD = null;
      if (provider) {
        const net = await provider.getNetwork();
        activeChainId = net.chainId;
      }
      await refreshWalletAndToken();
    };

    tokenAddr.oninput = async () => {
      tokenPriceUSD = null;
      await refreshWalletAndToken();
    };

    amountIn.oninput = updateEstimates;
    maxBtn.onclick = setMax;

    addRecBtn.onclick = () => {
      recipients.push({ addr:"", pct:0 });
      renderRecipients(); updateTotal(); updateEstimates();
    };

    approveBtn.onclick = approve;
    splitBtn.onclick = split;

    clearLogBtn.onclick = () => { logEl.textContent = ""; };
    liveBtn.onclick = refreshWalletAndToken;

    if (window.ethereum){
      window.ethereum.on("accountsChanged", () => window.location.reload());
      window.ethereum.on("chainChanged", () => window.location.reload());
    }

    log("ZEPHENHEL CITADEL ready. If execute fails, the log will show every attempted mode + gas settings.");
  }

  wire();
})();
