/* global ethers */
(() => {
  "use strict";

  /***********************
   * CONFIG (YOUR VERIFIED ADDRESSES)
   ***********************/
  const CONTRACTS = {
    bsc: {
      chainId: 56,
      chainIdHex: "0x38",
      chainName: "BNB CHAIN",
      rpcUrls: ["https://bsc-dataseed.binance.org/"],
      nativeSymbol: "BNB",
      explorer: "https://bscscan.com",
      splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
    },
    eth: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "ETHEREUM",
      rpcUrls: ["https://cloudflare-eth.com"],
      nativeSymbol: "ETH",
      explorer: "https://etherscan.io",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "POLYGON",
      rpcUrls: ["https://polygon-rpc.com"],
      nativeSymbol: "MATIC",
      explorer: "https://polygonscan.com",
      splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
    },
  };

  /***********************
   * ABIs (MINIMAL)
   ***********************/
  const SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
  ];

  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  /***********************
   * DOM (hard fail if missing)
   ***********************/
  const $ = (id) => document.getElementById(id);

  const el = {
    pillNet: $("pillNet"),
    pillWallet: $("pillWallet"),
    btnToggleOps: $("btnToggleOps"),
    btnSwitch: $("btnSwitch"),
    btnConnect: $("btnConnect"),

    selChain: $("selChain"),
    selMode: $("selMode"),
    modeHint: $("modeHint"),

    tokenBlock: $("tokenBlock"),
    inpToken: $("inpToken"),
    inpAmount: $("inpAmount"),
    tokenNote: $("tokenNote"),

    usdEst: $("usdEst"),
    postFeeLine: $("postFeeLine"),
    gasHint: $("gasHint"),

    recipients: $("recipients"),
    totalPill: $("totalPill"),
    btnAdd: $("btnAdd"),
    btnNormalize: $("btnNormalize"),

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
    teleFee: $("teleFee"),
    teleStatus: $("teleStatus"),

    btnAddToken: $("btnAddToken"),
    btnViewTx: $("btnViewTx"),
    debrief: $("debrief"),

    btnRefresh: $("btnRefresh"),
    btnClear: $("btnClear"),
    log: $("log"),

    opsHint: $("opsHint"),

    modal: $("modal"),
    modalBody: $("modalBody"),
    btnModalClose: $("btnModalClose"),
    btnModalBack: $("btnModalBack"),
    btnModalConfirm: $("btnModalConfirm"),
    chkAcknowledge: $("chkAcknowledge"),
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
  let feeWallet = null;

  let lastTxHash = null;
  let lastExplorerLink = null;

  // UI: default simple mode
  let operatorMode = false;

  // recipients model
  let rows = [
    { account: "", share: "50" },
    { account: "", share: "50" },
  ];

  /***********************
   * HELPERS
   ***********************/
  function activeCfg() {
    return CONTRACTS[currentChainKey];
  }

  function shortAddr(a) {
    if (!a || a.length < 10) return a || "—";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function isAddr(a) {
    try { return ethers.utils.isAddress(a); } catch { return false; }
  }

  function checksum(a) {
    return ethers.utils.getAddress(a);
  }

  function toBN(n) {
    return ethers.BigNumber.from(String(n));
  }

  function clampInt(n, min, max) {
    n = Math.floor(Number(n));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /***********************
   * LOGGING
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

  function setDebrief(html) {
    el.debrief.style.display = html ? "block" : "none";
    el.debrief.innerHTML = html || "";
  }

  /***********************
   * SOUND FX (optional)
   ***********************/
  let audioCtx = null;

  function ensureAudio() {
    if (!el.chkSound?.checked) return null;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function beep({ freq = 880, dur = 0.07, type = "triangle", gain = 0.08 } = {}) {
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
    beep({ freq: 220, dur: 0.05 });
    setTimeout(() => beep({ freq: 440, dur: 0.06 }), 70);
    setTimeout(() => beep({ freq: 880, dur: 0.07 }), 150);
  }

  function coinBeat(count) {
    const n = clampInt(count, 1, 24);
    for (let i = 0; i < n; i++) {
      setTimeout(() => beep({ freq: 520 + i * 35, dur: 0.05, type: "square", gain: 0.05 }), i * 110);
    }
  }

  /***********************
   * RECIPIENTS UI
   ***********************/
  function renderRecipients() {
    el.recipients.innerHTML = "";

    rows.forEach((r, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "row";

      const inpA = document.createElement("input");
      inpA.placeholder = "0xTARGET…";
      inpA.spellcheck = false;
      inpA.value = r.account || "";
      inpA.addEventListener("input", () => {
        rows[idx].account = inpA.value.trim();
        updateTotals();
        updateActionGuards();
      });

      const inpS = document.createElement("input");
      inpS.placeholder = "50";
      inpS.inputMode = "numeric";
      inpS.value = r.share || "";
      inpS.addEventListener("input", () => {
        rows[idx].share = inpS.value.trim();
        updateTotals();
        updateActionGuards();
      });

      const btnX = document.createElement("button");
      btnX.className = "btn ghost";
      btnX.textContent = "×";
      btnX.addEventListener("click", () => {
        if (rows.length <= 2) return;
        rows.splice(idx, 1);
        renderRecipients();
      });

      wrap.appendChild(inpA);
      wrap.appendChild(inpS);
      wrap.appendChild(btnX);
      el.recipients.appendChild(wrap);
    });

    updateTotals();
    updateActionGuards();
  }

  function normalizeShares() {
    setError("");
    const nums = rows
      .map((r) => Number(r.share || 0))
      .map((n) => (Number.isFinite(n) ? n : 0));

    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum <= 0) return setError("Allocation Vector must be > 0.");

    let scaled = nums.map((n) => Math.floor((n / sum) * 100));
    let s2 = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += 100 - s2;

    rows = rows.map((r, i) => ({ ...r, share: String(Math.max(1, scaled[i])) }));
    renderRecipients();
  }

  function updateTotals() {
    const nums = rows
      .map((r) => Number(r.share || 0))
      .map((n) => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    el.totalPill.textContent = `VECTOR: ${sum || 0}`;
  }

  function validateRecipients() {
    const accounts = [];
    const shares = [];

    for (let i = 0; i < rows.length; i++) {
      const a = (rows[i].account || "").trim();
      const s = (rows[i].share || "").trim();

      if (!isAddr(a)) return { ok: false, msg: `Target #${i + 1} address invalid.` };

      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: `Target #${i + 1} vector must be > 0.` };

      accounts.push(checksum(a));
      shares.push(toBN(Math.floor(n)));
    }

    const lower = accounts.map((x) => x.toLowerCase());
    const set = new Set(lower);
    if (set.size !== accounts.length) return { ok: false, msg: "Duplicate targets detected." };
    if (set.size === 1) return { ok: false, msg: "All targets resolve to the same address." };

    return { ok: true, accounts, shares };
  }

  /***********************
   * WALLET / CHAIN
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      setError("No wallet detected. Install MetaMask and refresh.");
      throw new Error("No ethereum provider");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  function lockSupportedChainOrThrow(chainId) {
    if (![56, 1, 137].includes(chainId)) {
      throw new Error("Unsupported network. Switch to BNB Chain, Ethereum, or Polygon.");
    }
  }

  async function syncChainFromWallet() {
    const net = await provider.getNetwork();
    lockSupportedChainOrThrow(net.chainId);

    if (net.chainId === 56) currentChainKey = "bsc";
    else if (net.chainId === 1) currentChainKey = "eth";
    else if (net.chainId === 137) currentChainKey = "polygon";

    el.selChain.value = currentChainKey;
    el.pillNet.textContent = `THEATER: ${activeCfg().chainName} (chainId ${net.chainId})`;

    log(`NETWORK ✅ ${activeCfg().chainName} chainId=${net.chainId}`);
  }

  async function connectWallet() {
    setError("");
    await ensureProvider();

    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      signer = provider.getSigner();
      userAddress = await signer.getAddress();

      el.pillWallet.textContent = `NODE: ${shortAddr(userAddress)}`;
      el.btnConnect.textContent = "LINKED";
      el.btnConnect.classList.remove("gold");
      el.btnConnect.classList.add("connected");
      el.btnConnect.disabled = true;

      radarPing();

      // IMPORTANT: log line you asked for
      log(`WALLET CONNECTED ✅ ${userAddress}`);

      await syncChainFromWallet();
      await initContracts();
      await refreshTelemetry();
      updateActionGuards();

      setStatus("NODE LINKED ✅");
    } catch (e) {
      setError(e?.message || "Wallet connection failed.");
      throw e;
    }
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
      updateActionGuards();
      setStatus(`THEATER SWITCHED → ${cfg.chainName}`);
    } catch (err) {
      if (err?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: cfg.chainIdHex,
              chainName: cfg.chainName,
              nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
              rpcUrls: cfg.rpcUrls,
              blockExplorerUrls: [cfg.explorer],
            }],
          });
          currentChainKey = key;
          await initContracts();
          await refreshTelemetry();
          updateActionGuards();
          setStatus(`THEATER ADDED + SWITCHED → ${cfg.chainName}`);
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
    const cfg = activeCfg();

    splitter = new ethers.Contract(cfg.splitter, SPLITTER_ABI, signer || provider);
    el.teleSplitter.textContent = cfg.splitter;

    try { feeBps = Number(await splitter.feeBps()); } catch { feeBps = 100; }
    try { feeWallet = await splitter.feeWallet(); } catch { feeWallet = null; }

    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    document.querySelectorAll(".feeTiny").forEach((n) => (n.textContent = `${feePct}%`));
    el.teleFee.textContent = `${feePct}% → ${feeWallet ? shortAddr(feeWallet) : "feeWallet"}`;

    log(`SPLITTER READY ✅ ${cfg.splitter}`);
    setStatus(`SPLITTER ONLINE. feeBps=${feeBps}`);
  }

  /***********************
   * TOKEN + TELEMETRY
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
      updateActionGuards();
      return;
    }

    tokenAddr = checksum(address);

    // IMPORTANT HARDENING:
    // Always connect token contract to signer if available so approve NEVER "silently fails".
    const base = new ethers.Contract(tokenAddr, ERC20_ABI, signer || provider);
    token = signer ? base.connect(signer) : base;

    try { tokenSymbol = await token.symbol(); } catch { tokenSymbol = "TOKEN"; }
    try { tokenDecimals = Number(await token.decimals()); } catch { tokenDecimals = 18; }

    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);

    log(`TOKEN LOADED ✅ ${tokenSymbol} decimals=${tokenDecimals}`);
    setStatus(`ASSET LOADED: ${tokenSymbol}`);
    updateActionGuards();
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

    try {
      const bal = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${cfg.nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        el.teleTokenBal.textContent = "—";
      }

      try {
        const allow = await token.allowance(userAddress, cfg.splitter);
        el.teleAllowance.textContent = `${ethers.utils.formatUnits(allow, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        el.teleAllowance.textContent = "—";
      }
    }

    updateEstimate();
    updateActionGuards();
  }

  function updateEstimate() {
    const mode = el.selMode.value;
    const raw = (el.inpAmount.value || "").trim();
    const num = Number(raw);

    if (!raw || !Number.isFinite(num) || num <= 0) {
      el.usdEst.textContent = "—";
      el.postFeeLine.textContent = "Post-fee delivery —";
      return;
    }

    const afterFee = num * (1 - feeBps / 10000);
    el.usdEst.textContent = `~$${num.toFixed(2)}`;

    if (mode === "token") {
      el.postFeeLine.textContent =
        `Post-fee delivery ~ ${afterFee.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${tokenSymbol}`;
    } else {
      el.postFeeLine.textContent = "Native distribution: coming soon.";
    }
  }

  /***********************
   * OPERATOR CONSOLE
   ***********************/
  function setOperatorMode(on) {
    operatorMode = !!on;
    el.btnToggleOps.textContent = operatorMode ? "OPERATOR: ON" : "OPERATOR: OFF";
    el.opsHint.style.display = operatorMode ? "block" : "none";
    log(operatorMode ? "Operator console enabled." : "Operator console disabled.");
  }

  /***********************
   * MODE + GUARDS
   ***********************/
  function applyMode() {
    const mode = el.selMode.value;

    if (mode === "token") {
      el.tokenBlock.style.display = "block";
      el.modeHint.textContent = "Token mode: ARM CONTRACT → DEPLOY PAYLOAD. Fee is applied inside the splitter.";
      el.gasHint.textContent = "Token mode uses exact token amount.";
      el.btnApprove.style.display = "inline-block";
      el.btnExecute.style.display = "inline-block";
    } else {
      // Keep it selectable, but clearly disable actions (native contract not deployed yet)
      el.tokenBlock.style.display = "none";
      el.modeHint.textContent = "Native distribution is coming later (requires a native splitter contract).";
      el.gasHint.textContent = "Native mode is disabled in this build.";
      el.btnApprove.style.display = "none";
    }

    updateEstimate();
    updateActionGuards();
  }

  function updateActionGuards() {
    const connected = !!userAddress && !!signer;
    const mode = el.selMode.value;

    // Always allow editing recipients
    el.btnAdd.disabled = false;
    el.btnNormalize.disabled = rows.length < 2;

    if (!connected) {
      el.btnApprove.disabled = true;
      el.btnExecute.disabled = true;
      return;
    }

    if (mode !== "token") {
      el.btnExecute.disabled = true;
      return;
    }

    const tokenOk = isAddr((el.inpToken.value || "").trim());
    const amtOk = Number(el.inpAmount.value || 0) > 0;
    const recOk = validateRecipients().ok;

    el.btnApprove.disabled = !(tokenOk && amtOk && recOk);
    el.btnExecute.disabled = !(tokenOk && amtOk && recOk);
  }

  /***********************
   * MODAL
   ***********************/
  function openModal(html) {
    el.modalBody.innerHTML = html;
    el.chkAcknowledge.checked = false;
    el.modal.style.display = "block";
  }
  function closeModal() {
    el.modal.style.display = "none";
  }

  function buildModalSummary({ taddr, amt, accounts, shares }) {
    const cfg = activeCfg();
    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    const afterFee = Number(amt) * (1 - feeBps / 10000);

    const wSum = shares.reduce((a, b) => a + Number(b.toString()), 0);

    const lines = accounts.map((a, i) => {
      const w = Number(shares[i].toString());
      const est = wSum ? (afterFee * (w / wSum)) : 0;
      return `• ${shortAddr(a)} ← ~${est.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${tokenSymbol}`;
    }).join("<br/>");

    return `
<b>THEATER:</b> ${cfg.chainName}<br/>
<b>ASSET:</b> ${tokenSymbol} <span style="opacity:.65;">(${shortAddr(taddr)})</span><br/>
<b>PAYLOAD:</b> ${amt} ${tokenSymbol}<br/>
<b>FEE:</b> ${feePct}% → ${feeWallet ? shortAddr(feeWallet) : "feeWallet"}<br/>
<b>DELIVERY (post-fee):</b> ~${afterFee.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${tokenSymbol}<br/>
<div class="hr"></div>
<b>TARGET MATRIX:</b><br/>
${lines}<br/>
<div class="hr"></div>
<span style="opacity:.75;">Funds deliver on <b>${cfg.chainName}</b>. Recipients must view the same chain.</span>
`;
  }

  /***********************
   * APPROVE (FIXED)
   ***********************/
  async function approveToken() {
    setError("");

    if (!signer || !userAddress) return setError("LINK NODE first.");
    if (el.selMode.value !== "token") return setError("ARM CONTRACT is token-mode only.");

    const taddrRaw = (el.inpToken.value || "").trim();
    if (!isAddr(taddrRaw)) return setError("Enter a valid asset contract address.");

    await loadToken(taddrRaw);

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid payload amount.");

    const vr = validateRecipients();
    if (!vr.ok) return setError(vr.msg);

    const cfg = activeCfg();
    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.btnApprove.disabled = true;

      // Preflight: read current allowance
      const currentAllow = await token.allowance(userAddress, cfg.splitter);
      if (operatorMode) log(`Preflight allowance: ${ethers.utils.formatUnits(currentAllow, tokenDecimals)} ${tokenSymbol}`);

      setStatus(`ARMING ${tokenSymbol}…`);

      // If already enough, skip sending tx
      if (currentAllow.gte(amountWei)) {
        log(`Allowance already sufficient ✅`);
        setStatus("ARMED ✅ (already sufficient)");
        await refreshTelemetry();
        return;
      }

      // IMPORTANT: approve must be a signer-connected contract (we enforce in loadToken)
      const tx = await token.approve(cfg.splitter, amountWei);
      log(`ARM tx: ${tx.hash}`);
      setStatus("AWAITING CONFIRMATION…");
      await tx.wait();

      setStatus("ARMED ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.message || "ARM failed.";
      setError(msg);
    } finally {
      el.btnApprove.disabled = false;
      updateActionGuards();
    }
  }

  /***********************
   * EXECUTE
   ***********************/
  async function executeSplit() {
    setError("");

    if (!signer || !userAddress) return setError("LINK NODE first.");
    if (el.selMode.value !== "token") return setError("Native distribution is coming later.");

    const cfg = activeCfg();
    const taddrRaw = (el.inpToken.value || "").trim();
    if (!isAddr(taddrRaw)) return setError("Enter a valid asset contract address.");

    await loadToken(taddrRaw);

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid payload amount.");

    const vr = validateRecipients();
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    // Allowance preflight
    try {
      const allow = await token.allowance(userAddress, cfg.splitter);
      if (allow.lt(amountWei)) return setError(`Allowance too low. ARM at least ${amt} ${tokenSymbol} first.`);
    } catch {
      // ignore
    }

    // Confirm modal
    openModal(buildModalSummary({
      taddr: checksum(taddrRaw),
      amt,
      accounts: vr.accounts,
      shares: vr.shares,
    }));

    el.btnModalConfirm.onclick = async () => {
      if (!el.chkAcknowledge.checked) return setError("Acknowledge chain-locked delivery to proceed.");
      setError("");
      closeModal();

      try {
        el.btnExecute.disabled = true;

        coinBeat(vr.accounts.length);
        setStatus("DEPLOYING…");

        if (operatorMode) log("Static preflight call…");
        await splitter.callStatic.depositAndDistribute(
          checksum(taddrRaw),
          vr.accounts,
          vr.shares,
          amountWei
        );

        const tx = await splitter.depositAndDistribute(
          checksum(taddrRaw),
          vr.accounts,
          vr.shares,
          amountWei
        );

        lastTxHash = tx.hash;
        lastExplorerLink = `${cfg.explorer}/tx/${tx.hash}`;

        log(`DEPLOY tx: ${tx.hash}`);
        setStatus("AWAITING CONFIRMATION…");

        await tx.wait();

        setStatus("DEPLOYMENT SUCCESS ✅");

        setDebrief(
          `<b>DEPLOYMENT SUCCESSFUL</b><br/>
           <span style="opacity:.75;">THEATER:</span> ${cfg.chainName}<br/>
           <span style="opacity:.75;">ASSET:</span> ${tokenSymbol} <span style="opacity:.6;">(${shortAddr(tokenAddr)})</span><br/>
           <span style="opacity:.75;">TX:</span> <a href="${lastExplorerLink}" target="_blank" rel="noreferrer">View on Explorer</a><br/>
           <span style="opacity:.75;">Tip:</span> Recipients must view <b>${cfg.chainName}</b> network to see the token.`
        );

        await refreshTelemetry();
      } catch (e) {
        const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "DEPLOY failed.";
        setError(msg);
      } finally {
        el.btnExecute.disabled = false;
        updateActionGuards();
      }
    };
  }

  /***********************
   * Add token to wallet + View tx
   ***********************/
  async function addTokenToWallet() {
    setError("");
    if (!window.ethereum) return setError("No wallet provider.");
    if (!tokenAddr || !tokenSymbol) return setError("Load an asset first.");

    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddr,
            symbol: (tokenSymbol || "TOKEN").slice(0, 11),
            decimals: tokenDecimals,
          },
        },
      });
      setStatus("Token prompt sent to wallet ✅");
    } catch (e) {
      setError(e?.message || "Token add request failed.");
    }
  }

  function viewLastTx() {
    setError("");
    if (!lastExplorerLink) return setError("No recent deployment found.");
    window.open(lastExplorerLink, "_blank", "noopener,noreferrer");
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);

    el.btnToggleOps.addEventListener("click", () => setOperatorMode(!operatorMode));

    el.selChain.addEventListener("change", () => {
      if (provider) switchNetwork();
    });

    el.selMode.addEventListener("change", applyMode);

    el.inpToken.addEventListener("input", async () => {
      const v = (el.inpToken.value || "").trim();
      if (isAddr(v)) await loadToken(v);
      await refreshTelemetry();
    });

    el.inpAmount.addEventListener("input", () => {
      updateEstimate();
      updateActionGuards();
    });

    el.btnNormalize.addEventListener("click", normalizeShares);

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "10" });
      renderRecipients();
    });

    el.btnApprove.addEventListener("click", approveToken);
    el.btnExecute.addEventListener("click", executeSplit);

    el.btnAddToken.addEventListener("click", addTokenToWallet);
    el.btnViewTx.addEventListener("click", viewLastTx);

    el.btnRefresh.addEventListener("click", refreshTelemetry);
    el.btnClear.addEventListener("click", () => {
      el.log.textContent = "";
      setError("");
      setDebrief("");
      setStatus("Log cleared.");
    });

    el.btnModalClose.addEventListener("click", closeModal);
    el.btnModalBack.addEventListener("click", closeModal);
    el.modal.addEventListener("click", (e) => {
      if (e.target === el.modal) closeModal();
    });

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        setError("");
        if (!accs || !accs.length) {
          userAddress = null;
          signer = null;

          el.pillWallet.textContent = "NODE: DISCONNECTED";
          el.btnConnect.textContent = "LINK NODE";
          el.btnConnect.classList.remove("connected");
          el.btnConnect.classList.add("gold");
          el.btnConnect.disabled = false;

          token = null; tokenAddr = null;

          setDebrief("");
          log("WALLET DISCONNECTED.");
          setStatus("NODE DISCONNECTED.");
          updateActionGuards();
          return;
        }

        userAddress = accs[0];
        el.pillWallet.textContent = `NODE: ${shortAddr(userAddress)}`;

        // IMPORTANT: log line
        log(`WALLET CHANGED ✅ ${userAddress}`);

        await refreshTelemetry();
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("THEATER CHANGED ✅");
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
      renderRecipients();
      applyMode();
      setOperatorMode(false); // default simple mode

      el.pillNet.textContent = `THEATER: ${activeCfg().chainName}`;
      el.teleSplitter.textContent = activeCfg().splitter;

      bindEvents();

      setStatus("CITADEL ONLINE. LINK NODE to begin.");

      // Silent connect if already authorized
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

          // IMPORTANT: log line you asked for
          log(`AUTO-LINKED ✅ ${userAddress}`);

          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();

          setStatus("AUTO-LINKED ✅");
        }
      }

      updateActionGuards();
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
