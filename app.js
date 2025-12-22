/* global ethers */
(() => {
  "use strict";

  /***********************
   * CONTRACT MAP (YOUR VERIFIED ADDRESSES)
   ***********************/
  const CONTRACTS = {
    bsc: {
      chainId: 56,
      chainIdHex: "0x38",
      chainName: "BNB CHAIN",
      nativeSymbol: "BNB",
      explorer: "https://bscscan.com",
      tokenSplitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
      tokenVault: "0x69BD92784b9ED63a40d2cf51b475Ba68B37bD59E",
      nativeSplitter:"0x190304170d78ba5144BFC617187B9e0b3f723F66",
      nativeVault: "0x7F86efd70c9CbF67d35e6162513DD6D56F8dBFE9",
    },
    ethereum: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "ETHEREUM",
      nativeSymbol: "ETH",
      explorer: "https://etherscan.io",
      tokenSplitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
      tokenVault: "0x798b4620d29cb6f1d4bFdA88D4537769E2BDdD47",
      nativeSplitter:"0xBcd7C5054522bf0A6DB5a63Fa2513a428e70b0FD",
      nativeVault: "0xB0b6b555d37220611e6d3d8c0DB6eC0C0b9A81Fc",
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "POLYGON",
      nativeSymbol: "MATIC",
      explorer: "https://polygonscan.com",
      tokenSplitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
      tokenVault: "0xde07160A2eC236315Dd27e9600f88Ba26F86f06e",
      // You confirmed the D01a one is NOT used. Using your v2 native splitter:
      nativeSplitter:"0xe59bd693661bB4201C1E91EB7b2A88E525C4cB99",
      nativeVault: "0xEB3992D48964783FC6B9c9881DfF67cC91ce2b4F",
    },
  };

  /***********************
   * ABIs (MINIMAL)
   ***********************/
  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  // ZephFlexSplitter
  const TOKEN_SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
  ];

  // ZephNativeSplitter
  const NATIVE_SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function distributeNative(address[] accounts, uint256[] shares) external payable",
  ];

  // ZephInheritanceVault (token)
  const TOKEN_VAULT_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function createVault(address token, uint256 amount, address[] recipients, uint256[] shares, uint64 inactivityPeriodSeconds, address safeWallet) external returns (uint256 vaultId)",
    "function ping(uint256 vaultId) external",
    "function freezeVault(uint256 vaultId) external",
    "function unfreezeVault(uint256 vaultId) external",
    "function executeInheritance(uint256 vaultId) external",
    "function getVault(uint256 vaultId) view returns (tuple(address owner,address token,address[] recipients,uint256[] shares,uint256 totalAmount,uint64 heartbeat,uint64 inactivityPeriod,bool frozen,bool executed,address safeWallet))",
  ];

  // ZephNativeInheritanceVault (native)
  const NATIVE_VAULT_ABI = [
    "function nativeSplitter() view returns (address)",
    "function createVault(address executor, uint64 inactivityPeriodSeconds, address safeWallet) external returns (uint256 vaultId)",
    "function deposit(uint256 vaultId) external payable",
    "function ping(uint256 vaultId) external",
    "function freeze(uint256 vaultId) external",
    "function unfreeze(uint256 vaultId) external",
    "function emergencyMoveToSafe(uint256 vaultId) external",
    "function execute(uint256 vaultId, address[] accounts, uint256[] shares) external",
    "function getVault(uint256 vaultId) view returns (tuple(address owner,address executor,address safeWallet,uint64 heartbeat,uint64 inactivityPeriod,bool frozen,bool executed,uint256 balance))",
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

    chkOperator: $("chkOperator"),
    chkSound: $("chkSound"),

    tabs: Array.from(document.querySelectorAll(".tab")),
    panes: {
      "split-token": $("pane-split-token"),
      "split-native": $("pane-split-native"),
      "vault-token": $("pane-vault-token"),
      "vault-native": $("pane-vault-native"),
    },

    // telemetry + log
    teleNative: $("teleNative"),
    teleSymbol: $("teleSymbol"),
    teleDecimals: $("teleDecimals"),
    teleTokenBal: $("teleTokenBal"),
    teleAllowance: $("teleAllowance"),
    teleActive: $("teleActive"),
    teleFee: $("teleFee"),
    teleStatus: $("teleStatus"),
    btnRefresh: $("btnRefresh"),
    btnClear: $("btnClear"),
    log: $("log"),
    errBox: $("errBox"),

    // labels on native tabs
    sn_symbol: $("sn_symbol"),
    vn_symbol: $("vn_symbol"),

    // token split
    st_token: $("st_token"),
    st_amount: $("st_amount"),
    st_usd: $("st_usd"),
    st_postFee: $("st_postFee"),
    st_feeTiny: $("st_feeTiny"),
    st_vector: $("st_vector"),
    st_recipients: $("st_recipients"),
    st_add: $("st_add"),
    st_normalize: $("st_normalize"),
    st_approve: $("st_approve"),
    st_execute: $("st_execute"),

    // native split
    sn_amount: $("sn_amount"),
    sn_max: $("sn_max"),
    sn_maxHint: $("sn_maxHint"),
    sn_vector: $("sn_vector"),
    sn_recipients: $("sn_recipients"),
    sn_add: $("sn_add"),
    sn_normalize: $("sn_normalize"),
    sn_execute: $("sn_execute"),

    // token vault
    vt_token: $("vt_token"),
    vt_amount: $("vt_amount"),
    vt_period: $("vt_period"),
    vt_safe: $("vt_safe"),
    vt_vector: $("vt_vector"),
    vt_recipients: $("vt_recipients"),
    vt_add: $("vt_add"),
    vt_normalize: $("vt_normalize"),
    vt_approve: $("vt_approve"),
    vt_create: $("vt_create"),
    vt_vaultId: $("vt_vaultId"),
    vt_load: $("vt_load"),
    vt_timerBox: $("vt_timerBox"),
    vt_ping: $("vt_ping"),
    vt_freeze: $("vt_freeze"),
    vt_unfreeze: $("vt_unfreeze"),
    vt_execute: $("vt_execute"),

    // native vault
    vn_executor: $("vn_executor"),
    vn_period: $("vn_period"),
    vn_safe: $("vn_safe"),
    vn_create: $("vn_create"),
    vn_vaultId: $("vn_vaultId"),
    vn_load: $("vn_load"),
    vn_depositAmt: $("vn_depositAmt"),
    vn_deposit: $("vn_deposit"),
    vn_ping: $("vn_ping"),
    vn_freeze: $("vn_freeze"),
    vn_unfreeze: $("vn_unfreeze"),
    vn_emergency: $("vn_emergency"),
    vn_vector: $("vn_vector"),
    vn_recipients: $("vn_recipients"),
    vn_add: $("vn_add"),
    vn_normalize: $("vn_normalize"),
    vn_execute: $("vn_execute"),
    vn_timerBox: $("vn_timerBox"),
  };

  /***********************
   * STATE
   ***********************/
  let provider = null;
  let signer = null;
  let userAddress = null;

  let currentKey = "bsc";
  let activeTab = "split-token";

  // contracts
  let tokenSplitter = null;
  let nativeSplitter = null;
  let tokenVault = null;
  let nativeVault = null;

  // token context
  let token = null;
  let tokenAddr = null;
  let tokenSymbol = "—";
  let tokenDecimals = 18;

  // fee
  let feeBps = 100;
  let feeWallet = null;

  // recipients models per module
  let rowsST = [{ account: "", share: "50" }, { account: "", share: "50" }];
  let rowsSN = [{ account: "", share: "50" }, { account: "", share: "50" }];
  let rowsVT = [{ account: "", share: "50" }, { account: "", share: "50" }];
  let rowsVN = [{ account: "", share: "50" }, { account: "", share: "50" }];

  // timers
  let timerInterval = null;

  /***********************
   * HELPERS
   ***********************/
  function log(line) {
    const ts = new Date().toLocaleTimeString();
    el.log.textContent = `[${ts}] ${line}\n` + el.log.textContent;
  }
  function setStatus(msg) {
    el.teleStatus.textContent = msg;
    log(msg);
  }
  function setError(msg) {
    el.errBox.style.display = msg ? "block" : "none";
    el.errBox.textContent = msg || "";
    if (msg) log(`ERROR: ${msg}`);
  }
  function shortAddr(a) {
    if (!a || a.length < 10) return a || "—";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }
  function isAddr(a) {
    try { return ethers.utils.isAddress(a); } catch { return false; }
  }
  function checksum(a) { return ethers.utils.getAddress(a); }

  function activeCfg() { return CONTRACTS[currentKey]; }

  function toBN(n) { return ethers.BigNumber.from(String(n)); }

  function clampInt(n, min, max) {
    n = Math.floor(Number(n));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function fmtCountdown(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    if (h > 0) return `${h}h ${m}m ${ss}s`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  }

  function fmtLocalTimeFromUnix(sec) {
    if (!sec) return "—";
    return new Date(sec * 1000).toLocaleString();
  }

  /***********************
   * SOUND FX
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
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  function radarPing() {
    beep({ freq: 220, dur: 0.05, type: "triangle", gain: 0.10 });
    setTimeout(() => beep({ freq: 440, dur: 0.06, type: "triangle", gain: 0.10 }), 70);
    setTimeout(() => beep({ freq: 880, dur: 0.07, type: "triangle", gain: 0.10 }), 150);
  }
  function coinBeat(count) {
    const n = clampInt(count, 1, 24);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const base = 520 + i * 35;
        beep({ freq: base, dur: 0.05, type: "square", gain: 0.05 });
        setTimeout(() => beep({ freq: base * 1.5, dur: 0.04, type: "square", gain: 0.04 }), 35);
      }, i * 110);
    }
  }

  /***********************
   * WALLET / NETWORK
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      throw new Error("No wallet provider detected. Install MetaMask and refresh.");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  function chainKeyFromId(chainId) {
    if (chainId === 56) return "bsc";
    if (chainId === 1) return "ethereum";
    if (chainId === 137) return "polygon";
    return null;
  }

  async function syncChainFromWallet() {
    const net = await provider.getNetwork();
    const key = chainKeyFromId(net.chainId);
    if (!key) throw new Error("Unsupported network. Use BNB, Ethereum, or Polygon.");
    currentKey = key;
    el.selChain.value = currentKey;
    el.pillNet.textContent = `THEATER: ${activeCfg().chainName} (chainId ${net.chainId})`;
    el.sn_symbol.textContent = activeCfg().nativeSymbol;
    el.vn_symbol.textContent = activeCfg().nativeSymbol;
  }

  async function switchNetwork() {
    setError("");
    await ensureProvider();
    const cfg = CONTRACTS[el.selChain.value];

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.chainIdHex }],
      });
      currentKey = el.selChain.value;
      await initContracts();
      await refreshTelemetry();
      setStatus(`THEATER SWITCHED → ${cfg.chainName}`);
    } catch (err) {
      setError(err?.message || "Network switch failed.");
    }
  }

  async function connectWallet() {
    setError("");
    await ensureProvider();

    await window.ethereum.request({ method: "eth_requestAccounts" });
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    el.pillWallet.textContent = `NODE: ${shortAddr(userAddress)}`;
    el.btnConnect.textContent = "LINKED";
    el.btnConnect.classList.remove("gold");
    el.btnConnect.classList.add("connected");
    el.btnConnect.disabled = true;

    radarPing();
    setStatus(`NODE LINKED: ${userAddress}`);

    await syncChainFromWallet();
    await initContracts();
    await refreshTelemetry();
    updateGuards();
  }

  async function initContracts() {
    const cfg = activeCfg();
    tokenSplitter = new ethers.Contract(cfg.tokenSplitter, TOKEN_SPLITTER_ABI, signer || provider);
    nativeSplitter = new ethers.Contract(cfg.nativeSplitter, NATIVE_SPLITTER_ABI, signer || provider);
    tokenVault = new ethers.Contract(cfg.tokenVault, TOKEN_VAULT_ABI, signer || provider);
    nativeVault = new ethers.Contract(cfg.nativeVault, NATIVE_VAULT_ABI, signer || provider);

    // fee policy shown from whichever pane is active, but we keep it consistent:
    // Token Splitter fee
    try {
      feeBps = Number(await tokenSplitter.feeBps());
      feeWallet = await tokenSplitter.feeWallet();
    } catch {
      feeBps = 100;
      feeWallet = null;
    }
    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    el.st_feeTiny.textContent = `${feePct}%`;
    el.teleFee.textContent = `${feePct}% → ${feeWallet ? shortAddr(feeWallet) : "feeWallet"}`;

    setStatus("CONTRACT ROUTER ONLINE.");
  }

  /***********************
   * TOKEN LOAD + TELEMETRY
   ***********************/
  async function loadToken(address) {
    if (!isAddr(address)) {
      token = null; tokenAddr = null; tokenSymbol = "—"; tokenDecimals = 18;
      el.teleSymbol.textContent = "—";
      el.teleDecimals.textContent = "—";
      el.teleTokenBal.textContent = "—";
      el.teleAllowance.textContent = "—";
      return;
    }
    tokenAddr = checksum(address);
    token = new ethers.Contract(tokenAddr, ERC20_ABI, signer || provider);
    try { tokenSymbol = await token.symbol(); } catch { tokenSymbol = "TOKEN"; }
    try { tokenDecimals = Number(await token.decimals()); } catch { tokenDecimals = 18; }
    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);
    setStatus(`ASSET LOADED: ${tokenSymbol} (${tokenDecimals} decimals)`);
  }

  async function refreshTelemetry() {
    if (!provider) return;

    const cfg = activeCfg();
    const net = await provider.getNetwork();
    el.pillNet.textContent = `THEATER: ${cfg.chainName} (chainId ${net.chainId})`;

    if (!userAddress) {
      el.teleNative.textContent = "—";
      return;
    }

    // native balance
    try {
      const b = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(b)} ${cfg.nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    // active contract shown per tab
    el.teleActive.textContent = activeContractForTab();

    // token-specific telemetry when token exists
    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch { el.teleTokenBal.textContent = "—"; }

      // allowance depends on feature:
      // token split uses spender = tokenSplitter
      // token vault uses spender = tokenVault
      let spender = activeTab === "vault-token" ? cfg.tokenVault : cfg.tokenSplitter;

      try {
        const al = await token.allowance(userAddress, spender);
        el.teleAllowance.textContent = `${ethers.utils.formatUnits(al, tokenDecimals)} ${tokenSymbol}`;
      } catch { el.teleAllowance.textContent = "—"; }
    }

    updateSplitTokenEstimate();
    updateGuards();
  }

  function activeContractForTab() {
    const cfg = activeCfg();
    if (activeTab === "split-token") return cfg.tokenSplitter;
    if (activeTab === "split-native") return cfg.nativeSplitter;
    if (activeTab === "vault-token") return cfg.tokenVault;
    if (activeTab === "vault-native") return cfg.nativeVault;
    return "—";
  }

  /***********************
   * RECIPIENT RENDERERS
   ***********************/
  function renderRecipients(container, model, vectorEl, onChange) {
    container.innerHTML = "";

    model.forEach((r, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "row";

      const inpA = document.createElement("input");
      inpA.placeholder = "0xTARGET…";
      inpA.spellcheck = false;
      inpA.value = r.account || "";
      inpA.addEventListener("input", () => {
        model[idx].account = inpA.value.trim();
        updateVector(vectorEl, model);
        onChange?.();
      });

      const inpS = document.createElement("input");
      inpS.placeholder = "50";
      inpS.inputMode = "numeric";
      inpS.value = r.share || "";
      inpS.addEventListener("input", () => {
        model[idx].share = inpS.value.trim();
        updateVector(vectorEl, model);
        onChange?.();
      });

      const btnX = document.createElement("button");
      btnX.className = "btn ghost";
      btnX.textContent = "×";
      btnX.style.padding = "10px 0";
      btnX.addEventListener("click", () => {
        if (model.length <= 2) return;
        model.splice(idx, 1);
        renderRecipients(container, model, vectorEl, onChange);
        updateVector(vectorEl, model);
        onChange?.();
      });

      wrap.appendChild(inpA);
      wrap.appendChild(inpS);
      wrap.appendChild(btnX);
      container.appendChild(wrap);
    });

    updateVector(vectorEl, model);
  }

  function updateVector(vectorEl, model) {
    const nums = model.map(x => Number(x.share || 0)).map(n => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a,b)=>a+b,0);
    vectorEl.textContent = `VECTOR: ${sum || 0}`;
  }

  function normalizeModel(model, container, vectorEl, onChange) {
    const nums = model.map(x => Number(x.share || 0)).map(n => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a,b)=>a+b,0);
    if (sum <= 0) return setError("Vector must be > 0.");
    let scaled = nums.map(n => Math.floor((n / sum) * 100));
    let s2 = scaled.reduce((a,b)=>a+b,0);
    scaled[scaled.length - 1] += (100 - s2);
    for (let i=0;i<model.length;i++) model[i].share = String(Math.max(1, scaled[i]));
    renderRecipients(container, model, vectorEl, onChange);
    setError("");
  }

  function validateRecipients(model) {
    const accounts = [];
    const shares = [];
    for (let i=0;i<model.length;i++) {
      const a = (model[i].account || "").trim();
      const s = (model[i].share || "").trim();
      if (!isAddr(a)) return { ok:false, msg:`Target #${i+1} address invalid.` };
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return { ok:false, msg:`Target #${i+1} share must be > 0.` };
      accounts.push(checksum(a));
      shares.push(toBN(Math.floor(n)));
    }
    const lowers = accounts.map(x=>x.toLowerCase());
    const set = new Set(lowers);
    if (set.size !== accounts.length) return { ok:false, msg:"Duplicate targets detected." };
    if (set.size === 1) return { ok:false, msg:"All targets resolve to the same address." };
    return { ok:true, accounts, shares };
  }

  /***********************
   * TOKEN SPLIT (approve + execute)
   ***********************/
  async function stApprove() {
    setError("");
    if (!signer || !userAddress) return setError("LINK NODE first.");
    const cfg = activeCfg();

    const taddr = (el.st_token.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");
    await loadToken(taddr);

    const amt = (el.st_amount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const vr = validateRecipients(rowsST);
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.st_approve.disabled = true;
      setStatus(`APPROVING ${tokenSymbol} → Splitter ${shortAddr(cfg.tokenSplitter)}…`);

      // IMPORTANT: spender is the TOKEN SPLITTER (not token, not vault)
      const tx = await token.approve(cfg.tokenSplitter, amountWei);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();

      setStatus("APPROVE CONFIRMED ✅");
      await refreshTelemetry();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Approve failed.");
    } finally {
      el.st_approve.disabled = false;
      updateGuards();
    }
  }

  async function stExecute() {
    setError("");
    if (!signer || !userAddress) return setError("LINK NODE first.");
    const cfg = activeCfg();

    const taddr = (el.st_token.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");
    await loadToken(taddr);

    const amt = (el.st_amount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const vr = validateRecipients(rowsST);
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    // allowance check
    try {
      const allow = await token.allowance(userAddress, cfg.tokenSplitter);
      if (allow.lt(amountWei)) return setError(`Allowance too low. Approve at least ${amt} ${tokenSymbol} first.`);
    } catch {}

    try {
      el.st_execute.disabled = true;
      setStatus("EXECUTE SPLIT…");
      coinBeat(vr.accounts.length);

      // static call to catch reverts early
      await tokenSplitter.callStatic.depositAndDistribute(
        checksum(taddr),
        vr.accounts,
        vr.shares,
        amountWei
      );

      const tx = await tokenSplitter.depositAndDistribute(
        checksum(taddr),
        vr.accounts,
        vr.shares,
        amountWei
      );
      log(`Execute tx: ${tx.hash}`);
      await tx.wait();

      setStatus("SPLIT COMPLETE ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Execute failed.";
      setError(msg);
    } finally {
      el.st_execute.disabled = false;
      updateGuards();
    }
  }

  function updateSplitTokenEstimate() {
    const raw = (el.st_amount.value || "").trim();
    const num = Number(raw);
    if (!raw || !Number.isFinite(num) || num <= 0) {
      el.st_usd.textContent = "—";
      el.st_postFee.textContent = "Post-fee delivery —";
      return;
    }
    const afterFee = num * (1 - feeBps / 10000);
    el.st_usd.textContent = `~${raw} ${tokenSymbol}`;
    el.st_postFee.textContent =
      `Post-fee delivery ~ ${afterFee.toFixed(6).replace(/0+$/,"").replace(/\.$/,"")} ${tokenSymbol}`;
  }

  /***********************
   * NATIVE SPLIT
   ***********************/
  async function snMaxGasSafe() {
    setError("");
    if (!provider || !userAddress) return setError("LINK NODE first.");

    const cfg = activeCfg();
    try {
      const bal = await provider.getBalance(userAddress);
      const reserve = ethers.utils.parseEther(currentKey === "ethereum" ? "0.005" : "0.003");
      const spendable = bal.gt(reserve) ? bal.sub(reserve) : ethers.BigNumber.from(0);
      const amt = ethers.utils.formatEther(spendable);
      el.sn_amount.value = amt;
      el.sn_maxHint.textContent = `Max set: ${amt} ${cfg.nativeSymbol}`;
      setStatus(`MAX SET (gas-safe). Reserved ${ethers.utils.formatEther(reserve)} ${cfg.nativeSymbol}`);
    } catch (e) {
      setError(e?.message || "Failed to compute MAX.");
    }
  }

  async function snExecute() {
    setError("");
    if (!signer || !userAddress) return setError("LINK NODE first.");
    const cfg = activeCfg();

    const amt = (el.sn_amount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid native amount.");

    const vr = validateRecipients(rowsSN);
    if (!vr.ok) return setError(vr.msg);

    const valueWei = ethers.utils.parseEther(amt);

    try {
      el.sn_execute.disabled = true;
      setStatus("EXECUTE NATIVE SPLIT…");
      coinBeat(vr.accounts.length);

      await nativeSplitter.callStatic.distributeNative(vr.accounts, vr.shares, { value: valueWei });
      const tx = await nativeSplitter.distributeNative(vr.accounts, vr.shares, { value: valueWei });
      log(`Native split tx: ${tx.hash}`);
      await tx.wait();

      setStatus("NATIVE SPLIT COMPLETE ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Native split failed.";
      setError(msg);
    } finally {
      el.sn_execute.disabled = false;
      updateGuards();
    }
  }

  /***********************
   * TOKEN VAULT (approve + create + timer + execute)
   ***********************/
  async function vtApprove() {
    setError("");
    if (!signer || !userAddress) return setError("LINK NODE first.");
    const cfg = activeCfg();

    const taddr = (el.vt_token.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");
    await loadToken(taddr);

    const amt = (el.vt_amount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid lock amount.");

    const vr = validateRecipients(rowsVT);
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.vt_approve.disabled = true;
      setStatus(`APPROVING ${tokenSymbol} → Vault ${shortAddr(cfg.tokenVault)}…`);

      // IMPORTANT: spender is TOKEN VAULT here
      const tx = await token.approve(cfg.tokenVault, amountWei);
      log(`Vault approve tx: ${tx.hash}`);
      await tx.wait();

      setStatus("VAULT APPROVE CONFIRMED ✅");
      await refreshTelemetry();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Vault approve failed.");
    } finally {
      el.vt_approve.disabled = false;
      updateGuards();
    }
  }

  async function vtCreate() {
    setError("");
    if (!signer || !userAddress) return setError("LINK NODE first.");
    const cfg = activeCfg();

    const taddr = (el.vt_token.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");
    await loadToken(taddr);

    const amt = (el.vt_amount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid lock amount.");

    const period = clampInt(el.vt_period.value || "0", 1, 315360000);
    if (period <= 0) return setError("Enter inactivity seconds (e.g. 120).");

    const safeRaw = (el.vt_safe.value || "").trim();
    const safe = safeRaw ? (isAddr(safeRaw) ? checksum(safeRaw) : null) : ethers.constants.AddressZero;
    if (safeRaw && !safe) return setError("Safe wallet is not a valid address.");

    const vr = validateRecipients(rowsVT);
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    // allowance check
    try {
      const allow = await token.allowance(userAddress, cfg.tokenVault);
      if (allow.lt(amountWei)) return setError(`Allowance too low. Approve vault for ${amt} ${tokenSymbol} first.`);
    } catch {}

    try {
      el.vt_create.disabled = true;
      setStatus("CREATING TOKEN VAULT…");

      const tx = await tokenVault.createVault(
        checksum(taddr),
        amountWei,
        vr.accounts,
        vr.shares,
        period,
        safe
      );
      log(`Create vault tx: ${tx.hash}`);
      const receipt = await tx.wait();

      setStatus("TOKEN VAULT CREATED ✅");

      // user can copy/paste vault id from events later; for now we just tell them to load by id
      el.vt_timerBox.textContent = "Vault created. Enter Vault ID and press LOAD.";
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Create vault failed.";
      setError(msg);
    } finally {
      el.vt_create.disabled = false;
      updateGuards();
    }
  }

  async function vtLoad() {
    setError("");
    if (!provider) return setError("LINK NODE first.");
    const id = clampInt(el.vt_vaultId.value || "0", 0, 10_000_000);
    try {
      const v = await tokenVault.getVault(id);
      startVaultTimer("token", id, v.heartbeat, v.inactivityPeriod, v.executed, v.frozen);
      setStatus(`TOKEN VAULT LOADED: #${id}`);
    } catch (e) {
      setError(e?.message || "Failed to load vault.");
    }
  }

  async function vtPing() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vt_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await tokenVault.ping(id);
      log(`Ping tx: ${tx.hash}`);
      await tx.wait();
      setStatus("PING CONFIRMED ✅");
      await vtLoad();
    } catch (e) { setError(e?.data?.message || e?.message || "Ping failed."); }
  }
  async function vtFreeze() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vt_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await tokenVault.freezeVault(id);
      log(`Freeze tx: ${tx.hash}`);
      await tx.wait();
      setStatus("FROZEN ✅");
      await vtLoad();
    } catch (e) { setError(e?.data?.message || e?.message || "Freeze failed."); }
  }
  async function vtUnfreeze() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vt_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await tokenVault.unfreezeVault(id);
      log(`Unfreeze tx: ${tx.hash}`);
      await tx.wait();
      setStatus("UNFROZEN ✅");
      await vtLoad();
    } catch (e) { setError(e?.data?.message || e?.message || "Unfreeze failed."); }
  }
  async function vtExecuteInheritance() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vt_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await tokenVault.executeInheritance(id);
      log(`ExecuteInheritance tx: ${tx.hash}`);
      await tx.wait();
      setStatus("INHERITANCE EXECUTED ✅");
      await vtLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "ExecuteInheritance failed.");
    }
  }

  /***********************
   * NATIVE VAULT (create/deposit/execute + timer)
   ***********************/
  async function vnCreate() {
    setError("");
    if (!signer || !userAddress) return setError("LINK NODE first.");

    const execRaw = (el.vn_executor.value || "").trim();
    if (!isAddr(execRaw)) return setError("Executor must be a valid address.");

    const safeRaw = (el.vn_safe.value || "").trim();
    if (!isAddr(safeRaw)) return setError("Safe wallet must be a valid address.");

    const period = clampInt(el.vn_period.value || "0", 1, 315360000);
    if (period <= 0) return setError("Enter inactivity seconds (e.g. 120).");

    try {
      el.vn_create.disabled = true;
      setStatus("CREATING NATIVE VAULT…");

      const tx = await nativeVault.createVault(checksum(execRaw), period, checksum(safeRaw));
      log(`Create native vault tx: ${tx.hash}`);
      await tx.wait();

      setStatus("NATIVE VAULT CREATED ✅");
      el.vn_timerBox.textContent = "Vault created. Enter Vault ID and press LOAD.";
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Create native vault failed.");
    } finally {
      el.vn_create.disabled = false;
    }
  }

  async function vnLoad() {
    setError("");
    if (!provider) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);
    try {
      const v = await nativeVault.getVault(id);
      startVaultTimer("native", id, v.heartbeat, v.inactivityPeriod, v.executed, v.frozen, v.executor);
      setStatus(`NATIVE VAULT LOADED: #${id}`);
    } catch (e) {
      setError(e?.message || "Failed to load native vault.");
    }
  }

  async function vnDeposit() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);
    const amt = (el.vn_depositAmt.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid deposit amount.");
    const valueWei = ethers.utils.parseEther(amt);
    try {
      el.vn_deposit.disabled = true;
      setStatus("DEPOSITING…");
      const tx = await nativeVault.deposit(id, { value: valueWei });
      log(`Deposit tx: ${tx.hash}`);
      await tx.wait();
      setStatus("DEPOSIT CONFIRMED ✅");
      await vnLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Deposit failed.");
    } finally {
      el.vn_deposit.disabled = false;
    }
  }

  async function vnPing() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await nativeVault.ping(id);
      log(`Ping tx: ${tx.hash}`);
      await tx.wait();
      setStatus("PING CONFIRMED ✅");
      await vnLoad();
    } catch (e) { setError(e?.data?.message || e?.message || "Ping failed."); }
  }
  async function vnFreeze() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await nativeVault.freeze(id);
      log(`Freeze tx: ${tx.hash}`);
      await tx.wait();
      setStatus("FROZEN ✅");
      await vnLoad();
    } catch (e) { setError(e?.data?.message || e?.message || "Freeze failed."); }
  }
  async function vnUnfreeze() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await nativeVault.unfreeze(id);
      log(`Unfreeze tx: ${tx.hash}`);
      await tx.wait();
      setStatus("UNFROZEN ✅");
      await vnLoad();
    } catch (e) { setError(e?.data?.message || e?.message || "Unfreeze failed."); }
  }
  async function vnEmergency() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);
    try {
      const tx = await nativeVault.emergencyMoveToSafe(id);
      log(`Emergency tx: ${tx.hash}`);
      await tx.wait();
      setStatus("EMERGENCY MOVE COMPLETE ✅");
      await vnLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Emergency move failed.");
    }
  }

  async function vnExecute() {
    setError("");
    if (!signer) return setError("LINK NODE first.");
    const id = clampInt(el.vn_vaultId.value || "0", 0, 10_000_000);

    const vr = validateRecipients(rowsVN);
    if (!vr.ok) return setError(vr.msg);

    try {
      el.vn_execute.disabled = true;
      setStatus("EXECUTING NATIVE VAULT…");
      coinBeat(vr.accounts.length);

      const tx = await nativeVault.execute(id, vr.accounts, vr.shares);
      log(`Execute vault tx: ${tx.hash}`);
      await tx.wait();

      setStatus("NATIVE VAULT EXECUTED ✅");
      await vnLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Vault execute failed.");
    } finally {
      el.vn_execute.disabled = false;
    }
  }

  /***********************
   * VAULT TIMER ENGINE
   ***********************/
  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function startVaultTimer(kind, vaultId, heartbeat, inactivity, executed, frozen, executorAddr) {
    stopTimer();

    function paint() {
      const hb = Number(heartbeat);
      const per = Number(inactivity);
      const unlockAt = hb + per;
      const now = nowSec();
      const remaining = unlockAt - now;

      const unlocked = remaining <= 0;

      const header = `Vault #${vaultId} • ${kind.toUpperCase()} • ${frozen ? "FROZEN" : "ACTIVE"} • ${executed ? "EXECUTED" : (unlocked ? "UNLOCKED" : "LOCKED")}`;
      const line1 = `Last heartbeat: ${fmtLocalTimeFromUnix(hb)} (unix ${hb})`;
      const line2 = `Unlock time: ${fmtLocalTimeFromUnix(unlockAt)} (unix ${unlockAt})`;
      const line3 = executed ? `Status: executed` : (unlocked ? `Unlocked: YES` : `Countdown: ${fmtCountdown(remaining)}`);

      const extra = executorAddr ? `Executor: ${shortAddr(executorAddr)}` : "";

      const text = `${header}\n${line1}\n${line2}\n${line3}${extra ? `\n${extra}` : ""}`;

      if (kind === "token") el.vt_timerBox.textContent = text;
      else el.vn_timerBox.textContent = text;
    }

    paint();
    timerInterval = setInterval(paint, 1000);
  }

  /***********************
   * UI TABS / OPERATOR MODE
   ***********************/
  function setTab(tabKey) {
    activeTab = tabKey;

    for (const k of Object.keys(el.panes)) {
      el.panes[k].style.display = (k === tabKey) ? "block" : "none";
    }
    el.tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabKey));

    el.teleActive.textContent = activeContractForTab();
    setStatus(`TAB: ${tabKey.toUpperCase()}`);
    setError("");
    updateGuards();
    refreshTelemetry().catch(()=>{});
  }

  function applyOperatorMode() {
    const op = !!el.chkOperator.checked;
    // In simple mode, we keep the right card visible but still clean.
    // Operator mode just means we allow more buttons & telemetry info stays.
    // (If you later want to hide the entire right panel in simple mode, I can do that too.)
    setStatus(op ? "OPERATOR CONSOLE: ON" : "SIMPLE MODE: ON");
  }

  /***********************
   * GUARDS (prevents broken approve/execute)
   ***********************/
  function updateGuards() {
    const connected = !!signer && !!userAddress;

    // chain switch & connect
    el.btnSwitch.disabled = !provider;
    // token split
    el.st_approve.disabled = !connected;
    el.st_execute.disabled = !connected;

    // native split
    el.sn_execute.disabled = !connected;

    // token vault
    el.vt_approve.disabled = !connected;
    el.vt_create.disabled = !connected;
    el.vt_ping.disabled = !connected;
    el.vt_freeze.disabled = !connected;
    el.vt_unfreeze.disabled = !connected;
    el.vt_execute.disabled = !connected;

    // native vault
    el.vn_create.disabled = !connected;
    el.vn_deposit.disabled = !connected;
    el.vn_ping.disabled = !connected;
    el.vn_freeze.disabled = !connected;
    el.vn_unfreeze.disabled = !connected;
    el.vn_emergency.disabled = !connected;
    el.vn_execute.disabled = !connected;
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    // tabs
    el.tabs.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

    // connect/switch
    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);
    el.selChain.addEventListener("change", () => { if (provider) switchNetwork(); });

    // operator mode
    el.chkOperator.addEventListener("change", applyOperatorMode);

    // refresh/log clear
    el.btnRefresh.addEventListener("click", refreshTelemetry);
    el.btnClear.addEventListener("click", () => { el.log.textContent = ""; setError(""); setStatus("Log cleared."); });

    // token load triggers
    el.st_token.addEventListener("input", async () => { const v=el.st_token.value.trim(); if (isAddr(v)) await loadToken(v); refreshTelemetry(); });
    el.vt_token.addEventListener("input", async () => { const v=el.vt_token.value.trim(); if (isAddr(v)) await loadToken(v); refreshTelemetry(); });

    el.st_amount.addEventListener("input", () => updateSplitTokenEstimate());

    // recipients UI init
    renderRecipients(el.st_recipients, rowsST, el.st_vector, updateGuards);
    renderRecipients(el.sn_recipients, rowsSN, el.sn_vector, updateGuards);
    renderRecipients(el.vt_recipients, rowsVT, el.vt_vector, updateGuards);
    renderRecipients(el.vn_recipients, rowsVN, el.vn_vector, updateGuards);

    // add buttons
    el.st_add.addEventListener("click", () => { rowsST.push({account:"",share:"10"}); renderRecipients(el.st_recipients, rowsST, el.st_vector, updateGuards); });
    el.sn_add.addEventListener("click", () => { rowsSN.push({account:"",share:"10"}); renderRecipients(el.sn_recipients, rowsSN, el.sn_vector, updateGuards); });
    el.vt_add.addEventListener("click", () => { rowsVT.push({account:"",share:"10"}); renderRecipients(el.vt_recipients, rowsVT, el.vt_vector, updateGuards); });
    el.vn_add.addEventListener("click", () => { rowsVN.push({account:"",share:"10"}); renderRecipients(el.vn_recipients, rowsVN, el.vn_vector, updateGuards); });

    // normalize
    el.st_normalize.addEventListener("click", () => normalizeModel(rowsST, el.st_recipients, el.st_vector, updateGuards));
    el.sn_normalize.addEventListener("click", () => normalizeModel(rowsSN, el.sn_recipients, el.sn_vector, updateGuards));
    el.vt_normalize.addEventListener("click", () => normalizeModel(rowsVT, el.vt_recipients, el.vt_vector, updateGuards));
    el.vn_normalize.addEventListener("click", () => normalizeModel(rowsVN, el.vn_recipients, el.vn_vector, updateGuards));

    // token split actions
    el.st_approve.addEventListener("click", stApprove);
    el.st_execute.addEventListener("click", stExecute);

    // native split actions
    el.sn_max.addEventListener("click", snMaxGasSafe);
    el.sn_execute.addEventListener("click", snExecute);

    // token vault actions
    el.vt_approve.addEventListener("click", vtApprove);
    el.vt_create.addEventListener("click", vtCreate);
    el.vt_load.addEventListener("click", vtLoad);
    el.vt_ping.addEventListener("click", vtPing);
    el.vt_freeze.addEventListener("click", vtFreeze);
    el.vt_unfreeze.addEventListener("click", vtUnfreeze);
    el.vt_execute.addEventListener("click", vtExecuteInheritance);

    // native vault actions
    el.vn_create.addEventListener("click", vnCreate);
    el.vn_load.addEventListener("click", vnLoad);
    el.vn_deposit.addEventListener("click", vnDeposit);
    el.vn_ping.addEventListener("click", vnPing);
    el.vn_freeze.addEventListener("click", vnFreeze);
    el.vn_unfreeze.addEventListener("click", vnUnfreeze);
    el.vn_emergency.addEventListener("click", vnEmergency);
    el.vn_execute.addEventListener("click", vnExecute);

    // metamask events
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        setError("");
        if (!accs || !accs.length) {
          userAddress = null; signer = null;
          el.pillWallet.textContent = "NODE: DISCONNECTED";
          el.btnConnect.textContent = "LINK NODE";
          el.btnConnect.classList.remove("connected");
          el.btnConnect.classList.add("gold");
          el.btnConnect.disabled = false;
          stopTimer();
          setStatus("NODE DISCONNECTED.");
          updateGuards();
          return;
        }
        userAddress = accs[0];
        el.pillWallet.textContent = `NODE: ${shortAddr(userAddress)}`;
        setStatus(`NODE CHANGED: ${userAddress}`);
        await refreshTelemetry();
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("THEATER CHANGED.");
        } catch (e) {
          setError(e?.message || "Chain change error.");
        }
      });
    }
  }

  /***********************
   * BOOT
   ***********************/
  async function boot() {
    try {
      bindEvents();
      setTab("split-token");
      applyOperatorMode();
      updateGuards();
      setStatus("CITADEL ONLINE. LINK NODE to begin.");

      // silent connect if already authorized
      if (window.ethereum) {
        await ensureProvider();
        const accs = await window.ethereum.request({ method: "eth_accounts" });
        if (accs && accs.length) {
          signer = provider.getSigner();
          userAddress = accs[0];

          el.pillWallet.textContent = `NODE: ${shortAddr(userAddress)}`;
          el.btnConnect.textContent = "LINKED";
          el.btnConnect.classList.remove("gold");
          el.btnConnect.classList.add("connected");
          el.btnConnect.disabled = true;

          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("AUTO-LINKED ✅");
        }
      }
    } catch (e) {
      setError(e?.message || "Boot error.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
