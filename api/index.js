<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AnuritChat · Docs Ask</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet" />
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          #faf9f7;
  --bg2:         #f4f2ee;
  --surface:     #ffffff;
  --surface2:    #f8f7f4;
  --border:      #e8e3db;
  --border2:     #d9d2c5;
  --navy:        #1a2b4a;
  --navy2:       #243758;
  --gold:        #b8955a;
  --gold-light:  rgba(184,149,90,0.12);
  --gold-glow:   rgba(184,149,90,0.25);
  --text:        #1a2b4a;
  --text2:       #5a6a80;
  --text3:       #9aa3b0;
  --red:         #c0392b;
  --green:       #27ae60;
  --serif:       'Playfair Display', Georgia, serif;
  --sans:        'DM Sans', sans-serif;
  --mono:        'DM Mono', monospace;
  --shadow:      0 2px 12px rgba(26,43,74,0.08);
  --shadow-lg:   0 8px 40px rgba(26,43,74,0.12);
}

html, body {
  height: 100%; background: var(--bg); color: var(--text);
  font-family: var(--sans); font-size: 15px;
  overflow: hidden; -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 99px; }

/* ── LOGIN ─────────────────────────────────────────────── */
#login-screen {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  background: var(--navy);
  background-image:
    radial-gradient(ellipse 80% 60% at 20% 80%, rgba(184,149,90,0.08) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 10%, rgba(184,149,90,0.06) 0%, transparent 50%);
}

.login-pattern {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.04;
  background-image: repeating-linear-gradient(
    45deg, #b8955a 0, #b8955a 1px, transparent 0, transparent 50%
  );
  background-size: 24px 24px;
}

.login-card {
  position: relative; width: 440px; max-width: 92vw;
  background: var(--surface); border-radius: 4px;
  padding: 48px 44px;
  box-shadow: var(--shadow-lg);
  animation: cardIn .5s cubic-bezier(.16,1,.3,1) both;
}

.login-brand {
  display: flex; align-items: center; gap: 11px; margin-bottom: 36px;
}
.login-logo-mark {
  width: 38px; height: 38px; background: var(--navy);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--serif); font-size: 17px; color: var(--gold); font-weight: 700;
}
.login-brand-name {
  font-family: var(--serif); font-size: 19px; font-weight: 600;
  color: var(--navy); letter-spacing: -.01em;
}

.login-card h1 {
  font-family: var(--serif); font-size: 30px; font-weight: 700;
  line-height: 1.15; color: var(--navy); margin-bottom: 10px;
  letter-spacing: -.02em;
}
.login-card h1 em { font-style: italic; color: var(--gold); }
.login-sub {
  font-size: 13.5px; color: var(--text2); line-height: 1.65;
  margin-bottom: 36px; font-weight: 400;
}

.field { margin-bottom: 18px; }
.field label {
  display: block; font-size: 11px; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: var(--text3); margin-bottom: 7px;
}
.field input {
  width: 100%; background: var(--bg); border: 1px solid var(--border2);
  border-radius: 3px; padding: 12px 15px; color: var(--text);
  font-family: var(--sans); font-size: 14px; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.field input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-glow); }
.field input::placeholder { color: var(--text3); }

.login-err {
  font-size: 12.5px; color: var(--red);
  background: rgba(192,57,43,.07); border: 1px solid rgba(192,57,43,.2);
  border-radius: 3px; padding: 10px 14px; margin-bottom: 16px; display: none;
}
.login-err.show { display: block; animation: shake .25s ease; }

#btn-signin {
  width: 100%; padding: 13px; border: none; border-radius: 3px;
  background: var(--navy); cursor: pointer;
  font-family: var(--sans); font-size: 13.5px; font-weight: 600;
  letter-spacing: .04em; color: #fff;
  display: flex; align-items: center; justify-content: center; gap: 9px;
  transition: background .15s, transform .1s; margin-top: 4px;
}
#btn-signin:hover { background: var(--navy2); }
#btn-signin:active { transform: scale(.98); }
#btn-signin:disabled { opacity: .45; cursor: not-allowed; }

.spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
  animation: spin .55s linear infinite; display: none; flex-shrink: 0;
}
#btn-signin.loading .spinner { display: block; }
#btn-signin.loading .signin-label { opacity: .7; }

.login-divider {
  display: flex; align-items: center; gap: 12px; margin: 20px 0 0;
}
.login-divider::before, .login-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}
.login-divider span {
  font-size: 11px; color: var(--text3); letter-spacing: .06em; white-space: nowrap;
}

/* ── APP ──────────────────────────────────────────────── */
#app {
  display: none; height: 100vh;
  grid-template-rows: 60px 1fr auto;
  grid-template-columns: 260px 1fr;
  grid-template-areas:
    "bar bar"
    "history chat"
    "footer footer";
}
#app.on { display: grid; animation: fadeIn .3s ease; }

/* ── TOP BAR ─────────────────────────────────────────── */
#bar {
  grid-area: bar;
  background: var(--navy);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 1px 0 rgba(255,255,255,0.06);
}
.bar-left { display: flex; align-items: center; gap: 12px; }
.bar-logo-mark {
  width: 32px; height: 32px; background: var(--gold);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--serif); font-size: 15px; color: var(--navy); font-weight: 700;
}
.bar-brand {
  font-family: var(--serif); font-size: 17px; font-weight: 600;
  color: #fff; letter-spacing: -.01em;
}
.bar-tagline {
  font-size: 11px; color: rgba(255,255,255,0.4);
  letter-spacing: .08em; text-transform: uppercase; margin-left: 4px;
  padding-left: 14px; border-left: 1px solid rgba(255,255,255,0.15);
  font-weight: 400;
}
.bar-right { display: flex; align-items: center; gap: 14px; }
.bar-greeting {
  font-size: 13px; color: rgba(255,255,255,0.65); font-weight: 400;
}
.bar-greeting strong { color: var(--gold); font-weight: 600; }
#btn-logout {
  background: none; border: 1px solid rgba(255,255,255,0.2); border-radius: 3px;
  padding: 6px 14px; cursor: pointer; color: rgba(255,255,255,0.6);
  font-family: var(--sans); font-size: 12px; font-weight: 500;
  letter-spacing: .05em; text-transform: uppercase;
  transition: border-color .15s, color .15s;
}
#btn-logout:hover { border-color: var(--gold); color: var(--gold); }

/* ── HISTORY PANEL ────────────────────────────────────── */
#history-panel {
  grid-area: history;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
}
.history-head {
  padding: 20px 18px 14px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.history-head-label {
  font-size: 11px; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; color: var(--text3);
}
#btn-new-chat {
  display: flex; align-items: center; gap: 5px;
  background: var(--gold-light); border: 1px solid rgba(184,149,90,0.35);
  border-radius: 3px; padding: 5px 11px; cursor: pointer;
  font-size: 11px; font-weight: 600; color: var(--gold);
  letter-spacing: .04em; text-transform: uppercase;
  transition: background .15s, border-color .15s;
}
#btn-new-chat:hover { background: rgba(184,149,90,0.2); border-color: var(--gold); }

#history-list {
  flex: 1; overflow-y: auto; padding: 10px 10px;
  display: flex; flex-direction: column; gap: 2px;
}
.history-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%; gap: 8px; padding: 20px;
  text-align: center;
}
.history-empty-icon { font-size: 22px; opacity: .3; }
.history-empty p { font-size: 11.5px; color: var(--text3); line-height: 1.7; }

.hist-item {
  display: flex; align-items: center;
  border-radius: 3px; cursor: pointer;
  transition: background .12s; position: relative;
  border: 1px solid transparent;
}
.hist-item:hover { background: var(--bg2); border-color: var(--border); }
.hist-item.active {
  background: var(--gold-light); border-color: rgba(184,149,90,0.35);
}
.hist-item-body { flex: 1; padding: 9px 10px; min-width: 0; }
.hist-item-title {
  font-size: 12.5px; font-weight: 500; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px;
}
.hist-item.active .hist-item-title { color: var(--gold); font-weight: 600; }
.hist-item-meta { font-size: 10px; color: var(--text3); font-family: var(--mono); }
.hist-item-actions {
  display: none; flex-shrink: 0; align-items: center; gap: 2px; padding-right: 6px;
}
.hist-item:hover .hist-item-actions { display: flex; }
.hist-act-btn {
  background: none; border: none; cursor: pointer; padding: 4px 5px;
  border-radius: 3px; font-size: 11px; color: var(--text3);
  transition: color .12s, background .12s;
}
.hist-act-btn:hover { color: var(--text); background: var(--border); }
.hist-act-btn.del:hover { color: var(--red); background: rgba(192,57,43,.08); }
.hist-rename-input {
  width: 100%; background: var(--bg); border: 1px solid var(--gold);
  border-radius: 3px; padding: 4px 7px; color: var(--text);
  font-family: var(--sans); font-size: 12.5px; font-weight: 500; outline: none;
}

.hist-skeleton {
  height: 50px; border-radius: 3px;
  background: linear-gradient(90deg, var(--bg2) 25%, var(--border) 50%, var(--bg2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }

/* ── CHAT ─────────────────────────────────────────────── */
#chat {
  grid-area: chat; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg);
}
#messages {
  flex: 1; overflow-y: auto; padding: 32px 36px 16px;
  display: flex; flex-direction: column; gap: 28px;
}

/* Welcome state */
#empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center;
  padding: 52px 48px; gap: 0;
}
#empty.gone { display: none; }
.empty-eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: .14em;
  text-transform: uppercase; color: var(--gold); margin-bottom: 16px;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.empty-eyebrow::before {
  content: ''; display: block; width: 28px; height: 1px; background: var(--gold);
}
.empty-greeting {
  font-family: var(--serif); font-size: 42px; font-weight: 700;
  line-height: 1.1; color: var(--navy); margin-bottom: 8px;
  letter-spacing: -.02em;
}
.empty-greeting em { font-style: italic; color: var(--gold); }
.empty-sub {
  font-size: 15px; color: var(--text2); line-height: 1.7;
  max-width: 440px; font-weight: 400; margin-bottom: 0;
}

/* Messages */
.msg {
  display: flex; gap: 13px;
  animation: msgIn .26s cubic-bezier(.16,1,.3,1); max-width: 820px;
}
.msg.user { align-self: flex-end; flex-direction: row-reverse; max-width: 640px; }
.avatar {
  width: 34px; height: 34px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
}
.msg.user .avatar {
  background: var(--navy); color: var(--gold);
  font-family: var(--serif); font-size: 14px;
}
.msg.assistant .avatar {
  background: var(--gold); color: var(--navy);
  font-family: var(--serif); font-size: 14px; font-weight: 700;
}
.msg-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.msg.user .msg-body { align-items: flex-end; }

/* Flat assistant text — no box, reads like a human reply */
.asst-text {
  line-height: 1.75; font-size: 14.5px; word-break: break-word;
  color: var(--text); max-width: 680px;
}
.asst-text p { margin-bottom: 10px; }
.asst-text p:last-child { margin-bottom: 0; }
.asst-text strong { color: var(--navy); font-weight: 600; }
.asst-text em { color: var(--text2); }
.asst-text ul, .asst-text ol { padding-left: 20px; margin: 8px 0; }
.asst-text li { margin-bottom: 6px; line-height: 1.65; }
.asst-text code {
  background: var(--bg2); border: 1px solid var(--border2); border-radius: 3px;
  padding: 1px 5px; font-family: var(--mono); font-size: 12px; color: var(--navy);
}
.asst-text pre {
  background: var(--navy); border-radius: 4px;
  padding: 14px 16px; overflow-x: auto; margin: 10px 0;
  font-family: var(--mono); font-size: 12px; line-height: 1.65; color: #e8e3db;
}
.asst-text pre code { background: none; border: none; padding: 0; color: inherit; }
.bubble {
  padding: 14px 18px; line-height: 1.72; font-size: 14px; word-break: break-word;
}
.msg.user .bubble {
  background: var(--navy); color: #fff;
  border-radius: 4px 4px 2px 4px;
}
.msg.assistant .bubble {
  background: transparent; border: none;
  color: var(--text); padding: 0;
  box-shadow: none;
}
.bubble p { margin-bottom: 9px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble strong { color: var(--navy); font-weight: 600; }
.bubble em { color: var(--text2); }
.bubble ul, .bubble ol { padding-left: 20px; margin: 8px 0; }
.bubble li { margin-bottom: 5px; }
.bubble code {
  background: var(--bg2); border: 1px solid var(--border2); border-radius: 3px;
  padding: 1px 5px; font-family: var(--mono); font-size: 12px; color: var(--navy);
}
.bubble pre {
  background: var(--navy); border-radius: 4px;
  padding: 14px 16px; overflow-x: auto; margin: 10px 0;
  font-family: var(--mono); font-size: 12px; line-height: 1.65; color: #e8e3db;
}
.bubble pre code { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }
.msg-meta {
  font-size: 10.5px; color: var(--text3); padding: 0 2px; font-family: var(--mono);
}

/* Sources */
.src-btn {
  display: inline-flex; align-items: center; gap: 5px;
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--text3); font-family: var(--mono);
  padding: 0; transition: color .15s;
}
.src-btn:hover { color: var(--gold); }
.src-arrow { display: inline-block; transition: transform .15s; }
.src-btn.open .src-arrow { transform: rotate(90deg); }
.src-panel {
  background: var(--bg2); border: 1px solid var(--border2);
  border-radius: 4px; overflow: hidden; display: none; margin-top: 2px;
}
.src-panel.open { display: block; animation: slideDown .18s ease; }
.src-item { padding: 9px 13px; border-bottom: 1px solid var(--border); }
.src-item:last-child { border-bottom: none; }
.src-top { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
.src-idx {
  font-family: var(--mono); font-size: 9.5px; color: var(--gold);
  background: var(--gold-light); border-radius: 3px; padding: 2px 5px; flex-shrink: 0;
}
.src-file { font-size: 11px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.src-score { font-family: var(--mono); font-size: 9.5px; color: var(--text3); margin-left: auto; flex-shrink: 0; }
.src-preview {
  font-size: 11px; color: var(--text3); line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* Typing */
.typing-wrap { padding: 4px 0; }
.typing { display: flex; gap: 5px; align-items: center; padding: 2px 0; }
.dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--text3);
  animation: bounce 1.1s infinite;
}
.dot:nth-child(2) { animation-delay: .18s; }
.dot:nth-child(3) { animation-delay: .36s; }

/* ── INPUT BAR ────────────────────────────────────────── */
#inputbar {
  flex-shrink: 0; padding: 14px 24px 18px;
  background: var(--bg); border-top: 1px solid var(--border);
}
.inputwrap {
  display: flex; align-items: flex-end; gap: 10px;
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 4px; padding: 11px 12px 11px 18px;
  max-width: 820px; margin: 0 auto;
  transition: border-color .15s, box-shadow .15s;
  box-shadow: var(--shadow);
}
.inputwrap:focus-within { border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-glow); }
#qinput {
  flex: 1; background: none; border: none; outline: none; color: var(--text);
  font-family: var(--sans); font-size: 14.5px; line-height: 1.5;
  resize: none; min-height: 22px; max-height: 150px; overflow-y: auto;
  font-weight: 400;
}
#qinput::placeholder { color: var(--text3); }
#sendbtn {
  width: 36px; height: 36px; border-radius: 3px; flex-shrink: 0;
  background: var(--navy); border: none; cursor: pointer; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, transform .1s;
}
#sendbtn:hover { background: var(--navy2); }
#sendbtn:active { transform: scale(.92); }
#sendbtn:disabled { opacity: .35; cursor: not-allowed; }
.hint {
  max-width: 820px; margin: 6px auto 0; text-align: center;
  font-size: 10.5px; color: var(--text3); font-family: var(--mono);
}

/* ── FOOTER ───────────────────────────────────────────── */
#app-footer {
  grid-area: footer;
  background: var(--surface); border-top: 1px solid var(--border);
  padding: 10px 24px; display: flex; align-items: center;
  justify-content: space-between; gap: 20px; flex-wrap: wrap;
}
.footer-meta {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
}
.footer-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text3); font-family: var(--mono);
}
.footer-item-dot {
  width: 5px; height: 5px; border-radius: 50%; background: var(--green); flex-shrink: 0;
}
.footer-sep { width: 1px; height: 14px; background: var(--border2); }
#retrieved-count { font-size: 11px; color: var(--text3); font-family: var(--mono); }
.footer-right { display: flex; align-items: center; gap: 10px; }
#btn-clear {
  background: none; border: 1px solid var(--border2); border-radius: 3px;
  padding: 5px 14px; cursor: pointer;
  font-size: 11px; font-weight: 500; letter-spacing: .05em; text-transform: uppercase;
  color: var(--text3); transition: border-color .15s, color .15s;
}
#btn-clear:hover { border-color: var(--red); color: var(--red); }

/* ── KEYFRAMES ────────────────────────────────────────── */
@keyframes cardIn    { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
@keyframes fadeIn    { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: none; } }
@keyframes msgIn     { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes spin      { to { transform: rotate(360deg); } }
@keyframes bounce    { 0%,100% { transform: translateY(0); opacity: .4; } 50% { transform: translateY(-5px); opacity: 1; } }
@keyframes shake     { 0%,100% { transform: translateX(0); } 25%,75% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }

@media (max-width: 860px) {
  #app.on { grid-template-columns: 1fr; grid-template-areas: "bar" "chat" "footer"; }
  #history-panel { display: none; }
  #messages { padding: 18px 16px; }
  #inputbar { padding: 10px 14px 14px; }
  #empty { padding: 32px 24px; }
  .empty-greeting { font-size: 30px; }
  .login-card { padding: 36px 28px; }
}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="login-screen">
  <div class="login-pattern"></div>
  <div class="login-card">
    <h1>Docs <em>Ask</em></h1>
    <p class="login-sub">Sign in to start a conversation with your ingested documents, connected by highly speed pipeline.</p>
    <div class="login-err" id="lerr"></div>
    <div class="field">
      <label>Client ID</label>
      <input id="f-cid" type="text" placeholder="e.g. acme-corp" autocomplete="off" spellcheck="false" />
    </div>
    <div class="field">
      <label>Password</label>
      <input id="f-cpw" type="password" placeholder="••••••••••" />
    </div>
    <button id="btn-signin" onclick="doLogin()">
      <span class="signin-label">Sign In</span>
      <div class="spinner"></div>
    </button>
  </div>
</div>

<!-- APP -->
<div id="app">

  <!-- Top Bar -->
  <div id="bar">
    <div class="bar-left">
      <div class="bar-logo-mark">A</div>
      <span class="bar-brand">Anuritmind</span>
      <span class="bar-tagline">Docs Ask</span>
    </div>
    <div class="bar-right">
      <span class="bar-greeting">Hi, <strong id="bar-name">—</strong></span>
      <button id="btn-logout" onclick="doLogout()">Sign Out</button>
    </div>
  </div>

  <!-- History Panel -->
  <div id="history-panel">
    <div class="history-head">
      <span class="history-head-label">Conversations</span>
      <button id="btn-new-chat" onclick="startNewChat()">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New
      </button>
    </div>
    <div id="history-list">
      <div class="history-empty" id="history-empty">
        <div class="history-empty-icon">📄</div>
        <p>No conversations yet.<br>Start asking to see history.</p>
      </div>
    </div>
  </div>

  <!-- Chat -->
  <div id="chat">
    <div id="empty">
      <div class="empty-eyebrow">Docs Ask</div>
      <div class="empty-greeting">Hi, <em id="greet-name">there</em></div>
      <p class="empty-sub">Your documents are ready. Ask anything — I'll find the answer for you.</p>
    </div>
    <div id="messages" style="display:none"></div>
    <div id="inputbar">
      <div class="inputwrap">
        <textarea id="qinput" rows="1"
          placeholder="Ask a question about your documents…"
          onkeydown="onKey(event)"
          oninput="grow(this)"></textarea>
        <button id="sendbtn" onclick="send()" title="Send">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      <div class="hint">Enter to send · Shift+Enter for new line</div>
    </div>
  </div>

  <!-- Footer -->
  <div id="app-footer">
    <div class="footer-meta">
      <div class="footer-item">
        <div class="footer-item-dot"></div>
        <span>Anurit's MiniLM-L12-v6</span>
      </div>
      <div class="footer-sep"></div>
      <div class="footer-item">
        <span>Azure Blob Storage</span>
      </div>
      <div class="footer-sep"></div>
      <div class="footer-item">
        <span id="side-cid">—</span>
      </div>
      <div id="retrieved-count"></div>
    </div>
    <div class="footer-right">
      <button id="btn-clear" onclick="clearChat()">Clear Conversation</button>
    </div>
  </div>

</div>

<script>
const API = 'https://anuritchatbackend.vercel.app'
// Top-K is set internally — 6 is optimal for RAG: enough context without noise
const TOP_K = 6

let sess = null
let msgs = []
let busy = false
let activeConversationId = null
let conversations = []

// ── LOGIN ──────────────────────────────────────────────
async function doLogin() {
  const cid = document.getElementById('f-cid').value.trim()
  const cpw = document.getElementById('f-cpw').value
  const btn = document.getElementById('btn-signin')
  if (!cid || !cpw) return showErr('Please enter your Client ID and password.')
  btn.classList.add('loading'); btn.disabled = true
  document.getElementById('lerr').classList.remove('show')
  try {
    const r = await fetch(`${API}/chat/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: cid, clientPassword: cpw }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'Login failed')
    sess = { clientId: d.client.clientId, clientPassword: cpw, name: d.client.name, username: d.client.clientUsername }
    bootApp()
  } catch (e) {
    showErr(e.message || 'Could not connect. Please try again.')
  } finally {
    btn.classList.remove('loading'); btn.disabled = false
  }
}

function showErr(msg) {
  const el = document.getElementById('lerr')
  el.textContent = msg; el.classList.add('show')
}

document.getElementById('f-cid').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin() })
document.getElementById('f-cpw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin() })

function bootApp() {
  document.getElementById('login-screen').style.display = 'none'
  document.getElementById('app').classList.add('on')
  const displayName = sess.name || sess.username || sess.clientId
  document.getElementById('bar-name').textContent = displayName
  document.getElementById('greet-name').textContent = displayName
  document.getElementById('side-cid').textContent = sess.clientId
  loadHistoryList()
  setTimeout(() => document.getElementById('qinput').focus(), 150)
}

function doLogout() {
  sess = null; msgs = []; busy = false; activeConversationId = null; conversations = []
  document.getElementById('login-screen').style.display = 'flex'
  document.getElementById('app').classList.remove('on')
  document.getElementById('f-cid').value = ''
  document.getElementById('f-cpw').value = ''
  document.getElementById('lerr').classList.remove('show')
  document.getElementById('messages').innerHTML = ''
  document.getElementById('messages').style.display = 'none'
  document.getElementById('empty').classList.remove('gone')
  document.getElementById('retrieved-count').textContent = ''
  document.getElementById('history-list').innerHTML = ''
  renderHistoryEmpty()
}

// ── HISTORY ────────────────────────────────────────────
function renderHistoryEmpty() {
  document.getElementById('history-list').innerHTML = `
    <div class="history-empty" id="history-empty">
      <div class="history-empty-icon">📄</div>
      <p>No conversations yet.<br>Start asking to see history.</p>
    </div>`
}

function renderHistorySkeletons() {
  document.getElementById('history-list').innerHTML =
    [1,2,3].map(() => `<div class="hist-skeleton"></div>`).join('')
}

async function loadHistoryList() {
  if (!sess) return
  renderHistorySkeletons()
  try {
    const r = await fetch(`${API}/chat/conversations/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: sess.clientId, clientPassword: sess.clientPassword }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error)
    conversations = d.conversations || []
    renderHistoryList()
  } catch (e) {
    console.warn('History load failed:', e.message)
    renderHistoryEmpty()
  }
}

function renderHistoryList() {
  const list = document.getElementById('history-list')
  if (!conversations.length) { renderHistoryEmpty(); return }
  list.innerHTML = conversations.map(c => buildHistItem(c)).join('')
}

function buildHistItem(c) {
  const date = formatHistDate(c.updatedAt || c.createdAt)
  const isActive = c._id === activeConversationId
  return `
    <div class="hist-item ${isActive ? 'active' : ''}" id="hi-${c._id}" onclick="openConversation('${c._id}')">
      <div class="hist-item-body">
        <div class="hist-item-title" id="hit-${c._id}">${esc(c.title || 'Untitled')}</div>
        <div class="hist-item-meta">${date}</div>
      </div>
      <div class="hist-item-actions">
        <button class="hist-act-btn" title="Rename" onclick="startRename(event,'${c._id}')">✏️</button>
        <button class="hist-act-btn del" title="Delete" onclick="deleteConversation(event,'${c._id}')">🗑️</button>
      </div>
    </div>`
}

function formatHistDate(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function setActiveHistItem(id) {
  document.querySelectorAll('.hist-item').forEach(el => el.classList.remove('active'))
  const el = document.getElementById(`hi-${id}`)
  if (el) el.classList.add('active')
}

// ── OPEN CONVERSATION ──────────────────────────────────
async function openConversation(id) {
  if (busy || activeConversationId === id) return
  try {
    const r = await fetch(`${API}/chat/conversations/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: sess.clientId, clientPassword: sess.clientPassword, conversationId: id }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error)
    activeConversationId = id
    msgs = d.messages || []
    const msgbox = document.getElementById('messages')
    msgbox.innerHTML = ''
    document.getElementById('empty').classList.add('gone')
    msgbox.style.display = 'flex'
    msgbox.style.flexDirection = 'column'
    msgbox.style.gap = '28px'
    for (const m of msgs) {
      appendMsg({ role: m.role, content: m.content, sources: m.role === 'assistant' ? (m.sources || []) : [], timestamp: m.timestamp }, msgbox)
    }
    setActiveHistItem(id)
    scrollBottom()
  } catch (e) { console.warn('Open conversation failed:', e.message) }
}

// ── NEW CHAT ───────────────────────────────────────────
function startNewChat() {
  activeConversationId = null; msgs = []
  const msgbox = document.getElementById('messages')
  msgbox.innerHTML = ''; msgbox.style.display = 'none'
  document.getElementById('empty').classList.remove('gone')
  document.getElementById('retrieved-count').textContent = ''
  document.querySelectorAll('.hist-item').forEach(el => el.classList.remove('active'))
  document.getElementById('qinput').focus()
}

// ── RENAME ─────────────────────────────────────────────
function startRename(e, id) {
  e.stopPropagation()
  const titleEl = document.getElementById(`hit-${id}`)
  if (!titleEl) return
  const oldTitle = titleEl.textContent
  titleEl.innerHTML = `<input class="hist-rename-input" value="${esc(oldTitle)}" id="rename-inp-${id}" />`
  const inp = document.getElementById(`rename-inp-${id}`)
  inp.focus(); inp.select()
  inp.addEventListener('keydown', async ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); await commitRename(id, inp.value.trim(), oldTitle) }
    if (ev.key === 'Escape') { titleEl.textContent = oldTitle }
  })
  inp.addEventListener('blur', () => {
    setTimeout(() => { if (document.getElementById(`rename-inp-${id}`)) commitRename(id, inp.value.trim(), oldTitle) }, 150)
  })
}

async function commitRename(id, newTitle, oldTitle) {
  const titleEl = document.getElementById(`hit-${id}`)
  if (!newTitle || newTitle === oldTitle) { if (titleEl) titleEl.textContent = oldTitle; return }
  try {
    const r = await fetch(`${API}/chat/conversations/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: sess.clientId, clientPassword: sess.clientPassword, conversationId: id, title: newTitle }),
    })
    if (!r.ok) throw new Error()
    if (titleEl) titleEl.textContent = newTitle
    const c = conversations.find(x => x._id === id)
    if (c) c.title = newTitle
  } catch { if (titleEl) titleEl.textContent = oldTitle }
}

// ── DELETE ─────────────────────────────────────────────
async function deleteConversation(e, id) {
  e.stopPropagation()
  if (!confirm('Delete this conversation?')) return
  try {
    const r = await fetch(`${API}/chat/conversations/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: sess.clientId, clientPassword: sess.clientPassword, conversationId: id }),
    })
    if (!r.ok) throw new Error()
    conversations = conversations.filter(c => c._id !== id)
    document.getElementById(`hi-${id}`)?.remove()
    if (!conversations.length) renderHistoryEmpty()
    if (activeConversationId === id) startNewChat()
  } catch { alert('Failed to delete conversation.') }
}

// ── SEND ───────────────────────────────────────────────
async function send(text) {
  const inp = document.getElementById('qinput')
  const rawQ = (text || inp.value).trim()
  if (!rawQ || busy || !sess) return

  // Normalize query — send lowercase so backend embedding matches regardless of user casing
  const q = rawQ
  const qNormalized = rawQ.toLowerCase().trim()

  inp.value = ''; grow(inp)
  busy = true
  document.getElementById('sendbtn').disabled = true
  document.getElementById('empty').classList.add('gone')

  const msgbox = document.getElementById('messages')
  msgbox.style.display = 'flex'
  msgbox.style.flexDirection = 'column'
  msgbox.style.gap = '28px'

  msgs.push({ role: 'user', content: q })
  appendMsg({ role: 'user', content: q }, msgbox)

  const tid = 'ty' + Date.now()
  msgbox.insertAdjacentHTML('beforeend', `
    <div class="msg assistant" id="${tid}">
      <div class="avatar">A</div>
      <div class="msg-body">
        <div class="typing-wrap">
          <div class="typing">
            <div class="dot"></div><div class="dot"></div><div class="dot"></div>
          </div>
        </div>
      </div>
    </div>`)
  scrollBottom()

  try {
    const r = await fetch(`${API}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: sess.clientId,
        clientPassword: sess.clientPassword,
        query: qNormalized,
        topK: TOP_K,
        conversationId: activeConversationId,
      }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'Request failed')

    if (d.conversationId && !activeConversationId) {
      activeConversationId = d.conversationId
      await loadHistoryList()
      setActiveHistItem(activeConversationId)
    }

    if (d.sources?.length) {
      document.getElementById('retrieved-count').textContent =
        `· ${d.sources.length} source${d.sources.length !== 1 ? 's' : ''} retrieved`
    }

    document.getElementById(tid)?.remove()

    // Clean up the answer before displaying
    let answer = cleanAnswer(d.answer, d.sources || [])

    msgs.push({ role: 'assistant', content: answer, sources: d.sources || [] })
    appendMsg({ role: 'assistant', content: answer, sources: d.sources || [] }, msgbox)
    refreshHistItemTime(activeConversationId)

  } catch (e) {
    document.getElementById(tid)?.remove()
    appendMsg({ role: 'assistant', content: `Something went wrong. Please try again.`, sources: [] }, msgbox)
  } finally {
    busy = false
    document.getElementById('sendbtn').disabled = false
    scrollBottom()
    document.getElementById('qinput').focus()
  }
}

// ── CLEAN ANSWER ───────────────────────────────────────
// Strips citation markers like [1], [2, 3], [1,2,3,4,5,6] from the AI response.
// Also catches "context does not define/contain/mention" fallback patterns and
// replaces them with a helpful message when sources ARE present.
function cleanAnswer(answer, sources) {
  if (!answer) return answer

  // Remove inline citation markers — [1], [2,3], [1, 2, 3, 4, 5, 6], etc.
  let cleaned = answer.replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '').trim()

  // Detect unhelpful "context does not..." fallback responses
  const fallbackPatterns = [
    /the (provided |given |available )?context does not (define|contain|mention|explain|include|describe|have|provide)/i,
    /is not (defined|mentioned|described|explained|included) in the (provided |given |available )?context/i,
    /no (information|data|definition|detail) (is |was )?(provided|found|available|present) (in|within) the (provided |given |available )?context/i,
    /the (document|context|provided (context|documents?)) (do(es)? not|doesn't) (define|contain|mention|explain|describe)/i,
    /based on the (provided |given |available )?context[^,]*,(?: i cannot| there is no| it is not)/i,
  ]

  const isFallback = fallbackPatterns.some(p => p.test(cleaned))

  // If it's a fallback but sources exist, the data IS there — give a better reply
  if (isFallback && sources.length > 0) {
    // Extract the core term from the fallback message if possible, else return generic
    cleaned = "The information is available in your documents — here's what was found in the relevant sections. You may want to rephrase your question with slightly different wording for a more targeted answer."
  }

  // Clean up multiple spaces left after removing citations
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()

  return cleaned
}

function refreshHistItemTime(id) {
  if (!id) return
  const c = conversations.find(x => x._id === id || x._id?.toString() === id)
  if (c) {
    c.updatedAt = new Date().toISOString()
    const metaEl = document.querySelector(`#hi-${id} .hist-item-meta`)
    if (metaEl) metaEl.textContent = formatHistDate(c.updatedAt)
  }
}

function clearChat() { startNewChat() }

// ── RENDER MESSAGE ─────────────────────────────────────
function appendMsg(msg, box) {
  const isUser = msg.role === 'user'
  const av = isUser ? (sess?.name?.[0]?.toUpperCase() || 'U') : 'A'
  const ts = msg.timestamp ? new Date(msg.timestamp) : new Date()
  const now = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  let srcHtml = ''
  if (!isUser && msg.sources?.length) {
    const uid = 'sp' + Date.now() + Math.random().toString(36).slice(2, 6)
    const items = msg.sources.map((s, i) => `
      <div class="src-item">
        <div class="src-top">
          <span class="src-idx">↗</span>
          <span class="src-file">${esc(s.source_file || 'unknown')}</span>
          <span class="src-score">${s.score != null ? (s.score * 100).toFixed(0) + '%' : '—'}</span>
        </div>
        <div class="src-preview">${esc(s.preview || '')}</div>
      </div>`).join('')
    srcHtml = `
      <button class="src-btn" onclick="toggleSrc('${uid}',this)">
        <span class="src-arrow">›</span>&nbsp;${msg.sources.length} document section${msg.sources.length !== 1 ? 's' : ''} referenced
      </button>
      <div class="src-panel" id="${uid}">${items}</div>`
  }

  // User: pill bubble. Assistant: flat text, no box.
  const contentHtml = isUser
    ? `<div class="bubble">${md(msg.content)}</div>`
    : `<div class="asst-text">${md(msg.content)}</div>`

  box.insertAdjacentHTML('beforeend', `
    <div class="msg ${msg.role}">
      <div class="avatar">${av}</div>
      <div class="msg-body">
        ${contentHtml}
        ${srcHtml}
        <div class="msg-meta">${now}</div>
      </div>
    </div>`)
  scrollBottom()
}

function toggleSrc(uid, btn) {
  document.getElementById(uid).classList.toggle('open')
  btn.classList.toggle('open')
}

// Friendly markdown renderer — produces readable, human-feeling output
function md(t) {
  if (!t) return ''
  let s = esc(t)

  // Code blocks
  s = s.replace(/```[\s\S]*?```/g, m => {
    const inner = m.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
    return `<pre><code>${inner}</code></pre>`
  })

  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')

  // Bullet lists — group consecutive bullet lines into <ul>
  s = s.replace(/((?:^|\n)[ \t]*[-•][ \t].+)+/g, block => {
    const items = block.split('\n').filter(l => l.trim())
    const lis = items.map(l => `<li>${l.replace(/^[ \t]*[-•][ \t]/, '')}</li>`).join('')
    return `<ul>${lis}</ul>`
  })

  // Numbered lists
  s = s.replace(/((?:^|\n)[ \t]*\d+\.[ \t].+)+/g, block => {
    const items = block.split('\n').filter(l => l.trim())
    const lis = items.map(l => `<li>${l.replace(/^[ \t]*\d+\.[ \t]/, '')}</li>`).join('')
    return `<ol>${lis}</ol>`
  })

  // Paragraphs — split on double newlines, avoid wrapping block elements
  const blocks = s.split(/\n\n+/)
  return blocks.map(block => {
    block = block.trim()
    if (!block) return ''
    if (block.startsWith('<ul') || block.startsWith('<ol') || block.startsWith('<pre')) return block
    return `<p>${block.replace(/\n/g, '<br>')}</p>`
  }).join('')
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function scrollBottom() {
  const b = document.getElementById('messages')
  if (b) b.scrollTop = b.scrollHeight
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}

function grow(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 150) + 'px'
}
</script>
</body>
</html>
