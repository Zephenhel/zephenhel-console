/* global ethers */
(() => {
  "use strict";

  /***********************
   * TRI-CHAIN CONFIG (YOUR DEPLOYED CONTRACTS)
   ***********************/
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
   * DOM (STRICT)
   ***********************/
  const need = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id} (index.html mismatch)`);
    return el;
  };

  const el = {
    pillNet: need("pillNet"),
    pillWallet: need("pillWallet"),
    btnSwitch: need("btnSwitch"),
    btnConnect: need("btnConnect"),
    selChain: need("selChain"),

    inpToken: need("inpToken"),
    inpAmount: need("inpAmount"),

    recipients: need("recipients"),
    totalPill: need("totalPill"),
    btnNormalize: need("btnNormalize"),
    btnAdd: need("btnAdd"),

    btnApprove: need("btnApprove"),
    btnExecute: need("btnExecute"),

    spendAddr: need("spendAddr"),

    errBox: need("errBox"),

    teleNative: need("teleNative"),
    teleSymbol: need("teleSymbol"),
    teleDecimals: need("teleDecimals"),
    teleTokenBal: need("teleTokenBal"),
    teleAllowance: need("teleAllowance"),
    teleSplitter: need("teleSplitter"),
    teleStatus: need("teleStatus"),

    btnRefresh: need("btnRefresh"),
    btnClear: need("btnClear"),
    log: need("log"),
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
   * LOGGING
   ***********************/
  const log = (m) => {
    const ts = new Date().toLocaleTimeString();
    el.log.textContent = `[${ts}] ${m}\n` + el.log.textContent;
  };

  const setStatus = (m) => {
    el.teleStatus.textContent = m;
    log(m);
  };

  const setError = (m) => {
    el.errBox.style.display = m ? "block" : "none";
    el.errBox.textContent = m || "";
    if (m) log(`ERROR: ${m}`);
  };

  const shortAddr = (a) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a || "—"));

  const isAddr = (a) => {
    try { return ethers.utils.isAddress(a); } catch { return false; }
  };

  const cfg = () => CONTRACTS[currentKey];

  const updatePills = () => {
    const c = cfg();
    el.pillNet.textContent = `Network: ${c.chainName} (chainId ${c.chainId})`;
    el.teleSplitter.textContent = c.splitter;
    el.spendAddr.textContent = c.splitter;
  };

  /***********************
   * RECIPIENTS UI
   ***********************/
  const updateTotal = () => {
    const sum = rows
      .map(r => Number(r.share || 0))
      .map(n => (Number.isFinite(n) ? n : 0))
      .reduce((a, b) => a + b, 0);
    el.totalPill.textContent = `Total: ${sum || 0}`;
  };

  const renderRecipients = () => {
    el.recipients.innerHTML = "";
    rows.forEach((r, idx) => {
      const row = document.createElement("div");
      row.className = "row";

      const a = document.createElement("input");
      a.placeholder = "0xRecipient…";
      a.spellcheck = false;
      a.value = r.account || "";
      a.addEventListener("input", () => {
        rows[idx].account = a.value.trim();
      });

      const s = document.createElement("input");
      s.placeholder = "50";
      s.inputMode = "numeric";
      s.value = r.share || "";
      s.addEventListener("input", () => {
        rows[idx].share = s.value.trim();
        updateTotal();
      });

      const x = document.createElement("button");
      x.className = "btn ghost";
      x.textContent = "×";
      x.style.padding = "10px 0";
      x.addEventListener("click", () => {
        if (rows.length <= 2) return;
        rows.splice(idx, 1);
        renderRecipients();
      });

      row.appendChild(a);
      row.appendChild(s);
      row.appendChild(x);
      el.recipients.appendChild(row);
    });

    updateTotal();
  };

  const normalizeShares = () => {
    const nums = rows.map(r => Number(r.share || 0)).map(n => (Number.isFinite(n) ? n : 0));
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum <= 0) return setError("Shares must be > 0.");

    let scaled = nums.map(n => Math.floor((n / sum) * 100));
    const s2 = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += 100 - s2;

    rows = rows.map((r, i) => ({ ...r, share: String(Math.max(1, scaled[i])) }));
    renderRecipients();
    setError("");
    setStatus("Normalized weights to 100.");
  };

  const validateRecipients = () => {
    const accounts = [];
    const shares = [];
    for (let i = 0; i < rows.length; i++) {
      const addr = (rows[i].account || "").trim();
      const w = Number((rows[i].share || "").trim());

      if (!isAddr(addr)) return { ok: false, msg: `Recipient #${i + 1} address invalid.` };
      if (!Number.isFinite(w) || w <= 0) return { ok: false, msg: `Recipient #${i + 1} weight must be > 0.` };

      accounts.push(addr);
      shares.push(ethers.BigNumber.from(String(Math.floor(w))));
    }
    return { ok: true, accounts, shares };
  };

  /***********************
   * WALLET / CHAIN
   ***********************/
  const ensureProvider = async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected.");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    return provider;
  };

  const syncChainFromWallet = async () => {
    const net = await provider.getNetwork();
    if (net.chainId === 56) currentKey = "bsc";
    else if (net.chainId === 1) currentKey = "eth";
    else if (net.chainId === 137) currentKey = "polygon";
    el.selChain.value = currentKey;
    updatePills();
    log(`NETWORK ✅ chainId=${net.chainId} (${cfg().chainName})`);
  };

  const initSplitter = async () => {
    const c = cfg();
    splitter = new ethers.Contract(c.splitter, SPLITTER_ABI, signer || provider);
    setStatus(`Splitter ready ✅ ${shortAddr(c.splitter)}`);
  };

  const connectWallet = async () => {
    setError("");
    try {
      await ensureProvider();
      await window.ethereum.request({ method: "eth_requestAccounts" });
      signer = provider.getSigner();
      userAddress = await signer.getAddress();

      el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
      el.btnConnect.textContent = "CONNECTED";
      el.btnConnect.disabled = true;

      log(`WALLET CONNECTED ✅ ${userAddress}`);

      await syncChainFromWallet();
      await initSplitter();
      await refreshTelemetry();
      setStatus("Ready.");
    } catch (e) {
      setError(e?.message || "Wallet connect failed.");
    }
  };

  const switchNetwork = async () => {
    setError("");
    try {
      await ensureProvider();
      const key = el.selChain.value;
      const c = CONTRACTS[key];

      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: c.chainIdHex }],
      });

      currentKey = key;
      await syncChainFromWallet();
      await initSplitter();
      await refreshTelemetry();
      setStatus(`Switched ✅ ${c.chainName}`);
    } catch (e) {
      setError(e?.message || "Switch failed.");
    }
  };

  /***********************
   * TOKEN + TELEMETRY
   ***********************/
  const loadToken = async (addr) => {
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
  };

  const refreshTelemetry = async () => {
    updatePills();

    if (!provider || !userAddress) return;

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
  };

  /***********************
   * APPROVE (ROBUST)
   ***********************/
  const approve = async () => {
    setError("");
    if (!provider || !signer || !userAddress) return setError("Connect wallet first.");

    const c = cfg();
    const net = await provider.getNetwork();
    if (net.chainId !== c.chainId) return setError(`Wrong network. Switch to ${c.chainName}.`);

    const taddr = (el.inpToken.value || "").trim();
    if (!isAddr(taddr)) return setError("Enter a valid token address.");

    const amt = (el.inpAmount.value || "").trim();
    const num = Number(amt);
    if (!amt || !Number.isFinite(num) || num <= 0) return setError("Enter a valid amount.");

    try {
      el.btnApprove.disabled = true;
      el.btnExecute.disabled = true;

      // signer-only token contract for approvals
      const t = new ethers.Contract(taddr, ERC20_ABI, signer);

      let sym = "TOKEN";
      let dec = 18;
      try { sym = await t.symbol(); } catch {}
      try { dec = Number(await t.decimals()); } catch {}

      const spender = c.splitter;
      const desired = ethers.utils.parseUnits(amt, dec);

      log(`APPROVE ▶ token=${taddr} (${sym}) spender=${spender}`);
      const cur = await t.allowance(userAddress, spender);
      log(`ALLOWANCE before=${ethers.utils.formatUnits(cur, dec)} ${sym}`);

      // Many tokens require reset-to-0 if allowance already exists
      if (!cur.isZero()) {
        setStatus("Approving reset (0)…");
        const tx0 = await t.approve(spender, 0);
        log(`tx0=${tx0.hash}`);
        await tx0.wait();
        log("Approve(0) confirmed ✅");
      }

      setStatus(`Approving ${amt} ${sym}…`);
      let gasLimit;
      try {
        const est = await t.estimateGas.approve(spender, desired);
        gasLimit = est.mul(120).div(100);
      } catch {
        gasLimit = ethers.BigNumber.from("120000");
      }

      const tx1 = await t.approve(spender, desired, { gasLimit });
      log(`tx1=${tx1.hash}`);
      await tx1.wait();
      log("Approve confirmed ✅");

      const after = await t.allowance(userAddress, spender);
      log(`ALLOWANCE after=${ethers.utils.formatUnits(after, dec)} ${sym}`);

      setStatus("Approve complete ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.data?.message || e?.error?.message || e?.reason || e?.message || "Approve failed.";
      setError(msg);
    } finally {
      el.btnApprove.disabled = false;
      el.btnExecute.disabled = false;
    }
  };

  /***********************
   * EXECUTE SPLIT
   ***********************/
  const execute = async () => {
    setError("");
    if (!provider || !signer || !userAddress) return setError("Connect wallet first.");

    const c = cfg();
    const net = await provider.getNetwork();
    if (net.chainId !== c.chainId) return setError(`Wrong network. Switch to ${c.chainName}.`);

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
      el.btnExecute.disabled = true;

      // allowance preflight
      const allow = await token.allowance(userAddress, c.splitter);
      if (allow.lt(amountWei)) {
        return setError(`Allowance too low. Click Approve first for at least ${amt} ${tokenSymbol}.`);
      }

      setStatus("Executing split…");
      const tx = await splitter.depositAndDistribute(
        taddr,
        vr.accounts,
        vr.shares,
        amountWei
      );

      log(`EXECUTE tx=${tx.hash}`);
      await tx.wait();
      log("Split executed ✅");

      setStatus("Split complete ✅");
      await refreshTelemetry();
    } catch (e) {
      const msg = e?.data?.message || e?.error?.message || e?.reason || e?.message || "Execute failed.";
      setError(msg);
    } finally {
      el.btnExecute.disabled = false;
    }
  };

  /***********************
   * EVENTS / BOOT
   ***********************/
  const bind = () => {
    el.btnConnect.addEventListener("click", connectWallet);
    el.btnSwitch.addEventListener("click", switchNetwork);

    el.selChain.addEventListener("change", () => {
      currentKey = el.selChain.value || "bsc";
      updatePills();
    });

    el.inpToken.addEventListener("input", refreshTelemetry);

    el.btnAdd.addEventListener("click", () => {
      rows.push({ account: "", share: "10" });
      renderRecipients();
    });

    el.btnNormalize.addEventListener("click", normalizeShares);

    el.btnApprove.addEventListener("click", approve);
    el.btnExecute.addEventListener("click", execute);

    el.btnRefresh.addEventListener("click", refreshTelemetry);
    el.btnClear.addEventListener("click", () => {
      el.log.textContent = "";
      setError("");
      setStatus("Log cleared.");
    });

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accs) => {
        if (!accs || !accs.length) {
          signer = null;
          userAddress = null;
          el.pillWallet.textContent = "Wallet: Disconnected";
          el.btnConnect.textContent = "Connect";
          el.btnConnect.disabled = false;
          setStatus("Disconnected.");
          return;
        }
        signer = provider.getSigner();
        userAddress = accs[0];
        el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
        log(`ACCOUNT CHANGED ✅ ${userAddress}`);
        await refreshTelemetry();
      });

      window.ethereum.on("chainChanged", async () => {
        try {
          await ensureProvider();
          signer = provider.getSigner();
          await syncChainFromWallet();
          await initSplitter();
          await refreshTelemetry();
          setStatus("Chain changed ✅");
        } catch {}
      });
    }
  };

  const boot = async () => {
    try {
      setStatus("Booting…");
      currentKey = el.selChain.value || "bsc";
      updatePills();
      renderRecipients();
      bind();
      setStatus("Ready. Connect wallet.");

      if (window.ethereum) {
        await ensureProvider();
        const accs = await window.ethereum.request({ method: "eth_accounts" });
        if (accs && accs.length) {
          signer = provider.getSigner();
          userAddress = accs[0];

          el.pillWallet.textContent = `Wallet: ${shortAddr(userAddress)}`;
          el.btnConnect.textContent = "CONNECTED";
          el.btnConnect.disabled = true;

          log(`AUTO-CONNECT ✅ ${userAddress}`);
          await syncChainFromWallet();
          await initSplitter();
          await refreshTelemetry();
          setStatus("Auto-connected ✅");
        }
      }
    } catch (e) {
      setError(e?.message || "Boot error.");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
