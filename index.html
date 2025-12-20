<!-- index.html (FULL OVERWRITE) -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ZEPHENHEL CITADEL</title>
  <link rel="stylesheet" href="./styles.css" />
  <script src="https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js"></script>
</head>
<body>

  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <div class="brand-badge">Z</div>
        <div class="brand-text">
          <h1>ZEPHENHEL CITADEL</h1>
          <p>Tri-Chain Distribution Console • BSC • Ethereum • Polygon</p>
        </div>
      </div>

      <div class="pills">
        <div class="pill net" id="pillNet">THEATER: —</div>
        <div class="pill wallet" id="pillWallet">NODE: DISCONNECTED</div>

        <div class="console-led" title="System health">
          <span class="led-dot" id="ledDot"></span>
          <span id="ledText">STANDBY</span>
        </div>

        <div class="radar off" id="radar" title="Radar sweep"></div>

        <button class="btn ghost" id="btnSwitch" title="Switch network">SWITCH THEATER</button>
        <button class="btn gold" id="btnConnect">LINK NODE</button>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="warframe">
      <div class="scanlines"></div>
      <div class="gridlines"></div>
      <div class="gloworb a"></div>
      <div class="gloworb b"></div>

      <div class="grid">
        <!-- LEFT: COMMAND -->
        <section class="card">
          <div class="card-title">
            <h2>PAYLOAD COMMAND</h2>
            <div class="badge">CITADEL</div>
          </div>

          <div class="label">THEATER (CHAIN)</div>
          <select id="selChain">
            <option value="bsc">BNB CHAIN</option>
            <option value="eth">ETHEREUM</option>
            <option value="polygon">POLYGON</option>
          </select>

          <div class="hr"></div>

          <div class="label">OPERATION MODE</div>
          <select id="selMode">
            <option value="token">TOKEN DISTRIBUTION (ERC20/BEP20)</option>
            <option value="native">NATIVE DISTRIBUTION (BNB/ETH/MATIC)</option>
          </select>
          <div class="small" id="modeHint">
            Token mode: ARM CONTRACT → DEPLOY PAYLOAD. Fee is applied inside the splitter.
          </div>

          <div class="hr"></div>

          <div id="tokenBlock">
            <div class="label">ASSET CONTRACT (TOKEN ADDRESS)</div>
            <input id="inpToken" placeholder="0x…" spellcheck="false" />
            <div class="small" id="tokenNote">
              Assets deliver on the SAME theater you execute on. (BSC USDC ≠ Ethereum USDC)
            </div>
          </div>

          <div class="row2">
            <div>
              <div class="label">PAYLOAD AMOUNT</div>
              <input id="inpAmount" placeholder="0.0" inputmode="decimal" />
              <div class="small" id="gasHint">
                NATIVE MAX reserves gas automatically. Token mode uses exact token amount.
              </div>
            </div>

            <div class="miniCard">
              <div class="miniTitle">INTEL ESTIMATE</div>
              <div class="miniValue" id="usdEst">—</div>
              <div class="miniSub" id="postFeeLine">Post-fee delivery —</div>
              <div class="miniSub2">Platform fee: <span class="feeTiny">1%</span></div>
            </div>
          </div>

          <div class="btnRow">
            <button class="btn ghost" id="btnMax">MAX (GAS-SAFE)</button>
            <button class="btn ghost" id="btnNormalize">NORMALIZE VECTOR</button>
          </div>

          <div class="hr"></div>

          <div class="card-title" style="margin-bottom:6px;">
            <h2>TARGET MATRIX</h2>
            <div class="inlineBtns">
              <div class="pill" id="totalPill">VECTOR: —</div>
              <button class="btn ghost" id="btnAdd">+ ADD TARGET</button>
            </div>
          </div>

          <div class="small" style="margin-bottom:8px;">
            Allocation Vector uses share weights (e.g., 50/50). NORMALIZE VECTOR sets total to 100.
          </div>

          <div id="recipients"></div>

          <div class="btnRow">
            <button class="btn ghost" id="btnApprove">ARM CONTRACT</button>
            <button class="btn gold" id="btnExecute">DEPLOY PAYLOAD</button>
          </div>

          <div class="notice" id="tipBox">
            ⚠️ Funds deliver on the active theater. Recipients must view the same chain in their wallet.
          </div>

          <div class="error" id="errBox" style="display:none;"></div>

          <div class="footer-note">Always test small first. Citadel is non-custodial and chain-honest.</div>
        </section>

        <!-- RIGHT: TELEMETRY -->
        <section class="card">
          <div class="card-title">
            <h2>LIVE TELEMETRY</h2>
            <label class="soundToggle">
              <input type="checkbox" id="chkSound" checked />
              <span>SOUND FX</span>
            </label>
          </div>

          <div class="teleGrid">
            <div class="teleBox">
              <div class="teleK">NODE BALANCE</div>
              <div class="teleV" id="teleNative">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">ASSET</div>
              <div class="teleV" id="teleSymbol">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">DECIMALS</div>
              <div class="teleV" id="teleDecimals">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">ASSET BALANCE</div>
              <div class="teleV" id="teleTokenBal">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">ALLOWANCE → SPLITTER</div>
              <div class="teleV" id="teleAllowance">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">ACTIVE SPLITTER</div>
              <div class="teleV mono" id="teleSplitter">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">FEE POLICY</div>
              <div class="teleV" id="teleFee">—</div>
            </div>
            <div class="teleBox">
              <div class="teleK">SYSTEM STATUS</div>
              <div class="teleV" id="teleStatus">Ready.</div>
            </div>
          </div>

          <div class="hr"></div>

          <div class="card-title" style="margin-bottom:6px;">
            <h2>MISSION DEBRIEF</h2>
            <div class="inlineBtns">
              <button class="btn ghost" id="btnAddToken">ADD TOKEN TO WALLET</button>
              <button class="btn ghost" id="btnViewTx">VIEW TX</button>
            </div>
          </div>

          <div class="notice" id="debrief" style="display:none;"></div>

          <div class="hr"></div>

          <div class="card-title" style="margin-bottom:6px;">
            <h2>RUNTIME LOG</h2>
            <div class="inlineBtns">
              <button class="btn ghost" id="btnRefresh">REFRESH</button>
              <button class="btn ghost" id="btnClear">CLEAR</button>
            </div>
          </div>

          <pre class="log" id="log"></pre>
          <div class="footer-note">Telemetry updates on LINK NODE, asset load, ARM, DEPLOY.</div>
        </section>
      </div>
    </div>
  </main>

  <!-- CONFIRM MODAL -->
  <div id="modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:9999;">
    <div style="max-width:720px; margin:7vh auto; padding:16px;">
      <div class="card" style="border-color: rgba(245,196,77,.22);">
        <div class="card-title">
          <h2>CONFIRM DEPLOYMENT</h2>
          <button class="btn ghost" id="btnModalClose">CANCEL</button>
        </div>

        <div class="notice" id="modalBody"></div>

        <div class="hr"></div>

        <label style="display:flex; gap:10px; align-items:center; font-size:12px; color:rgba(255,255,255,.75);">
          <input type="checkbox" id="chkAcknowledge" />
          I understand funds deliver on this theater (chain) and recipients must view the same network.
        </label>

        <div class="btnRow" style="margin-top:12px;">
          <button class="btn ghost" id="btnModalBack">BACK</button>
          <button class="btn gold" id="btnModalConfirm">CONFIRM & DEPLOY</button>
        </div>
      </div>
    </div>
  </div>

  <script src="./app.js"></script>
</body>
</html>
