/* global ethers */

(() => {
  // ====== YOUR SPLITTERS ======
  const SPLITTERS = {
    bsc: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
    eth: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    polygon: "0x05948E68137eC131E1f0E27028d09fa174679ED4"
  };

  const CHAIN = {
    bsc: { chainId: 56, hex: "0x38", name: "BNB Chain", native: "BNB", gasReserve: "0.003" },
    eth: { chainId: 1, hex: "0x1", name: "Ethereum", native: "ETH", gasReserve: "0.005" },
    polygon: { chainId: 137, hex: "0x89", name: "Polygon", native: "MATIC", gasReserve: "0.02" }
  };

  // Platform fee shown & used for auto-adjust. (UI/logic only, contract is already fee’d.)
  const PLATFORM_FEE_PCT = 1;

  // Percent scale candidates (some contracts use 100, some 10000, etc.)
  const SCALE_CANDIDATES = [100, 10000, 100000];

  // ====== Minimal ABIs ======
  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner,address spender) view returns (uint256)",
    "function approve(address spender,uint256 amount) returns (bool)"
  ];

  // Your splitter function signature (common pattern)
  const SPLITTER_ABI = [
    "function splitToken(address token,uint256 amount,address[] recipients,uint256[] percents) external",
    "function splitNative(address[] recipients,uint256[] percents) external payable"
  ];

  // ====== DOM ======
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

  // ====== State ======
  let provider, signer;
  let account = null;

  let currentNetKey = "bsc";
  let activeChainId = null;

  let token = null; // ethers.Contract
  let tokenMeta = { symbol: "-", decimals: 18 };
  let tokenPriceUSD = null; // number

  // Recipients state
  let recipients = [
    { addr: "", pct: 50 },
    { addr: "", pct: 50 }
  ];

  // ====== Sound FX (WebAudio) ======
  function playPing() {
    if (!soundToggle.checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.18);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.25);
      setTimeout(() => ctx.close(), 400);
    } catch {}
  }

  function playCoins(n) {
    if (!soundToggle.checked) return;
    const hits = Math.max(1, Math.min(12, n)); // cap so it doesn't get insane
    let i = 0;
    const tick = () => {
      i++;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        const base = 520 + Math.random() * 220;
        o.frequency.setValueAtTime(base, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(base * 0.75, ctx.currentTime + 0.07);
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
        o.connect(g); g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.10);
        setTimeout(() => ctx.close(), 200);
      } catch {}
      if (i < hits) setTimeout(tick, 90 + Math.random() * 70);
    };
    tick();
  }

  // ====== Helpers ======
  function log(msg) {
    const t = new Date().toLocaleTimeString();
    logEl.textContent += `[${t}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showError(msg) {
    errBox.hidden = false;
    errBox.textContent = msg;
  }

  function clearError() {
    errBox.hidden = true;
    errBox.textContent = "";
  }

  function fmtAddr(a) {
    if (!a) return "—";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function isAddr(a) {
    try { return ethers.utils.isAddress(a); } catch { return false; }
  }

  function bn(x) { return ethers.BigNumber.from(x); }

  function toFloatSafe(s) {
    const v = Number(String(s).replace(/,/g, ""));
    return Number.isFinite(v) ? v : 0;
  }

  function setTopPills() {
    const c = CHAIN[currentNetKey];
    netPill.textContent = `Network: ${c.name} (chainId ${c.chainId})`;
    acctPill.textContent = account ? `Wallet: ${fmtAddr(account)}` : "Wallet: Disconnected";
    splitterAddrEl.textContent = SPLITTERS[currentNetKey];
  }

  function currentSplitter() {
    return new ethers.Contract(SPLITTERS[currentNetKey], SPLITTER_ABI, signer);
  }

  function nativeSymbol() {
    return CHAIN[currentNetKey].native;
  }

  function tokenIsNative() {
    return tokenAddr.value.trim() === "";
  }

  function setGasHint() {
    const reserve = CHAIN[currentNetKey].gasReserve;
    gasHint.textContent = tokenIsNative()
      ? `MAX reserves gas (${reserve} ${nativeSymbol()}).`
      : `MAX is for native only. For tokens, enter a token amount.`;
  }

  // ====== UI: Recipients ======
  function renderRecipients() {
    recList.innerHTML = "";
    recipients.forEach((r, idx) => {
      const row = document.createElement("div");
      row.className = "recRow";

      const addr = document.createElement("input");
      addr.className = "in";
      addr.placeholder = "0xRecipient…";
      addr.value = r.addr;
      addr.oninput = () => {
        recipients[idx].addr = addr.value.trim();
      };

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
      rm.title = "Remove recipient";
      rm.onclick = () => {
        recipients.splice(idx, 1);
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

  function updateTotal() {
    const total = recipients.reduce((a, r) => a + (Number(r.pct) || 0), 0);
    totalPill.textContent = `Total: ${total.toFixed(2)}%`;
    return total;
  }

  // ====== DexScreener USD ======
  async function fetchDexPriceUSD(tokenAddress) {
    // DexScreener token endpoint
    // Note: Some browsers may block CORS in rare cases. If that happens, we fail gracefully.
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return null;
      const data = await res.json();
      const pairs = Array.isArray(data.pairs) ? data.pairs : [];
      // Prefer the selected chain
      const chainName =
        currentNetKey === "bsc" ? "bsc" :
        currentNetKey === "eth" ? "ethereum" :
        "polygon";

      const best = pairs.find(p => (p.chainId || "").toLowerCase() === chainName) || pairs[0];
      const px = best?.priceUsd ? Number(best.priceUsd) : null;
      return Number.isFinite(px) ? px : null;
    } catch {
      return null;
    }
  }

  // ====== Token + wallet intel ======
  async function refreshTokenAndWallet() {
    if (!provider) return;
    setTopPills();
    setGasHint();

    if (!account) {
      walletBalEl.textContent = "—";
      tokSymEl.textContent = "—";
      tokDecEl.textContent = "—";
      tokBalEl.textContent = "—";
      allowEl.textContent = "—";
      usdEstEl.textContent = "—";
      postFeeAmtEl.textContent = "—";
      return;
    }

    // Wallet native balance
    const bal = await provider.getBalance(account);
    walletBalEl.textContent = `${ethers.utils.formatEther(bal)} ${nativeSymbol()}`;

    // Token path
    if (tokenIsNative()) {
      token = null;
      tokenMeta = { symbol: nativeSymbol(), decimals: 18 };
      tokSymEl.textContent = nativeSymbol();
      tokDecEl.textContent = "18";
      tokBalEl.textContent = `${ethers.utils.formatEther(bal)} ${nativeSymbol()}`;
      allowEl.textContent = "— (native)";
      usdEstEl.textContent = "—";
      updateEstimates();
      return;
    }

    const tAddr = tokenAddr.value.trim();
    if (!isAddr(tAddr)) {
      tokSymEl.textContent = "—";
      tokDecEl.textContent = "—";
      tokBalEl.textContent = "—";
      allowEl.textContent = "—";
      usdEstEl.textContent = "—";
      updateEstimates();
      return;
    }

    token = new ethers.Contract(tAddr, ERC20_ABI, signer);

    try {
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

      // USD price
      tokenPriceUSD = await fetchDexPriceUSD(tAddr);
      updateEstimates();
      log(`Token loaded: ${sym} (decimals ${dec})${tokenPriceUSD ? ` • $${tokenPriceUSD}` : ""}`);
    } catch (e) {
      log(`Token read failed: ${shortErr(e)}`);
      tokSymEl.textContent = "—";
      tokDecEl.textContent = "—";
      tokBalEl.textContent = "—";
      allowEl.textContent = "—";
      tokenPriceUSD = null;
    }
  }

  function updateEstimates() {
    const amt = toFloatSafe(amountIn.value);
    const post = amt * (1 - PLATFORM_FEE_PCT / 100);
    postFeeAmtEl.textContent = amt > 0 ? `${post} ${tokenMeta.symbol}` : "—";

    if (tokenPriceUSD && amt > 0) {
      usdEstEl.textContent = `$${(amt * tokenPriceUSD).toFixed(2)}`;
    } else {
      usdEstEl.textContent = "—";
    }
  }

  function shortErr(e) {
    const msg =
      e?.data?.message ||
      e?.error?.message ||
      e?.reason ||
      e?.message ||
      String(e);
    return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
  }

  // ====== MetaMask connect / switch ======
  async function ensureProvider() {
    if (!window.ethereum) {
      showError("MetaMask not detected. Install/enable MetaMask extension, then refresh.");
      return false;
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();
    return true;
  }

  async function connect() {
    clearError();
    if (!(await ensureProvider())) return;

    try {
      const accts = await provider.send("eth_requestAccounts", []);
      account = accts?.[0] || null;
      const net = await provider.getNetwork();
      activeChainId = net.chainId;

      log(`Connected: ${account} on chainId ${activeChainId}`);
      playPing();

      setTopPills();
      await autoSyncNetworkSelection();
      await refreshTokenAndWallet();
    } catch (e) {
      showError(`Connect failed: ${shortErr(e)}`);
    }
  }

  async function autoSyncNetworkSelection() {
    // Choose dropdown based on actual connected chain
    const id = activeChainId;
    if (id === 56) currentNetKey = "bsc";
    else if (id === 1) currentNetKey = "eth";
    else if (id === 137) currentNetKey = "polygon";
    setTopPills();
    networkSel.value = currentNetKey;
    setGasHint();
  }

  async function switchNetwork() {
    clearError();
    if (!window.ethereum) return showError("MetaMask not detected.");

    const target = CHAIN[currentNetKey];
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: target.hex }]
      });
      log(`Switched to ${target.name}`);
      // provider network will update via chainChanged listener
    } catch (e) {
      showError(`Switch failed: ${shortErr(e)}`);
    }
  }

  // ====== Percent math (simple % -> contract shares) ======
  function buildSharesSimple(scale) {
    // User enters simple percentages that must total 100
    const pcts = recipients.map(r => Number(r.pct) || 0);
    const total = pcts.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.0001) throw new Error("Total percent must equal 100.");

    // Convert to integer shares with rounding, then fix remainder to exact sum=scale
    const raw = pcts.map(p => Math.floor((p / 100) * scale));
    let sum = raw.reduce((a, b) => a + b, 0);

    // distribute remaining shares to highest pct rows
    let rem = scale - sum;
    const order = pcts.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
    let k = 0;
    while (rem > 0) {
      raw[order[k % order.length].i] += 1;
      rem--;
      k++;
    }
    // If we overshot somehow (rare), remove from smallest
    while (raw.reduce((a, b) => a + b, 0) > scale) {
      const smallest = pcts.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)[0].i;
      if (raw[smallest] > 0) raw[smallest] -= 1;
      else break;
    }
    return raw;
  }

  function buildSharesFeeAdjusted(scale) {
    // Adjust total shares to (1 - fee)
    const targetSum = Math.round(scale * (1 - PLATFORM_FEE_PCT / 100));

    const pcts = recipients.map(r => Number(r.pct) || 0);
    const total = pcts.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.0001) throw new Error("Total percent must equal 100.");

    const raw = pcts.map(p => Math.floor((p / 100) * targetSum));
    let sum = raw.reduce((a, b) => a + b, 0);

    let rem = targetSum - sum;
    const order = pcts.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
    let k = 0;
    while (rem > 0) {
      raw[order[k % order.length].i] += 1;
      rem--;
      k++;
    }
    while (raw.reduce((a, b) => a + b, 0) > targetSum) {
      const smallest = pcts.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)[0].i;
      if (raw[smallest] > 0) raw[smallest] -= 1;
      else break;
    }
    return raw;
  }

  function validateRecipients() {
    if (recipients.length < 1) throw new Error("Add at least 1 recipient.");
    const bad = recipients.find(r => !isAddr(r.addr));
    if (bad) throw new Error("One or more recipient addresses are invalid.");
  }

  // ====== Approve ======
  async function approve() {
    clearError();
    try {
      if (!account) throw new Error("Connect wallet first.");
      if (tokenIsNative()) throw new Error("Approve is not needed for native coin.");
      if (!token) throw new Error("Enter a valid token address first.");

      const amt = toFloatSafe(amountIn.value);
      if (!(amt > 0)) throw new Error("Enter an amount > 0.");

      const dec = tokenMeta.decimals;
      const parsed = ethers.utils.parseUnits(String(amt), dec);

      log(`Approving ${tokenMeta.symbol} for splitter ${SPLITTERS[currentNetKey]}…`);
      const tx = await token.approve(SPLITTERS[currentNetKey], parsed);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();
      log(`Approve confirmed ✅`);
      await refreshTokenAndWallet();
    } catch (e) {
      showError(`Approve failed: ${shortErr(e)}`);
      log(`Approve failed: ${shortErr(e)}`);
    }
  }

  // ====== Split (with smart preflight) ======
  async function split() {
    clearError();
    try {
      if (!account) throw new Error("Connect wallet first.");

      validateRecipients();

      const amt = toFloatSafe(amountIn.value);
      if (!(amt > 0)) throw new Error("Enter an amount > 0.");

      const splitter = currentSplitter();
      const recAddrs = recipients.map(r => r.addr);

      // Build amount
      let callAmountBN;
      if (tokenIsNative()) {
        callAmountBN = ethers.utils.parseEther(String(amt));
      } else {
        if (!token) throw new Error("Enter a valid token address first.");
        callAmountBN = ethers.utils.parseUnits(String(amt), tokenMeta.decimals);
      }

      // Try combinations:
      // 1) simple shares (sum=scale)
      // 2) fee-adjusted shares (sum=scale*(1-fee))
      // For each, try scale candidates (100, 10000, 100000)
      const tokenToUse = tokenIsNative() ? ethers.constants.AddressZero : token.address;

      let chosen = null;

      for (const scale of SCALE_CANDIDATES) {
        // simple
        try {
          const shares = buildSharesSimple(scale).map(x => bn(x));
          await preflight(splitter, tokenToUse, callAmountBN, recAddrs, shares);
          chosen = { scale, mode: "simple", shares };
          break;
        } catch {}
        // fee adjusted
        try {
          const shares = buildSharesFeeAdjusted(scale).map(x => bn(x));
          await preflight(splitter, tokenToUse, callAmountBN, recAddrs, shares);
          chosen = { scale, mode: "feeAdjusted", shares };
          break;
        } catch {}
      }

      if (!chosen) {
        throw new Error("Splitter rejected the percent format. Your contract is enforcing a different rule than 100/10000/100000 or fee-adjust. (We can add more scales if needed.)");
      }

      log(`Preflight OK ✅ (scale=${chosen.scale}, mode=${chosen.mode === "feeAdjusted" ? "auto-adjusted for 1% fee" : "simple"})`);

      // Execute
      playCoins(recipients.length);

      if (tokenIsNative()) {
        log(`Executing native split on ${CHAIN[currentNetKey].name}…`);
        const tx = await splitter.splitNative(recAddrs, chosen.shares, { value: callAmountBN });
        log(`Split tx: ${tx.hash}`);
        await tx.wait();
        log(`Split complete ✅`);
      } else {
        log(`Executing token split on ${CHAIN[currentNetKey].name}…`);
        const tx = await splitter.splitToken(tokenToUse, callAmountBN, recAddrs, chosen.shares);
        log(`Split tx: ${tx.hash}`);
        await tx.wait();
        log(`Split complete ✅`);
      }

      await refreshTokenAndWallet();
    } catch (e) {
      showError(`Split failed: ${shortErr(e)}`);
      log(`Split failed: ${shortErr(e)}`);
    }
  }

  async function preflight(splitter, tokenToUse, amountBN, recAddrs, sharesBN) {
    // callStatic to catch reverts BEFORE sending a tx
    if (tokenIsNative()) {
      await splitter.callStatic.splitNative(recAddrs, sharesBN, { value: amountBN });
    } else {
      await splitter.callStatic.splitToken(tokenToUse, amountBN, recAddrs, sharesBN);
    }
  }

  // ====== MAX for native (reserves gas) ======
  async function setMax() {
    clearError();
    try {
      if (!account) throw new Error("Connect wallet first.");
      if (!tokenIsNative()) throw new Error("MAX is for native coin only (leave token address blank).");

      const bal = await provider.getBalance(account);
      const reserve = ethers.utils.parseEther(CHAIN[currentNetKey].gasReserve);
      const max = bal.gt(reserve) ? bal.sub(reserve) : bn(0);
      amountIn.value = ethers.utils.formatEther(max);
      updateEstimates();
      log(`MAX set (reserved ${CHAIN[currentNetKey].gasReserve} ${nativeSymbol()} for gas)`);
    } catch (e) {
      showError(`MAX failed: ${shortErr(e)}`);
    }
  }

  // ====== Events / wiring ======
  function wire() {
    renderRecipients();
    updateTotal();
    updateEstimates();
    setTopPills();
    setGasHint();

    connectBtn.onclick = connect;
    switchBtn.onclick = switchNetwork;

    networkSel.onchange = async () => {
      currentNetKey = networkSel.value;
      setTopPills();
      setGasHint();
      tokenPriceUSD = null;
      await refreshTokenAndWallet();
    };

    tokenAddr.oninput = async () => {
      tokenPriceUSD = null;
      await refreshTokenAndWallet();
    };

    amountIn.oninput = () => updateEstimates();
    maxBtn.onclick = setMax;

    addRecBtn.onclick = () => {
      recipients.push({ addr: "", pct: 0 });
      renderRecipients();
      updateTotal();
      updateEstimates();
    };

    approveBtn.onclick = approve;
    splitBtn.onclick = split;

    clearLogBtn.onclick = () => { logEl.textContent = ""; };
    liveBtn.onclick = refreshTokenAndWallet;

    // MetaMask listeners
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", () => window.location.reload());
      window.ethereum.on("chainChanged", () => window.location.reload());
    }
  }

  // ====== Boot ======
  wire();
  log("ZEPHENHEL CITADEL ready. Connect wallet to begin.");
})();
