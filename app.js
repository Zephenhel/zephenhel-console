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
   * ABIs
   ***********************/
  const SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
    "function feeWallet() view returns (address)",
    "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount) external",
    "event Deposited(address indexed sender, address indexed token, uint256 amount, uint256 fee)",
    "event Distributed(address indexed token, uint256 amountAfterFee, address[] accounts, uint256[] shares)",
  ];

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
    // topbar
    pillNet: $("pillNet"),
    pillWallet: $("pillWallet"),
    btnUIMode: $("btnUIMode"),
    btnSwitch: $("btnSwitch"),
    btnConnect: $("btnConnect"),

    // main
    selChain: $("selChain"),
    inpToken: $("inpToken"),
    inpAmount: $("inpAmount"),
    usdEst: $("usdEst"),
    postFeeLine: $("postFeeLine"),
    tokenSafetyLine: $("tokenSafetyLine"),
    gasHint: $("gasHint"),

    recipients: $("recipients"),
    totalPill: $("totalPill"),
    btnAdd: $("btnAdd"),
    btnNormalize: $("btnNormalize"),
    btnSavePreset: $("btnSavePreset"),
    btnLoadPreset: $("btnLoadPreset"),

    previewBody: $("previewBody"),

    btnApprove: $("btnApprove"),
    btnExecute: $("btnExecute"),

    tipBox: $("tipBox"),
    errBox: $("errBox"),

    // operator console
    operatorPanel: $("operatorPanel"),
    chkSound: $("chkSound"),
    teleNative: $("teleNative"),
    teleSymbol: $("teleSymbol"),
    teleDecimals: $("teleDecimals"),
    teleTokenBal: $("teleTokenBal"),
    teleAllowance: $("teleAllowance"),
    teleSplitter: $("teleSplitter"),
    teleFeeWallet: $("teleFeeWallet"),
    teleStatus: $("teleStatus"),
    btnRefresh: $("btnRefresh"),
    btnClear: $("btnClear"),
    log: $("log"),

    // confirm modal
    confirmModal: $("confirmModal"),
    confirmBody: $("confirmBody"),
    btnCancelModal: $("btnCancelModal"),
    btnConfirmModal: $("btnConfirmModal"),
  };

  /***********************
   * UI MODE (Simple default)
   ***********************/
  const UI_MODE_KEY = "zeph_ui_mode"; // "simple" | "operator"
  let uiMode = "simple";

  function loadUiMode() {
    const saved = localStorage.getItem(UI_MODE_KEY);
    uiMode = saved === "operator" ? "operator" : "simple";
    applyUiMode();
  }

  function applyUiMode() {
    document.body.classList.toggle("mode-simple", uiMode === "simple");
    document.body.classList.toggle("mode-operator", uiMode === "operator");
    if (el.btnUIMode) {
      el.btnUIMode.textContent = uiMode === "operator" ? "Operator Console: ON" : "Operator Console: OFF";
    }
    // In simple mode, keep status minimal (no noisy logs unless error)
    if (uiMode === "simple") {
      // optional: collapse panel if exists
      if (el.operatorPanel) el.operatorPanel.style.display = "none";
    } else {
      if (el.operatorPanel) el.operatorPanel.style.display = "block";
    }
  }

  function toggleUiMode() {
    uiMode = uiMode === "simple" ? "operator" : "simple";
    localStorage.setItem(UI_MODE_KEY, uiMode);
    applyUiMode();
    setStatus(uiMode === "operator" ? "Operator Console enabled." : "Simple Mode enabled.");
  }

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
  let feeWallet = "—";

  let rows = [
    { account: "", share: "50" },
    { account: "", share: "50" },
  ];

  let pendingTxBuild = null;

  /***********************
   * HELPERS
   ***********************/
  function log(line) {
    // In simple mode, we still keep internal log buffer for debugging if user flips modes
    const ts = new Date().toLocaleTimeString();
    if (el.log) el.log.textContent = `[${ts}] ${line}\n` + el.log.textContent;
  }

  function setError(msg) {
    el.errBox.style.display = msg ? "block" : "none";
    el.errBox.textContent = msg || "";
    if (msg) log(`ERROR: ${msg}`);
    if (msg) beep({ freq: 140, dur: 0.08, type: "sawtooth", gain: 0.10 });
  }

  function setStatus(msg) {
    if (el.teleStatus) el.teleStatus.textContent = msg;
    // In simple mode, avoid spamming log; but keep key events.
    if (uiMode === "operator") log(msg);
  }

  function shortAddr(a) {
    if (!a || a.length < 10) return a || "—";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function isAddr(a) {
    try { return ethers.utils.isAddress(a); } catch { return false; }
  }

  function checksum(a) {
    try { return ethers.utils.getAddress(a); } catch { return a; }
  }

  function clampInt(n, min, max) {
    n = Math.floor(Number(n));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function cfg() {
    return CONTRACTS[currentChainKey];
  }

  function explorerBase() {
    return cfg().explorer;
  }

  function linkAddr(a) {
    return `${explorerBase()}/address/${a}`;
  }

  function linkTx(h) {
    return `${explorerBase()}/tx/${h}`;
  }

  function formatUnitsSafe(bn, dec) {
    try { return ethers.utils.formatUnits(bn, dec); } catch { return "0"; }
  }

  function parseAmountUnits(text, dec) {
    return ethers.utils.parseUnits(text, dec);
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

  function beep({ freq = 880, dur = 0.06, type = "sine", gain = 0.10 } = {}) {
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
    beep({ freq: 220, dur: 0.05, type: "triangle", gain: 0.09 });
    setTimeout(() => beep({ freq: 440, dur: 0.06, type: "triangle", gain: 0.09 }), 70);
    setTimeout(() => beep({ freq: 880, dur: 0.07, type: "triangle", gain: 0.09 }), 150);
  }

  function coinBeat(count) {
    const n = clampInt(count, 1, 24);
    for (let i = 0; i < n; i++) {
      setTimeout(() => beep({ freq: 520 + i * 25, dur: 0.03, type: "square", gain: 0.05 }), i * 90);
    }
  }

  /***********************
   * RECIPIENTS
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
        updatePreview();
      });

      const inpS = document.createElement("input");
      inpS.placeholder = "50";
      inpS.inputMode = "numeric";
      inpS.value = r.share || "";
      inpS.addEventListener("input", () => {
        rows[idx].share = inpS.value.trim();
        updateTotals();
        updatePreview();
      });

      const btnX = document.createElement("button");
      btnX.className = "btn ghost";
      btnX.textContent = "×";
      btnX.style.padding = "10px 0";
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
    updatePreview();
  }

  function normalizeShares() {
    const nums = rows.map((r) => Number(r.share || 0)).map((n) => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum <= 0) return setError("Shares must be > 0.");

    let scaled = nums.map((n) => Math.floor((n / sum) * 100));
    let s2 = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += 100 - s2;

    rows = rows.map((r, i) => ({ ...r, share: String(Math.max(1, scaled[i])) }));
    setError("");
    renderRecipients();
    setStatus("Shares normalized to 100.");
  }

  function updateTotals() {
    const nums = rows.map((r) => Number(r.share || 0)).map((n) => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    el.totalPill.textContent = `Total: ${sum ? sum : 0}`;
  }

  function buildRecipients() {
    const warnings = [];
    const accounts = [];
    const shares = [];

    const map = new Map();
    for (let i = 0; i < rows.length; i++) {
      const aRaw = (rows[i].account || "").trim();
      const sRaw = (rows[i].share || "").trim();

      if (!isAddr(aRaw)) return { ok: false, msg: `Recipient #${i + 1} address invalid.` };
      const a = checksum(aRaw);
      if (a === ethers.constants.AddressZero) return { ok: false, msg: `Recipient #${i + 1} is zero address.` };

      const n = Number(sRaw);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: `Recipient #${i + 1} share must be > 0.` };

      const weight = Math.floor(n);
      if (userAddress && a.toLowerCase() === userAddress.toLowerCase()) warnings.push(`Recipient #${i + 1} is YOUR wallet.`);

      const key = a.toLowerCase();
      map.set(key, (map.get(key) || 0) + weight);
    }

    for (const [key, w] of map.entries()) {
      accounts.push(checksum(key));
      shares.push(ethers.BigNumber.from(w));
    }

    if (accounts.length < 2) warnings.push("Only one unique recipient after merging duplicates.");

    return { ok: true, accounts, shares, warnings };
  }

  /***********************
   * WALLET + CHAIN
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask, then refresh.");
      throw new Error("No provider");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  async function syncChainFromWallet() {
    const net = await provider.getNetwork();
    const chainId = net.chainId;

    if (chainId === 56) currentChainKey = "bsc";
    else if (chainId === 1) currentChainKey = "eth";
    else if (chainId === 137) currentChainKey = "polygon";

    el.selChain.value = currentChainKey;
    el.pillNet.textContent = `Network: ${cfg().chainName} (chainId ${chainId})`;
  }

  async function connectWallet() {
    setError("");
    await ensureProvider();

    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      signer = provider.getSigner();
      userAddress = await signer.getAddress();

      el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
      el.btnConnect.textContent = "CONNECTED";
      el.btnConnect.classList.remove("gold");
      el.btnConnect.classList.add("connected");
      el.btnConnect.disabled = true;

      radarPing();
      setStatus("Connected ✅");

      await syncChainFromWallet();
      await initContracts();
      await refreshTelemetry();
      await updatePreview();
    } catch (e) {
      setError(e?.message || "Wallet connection failed.");
      throw e;
    }
  }

  async function switchNetwork() {
    setError("");
    await ensureProvider();

    const key = el.selChain.value;
    const c = CONTRACTS[key];

    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: c.chainIdHex }] });
      currentChainKey = key;
      await initContracts();
      await refreshTelemetry();
      await updatePreview();
      setStatus(`Switched to ${c.chainName}.`);
    } catch (err) {
      if (err?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: c.chainIdHex,
              chainName: c.chainName,
              nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
              rpcUrls: c.rpcUrls,
              blockExplorerUrls: [c.explorer],
            }],
          });
          currentChainKey = key;
          await initContracts();
          await refreshTelemetry();
          await updatePreview();
          setStatus(`Added + switched to ${c.chainName}.`);
          return;
        } catch (e2) {
          return setError(e2?.message || "Failed to add chain.");
        }
      }
      setError(err?.message || "Network switch failed.");
    }
  }

  async function initContracts() {
    if (!provider) return;

    splitter = new ethers.Contract(cfg().splitter, SPLITTER_ABI, signer || provider);
    el.teleSplitter.textContent = cfg().splitter;

    try { feeBps = Number(await splitter.feeBps()); } catch { feeBps = 100; }
    try { feeWallet = await splitter.feeWallet(); } catch { feeWallet = "—"; }

    el.teleFeeWallet.textContent = feeWallet && feeWallet !== "—" ? shortAddr(feeWallet) : "—";

    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    document.querySelectorAll(".feeTiny").forEach((n) => (n.textContent = `${feePct}%`));

    setStatus("Splitter online.");
  }

  /***********************
   * TOKEN
   ***********************/
  async function tokenCodeCheck(addr) {
    try {
      const code = await provider.getCode(addr);
      return code && code !== "0x";
    } catch {
      return false;
    }
  }

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
      el.tokenSafetyLine.textContent = "Paste token address on the selected chain.";
      return;
    }

    tokenAddr = checksum(address);

    const isContract = await tokenCodeCheck(tokenAddr);
    if (!isContract) {
      el.tokenSafetyLine.textContent = "WARNING: No contract code at this address on this chain.";
      throw new Error("Token address is not a contract on this chain.");
    }

    token = new ethers.Contract(tokenAddr, ERC20_ABI, signer || provider);

    try { tokenSymbol = await token.symbol(); } catch { tokenSymbol = "TOKEN"; }
    try { tokenDecimals = Number(await token.decimals()); } catch { tokenDecimals = 18; }

    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);
    el.tokenSafetyLine.textContent = `Verified token ✅ ${tokenSymbol} (${tokenDecimals} decimals)`;

    setStatus("Token loaded.");
  }

  /***********************
   * TELEMETRY (operator-only panel, but functions still work)
   ***********************/
  async function refreshTelemetry() {
    if (!provider) return;

    const net = await provider.getNetwork();
    el.pillNet.textContent = `Network: ${cfg().chainName} (chainId ${net.chainId})`;

    if (!userAddress) return;

    try {
      const bal = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${cfg().nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        el.teleTokenBal.textContent = `${formatUnitsSafe(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        el.teleTokenBal.textContent = "—";
      }

      try {
        const allow = await token.allowance(userAddress, cfg().splitter);
        el.teleAllowance.textContent = `${formatUnitsSafe(allow, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        el.teleAllowance.textContent = "—";
      }
    }

    updateEstimate();
  }

  function updateEstimate() {
    const raw = (el.inpAmount.value || "").trim();
    const num = Number(raw);
    if (!raw || !Number.isFinite(num) || num <= 0) {
      el.usdEst.textContent = "—";
      el.postFeeLine.textContent = "Post-fee output: —";
      return;
    }
    const afterFee = num * (1 - feeBps / 10000);
    el.usdEst.textContent = `$${num.toFixed(2)}`;
    el.postFeeLine.textContent = `Post-fee output: ~${afterFee.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${tokenSymbol}`;
  }

  /***********************
   * PREVIEW
   ***********************/
  async function updatePreview() {
    try {
      const rawAmt = (el.inpAmount.value || "").trim();
      const num = Number(rawAmt);

      if (!rawAmt || !Number.isFinite(num) || num <= 0 || !tokenSymbol || tokenSymbol === "—") {
        el.previewBody.innerHTML = `<tr><td colspan="5" class="mutedCell">Enter token + amount to preview.</td></tr>`;
        return;
      }

      const built = buildRecipients();
      if (!built.ok) {
        el.previewBody.innerHTML = `<tr><td colspan="5" class="mutedCell">${built.msg}</td></tr>`;
        return;
      }

      const totalShares = built.shares.reduce((a, b) => a.add(b), ethers.BigNumber.from(0));
      if (totalShares.isZero()) {
        el.previewBody.innerHTML = `<tr><td colspan="5" class="mutedCell">Shares total is zero.</td></tr>`;
        return;
      }

      const amountWei = parseAmountUnits(rawAmt, tokenDecimals);
      const feeWei = amountWei.mul(feeBps).div(10000);
      const afterWei = amountWei.sub(feeWei);

      const rowsOut = [];
      let remaining = afterWei;

      for (let i = 0; i < built.accounts.length; i++) {
        let part = ethers.BigNumber.from(0);
        if (i < built.accounts.length - 1) {
          part = afterWei.mul(built.shares[i]).div(totalShares);
          remaining = remaining.sub(part);
        } else {
          part = remaining;
        }
        rowsOut.push({ i, addr: built.accounts[i], share: built.shares[i], amount: part });
      }

      el.previewBody.innerHTML = "";
      rowsOut.forEach((r) => {
        const tr = document.createElement("tr");

        const td1 = document.createElement("td");
        td1.textContent = String(r.i + 1);

        const td2 = document.createElement("td");
        td2.className = "mono";
        td2.textContent = shortAddr(r.addr);

        const td3 = document.createElement("td");
        td3.textContent = r.share.toString();

        const td4 = document.createElement("td");
        td4.textContent = `${formatUnitsSafe(r.amount, tokenDecimals)} ${tokenSymbol}`;

        const td5 = document.createElement("td");
        const a = document.createElement("a");
        a.href = linkAddr(r.addr);
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = "View";
        td5.appendChild(a);

        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tr.appendChild(td5);

        el.previewBody.appendChild(tr);
      });

      // Warnings only loud in operator mode
      if (built.warnings.length && uiMode === "operator") {
        log(`WARN: ${built.warnings.join(" | ")}`);
      }
    } catch (e) {
      el.previewBody.innerHTML = `<tr><td colspan="5" class="mutedCell">Preview error: ${e?.message || "—"}</td></tr>`;
    }
  }

  /***********************
   * MODAL
   ***********************/
  function openConfirmModal(html) {
    el.confirmBody.innerHTML = html;
    el.confirmModal.style.display = "flex";
  }

  function closeConfirmModal() {
    el.confirmModal.style.display = "none";
    el.confirmBody.innerHTML = "";
    pendingTxBuild = null;
  }

  /***********************
   * APPROVE
   ***********************/
  async function approveToken() {
    setError("");
    if (!signer || !userAddress) return setError("Connect wallet first.");

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    try { await loadToken(taddr); }
    catch (e) { return setError(e?.message || "Token load failed."); }

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const amountWei = parseAmountUnits(amt, tokenDecimals);

    try {
      el.btnApprove.disabled = true;

      const bal = await token.balanceOf(userAddress);
      if (bal.lt(amountWei)) {
        return setError(`Insufficient ${tokenSymbol}. Balance: ${formatUnitsSafe(bal, tokenDecimals)}.`);
      }

      setStatus("Approving…");
      const tx = await token.approve(cfg().splitter, amountWei);
      if (uiMode === "operator") log(`Approve tx: ${tx.hash} (${linkTx(tx.hash)})`);
      await tx.wait();

      setStatus("Approve confirmed ✅");
      await refreshTelemetry();
      await updatePreview();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Approve failed.");
    } finally {
      el.btnApprove.disabled = false;
    }
  }

  /***********************
   * EXECUTE (preflight + confirm + receipt decode)
   ***********************/
  async function simulate(taddr, accounts, shares, amountWei) {
    try {
      await splitter.callStatic.depositAndDistribute(taddr, accounts, shares, amountWei);
      return { ok: true };
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Simulation failed.";
      return { ok: false, msg };
    }
  }

  async function executeSplit() {
    setError("");
    if (!signer || !userAddress) return setError("Connect wallet first.");

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    try { await loadToken(taddr); }
    catch (e) { return setError(e?.message || "Token load failed."); }

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const built = buildRecipients();
    if (!built.ok) return setError(built.msg);

    const amountWei = parseAmountUnits(amt, tokenDecimals);

    // allowance + balance hard check
    try {
      const [allow, bal] = await Promise.all([
        token.allowance(userAddress, cfg().splitter),
        token.balanceOf(userAddress),
      ]);
      if (bal.lt(amountWei)) return setError(`Insufficient ${tokenSymbol}. Balance: ${formatUnitsSafe(bal, tokenDecimals)}.`);
      if (allow.lt(amountWei)) return setError(`Allowance too low. Approve at least ${amt} ${tokenSymbol}.`);
    } catch {
      // sim will catch
    }

    setStatus("Preflight…");
    const simRes = await simulate(tokenAddr, built.accounts, built.shares, amountWei);
    if (!simRes.ok) return setError(`Preflight failed: ${simRes.msg}`);

    // build confirm modal
    const feeWei = amountWei.mul(feeBps).div(10000);
    const afterWei = amountWei.sub(feeWei);
    const totalShares = built.shares.reduce((a, b) => a.add(b), ethers.BigNumber.from(0));
    let remaining = afterWei;

    const lines = built.accounts.map((a, i) => {
      let part;
      if (i < built.accounts.length - 1) {
        part = afterWei.mul(built.shares[i]).div(totalShares);
        remaining = remaining.sub(part);
      } else {
        part = remaining;
      }
      return `
        <div class="confirmLine">
          <div class="mono">${shortAddr(a)}</div>
          <div>${formatUnitsSafe(part, tokenDecimals)} ${tokenSymbol}</div>
          <a href="${linkAddr(a)}" target="_blank" rel="noreferrer">explorer</a>
        </div>`;
    }).join("");

    const warnHtml = built.warnings.length
      ? `<div class="warnBox">${built.warnings.map((w) => `<div>• ${w}</div>`).join("")}</div>`
      : "";

    const html = `
      <div class="confirmBlock">
        <div><b>Chain:</b> ${cfg().chainName}</div>
        <div><b>Token:</b> ${tokenSymbol} <span class="mono">${shortAddr(tokenAddr)}</span>
          <a href="${linkAddr(tokenAddr)}" target="_blank" rel="noreferrer">explorer</a>
        </div>
        <div><b>Amount in:</b> ${amt} ${tokenSymbol}</div>
        <div><b>Fee:</b> ${formatUnitsSafe(feeWei, tokenDecimals)} ${tokenSymbol} (${(feeBps/100).toFixed(2)}%) → <span class="mono">${shortAddr(feeWallet)}</span></div>
        <div><b>Amount out:</b> ${formatUnitsSafe(afterWei, tokenDecimals)} ${tokenSymbol}</div>
      </div>
      ${warnHtml}
      <div class="confirmHeader">Recipients</div>
      <div class="confirmList">${lines}</div>
      <div class="small">Important: recipient wallets must support the selected chain.</div>
    `;

    pendingTxBuild = { taddr: tokenAddr, accounts: built.accounts, shares: built.shares, amountWei };
    openConfirmModal(html);
  }

  async function sendConfirmedTx() {
    if (!pendingTxBuild) return;

    const { taddr, accounts, shares, amountWei } = pendingTxBuild;

    try {
      el.btnConfirmModal.disabled = true;
      el.btnExecute.disabled = true;

      coinBeat(accounts.length);
      setStatus("Broadcasting…");

      const tx = await splitter.depositAndDistribute(taddr, accounts, shares, amountWei);
      if (uiMode === "operator") log(`Execute tx: ${tx.hash} (${linkTx(tx.hash)})`);
      setStatus("Confirming…");

      const receipt = await tx.wait();

      // decode event (operator proof)
      if (uiMode === "operator") {
        const iface = new ethers.utils.Interface(SPLITTER_ABI);
        for (const lg of receipt.logs) {
          try {
            const parsed = iface.parseLog(lg);
            if (parsed?.name === "Distributed") {
              log(`✅ Distributed decoded: token=${parsed.args.token} amountAfterFee=${formatUnitsSafe(parsed.args.amountAfterFee, tokenDecimals)} ${tokenSymbol}`);
              (parsed.args.accounts || []).forEach((a, i) => log(` - ${a} | weight=${(parsed.args.shares?.[i] || 0).toString()}`));
            }
          } catch { /* ignore */ }
        }
      }

      closeConfirmModal();
      setStatus("Split executed ✅");
      await refreshTelemetry();
      await updatePreview();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Execute failed.";
      setError(msg);
    } finally {
      el.btnConfirmModal.disabled = false;
      el.btnExecute.disabled = false;
    }
  }

  /***********************
   * PRESETS
   ***********************/
  function presetKey() {
    return `zeph_citadel_preset_${currentChainKey}`;
  }

  function savePreset() {
    const data = { chain: currentChainKey, token: (el.inpToken.value || "").trim(), rows };
    localStorage.setItem(presetKey(), JSON.stringify(data));
    setStatus("Preset saved ✅");
  }

  function loadPreset() {
    const raw = localStorage.getItem(presetKey());
    if (!raw) return setError("No preset saved for this chain yet.");
    try {
      const data = JSON.parse(raw);
      rows = Array.isArray(data.rows) && data.rows.length ? data.rows : rows;
      el.inpToken.value = data.token || "";
      renderRecipients();
      setStatus("Preset loaded ✅");
      setError("");
    } catch {
      setError("Preset corrupted.");
    }
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    el.btnUIMode?.addEventListener("click", toggleUiMode);

    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);

    el.selChain.addEventListener("change", () => {
      if (provider) switchNetwork();
      else currentChainKey = el.selChain.value;
    });

    el.inpToken.addEventListener("input", async () => {
      const v = (el.inpToken.value || "").trim();
      if (!isAddr(v)) {
        token = null; tokenSymbol = "—"; tokenAddr = null; tokenDecimals = 18;
        el.teleSymbol.textContent = "—";
        el.teleDecimals.textContent = "—";
        el.teleTokenBal.textContent = "—";
        el.teleAllowance.textContent = "—";
        el.tokenSafetyLine.textContent = "Paste token address on the selected chain.";
        updateEstimate();
        updatePreview();
        return;
      }
      try {
        await loadToken(v);
        await refreshTelemetry();
        await updatePreview();
      } catch (e) {
        setError(e?.message || "Token load failed.");
      }
    });

    el.inpAmount.addEventListener("input", async () => {
      updateEstimate();
      await updatePreview();
    });

    el.btnNormalize.addEventListener("click", normalizeShares);
    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "10" });
      renderRecipients();
    });

    el.btnSavePreset.addEventListener("click", savePreset);
    el.btnLoadPreset.addEventListener("click", loadPreset);

    el.btnApprove.addEventListener("click", approveToken);
    el.btnExecute.addEventListener("click", executeSplit);

    el.btnRefresh?.addEventListener("click", refreshTelemetry);
    el.btnClear?.addEventListener("click", () => { if (el.log) el.log.textContent = ""; setError(""); setStatus("Log cleared."); });

    el.btnCancelModal.addEventListener("click", closeConfirmModal);
    el.btnConfirmModal.addEventListener("click", sendConfirmedTx);

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        setError("");
        if (!accs || !accs.length) {
          userAddress = null; signer = null;
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
        setStatus("Account changed.");
        await refreshTelemetry();
        await updatePreview();
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          await updatePreview();
          setStatus("Chain changed.");
        } catch { /* ignore */ }
      });
    }
  }

  /***********************
   * BOOT
   ***********************/
  async function boot() {
    try {
      loadUiMode(); // ✅ simple by default
      renderRecipients();

      currentChainKey = el.selChain.value || "bsc";
      el.pillNet.textContent = `Network: ${cfg().chainName}`;
      el.teleSplitter.textContent = cfg().splitter;

      bindEvents();
      setStatus("Ready. Connect wallet to begin.");

      // silent connect
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
          await updatePreview();

          setStatus("Auto-connected ✅");
        }
      }
    } catch (e) {
      setError(e?.message || "Boot error.");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
