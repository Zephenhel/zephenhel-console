/* global ethers */
(() => {
  "use strict";

  /***********************
   * CONFIG (YOUR DEPLOYED ADDRESSES)
   ***********************/
  const CONTRACTS = {
    bsc: {
      chainId: 56,
      chainIdHex: "0x38",
      chainName: "BNB Chain",
      nativeSymbol: "BNB",
      explorer: "https://bscscan.com",
      splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
    },
    eth: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "Ethereum",
      nativeSymbol: "ETH",
      explorer: "https://etherscan.io",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "Polygon",
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
   * DOM SAFE GETTER (prevents null errors)
   ***********************/
  const $ = (id) => document.getElementById(id);

  const el = {
    pillNet: $("pillNet"),
    pillWallet: $("pillWallet"),
    btnSwitch: $("btnSwitch"),
    btnConnect: $("btnConnect"),

    selChain: $("selChain"),
    inpToken: $("inpToken"),
    inpAmount: $("inpAmount"),

    chkOperator: $("chkOperator"),
    operatorPanel: $("operatorPanel"),

    chkApproveMax: $("chkApproveMax"),

    recipients: $("recipients"),
    totalPill: $("totalPill"),
    btnAdd: $("btnAdd"),

    btnApprove: $("btnApprove"),
    btnExecute: $("btnExecute"),

    errBox: $("errBox"),

    teleNative: $("teleNative"),
    teleSymbol: $("teleSymbol"),
    teleDecimals: $("teleDecimals"),
    teleTokenBal: $("teleTokenBal"),
    teleAllowance: $("teleAllowance"),
    teleSplitter: $("teleSplitter"),
    teleStatus: $("teleStatus"),

    btnRefresh: $("btnRefresh"),
    btnClear: $("btnClear"),
    log: $("log"),
  };

  function must(elm, name) {
    if (!elm) throw new Error(`Missing DOM element: ${name}`);
    return elm;
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

  // recipients model
  let rows = [
    { account: "", share: "50" },
    { account: "", share: "50" },
  ];

  /***********************
   * LOG + UI
   ***********************/
  function log(line) {
    if (!el.log) return; // operator console may be off
    const ts = new Date().toLocaleTimeString();
    el.log.textContent = `[${ts}] ${line}\n` + el.log.textContent;
  }

  function setError(msg) {
    if (!el.errBox) return;
    el.errBox.style.display = msg ? "block" : "none";
    el.errBox.textContent = msg || "";
    if (msg) log(`ERROR: ${msg}`);
  }

  function setStatus(msg) {
    if (el.teleStatus) el.teleStatus.textContent = msg;
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

  function toBN(n) {
    return ethers.BigNumber.from(String(n));
  }

  function activeCfg() {
    return CONTRACTS[currentChainKey];
  }

  function setConnectedUI() {
    const addr = userAddress || "—";
    el.pillWallet.textContent = `Wallet: ${shortAddr(addr)}`;
    el.btnConnect.textContent = `CONNECTED (${shortAddr(addr)})`;
    el.btnConnect.classList.remove("gold");
    el.btnConnect.classList.add("connected");
    el.btnConnect.disabled = true;
    log(`WALLET CONNECTED ✅ ${addr}`);
  }

  function setDisconnectedUI() {
    el.pillWallet.textContent = "Wallet: Disconnected";
    el.btnConnect.textContent = "Connect";
    el.btnConnect.classList.remove("connected");
    el.btnConnect.classList.add("gold");
    el.btnConnect.disabled = false;
  }

  function setNetworkUI(chainId) {
    const cfg = activeCfg();
    el.pillNet.textContent = `Network: ${cfg.chainName} chainId=${chainId}`;
    if (el.teleSplitter) el.teleSplitter.textContent = cfg.splitter;
    log(`NETWORK ✅ ${cfg.chainName} chainId=${chainId}`);
  }

  /***********************
   * RECIPIENTS UI
   ***********************/
  function updateTotals() {
    const nums = rows.map(r => Number(r.share || 0)).map(n => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    if (el.totalPill) el.totalPill.textContent = `Total weight: ${sum || 0}`;
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

  function validateRecipients() {
    const accounts = [];
    const shares = [];

    for (let i = 0; i < rows.length; i++) {
      const a = (rows[i].account || "").trim();
      const s = (rows[i].share || "").trim();

      if (!isAddr(a)) return { ok: false, msg: `Recipient #${i + 1} address invalid.` };

      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: `Recipient #${i + 1} weight must be > 0.` };

      accounts.push(a);
      shares.push(toBN(Math.floor(n)));
    }

    return { ok: true, accounts, shares };
  }

  /***********************
   * WALLET / NETWORK
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask extension and refresh.");
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

    if (el.selChain) el.selChain.value = currentChainKey;
    setNetworkUI(chainId);
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
      // chain not added
      if (err?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: cfg.chainIdHex,
              chainName: cfg.chainName,
              nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
              rpcUrls: cfg.rpcUrls ? cfg.rpcUrls : [],
              blockExplorerUrls: [cfg.explorer],
            }],
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

  async function connectWallet() {
    setError("");
    await ensureProvider();

    try {
      log("CONNECT: requesting accounts…");
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accs || !accs.length) return setError("No accounts returned from MetaMask.");

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

  /***********************
   * CONTRACTS + TOKEN
   ***********************/
  async function initContracts() {
    if (!provider) return;

    const cfg = activeCfg();
    splitter = new ethers.Contract(cfg.splitter, SPLITTER_ABI, signer || provider);

    try {
      feeBps = await splitter.feeBps();
      feeBps = Number(feeBps);
    } catch {
      feeBps = 100;
    }

    const feePct = (feeBps / 100).toFixed(2).replace(/\.00$/, "");
    document.querySelectorAll(".feeTiny").forEach(n => (n.textContent = `${feePct}%`));

    log(`SPLITTER READY ✅ ${cfg.splitter}`);
    log(`Splitter online. feeBps=${feeBps}`);
  }

  async function loadToken(address) {
    if (!isAddr(address)) {
      token = null;
      tokenAddr = null;
      tokenDecimals = 18;
      tokenSymbol = "—";
      if (el.teleSymbol) el.teleSymbol.textContent = "—";
      if (el.teleDecimals) el.teleDecimals.textContent = "—";
      if (el.teleTokenBal) el.teleTokenBal.textContent = "—";
      if (el.teleAllowance) el.teleAllowance.textContent = "—";
      return;
    }

    tokenAddr = address;
    token = new ethers.Contract(tokenAddr, ERC20_ABI, signer || provider);

    try { tokenSymbol = await token.symbol(); } catch { tokenSymbol = "TOKEN"; }
    try { tokenDecimals = Number(await token.decimals()); } catch { tokenDecimals = 18; }

    if (el.teleSymbol) el.teleSymbol.textContent = tokenSymbol;
    if (el.teleDecimals) el.teleDecimals.textContent = String(tokenDecimals);

    log(`TOKEN LOADED ✅ ${tokenSymbol} decimals=${tokenDecimals}`);
  }

  async function refreshTelemetry() {
    if (!provider) return;

    const net = await provider.getNetwork();
    setNetworkUI(net.chainId);

    if (!userAddress) return;

    const cfg = activeCfg();

    try {
      const bal = await provider.getBalance(userAddress);
      if (el.teleNative) el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${cfg.nativeSymbol}`;
    } catch {
      if (el.teleNative) el.teleNative.textContent = "—";
    }

    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        if (el.teleTokenBal) el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        if (el.teleTokenBal) el.teleTokenBal.textContent = "—";
      }

      try {
        const allow = await token.allowance(userAddress, cfg.splitter);
        if (el.teleAllowance) el.teleAllowance.textContent = `${ethers.utils.formatUnits(allow, tokenDecimals)} ${tokenSymbol}`;
      } catch {
        if (el.teleAllowance) el.teleAllowance.textContent = "—";
      }
    }
  }

  /***********************
   * SAFE APPROVE (fixes common approve failures)
   ***********************/
  async function approveToken() {
    setError("");

    if (!window.ethereum) return setError("MetaMask not detected.");
    if (!provider) await ensureProvider();

    signer = provider.getSigner();

    try {
      userAddress = await signer.getAddress();
    } catch {
      return setError("Wallet is locked. Open MetaMask and unlock, then retry.");
    }

    const cfg = activeCfg();
    const net = await provider.getNetwork();
    if (net.chainId !== cfg.chainId) {
      return setError(`Wrong network. Switch to ${cfg.chainName} then approve.`);
    }

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    await loadToken(taddr);
    if (!token) return setError("Token contract could not be loaded.");

    const spender = cfg.splitter;
    const approveMax = !!el.chkApproveMax?.checked;

    const desired = approveMax
      ? ethers.constants.MaxUint256
      : ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.btnApprove.disabled = true;
      el.btnExecute.disabled = true;

      const current = await token.allowance(userAddress, spender);
      log(`Allowance before: ${ethers.utils.formatUnits(current, tokenDecimals)} ${tokenSymbol}`);

      // Safe reset for tokens that require 0 first
      if (!approveMax && current.gt(0) && desired.gt(0)) {
        setStatus("Preflight: resetting allowance to 0 (safe approve)...");
        const tx0 = await token.connect(signer).approve(spender, 0);
        log(`Approve(0) tx: ${tx0.hash}`);
        await tx0.wait();
        log("Approve(0) confirmed ✅");
      }

      setStatus(approveMax ? `Approving MAX ${tokenSymbol}…` : `Approving ${amt} ${tokenSymbol}…`);
      const tx = await token.connect(signer).approve(spender, desired);
      log(`Approve tx: ${tx.hash}`);
      await tx.wait();

      const after = await token.allowance(userAddress, spender);
      log(`Allowance after: ${ethers.utils.formatUnits(after, tokenDecimals)} ${tokenSymbol}`);

      setStatus("Approve confirmed ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.data?.message || e?.error?.message || e?.reason || e?.message || "Approve failed.";
      if (String(msg).toLowerCase().includes("user rejected")) {
        setError("Approve was rejected in MetaMask.");
      } else {
        setError(msg);
      }
    } finally {
      el.btnApprove.disabled = false;
      el.btnExecute.disabled = false;
    }
  }

  /***********************
   * EXECUTE SPLIT
   ***********************/
  async function executeSplit() {
    setError("");

    if (!provider || !signer || !userAddress) {
      return setError("Connect wallet first.");
    }

    const cfg = activeCfg();
    const net = await provider.getNetwork();
    if (net.chainId !== cfg.chainId) {
      return setError(`Wrong network. Switch to ${cfg.chainName} then execute.`);
    }

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    await loadToken(taddr);

    const vr = validateRecipients();
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      // Ensure allowance is enough
      const allow = await token.allowance(userAddress, cfg.splitter);
      if (allow.lt(amountWei) && !el.chkApproveMax?.checked) {
        return setError(`Allowance too low. Click Approve (or enable Approve MAX).`);
      }

      el.btnExecute.disabled = true;
      setStatus("Preflight… building split payload.");

      setStatus(`Executing split via depositAndDistribute(${tokenSymbol})…`);
      const tx = await splitter.connect(signer).depositAndDistribute(
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
      const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || "Execute failed.";
      setError(msg);
    } finally {
      el.btnExecute.disabled = false;
    }
  }

  /***********************
   * OPERATOR CONSOLE TOGGLE
   ***********************/
  function applyOperatorMode() {
    const on = !!el.chkOperator?.checked;
    if (el.operatorPanel) el.operatorPanel.style.display = on ? "block" : "none";
    log(on ? "Operator console enabled." : "Operator console disabled.");
    if (on) refreshTelemetry().catch(() => {});
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);

    el.selChain.addEventListener("change", async () => {
      if (provider) await switchNetwork();
    });

    el.inpToken.addEventListener("input", async () => {
      const v = (el.inpToken.value || "").trim();
      if (isAddr(v)) await loadToken(v);
      if (el.chkOperator?.checked) await refreshTelemetry();
    });

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "10" });
      renderRecipients();
      updateTotals();
    });

    el.btnApprove.addEventListener("click", approveToken);
    el.btnExecute.addEventListener("click", executeSplit);

    el.chkOperator.addEventListener("change", applyOperatorMode);

    el.btnRefresh?.addEventListener("click", () => refreshTelemetry());
    el.btnClear?.addEventListener("click", () => {
      if (el.log) el.log.textContent = "";
      setError("");
      setStatus("Log cleared.");
    });

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
        setConnectedUI();
        await refreshTelemetry();
      });

      window.ethereum.on("chainChanged", async () => {
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
      // Hard DOM validation to kill null errors early
      must(el.pillNet, "pillNet");
      must(el.pillWallet, "pillWallet");
      must(el.btnSwitch, "btnSwitch");
      must(el.btnConnect, "btnConnect");
      must(el.selChain, "selChain");
      must(el.inpToken, "inpToken");
      must(el.inpAmount, "inpAmount");
      must(el.recipients, "recipients");
      must(el.totalPill, "totalPill");
      must(el.btnAdd, "btnAdd");
      must(el.btnApprove, "btnApprove");
      must(el.btnExecute, "btnExecute");
      must(el.errBox, "errBox");

      renderRecipients();
      applyOperatorMode();

      currentChainKey = el.selChain.value || "bsc";
      el.pillNet.textContent = `Network: ${activeCfg().chainName}`;
      if (el.teleSplitter) el.teleSplitter.textContent = activeCfg().splitter;

      bindEvents();
      setStatus("Ready. Connect wallet to begin.");

      // Silent auto-connect
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

          log("Auto-connected ✅");
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
