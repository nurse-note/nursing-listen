// 간호 암기 목록 — 계정 로그인과 기록 동기화 (Firebase, 간호학 단어장과 같은 프로젝트·같은 계정)
// 기록은 users/{uid} 문서의 "ls" 칸에만 저장합니다. 단어장 기록(w, h 칸)은 읽지도 바꾸지도 않습니다.
// 올리는 것: 별표, 재생 설정. (재생 위치·음성 선택은 기기마다 달라서 올리지 않습니다 → 밤새 틀어도 쓰기 횟수가 늘지 않음)
const V = "13.1.0";
const BASE = "https://www.gstatic.com/firebasejs/" + V + "/";
const firebaseConfig = {
  apiKey: "AIzaSyCezRqu2QvyAQsWMRO8v9OjcjjzmW-fkVA",
  authDomain: "nursing-voca-a.firebaseapp.com",
  projectId: "nursing-voca-a",
  storageBucket: "nursing-voca-a.firebasestorage.app",
  messagingSenderId: "614457339051",
  appId: "1:614457339051:web:284fb7fedd8a7ed0c9dbee"
};
const CFG_KEYS = ["mode", "order", "rate", "rep", "gap", "acts", "recall", "follow", "mask", "enVoice"];

let FA, FS, auth, db, user = null, unsub = null, timer = null, status = "loading", errMsg = "", formOpen = false, busy = false;
const KN = () => window.KN;
const STATUS = {
  loading: "동기화 기능을 불러오는 중…",
  failed: "동기화 기능을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 앱을 다시 열어 주세요. (듣기는 그대로 할 수 있어요)",
  out: "간호학 단어장과 같은 계정으로 로그인하면 별표와 재생 설정이 휴대폰·PC에서 똑같이 맞춰져요.",
  syncing: "동기화 중…",
  synced: "동기화됨",
  pending: "올릴 기록이 있어요",
  offline: "오프라인 · 인터넷이 연결되면 자동으로 올라가요",
  denied: "권한 오류예요. Firebase의 Firestore 규칙을 확인해 주세요.",
  error: "동기화 중 오류가 났어요. 잠시 후 다시 시도해 주세요."
};
const AUTH_ERR = {
  "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/wrong-password": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/user-not-found": "가입되지 않은 이메일이에요. ‘회원가입’을 눌러 주세요.",
  "auth/email-already-in-use": "이미 가입된 이메일이에요. ‘로그인’을 눌러 주세요.",
  "auth/weak-password": "비밀번호는 6자 이상으로 정해 주세요.",
  "auth/invalid-email": "이메일 형식이 올바르지 않아요.",
  "auth/missing-password": "비밀번호를 입력해 주세요.",
  "auth/too-many-requests": "시도가 너무 많아요. 잠시 후 다시 해 주세요.",
  "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
  "auth/unauthorized-domain": "Firebase 승인된 도메인에 이 사이트 주소를 추가해야 해요.",
  "auth/operation-not-allowed": "Firebase에서 이 로그인 방법이 꺼져 있어요.",
  "auth/popup-blocked": "팝업이 차단됐어요. 팝업을 허용하거나 이메일로 로그인해 주세요."
};
function authErr(e) { const c = e && e.code; if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return ""; return AUTH_ERR[c] || ("로그인 오류: " + (c || (e && e.message) || "알 수 없음")); }

function h(tag, attrs, kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) { const v = attrs[k]; if (v == null || v === false) continue; if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v); }
  (kids || []).forEach((c) => { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return e;
}
function setStatus(s) { status = s; render(); }
function curStatus() { if (user && (status === "syncing" || status === "pending") && !navigator.onLine) return "offline"; return status; }

function render(box) {
  box = box || document.getElementById("acct");
  if (!box) return;
  box.innerHTML = ""; box.className = "acct";
  const st = curStatus();
  if (!user) {
    box.appendChild(h("div", { class: "acct-t" }, [h("strong", { text: "계정 동기화" })]));
    box.appendChild(h("p", { class: "note", style: "margin:4px 0 10px", text: STATUS[st === "loading" || st === "failed" ? st : "out"] }));
    if (st === "loading" || st === "failed") return;
    box.appendChild(h("div", { class: "acct-btns" }, [
      h("button", { class: "abtn primary", type: "button", disabled: busy, text: "Google로 로그인", onclick: google }),
      h("button", { class: "abtn", type: "button", "aria-expanded": String(formOpen), text: "이메일로 로그인", onclick: () => { formOpen = !formOpen; errMsg = ""; render(); } })]));
    if (formOpen) {
      const em = h("input", { class: "ainp", type: "email", autocomplete: "email", placeholder: "이메일", "aria-label": "이메일" });
      const pw = h("input", { class: "ainp", type: "password", autocomplete: "current-password", placeholder: "비밀번호 (6자 이상)", "aria-label": "비밀번호" });
      box.appendChild(h("div", { class: "acct-form" }, [em, pw, h("div", { class: "acct-btns" }, [
        h("button", { class: "abtn primary", type: "button", disabled: busy, text: "로그인", onclick: () => emailAuth("in", em.value, pw.value) }),
        h("button", { class: "abtn", type: "button", disabled: busy, text: "회원가입", onclick: () => emailAuth("up", em.value, pw.value) })]),
        h("button", { class: "abtn ghost", type: "button", text: "비밀번호를 잊었어요", onclick: () => resetPw(em.value) })]));
    }
    if (errMsg) box.appendChild(h("p", { class: "acct-err", role: "alert", text: errMsg }));
    return;
  }
  box.appendChild(h("div", { class: "acct-t" }, [h("strong", { text: user.email || user.displayName || "로그인됨" }),
    h("span", { class: "acct-st " + (st === "synced" ? "ok" : st === "denied" || st === "error" ? "bad" : ""), text: STATUS[st] || "" })]));
  box.appendChild(h("div", { class: "acct-btns" }, [
    h("button", { class: "abtn", type: "button", text: "지금 동기화", onclick: () => flush(true) }),
    h("button", { class: "abtn ghost", type: "button", text: "로그아웃", onclick: async () => { try { await FA.signOut(auth); } catch (e) {} } })]));
  box.appendChild(h("p", { class: "note", style: "margin:8px 0 0", text: "회원 탈퇴는 간호학 단어장 앱에서 할 수 있어요. 탈퇴하면 이 앱의 기록도 함께 지워져요." }));
  if (errMsg) box.appendChild(h("p", { class: "acct-err", role: "alert", text: errMsg }));
}

async function google() {
  errMsg = ""; busy = true; render();
  const p = new FA.GoogleAuthProvider();
  try { await FA.signInWithPopup(auth, p); }
  catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      try { await FA.signInWithRedirect(auth, p); return; } catch (e2) { errMsg = authErr(e2); }
    } else errMsg = authErr(e);
  }
  busy = false; render();
}
async function emailAuth(mode, email, pw) {
  errMsg = ""; email = (email || "").trim();
  if (!email) { errMsg = "이메일을 입력해 주세요."; render(); return; }
  busy = true; render();
  try { if (mode === "up") await FA.createUserWithEmailAndPassword(auth, email, pw || ""); else await FA.signInWithEmailAndPassword(auth, email, pw || ""); formOpen = false; }
  catch (e) { errMsg = authErr(e); }
  busy = false; render();
}
async function resetPw(email) {
  email = (email || "").trim();
  if (!email) { errMsg = "비밀번호를 재설정할 이메일을 먼저 입력해 주세요."; render(); return; }
  try { await FA.sendPasswordResetEmail(auth, email); errMsg = "비밀번호 재설정 메일을 보냈어요. 메일함(스팸함 포함)을 확인해 주세요."; }
  catch (e) { errMsg = authErr(e); }
  render();
}

// ----- 합치기: 별표는 항목마다, 설정은 통째로 더 최근(t가 큰) 것을 남깁니다 -----
function ensure(S) { S.stT = S.stT || {}; S.dd = S.dd || {}; S.dd.st = S.dd.st || {}; S.cfgT = S.cfgT || 0; }
function mergeRemote(ls) {
  const S = KN().S; ensure(S); let changed = false;
  const rst = (ls && ls.st) || {};
  for (const id in rst) {
    const r = rst[id]; if (!r || typeof r !== "object") continue;
    if ((r.t || 0) > (S.stT[id] || 0)) {
      if (r.v) S.stars[id] = 1; else delete S.stars[id];
      S.stT[id] = r.t || 0; delete S.dd.st[id]; changed = true;
    }
  }
  const rc = ls && ls.cfg;
  if (rc && (rc.t || 0) > (S.cfgT || 0)) {
    CFG_KEYS.forEach((k) => { if (k in rc) S[k] = rc[k]; });
    S.cfgT = rc.t || 0; S.dd.cfg = 0; changed = true;
  }
  return changed;
}
function dirtyCount(S) { ensure(S); return Object.keys(S.dd.st).length + (S.dd.cfg ? 1 : 0); }

// 쓰기 횟수 보호: 한 번에 하나만 보내고(보내는 중이면 끝난 뒤 한 번 더), 변경은 3초 모아서 보냄
let inflight = false, again = false;
const DEBOUNCE = 3000;
let firstPend = 0; const MAXWAIT = 20000;
function schedule(ms) {
  clearTimeout(timer);
  if (!firstPend) firstPend = Date.now();
  let wait = ms == null ? DEBOUNCE : ms;
  wait = Math.max(0, Math.min(wait, MAXWAIT - (Date.now() - firstPend)));
  timer = setTimeout(flush, wait);
}
async function flush(manual) {
  if (!user || !db) return;
  clearTimeout(timer);
  if (inflight) { again = true; return; }
  const S = KN().S; ensure(S);
  const ids = Object.keys(S.dd.st), sendCfg = !!S.dd.cfg;
  if (!ids.length && !sendCfg) { if (status !== "denied") setStatus("synced"); return; }
  const st = {}, sent = {};
  ids.forEach((id) => { st[id] = { v: S.stars[id] ? 1 : 0, t: S.stT[id] || Date.now() }; sent[id] = st[id].t; });
  const ls = {};
  if (ids.length) ls.st = st;
  let cfgSent = 0;
  if (sendCfg) { const c = { t: S.cfgT || Date.now() }; CFG_KEYS.forEach((k) => { c[k] = S[k]; }); ls.cfg = c; cfgSent = c.t; }
  setStatus("syncing");
  inflight = true; firstPend = 0;
  try {
    await FS.setDoc(FS.doc(db, "users", user.uid), { ls, lsAt: FS.serverTimestamp() }, { merge: true });
    ids.forEach((id) => { if ((S.stT[id] || 0) === sent[id]) delete S.dd.st[id]; });
    if (sendCfg && (S.cfgT || 0) === cfgSent) S.dd.cfg = 0;
    KN().save(true);
    setStatus(dirtyCount(S) ? "pending" : "synced");
  } catch (e) {
    setStatus(e && e.code === "permission-denied" ? "denied" : "error");
  } finally {
    inflight = false;
    if (again || dirtyCount(KN().S)) { again = false; if (user) schedule(); }
  }
}
function onSave() {
  if (!user) return;
  clearTimeout(timer);
  if (status !== "syncing") { status = "pending"; render(); }
  schedule();
}

async function boot() {
  try {
    const [A, AU, F] = await Promise.all([import(BASE + "firebase-app.js"), import(BASE + "firebase-auth.js"), import(BASE + "firebase-firestore.js")]);
    FA = AU; FS = F;
    const app = A.initializeApp(firebaseConfig);
    auth = AU.getAuth(app);
    try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
    catch (e) { db = F.getFirestore(app); }
  } catch (e) { setStatus("failed"); return; }
  try { await FA.getRedirectResult(auth); } catch (e) { errMsg = authErr(e); }
  FA.onAuthStateChanged(auth, (u) => attach(u));
}
function attach(u) {
  if (unsub) { unsub(); unsub = null; }
  clearTimeout(timer);
  user = u || null; errMsg = "";
  if (!user) { setStatus("out"); return; }
  const S = KN().S; ensure(S);
  // 이 기기에서 다른 계정을 쓰던 기록이면 섞지 않고 새 계정 기록으로 바꿉니다.
  if (S.owner && S.owner !== user.uid) { S.stars = {}; S.stT = {}; S.dd = { st: {} }; S.cfgT = 0; }
  S.owner = user.uid; KN().save(true); KN().refresh();
  setStatus("syncing");
  let first = true;
  unsub = FS.onSnapshot(FS.doc(db, "users", user.uid), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    const ls = (data && data.ls) || {};
    if (first) {
      first = false;
      const rst = ls.st || {};
      // 서버보다 이 기기 기록이 더 최근이면 올릴 목록에 넣음
      for (const id in S.stT) { const r = rst[id]; if (!r || (S.stT[id] || 0) > (r.t || 0)) S.dd.st[id] = 1; }
      for (const id in S.stars) { if (!S.stT[id] && !rst[id]) { S.stT[id] = Date.now(); S.dd.st[id] = 1; } }
      if (S.cfgT && (!ls.cfg || S.cfgT > (ls.cfg.t || 0))) S.dd.cfg = 1;
    }
    const changed = mergeRemote(ls);
    KN().save(true);
    if (changed) KN().refresh();
    const pendingSnap = snap.metadata && snap.metadata.hasPendingWrites;
    if (!pendingSnap && !inflight && dirtyCount(S)) schedule();
    else if (!pendingSnap && !inflight && status !== "denied") setStatus("synced");
  }, (err) => setStatus(err && err.code === "permission-denied" ? "denied" : "error"));
}

window.addEventListener("online", () => { render(); if (user) schedule(500); });
// 앱을 닫거나 다른 화면으로 갈 때 남은 기록을 바로 올림
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && user) flush(); });
window.addEventListener("pagehide", () => { if (user) flush(); });
window.addEventListener("offline", () => render());
window.KNSync = { onSave, render };
render();
boot();
