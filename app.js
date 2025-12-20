/* global ethers */
(() => {
  "use strict";

  const CONTRACTS = {
    bsc: {
      chainId: 56,
      chainIdHex: "0x38",
      chainName: "BNB Chain",
      nativeSymbol: "BNB",
      splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
    },
    eth: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "Ethereum",
      nativeSymbol: "ETH",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "Polygon",
      nativeSymbol: "MATIC",
      splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
    },
  };

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

  const $ = (id) => document.getElementById(id);

  const el = {
    pillNet: $("pillNet"),
    pillWallet: $("pillWallet"),
    btnSwitch: $("btnSwitch"),
    btnConnect: $("btnConnect"),
    btnOps: $("btnOps"),
    opsPanel: $("opsPanel"),

    selChain: $("selChain"),
    inpToken: $("inpToken"),
    inpAmount: $("inpAmount"),

    chkApproveMax: $("chkApproveMax"),

    recipients: $("recipients"),
    totalPill: $("totalPill"),
    btnAdd: $("btnAdd"),
    btnApprove: $("btnApprove"),
    btnExecute: $("btnExecute"),

    errBox: $("errBox"),

    feeLabel: $("feeLabel"),

    teleNative: $("teleNative"),
    teleSymbol: $("teleSymbol"),
    teleDecimals: $("teleDecimals"),
    teleTokenBal: $("teleTokenBal"),
    teleAllowance: $("teleAllowance"),
    teleSplitter: $("teleSplitter"),
    teleFeeBps: $("teleFeeBps"),
    teleFeeWallet: $("teleFeeWallet"),
    teleStatus: $("teleStatus"),

    log: $("log"),
    btnClearLog: $("btnClearLog"),
    btnRefresh: $("btnRefresh"),
  };

  // Required DOM guard (prevents null crashes)
  const REQUIRED = Object.keys(el).filter((k) => el[k] === null);
  if (REQUIRED.length) {
    document.body.innerHTML = `
      <div style="padding:16px;font-family:system-ui;background:#111;color:#fff">
        <h2 style="margin:0 0 10px 0;color:#ffcc66">DOM ERROR — Missing IDs</h2>
        <pre style="background:#1a1a1a;padding:12px;border-radius:10px;border:1px solid #333;white-space:pre-wrap">${REQUIRED.join("\n")}</pre>
      </div>
    `;
    throw new Error("Missing DOM IDs: " + REQUIRED.join(", "));
  }

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
    { account: "", weight: "" },
    { account: "", weight: "" },
  ];

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
    try { return ethers.utils.isAddress(a); } catch { return false; }
  }

  function setOpsEnabled(on) {
    el.opsPanel.style.display = on ? "block" : "none";
    el.btnOps.textContent = on ? "Operator Console: ON" : "Operator Console: OFF";
    localStorage.setItem("zeph_ops", on ? "1" : "0");
    log(on ? "Operator console enabled." : "Operator console disabled.");
  }

  function getOpsEnabled() {
    return localStorage.getItem("zeph_ops") === "1";
  }

  function updateTotalWeight() {
    const total = rows
      .map((r) => Number(r.weight || 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reduce((a, b) => a + b, 0);

    el.totalPill.textContent = `Total weight: ${total || 0}`;
  }

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
        updateTotalWeight();
      });

      const inpW = document.createElement("input");
      inpW.placeholder = "Weight (e.g. 50)";
      inpW.inputMode = "numeric";
      inpW.value = r.weight || "";
      inpW.addEventListener("input", () => {
        rows[idx].weight = inpW.value.trim();
        updateTotalWeight();
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
      wrap.appendChild(inpW);
      wrap.appendChild(btnX);
      el.recipients.appendChild(wrap);
    });

    updateTotalWeight();
  }

  function validateRecipients() {
    const accounts = [];
    const weights = [];

    for (let i = 0; i < rows.length; i++) {
      const a = (rows[i].account || "").trim();
      const w = (rows[i].weight || "").trim();

      if (!isAddr(a)) return { ok: false, msg: `Recipient #${i + 1} address is invalid.` };

      const n = Number(w);
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, msg: `Recipient #${i + 1} weight must be > 0.` };
      }

      accounts.push(a);
      weights.push(ethers.BigNumber.from(String(Math.floor(n))));
    }

    return { ok: true, accounts, weights };
  }

  async function ensureProvider() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask extension, then refresh.");
      throw new Error("No ethereum provider");
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
    el.pillNet.textContent = `Network: ${CONTRACTS[currentChainKey].chainName} (chainId ${chainId})`;
    log(`NETWORK ✅ ${CONTRACTS[currentChainKey].chainName} chainId=${chainId}`);
  }

  function setConnectedUI() {
    el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
    el.btnConnect.textContent = "CONNECTED";
    el.btnConnect.classList.remove("gold");
    el.btnConnect.classList.add("connected");
    el.btnConnect.disabled = true;
    log(`WALLET CONNECTED ✅ ${userAddress}`);
  }

  function setDisconnectedUI() {
    el.pillWallet.textContent = "Wallet: Disconnected";
    el.btnConnect.textContent = "Connect";
    el.btnConnect.classList.remove("connected");
    el.btnConnect.classList.add("gold");
    el.btnConnect.disabled = false;
    log("WALLET DISCONNECTED ❌");
  }

  async function initContracts() {
    const cfg = CONTRACTS[currentChainKey];
    splitter = new ethers.Contract(cfg.splitter, SPLITTER_ABI, signer || provider);

    el.teleSplitter.textContent = cfg.splitter;
    log(`SPLITTER READY ✅ ${cfg.splitter}`);

    try {
      feeBps = Number(await splitter.feeBps());
      feeWallet = await splitter.feeWallet();
    } catch {
      feeBps = 100;
      feeWallet = "—";
    }

    el.teleFeeBps.textContent = String(feeBps);
    el.teleFeeWallet.textContent = shortAddr(feeWallet);

    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    el.feeLabel.textContent = `${feePct}%`;

    setStatus(`Splitter online. feeBps=${feeBps}`);
  }

  async function connectWallet() {
    setError("");
    await ensureProvider();

    try {
      log("CONNECT: requesting accounts…");
      await window.ethereum.request({ method: "eth_requestAccounts" });

      signer = provider.getSigner();
      userAddress = await signer.getAddress();

      setConnectedUI();
      await syncChainFromWallet();
      await initContracts();
      await refreshTelemetry();
      setStatus("Ready.");
    } catch (e) {
      setError(e?.message || "Wallet connection failed.");
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
      await syncChainFromWallet();
      await initContracts();
      await refreshTelemetry();
    } catch (e) {
      setError(e?.message || "Network switch failed.");
    }
  }

  async function loadToken(addr) {
    if (!isAddr(addr)) {
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

    tokenAddr = addr;
    token = new ethers.Contract(tokenAddr, ERC20_ABI, signer || provider);

    try { tokenSymbol = await token.symbol(); } catch { tokenSymbol = "TOKEN"; }
    try { tokenDecimals = Number(await token.decimals()); } catch { tokenDecimals = 18; }

    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);

    log(`TOKEN LOADED ✅ ${tokenSymbol} decimals=${tokenDecimals}`);
  }

  async function refreshTelemetry() {
    if (!provider) return;

    const cfg = CONTRACTS[currentChainKey];

    if (userAddress) {
      try {
        const bal = await provider.getBalance(userAddress);
        el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${cfg.nativeSymbol}`;
      } catch {
        el.teleNative.textContent = "—";
      }
    } else {
      el.teleNative.textContent = "—";
    }

    const addr = (el.inpToken.value || "").trim();
    if (isAddr(addr)) {
      await loadToken(addr);
      if (token && userAddress) {
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
    }
  }

  async function approveToken() {
    setError("");
    if (!signer || !userAddress) return setError("Connect wallet first.");

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    await loadToken(taddr);

    const cfg = CONTRACTS[currentChainKey];

    // Approve amount: either exact amount OR max uint256
    const approveMax = !!el.chkApproveMax.checked;
    const amountWei = approveMax
      ? ethers.constants.MaxUint256
      : ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.btnApprove.disabled = true;
      el.btnExecute.disabled = true;

      setStatus(approveMax ? `Approving MAX ${tokenSymbol}…` : `Approving ${amt} ${tokenSymbol}…`);

      // IMPORTANT: ensure token uses signer
      const tx = await token.connect(signer).approve(cfg.splitter, amountWei);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();

      // Verify allowance now
      const allow = await token.allowance(userAddress, cfg.splitter);
      log(`Allowance now: ${ethers.utils.formatUnits(allow, tokenDecimals)} ${tokenSymbol}`);

      setStatus("Approve confirmed ✅");
      await refreshTelemetry();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Approve failed.");
    } finally {
      el.btnApprove.disabled = false;
      el.btnExecute.disabled = false;
    }
  }

  async function executeSplit() {
    setError("");
    if (!signer || !userAddress) return setError("Connect wallet first.");

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    const vr = validateRecipients();
    if (!vr.ok) return setError(vr.msg);

    await loadToken(taddr);

    const cfg = CONTRACTS[currentChainKey];
    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    // Hard pre-check allowance
    try {
      const allow = await token.allowance(userAddress, cfg.splitter);
      if (allow.lt(amountWei)) {
        return setError(`Allowance too low. Click Approve (or enable Approve Max) then retry.`);
      }
    } catch {}

    try {
      el.btnExecute.disabled = true;
      setStatus("Executing split…");

      log(`EXECUTE: token=${tokenSymbol} amount=${amt} recipients=${vr.accounts.length}`);

      const tx = await splitter.connect(signer).depositAndDistribute(
        taddr,
        vr.accounts,
        vr.weights,
        amountWei
      );

      log(`Execute tx: ${tx.hash}`);
      await tx.wait();

      setStatus("Split executed ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Execute failed.";
      setError(msg);
    } finally {
      el.btnExecute.disabled = false;
    }
  }

  function bindEvents() {
    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);

    el.btnOps.addEventListener("click", () => setOpsEnabled(!getOpsEnabled()));

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", weight: "" });
      renderRecipients();
    });

    el.btnApprove.addEventListener("click", approveToken);
    el.btnExecute.addEventListener("click", executeSplit);

    el.inpToken.addEventListener("input", () => refreshTelemetry());
    el.selChain.addEventListener("change", () => {
      if (provider) switchNetwork();
    });

    el.btnClearLog.addEventListener("click", () => {
      el.log.textContent = "";
      log("Log cleared.");
      setError("");
    });

    el.btnRefresh.addEventListener("click", refreshTelemetry);

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        setError("");
        if (!accs || !accs.length) {
          userAddress = null;
          signer = null;
          setDisconnectedUI();
          setStatus("Disconnected.");
          return;
        }
        userAddress = accs[0];
        signer = provider ? provider.getSigner() : null;
        setConnectedUI();
        await refreshTelemetry();
        setStatus("Account changed.");
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initContracts();
          await refreshTelemetry();
          setStatus("Chain changed.");
        } catch {}
      });
    }
  }

  async function boot() {
    // 1) UI setup
    setOpsEnabled(getOpsEnabled());
    renderRecipients();
    bindEvents();

    // 2) Initial labels
    const key = el.selChain.value || "bsc";
    currentChainKey = CONTRACTS[key] ? key : "bsc";
    el.pillNet.textContent = `Network: ${CONTRACTS[currentChainKey].chainName}`;
    el.teleSplitter.textContent = CONTRACTS[currentChainKey].splitter;

    // 3) Silent connect
    if (window.ethereum) {
      await ensureProvider();
      const accs = await window.ethereum.request({ method: "eth_accounts" });
      if (accs && accs.length) {
        signer = provider.getSigner();
        userAddress = accs[0];

        setConnectedUI();
        await syncChainFromWallet();
        await initContracts();
        await refreshTelemetry();
        setStatus("Auto-connected ✅");
        return; // IMPORTANT: do not log "connect wallet to begin" after this
      }
    }

    // Only show this if NOT connected
    setStatus("Ready. Connect wallet to begin.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
