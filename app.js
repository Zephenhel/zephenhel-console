/* global ethers */
(() => {
  "use strict";

  /***********************
   * YOU (GLOBAL FEE WALLET DISPLAY)
   ***********************/
  const GLOBAL_FEE_WALLET = "0x9285d738aD948C09E14BAc12e8D2Cc3E11eC59ec";

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
      nativeSplitter: "0x190304170d78ba5144BFC617187B9e0b3f723F66",
      nativeVault: "0x7F86efd70c9CbF67d35e6162513DD6D56F8dBFE9",
      rpcFallbacks: [
        "https://bsc-dataseed.binance.org/",
        "https://bsc-dataseed1.binance.org/",
        "https://bsc-dataseed2.binance.org/",
      ],
    },
    ethereum: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "ETHEREUM",
      nativeSymbol: "ETH",
      explorer: "https://etherscan.io",
      tokenSplitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
      tokenVault: "0x798b4620d29cb6f1d4bFdA88D4537769E2BDdD47",
      nativeSplitter: "0xBcd7C5054522bf0A6DB5a63Fa2513a428e70b0FD",
      nativeVault: "0xB0b6b555d37220611e6d3d8c0DB6eC0C0b9A81Fc",
      rpcFallbacks: [
        "https://cloudflare-eth.com",
        "https://rpc.ankr.com/eth",
      ],
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "POLYGON",
      nativeSymbol: "MATIC",
      explorer: "https://polygonscan.com",
      tokenSplitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
      tokenVault: "0xde07160A2eC236315Dd27e9600f88Ba26F86f06e",
      nativeSplitter: "0xe59bd693661bB4201C1E91EB7b2A88E525C4cB99",
      nativeVault: "0xEB3992D48964783FC6B9c9881DfF67cC91ce2b4F",
      rpcFallbacks: [
        "https://polygon-rpc.com",
        "https://rpc.ankr.com/polygon",
      ],
    },
  };

  /***********************
   * ABIs (MINIMAL + EVENTS)
   ***********************/
  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  const TOKEN_SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
  ];

  const NATIVE_SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function distributeNative(address[] accounts, uint256[] shares) external payable",
  ];

  const TOKEN_VAULT_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function createVault(address token, uint256 amount, address[] recipients, uint256[] shares, uint64 inactivityPeriodSeconds, address safeWallet) external returns (uint256 vaultId)",
    "function ping(uint256 vaultId) external",
    "function freezeVault(uint256 vaultId) external",
    "function unfreezeVault(uint256 vaultId) external",
    "function executeInheritance(uint256 vaultId) external",
    "function getVault(uint256 vaultId) view returns (tuple(address owner,address token,address[] recipients,uint256[] shares,uint256 totalAmount,uint64 heartbeat,uint64 inactivityPeriod,bool frozen,bool executed,address safeWallet))",
    "event VaultCreated(uint256 indexed vaultId, address indexed owner, address indexed token, uint256 amount, uint64 inactivityPeriod, address safeWallet)",
  ];

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
    "event VaultCreated(uint256 indexed vaultId, address indexed vaultOwner, address indexed executor, address safeWallet, uint64 inactivityPeriod)",
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
    feeWalletInline: $("feeWalletInline"),

    chkSound: $("chkSound"),
    radar: $("radar"),

    tabs: Array.from(document.querySelectorAll(".tab")),
    panes: {
      "split-token": $("pane-split-token"),
      "split-native": $("pane-split-native"),
      "vault-token": $("pane-vault-token"),
      "vault-native": $("pane-vault-native"),
      "my-vaults": $("pane-my-vaults"),
    },
    paneTitle: $("paneTitle"),
    paneBadge: $("paneBadge"),

    // telemetry
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
    btnViewExplorer: $("btnViewExplorer"),
    log: $("log"),
    errBox: $("errBox"),

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
    sn_symbol: $("sn_symbol"),
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
    vn_symbol: $("vn_symbol"),
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

    // my vaults
    mv_range: $("mv_range"),
    mv_scan: $("mv_scan"),
    mv_tokenCount: $("mv_tokenCount"),
    mv_nativeCount: $("mv_nativeCount"),
    mv_tokenList: $("mv_tokenList"),
    mv_nativeList: $("mv_nativeList"),
  };

  /***********************
   * STATE
   ***********************/
  let provider = null;
  let signer = null;
  let userAddress = null;
  let currentKey = "bsc";
  let activeTab = "split-token";
  let lastExplorerBase = CONTRACTS.bsc.explorer;

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

  // recipients models
  let rowsST = [{ account: "", share: "50" }, { account: "", share: "50" }];
  let rowsSN = [{ account: "", share: "50" }, { account: "", share: "50" }];
  let rowsVT = [{ account: "", share: "50" }, { account: "", share: "50" }];
  let rowsVN = [{ account: "", share: "50" }, { account: "", share: "50" }];

  // vault timer intervals
  let timerIntervalVT = null;
  let timerIntervalVN = null;

  // radar blips
  let radarBlips = [];
  let radarAngle = 0;

  /***********************
   * LOG / UI
   ***********************/
  function log(line) {
    const ts = new Date().toLocaleTimeString();
    el.log.textContent = `[${ts}] ${line}\n` + el.log.textContent;
  }
  function setStatus(msg) {
    el.teleStatus.textContent = msg;
    log(msg);
    radarBlip();
  }
  function setError(msg) {
    el.errBox.style.display = msg ? "block" : "none";
    el.errBox.textContent = msg || "";
    if (msg) log(`ERROR: ${msg}`);
    if (msg) radarBlip(true);
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

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("COPIED ✅");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("COPIED ✅");
    }
  }

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
   * SOUND + RADAR (PING + SONAR)
   ***********************/
  let audioCtx = null;
  function ensureAudio() {
    if (!el.chkSound?.checked) return null;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function beep({ freq = 880, dur = 0.08, type = "sine", gain = 0.10 } = {}) {
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
  function pingFx() {
    beep({ freq: 220, dur: 0.05, type: "triangle", gain: 0.08 });
    setTimeout(() => beep({ freq: 440, dur: 0.06, type: "triangle", gain: 0.08 }), 70);
    setTimeout(() => beep({ freq: 880, dur: 0.07, type: "triangle", gain: 0.08 }), 150);
  }
  function sonarFx() {
    // deep pulse for heavy actions
    beep({ freq: 130, dur: 0.10, type: "sine", gain: 0.10 });
    setTimeout(() => beep({ freq: 90, dur: 0.14, type: "sine", gain: 0.08 }), 120);
    setTimeout(() => beep({ freq: 60, dur: 0.18, type: "sine", gain: 0.06 }), 260);
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

  function radarBlip(isError = false) {
    radarBlips.push({
      t: performance.now(),
      r: 0.18 + Math.random() * 0.28,
      a: Math.random() * Math.PI * 2,
      err: isError,
    });
    if (radarBlips.length > 18) radarBlips.shift();
    if (!isError) pingFx();
  }

  function drawRadar() {
    const c = el.radar;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.46;

    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, R * 1.15);
    grad.addColorStop(0, "rgba(245,196,77,0.10)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(245,196,77,0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

    radarAngle += 0.015;
    const a = radarAngle % (Math.PI * 2);
    const sx = cx + Math.cos(a) * R;
    const sy = cy + Math.sin(a) * R;

    const sweepGrad = ctx.createLinearGradient(cx, cy, sx, sy);
    sweepGrad.addColorStop(0, "rgba(245,196,77,0.00)");
    sweepGrad.addColorStop(1, "rgba(245,196,77,0.25)");
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();

    ctx.fillStyle = "rgba(245,196,77,0.05)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a - 0.35, a);
    ctx.closePath();
    ctx.fill();

    const now = performance.now();
    radarBlips = radarBlips.filter(b => now - b.t < 2200);
    for (const b of radarBlips) {
      const age = (now - b.t) / 2200;
      const alpha = Math.max(0, 1 - age);
      const rr = R * b.r;
      const x = cx + Math.cos(b.a) * rr;
      const y = cy + Math.sin(b.a) * rr;
      ctx.fillStyle = b.err ? `rgba(255,77,77,${0.55 * alpha})` : `rgba(245,196,77,${0.55 * alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = b.err ? `rgba(255,77,77,${0.35 * alpha})` : `rgba(245,196,77,${0.35 * alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    requestAnimationFrame(drawRadar);
  }

  /***********************
   * WALLET / NETWORK
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) throw new Error("MetaMask not detected.");
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
    lastExplorerBase = activeCfg().explorer;
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

    radarBlip();
    setStatus(`NODE LINKED: ${userAddress}`);

    await syncChainFromWallet();
    await initContracts();
    await refreshTelemetry();
    updateGuards();
  }

  function activeContractForTab() {
    const cfg = activeCfg();
    if (activeTab === "split-token") return cfg.tokenSplitter;
    if (activeTab === "split-native") return cfg.nativeSplitter;
    if (activeTab === "vault-token") return cfg.tokenVault;
    if (activeTab === "vault-native") return cfg.nativeVault;
    if (activeTab === "my-vaults") return "Vault Log Scanner";
    return "—";
  }

  async function initContracts() {
    const cfg = activeCfg();
    tokenSplitter = new ethers.Contract(cfg.tokenSplitter, TOKEN_SPLITTER_ABI, signer || provider);
    nativeSplitter = new ethers.Contract(cfg.nativeSplitter, NATIVE_SPLITTER_ABI, signer || provider);
    tokenVault = new ethers.Contract(cfg.tokenVault, TOKEN_VAULT_ABI, signer || provider);
    nativeVault = new ethers.Contract(cfg.nativeVault, NATIVE_VAULT_ABI, signer || provider);

    try {
      feeBps = Number(await tokenSplitter.feeBps());
      feeWallet = await tokenSplitter.feeWallet();
    } catch {
      feeBps = 100;
      feeWallet = null;
    }

    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    el.st_feeTiny.textContent = `${feePct}%`;
    el.teleFee.textContent = `${feePct}% → ${feeWallet ? shortAddr(feeWallet) : shortAddr(GLOBAL_FEE_WALLET)}`;
    el.feeWalletInline.textContent = shortAddr(GLOBAL_FEE_WALLET);

    // tap-to-copy fee wallet
    el.feeWalletInline.title = GLOBAL_FEE_WALLET;
    el.feeWalletInline.onclick = () => copyToClipboard(GLOBAL_FEE_WALLET);

    const full = activeContractForTab();
    el.teleActive.textContent = full;
    el.teleActive.title = full;
    el.teleActive.onclick = () => copyToClipboard(full);

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

    const full = activeContractForTab();
    el.teleActive.textContent = full;
    el.teleActive.title = full;
    el.teleActive.onclick = () => copyToClipboard(full);

    if (!userAddress) {
      el.teleNative.textContent = "—";
      return;
    }

    try {
      const b = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(b)} ${cfg.nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch { el.teleTokenBal.textContent = "—"; }

      let spender;
      if (activeTab === "vault-token") spender = cfg.tokenVault;
      else spender = cfg.tokenSplitter;

      try {
        const al = await token.allowance(userAddress, spender);
        el.teleAllowance.textContent = `${ethers.utils.formatUnits(al, tokenDecimals)} ${tokenSymbol}`;
      } catch { el.teleAllowance.textContent = "—"; }
    }

    updateSplitTokenEstimate();
    updateGuards();
  }

  /***********************
   * RECIPIENTS UI
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
    radarBlip();
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
   * TOKEN SPLIT
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

    try {
      const allow = await token.allowance(userAddress, cfg.tokenSplitter);
      if (allow.lt(amountWei)) return setError(`Allowance too low. Approve at least ${amt} ${tokenSymbol} first.`);
    } catch {}

    try {
      el.st_execute.disabled = true;
      setStatus("EXECUTE TOKEN SPLIT…");
      sonarFx();
      coinBeat(vr.accounts.length);

      await tokenSplitter.callStatic.depositAndDistribute(checksum(taddr), vr.accounts, vr.shares, amountWei);

      const tx = await tokenSplitter.depositAndDistribute(checksum(taddr), vr.accounts, vr.shares, amountWei);
      log(`Execute tx: ${tx.hash}`);
      await tx.wait();

      setStatus("TOKEN SPLIT COMPLETE ✅");
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
    el.st_postFee.textContent = `Post-fee ~ ${afterFee.toFixed(6).replace(/0+$/,"").replace(/\.$/,"")} ${tokenSymbol}`;
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

    const amt = (el.sn_amount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid native amount.");

    const vr = validateRecipients(rowsSN);
    if (!vr.ok) return setError(vr.msg);

    const valueWei = ethers.utils.parseEther(amt);

    try {
      el.sn_execute.disabled = true;
      setStatus("EXECUTE NATIVE SPLIT…");
      sonarFx();
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
   * TOKEN VAULT
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

    try {
      const allow = await token.allowance(userAddress, cfg.tokenVault);
      if (allow.lt(amountWei)) return setError(`Allowance too low. Approve vault for ${amt} ${tokenSymbol} first.`);
    } catch {}

    try {
      el.vt_create.disabled = true;
      setStatus("CREATING TOKEN VAULT…");
      sonarFx();

      const tx = await tokenVault.createVault(checksum(taddr), amountWei, vr.accounts, vr.shares, period, safe);
      log(`Create vault tx: ${tx.hash}`);

      const receipt = await tx.wait();
      let createdId = null;
      for (const ev of (receipt.events || [])) {
        if (ev.event === "VaultCreated" && ev.args && ev.args.vaultId != null) {
          createdId = ev.args.vaultId.toString();
          break;
        }
      }

      if (createdId != null) {
        el.vt_vaultId.value = createdId;
        setStatus(`TOKEN VAULT CREATED ✅ (Vault #${createdId})`);
        await vtLoad();
      } else {
        setStatus("TOKEN VAULT CREATED ✅ (Enter Vault ID then LOAD)");
      }

      await refreshTelemetry();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Create vault failed.";
      setError(msg);
    } finally {
      el.vt_create.disabled = false;
      updateGuards();
    }
  }

  function stopVTTimer() { if (timerIntervalVT) clearInterval(timerIntervalVT); timerIntervalVT = null; }

  async function vtLoad() {
    setError("");
    if (!provider) return setError("LINK NODE first.");
    const id = clampInt(el.vt_vaultId.value || "0", 0, 10_000_000);
    try {
      const v = await tokenVault.getVault(id);
      startTokenVaultTimer(id, v.heartbeat, v.inactivityPeriod, v.executed, v.frozen);
      setStatus(`TOKEN VAULT LOADED: #${id}`);
    } catch (e) {
      setError(e?.message || "Failed to load vault.");
    }
  }

  function startTokenVaultTimer(vaultId, heartbeat, inactivity, executed, frozen) {
    stopVTTimer();
    const paint = () => {
      const hb = Number(heartbeat);
      const per = Number(inactivity);
      const unlockAt = hb + per;
      const now = nowSec();
      const remaining = unlockAt - now;
      const unlocked = remaining <= 0;

      const header = `Vault #${vaultId} • TOKEN • ${frozen ? "FROZEN" : "ACTIVE"} • ${executed ? "EXECUTED" : (unlocked ? "UNLOCKED" : "LOCKED")}`;
      const line1 = `Last heartbeat: ${fmtLocalTimeFromUnix(hb)} (unix ${hb})`;
      const line2 = `Unlock time: ${fmtLocalTimeFromUnix(unlockAt)} (unix ${unlockAt})`;
      const line3 = executed ? `Status: executed` : (unlocked ? `Unlocked: YES` : `Countdown: ${fmtCountdown(remaining)}`);

      el.vt_timerBox.textContent = `${header}\n${line1}\n${line2}\n${line3}`;
    };
    paint();
    timerIntervalVT = setInterval(paint, 1000);
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
      setStatus("EXECUTING TOKEN VAULT…");
      sonarFx();
      const tx = await tokenVault.executeInheritance(id);
      log(`ExecuteInheritance tx: ${tx.hash}`);
      await tx.wait();
      setStatus("INHERITANCE EXECUTED ✅");
      await vtLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Execute failed.");
    }
  }

  /***********************
   * NATIVE VAULT
   ***********************/
  function stopVNTimer() { if (timerIntervalVN) clearInterval(timerIntervalVN); timerIntervalVN = null; }

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
      sonarFx();

      const tx = await nativeVault.createVault(checksum(execRaw), period, checksum(safeRaw));
      log(`Create native vault tx: ${tx.hash}`);
      const receipt = await tx.wait();

      let createdId = null;
      for (const ev of (receipt.events || [])) {
        if (ev.event === "VaultCreated" && ev.args && ev.args.vaultId != null) {
          createdId = ev.args.vaultId.toString();
          break;
        }
      }

      if (createdId != null) {
        el.vn_vaultId.value = createdId;
        setStatus(`NATIVE VAULT CREATED ✅ (Vault #${createdId})`);
        await vnLoad();
      } else {
        setStatus("NATIVE VAULT CREATED ✅ (Enter Vault ID then LOAD)");
      }
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Create failed.");
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
      startNativeVaultTimer(id, v.heartbeat, v.inactivityPeriod, v.executed, v.frozen, v.executor, v.balance);
      setStatus(`NATIVE VAULT LOADED: #${id}`);
    } catch (e) {
      setError(e?.message || "Failed to load native vault.");
    }
  }

  function startNativeVaultTimer(vaultId, heartbeat, inactivity, executed, frozen, executorAddr, balanceWei) {
    stopVNTimer();
    const paint = () => {
      const hb = Number(heartbeat);
      const per = Number(inactivity);
      const unlockAt = hb + per;
      const now = nowSec();
      const remaining = unlockAt - now;
      const unlocked = remaining <= 0;

      const header = `Vault #${vaultId} • NATIVE • ${frozen ? "FROZEN" : "ACTIVE"} • ${executed ? "EXECUTED" : (unlocked ? "UNLOCKED" : "LOCKED")}`;
      const line1 = `Last heartbeat: ${fmtLocalTimeFromUnix(hb)} (unix ${hb})`;
      const line2 = `Unlock time: ${fmtLocalTimeFromUnix(unlockAt)} (unix ${unlockAt})`;
      const line3 = executed ? `Status: executed` : (unlocked ? `Unlocked: YES` : `Countdown: ${fmtCountdown(remaining)}`);
      const line4 = `Executor: ${shortAddr(executorAddr)}`;
      const line5 = `Balance: ${ethers.utils.formatEther(balanceWei || 0)} ${activeCfg().nativeSymbol}`;

      el.vn_timerBox.textContent = `${header}\n${line1}\n${line2}\n${line3}\n${line4}\n${line5}`;
    };
    paint();
    timerIntervalVN = setInterval(paint, 1000);
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
      sonarFx();

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
      setStatus("EMERGENCY MOVE…");
      sonarFx();
      const tx = await nativeVault.emergencyMoveToSafe(id);
      log(`Emergency tx: ${tx.hash}`);
      await tx.wait();
      setStatus("EMERGENCY MOVE COMPLETE ✅");
      await vnLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Emergency failed.");
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
      sonarFx();
      coinBeat(vr.accounts.length);

      const tx = await nativeVault.execute(id, vr.accounts, vr.shares);
      log(`Execute vault tx: ${tx.hash}`);
      await tx.wait();

      setStatus("NATIVE VAULT EXECUTED ✅");
      await vnLoad();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.error?.message || e?.data?.message || e?.reason || e?.message || "Execute failed.");
    } finally {
      el.vn_execute.disabled = false;
    }
  }

  /***********************
   * MY VAULTS (AUTO DISCOVERY)
   ***********************/
  function cacheKey(kind) {
    return `citadel_v2_${currentKey}_${userAddress || "0x0"}_${kind}`;
  }

  function renderVaultList(container, ids, kind) {
    container.innerHTML = "";
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "vaultCard";
      empty.innerHTML = `<div class="vaultMeta">No ${kind} vaults found in scan range.</div>`;
      container.appendChild(empty);
      return;
    }

    ids.forEach((id) => {
      const card = document.createElement("div");
      card.className = "vaultCard";

      const top = document.createElement("div");
      top.className = "vaultCardTop";
      top.innerHTML = `<h4>${kind.toUpperCase()} Vault #${id}</h4><span class="pill mini mono">${activeCfg().chainName}</span>`;

      const meta = document.createElement("div");
      meta.className = "vaultMeta";
      meta.textContent = "Tap LOAD to open timer/actions.";

      const actions = document.createElement("div");
      actions.className = "vaultActions";

      const btnLoad = document.createElement("button");
      btnLoad.className = "btn gold";
      btnLoad.textContent = "LOAD";
      btnLoad.onclick = async () => {
        if (kind === "token") {
          el.vt_vaultId.value = String(id);
          setTab("vault-token");
          await vtLoad();
        } else {
          el.vn_vaultId.value = String(id);
          setTab("vault-native");
          await vnLoad();
        }
        radarBlip();
      };

      actions.appendChild(btnLoad);
      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  async function scanVaults() {
    setError("");
    if (!provider || !userAddress) return setError("LINK NODE first.");

    const range = clampInt(el.mv_range.value || "200000", 1000, 5_000_000);

    try {
      el.mv_scan.disabled = true;
      setStatus(`SCANNING VAULT LOGS (last ${range} blocks)…`);
      sonarFx();

      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - range);

      const tokenIface = new ethers.utils.Interface(TOKEN_VAULT_ABI);
      const tokenTopic = tokenIface.getEventTopic("VaultCreated");

      const tokenLogs = await provider.getLogs({
        address: activeCfg().tokenVault,
        fromBlock,
        toBlock: latest,
        topics: [tokenTopic, ethers.utils.hexZeroPad(userAddress, 32)],
      });

      const tokenIds = [];
      for (const l of tokenLogs) {
        try {
          const p = tokenIface.parseLog(l);
          tokenIds.push(p.args.vaultId.toString());
        } catch {}
      }

      const nativeIface = new ethers.utils.Interface(NATIVE_VAULT_ABI);
      const nativeTopic = nativeIface.getEventTopic("VaultCreated");

      const nativeLogs = await provider.getLogs({
        address: activeCfg().nativeVault,
        fromBlock,
        toBlock: latest,
        topics: [nativeTopic, ethers.utils.hexZeroPad(userAddress, 32)],
      });

      const nativeIds = [];
      for (const l of nativeLogs) {
        try {
          const p = nativeIface.parseLog(l);
          nativeIds.push(p.args.vaultId.toString());
        } catch {}
      }

      const uniqSort = (arr) => Array.from(new Set(arr)).sort((a,b)=>Number(a)-Number(b));
      const tok = uniqSort(tokenIds);
      const nat = uniqSort(nativeIds);

      localStorage.setItem(cacheKey("tokenVaultIds"), JSON.stringify({ at: Date.now(), fromBlock, latest, ids: tok }));
      localStorage.setItem(cacheKey("nativeVaultIds"), JSON.stringify({ at: Date.now(), fromBlock, latest, ids: nat }));

      el.mv_tokenCount.textContent = `${tok.length} found`;
      el.mv_nativeCount.textContent = `${nat.length} found`;
      renderVaultList(el.mv_tokenList, tok, "token");
      renderVaultList(el.mv_nativeList, nat, "native");

      setStatus("SCAN COMPLETE ✅");
    } catch (e) {
      setError(e?.message || "Scan failed.");
    } finally {
      el.mv_scan.disabled = false;
    }
  }

  function loadCachedVaultsIfAny() {
    try {
      const tok = JSON.parse(localStorage.getItem(cacheKey("tokenVaultIds")) || "null");
      const nat = JSON.parse(localStorage.getItem(cacheKey("nativeVaultIds")) || "null");
      if (tok?.ids) {
        el.mv_tokenCount.textContent = `${tok.ids.length} cached`;
        renderVaultList(el.mv_tokenList, tok.ids, "token");
      } else {
        el.mv_tokenCount.textContent = "—";
        el.mv_tokenList.innerHTML = "";
      }
      if (nat?.ids) {
        el.mv_nativeCount.textContent = `${nat.ids.length} cached`;
        renderVaultList(el.mv_nativeList, nat.ids, "native");
      } else {
        el.mv_nativeCount.textContent = "—";
        el.mv_nativeList.innerHTML = "";
      }
    } catch {
      el.mv_tokenCount.textContent = "—";
      el.mv_nativeCount.textContent = "—";
    }
  }

  /***********************
   * TABS
   ***********************/
  function setTab(tabKey) {
    activeTab = tabKey;

    for (const k of Object.keys(el.panes)) {
      el.panes[k].style.display = (k === tabKey) ? "block" : "none";
    }
    el.tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabKey));

    const full = activeContractForTab();
    el.teleActive.textContent = full;
    el.teleActive.title = full;
    el.teleActive.onclick = () => copyToClipboard(full);

    if (tabKey === "split-token") { el.paneTitle.textContent = "TOKEN SPLIT"; }
    if (tabKey === "split-native") { el.paneTitle.textContent = "NATIVE SPLIT"; }
    if (tabKey === "vault-token") { el.paneTitle.textContent = "TOKEN VAULT"; }
    if (tabKey === "vault-native") { el.paneTitle.textContent = "NATIVE VAULT"; }
    if (tabKey === "my-vaults") { el.paneTitle.textContent = "MY VAULTS"; }

    setError("");
    setStatus(`TAB: ${tabKey.toUpperCase()}`);
    refreshTelemetry().catch(()=>{});
    if (tabKey === "my-vaults") loadCachedVaultsIfAny();
  }

  /***********************
   * GUARDS
   ***********************/
  function updateGuards() {
    const connected = !!signer && !!userAddress;

    el.btnSwitch.disabled = !provider;

    el.st_approve.disabled = !connected;
    el.st_execute.disabled = !connected;

    el.sn_execute.disabled = !connected;

    el.vt_approve.disabled = !connected;
    el.vt_create.disabled = !connected;
    el.vt_ping.disabled = !connected;
    el.vt_freeze.disabled = !connected;
    el.vt_unfreeze.disabled = !connected;
    el.vt_execute.disabled = !connected;

    el.vn_create.disabled = !connected;
    el.vn_deposit.disabled = !connected;
    el.vn_ping.disabled = !connected;
    el.vn_freeze.disabled = !connected;
    el.vn_unfreeze.disabled = !connected;
    el.vn_emergency.disabled = !connected;
    el.vn_execute.disabled = !connected;

    el.mv_scan.disabled = !connected;
  }

  /***********************
   * EXPLORER BUTTON
   ***********************/
  function openExplorer() {
    window.open(lastExplorerBase, "_blank", "noopener,noreferrer");
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    el.tabs.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);
    el.selChain.addEventListener("change", () => { if (provider) switchNetwork(); });

    el.btnRefresh.addEventListener("click", refreshTelemetry);
    el.btnClear.addEventListener("click", () => { el.log.textContent = ""; setError(""); setStatus("Log cleared."); });
    el.btnViewExplorer.addEventListener("click", openExplorer);

    el.st_token.addEventListener("input", async () => { const v=el.st_token.value.trim(); if (isAddr(v)) await loadToken(v); refreshTelemetry(); });
    el.vt_token.addEventListener("input", async () => { const v=el.vt_token.value.trim(); if (isAddr(v)) await loadToken(v); refreshTelemetry(); });

    el.st_amount.addEventListener("input", updateSplitTokenEstimate);

    renderRecipients(el.st_recipients, rowsST, el.st_vector, updateGuards);
    renderRecipients(el.sn_recipients, rowsSN, el.sn_vector, updateGuards);
    renderRecipients(el.vt_recipients, rowsVT, el.vt_vector, updateGuards);
    renderRecipients(el.vn_recipients, rowsVN, el.vn_vector, updateGuards);

    el.st_add.addEventListener("click", () => { rowsST.push({account:"",share:"10"}); renderRecipients(el.st_recipients, rowsST, el.st_vector, updateGuards); radarBlip(); });
    el.sn_add.addEventListener("click", () => { rowsSN.push({account:"",share:"10"}); renderRecipients(el.sn_recipients, rowsSN, el.sn_vector, updateGuards); radarBlip(); });
    el.vt_add.addEventListener("click", () => { rowsVT.push({account:"",share:"10"}); renderRecipients(el.vt_recipients, rowsVT, el.vt_vector, updateGuards); radarBlip(); });
    el.vn_add.addEventListener("click", () => { rowsVN.push({account:"",share:"10"}); renderRecipients(el.vn_recipients, rowsVN, el.vn_vector, updateGuards); radarBlip(); });

    el.st_normalize.addEventListener("click", () => normalizeModel(rowsST, el.st_recipients, el.st_vector, updateGuards));
    el.sn_normalize.addEventListener("click", () => normalizeModel(rowsSN, el.sn_recipients, el.sn_vector, updateGuards));
    el.vt_normalize.addEventListener("click", () => normalizeModel(rowsVT, el.vt_recipients, el.vt_vector, updateGuards));
    el.vn_normalize.addEventListener("click", () => normalizeModel(rowsVN, el.vn_recipients, el.vn_vector, updateGuards));

    el.st_approve.addEventListener("click", stApprove);
    el.st_execute.addEventListener("click", stExecute);

    el.sn_max.addEventListener("click", snMaxGasSafe);
    el.sn_execute.addEventListener("click", snExecute);

    el.vt_approve.addEventListener("click", vtApprove);
    el.vt_create.addEventListener("click", vtCreate);
    el.vt_load.addEventListener("click", vtLoad);
    el.vt_ping.addEventListener("click", vtPing);
    el.vt_freeze.addEventListener("click", vtFreeze);
    el.vt_unfreeze.addEventListener("click", vtUnfreeze);
    el.vt_execute.addEventListener("click", vtExecuteInheritance);

    el.vn_create.addEventListener("click", vnCreate);
    el.vn_load.addEventListener("click", vnLoad);
    el.vn_deposit.addEventListener("click", vnDeposit);
    el.vn_ping.addEventListener("click", vnPing);
    el.vn_freeze.addEventListener("click", vnFreeze);
    el.vn_unfreeze.addEventListener("click", vnUnfreeze);
    el.vn_emergency.addEventListener("click", vnEmergency);
    el.vn_execute.addEventListener("click", vnExecute);

    el.mv_scan.addEventListener("click", scanVaults);

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
          setStatus("NODE DISCONNECTED.");
          updateGuards();
          return;
        }
        userAddress = accs[0];
        el.pillWallet.textContent = `NODE: ${shortAddr(userAddress)}`;
        setStatus(`NODE CHANGED: ${userAddress}`);
        await refreshTelemetry();
        if (activeTab === "my-vaults") loadCachedVaultsIfAny();
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("THEATER CHANGED.");
          if (activeTab === "my-vaults") loadCachedVaultsIfAny();
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
      el.feeWalletInline.textContent = shortAddr(GLOBAL_FEE_WALLET);
      el.feeWalletInline.title = GLOBAL_FEE_WALLET;
      el.feeWalletInline.onclick = () => copyToClipboard(GLOBAL_FEE_WALLET);

      el.mv_range.value = "200000";

      bindEvents();
      setTab("split-token");
      updateGuards();
      setStatus("CITADEL v2 ONLINE. LINK NODE to begin.");
      radarBlip();

      drawRadar();

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
          updateGuards();
        } else {
          el.pillNet.textContent = `THEATER: ${activeCfg().chainName}`;
          el.sn_symbol.textContent = activeCfg().nativeSymbol;
          el.vn_symbol.textContent = activeCfg().nativeSymbol;
        }
      } else {
        setError("MetaMask not detected. Use MetaMask app browser (mobile) or install MetaMask (desktop).");
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
