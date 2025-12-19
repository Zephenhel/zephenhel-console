/* global ethers */
'use strict';

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

const DEX_CHAIN = {
  56: 'bsc',
  1: 'ethereum',
  137: 'polygon',
};

// Minimal ERC20 ABI
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Splitter ABI (assumes your function signature)
const SPLITTER_ABI = [
  'function splitToken(address token, uint256 amount, address[] recipients, uint256[] percents) external',
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
  scaleDetected: $('scaleDetected'),

  errBox: $('errBox'),
  log: $('log'),

  btnClearLog: $('btnClearLog'),
  btnRefresh: $('btnRefresh'),
  soundToggle: $('soundToggle'),
};

let provider;
let signer;
let account = null;
let chainId = null;

let token = null; // ethers.Contract
let splitter = null; // ethers.Contract
let tokenMeta = { symbol: '-', decimals: 18, priceUsd: null };

let detectedScale = null; // 100 or 10000

// ---------- Sound FX (no external files) ----------
function beepRadar() {
  if (!el.soundToggle.checked) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(740, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(1240, ctx.currentTime + 0.12);
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

  const n = Math.max(1, Math.min(12, count)); // cap
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

// ---------- Logging ----------
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

// ---------- Helpers ----------
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
    const v = pctEl.value.trim();
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    sum += n;
  }
  return sum;
}

function updateTotalPill() {
  const total = computeTotalPct();
  el.totalPill.textContent = `Total: ${total.toFixed(2)}%`;
}

function normalizePercents() {
  const rows = getRecipientRows();
  const nums = rows.map(r => Number(r.pctEl.value || 0));
  const total = nums.reduce((a,b)=>a+b,0);
  if (total <= 0) return;

  // Normalize to exactly 100.00
  let remaining = 100.0;
  for (let i = 0; i < rows.length; i++) {
    let p = (nums[i] / total) * 100.0;
    if (i === rows.length - 1) {
      p = remaining;
    } else {
      p = Math.round(p * 100) / 100; // 2 decimals
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
  // Allow tiny floating drift
  if (Math.abs(total - 100) > 0.01) {
    throw new Error(`Total must equal 100%. Current total: ${total.toFixed(2)}%`);
  }

  return { recipients, percentsHuman };
}

// Convert human % -> integer percents for given scale (100 or 10000)
function toScalePercents(percentsHuman, scale) {
  const out = [];
  let sum = 0;

  for (let i = 0; i < percentsHuman.length; i++) {
    let v = Math.floor((percentsHuman[i] / 100) * scale);
    out.push(v);
    sum += v;
  }

  // Fix rounding on last entry so it sums EXACT
  const diff = scale - sum;
  out[out.length - 1] += diff;

  // Ensure no negatives due to extreme rounding
  if (out[out.length - 1] < 0) throw new Error('Percent rounding produced a negative last share.');
  return out;
}

// ---------- DexScreener price ----------
async function loadDexPrice(tokenAddress) {
  tokenMeta.priceUsd = null;
  el.usdEstimate.textContent = '$—';

  const dexChain = DEX_CHAIN[chainId];
  if (!dexChain) return;

  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];

    // pick best pair for this chainId
    const onChain = pairs.filter(p => (p.chainId || '').toLowerCase() === dexChain);
    const best = (onChain[0] || pairs[0]);
    if (!best || !best.priceUsd) return;

    const price = Number(best.priceUsd);
    if (!Number.isFinite(price)) return;

    tokenMeta.priceUsd = price;
    updateUsdEstimate();
  } catch {
    // ignore
  }
}

function updateUsdEstimate() {
  const amtStr = parseAmountInput();
  if (!amtStr || tokenMeta.priceUsd == null) {
    el.usdEstimate.textContent = '$—';
    return;
  }
  const amt = Number(amtStr);
  if (!Number.isFinite(amt)) { el.usdEstimate.textContent = '$—'; return; }
  const usd = amt * tokenMeta.priceUsd;
  el.usdEstimate.textContent = `$${usd.toFixed(2)}`;
}

// ---------- UI: recipient rows ----------
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

// ---------- Wallet / network ----------
async function ensureProvider() {
  if (!window.ethereum) throw new Error('MetaMask not detected.');
  provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
  return provider;
}

async function connect() {
  clearErr();
  await ensureProvider();

  const accs = await provider.send('eth_requestAccounts', []);
  account = accs[0] || null;
  signer = provider.getSigner();

  const net = await provider.getNetwork();
  chainId = net.chainId;

  beepRadar();
  await onNetworkOrAccountChanged();
}

async function onNetworkOrAccountChanged() {
  clearErr();

  const net = await provider.getNetwork();
  chainId = net.chainId;

  el.pillNet.textContent = `Network: ${NETWORK_NAMES[chainId] || `chainId ${chainId}`}`;
  el.pillWallet.textContent = `Wallet: ${account ? shortAddr(account) : 'disconnected'}`;

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

  // Active splitter by chain
  const activeSplitter = SPLITTERS[chainId];
  el.splitterAddr.value = activeSplitter || 'Unsupported network';
  splitter = activeSplitter ? new ethers.Contract(activeSplitter, SPLITTER_ABI, signer) : null;

  detectedScale = null;
  el.scaleDetected.textContent = '—';

  await refreshTelemetry();
}

async function switchNetwork() {
  clearErr();
  if (!window.ethereum) return;

  // Cycle: BSC -> ETH -> POLY
  const order = [56, 1, 137];
  const idx = Math.max(0, order.indexOf(chainId));
  const next = order[(idx + 1) % order.length];

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + next.toString(16) }],
    });
  } catch (e) {
    showErr('Network switch failed. Please switch in MetaMask.');
  }
}

// ---------- Token load / telemetry ----------
async function loadToken(tokenAddress) {
  const a = isAddr(tokenAddress);
  if (!a) throw new Error('Invalid token address.');
  token = new ethers.Contract(a, ERC20_ABI, signer);

  // symbol/decimals
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
  if (!provider) return;

  try {
    const net = await provider.getNetwork();
    chainId = net.chainId;
  } catch {}

  if (!account) {
    el.nativeBal.textContent = '—';
    el.tokenBal.textContent = '—';
    el.allowance.textContent = '—';
    return;
  }

  // native balance display (for info only)
  try {
    const bal = await provider.getBalance(account);
    const eth = ethers.utils.formatEther(bal);
    el.nativeBal.textContent = `${Number(eth).toFixed(6)} ${chainId === 56 ? 'BNB' : chainId === 137 ? 'MATIC' : 'ETH'}`;
  } catch {
    el.nativeBal.textContent = '—';
  }

  const tokenAddress = el.tokenAddr.value.trim();
  if (isAddr(tokenAddress)) {
    try {
      if (!token || token.address.toLowerCase() !== tokenAddress.toLowerCase()) {
        await loadToken(tokenAddress);
      }
    } catch (e) {
      showErr(e.message || 'Token load failed.');
      return;
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
    const sp = SPLITTERS[chainId];
    if (sp) {
      try {
        const a = await token.allowance(account, sp);
        const formatted = ethers.utils.formatUnits(a, tokenMeta.decimals);
        el.allowance.textContent = `${Number(formatted).toFixed(6)} ${tokenMeta.symbol}`;
      } catch {
        el.allowance.textContent = '—';
      }
    }
  }
}

// ---------- Approve + Execute ----------
async function approve() {
  clearErr();
  if (!account) throw new Error('Connect wallet first.');
  if (!splitter) throw new Error('Unsupported network.');
  const tokenAddress = el.tokenAddr.value.trim();
  const a = isAddr(tokenAddress);
  if (!a) throw new Error('Enter a valid token address.');

  await loadToken(a);

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

async function detectScaleAndExecute(amountWei, recipients, percentsHuman) {
  // Try scale 10000 first, then 100
  const tries = [10000, 100];

  for (const scale of tries) {
    const percents = toScalePercents(percentsHuman, scale);

    // Preflight with callStatic (no gas)
    try {
      log(`Preflight callStatic (scale=${scale})…`);
      await splitter.callStatic.splitToken(token.address, amountWei, recipients, percents);

      detectedScale = scale;
      el.scaleDetected.textContent = String(scale);
      log(`Preflight OK ✅ (scale=${scale})`);
      return { scale, percents };
    } catch (e) {
      log(`Preflight failed (scale=${scale})`);
      // continue to next
    }
  }

  throw new Error('Both percent scales failed. Your contract rules did not accept the inputs.');
}

async function executeSplit() {
  clearErr();
  if (!account) throw new Error('Connect wallet first.');
  if (!splitter) throw new Error('Unsupported network.');

  const tokenAddress = el.tokenAddr.value.trim();
  const a = isAddr(tokenAddress);
  if (!a) throw new Error('Enter a valid token address.');
  await loadToken(a);

  const amtStr = parseAmountInput();
  if (!amtStr) throw new Error('Enter a valid amount.');
  const amountWei = ethers.utils.parseUnits(amtStr, tokenMeta.decimals);

  const { recipients, percentsHuman } = humanPercentsValidated();

  // Detect scale using callStatic, then send tx with the winning scale
  const { scale, percents } = await detectScaleAndExecute(amountWei, recipients, percentsHuman);

  coinDropBurst(recipients.length);

  log(`Sending splitToken (scale=${scale})…`);
  const tx = await splitter.splitToken(token.address, amountWei, recipients, percents);
  if (!tx || !tx.hash) throw new Error('Transaction did not return a hash (MetaMask may have blocked it).');
  log(`Split tx: ${tx.hash}`);
  await tx.wait();
  log('Split confirmed ✅');

  await refreshTelemetry();
}

// ---------- Events ----------
function wire() {
  // defaults
  addRecipientRow('', '50');
  addRecipientRow('', '50');
  updateTotalPill();

  el.btnConnect.addEventListener('click', async () => {
    try { await connect(); } catch (e) { showErr(e.message || 'Connect failed'); }
  });

  el.btnSwitch.addEventListener('click', async () => {
    try { await switchNetwork(); } catch {}
  });

  el.btnAdd.addEventListener('click', () => addRecipientRow('', '0'));

  el.btnNormalize.addEventListener('click', () => {
    normalizePercents();
    log('Normalized percents to total 100%.');
  });

  el.btnApprove.addEventListener('click', async () => {
    try { await approve(); } catch (e) { showErr(e.message || 'Approve failed'); }
  });

  el.btnExecute.addEventListener('click', async () => {
    try { await executeSplit(); } catch (e) { showErr(e.message || 'Split failed'); }
  });

  el.btnClearLog.addEventListener('click', () => {
    el.log.textContent = '';
    log('Log cleared.');
  });

  el.btnRefresh.addEventListener('click', async () => {
    try { await refreshTelemetry(); log('Refreshed telemetry.'); } catch {}
  });

  el.tokenAddr.addEventListener('change', async () => {
    clearErr();
    detectedScale = null;
    el.scaleDetected.textContent = '—';
    try { await refreshTelemetry(); } catch {}
  });

  el.amount.addEventListener('input', updateUsdEstimate);

  // MetaMask events
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accs) => {
      account = (accs && accs[0]) ? accs[0] : null;
      signer = account ? provider.getSigner() : null;
      await onNetworkOrAccountChanged();
    });
    window.ethereum.on('chainChanged', async () => {
      // ethers provider "any" handles it; just refresh
      const accs = await provider.listAccounts();
      account = accs[0] || null;
      signer = account ? provider.getSigner() : null;
      // re-enable connect button if needed
      el.btnConnect.disabled = !account ? false : true;
      await onNetworkOrAccountChanged();
    });
  }

  // Boot
  log('ZEPHENHEL CITADEL loaded. Ready.');
}

wire();
