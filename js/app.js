import { createStore, setHashParams, hashParams } from "./data.js";
import { drawEquity, drawCandles, drawScoreRing } from "./charts.js";

const BOT_COLOR = {
  scanner: "#64d2ff",
  analyst: "#ffd60a",
  brain: "#bf5af2",
  executor: "#00d35a",
  risk: "#ff6b9a",
};
const BOT_TITLE = { scanner: "Scanner", analyst: "Analyst", brain: "Brain", executor: "Executor", risk: "Risk" };
const TABS = ["home", "bots", "activity", "account"];
const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];

const store = createStore();
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let range = "LIVE";
let retryIn = 15;
let retryTimer = 0;
let toastTimer = 0;
let screenUrls = [null, null];
let screenIdx = 0;
let lastBalance = null;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function clean(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function fmtUsd(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function fmtPct(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(digits) + "%";
}

function fmtMult(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(2) + "×";
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts);
  if (!Number.isFinite(d)) return "";
  return new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function ago(ts) {
  if (!ts) return "";
  const d = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts);
  if (!Number.isFinite(d)) return "";
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 1) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function go(page, mint) {
  setHashParams((h) => {
    h.set("page", page);
    if (mint) h.set("mint", mint);
    else h.delete("mint");
  });
  render();
}

function paperBadge(mode) {
  return (mode || "PAPER").toUpperCase() === "PAPER" ? `<span class="paper-pill">PAPER</span>` : "";
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
}

function writeNote() {
  if (store.writable) return "";
  return `<p class="note">Changes from Telegram (step 11)</p>`;
}

/* ---------- icons ---------- */
function ico(name) {
  const icons = {
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5" stroke-linecap="round"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 20a2 2 0 0 0 4 0" stroke-linecap="round"/></svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11.5L12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>`,
    bots: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="7" width="16" height="12" rx="3"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/><path d="M9 4h6" stroke-linecap="round"/></svg>`,
    activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 14l4-4 3 3 5-7 4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    account: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" stroke-linecap="round"/></svg>`,
  };
  return icons[name] || "";
}

/* ---------- odometer ---------- */
function renderOdometer(el, value) {
  const text = fmtUsd(value);
  const prev = lastBalance == null ? text : fmtUsd(lastBalance);
  lastBalance = value;
  if (reduced) {
    el.textContent = text;
    return;
  }
  el.innerHTML = "";
  [...text].forEach((ch, i) => {
    const wrap = document.createElement("span");
    wrap.className = "ch";
    if (!/\d/.test(ch)) {
      wrap.textContent = ch;
      el.appendChild(wrap);
      return;
    }
    const col = document.createElement("b");
    col.innerHTML = "0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9";
    const from = /\d/.test(prev[i] || "") ? Number(prev[i]) : 0;
    const to = Number(ch);
    col.style.transform = `translateY(-${from}em)`;
    wrap.appendChild(col);
    el.appendChild(wrap);
    requestAnimationFrame(() => {
      setTimeout(() => { col.style.transform = `translateY(-${to}em)`; }, i * 30);
    });
  });
}

/* ---------- screen card ---------- */
async function refreshScreen(frameEl, state) {
  if (!frameEl) return;
  const offline = $(".screen-offline", frameEl);
  const live = $(".live-tag", frameEl.parentElement) || $(".live-tag");
  const info = (state && state.screen) || {};
  let blob = null;
  try { blob = await store.fetchScreenBlob(); } catch { blob = null; }
  if (blob && blob.size > 32) {
    const url = URL.createObjectURL(blob);
    const imgs = $$("img", frameEl);
    const next = (screenIdx + 1) % 2;
    const img = imgs[next] || imgs[0];
    const old = imgs[screenIdx];
    img.onload = () => {
      img.classList.add("show");
      if (old && old !== img) {
        old.classList.remove("show");
        if (screenUrls[screenIdx]) URL.revokeObjectURL(screenUrls[screenIdx]);
      }
      screenUrls[next] = url;
      screenIdx = next;
    };
    img.src = url;
    if (offline) offline.hidden = true;
  } else if (offline) {
    offline.hidden = false;
  }
  const age = info.ageS != null ? info.ageS : (info.updated ? Math.round(Date.now() / 1000 - (info.updated < 1e12 ? info.updated : info.updated / 1000)) : null);
  const liveEl = frameEl.querySelector(".live-tag");
  if (liveEl) {
    const fresh = blob && age != null && age < 5;
    liveEl.innerHTML = fresh
      ? `<i class="dot live"></i> Live · Bot's computer`
      : `<i class="dot"></i> Last frame${info.updated || age != null ? " " + (age != null ? ago(Date.now() / 1000 - (age || 0)) : fmtTime(info.updated)) : ""}`;
  }
}

function laneLabel(lane) {
  if (!lane || !lane.bot || lane.action === "Idle") {
    return `<span class="lane-tag dim">Idle</span>`;
  }
  const color = lane.color || BOT_COLOR[lane.bot] || "#fff";
  return `<span class="lane-tag" style="color:${color}">${esc(lane.label || (BOT_TITLE[lane.bot] + " · " + lane.action))}</span>`;
}

function checkIcons(checks) {
  if (!checks) return "";
  const one = (k, label) => {
    const v = checks[k];
    const cls = v === true ? "ok" : v === false ? "no" : "";
    const mark = v === true ? "✓" : v === false ? "!" : "·";
    return `<span class="check ${cls}" title="${label}">${mark}</span>`;
  };
  return `<span class="checks">${one("screen", "screen")}${one("api", "api")}${one("chain", "chain")}</span>`;
}

function fomoLink(link, label = "Open on FOMO") {
  if (!link) return "";
  return `<a class="open-fomo" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

/* ---------- activity row ---------- */
function activityRow(a) {
  const kind = a.kind || "";
  const rightCls = kind === "sold" || (a.value && String(a.value).startsWith("+")) ? "up"
    : kind === "stopped" || (a.value && String(a.value).startsWith("-")) ? "dn"
    : kind === "rejected" ? "skip" : "";
  const right = kind === "rejected" ? "Skipped" : esc(a.value || "");
  const page = a.href === "audit" || kind === "rejected" ? "audit" : "coin";
  const tap = a.mint ? `data-go="${page}" data-mint="${esc(a.mint)}"` : "";
  return `<div class="row act" ${tap}>
    <div class="left">
      <div class="title">${esc(clean(a.title))}</div>
      <div class="sub">${esc([clean(a.subtitle), fmtTime(a.ts)].filter(Boolean).join(" · "))}</div>
      ${fomoLink(a.link)}
    </div>
    <div class="right ${rightCls}">${right}</div>
  </div>`;
}

/* ---------- bot cards ---------- */
function botCard(b) {
  const color = b.color || BOT_COLOR[b.name] || "#fff";
  let body = "";
  if (b.name === "scanner") {
    const killed = b.detail && String(b.detail).startsWith("killed");
    body = killed
      ? `<div class="detail"><span class="killed">${esc(clean(b.label))}</span><span class="kill-reason">${esc(clean(b.detail))}</span></div>`
      : `<div class="detail">${esc(clean(b.detail || "feed"))}</div>`;
  } else if (b.name === "analyst") {
    const layers = (b.layers && b.layers.length ? b.layers : Array.from({ length: 8 }, (_, i) => ({ n: i + 1, pass: null })));
    body = `<div class="layer-grid">${layers.slice(0, 8).map((l) =>
      `<div class="layer-strip ${l.pass === true ? "ok" : l.pass === false ? "no" : ""}"></div>`
    ).join("")}</div>
      <div class="score-row">
        <canvas class="score-ring" width="44" height="44" data-score="${b.score ?? ""}"></canvas>
        <div class="detail">${esc(clean(b.detail || "Social: off"))}</div>
      </div>`;
  } else if (b.name === "brain") {
    body = `<div class="detail">${esc(clean(b.detail || "80+ = full size / under 80 = half size"))}</div>`;
  } else if (b.name === "executor") {
    body = `<div class="exec-bar">${esc(clean(b.detail || "Idle"))}</div>`;
  } else if (b.name === "risk") {
    const pills = (b.pills || []).map((p) => `<span class="pill ${esc(p.tone || "")}">${esc(p.label)}</span>`).join("");
    body = `<div class="pills">${pills}</div>`;
  }
  return `<article class="bot-card" data-bot="${esc(b.name)}">
    <div class="who"><i class="swatch" style="background:${color}"></i> ${esc(b.title || BOT_TITLE[b.name])}</div>
    <div class="label" style="color:${color}">${esc(clean(b.label || b.title))}</div>
    ${body}
  </article>`;
}

function decisionLine(bot, d) {
  let title = d.title || d.reason || d.verdict || d.status || "Decision";
  let sub = d.subtitle || d.reason || "";
  let right = d.value || (d.score != null ? String(d.score) : d.verdict || d.status || "");
  if (bot === "scanner") {
    title = d.verdict === "kill" ? "Killed" : d.verdict === "pass" ? "Passed" : (d.verdict || "Scan");
    sub = d.reason || "";
    right = d.liquidityUsd != null ? fmtUsd(d.liquidityUsd, 0) : "";
  } else if (bot === "analyst") {
    title = d.passed ? "Passed" : "Rejected";
    sub = d.reason || "";
    right = d.score != null ? String(Math.round(d.score)) : "";
  } else if (bot === "executor") {
    title = (d.side === "sell" ? "Sold" : "Bought");
    sub = d.reason || d.status || "";
    right = d.usd != null ? fmtUsd(d.usd) : "";
  }
  return `<div class="row">
    <div class="left">
      <div class="title">${esc(clean(title))}</div>
      <div class="sub">${esc([clean(sub), fmtTime(d.ts)].filter(Boolean).join(" · "))}</div>
      ${fomoLink(d.link)}
    </div>
    <div class="right">${esc(right)}</div>
  </div>`;
}

/* ---------- skeletons / empty / locked ---------- */
function skeletonHome() {
  return `<div class="page gutter" data-state="loading">
    <div class="skel skel-balance"></div>
    <div class="skel" style="height:18px;width:40%;margin:8px 0 16px"></div>
    <div class="skel skel-chart"></div>
    <div class="skel skel-screen" style="margin-top:12px"></div>
    <div class="skel" style="height:22px;width:50%;margin:20px 0 10px"></div>
    <div class="skel skel-card"></div>
  </div>`;
}

function pageNav(title, extra = "") {
  return `<div class="pagenav">
    <button class="icon-btn" data-go="home" aria-label="Back">${ico("back")}</button>
    <div class="title">${title}${extra}</div>
  </div>`;
}

/* ---------- screens ---------- */
function viewHome(state) {
  const mode = (state.mode || "PAPER").toUpperCase();
  const today = state.todayPct || 0;
  const up = today >= 0;
  const bots = state.bots || [];
  const running = bots.filter((b) => b.status === "running").length;
  const act = state.activity || [];
  const hasTrade = act.some((a) => a.kind === "bought" || a.kind === "sold" || a.kind === "stopped") || (state.positions || []).length;
  const last = state.lastOrder;
  const bell = last && last.status && last.status !== "done";
  return `
    <header class="topnav">
      <button class="icon-btn" data-go="account" aria-label="Account"><span class="avatar">GB</span></button>
      <div class="brand">Grok Bot <span>›</span></div>
      <button class="icon-btn" id="btn-search" aria-label="Search">${ico("search")}</button>
      <button class="icon-btn" id="btn-bell" aria-label="Alerts">${ico("bell")}<i class="bell-dot ${bell ? "on" : ""}"></i></button>
    </header>
    <div class="page">
      <div class="gutter balance-block">
        <div class="odometer" id="odometer"></div>
        <div class="balance-meta">
          <span class="${up ? "today-up" : "today-dn"}">${up ? "+" : ""}${Number(today).toFixed(2)}%</span>
          <span class="mult-pill ${up ? "" : "dn"}">${esc(fmtMult(state.multiplier))}</span>
          ${paperBadge(mode)}
        </div>
      </div>
      <div class="gutter">
        <div class="chart-wrap">
          <canvas id="equity-chart"></canvas>
          <div class="chart-marks" id="equity-marks"></div>
        </div>
        <div class="ranges" id="ranges">
          ${RANGES.map((r) => `<button data-range="${r}" class="${r === range ? "on" : ""}">${r}</button>`).join("")}
        </div>
        <div class="screen-card" id="screen-card">
          <div class="screen-frame" id="screen-frame">
            <img alt="Desk screen">
            <img alt="">
            <div class="screen-offline" hidden>
              <span class="dim">No frame published yet</span>
            </div>
            <div class="screen-chrome">
              <div class="live-tag"><i class="dot"></i> Last frame</div>
              ${laneLabel(state.lane)}
            </div>
          </div>
          <div class="order-row">
            <div>${last ? esc(last.label) : `<span class="muted">No orders yet</span>`}</div>
            ${last ? checkIcons(last.checks) : ""}
          </div>
        </div>
        <div class="updated-line" id="updated-line"></div>
        ${hasTrade ? "" : `<div class="empty" style="padding:28px 0 8px">Waiting for the first trade</div>`}
      </div>
      <div class="gutter section-h">Bots · ${running} running</div>
      <div class="carousel" id="bot-carousel">
        ${bots.map(botCard).join("") || `<div class="empty" style="padding:24px">No bots yet</div>`}
      </div>
      <div class="gutter section-h">Activity <button class="see" data-go="activity">See all</button></div>
      <div class="card gutter-card" style="margin:0 16px">
        ${hasTrade || act.length ? act.slice(0, 5).map(activityRow).join("") : `<div class="empty">Waiting for the first trade</div>`}
      </div>
    </div>`;
}

function viewBots(state, decisions) {
  const bots = state.bots || [];
  const posOpen = (state.positions || []).length > 0;
  return `
    <div class="pagenav"><div class="title" style="padding-right:0">Bots</div></div>
    <div class="page">
      ${bots.map((b) => {
        const locked = b.name === "risk" && (b.locked || posOpen);
        const frozen = locked || !store.writable;
        const dec = (decisions[b.name] || []).slice(0, 20);
        return `<section class="card bot-full">
          <div class="head">
            <i class="status-dot ${esc(b.status || "")}"></i>
            <div style="flex:1">
              <div class="title" style="color:${b.color || BOT_COLOR[b.name]}">${esc(b.title)}</div>
              <div class="sub muted">${esc(clean(b.label || ""))}${b.count != null ? " · today " + b.count : ""}</div>
            </div>
            <button class="switch ${b.paused ? "" : "on"} ${frozen ? "locked" : ""}"
              data-pause="${esc(b.name)}" ${frozen ? "disabled" : ""} aria-label="Pause ${esc(b.title)}"><i></i></button>
          </div>
          ${locked ? `<div class="note" style="text-align:left">Risk is locked while a position is open</div>` : ""}
          ${store.writable ? "" : writeNote()}
          <div class="decisions">${dec.map((d) => decisionLine(b.name, d)).join("") || `<div class="dim" style="padding:8px 0">No decisions yet</div>`}</div>
          <button class="open-fomo" data-go="account" data-jump="settings">Settings</button>
        </section>`;
      }).join("")}
    </div>`;
}

function viewActivity(rows) {
  const list = rows || [];
  return `
    <div class="pagenav"><div class="title" style="padding-right:0">Activity</div></div>
    <div class="page">
      <div class="card" style="margin:0 16px">
        ${list.length ? list.map(activityRow).join("") : `<div class="empty">Nothing yet tonight</div>`}
      </div>
    </div>`;
}

function viewCoin(coin, state) {
  if (!coin) return pageNav("Coin") + `<div class="empty">Unknown coin</div>`;
  const mode = (state && state.mode) || "PAPER";
  const chg = coin.changeSinceEntry;
  const pos = coin.position;
  const sellOn = store.writable && (coin.canSell || pos);
  return `
    ${pageNav(esc(clean(coin.symbol || coin.name || "Coin")), paperBadge(mode))}
    <div class="page gutter coin-head">
      <div class="name">${esc(clean(coin.name || coin.symbol || ""))}</div>
      <div class="meta">${esc(clean(coin.symbol || ""))} · ${esc(coin.chain || "Solana")} · ${esc(coin.age || "")}</div>
      ${coin.shield ? `<span class="shield">🛡 ${esc(coin.shield)}</span>` : ""}
      <div class="big-price num">${coin.price == null ? "—" : Number(coin.price).toLocaleString("en-US", { maximumFractionDigits: 8 })}</div>
      <div class="since ${chg >= 0 ? "today-up" : "today-dn"}">${chg == null ? "" : "▲ " + fmtPct(chg) + " since entry"}</div>
      <div class="chart-wrap" style="height:160px;margin:12px 0">
        <canvas id="candle-chart"></canvas>
      </div>
      <div class="stats">
        <div><div class="k">Market cap</div><div class="v">${coin.marketCap == null ? "—" : fmtUsd(coin.marketCap, 0)}</div></div>
        <div><div class="k">Liquidity</div><div class="v">${coin.liquidity == null ? "—" : fmtUsd(coin.liquidity, 0)}</div></div>
        <div><div class="k">Holders</div><div class="v">${coin.holders == null ? "—" : Number(coin.holders).toLocaleString()}</div></div>
      </div>
      ${pos ? `<div class="card pos-card">
        <div class="muted">Your position</div>
        <div style="font-weight:700;margin-top:4px">${fmtUsd(pos.sizeUsd)} in · ${esc(pos.bot || "Executor")}</div>
      </div>` : ""}
      <div class="actions">
        ${coin.link ? `<a class="btn primary" href="${esc(coin.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}
        <button class="btn danger ${sellOn ? "" : "disabled"}" id="btn-sell" ${sellOn ? "" : "disabled"}>Sell now</button>
      </div>
      ${sellOn ? "" : writeNote()}
    </div>`;
}

function viewAudit(audit) {
  if (!audit) return pageNav("Audit") + `<div class="empty">No audit yet</div>`;
  const layers = audit.layers || [];
  return `
    ${pageNav(esc(clean(audit.symbol || audit.name || "Audit")))}
    <div class="page">
      <div class="gutter">
        <div class="name" style="font-size:22px;font-weight:700">${esc(clean(audit.name || audit.symbol || ""))}</div>
        <div class="audit-stage">
          <div class="beam" id="audit-beam"></div>
          <div class="disc-row">
            ${layers.map((l) => `<div class="disc ${l.pass === true ? "ok" : l.pass === false ? "no" : ""}" data-n="${l.n}">${l.pass === true ? "✓" : l.pass === false ? "✕" : l.n}</div>`).join("")}
          </div>
        </div>
      </div>
      <div class="card layer-list" style="margin:0 16px">
        ${layers.map((l) => `<div class="row">
          <div class="n">${l.n}</div>
          <div class="left">
            <div class="title">${esc(l.name || "Layer " + l.n)}</div>
            <div class="sub">${esc(l.value || "")}</div>
          </div>
          <div class="right ${l.pass === true ? "up" : l.pass === false ? "dn" : ""}">${l.pass === true ? "✓" : l.pass === false ? "✕" : ""}</div>
        </div>`).join("")}
      </div>
      <div class="card social-row">${esc((audit.social && audit.social.label) || "Social: off")}</div>
      <div class="gutter">${fomoLink(audit.link)}</div>
    </div>`;
}

function viewAccount(account, settings) {
  const mode = ((account && account.mode) || "PAPER").toUpperCase();
  const st = (settings && settings.settings) || {};
  const groups = (settings && settings.groups) || {};
  const ranges = (settings && settings.ranges) || {};
  const choices = (settings && settings.choices) || {};
  const dis = store.writable ? "" : "disabled";
  const picks = (account && account.copyPicks) || st.copy_picks || "off";
  const picksTime = (account && account.copyPicksTime) || st.copy_picks_time || "09:00";
  const push = (account && account.push) || { plan: "B", connected: false, note: "Telegram only on plan B; web push comes later" };
  const groupHtml = Object.entries(groups).map(([g, keys]) => {
    const rows = keys.filter((k) => k !== "mode").map((k) => {
      if (k in choices) {
        return `<div class="slider-row">
          <div class="lab"><span>${esc(k)}</span></div>
          <select data-set="${esc(k)}" ${dis}>${choices[k].map((c) =>
            `<option value="${esc(c)}" ${String(st[k]) === String(c) ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        </div>`;
      }
      if (typeof st[k] === "string" && !ranges[k]) {
        return `<div class="slider-row">
          <div class="lab"><span>${esc(k)}</span></div>
          <input type="text" data-set="${esc(k)}" value="${esc(st[k] ?? "")}" ${dis}>
        </div>`;
      }
      const r = ranges[k] || { min: 0, max: 100 };
      const val = st[k] ?? "";
      const step = (Number(r.max) - Number(r.min) > 10) ? 1 : 0.1;
      return `<div class="slider-row">
        <div class="lab"><span>${esc(k)}</span>
          <input type="number" data-set="${esc(k)}" value="${esc(val)}" min="${r.min}" max="${r.max}" step="${step}" ${dis}>
        </div>
        <input type="range" data-set="${esc(k)}" value="${esc(val)}" min="${r.min}" max="${r.max}" step="${step}" ${dis}>
      </div>`;
    }).join("");
    return `<div class="group-title">${esc(g)}</div><div class="card">${rows}</div>`;
  }).join("");
  return `
    <div class="pagenav"><div class="title" style="padding-right:0">Account</div></div>
    <div class="page gutter">
      <div class="seg" id="mode-seg">
        <button data-mode="PAPER" class="${mode === "PAPER" ? "on" : ""}" ${dis}>PAPER</button>
        <button data-mode="LIVE" class="${mode === "LIVE" ? "on" : ""}" ${dis}>LIVE</button>
      </div>
      ${store.writable ? "" : writeNote()}
      <div class="field"><label>Cash</label><div class="num" style="font-size:22px;font-weight:700">${fmtUsd(account && account.cash)}</div></div>
      ${account && account.profileUrl
        ? `<a class="btn" href="${esc(account.profileUrl)}" target="_blank" rel="noopener noreferrer">Your FOMO profile</a>`
        : `<div class="field"><label>Your FOMO profile</label><div class="muted">No handle set</div></div>`}
      <button class="btn" id="btn-invite" data-url="${esc((account && account.signupUrl) || "")}" style="margin-top:10px">Invite a friend</button>
      <div class="group-title">Copy picks</div>
      <div class="card">
        <div class="slider-row">
          <div class="lab"><span>Schedule</span></div>
          <select data-set="copy_picks" ${dis}>
            ${["off", "24h", "12h", "6h"].map((c) => `<option value="${c}" ${picks === c ? "selected" : ""}>${c === "off" ? "off" : "every " + c}</option>`).join("")}
          </select>
        </div>
        <div class="slider-row">
          <div class="lab"><span>Time</span></div>
          <input type="time" data-set="copy_picks_time" value="${esc(picksTime)}" ${dis}>
        </div>
      </div>
      <div class="group-title">Pushes</div>
      <div class="card">
        <div class="row"><div class="left"><div class="title">${push.connected ? "Connected" : "Not connected"}</div>
          <div class="sub">${esc(push.note || "Telegram only on plan B")}</div></div></div>
        <div class="row"><button class="open-fomo" id="btn-test-push" ${store.writable ? "" : "disabled"}>Send test push</button></div>
      </div>
      <button class="btn" id="btn-watch" style="margin-top:12px">Watch in Grok Bot</button>
      <div id="settings-anchor">${groupHtml}</div>
    </div>`;
}

function viewLocked() {
  return `<div class="locked-page">
    <h1 style="color:#fff">Grok Bot</h1>
    <p>Locked. Open the app link from Telegram, or run locally against the desk.</p>
  </div>`;
}

function tabbar(page) {
  const items = [
    ["home", "Home"],
    ["bots", "Bots"],
    ["activity", "Activity"],
    ["account", "Account"],
  ];
  return items.map(([id, label]) =>
    `<button class="tab ${page === id ? "on" : ""}" data-go="${id}">${ico(id)}<span>${label}</span></button>`
  ).join("");
}

/* ---------- render ---------- */
async function render() {
  const main = $("#main");
  const bar = $("#tabbar");
  const page = store.page();
  const mint = store.mint();
  document.body.classList.toggle("offline", !!store.error && !!store.lastGood.state);
  if (store.mode === "locked") {
    main.innerHTML = viewLocked();
    bar.classList.add("hidden");
    main.classList.add("no-tabs");
    main.dataset.ready = "locked";
    return;
  }
  const state = store.cache.get("state") || store.lastGood.state;
  if (!state && !store.error) {
    main.innerHTML = skeletonHome();
    bar.innerHTML = tabbar("home");
    bar.classList.remove("hidden");
    main.dataset.ready = "loading";
    return;
  }
  if (!state && store.error) {
    main.innerHTML = `<div class="empty">Desk offline</div>`;
    bar.innerHTML = tabbar(page);
    main.dataset.ready = "error";
    updateOffline();
    return;
  }
  document.body.classList.toggle("has-demo", !!state.demo);
  $("#demo-banner").classList.toggle("show", !!state.demo);
  bar.innerHTML = tabbar(["coin", "audit"].includes(page) ? "" : page);
  bar.classList.toggle("hidden", ["coin", "audit"].includes(page));
  main.classList.toggle("no-tabs", ["coin", "audit"].includes(page));

  try {
    if (page === "home") {
      main.innerHTML = viewHome(state);
      renderOdometer($("#odometer"), state.balance);
      paintChart(state);
      refreshScreen($("#screen-frame"), state);
      paintRings(main);
    } else if (page === "bots") {
      const decisions = {};
      await Promise.all((state.bots || []).map(async (b) => {
        try { decisions[b.name] = (await store.load("bots/" + b.name)).decisions || []; }
        catch { decisions[b.name] = []; }
      }));
      main.innerHTML = viewBots(state, decisions);
    } else if (page === "activity") {
      let rows = [];
      try { rows = (await store.load("activity")).rows || []; }
      catch { rows = state.activity || []; }
      main.innerHTML = viewActivity(rows);
    } else if (page === "coin") {
      let coin = null;
      try { coin = await store.load("coin/" + mint, { force: true }); }
      catch { coin = null; }
      main.innerHTML = viewCoin(coin, state);
      const cnv = $("#candle-chart");
      if (cnv && coin) drawCandles(cnv, { candles: coin.candles || [], exitLine: coin.exitLine });
    } else if (page === "audit") {
      let audit = null;
      try { audit = await store.load("audit/" + mint, { force: true }); }
      catch { audit = null; }
      main.innerHTML = viewAudit(audit);
      requestAnimationFrame(() => runBeam());
    } else if (page === "account") {
      let account = {}, settings = {};
      try { account = await store.load("account"); } catch { account = { mode: state.mode, cash: state.cash }; }
      try { settings = await store.load("settings"); } catch { settings = { settings: {}, groups: {}, ranges: {}, choices: {} }; }
      main.innerHTML = viewAccount(account, settings);
    } else {
      main.innerHTML = viewHome(state);
    }
    updateUpdatedLine(state);
    main.dataset.ready = "ok";
    main.dataset.page = page;
  } catch (err) {
    main.dataset.ready = "error";
    updateOffline();
  }
  bind();
  updateOffline();
}

async function paintChart(state) {
  const cnv = $("#equity-chart");
  if (!cnv) return;
  let chart = { points: [], marks: [], startLine: state.night && state.night.startValue };
  try { chart = await store.load("chart/" + range, { force: true }); }
  catch { /* keep last */ }
  const { markPos } = drawEquity(cnv, {
    points: chart.points || [],
    marks: chart.marks || [],
    startLine: chart.startLine,
    reduced,
  });
  const box = $("#equity-marks");
  if (box) {
    box.innerHTML = (markPos || []).map((m) => {
      let label = m.label || "";
      if (m.kind === "sold") label = m.value || label;
      if (m.kind === "stopped") label = m.value ? m.value : label;
      return `<div class="chart-mark ${esc(m.color || m.kind)}" style="left:${m.x}px;top:${m.y}px">${esc(label)}</div>`;
    }).join("");
  }
}

function paintRings(root) {
  for (const c of $$("canvas.score-ring", root)) {
    const s = c.getAttribute("data-score");
    if (s) drawScoreRing(c, Number(s));
  }
}

function runBeam() {
  const beam = $("#audit-beam");
  const discs = $$(".disc");
  if (!beam || !discs.length) return;
  const row = discs[0].parentElement.getBoundingClientRect();
  const first = discs[0].getBoundingClientRect();
  const last = discs[discs.length - 1].getBoundingClientRect();
  beam.style.left = (first.left + first.width / 2 - row.left) + "px";
  const full = (last.left + last.width / 2) - (first.left + first.width / 2);
  beam.style.width = "0px";
  const go = () => { beam.style.transition = reduced ? "none" : "width 900ms ease-out"; beam.style.width = full + "px"; };
  requestAnimationFrame(go);
}

function updateUpdatedLine(state) {
  const el = $("#updated-line");
  if (!el || !state) return;
  const ts = store.lastGood.at || (state.updated ? (state.updated < 1e12 ? state.updated * 1000 : state.updated) : 0);
  const s = ts ? Math.max(0, Math.round((Date.now() - ts) / 1000)) : 0;
  el.textContent = ts ? `Updated ${s}s ago` : "";
}

function updateOffline() {
  const ban = $("#offline-banner");
  const state = store.lastGood.state;
  if (store.error && state) {
    const last = store.lastGood.at ? ago(store.lastGood.at) : (state.updated ? ago(state.updated) : "earlier");
    ban.innerHTML = `<div class="err-row">Desk offline · retrying in ${retryIn}s · last update ${esc(last)}</div>`;
    ban.classList.add("show");
    document.body.classList.add("offline");
  } else if (store.error && !state) {
    ban.innerHTML = `<div class="err-row">Desk offline · retrying in ${retryIn}s</div>`;
    ban.classList.add("show");
    document.body.classList.add("offline");
  } else {
    ban.classList.remove("show");
    document.body.classList.remove("offline");
  }
}

/* ---------- events ---------- */
function bind() {
  const main = $("#main");
  $$("[data-go]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      go(el.getAttribute("data-go"), el.getAttribute("data-mint") || undefined);
    });
  });
  $$("[data-range]").forEach((el) => {
    el.addEventListener("click", () => {
      range = el.getAttribute("data-range");
      $$("[data-range]").forEach((b) => b.classList.toggle("on", b === el));
      paintChart(store.cache.get("state") || store.lastGood.state || {});
    });
  });
  const searchBtn = $("#btn-search");
  if (searchBtn) searchBtn.addEventListener("click", openSearch);
  const screen = $("#screen-card");
  if (screen) screen.addEventListener("click", () => openScreenFs());
  $$("[data-pause]").forEach((el) => el.addEventListener("click", () => togglePause(el)));
  $$("[data-set]").forEach((el) => el.addEventListener("change", () => saveSetting(el)));
  const modeSeg = $("#mode-seg");
  if (modeSeg) modeSeg.addEventListener("click", onMode);
  const invite = $("#btn-invite");
  if (invite) invite.addEventListener("click", () => shareInvite(invite.getAttribute("data-url")));
  const sell = $("#btn-sell");
  if (sell) sell.addEventListener("click", openSell);
  const watch = $("#btn-watch");
  if (watch) watch.addEventListener("click", openScreenFs);
  const testPush = $("#btn-test-push");
  if (testPush) testPush.addEventListener("click", async () => {
    if (!store.writable) { toast("Changes from Telegram (step 11)"); return; }
    try { const r = await store.write("/api/push/test", {}); toast(r.ok ? "Sent to Telegram" : "Not sent"); }
    catch (err) { toast((err.body && err.body.detail) || "Not sent"); }
  });
  if (hashParams().get("jump") === "settings") {
    const a = $("#settings-anchor");
    if (a) a.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }
  void main;
}

async function togglePause(el) {
  if (!store.writable) { toast("Changes from Telegram (step 11)"); return; }
  const name = el.getAttribute("data-pause");
  const on = el.classList.contains("on"); // on = running
  try {
    await store.write(`/api/bots/${name}/${on ? "pause" : "resume"}`, {});
    await store.refreshState();
    render();
  } catch (err) {
    toast((err.body && err.body.detail) || err.message || "Could not change");
  }
}

async function saveSetting(el) {
  if (!store.writable) { toast("Changes from Telegram (step 11)"); return; }
  const key = el.getAttribute("data-set");
  const value = el.value;
  $$("[data-set='" + key + "']").forEach((n) => { if (n !== el) n.value = value; });
  try {
    await store.write("/api/settings", { [key]: value });
    toast("Saved " + key);
  } catch (err) {
    toast((err.body && err.body.detail) || "Could not save");
  }
}

async function onMode(e) {
  const btn = e.target.closest("[data-mode]");
  if (!btn) return;
  if (!store.writable) { toast("Changes from Telegram (step 11)"); return; }
  const mode = btn.getAttribute("data-mode");
  if (mode === "LIVE") {
    const typed = window.prompt("Type LIVE to switch to live trading.");
    if (typed !== "LIVE") return;
    try {
      await store.write("/api/mode", { mode: "LIVE", confirm: "LIVE" });
    } catch (err) {
      toast((err.body && err.body.detail) || "LIVE refused");
    }
    return;
  }
  try {
    await store.write("/api/mode", { mode: "PAPER" });
    await store.refreshState();
    render();
  } catch (err) {
    toast((err.body && err.body.detail) || "Could not change mode");
  }
}

async function shareInvite(url) {
  if (!url) return;
  if (navigator.share) {
    try { await navigator.share({ title: "FOMO", url }); return; } catch { /* fall through */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast(url);
  }
}

function openSell() {
  if (!store.writable) { toast("Changes from Telegram (step 11)"); return; }
  const mint = store.mint();
  const modal = $("#modal");
  modal.innerHTML = `<div class="sheet">
    <h3>Sell now</h3>
    <div class="pcts">
      <button data-pct="25">25%</button>
      <button data-pct="50">50%</button>
      <button data-pct="100" class="on">100%</button>
    </div>
    <button class="btn danger" id="confirm-sell">Confirm sell</button>
    <button class="btn" id="cancel-sell" style="margin-top:8px">Cancel</button>
  </div>`;
  modal.classList.add("on");
  let pct = 100;
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("on"); };
  $$("[data-pct]", modal).forEach((b) => b.addEventListener("click", () => {
    pct = Number(b.getAttribute("data-pct"));
    $$("[data-pct]", modal).forEach((x) => x.classList.toggle("on", x === b));
  }));
  $("#cancel-sell").addEventListener("click", () => modal.classList.remove("on"));
  $("#confirm-sell").addEventListener("click", async () => {
    try {
      await store.write("/api/sell/" + mint, { pct, confirm: true });
      modal.classList.remove("on");
      toast("Sell requested");
    } catch (err) {
      toast((err.body && err.body.detail) || "Sell failed");
    }
  });
}

function openSearch() {
  const ov = $("#search-overlay");
  ov.classList.add("on");
  const input = $("input", ov);
  const hits = $(".search-hits", ov);
  input.value = "";
  hits.innerHTML = "";
  input.focus();
  const state = store.cache.get("state") || store.lastGood.state || {};
  const coins = new Map();
  for (const a of (state.activity || [])) if (a.mint) coins.set(a.mint, a);
  for (const p of (state.positions || [])) if (p.mint) coins.set(p.mint, p);
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { hits.innerHTML = ""; return; }
    const rows = [...coins.values()].filter((c) =>
      (c.symbol || "").toLowerCase().includes(q) ||
      (c.name || "").toLowerCase().includes(q) ||
      (c.mint || "").toLowerCase().includes(q)
    );
    hits.innerHTML = rows.map((c) => `<div class="row" data-go="coin" data-mint="${esc(c.mint)}">
      <div class="left"><div class="title">${esc(clean(c.symbol || c.name || c.mint))}</div>
      <div class="sub">${esc((c.mint || "").slice(0, 8))}…</div></div></div>`).join("") || `<div class="empty">No matches</div>`;
    $$("[data-go]", hits).forEach((el) => el.addEventListener("click", () => {
      ov.classList.remove("on");
      go("coin", el.getAttribute("data-mint"));
    }));
  };
}

async function openScreenFs() {
  const state = store.cache.get("state") || store.lastGood.state || {};
  const last = state.lastOrder;
  const fs = $("#fs-screen");
  fs.classList.add("on");
  fs.innerHTML = `<div class="fs-bar">
    <button class="icon-btn" id="fs-close">${ico("back")}</button>
    ${last && last.link ? fomoLink(last.link) : ""}
  </div>
  <div class="screen-frame" style="flex:1;aspect-ratio:auto">
    <img id="fs-img" alt="Desk screen">
  </div>`;
  fs.style.display = "flex";
  try {
    const blob = await store.fetchScreenBlob();
    if (blob) $("#fs-img").src = URL.createObjectURL(blob);
  } catch { /* offline */ }
  $("#fs-close").addEventListener("click", () => { fs.style.display = "none"; fs.classList.remove("on"); });
  // pinch-to-zoom
  const img = $("#fs-img");
  let scale = 1;
  img.style.transformOrigin = "center center";
  img.addEventListener("wheel", (e) => {
    e.preventDefault();
    scale = Math.min(6, Math.max(1, scale + (e.deltaY < 0 ? 0.15 : -0.15)));
    img.style.transform = `scale(${scale})`;
  }, { passive: false });
}

function openSearchClose() {
  $("#search-overlay").classList.remove("on");
}

/* ---------- boot ---------- */
async function tick() {
  try {
    await store.refreshState();
    retryIn = 15;
    if ((store.page() === "home" || !store.page())) {
      updateUpdatedLine(store.cache.get("state"));
      // re-render only when we are on a live page that needs fresh numbers
      if ($("#main").dataset.ready !== "loading") {
        // update odometer / chart in place if already on home
        if (store.page() === "home" || !hashParams().get("page") || hashParams().get("page") === "home") {
          const st = store.cache.get("state");
          if ($("#odometer") && st) renderOdometer($("#odometer"), st.balance);
          if ($("#equity-chart")) paintChart(st);
          if ($("#screen-frame")) refreshScreen($("#screen-frame"), st);
          const liveBots = $(".section-h");
          void liveBots;
        }
      } else {
        await render();
      }
    }
    updateOffline();
  } catch {
    retryIn = 15;
    updateOffline();
  }
}

async function boot() {
  $("#search-overlay").addEventListener("click", (e) => {
    if (e.target.id === "search-overlay" || e.target.id === "search-close") openSearchClose();
  });
  $("#search-close") && $("#search-close").addEventListener("click", openSearchClose);
  window.addEventListener("hashchange", () => render());
  if (store.mode === "locked") {
    await render();
    return;
  }
  await render(); // skeleton
  try {
    await store.refreshState();
    await render();
  } catch {
    await render();
  }
  const st = store.cache.get("state") || {};
  const every = store.refreshMs(st);
  setInterval(tick, every);
  // screen refresh: 1s on local API, 15s on plan B
  const screenEvery = store.mode === "api" ? 1000 : every;
  setInterval(() => {
    const fr = $("#screen-frame");
    const stNow = store.cache.get("state") || store.lastGood.state;
    if (fr && stNow && (store.page() === "home" || !hashParams().get("page") || hashParams().get("page") === "home")) {
      refreshScreen(fr, stNow);
    }
  }, screenEvery);
  setInterval(() => {
    if (store.error) {
      retryIn = Math.max(0, retryIn - 1);
      updateOffline();
    } else {
      const stNow = store.cache.get("state") || store.lastGood.state;
      if (stNow) updateUpdatedLine(stNow);
    }
  }, 1000);
}

window.__deskTick = tick;
boot();
