const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let session = null;
const $ = (id) => document.getElementById(id);

const LINES = [
  "The hour keeps a small fire and does not explain it.",
  "Ash settles. Someone still writes on the table.",
  "What you pin to the wall outlives the minute you wrote it.",
  "A public note is a window left cracked on purpose.",
  "The desk is private. The wall is a dare.",
  "Every sixty minutes the masthead forgets and starts again.",
  "Leave something ordinary. Ordinary lasts.",
  "Smoke first, then the letter.",
];

function hourKey(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x.toISOString();
}

function fmt(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("on"));
  $("view-" + name).classList.add("on");
  document.querySelectorAll("nav button").forEach((b) => {
    b.setAttribute("aria-current", b.dataset.view === name ? "true" : "false");
  });
}

document.querySelectorAll("nav button").forEach((b) => {
  b.addEventListener("click", () => showView(b.dataset.view));
});

async function ensureProfile(user) {
  const { data } = await sb.from("ashwick_profiles").select("*").eq("id", user.id).maybeSingle();
  if (data) return data;
  const base = (user.email || "guest").split("@")[0];
  const row = { id: user.id, handle: base + "-" + user.id.slice(0, 5), display_name: base };
  await sb.from("ashwick_profiles").insert(row);
  return row;
}

function renderAuth() {
  const slot = $("authSlot");
  slot.innerHTML = "";
  const btn = document.createElement("button");
  if (session) {
    btn.textContent = "Sign out";
    btn.onclick = () => sb.auth.signOut();
    $("noteForm").hidden = false;
    $("deskGate").hidden = true;
  } else {
    btn.textContent = "Sign in";
    btn.onclick = () => { $("gate").hidden = false; };
    $("noteForm").hidden = true;
    $("deskGate").hidden = false;
  }
  slot.appendChild(btn);
}

async function rotateHour() {
  const key = hourKey();
  const { data: existing } = await sb.from("ashwick_hours").select("*").eq("hour_key", key).maybeSingle();
  if (existing) return existing;

  const { data: publics } = await sb
    .from("ashwick_notes")
    .select("id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(24);

  const pick = publics && publics.length
    ? publics[Math.floor(Math.random() * publics.length)].id
    : null;
  const line = LINES[new Date().getHours() % LINES.length];
  const row = { hour_key: key, editorial_line: line, note_id: pick };
  await sb.from("ashwick_hours").insert(row);
  return row;
}

async function loadHour() {
  const hour = await rotateHour();
  $("editorial").textContent = hour.editorial_line;
  $("hourStamp").textContent = "this hour · " + fmt(hour.hour_key || hour.featured_at);

  const bar = $("timer");
  const now = Date.now();
  const start = new Date(hourKey()).getTime();
  const elapsed = Math.max(0, now - start);
  bar.style.animation = "none";
  bar.offsetHeight;
  bar.style.animation = `tick ${3600000 - elapsed}ms linear forwards`;

  if (!hour.note_id) {
    $("featureCard").hidden = true;
    return;
  }
  const { data: note } = await sb
    .from("ashwick_notes")
    .select("title, body, created_at, user_id, is_public")
    .eq("id", hour.note_id)
    .maybeSingle();
  if (!note || !note.is_public) {
    $("featureCard").hidden = true;
    return;
  }
  const { data: prof } = await sb.from("ashwick_profiles").select("handle").eq("id", note.user_id).maybeSingle();
  $("featureCard").hidden = false;
  $("featureMeta").textContent = (prof?.handle || "someone") + " · " + fmt(note.created_at);
  $("featureTitle").textContent = note.title || "Untitled";
  $("featureBody").textContent = note.body;
}

function cardEl(n, extra = "") {
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `<p class="meta ${n.is_public ? "pub" : "priv"}">${n.is_public ? "on the wall" : "in the drawer"} · ${fmt(n.created_at)}</p>
    <h3>${escapeHtml(n.title || "Untitled")}</h3>
    <p>${escapeHtml(n.body)}</p>${extra}`;
  return el;
}

async function loadWall() {
  const { data } = await sb
    .from("ashwick_notes")
    .select("id, title, body, created_at, is_public, user_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(50);
  const wall = $("wall");
  wall.innerHTML = "";
  if (!data || !data.length) {
    wall.innerHTML = "<p class='lede'>The wall is bare. Mark a note public.</p>";
    return;
  }
  data.forEach((n, i) => {
    const el = cardEl(n);
    el.style.animationDelay = i * 40 + "ms";
    wall.appendChild(el);
  });
}

async function loadMine() {
  if (!session) { $("mine").innerHTML = ""; return; }
  const { data } = await sb
    .from("ashwick_notes")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  const mine = $("mine");
  mine.innerHTML = "";
  (data || []).forEach((n) => {
    const extra = `<div class="row">
      <button type="button" data-act="toggle">${n.is_public ? "Take off wall" : "Mark public"}</button>
      <button type="button" data-act="del">Forget</button>
    </div>`;
    const el = cardEl(n, extra);
    el.querySelector("[data-act=toggle]").onclick = async () => {
      await sb.from("ashwick_notes").update({ is_public: !n.is_public, updated_at: new Date().toISOString() }).eq("id", n.id);
      loadMine(); loadWall(); loadHour();
    };
    el.querySelector("[data-act=del]").onclick = async () => {
      await sb.from("ashwick_notes").delete().eq("id", n.id);
      loadMine(); loadWall(); loadHour();
    };
    mine.appendChild(el);
  });
}

$("noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!session) return;
  await ensureProfile(session.user);
  const fd = new FormData(e.target);
  await sb.from("ashwick_notes").insert({
    user_id: session.user.id,
    title: String(fd.get("title") || "").trim(),
    body: String(fd.get("body") || "").trim(),
    is_public: fd.get("is_public") === "on",
  });
  e.target.reset();
  loadMine(); loadWall();
});

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = String(new FormData(e.target).get("email"));
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  $("authMsg").textContent = error ? error.message : "Look in your mail. The door is there.";
});

$("gate").addEventListener("click", (e) => {
  if (e.target.id === "gate") $("gate").hidden = true;
});

sb.auth.onAuthStateChange(async (_e, s) => {
  session = s;
  renderAuth();
  if (s) {
    await ensureProfile(s.user);
    $("gate").hidden = true;
  }
  loadMine();
});

loadHour();
loadWall();
setInterval(loadHour, 30_000);
