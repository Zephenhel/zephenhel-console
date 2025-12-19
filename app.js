/* =========================================================
   ZEPHENHEL CITADEL — FULL OVERWRITE app.js (Ethers v5)
   Fixes:
   - Wallet connect (Edge/MetaMask)
   - Execute split reverts (auto-detect percent scale + amount mode)
   - Exact percent totals (no 99/101 or 9999/10001)
   - Native split support + gas-safe MAX
   - Connected button turns green + says CONNECTED
   - Radar ping on connect + coin-drop beat on execute
   ========================================================= */

/* -------------------------
   HTML IDs REQUIRED
   -------------------------
   Buttons:
     btnConnect
     btnSwitchNetwork (optional)
     btnApprove
     btnExecute
     btnMax (optional)

   Selects:
     selChain (values: "56" | "1" | "137") OR omit (auto uses wallet chain)
     selMode (values: "token" | "native")

   Inputs:
     inpToken (token address for token mode)
     inpAmount (amount input)
     recipientsWrap (container where recipient rows exist or will be created)
       Each row: .row containing
         input.addr (recipient address)
         input.pct (percent number, e.g. 50)
         button.del (remove row)
     btnAddRecipient (optional)
     btnNormalize (optional)

   Telemetry / UI text:
     txtNetwork
     txtWallet
     txtNativeBal
     txtTokenSymbol
     txtTokenDecimals
     txtTokenBalance
     txtAllowance
     txtActiveSplitter
     txtStatus
     txtError
     logBox

   If some are missing, code degrades gracefully (won’t crash).
*/

(function () {
  // ----------- Safety: require ethers v5 -----------
  if (typeof window.ethers === "undefined") {
    alert("Ethers.js not found. Make sure you include ethers v5 on the page.");
    return;
  }

  const { ethers } = window;

  // =========================
  // 1) CONFIG (YOUR DEPLOYED ADDRESSES)
  // =========================
  const CHAINS = {
    56: {
      name: "BNB Chain",
      symbol: "BNB",
      rpcChainIdHex: "0x38",
      splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
      vault: "0x69BD92784b9ED63a40d2cf51b475Ba68B37bD59E",
      gasReserve: "0.003" // gas-safe reserve for MAX native
    },
    1: {
      name: "Ethereum",
      symbol: "ETH",
      rpcChainIdHex: "0x1",
      splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
      vault: "0x886f915D21A5BC540E86655a89e6223981D875d8",
      gasReserve: "0.005"
    },
    137: {
      name: "Polygon",
      symbol: "MATIC",
      rpcChainIdHex: "0x89",
      splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
      vault: "0xde07160A2eC236315Dd27e9600f88Ba26F86f06e",
      gasReserve: "0.2"
    }
  };

  // =========================
  // 2) MINIMAL ABIs (splitter + vault)
  // =========================

  // Splitter ABI (supports common variants)
  const SPLITTER_ABI = [
    // token split
    "function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external",
    // some variants include "shares" naming; still same signature
    // native split variants
    "function splitNative(address[] recipients, uint256[] percents) external payable",
    "function splitNative(uint256 amount, address[] recipients, uint256[] percents) external payable"
  ];

  // ERC20 ABI
  const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];

  // Vault ABI (generic read/execute hooks; will not break if not used by UI)
  // NOTE: since your vault is already deployed, UI should call functions that exist.
  // Here we keep it minimal and optional.
  const VAULT_ABI = [
    "function owner() view returns (address)",
    "function createVault(address token, uint256 amount, uint256 releaseTime, address beneficiary) external",
    "function deposit(uint256 vaultId, uint256 amount) external",
    "function trigger(uint256 vaultId) external",
    "function inspect(uint256 vaultId) view returns (address token, uint256 balance, uint256 releaseTime, address beneficiary, bool triggered)"
  ];

  // =========================
  // 3) DOM HELPERS
  // =========================
  const $ = (id) => document.getElementById(id);
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const setHTML = (id, v) => { const el = $(id); if (el) el.innerHTML = v; };
  const show = (id) => { const el = $(id); if (el) el.style.display = ""; };
  const hide = (id) => { const el = $(id); if (el) el.style.display = "none"; };

  function log(msg) {
    const t = new Date();
    const stamp = t.toLocaleTimeString();
    const line = `[${stamp}] ${msg}\n`;
    const box = $("logBox");
    if (box) {
      box.textContent += line;
      box.scrollTop = box.scrollHeight;
    }
    // also console
    console.log(msg);
  }

  function setError(msg) {
    setText("txtError", msg || "");
    if (msg) log(msg);
  }

  function setStatus(msg) {
    setText("txtStatus", msg || "");
    if (msg) log(msg);
  }

  // =========================
  // 4) SOUND FX (no external files)
  // =========================
  const SFX = {
    enabled: true,
    ctx: null,
    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      return this.ctx;
    },
    radarPing() {
      const ctx = this.ensure(); if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.24);
    },
    coinBeat(count) {
      const ctx = this.ensure(); if (!ctx) return;
      const hits = Math.max(1, Math.min(12, Number(count) || 1));
      for (let i = 0; i < hits; i++) {
        const t = ctx.currentTime + i * 0.06;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(520 + (i * 25), t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.09);
      }
    }
  };

  // =========================
  // 5) STATE
  // =========================
  let provider = null;
  let signer = null;
  let user = null;
  let chainId = null;

  let splitter = null;
  let vault = null;
  let token = null;
  let tokenMeta = { symbol: "-", decimals: 18 };
  let detected = {
    percentScale: null, // 100 or 10000
    amountMode: null, // "raw" or "postFee"
    nativeSig: null // "A" or "B" for splitNative variants
  };

  // =========================
  // 6) NETWORK / CONNECT
  // =========================
  function getSelectedChainId() {
    const sel = $("selChain");
    if (sel && sel.value) return Number(sel.value);
    return chainId; // fallback
  }

  function chainCfg() {
    const cid = getSelectedChainId();
    return CHAINS[cid] || null;
  }

  async function connect() {
    setError("");
    setStatus("Connecting wallet…");

    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask extension and refresh.");
      return;
    }

    try {
      provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      signer = provider.getSigner();
      user = await signer.getAddress();

      const net = await provider.getNetwork();
      chainId = Number(net.chainId);

      onConnectedUI(true);
      SFX.radarPing();

      setStatus(`Connected: ${shortAddr(user)} on chainId ${chainId}`);
      await refreshAll();

      // listeners
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
      window.ethereum.on("accountsChanged", onAccountsChanged);
      window.ethereum.on("chainChanged", onChainChanged);

    } catch (e) {
      onConnectedUI(false);
      setError("Connect failed: " + (e?.message || e));
    }
  }

  function onConnectedUI(ok) {
    const b = $("btnConnect");
    if (!b) return;

    if (ok) {
      b.textContent = "CONNECTED";
      b.classList.add("connected");
      b.disabled = true;
    } else {
      b.textContent = "Connect";
      b.classList.remove("connected");
      b.disabled = false;
    }
  }

  async function onAccountsChanged(accounts) {
    if (!accounts || !accounts.length) {
      user = null;
      onConnectedUI(false);
      setStatus("Disconnected.");
      return;
    }
    user = accounts[0];
    onConnectedUI(true);
    setStatus(`Account changed: ${shortAddr(user)}`);
    await refreshAll();
  }

  async function onChainChanged(_hex) {
    // MetaMask recommends reload on chain changes for safety
    location.reload();
  }

  async function switchNetwork(targetChainId) {
    const cfg = CHAINS[targetChainId];
    if (!cfg) return setError("Unknown chain.");

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.rpcChainIdHex }]
      });
    } catch (e) {
      setError("Switch network failed: " + (e?.message || e));
    }
  }

  function shortAddr(a) {
    if (!a) return "-";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  // =========================
  // 7) RECIPIENTS (UI parsing + exact totals)
  // =========================
  function recipientsList() {
    const wrap = $("recipientsWrap");
    if (!wrap) return { recipients: [], percents: [] };

    const rows = Array.from(wrap.querySelectorAll(".row"));
    const recipients = [];
    const percents = [];

    for (const r of rows) {
      const addr = r.querySelector("input.addr")?.value?.trim() || "";
      const pctStr = r.querySelector("input.pct")?.value?.trim() || "0";
      const pct = Number(pctStr);

      if (addr.length) recipients.push(addr);
      if (Number.isFinite(pct)) percents.push(pct);
    }

    return { recipients, percents };
  }

  // Make percents EXACT total (scale 100 or 10000)
  function makePercentsExact(scale) {
    const { percents } = recipientsList();
    const nums = percents.map(v => Number(v));

    if (!nums.length) throw new Error("Add recipients first.");
    if (nums.some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid percents.");

    const sum = nums.reduce((a,b)=>a+b,0);
    if (sum <= 0) throw new Error("Percent sum must be > 0.");

    // Normalize to 100
    const norm = nums.map(n => (n / sum) * 100);

    const out = [];
    let running = 0;

    for (let i = 0; i < norm.length; i++) {
      if (i === norm.length - 1) {
        out.push(scale - running);
      } else {
        const v = (scale === 100) ? Math.round(norm[i]) : Math.round(norm[i] * 100);
        out.push(v);
        running += v;
      }
    }

    // final correction
    const total = out.reduce((a,b)=>a+b,0);
    if (total !== scale) out[out.length - 1] += (scale - total);

    // clamp last
    if (out[out.length - 1] < 0) out[out.length - 1] = 0;

    return out;
  }

  function updateTotalPctUI() {
    const wrap = $("recipientsWrap");
    const totalEl = $("txtTotalPct");
    if (!wrap || !totalEl) return;

    const { percents } = recipientsList();
    const sum = percents.reduce((a,b)=>a+(Number(b)||0), 0);
    totalEl.textContent = `Total: ${sum.toFixed(2)}%`;
  }

  function addRecipientRow(addr = "", pct = 50) {
    const wrap = $("recipientsWrap");
    if (!wrap) return;

    const row = document.createElement("div");
    row.className = "row";

    row.innerHTML = `
      <input class="addr" placeholder="0xRecipient…" value="${addr}" />
      <input class="pct" placeholder="%" value="${pct}" />
      <button class="del" type="button">×</button>
    `;

    row.querySelector(".del").onclick = () => {
      row.remove();
      updateTotalPctUI();
    };
    row.querySelector(".pct").oninput = updateTotalPctUI;
    wrap.appendChild(row);
    updateTotalPctUI();
  }

  function normalizePercents() {
    try {
      const { percents } = recipientsList();
      const sum = percents.reduce((a,b)=>a+(Number(b)||0),0);
      if (sum <= 0) return;

      const wrap = $("recipientsWrap");
      const rows = Array.from(wrap.querySelectorAll(".row"));
      rows.forEach((r, i) => {
        const p = Number(r.querySelector("input.pct")?.value || 0);
        const norm = (p / sum) * 100;
        r.querySelector("input.pct").value = norm.toFixed(2);
      });
      updateTotalPctUI();
    } catch (e) {
      setError(e.message);
    }
  }

  // =========================
  // 8) TOKEN LOAD + BALANCES
  // =========================
  async function loadTokenIfNeeded() {
    const mode = $("selMode")?.value || "token";
    if (mode !== "token") {
      token = null;
      tokenMeta = { symbol: "-", decimals: 18 };
      setText("txtTokenSymbol", "-");
      setText("txtTokenDecimals", "-");
      setText("txtTokenBalance", "-");
      setText("txtAllowance", "-");
      return;
    }

    const addr = ($("inpToken")?.value || "").trim();
    if (!ethers.utils.isAddress(addr)) {
      token = null;
      tokenMeta = { symbol: "-", decimals: 18 };
      setText("txtTokenSymbol", "-");
      setText("txtTokenDecimals", "-");
      setText("txtTokenBalance", "-");
      setText("txtAllowance", "-");
      return;
    }

    token = new ethers.Contract(addr, ERC20_ABI, signer || provider);
    try {
      const [sym, dec] = await Promise.all([token.symbol(), token.decimals()]);
      tokenMeta = { symbol: sym, decimals: Number(dec) };
      setText("txtTokenSymbol", sym);
      setText("txtTokenDecimals", String(dec));
      setStatus(`Token loaded: ${sym} (decimals ${dec})`);
    } catch (e) {
      // some tokens fail symbol() on some chains; keep decimals fallback
      tokenMeta = { symbol: "TOKEN", decimals: 18 };
      setText("txtTokenSymbol", "TOKEN");
      setText("txtTokenDecimals", "18");
      log("Token metadata read failed: " + (e?.message || e));
    }
  }

  async function refreshBalances() {
    if (!provider || !user) return;

    const cfg = chainCfg();
    if (!cfg) return;

    // network + wallet display
    setText("txtNetwork", `${cfg.name} (chainId ${chainId})`);
    setText("txtWallet", shortAddr(user));
    setText("txtActiveSplitter", cfg.splitter);

    // native balance
    try {
      const nb = await provider.getBalance(user);
      setText("txtNativeBal", `${ethers.utils.formatEther(nb)} ${cfg.symbol}`);
    } catch { /* ignore */ }

    // token balance + allowance
    const mode = $("selMode")?.value || "token";
    if (mode === "token" && token && ethers.utils.isAddress(cfg.splitter)) {
      try {
        const [bal, allow] = await Promise.all([
          token.balanceOf(user),
          token.allowance(user, cfg.splitter)
        ]);

        setText("txtTokenBalance", `${ethers.utils.formatUnits(bal, tokenMeta.decimals)} ${tokenMeta.symbol}`);
        setText("txtAllowance", `${ethers.utils.formatUnits(allow, tokenMeta.decimals)} ${tokenMeta.symbol}`);
      } catch (e) {
        log("Token balance/allowance read failed: " + (e?.message || e));
      }
    }
  }

  // =========================
  // 9) CONTRACT INSTANCES
  // =========================
  function splitterContract() {
    const cfg = chainCfg();
    if (!cfg) throw new Error("Unsupported chain.");
    if (!ethers.utils.isAddress(cfg.splitter)) throw new Error("Splitter address missing.");
    return new ethers.Contract(cfg.splitter, SPLITTER_ABI, signer);
  }

  function vaultContract() {
    const cfg = chainCfg();
    if (!cfg || !ethers.utils.isAddress(cfg.vault)) return null;
    return new ethers.Contract(cfg.vault, VAULT_ABI, signer);
  }

  // =========================
  // 10) FEE + AUTO DETECT
  // =========================
  function feeAdjusted(rawWei) {
    // 1% platform fee — just for display and “postFee candidate”
    // If contract takes fee on-chain, it may expect amount BEFORE fee.
    // We try both modes in detect().
    return rawWei.mul(99).div(100);
  }

  async function detectSplitterRequirements() {
    detected = { percentScale: null, amountMode: null, nativeSig: null };

    const cfg = chainCfg();
    if (!cfg) throw new Error("Unsupported chain.");
    splitter = splitterContract();
    vault = vaultContract();

    const mode = $("selMode")?.value || "token";

    const { recipients } = recipientsList();
    if (!recipients.length) throw new Error("Add recipients.");

    // Validate recipient addresses
    for (const a of recipients) {
      if (!ethers.utils.isAddress(a)) throw new Error("Bad recipient: " + a);
    }

    // percent scale detect: try 100 then 10000 using callStatic
    const tryScales = [100, 10000];
    const tryAmountModes = ["raw", "postFee"];

    if (mode === "token") {
      if (!token) throw new Error("Enter token address first.");
      const tokenAddr = token.address;

      const amtStr = ($("inpAmount")?.value || "").trim();
      if (!amtStr || Number(amtStr) <= 0) throw new Error("Enter amount.");

      const rawWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
      const postWei = feeAdjusted(rawWei);

      for (const scale of tryScales) {
        let percArr;
        try { percArr = makePercentsExact(scale); } catch { continue; }

        for (const am of tryAmountModes) {
          const amountToSend = (am === "raw") ? rawWei : postWei;
          try {
            // callStatic to see if it reverts
            await splitter.callStatic.splitToken(tokenAddr, amountToSend, recipients, percArr);
            detected.percentScale = scale;
            detected.amountMode = am;
            setStatus(`Auto-detect OK: scale=${scale}, amountMode=${am}`);
            return detected;
          } catch (e) {
            // keep trying
          }
        }
      }

      throw new Error("Auto-detect failed (splitToken). Contract rules didn’t match inputs.");
    }

    // NATIVE detect: try both signatures
    const amtStr = ($("inpAmount")?.value || "").trim();
    if (!amtStr || Number(amtStr) <= 0) throw new Error("Enter amount.");

    const rawWei = ethers.utils.parseEther(amtStr);
    const postWei = feeAdjusted(rawWei);

    for (const scale of tryScales) {
      let percArr;
      try { percArr = makePercentsExact(scale); } catch { continue; }

      // Signature A: splitNative(address[],uint256[]) payable with value
      try {
        await splitter.callStatic.splitNative(recipients, percArr, { value: postWei });
        detected.percentScale = scale;
        detected.amountMode = "postFee";
        detected.nativeSig = "A";
        setStatus(`Auto-detect OK: nativeSig=A scale=${scale}`);
        return detected;
      } catch (_) {}

      // Signature B: splitNative(uint256,address[],uint256[]) payable with value
      try {
        await splitter.callStatic.splitNative(postWei, recipients, percArr, { value: postWei });
        detected.percentScale = scale;
        detected.amountMode = "postFee";
        detected.nativeSig = "B";
        setStatus(`Auto-detect OK: nativeSig=B scale=${scale}`);
        return detected;
      } catch (_) {}
    }

    throw new Error("Auto-detect failed (splitNative).");
  }

  // =========================
  // 11) APPROVE (TOKEN MODE)
  // =========================
  async function approve() {
    setError("");
    if (!signer || !user) return setError("Connect wallet first.");
    const cfg = chainCfg();
    if (!cfg) return setError("Unsupported chain.");

    const mode = $("selMode")?.value || "token";
    if (mode !== "token") return setError("Approve is only for token mode.");

    await loadTokenIfNeeded();
    if (!token) return setError("Enter valid token address.");

    const amtStr = ($("inpAmount")?.value || "").trim();
    if (!amtStr || Number(amtStr) <= 0) return setError("Enter amount.");

    const rawWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);

    try {
      setStatus(`Approving ${tokenMeta.symbol} for splitter ${shortAddr(cfg.splitter)}…`);
      const tx = await token.approve(cfg.splitter, rawWei);
      setStatus(`Approve tx sent: ${tx.hash}`);
      await tx.wait();
      setStatus("Approve confirmed ✅");
      await refreshBalances();
    } catch (e) {
      setError("Approve failed: " + (e?.message || e));
    }
  }

  // =========================
  // 12) EXECUTE SPLIT (TOKEN OR NATIVE)
  // =========================
  async function executeSplit() {
    setError("");
    if (!signer || !user) return setError("Connect wallet first.");

    const cfg = chainCfg();
    if (!cfg) return setError("Unsupported chain.");

    const mode = $("selMode")?.value || "token";
    const { recipients } = recipientsList();

    if (!recipients.length) return setError("Add recipients first.");

    // ensure contracts
    try {
      splitter = splitterContract();
    } catch (e) {
      return setError(e.message);
    }

    // auto detect requirements every time (safe)
    try {
      await loadTokenIfNeeded();
      await detectSplitterRequirements();
    } catch (e) {
      return setError(e.message);
    }

    let percArr;
    try {
      percArr = makePercentsExact(detected.percentScale);
    } catch (e) {
      return setError(e.message);
    }

    const amtStr = ($("inpAmount")?.value || "").trim();
    if (!amtStr || Number(amtStr) <= 0) return setError("Enter amount.");

    // play SFX (beats = number of recipients)
    SFX.coinBeat(recipients.length);

    try {
      if (mode === "token") {
        if (!token) return setError("Enter token address.");

        const rawWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
        const postWei = feeAdjusted(rawWei);
        const amountToSend = (detected.amountMode === "raw") ? rawWei : postWei;

        // Preflight allowance + balance
        const [bal, allow] = await Promise.all([
          token.balanceOf(user),
          token.allowance(user, cfg.splitter)
        ]);

        if (bal.lt(amountToSend)) {
          return setError(`Insufficient ${tokenMeta.symbol} balance.`);
        }
        if (allow.lt(amountToSend)) {
          return setError(`Allowance too low. Approve at least ${ethers.utils.formatUnits(amountToSend, tokenMeta.decimals)} ${tokenMeta.symbol}.`);
        }

        setStatus(`Executing splitToken (scale=${detected.percentScale}, mode=${detected.amountMode})…`);

        // Estimate gas with fallback
        let gasLimit;
        try {
          const g = await splitter.estimateGas.splitToken(token.address, amountToSend, recipients, percArr);
          gasLimit = g.mul(130).div(100);
        } catch (e) {
          // fallback
          gasLimit = ethers.BigNumber.from("700000");
          log("estimateGas failed; using fallback gasLimit 700000");
        }

        const tx = await splitter.splitToken(token.address, amountToSend, recipients, percArr, { gasLimit });
        setStatus(`Split tx: ${tx.hash}`);
        await tx.wait();
        setStatus("Split confirmed ✅");
        await refreshAll();
        return;
      }

      // NATIVE
      const rawWei = ethers.utils.parseEther(amtStr);
      const postWei = feeAdjusted(rawWei);
      const amountToSend = postWei;

      setStatus(`Executing native split (sig=${detected.nativeSig}, scale=${detected.percentScale})…`);

      let tx;
      let gasLimit;

      if (detected.nativeSig === "A") {
        try {
          const g = await splitter.estimateGas.splitNative(recipients, percArr, { value: amountToSend });
          gasLimit = g.mul(130).div(100);
        } catch (_) {
          gasLimit = ethers.BigNumber.from("700000");
        }
        tx = await splitter.splitNative(recipients, percArr, { value: amountToSend, gasLimit });
      } else {
        try {
          const g = await splitter.estimateGas.splitNative(amountToSend, recipients, percArr, { value: amountToSend });
          gasLimit = g.mul(130).div(100);
        } catch (_) {
          gasLimit = ethers.BigNumber.from("700000");
        }
        tx = await splitter.splitNative(amountToSend, recipients, percArr, { value: amountToSend, gasLimit });
      }

      setStatus(`Native split tx: ${tx.hash}`);
      await tx.wait();
      setStatus("Native split confirmed ✅");
      await refreshAll();

    } catch (e) {
      const msg = e?.reason || e?.data?.message || e?.message || String(e);
      setError("Split failed: " + msg);
    }
  }

  // =========================
  // 13) MAX (gas-safe)
  // =========================
  async function setMax() {
    setError("");
    if (!provider || !user) return setError("Connect wallet first.");

    const cfg = chainCfg();
    if (!cfg) return setError("Unsupported chain.");

    const mode = $("selMode")?.value || "token";
    const amt = $("inpAmount");
    if (!amt) return;

    try {
      if (mode === "native") {
        // gas-safe max: balance - reserve
        const bal = await provider.getBalance(user);

        // primary reserve from config, but if gasPrice is huge, add a dynamic safety
        const reserveFixed = ethers.utils.parseEther(cfg.gasReserve);
        let reserveDyn = ethers.BigNumber.from(0);
        try {
          const gp = await provider.getGasPrice();
          reserveDyn = gp.mul(21000).mul(3); // 3x simple transfer
        } catch (_) {}

        const reserve = reserveFixed.gt(reserveDyn) ? reserveFixed : reserveDyn;

        const max = bal.gt(reserve) ? bal.sub(reserve) : ethers.BigNumber.from(0);
        amt.value = ethers.utils.formatEther(max);
        setStatus(`MAX (gas-safe) set. Reserved ~${cfg.gasReserve} ${cfg.symbol} for gas.`);
      } else {
        await loadTokenIfNeeded();
        if (!token) return setError("Enter token address first.");
        const bal = await token.balanceOf(user);
        amt.value = ethers.utils.formatUnits(bal, tokenMeta.decimals);
        setStatus(`MAX token set: ${amt.value} ${tokenMeta.symbol}`);
      }
    } catch (e) {
      setError("MAX failed: " + (e?.message || e));
    }
  }

  // =========================
  // 14) REFRESH ALL
  // =========================
  async function refreshAll() {
    try {
      const net = await provider.getNetwork();
      chainId = Number(net.chainId);

      const cfg = chainCfg() || CHAINS[chainId];
      if (cfg) {
        setText("txtNetwork", `${cfg.name} (chainId ${chainId})`);
        setText("txtActiveSplitter", cfg.splitter);
      } else {
        setText("txtNetwork", `chainId ${chainId}`);
      }

      await loadTokenIfNeeded();
      await refreshBalances();
      updateTotalPctUI();
    } catch (e) {
      log("Refresh error: " + (e?.message || e));
    }
  }

  // =========================
  // 15) WIRE UP BUTTONS
  // =========================
  function bindUI() {
    $("btnConnect")?.addEventListener("click", connect);

    $("btnSwitchNetwork")?.addEventListener("click", async () => {
      const target = Number(($("selChain")?.value || chainId || 0));
      if (!target) return setError("Select a chain.");
      await switchNetwork(target);
    });

    $("btnApprove")?.addEventListener("click", approve);
    $("btnExecute")?.addEventListener("click", executeSplit);
    $("btnMax")?.addEventListener("click", setMax);

    $("btnAddRecipient")?.addEventListener("click", () => addRecipientRow("", 50));
    $("btnNormalize")?.addEventListener("click", normalizePercents);

    $("selMode")?.addEventListener("change", async () => {
      await loadTokenIfNeeded();
      await refreshBalances();
    });

    $("inpToken")?.addEventListener("change", async () => {
      await loadTokenIfNeeded();
      await refreshBalances();
    });

    $("inpAmount")?.addEventListener("input", () => {
      // optional: could update a "post-fee receive" label if your UI has one
    });

    $("selChain")?.addEventListener("change", async () => {
      // if connected, offer switch
      const target = Number(($("selChain")?.value || 0));
      if (target && window.ethereum) {
        setStatus("Chain selected. Use Switch Network to change MetaMask network.");
      }
    });

    // Sound toggle if exists
    const sfx = $("chkSfx");
    if (sfx) {
      SFX.enabled = !!sfx.checked;
      sfx.addEventListener("change", () => (SFX.enabled = !!sfx.checked));
    }

    // Create 2 default rows if empty
    const wrap = $("recipientsWrap");
    if (wrap && !wrap.querySelector(".row")) {
      addRecipientRow("", 50);
      addRecipientRow("", 50);
    }
  }

  // =========================
  // 16) INIT
  // =========================
  function init() {
    bindUI();
    setStatus("Ready. Connect wallet to begin.");

    // If MetaMask already connected, try silent connect
    if (window.ethereum) {
      window.ethereum.request({ method: "eth_accounts" }).then(async (acc) => {
        if (acc && acc.length) {
          await connect();
        }
      }).catch(()=>{});
    }
  }

  init();

})();
