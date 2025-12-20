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
   * ABIs
   ***********************/
  const SPLITTER_ABI = [
    "function feeBps() view returns (uint16)",
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
   * DOM helpers
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

    recipients: $("recipients"),
    totalPill: $("totalPill"),
    btnAdd: $("btnAdd"),
    btnNormalize: $("btnNormalize"),

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

  /***********************
   * STATE
   ***********************/
  let provider = null;
  let signer = null;
  let userAddress = null;

  let currentKey = "bsc";
  let splitter = null;

  let token = null;
  let tokenAddr = null;
  let tokenSymbol = "—";
  let tokenDecimals = 18;

  let rows = [
    { account: "", share: "50" },
    { account: "", share: "50" },
  ];

  /***********************
   * LOG + UI
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

  function cfg() {
    return CONTRACTS[currentKey];
  }

  function updateNetPill() {
    const c = cfg();
    el.pillNet.textContent = `Network: ${c.chainName} (chainId ${c.chainId})`;
    el.teleSplitter.textContent = c.splitter;
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
      });

      wrap.appendChild(inpA);
      wrap.appendChild(inpS);
      wrap.appendChild(btnX);
      el.recipients.appendChild(wrap);
    });

    updateTotals();
  }

  function updateTotals() {
    const sum = rows
      .map((r) => Number(r.share || 0))
      .map((n) => (Number.isFinite(n) ? n : 0))
      .reduce((a, b) => a + b, 0);

    el.totalPill.textContent = `Total: ${sum || 0}`;
  }

  function normalizeShares() {
    const nums = rows.map((r) => Number(r.share || 0)).map((n) => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum <= 0) return setError("Shares must be > 0.");

    let scaled = nums.map((n) => Math.floor((n / sum) * 100));
    let s2 = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += 100 - s2;

    rows = rows.map((r, i) => ({ ...r, share: String(Math.max(1, scaled[i])) }));
    renderRecipients();
    setError("");
    setStatus("Shares normalized to 100.");
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
      shares.push(ethers.BigNumber.from(String(Math.floor(n))));
    }

    return { ok: true, accounts, shares };
  }

  /***********************
   * WALLET
   ***********************/
  async function ensureProvider() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask extension, then refresh.");
      throw new Error("No MetaMask");
    }
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  }

  async function initContracts() {
    const c = cfg();
    splitter = new ethers.Contract(c.splitter, SPLITTER_ABI, signer || provider);
    setStatus(`SPLITTER READY ✅ ${c.splitter}`);
  }

  async function syncFromWalletChain() {
    const net = await provider.getNetwork();

    if (net.chainId === 56) currentKey = "bsc";
    else if (net.chainId === 1) currentKey = "eth";
    else if (net.chainId === 137) currentKey = "polygon";

    el.selChain.value = currentKey;
    updateNetPill();
    log(`NETWORK ✅ ${cfg().chainName} chainId=${net.chainId}`);
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

      log(`WALLET CONNECTED ✅ ${userAddress}`);

      await syncFromWalletChain();
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
    const c = CONTRACTS[key];

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: c.chainIdHex }],
      });
      currentKey = key;
      await syncFromWalletChain();
      await initContracts();
      await refreshTelemetry();
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
          currentKey = key;
          await syncFromWalletChain();
          await initContracts();
          await refreshTelemetry();
          setStatus(`Added + switched to ${c.chainName}.`);
        } catch (e2) {
          setError(e2?.message || "Failed to add chain.");
        }
        return;
      }
      setError(err?.message || "Network switch failed.");
    }
  }

  /***********************
   * TOKEN + TELEMETRY
   ***********************/
  async function loadToken(addr) {
    token = null;
    tokenAddr = null;
    tokenSymbol = "—";
    tokenDecimals = 18;

    el.teleSymbol.textContent = "—";
    el.teleDecimals.textContent = "—";
    el.teleTokenBal.textContent = "—";
    el.teleAllowance.textContent = "—";

    if (!isAddr(addr)) return;

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

    updateNetPill();

    if (!userAddress) {
      el.teleNative.textContent = "—";
      return;
    }

    const c = cfg();

    try {
      const bal = await provider.getBalance(userAddress);
      el.teleNative.textContent = `${ethers.utils.formatEther(bal)} ${c.nativeSymbol}`;
    } catch {
      el.teleNative.textContent = "—";
    }

    const taddr = (el.inpToken.value || "").trim();
    if (isAddr(taddr)) {
      await loadToken(taddr);

      if (token) {
        try {
          const tb = await token.balanceOf(userAddress);
          el.teleTokenBal.textContent = `${ethers.utils.formatUnits(tb, tokenDecimals)} ${tokenSymbol}`;
        } catch {}

        try {
          const allow = await token.allowance(userAddress, c.splitter);
          el.teleAllowance.textContent = `${ethers.utils.formatUnits(allow, tokenDecimals)} ${tokenSymbol}`;
        } catch {}
      }
    }
  }

  /***********************
   * APPROVE (FIXED)
   ***********************/
  async function approveToken() {
    setError("");

    if (!provider || !signer || !userAddress) {
      return setError("Connect wallet first.");
    }

    const c = cfg();

    // Hard check chain really matches selected key
    const net = await provider.getNetwork();
    if (net.chainId !== c.chainId) {
      log(`APPROVE PRECHECK: chainId=${net.chainId} expected=${c.chainId}`);
      return setError(`Wrong network. Switch to ${c.chainName} then approve.`);
    }

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    // Force signer contract for approve
    const tokenLocal = new ethers.Contract(taddr, ERC20_ABI, signer);

    // read decimals/symbol
    let sym = "TOKEN";
    let dec = 18;
    try { sym = await tokenLocal.symbol(); } catch {}
    try { dec = Number(await tokenLocal.decimals()); } catch {}

    token = tokenLocal;
    tokenAddr = taddr;
    tokenSymbol = sym;
    tokenDecimals = dec;

    el.teleSymbol.textContent = tokenSymbol;
    el.teleDecimals.textContent = String(tokenDecimals);

    const spender = c.splitter;
    const desired = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      el.btnApprove.disabled = true;
      el.btnExecute.disabled = true;

      log(`APPROVE: token=${taddr} (${tokenSymbol}) spender=${spender}`);

      const current = await token.allowance(userAddress, spender);
      log(`ALLOWANCE current=${ethers.utils.formatUnits(current, tokenDecimals)} ${tokenSymbol}`);
      log(`ALLOWANCE desired=${amt} ${tokenSymbol}`);

      // If token requires reset-to-0, do it only when allowance > 0
      if (!current.isZero()) {
        setStatus("Approving reset (0)...");
        const tx0 = await token.approve(spender, 0);
        log(`Approve(0) tx: ${tx0.hash}`);
        await tx0.wait();
        log("Approve(0) confirmed ✅");
      }

      setStatus(`Approving ${amt} ${tokenSymbol}...`);

      // Estimate gas; fallback if provider chokes
      let gasLimit;
      try {
        const est = await token.estimateGas.approve(spender, desired);
        gasLimit = est.mul(120).div(100); // +20%
      } catch {
        gasLimit = ethers.BigNumber.from("120000");
      }

      const tx1 = await token.approve(spender, desired, { gasLimit });
      log(`Approve tx: ${tx1.hash}`);
      await tx1.wait();

      const after = await token.allowance(userAddress, spender);
      log(`ALLOWANCE after=${ethers.utils.formatUnits(after, tokenDecimals)} ${tokenSymbol}`);

      setStatus("Approve confirmed ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.data?.message || e?.error?.message || e?.reason || e?.message || "Approve failed.";
      setError(msg);
    } finally {
      el.btnApprove.disabled = false;
      el.btnExecute.disabled = false;
    }
  }

  /***********************
   * EXECUTE
   ***********************/
  async function executeSplit() {
    setError("");

    if (!provider || !signer || !userAddress) {
      return setError("Connect wallet first.");
    }

    const c = cfg();
    const net = await provider.getNetwork();
    if (net.chainId !== c.chainId) {
      return setError(`Wrong network. Switch to ${c.chainName} then execute.`);
    }

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    await loadToken(taddr);
    if (!token) return setError("Token load failed.");

    const vr = validateRecipients();
    if (!vr.ok) return setError(vr.msg);

    const amountWei = ethers.utils.parseUnits(amt, tokenDecimals);

    try {
      // confirm allowance
      const allow = await token.allowance(userAddress, c.splitter);
      if (allow.lt(amountWei)) {
        return setError(`Allowance too low. Approve at least ${amt} ${tokenSymbol} first.`);
      }
    } catch {}

    try {
      el.btnExecute.disabled = true;

      setStatus("Executing split...");
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
      const msg = e?.data?.message || e?.error?.message || e?.reason || e?.message || "Execute failed.";
      setError(msg);
    } finally {
      el.btnExecute.disabled = false;
    }
  }

  /***********************
   * EVENTS + BOOT
   ***********************/
  function bindEvents() {
    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);

    el.selChain.addEventListener("change", () => {
      currentKey = el.selChain.value || "bsc";
      updateNetPill();
      // If wallet connected, we actually switch MetaMask
      if (provider) switchNetwork();
    });

    el.inpToken.addEventListener("input", () => refreshTelemetry());

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "10" });
      renderRecipients();
    });

    el.btnNormalize.addEventListener("click", normalizeShares);

    el.btnApprove.addEventListener("click", approveToken);
    el.btnExecute.addEventListener("click", executeSplit);

    el.btnRefresh.addEventListener("click", refreshTelemetry);
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
        log(`ACCOUNT CHANGED ✅ ${userAddress}`);
        await refreshTelemetry();
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncFromWalletChain();
          await initContracts();
          await refreshTelemetry();
          setStatus("Chain changed.");
        } catch {}
      });
    }
  }

  async function boot() {
    try {
      currentKey = el.selChain.value || "bsc";
      updateNetPill();
      renderRecipients();
      bindEvents();

      setStatus("Ready. Connect wallet to begin.");

      // Silent connect if already authorized
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

          log(`WALLET CONNECTED ✅ ${userAddress}`);

          await syncFromWalletChain();
          await initContracts();
          await refreshTelemetry();

          setStatus("Auto-connected ✅");
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
