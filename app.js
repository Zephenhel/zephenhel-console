/* Zephenhel Console — GitHub Pages safe build
   - Connect wallet only on button click
   - Works with MetaMask
   - Split BNB + Split ERC20 by direct transfers
*/

const $ = (id) => document.getElementById(id);

let provider = null;
let signer = null;
let currentAccount = null;

const BSC = {
  chainIdHex: "0x38", // 56
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org/"],
  blockExplorerUrls: ["https://bscscan.com/"],
};

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint amount) returns (bool)",
];

function log(msg) {
  const el = $("log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.textContent = line + el.textContent;
}

function setWalletPill(connected) {
  const pill = $("pillWallet");
  if (connected) {
    pill.classList.remove("warn");
    pill.classList.add("ok");
    pill.innerHTML = `Wallet: <b>${short(currentAccount)}</b>`;
  } else {
    pill.classList.remove("ok");
    pill.classList.add("warn");
    pill.innerHTML = `Wallet: <b>Disconnected</b>`;
  }
}

function setNetworkPill(name, chainId) {
  $("pillNetwork").innerHTML = `Network: <b>${name}</b> <span class="muted">(${chainId})</span>`;
}

function short(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function parseRecipients(text) {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const recipients = lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length !== 2) throw new Error(`Bad line: "${line}" (use: address | percent)`);
    const address = parts[0];
    const percent = Number(parts[1]);
    if (!window.ethers.utils.isAddress(address)) throw new Error(`Invalid address: ${address}`);
    if (!Number.isFinite(percent) || percent <= 0) throw new Error(`Invalid percent on: "${line}"`);
    return { address, percent };
  });

  const total = recipients.reduce((a, r) => a + r.percent, 0);
  if (Math.abs(total - 100) > 0.0001) throw new Error(`Percents must total 100. Current total: ${total}`);
  return recipients;
}

async function refreshNetwork() {
  try {
    if (!window.ethereum) {
      setNetworkPill("No wallet", "—");
      return;
    }
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    const name = chainId === BSC.chainIdHex ? "BSC" : "Other";
    setNetworkPill(name, chainId);
  } catch (e) {
    setNetworkPill("Unknown", "—");
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    log("MetaMask not detected. Install/enable it, then refresh.");
    alert("MetaMask not detected. Install it and refresh.");
    return;
  }

  try {
    log("Requesting wallet connection…");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    currentAccount = accounts?.[0] || null;

    provider = new window.ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();

    setWalletPill(true);
    log(`Connected: ${currentAccount}`);

    await refreshNetwork();
  } catch (e) {
    log(`Connect failed: ${e.message || e}`);
    setWalletPill(false);
  }
}

async function switchToBsc() {
  if (!window.ethereum) {
    log("No wallet available for network switch.");
    return;
  }
  try {
    log("Switching network to BSC…");
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC.chainIdHex }],
    });
    await refreshNetwork();
    log("Switched to BSC.");
  } catch (e) {
    // If chain not added
    if (e?.code === 4902) {
      try {
        log("BSC not added to wallet. Adding…");
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [BSC],
        });
        await refreshNetwork();
        log("BSC added + selected.");
      } catch (e2) {
        log(`Add chain failed: ${e2.message || e2}`);
      }
    } else {
      log(`Switch failed: ${e.message || e}`);
    }
  }
}

async function splitNative() {
  if (!signer) {
    alert("Connect wallet first.");
    log("Split BNB blocked: wallet not connected.");
    return;
  }

  const amtStr = $("nativeAmount").value.trim();
  const recipients = parseRecipients($("recipients").value);

  if (!amtStr) throw new Error("Enter total BNB amount.");

  const totalWei = window.ethers.utils.parseEther(amtStr);
  log(`Preparing BNB split. Total: ${amtStr} BNB across ${recipients.length} recipients.`);

  const ok = confirm(
    `This will send ${amtStr} BNB split across ${recipients.length} recipients.\n\nThis creates ${recipients.length} transactions.\n\nContinue?`
  );
  if (!ok) {
    log("User cancelled BNB split.");
    return;
  }

  for (const r of recipients) {
    const sendWei = totalWei.mul(Math.round(r.percent * 10000)).div(1000000); // percent w/ 2 decimals safe-ish
    // NOTE: rounding: last tx may be slightly off; handle by sending remainder at end
    r._wei = sendWei;
  }

  // Fix remainder by adjusting last recipient
  const sumWei = recipients.reduce((a, r) => a.add(r._wei), window.ethers.BigNumber.from(0));
  const remainder = totalWei.sub(sumWei);
  recipients[recipients.length - 1]._wei = recipients[recipients.length - 1]._wei.add(remainder);

  for (const r of recipients) {
    const bnb = window.ethers.utils.formatEther(r._wei);
    log(`Sending ${bnb} BNB to ${short(r.address)} (${r.percent}%)…`);
    const tx = await signer.sendTransaction({
      to: r.address,
      value: r._wei,
    });
    log(`Tx sent: ${tx.hash}`);
    await tx.wait();
    log(`Confirmed: ${tx.hash}`);
  }

  log("BNB split complete ✅");
  alert("BNB split complete ✅");
}

async function splitErc20() {
  if (!signer) {
    alert("Connect wallet first.");
    log("Split ERC20 blocked: wallet not connected.");
    return;
  }

  const tokenAddr = $("tokenAddress").value.trim();
  const amtStr = $("tokenAmount").value.trim();
  const recipients = parseRecipients($("recipients").value);

  if (!window.ethers.utils.isAddress(tokenAddr)) throw new Error("Enter a valid token contract address.");
  if (!amtStr) throw new Error("Enter total token amount.");

  const token = new window.ethers.Contract(tokenAddr, ERC20_ABI, signer);

  let decimals = 18;
  let symbol = "TOKEN";
  try {
    decimals = await token.decimals();
    symbol = await token.symbol();
  } catch (_) {}

  const totalUnits = window.ethers.utils.parseUnits(amtStr, decimals);

  log(`Preparing ${symbol} split. Total: ${amtStr} ${symbol} across ${recipients.length} recipients.`);

  const ok = confirm(
    `This will send ${amtStr} ${symbol} split across ${recipients.length} recipients.\n\nThis creates ${recipients.length} token transfer transactions.\n\nContinue?`
  );
  if (!ok) {
    log("User cancelled ERC20 split.");
    return;
  }

  for (const r of recipients) {
    const sendUnits = totalUnits.mul(Math.round(r.percent * 10000)).div(1000000);
    r._units = sendUnits;
  }

  // Fix remainder on last recipient
  const sumUnits = recipients.reduce((a, r) => a.add(r._units), window.ethers.BigNumber.from(0));
  const remainder = totalUnits.sub(sumUnits);
  recipients[recipients.length - 1]._units = recipients[recipients.length - 1]._units.add(remainder);

  for (const r of recipients) {
    const amountOut = window.ethers.utils.formatUnits(r._units, decimals);
    log(`Sending ${amountOut} ${symbol} to ${short(r.address)} (${r.percent}%)…`);
    const tx = await token.transfer(r.address, r._units);
    log(`Tx sent: ${tx.hash}`);
    await tx.wait();
    log(`Confirmed: ${tx.hash}`);
  }

  log(`${symbol} split complete ✅`);
  alert(`${symbol} split complete ✅`);
}

function wireEvents() {
  $("btnConnect").addEventListener("click", async () => {
    try { await connectWallet(); } catch (e) { log(e.message || e); }
  });

  $("btnSwitchBsc").addEventListener("click", async () => {
    try { await switchToBsc(); } catch (e) { log(e.message || e); }
  });

  $("btnSplitNative").addEventListener("click", async () => {
    try { await splitNative(); } catch (e) { log(`Split BNB error: ${e.message || e}`); alert(e.message || e); }
  });

  $("btnSplitErc20").addEventListener("click", async () => {
    try { await splitErc20(); } catch (e) { log(`Split ERC20 error: ${e.message || e}`); alert(e.message || e); }
  });

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accounts) => {
      currentAccount = accounts?.[0] || null;
      if (currentAccount) {
        setWalletPill(true);
        log(`Account changed: ${currentAccount}`);
      } else {
        setWalletPill(false);
        log("Account disconnected.");
      }
    });

    window.ethereum.on("chainChanged", async () => {
      await refreshNetwork();
      log("Network changed.");
    });
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  log("Console boot: DOM loaded.");
  setWalletPill(false);
  await refreshNetwork();
  wireEvents();
  log("Ready. Click CONNECT WALLET.");
});
