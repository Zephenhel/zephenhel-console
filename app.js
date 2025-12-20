/* global ethers */

let provider, signer, user;
let splitter;

const SPLITTERS = {
  56: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c", // BSC
  1: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2", // ETH
  137:"0x05948E68137eC131E1f0E27028d09fa174679ED4" // Polygon
};

const SPLITTER_ABI = [
  "function depositAndDistribute(address token,address[] accounts,uint256[] shares,uint256 amount)",
  "function feeBps() view returns(uint16)"
];

const ERC20_ABI = [
  "function decimals() view returns(uint8)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)"
];

const log = (m) => {
  const el = document.getElementById("log");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${m}\n` + el.textContent;
};

const recipients = [];

function renderRecipients() {
  const box = document.getElementById("recipients");
  box.innerHTML = "";

  recipients.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "row";

    const a = document.createElement("input");
    a.placeholder = "0xRecipient";
    a.value = r.addr;
    a.oninput = () => r.addr = a.value;

    const s = document.createElement("input");
    s.placeholder = "Share (ex: 50)";
    s.value = r.share;
    s.oninput = () => r.share = s.value;

    row.appendChild(a);
    row.appendChild(s);
    box.appendChild(row);
  });
}

document.getElementById("add").onclick = () => {
  recipients.push({ addr:"", share:"50" });
  renderRecipients();
};

document.getElementById("connect").onclick = async () => {
  if (!window.ethereum) return alert("Install MetaMask");

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  user = await signer.getAddress();

  const net = await provider.getNetwork();
  const splitAddr = SPLITTERS[net.chainId];
  if (!splitAddr) return alert("Unsupported network");

  splitter = new ethers.Contract(splitAddr, SPLITTER_ABI, signer);

  document.getElementById("wallet").textContent = user;
  document.getElementById("network").textContent = net.chainId;

  log("Wallet connected");
};

document.getElementById("approve").onclick = async () => {
  const tokenAddr = document.getElementById("token").value.trim();
  const amt = document.getElementById("amount").value;

  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const decimals = await token.decimals();
  const wei = ethers.utils.parseUnits(amt, decimals);

  const net = await provider.getNetwork();
  const spender = SPLITTERS[net.chainId];

  log("Approving...");
  const tx = await token.approve(spender, wei);
  await tx.wait();
  log("Approve confirmed");
};

document.getElementById("execute").onclick = async () => {
  const tokenAddr = document.getElementById("token").value.trim();
  const amt = document.getElementById("amount").value;

  const accounts = [];
  const shares = [];

  recipients.forEach(r => {
    if (ethers.utils.isAddress(r.addr)) {
      accounts.push(r.addr);
      shares.push(ethers.BigNumber.from(r.share));
    }
  });

  if (!accounts.length) return alert("No recipients");

  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const decimals = await token.decimals();
  const wei = ethers.utils.parseUnits(amt, decimals);

  log("Executing split...");
  const tx = await splitter.depositAndDistribute(
    tokenAddr,
    accounts,
    shares,
    wei
  );
  await tx.wait();
  log("Split executed");
};

// init with 2 rows
recipients.push({ addr:"", share:"50" });
recipients.push({ addr:"", share:"50" });
renderRecipients();
