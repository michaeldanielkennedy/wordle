"use strict";
const ROWS = 6, COLS = 5;
const DB = ((window.WORDLE_CONFIG || {}).databaseURL || "").replace(/\/$/, "");
const ONLINE = !!DB;
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- tiny REST client for Firebase Realtime Database ---------- */
async function db(method, path, body) {
  const r = await fetch(`${DB}/${path}.json`, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error("db " + r.status);
  return r.json();
}
const INC = { ".sv": { increment: 1 } };

/* ---------- player identity ---------- */
let playerName = store.get("name", "");
const keyOf = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "") || "anon";
function askName() {
  return new Promise((res) => {
    const dlg = $("#name-dialog"), inp = $("#name-input");
    inp.value = playerName;
    dlg.addEventListener("close", function f() {
      dlg.removeEventListener("close", f);
      const n = inp.value.trim().slice(0, 16);
      if (n) { playerName = n; store.set("name", n); }
      $("#who").textContent = playerName || "Set name";
      res(playerName);
    });
    dlg.showModal();
    setTimeout(() => inp.focus(), 50);
  });
}
async function ensureName() { if (!playerName) await askName(); return playerName; }
$("#who").onclick = askName;
$("#who").textContent = playerName || "Set name";

/* ---------- game state ---------- */
let g = null; // {mode, target, guesses:[], cur:"", over:false, keys:{}, room?, pid?, opp?}
let busy = false;

function evaluate(guess, target) {
  const res = Array(COLS).fill("absent"), left = {};
  for (let i = 0; i < COLS; i++) {
    if (guess[i] === target[i]) res[i] = "correct";
    else left[target[i]] = (left[target[i]] || 0) + 1;
  }
  for (let i = 0; i < COLS; i++) {
    if (res[i] === "absent" && left[guess[i]] > 0) { res[i] = "present"; left[guess[i]]--; }
  }
  return res;
}
const rank = { absent: 1, present: 2, correct: 3 };
const code = (res) => res.map((r) => r[0]).join(""); // "cpa.."
const decode = (s) => [...s].map((c) => ({ c: "correct", p: "present", a: "absent" }[c]));

function newGame(mode, target, extra = {}) {
  g = { mode, target, guesses: [], cur: "", over: false, keys: {}, ...extra };
  buildBoard($("#board"), true);
  buildKeyboard();
  $("#after").hidden = true; $("#again").textContent = "Play again";
  $("#opp-wrap").hidden = mode !== "duel";
  $("#banner").hidden = mode !== "duel";
  showView("game");
}
function newSolo() {
  newGame("solo", ANSWERS[Math.floor(Math.random() * ANSWERS.length)]);
}

/* ---------- rendering ---------- */
function buildBoard(el, letters) {
  el.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement("div"); row.className = "row";
    for (let c = 0; c < COLS; c++) { const t = document.createElement("div"); t.className = "tile"; row.appendChild(t); }
    el.appendChild(row);
  }
}
function rowEl(i) { return $("#board").children[i]; }
function renderCurrent() {
  const row = rowEl(g.guesses.length); if (!row) return;
  [...row.children].forEach((t, i) => {
    t.textContent = g.cur[i] || "";
    t.classList.toggle("filled", !!g.cur[i]);
  });
}
function buildKeyboard() {
  const kb = $("#keyboard"); kb.innerHTML = "";
  ["qwertyuiop", "asdfghjkl", "zxcvbnm"].forEach((letters, i) => {
    const row = document.createElement("div"); row.className = "krow";
    if (i === 2) row.appendChild(mkKey("enter", "Enter", true));
    for (const ch of letters) row.appendChild(mkKey(ch, ch));
    if (i === 2) row.appendChild(mkKey("back", "⌫", true));
    kb.appendChild(row);
  });
}
function mkKey(k, label, wide) {
  const b = document.createElement("button");
  b.className = "key" + (wide ? " wide" : ""); b.dataset.k = k; b.textContent = label;
  b.setAttribute("aria-label", k);
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); press(k); });
  return b;
}
function paintKeys() {
  document.querySelectorAll(".key").forEach((b) => {
    b.classList.remove("correct", "present", "absent");
    if (g.keys[b.dataset.k]) b.classList.add(g.keys[b.dataset.k]);
  });
}
let toastT;
function toast(msg, ms = 1600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------- input ---------- */
function press(k) {
  if (!g || g.over || busy) return;
  if (k === "enter") return submit();
  if (k === "back") g.cur = g.cur.slice(0, -1);
  else if (/^[a-z]$/.test(k) && g.cur.length < COLS) { g.cur += k; if (!g.start) g.start = Date.now(); }
  renderCurrent();
}

/* Scoring: (7 - guesses) so 6 for a first-guess solve down to 1, plus a speed bonus.
   Timer runs from your first letter to the guess that solves it. +3 more for winning a 1v1. */
const DUEL_BONUS = 3;
function speedBonus(secs) { return secs < 30 ? 3 : secs < 60 ? 2 : secs < 120 ? 1 : 0; }
function scoreFor(guesses, secs) { return { base: ROWS + 1 - guesses, bonus: speedBonus(secs) }; }
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement.tagName === "INPUT" || $("#name-dialog").open) return;
  if ($("#view-game").hidden) return;
  if (e.key === "Enter") press("enter");
  else if (e.key === "Backspace") press("back");
  else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
});

async function submit() {
  const row = rowEl(g.guesses.length);
  if (g.cur.length < COLS) { shake(row); return toast("Not enough letters"); }
  if (!VALID.has(g.cur)) { shake(row); return toast("Not in word list"); }
  const guess = g.cur, res = evaluate(guess, g.target);
  g.secs = (Date.now() - (g.start || Date.now())) / 1000;
  g.guesses.push({ guess, res }); g.cur = ""; busy = true;
  [...row.children].forEach((t, i) => {
    t.style.animationDelay = i * 0.125 + "s"; t.classList.add("flip");
    setTimeout(() => { t.classList.remove("filled"); t.classList.add(res[i]); }, i * 125 + 125);
  });
  await new Promise((r) => setTimeout(r, COLS * 125 + 150));
  res.forEach((r, i) => { if ((rank[r] || 0) > (rank[g.keys[guess[i]]] || 0)) g.keys[guess[i]] = r; });
  paintKeys(); busy = false;
  const won = guess === g.target, lost = !won && g.guesses.length >= ROWS;
  if (g.mode === "duel") await duelPush(won ? "won" : lost ? "lost" : "playing");
  if (won || lost) finish(won);
}
function shake(row) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }

async function finish(won) {
  if (g.over) return;
  g.over = true;
  const n = g.guesses.length;
  let pts = 0, msg = g.target.toUpperCase();
  if (won) {
    const s = scoreFor(n, g.secs); pts = s.base + s.bonus;
    const praise = ["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"][n - 1];
    msg = `${praise} +${pts} pts` + (s.bonus ? ` (${s.base} + ${s.bonus} speed, ${Math.round(g.secs)}s)` : ` (${Math.round(g.secs)}s)`);
  }
  toast(msg, 3500);
  if (g.mode === "solo") $("#after").hidden = false;
  await recordResult(won, pts, n);
}

/* ---------- scores ---------- */
async function recordResult(solved, pts, guesses) {
  const name = await ensureName(); if (!name) return;
  // local copy always kept
  const mine = store.get("local-score", { name, wins: 0, played: 0, points: 0, guessTotal: 0 });
  mine.name = name; mine.played++;
  if (solved) { mine.wins++; mine.points = (mine.points || 0) + pts; mine.guessTotal = (mine.guessTotal || 0) + guesses; }
  store.set("local-score", mine);
  if (!ONLINE) return;
  const patch = { name, played: INC };
  if (solved) { patch.wins = INC; patch.points = inc(pts); patch.guessTotal = inc(guesses); }
  try { await db("PATCH", `scores/${keyOf(name)}`, patch); if (solved) toast(`+${pts} pts saved to scoreboard ✔`); }
  catch { toast("Couldn't reach scoreboard"); }
}
const inc = (n) => ({ ".sv": { increment: n } });
async function recordDuelWin() {
  const mine = store.get("local-score", null);
  if (mine) { mine.points = (mine.points || 0) + DUEL_BONUS; mine.duelWins = (mine.duelWins || 0) + 1; mine.duels = (mine.duels || 0) + 1; store.set("local-score", mine); }
  if (!ONLINE) return;
  try { await db("PATCH", `scores/${keyOf(playerName)}`, { name: playerName, duelWins: INC, duels: INC, points: inc(DUEL_BONUS) }); } catch {}
}
async function recordDuelLoss() {
  if (!ONLINE) return;
  try { await db("PATCH", `scores/${keyOf(playerName)}`, { name: playerName, duels: INC }); } catch {}
}
async function loadScores() {
  const tbl = $("#score-table"), note = $("#scores-note");
  let rows;
  if (!ONLINE) {
    note.textContent = "Scoreboard isn't connected yet, so you're only seeing your own scores on this device. See README to switch on mates' scores.";
    const m = store.get("local-score", null); rows = m ? [m] : [];
  } else {
    note.textContent = "";
    try { const all = (await db("GET", "scores")) || {}; rows = Object.values(all); }
    catch { note.textContent = "Couldn't load scores. Check your connection."; rows = []; }
  }
  rows.forEach((r) => {
    r.wins = r.wins || 0; r.played = r.played || 0; r.duelWins = r.duelWins || 0; r.duels = r.duels || 0;
    r.points = r.points || 0; r.avg = r.wins && r.guessTotal ? r.guessTotal / r.wins : null;
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || (a.avg ?? 99) - (b.avg ?? 99));
  tbl.innerHTML = "<tr><th>#</th><th>Name</th><th>Pts</th><th>Solved</th><th>Avg</th><th>1v1 W</th></tr>";
  if (!rows.length) tbl.innerHTML += '<tr><td colspan="6" class="muted" style="text-align:center">No scores yet. Go win something!</td></tr>';
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (playerName && keyOf(r.name || "") === keyOf(playerName)) tr.className = "me";
    [i + 1, r.name || "?", r.points, `${r.wins}/${r.played}`, r.avg ? r.avg.toFixed(1) : "-", `${r.duelWins}/${r.duels}`].forEach((v) => {
      const td = document.createElement("td"); td.textContent = v; if (tr.className) td.className = "me"; tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
}

/* ---------- 1v1 duel: best-of series ---------- */
let pollT = null, seriesLen = 1;
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
function duelMsg(m) { $("#duel-msg").textContent = m; }
function setSeries(n) {
  seriesLen = n;
  document.querySelectorAll("#series button").forEach((b) => b.classList.toggle("active", +b.dataset.n === n));
}

async function createRoom() {
  if (!ONLINE) return duelMsg("1v1 needs the online scoreboard set up first. See README.");
  await ensureName();
  try {
    let id;
    for (let i = 0; i < 10; i++) {
      id = Array.from({ length: 4 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join("");
      if ((await db("GET", `rooms/${id}`)) === null) break;
    }
    const picked = new Set();
    while (picked.size < seriesLen) picked.add(Math.floor(Math.random() * ANSWERS.length));
    await db("PUT", `rooms/${id}`, { words: [...picked], games: seriesLen, created: { ".sv": "timestamp" } });
    await joinRoom(id);
  } catch { duelMsg("Couldn't create room. Check your connection."); }
}
async function joinRoom(id) {
  if (!ONLINE) return duelMsg("1v1 needs the online scoreboard set up first. See README.");
  id = id.toUpperCase().trim();
  if (id.length !== 4) return duelMsg("Room codes are 4 letters.");
  await ensureName();
  try {
    const room = await db("GET", `rooms/${id}`);
    if (!room) return duelMsg("No such room.");
    if (Object.keys(room.players || {}).length >= 2) return duelMsg("That room is full.");
    const words = room.words || [], games = room.games || words.length || 1;
    if (!words.length) return duelMsg("That room is from an old version of the game.");
    const pid = Math.random().toString(36).slice(2, 8);
    await db("PUT", `rooms/${id}/players/${pid}`, { name: playerName });
    newGame("duel", ANSWERS[words[0]], { room: id, pid, games, words: [...words], round: 0, rec: {}, seriesDone: false });
    $("#banner").textContent = `Room ${id}: best of ${games}. Waiting for a mate to join… share the code!`;
    $("#opp-name").textContent = "Waiting…"; buildBoard($("#opp-board"));
    startPoll();
  } catch { duelMsg("Couldn't join room. Check your connection."); }
}
function startPoll() { stopPoll(); pollT = setInterval(poll, 1500); poll(); }
function stopPoll() { clearInterval(pollT); pollT = null; }

async function duelPush(status) {
  const body = { rows: g.guesses.map((x) => code(x.res)).join(","), status };
  if (status !== "playing") body.finishedAt = { ".sv": "timestamp" };
  try { await db("PUT", `rooms/${g.room}/players/${g.pid}/rounds/${g.round}`, body); } catch { toast("Connection hiccup"); }
}

// Result of one game from my point of view: "win" | "lose" | "draw" | null (not decided yet)
function roundResult(m, o, myId, oppId) {
  const mw = m && m.status === "won", ow = o && o.status === "won";
  if (mw && ow) {
    const a = m.finishedAt || 0, b = o.finishedAt || 0;
    return a !== b ? (a < b ? "win" : "lose") : (myId < oppId ? "win" : "lose");
  }
  if (mw) return "win";
  if (ow) return "lose";
  if (m && o && m.status === "lost" && o.status === "lost") return "draw";
  return null;
}

async function poll() {
  if (!g || g.mode !== "duel") return stopPoll();
  let room; try { room = await db("GET", `rooms/${g.room}`); } catch { return; }
  if (!room || !g || g.mode !== "duel" || g.seriesDone) return;
  const ps = room.players || {}, me = ps[g.pid] || {};
  const oppId = Object.keys(ps).find((k) => k !== g.pid), opp = oppId ? ps[oppId] : null;
  const banner = $("#banner");
  if (!opp) { banner.textContent = `Room ${g.room}: best of ${g.games}. Waiting for a mate to join… share the code!`; return; }
  const oppName = opp.name || "Mate";
  $("#opp-name").textContent = oppName;
  const mr = me.rounds || {}, or = opp.rounds || {};

  // opponent's board for the current game
  const orow = or[g.round], rows = orow && orow.rows ? orow.rows.split(",") : [];
  buildBoard($("#opp-board"));
  rows.forEach((s, i) => decode(s).forEach((cl, j) => $("#opp-board").children[i].children[j].classList.add(cl)));

  // series tally
  const need = Math.ceil(g.games / 2);
  let w = 0, l = 0, resolved = 0; const results = [];
  for (let r = 0; r < g.games; r++) {
    const res = roundResult(mr[r], or[r], g.pid, oppId);
    results[r] = res; if (res === "win") w++; else if (res === "lose") l++; if (res) resolved++;
  }
  const seriesOver = w >= need || l >= need || resolved === g.games;
  const prefix = g.games > 1 ? `Game ${g.round + 1}/${g.games} · You ${w}–${l} ${oppName} · ` : "";
  const word = g.target.toUpperCase();

  if (seriesOver) {
    g.seriesDone = true; stopPoll();
    if (!g.over) { g.over = true; toast(`It was ${word}`, 3000); }
    const tail = ` The word was ${word}.`;
    banner.textContent = w > l
      ? (g.games > 1 ? `🏆 You win the match ${w}–${l}!` : "🏆 You win!")
      : l > w
        ? (g.games > 1 ? `😬 ${oppName} wins the match ${l}–${w}.` : `😬 ${oppName} wins.`) + tail
        : `🤝 ${g.games > 1 ? `Match drawn ${w}–${l}.` : "Draw."}` + tail;
    if (w > l) await recordDuelWin(); else await recordDuelLoss();
    $("#again").textContent = "Play again"; $("#after").hidden = false;
    return;
  }

  const cur = results[g.round];
  if (cur && !g.rec[g.round]) {
    g.rec[g.round] = true;
    if (!g.over) { g.over = true; toast(`${oppName} got it first! It was ${word}`, 3500); }
    $("#again").textContent = "Next game"; $("#after").hidden = false;
  }
  if (g.rec[g.round]) {
    banner.textContent = prefix + (cur === "win" ? "You won this game!" : cur === "lose" ? `${oppName} won this game. It was ${word}.` : `Nobody got it. It was ${word}.`);
  } else {
    banner.textContent = prefix + `${oppName} has made ${rows.length} guess${rows.length === 1 ? "" : "es"}`;
  }
}

function nextRound() {
  g.round++; g.target = ANSWERS[g.words[g.round]];
  g.guesses = []; g.cur = ""; g.over = false; g.keys = {}; g.start = null; g.secs = 0;
  buildBoard($("#board"), true); buildKeyboard(); buildBoard($("#opp-board"));
  $("#after").hidden = true;
  poll();
}

/* ---------- navigation ---------- */
function showView(v) {
  ["game", "duel", "scores"].forEach((n) => ($("#view-" + n).hidden = n !== v));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  if (v === "scores") loadScores();
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => {
  if (b.dataset.view === "game" && g && g.mode === "duel" && !g.seriesDone) { showView("game"); return; }
  showView(b.dataset.view);
}));
$("#again").onclick = () => {
  if (g.mode === "duel" && !g.seriesDone) return nextRound();
  stopPoll(); if (g.mode === "duel") { duelMsg(""); showView("duel"); } else newSolo();
};
document.querySelectorAll("#series button").forEach((b) => (b.onclick = () => setSeries(+b.dataset.n)));
$("#create-room").onclick = createRoom;
$("#join-form").onsubmit = (e) => { e.preventDefault(); joinRoom($("#room-code").value); };
$("#refresh").onclick = loadScores;

newSolo();
if (!playerName) setTimeout(askName, 300);
