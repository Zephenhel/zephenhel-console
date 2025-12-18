let provider, signer, userAddress;
let splitter;

const SPLITTERS = {
  56: "0x928B75D0fA6382D4B742afB6e500C9458B4f502c", // BSC
  1: "0x56FeE96eF295Cf282490592403B9A3C1304b91d2", // ETH
  137:"0x05948E68137eC131E1f0E27028d09fa174679ED4" // POLYGON
};

const ABI = [
  "function splitToken(address token,uint256 amount,address[] recipients,uint256[] percentages)"
];

const log = msg => {
  document.getElementById("logBox").textContent += msg + "\n";
};

document.getElementById("connectBtn").onclick = async () => {
  if (!window.ethereum) return alert("MetaMask required");
  document.getElementById("radarSound").play();

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = await signer.getAddress();

  const net = await provider.getNetwork();
  const addr = SPLITTERS[net.chainId];
  if (!addr) return alert("Unsupported chain");

  splitter = new ethers.Contract(addr, ABI, signer);

  document.getElementById("walletBadge").textContent = userAddress.slice(0,6)+"..."+userAddress.slice(-4);
  document.getElementById("chainBadge").textContent = "CHAIN: " + net.chainId;
  log("Wallet connected");
};

document.getElementById("addRecipient").onclick = () => {
  const div = document.createElement("div");
  div.className = "recipient";
  div.innerHTML = `
    <input placeholder="0xRecipient" />
    <input type="number" placeholder="%" />
    <button>X</button>
  `;
  div.querySelector("button").onclick = () => div.remove();
  document.getElementById("recipients").appendChild(div);
};

document.getElementById("approveBtn").onclick = async () => {
  const token = document.getElementById("tokenAddress").value;
  const amt = ethers.utils.parseUnits(document.getElementById("amountInput").value || "0", 18);
  const erc20 = new ethers.Contract(token, ["function approve(address,uint256)"], signer);
  const tx = await erc20.approve(splitter.address, amt);
  log("Approve tx sent");
  await tx.wait();
  log("Approve confirmed");
};

document.getElementById("executeBtn").onclick = async () => {
  document.getElementById("coinSound").play();

  const token = document.getElementById("tokenAddress").value;
  const amount = ethers.utils.parseUnits(document.getElementById("amountInput").value || "0", 18);

  const recEls = [...document.querySelectorAll(".recipient")];
  const rec = [];
  const pct = [];
  let total = 0;

  recEls.forEach(r => {
    const a = r.children[0].value;
    const p = parseInt(r.children[1].value);
    if (a && p) {
      rec.push(a);
      pct.push(p);
      total += p;
    }
  });

  if (total !== 100) return alert("Percentages must equal 100");

  const tx = await splitter.splitToken(token, amount, rec, pct);
  log("Split tx sent");
  await tx.wait();
  log("Split completed");
};
