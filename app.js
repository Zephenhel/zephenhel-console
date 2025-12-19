/* global ethers */
(() => {
"use strict";

/* ========= CONFIG ========= */
const CHAINS = {
  bsc: {
    name: "BNB Chain",
    chainId: 56,
    hex: "0x38",
    native: "BNB",
    splitter: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c",
  },
  eth: {
    name: "Ethereum",
    chainId: 1,
    hex: "0x1",
    native: "ETH",
    splitter: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2",
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    hex: "0x89",
    native: "MATIC",
    splitter: "0x05948E68137eC131E1f0E27028d09fa174679ED4",
  },
};

const SPLITTER_ABI = [
  "function feeBps() view returns (uint16)",
  "function depositAndDistribute(address token, address[] accounts, uint256[] shares, uint256 amount)"
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

/* ========= DOM ========= */
const $ = (id) => document.getElementById(id);
const el = {
  pillNet: $("pillNet"),
  pillWallet: $("pillWallet"),
  btnConnect: $("btnConnect"),
  btnSwitch: $("btnSwitch"),
  selChain: $("selChain"),
  inpToken: $("inpToken"),
  inpAmount: $("inpAmount"),
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
  log: $("log"),
};

/* ========= STATE ========= */
let provider, signer, user;
let chainKey = "bsc";
let splitter, token, tokenDecimals = 18;

/* ========= HELPERS ========= */
function log(msg) {
  const t = new Date().toLocaleTimeString();
  el.log.textContent = `[${t}] ${msg}\n` + el.log.textContent;
}
function error(msg) {
  el.errBox.style.display = msg ? "block" : "none";
  el.errBox.textContent = msg || "";
  if (msg) log("ERROR: " + msg);
}
function addrOK(a){ return ethers.utils.isAddress(a); }

/* ========= RECIPIENTS ========= */
let rows = [
  { addr:"", share:50 },
  { addr:"", share:50 }
];

function renderRecipients(){
  el.recipients.innerHTML = "";
  let total = 0;

  rows.forEach((r,i)=>{
    total += Number(r.share)||0;

    const row = document.createElement("div");
    row.className="row";

    const a = document.createElement("input");
    a.placeholder="0xRecipient…";
    a.value=r.addr;
    a.oninput=()=>{ r.addr=a.value; };

    const s = document.createElement("input");
    s.value=r.share;
    s.oninput=()=>{ r.share=s.value; renderRecipients(); };

    row.append(a,s);
    el.recipients.appendChild(row);
  });

  el.totalPill.textContent = `Total: ${total}`;
}

el.btnAdd.onclick=()=>{
  rows.push({addr:"",share:10});
  renderRecipients();
};

/* ========= WALLET ========= */
async function connect(){
  if(!window.ethereum) return error("MetaMask not found");

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts",[]);
  signer = provider.getSigner();
  user = await signer.getAddress();

  el.pillWallet.textContent = "Wallet: " + user.slice(0,6)+"…";
  el.btnConnect.disabled=true;
  el.btnConnect.textContent="CONNECTED";

  await syncChain();
}

async function syncChain(){
  const net = await provider.getNetwork();
  for(const k in CHAINS){
    if(CHAINS[k].chainId===net.chainId) chainKey=k;
  }
  const cfg = CHAINS[chainKey];
  el.pillNet.textContent = cfg.name;
  splitter = new ethers.Contract(cfg.splitter, SPLITTER_ABI, signer);
  el.teleSplitter.textContent = cfg.splitter;
  refreshTelemetry();
}

el.btnConnect.onclick=connect;

el.btnSwitch.onclick=async()=>{
  const cfg = CHAINS[el.selChain.value];
  await window.ethereum.request({
    method:"wallet_switchEthereumChain",
    params:[{chainId:cfg.hex}]
  });
};

/* ========= TOKEN ========= */
async function loadToken(){
  const a = el.inpToken.value.trim();
  if(!addrOK(a)) return;
  token = new ethers.Contract(a, ERC20_ABI, signer);
  el.teleSymbol.textContent = await token.symbol();
  tokenDecimals = await token.decimals();
  el.teleDecimals.textContent = tokenDecimals;
}

/* ========= TELEMETRY ========= */
async function refreshTelemetry(){
  if(!user) return;
  const cfg = CHAINS[chainKey];

  const bal = await provider.getBalance(user);
  el.teleNative.textContent =
    ethers.utils.formatEther(bal)+" "+cfg.native;

  if(token){
    const tb = await token.balanceOf(user);
    el.teleTokenBal.textContent =
      ethers.utils.formatUnits(tb,tokenDecimals);
    const al = await token.allowance(user,cfg.splitter);
    el.teleAllowance.textContent =
      ethers.utils.formatUnits(al,tokenDecimals);
  }
}

/* ========= ACTIONS ========= */
el.btnApprove.onclick=async()=>{
  error("");
  await loadToken();
  const amt = ethers.utils.parseUnits(el.inpAmount.value,tokenDecimals);
  const tx = await token.approve(
    CHAINS[chainKey].splitter,
    amt
  );
  log("Approve tx "+tx.hash);
  await tx.wait();
  refreshTelemetry();
};

el.btnExecute.onclick=async()=>{
  error("");
  await loadToken();
  const amt = ethers.utils.parseUnits(el.inpAmount.value,tokenDecimals);

  const accounts=[],shares=[];
  for(const r of rows){
    if(!addrOK(r.addr)) return error("Bad recipient");
    accounts.push(r.addr);
    shares.push(Math.floor(Number(r.share)));
  }

  const tx = await splitter.depositAndDistribute(
    token.address,
    accounts,
    shares,
    amt
  );

  log("Execute tx "+tx.hash);
  await tx.wait();
  refreshTelemetry();
};

/* ========= BOOT ========= */
renderRecipients();
log("Citadel ready.");
})();
