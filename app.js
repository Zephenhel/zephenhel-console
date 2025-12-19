/* global ethers */
'use strict';

/**
 * Your deployed splitters
 */
const SPLITTERS = {
  56: '0x928B75D0fA6382D4B742afB6e500C9458B4f502c', // BSC
  1: '0x56FeE96eF295Cf282490592403B9A3C1304b91d2', // ETH
  137: '0x05948E68137eC131E1f0E27028d09fa174679ED4', // POLY
};

const NETWORK_NAMES = {
  56: 'BNB Chain (chainId 56)',
  1: 'Ethereum (chainId 1)',
  137: 'Polygon (chainId 137)',
};

const DEX_CHAIN = { 56:'bsc', 1:'ethereum', 137:'polygon' };

// ERC20 ABI
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// IMPORTANT:
// We include multiple possible splitter signatures so we can EXECUTE even if
// your deployed contract uses split(), splitToken(), uint16/uint256 percents, etc.
const SPLITTER_ABI = [
  // common
  'function splitToken(address token,uint256 amount,address[] recipients,uint256[] percents) external',
  'function splitToken(address token,uint256 amount,address[] recipients,uint16[] percents) external',
  'function split(address token,uint256 amount,address[] recipients,uint256[] percents) external',
  'function split(address token,uint256 amount,address[] recipients,uint16[] percents) external',
  'function splitERC20(address token,uint256 amount,address[] recipients,uint256[] percents) external',
  'function splitERC20(address token,uint256 amount,address[] recipients,uint16[] percents) external',
];

const $ = (id) => document.getElementById(id);

const el = {
  pillNet: $('pillNet'),
  pillWallet: $('pillWallet'),
  btnConnect: $('btnConnect'),
  btnSwitch: $('btnSwitch'),

  splitterAddr: $('splitterAddr'),
  tokenAddr: $('tokenAddr'),
  amount: $('amount'),
  usdEstimate: $('usdEstimate'),

  recipients: $('recipients'),
  totalPill: $('totalPill'),
  btnAdd: $('btnAdd'),
  btnNormalize: $('btnNormalize'),
  btnApprove: $('btnApprove'),
  btnExecute: $('btnExecute'),

  nativeBal: $('nativeBal'),
  tokenSym: $('tokenSym'),
  tokenDec: $('tokenDec'),
  tokenBal: $('tokenBal'),
  allowance: $('allowance'),
  detectedMode: $('detectedMode'),

  errBox: $('errBox'),
  log: $('log'),

  btnClearLog: $('btnClearLog'),
  btnRefresh: $('btnRefresh'),
  soundToggle: $('soundToggle'),
};

let ethereum; // the chosen MetaMask provider (important on Edge)
let provider; // ethers provider
let signer; // ethers signer
let account = null;
let chainId = null;

let splitter = null; // ethers.Contract
let token = null; // ethers.Contract
let tokenMeta = { symbol: '-', decimals: 18, priceUsd: null };

// ---------------- Sound FX ----------------
function beepRadar() {
  if (!el.soundToggle.checked) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(720, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.12);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.20);
  o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.22);
}

function coinDropBurst(count) {
  if (!el.soundToggle.checked) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const now = ctx.currentTime;
  const n = Math.max(1, Math.min(12, count));
  for (let i = 0; i < n; i++) {
    const t = now + i * 0.055;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    const base = 320 + (i % 4) * 45;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.9, t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.13);
  }
}

// ---------------- Logging ----------------
function ts() {
  const d = new Date();
  let h = d.getHours();
  const am = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `[${h}:${mm}:${ss} ${am}]`;
}
function log(msg) {
  el.log.textContent += `${ts()} ${msg}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}
function showErr(msg) {
  el.errBox.style.display = 'block';
  el.errBox.textContent = msg;
}
function clearErr() {
  el.errBox.style.display = 'none';
  el.errBox.textContent = '';
}
function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function isAddr(v) {
  try { return ethers.utils.getAddress(v); } catch { return null; }
}
function parseAmountInput() {
  const v = el.amount.value.trim();
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return v;
}
function extractRpcReason(e) {
  const msg =
    e?.error?.message ||
    e?.data?.message ||
    e?.data?.originalError?.message ||
    e?.message ||
    String(e);
  return msg;
}

// ---------------- MetaMask Provider Selection (EDGE FIX) ----------------
function pickMetaMaskProvider() {
  if (!window.ethereum) return null;

  // Edge / some environments expose multiple providers
  const any = window.ethereum;
  if (Array.isArray(any.providers)) {
    const mm = any.providers.find(p => p.isMetaMask);
    return mm || any.providers[0] || any;
  }
  return any;
}

async function initProvider() {
  ethereum = pickMetaMaskProvider();
  if (!ethereum) throw new Error('MetaMask not detected. Install/enable the extension, then refresh.');

  provider = new ethers.providers.Web3Provider(ethereum, 'any');
  return provider;
}

// ---------------- UI: recipients ----------------
function getRecipientRows() {
  const rows = [...el.recipients.querySelectorAll('.row')];
  return rows.map(r => ({
    addrEl: r.querySelector('input[data-role="addr"]'),
    pctEl: r.querySelector('input[data-role="pct"]'),
  }));
}
function computeTotalPct() {
  let sum = 0;
  for (const { pctEl } of getRecipientRows()) {
    const n = Number(pctEl.value.trim());
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}
function updateTotalPill() {
  const total = computeTotalPct();
  el.totalPill.textContent = `Total: ${total.toFixed(2)}%`;
}
function addRecipientRow(addr = '', pct = '') {
  const wrap = document.createElement('div');
  wrap.className = 'row';

  const addrInput = document.createElement('input');
  addrInput.dataset.role = 'addr';
  addrInput.placeholder = '0xRecipient…';
  addrInput.value = addr;
  addrInput.autocomplete = 'off';
  addrInput.spellcheck = false;

  const pctInput = document.createElement('input');
  pctInput.dataset.role = 'pct';
  pctInput.placeholder = 'e.g. 50';
  pctInput.inputMode = 'decimal';
  pctInput.value = pct;

  const x = document.createElement('button');
  x.className = 'xbtn';
  x.textContent = '×';
  x.addEventListener('click', () => {
    wrap.remove();
    updateTotalPill();
  });

  addrInput.addEventListener('input', updateTotalPill);
  pctInput.addEventListener('input', updateTotalPill);

  wrap.appendChild(addrInput);
  wrap.appendChild(pctInput);
  wrap.appendChild(x);

  el.recipients.appendChild(wrap);
  updateTotalPill();
}
function normalizePercents() {
  const rows = getRecipientRows();
  const nums = rows.map(r => Number(r.pctEl.value || 0));
  const total = nums.reduce((a,b)=>a+b,0);
  if (total <= 0) return;

  let remaining = 100.0;
  for (let i = 0; i < rows.length; i++) {
    let p = (nums[i] / total) * 100.0;
    if (i === rows.length - 1) {
      p = remaining;
    } else {
      p = Math.round(p * 100) / 100;
      remaining = Math.round((remaining - p) * 100) / 100;
    }
    rows[i].pctEl.value = p.toFixed(2).replace(/\.00$/,'');
  }
  updateTotalPill();
}
function humanPercentsValidated() {
  const rows = getRecipientRows();
  const recipients = [];
  const percentsHuman = [];

  for (const { addrEl, pctEl } of rows) {
    const a = isAddr(addrEl.value.trim());
    if (!a) throw new Error('Invalid recipient address.');
    const p = Number(pctEl.value.trim());
    if (!Number.isFinite(p) || p < 0) throw new Error('Invalid percent.');
    recipients.push(a);
    percentsHuman.push(p);
  }

  const total = percentsHuman.reduce((a,b)=>a+b,0);
  if (Math.abs(total - 100) > 0.01) {
    throw new Error(`Total must equal 100%. Current total: ${total.toFixed(2)}%`);
  }

  return { recipients, percentsHuman };
}
function toScalePercents(percentsHuman, scale) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < percentsHuman.length; i++) {
    let v = Math.floor((percentsHuman[i] / 100) * scale);
    out.push(v);
    sum += v;
  }
  const diff = scale - sum;
  out[out.length - 1] += diff;
  if (out[out.length - 1] < 0) throw new Error('Percent rounding produced negative share.');
  return out;
}

// ---------------- DexScreener price ----------------
async function loadDexPrice(tokenAddress) {
  tokenMeta.priceUsd = null;
  el.usdEstimate.textContent = '$—';
  const dexChain = DEX_CHAIN[chainId];
  if (!dexChain) return;

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!res.ok) return;
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const onChain = pairs.filter(p => (p.chainId || '').toLowerCase() === dexChain);
    const best = onChain[0] || pairs[0];
    const price = Number(best?.priceUsd);
    if (!Number.isFinite(price)) return;

    tokenMeta.priceUsd = price;
    updateUsdEstimate();
  } catch {}
}
function updateUsdEstimate() {
  const amtStr = parseAmountInput();
  if (!amtStr || tokenMeta.priceUsd == null) { el.usdEstimate.textContent = '$—'; return; }
  const amt = Number(amtStr);
  if (!Number.isFinite(amt)) { el.usdEstimate.textContent = '$—'; return; }
  el.usdEstimate.textContent = `$${(amt * tokenMeta.priceUsd).toFixed(2)}`;
}

// ---------------- Connect / Network ----------------
async function paintHeader() {
  el.pillNet.textContent = `Network: ${NETWORK_NAMES[chainId] || `chainId ${chainId}`}`;
  el.pillWallet.textContent = account ? `Wallet: ${shortAddr(account)}` : `Wallet: disconnected`;

  // Connect button state
  if (account) {
    el.btnConnect.textContent = 'CONNECTED';
    el.btnConnect.classList.add('connected');
    el.btnConnect.disabled = true;
  } else {
    el.btnConnect.textContent = 'Connect';
    el.btnConnect.classList.remove('connected');
    el.btnConnect.disabled = false;
  }

  const active = SPLITTERS[chainId];
  el.splitterAddr.value = active || 'Unsupported network';
  splitter = active && signer ? new ethers.Contract(active, SPLITTER_ABI, signer) : null;
}

async function connect() {
  clearErr();
  await initProvider();

  // Ask for accounts (Edge/MetaMask sometimes needs explicit permission)
  try {
    await ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // not all wallets support it; ignore
  }

  const accs = await provider.send('eth_requestAccounts', []);
  account = accs[0] || null;
  signer = account ? provider.getSigner() : null;

  const net = await provider.getNetwork();
  chainId = net.chainId;

  beepRadar();
  log(`Connected: ${shortAddr(account)} on chainId ${chainId}`);
  await paintHeader();
  await refreshTelemetry();
}

async function silentBoot() {
  try {
    await initProvider();
    const net = await provider.getNetwork();
    chainId = net.chainId;

    // try get existing accounts (no popups)
    const accs = await provider.send('eth_accounts', []);
    account = accs[0] || null;
    signer = account ? provider.getSigner() : null;

    await paintHeader();
    if (account) {
      log(`Auto-connected: ${shortAddr(account)} on chainId ${chainId}`);
      await refreshTelemetry();
    } else {
      log('Ready. Click Connect.');
    }
  } catch (e) {
    showErr(extractRpcReason(e));
    log('MetaMask not ready.');
  }
}

async function switchNetwork() {
  clearErr();
  if (!ethereum) await initProvider();

  const order = [56, 1, 137];
  const idx = Math.max(0, order.indexOf(chainId));
  const next = order[(idx + 1) % order.length];

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + next.toString(16) }],
    });
  } catch (e) {
    showErr('Switch failed. Switch network inside MetaMask, then refresh.');
  }
}

// ---------------- Token / Telemetry ----------------
async function loadToken(tokenAddress) {
  const a = isAddr(tokenAddress);
  if (!a) throw new Error('Invalid token address.');

  token = new ethers.Contract(a, ERC20_ABI, signer);

  let sym = '—';
  let dec = 18;
  try { sym = await token.symbol(); } catch {}
  try { dec = await token.decimals(); } catch {}

  tokenMeta.symbol = sym;
  tokenMeta.decimals = dec;

  el.tokenSym.textContent = sym;
  el.tokenDec.textContent = String(dec);

  log(`Token loaded: ${sym} (decimals ${dec})`);
  await loadDexPrice(a);
}

async function refreshTelemetry() {
  if (!provider || !account) {
    el.nativeBal.textContent = '—';
    el.tokenBal.textContent = '—';
    el.allowance.textContent = '—';
    return;
  }

  // native balance
  try {
    const bal = await provider.getBalance(account);
    const native = ethers.utils.formatEther(bal);
    const unit = chainId === 56 ? 'BNB' : chainId === 137 ? 'MATIC' : 'ETH';
    el.nativeBal.textContent = `${Number(native).toFixed(6)} ${unit}`;
  } catch {
    el.nativeBal.textContent = '—';
  }

  const tokenAddress = el.tokenAddr.value.trim();
  if (!isAddr(tokenAddress) || !splitter) return;

  if (!token || token.address.toLowerCase() !== tokenAddress.toLowerCase()) {
    await loadToken(tokenAddress);
  }

  // token balance
  try {
    const b = await token.balanceOf(account);
    const formatted = ethers.utils.formatUnits(b, tokenMeta.decimals);
    el.tokenBal.textContent = `${Number(formatted).toFixed(6)} ${tokenMeta.symbol}`;
  } catch {
    el.tokenBal.textContent = '—';
  }

  // allowance
  try {
    const a = await token.allowance(account, splitter.address);
    const formatted = ethers.utils.formatUnits(a, tokenMeta.decimals);
    el.allowance.textContent = `${Number(formatted).toFixed(6)} ${tokenMeta.symbol}`;
  } catch {
    el.allowance.textContent = '—';
  }
}

// ---------------- Approve / Execute (AUTO-DETECT FUNCTION + SCALE) ----------------
async function approve() {
  clearErr();
  if (!account) throw new Error('Connect wallet first.');
  if (!splitter) throw new Error('Unsupported network.');

  const tokenAddress = el.tokenAddr.value.trim();
  if (!isAddr(tokenAddress)) throw new Error('Enter a valid token address.');

  await loadToken(tokenAddress);

  const amtStr = parseAmountInput();
  if (!amtStr) throw new Error('Enter a valid amount.');

  const amountWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);

  log(`Approving ${tokenMeta.symbol} for splitter ${shortAddr(splitter.address)}…`);
  const tx = await token.approve(splitter.address, amountWei);
  log(`Approve tx: ${tx.hash}`);
  await tx.wait();
  log('Approve confirmed ✅');

  await refreshTelemetry();
}

// Try different method names + percent scales using callStatic
async function preflightDetect(amountWei, recipients, percentsHuman) {
  const scales = [10000, 100]; // try bps then percent
  const methods = ['splitToken', 'split', 'splitERC20'];

  for (const scale of scales) {
    const percents = toScalePercents(percentsHuman, scale);

    for (const m of methods) {
      // callStatic exists even if method is missing -> it will throw, we catch
      try {
        log(`Preflight callStatic: ${m} (scale=${scale})…`);
        await splitter.callStatic[m](token.address, amountWei, recipients, percents);
        el.detectedMode.textContent = `${m} • scale ${scale}`;
        log(`Preflight OK ✅ using ${m} (scale=${scale})`);
        return { method: m, scale, percents };
      } catch (e) {
        // continue
      }
    }
  }

  throw new Error('Preflight failed: contract did not accept inputs (or ABI mismatch).');
}

async function executeSplit() {
  clearErr();
  if (!account) throw new Error('Connect wallet first.');
  if (!splitter) throw new Error('Unsupported network.');

  const tokenAddress = el.tokenAddr.value.trim();
  if (!isAddr(tokenAddress)) throw new Error('Enter a valid token address.');

  await loadToken(tokenAddress);

  const amtStr = parseAmountInput();
  if (!amtStr) throw new Error('Enter a valid amount.');

  const amountWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);
  const { recipients, percentsHuman } = humanPercentsValidated();

  // Check allowance BEFORE trying to execute
  const allowanceWei = await token.allowance(account, splitter.address);
  if (allowanceWei.lt(amountWei)) {
    throw new Error('Allowance is too low. Click Approve first (or approve a larger amount).');
  }

  // Detect function + scale
  const { method, percents } = await preflightDetect(amountWei, recipients, percentsHuman);

  coinDropBurst(recipients.length);

  log(`Sending tx: ${method}…`);
  const tx = await splitter[method](token.address, amountWei, recipients, percents);
  if (!tx?.hash) throw new Error('No transaction hash returned (wallet rejected or blocked).');

  log(`Split tx: ${tx.hash}`);
  await tx.wait();
  log('Split confirmed ✅');

  await refreshTelemetry();
}

// ---------------- Wiring ----------------
function wire() {
  addRecipientRow('', '50');
  addRecipientRow('', '50');
  updateTotalPill();

  el.btnConnect.addEventListener('click', async () => {
    try { await connect(); } catch (e) { showErr(extractRpcReason(e)); log(`Connect failed: ${extractRpcReason(e)}`); }
  });

  el.btnSwitch.addEventListener('click', async () => {
    try { await switchNetwork(); } catch {}
  });

  el.btnAdd.addEventListener('click', () => addRecipientRow('', '0'));
  el.btnNormalize.addEventListener('click', () => { normalizePercents(); log('Normalized to 100%.'); });

  el.btnApprove.addEventListener('click', async () => {
    try { await approve(); } catch (e) { showErr(extractRpcReason(e)); log(`Approve failed: ${extractRpcReason(e)}`); }
  });

  el.btnExecute.addEventListener('click', async () => {
    try { await executeSplit(); } catch (e) { showErr(extractRpcReason(e)); log(`Execute failed: ${extractRpcReason(e)}`); }
  });

  el.btnClearLog.addEventListener('click', () => { el.log.textContent = ''; log('Log cleared.'); });
  el.btnRefresh.addEventListener('click', async () => { try { await refreshTelemetry(); log('Telemetry refreshed.'); } catch {} });

  el.tokenAddr.addEventListener('change', async () => {
    clearErr();
    el.detectedMode.textContent = '—';
    try { await refreshTelemetry(); } catch {}
  });

  el.amount.addEventListener('input', updateUsdEstimate);

  // MetaMask events
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accs) => {
      account = (accs && accs[0]) ? accs[0] : null;
      signer = account && provider ? provider.getSigner() : null;
      if (provider) {
        const net = await provider.getNetwork();
        chainId = net.chainId;
      }
      await paintHeader();
      await refreshTelemetry();
    });

    window.ethereum.on('chainChanged', async () => {
      // re-init on chain changes
      await initProvider();
      const net = await provider.getNetwork();
      chainId = net.chainId;

      const accs = await provider.send('eth_accounts', []);
      account = accs[0] || null;
      signer = account ? provider.getSigner() : null;

      el.detectedMode.textContent = '—';
      await paintHeader();
      await refreshTelemetry();
      log(`Network changed: chainId ${chainId}`);
    });
  }

  log('ZEPHENHEL CITADEL loaded.');
  silentBoot();
}

wire();
