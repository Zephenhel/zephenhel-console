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
    },
    eth: {
      chainId: 1,
      chainIdHex: "0x1",
      chainName: "Ethereum",
      rpcUrls: ["https://cloudflare-eth.com"],
      nativeSymbol: "ETH",
      explorer: "https://etherscan.io",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
    },
    polygon: {
      chainId: 137,
      chainIdHex: "0x89",
      chainName: "Polygon",
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
   * DOM (HARDENED)
   ***********************/
  const $ = (id) => document.getElementById(id);

  // Required IDs for this JS to run
  const REQUIRED_IDS = [
    "pillNet","pillWallet","btnSwitch","btnConnect",
    "selChain","selMode","modeHint",
    "tokenBlock","inpToken","inpAmount","btnMax","btnNormalize","gasHint",
    "recipients","totalPill","btnAdd","btnApprove","btnExecute",
    "tipBox","errBox","chkSound",
    "teleNative","teleSymbol","teleDecimals","teleTokenBal","teleAllowance","teleSplitter","teleDetected","teleStatus",
    "btnRefresh","btnClear","log"
  ];

  function hardFailMissingDom() {
    const missing = REQUIRED_IDS.filter((id) => !$(id));
    if (missing.length) {
      // Write directly into body so you can see it even if UI breaks
      document.body.innerHTML = `
        <div style="padding:16px;font-family:system-ui;color:#fff;background:#111">
          <h2 style="margin:0 0 10px 0;color:#ffcc66">ZEPHENHEL CITADEL — DOM ERROR</h2>
          <p style="margin:0 0 10px 0;opacity:.9">
            Your HTML is missing required element IDs. The app cannot start until these IDs exist.
          </p>
          <pre style="white-space:pre-wrap;background:#1a1a1a;padding:12px;border-radius:10px;border:1px solid #333">${missing.join("\n")}</pre>
          <p style="margin:10px 0 0 0;opacity:.9">
            Fix: make sure your index.html has elements with EXACTLY those id="" values.
          </p>
        </div>
      `;
      throw new Error(`Missing DOM IDs: ${missing.join(", ")}`);
    }
  }

  // Call this before we build `el`
  hardFailMissingDom();

  const el = Object.fromEntries(REQUIRED_IDS.map((id) => [id, $(id)]));

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

  let rows = [{ account: "", share: "" }];

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

  function shortAddr(a) {
    if (!a || a.length < 10) return a || "—";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function isAddr(a) {
    try { return ethers.utils.isAddress(a); } catch { return false; }
  }

  /***********************
   * WALLET
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask extension, then refresh.");
      throw new Error("No ethereum provider");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  function setConnectedUI() {
    el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
    el.btnConnect.textContent = "CONNECTED";
    el.btnConnect.disabled = true;
    log(`WALLET CONNECTED ✅ addr=${userAddress}`);
  }

  function setDisconnectedUI() {
    el.pillWallet.textContent = "Wallet: Disconnected";
    el.btnConnect.textContent = "Connect";
    el.btnConnect.disabled = false;
    log("WALLET DISCONNECTED ❌");
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

  async function initContracts() {
    const splitAddr = CONTRACTS[currentChainKey].splitter;
    splitter = new ethers.Contract(splitAddr, SPLITTER_ABI, signer || provider);
    el.teleSplitter.textContent = splitAddr;
    el.teleDetected.textContent = "ZephFlexSplitter (token only)";
    log(`SPLITTER READY ✅ ${splitAddr}`);
  }

  async function connectWallet() {
    setError("");
    await ensureProvider();

    try {
      log("CONNECT: Requesting accounts…");
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

  /***********************
   * TELEMETRY
   ***********************/
  async function refreshTelemetry() {
    if (!provider) return;
    if (!userAddress) return;

    try {
      const bal = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${CONTRACTS[currentChainKey].nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    // only show token info if token loaded
    if (token && tokenAddr) {
      try {
        const tb = await token.balanceOf(userAddress);
        el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
      } catch { el.teleTokenBal.textContent = "—"; }

      try {
        const allow = await token.allowance(userAddress, CONTRACTS[currentChainKey].splitter);
        el.teleAllowance.textContent = `${ethers.utils.formatUnits(allow, tokenDecimals)} ${tokenSymbol}`;
      } catch { el.teleAllowance.textContent = "—"; }
    }
  }

  async function loadToken(address) {
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

    try { tokenSymbol = await token.symbol(); } catch { tokenSymbol = "TOKEN"; }
    try { tokenDecimals = Number(await token.decimals()); } catch { tokenDecimals = 18; }

    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);
    log(`TOKEN LOADED ✅ ${tokenSymbol} decimals=${tokenDecimals}`);
    await refreshTelemetry();
  }

  /***********************
   * RECIPIENTS
   ***********************/
  function updateTotals() {
    const sum = rows
      .map((r) => Number(r.share || 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reduce((a, b) => a + b, 0);

    el.totalPill.textContent = `Total weight: ${sum || 0}`;
  }

  function renderRecipients() {
    el.recipients.innerHTML = "";
    rows.forEach((r, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "row";

      const a = document.createElement("input");
      a.placeholder = "0xRecipient…";
      a.value = r.account || "";
      a.addEventListener("input", () => { rows[idx].account = a.value.trim(); updateTotals(); });

      const s = document.createElement("input");
      s.placeholder = "Weight";
      s.inputMode = "numeric";
      s.value = r.share || "";
      s.addEventListener("input", () => { rows[idx].share = s.value.trim(); updateTotals(); });

      const x = document.createElement("button");
      x.className = "btn ghost";
      x.textContent = "×";
      x.addEventListener("click", () => {
        if (rows.length <= 1) return;
        rows.splice(idx, 1);
        renderRecipients();
        updateTotals();
      });

      wrap.appendChild(a);
      wrap.appendChild(s);
      wrap.appendChild(x);
      el.recipients.appendChild(wrap);
    });

    updateTotals();
  }

  /***********************
   * EVENTS
   ***********************/
  function bindEvents() {
    el.btnConnect.addEventListener("click", connectWallet);

    el.btnSwitch.addEventListener("click", async () => {
      setError("");
      await ensureProvider();

      const key = el.selChain.value;
      const cfg = CONTRACTS[key];

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: cfg.chainIdHex }],
        });
      } catch (err) {
        if (err?.code === 4902) {
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
        } else {
          setError(err?.message || "Network switch failed.");
          return;
        }
      }

      // After switching, MetaMask will fire chainChanged; we still update now
      await syncChainFromWallet();
      await initContracts();
      await refreshTelemetry();
    });

    el.selMode.addEventListener("change", () => {
      // token-only splitter: keep UI consistent
      if (el.selMode.value === "native") {
        el.selMode.value = "token";
        setError("Native splits are NOT supported by the deployed ZephFlexSplitter. Use Token mode.");
      }
    });

    el.inpToken.addEventListener("input", async () => {
      const v = (el.inpToken.value || "").trim();
      await loadToken(v);
    });

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "" });
      renderRecipients();
    });

    el.btnRefresh.addEventListener("click", refreshTelemetry);

    el.btnClear.addEventListener("click", () => {
      el.log.textContent = "";
      setError("");
      setStatus("Log cleared.");
    });

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        if (!accs || !accs.length) {
          userAddress = null;
          signer = null;
          setDisconnectedUI();
          return;
        }
        userAddress = accs[0];
        if (provider) signer = provider.getSigner();
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
        } catch {}
      });
    }
  }

  /***********************
   * BOOT
   ***********************/
  async function boot() {
    renderRecipients();
    bindEvents();

    // default network label
    const key = el.selChain.value || "bsc";
    currentChainKey = CONTRACTS[key] ? key : "bsc";
    el.pillNet.textContent = `Network: ${CONTRACTS[currentChainKey].chainName}`;
    el.teleSplitter.textContent = CONTRACTS[currentChainKey].splitter;

    setStatus("Ready. Connect wallet to begin.");

    // silent connect if already authorized
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
      } else {
        log("BOOT: No authorized wallet yet.");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
