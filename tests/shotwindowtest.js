// Offline checks for Shot Window: loads ShotWindow.lua into fengari (Lua 5.3) against a stubbed
// WoW Forever client, then drives login, ranged and melee swings, OnUpdate ticks, resizes of the
// game's bar, every slash command, a non-hunter login, and secret values.
//
// The options UI runs too: widget stubs with client visibility rules (OnShow/OnHide, a parentless
// frame counts as visible), templates that exist only when listed in T.templates (CreateFrame
// raises for a missing one, so the fallback chains run), Settings/SettingsPanel following Forever's
// Blizzard_SettingsPanel.lua (OpenToCategory shows the panel, selects the first category, then
// parents and shows the canvas page), HideUIPanel(SettingsPanel) refused from addon code, and a
// ColorPickerFrame that follows Forever's Mainline ColorPickerFrame.lua (SetColorRGB fires
// swatchFunc before Show; any mouse-down outside it, and Escape, call cancelFunc). T.click,
// T.drag, T.pickColor, T.pickerOkay, T.pickerCancel and T.escape stand in for the player.
//
//   node tests/shotwindowtest.js [--verbose]
//   SHOTWINDOW_LUA=<path> node tests/shotwindowtest.js   (check another copy of the file)
//
// Window styles: Styles.lua and ShotWindow_Skins.lua load after ShotWindow.lua with the same
// namespace, as the TOC lists them. A scenario can run Lua before the files load (its third
// argument), which is how the EllesmereUI scenarios put a recording stand-in facade in place.
// Styles.lua draws with Interface\Buttons\WHITE8X8; that use is listed as a note, not a failure.
//
// fengari is looked for in FENGARI=<its folder>, then on the normal require path, then in the
// scratchpad copy it was first run from.
//
// Auto-repeat and combat: C_Spell.IsCurrentSpell follows T.currentMode / T.current[spellID]
// (missing by default, so older scenarios see an unknown state), START/STOP_AUTOREPEAT_SPELL are
// fired by the tests, InCombatLockdown() answers T.combat, and Settings.OpenToCategory is refused
// for addon code in combat. The red zone's own alpha (its pulse) is logged per SetAlpha call.
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
const STYLES_SRC = fs.readFileSync(path.join(ROOT, 'Styles.lua'), 'utf8');
const SKINS_SRC = fs.readFileSync(path.join(ROOT, 'ShotWindow_Skins.lua'), 'utf8');

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
// Taint, roughly: any ShotWindow.lua function on the call stack makes the call the addon's.
function addonOnStack(state) {
  for (let ci = state && state.ci; ci; ci = ci.previous) {
    const f = ci.func && ci.func.value;
    if (f && f.p && to_jsstring(f.p.source.getstr()) === ADDON_SOURCE) return true;
  }
  return false;
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
  fn('fromaddon', (S) => { lua.lua_pushboolean(S, addonOnStack(S)); return 1; });

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
PixelUtil = {
  GetNearestPixelSize = function(size, scale, minPixels)
    T.pixelCalls = (T.pixelCalls or 0) + 1 T.pixelArgs = { size, scale, minPixels } return T.pixelSize or size
  end,
  SetSize = function(region, w, h) region:SetSize(w, h) end,
}
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
-- C_Spell.IsCurrentSpell (SpellDocumentation.lua:741, bool, not nilable). T.currentMode picks how
-- the client answers: "missing" (the default, so older scenarios keep an unknown auto-repeat
-- state) leaves the function out; "plain" answers T.current[spellID] == true; "error" raises;
-- "secret" hands back a secret boolean; "number" answers 1 or nil like old clients. Every query
-- is listed in T.currentQueries.
T.current, T.currentMode, T.currentQueries = {}, "missing", {}
local function isCurrentSpell(id)
  T.currentQueries[#T.currentQueries + 1] = id
  local m = T.currentMode
  if m == "error" then error("IsCurrentSpell: test failure") end
  local v = T.current[id] == true
  if m == "secret" then return secret(v) end
  if m == "number" then return v and 1 or nil end
  return v
end
-- C_Spell.IsAutoRepeatSpell: what Blizzard's Forever Shoot button reads as the live auto-repeat
-- state (HostileTargetingActionBar.lua:198-219). T.autoRepMode "missing" (default) leaves it out;
-- "plain" answers T.autoRep[spellID] == true; "secret" and "error" as above.
T.autoRep, T.autoRepMode = {}, "missing"
local function isAutoRepeatSpell(id)
  T.currentQueries[#T.currentQueries + 1] = "repeat:" .. tostring(id)
  if T.autoRepMode == "error" then error("IsAutoRepeatSpell: test failure") end
  local v = T.autoRep[id] == true
  if T.autoRepMode == "secret" then return secret(v) end
  return v
end
-- C_Spell.IsSpellInRange: T.inRange true/false/nil (nil = cannot tell).
local function isSpellInRange(id, unit) return T.inRange end
setmetatable(C_Spell, { __index = function(_, k)
  if k == "IsCurrentSpell" and T.currentMode ~= "missing" then return isCurrentSpell end
  if k == "IsAutoRepeatSpell" and T.autoRepMode ~= "missing" then return isAutoRepeatSpell end
  if k == "IsSpellInRange" then return isSpellInRange end
end })
-- In combat (T.combat) the client refuses to open its options panel for an addon.
T.combat = false
function InCombatLockdown() return T.combat == true end
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
function Texture:SetAllPoints(rel) self.allPoints = rel or true end
function Texture:Show() self.shown = true end
function Texture:Hide() self.shown = false end
function Texture:SetShown(s) self.shown = not not s end
function Texture:SetAlpha(a)
  self.alpha = a
  local log = rawget(self, "alphaLog")
  if not log then log = {} rawset(self, "alphaLog", log) end
  log[#log + 1] = a
end
function Texture:IsShown() return self.shown end
function Texture:SetHeight(h) self.height = h end

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
function Frame:GetStatusBarTexture() local f = rawget(self, "fillTex") if not f then f = self:CreateTexture(nil, "ARTWORK") rawset(self, "fillTex", f) end return f end
function Frame:CreateTexture(name, layer, inherits, sublevel)
  local t = setmetatable({ parent = self, layer = layer or false, sublevel = sublevel or 0, shown = true,
    points = {}, width = 0, color = false, colorCalls = 0 }, TextureMeta)
  self.textures[#self.textures + 1] = t
  return t
end
-- Strict frames are only the swing bar (SwingTimerRangedFrame and its StatusBar); every frame the
-- addon makes comes from the widget stubs further down.
local function strictFrame(kind, name, parent)
  local f = setmetatable({ kind = kind, name = name or false, scripts = {}, hooks = {}, events = {},
    textures = {}, width = 0, height = 0 }, FrameMeta)
  T.frames[#T.frames + 1] = f
  if name then _G[name] = f end
  return f
end

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
-- Blizzard_SwingTimer's frames, after Blizzard_SwingTimer.xml: Background and Border on the frame,
-- the StatusBar with its Pip and labels. Their art is kept off bar.textures, which holds only what
-- the addon makes. Its StatusBar is what the addon draws on.
local function blizzardTexture(atlas)
  return setmetatable({ parent = false, layer = "BACKGROUND", sublevel = 0, shown = true, points = {}, width = 0,
    color = false, colorCalls = 0, atlas = atlas }, TextureMeta)
end
local Label = {}
local LabelMeta = strict(Label, "FontString")
function Label:GetFont() return "Fonts\\FRIZQT__.TTF", 10, "" end
function Label:SetFont(path) self.fontFile = path end
function Label:SetTextColor(r, g, b) self.textColor = { r, g, b } end
function T.makeSwing(name, width)
  local frame = strictFrame("Frame", name, UIParent)
  frame.Background = blizzardTexture("ui-swingtimerbar-background")
  frame.Border = blizzardTexture("ui-swingtimerbar-frame")
  local bar = strictFrame("StatusBar", nil, frame)
  bar.width, bar.height = width or 200, 12
  bar.Pip = blizzardTexture("ui-swingtimerbar-pip")
  bar.TypeLabel = setmetatable({ text = "Ranged" }, LabelMeta)
  bar.TimeLabel = setmetatable({ text = "0.0" }, LabelMeta)
  frame.StatusBar = bar
  return frame, bar
end
function T.makeBar(width)
  local _, bar = T.makeSwing("SwingTimerRangedFrame", width)
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
function T.fillTint()
  for _, t in ipairs(T.bar.textures) do if t.sublevel == 5 then return t end end
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
-- A line's center x, or nil when hidden.
function T.line(t)
  if not t.shown then return nil end
  if #t.points ~= 2 or t.points[1][4] ~= t.points[2][4] or t.points[1][1] ~= "TOP" or t.points[2][1] ~= "BOTTOM" or t.width ~= (T.lineW or T.pixelSize or 2) then
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
-- The red zone's own alpha (SetAlpha: the pulse), apart from the alpha of its color.
function T.standAlpha() return rawget(T.tex().stand, "alpha") end
function T.alphaLog() return rawget(T.tex().stand, "alphaLog") or {} end
function T.alphaCount() return #T.alphaLog() end
function T.alphasSince(n) -- the alpha values set after the first n
  local log, out = T.alphaLog(), {}
  for i = n + 1, #log do out[#out + 1] = realFormat("%.3f", log[i]) end
  return table.concat(out, " ")
end
-- The addon's state line from /shotwindow debug: shot spell, auto-repeat, waiting/swing/idle.
function T.state()
  local n = #T.prints
  T.slash("debug")
  for i = #T.prints, n + 1, -1 do
    if T.prints[i]:find("shot spell", 1, true) then return T.prints[i] end
  end
  return "(no state line)"
end
function T.stateHas(text) return T.state():find(text, 1, true) ~= nil end
function T.debugSays(text) -- a fresh /shotwindow debug has a line containing text
  local n = #T.prints
  T.slash("debug")
  for i = n + 1, #T.prints do if T.prints[i]:find(text, 1, true) then return true end end
  return false
end
function T.running() return T.driver.scripts.OnUpdate ~= nil end
function T.report()
  local out = {}
  for _, m in ipairs(T.fails) do out[#out + 1] = "F\t" .. m end
  for _, m in ipairs(T.buttonArt or {}) do out[#out + 1] = "F\tInterface\\Buttons art does not render on this client: " .. tostring(m) end
  for _, m in ipairs(T.errors) do out[#out + 1] = "E\t" .. m end
  for _, m in ipairs(T.prints) do out[#out + 1] = "P\t" .. m end
  local unknown = {}
  for k, n in pairs(T.unknown or {}) do unknown[#unknown + 1] = k .. " x" .. n end
  table.sort(unknown)
  for _, m in ipairs(unknown) do out[#out + 1] = "U\t" .. m end
  out[#out + 1] = "C\t" .. T.checks
  return table.concat(out, "\n")
end
` + String.raw`
-- ---------------------------------------------------------------------------------------------
-- Options UI. Every frame the addon creates gets a widget stub that behaves like the client's: a
-- field it does not have reads as nil (so calling a missing method raises "attempt to call a nil
-- value"; such reads of capitalised names are listed with --verbose), Show/Hide/SetParent send
-- OnShow/OnHide, a shown frame with no parent counts as visible, OnUpdate runs only while visible,
-- OnSizeChanged is sent on the next T.update, and a template exists only if T.templates lists it:
-- CreateFrame raises for any other, as the client does.
T.templates = { MinimalSliderTemplate = true, UISliderTemplate = true, OptionsSliderTemplate = true,
  UICheckButtonTemplate = true, ChatConfigCheckButtonTemplate = true, ColorSwatchTemplate = true,
  UIPanelButtonTemplate = true, ButtonFrameTemplate = true, BasicFrameTemplateWithInset = true,
  UIPanelCloseButton = true }
T.fonts = { GameFontNormal = true, GameFontNormalLarge = true, GameFontNormalSmall = true,
  GameFontHighlight = true, GameFontHighlightSmall = true, GameFontDisableSmall = true }
T.unknown, T.buttonArt, T.sizeDirty = {}, {}, {}
T.blocked, T.hideCalls = 0, 0

local function isVisible(f)
  while f do
    if rawget(f, "shown") == false then return false end
    f = rawget(f, "parent")
  end
  return true
end
local function isDescendant(f, root)
  while f do
    if f == root then return true end
    f = rawget(f, "parent")
  end
  return false
end
local function fireScript(f, name, ...)
  local s = f.scripts[name]
  if s then T.call(s, f, ...) end
  local hs = f.hooks[name]
  if hs then for _, h in ipairs(hs) do T.call(h, f, ...) end end
end
T.fireScript = fireScript
-- Visibility: settle the whole subtree first, then send OnShow/OnHide parent first, skipping a
-- frame whose state changed again in the meantime (a script that moved or hid it).
local function syncTree(root)
  local events = {}
  local function walk(f)
    if rawget(f, "ui") then
      local now = isVisible(f)
      if now ~= f.vis then f.vis = now events[#events + 1] = { f, now } end
      for _, c in ipairs(f.children) do walk(c) end
    end
  end
  walk(root)
  for _, e in ipairs(events) do
    if e[1].vis == e[2] then fireScript(e[1], e[2] and "OnShow" or "OnHide") end
  end
end

local M, metas = {}, {}
local function methods(kind, base)
  local t = {}
  if base then for k, v in pairs(M[base]) do t[k] = v end end
  M[kind] = t
  return t
end
local function metaFor(kind)
  if not metas[kind] then
    local t = M[kind]
    metas[kind] = { __index = function(self, k)
      local m = t[k]
      if m ~= nil then return m end
      if realType(k) == "string" and k:find("^%u") then
        local key = kind .. "." .. k
        T.unknown[key] = (T.unknown[key] or 0) + 1
      end
      return nil
    end }
  end
  return metas[kind]
end

local R = methods("Region")
function R:SetPoint(p, a, b, c, d) self.points[#self.points + 1] = { p, a, b, c, d } end
function R:ClearAllPoints() self.points = {} end
local function setSize(self, w, h)
  if (w ~= nil and realType(w) ~= "number") or (h ~= nil and realType(h) ~= "number") then error("SetSize: numbers expected", 3) end
  local changed = (w ~= nil and w ~= self.width) or (h ~= nil and h ~= self.height)
  if w ~= nil then self.width = w end
  if h ~= nil then self.height = h end
  if changed and rawget(self, "ui") then T.sizeDirty[self] = true end
end
function R:SetSize(w, h) setSize(self, w, h) end
function R:SetWidth(w) setSize(self, w, nil) end
function R:SetHeight(h) setSize(self, nil, h) end
function R:GetWidth() return self.width end
function R:GetHeight() return self.height end
function R:GetSize() return self.width, self.height end
function R:SetAllPoints(rel)
  rel = rel or rawget(self, "parent")
  self.points = { { "ALL", rel } }
  if realType(rel) == "table" and rawget(rel, "width") then setSize(self, rel.width, rel.height) end
end
function R:Show() if self.shown ~= true then self.shown = true if rawget(self, "ui") then syncTree(self) end end end
function R:Hide() if self.shown ~= false then self.shown = false if rawget(self, "ui") then syncTree(self) end end end
function R:SetShown(s) if s then self:Show() else self:Hide() end end
function R:IsShown() return self.shown end
function R:IsVisible() return isVisible(self) end
function R:GetParent() return rawget(self, "parent") end
function R:SetAlpha(a) self.alpha = a end
function R:GetAlpha() return rawget(self, "alpha") or 1 end
function R:SetHitRectInsets(l, r, t, b) self.hitInsets = { l, r, t, b } end

local TX = methods("Texture", "Region")
function TX:SetColorTexture(r, g, b, a) self.colorTex = { r, g, b, a or 1 } self.file, self.atlas = nil, nil end
function TX:SetVertexColor(r, g, b, a) self.vertex = { r, g, b, a or 1 } end
function TX:GetVertexColor() local v = rawget(self, "vertex") or { 1, 1, 1, 1 } return v[1], v[2], v[3], v[4] end
function TX:SetTexture(file)
  self.file = file
  if realType(file) == "string" and file:lower():find("interface\\buttons", 1, true) then
    if file:lower():find("white8x8", 1, true) then T.flatArt = (T.flatArt or 0) + 1
    else T.buttonArt[#T.buttonArt + 1] = file end
  end
end
function TX:SetAtlas(atlas) self.atlas = atlas end
function TX:SetDrawLayer(layer, sub) self.layer, self.sublevel = layer, sub end
function TX:GetDrawLayer() return self.layer, self.sublevel end

local FS = methods("FontString", "Region")
function FS:SetText(t)
  if not rawget(self, "font") then error("FontString:SetText(): Font not set", 2) end
  if T.badText and t == T.badText then error("FontString:SetText(): test failure for " .. t, 2) end
  if t ~= nil and realType(t) ~= "string" and realType(t) ~= "number" then error("FontString:SetText(): bad argument", 2) end
  self.text = t ~= nil and tostring(t) or nil
end
function FS:GetText() return rawget(self, "text") end
function FS:GetStringWidth() return #(rawget(self, "text") or "") * 6 end
function FS:SetFormattedText(fmt, ...) self:SetText(fmt:format(...)) end
function FS:SetJustifyH(j) self.justifyH = j end
function FS:SetJustifyV(j) self.justifyV = j end
function FS:SetTextColor(r, g, b, a) self.textColor = { r, g, b, a } end
function FS:SetFontObject(f) self.font = f end
function FS:SetWordWrap(w) self.wrap = w end

local F = methods("Frame", "Region")
function F:SetParent(p)
  local old = rawget(self, "parent")
  if old == p then return end
  if old and rawget(old, "children") then
    for i, c in ipairs(old.children) do if c == self then table.remove(old.children, i) break end end
  end
  self.parent = p
  if p and rawget(p, "children") then p.children[#p.children + 1] = self end
  syncTree(self)
end
function F:SetScale(s)
  if realType(s) ~= "number" or s <= 0 then error("Frame:SetScale(): Scale must be > 0", 2) end
  self.scale = s
end
function F:GetScale() return self.scale end
function F:GetEffectiveScale()
  local s, f = 1, self
  while f do s = s * (rawget(f, "scale") or 1) f = rawget(f, "parent") end
  return s
end
function F:SetFrameStrata(s) self.strata = s end
function F:GetFrameStrata() return rawget(self, "strata") or "MEDIUM" end
function F:SetFrameLevel(l) self.level = l end
function F:GetFrameLevel() return rawget(self, "level") or 0 end
function F:SetToplevel(t) self.toplevel = t end
function F:SetMovable(m) self.movable = m end
function F:IsMovable() return rawget(self, "movable") == true end
function F:EnableMouse(e) self.mouse = e end
function F:EnableMouseWheel(e) self.wheel = e end
function F:SetClampedToScreen(c) self.clamped = c end
function F:RegisterForDrag(...) self.drag = { ... } end
function F:StartMoving() self.moving = true end
function F:StopMovingOrSizing() self.moving = false end
function F:Raise() self.raised = (rawget(self, "raised") or 0) + 1 end
function F:Lower() end
function F:GetName() return self.name or nil end
function F:GetObjectType() return self.kind end
function F:SetScript(n, f) self.scripts[n] = f end
function F:GetScript(n) return self.scripts[n] end
function F:HookScript(n, f) self.hooks[n] = self.hooks[n] or {} table.insert(self.hooks[n], f) end
function F:HasScript(n) return true end
function F:RegisterEvent(e) self.events[e] = true end
function F:RegisterUnitEvent(e, ...) self.events[e] = { ... } end
function F:UnregisterEvent(e) self.events[e] = nil end
function F:UnregisterAllEvents() self.events = {} end
function F:IsEventRegistered(e) return self.events[e] ~= nil end
function F:CreateTexture(name, layer, inherits, sublevel)
  local t = setmetatable({ parent = self, layer = layer or "ARTWORK", sublevel = sublevel or 0, shown = true,
    points = {}, width = 0, height = 0 }, metaFor("Texture"))
  self.textures[#self.textures + 1] = t
  if name then _G[name] = t end
  return t
end
function F:CreateFontString(name, layer, template)
  if T.badFont and template == T.badFont then error("CreateFontString: test failure for " .. template, 2) end
  local fs = setmetatable({ parent = self, layer = layer or "ARTWORK", shown = true, points = {}, width = 0, height = 0,
    font = (template and T.fonts[template]) and template or nil }, metaFor("FontString"))
  self.fontStrings[#self.fontStrings + 1] = fs
  if name then _G[name] = fs end
  return fs
end

local B = methods("Button", "Frame")
function B:SetText(t) self.text = t ~= nil and tostring(t) or nil end
function B:GetText() return rawget(self, "text") end
function B:RegisterForClicks(...) self.clicks = { ... } end
function B:Enable() self.enabled = true end
function B:Disable() self.enabled = false end
function B:IsEnabled() return rawget(self, "enabled") ~= false end
function B:SetNormalFontObject(f) self.font = f end
function B:GetFontString() return rawget(self, "fs") end
function B:SetFontString(fs) self.fs = fs end

local CB = methods("CheckButton", "Button")
function CB:SetChecked(c) self.checked = not not c end
function CB:GetChecked() return rawget(self, "checked") == true end
function CB:SetCheckedTexture(t) self.checkedTex = t end
function CB:GetCheckedTexture() return rawget(self, "checkedTex") end

local SL = methods("Slider", "Frame")
-- Like the client: SetValue clamps to the range and sends OnValueChanged(self, value, userInput)
-- only when the value changes; SetMinMaxValues clamps the current value the same way.
local function sliderSet(s, v, user)
  if realType(v) ~= "number" then error("Slider:SetValue(): number expected", 3) end
  if v < s.min then v = s.min elseif v > s.max then v = s.max end
  if v ~= s.value then
    s.value = v
    fireScript(s, "OnValueChanged", v, user)
  end
end
function SL:SetOrientation(o) self.orientation = o end
function SL:GetOrientation() return rawget(self, "orientation") end
function SL:SetMinMaxValues(a, b)
  if realType(a) ~= "number" or realType(b) ~= "number" or a > b then error("Slider:SetMinMaxValues(): bad range", 2) end
  self.min, self.max = a, b
  sliderSet(self, self.value, false)
end
function SL:GetMinMaxValues() return self.min, self.max end
function SL:SetValueStep(s) self.step = s end
function SL:GetValueStep() return rawget(self, "step") or 0 end
function SL:SetObeyStepOnDrag(o) self.obeyStep = not not o end
function SL:GetObeyStepOnDrag() return rawget(self, "obeyStep") == true end
function SL:SetValue(v) sliderSet(self, v, false) end
function SL:GetValue() return self.value end
function SL:SetThumbTexture(t) self.thumb = t end
function SL:GetThumbTexture() return rawget(self, "thumb") end
function SL:Enable() end
function SL:Disable() end
function SL:SetStepsPerPage(n) end

local CS = methods("ColorSelect", "Frame")
function CS:SetColorRGB(r, g, b)
  if realType(r) ~= "number" or realType(g) ~= "number" or realType(b) ~= "number" then error("ColorSelect:SetColorRGB(): numbers expected", 2) end
  self.rgb = { r, g, b }
  fireScript(self, "OnColorSelect", r, g, b)
end
function CS:GetColorRGB() return self.rgb[1], self.rgb[2], self.rgb[3] end
function CS:SetColorAlpha(a) if realType(a) ~= "number" then error("ColorSelect:SetColorAlpha(): number expected", 2) end self.colorAlpha = a end
function CS:GetColorAlpha() return self.colorAlpha end

-- What the window styles' drawing calls use (Styles.lua and the EllesmereUI facade).
do
  local frameKinds = { "Frame", "Button", "CheckButton", "Slider", "ColorSelect" }
  for _, kind in ipairs(frameKinds) do
    local t = M[kind]
    t.IsObjectType = function(self, what) return what == self.kind or what == "Frame" or (what == "Button" and self.kind == "CheckButton") end
    t.GetRegions = function(self)
      local list = {}
      for _, r in ipairs(self.textures) do list[#list + 1] = r end
      for _, r in ipairs(self.fontStrings) do list[#list + 1] = r end
      return table.unpack(list)
    end
    t.GetChildren = function(self) return table.unpack(self.children) end
  end
  for _, kind in ipairs({ "Button", "CheckButton" }) do
    M[kind].SetHighlightFontObject = function(self, f) self.highlightFont = f end
    M[kind].SetDisabledFontObject = function(self, f) self.disabledFont = f end
  end
  M.Texture.IsObjectType = function(_, what) return what == "Texture" end
  M.Texture.SetGradient = function(self, orient, a, b) self.gradient = { orient, a, b } end
  M.Texture.SetRotation = function(self, r) self.rotation = r end
  M.Texture.SetTexCoord = function(self, ...) self.texCoord = { ... } end
  M.Texture.GetNumMaskTextures = function() return 0 end
  M.FontString.IsObjectType = function(_, what) return what == "FontString" end
  M.FontString.GetFont = function(self) return "Fonts\\FRIZQT__.TTF", 12, "" end
  M.FontString.SetFont = function(self, path, size, flags) self.fontFile = path return true end
end
function CreateColor(r, g, b, a) return { r = r, g = g, b = b, a = a } end
GameTooltip = { lines = {} }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:SetText(text) self.lines = { text } end
function GameTooltip:AddLine(text) self.lines[#self.lines + 1] = text end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false end
function T.tooltipHas(text)
  for _, l in ipairs(GameTooltip.lines) do if realType(l) == "string" and l:find(text, 1, true) then return true end end
  return false
end
C_UI = { Reload = function() T.reloads = (T.reloads or 0) + 1 end }

local function newUI(kind, name, parent)
  local f = setmetatable({ kind = kind, name = name or false, ui = true, children = {}, shown = true,
    scripts = {}, hooks = {}, events = {}, textures = {}, fontStrings = {}, points = {}, width = 0, height = 0,
    scale = 1 }, metaFor(M[kind] and kind or "Frame"))
  if kind == "Slider" then f.min, f.max, f.value = 0, 0, 0 end
  T.frames[#T.frames + 1] = f
  if name then _G[name] = f end
  if parent then
    f.parent = parent
    if rawget(parent, "children") then table.insert(parent.children, f) end
  end
  f.vis = isVisible(f)
  return f
end
local rawHide = R.Hide

UIParent = newUI("Frame", "UIParent")
UIParent:SetSize(1920, 1080)
UISpecialFrames = {}
tinsert = table.insert

function UIPanelCloseButton_OnClick(self) -- SharedUIPanelTemplates.lua:150
  local parent = self:GetParent()
  if parent then HideUIPanel(parent) end
end
function ButtonFrameTemplate_HidePortrait(self) -- SharedUIPanelTemplates.lua:111
  self:SetBorder("ButtonFrameTemplateNoPortrait")
  self:SetPortraitShown(false)
  T.hidPortrait = (T.hidPortrait or 0) + 1
end
function ButtonFrameTemplate_HideButtonBar(self) -- SharedUIPanelTemplates.lua:66 -> FrameTemplate_SetButtonBarHeight
  if self.topInset then
    self.topInset:SetPoint("BOTTOMRIGHT", self, "BOTTOMRIGHT", -6, 4)
  elseif self.Inset then
    self.Inset:SetPoint("BOTTOMRIGHT", self, "BOTTOMRIGHT", -6, 4)
  end
  T.hidButtonBar = (T.hidButtonBar or 0) + 1
end

-- Templates, shaped after the Forever XML: only the parts the options code can touch.
local TEMPLATES = {}
local function applyTemplate(f, template, name)
  TEMPLATES[template](f, name)
  f.template = template
end
local function thumb(f)
  local t = f:CreateTexture(nil, "OVERLAY")
  t:SetAtlas("Minimal_SliderBar_Button")
  f.thumb = t
end
TEMPLATES.MinimalSliderTemplate = function(f) -- MinimalSlider.xml:3: obeyStepOnDrag, no labels
  f.orientation, f.obeyStep = "HORIZONTAL", true
  f:SetHeight(16)
  thumb(f)
end
TEMPLATES.UISliderTemplate = function(f)
  f.orientation = "HORIZONTAL"
  f:SetSize(144, 17)
  thumb(f)
end
TEMPLATES.OptionsSliderTemplate = function(f, name) -- UISliderTemplateWithLabels: named Low/High/Text
  TEMPLATES.UISliderTemplate(f)
  for _, key in ipairs({ "Low", "High", "Text" }) do
    local fs = f:CreateFontString(name and (name .. key) or nil, "ARTWORK", "GameFontHighlightSmall")
    fs:SetText(key == "Text" and "Slider" or key)
    f[key] = fs
  end
end
local function checkArt(f)
  f:SetSize(32, 32)
  local t = f:CreateTexture(nil, "ARTWORK")
  t:SetAtlas("checkbox-minimal-checked")
  f.checkedTex = t
  f.Text = f:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
end
TEMPLATES.UICheckButtonTemplate = checkArt
TEMPLATES.ChatConfigCheckButtonTemplate = checkArt
TEMPLATES.ColorSwatchTemplate = function(f) -- Blizzard_SharedXMLBase/ColorSwatch.xml + ColorSwatch.lua
  f:SetSize(16, 16)
  local function square(key, sub, size, r, g, b)
    local t = f:CreateTexture(nil, "BACKGROUND", nil, sub)
    t:SetSize(size, size)
    t:SetPoint("CENTER")
    t:SetColorTexture(r, g, b)
    f[key] = t
  end
  square("SwatchBg", -3, 14, 1, 1, 1)
  square("InnerBorder", -2, 12, 0, 0, 0)
  square("Color", -1, 10, 1, 1, 1)
  f.SetColor = function(self, c) self.Color:SetVertexColor(c:GetRGB()) end
  f.SetColorRGB = function(self, r, g, b) self.Color:SetVertexColor(r, g, b) end
  f.SetBorderColor = function(self, c) self.SwatchBg:SetVertexColor(c:GetRGB()) end
  f.OnShow = function(self)
    PixelUtil.SetSize(self.SwatchBg, 14, 14)
    PixelUtil.SetSize(self.InnerBorder, 12, 12)
    PixelUtil.SetSize(self.Color, 10, 10)
  end
  f.scripts.OnShow = f.OnShow
  f.scripts.OnEnter = function(self) self.SwatchBg:SetVertexColor(1, 0.82, 0) end
  f.scripts.OnLeave = function(self) self.SwatchBg:SetVertexColor(1, 1, 1) end
end
TEMPLATES.UIPanelButtonTemplate = function(f)
  f:SetSize(40, 22)
  for _, part in ipairs({ "Left", "Middle", "Right" }) do
    local t = f:CreateTexture(nil, "BACKGROUND")
    t:SetAtlas("128-RedButton-" .. part)
    f[part] = t
  end
  f.fs = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.font = "GameFontNormal"
end
TEMPLATES.UIPanelCloseButton = function(f)
  f:SetSize(24, 24)
  local t = f:CreateTexture(nil, "ARTWORK")
  t:SetAtlas("RedButton-Exit")
  f.normal = t
  f.scripts.OnClick = UIPanelCloseButton_OnClick
end
local function closeButton(f, name)
  local c = newUI("Button", name, f)
  applyTemplate(c, "UIPanelCloseButton")
  return c
end
TEMPLATES.ButtonFrameTemplate = function(f, name)
  local bg = f:CreateTexture(name and (name .. "Bg") or nil, "BACKGROUND")
  bg:SetTexture("Interface\\FrameGeneral\\UI-Background-Rock")
  f.Bg = bg
  f.CloseButton = closeButton(f, name and (name .. "CloseButton") or nil)
  f.TitleContainer = newUI("Frame", nil, f)
  f.TitleContainer.TitleText = f.TitleContainer:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.Inset = newUI("Frame", name and (name .. "Inset") or nil, f)
  f.SetTitle = function(self, title) self.TitleContainer.TitleText:SetText(title) end -- TitledPanelMixin
  f.SetBorder = function(self, layout) self.border = layout end
  f.SetPortraitShown = function(self, shown) self.portraitShown = shown end
end
TEMPLATES.BasicFrameTemplateWithInset = function(f)
  local bg = f:CreateTexture(nil, "BACKGROUND")
  bg:SetTexture("Interface\\FrameGeneral\\UI-Background-Rock")
  f.Bg = bg
  f.CloseButton = closeButton(f, nil)
  f.TitleText = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
end

function CreateFrame(kind, name, parent, template)
  if template ~= nil and not (T.templates[template] and TEMPLATES[template]) then
    error('CreateFrame(): Couldn' .. "'" .. 't find inherited node "' .. tostring(template) .. '"', 2)
  end
  local f = newUI(kind, name, parent)
  if template then applyTemplate(f, template, name) end
  return f
end

-- HideUIPanel(SettingsPanel) and SettingsPanel:Hide() from addon code are refused on Forever: the
-- call does nothing (the client shows its "blocked" message), T.blocked counts them.
-- In combat both refuse (CheckProtectedFunctionsAllowed: InCombatLockdown() and not issecure()).
-- HideUIPanel refuses whoever calls it: a close X on an addon's own window runs it from tainted
-- code even though only Blizzard's UIPanelCloseButton_OnClick is on the stack. ShowUIPanel spares
-- the player's own secure path (opening the panel by hand), so only addon calls are refused.
T.combatRefusals = 0
function ShowUIPanel(f)
  if InCombatLockdown() and fromaddon() then T.combatRefusals = T.combatRefusals + 1 T.blocked = T.blocked + 1 return end
  if f then f:Show() end
end
function HideUIPanel(f)
  T.hideCalls = T.hideCalls + 1
  if InCombatLockdown() then T.combatRefusals = T.combatRefusals + 1 T.blocked = T.blocked + 1 return end
  if f == SettingsPanel and fromaddon() and not T.hidePanelWorks then T.blocked = T.blocked + 1 return end
  if f then rawHide(f) end
end

-- Settings, after Forever's Blizzard_Settings.lua:144 and Blizzard_SettingsPanel.lua.
SettingsPanel = newUI("Frame", "SettingsPanel", UIParent)
SettingsPanel:SetSize(920, 724)
SettingsPanel.strata = "HIGH"
rawHide(SettingsPanel)
SettingsPanel.Container = newUI("Frame", nil, SettingsPanel)
SettingsPanel.Container:SetSize(665, 601)
T.canvas = newUI("Frame", nil, SettingsPanel.Container)
T.canvas:SetSize(665, 601)
SettingsPanel.Container.SettingsCanvas = T.canvas
SettingsPanel.Hide = function(self) if fromaddon() then T.blocked = T.blocked + 1 return end rawHide(self) end
SettingsPanel.SetShown = function(self, s) if s then self:Show() else self:Hide() end end

T.settings = { canvas = {}, addon = {}, opens = {}, proxies = 0 }
local Category = {}
Category.__index = Category
function Category:GetID() return self.ID end
function Category:GetName() return self.name end
local firstCategory = setmetatable({ ID = 1, name = "Game" }, Category) -- a vertical layout of Blizzard's
local nextID, currentCategory = 200, nil
local function clearCanvas() -- ClearCurrentCategoryCanvas, SettingsPanel.lua:918
  local frame = currentCategory and currentCategory.frame
  if frame then frame:SetParent(nil) frame:ClearAllPoints() frame:Hide() end
end
local function displayLayout(cat) -- DisplayLayout, SettingsPanel.lua:933
  local frame = cat.frame
  if not frame then return end
  frame:SetParent(T.canvas)
  frame:ClearAllPoints()
  frame:SetAllPoints(T.canvas)
  frame:Show()
  if rawget(frame, "OnRefresh") then T.call(frame.OnRefresh, frame) end
end
local function selectCategory(cat, force) -- SelectCategory, SettingsPanel.lua:841
  if force or currentCategory ~= cat then
    clearCanvas()
    currentCategory = cat
    displayLayout(cat)
  end
end
SettingsPanel.scripts.OnShow = function() selectCategory(firstCategory, true) end -- SettingsPanel.lua:158
local function panelOpenToCategory(id) -- SETTINGS_PANEL_OPEN -> OpenToCategory, SettingsPanel.lua:313
  ShowUIPanel(SettingsPanel)
  for _, c in ipairs(T.settings.addon) do
    if c.ID == id then selectCategory(c) return true end
  end
  return false
end
local function proxy() T.settings.proxies = T.settings.proxies + 1 end
Settings = {
  RegisterCanvasLayoutCategory = function(frame, name)
    nextID = nextID + 1
    local c = setmetatable({ ID = nextID, name = name, frame = frame }, Category)
    table.insert(T.settings.canvas, c)
    return c
  end,
  RegisterAddOnCategory = function(c) table.insert(T.settings.addon, c) end,
  OpenToCategory = function(id, scrollTo) -- C_SettingsUtil.OpenSettingsPanel(openToCategoryID: number)
    -- HasRestrictions (SettingsUtilDocumentation.lua): refused for addon code in combat.
    if T.combat and fromaddon() then T.settings.combatOpens = (T.settings.combatOpens or 0) + 1 T.blocked = T.blocked + 1 return end
    table.insert(T.settings.opens, id)
    if realType(id) ~= "number" then error("bad argument #1 to 'OpenSettingsPanel' (number expected, got " .. realType(id) .. ")", 2) end
    if T.openFails then return end
    panelOpenToCategory(id)
  end,
  RegisterVerticalLayoutCategory = proxy, RegisterProxySetting = proxy, RegisterAddOnSetting = proxy, RegisterCVarSetting = proxy,
}
function T.closePanel() rawHide(SettingsPanel) end -- the player: Esc or the panel's Close button
function T.switchCategory() selectCategory(firstCategory) end -- the player picks another category
function T.openPanelManually() return panelOpenToCategory(T.settings.addon[1] and T.settings.addon[1].ID) end
function T.page() local c = T.settings.canvas[1] return c and c.frame end

-- ColorPickerFrame, after Forever's Blizzard_ColorPickerFrame/Mainline/ColorPickerFrame.lua.
do
  local cp = newUI("Frame", "ColorPickerFrame", UIParent)
  cp.strata = "DIALOG"
  rawHide(cp)
  cp.Content = newUI("Frame", nil, cp)
  local sel = newUI("ColorSelect", nil, cp.Content)
  sel.rgb, sel.colorAlpha = { 0.4, 0.4, 0.4 }, 0.6 -- whatever its last user left
  cp.Content.ColorPicker = sel
  cp.Footer = newUI("Frame", nil, cp)
  cp.Footer.OkayButton = newUI("Button", nil, cp.Footer)
  cp.Footer.CancelButton = newUI("Button", nil, cp.Footer)
  cp.Footer.OkayButton:SetSize(96, 22)
  cp.Footer.CancelButton:SetSize(96, 22)
  T.picker, T.pickerEarly, T.pickerSetups = cp, 0, 0
  sel.scripts.OnColorSelect = function(_, r, g, b) -- OnLoad, lua:21
    if not cp:IsShown() then T.pickerEarly = T.pickerEarly + 1 end
    if cp.swatchFunc then cp.swatchFunc() end
    if cp.swatch then cp.swatch:SetColorRGB(r, g, b) end
    if cp.opacityFunc then cp.opacityFunc() end
  end
  function cp:OnOkay() -- lua:3: swatchFunc unguarded
    self.swatchFunc()
    if self.opacityFunc then self.opacityFunc() end
    self:Hide()
  end
  function cp:OnCancel() -- lua:12
    if self.cancelFunc then self.cancelFunc(self.previousValues) end
    self:Hide()
  end
  cp.Footer.OkayButton.scripts.OnClick = function() cp:OnOkay() end
  cp.Footer.CancelButton.scripts.OnClick = function() cp:OnCancel() end
  cp.scripts.OnShow = function(self) -- lua:43
    if self.hasOpacity then self.Content.ColorPicker:SetColorAlpha(self.opacity) end
    self:RegisterEvent("GLOBAL_MOUSE_DOWN")
  end
  cp.scripts.OnHide = function(self) self:UnregisterEvent("GLOBAL_MOUSE_DOWN") end
  cp.scripts.OnEvent = function(self, event) -- lua:84: a mouse-down anywhere outside cancels
    if event == "GLOBAL_MOUSE_DOWN" and self:IsShown() and not isDescendant(T.mouseTarget, self) then
      if self.cancelFunc then self.cancelFunc(self.previousValues) end
      self:Hide()
    end
  end
  function cp:GetColorRGB() return self.Content.ColorPicker:GetColorRGB() end
  function cp:GetColorAlpha() return self.Content.ColorPicker:GetColorAlpha() end
  function cp:GetPreviousValues() local p = self.previousValues return p.r, p.g, p.b, p.a end
  function cp:SetupColorPickerAndShow(info) -- lua:166
    T.pickerSetups = T.pickerSetups + 1
    self.swatchFunc = info.swatchFunc
    self.hasOpacity = info.hasOpacity
    self.opacityFunc = info.opacityFunc
    self.opacity = info.opacity
    self.previousValues = { r = info.r, g = info.g, b = info.b, a = info.opacity }
    self.cancelFunc = info.cancelFunc
    self.extraInfo = info.extraInfo
    self.swatch = info.swatch
    self.Content.ColorPicker:SetColorRGB(info.r, info.g, info.b) -- fires OnColorSelect before Show
    self:Show()
  end
end
T.sizeDirty = {}

-- The player.
function T.mouseDown(target)
  T.mouseTarget = target
  T.fire("GLOBAL_MOUSE_DOWN", "LeftButton")
  T.mouseTarget = nil
end
local function canTouch(f, what)
  if not f then T.fails[#T.fails + 1] = what .. ": no such control" return false end
  if not f:IsVisible() then T.fails[#T.fails + 1] = what .. ": the control is not visible" return false end
  -- T.strictMouse: a control with the mouse turned off (grayed out) cannot be clicked or dragged.
  if T.strictMouse and rawget(f, "mouse") == false then T.fails[#T.fails + 1] = what .. ": the control does not take the mouse (grayed out)" return false end
  if (f.width or 0) <= 0 or (f.height or 0) <= 0 then
    T.fails[#T.fails + 1] = what .. ": the control has no size (" .. tostring(f.width) .. "x" .. tostring(f.height) .. "), so it cannot be clicked"
    return false
  end
  return true
end
function T.click(f, button)
  if not canTouch(f, "T.click") then return end
  T.mouseDown(f)
  if f.kind == "CheckButton" then f.checked = not f.checked end
  fireScript(f, "OnClick", button or "LeftButton", false)
end
function T.drag(s, v)
  if not canTouch(s, "T.drag") then return end
  T.mouseDown(s)
  if s.obeyStep and realType(rawget(s, "step")) == "number" and s.step > 0 then
    v = s.min + math.floor((v - s.min) / s.step + 0.5) * s.step
  end
  sliderSet(s, v, true)
end
function T.pickColor(r, g, b)
  if not T.picker:IsShown() then T.fails[#T.fails + 1] = "T.pickColor: the color picker is not shown" return end
  T.mouseDown(T.picker.Content.ColorPicker)
  T.picker.Content.ColorPicker:SetColorRGB(r, g, b)
end
function T.pickerOkay() T.click(T.picker.Footer.OkayButton) end
function T.pickerCancel() T.click(T.picker.Footer.CancelButton) end
function T.escape()
  if T.picker:IsShown() then -- the picker takes Escape first (OnKeyDown, lua:95)
    if T.picker.cancelFunc then T.call(T.picker.cancelFunc, T.picker.previousValues) end
    rawHide(T.picker)
    return
  end
  for _, name in ipairs(UISpecialFrames) do -- CloseSpecialWindows
    local f = _G[name]
    if f and f:IsShown() then f:Hide() end
  end
end
function T.flushLayout()
  local dirty = T.sizeDirty
  T.sizeDirty = {}
  for f in pairs(dirty) do
    if isVisible(f) then fireScript(f, "OnSizeChanged", f.width, f.height) else T.sizeDirty[f] = true end
  end
end
function T.update(elapsed)
  T.flushLayout()
  for _, f in ipairs(T.frames) do
    local s = f.scripts.OnUpdate
    if s and (not rawget(f, "ui") or isVisible(f)) then T.call(s, f, elapsed or 0.016) end
  end
end

-- Finding the options' controls by their labels.
local function hasText(f, text)
  for _, fs in ipairs(rawget(f, "fontStrings") or {}) do if rawget(fs, "text") == text then return true end end
  return false
end
function T.contents()
  local list = {}
  for _, f in ipairs(T.frames) do if rawget(f, "ui") and hasText(f, "Timing") then list[#list + 1] = f end end
  return list
end
function T.content() local list = T.contents() return list[#list] end
local function find(kind, test)
  local root = T.content()
  if not root then return nil end
  for i = #T.frames, 1, -1 do
    local f = T.frames[i]
    if f.kind == kind and rawget(f, "ui") and isDescendant(f, root) and test(f) then return f end
  end
end
function T.checkbox(label) return find("CheckButton", function(f) return hasText(f, label) end) end
function T.swatch(label) return find("Button", function(f) return hasText(f, label) end) end
function T.slider(label) return find("Slider", function(f) local h = rawget(f, "parent") return h and hasText(h, label) end) end
function T.sliderText(label)
  local s = T.slider(label)
  local h = s and s.parent
  return h and h.fontStrings[2] and h.fontStrings[2].text
end
function T.button(text) return find("Button", function(f) return rawget(f, "text") == text end) end
function T.status()
  local c = T.content()
  for _, fs in ipairs(c and c.fontStrings or {}) do
    local t = rawget(fs, "text")
    if t and t:find("^Red zone now") then return t end
  end
end
function T.window() return rawget(_G, "ShotWindowOptions") end
function T.countSaid(text)
  local n = 0
  for _, m in ipairs(T.prints) do if m:find(text, 1, true) then n = n + 1 end end
  return n
end
function rgbIs(t, r, g, b) return realType(t) == "table" and near(t[1], r) and near(t[2], g) and near(t[3], b) end
function rgbText(t)
  if realType(t) ~= "table" then return tostring(t) end
  return realFormat("%.3f,%.3f,%.3f", t[1] or -1, t[2] or -1, t[3] or -1)
end
function T.swatchRGB(label) local s = T.swatch(label) return s and s.Color and s.Color.vertex end
-- Grayed out (SetUsable): alpha 0.45 and the mouse off; usable: alpha 1 and the mouse not off.
-- A slider grays its holder (caption and value) and turns off the slider's mouse.
function T.grayState(f, holder)
  local a = rawget(holder or f, "alpha") or 1
  local m = rawget(f, "mouse")
  if a == 1 and m ~= false then return "usable" end
  if near(a, 0.45) and m == false then return "grayed" end
  return "mixed (alpha " .. tostring(a) .. ", mouse " .. tostring(m) .. ")"
end
function T.controlState(label)
  local s = T.slider(label)
  if s then return T.grayState(s, s.parent) end
  local c = T.checkbox(label) or T.swatch(label)
  if not c then return "missing" end
  return T.grayState(c)
end
function checkControls(label, want)
  local names = {}
  for name in pairs(want) do names[#names + 1] = name end
  table.sort(names)
  for _, name in ipairs(names) do
    local got = T.controlState(name)
    check(got == want[name], label .. ": " .. name .. " " .. want[name] .. " (got " .. got .. ")")
  end
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
  const drv = exec(S, 'T.driver = T.frames[#T.frames]', '=test');
  if (drv) return drv;
  for (const [src, name] of [[STYLES_SRC, '@Styles.lua'], [SKINS_SRC, '@ShotWindow_Skins.lua']]) {
    if (lauxlib.luaL_loadbuffer(S, to_luastring(src), null, to_luastring(name)) !== 0) return lua.lua_tojsstring(S, -1);
    lua.lua_pushstring(S, to_luastring('ShotWindow'));
    lua.lua_getglobal(S, to_luastring('NS'));
    if (lua.lua_pcall(S, 2, 0, 0) !== 0) return name + ': ' + lua.lua_tojsstring(S, -1);
  }
  return null;
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
function scenario(name, body, pre) {
  HITS = new Map(); SEEN = new Map();
  const S = newState();
  const preErr = pre ? exec(S, pre, '=pre') : null;
  if (preErr) throw new Error(name + ': pre: ' + preErr);
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
    for (const l of lines.filter(l => l[0] === 'U')) console.log('       nil field read on a widget: ' + l.slice(2));
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
  check(#T.bar.textures >= 3 and T.fillTint() ~= nil and T.fillTint().allPoints == T.bar:GetStatusBarTexture() and not T.fillTint().shown, "stand, line and a hidden fill tint laid over the fill (got " .. #T.bar.textures .. ")")
  local x = T.tex()
  check(x.stand.layer == "ARTWORK" and x.stand.sublevel == 6 and x.line.layer == "ARTWORK" and x.line.sublevel == 7, "draw layers")
  check(x.stand.color[1] == 0.95 and x.stand.color[4] == 0.35 and x.line.color[4] == 0.95, "colors")
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
  check(x.stand.colorCalls == calls + 2, "two color changes over a full swing (" .. (x.stand.colorCalls - calls) .. ")")
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
  check(ShotWindowDB.window == 0.3 and T.said("aim window set to 0.3 s"), "window 0.3 taken")
  checkBands("window 0.3", 200, 2.8, 0.3, 0)
  T.now = 102.45 T.update() check(alpha() == 0.35, "window 0.3: still dim at 2.45 s")
  T.now = 102.55 T.update() check(alpha() == 0.65, "window 0.3: bright at 2.55 s (mid-swing change applies)")
  T.slash("window 5") check(ShotWindowDB.window == 0.3 and T.said("between 0 and 1"), "window 5 refused")
  T.slash("window abc") check(ShotWindowDB.window == 0.3, "window abc refused")
  T.slash("window -1") check(ShotWindowDB.window == 0.3, "window -1 refused")
  T.slash("window") check(ShotWindowDB.window == 0.3, "window with no number refused")
  T.slash("WINDOW 0") check(ShotWindowDB.window == 0, "command words ignore case")
  checkBands("window 0", 200, 2.8, 0, 0)
  T.slash("window 2") check(ShotWindowDB.window == 0 and T.said("between 0 and 1"), "window 2 refused")
  T.slash("window 1")
  checkBands("window 1", 200, 2.8, 1, 0)
  T.now = 200 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 201.85 T.update() check(alpha() == 0.65, "window 1: bright from 1.8 s")
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
  check(T.said("version 0.2.0"), "debug: version")
  check(T.said("bar found: true, showSwingTimer: 1"), "debug: bar and cvar")
  check(T.said("swing: 2.8 s (weapon 2.8 s)"), "debug: swing line")
  check(T.said("red zone: last 0.50 s = window 0.50 s + latency 0 ms + extra 0 ms"), "debug: red zone line")
  local n = #T.prints
  T.slash("garbage words")
  check(#T.prints == n + 6 and T.said("/shotwindow window <seconds>") and T.said("/shotwindow debug"), "garbage shows usage")
  T.slash("help")
  check(#T.prints == n + 12, "help shows usage (" .. (#T.prints - n) .. ")")
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
  check(#T.bar.textures >= 3, "textures created on the late bar")
  checkBands("late bar", 200, 2.8, 0.4, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('non-hunter login: no zone and nothing on the bar, only the look', String.raw`
  T.className, T.class = "Warrior", "WARRIOR"
  T.login(200)
  check(SlashCmdList.SHOTWINDOW ~= nil, "slash command, for the look")
  check(type(ShotWindowDB) == "table" and ShotWindowDB.style == "auto", "saved variables, for the look")
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
  check(#T.bar.textures >= 3, "textures created")
  checkAllHidden("no preview without a readable speed")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  check(T.driver.scripts.OnUpdate ~= nil, "a readable PLAYER_SWING still drives the bands")
  if #T.bar.textures >= 3 then checkBands("from PLAYER_SWING", 200, 2.8, 0.5, 0) end
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

// ---------------------------------------------------------------------------------------------
// The options UI.

scenario('options: page registered at hunter login, hidden, no proxy settings', String.raw`
  T.login(200)
  local s = T.settings
  check(#s.canvas == 1 and s.canvas[1].name == "Shot Window", "one canvas category named Shot Window (got " .. #s.canvas .. ")")
  check(#s.addon == 1 and s.addon[1] == s.canvas[1], "the category is added to the AddOns list")
  local page = T.page()
  check(page ~= nil and page:IsShown() == false and not page:IsVisible() and page:GetParent() == nil, "page hidden and unparented until Blizzard shows it")
  check(s.proxies == 0, "no proxy settings")
  check(#s.opens == 0 and not SettingsPanel:IsShown(), "nothing opened at login")
  check(T.content() == nil, "controls are not built at login")
  check(T.blocked == 0, "no blocked actions")
  check(#T.errors == 0, "no errors")
`);

scenario('options: a class without Auto Shot or a wand gets a page with the look only, and is told why', String.raw`
  T.className, T.class = "Rogue", "ROGUE"
  T.login(200)
  check(#T.settings.canvas == 1 and #T.settings.addon == 1, "a category registered")
  T.slash("")
  local page = T.page()
  local c
  for _, f in ipairs(T.frames) do if rawget(f, "parent") == page and rawget(f, "swParts") then c = f end end
  check(c ~= nil and c:IsVisible(), "the page shows its controls")
  local has = {}
  for _, fs in ipairs(c and c.fontStrings or {}) do if rawget(fs, "text") then has[#has + 1] = fs.text end end
  local all = table.concat(has, "|")
  check(all:find("Look", 1, true) and all:find("no stand-still zone", 1, true) and not all:find("Timing", 1, true)
    and not all:find("Red zone", 1, true) and not all:find("Color picker", 1, true), "the look, a line saying why, no zone settings (" .. all .. ")")
  local style, opacity, defaults
  for _, f in ipairs(T.frames) do
    if rawget(f, "parent") == c and f.kind == "Button" and rawget(f, "text") == "Window style: Automatic" then style = f end
    if rawget(f, "parent") == c and f.kind == "Button" and rawget(f, "text") == "Defaults" then defaults = f end
  end
  check(style ~= nil and defaults ~= nil, "the style button and Defaults")
  T.click(style, "RightButton")
  check(ShotWindowDB.style == "dark" and NS.report.skin == "Dark", "the style can be chosen here (" .. tostring(NS.report.skin) .. ")")
  T.slash("window 0.3")
  check(ShotWindowDB.window == 0.5 and T.said("the stand-still zone is for hunters and wand users"), "zone commands answer with what applies")
  T.slash("debug")
  check(T.said("no stand-still zone on this character"), "debug says so")
  check(#T.bar.textures > 0 and T.tex().stand.sublevel ~= 6, "the bar went flat, with no zone on it")
  check(#T.errors == 0, "no errors")
`);

scenario('options: /shotwindow opens the page by category ID and builds the controls once', String.raw`
  T.login(200)
  T.slash("")
  local s = T.settings
  check(#s.opens == 1 and type(s.opens[1]) == "number" and s.opens[1] == s.canvas[1]:GetID(), "OpenToCategory got the category's numeric ID (got " .. tostring(s.opens[1]) .. ")")
  check(SettingsPanel:IsShown(), "panel shown")
  local page, c = T.page(), T.content()
  check(page:GetParent() == T.canvas and page:IsVisible(), "page parented to the settings canvas and visible")
  check(c ~= nil and c:GetParent() == page and c:IsVisible(), "controls hosted on the page")
  check(T.window() == nil, "no fallback window")
  check(c and c:GetScale() == 1, "full size on the 665x601 canvas (scale " .. tostring(c and c:GetScale()) .. ")")
  check(T.slider("Aim window (the shot's wind-up)"):GetValue() == 500 and T.sliderText("Aim window (the shot's wind-up)") == "0.50 s", "aim window slider read from db (" .. tostring(T.sliderText("Aim window (the shot's wind-up)")) .. ")")
  check(T.slider("Extra lead"):GetValue() == 0 and T.sliderText("Extra lead") == "0 ms", "extra lead slider")
  check(T.slider("Thickness"):GetValue() == 2 and T.sliderText("Thickness") == "2 px", "thickness slider")
  check(T.slider("Zone opacity"):GetValue() == 35 and T.sliderText("Zone opacity") == "35%", "opacity slider")
  check(T.slider("Brightened opacity"):GetValue() == 65 and T.sliderText("Brightened opacity") == "65%", "inside opacity slider")
  check(T.slider("Fill opacity"):GetValue() == 75 and T.sliderText("Fill opacity") == "75%", "fill opacity slider")
  for _, l in ipairs({ "Start earlier by my latency", "Show the marker line", "Show the red zone", "Brighten inside the zone" }) do
    check(T.checkbox(l) and T.checkbox(l):GetChecked() == true, "checked: " .. l)
  end
  check(T.checkbox("Tint the fill inside the zone"):GetChecked() == false, "fill tint unchecked")
  for _, l in ipairs({ "Zone color", "Line color", "Fill color" }) do
    check(rgbIs(T.swatchRGB(l), 0.95, 0.20, 0.15), "swatch painted: " .. l .. " (" .. rgbText(T.swatchRGB(l)) .. ")")
  end
  check(T.status() and T.status():find("last 0.50 s", 1, true) ~= nil, "status line (" .. tostring(T.status()) .. ")")
  check(T.button("Defaults") ~= nil, "Defaults button")
  T.update(0.016) -- OnSizeChanged from SetAllPoints arrives on the next frame
  check(c:GetParent() == page and c:IsVisible() and c:GetScale() == 1, "still hosted after the page is sized")
  local frames = #T.frames
  T.closePanel()
  check(not page:IsVisible() and not c:IsVisible(), "closing the panel hides the page and the controls")
  T.slash("")
  check(#s.opens == 2 and SettingsPanel:IsShown() and page:IsVisible() and c:IsVisible() and c:GetParent() == page, "reopened")
  check(#T.frames == frames and #T.contents() == 1, "controls built once (" .. #T.contents() .. " builds, " .. (#T.frames - frames) .. " new frames)")
  T.slash("debug")
  check(T.said("options: page=registered, open=options page"), "debug says the page opened")
  check(T.blocked == 0, "no blocked actions")
  check(#T.errors == 0, "no errors")
`);

scenario('options: /shotwindow on an open page tries HideUIPanel; refused -> one hint', String.raw`
  T.login(200)
  T.slash("")
  check(SettingsPanel:IsShown(), "open")
  T.slash("")
  check(T.hideCalls == 1, "HideUIPanel tried (" .. T.hideCalls .. ")")
  check(T.blocked == 1 and SettingsPanel:IsShown() and T.page():IsVisible(), "refused: the panel stays")
  check(T.countSaid("Close them there") == 1, "close-there hint printed")
  T.slash("")
  check(T.countSaid("Close them there") == 1, "hint printed once (" .. T.countSaid("Close them there") .. ")")
  check(#T.settings.opens == 1, "no second OpenToCategory while open")
  T.hidePanelWorks = true
  T.slash("")
  check(not SettingsPanel:IsShown() and not T.page():IsVisible() and not T.content():IsVisible(), "closed when HideUIPanel is allowed")
  T.slash("")
  check(SettingsPanel:IsShown() and T.page():IsVisible() and T.content():IsVisible(), "opens again")
  check(T.window() == nil, "never fell back to the window")
  check(#T.errors == 0, "no errors")
`);

scenario('options: the page does not open -> standalone window, /shotwindow toggles it', String.raw`
  T.openFails = true
  T.login(200)
  T.slash("")
  local w = T.window()
  check(w ~= nil and w:IsShown() and w:IsVisible(), "window shown")
  check(w and w:GetFrameStrata() == "HIGH", "HIGH strata, under the DIALOG color picker")
  local listed = false
  for _, n in ipairs(UISpecialFrames) do if n == "ShotWindowOptions" then listed = true end end
  check(listed, "in UISpecialFrames, so Esc closes it")
  check(T.content() and T.content():GetParent() == w and T.content():IsVisible(), "controls hosted in the window")
  check(w and w.TitleContainer.TitleText:GetText() == "Shot Window", "title")
  check(T.hidPortrait == 1, "portrait hidden")
  check(#T.settings.opens == 1, "tried the page once")
  T.slash("debug")
  check(T.said("open=page did not open; using the window") and T.said("window=ButtonFrameTemplate"), "debug says why")
  T.slash("")
  check(not w:IsShown(), "second /shotwindow hides it")
  T.slash("")
  check(w:IsShown() and T.content():IsVisible() and #T.settings.opens == 1, "third shows it again without retrying the page")
  check(T.window() == w and #T.contents() == 1, "one window, one build")
  T.drag(T.slider("Extra lead"), 50)
  check(ShotWindowDB.extraLead == 50, "controls work in the window")
  T.escape()
  check(not w:IsShown(), "Esc closes it")
  T.slash("")
  T.click(w.CloseButton)
  check(not w:IsShown(), "its close button closes it")
  -- the player opens Esc > Options > AddOns > Shot Window while the window is up
  T.slash("")
  T.openPanelManually()
  check(not w:IsShown() and T.content():GetParent() == T.page() and T.content():IsVisible(), "the page takes the controls and the window hides")
  T.slash("")
  check(SettingsPanel:IsShown() and T.countSaid("Close them there") == 1, "page open: refused close, hint")
  T.closePanel()
  T.slash("")
  check(w:IsShown() and T.content():GetParent() == w and T.content():IsVisible(), "window again afterwards (the failure is sticky)")
  check(#T.errors == 0, "no errors")
`);

// The window's X in combat: the game's UIPanelCloseButton_OnClick goes through HideUIPanel, which
// refuses in combat, so the X must hide the window itself. Every way the window can be built.
for (const [label, setup, closeOf] of [
  ['ButtonFrameTemplate', '', 'w.CloseButton'],
  ['BasicFrameTemplateWithInset', 'T.templates.ButtonFrameTemplate = nil', 'w.CloseButton'],
  ['no frame template, own UIPanelCloseButton', 'T.templates.ButtonFrameTemplate, T.templates.BasicFrameTemplateWithInset = nil, nil', 'w.swClose'],
  ['Dark style', 'ShotWindowDB = { style = "dark" }', 'w.CloseButton'],
]) {
  scenario('options: the window close X works in combat (' + label + ')', String.raw`
    T.openFails = true
    ` + setup + String.raw`
    T.login(200)
    T.fire("PLAYER_ENTERING_WORLD")
    T.slash("")
    local w = T.window()
    local close = w and ` + closeOf + String.raw`
    check(w and w:IsShown() and close ~= nil, "window shown with its X")
    T.click(close)
    check(not w:IsShown(), "out of combat: the X closes it")
    T.slash("")
    check(w:IsShown(), "shown again")
    T.combat = true
    local before = T.combatRefusals
    T.click(close)
    check(not w:IsShown() and not w:IsVisible(), "in combat: the X closes it")
    check(T.combatRefusals == before, "no HideUIPanel refused in combat (" .. (T.combatRefusals - before) .. ")")
    check(T.blocked == 0, "nothing blocked")
    T.slash("")
    check(w:IsShown(), "in combat: /shotwindow opens it again")
    T.click(close)
    check(not w:IsShown() and T.combatRefusals == before, "and the X closes it again")
    check(#T.errors == 0, "no errors")
  `);
}

scenario('options: no Settings API -> window straight away', String.raw`
  Settings = nil
  T.login(200)
  T.slash("debug")
  check(T.said("options: not opened yet"), "debug before opening")
  T.slash("")
  check(T.window() and T.window():IsShown() and T.content():IsVisible(), "window shown")
  check(#T.errors == 0, "no errors")
`);

scenario('options: switching category and back; a small canvas scales the controls', String.raw`
  T.login(200)
  T.slash("")
  local page, c = T.page(), T.content()
  T.switchCategory()
  check(page:GetParent() == nil and not page:IsShown() and not c:IsVisible(), "another category: page unparented and hidden")
  T.slash("")
  check(#T.settings.opens == 2 and page:IsVisible() and c:IsVisible() and c:GetParent() == page, "/shotwindow brings it back")
  T.closePanel()
  T.canvas:SetSize(500, 400)
  T.slash("")
  local want = math.min(1, 488 / 600, 350 / 532)
  check(near(c:GetScale(), want), "scaled to fit (" .. tostring(c:GetScale()) .. ", want " .. want .. ")")
  T.update(0.016)
  check(near(c:GetScale(), want) and c:IsVisible(), "refit on OnSizeChanged")
  check(#T.errors == 0, "no errors")
`);

scenario('options: sliders change db, the zone timing and the looks', String.raw`
  T.login(200)
  T.slash("")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.drag(T.slider("Aim window (the shot's wind-up)"), 300)
  check(near(ShotWindowDB.window, 0.3) and T.sliderText("Aim window (the shot's wind-up)") == "0.30 s", "aim window 300 ms -> 0.3 s (" .. tostring(ShotWindowDB.window) .. ")")
  checkBands("aim 300 ms", 200, 2.8, 0.3, 0)
  T.now = 102.45 T.update() check(alpha() == 0.35, "aim 300 ms: dim at 2.45 s")
  T.now = 102.55 T.update() check(alpha() == 0.65, "aim 300 ms: bright at 2.55 s")
  check(T.status():find("aim 0.30", 1, true) ~= nil, "status line follows (" .. T.status() .. ")")

  T.now = 200 T.fire("PLAYER_SWING", 2.8, 2)
  T.drag(T.slider("Extra lead"), 100)
  check(ShotWindowDB.extraLead == 100 and T.sliderText("Extra lead") == "100 ms", "extra lead 100 ms")
  checkBands("extra lead 100 ms", 200, 2.8, 0.3, 0.1)
  T.now = 202.35 T.update() check(alpha() == 0.35, "extra lead: dim at 2.35 s")
  T.now = 202.45 T.update() check(alpha() == 0.65, "extra lead: bright from 2.4 s")
  T.drag(T.slider("Extra lead"), 103)
  check(ShotWindowDB.extraLead == 105, "snaps to 5 ms steps (" .. ShotWindowDB.extraLead .. ")")
  T.drag(T.slider("Extra lead"), 900)
  check(ShotWindowDB.extraLead == 300 and T.sliderText("Extra lead") == "300 ms", "clamped to 300")
  T.drag(T.slider("Extra lead"), 0)
  check(ShotWindowDB.extraLead == 0, "back to 0")

  T.now = 300 T.fire("PLAYER_SWING", 2.8, 2)
  T.drag(T.slider("Zone opacity"), 50)
  check(near(ShotWindowDB.idleAlpha, 0.5) and near(alpha(), 0.5) and T.sliderText("Zone opacity") == "50%", "opacity 50% while idle (" .. tostring(alpha()) .. ")")
  T.drag(T.slider("Brightened opacity"), 90)
  check(near(ShotWindowDB.activeAlpha, 0.9) and near(alpha(), 0.5), "inside opacity 90%: idle look unchanged")
  T.now = 302.6 T.update() check(near(alpha(), 0.9), "inside the zone: 0.9 (" .. tostring(alpha()) .. ")")
  T.drag(T.slider("Brightened opacity"), 20)
  check(near(alpha(), 0.2), "changed live while inside (" .. tostring(alpha()) .. ")")
  T.now = 302.9 T.update() check(near(alpha(), 0.5), "swing end: idle 0.5")

  T.drag(T.slider("Fill opacity"), 40)
  check(near(ShotWindowDB.fillAlpha, 0.4) and near(T.fillTint().color[4], 0.4) and T.sliderText("Fill opacity") == "40%", "fill opacity 40%")

  local calls = T.pixelCalls
  T.drag(T.slider("Thickness"), 4)
  check(ShotWindowDB.lineWidth == 4 and T.sliderText("Thickness") == "4 px", "thickness 4")
  check(T.pixelCalls > calls and T.pixelArgs[1] == 4 and T.pixelArgs[3] == 1, "line width goes through PixelUtil")
  check(T.tex().line.width == 4, "line 4 px wide (" .. tostring(T.tex().line.width) .. ")")
  T.pixelSize = 4.5 T.drag(T.slider("Thickness"), 3)
  check(T.tex().line.width == 4.5, "PixelUtil's answer is used (" .. tostring(T.tex().line.width) .. ")")
  T.pixelSize = nil T.lineW = 3 T.resize(200)
  checkBands("after the slider changes", 200, 2.8, 0.3, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('options: checkboxes toggle their keys and the visuals', String.raw`
  T.net = { 0, 0, 40, 120 }
  T.login(200)
  T.slash("")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  local x = T.tex()
  local band = T.checkbox("Show the red zone")
  T.click(band)
  check(ShotWindowDB.band == false and band:GetChecked() == false and not x.stand.shown and x.line.shown, "red zone off: band hidden, line kept")
  T.click(band)
  check(ShotWindowDB.band == true and x.stand.shown, "red zone on again")
  local line = T.checkbox("Show the marker line")
  T.click(line)
  check(ShotWindowDB.line == false and not x.line.shown and x.stand.shown, "marker line off")
  T.click(line)
  check(ShotWindowDB.line == true and x.line.shown, "marker line on again")
  checkBands("latency on", 200, 2.8, 0.5, 0.12)
  local lat = T.checkbox("Start earlier by my latency")
  T.click(lat)
  check(ShotWindowDB.latency == false, "latency off")
  checkBands("latency off", 200, 2.8, 0.5, 0)
  check(T.status():find("latency 0 ms", 1, true) ~= nil, "status line shows no latency")
  T.click(lat)
  checkBands("latency on again", 200, 2.8, 0.5, 0.12)
  local flash = T.checkbox("Brighten inside the zone")
  T.click(flash)
  check(ShotWindowDB.flash == false, "flash off")
  T.now = 102.5 T.update() check(alpha() == 0.35, "no brightening with flash off")
  T.click(flash)
  check(alpha() == 0.65, "bright at once when turned on inside the zone")
  local tint = T.checkbox("Tint the fill inside the zone")
  local fill = T.fillTint()
  T.click(tint)
  check(ShotWindowDB.fillTint == true and fill.shown, "fill tint on inside the zone: shown at once")
  check(rgbIs(fill.color, 0.95, 0.20, 0.15) and near(fill.color[4], 0.75), "fill tint color and opacity")
  T.now = 102.9 T.update() check(not fill.shown, "hidden at swing end")
  T.now = 200 T.fire("PLAYER_SWING", 2.8, 2) check(not fill.shown, "hidden at swing start")
  T.now = 202.0 T.update() check(not fill.shown, "hidden before the zone")
  T.now = 202.3 T.update() check(fill.shown, "shown inside the zone (from 2.18 s)")
  T.click(tint)
  check(ShotWindowDB.fillTint == false and not fill.shown, "fill tint off: hidden at once")
  check(#T.errors == 0, "no errors")
`);

scenario('options: color swatches (live, Okay, Cancel, click outside, Escape)', String.raw`
  T.login(200)
  T.slash("")
  local sw, x = T.swatch("Zone color"), T.tex()
  local calls, paints = x.stand.colorCalls, sw.Color.vertex
  T.click(sw)
  check(T.picker:IsShown() and T.pickerSetups == 1, "picker opened")
  check(T.picker.hasOpacity == false and T.picker.swatchFunc ~= nil and T.picker.cancelFunc ~= nil, "no opacity; swatchFunc and cancelFunc set")
  check(near(T.picker.previousValues.r, 0.95) and near(T.picker.previousValues.g, 0.20) and near(T.picker.previousValues.b, 0.15), "opened with the saved color")
  check(T.pickerEarly == 1, "the mock fired swatchFunc once before Show")
  check(x.stand.colorCalls == calls and sw.Color.vertex == paints, "that early call was ignored (no apply)")
  T.slash("debug") check(T.said("picker=opened"), "debug: picker=opened")
  T.pickColor(0.1, 0.8, 0.2)
  check(rgbIs(ShotWindowDB.color, 0.1, 0.8, 0.2), "live: db (" .. rgbText(ShotWindowDB.color) .. ")")
  check(rgbIs(x.stand.color, 0.1, 0.8, 0.2), "live: band recolored (" .. rgbText(x.stand.color) .. ")")
  check(rgbIs(T.swatchRGB("Zone color"), 0.1, 0.8, 0.2), "live: swatch repainted")
  T.pickerOkay()
  check(not T.picker:IsShown() and rgbIs(ShotWindowDB.color, 0.1, 0.8, 0.2) and rgbIs(x.stand.color, 0.1, 0.8, 0.2), "Okay keeps it")

  T.click(sw)
  check(near(T.picker.previousValues.r, 0.1), "reopens with the kept color")
  T.pickColor(0.5, 0.5, 0.9)
  check(rgbIs(x.stand.color, 0.5, 0.5, 0.9), "live again")
  T.pickerCancel()
  check(not T.picker:IsShown() and rgbIs(ShotWindowDB.color, 0.1, 0.8, 0.2) and rgbIs(x.stand.color, 0.1, 0.8, 0.2)
    and rgbIs(T.swatchRGB("Zone color"), 0.1, 0.8, 0.2), "Cancel restores db, band and swatch")

  T.click(sw) T.pickColor(0.3, 0.3, 0.3)
  T.click(T.checkbox("Show the marker line"))
  check(not T.picker:IsShown() and rgbIs(ShotWindowDB.color, 0.1, 0.8, 0.2), "a click elsewhere cancels")
  check(ShotWindowDB.line == false, "and the click still lands")
  T.click(T.checkbox("Show the marker line"))

  T.click(sw) T.pickColor(0.2, 0.2, 0.2)
  T.escape()
  check(not T.picker:IsShown() and rgbIs(ShotWindowDB.color, 0.1, 0.8, 0.2), "Escape cancels")

  local lsw = T.swatch("Line color")
  T.click(lsw) T.pickColor(0, 0, 1)
  check(rgbIs(x.line.color, 0, 0, 1) and rgbIs(ShotWindowDB.lineColor, 0, 0, 1), "line color live")
  T.pickerOkay()
  T.click(T.swatch("Fill color")) T.pickColor(1, 1, 0) T.pickerOkay()
  check(rgbIs(ShotWindowDB.fillColor, 1, 1, 0) and rgbIs(T.fillTint().color, 1, 1, 0), "fill color")

  T.click(sw) T.pickColor(0.6, 0.6, 0.6)
  T.click(lsw)
  check(rgbIs(ShotWindowDB.color, 0.1, 0.8, 0.2), "opening another swatch cancels the first")
  check(T.picker:IsShown() and near(T.picker.previousValues.b, 1), "and opens on the line color")
  T.pickerCancel()
  check(rgbIs(ShotWindowDB.lineColor, 0, 0, 1) and ShotWindowDB.color ~= ShotWindowDB.lineColor, "line color kept, separate tables")
  check(#T.errors == 0, "no errors")
`);

scenario('options: no color picker on the client -> message', String.raw`
  ColorPickerFrame = nil
  T.login(200)
  T.slash("")
  T.click(T.swatch("Zone color"))
  check(T.said("this client would not open the color picker."), "message")
  T.slash("debug") check(T.said("picker=unavailable"), "debug: picker=unavailable")
  check(#T.errors == 0, "no errors")
`);

scenario('options: ColorSwatchTemplate missing -> bare swatch from color textures', String.raw`
  T.templates.ColorSwatchTemplate = nil
  T.login(200)
  T.slash("")
  local sw = T.swatch("Zone color")
  check(sw ~= nil and sw.template == nil, "a plain Button")
  check(sw and sw.SwatchBg and sw.InnerBorder and sw.Color and sw.SwatchBg.colorTex and sw.InnerBorder.colorTex and sw.Color.colorTex, "three color-texture squares")
  check(sw and sw.width == 16 and sw.height == 16, "16x16")
  check(rgbIs(T.swatchRGB("Zone color"), 0.95, 0.20, 0.15), "painted")
  T.click(sw) T.pickColor(0, 1, 0) T.pickerOkay()
  check(rgbIs(ShotWindowDB.color, 0, 1, 0) and rgbIs(T.swatchRGB("Zone color"), 0, 1, 0), "picks work")
  T.slash("debug") check(T.said("swatch=bare"), "debug: swatch=bare")
  check(#T.errors == 0, "no errors")
`);

scenario('options: missing slider templates -> the next one in the chain', String.raw`
  T.templates.MinimalSliderTemplate = nil
  T.login(200)
  T.slash("")
  T.slash("debug") check(T.said("slider=UISliderTemplate"), "UISliderTemplate used")
  local s = T.slider("Extra lead")
  check(s and s.template == "UISliderTemplate" and s:GetObeyStepOnDrag(), "obeys steps on drag")
  T.drag(s, 52) check(ShotWindowDB.extraLead == 50, "drag works (" .. tostring(ShotWindowDB.extraLead) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('options: only OptionsSliderTemplate -> its named labels are stripped', String.raw`
  T.templates.MinimalSliderTemplate, T.templates.UISliderTemplate = nil, nil
  T.login(200)
  T.slash("")
  T.slash("debug") check(T.said("slider=OptionsSliderTemplate"), "OptionsSliderTemplate used")
  for i = 1, 6 do
    for _, k in ipairs({ "Low", "High", "Text" }) do
      local fs = _G["ShotWindowOptionsSlider" .. i .. k]
      check(fs ~= nil and fs:GetText() == "" and not fs:IsShown(), "slider " .. i .. " " .. k .. " cleared and hidden")
    end
  end
  T.drag(T.slider("Zone opacity"), 60) check(near(ShotWindowDB.idleAlpha, 0.6), "drag works")
  check(#T.errors == 0, "no errors")
`);

scenario('options: no templates at all -> bare widgets from color textures', String.raw`
  T.templates = {}
  T.openFails = true
  T.login(200)
  T.slash("")
  T.slash("debug")
  check(T.said("window=bare, slider=bare, check=bare, swatch=bare"), "every fallback reported")
  local w = T.window()
  check(w and w:IsShown() and T.content():IsVisible(), "bare window shown")
  local bg = w and w.textures[1]
  check(bg and bg.colorTex and bg.layer == "BACKGROUND", "window background is a color texture")
  local cb = T.checkbox("Show the red zone")
  check(cb and cb:GetCheckedTexture() and cb:GetCheckedTexture().colorTex, "checkbox mark is a color texture")
  T.click(cb) check(ShotWindowDB.band == false and not T.tex().stand.shown, "bare checkbox works")
  local s = T.slider("Extra lead")
  check(s and s:GetThumbTexture() and s:GetThumbTexture().colorTex and s:GetOrientation() == "HORIZONTAL", "slider thumb is a color texture")
  T.drag(s, 40) check(ShotWindowDB.extraLead == 40, "bare slider works")
  local sw = T.swatch("Zone color")
  T.click(sw) T.pickColor(0, 0, 1) T.pickerOkay()
  check(rgbIs(ShotWindowDB.color, 0, 0, 1), "bare swatch works")
  local reset = T.button("Defaults")
  check(reset ~= nil and #reset.textures > 0, "bare Defaults button has something drawn (" .. (reset and #reset.textures or 0) .. " textures)")
  T.click(reset)
  check(ShotWindowDB.extraLead == 0 and ShotWindowDB.band == true, "bare Defaults button works")
  local close
  for _, f in ipairs(w.children) do if f.kind == "Button" then close = f end end
  check(close ~= nil, "bare window has a close button")
  check(close and close.width > 0 and close.height > 0 and #close.textures > 0, "bare close button has a size and something drawn (" .. tostring(close and close.width) .. "x" .. tostring(close and close.height) .. ", " .. (close and #close.textures or 0) .. " textures)")
  T.click(close)
  check(not w:IsShown(), "bare close button closes the window")
  check(#T.errors == 0, "no errors")
`);

scenario('options: Defaults resets every key with fresh tables', String.raw`
  T.login(200)
  T.slash("")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.drag(T.slider("Aim window (the shot's wind-up)"), 300) T.drag(T.slider("Extra lead"), 100) T.drag(T.slider("Thickness"), 5)
  T.drag(T.slider("Zone opacity"), 50) T.drag(T.slider("Brightened opacity"), 90) T.drag(T.slider("Fill opacity"), 40)
  for _, l in ipairs({ "Start earlier by my latency", "Show the marker line", "Show the red zone", "Brighten inside the zone", "Tint the fill inside the zone" }) do T.click(T.checkbox(l)) end
  T.click(T.swatch("Zone color")) T.pickColor(0, 0, 0) T.pickerOkay()
  T.click(T.swatch("Line color")) T.pickColor(0, 0, 1) T.pickerOkay()
  T.click(T.swatch("Fill color")) T.pickColor(1, 1, 0) T.pickerOkay()
  T.now = 102.5 T.update()
  check(T.fillTint().shown, "fill tint showing before the reset")
  T.click(T.button("Defaults"))
  check(T.said("settings reset to the defaults"), "printed")
  local d = ShotWindowDB
  check(d.window == 0.5 and d.latency == true and d.extraLead == 0 and d.band == true and d.idleAlpha == 0.35 and d.flash == true
    and d.activeAlpha == 0.65 and d.line == true and d.lineWidth == 2 and d.fillTint == false and d.fillAlpha == 0.75, "every value back")
  check(rgbIs(d.color, 0.95, 0.20, 0.15) and rgbIs(d.lineColor, 0.95, 0.20, 0.15) and rgbIs(d.fillColor, 0.95, 0.20, 0.15), "every color back")
  check(d.color ~= d.lineColor and d.color ~= d.fillColor and d.lineColor ~= d.fillColor, "three separate color tables")
  check(T.slider("Aim window (the shot's wind-up)"):GetValue() == 500 and T.slider("Extra lead"):GetValue() == 0 and T.slider("Thickness"):GetValue() == 2
    and T.slider("Zone opacity"):GetValue() == 35 and T.slider("Brightened opacity"):GetValue() == 65 and T.slider("Fill opacity"):GetValue() == 75, "sliders refreshed")
  check(T.checkbox("Show the red zone"):GetChecked() and T.checkbox("Show the marker line"):GetChecked() and T.checkbox("Brighten inside the zone"):GetChecked()
    and T.checkbox("Start earlier by my latency"):GetChecked() and not T.checkbox("Tint the fill inside the zone"):GetChecked(), "checkboxes refreshed")
  check(rgbIs(T.swatchRGB("Zone color"), 0.95, 0.20, 0.15) and rgbIs(T.swatchRGB("Line color"), 0.95, 0.20, 0.15) and rgbIs(T.swatchRGB("Fill color"), 0.95, 0.20, 0.15), "swatches repainted")
  check(not T.fillTint().shown and alpha() == 0.65 and rgbIs(T.tex().stand.color, 0.95, 0.20, 0.15), "looks back (inside the zone, flash on)")
  checkBands("defaults", 200, 2.8, 0.5, 0)
  -- the picker edits the color table in place; a later reset must not inherit that
  T.click(T.swatch("Zone color")) T.pickColor(0, 0, 0) T.pickerOkay()
  ShotWindowDB.fillColor[1] = 0
  T.click(T.button("Defaults"))
  check(rgbIs(ShotWindowDB.color, 0.95, 0.20, 0.15) and rgbIs(ShotWindowDB.fillColor, 0.95, 0.20, 0.15), "second reset unaffected by edits to the first reset's tables")
  check(#T.errors == 0, "no errors")
`);

scenario('options: slash changes refresh the open page', String.raw`
  T.login(200)
  T.slash("")
  T.slash("window 0.3")
  check(T.slider("Aim window (the shot's wind-up)"):GetValue() == 300 and T.sliderText("Aim window (the shot's wind-up)") == "0.30 s", "aim slider follows /shotwindow window")
  check(T.status():find("aim 0.30", 1, true) ~= nil, "status line follows")
  T.slash("latency")
  check(T.checkbox("Start earlier by my latency"):GetChecked() == false, "latency checkbox follows")
  T.slash("flash")
  check(T.checkbox("Brighten inside the zone"):GetChecked() == false, "flash checkbox follows")
  T.slash("window 0.333")
  check(T.sliderText("Aim window (the shot's wind-up)") == "0.33 s" and near(ShotWindowDB.window, 0.333), "off-step value keeps db and reads true")
  T.closePanel()
  T.slash("window 0.7") T.slash("latency")
  T.slash("")
  check(T.slider("Aim window (the shot's wind-up)"):GetValue() == 700 and T.checkbox("Start earlier by my latency"):GetChecked() == true, "changes made while closed show on reopen")
  check(#T.errors == 0, "no errors")
`);

scenario('options: /shotwindow debug prints the options report', String.raw`
  T.login(200)
  T.slash("debug")
  check(T.said("options: page=registered"), "before opening")
  T.slash("")
  T.click(T.swatch("Zone color")) T.pickerCancel()
  T.slash("debug")
  check(T.said("options: page=registered, open=options page, slider=MinimalSliderTemplate, check=UICheckButtonTemplate, swatch=ColorSwatchTemplate, picker=opened"), "full report")
  check(#T.errors == 0, "no errors")
`);

scenario('options: a build error is caught and printed (page, then window)', String.raw`
  T.login(200)
  T.badFont = "GameFontDisableSmall" -- the status line, after three controls were made
  T.slash("")
  check(T.said("the options could not be built:"), "printed on the page path")
  check(#T.errors == 0, "no script error")
  check(SettingsPanel:IsShown() and T.page():IsVisible(), "the page itself still opens")
  T.closePanel()
  T.badFont = nil
  T.slash("")
  local c = T.content()
  check(c and c:IsVisible() and c:GetParent() == T.page(), "built on the next open")
  T.drag(T.slider("Extra lead"), 50)
  check(ShotWindowDB.extraLead == 50 and T.sliderText("Extra lead") == "50 ms", "the new controls work")
  check(#T.errors == 0, "no errors after the retry")
`);

scenario('options: a build error after the status line leaves nothing running', String.raw`
  T.login(200)
  T.badText = "Marker line" -- the second header: the status line's OnUpdate is already set
  T.slash("")
  check(T.said("the options could not be built:"), "printed")
  local orphan = T.content()
  check(orphan ~= nil and not orphan:IsVisible() and orphan:GetParent() == nil, "the half-built frame is hidden and unparented")
  local before = #T.errors
  orphan.scripts.OnUpdate = (function(f) return function(...) T.orphanTicks = (T.orphanTicks or 0) + 1 return f(...) end end)(orphan.scripts.OnUpdate)
  T.update(0.6) T.update(0.6)
  check(not T.orphanTicks, "its OnUpdate never runs (" .. tostring(T.orphanTicks) .. " ticks)")
  T.closePanel()
  T.badText = nil
  T.slash("")
  local c = T.content()
  check(c ~= orphan and c:IsVisible() and #T.contents() == 2, "rebuilt on the next open")
  T.slash("window 0.4")
  check(T.slider("Aim window (the shot's wind-up)"):GetValue() == 400, "the new page refreshes")
  check(#T.errors == before, "no errors")
`);

scenario('options: a build error on the window path', String.raw`
  T.openFails = true
  T.login(200)
  T.badFont = "GameFontNormalLarge" -- the first header
  T.slash("")
  check(T.said("the options could not be built:") and T.window() == nil, "printed, no window")
  T.badFont = nil
  T.slash("")
  check(T.window() and T.window():IsShown() and T.content():IsVisible(), "window on the next try")
  check(#T.errors == 0, "no errors")
`);

scenario('options: settings saved by 0.1.0 show on the page', String.raw`
  ShotWindowDB = { window = 1.5, latency = true, flash = false, color = { 0.2, 0.4, 0.6 } } -- 0.1.0 allowed up to 2 s
  T.login(200)
  T.slash("")
  check(T.slider("Aim window (the shot's wind-up)"):GetValue() == 1000 and T.sliderText("Aim window (the shot's wind-up)") == "1.50 s", "out-of-range window: slider at its end, label from db (" .. tostring(T.sliderText("Aim window (the shot's wind-up)")) .. ")")
  check(ShotWindowDB.window == 1.5, "the refresh does not overwrite the saved window")
  check(T.checkbox("Brighten inside the zone"):GetChecked() == false, "saved flash off shows")
  check(rgbIs(T.swatchRGB("Zone color"), 0.2, 0.4, 0.6), "saved color shows")
  T.drag(T.slider("Aim window (the shot's wind-up)"), 400)
  check(near(ShotWindowDB.window, 0.4), "dragging takes over")
  check(#T.errors == 0, "no errors")
`);

scenario('options: category registration fails -> window, reported in debug', String.raw`
  Settings.RegisterAddOnCategory = function() error("no AddOns list here") end
  T.login(200)
  check(#T.errors == 0, "login survives it")
  T.slash("debug")
  check(T.said("page=failed:"), "debug reports the failure")
  T.slash("")
  check(T.window() and T.window():IsShown() and T.content():IsVisible() and #T.settings.opens == 0, "window, no OpenToCategory")
  check(#T.errors == 0, "no errors")
`);

scenario('options: secret latency and weapon speed while the page is open', String.raw`
  T.net = { 0, 0, secret(40), secret(120) }
  T.login(200)
  T.slash("")
  T.update(0.6)
  check(T.status():find("latency 0 ms", 1, true) ~= nil, "secret latency reads as 0 on the page (" .. tostring(T.status()) .. ")")
  T.speed = { mh = secret(2.0), oh = nil, rng = secret(2.8) }
  T.drag(T.slider("Extra lead"), 50)
  T.click(T.checkbox("Show the red zone"))
  T.update(0.6)
  check(#T.errors == 0, "no errors")
`);

// ---------------------------------------------------------------------------------------------
// Hold until the shot, auto-repeat tracking, wand users, and the options added with them.
// The game's bar clears itself when its time runs out (Blizzard_SwingTimer.lua OnUpdate ->
// ClearSwingTimer at remaining <= 0); Shot Window keeps the zone lit after that while Auto Shot is on.
// The wait starts at the OnUpdate tick that sees the end, so the scenarios tick at 102.81 (not
// 102.8, which is 2.7999... s after 100 in floating point).

scenario('hold: Auto Shot on keeps the zone lit after the bar ends, steady 0.15 s, then pulsing, until the next shot', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  check(not T.running(), "seeded on at login: no wait and no OnUpdate before any swing")
  local x = T.tex()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.0 T.update() check(alpha() == 0.35, "dim before the zone")
  T.now = 102.5 T.update() check(alpha() == 0.65, "bright inside the zone")
  local n0 = T.alphaCount()
  T.now = 102.81 T.update()
  check(T.running(), "OnUpdate keeps running after the bar's time is up")
  check(alpha() == 0.65 and x.stand.shown, "zone still lit after the bar ends (alpha " .. tostring(alpha()) .. ")")
  checkSpan("zone kept where it was", x.stand, ${RED_X}, 200)
  check(T.stateHas("waiting for a late shot"), "debug: waiting (" .. T.state() .. ")")
  for _, t in ipairs({ 0.02, 0.05, 0.1, 0.14 }) do T.now = 102.81 + t T.update() end
  check(T.alphaCount() == n0, "steady for the first 0.15 s (alpha set to: " .. T.alphasSince(n0) .. ")")
  check(alpha() == 0.65, "still lit in the grace period")
  T.now = 102.81 + 0.35 T.update()
  check(near(T.standAlpha(), 0.6), "pulse: 0.6 at 0.2 s into it (" .. tostring(T.standAlpha()) .. ")")
  T.now = 102.81 + 0.55 T.update()
  check(near(T.standAlpha(), 0.2), "pulse: 0.2 at its low (" .. tostring(T.standAlpha()) .. ")")
  T.now = 102.81 + 0.95 T.update()
  check(near(T.standAlpha(), 1), "pulse: back to 1 after 0.8 s (" .. tostring(T.standAlpha()) .. ")")
  check(alpha() == 0.65, "the color keeps the brightened alpha while pulsing")
  -- the late shot, about 1 s after the bar ended
  T.now = 103.81 T.update()
  local beforeShot = T.alphaCount()
  T.fire("PLAYER_SWING", 2.8, 2)
  check(T.standAlpha() == 1, "next ranged PLAYER_SWING: alpha back to 1 (" .. tostring(T.standAlpha()) .. ")")
  check(alpha() == 0.35, "next ranged PLAYER_SWING: dim at the start of the new swing")
  check(T.stateHas("swing running"), "debug: swing running (" .. T.state() .. ")")
  local afterShot = T.alphaCount()
  T.now = 104.5 T.update() T.now = 105.0 T.update()
  check(T.alphaCount() == afterShot and alpha() == 0.35, "no pulse and dim during the new swing")
  T.now = 103.81 + 2.4 T.update() check(alpha() == 0.65, "the new swing brightens 2.3 s in")
  T.now = 103.81 + 2.81 T.update() check(T.running() and alpha() == 0.65, "and holds again at its end")
  check(#T.errors == 0, "no errors")
`);

scenario('hold: a shot reported in the grace period ends the wait with no pulse', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.5 T.update()
  local n0 = T.alphaCount()
  T.now = 102.81 T.update()
  T.now = 102.86 T.update()
  T.now = 102.88 T.fire("PLAYER_SWING", 2.8, 2)
  local bad = false
  for _, a in ipairs(T.alphaLog()) do if a ~= 1 then bad = true end end
  check(not bad, "alpha never left 1 (set to: " .. T.alphasSince(n0) .. ")")
  check(alpha() == 0.35 and T.running(), "new swing running, dim")
  check(#T.errors == 0, "no errors")
`);

scenario('hold: STOP_AUTOREPEAT_SPELL ends a wait, and dims an inside zone mid-swing', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.now = 103.2 T.update()
  check(T.standAlpha() ~= nil and T.standAlpha() < 1, "pulsing before STOP (" .. tostring(T.standAlpha()) .. ")")
  T.fire("STOP_AUTOREPEAT_SPELL")
  check(T.standAlpha() == 1, "STOP: alpha back to 1")
  check(alpha() == 0.35, "STOP: zone dimmed")
  check(not T.running(), "STOP: OnUpdate removed")
  check(T.stateHas("auto-repeat false, idle"), "debug after STOP (" .. T.state() .. ")")
  local n = T.alphaCount()
  T.now = 104 T.update() check(T.alphaCount() == n, "no pulse after STOP")
  -- mid-swing
  T.now = 110 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 112.4 T.update() check(alpha() == 0.35, "Auto Shot off: no brightening inside the zone")
  T.fire("START_AUTOREPEAT_SPELL")
  check(alpha() == 0.65, "START inside the zone brightens at once")
  check(T.stateHas("auto-repeat true, swing running"), "START mid-swing does not start a wait (" .. T.state() .. ")")
  T.fire("STOP_AUTOREPEAT_SPELL")
  check(alpha() == 0.35, "STOP inside the zone dims at once")
  T.now = 112.6 T.update() check(alpha() == 0.35, "stays dim inside the zone")
  T.now = 112.81 T.update()
  check(not T.running() and alpha() == 0.35, "no wait at the bar's end with Auto Shot off")
  check(#T.errors == 0, "no errors")
`);

scenario('hold: the wait gives up after 5 s', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  for k = 1, 49 do T.now = 102.81 + k * 0.1 T.update(0.1) end
  check(T.running() and alpha() == 0.65, "still waiting at 4.9 s")
  T.now = 102.81 + 5.01 T.update()
  check(not T.running(), "OnUpdate removed at the cap")
  check(alpha() == 0.35 and T.standAlpha() == 1, "dim with alpha 1 after the cap (" .. tostring(alpha()) .. ", " .. tostring(T.standAlpha()) .. ")")
  check(T.stateHas("auto-repeat true, idle"), "debug after the cap (" .. T.state() .. ")")
  T.now = 120 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 122.5 T.update() check(alpha() == 0.65, "a later shot works as usual")
  check(#T.errors == 0, "no errors")
`);

scenario('hold off: the zone ends with the bar, START begins no wait', String.raw`
  ShotWindowDB = { hold = false }
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.5 T.update() check(alpha() == 0.65, "bright inside the zone")
  T.now = 102.81 T.update()
  check(not T.running() and alpha() == 0.35, "hold off: dim and stopped when the bar ends")
  check(T.alphaCount() == 0, "no alpha changes")
  T.fire("STOP_AUTOREPEAT_SPELL") T.fire("START_AUTOREPEAT_SPELL")
  check(not T.running() and alpha() == 0.35, "hold off: START with no swing begins no wait")
  check(#T.errors == 0, "no errors")
`);

scenario('pulse off: lit while waiting, alpha never touched', String.raw`
  ShotWindowDB = { pulse = false }
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  for k = 1, 30 do T.now = 102.81 + k * 0.05 T.update(0.05) end
  check(T.running() and alpha() == 0.65, "lit and waiting")
  check(T.alphaCount() == 0, "no pulse (alpha set to: " .. T.alphasSince(0) .. ")")
  T.fire("PLAYER_SWING", 2.8, 2)
  check(alpha() == 0.35 and (T.standAlpha() == nil or T.standAlpha() == 1), "the shot ends it")
  check(#T.errors == 0, "no errors")
`);

scenario('Auto Shot off at login (IsAutoRepeatSpell false): no brightening inside the zone and no wait', String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", false
  T.currentMode, T.current[75] = "plain", false
  T.login(200)
  check(T.stateHas("shot spell 75, auto-repeat false, idle"), "debug (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  for _, el in ipairs({ 2.0, 2.4, 2.7 }) do
    T.now = 100 + el T.update() check(alpha() == 0.35, "dim at " .. el .. " s with Auto Shot off")
  end
  T.now = 102.81 T.update()
  check(not T.running() and alpha() == 0.35, "no wait")
  check(#T.errors == 0, "no errors")
`);

scenario('auto-repeat unknown (no IsCurrentSpell, no events): brightens as before, never waits', String.raw`
  T.login(200)
  check(T.stateHas("auto-repeat nil"), "unknown (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.5 T.update() check(alpha() == 0.65, "brightens inside the zone")
  T.now = 102.81 T.update()
  check(not T.running() and alpha() == 0.35, "no wait at the bar's end")
  check(#T.errors == 0, "no errors")
`);

for (const [mode, label] of [['error', 'raises'], ['number', 'answers a number (old client)']]) {
  scenario('auto-repeat unknown when IsCurrentSpell ' + label, String.raw`
    T.currentMode, T.current[75] = "${mode}", true
    T.login(200)
    check(#T.errors == 0, "login survives it")
    check(#T.currentQueries == 1 and T.currentQueries[1] == 75, "asked once for 75")
    check(T.stateHas("auto-repeat nil"), "unknown (" .. T.state() .. ")")
    T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
    T.now = 102.5 T.update() check(alpha() == 0.65, "brightens")
    T.now = 102.81 T.update() check(not T.running(), "never waits")
    check(#T.errors == 0, "no errors")
  `);
}

scenario('IsCurrentSpell true at login seeds auto-repeat on (a /reload mid-fight)', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  check(#T.currentQueries == 1 and T.currentQueries[1] == 75, "hunter asks about 75 (Auto Shot)")
  check(T.stateHas("shot spell 75, auto-repeat true, idle"), "seeded (" .. T.state() .. ")")
  local ev = T.driver.events
  check(ev.START_AUTOREPEAT_SPELL == true and ev.STOP_AUTOREPEAT_SPELL == true, "START and STOP_AUTOREPEAT_SPELL registered")
  check(#T.errors == 0, "no errors")
`);

scenario('secret IsCurrentSpell answer: unknown, never touched', String.raw`
  T.currentMode, T.current[75] = "secret", true
  T.login(200)
  check(#T.currentQueries == 1 and T.currentQueries[1] == 75, "asked once, and got the secret")
  check(#T.errors == 0, "no error from a secret answer")
  check(T.stateHas("auto-repeat nil"), "treated as unknown (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.5 T.update() check(alpha() == 0.65, "brightens as unknown")
  T.now = 102.81 T.update() check(not T.running(), "no wait")
  check(#T.errors == 0, "no errors")
`);

scenario('START with no swing running: first-shot wait until PLAYER_SWING, or the cap', String.raw`
  T.currentMode = "plain"
  T.login(200)
  local x = T.tex()
  T.now = 100 T.fire("START_AUTOREPEAT_SPELL")
  check(T.running(), "OnUpdate started for the first shot's wind-up")
  check(alpha() == 0.65 and x.stand.shown, "zone lit at once")
  checkSpan("preview zone from the weapon speed", x.stand, ${RED_X}, 200)
  check(T.stateHas("auto-repeat true, waiting for a late shot"), "debug (" .. T.state() .. ")")
  local n0 = T.alphaCount()
  T.now = 100.1 T.update() check(T.alphaCount() == n0, "steady in the grace period")
  T.now = 100.5 T.update() check(T.standAlpha() ~= nil and T.standAlpha() < 1, "pulsing after it (" .. tostring(T.standAlpha()) .. ")")
  T.now = 100.6 T.fire("PLAYER_SWING", 2.8, 2)
  check(T.standAlpha() == 1 and alpha() == 0.35, "the first shot ends the wait: alpha 1, dim")
  check(T.stateHas("swing running"), "swing running (" .. T.state() .. ")")
  -- the cap: Auto Shot turned on but no shot ever comes (out of range, say)
  T.fire("STOP_AUTOREPEAT_SPELL")
  T.now = 104 T.update()
  check(not T.running(), "idle after the swing with Auto Shot off")
  T.now = 110 T.fire("START_AUTOREPEAT_SPELL")
  check(T.running() and alpha() == 0.65, "waiting again")
  for k = 1, 49 do T.now = 110 + k * 0.1 T.update(0.1) end
  check(T.running(), "still waiting at 4.9 s")
  T.now = 115.01 T.update()
  check(not T.running() and alpha() == 0.35 and T.standAlpha() == 1, "cap ends it")
  check(#T.errors == 0, "no errors")
`);

scenario('START mid-swing begins no wait; the wait comes at the bar end', String.raw`
  T.currentMode = "plain"
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 101 T.update()
  T.fire("START_AUTOREPEAT_SPELL")
  check(alpha() == 0.35 and T.stateHas("swing running"), "START before the zone: dim, swing running")
  local n0 = T.alphaCount()
  T.now = 101.5 T.update() check(T.alphaCount() == n0, "no pulse mid-swing")
  T.now = 102.81 T.update()
  check(T.running() and alpha() == 0.65 and T.stateHas("waiting"), "Auto Shot now on: waits at the bar end")
  check(#T.errors == 0, "no errors")
`);

scenario('melee and off-hand PLAYER_SWING never end a wait', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.now = 102.9 T.fire("PLAYER_SWING", 2.0, 0) T.fire("PLAYER_SWING", 1.5, 1)
  check(T.running() and alpha() == 0.65 and T.stateHas("waiting"), "still waiting after melee swings")
  T.now = 103.3 T.update()
  check(T.standAlpha() < 1, "still pulsing")
  check(#T.errors == 0, "no errors")
`);

scenario('WEAPON_SLOT_CHANGED during a wait (the game bar is already clear, so Blizzard does nothing)', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  local x = T.tex()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.now = 102.9 T.fire("WEAPON_SLOT_CHANGED")
  check(T.running() and alpha() == 0.65 and T.stateHas("waiting"), "the wait goes on")
  check(x.stand.shown, "zone still drawn")
  T.now = 103.3 T.update()
  check(T.standAlpha() < 1, "still pulsing")
  T.now = 103.4 T.fire("PLAYER_SWING", 2.8, 2)
  check(alpha() == 0.35 and T.standAlpha() == 1 and T.stateHas("swing running"), "the shot ends it as usual")
  checkBands("zone after the shot", 200, 2.8, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('hold: in combat (secret weapon speed) a speed or gear event during the wait keeps the zone', String.raw`
  -- UnitAttackSpeed is SecretWhenUnitStatsRestricted, so in combat WeaponSpeed() is nil.
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  local x = T.tex()
  T.now = 100 T.fire("PLAYER_SWING", 2.24, 2)
  T.speed = { mh = secret(2.0), oh = nil, rng = secret(2.8) }
  T.now = 102.25 T.update()
  check(T.stateHas("waiting"), "waiting after the hasted 2.24 s swing")
  checkBands("zone of the 2.24 s swing", 200, 2.24, 0.5, 0)
  T.now = 102.4 T.fire("UNIT_ATTACK_SPEED", "player") -- a haste buff runs out mid-wait
  check(x.stand.shown, "UNIT_ATTACK_SPEED mid-wait: zone still drawn (shown=" .. tostring(x.stand.shown) .. ")")
  checkBands("UNIT_ATTACK_SPEED mid-wait: zone where it was", 200, 2.24, 0.5, 0)
  check(T.debugSays("swing: 2.24 s"), "swing duration kept for the wait (debug: swing: 2.24 s)")
  T.now = 102.5 T.fire("PLAYER_EQUIPMENT_CHANGED", 18, false)
  check(x.stand.shown, "PLAYER_EQUIPMENT_CHANGED mid-wait: zone still drawn")
  T.now = 102.6 T.fire("WEAPON_SLOT_CHANGED")
  check(x.stand.shown, "WEAPON_SLOT_CHANGED mid-wait: zone still drawn")
  check(T.stateHas("waiting"), "the wait itself goes on")
  check(#T.errors == 0, "no errors")
`);

scenario('first-shot wait in combat after an idle speed event still draws the zone', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  local x = T.tex()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.fire("STOP_AUTOREPEAT_SPELL") -- the target died
  T.speed = { mh = secret(2.0), oh = nil, rng = secret(2.8) } -- in combat
  T.now = 103.5 T.fire("UNIT_ATTACK_SPEED", "player")
  T.now = 104 T.fire("START_AUTOREPEAT_SPELL") -- next target
  check(T.stateHas("waiting"), "first-shot wait running")
  check(x.stand.shown, "the lit zone is drawn (shown=" .. tostring(x.stand.shown) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('hold: out of combat a speed event during the wait does not move the zone', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.24, 2) -- hasted swing; the weapon itself is 2.8
  T.now = 102.25 T.update()
  checkBands("zone of the 2.24 s swing", 200, 2.24, 0.5, 0)
  T.now = 102.4 T.fire("UNIT_ATTACK_SPEED", "player")
  checkBands("after UNIT_ATTACK_SPEED mid-wait", 200, 2.24, 0.5, 0)
  check(#T.errors == 0, "no errors")
`);

scenario('options mid-wait: hold off ends it; pulse off restores alpha; pulse on resumes', String.raw`
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  T.slash("")
  local hold, pulse = T.checkbox("Keep the zone lit until the shot fires"), T.checkbox("Pulse while waiting for a late shot")
  check(hold and hold:GetChecked() and pulse and pulse:GetChecked(), "both new checkboxes exist and are on by default")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.now = 103.3 T.update()
  check(T.standAlpha() < 1, "pulsing")
  T.click(pulse)
  check(ShotWindowDB.pulse == false and T.standAlpha() == 1, "pulse off: alpha back to 1 at once (" .. tostring(T.standAlpha()) .. ")")
  local n = T.alphaCount()
  T.now = 103.5 T.update() T.now = 103.7 T.update()
  check(T.alphaCount() == n and T.running() and alpha() == 0.65, "pulse off: still waiting, lit, no alpha changes")
  T.click(pulse)
  T.now = 103.9 T.update()
  check(ShotWindowDB.pulse == true and T.standAlpha() < 1, "pulse on again: pulsing resumes (" .. tostring(T.standAlpha()) .. ")")
  local beforeDrag = T.alphaCount()
  T.drag(T.slider("Extra lead"), 50)
  check(T.alphaCount() == beforeDrag, "a slider change mid-wait does not reset the pulsing alpha (set to: " .. T.alphasSince(beforeDrag) .. ")")
  T.now = 104.1 T.update()
  check(T.alphaCount() == beforeDrag + 1 and T.running(), "and the pulse carries on")
  T.drag(T.slider("Extra lead"), 0)
  T.click(hold)
  check(ShotWindowDB.hold == false, "hold off")
  check(not T.running() and alpha() == 0.35 and T.standAlpha() == 1, "hold off mid-wait: wait ended, dim, alpha 1")
  check(T.stateHas("idle"), "idle (" .. T.state() .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('fill tint shows while lit and while waiting, hides when the shot fires', String.raw`
  ShotWindowDB = { fillTint = true }
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  local fill = T.fillTint()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.0 T.update() check(not fill.shown, "hidden before the zone")
  T.now = 102.5 T.update() check(fill.shown, "shown inside the zone")
  T.now = 102.81 T.update() check(fill.shown, "shown while waiting")
  T.now = 103.3 T.update() check(fill.shown, "shown while pulsing")
  T.now = 103.4 T.fire("PLAYER_SWING", 2.8, 2) check(not fill.shown, "hidden when the shot fires")
  T.now = 105.9 T.update() T.now = 106.21 T.update()
  T.fire("STOP_AUTOREPEAT_SPELL") check(not fill.shown, "hidden when STOP ends the wait")
  T.now = 110 T.fire("START_AUTOREPEAT_SPELL") check(fill.shown, "shown in the first-shot wait")
  check(#T.errors == 0, "no errors")
`);

for (const cls of ['MAGE', 'PRIEST', 'WARLOCK']) {
  scenario('wand user (' + cls + '): attaches, asks about Shoot (5019), holds for the wand shot', String.raw`
    T.className, T.class = "${cls}", "${cls}"
    T.currentMode, T.current[5019], T.current[75] = "plain", true, false
    T.login(200)
    check(SlashCmdList.SHOTWINDOW ~= nil and type(ShotWindowDB) == "table", "slash command and saved variables")
    check(#T.bar.textures >= 3, "textures on the game's bar")
    check(#T.settings.addon == 1, "options page registered")
    check(#T.currentQueries == 1 and T.currentQueries[1] == 5019, "IsCurrentSpell asked about 5019 (got " .. tostring(T.currentQueries[1]) .. ")")
    check(T.stateHas("shot spell 5019, auto-repeat true"), "debug (" .. T.state() .. ")")
    local ev = T.driver.events
    check(ev.PLAYER_SWING == true and ev.START_AUTOREPEAT_SPELL == true and ev.STOP_AUTOREPEAT_SPELL == true, "events registered")
    T.now = 100 T.fire("PLAYER_SWING", 1.5, 2) -- a 1.5 s wand
    checkBands("wand swing", 200, 1.5, 0.5, 0)
    T.now = 101.2 T.update() check(alpha() == 0.65, "bright inside the zone")
    T.now = 101.51 T.update() check(T.running() and alpha() == 0.65, "holds after the bar ends")
    T.fire("STOP_AUTOREPEAT_SPELL") -- casting a spell stops Shoot
    check(not T.running() and alpha() == 0.35, "STOP ends it")
    check(#T.errors == 0, "no errors")
  `);
}

for (const cls of ['ROGUE', 'WARRIOR', 'PALADIN', 'DRUID', 'SHAMAN']) {
  scenario('no auto-repeating ranged attack (' + cls + '): no zone, only the look', String.raw`
    T.className, T.class = "${cls}", "${cls}"
    T.currentMode, T.current[5019], T.current[75] = "plain", true, true
    T.login(200)
    check(SlashCmdList.SHOTWINDOW ~= nil and type(ShotWindowDB) == "table", "slash command and saved variables, for the look")
    check(#T.bar.textures == 0, "nothing drawn")
    check(#T.settings.canvas == 1, "an options page, for the look")
    check(#T.currentQueries == 0, "IsCurrentSpell never asked")
    for e in pairs(T.driver.events) do check(e == "PLAYER_LOGIN", "only PLAYER_LOGIN registered (also " .. e .. ")") end
    T.fire("START_AUTOREPEAT_SPELL") T.fire("PLAYER_SWING", 2.8, 2) T.update()
    check(T.driver.scripts.OnUpdate == nil, "no OnUpdate")
    check(#T.errors == 0, "no errors")
  `);
}

scenario('hunter asks about Auto Shot (75), not Shoot', String.raw`
  T.currentMode, T.current[5019], T.current[75] = "plain", true, false
  T.autoRepMode, T.autoRep[5019], T.autoRep[75] = "plain", true, false
  T.login(200)
  local only75 = #T.currentQueries > 0
  for _, q in ipairs(T.currentQueries) do if q ~= 75 and q ~= "repeat:75" then only75 = false end end
  check(only75, "asked about 75 only")
  check(T.stateHas("shot spell 75, auto-repeat false"), "debug (" .. T.state() .. ")")
`);

scenario('auto-repeat events before the bar exists and while idle raise nothing', String.raw`
  T.currentMode = "plain"
  T.fire("PLAYER_LOGIN")
  T.fire("START_AUTOREPEAT_SPELL") T.update() T.fire("STOP_AUTOREPEAT_SPELL")
  check(#T.errors == 0, "no errors before the bar exists")
  check(not T.running(), "nothing running without the bar")
  T.makeBar(200)
  T.fire("ADDON_LOADED", "Blizzard_SwingTimer")
  T.fire("STOP_AUTOREPEAT_SPELL") T.fire("STOP_AUTOREPEAT_SPELL")
  check(not T.running() and alpha() == 0.35, "STOP while idle: nothing")
  T.fire("START_AUTOREPEAT_SPELL") T.fire("START_AUTOREPEAT_SPELL")
  check(T.running() and alpha() == 0.65, "START twice: one wait")
  check(#T.errors == 0, "no errors")
`);

scenario('options in combat: the window, not the Settings panel; not sticky; the page afterwards', String.raw`
  T.login(200)
  T.combat = true
  T.slash("")
  check(#T.settings.opens == 0 and (T.settings.combatOpens or 0) == 0, "OpenToCategory not called in combat")
  check(not SettingsPanel:IsShown(), "Settings panel untouched")
  local w = T.window()
  check(w and w:IsShown() and T.content() and T.content():IsVisible() and T.content():GetParent() == w, "the window opens with the controls")
  check(T.hideCalls == 0, "no HideUIPanel")
  check(T.hidButtonBar == 1 and w.Inset and #w.Inset.points > 0, "button bar hidden, inset reaches down")
  check(T.blocked == 0, "nothing blocked")
  T.slash("debug")
  check(not T.said("page did not open"), "not recorded as a page failure")
  T.slash("")
  check(not w:IsShown(), "second /shotwindow in combat closes the window")
  T.combat = false
  T.slash("")
  check(#T.settings.opens == 1 and SettingsPanel:IsShown() and T.page():IsVisible(), "out of combat: the page opens")
  check(T.content():GetParent() == T.page() and not w:IsShown(), "controls moved to the page")
  -- page open, then combat: no HideUIPanel try, one hint
  T.combat = true
  local hc = T.hideCalls
  T.slash("")
  check(T.hideCalls == hc, "no HideUIPanel in combat (" .. (T.hideCalls - hc) .. ")")
  check(T.countSaid("Close them there") == 1, "close-there hint")
  check(SettingsPanel:IsShown(), "panel stays")
  T.closePanel()
  T.slash("")
  check(w:IsShown() and T.content():GetParent() == w and #T.settings.opens == 1, "panel closed in combat: window again")
  T.combat = false
  T.escape()
  check(not w:IsShown(), "Esc closes it")
  T.slash("")
  check(#T.settings.opens == 2 and SettingsPanel:IsShown() and T.content():GetParent() == T.page(), "out of combat again: page")
  check(T.blocked == 0, "nothing blocked")
  check(#T.errors == 0, "no errors")
`);

scenario('options: grayed-out controls follow their checkboxes (alpha and mouse)', String.raw`
  T.login(200)
  T.slash("")
  T.strictMouse = true
  checkControls("defaults", {
    ["Thickness"] = "usable", ["Line color"] = "usable", ["Zone color"] = "usable", ["Zone opacity"] = "usable",
    ["Brighten inside the zone"] = "usable", ["Brightened opacity"] = "usable", ["Pulse while waiting for a late shot"] = "usable",
    ["Fill color"] = "grayed", ["Fill opacity"] = "grayed",
    ["Show the red zone"] = "usable", ["Show the marker line"] = "usable", ["Keep the zone lit until the shot fires"] = "usable",
    ["Tint the fill inside the zone"] = "usable", ["Start earlier by my latency"] = "usable", ["Extra lead"] = "usable",
  })
  T.click(T.checkbox("Show the marker line"))
  checkControls("line off", { ["Thickness"] = "grayed", ["Line color"] = "grayed", ["Zone color"] = "usable", ["Show the marker line"] = "usable" })
  T.click(T.checkbox("Show the marker line"))
  checkControls("line on", { ["Thickness"] = "usable", ["Line color"] = "usable" })
  T.click(T.checkbox("Show the red zone"))
  checkControls("band off", { ["Zone color"] = "grayed", ["Zone opacity"] = "grayed", ["Brighten inside the zone"] = "grayed",
    ["Brightened opacity"] = "grayed", ["Pulse while waiting for a late shot"] = "grayed", ["Thickness"] = "usable", ["Show the red zone"] = "usable" })
  T.click(T.checkbox("Show the red zone"))
  checkControls("band on", { ["Zone color"] = "usable", ["Zone opacity"] = "usable", ["Brighten inside the zone"] = "usable",
    ["Brightened opacity"] = "usable", ["Pulse while waiting for a late shot"] = "usable" })
  T.click(T.checkbox("Brighten inside the zone"))
  checkControls("flash off", { ["Brightened opacity"] = "grayed", ["Pulse while waiting for a late shot"] = "usable", ["Zone opacity"] = "usable" })
  T.click(T.checkbox("Brighten inside the zone"))
  T.click(T.checkbox("Keep the zone lit until the shot fires"))
  checkControls("hold off", { ["Pulse while waiting for a late shot"] = "grayed", ["Brightened opacity"] = "usable", ["Keep the zone lit until the shot fires"] = "usable" })
  T.click(T.checkbox("Show the red zone"))
  checkControls("hold off, band off", { ["Pulse while waiting for a late shot"] = "grayed" })
  T.click(T.checkbox("Keep the zone lit until the shot fires"))
  checkControls("hold on, band off", { ["Pulse while waiting for a late shot"] = "grayed" })
  T.click(T.checkbox("Show the red zone"))
  checkControls("hold on, band on", { ["Pulse while waiting for a late shot"] = "usable" })
  T.click(T.checkbox("Tint the fill inside the zone"))
  checkControls("fill tint on", { ["Fill color"] = "usable", ["Fill opacity"] = "usable" })
  T.slash("flash")
  checkControls("/shotwindow flash refreshes", { ["Brightened opacity"] = "grayed" })
  T.click(T.button("Defaults"))
  checkControls("after Defaults", { ["Brightened opacity"] = "usable", ["Fill color"] = "grayed", ["Fill opacity"] = "grayed", ["Pulse while waiting for a late shot"] = "usable" })
  T.closePanel()
  ShotWindowDB.band = false
  T.slash("")
  checkControls("changed while closed, shown on reopen", { ["Zone color"] = "grayed", ["Pulse while waiting for a late shot"] = "grayed" })
  check(#T.errors == 0, "no errors")
`);

scenario('options: labels click too (hit rects), swatches sit under the checkboxes', String.raw`
  T.login(200)
  T.slash("")
  for _, l in ipairs({ "Keep the zone lit until the shot fires", "Pulse while waiting for a late shot", "Show the red zone" }) do
    local cb = T.checkbox(l)
    local hi = cb and rawget(cb, "hitInsets")
    check(hi and hi[1] == 0 and hi[2] == -(#l * 6 + 2) and hi[3] == 0 and hi[4] == 0, "checkbox hit rect covers its label: " .. l)
  end
  local sw = T.swatch("Zone color")
  local hi = sw and rawget(sw, "hitInsets")
  check(hi and hi[2] == -(#"Zone color" * 6 + 6) and hi[3] == -4 and hi[4] == -4, "swatch hit rect covers its label")
  local cb = T.checkbox("Show the red zone")
  check(sw.points[1][2] == cb.points[1][2] + 4 and sw.points[1][3] == cb.points[1][3] - 28 - 4, "swatch 4 px in and down from the checkbox column")
  check(cb.width == 24 and sw.width == 16, "checkbox 24 px, swatch 16 px: the swatch is centered in the checkbox column")
  local function labelX(f) for _, fs in ipairs(f.fontStrings) do local p = fs.points[1] if p and p[1] == "LEFT" and p[2] == f then return p[4] end end end
  check(labelX(cb) and labelX(sw) and cb.points[1][2] + cb.width + labelX(cb) == sw.points[1][2] + sw.width + labelX(sw), "labels start at the same x")
  check(#T.errors == 0, "no errors")
`);

scenario('options: every control fits above the Defaults row (CONTENT_H 532)', String.raw`
  T.login(200)
  T.slash("")
  local c = T.content()
  check(c.height == 532, "content 532 high (" .. tostring(c.height) .. ")")
  local reset = T.button("Defaults")
  local rp = reset.points[1]
  local resetTop = -(c.height - rp[3] - reset.height)
  local lowest, what = 0, nil
  for _, f in ipairs(c.children) do
    local p = f.points[1]
    if f ~= reset and p and p[1] == "TOPLEFT" and type(p[2]) == "number" and type(p[3]) == "number" then
      local bottom = p[3] - (f.height or 0)
      if bottom < lowest then lowest, what = bottom, f end
    end
  end
  check(rp[1] == "BOTTOMLEFT" and lowest > resetTop, "lowest control bottom " .. tostring(lowest) .. " above the Defaults top " .. tostring(resetTop))
  check(#T.errors == 0, "no errors")
`);

scenario('debug shows the shot spell, auto-repeat and state', String.raw`
  T.currentMode = "plain"
  T.autoRepMode = "plain"
  T.login(200)
  check(T.stateHas("shot spell 75, auto-repeat false, idle"), "idle (" .. T.state() .. ")")
  T.fire("START_AUTOREPEAT_SPELL")
  check(T.stateHas("shot spell 75, auto-repeat true, waiting for a late shot"), "first-shot wait (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  check(T.stateHas("shot spell 75, auto-repeat true, swing running"), "swing (" .. T.state() .. ")")
  T.now = 102.81 T.update()
  check(T.stateHas("waiting for a late shot"), "late shot (" .. T.state() .. ")")
  T.fire("STOP_AUTOREPEAT_SPELL")
  check(T.stateHas("auto-repeat false, idle"), "stopped (" .. T.state() .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('IsCurrentSpell false alone does not mark Auto Shot off (a /reload between shots)', String.raw`
  T.currentMode, T.current[75] = "plain", false
  T.login(200)
  check(T.stateHas("auto-repeat nil"), "unknown, not off (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update() check(alpha() == 0.65, "still brightens inside the zone")
  check(#T.errors == 0, "no errors")
`);

scenario('IsAutoRepeatSpell true at login seeds on, even when IsCurrentSpell says no', String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.currentMode, T.current[75] = "plain", false
  T.login(200)
  check(T.stateHas("auto-repeat true"), "on (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  check(T.stateHas("waiting for a late shot"), "holds after the bar ends")
  check(#T.errors == 0, "no errors")
`);

scenario('secret or failing IsAutoRepeatSpell falls back to IsCurrentSpell, never touched', String.raw`
  T.autoRepMode, T.autoRep[75] = "secret", true
  T.currentMode, T.current[75] = "plain", true
  T.login(200)
  check(T.stateHas("auto-repeat true"), "IsCurrentSpell yes counts (" .. T.state() .. ")")
  T.autoRepMode = "error"
  T.current[75] = false
  T.fire("PLAYER_ENTERING_WORLD", false, false)
  check(T.stateHas("auto-repeat nil"), "unknown after an error and a no (" .. T.state() .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('a loading screen that ate STOP: PLAYER_ENTERING_WORLD asks again and ends a wait', String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  check(T.stateHas("waiting for a late shot"), "waiting")
  T.autoRep[75] = false
  T.fire("PLAYER_ENTERING_WORLD", false, false)
  check(T.stateHas("auto-repeat false, idle") and T.standAlpha() == 1 and alpha() == 0.35, "wait ended, dim (" .. T.state() .. ")")
  check(not T.running(), "no OnUpdate left running")
  check(#T.errors == 0, "no errors")
`);

scenario('kiting past the cap: stopping or a retried shot starts the wait again', String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  check(T.stateHas("waiting for a late shot"), "waiting")
  for k = 1, 12 do T.now = 102.81 + k * 0.5 T.fire("UNIT_SPELLCAST_FAILED_QUIET", "player", "guid", 75) T.update() end
  check(T.stateHas("waiting for a late shot"), "still waiting 6 s later thanks to the retries")
  T.now = 114 T.update()
  check(T.stateHas("idle"), "cap 5 s after the last retry")
  T.fire("UNIT_SPELLCAST_FAILED_QUIET", "player", "guid", 2643)
  check(T.stateHas("idle"), "another spell's failure starts nothing")
  T.now = 115 T.fire("PLAYER_STOPPED_MOVING")
  check(T.stateHas("waiting for a late shot") and alpha() == 0.65, "stopping lights the zone for the wind-up")
  T.now = 115.3 T.fire("PLAYER_SWING", 2.8, 2)
  check(T.stateHas("swing running") and T.standAlpha() == 1, "the shot ends it")
  T.now = 116 T.fire("PLAYER_STOPPED_MOVING")
  check(T.stateHas("swing running"), "stopping mid-swing changes nothing")
  check(#T.errors == 0, "no errors")
`);

scenario('out of range: stopping or retries do not start a wait', String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.inRange = false
  T.fire("PLAYER_STOPPED_MOVING")
  T.fire("UNIT_SPELLCAST_FAILED_QUIET", "player", "guid", 75)
  check(T.stateHas("idle"), "idle while out of range")
  T.inRange = nil
  T.fire("PLAYER_STOPPED_MOVING")
  check(T.stateHas("waiting for a late shot"), "unknown range still starts it")
  T.fire("STOP_AUTOREPEAT_SPELL")
  T.fire("PLAYER_STOPPED_MOVING")
  check(T.stateHas("idle"), "nothing while Auto Shot is off")
  check(#T.errors == 0, "no errors")
`);

scenario('secret spell ID in UNIT_SPELLCAST_FAILED_QUIET is skipped', String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.fire("UNIT_SPELLCAST_FAILED_QUIET", "player", "guid", secret(75))
  check(T.stateHas("idle"), "ignored")
  check(#T.errors == 0, "no errors")
`);

scenario('wand user: Shoot (5019) holds and retries like Auto Shot', String.raw`
  T.className, T.class = "Priest", "PRIEST"
  T.autoRepMode, T.autoRep[5019] = "plain", true
  T.login(200)
  check(T.stateHas("shot spell 5019, auto-repeat true"), "Shoot tracked (" .. T.state() .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 1.5, 2)
  T.now = 101.51 T.update()
  check(T.stateHas("waiting for a late shot"), "holds after a wand swing")
  T.fire("UNIT_SPELLCAST_FAILED_QUIET", "player", "guid", 75)
  T.now = 106.6 T.update()
  check(T.stateHas("idle"), "an Auto Shot failure does not extend a wand wait")
  check(#T.errors == 0, "no errors")
`);

// ---------------------------------------------------------------------------------------------
// Window styles (Styles.lua, ShotWindow_Skins.lua)

// Lua helpers shared by the style scenarios.
const STYLE_HELPERS = String.raw`
  local function under(f, root)
    while f do
      if f == root then return true end
      f = rawget(f, "parent")
    end
    return false
  end
  local function checkIn(root, label)
    for _, f in ipairs(T.frames) do
      if f.kind == "CheckButton" and rawget(f, "parent") == root then
        for _, fs in ipairs(f.fontStrings) do if rawget(fs, "text") == label then return f end end
      end
    end
  end
  local function noteOf(c)
    for _, fs in ipairs(c.fontStrings) do
      local t = rawget(fs, "text")
      if t and (t:find("^In use") or t:find("/reload", 1, true)) then return fs end
    end
  end
  local function backdrop(w)
    for _, t in ipairs(w.textures) do if rawget(t, "gradient") then return t end end
  end
  local function skinErrors()
    local list = {}
    for k, v in pairs(NS.report) do if k:find("skin error", 1, true) then list[#list + 1] = k .. ": " .. tostring(v) end end
    return list
  end
`;

// A stand-in for EllesmereUI's facade that records every call per frame.
const EUI_PRE = String.raw`
  EUIDONE = {}
  local function rec(name) return function(f) if f then EUIDONE[f] = (EUIDONE[f] or "") .. name .. "," end end end
  EUI_S = { apiVersion = 3, GetStyle = function() return "eui" end,
    GetAccentColor = function() return 0.1, 0.6, 0.3 end,
    GetPanelColor = function() return 0.05, 0.05, 0.06, 0.9 end,
    OnLooksChanged = function(fn) EUI_LOOKS = fn end }
  for _, n in ipairs({ "Panel", "Inset", "FadeRegions", "FadeNineSlice", "Button", "WhiteButtonLabel", "StateButtonLabel",
    "EditBox", "Checkbox", "Dropdown", "ScrollBar", "Tab", "CloseButton", "PageButton", "SquareIcon", "Font", "White" }) do
    EUI_S[n] = rec(n)
  end
  EUI_S.Shell = function(f) -- like EllesmereUI: the border is a frame of its own, high above the window
    rec("Shell")(f)
    local border = CreateFrame("Frame", nil, f)
    border:SetFrameLevel(6)
    border.euiBorder = true
  end
  EllesmereUI = { RegisterSkin = function(name, fn) EUI_REG, EUI_FN = name, fn end, _DispatchSkinRegistration = function() end }
`;

scenario('styles: Blizzard by default draws nothing; the Look section on the page', STYLE_HELPERS + String.raw`
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(ShotWindowDB.style == "auto" and ShotWindowDB.darkAlpha == 0.92, "style defaults")
  check(NS.Styles.S == nil, "no drawing calls in use")
  check(NS.report.skin == "Blizzard (EllesmereUI is not loaded)", "skin line (" .. tostring(NS.report.skin) .. ")")
  T.slash("")
  local c = T.content()
  local b = T.button("Window style: Automatic")
  check(b ~= nil and b:GetParent() == c, "style button names the style")
  local note = noteOf(c)
  check(note and note.text == "In use: Blizzard (EllesmereUI is not loaded).", "note line (" .. tostring(note and note.text) .. ")")
  local holder = T.slider("Dark background opacity") and T.slider("Dark background opacity").parent
  check(holder ~= nil, "opacity slider")
  check(T.slider("Dark background opacity"):GetValue() == 92 and T.sliderText("Dark background opacity") == "92%", "opacity slider read from db")
  check(T.controlState("Dark background opacity") == "grayed", "opacity grayed for Automatic (" .. T.controlState("Dark background opacity") .. ")")
  -- placed in order: button, note (two lines), slider
  local by, ny, hy = b.points[1][3], note.points[1][3], holder.points[1][3]
  check(ny <= by - 22 and hy <= ny - 24, "button, note and slider do not overlap (" .. by .. ", " .. ny .. ", " .. hy .. ")")
  local cb = T.checkbox("Show the red zone")
  check(#cb.textures == 1 and #b.textures == 3, "controls keep the game's art (" .. #cb.textures .. ", " .. #b.textures .. ")")
  check(T.flatArt == nil, "nothing flat drawn")
  T.fireScript(b, "OnEnter")
  check(T.tooltipHas("Automatic: EllesmereUI's look") and T.tooltipHas("Dark: a flat dark style built in")
    and T.tooltipHas("right-click for the previous one"), "style tooltip")
  T.fireScript(holder, "OnEnter")
  check(T.tooltipHas("Dark background opacity") and T.tooltipHas("Applies to the Dark style only."), "opacity tooltip says Dark only")
  T.fireScript(T.slider("Dark background opacity"), "OnEnter")
  check(T.tooltipHas("Applies to the Dark style only."), "the slider shows the same tooltip")
  T.slash("debug")
  check(T.said("skin: Blizzard (EllesmereUI is not loaded)"), "debug shows the skin line")
  check(#T.errors == 0, "no errors")
`);

scenario('styles: Blizzard to Dark from the Look button draws at once; opacity live; reload prompt when leaving', STYLE_HELPERS + String.raw`
  T.openFails = true
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  T.slash("")
  local w = T.window()
  local shared = T.content()
  check(w and shared:GetParent() == w and #T.contents() == 1, "Blizzard: the shared controls in the window")
  check(not w.swSkinned, "window not drawn on")
  local before = #w.textures
  T.click(T.button("Window style: Automatic"), "RightButton")
  check(ShotWindowDB.style == "dark", "right-click steps back to Dark (" .. tostring(ShotWindowDB.style) .. ")")
  check(NS.report.skin == "Dark", "Dark drawn at once (" .. tostring(NS.report.skin) .. ")")
  check(not (ShotWindowReloadPrompt and ShotWindowReloadPrompt:IsShown()), "no reload prompt from Blizzard to Dark")
  check(#w.textures - before == 11, "window: backdrop, title strip, rule and edges (" .. (#w.textures - before) .. " textures)")
  check(rawget(w.Bg, "alpha") == 0, "template background faded")
  local own = T.content()
  check(own ~= shared and own:GetParent() == w and own:IsVisible() and not shared:IsVisible(), "the open window swapped to its own copy")
  check(#T.contents() == 2, "two builds: the page's and the window's (" .. #T.contents() .. ")")
  local strokes = 0
  for _, t in ipairs(w.CloseButton.textures) do if rawget(t, "rotation") then strokes = strokes + 1 end end
  check(strokes == 2 and rawget(w.CloseButton.textures[1], "alpha") == 0, "close button drawn as an X over faded art")
  check(w.CloseButton:GetFrameLevel() >= 1, "close button raised")
  local cb = T.checkbox("Show the red zone")
  check(cb:GetParent() == own and #cb.textures >= 7, "checkbox drawn (" .. #cb.textures .. " textures)")
  check(cb.checkedTex.vertex and near(cb.checkedTex.vertex[1], 0.5) and near(cb.checkedTex.vertex[3], 1), "check mark in the accent")
  local thumb = T.slider("Zone opacity").thumb
  check(thumb.colorTex and near(thumb.colorTex[1], 0.5) and near(thumb.colorTex[2], 0.82) and rawget(thumb, "alpha") == 1, "slider thumb flat, in the accent")
  check(#T.button("Defaults").textures > 3 and #T.button("Window style: Dark").textures > 3, "buttons drawn")
  local pcb = checkIn(shared, "Show the red zone")
  check(pcb and #pcb.textures == 1, "the shared copy (the Options page's) keeps the game's look")
  check(T.controlState("Dark background opacity") == "usable", "opacity live for Dark (" .. T.controlState("Dark background opacity") .. ")")
  local bg = backdrop(w)
  check(bg and near(bg.gradient[2].a, 0.92) and near(bg.gradient[3].a, 0.92), "backdrop opacity from the settings")
  T.drag(T.slider("Dark background opacity"), 50)
  check(ShotWindowDB.darkAlpha == 0.5 and near(bg.gradient[2].a, 0.5) and near(bg.gradient[3].a, 0.5), "opacity slider applies live")
  T.click(T.button("Window style: Dark"))
  check(ShotWindowDB.style == "auto", "left-click steps on to Automatic (" .. tostring(ShotWindowDB.style) .. ")")
  local p = ShotWindowReloadPrompt
  check(p and p:IsShown() and p.text.text:find("takes a reload", 1, true) ~= nil, "reload prompt when leaving Dark")
  check(NS.report.skin == "Dark, Blizzard after a /reload", "skin line says what a reload brings (" .. tostring(NS.report.skin) .. ")")
  check(noteOf(own) and noteOf(own).text:find("Type /reload", 1, true) ~= nil, "note line says so")
  check(T.controlState("Dark background opacity") == "grayed", "opacity grayed again")
  check(p and backdrop(p) ~= nil, "the prompt is drawn in the style in use")
  T.click(p.reload)
  check(T.reloads == 1, "Reload now reloads")
  T.slash("style dark")
  check(not p:IsShown() and T.said("window style Dark. In use: Dark."), "back to Dark: prompt gone")
  local errs = skinErrors()
  check(#errs == 0, "no skin errors (" .. table.concat(errs, "; ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('styles: Dark from the saved setting is drawn when the world is up; the page keeps the game look', STYLE_HELPERS + String.raw`
  ShotWindowDB = { style = "dark" }
  T.login(200)
  check(NS.Styles.S == nil, "nothing drawn before the world is up")
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.report.skin == "Dark", "Dark (" .. tostring(NS.report.skin) .. ")")
  T.slash("")
  local page, c = T.page(), T.content()
  check(c:GetParent() == page and #T.contents() == 1, "page: the shared controls, no copy")
  check(#T.checkbox("Show the red zone").textures == 1 and #T.button("Defaults").textures == 3, "page controls keep the game's look")
  check(T.controlState("Dark background opacity") == "usable", "opacity live on the page too")
  T.closePanel()
  T.openFails = true
  T.slash("")
  local w = T.window()
  check(w and w:IsShown() and w.swSkinned, "fallback window, drawn on")
  local own = T.content()
  check(own ~= c and own:GetParent() == w and own:IsVisible() and #T.contents() == 2, "the window has its own copy")
  check(#T.checkbox("Show the red zone").textures > 1, "its controls drawn")
  T.click(T.checkbox("Show the red zone"))
  check(ShotWindowDB.band == false, "the window copy works")
  T.drag(T.slider("Thickness"), 4)
  check(ShotWindowDB.lineWidth == 4, "its sliders work")
  T.openPanelManually()
  check(not w:IsShown() and c:GetParent() == page and c:IsVisible(), "the page takes over")
  check(checkIn(c, "Show the red zone"):GetChecked() == false and T.slider("Thickness") ~= nil, "the page shows the change")
  T.slash("")
  check(SettingsPanel:IsShown(), "still on the page")
  local errs = skinErrors()
  check(#errs == 0, "no skin errors (" .. table.concat(errs, "; ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('styles: Defaults returns the style to Automatic and offers the reload', STYLE_HELPERS + String.raw`
  ShotWindowDB = { style = "dark", darkAlpha = 0.4 }
  T.openFails = true
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  T.slash("")
  local bg = backdrop(T.window())
  check(bg and near(bg.gradient[2].a, 0.4), "saved opacity used")
  T.click(T.button("Defaults"))
  check(ShotWindowDB.style == "auto" and ShotWindowDB.darkAlpha == 0.92, "reset")
  check(near(bg.gradient[2].a, 0.92), "opacity back to the default on screen")
  check(ShotWindowReloadPrompt and ShotWindowReloadPrompt:IsShown(), "reload prompt")
  check(T.controlState("Dark background opacity") == "grayed", "opacity grayed")
  check(#T.errors == 0, "no errors")
`);

scenario('styles: /shotwindow style', STYLE_HELPERS + String.raw`
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  T.slash("style blizzard")
  check(ShotWindowDB.style == "blizzard" and T.said("window style Blizzard. In use: Blizzard."), "blizzard")
  T.slash("style Automatic")
  check(ShotWindowDB.style == "auto" and T.said("window style Automatic. In use: Blizzard (EllesmereUI is not loaded)."), "automatic")
  T.slash("style purple")
  check(ShotWindowDB.style == "auto" and T.said("styles: auto, blizzard, dark"), "unknown style refused")
  T.slash("style")
  check(ShotWindowDB.style == "blizzard", "no argument steps to the next")
  T.slash("help")
  check(T.said("/shotwindow style [auto|blizzard|dark]  - the options window's look (now Blizzard)"), "listed in the usage")
  T.slash("style dark")
  check(NS.report.skin == "Dark" and not (ShotWindowReloadPrompt and ShotWindowReloadPrompt:IsShown()), "Dark drawn at once")
  T.slash("style blizzard")
  check(ShotWindowReloadPrompt:IsShown() and T.said("Type /reload to switch to Blizzard."), "leaving Dark asks for a reload")
  check(#T.errors == 0, "no errors")
`);

scenario('styles: EllesmereUI hands over its calls; the window and its copy use them, the page copy does not', STYLE_HELPERS + String.raw`
  T.openFails = true
  T.login(200)
  check(EUI_REG == "ShotWindow" and type(EUI_FN) == "function", "registered with EllesmereUI under the folder name")
  EUI_FN(EUI_S) -- EllesmereUI calls back at login
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.Styles.S == EUI_S, "its calls are the ones in use")
  check(NS.report.skin == "EllesmereUI (eui style)", "skin line (" .. tostring(NS.report.skin) .. ")")
  T.slash("")
  local w = T.window()
  local function did(f, what) return f ~= nil and (EUIDONE[f] or ""):find(what, 1, true) ~= nil end
  check(did(w, "Shell") and did(w.Inset, "Inset") and did(w.CloseButton, "CloseButton"), "window: shell, inset, close button")
  check(did(w.TitleContainer.TitleText, "Font"), "title font")
  local border
  for _, ch in ipairs(w.children) do if rawget(ch, "euiBorder") then border = ch end end
  check(border and w.CloseButton:GetFrameLevel() > border:GetFrameLevel(), "close button above EllesmereUI's border frame")
  local own, shared = T.content(), T.contents()[1]
  check(own ~= shared and own:GetParent() == w, "the window has its own copy")
  check(did(T.checkbox("Show the red zone"), "Checkbox") and did(T.checkbox("Brighten inside the zone"), "Checkbox"), "checkboxes")
  check(did(T.button("Defaults"), "Button") and did(T.button("Defaults"), "WhiteButtonLabel"), "Defaults button")
  check(did(T.button("Window style: Automatic"), "Button"), "style button")
  check(did(T.slider("Zone opacity"), "FadeRegions"), "slider art faded")
  local thumb = T.slider("Zone opacity").thumb
  check(thumb.colorTex and near(thumb.colorTex[1], 0.1) and near(thumb.colorTex[2], 0.6), "thumb in EllesmereUI's accent")
  EUI_S.GetAccentColor = function() return 1, 0, 0 end
  check(type(EUI_LOOKS) == "function", "listens for look changes")
  if EUI_LOOKS then EUI_LOOKS() end
  check(near(thumb.colorTex[1], 1) and near(thumb.colorTex[2], 0), "recolored live")
  local touched = 0
  for f in pairs(EUIDONE) do if under(f, shared) then touched = touched + 1 end end
  check(touched == 0, "nothing on the shared copy (the Options page's) restyled (" .. touched .. ")")
  check(T.controlState("Dark background opacity") == "grayed", "opacity grayed under EllesmereUI")
  T.slash("debug")
  check(T.said("skin: EllesmereUI (eui style)"), "debug shows it")
  local errs = skinErrors()
  check(#errs == 0, "no skin errors (" .. table.concat(errs, "; ") .. ")")
  check(#T.errors == 0, "no errors")
`, EUI_PRE);

scenario('styles: EllesmereUI loaded but switched off for Shot Window: Blizzard, and says why', STYLE_HELPERS + String.raw`
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.Styles.S == nil and next(EUIDONE) == nil, "nothing drawn")
  check(NS.report.skin == "Blizzard (switched off for Shot Window in EllesmereUI's options)", "skin line (" .. tostring(NS.report.skin) .. ")")
  check(NS.Styles.Note() == "In use: Blizzard (switched off for Shot Window in EllesmereUI's options).", "the note gives the reason (" .. tostring(NS.Styles.Note()) .. ")")
  check(#T.errors == 0, "no errors")
`, EUI_PRE);

scenario('styles: Blizzard chosen while EllesmereUI runs draws nothing', STYLE_HELPERS + String.raw`
  ShotWindowDB = { style = "blizzard" }
  T.openFails = true
  T.login(200)
  EUI_FN(EUI_S)
  T.fire("PLAYER_ENTERING_WORLD")
  T.slash("")
  check(NS.Styles.S == nil and next(EUIDONE) == nil, "nothing drawn")
  check(#T.contents() == 1 and T.content():GetParent() == T.window(), "the window shows the shared controls")
  check(NS.report.skin == "Blizzard (chosen in the options)", "skin line (" .. tostring(NS.report.skin) .. ")")
  T.slash("style auto")
  check(NS.report.skin == "EllesmereUI (eui style)" and not (ShotWindowReloadPrompt and ShotWindowReloadPrompt:IsShown()), "Automatic draws EllesmereUI's look at once")
  check((EUIDONE[T.window()] or ""):find("Shell", 1, true) ~= nil and T.content() ~= T.contents()[1], "the open window swaps to a restyled copy")
  check(#T.errors == 0, "no errors")
`, EUI_PRE);

// ---------------------------------------------------------------------------------------------
// The swing timer bars in the window styles

const BAR_HELPERS = String.raw`
  -- What a style left on a bar: the track, the edge, and the flat fill.
  local function flatParts(bar)
    local out = { edges = 0 }
    for _, t in ipairs(bar.textures) do
      if t.layer == "BACKGROUND" and t.sublevel == -8 then out.track = t
      elseif t.layer == "BACKGROUND" and t.sublevel == 7 then out.edges = out.edges + 1
      elseif t.layer == "ARTWORK" and t.sublevel == 1 then out.fill = t end
    end
    return out
  end
  local function emptied(art) return rawget(art, "color") and art.color[4] == 0 end
  local function untouched(frame, bar)
    return rawget(frame.Background, "color") == false and rawget(frame.Border, "color") == false
      and rawget(bar.Pip, "alpha") == nil and flatParts(bar).track == nil and flatParts(bar).fill == nil
  end
  local function rgbNear(c, r, g, b) return type(c) == "table" and near(c[1], r) and near(c[2], g) and near(c[3], b) end
`;

scenario('swing bars: Blizzard leaves them exactly as the game draws them', BAR_HELPERS + String.raw`
  local mainFrame, mainBar = T.makeSwing("SwingTimerMainHandFrame", 200)
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  local ranged = SwingTimerRangedFrame
  check(untouched(ranged, T.bar), "ranged bar: art, pip, nothing of ours but the zone")
  check(untouched(mainFrame, mainBar) and #mainBar.textures == 0, "main hand bar untouched")
  check(#T.bar.textures == 4, "only the red zone, its line and the tint on the ranged bar, beside its own fill (" .. #T.bar.textures .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('swing bars: Dark gives every swing bar the flat look and keeps the red zone on top', BAR_HELPERS + String.raw`
  local mainFrame, mainBar = T.makeSwing("SwingTimerMainHandFrame", 200)
  local offFrame, offBar = T.makeSwing("SwingTimerOffHandFrame", 200)
  ShotWindowDB = { style = "dark" }
  T.login(200)
  local ranged = SwingTimerRangedFrame
  check(untouched(ranged, T.bar), "nothing drawn before the world is up")
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.report.skin == "Dark", "Dark (" .. tostring(NS.report.skin) .. ")")
  for _, pair in ipairs({ { ranged, T.bar, "ranged" }, { mainFrame, mainBar, "main hand" }, { offFrame, offBar, "off hand" } }) do
    local frame, bar, what = pair[1], pair[2], pair[3]
    local parts = flatParts(bar)
    check(emptied(frame.Background) and emptied(frame.Border), what .. ": Blizzard's background and border art emptied in place")
    check(frame.Background.shown and frame.Border.shown and #frame.Background.points == 0, what .. ": never hidden or moved")
    check(rawget(bar.Pip, "alpha") == 0, what .. ": the pip faded")
    check(parts.track and parts.track.allPoints == bar and parts.track.color[4] == 0.85, what .. ": a dark track over the bar")
    check(parts.edges == 4, what .. ": a thin edge round it (" .. parts.edges .. " lines)")
    check(parts.fill and parts.fill.allPoints == bar:GetStatusBarTexture() and rgbNear(parts.fill.color, 0.5, 0.82, 1)
      and parts.fill.color[4] == 1, what .. ": a flat fill in the accent, following Blizzard's fill")
  end
  local x = T.tex()
  check(x.stand.sublevel == 6 and x.line.sublevel == 7 and T.fillTint().sublevel == 5 and flatParts(T.bar).fill.sublevel == 1,
    "the red zone, its line and the tint stay above the flat fill")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  checkSpan("red zone on the flat bar", x.stand, ${RED_X}, 200)
  checkLine("red line on the flat bar", x.line, ${RED_X})
  T.now = 102.4 T.update()
  check(alpha() == 0.65, "and it still brightens inside the zone")
  -- Blizzard sets the background and border alpha itself when the target goes out of range or back.
  ranged.Background:SetAlpha(1) ranged.Border:SetAlpha(0.4)
  check(emptied(ranged.Background) and emptied(ranged.Border), "a range change cannot bring the art back")
  local before = #T.bar.textures
  T.fire("PLAYER_ENTERING_WORLD")
  check(#T.bar.textures == before, "drawn once, not again on the next loading screen")
  local errs = {}
  for k, v in pairs(NS.report) do if k:find("skin error", 1, true) then errs[#errs + 1] = k .. ": " .. tostring(v) end end
  check(#errs == 0, "no skin errors (" .. table.concat(errs, "; ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('swing bars: Blizzard to Dark live draws them at once', BAR_HELPERS + String.raw`
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(untouched(SwingTimerRangedFrame, T.bar), "Blizzard first")
  T.slash("style dark")
  check(emptied(SwingTimerRangedFrame.Background) and flatParts(T.bar).fill ~= nil, "Dark drawn on the bar at once")
  check(#T.errors == 0, "no errors")
`);

scenario('swing bars: a bar that loads after login is drawn flat when Shot Window attaches to it', BAR_HELPERS + String.raw`
  ShotWindowDB = { style = "dark" }
  T.fire("PLAYER_LOGIN") -- no swing timer frame yet
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.report.skin == "Dark", "Dark")
  T.makeBar(200)
  T.fire("ADDON_LOADED", "Blizzard_SwingTimer")
  check(emptied(SwingTimerRangedFrame.Background) and flatParts(T.bar).fill ~= nil and #T.bar.textures >= 3, "flat once attached")
  check(#T.errors == 0, "no errors")
`);

scenario('swing bars: EllesmereUI flattens them in its accent and recolors them live', BAR_HELPERS + String.raw`
  T.login(200)
  EUI_FN(EUI_S)
  T.fire("PLAYER_ENTERING_WORLD")
  local parts = flatParts(T.bar)
  check(emptied(SwingTimerRangedFrame.Background) and parts.fill and rgbNear(parts.fill.color, 0.1, 0.6, 0.3), "flat, in EllesmereUI's accent")
  check(parts.track and near(parts.track.color[1], 0.05), "track in its panel color")
  check((EUIDONE[T.bar.TypeLabel] or ""):find("Font", 1, true) ~= nil and (EUIDONE[T.bar.TimeLabel] or ""):find("Font", 1, true) ~= nil,
    "the bar's labels in its font")
  EUI_S.GetAccentColor = function() return 1, 0, 0 end
  if EUI_LOOKS then EUI_LOOKS() end
  check(rgbNear(parts.fill.color, 1, 0, 0), "recolored when its accent changes")
  check(#T.errors == 0, "no errors")
`, EUI_PRE);

scenario('swing bars: a warrior gets the flat bars under EllesmereUI, and no zone', BAR_HELPERS + String.raw`
  T.className, T.class = "Warrior", "WARRIOR"
  local mainFrame, mainBar = T.makeSwing("SwingTimerMainHandFrame", 200)
  T.login(200)
  EUI_FN(EUI_S)
  T.fire("PLAYER_ENTERING_WORLD")
  for _, pair in ipairs({ { mainFrame, mainBar, "main hand" }, { SwingTimerRangedFrame, T.bar, "ranged" } }) do
    local parts = flatParts(pair[2])
    check(emptied(pair[1].Background) and parts.track and parts.edges == 4 and parts.fill and rgbNear(parts.fill.color, 0.1, 0.6, 0.3),
      pair[3] .. ": flat, in EllesmereUI's accent")
  end
  local zone = 0
  for _, t in ipairs(T.bar.textures) do if t.layer == "ARTWORK" and t.sublevel >= 5 then zone = zone + 1 end end
  check(zone == 0, "no red zone, line or tint (" .. zone .. ")")
  for e in pairs(T.driver.events) do check(e == "PLAYER_LOGIN", "only PLAYER_LOGIN registered (also " .. e .. ")") end
  T.now = 100 T.fire("PLAYER_SWING", 2.0, 0) T.update()
  check(T.driver.scripts.OnUpdate == nil, "no clock running")
  check(#T.errors == 0, "no errors")
`, EUI_PRE);

scenario('swing bars: a druid in Dark, the swing timer loading after login, gets flat bars when it arrives', BAR_HELPERS + String.raw`
  T.className, T.class = "Druid", "DRUID"
  ShotWindowDB = { style = "dark" }
  T.fire("PLAYER_LOGIN") -- no swing timer frames yet
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.report.skin == "Dark" and T.driver.events.ADDON_LOADED == true, "Dark, waiting for the swing timer")
  local mainFrame, mainBar = T.makeSwing("SwingTimerMainHandFrame", 200)
  T.makeBar(200)
  T.fire("ADDON_LOADED", "Blizzard_SwingTimer")
  check(emptied(mainFrame.Background) and flatParts(mainBar).fill ~= nil and flatParts(T.bar).fill ~= nil, "both bars flat once it loads")
  check(T.driver.events.ADDON_LOADED == nil, "stops listening")
  local zone = 0
  for _, t in ipairs(T.bar.textures) do if t.layer == "ARTWORK" and t.sublevel >= 5 then zone = zone + 1 end end
  check(zone == 0, "and nothing of the zone")
  check(#T.errors == 0, "no errors")
`);

console.log(`\n${passed} passed, ${failed} failed, ${checks} checks`);
process.exit(failed ? 1 : 0);
