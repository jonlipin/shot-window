// Offline checks for Shot Window: loads ShotWindow.lua into fengari (Lua 5.3) against a stubbed
// WoW Forever client, then drives login, ranged and melee swings, OnUpdate ticks, resizes of the
// game's bar, every slash command, a non-hunter login, and secret values.
//
//   node tests/shotwindowtest.js [--verbose]
//   SHOTWINDOW_LUA=<path> node tests/shotwindowtest.js   (check another copy of the file)
//
// fengari is looked for in FENGARI=<its folder>, then on the normal require path, then in the
// scratchpad copy it was first run from.
//
// Secrets: secret(v) hands out a stand-in that the trap below holds to the client's rules, but only
// for code loaded from ShotWindow.lua (stub and test code stand in for the client and may touch
// secrets). Following https://warcraft.wiki.gg/wiki/Secret_Values, tainted code may NOT compare a
// secret (==, ~=, <, <=, also against nil), do arithmetic on it, index it, call it, take its length,
// use it as a table key, or truth-test a secret BOOLEAN; it MAY store and pass secrets, truth-test a
// non-boolean secret (always true), concatenate secret strings and numbers, and format them. A
// refused use raises a Lua error at the addon's line, as the client does, and is listed per run.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');
const ADDON_FILE = 'ShotWindow.lua';
const ADDON_SOURCE = '@' + ADDON_FILE;
// SHOTWINDOW_LUA=<file> runs the same checks against another copy (a candidate fix, say).
const ADDON_SRC = fs.readFileSync(process.env.SHOTWINDOW_LUA || path.join(ROOT, ADDON_FILE), 'utf8');

function findFengari() {
  const tries = [];
  if (process.env.FENGARI) tries.push(process.env.FENGARI);
  try { tries.push(path.dirname(require.resolve('fengari/package.json'))); } catch (e) { /* not on the path */ }
  tries.push('C:/Users/jonli/AppData/Local/Temp/claude/C--Users-jonli-ffxi-ah-analysis/989059d8-08ec-488d-9dd6-df53722920db/scratchpad/node_modules/fengari');
  for (const d of tries) if (fs.existsSync(path.join(d, 'src', 'lvm.js'))) return d;
  throw new Error('fengari not found; set FENGARI to its folder');
}
const FDIR = findFengari();

// Equality: luaV_equalobj is module-local in lvm.js and sees == against nil, which __eq never does,
// so lvm.js is patched as it loads.
const lvmPath = require.resolve(path.join(FDIR, 'src', 'lvm.js'));
let lvmPatched = false;
{
  const origJs = Module._extensions['.js'];
  Module._extensions['.js'] = function (m, filename) {
    if (filename !== lvmPath) return origJs(m, filename);
    const src = fs.readFileSync(filename, 'utf8');
    const hook = 'const luaV_equalobj = function(L, t1, t2) {';
    if (!src.includes(hook)) throw new Error('fengari lvm.js changed shape');
    lvmPatched = true;
    m._compile(src.replace(hook, hook + ' if (L !== null && global.__swEqHook) global.__swEqHook(L, t1, t2);'), filename);
  };
}
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(FDIR);
if (!lvmPatched) throw new Error('lvm.js was loaded before the equality hook could be installed');
const lobject = require(path.join(FDIR, 'src', 'lobject.js'));
const ltable = require(path.join(FDIR, 'src', 'ltable.js'));
const ldebug = require(path.join(FDIR, 'src', 'ldebug.js'));
const { LUA_TTABLE } = require(path.join(FDIR, 'src', 'defs.js')).constant_types;

// ---------------------------------------------------------------------------------------------
// The secret trap
const BOX = new WeakMap(); // stand-in table -> { type, tv }
let HITS = new Map();      // refused uses by the addon: "ShotWindow.lua:N  what" -> count
let SEEN = new Map();      // allowed uses by the addon, for the report
let L = null;              // the state being run
const isSecretTV = (tv) => !!tv && tv.type === LUA_TTABLE && BOX.has(tv.value);

function addonWhere(state) {
  for (let ci = state && state.ci; ci; ci = ci.previous) {
    const f = ci.func && ci.func.value;
    if (f && f.p) {
      if (to_jsstring(f.p.source.getstr()) !== ADDON_SOURCE) return null;
      return ADDON_FILE + ':' + (f.p.lineinfo[ci.l_savedpc - 1] || '?');
    }
  }
  return null;
}
function tally(map, where, what) { const k = where + '  ' + what; map.set(k, (map.get(k) || 0) + 1); }
function refuse(state, what) {
  state = state || L;
  const where = addonWhere(state);
  if (!where) return false;
  tally(HITS, where, what);
  const ci = state.ci;
  const inLua = ci.func && ci.func.value && ci.func.value.p; // runerror adds file:line itself then
  ldebug.luaG_runerror(state, to_luastring((inLua ? '' : where + ': ') + 'attempt to perform ' + what + ' on a secret value (tainted by ShotWindow)'));
  return true;
}
function allowed(state, what) {
  const where = addonWhere(state || L);
  if (where) tally(SEEN, where, what);
}

// Truth tests: if/while/not/and/or all go through TValue.l_isfalse.
{
  const orig = lobject.TValue.prototype.l_isfalse;
  lobject.TValue.prototype.l_isfalse = function () {
    if (isSecretTV(this)) {
      const typ = BOX.get(this.value).type;
      if (typ === 'boolean') refuse(L, 'boolean test');
      else allowed(L, 'truth test of a secret ' + typ + ' (allowed)');
    }
    return orig.call(this);
  };
}
global.__swEqHook = (state, a, b) => { if (isSecretTV(a) || isSecretTV(b)) refuse(state, 'comparison (== or ~=)'); };
for (const name of ['luaH_get', 'luaH_setfrom']) {
  const orig = ltable[name];
  ltable[name] = function (state, t, key, ...rest) {
    if (isSecretTV(key)) refuse(state, 'table access with a secret key');
    return orig.call(this, state, t, key, ...rest);
  };
}

const arg1 = (S, i) => (lua.lua_gettop(S) >= i ? S.stack[S.ci.funcOff + i] : null);
function mint(S) { // replaces the value on top of the stack with a secret stand-in for it
  const src = S.stack[S.top - 1];
  const typ = to_jsstring(lua.lua_typename(S, lua.lua_type(S, -1)));
  const tv = new lobject.TValue(src.type, src.value);
  lua.lua_pop(S, 1);
  lua.lua_newtable(S);
  BOX.set(lua.lua_topointer(S, -1), { type: typ, tv });
  lua.lua_getfield(S, lua.LUA_REGISTRYINDEX, to_luastring('SW_SECRET_META'));
  lua.lua_setmetatable(S, -2);
}
function pushPlain(S, i) { // pushes argument i, unwrapped if it is a secret
  const tv = arg1(S, i);
  if (isSecretTV(tv)) lobject.pushobj2s(S, BOX.get(tv.value).tv); else lua.lua_pushvalue(S, i);
}
function installSecretApi(S) {
  const fn = (name, f) => { lua.lua_pushcfunction(S, f); lua.lua_setglobal(S, to_luastring(name)); };
  fn('secret', (S) => { lua.lua_settop(S, 1); mint(S); return 1; });
  fn('issecretvalue', (S) => { lua.lua_pushboolean(S, isSecretTV(arg1(S, 1))); return 1; });
  fn('unsecret', (S) => { pushPlain(S, 1); return 1; });
  fn('secrettype', (S) => { lua.lua_pushstring(S, to_luastring(BOX.get(arg1(S, 1).value).type)); return 1; });

  // Metamethods are JS functions, so the nearest Lua frame when they run is the code that used
  // the secret (math.max and friends are skipped as C frames).
  lua.lua_newtable(S);
  const set = (name, f) => { lua.lua_pushcfunction(S, f); lua.lua_setfield(S, -2, to_luastring(name)); };
  for (const e of ['add', 'sub', 'mul', 'div', 'mod', 'pow', 'unm', 'idiv', 'band', 'bor', 'bxor', 'shl', 'shr', 'bnot']) {
    set('__' + e, (S) => { refuse(S, 'arithmetic'); return 0; });
  }
  set('__lt', (S) => { refuse(S, 'ordered comparison'); lua.lua_pushboolean(S, false); return 1; });
  set('__le', (S) => { refuse(S, 'ordered comparison'); lua.lua_pushboolean(S, false); return 1; });
  set('__eq', (S) => { refuse(S, 'comparison (== or ~=)'); lua.lua_pushboolean(S, false); return 1; });
  set('__index', (S) => { refuse(S, 'indexing'); return 0; });
  set('__newindex', (S) => { refuse(S, 'indexed assignment'); return 0; });
  set('__call', (S) => { refuse(S, 'call'); return 0; });
  set('__len', (S) => { refuse(S, 'length'); return 0; });
  set('__pairs', (S) => { refuse(S, 'iteration'); return 0; });
  set('__concat', (S) => { // allowed for strings and numbers; the result is secret
    allowed(S, 'concatenation (allowed)');
    pushPlain(S, 1); pushPlain(S, 2); lua.lua_concat(S, 2); mint(S); return 1;
  });
  set('__tostring', (S) => { allowed(S, 'tostring'); lua.lua_pushstring(S, to_luastring('<secret>')); return 1; });
  lua.lua_pushstring(S, to_luastring('secret')); lua.lua_setfield(S, -2, to_luastring('__name'));
  lua.lua_pushboolean(S, false); lua.lua_setfield(S, -2, to_luastring('__metatable'));
  lua.lua_setfield(S, lua.LUA_REGISTRYINDEX, to_luastring('SW_SECRET_META'));
}

// ---------------------------------------------------------------------------------------------
// The client stub
const STUB = String.raw`
T = { prints = {}, frames = {}, errors = {}, fails = {}, checks = 0 }
T.now = 100
T.className, T.class = "Hunter", "HUNTER"
T.speed = { mh = 2.0, oh = nil, rng = 2.8 }
T.net = { 0, 0, 0, 0 }
T.cvars = { showSwingTimer = "1", loadDeprecationFallbacks = "1" }
T.known = { [34120] = true }
T.spells = {
  { spellID = 34120, name = "Steady Shot", castTime = 1500 },
  { spellID = 19434, name = "Aimed Shot", castTime = 3000 },
  { spellID = 3044, name = "Arcane Shot", castTime = 0 },
}
T.secretCast = false

-- The client's type() answers a secret's real type, and string.format accepts secrets and
-- hands back a secret.
local realType = type
function type(v) if issecretvalue(v) then return secrettype(v) end return realType(v) end
local realFormat = string.format
string.format = function(fmt, ...)
  local n, args, any = select("#", ...), { ... }, issecretvalue(fmt)
  for i = 1, n do if issecretvalue(args[i]) then any = true args[i] = unsecret(args[i]) end end
  if not any then return realFormat(fmt, ...) end
  return secret(realFormat(unsecret(fmt), table.unpack(args, 1, n)))
end
format = string.format

function GetTime() return T.now end
function UnitClass(unit) return T.className, T.class, 3 end
function UnitAttackSpeed(unit) return T.speed.mh, T.speed.oh, T.speed.rng end
function IsPlayerSpell(id) return T.known[id] == true end
PixelUtil = { GetNearestPixelSize = function(size, scale, minPixels) T.pixelCalls = (T.pixelCalls or 0) + 1 return T.pixelSize or size end }
C_SpellBook = { IsSpellKnown = function(id, bank) return T.known[id] == true end }
Enum = { PlayerSwingType = { MainHand = 0, OffHand = 1, Ranged = 2 }, SpellBookSpellBank = { Player = 0, Pet = 1 } }
C_Spell = { GetSpellInfo = function(s)
  for _, sp in ipairs(T.spells) do
    if sp.spellID == s or (realType(s) == "string" and sp.name:lower() == s:lower()) then
      local cast = sp.castTime
      if T.secretCast then cast = secret(cast) end
      return { spellID = sp.spellID, name = sp.name, castTime = cast, iconID = 0, originalIconID = 0, minRange = 0, maxRange = 35 }
    end
  end
end }
function GetNetStats() return T.net[1], T.net[2], T.net[3], T.net[4] end
function GetCVar(name) return T.cvars[name] end
DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) T.prints[#T.prints + 1] = m end }
SlashCmdList = {}

-- Frames and textures answer only the methods stubbed here; anything else the addon calls is an
-- error, so a typo or an unexpected API shows up.
local function strict(methods, kind)
  return { __index = function(self, k)
    local m = methods[k]
    if m == nil then error(kind .. " stub has no method or field '" .. tostring(k) .. "'", 2) end
    return m
  end }
end
local Texture = {}
local TextureMeta = strict(Texture, "Texture")
function Texture:SetColorTexture(r, g, b, a) self.color = { r, g, b, a } self.colorCalls = self.colorCalls + 1 end
function Texture:SetPoint(p, rel, relp, x, y) self.points[#self.points + 1] = { p, rel, relp, x or 0, y or 0 } end
function Texture:ClearAllPoints() self.points = {} end
function Texture:SetWidth(w) self.width = w end
function Texture:Show() self.shown = true end
function Texture:Hide() self.shown = false end
function Texture:SetShown(s) self.shown = not not s end
function Texture:IsShown() return self.shown end

local Frame = {}
local FrameMeta = strict(Frame, "Frame")
function Frame:SetScript(n, f) self.scripts[n] = f end
function Frame:GetScript(n) return self.scripts[n] end
function Frame:HookScript(n, f) self.hooks[n] = self.hooks[n] or {} table.insert(self.hooks[n], f) end
function Frame:RegisterEvent(e) self.events[e] = true end
function Frame:RegisterUnitEvent(e, ...) self.events[e] = { ... } end
function Frame:UnregisterEvent(e) self.events[e] = nil end
function Frame:IsEventRegistered(e) return self.events[e] ~= nil end
function Frame:GetWidth() return self.width end
function Frame:GetHeight() return self.height end
function Frame:GetEffectiveScale() return rawget(self, "scale") or 1 end
function Frame:CreateTexture(name, layer, inherits, sublevel)
  local t = setmetatable({ parent = self, layer = layer or false, sublevel = sublevel or 0, shown = true,
    points = {}, width = 0, color = false, colorCalls = 0 }, TextureMeta)
  self.textures[#self.textures + 1] = t
  return t
end
function CreateFrame(kind, name, parent)
  local f = setmetatable({ kind = kind, name = name or false, scripts = {}, hooks = {}, events = {},
    textures = {}, width = 0, height = 0 }, FrameMeta)
  T.frames[#T.frames + 1] = f
  if name then _G[name] = f end
  return f
end
UIParent = CreateFrame("Frame", "UIParent")

-- The client runs every script in its own protected call and reports the error.
function T.call(f, ...)
  local ok, err = pcall(f, ...)
  if not ok then T.errors[#T.errors + 1] = tostring(err) end
  return ok
end
function T.fire(e, ...)
  local unit = ...
  for _, f in ipairs(T.frames) do
    local reg = f.events[e]
    if reg and f.scripts.OnEvent then
      local deliver = reg == true
      if realType(reg) == "table" then for _, u in ipairs(reg) do if u == unit then deliver = true end end end
      if deliver then T.call(f.scripts.OnEvent, f, e, ...) end
    end
  end
end
function T.update(elapsed)
  for _, f in ipairs(T.frames) do
    local s = f.scripts.OnUpdate
    if s then T.call(s, f, elapsed or 0.016) end
  end
end
function T.slash(msg) T.call(SlashCmdList.SHOTWINDOW, msg) end
-- Blizzard_SwingTimer's frame; its StatusBar is what the addon draws on.
function T.makeBar(width)
  local frame = CreateFrame("Frame", "SwingTimerRangedFrame", UIParent)
  local bar = CreateFrame("StatusBar", nil, frame)
  bar.width, bar.height = width or 200, 12
  frame.StatusBar = bar
  T.bar = bar
  return bar
end
-- Edit Mode resizing the frame: the anchored StatusBar gets OnSizeChanged.
function T.resize(w)
  local b = T.bar
  b.width = w
  if b.scripts.OnSizeChanged then T.call(b.scripts.OnSizeChanged, b, w, b.height) end
  for _, h in ipairs(b.hooks.OnSizeChanged or {}) do T.call(h, b, w, b.height) end
end
function T.tex()
  local t = T.bar.textures
  return { stand = t[1], line = t[2] }
end
function T.said(text)
  for _, m in ipairs(T.prints) do if m:find(text, 1, true) then return true end end
  return false
end
function T.login(width) if not T.bar then T.makeBar(width or 200) end T.fire("PLAYER_LOGIN") end

function check(ok, what) T.checks = T.checks + 1 if not ok then T.fails[#T.fails + 1] = what end end
function near(a, b) return realType(a) == "number" and realType(b) == "number" and math.abs(a - b) < 1e-6 end
local function f(v) if realType(v) == "number" then return realFormat("%.4f", v) end return tostring(v) end
-- A span's left edge and width, or nil when hidden; both anchors must agree.
function T.span(t)
  if not t.shown then return nil end
  if #t.points ~= 2 or t.points[1][4] ~= t.points[2][4] or t.points[1][1] ~= "TOPLEFT" or t.points[2][1] ~= "BOTTOMLEFT" then
    return "bad anchors"
  end
  return t.points[1][4], t.width
end
-- A line's centre x, or nil when hidden.
function T.line(t)
  if not t.shown then return nil end
  if #t.points ~= 2 or t.points[1][4] ~= t.points[2][4] or t.points[1][1] ~= "TOP" or t.points[2][1] ~= "BOTTOM" or t.width ~= (T.pixelSize or 2) then
    return "bad anchors"
  end
  return t.points[1][4]
end
function checkSpan(label, t, left, right)
  local x, w = T.span(t)
  if left == nil then check(x == nil, label .. " hidden (got x=" .. f(x) .. ")") return end
  check(near(x, left) and near(w, math.max(1, right - left)),
    label .. " from x=" .. f(left) .. " to " .. f(right) .. " (got x=" .. f(x) .. " width " .. f(w) .. ")")
end
function checkLine(label, t, at)
  local x = T.line(t)
  if at == nil then check(x == nil, label .. " hidden (got x=" .. f(x) .. ")") return end
  check(near(x, at), label .. " at x=" .. f(at) .. " (got " .. f(x) .. ")")
end
-- Where the red zone belongs, worked out independently of the addon's code path:
-- it starts window + latency before the end of the swing.
function checkBands(label, width, dur, window, lat)
  local x = T.tex()
  local standX = width * math.max(0, dur - window - (lat or 0)) / dur
  if standX < width then checkSpan(label .. ": red band", x.stand, standX, width) else checkSpan(label .. ": red band", x.stand, nil) end
  checkLine(label .. ": red line", x.line, (standX > 0 and standX < width) and standX or nil)
end
function checkAllHidden(label)
  for k, t in pairs(T.tex()) do check(not t.shown, label .. ": " .. k .. " hidden") end
end
function alpha() local c = T.tex().stand.color return c and c[4] end
function T.report()
  local out = {}
  for _, m in ipairs(T.fails) do out[#out + 1] = "F\t" .. m end
  for _, m in ipairs(T.errors) do out[#out + 1] = "E\t" .. m end
  for _, m in ipairs(T.prints) do out[#out + 1] = "P\t" .. m end
  out[#out + 1] = "C\t" .. T.checks
  return table.concat(out, "\n")
end
`;

// ---------------------------------------------------------------------------------------------
function exec(S, code, name) {
  if (lauxlib.luaL_loadbuffer(S, to_luastring(code), null, to_luastring(name)) !== 0) return lua.lua_tojsstring(S, -1);
  if (lua.lua_pcall(S, 0, 0, 0) !== 0) return lua.lua_tojsstring(S, -1);
  return null;
}
function newState() {
  const S = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(S);
  L = S;
  installSecretApi(S);
  const err = exec(S, STUB, '=stub');
  if (err) throw new Error('stub: ' + err);
  return S;
}
function loadAddon(S) {
  if (lauxlib.luaL_loadbuffer(S, to_luastring(ADDON_SRC), null, to_luastring(ADDON_SOURCE)) !== 0) return lua.lua_tojsstring(S, -1);
  lua.lua_pushstring(S, to_luastring('ShotWindow'));
  lua.lua_newtable(S);
  lua.lua_pushvalue(S, -1); lua.lua_setglobal(S, to_luastring('NS'));
  if (lua.lua_pcall(S, 2, 0, 0) !== 0) return lua.lua_tojsstring(S, -1);
  return exec(S, 'T.driver = T.frames[#T.frames]', '=test');
}

// The trap must work before anything it says can be trusted.
function selfTest() {
  const S = newState();
  const probes = [
    ['s == nil', 'local x = (S == nil)', false], ['s ~= nil', 'local x = (S ~= nil)', false],
    ['s <= 0', 'local x = (S <= 0)', false], ['s + 1', 'local x = S + 1', false], ['-s', 'local x = -S', false],
    ['s / 1000', 'local x = S / 1000', false], ['math.max(0, s)', 'local x = math.max(0, S)', false],
    ['if b then (secret boolean)', 'if B then end', false], ['t[s]', 'local t = {} local x = t[S]', false],
    ['if s then (secret number)', 'if S then end', true], ['not s (secret number)', 'local x = not S', true],
    ['"a" .. s', 'local x = "a" .. S assert(issecretvalue(x))', true], ['issecretvalue(s)', 'assert(issecretvalue(S))', true],
    ['pass and store s', 'local t = {} t.v = S local function g(v) return v end g(S)', true],
  ];
  exec(S, 'S = secret(2.8) B = secret(true)', '=test');
  const bad = [];
  for (const [label, code, shouldPass] of probes) {
    const err = exec(S, 'local ok, e = pcall(function() ' + code + ' end) if not ok then error(e, 0) end', ADDON_SOURCE);
    if ((err === null) !== shouldPass) bad.push(label + (shouldPass ? ' raised: ' + err : ' was not refused'));
  }
  const harnessErr = exec(S, 'local x = (S == nil) if B then end', '=test');
  if (harnessErr) bad.push('harness code was refused: ' + harnessErr);
  if (bad.length) { console.log('SECRET TRAP SELF-TEST FAILED\n  ' + bad.join('\n  ')); process.exit(2); }
  console.log('trap self-test: ' + probes.length + ' probes behave as the client does');
  HITS = new Map(); SEEN = new Map();
}

let failed = 0, passed = 0, checks = 0;
function scenario(name, body) {
  HITS = new Map(); SEEN = new Map();
  const S = newState();
  const loadErr = loadAddon(S);
  let lines = [];
  if (loadErr) lines.push('E\tloading ShotWindow.lua: ' + loadErr);
  else {
    const bodyErr = exec(S, body, '=test');
    if (bodyErr) lines.push('F\ttest body stopped: ' + bodyErr);
  }
  const repErr = exec(S, 'REPORT = T.report()', '=test');
  if (repErr) lines.push('F\treport: ' + repErr);
  lua.lua_getglobal(S, to_luastring('REPORT'));
  const rep = lua.lua_isstring(S, -1) ? lua.lua_tojsstring(S, -1) : '';
  lines = lines.concat(rep.split('\n').filter(Boolean));
  const fails = lines.filter(l => l[0] === 'F').map(l => 'check failed: ' + l.slice(2));
  const errs = lines.filter(l => l[0] === 'E').map(l => 'Lua error:    ' + l.slice(2));
  const c = lines.find(l => l[0] === 'C');
  checks += c ? Number(c.slice(2)) : 0;
  const bad = fails.length + errs.length;
  if (bad) failed++; else passed++;
  console.log((bad ? 'FAIL ' : 'ok   ') + name);
  for (const l of errs.concat(fails)) console.log('       ' + l);
  for (const [k, n] of HITS) console.log('       refused secret use: ' + k + '  x' + n);
  if (VERBOSE) {
    for (const [k, n] of SEEN) console.log('       allowed secret use: ' + k + '  x' + n);
    for (const l of lines.filter(l => l[0] === 'P')) console.log('       | ' + l.slice(2));
  }
}

selfTest();

// With dur 2.8, window 0.5 and no latency on a 200 px bar the red zone runs from
// 200*2.3/2.8 = 164.2857 to 200.
const RED_X = 200 * 2.3 / 2.8;

scenario('hunter login: textures, hook, events, preview from the weapon speed', String.raw`
  T.login(200)
  check(#T.errors == 0, "no errors at login")
  check(SlashCmdList.SHOTWINDOW ~= nil and SLASH_SHOTWINDOW1 == "/shotwindow" and SLASH_SHOTWINDOW2 == "/shotwin", "slash command registered")
  check(type(ShotWindowDB) == "table" and ShotWindowDB.window == 0.5 and ShotWindowDB.latency == true
    and ShotWindowDB.flash == true and type(ShotWindowDB.color) == "table", "saved variables filled from defaults")
  check(#T.bar.textures == 2, "two textures on the bar (got " .. #T.bar.textures .. ")")
  local x = T.tex()
  check(x.stand.layer == "ARTWORK" and x.stand.sublevel == 6 and x.line.layer == "ARTWORK" and x.line.sublevel == 7, "draw layers")
  check(x.stand.color[1] == 0.95 and x.stand.color[4] == 0.35 and x.line.color[4] == 0.95, "colours")
  check(#(T.bar.hooks.OnSizeChanged or {}) == 1, "OnSizeChanged hooked once")
  local ev = T.driver.events
  check(ev.PLAYER_SWING == true and ev.WEAPON_SLOT_CHANGED == true and ev.PLAYER_EQUIPMENT_CHANGED == true
    and ev.UI_SCALE_CHANGED == true and ev.DISPLAY_SIZE_CHANGED == true, "events registered")
  check(ev.SPELLS_CHANGED == nil, "no spell tracking")
  check(type(ev.UNIT_ATTACK_SPEED) == "table" and ev.UNIT_ATTACK_SPEED[1] == "player", "UNIT_ATTACK_SPEED for the player only")
  check(ev.ADDON_LOADED == nil, "not waiting for ADDON_LOADED when the bar exists")
  check(T.driver.scripts.OnUpdate == nil, "no OnUpdate while idle")
  checkBands("preview", 200, 2.8, 0.5, 0)
`);

scenario('ranged swing 2.8 s: band position, red zone brightening, swing end', String.raw`
  T.login(200)
  T.now = 100
  T.fire("PLAYER_SWING", 2.8, 2)
  check(T.driver.scripts.OnUpdate ~= nil, "OnUpdate runs during the swing")
  local x = T.tex()
  checkSpan("red band", x.stand, ${RED_X}, 200)
  checkLine("red line", x.line, ${RED_X})
  local calls = x.stand.colorCalls
  for _, el in ipairs({ 0.1, 0.5, 1.0, 2.0, 2.25 }) do
    T.now = 100 + el T.update(0.016)
    check(alpha() == 0.35, "dim at " .. el .. " s (alpha " .. tostring(alpha()) .. ")")
  end
  for _, el in ipairs({ 2.35, 2.5, 2.75, 2.79 }) do
    T.now = 100 + el T.update(0.016)
    check(alpha() == 0.65, "bright inside the red zone at " .. el .. " s (alpha " .. tostring(alpha()) .. ")")
  end
  check(x.stand.colorCalls == calls + 1, "brightened once, not every frame (" .. (x.stand.colorCalls - calls) .. " calls)")
  T.now = 102.85 T.update(0.016)
  check(T.driver.scripts.OnUpdate == nil, "OnUpdate removed at swing end")
  check(alpha() == 0.35, "dim again after the swing")
  checkSpan("red band stays after the swing", x.stand, ${RED_X}, 200)
  T.now = 200 T.fire("PLAYER_SWING", 2.8, 2)
  calls = x.stand.colorCalls
  for k = 1, 290 do T.now = 200 + k * 0.01 T.update(0.01) end
  check(x.stand.colorCalls == calls + 2, "two colour changes over a full swing (" .. (x.stand.colorCalls - calls) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('melee and off-hand swings are ignored', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 101 T.fire("PLAYER_SWING", 2.0, 0) T.fire("PLAYER_SWING", 1.5, 1)
  checkBands("after melee swings", 200, 2.8, 0.5, 0)
  T.now = 102.35 T.update()
  check(alpha() == 0.65, "red zone timing still follows the ranged swing")
  T.now = 102.85 T.update()
  check(T.driver.scripts.OnUpdate == nil, "ranged swing ended at 2.8 s, not restarted by melee")
  T.now = 110 T.fire("PLAYER_SWING", 2.0, 0)
  check(T.driver.scripts.OnUpdate == nil, "a melee swing while idle starts nothing")
  check(#T.errors == 0, "no errors")
`);

scenario('resize through the hooked OnSizeChanged', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.resize(300)
  checkBands("300 px", 300, 2.8, 0.5, 0)
  T.resize(0)
  checkAllHidden("0 px")
  T.resize(200)
  checkBands("back to 200 px", 200, 2.8, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('bar without a size at login gets bands when Edit Mode sizes it', String.raw`
  T.login(0)
  checkAllHidden("0 px at login")
  T.resize(200)
  checkBands("sized later", 200, 2.8, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('marker line never thinner than one physical pixel', String.raw`
  T.login(200)
  check((T.pixelCalls or 0) > 0, "line width goes through PixelUtil")
  T.pixelSize = 2.5
  T.bar.scale = 0.5
  T.fire("UI_SCALE_CHANGED")
  checkBands("re-laid on UI_SCALE_CHANGED", 200, 2.8, 0.5, 0)
  T.pixelSize = 3
  T.fire("DISPLAY_SIZE_CHANGED")
  checkBands("re-laid on DISPLAY_SIZE_CHANGED", 200, 2.8, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('/shotwindow window', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.slash("window 0.3")
  check(ShotWindowDB.window == 0.3 and T.said("Auto Shot aim window set to 0.3 s"), "window 0.3 taken")
  checkBands("window 0.3", 200, 2.8, 0.3, 0)
  T.now = 102.45 T.update() check(alpha() == 0.35, "window 0.3: still dim at 2.45 s")
  T.now = 102.55 T.update() check(alpha() == 0.65, "window 0.3: bright at 2.55 s (mid-swing change applies)")
  T.slash("window 5") check(ShotWindowDB.window == 0.3 and T.said("between 0 and 2"), "window 5 refused")
  T.slash("window abc") check(ShotWindowDB.window == 0.3, "window abc refused")
  T.slash("window -1") check(ShotWindowDB.window == 0.3, "window -1 refused")
  T.slash("window") check(ShotWindowDB.window == 0.3, "window with no number refused")
  T.slash("WINDOW 0") check(ShotWindowDB.window == 0, "command words ignore case")
  checkBands("window 0", 200, 2.8, 0, 0)
  T.slash("window 2")
  checkBands("window 2", 200, 2.8, 2, 0)
  T.now = 200 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 200.9 T.update() check(alpha() == 0.65, "window 2: bright from 0.8 s")
  check(#T.errors == 0, "no errors")
`);

scenario('latency moves the red zone earlier; /shotwindow latency', String.raw`
  T.net = { 0, 0, 40, 120 }
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  checkBands("latency on, 120 ms world", 200, 2.8, 0.5, 0.12)
  T.now = 102.15 T.update() check(alpha() == 0.35, "dim at 2.15 s")
  T.now = 102.20 T.update() check(alpha() == 0.65, "bright from 2.18 s (window + latency)")
  T.slash("latency")
  check(ShotWindowDB.latency == false and T.said("latency off"), "latency off")
  checkBands("latency off", 200, 2.8, 0.5, 0)
  T.now = 200 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 202.25 T.update() check(alpha() == 0.35, "latency off: dim at 2.25 s")
  T.slash("latency")
  check(ShotWindowDB.latency == true and T.said("latency on"), "latency on")
  checkBands("latency on again", 200, 2.8, 0.5, 0.12)
  T.net = { 0, 0, 40, nil }
  T.resize(200)
  checkBands("home latency when world is missing", 200, 2.8, 0.5, 0.04)
  check(#T.errors == 0, "no errors")
`);

scenario('/shotwindow flash', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update() check(alpha() == 0.65, "bright in the red zone")
  T.slash("flash")
  check(ShotWindowDB.flash == false and T.said("flash off"), "flash off")
  check(alpha() == 0.35, "dimmed at once")
  T.now = 102.5 T.update() check(alpha() == 0.35, "stays dim with flash off")
  T.slash("flash")
  check(ShotWindowDB.flash == true and T.said("flash on"), "flash on")
  T.now = 102.6 T.update() check(alpha() == 0.65, "bright again with flash on")
  check(#T.errors == 0, "no errors")
`);

scenario('/shotwindow debug, garbage and empty input', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.slash("debug")
  check(T.said("version 0.1.0"), "debug: version")
  check(T.said("bar found: true, showSwingTimer: 1"), "debug: bar and cvar")
  check(T.said("swing: 2.8 s (weapon 2.8 s)"), "debug: swing line")
  check(T.said("red zone: last 0.50 s = window 0.50 + latency 0.000"), "debug: red zone line")
  local n = #T.prints
  T.slash("garbage words")
  check(#T.prints == n + 4 and T.said("/shotwindow window <seconds>") and T.said("/shotwindow debug"), "garbage shows usage")
  T.slash("") T.slash("   ") T.slash(nil)
  check(#T.prints == n + 16, "empty input shows usage (" .. (#T.prints - n) .. ")")
  checkBands("unchanged by debug/usage", 200, 2.8, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('saved settings survive login and are topped up', String.raw`
  ShotWindowDB = { window = 0.4, latency = false }
  T.login(200)
  check(ShotWindowDB.window == 0.4 and ShotWindowDB.latency == false and ShotWindowDB.flash == true
    and type(ShotWindowDB.color) == "table", "kept and topped up")
  checkBands("saved window 0.4", 200, 2.8, 0.4, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('speed changes: ignored mid-swing, previewed while idle', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.speed.rng = 2.24
  T.now = 101 T.fire("UNIT_ATTACK_SPEED", "player")
  checkBands("mid-swing speed change ignored", 200, 2.8, 0.5, 0)
  T.now = 102.9 T.update()
  T.fire("UNIT_ATTACK_SPEED", "target")
  checkBands("other units are not delivered", 200, 2.8, 0.5, 0)
  T.fire("UNIT_ATTACK_SPEED", "player")
  checkBands("idle: new weapon speed previewed", 200, 2.24, 0.5, 0)
  T.speed.rng = 3.0
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, false)
  checkBands("idle: equipment change previewed", 200, 3.0, 0.5, 0)
  T.speed.rng = 2.6
  T.fire("WEAPON_SLOT_CHANGED")
  checkBands("idle: weapon slot change previewed", 200, 2.6, 0.5, 0)
  check(T.driver.scripts.OnUpdate == nil, "idle weapon change starts no clock")
  T.speed.rng = nil
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, true)
  checkAllHidden("no ranged weapon")
  T.speed.rng = 2.8
  T.now = 120 T.fire("PLAYER_SWING", 2.24, 2)
  checkBands("hasted swing", 200, 2.24, 0.5, 0)
  T.now = 120.4 T.fire("PLAYER_SWING", 0.4, 2)
  checkBands("swing shorter than the window: all red, no line", 200, 0.4, 0.5, 0)
  T.now = 120.41 T.update() check(alpha() == 0.65, "whole short swing is red")
  check(#T.errors == 0, "no errors")
`);

scenario('next swing restarts the clock and dims the red zone', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.5 T.update() check(alpha() == 0.65, "bright")
  T.now = 102.6 T.fire("PLAYER_SWING", 2.8, 2)
  check(alpha() == 0.35, "a new swing dims the red zone")
  T.now = 104.0 T.update() check(T.driver.scripts.OnUpdate ~= nil and alpha() == 0.35, "running from the new start")
  T.now = 104.95 T.update() check(alpha() == 0.65, "bright 2.35 s into the new swing")
  check(#T.errors == 0, "no errors")
`);

scenario('/shotwindow flash before the bar exists and before any swing', String.raw`
  T.fire("PLAYER_LOGIN")
  T.slash("flash")
  check(#T.errors == 0, "/shotwindow flash with no bar raises no error")
  check(ShotWindowDB.flash == false, "flash still toggled")
`);

scenario('swings and events while the bar is still missing', String.raw`
  T.fire("PLAYER_LOGIN")
  for s = 0, 2 do
    local t0 = 100 + s * 3
    T.now = t0 T.fire("PLAYER_SWING", 2.8, 2)
    for k = 1, 29 do T.now = t0 + k * 0.1 T.update(0.1) end
  end
  T.fire("WEAPON_SLOT_CHANGED") T.fire("UI_SCALE_CHANGED") T.slash("window 0.4") T.slash("latency")
  check(#T.errors == 0, "no errors from swings and events before the bar exists (got " .. #T.errors .. ")")
`);

scenario('weapon swapped mid-swing (Blizzard restarts its bar on WEAPON_SLOT_CHANGED)', String.raw`
  -- Blizzard_SwingTimer.lua: WEAPON_SLOT_CHANGED -> ResetSwingTimerForEquippedWeapon ->
  -- ResetSwingTimer(rangedAttackSpeed): the game's bar restarts from 0 over the new weapon speed.
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 101 T.speed.rng = 3.0
  T.fire("WEAPON_SLOT_CHANGED") T.fire("PLAYER_EQUIPMENT_CHANGED", 18, false) T.fire("UNIT_ATTACK_SPEED", "player")
  checkBands("bands follow the restarted 3.0 s bar", 200, 3.0, 0.5, 0)
  T.now = 103.0 T.update() check(T.driver.scripts.OnUpdate ~= nil and alpha() == 0.35, "2.0 s into the restarted bar: running and dim")
  T.now = 103.6 T.update() check(alpha() == 0.65, "2.6 s into the restarted bar: bright")
  -- unreadable speed: restart over the old duration
  T.speed = { mh = 2.0, oh = nil, rng = secret(2.6) }
  T.now = 103.7 T.fire("WEAPON_SLOT_CHANGED")
  check(alpha() == 0.35, "restart dims the red zone")
  checkBands("secret speed keeps the old duration", 200, 3.0, 0.5, 0)
  T.now = 106.0 T.update() check(T.driver.scripts.OnUpdate ~= nil, "running from the restart")
  check(#T.errors == 0, "no errors")
`);

scenario('the bar appears after login (ADDON_LOADED path)', String.raw`
  T.fire("PLAYER_LOGIN")
  check(T.driver.events.ADDON_LOADED == true, "waits for ADDON_LOADED")
  check(T.driver.events.PLAYER_SWING == true, "PLAYER_SWING registered anyway")
  T.slash("window 0.4") T.slash("latency") T.slash("latency") T.slash("debug")
  check(T.said("bar found: false"), "debug says the bar is missing")
  local before = #T.errors
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  check(#T.errors == before, "a ranged swing before the bar exists raises no error")
  T.fire("ADDON_LOADED", "SomeOtherAddon")
  check(T.driver.events.ADDON_LOADED == true, "still waiting after another addon loads")
  T.makeBar(200)
  T.fire("ADDON_LOADED", "Blizzard_SwingTimer")
  check(T.driver.events.ADDON_LOADED == nil, "stops waiting once attached")
  check(#T.bar.textures == 2, "textures created on the late bar")
  checkBands("late bar", 200, 2.8, 0.4, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('non-hunter login does nothing and raises nothing', String.raw`
  T.className, T.class = "Warrior", "WARRIOR"
  T.login(200)
  check(SlashCmdList.SHOTWINDOW == nil, "no slash command")
  check(ShotWindowDB == nil, "no saved variables")
  check(#T.bar.textures == 0, "nothing drawn on the bar")
  for e in pairs(T.driver.events) do check(e == "PLAYER_LOGIN", "only PLAYER_LOGIN registered (also " .. e .. ")") end
  T.fire("PLAYER_SWING", 2.0, 0) T.fire("PLAYER_SWING", 2.8, 2) T.fire("UNIT_ATTACK_SPEED", "player") T.fire("WEAPON_SLOT_CHANGED")
  T.update()
  check(T.driver.scripts.OnUpdate == nil, "no OnUpdate")
  check(#T.errors == 0, "no errors")
`);

scenario('secret PLAYER_SWING payload is skipped without touching it', String.raw`
  T.login(200)
  T.now = 100
  T.fire("PLAYER_SWING", secret(2.8), 2)
  T.fire("PLAYER_SWING", 2.8, secret(2))
  check(#T.errors == 0, "no error from a secret swing duration or type")
  check(T.driver.scripts.OnUpdate == nil, "secret swing not started")
  checkBands("weapon preview kept", 200, 2.8, 0.5, 0)
`);

scenario('secret UnitAttackSpeed at login', String.raw`
  T.speed = { mh = secret(2.0), oh = nil, rng = secret(2.8) }
  T.login(200)
  check(#T.errors == 0, "no error at login with a secret weapon speed")
  check(T.driver.events.PLAYER_SWING == true, "PLAYER_SWING still registered")
  check(#T.bar.textures == 2, "textures created")
  checkAllHidden("no preview without a readable speed")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  check(T.driver.scripts.OnUpdate ~= nil, "a readable PLAYER_SWING still drives the bands")
  if #T.bar.textures == 2 then checkBands("from PLAYER_SWING", 200, 2.8, 0.5, 0) end
`);

scenario('secret UnitAttackSpeed while idle (UNIT_ATTACK_SPEED, resize, debug)', String.raw`
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.9 T.update()
  T.speed = { mh = secret(2.0), oh = nil, rng = secret(2.24) }
  T.fire("UNIT_ATTACK_SPEED", "player")
  check(#T.errors == 0, "no error from an idle speed change with a secret speed")
  checkAllHidden("preview hidden")
  T.resize(250)
  T.slash("debug")
  check(#T.errors == 0, "no error from resize or debug with a secret speed")
`);

scenario('secret GetNetStats latency and secret bar width', String.raw`
  T.net = { 0, 0, secret(40), secret(120) }
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  checkBands("secret latency counts as 0", 200, 2.8, 0.5, 0)
  T.bar.width = secret(200)
  T.resize(secret(200))
  checkAllHidden("secret width hides the bands")
  T.bar.width = 200 T.resize(200)
  checkBands("readable width again", 200, 2.8, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

console.log(`\n${passed} passed, ${failed} failed, ${checks} checks`);
process.exit(failed ? 1 : 0);
