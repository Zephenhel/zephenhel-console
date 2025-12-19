/* global ethers */
(() => {
  "use strict";

  /***********************
   * CONFIG (YOUR ADDRESSES)
   ***********************/
  const CONTRACTS = {
    bsc: {
      chainId: 56,
      chainIdHex: "0x38",
      chainName: "BNB Chain",
      rpcUrls: ["https://bsc-dataseed.binance.org/"],
      nativeSymbol: "BNB",
      explorer: "https://bscscan.com",
      splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
      vault: "0x69BD92784b9ED63a40d2cf51b475Ba68B37bD59E",
    },
    eth: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "Ethereum",
      rpcUrls: ["https://cloudflare-eth.com"],
      nativeSymbol: "ETH",
      explorer: "https://etherscan.io",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
      vault: "0x886f915D21A5BC540E86655a89e6223981D875d8",
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "Polygon",
      rpcUrls: ["https://polygon-rpc.com"],
      nativeSymbol: "MATIC",
      explorer: "https://polygonscan.com",
      splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
      vault: "0xde07160A2eC236315Dd27e9600f88Ba26F86f06e",
    },
  };

  /***********************
   * ABIs (MINIMAL)
   ***********************/
  // ZephFlexSplitter ABI (ONLY what we need)
  const SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
  ];

  // ERC20 ABI (for UI + approve)
  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  /***********************
   * DOM
   ***********************/
  const $ = (id) => document.getElementById(id);

  const el = {
    pillNet: $("pillNet"),
    pillWallet: $("pillWallet"),
    btnSwitch: $("btnSwitch"),
    btnConnect: $("btnConnect"),
    selChain: $("selChain"),
    selMode: $("selMode"),
    modeHint: $("modeHint"),

    tokenBlock: $("tokenBlock"),
    inpToken: $("inpToken"),
    inpAmount: $("inpAmount"),
    btnMax: $("btnMax"),
    btnNormalize: $("btnNormalize"),

    usdEst: $("usdEst"),
    postFeeLine: $("postFeeLine"),
    gasHint: $("gasHint"),

    recipients: $("recipients"),
    totalPill: $("totalPill"),
    btnAdd: $("btnAdd"),

    btnApprove: $("btnApprove"),
    btnExecute: $("btnExecute"),

    tipBox: $("tipBox"),
    errBox: $("errBox"),

    chkSound: $("chkSound"),

    teleNative: $("teleNative"),
    teleSymbol: $("teleSymbol"),
    teleDecimals: $("teleDecimals"),
    teleTokenBal: $("teleTokenBal"),
    teleAllowance: $("teleAllowance"),
    teleSplitter: $("teleSplitter"),
    teleDetected: $("teleDetected"),
    teleStatus: $("teleStatus"),

    btnRefresh: $("btnRefresh"),
    btnClear: $("btnClear"),
    log: $("log"),
  };

  /***********************
   * STATE
   ***********************/
  let provider = null;
  let signer = null;
  let userAddress = null;
  let currentChainKey = "bsc";
  let splitter = null;

  let token = null;
  let tokenAddr = null;
  let tokenDecimals = 18;
  let tokenSymbol = "—";
  let feeBps = 100;

  // recipients model: [{account, shareText}]
  let rows = [
    { account: "", share: "50" },
    { account: "", share: "50" },
  ];

  /***********************
   * LOGGING + UI HELPERS
   ***********************/
  function log(line) {
    const ts = new Date().toLocaleTimeString();
    el.log.textContent = `[${ts}] ${line}\n` + el.log.textContent;
  }

  function setError(msg) {
    el.errBox.style.display = msg ? "block" : "none";
    el.errBox.textContent = msg || "";
    if (msg) log(`ERROR: ${msg}`);
  }

  function setStatus(msg) {
    el.teleStatus.textContent = msg;
    log(msg);
  }

  function shortAddr(a) {
    if (!a || a.length < 10) return a || "—";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function isAddr(a) {
    try {
      return ethers.utils.isAddress(a);
    } catch {
      return false;
    }
  }

  function toBN(val) {
    return ethers.BigNumber.from(val.toString());
  }

  function clampInt(n, min, max) {
    n = Math.floor(Number(n));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /***********************
   * SOUND FX (WebAudio)
   ***********************/
  let audioCtx = null;

  function ensureAudio() {
    if (!el.chkSound?.checked) return null;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function beep({ freq = 880, dur = 0.08, type = "sine", gain = 0.12 } = {}) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  function radarPing() {
    // quick sweep style
    beep({ freq: 220, dur: 0.05, type: "triangle", gain: 0.10 });
    setTimeout(() => beep({ freq: 440, dur: 0.06, type: "triangle", gain: 0.10 }), 70);
    setTimeout(() => beep({ freq: 880, dur: 0.07, type: "triangle", gain: 0.10 }), 150);
  }

  function coinClink(i = 0) {
    const base = 520 + i * 35;
    beep({ freq: base, dur: 0.05, type: "square", gain: 0.05 });
    setTimeout(() => beep({ freq: base * 1.5, dur: 0.04, type: "square", gain: 0.04 }), 35);
  }

  function coinBeat(count) {
    const n = clampInt(count, 1, 24);
    for (let i = 0; i < n; i++) {
      setTimeout(() => coinClink(i), i * 110);
    }
  }

  /***********************
   * RENDER RECIPIENTS UI
   ***********************/
  function renderRecipients() {
    el.recipients.innerHTML = "";

    rows.forEach((r, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "row";

      const inpA = document.createElement("input");
      inpA.placeholder = "0xRecipient…";
      inpA.spellcheck = false;
      inpA.value = r.account || "";
      inpA.addEventListener("input", () => {
        rows[idx].account = inpA.value.trim();
        updateTotals();
      });

      const inpS = document.createElement("input");
      inpS.placeholder = "50";
      inpS.inputMode = "numeric";
      inpS.value = r.share || "";
      inpS.addEventListener("input", () => {
        rows[idx].share = inpS.value.trim();
        updateTotals();
      });

      const btnX = document.createElement("button");
      btnX.className = "btn ghost";
      btnX.textContent = "×";
      btnX.style.padding = "10px 0";
      btnX.addEventListener("click", () => {
        if (rows.length <= 2) return;
        rows.splice(idx, 1);
        renderRecipients();
        updateTotals();
      });

      wrap.appendChild(inpA);
      wrap.appendChild(inpS);
      wrap.appendChild(btnX);
      el.recipients.appendChild(wrap);
    });

    updateTotals();
  }

  function normalizeShares() {
    // Converts whatever numbers they typed into integer weights that sum to 100 (nice + clean)
    const nums = rows.map((r) => Number(r.share || 0)).map((n) => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);

    if (sum <= 0) {
      setError("Shares must be > 0.");
      return;
    }

    // Scale to 100 with rounding; remainder goes to last
    let scaled = nums.map((n) => Math.floor((n / sum) * 100));
    let s2 = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += 100 - s2;

    rows = rows.map((r, i) => ({ ...r, share: String(Math.max(1, scaled[i])) }));
    renderRecipients();
    setError("");
  }

  function updateTotals() {
    const nums = rows.map((r) => Number(r.share || 0)).map((n) => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    el.totalPill.textContent = `Total: ${sum ? sum : 0}`;
  }

  /***********************
   * CHAIN + WALLET
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask extension, then refresh.");
      throw new Error("No ethereum provider");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  async function connectWallet() {
    setError("");
    await ensureProvider();

    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      signer = provider.getSigner();
      userAddress = await signer.getAddress();

      // Update UI
      el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
      el.btnConnect.textContent = "CONNECTED";
      el.btnConnect.classList.remove("gold");
      el.btnConnect.classList.add("connected");
      el.btnConnect.disabled = true;

      radarPing();
      setStatus(`Connected: ${userAddress}`);

      await syncChainFromWallet();
      await initContracts();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.message || "Wallet connection failed.");
      throw e;
    }
  }

  async function syncChainFromWallet() {
    const net = await provider.getNetwork();
    const chainId = net.chainId;

    // map chainId -> key
    if (chainId === 56) currentChainKey = "bsc";
    else if (chainId === 1) currentChainKey = "eth";
    else if (chainId === 137) currentChainKey = "polygon";

    el.selChain.value = currentChainKey;
    el.pillNet.textContent = `Network: ${CONTRACTS[currentChainKey].chainName} (chainId ${chainId})`;
  }

  async function switchNetwork() {
    setError("");
    await ensureProvider();

    const key = el.selChain.value;
    const cfg = CONTRACTS[key];

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.chainIdHex }],
      });
      currentChainKey = key;
      await initContracts();
      await refreshTelemetry();
      setStatus(`Switched network to ${cfg.chainName}.`);
    } catch (err) {
      // If chain not added
      if (err?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: cfg.chainIdHex,
                chainName: cfg.chainName,
                nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
                rpcUrls: cfg.rpcUrls,
                blockExplorerUrls: [cfg.explorer],
              },
            ],
          });
          currentChainKey = key;
          await initContracts();
          await refreshTelemetry();
          setStatus(`Added + switched to ${cfg.chainName}.`);
          return;
        } catch (e2) {
          setError(e2?.message || "Failed to add chain.");
          return;
        }
      }
      setError(err?.message || "Network switch failed.");
    }
  }

  async function initContracts() {
    if (!provider) return;

    const cfg = CONTRACTS[currentChainKey];
    const splitAddr = cfg.splitter;

    splitter = new ethers.Contract(splitAddr, SPLITTER_ABI, signer || provider);

    el.teleSplitter.textContent = splitAddr;
    el.teleDetected.textContent = `ZephFlexSplitter (shares weights) + feeBps`;

    // read feeBps on this chain (REAL from contract)
    try {
      feeBps = await splitter.feeBps();
      feeBps = Number(feeBps);
    } catch {
      feeBps = 100;
    }

    // update fee UI text
    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    const feeTinyEls = document.querySelectorAll(".feeTiny");
    feeTinyEls.forEach((n) => (n.textContent = `${feePct}%`));

    setStatus(`Splitter ready on ${cfg.chainName}. feeBps=${feeBps}`);
  }

  /***********************
   * TOKEN LOADING + TELEMETRY
   ***********************/
  async function loadToken(address) {
    setError("");
    if (!isAddr(address)) {
      token = null;
      tokenAddr = null;
      tokenDecimals = 18;
      tokenSymbol = "—";
      el.teleSymbol.textContent = "—";
      el.teleDecimals.textContent = "—";
      el.teleTokenBal.textContent = "—";
      el.teleAllowance.textContent = "—";
      return;
    }

    tokenAddr = address;
    token = new ethers.Contract(tokenAddr, ERC20_ABI, signer || provider);

    try {
      tokenSymbol = await token.symbol();
    } catch {
      tokenSymbol = "TOKEN";
    }
    try {
      tokenDecimals = await token.decimals();
      tokenDecimals = Number(tokenDecimals);
    } catch {
      tokenDecimals = 18;
    }

    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);

    setStatus(`Token loaded: ${tokenSymbol} (decimals ${tokenDecimals})`);
  }

  async function refreshTelemetry() {
    if (!provider) return;

    const cfg = CONTRACTS[currentChainKey];

    // network pill (more accurate)
    const net = await provider.getNetwork();
    el.pillNet.textContent = `Network: ${cfg.chainName} (chainId ${net.chainId})`;

    if (!userAddress) {
      el.teleNative.textContent = "—";
      return;
    }

    // native balance
    try {
      const bal = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${cfg.nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    // token stats if token loaded
    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        el.teleTokenBal.textContent = "—";
      }

      try {
        const allow = await token.allowance(userAddress, CONTRACTS[currentChainKey].splitter);
        el.teleAllowance.textContent = `${ethers.utils.formatUnits(allow, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        el.teleAllowance.textContent = "—";
      }
    }

    // update post-fee line
    updateEstimate();
  }

  function updateEstimate() {
    const mode = el.selMode.value;
    const raw = (el.inpAmount.value || "").trim();
    const num = Number(raw);
    if (!raw || !Number.isFinite(num) || num <= 0) {
      el.usdEst.textContent = "—";
      el.postFeeLine.textContent = mode === "token" ? "You send (auto-detect) —" : "You send —";
      return;
    }

    // Fee is inside contract for token split.
    const afterFee = num * (1 - feeBps / 10000);
    if (mode === "token") {
      el.usdEst.textContent = `$${num.toFixed(2)}`;
      el.postFeeLine.textContent = `You receive (post-fee) ~ ${afterFee.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${tokenSymbol}`;
    } else {
      el.usdEst.textContent = `$${num.toFixed(2)}`;
      el.postFeeLine.textContent = `Native split: ${cfgNativeSymbol()} (client-side)`;
    }
  }

  function cfgNativeSymbol() {
    return CONTRACTS[currentChainKey]?.nativeSymbol || "NATIVE";
  }

  /***********************
   * ACTIONS: MAX, APPROVE, EXECUTE
   ***********************/
  async function setMaxGasSafe() {
    setError("");
    if (!provider || !userAddress) return setError("Connect wallet first.");

    const mode = el.selMode.value;
    if (mode !== "native") {
      // Your contract has NO native split function.
      // MAX is only meaningful for native transfers (ETH/BNB/MATIC).
      el.gasHint.textContent = "MAX is for native-only. Token mode: enter token amount.";
      return;
    }

    const cfg = CONTRACTS[currentChainKey];

    try {
      const bal = await provider.getBalance(userAddress);

      // reserve a buffer for gas (safe)
      // on BSC/Polygon typically enough; user can edit after.
      const reserve = ethers.utils.parseEther(currentChainKey === "eth" ? "0.005" : "0.003");
      const spendable = bal.gt(reserve) ? bal.sub(reserve) : ethers.BigNumber.from(0);

      el.inpAmount.value = ethers.utils.formatEther(spendable);
      setStatus(`MAX set (gas-safe). Reserved ${ethers.utils.formatEther(reserve)} ${cfg.nativeSymbol}`);
      updateEstimate();
    } catch (e) {
      setError(e?.message || "Failed to compute MAX.");
    }
  }

  function validateRecipients() {
    const accounts = [];
    const shares = [];

    for (let i = 0; i < rows.length; i++) {
      const a = (rows[i].account || "").trim();
      const s = (rows[i].share || "").trim();

      if (!isAddr(a)) return { ok: false, msg: `Recipient #${i + 1} address invalid.` };
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: `Recipient #${i + 1} share must be > 0.` };

      accounts.push(a);
      // IMPORTANT: contract expects weights (uint256). 50/50 is fine.
      shares.push(toBN(Math.floor(n)));
    }

    return { ok: true, accounts, shares };
  }

  async function approveToken() {
    setError("");
    if (!signer || !userAddress) return setError("Connect wallet first.");

    const mode = el.selMode.value;
    if (mode !== "token") return setError("Approve is for Token mode only.");

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    await loadToken(taddr);

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.btnApprove.disabled = true;
      setStatus(`Approving ${tokenSymbol} for splitter ${shortAddr(CONTRACTS[currentChainKey].splitter)}…`);

      const tx = await token.approve(CONTRACTS[currentChainKey].splitter, amountWei);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();

      setStatus("Approve confirmed ✅");
      await refreshTelemetry();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Approve failed.");
    } finally {
      el.btnApprove.disabled = false;
    }
  }

  async function executeSplit() {
    setError("");
    if (!signer || !userAddress) return setError("Connect wallet first.");

    const mode = el.selMode.value;

    if (mode === "native") {
      // Your deployed splitter contract does NOT support native splitting.
      // To do native splitting “today” without deploying another contract,
      // the only workable method is multiple signed transfers (one per recipient).
      return setError("Native split is not supported by ZephFlexSplitter contract. Deploy a native splitter contract if you want 1-tx native splits with fee.");
    }

    // Token mode (REAL contract call)
    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    await loadToken(taddr);

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const vr = validateRecipients();
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    // check allowance first to prevent confusing errors
    try {
      const allow = await token.allowance(userAddress, CONTRACTS[currentChainKey].splitter);
      if (allow.lt(amountWei)) {
        return setError(`Allowance too low. Approve at least ${amt} ${tokenSymbol} first.`);
      }
    } catch {
      // ignore
    }

    try {
      el.btnExecute.disabled = true;
      setStatus("Preflight… building split payload.");

      // Play coins (beat = number of recipients)
      coinBeat(vr.accounts.length);

      setStatus(`Executing splitToken via depositAndDistribute(${tokenSymbol})…`);

      // IMPORTANT: Correct order for your contract:
      // depositAndDistribute(token, accounts, shares, amount)
      const tx = await splitter.depositAndDistribute(
        taddr,
        vr.accounts,
        vr.shares,
        amountWei
      );

      log(`Execute tx: ${tx.hash}`);
      await tx.wait();

      setStatus("Split executed ✅");
      await refreshTelemetry();
    } catch (e) {
      // These errors show up as Internal JSON-RPC or UNPREDICTABLE_GAS_LIMIT
      // but we print the REAL revert reason when available
      const msg =
        e?.error?.message ||
        e?.data?.message ||
        e?.reason ||
        e?.message ||
        "Execute failed.";
      setError(msg);
    } finally {
      el.btnExecute.disabled = false;
    }
  }

  /***********************
   * MODE HANDLING
   ***********************/
  function applyMode() {
    const mode = el.selMode.value;

    if (mode === "token") {
      el.tokenBlock.style.display = "block";
      el.modeHint.textContent = "Tip: Token split uses Approve → Execute. Fee is applied inside the contract.";
      el.gasHint.textContent = "MAX is for native only. Tokens: enter amount.";
      el.btnApprove.style.display = "inline-block";
    } else {
      el.tokenBlock.style.display = "none";
      el.modeHint.textContent = "Native split requires a native splitter contract (not in ZephFlexSplitter).";
      el.gasHint.textContent = "MAX will reserve gas automatically for native coins.";
      el.btnApprove.style.display = "none";
    }

    updateEstimate();
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    el.btnConnect.addEventListener("click", () => connectWallet());
    el.btnSwitch.addEventListener("click", () => switchNetwork());
    el.selChain.addEventListener("change", () => {
      // if wallet connected, we switch; otherwise just update pill for UI
      if (provider) switchNetwork();
    });

    el.selMode.addEventListener("change", applyMode);

    el.inpToken.addEventListener("input", async () => {
      const v = (el.inpToken.value || "").trim();
      if (isAddr(v)) await loadToken(v);
      await refreshTelemetry();
    });

    el.inpAmount.addEventListener("input", () => updateEstimate());

    el.btnMax.addEventListener("click", () => setMaxGasSafe());
    el.btnNormalize.addEventListener("click", () => normalizeShares());

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "10" });
      renderRecipients();
    });

    el.btnApprove.addEventListener("click", () => approveToken());
    el.btnExecute.addEventListener("click", () => executeSplit());

    el.btnRefresh.addEventListener("click", () => refreshTelemetry());
    el.btnClear.addEventListener("click", () => {
      el.log.textContent = "";
      setError("");
      setStatus("Log cleared.");
    });

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        setError("");
        if (!accs || !accs.length) {
          userAddress = null;
          signer = null;
          el.pillWallet.textContent = "Wallet: Disconnected";
          el.btnConnect.textContent = "Connect";
          el.btnConnect.classList.remove("connected");
          el.btnConnect.classList.add("gold");
          el.btnConnect.disabled = false;
          setStatus("Disconnected.");
          return;
        }
        userAddress = accs[0];
        el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
        setStatus(`Account changed: ${userAddress}`);
        await refreshTelemetry();
      });

      window.ethereum.on("chainChanged", async () => {
        // provider refresh on chain change
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("Chain changed.");
        } catch {
          // ignore
        }
      });
    }
  }

  /***********************
   * BOOT
   ***********************/
  async function boot() {
    try {
      // default UI
      renderRecipients();
      applyMode();

      // initial chain selection
      currentChainKey = el.selChain.value || "bsc";
      el.pillNet.textContent = `Network: ${CONTRACTS[currentChainKey].chainName}`;
      el.teleSplitter.textContent = CONTRACTS[currentChainKey].splitter;
      el.teleDetected.textContent = "Awaiting connect…";

      bindEvents();
      setStatus("ZEPHENHEL CITADEL ready. Connect wallet to begin.");

      // If already connected in MetaMask, try silent connect
      if (window.ethereum) {
        await ensureProvider();
        const accs = await window.ethereum.request({ method: "eth_accounts" });
        if (accs && accs.length) {
          signer = provider.getSigner();
          userAddress = accs[0];

          el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
          el.btnConnect.textContent = "CONNECTED";
          el.btnConnect.classList.remove("gold");
          el.btnConnect.classList.add("connected");
          el.btnConnect.disabled = true;

          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("Auto-connected ✅");
        }
      }
    } catch (e) {
      setError(e?.message || "Boot error.");
    }
  }

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
