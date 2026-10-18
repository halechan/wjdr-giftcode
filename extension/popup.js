const DEFAULT_SALT = "Uiv#87#SPan.ECsp";
const GIFT_URL = "https://wjdr-giftcode.wjdr.cn/";
const API_URL = "https://wjdr-giftcode-api.campfiregames.cn/api/gift_code";
const ERR_ALREADY_DONE = new Set([40008, 20000]);
const ERR_TIME_EXPIRED = 40004;
const MAX_RETRIES = 5;

let accounts = [];
let records = {};
let isRunning = false;
let targetTabId = null;

function pyQuote(str) {
  let result = '';
  for (const ch of str) {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) {
      result += ch;
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) {
        result += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return result;
}

function buildSign(cdk, fid, kid, timestamp, salt) {
  const cdkEncoded = pyQuote(cdk);
  const raw = `cdk=${cdkEncoded}&fid=${fid}&kid=${kid}&time=${timestamp}${salt}`;
  return md5(raw);
}

async function ensureTargetTab() {
  const tabs = await chrome.tabs.query({ url: 'https://wjdr-giftcode.wjdr.cn/*' });
  if (tabs.length > 0) {
    targetTabId = tabs[0].id;
    return;
  }
  const tab = await chrome.tabs.create({ url: GIFT_URL, active: false });
  targetTabId = tab.id;
  await new Promise(r => {
    const listener = (id, info) => {
      if (id === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        r();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(r, 3000);
  });
}

async function exchangeGift(cdk, fid, kid, salt) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = buildSign(cdk, fid, kid, timestamp, salt);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    world: 'MAIN',
    func: async (apiUrl, sign, fid, cdk, kid, timestamp) => {
      const body = new URLSearchParams({ sign, fid, cdk, kid, time: String(timestamp) });
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      return resp.json();
    },
    args: [API_URL, sign, fid, cdk, kid, timestamp],
  });

  return result;
}

function makeKey(cdk, fid, kid) {
  return `${cdk}|${fid}|${kid}`;
}

function isAlreadyDone(cdk, fid, kid) {
  for (const record of (records[cdk] || [])) {
    if (record.fid === fid && record.kid === kid) {
      const errCode = record.result && record.result.err_code;
      return ERR_ALREADY_DONE.has(errCode);
    }
  }
  return false;
}

function saveRecord(cdk, fid, kid, result) {
  const list = records[cdk] = records[cdk] || [];
  let found = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].fid === fid && list[i].kid === kid) {
      list[i] = { kid, fid, result };
      found = true;
      break;
    }
  }
  if (!found) list.push({ kid, fid, result });
  persistRecords();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg, level = 'info') {
  const area = document.getElementById('logArea');
  const cls = level === 'warn' ? 'log-warn' : level === 'error' ? 'log-error' : level === 'skip' ? 'log-skip' : 'log-info';
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + cls;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${msg}`;
  area.appendChild(entry);
  area.scrollTop = area.scrollHeight;
}

function setStatus(text, running = false) {
  const status = document.getElementById('statusBar');
  status.textContent = text;
  status.className = 'status' + (running ? ' running' : '');
}

function renderAccounts() {
  const tbody = document.getElementById('accountsBody');
  tbody.innerHTML = '';
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${a.fid}</td>
      <td>${a.kid}</td>
      <td>${a.name || ''}</td>
      <td class="row-actions"><button data-idx="${i}">✕</button></td>
    `;
    tr.querySelector('button').onclick = () => { accounts.splice(i, 1); persistAccounts(); renderAccounts(); };
    tbody.appendChild(tr);
  }
  document.getElementById('accountCount').textContent = `${accounts.length} 个账号`;
}

function parseCdks() {
  const raw = document.getElementById('cdkInput').value.trim();
  if (!raw) return [];
  return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

async function persistAccounts() {
  try { await chrome.storage.local.set({ accounts }); } catch (e) { console.warn(e); }
}

async function persistRecords() {
  try { await chrome.storage.local.set({ records }); } catch (e) { console.warn(e); }
}

async function run() {
  const cdks = parseCdks();
  const salt = document.getElementById('saltInput').value || DEFAULT_SALT;
  const interval = Math.max(0, parseInt(document.getElementById('intervalInput').value) || 5);

  if (accounts.length === 0) { log('请先添加账号', 'error'); return; }
  if (cdks.length === 0) { log('请先输入 CDK', 'error'); return; }

  isRunning = true;
  document.getElementById('btnStart').classList.add('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  setStatus('准备目标页面...', true);

  try {
    await ensureTargetTab();
  } catch (e) {
    log('无法打开目标页面: ' + e.message, 'error');
    setStatus('错误');
    isRunning = false;
    document.getElementById('btnStart').classList.remove('hidden');
    document.getElementById('btnStop').classList.add('hidden');
    return;
  }

  try { await chrome.storage.local.set({ salt }); } catch (e) {}

  let skipped = 0, processed = 0;
  const total = accounts.length * cdks.length;
  let doneCount = 0;

  log(`开始兑换: ${cdks.length} CDK × ${accounts.length} 账号 = ${total} 组合`);

  for (const account of accounts) {
    for (const cdk of cdks) {
      if (!isRunning) { log('用户停止', 'warn'); setStatus('已停止'); return; }

      const { fid, kid, name } = account;
      const key = makeKey(cdk, fid, kid);

      if (isAlreadyDone(cdk, fid, kid)) {
        log(`SKIP (already done): ${key}|${name}`, 'skip');
        skipped++; doneCount++;
        setStatus(`跳过:${skipped} 已处理:${processed} 总:${doneCount}/${total}`, true);
        continue;
      }

      let success = false;
      for (let attempt = 1; attempt <= MAX_RETRIES && isRunning; attempt++) {
        try {
          const result = await exchangeGift(cdk, fid, kid, salt);
          log(`[${attempt}/${MAX_RETRIES}] ${key}|${name} -> ${JSON.stringify(result)}`);
          const errCode = result.err_code;

          if (errCode === ERR_TIME_EXPIRED) {
            log('time Expired, retrying...', 'warn');
            await sleep(4000 + Math.random() * 6000);
            continue;
          }

          saveRecord(cdk, fid, kid, result);
          processed++;
          success = true;
          break;
        } catch (e) {
          log(`request error: ${e.message}`, 'error');
          await sleep(1000);
        }
      }

      if (!success && isRunning) {
        log(`FAILED after ${MAX_RETRIES} retries: ${key}`, 'error');
      }

      doneCount++;
      setStatus(`跳过:${skipped} 已处理:${processed} 总:${doneCount}/${total}`, true);

      if (isRunning) await sleep(interval * 1000 + Math.random() * 2000);
    }
  }

  isRunning = false;
  document.getElementById('btnStart').classList.remove('hidden');
  document.getElementById('btnStop').classList.add('hidden');
  log(`完成。跳过: ${skipped}, 已处理: ${processed}`);
  setStatus(`完成 - 跳过:${skipped} 处理:${processed}`);
}

function stop() {
  isRunning = false;
}

function exportJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    try {
      const data = await chrome.storage.local.get(['accounts', 'records', 'salt']);
      accounts = data.accounts || [];
      records = data.records || {};
      document.getElementById('saltInput').value = data.salt || DEFAULT_SALT;
    } catch (e) {
      console.warn('storage init failed:', e);
      document.getElementById('saltInput').value = DEFAULT_SALT;
    }
    renderAccounts();
  })();

  document.getElementById('btnAddAccount').onclick = () => {
    const fid = document.getElementById('newFid').value.trim();
    const kid = document.getElementById('newKid').value.trim();
    const name = document.getElementById('newName').value.trim();
    if (!fid || !kid) return;
    accounts.push({ fid, kid, name });
    persistAccounts();
    renderAccounts();
    document.getElementById('newFid').value = '';
    document.getElementById('newKid').value = '';
    document.getElementById('newName').value = '';
  };

  document.getElementById('btnImportAccounts').onclick = () => {
    document.getElementById('fileAccounts').click();
  };
  document.getElementById('fileAccounts').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : (data.accounts || []);
      accounts = list.filter(a => a.fid && a.kid);
      persistAccounts();
      renderAccounts();
      log(`导入 ${accounts.length} 个账号`);
    } catch (err) {
      log('JSON 解析失败: ' + err.message, 'error');
    }
  };

  document.getElementById('btnExportAccounts').onclick = () => {
    exportJson(accounts, `accounts-${Date.now()}.json`);
  };

  document.getElementById('btnStart').onclick = run;
  document.getElementById('btnStop').onclick = stop;
  document.getElementById('btnClearLog').onclick = () => {
    document.getElementById('logArea').innerHTML = '';
  };
  document.getElementById('btnExportRecords').onclick = () => {
    exportJson(records, `records-${Date.now()}.json`);
  };
});