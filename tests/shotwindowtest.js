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
// T.drag, T.pickColor, T.pickerOkay, T.pickerCancel, T.escape and T.hover stand in for the player
// (a disabled button takes no click, and no OnEnter unless its motion scripts run while disabled).
//
// The options' tabs and preview box: PanelTabButtonTemplate and InsetFrameTemplate follow
// Blizzard_SharedXML/Mainline/SharedUIPanelTemplates.xml (the tab joins its parent's Tabs list,
// lifts its frame level by 4 and resizes itself from the parent's min/maxTabWidth when shown), and
// PanelTemplates_SetTab / UpdateTabs / SelectTab / DeselectTab / TabResize follow
// SharedUIPanelTemplates.lua. A new frame sits one level above its parent. hooksecurefunc and
// GetAppropriateTooltip are there as in the client. T.preview() is the options' preview (its
// renderer, its mock game bar, its words), T.previewBox() the box round it, and T.unknownBut(list)
// lists widget fields read that the stubs do not have.
//
//   node tests/shotwindowtest.js [--verbose]
//   SHOTWINDOW_LUA=<path> node tests/shotwindowtest.js   (check another copy of the file)
//   DISPLAYS_LUA=<path> node tests/shotwindowtest.js     (another copy of Displays.lua)
//   SKINS_LUA=<path> node tests/shotwindowtest.js        (another copy of ShotWindow_Skins.lua)
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
// Displays (Displays.lua): frame:CreateLine gives Line regions that record their two points and
// thickness (T.noLines takes CreateLine away, so the square fallback runs), PlaySound records each
// call in T.sounds, IsPlayerMoving answers T.moving, and every renderer made is listed in
// T.renderers so a scenario can look a design's regions up by key (T.rend, T.part, T.rect).
// T.dragFrame drags a frame that takes the mouse and is registered for dragging.
//
// Blizzard art on the round designs: C_Texture.GetAtlasInfo answers the swing timer's atlases
// (file 8344036, texcoords from the 2x atlas members; T.atlasMode "missing", "nil" or "error" for
// the fallbacks), and a Line records SetTexture, SetTexCoord and SetVertexColor and counts its
// SetStartPoint calls (startCalls), so a scenario can tell a strip laid out again from one left be.
//
// Seamless strips: a texture has SetVertexOffset (each corner's offset recorded, calls counted per
// texture and in T.vertexOffsetCalls), so the round designs draw their curves as textures whose
// corners sit on the circles; T.quadCorners(texture) gives the four corners in the frame's units.
// T.noVertexOffset (set before login) takes SetVertexOffset away, and the scenarios written for
// the Line strips set it, so the Line fallback stays covered. SetSnapToPixelGrid and
// SetTexelSnappingBias record their value and count their calls (T.noPixelSnap takes them away).
//
// Secrets: secret(v) hands out a stand-in that the trap below holds to the client's rules, but only
// for code loaded from ShotWindow.lua and Displays.lua (stub and test code stand in for the client
// and may touch secrets). Following https://warcraft.wiki.gg/wiki/Secret_Values, tainted code may NOT compare a
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
// SKINS_LUA=<file> does the same for ShotWindow_Skins.lua.
const SKINS_SRC = fs.readFileSync(process.env.SKINS_LUA || path.join(ROOT, 'ShotWindow_Skins.lua'), 'utf8');
// DISPLAYS_LUA=<file> does the same for Displays.lua.
const DISPLAYS_SRC = fs.readFileSync(process.env.DISPLAYS_LUA || path.join(ROOT, 'Displays.lua'), 'utf8');

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

// The files held to the client's rules: the clock and the displays that read it.
const TRAPPED = new Set([ADDON_SOURCE, '@Displays.lua']);
function addonWhere(state) {
  for (let ci = state && state.ci; ci; ci = ci.previous) {
    const f = ci.func && ci.func.value;
    if (f && f.p) {
      const src = to_jsstring(f.p.source.getstr());
      if (!TRAPPED.has(src)) return null;
      return src.slice(1) + ':' + (f.p.lineinfo[ci.l_savedpc - 1] || '?');
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
    if (f && f.p && TRAPPED.has(to_jsstring(f.p.source.getstr()))) return true;
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
-- C_Texture.GetAtlasInfo (TextureUtilsDocumentation.lua: AtlasInfo, MayReturnNothing): the swing
-- timer's atlases as Forever has them, all in file 8344036 (512x256, atlas 4237), placed after the
-- 2x members in UiTextureAtlasMember. T.atlasMode picks how the client answers: "plain" (the
-- default) gives the AtlasInfo; "filename" gives it with the file as info.filename; "missing" leaves
-- the function out; "nil" answers nothing; "error" raises. Displays.lua looks the atlases up once a
-- session, so set the mode before login. Every
-- query is listed in T.atlasQueries; T.atlasCoords(name) gives the member's l, r, t, b texcoords.
T.atlasFile, T.atlasMode, T.atlasQueries = 8344036, "plain", {}
T.atlasRects = { -- left, top, right, bottom, in pixels of the 512x256 file
  ["ui-swingtimerbar-frame"] = { 1, 1, 427, 31 },
  ["ui-swingtimerbar-background"] = { 1, 33, 423, 59 },
  ["ui-swingtimerbar-filling-ranged"] = { 1, 109, 419, 131 },
  ["ui-swingtimerbar-pip"] = { 1, 156, 11, 210 },
}
function T.atlasCoords(name)
  local p = T.atlasRects[name]
  return p[1] / 512, p[3] / 512, p[2] / 256, p[4] / 256
end
local function getAtlasInfo(name)
  T.atlasQueries[#T.atlasQueries + 1] = name
  if T.atlasMode == "error" then error("GetAtlasInfo: test failure") end
  if T.atlasMode == "nil" then return nil end
  local p = T.atlasRects[name]
  if not p then return nil end
  local l, r, t, b = T.atlasCoords(name)
  local info = { elementName = name, width = (p[3] - p[1]) / 2, height = (p[4] - p[2]) / 2,
    rawSize = { x = p[3] - p[1], y = p[4] - p[2] },
    leftTexCoord = l, rightTexCoord = r, topTexCoord = t, bottomTexCoord = b,
    tilesHorizontally = false, tilesVertically = false, file = T.atlasFile }
  -- "filename": the file named the way Blizzard's NineSlice also reads it (info.filename), no file.
  if T.atlasMode == "filename" then info.file, info.filename = nil, T.atlasFile end
  return info
end
C_Texture = setmetatable({}, { __index = function(_, k)
  if k == "GetAtlasInfo" and T.atlasMode ~= "missing" then return getAtlasInfo end
end })
-- In combat (T.combat) the client refuses to open its options panel for an addon.
T.combat = false
function InCombatLockdown() return T.combat == true end
-- IsPlayerMoving answers T.moving (read at login); PLAYER_STARTED/STOPPED_MOVING are fired by tests.
T.moving = false
function IsPlayerMoving() return T.moving == true end
-- PlaySound(soundKitID, channel) records every call; SOUNDKIT has the ids of the kits the addon names.
T.sounds = {}
SOUNDKIT = { IG_MAINMENU_OPTION_CHECKBOX_ON = 856, MAP_PING = 3175, READY_CHECK = 8960, RAID_WARNING = 8959,
  IG_CHARACTER_INFO_TAB = 841 }
SWING_TIMER_RANGED = "Ranged" -- the game's name for the ranged swing bar (GlobalStrings)
function PlaySound(id, channel)
  if realType(id) ~= "number" then error("PlaySound: bad argument #1 (number expected)", 2) end
  T.sounds[#T.sounds + 1] = { id = id, channel = channel }
  return true, #T.sounds
end
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
-- Font strings the addon makes on the swing bar itself (the late-shot readout).
function Label:SetPoint(...) local pts = rawget(self, "points") or {} pts[#pts + 1] = { ... } rawset(self, "points", pts) end
function Label:SetText(t) rawset(self, "text", t) end
function Label:GetText() return rawget(self, "text") end
function Label:Show() rawset(self, "shown", true) end
function Label:Hide() rawset(self, "shown", false) end
function Label:IsShown() return rawget(self, "shown") == true end
function Frame:CreateFontString(name, layer, template)
  local fs = setmetatable({ layer = layer or false, template = template or false, shown = true }, LabelMeta)
  local list = rawget(self, "fontStrings") or {}
  list[#list + 1] = fs
  rawset(self, "fontStrings", list)
  return fs
end
function T.lateLabel() local list = rawget(T.bar, "fontStrings") return list and list[1] end
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
  UIPanelCloseButton = true, PanelTabButtonTemplate = true, InsetFrameTemplate = true }
T.fonts = { GameFontNormal = true, GameFontNormalLarge = true, GameFontNormalSmall = true,
  GameFontHighlight = true, GameFontHighlightSmall = true, GameFontDisableSmall = true,
  GameFontNormalHuge = true, GameFontHighlightLarge = true }
-- Font objects the displays take a font file from (FontInstance:GetFont: file, height, flags).
GameFontNormalHuge = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 20, "" end }
GameFontHighlightLarge = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 16, "" end }
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
      if k == "CreateLine" and T.noLines then return nil end -- a client without Line regions
      if k == "SetVertexOffset" and T.noVertexOffset then return nil end -- nor vertex offsets
      if (k == "SetSnapToPixelGrid" or k == "SetTexelSnappingBias") and T.noPixelSnap then return nil end -- nor pixel snapping
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
  self.textureCalls = (rawget(self, "textureCalls") or 0) + 1
  if realType(file) == "string" and file:lower():find("interface\\buttons", 1, true) then
    if file:lower():find("white8x8", 1, true) then T.flatArt = (T.flatArt or 0) + 1
    else T.buttonArt[#T.buttonArt + 1] = file end
  end
end
function TX:SetAtlas(atlas) self.atlas = atlas end
-- Texture:SetVertexOffset(vertexIndex, offsetX, offsetY) moves one corner of the texture's box:
-- 1 upper left, 2 lower left, 3 upper right, 4 lower right (UPPER_LEFT_VERTEX .. LOWER_RIGHT_VERTEX),
-- x right and y up. Each corner's offset is kept in vertexOffsets[index] = { x, y }; calls are
-- counted per texture (vertexOffsetCalls) and in all (T.vertexOffsetCalls). T.noVertexOffset takes
-- the method away (set it before the renderer is made), so the Line fallback runs.
function TX:SetVertexOffset(index, x, y)
  if realType(index) ~= "number" or not (index == 1 or index == 2 or index == 3 or index == 4) then
    error("Texture:SetVertexOffset(): vertex index 1 to 4 expected, got " .. tostring(index), 2)
  end
  if realType(x) ~= "number" or realType(y) ~= "number" or x ~= x or y ~= y then
    error("Texture:SetVertexOffset(): bad offset (numbers expected): " .. tostring(x) .. ", " .. tostring(y), 2)
  end
  local off = rawget(self, "vertexOffsets")
  if not off then off = {} rawset(self, "vertexOffsets", off) end
  off[index] = { x, y }
  self.vertexOffsetCalls = (rawget(self, "vertexOffsetCalls") or 0) + 1
  T.vertexOffsetCalls = (T.vertexOffsetCalls or 0) + 1
end
-- TextureBase:SetSnapToPixelGrid(snap) and SetTexelSnappingBias(bias): the value is kept
-- (snapToPixelGrid, texelBias), calls are counted per texture (snapCalls, texelBiasCalls) and in all
-- (T.snapCalls, T.texelBiasCalls), and snapAt / texelAt keep the texture's vertexOffsetCalls at its
-- first call, so a scenario can tell snapping was turned off before the corners were first moved.
-- T.noPixelSnap takes both methods away (a client without them).
function TX:SetSnapToPixelGrid(snap)
  if realType(snap) ~= "boolean" then error("TextureBase:SetSnapToPixelGrid(): boolean expected, got " .. tostring(snap), 2) end
  if rawget(self, "snapAt") == nil then self.snapAt = rawget(self, "vertexOffsetCalls") or 0 end
  self.snapToPixelGrid = snap
  self.snapCalls = (rawget(self, "snapCalls") or 0) + 1
  T.snapCalls = (T.snapCalls or 0) + 1
end
function TX:SetTexelSnappingBias(bias)
  if realType(bias) ~= "number" or bias ~= bias then error("TextureBase:SetTexelSnappingBias(): number expected, got " .. tostring(bias), 2) end
  if rawget(self, "texelAt") == nil then self.texelAt = rawget(self, "vertexOffsetCalls") or 0 end
  self.texelBias = bias
  self.texelBiasCalls = (rawget(self, "texelBiasCalls") or 0) + 1
  T.texelBiasCalls = (T.texelBiasCalls or 0) + 1
end
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
function FS:SetSpacing(px) self.spacing = px end
function FS:IsTruncated() return false end

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
-- A button's text is its font string's (a template's ButtonText, or one given with SetFontString).
function B:SetText(t)
  self.text = t ~= nil and tostring(t) or nil
  local fs = rawget(self, "fs")
  if fs then fs:SetText(self.text) end
end
function B:GetText() return rawget(self, "text") end
function B:RegisterForClicks(...) self.clicks = { ... } end
function B:SetID(id) self.id = id end
function B:GetID() return rawget(self, "id") or 0 end
-- Enable and Disable send OnEnable / OnDisable when the state changes. A disabled button takes no
-- clicks, and no OnEnter / OnLeave unless its motion scripts run while disabled (T.click, T.hover).
function B:Enable() if rawget(self, "enabled") == false then self.enabled = true fireScript(self, "OnEnable") end end
function B:Disable() if rawget(self, "enabled") ~= false then self.enabled = false fireScript(self, "OnDisable") end end
function B:IsEnabled() return rawget(self, "enabled") ~= false end
function B:SetMotionScriptsWhileDisabled(m) self.motionWhileDisabled = not not m end
function B:GetMotionScriptsWhileDisabled() return rawget(self, "motionWhileDisabled") == true end
function B:LockHighlight() self.highlightLocked = true end
function B:UnlockHighlight() self.highlightLocked = false end
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
  M.Texture.SetTexCoord = function(self, ...) self.texCoord, self.texCoordArgs = { ... }, select("#", ...) end
  M.Texture.GetNumMaskTextures = function() return 0 end
  M.FontString.IsObjectType = function(_, what) return what == "FontString" end
  M.FontString.GetFont = function(self) return "Fonts\\FRIZQT__.TTF", 12, "" end
  M.FontString.SetFont = function(self, path, size, flags) -- a font file set counts as a font
    self.fontFile, self.fontSize, self.fontFlags = path, size, flags
    if not rawget(self, "font") then self.font = path end
    self.fontCalls = (rawget(self, "fontCalls") or 0) + 1
    return true
  end
end

-- Line regions (frame:CreateLine): a texture between two anchor points, of some thickness.
local LN = methods("Line", "Texture")
-- A Line counts how often it is laid out (SetStartPoint), and records the art it wears: SetTexture
-- (file, counted), SetTexCoord (left, right, top, bottom; the 8 number form is the client's too,
-- texCoordArgs says which was used) and SetVertexColor.
function LN:SetStartPoint(point, rel, x, y)
  self.startPoint = { point, rel, x or 0, y or 0 }
  self.startCalls = (rawget(self, "startCalls") or 0) + 1
end
function LN:SetTexture(file)
  self.file = file
  self.textureCalls = (rawget(self, "textureCalls") or 0) + 1
end
function LN:SetTexCoord(...)
  local n = select("#", ...)
  if n ~= 4 and n ~= 8 then error("Line:SetTexCoord(): 4 or 8 numbers expected, got " .. n, 2) end
  for i = 1, n do
    if realType((select(i, ...))) ~= "number" then error("Line:SetTexCoord(): bad argument #" .. i .. " (number expected)", 2) end
  end
  self.texCoord, self.texCoordArgs = { ... }, n
end
function LN:SetVertexColor(r, g, b, a)
  if realType(r) ~= "number" or realType(g) ~= "number" or realType(b) ~= "number" or (a ~= nil and realType(a) ~= "number") then
    error("Line:SetVertexColor(): numbers expected", 2)
  end
  self.vertex = { r, g, b, a or 1 }
end
function LN:SetEndPoint(point, rel, x, y) self.endPoint = { point, rel, x or 0, y or 0 } end
function LN:GetStartPoint() local p = rawget(self, "startPoint") if p then return p[1], p[2], p[3], p[4] end end
function LN:GetEndPoint() local p = rawget(self, "endPoint") if p then return p[1], p[2], p[3], p[4] end end
function LN:SetThickness(t)
  if realType(t) ~= "number" then error("Line:SetThickness(): number expected", 2) end
  self.thickness = t
end
function LN:GetThickness() return rawget(self, "thickness") or 1 end
LN.IsObjectType = function(_, what) return what == "Line" or what == "Texture" end
do
  local function createLine(self, name, layer, inherits, sublevel)
    local l = setmetatable({ parent = self, kind = "Line", layer = layer or "ARTWORK", sublevel = sublevel or 0,
      shown = true, points = {}, width = 0, height = 0 }, metaFor("Line"))
    local list = rawget(self, "lines")
    if not list then list = {} rawset(self, "lines", list) end
    list[#list + 1] = l
    if name then _G[name] = l end
    return l
  end
  -- Where a frame's center is, for frames placed by their CENTER on UIParent or another stub frame.
  local function getCenter(self)
    if self == UIParent then return self.width / 2, self.height / 2 end
    local p = self.points[1]
    if not p or p[1] ~= "CENTER" then return nil end
    local rel = p[2]
    if realType(rel) ~= "table" or not (rel == UIParent or rawget(rel, "ui")) then return nil end
    local rx, ry = getCenter(rel)
    if not rx then return nil end
    local relp, w, h = p[3] or "CENTER", rel.width or 0, rel.height or 0
    if relp == "BOTTOMLEFT" then rx, ry = rx - w / 2, ry - h / 2
    elseif relp == "TOPLEFT" then rx, ry = rx - w / 2, ry + h / 2
    elseif relp ~= "CENTER" then return nil end
    return rx + (p[4] or 0), ry + (p[5] or 0)
  end
  for _, kind in ipairs({ "Frame", "Button", "CheckButton", "Slider", "ColorSelect" }) do
    local t = M[kind]
    t.CreateLine = createLine
    t.GetCenter = getCenter
    t.GetNumRegions = function(self) return #self.textures + #self.fontStrings + #(rawget(self, "lines") or {}) end
    local regions = t.GetRegions
    t.GetRegions = function(self)
      local list = { regions(self) }
      for _, l in ipairs(rawget(self, "lines") or {}) do list[#list + 1] = l end
      return table.unpack(list)
    end
  end
end
function CreateColor(r, g, b, a) return { r = r, g = g, b = b, a = a } end
GameTooltip = { lines = {} }
function GameTooltip:SetOwner(owner) self.owner, self.lines = owner, {} end
function GameTooltip:SetText(text) self.lines = { text } end
function GameTooltip:AddLine(text) self.lines[#self.lines + 1] = text end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() self.shown = false end
function GameTooltip:IsOwned(f) return self.shown == true and self.owner == f end
function GetAppropriateTooltip() return GameTooltip end -- in the game (the glue screens have their own)
-- hooksecurefunc([table,] name, hook): the hook runs after the original, with the same arguments.
function hooksecurefunc(a, b, c)
  local t, name, hook = _G, a, b
  if realType(a) == "table" then t, name, hook = a, b, c end
  local orig = t[name]
  if realType(orig) ~= "function" or realType(hook) ~= "function" then error("hooksecurefunc(): bad arguments", 2) end
  t[name] = function(...)
    local out = table.pack(orig(...))
    hook(...)
    return table.unpack(out, 1, out.n)
  end
end
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
    -- A new frame sits one level above its parent (a template can say otherwise: useParentLevel).
    f.level = (rawget(parent, "level") or 0) + 1
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
-- InsetFrameTemplate (Blizzard_SharedXML/Mainline/SharedUIPanelTemplates.xml:389): useParentLevel,
-- layoutType "InsetFrameTemplate", Bg (BACKGROUND -5, the marble file, all points), and NineSlice,
-- a child frame at the same level (useParentLevel over NineSlicePanelTemplate) whose OnLoad lays out
-- NineSliceLayouts.InsetFrameTemplate: four corners and four edges, BORDER -5.
TEMPLATES.InsetFrameTemplate = function(f)
  local parent = rawget(f, "parent")
  f.level = parent and rawget(parent, "level") or nil
  f.layoutType = "InsetFrameTemplate"
  local bg = f:CreateTexture(nil, "BACKGROUND", nil, -5)
  bg:SetTexture("Interface\\FrameGeneral\\UI-Background-Marble")
  bg:SetAllPoints()
  f.Bg = bg
  local nine = newUI("Frame", nil, f)
  nine.level = rawget(f, "level")
  nine:SetAllPoints()
  for _, piece in ipairs({ { "TopLeftCorner", "UI-Frame-InnerTopLeft" }, { "TopRightCorner", "UI-Frame-InnerTopRight" },
    { "BottomLeftCorner", "UI-Frame-InnerBotLeftCorner" }, { "BottomRightCorner", "UI-Frame-InnerBotRight" },
    { "TopEdge", "_UI-Frame-InnerTopTile" }, { "BottomEdge", "_UI-Frame-InnerBotTile" },
    { "LeftEdge", "!UI-Frame-InnerLeftTile" }, { "RightEdge", "!UI-Frame-InnerRightTile" } }) do
    local t = nine:CreateTexture(nil, "BORDER", nil, -5)
    t:SetAtlas(piece[2])
    nine[piece[1]] = t
  end
  f.NineSlice = nine
end
-- PanelTabButtonTemplate (SharedUIPanelTemplates.xml:932, PanelTabButtonMixin in
-- SharedUIPanelTemplates.lua:249): 10x32, motionScriptsWhileDisabled, parentArray="Tabs" (the tab
-- joins its parent's Tabs list). BACKGROUND: LeftActive, RightActive, MiddleActive, Left, Right,
-- Middle at their atlas sizes (UiTextureAtlasMember, 1.60.1.70009: uiframe-activetab-left 35x42,
-- -right 37x42, uiframe-tab-left 35x36, -right 37x36, the centers tiled between); HIGHLIGHT: the
-- same three at 0.4; Text, the button text (GameFontNormalSmall, CENTER 0, 2). OnLoad lifts the frame
-- level by 4 and registers DISPLAY_SIZE_CHANGED; OnShow, and OnEvent while visible, run
-- PanelTemplates_TabResize with the parent's tabPadding, minTabWidth and maxTabWidth.
-- T.tabTemplateWithout = "<key>" leaves that piece out (a client whose template differs).
TEMPLATES.PanelTabButtonTemplate = function(f)
  f:SetSize(10, 32)
  f:SetMotionScriptsWhileDisabled(true)
  local parent = rawget(f, "parent")
  if parent then
    local list = rawget(parent, "Tabs") or {}
    list[#list + 1] = f
    rawset(parent, "Tabs", list)
  end
  f.TabTextures = {}
  local function piece(key, layer, atlas, w, h, point, rel, relPoint, x)
    if T.tabTemplateWithout == key then return end
    local t = f:CreateTexture(nil, layer)
    t:SetAtlas(atlas)
    t:SetSize(w, h)
    t:SetPoint(point, rel or f, relPoint or point, x or 0, 0)
    if layer == "HIGHLIGHT" then t:SetAlpha(0.4) end
    f[key] = t
    f.TabTextures[#f.TabTextures + 1] = t
  end
  piece("LeftActive", "BACKGROUND", "uiframe-activetab-left", 35, 42, "TOPLEFT", nil, nil, -1)
  piece("RightActive", "BACKGROUND", "uiframe-activetab-right", 37, 42, "TOPRIGHT", nil, nil, 8)
  piece("MiddleActive", "BACKGROUND", "_uiframe-activetab-center", 1, 42, "TOPLEFT", rawget(f, "LeftActive"), "TOPRIGHT")
  piece("Left", "BACKGROUND", "uiframe-tab-left", 35, 36, "TOPLEFT", nil, nil, -3)
  piece("Right", "BACKGROUND", "uiframe-tab-right", 37, 36, "TOPRIGHT", nil, nil, 7)
  piece("Middle", "BACKGROUND", "_uiframe-tab-center", 1, 36, "TOPLEFT", rawget(f, "Left"), "TOPRIGHT")
  piece("LeftHighlight", "HIGHLIGHT", "uiframe-tab-left", 35, 36, "TOPLEFT", rawget(f, "Left"))
  piece("MiddleHighlight", "HIGHLIGHT", "_uiframe-tab-center", 1, 36, "TOPLEFT", rawget(f, "Middle"))
  piece("RightHighlight", "HIGHLIGHT", "uiframe-tab-right", 37, 36, "TOPRIGHT", rawget(f, "Right"))
  if T.tabTemplateWithout ~= "Text" then
    local text = f:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
    text:SetSize(0, 10)
    text:SetPoint("CENTER", f, "CENTER", 0, 2)
    f.Text, f.fs = text, text
  end
  f.font, f.highlightFont, f.disabledFont = "GameFontNormalSmall", "GameFontHighlightSmall", "GameFontHighlightSmall"
  local function resize(self)
    local p = self:GetParent()
    PanelTemplates_TabResize(self, p.tabPadding, nil, p.minTabWidth, p.maxTabWidth)
  end
  f.scripts.OnShow = resize
  f.scripts.OnEvent = function(self) if self:IsVisible() then resize(self) end end
  f.scripts.OnEnter = function(self) -- shows the label when it is cut short
    local tooltip = GetAppropriateTooltip()
    tooltip:Hide()
    if self.Text:IsTruncated() then tooltip:SetOwner(self, "ANCHOR_RIGHT") tooltip:SetText(self.Text:GetText()) tooltip:Show() end
  end
  f.scripts.OnLeave = function() GetAppropriateTooltip():Hide() end
  -- OnLoad
  f:SetFrameLevel(f:GetFrameLevel() + 4)
  f:RegisterEvent("DISPLAY_SIZE_CHANGED")
end
T.tabTemplateWithout = nil

-- PanelTemplates (SharedUIPanelTemplates.lua:435-640). They are part of the client whether or not an
-- addon uses the tab template. A frame's tabs are frame.Tabs[i], or the globals <name>Tab<i>.
local function tabByIndex(frame, index) -- GetTabByIndex
  return frame.Tabs and frame.Tabs[index] or _G[frame:GetName() .. "Tab" .. index]
end
function PanelTemplates_Tab_OnClick(self, frame) PanelTemplates_SetTab(frame, self:GetID()) end
function PanelTemplates_SetTab(frame, id)
  frame.selectedTab = id
  PanelTemplates_UpdateTabs(frame)
end
function PanelTemplates_GetSelectedTab(frame) return frame.selectedTab end
function PanelTemplates_UpdateTabs(frame)
  if frame.selectedTab then
    for i = 1, frame.numTabs, 1 do
      local tab = tabByIndex(frame, i)
      if tab.isDisabled then PanelTemplates_SetDisabledTabState(tab)
      elseif i == frame.selectedTab then PanelTemplates_SelectTab(tab)
      else PanelTemplates_DeselectTab(tab) end
    end
  end
end
local TAB_SIDES_PADDING = 20
function PanelTemplates_TabResize(tab, padding, absoluteSize, minWidth, maxWidth, absoluteTextSize)
  if absoluteTextSize then tab.Text:SetWidth(absoluteTextSize) else tab.Text:SetWidth(0) end
  local textWidth = tab.Text:GetStringWidth()
  local width = textWidth + TAB_SIDES_PADDING + (padding or 0)
  local sideWidths = tab.Left:GetWidth() + tab.Right:GetWidth()
  minWidth = minWidth or sideWidths
  if absoluteSize then
    if absoluteSize < sideWidths then width = sideWidths else width = absoluteSize end
    textWidth = width - TAB_SIDES_PADDING - (padding or 0)
  else
    if maxWidth and width > maxWidth then
      width = maxWidth
      textWidth = width - TAB_SIDES_PADDING - (padding or 0)
    elseif minWidth and width < minWidth then
      width = minWidth
      textWidth = width - TAB_SIDES_PADDING - (padding or 0)
    end
  end
  tab.Text:SetWidth(textWidth)
  tab:SetWidth(width)
  T.tabResizes = (T.tabResizes or 0) + 1
end
function PanelTemplates_DeselectTab(tab)
  tab.Left:Show() tab.Middle:Show() tab.Right:Show()
  tab:Enable()
  local offsetY = tab.deselectedTextY or 2
  if tab.isTopTab then offsetY = -offsetY - 6 end
  tab.Text:SetPoint("CENTER", tab, "CENTER", (tab.deselectedTextX or 0), offsetY)
  tab.LeftActive:Hide() tab.MiddleActive:Hide() tab.RightActive:Hide()
end
function PanelTemplates_SelectTab(tab)
  tab.Left:Hide() tab.Middle:Hide() tab.Right:Hide()
  tab:Disable()
  tab:SetDisabledFontObject(GameFontHighlightSmall)
  local offsetY = tab.selectedTextY or -3
  if tab.isTopTab then offsetY = -offsetY - 7 end
  tab.Text:SetPoint("CENTER", tab, "CENTER", (tab.selectedTextX or 0), offsetY)
  tab.LeftActive:Show() tab.MiddleActive:Show() tab.RightActive:Show()
  local tooltip = GetAppropriateTooltip()
  if tooltip:IsOwned(tab) then tooltip:Hide() end
end
function PanelTemplates_SetDisabledTabState(tab)
  tab.Left:Show() tab.Middle:Show() tab.Right:Show()
  tab:Disable()
  tab:SetDisabledFontObject(GameFontDisableSmall)
  tab.LeftActive:Hide() tab.MiddleActive:Hide() tab.RightActive:Hide()
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
  if (f.kind == "Button" or f.kind == "CheckButton") and not f:IsEnabled() then
    T.fails[#T.fails + 1] = "T.click: the button is disabled, so the click does nothing"
    return
  end
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
-- The mouse moves onto a control and off again: OnEnter, then OnLeave, as the client sends them (a
-- disabled button only when its motion scripts run while disabled). Returns whether OnEnter went.
function T.hover(f)
  if not (f and f:IsVisible()) then return false end
  if (f.kind == "Button" or f.kind == "CheckButton") and not f:IsEnabled() and not f:GetMotionScriptsWhileDisabled() then return false end
  fireScript(f, "OnEnter")
  return true
end
function T.unhover(f) fireScript(f, "OnLeave") end
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
-- The controls sit on pages (Zone, Display, Alerts, Look) inside the content; the content is the root.
function T.contents()
  local list = {}
  for _, f in ipairs(T.frames) do
    if rawget(f, "ui") and hasText(f, "Timing") then
      local root = rawget(f, "parent")
      if root and rawget(root, "pages") then f = root end
      list[#list + 1] = f
    end
  end
  return list
end
function T.pages() local c = T.content() return c and rawget(c, "pages") or {} end
function T.tab(i) local c = T.content() return c and rawget(c, "tabs")[i] end
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
  local where = { c }
  for _, page in ipairs(T.pages()) do where[#where + 1] = page end
  for _, f in ipairs(where) do
    for _, fs in ipairs(f and f.fontStrings or {}) do
      local t = rawget(fs, "text")
      if t and t:find("^Red zone now") then return t end
    end
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

-- The displays (Displays.lua). T.renderers lists every renderer made (filled by a wrapper round
-- NS.NewRenderer, put in place as the files load); a renderer keeps its regions by "design:key".
function T.rend() -- the free display's renderer
  local holder = rawget(_G, "ShotWindowDisplay")
  if not holder then return nil end
  for _, r in ipairs(T.renderers or {}) do if rawget(r.frame, "parent") == holder then return r end end
end
function T.part(r, key) -- the region a design keeps under key: a texture, a font string or a segment
  if not r or not r.design then return nil end
  local name = r.design .. ":" .. key
  local s = r.segs[name]
  return r.tex[name] or r.texts[name] or (s and (s.line or s.tex))
end
function T.isShown(region) return region ~= nil and rawget(region, "shown") == true end
-- A rectangle the displays lay out from the frame's TOPLEFT: x0, x1, y0, y1 (y down), or nil when hidden.
function T.rect(t)
  if not T.isShown(t) then return nil end
  local p = t.points[1]
  if #t.points ~= 1 or p[1] ~= "TOPLEFT" or p[3] ~= "TOPLEFT" then return "bad anchors" end
  return p[4], p[4] + t.width, -p[5], -p[5] + t.height
end
-- A segment's two ends (x right, y up from the frame's BOTTOMLEFT): from a Line, or the square's
-- center and size when there are no Line regions.
function T.segEnds(region)
  if not T.isShown(region) then return nil end
  if rawget(region, "kind") == "Line" then
    local a, b = region.startPoint, region.endPoint
    if not (a and b) or a[1] ~= "BOTTOMLEFT" or b[1] ~= "BOTTOMLEFT" then return "bad anchors" end
    return a[3], a[4], b[3], b[4]
  end
  local p = region.points[1]
  if not p or p[1] ~= "CENTER" or p[3] ~= "BOTTOMLEFT" then return "bad anchors" end
  return p[4], p[5], p[4], p[5], region.width
end
-- A texture whose corners were moved with SetVertexOffset (the seamless strips): its four corners
-- in the frame's units (x right, y up from the frame's BOTTOMLEFT), in the client's order: 1 upper
-- left, 2 lower left, 3 upper right, 4 lower right, each { x, y }. A corner is where the texture's
-- box puts it (one CENTER anchor on its frame's BOTTOMLEFT, and its size) plus that vertex's
-- offset. nil when hidden; a string when the texture is not anchored that way.
function T.quadCorners(t)
  if not T.isShown(t) then return nil end
  local p = t.points[1]
  if #t.points ~= 1 or p[1] ~= "CENTER" or p[3] ~= "BOTTOMLEFT" or p[2] ~= rawget(t, "parent") then return "bad anchors" end
  local hw, hh = (rawget(t, "width") or 0) / 2, (rawget(t, "height") or 0) / 2
  local x, y = p[4] or 0, p[5] or 0
  local box = { { x - hw, y + hh }, { x - hw, y - hh }, { x + hw, y + hh }, { x + hw, y - hh } }
  local off = rawget(t, "vertexOffsets") or {}
  local out = {}
  for i = 1, 4 do
    local o = off[i] or { 0, 0 }
    out[i] = { box[i][1] + o[1], box[i][2] + o[2] }
  end
  return out
end
function T.shownParts(r, design)
  local n = 0
  for _, region in ipairs(r.parts[design or r.design] or {}) do if T.isShown(region) then n = n + 1 end end
  return n
end
-- The preview in the options: one for every tab, across the top of the controls (c.preview, in its
-- box c.previewBox). It keeps the display's renderer (renderer), the mock game bar (bar), the
-- call-out (say), the display's late readout (late) and the display's name (dispName).
function T.preview(c)
  c = c or T.content()
  return c and rawget(c, "preview")
end
function T.previewBox(c)
  c = c or T.content()
  return c and rawget(c, "previewBox")
end
-- Widget fields read that the stubs do not have (T.unknown), except those in allowed: a sorted list.
function T.unknownBut(allowed)
  local ok, out = {}, {}
  for _, k in ipairs(allowed or {}) do ok[k] = true end
  for k, n in pairs(T.unknown) do if not ok[k] then out[#out + 1] = k .. " x" .. n end end
  table.sort(out)
  return out
end
-- The player drags a frame: only one that takes the mouse and is registered for dragging gets it.
function T.dragFrame(f, dx, dy)
  if rawget(f, "mouse") ~= true or not rawget(f, "drag") or not f:IsVisible() then return false end
  local x, y = f:GetCenter()
  fireScript(f, "OnDragStart", "LeftButton")
  if rawget(f, "moving") and x then f.points = { { "CENTER", UIParent, "BOTTOMLEFT", x + dx, y + dy } } end
  fireScript(f, "OnDragStop")
  return true
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
  for (const [src, name] of [[STYLES_SRC, '@Styles.lua'], [DISPLAYS_SRC, '@Displays.lua'], [SKINS_SRC, '@ShotWindow_Skins.lua']]) {
    if (lauxlib.luaL_loadbuffer(S, to_luastring(src), null, to_luastring(name)) !== 0) return lua.lua_tojsstring(S, -1);
    lua.lua_pushstring(S, to_luastring('ShotWindow'));
    lua.lua_getglobal(S, to_luastring('NS'));
    if (lua.lua_pcall(S, 2, 0, 0) !== 0) return name + ': ' + lua.lua_tojsstring(S, -1);
  }
  // Every renderer the displays make is listed, so scenarios can find a design's regions by key.
  return exec(S, 'T.renderers = {} local made = NS.NewRenderer if made then NS.NewRenderer = function(parent) ' +
    'local r = made(parent) T.renderers[#T.renderers + 1] = r return r end end', '=test');
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
  check(T.said("version 0.3.1"), "debug: version")
  check(T.said("bar found: true, showSwingTimer: 1"), "debug: bar and cvar")
  check(T.said("swing: 2.8 s (weapon 2.8 s)"), "debug: swing line")
  check(T.said("red zone: last 0.50 s = window 0.50 s + latency 0 ms + extra 0 ms"), "debug: red zone line")
  local n = #T.prints
  T.slash("garbage words")
  check(#T.prints == n + 8 and T.said("/shotwindow window <seconds>") and T.said("/shotwindow debug"), "garbage shows usage")
  T.slash("help")
  check(#T.prints == n + 16, "help shows usage (" .. (#T.prints - n) .. ")")
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
  local want = math.min(1, 488 / 600, (400 - 10 - 8) / 581) -- the preview takes the title's place
  check(near(c:GetScale(), want), "scaled to fit (" .. tostring(c:GetScale()) .. ", want " .. want .. ")")
  local p = c.points[1]
  check(p and p[1] == "TOPLEFT" and p[2] == page and near(p[4] * want, 6) and near(p[5] * want, -10),
    "placed 6 in and 10 down in the page's units (offsets " .. tostring(p and p[4]) .. ", " .. tostring(p and p[5]) .. " at scale " .. want .. ")")
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

scenario('options: every control on every page fits above the Defaults row (CONTENT_H 581)', String.raw`
  T.login(200)
  T.slash("")
  local c = T.content()
  check(c.height == 581, "content 581 high (" .. tostring(c.height) .. ")")
  local reset = T.button("Defaults")
  local rp = reset.points[1]
  local resetTop = -(c.height - rp[3] - reset.height)
  local lowest, what = 0, nil
  check(#T.pages() == 4, "four pages")
  for _, page in ipairs(T.pages()) do
    local top = page.points[1][3]
    for _, f in ipairs(page.children) do
      local p = f.points[1]
      if p and p[1] == "TOPLEFT" and type(p[2]) == "number" and type(p[3]) == "number" then
        local bottom = top + p[3] - (f.height or 0)
        if bottom < lowest then lowest, what = bottom, f end
      end
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
  local function under(f, root)
    local parent = rawget(f, "parent")
    return parent == root or (parent and rawget(parent, "parent") == root and rawget(root, "pages") ~= nil)
  end
  local function checkIn(root, label)
    for _, f in ipairs(T.frames) do
      if f.kind == "CheckButton" and under(f, root) then
        for _, fs in ipairs(f.fontStrings) do if rawget(fs, "text") == label then return f end end
      end
    end
  end
  local function noteOf(c)
    local where = { c }
    for _, page in ipairs(rawget(c, "pages") or {}) do where[#where + 1] = page end
    for _, f in ipairs(where) do
      for _, fs in ipairs(f.fontStrings) do
        local t = rawget(fs, "text")
        if t and (t:find("^In use") or t:find("/reload", 1, true)) then return fs end
      end
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
  check(b ~= nil and under(b, c), "style button names the style")
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
  check(not T.button("Window style: Automatic"):IsVisible(), "the style button is on the Look tab, not the Zone tab")
  T.click(T.tab(4))
  check(T.tab(4).text == "Look" and T.pages()[4]:IsVisible() and T.button("Window style: Automatic"):IsVisible(), "the Look tab shows it")
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
  check(under(cb, own) and #cb.textures >= 7, "checkbox drawn (" .. #cb.textures .. " textures)")
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

scenario('swing bars: a druid under EllesmereUI, whose look arrives before the settings at login, still gets flat bars', BAR_HELPERS + String.raw`
  -- EllesmereUI's PLAYER_LOGIN handler runs before Shot Window's: its callback comes while the
  -- settings aren't loaded, so the bars must be styled once they are. (A hunter's Attach did that;
  -- a class without Auto Shot or a wand used to be left with Blizzard's bars.)
  T.className, T.class = 'Druid', 'DRUID'
  local mainFrame, mainBar = T.makeSwing('SwingTimerMainHandFrame', 200)
  EUI_FN(EUI_S)
  check(not emptied(mainFrame.Background), 'nothing styled before the settings load')
  T.login(200)
  T.fire('PLAYER_ENTERING_WORLD')
  for _, pair in ipairs({ { mainFrame, mainBar, 'main hand' }, { SwingTimerRangedFrame, T.bar, 'ranged' } }) do
    local parts = flatParts(pair[2])
    check(emptied(pair[1].Background) and parts.track and parts.fill and rgbNear(parts.fill.color, 0.1, 0.6, 0.3), pair[3] .. ': flat, in the EllesmereUI accent')
  end
  check((NS.report['swing bars'] or ''):find('MainHand flat', 1, true) ~= nil, 'debug says the main hand bar is flat: ' .. tostring(NS.report['swing bars']))
  check(#T.errors == 0, 'no errors')
`, EUI_PRE);

scenario('swing bars: Blizzard chosen, EllesmereUI calling back before the settings load, stays Blizzard', BAR_HELPERS + String.raw`
  -- EllesmereUI's callback comes before Shot Window's PLAYER_LOGIN: the saved choice must already count.
  ShotWindowDB = { style = "blizzard" }
  EUI_FN(EUI_S)
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(not emptied(SwingTimerRangedFrame.Background) and flatParts(T.bar).fill == nil, "the game's own bar, not flattened")
  check((NS.report.skin or ""):find("Blizzard (chosen", 1, true) == 1, "skin line says Blizzard was chosen: " .. tostring(NS.report.skin))
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

// ---------------------------------------------------------------------------------------------
// Displays and alerts (Displays.lua): designs drawn on a frame of our own, the call-out, the screen
// edge, the sound, the late readout, and their options.

// Lua helpers shared by the display scenarios.
const DISPLAY_HELPERS = String.raw`
  local SHOT, WHITE = { 1, 0.85, 0.35 }, { 1, 1, 1 }
  local function close(a, b, tol) return type(a) == "number" and type(b) == "number" and math.abs(a - b) <= (tol or 0.01) end
  local function num(v) if type(v) == "number" then return string.format("%.3f", v) end return tostring(v) end
  local function rgbOf(t) return t and rawget(t, "colorTex") end
  local function alphaOf(t) local c = rgbOf(t) return c and c[4] end
  local function sameRGB(c, want)
    return type(c) == "table" and type(want) == "table" and close(c[1], want[1], 1e-6) and close(c[2], want[2], 1e-6)
      and close(c[3], want[3], 1e-6)
  end
  local function rgbStr(c)
    if type(c) ~= "table" then return tostring(c) end
    return string.format("%.2f,%.2f,%.2f", c[1] or c.r or -1, c[2] or c.g or -1, c[3] or c.b or -1)
  end
  local function mid(a, b) if type(a) == "number" and type(b) == "number" then return (a + b) / 2 end end
  local function dist(x, y, cx, cy) if type(x) == "number" and type(y) == "number" then return math.sqrt((x - cx) ^ 2 + (y - cy) ^ 2) end end
  local function pulseAt(age) return 0.6 + 0.4 * math.cos((age - 0.15) * math.pi * 2.5) end
  local function grayOf(text) local b = T.button(text) return b and T.grayState(b) or "missing" end
  local function buttonStarting(prefix) -- a visible button whose label starts with prefix
    for i = #T.frames, 1, -1 do
      local f = T.frames[i]
      local t = rawget(f, "text")
      if f.kind == "Button" and type(t) == "string" and t:sub(1, #prefix) == prefix and f:IsVisible() then return f end
    end
  end
  local function textOn(frame, text)
    for _, fs in ipairs(frame.fontStrings) do if rawget(fs, "text") == text then return fs end end
  end
`;

// The scripted fight every design goes through, in one session: a ranged swing of 2.8 s (the zone
// is the last 0.5 s, no latency), a tick before the zone, one inside it, moving inside it
// (clipping), the bar running out with no shot (the hold), ticks past the 0.15 s grace while still
// moving and after stopping (the pulse), the late shot (the flash and "+0.59"), then ticks.
// Modes: "art" (Blizzard style, Line regions, GetAtlasInfo: the round designs wear the bar's art,
// the states as a flat tint over it), "lines" (the same without GetAtlasInfo: every design flat),
// "squares" (no CreateLine) and "dark" (the Dark style: flat).
const FIGHT = String.raw`
  local mode = FIGHT_MODE
  local ART = mode == "art"
  T.noVertexOffset = true -- the Line strips (the seamless strips have scenarios of their own)
  T.autoRepMode, T.autoRep[75] = "plain", true
  if mode == "lines" then T.atlasMode = "missing" end
  if mode == "squares" then T.noLines = true end
  if mode == "dark" then ShotWindowDB = { style = "dark" } end
  T.login(200)
  if mode == "dark" then T.fire("PLAYER_ENTERING_WORLD") end
  check(mode ~= "dark" or (NS.Styles.Applied() == "dark" and NS.Styles.S ~= nil), "Dark drawn")
  local db = ShotWindowDB
  local accent = mode == "dark" and { NS.Styles.S.GetAccentColor() } or nil
  local moveC = accent or db.moveColor
  check(NS.DISPLAYS[1] == "none" and #NS.DISPLAYS == 12, "twelve choices, none first (" .. #NS.DISPLAYS .. ")")
  local K0 = math.ceil(((db.trackSeconds or 5) / 2) / 2.8) + 2 -- the rhythm track's next shot (k = 0)
  local pipMid = math.floor(((db.pipCount or 11) + 1) / 2)
  -- fill: the region in the fill color (moveFill before the zone, waitFill while holding);
  -- flash: what turns the shot color as the shot fires; chrome: the frame drawn round it.
  local SPEC = {
    classic = { fill = "fill", flash = "spark", chrome = "hbar" },
    pincer = { fill = "left", flash = "shot", chrome = "hbar" },
    vpincer = { fill = "top", flash = "shot", chrome = "vbar" },
    gap = { fill = "fill", waitFill = "dot", flash = "dot", chrome = "hbar" },
    brackets = { fill = "lv", flash = "dot" },
    pips = { fill = "p1", flash = "p" .. pipMid },
    scanner = { fill = "spark", flash = "shot", chrome = "hbar" },
    track = { fill = "z" .. K0, moveFill = "m" .. K0, chrome = "hbar" },
    arc = { fill = "fl1", flash = "shot" },
    ring = { fill = "f1", flash = "shot" },
    reticle = { fill = "c1", flash = "dot" },
  }
  -- In the bar's art: the art fill strips (keys, segments each), and the tint laid over them.
  local ARTSPEC = {
    arc = { fill = { "Afl", "Afr" }, n = 22, tint = { "Atl", "Atr" } },
    ring = { fill = { "Afill" }, n = 40, tint = { "Atint" } },
    reticle = { fill = { "Acirc" }, n = 32, tint = { "Atint" } },
  }
  local function artOf(D) return ART and ARTSPEC[D] or nil end
  -- How many of a strip's segments are shown, and how many wear the atlas file.
  local function stripCount(r, keys, n)
    local shown, art = 0, 0
    for _, k in ipairs(keys) do
      for i = 1, n do
        local s = T.part(r, k .. i)
        if T.isShown(s) then shown = shown + 1 end
        if s and rawget(s, "file") == T.atlasFile then art = art + 1 end
      end
    end
    return shown, art
  end

  local function chromeCheck(D, r, tag)
    local c = r.chrome
    if not c then check(false, tag .. "no frame made round the drawing") return end
    local kind = SPEC[D].chrome
    local shown, black, gold = 0, 0, 0
    for i = 1, 4 do
      local e = c.edges[i]
      if T.isShown(e) then shown = shown + 1 end
      if sameRGB(rgbOf(e), { 0, 0, 0 }) then black = black + 1 end
      if sameRGB(rgbOf(e), { 0.8, 0.65, 0.3 }) then gold = gold + 1 end
    end
    if not kind then
      check(not T.isShown(c.bg) and not T.isShown(c.art) and shown == 0, tag .. "no frame round a round or free-standing design")
    elseif mode == "dark" then
      check(T.isShown(c.bg) and rawget(c.bg, "atlas") == nil and close(alphaOf(c.bg), 0.9) and not T.isShown(c.art),
        tag .. "Dark: a flat panel behind it, no atlas (atlas " .. tostring(rawget(c.bg, "atlas")) .. ")")
      check(shown == 4 and black == 4, tag .. "Dark: a black outline (" .. shown .. " edges shown, " .. black .. " black)")
    elseif kind == "hbar" then
      check(T.isShown(c.bg) and rawget(c.bg, "atlas") == "ui-swingtimerbar-background" and T.isShown(c.art)
        and rawget(c.art, "atlas") == "ui-swingtimerbar-frame", tag .. "Blizzard: the swing timer's own bar art round it")
      check(shown == 0, tag .. "Blizzard: no outline over the art (" .. shown .. ")")
    else -- the vertical pincer under Blizzard: the bar art is horizontal, so a flat track and a gold edge
      check(T.isShown(c.bg) and rawget(c.bg, "atlas") == nil and close(alphaOf(c.bg), 0.7) and not T.isShown(c.art),
        tag .. "Blizzard, standing bar: a flat track, no atlas")
      check(shown == 4 and gold == 4, tag .. "Blizzard, standing bar: a gold edge (" .. shown .. " shown, " .. gold .. " gold)")
    end
  end

  -- Holding for the shot: every design drawn at the shot point.
  local function waitShape(D, r, W, H, fillC, age, when)
    local tag = "[" .. D .. "] " .. when .. ": "
    local function P(k) return T.part(r, k) end
    local as = artOf(D)
    if as then -- the bar's fill art full length, the tint over all of it
      local want = #as.fill * as.n
      local shown, art = stripCount(r, as.fill, as.n)
      check(shown == want and art == want, tag .. "the whole fill shown in the bar's art (" .. shown .. " shown, " .. art .. " with the atlas file, of " .. want .. ")")
      local tinted = stripCount(r, as.tint, as.n)
      check(tinted == #as.tint * as.n, tag .. "the tint over all of it (" .. tinted .. " of " .. #as.tint * as.n .. ")")
      if D == "reticle" then
        local th = math.max(2, db.dispThick / 2)
        local half = math.min(W, H) / 2
        local rim = math.max(0, math.min(th * 30 / 22 * 1.4, half - th - 2 - 12))
        local rmax = half - th - 2 - rim
        local rmin = math.max(4, rmax * 0.12)
        local x1, y1, x2, y2 = T.segEnds(P("Acirc1"))
        local d1, d2 = dist(x1, y1, W / 2, H / 2), dist(x2, y2, W / 2, H / 2)
        check(close(d1, rmin) and close(d2, rmin), tag .. "the circle closed to its smallest inside the rim (radius " .. num(d1) .. ", " .. num(d2) .. ", want " .. num(rmin) .. ")")
        -- Never thicker than 0.8 of its radius, so it stays a ring as it closes.
        local ct = math.min(th * 1.4, rmin * 0.8)
        check(close(rawget(P("Acirc1"), "thickness"), ct, 1e-6), tag .. "circle art thickness " .. num(ct) .. " (" .. num(rawget(P("Acirc1"), "thickness")) .. ")")
      elseif D == "ring" then
        local count = P("count")
        check(T.isShown(count) and rawget(count, "text") == "Late", tag .. "the countdown says Late (" .. tostring(count and rawget(count, "text")) .. ")")
      else
        local label = P("label")
        check(T.isShown(label) and rawget(label, "text") == (when:find("moving", 1, true) and "Moving" or "Late"), tag .. "the label (" .. tostring(label and rawget(label, "text")) .. ")")
      end
      return
    end
    if D == "classic" then
      local x0, x1 = T.rect(P("fill"))
      check(close(x0, 0) and close(x1, W), tag .. "the fill reaches the end (x " .. num(x0) .. " to " .. num(x1) .. ", W " .. W .. ")")
    elseif D == "pincer" then
      local l0, l1 = T.rect(P("left"))
      local r0, r1 = T.rect(P("right"))
      check(close(l0, 0) and close(l1, W / 2), tag .. "the left fill reaches the middle (" .. num(l0) .. " to " .. num(l1) .. ")")
      check(close(r0, W / 2) and close(r1, W), tag .. "the right fill starts at the middle (" .. num(r0) .. " to " .. num(r1) .. ")")
    elseif D == "vpincer" then
      local _, _, t0, t1 = T.rect(P("top"))
      local _, _, b0, b1 = T.rect(P("bottom"))
      check(close(t0, 0) and close(t1, H / 2), tag .. "the top fill reaches the middle (y " .. num(t0) .. " to " .. num(t1) .. ", H " .. H .. ")")
      check(close(b0, H / 2) and close(b1, H), tag .. "the bottom fill starts at the middle (y " .. num(b0) .. " to " .. num(b1) .. ")")
    elseif D == "gap" then
      check(T.rect(P("fill")) == nil, tag .. "the bar has closed (fill hidden)")
      local dot = P("dot")
      check(T.isShown(dot) and close(mid(T.rect(dot)), W / 2), tag .. "a mark where it closed, at the middle")
      check(close(alphaOf(dot), pulseAt(age), 1e-6), tag .. "the mark pulses (alpha " .. num(alphaOf(dot)) .. ", want " .. num(pulseAt(age)) .. ")")
    elseif D == "brackets" then
      local arm = math.max(4, H * 0.3)
      local tip = W / 2 - 1
      local _, lt1 = T.rect(P("lt"))
      local rt0 = T.rect(P("rt"))
      check(close(lt1, W / 2 - 1) and close(rt0, W / 2 + 1), tag .. "the bracket tips meet at the middle (" .. num(lt1) .. " and " .. num(rt0) .. ", W/2 " .. W / 2 .. ")")
      local lv0, lv1 = T.rect(P("lv"))
      check(close(lv0, tip - arm - 3) and close(lv1, tip - arm), tag .. "the left upright stands an arm behind its tip (" .. num(lv0) .. " to " .. num(lv1) .. ")")
      local rv0, rv1 = T.rect(P("rv"))
      check(close(rv0, W - (tip - arm)) and close(rv1, W - (tip - arm) + 3), tag .. "the right upright mirrors it (" .. num(rv0) .. " to " .. num(rv1) .. ")")
    elseif D == "pips" then
      local bad = {}
      for i = 1, db.pipCount do
        if i ~= pipMid then
          local t = P("p" .. i)
          if not (T.rect(t) and sameRGB(rgbOf(t), fillC)) then bad[#bad + 1] = i .. "=" .. rgbStr(rgbOf(t)) end
        end
      end
      check(#bad == 0, tag .. "every side pip lit in the fill color " .. rgbStr(fillC) .. " (not: " .. table.concat(bad, " ") .. ")")
    elseif D == "scanner" then
      local x = mid(T.rect(P("spark")))
      check(close(x, W / 2), tag .. "the spark stops on the shot line (x " .. num(x) .. ", W/2 " .. W / 2 .. ")")
    elseif D == "track" then
      local x = mid(T.rect(P("s" .. K0)))
      check(close(x, W / 2), tag .. "the due shot's tick sits on the now line (x " .. num(x) .. ")")
      check(close(mid(T.rect(P("now"))), W / 2), tag .. "the now line in the middle")
    elseif D == "arc" or D == "ring" then
      local keys, n = D == "arc" and { "fl", "fr" } or { "f" }, D == "arc" and 22 or 40
      local hidden, kinds = 0, 0
      for _, k in ipairs(keys) do
        for i = 1, n do
          local s = P(k .. i)
          if not T.isShown(s) then hidden = hidden + 1 end
          if s and (rawget(s, "kind") == "Line") == (mode ~= "squares") then kinds = kinds + 1 end
        end
      end
      check(hidden == 0, tag .. "every fill segment shown (" .. hidden .. " hidden)")
      check(kinds == #keys * n, tag .. (mode == "squares" and "squares stand in for the segments" or "the segments are Line regions"))
      if D == "ring" then
        local count = P("count")
        check(T.isShown(count) and rawget(count, "text") == "Late", tag .. "the countdown says Late (" .. tostring(count and rawget(count, "text")) .. ")")
      else
        local label = P("label")
        check(T.isShown(label) and rawget(label, "text") == (when:find("moving", 1, true) and "Moving" or "Late"), tag .. "the label (" .. tostring(label and rawget(label, "text")) .. ")")
      end
    elseif D == "reticle" then
      local th = math.max(2, (db.dispThick or 8) / 2)
      local rmax = math.min(W, H) / 2 - th - 2
      local rmin = math.max(4, rmax * 0.12)
      local x1, y1, x2, y2 = T.segEnds(P("c1"))
      if mode == "squares" then
        local d, want = dist(x1, y1, W / 2, H / 2), rmin * math.cos(math.pi / 32)
        check(close(d, want), tag .. "the circle closed to its smallest (square at " .. num(d) .. " from the center, want " .. num(want) .. ")")
      else
        local d1, d2 = dist(x1, y1, W / 2, H / 2), dist(x2, y2, W / 2, H / 2)
        check(close(d1, rmin) and close(d2, rmin), tag .. "the circle closed to its smallest (radius " .. num(d1) .. ", " .. num(d2) .. ", want " .. num(rmin) .. ")")
        local ct = math.min(th, rmin * 0.8) -- never thicker than 0.8 of its radius
        check(close(rawget(P("c1"), "thickness"), ct, 1e-6), tag .. "circle line thickness " .. num(ct) .. " (" .. num(rawget(P("c1"), "thickness")) .. ")")
      end
    end
  end

  local function flashCheck(D, r, W, on, tag)
    local function P(k) return T.part(r, k) end
    if D == "track" then
      if not on then return end
      local tick
      for i = 1, (r.trackMax or 0) do
        local t = P("s" .. i)
        if T.rect(t) and close(mid(T.rect(t)), W / 2, 0.5) then tick = t end
      end
      check(tick ~= nil and sameRGB(rgbOf(tick), SHOT), tag .. "the shot that just fired sits on the now line")
      check(tick ~= nil and close(alphaOf(tick), 1, 1e-6), tag .. "and flashes (alpha " .. num(alphaOf(tick)) .. ", want 1 as the shot fires)")
      return
    end
    local key = SPEC[D].flash
    local t = P(key)
    if on then
      check(T.isShown(t) and sameRGB(rgbOf(t), SHOT), tag .. "the shot flashes: " .. key .. " in the shot color (" .. rgbStr(rgbOf(t)) .. ")")
      if D == "reticle" then check(t and t.width == 8, tag .. "the center dot grows to 8 (" .. tostring(t and t.width) .. ")") end
    elseif D == "gap" then
      check(not T.isShown(t), tag .. "flash over: the mark hidden while the bar is open")
    elseif D == "reticle" then
      check(t and t.width == 4, tag .. "flash over: the center dot back to 4")
    else
      check(T.isShown(t) and sameRGB(rgbOf(t), WHITE), tag .. "flash over: " .. key .. " white again (" .. rgbStr(rgbOf(t)) .. ")")
    end
  end

  local prev
  for index, D in ipairs(NS.DISPLAYS) do
    if D ~= "none" then
      local tag = "[" .. D .. "] "
      local errs = #T.errors
      local base = 100 + index * 20
      T.slash("display " .. D)
      local holder, r = rawget(_G, "ShotWindowDisplay"), T.rend()
      check(holder ~= nil and holder:IsShown() and r ~= nil and r.design == D, tag .. "the display shows this design")
      if r then
        local spec = SPEC[D]
        local function P(k) return T.part(r, k) end
        local W, H = NS.DisplaySize(db, D)
        check(r.w == W and r.h == H and holder.width == W and holder.height == H, tag .. "drawn at " .. W .. "x" .. H)

        T.now = base T.fire("PLAYER_SWING", 2.8, 2)
        T.now = base + 1.0 T.update()
        check(rawget(r.frame, "alpha") == 1, tag .. "visible while Auto Shot is on")
        if prev then check(T.shownParts(r, prev) == 0, tag .. "nothing of " .. prev .. " left shown (" .. T.shownParts(r, prev) .. ")") end
        check(T.shownParts(r) >= 3, tag .. "regions shown (" .. T.shownParts(r) .. ")")
        chromeCheck(D, r, tag)
        local as = artOf(D)
        check(r.mode == (as and "art" or "flat"), tag .. "drawn " .. (as and "in the bar's art" or "flat") .. " (" .. tostring(r.mode) .. ")")
        local f
        if as then
          -- Moving is free: no tint, the art's own fill shows, at the fill's alpha.
          f = P(as.tint[1] .. "1")
          local art = P(as.fill[1] .. "1")
          local v = art and rawget(art, "vertex")
          check(not T.isShown(f), tag .. "before the zone: no tint over the fill")
          check(T.isShown(art) and rawget(art, "file") == T.atlasFile and v and close(v[1], 1, 1e-9) and close(v[2], 1, 1e-9)
            and close(v[3], 1, 1e-9) and close(v[4], 0.95, 1e-9), tag .. "before the zone: the bar's fill art shows, untinted (vertex " .. rgbStr(v) .. " alpha " .. num(v and v[4]) .. ")")
        else
          f = P(spec.moveFill or spec.fill)
          check(T.isShown(f) and sameRGB(rgbOf(f), moveC), tag .. "before the zone: the fill in the move color"
            .. (accent and " (the style's accent)" or "") .. " (" .. rgbStr(rgbOf(f)) .. ", want " .. rgbStr(moveC) .. ")")
        end

        -- The tint is 0.55 of the pulse over the art; a flat fill is the whole color.
        local tintK = as and 0.55 or 1
        T.now = base + 2.4 T.update()
        f = as and P(as.tint[1] .. "1") or P(spec.fill)
        check(T.isShown(f) and sameRGB(rgbOf(f), db.color), tag .. "inside the zone: the fill in the zone color (" .. rgbStr(rgbOf(f)) .. ")")
        if as then check(close(alphaOf(f), 0.55, 1e-9), tag .. "inside the zone: the tint at 0.55 (" .. num(alphaOf(f)) .. ")") end

        T.now = base + 2.5 T.fire("PLAYER_STARTED_MOVING") T.update()
        check(T.isShown(f) and sameRGB(rgbOf(f), db.clipColor), tag .. "moving inside the zone: the fill in the clip color (" .. rgbStr(rgbOf(f)) .. ")")

        local waitAt = base + 2.81
        T.now = waitAt T.update()
        check(T.stateHas("waiting for a late shot"), tag .. "the bar ran out: holding for the shot")
        T.now = base + 3.0 T.update()
        waitShape(D, r, W, H, db.clipColor, T.now - waitAt, "holding, still moving")
        local wf = as and P(as.tint[1] .. "1") or P(spec.waitFill or spec.fill)
        local wantA = (D == "track" and db.activeAlpha or tintK) * pulseAt(T.now - waitAt)
        check(T.isShown(wf) and sameRGB(rgbOf(wf), db.clipColor), tag .. "holding, still moving: the clip color (" .. rgbStr(rgbOf(wf)) .. ")")
        check(close(alphaOf(wf), wantA, 1e-6), tag .. "holding past the grace: pulsing (alpha " .. num(alphaOf(wf)) .. ", want " .. num(wantA) .. ")")
        check(T.shownParts(r) >= 3, tag .. "regions shown while holding (" .. T.shownParts(r) .. ")")

        T.now = base + 3.1 T.fire("PLAYER_STOPPED_MOVING")
        T.now = base + 3.25 T.update()
        waitShape(D, r, W, H, db.color, T.now - waitAt, "holding, standing")
        wantA = (D == "track" and db.activeAlpha or tintK) * pulseAt(T.now - waitAt)
        check(T.isShown(wf) and sameRGB(rgbOf(wf), db.color), tag .. "holding, standing: the zone color (" .. rgbStr(rgbOf(wf)) .. ")")
        check(close(alphaOf(wf), wantA, 1e-6), tag .. "holding, standing: still pulsing (alpha " .. num(alphaOf(wf)) .. ", want " .. num(wantA) .. ")")

        T.now = base + 3.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
        flashCheck(D, r, W, true, tag .. "the late shot: ")
        local lateFS = holder.fontStrings[2]
        check(lateFS:IsShown() and rawget(lateFS, "text") == "+0.59" and sameRGB(lateFS.textColor, db.clipColor),
          tag .. "the late readout under the display (" .. tostring(rawget(lateFS, "text")) .. ")")
        check(not T.lateLabel():IsShown(), tag .. "not on the game's bar while a display shows it")
        T.now = base + 4.0 T.update()
        flashCheck(D, r, W, false, tag .. "0.6 s later: ")
        T.now = base + 4.95 T.update()
        check(not lateFS:IsShown(), tag .. "the late readout gone 1.5 s after the shot")
        check(T.debugSays("display: " .. NS.DISPLAY_NAMES[D] .. ", locked, shown, " .. (mode == "squares" and "squares" or "lines")),
          tag .. "debug: the display line")
        if NS.ROUND_DISPLAYS[D] and mode ~= "squares" then
          local why = ART and "Blizzard art" or (mode == "dark" and "flat (a drawn window style)" or "flat (no atlas info)")
          check(T.debugSays("display: " .. NS.DISPLAY_NAMES[D] .. ", locked, shown, lines, " .. why .. ", line strips"), tag .. "debug: " .. why .. ", line strips")
        end
      end
      check(#T.errors == errs, tag .. "no Lua errors (" .. (#T.errors - errs) .. ")")
      prev = D
    end
  end
  check(#T.errors == 0, "no errors")
`;

for (const [mode, label] of [['art', 'Blizzard style: the round designs in the bar\'s art'], ['lines', 'Line regions, no atlas info: all flat'],
  ['squares', 'no CreateLine: squares stand in'], ['dark', 'Dark style']]) {
  scenario('displays: every design through one fight (' + label + '; Line strips): move, zone, clipping, hold, pulse, late shot', DISPLAY_HELPERS + 'local FIGHT_MODE = "' + mode + '"\n' + FIGHT);
}

scenario('alerts: the call-out says Go, Stop, Moving, Late, nothing idle; the screen edge tints, in the clip color while clipping', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { callout = true, edge = true }
  T.login(200)
  local db = ShotWindowDB
  local co, edge = rawget(_G, "ShotWindowCallout"), rawget(_G, "ShotWindowEdge")
  check(co ~= nil and edge ~= nil, "call-out and edge frames made at login")
  check(rawget(_G, "ShotWindowDisplay") == nil, "no display frame for display none")
  local fs = co.fontStrings[1]
  local function say() return co:IsShown() and rawget(fs, "text") or nil end
  check(co.points[1][1] == "BOTTOM" and co.points[1][2] == SwingTimerRangedFrame and co.points[1][3] == "TOP" and co.points[1][5] == 14, "with no display the call-out sits above the game's bar")
  check(fs.fontFile == "Fonts\\FRIZQT__.TTF" and fs.fontSize == 26 and fs.fontFlags == "OUTLINE", "a big outlined font at the chosen size (" .. tostring(fs.fontFile) .. " " .. tostring(fs.fontSize) .. ")")
  local top = edge.textures[1]
  check(edge.mouse == false and edge.strata == "BACKGROUND" and edge.points[1][1] == "ALL" and edge.points[1][2] == UIParent, "the edge covers the screen behind everything and never takes the mouse")
  T.update()
  check(say() == nil and not edge:IsShown(), "idle: no words, no edge")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 100.2 T.update()
  check(say() == "Go" and sameRGB(fs.textColor, db.moveColor), "just after a shot: Go, in the move color (" .. tostring(say()) .. ")")
  T.now = 101.0 T.update()
  check(say() == nil and not edge:IsShown(), "before the zone: nothing (" .. tostring(say()) .. ")")
  T.now = 102.4 T.update()
  check(say() == "Stop" and sameRGB(fs.textColor, db.color), "inside the zone: Stop, in the zone color (" .. tostring(say()) .. ")")
  check(edge:IsShown() and close(edge.alpha, 0.6), "inside the zone: the edge shows (alpha " .. tostring(edge.alpha) .. ")")
  local g = rawget(top, "gradient")
  check(g and g[1] == "VERTICAL" and sameRGB({ g[3].r, g[3].g, g[3].b }, db.color) and close(g[3].a, 0.9) and close(g[2].a, 0), "the top edge in the zone color, fading inward")
  check(close(top.height, 90) and close(edge.textures[3].width, 90), "edge bands 90 px")
  T.now = 102.5 T.fire("PLAYER_STARTED_MOVING") T.update()
  check(say() == "Moving" and sameRGB(fs.textColor, db.clipColor), "moving inside the zone: Moving, in the clip color (" .. tostring(say()) .. ")")
  g = rawget(top, "gradient")
  check(edge:IsShown() and close(edge.alpha, 0.85) and g and sameRGB({ g[3].r, g[3].g, g[3].b }, db.clipColor), "the edge in the clip color while clipping (" .. rgbStr(g and g[3]) .. ")")
  local side = rawget(edge.textures[3], "gradient")
  check(side and side[1] == "HORIZONTAL" and close(side[2].a, 0.9) and close(side[3].a, 0), "the left edge fades to the right")
  T.now = 102.81 T.update()
  T.now = 103.0 T.update()
  check(say() == "Moving", "the bar ran out while moving: still Moving (" .. tostring(say()) .. ")")
  T.now = 103.1 T.fire("PLAYER_STOPPED_MOVING")
  T.now = 103.25 T.update()
  local p = pulseAt(103.25 - 102.81)
  check(say() == "Late" and sameRGB(fs.textColor, db.color) and close(fs.textColor[4], p, 1e-6), "standing, the shot late: Late, pulsing (" .. tostring(say()) .. ", alpha " .. num(fs.textColor[4]) .. ")")
  g = rawget(top, "gradient")
  check(edge:IsShown() and close(edge.alpha, 0.7 * p, 1e-6) and sameRGB({ g[3].r, g[3].g, g[3].b }, db.color), "the edge pulses in the zone color (alpha " .. num(edge.alpha) .. ")")
  T.now = 103.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  check(say() == "Go", "the late shot fires: Go (" .. tostring(say()) .. ")")
  T.now = 103.75 T.update() check(say() == "Go", "Go for 0.4 s")
  T.now = 103.85 T.update() check(say() == nil and not edge:IsShown(), "then nothing (" .. tostring(say()) .. ")")
  T.fire("STOP_AUTOREPEAT_SPELL")
  T.now = 106.21 T.update()
  check(T.stateHas("idle") and say() == nil and not edge:IsShown(), "Auto Shot off and the swing over: idle, nothing")
  T.now = 110 T.fire("START_AUTOREPEAT_SPELL") T.update()
  check(say() == "Stop", "the first shot's wind-up: Stop (" .. tostring(say()) .. ")")
  T.now = 110.6 T.update()
  check(say() == "Stop" and close(edge.alpha, 0.6), "the first shot's wait past the grace: still Stop, not Late (" .. tostring(say()) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('alerts: moving at login (IsPlayerMoving) counts as clipping inside the zone; warnMove off never clips', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.moving = true
  ShotWindowDB = { callout = true }
  T.login(200)
  local co = ShotWindowCallout
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update()
  check(co:IsShown() and co.fontStrings[1].text == "Moving", "seeded moving: Moving inside the zone (" .. tostring(co.fontStrings[1].text) .. ")")
  check(sameRGB(T.tex().stand.color, ShotWindowDB.clipColor), "the zone on the game's bar in the clip color")
  ShotWindowDB.warnMove = false
  T.slash("flash") T.slash("flash")
  T.now = 102.5 T.update()
  check(co.fontStrings[1].text == "Stop" and sameRGB(T.tex().stand.color, ShotWindowDB.color), "warnMove off: Stop, the zone color")
  check(#T.errors == 0, "no errors")
`);

scenario('alerts: the late readout shows under the display, not on the bar, and goes after 1.5 s; on the bar with display none', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "classic" }
  T.login(200)
  local db = ShotWindowDB
  local holder = ShotWindowDisplay
  local lateFS, bar = holder.fontStrings[2], T.lateLabel()
  check(lateFS.points[1][1] == "TOPRIGHT" and lateFS.points[1][2] == holder and lateFS.points[1][3] == "BOTTOMRIGHT", "under the display's right end")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.now = 103.0 T.update()
  check(not lateFS:IsShown() and not bar:IsShown(), "nothing before a late shot")
  T.now = 103.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  check(lateFS:IsShown() and lateFS.text == "+0.59" and sameRGB(lateFS.textColor, db.clipColor), "+0.59 in the clip color under the display (" .. tostring(lateFS.text) .. ")")
  check(not bar:IsShown(), "not on the game's bar")
  T.now = 104.85 T.update() check(lateFS:IsShown(), "still up 1.45 s after the shot")
  T.now = 104.95 T.update() check(not lateFS:IsShown(), "gone 1.55 s after the shot")
  T.now = 106.21 T.update()
  T.now = 106.26 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  check(not lateFS:IsShown(), "a shot 0.05 s after the bar ends is report jitter, not late")
  -- display none: the readout goes on the game's bar
  T.slash("display none")
  check(not holder:IsShown(), "display none hides the display")
  T.now = 109.07 T.update()
  T.now = 109.5 T.fire("PLAYER_SWING", 2.8, 2)
  check(bar:IsShown() and bar:GetText() == "+0.43" and sameRGB(bar.textColor, db.clipColor), "display none: +0.43 on the game's bar (" .. tostring(bar:GetText()) .. ")")
  T.now = 110.9 T.update() check(bar:IsShown(), "still up 1.4 s after the shot")
  T.now = 111.05 T.update() check(not bar:IsShown(), "gone 1.55 s after the shot")
  -- lateText off: nowhere
  db.lateText = false
  T.now = 112.31 T.update()
  T.now = 112.9 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  check(not bar:IsShown(), "lateText off: not on the bar")
  check(#T.errors == 0, "no errors")
`);

scenario('alerts: the late readout on the game bar goes 1.5 s after the shot even when that swing ends sooner (Auto Shot stopped)', DISPLAY_HELPERS + String.raw`
  -- A hasted 1.2 s swing after a late shot, then the target dies (STOP_AUTOREPEAT_SPELL): the swing
  -- ends 1.2 s after the shot with nothing to wait for.
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local bar = T.lateLabel()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.81 T.update()
  T.now = 103.4 T.fire("PLAYER_SWING", 1.2, 2)
  check(bar:IsShown() and bar:GetText() == "+0.59", "the late shot's delay on the bar (" .. tostring(bar:GetText()) .. ")")
  T.now = 103.5 T.fire("STOP_AUTOREPEAT_SPELL")
  T.now = 104.0 T.update()
  T.now = 104.61 T.update()
  check(T.stateHas("idle"), "the swing is over and nothing is held")
  T.now = 105.0 T.update()
  T.now = 106.0 T.update()
  check(not bar:IsShown(), "2.6 s after the shot the delay is gone from the bar (still showing " .. tostring(bar:GetText()) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('alerts: a sound once per swing as the zone starts, in the chosen kit; none for the first shot\'s wait', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", false
  ShotWindowDB = { sound = true, soundKit = 2 }
  T.login(200)
  T.update()
  check(#T.sounds == 0, "nothing at login")
  T.now = 100 T.fire("START_AUTOREPEAT_SPELL")
  for k = 1, 5 do T.now = 100 + k * 0.1 T.update() end
  check(T.stateHas("waiting") and #T.sounds == 0, "the first shot's wind-up (a wait with no swing) plays nothing (" .. #T.sounds .. ")")
  T.now = 100.6 T.fire("PLAYER_SWING", 2.8, 2)
  for k = 1, 22 do T.now = 100.6 + k * 0.1 T.update() end
  check(#T.sounds == 0, "nothing before the zone (" .. #T.sounds .. ")")
  T.now = 102.95 T.update()
  check(#T.sounds == 1 and T.sounds[1].id == SOUNDKIT.MAP_PING and T.sounds[1].channel == "Master", "one sound as the zone starts: Ping, on Master (" .. #T.sounds .. ", " .. tostring(T.sounds[1] and T.sounds[1].id) .. ")")
  T.now = 103.0 T.fire("PLAYER_STARTED_MOVING") T.update()
  T.now = 103.2 T.fire("PLAYER_STOPPED_MOVING") T.update()
  T.now = 103.41 T.update()
  for k = 1, 6 do T.now = 103.41 + k * 0.1 T.update() end
  check(T.stateHas("waiting") and #T.sounds == 1, "nothing more for moving, stopping or holding for the late shot (" .. #T.sounds .. ")")
  T.now = 104.1 T.fire("PLAYER_SWING", 2.8, 2)
  for k = 1, 28 do T.now = 104.1 + k * 0.1 T.update() end
  check(#T.sounds == 2, "once more in the next swing (" .. #T.sounds .. ")")
  ShotWindowDB.soundKit = 4
  T.now = 106.95 T.fire("PLAYER_SWING", 2.8, 2)
  for k = 1, 28 do T.now = 106.95 + k * 0.1 T.update() end
  check(#T.sounds == 3 and T.sounds[3].id == SOUNDKIT.RAID_WARNING, "the kit chosen now is the one played (" .. tostring(T.sounds[3] and T.sounds[3].id) .. ")")
  ShotWindowDB.sound = false
  T.now = 109.8 T.fire("PLAYER_SWING", 2.8, 2)
  for k = 1, 28 do T.now = 109.8 + k * 0.1 T.update() end
  check(#T.sounds == 3, "sound off: nothing (" .. #T.sounds .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('display frame: faded out when locked and idle; shown in combat, with Auto Shot on, or a swing or wait running; always and unlocked show it', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", false
  ShotWindowDB = { display = "classic" }
  T.login(200)
  local holder, r = rawget(_G, "ShotWindowDisplay"), T.rend()
  check(holder and holder:IsShown() and r and r.design == "classic", "made and shown at login from the saved choice")
  check(holder.strata == "MEDIUM" and rawget(holder, "parent") == UIParent, "on UIParent, MEDIUM strata")
  local lateFS = holder.fontStrings[2]
  local function a() return rawget(r.frame, "alpha") end
  T.update()
  check(a() == 0 and lateFS.alpha == 0, "locked, out of combat, Auto Shot off, no swing: faded out (" .. tostring(a()) .. ")")
  check(holder:IsShown(), "the frame itself stays shown")
  T.combat = true T.update()
  check(a() == 1 and lateFS.alpha == 1, "in combat: shown")
  T.combat = false T.update()
  check(a() == 0, "out of combat again: faded")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  check(a() == 1, "a swing running: shown")
  T.now = 102.81 T.update()
  check(a() == 0 and T.stateHas("idle"), "the swing over with Auto Shot off: faded")
  T.now = 103 T.fire("START_AUTOREPEAT_SPELL") T.update()
  check(a() == 1, "Auto Shot turned on (the first shot's wait): shown")
  T.now = 103.2 T.fire("STOP_AUTOREPEAT_SPELL") T.update()
  check(a() == 0, "Auto Shot off: faded")
  T.autoRep[75] = true
  T.fire("PLAYER_ENTERING_WORLD") T.update()
  check(T.stateHas("auto-repeat true, idle") and a() == 1, "Auto Shot on with nothing running: shown")
  T.autoRep[75] = false
  T.fire("PLAYER_ENTERING_WORLD") T.update()
  check(a() == 0, "off again: faded")
  ShotWindowDB.dispAlways = true T.update()
  check(a() == 1, "Show out of combat too: always shown")
  ShotWindowDB.dispAlways = false T.update()
  check(a() == 0, "and faded again without it")
  T.slash("unlock") T.update()
  check(a() == 1, "unlocked: shown, to be placed")
  check(#T.errors == 0, "no errors")
`);

scenario('display frame: none makes nothing; a design makes and shows it; none hides it again', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.update()
  check(rawget(_G, "ShotWindowDisplay") == nil, "display none: no frame made")
  check(T.debugSays("display: None (marks on the game's bar only), alerts: warnMove lateText"), "debug: display none")
  T.slash("display classic")
  local holder = rawget(_G, "ShotWindowDisplay")
  check(holder and holder:IsShown() and T.said("display: Classic bar"), "classic: made and shown")
  T.slash("display none")
  check(not holder:IsShown(), "none: hidden")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  check(not holder:IsShown(), "stays hidden through a swing")
  check(#T.errors == 0, "no errors")
`);

scenario('display frame and alerts: never for a class without Auto Shot or a wand, whatever is saved', DISPLAY_HELPERS + String.raw`
  T.className, T.class = "Warrior", "WARRIOR"
  ShotWindowDB = { display = "classic", callout = true, edge = true, sound = true }
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  for k = 1, 30 do T.now = 100 + k * 0.1 T.update() end
  T.slash("display pips")
  check(ShotWindowDB.display == "classic" and T.said("the stand-still zone is for hunters and wand users"), "/shotwindow display answers with what applies")
  T.slash("unlock")
  check(ShotWindowDB.dispLocked == true, "/shotwindow unlock does nothing")
  check(rawget(_G, "ShotWindowDisplay") == nil and rawget(_G, "ShotWindowCallout") == nil and rawget(_G, "ShotWindowEdge") == nil, "no display, call-out or edge made")
  check(#T.sounds == 0, "no sound")
  check(#T.errors == 0, "no errors")
`);

scenario('displays: a wand user (priest) gets the display and the alerts on Shoot', DISPLAY_HELPERS + String.raw`
  T.className, T.class = "Priest", "PRIEST"
  T.autoRepMode, T.autoRep[5019] = "plain", true
  ShotWindowDB = { display = "pincer", callout = true }
  T.login(200)
  local r = T.rend()
  check(ShotWindowDisplay and ShotWindowDisplay:IsShown() and r and r.design == "pincer", "the display for Shoot")
  T.now = 100 T.fire("PLAYER_SWING", 1.5, 2)
  T.now = 101.2 T.update()
  check(ShotWindowCallout:IsShown() and ShotWindowCallout.fontStrings[1].text == "Stop", "Stop inside the wand's zone")
  T.now = 101.51 T.update() T.now = 101.8 T.update()
  local _, x1 = T.rect(T.part(r, "left"))
  check(close(x1, r.w / 2), "held at the shot after the wand's swing (" .. num(x1) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('display frame: unlock shows the outline and hint and takes the mouse; a drag saves the spot; Reset position; on the game bar; lock', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "classic", callout = true }
  T.login(200)
  local db = ShotWindowDB
  local holder = ShotWindowDisplay
  local outline, hint = holder.textures[1], holder.fontStrings[1]
  local p = holder.points[1]
  check(#holder.points == 1 and p[1] == "CENTER" and p[2] == UIParent and p[3] == "CENTER" and p[4] == 0 and p[5] == -180, "first placed 180 below the middle")
  check(ShotWindowCallout.points[1][2] == holder and ShotWindowCallout.points[1][3] == "TOP", "the call-out sits above the display")
  check(not outline:IsShown() and not hint:IsShown() and holder.mouse == false, "locked: no outline, no hint, mouse off")
  check(not T.dragFrame(holder, 50, 50) and db.dispPos == nil, "locked: cannot be dragged")
  T.slash("unlock")
  check(db.dispLocked == false and T.said("display unlocked: drag it, then /shotwindow lock"), "/shotwindow unlock")
  check(outline:IsShown() and hint:IsShown() and hint.text == "Shot Window: drag to move, then /shotwindow lock" and holder.mouse == true, "unlocked: outline, hint, takes the mouse")
  check(holder.movable == true and holder.drag and holder.drag[1] == "LeftButton" and holder.clamped == true, "movable with the left button, kept on screen")
  check(T.dragFrame(holder, 100, 50) and holder.moving == false, "dragged and let go")
  local pos = db.dispPos
  check(type(pos) == "table" and close(pos[1], 100) and close(pos[2], -130), "the spot saved from the middle of the screen (" .. num(pos and pos[1]) .. ", " .. num(pos and pos[2]) .. ")")
  p = holder.points[1]
  check(#holder.points == 1 and p[1] == "CENTER" and p[2] == UIParent and p[3] == "CENTER" and close(p[4], 100) and close(p[5], -130), "and placed there by its middle")
  T.slash("lock")
  check(db.dispLocked == true and T.said("display locked") and not outline:IsShown() and not hint:IsShown() and holder.mouse == false, "/shotwindow lock")
  T.slash("display pips")
  p = holder.points[1]
  check(close(p[4], 100) and close(p[5], -130), "the saved spot kept for another design")
  T.slash("")
  T.click(T.tab(2))
  T.click(T.button("Reset position"))
  p = holder.points[1]
  check(db.dispPos == nil and p[2] == UIParent and p[4] == 0 and p[5] == -180, "Reset position: back to the first spot")
  T.click(T.checkbox("Lock in place"))
  check(db.dispLocked == false and holder.mouse == true and outline:IsShown(), "Lock in place unchecked: unlocked")
  T.click(T.checkbox("Sit on the game's swing bar"))
  p = holder.points[1]
  check(db.dispOnBar == true and #holder.points == 1 and p[1] == "CENTER" and p[2] == SwingTimerRangedFrame and p[3] == "CENTER", "on the game's bar: centered on SwingTimerRangedFrame")
  check(holder.mouse == false and not outline:IsShown() and not hint:IsShown(), "on the bar: fixed, never takes the mouse")
  check(not T.dragFrame(holder, 30, 30), "on the bar: cannot be dragged")
  checkControls("on the bar", { ["Lock in place"] = "grayed", ["Sit on the game's swing bar"] = "usable" })
  check(grayOf("Reset position") == "grayed", "Reset position grayed on the bar")
  check(T.debugSays("display: Pips, on the game's bar, shown"), "debug: on the game's bar")
  T.click(T.checkbox("Sit on the game's swing bar"))
  p = holder.points[1]
  check(db.dispOnBar == false and p[2] == UIParent and holder.mouse == true, "off the bar: free again, still unlocked")
  T.click(T.checkbox("Lock in place"))
  check(db.dispLocked == true and holder.mouse == false, "Lock in place checked: locked")
  check(T.debugSays("display: Pips, locked, shown, lines"), "debug: locked")
  check(#T.errors == 0, "no errors")
`);

scenario('display: /shotwindow display <name>, display alone steps on, unknown names listed; usage and debug', DISPLAY_HELPERS + String.raw`
  T.login(200)
  T.slash("display")
  check(ShotWindowDB.display == "classic" and T.said("display: Classic bar"), "display alone: the next design (" .. tostring(ShotWindowDB.display) .. ")")
  T.slash("display")
  check(ShotWindowDB.display == "pincer", "and the next")
  T.slash("display Reticle")
  check(ShotWindowDB.display == "reticle" and T.said("display: Tightening reticle") and T.rend().design == "reticle", "by name, any case")
  T.slash("display")
  check(ShotWindowDB.display == "none" and not ShotWindowDisplay:IsShown(), "after the last: none")
  T.slash("display blob")
  check(ShotWindowDB.display == "none" and T.said("displays: none, classic, pincer, vpincer, gap, brackets, pips, scanner, track, arc, ring, reticle"), "an unknown name lists them")
  T.slash("help")
  check(T.said("/shotwindow display [none|classic|pincer|vpincer|gap|brackets|pips|scanner|track|arc|ring|reticle]  - a display of its own (now none)"), "usage lists the designs")
  check(T.said("/shotwindow lock | unlock  - fix or move that display"), "usage: lock and unlock")
  T.slash("display gap")
  check(T.debugSays("display: Closing gap, locked, shown, lines, alerts: warnMove lateText"), "debug: the display line")
  ShotWindowDB.callout, ShotWindowDB.sound = true, true
  T.slash("unlock")
  check(T.debugSays("display: Closing gap, unlocked, shown, lines, alerts: warnMove lateText callout sound"), "debug: unlocked, the alerts listed")
  check(#T.errors == 0, "no errors")
`);

// The tab scenario on both paths: the game's tab template (selection through PanelTemplates: the
// selected tab disabled, its Active pieces shown) and plain tabs (selected flag and colors).
for (const [mode, label, pre] of [['template', 'the game\'s tab template', ''], ['plain', 'plain tabs', 'T.templates.PanelTabButtonTemplate = nil\n']]) {
  scenario('options: four tabs, Zone first; a tab shows its page and only its page, the selection follows (' + label + '); the tab is kept on reopening', DISPLAY_HELPERS + 'local MODE = "' + mode + '"\n' + pre + String.raw`
  T.login(200)
  T.slash("")
  local c, pages = T.content(), T.pages()
  check(#pages == 4 and #c.tabs == 4 and T.tab(1).text == "Zone" and T.tab(2).text == "Display" and T.tab(3).text == "Alerts" and T.tab(4).text == "Look",
    "Zone, Display, Alerts, Look")
  check(c.tabStyle == (MODE == "template" and "PanelTabButtonTemplate" or "plain"), "tab style (" .. tostring(c.tabStyle) .. ")")
  -- What the player sees as the selected tab, and as one of the others.
  local function looksSelected(tab)
    if MODE == "template" then
      return not tab:IsEnabled() and not tab.Left:IsShown() and not tab.Middle:IsShown() and not tab.Right:IsShown()
        and tab.LeftActive:IsShown() and tab.MiddleActive:IsShown() and tab.RightActive:IsShown()
    end
    local bg = tab.swBg.colorTex
    return tab.selected == true and tab:IsEnabled() and close(bg[1], 0.35, 1e-9) and close(bg[2], 0.28, 1e-9) and close(bg[3], 0.12, 1e-9)
  end
  local function looksDeselected(tab)
    if MODE == "template" then
      return tab:IsEnabled() and tab.Left:IsShown() and tab.Middle:IsShown() and tab.Right:IsShown()
        and not tab.LeftActive:IsShown() and not tab.MiddleActive:IsShown() and not tab.RightActive:IsShown()
    end
    local bg = tab.swBg.colorTex
    return tab.selected == false and tab:IsEnabled() and close(bg[1], 0.12, 1e-9) and close(bg[2], 0.1, 1e-9) and close(bg[3], 0.07, 1e-9)
  end
  local function on(i, what)
    local bad = {}
    for k = 1, 4 do
      if pages[k]:IsShown() ~= (k == i) then bad[#bad + 1] = "page " .. k .. (k == i and " hidden" or " shown") end
      if k == i and not looksSelected(T.tab(k)) then bad[#bad + 1] = "tab " .. k .. " not drawn selected" end
      if k ~= i and not looksDeselected(T.tab(k)) then bad[#bad + 1] = "tab " .. k .. " not drawn deselected" end
    end
    if MODE == "template" and c.tabStrip.selectedTab ~= i then bad[#bad + 1] = "the strip's selectedTab is " .. tostring(c.tabStrip.selectedTab) end
    if c.swTab ~= i then bad[#bad + 1] = "c.swTab " .. tostring(c.swTab) end
    if not pages[i]:IsVisible() then bad[#bad + 1] = "its page not visible" end
    check(#bad == 0, what .. (#bad > 0 and (": " .. table.concat(bad, ", ")) or ""))
  end
  on(1, "Zone first")
  check(T.checkbox("Show the red zone"):IsVisible() and not T.checkbox("Lock in place"):IsVisible(), "only the Zone page's controls")
  T.click(T.tab(2))
  on(2, "Display: its page, its tab selected")
  check(T.checkbox("Lock in place"):IsVisible() and not T.checkbox("Show the red zone"):IsVisible(), "only the Display page's controls")
  T.click(T.tab(3))
  on(3, "Alerts")
  check(T.checkbox("Say Stop, Moving, Late and Go"):IsVisible() and not T.checkbox("Lock in place"):IsVisible(), "only the Alerts page's controls")
  T.click(T.tab(4))
  on(4, "Look")
  check(T.button("Window style: Automatic"):IsVisible() and not T.checkbox("Say Stop, Moving, Late and Go"):IsVisible(), "only the Look page's controls")
  T.closePanel()
  T.slash("")
  on(4, "reopened on the Look page")
  T.click(T.tab(3))
  on(3, "then Alerts")
  T.click(T.tab(1))
  on(1, "back to Zone")
  check(T.button("Defaults"):IsVisible() and T.previewBox():IsVisible(), "the preview above and Defaults under every page")
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);
}

for (const [mode, label] of [['lines', 'Line regions'], ['squares', 'no CreateLine']]) {
  scenario('options: the Design button steps through every design, right click back; the preview draws each without errors (' + label + ')', DISPLAY_HELPERS + 'T.noLines = ' + (mode === 'squares') + '\n' + String.raw`
    T.autoRepMode, T.autoRep[75] = "plain", true
    T.login(200)
    T.slash("")
    T.click(T.tab(2))
    local db = ShotWindowDB
    local page = T.pages()[2]
    local stage, box = T.preview(), T.previewBox()
    check(stage ~= nil and box ~= nil and box:IsVisible() and box.width == 584 and box.height == 132 and stage.width == 584 and stage.height == 132,
      "the 584x132 preview over the tabs, shown on the Display tab")
    local r, g = stage.renderer, stage.bar
    local lateFS = stage.late
    local design = buttonStarting("Design: ")
    check(design and design.text == "Design: None (marks on the game's bar only)", "the Design button names the choice (" .. tostring(design and design.text) .. ")")
    check(textOn(page, NS.DISPLAY_NOTES.none) ~= nil, "the note under it")
    local list = NS.DISPLAYS
    for i = 1, #list do
      local want = list[i % #list + 1] -- classic ... reticle, then none
      T.click(design)
      check(db.display == want and design.text == "Design: " .. NS.DISPLAY_NAMES[want], "left click: " .. want .. " (" .. tostring(db.display) .. ")")
      check(textOn(page, NS.DISPLAY_NOTES[want]) ~= nil, want .. ": its note")
      -- The game's bar is drawn on every frame; a design is drawn beside it, none hides the display's
      -- cell. The made-up late shot's delay shows under the display, or on the bar with none.
      local errs, drawn, late, barLate, cellShown = #T.errors, 0, false, false, 0
      for k = 1, 37 do
        T.now = T.now + 0.25 T.update()
        local bar = T.isShown(g.stand) and g.frame:IsVisible()
        if want == "none" then
          if bar then drawn = drawn + 1 end
        elseif bar and T.shownParts(r) > 0 and r.frame:IsVisible() then drawn = drawn + 1 end
        if r.frame:IsVisible() then cellShown = cellShown + 1 end
        if lateFS:IsShown() and lateFS.text == "+0.60" then late = true end
        if g.late:IsShown() and g.late.text == "+0.60" then barLate = true end
      end
      check(#T.errors == errs, want .. ": the preview runs without errors (" .. (#T.errors - errs) .. ")")
      check(drawn == 37, want .. ": drawn on every frame (" .. drawn .. ")")
      if want == "none" then
        check(cellShown == 0, want .. ": no display drawn in the preview (" .. cellShown .. " frames)")
        check(barLate and not late, want .. ": the made-up late shot's delay on the game's bar")
        check(stage.dispName.text == "No display of its own", want .. ": named (" .. tostring(stage.dispName.text) .. ")")
      else
        local w, h = NS.DisplaySize(db, want)
        check(r.design == want and r.w == w and r.h == h, want .. ": the preview draws " .. want .. " at " .. w .. "x" .. h .. " (" .. tostring(r.design) .. " " .. tostring(r.w) .. "x" .. tostring(r.h) .. ")")
        local fit = math.min(1, (292 - 24) / w, (132 - 18 - 22 - 14) / h) -- its half of the width, the height under the names and the call-out
        check(close(r.frame:GetScale(), fit, 0.002), want .. ": scaled to fit its cell (" .. num(r.frame:GetScale()) .. ", want " .. num(fit) .. ")")
        check(late and not barLate, want .. ": the made-up late shot's delay under the display, not on the bar")
        check(stage.dispName.text == "Display: " .. NS.DISPLAY_NAMES[want], want .. ": named (" .. tostring(stage.dispName.text) .. ")")
      end
      if want ~= "none" then
        check(ShotWindowDisplay and ShotWindowDisplay:IsShown() and T.rend().design == want, want .. ": the display itself follows")
      end
    end
    check(db.display == "none" and not ShotWindowDisplay:IsShown(), "round to none: the display hidden")
    T.click(design, "RightButton")
    check(db.display == "reticle" and design.text == "Design: Tightening reticle", "right click from none: the last design")
    T.click(design, "RightButton")
    check(db.display == "ring", "right click again: the one before")
    T.update()
    check(#T.errors == 0, "no errors")
  `);
}

scenario('options: the Display page grays out what the chosen design does not use; its sliders and the scanner button change the settings', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.slash("")
  T.click(T.tab(2))
  local db = ShotWindowDB
  local function u(on) return on and "usable" or "grayed" end
  for _, d in ipairs(NS.DISPLAYS) do
    T.slash("display " .. d)
    local straight = d ~= "none" and not NS.ROUND_DISPLAYS[d]
    local round = NS.ROUND_DISPLAYS[d] == true
    checkControls(d, {
      ["Length"] = u(straight), ["Thickness of a bar"] = u(straight),
      ["Size of a round design"] = u(round), ["Line thickness of a round design"] = u(round),
      ["Rhythm track: seconds shown"] = u(d == "track"), ["Pips: how many"] = u(d == "pips"),
      ["Lock in place"] = u(d ~= "none"), ["Sit on the game's swing bar"] = u(d ~= "none"), ["Show out of combat too"] = u(d ~= "none"),
      -- Blizzard has no accent to use, so its checkbox is grayed (the Dark scenario below has it usable).
      ["Move color"] = "usable", ["Use the window style's accent for move"] = "grayed",
      ["Words: Move, Stand still, Moving, Late"] = u(d == "arc" or d == "ring"), ["Show the ring's countdown"] = u(d == "ring"),
    })
    check(grayOf("Scanner: out and back") == u(d == "scanner"), d .. ": the Scanner button " .. u(d == "scanner") .. " (" .. grayOf("Scanner: out and back") .. ")")
    check(grayOf("Reset position") == u(d ~= "none"), d .. ": Reset position " .. u(d ~= "none") .. " (" .. grayOf("Reset position") .. ")")
  end
  T.slash("display classic")
  T.drag(T.slider("Length"), 300)
  check(db.dispWidth == 300 and T.sliderText("Length") == "300 px" and T.rend().w == 300 and ShotWindowDisplay.width == 300, "Length 300: the bar 300 long")
  T.drag(T.slider("Thickness of a bar"), 24)
  check(db.dispHeight == 24 and T.rend().h == 24, "Thickness of a bar 24")
  T.slash("display vpincer")
  check(T.rend().w == 24 and T.rend().h == 300, "the vertical pincer stands that bar on end")
  T.slash("display ring")
  T.drag(T.slider("Size of a round design"), 200)
  check(db.dispSize == 200 and T.rend().w == 200 and T.rend().h == 200, "round size 200")
  T.drag(T.slider("Line thickness of a round design"), 16)
  check(db.dispThick == 16, "line thickness 16")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  -- Blizzard style: the ring's fill is the bar's fill art (QAfill: a seamless strip, its thickness
  -- the distance from its inner corners to its outer ones).
  local rr = T.rend()
  local ringFill = T.part(rr, "QAfill1")
  local cs = T.quadCorners(ringFill)
  local fillThick = type(cs) == "table" and (dist(cs[1][1], cs[1][2], rr.w / 2, rr.h / 2) - dist(cs[2][1], cs[2][2], rr.w / 2, rr.h / 2)) or nil
  check(rr.mode == "art" and rr.quads == true and close(fillThick, 16, 1e-6),
    "the ring's fill drawn 16 thick in the bar's art (" .. tostring(rr.mode) .. ", " .. num(fillThick) .. ")")
  T.slash("display arc")
  check(T.rend().w == 200 and close(T.rend().h, 160), "the arc 200 wide, 0.8 as tall")
  T.slash("display track")
  T.drag(T.slider("Rhythm track: seconds shown"), 8)
  check(db.trackSeconds == 8 and T.sliderText("Rhythm track: seconds shown") == "8 s", "the rhythm track shows 8 s")
  T.slash("display scanner")
  T.click(T.button("Scanner: out and back"))
  check(db.scanMode == "wrap" and T.button("Scanner: left to right") ~= nil, "the scanner button: left to right")
  T.click(T.button("Scanner: left to right"), "RightButton")
  check(db.scanMode == "pingpong", "and back")
  T.slash("display pips")
  T.drag(T.slider("Pips: how many"), 15)
  check(db.pipCount == 15 and T.sliderText("Pips: how many") == "15", "Pips 15: 15 saved and shown (" .. tostring(db.pipCount) .. ", label " .. tostring(T.sliderText("Pips: how many")) .. ")")
  T.now = 102 T.update()
  local r, n = T.rend(), 0
  for i = 1, 30 do if T.isShown(T.part(r, "p" .. i)) then n = n + 1 end end
  check(n == T.slider("Pips: how many"):GetValue(), "as many pips drawn as the slider is set to (" .. n .. " drawn, slider at " .. tostring(T.slider("Pips: how many"):GetValue()) .. ", label " .. tostring(T.sliderText("Pips: how many")) .. ")")
  T.drag(T.slider("Pips: how many"), 5)
  check(db.pipCount == 5 and T.sliderText("Pips: how many") == "5", "the slider's low end: 5 pips (" .. tostring(db.pipCount) .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('options: the Alerts page controls change the settings and gray out with their checkboxes', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.slash("")
  T.click(T.tab(3))
  local db = ShotWindowDB
  checkControls("defaults", { ["Warn when I move inside the zone"] = "usable", ["Clip color"] = "usable", ["Show how late a late shot was"] = "usable",
    ["Say Stop, Moving, Late and Go"] = "usable", ["Text size"] = "grayed", ["Play a sound as the zone starts"] = "usable",
    ["Tint the screen's edges to stand still"] = "usable", ["Edge width"] = "grayed" })
  check(grayOf("Sound: Tick") == "grayed", "the sound choice grayed while sound is off")
  T.click(T.checkbox("Warn when I move inside the zone"))
  check(db.warnMove == false and T.checkbox("Warn when I move inside the zone"):GetChecked() == false, "warnMove off")
  checkControls("warnMove off", { ["Clip color"] = "usable" })
  T.click(T.checkbox("Show how late a late shot was"))
  check(db.lateText == false, "lateText off")
  checkControls("both off", { ["Clip color"] = "grayed" })
  T.click(T.checkbox("Warn when I move inside the zone")) T.click(T.checkbox("Show how late a late shot was"))
  check(db.warnMove and db.lateText, "both on again")
  T.click(T.checkbox("Say Stop, Moving, Late and Go"))
  check(db.callout == true and rawget(_G, "ShotWindowCallout") ~= nil, "call-out on: its frame made")
  checkControls("call-out on", { ["Text size"] = "usable" })
  T.drag(T.slider("Text size"), 40)
  local fs = ShotWindowCallout.fontStrings[1]
  check(db.calloutSize == 40 and T.sliderText("Text size") == "40 pt" and fs.fontSize == 40, "Text size 40: the call-out in 40 pt (" .. tostring(fs.fontSize) .. ")")
  T.click(T.checkbox("Play a sound as the zone starts"))
  check(db.sound == true and grayOf("Sound: Tick") == "usable", "sound on: the choice usable")
  local n = #T.sounds
  T.click(T.button("Sound: Tick"))
  check(db.soundKit == 2 and T.button("Sound: Ping") ~= nil and #T.sounds == n + 1 and T.sounds[#T.sounds].id == SOUNDKIT.MAP_PING, "left click: Ping, played to hear it")
  T.click(T.button("Sound: Ping"), "RightButton")
  check(db.soundKit == 1 and T.sounds[#T.sounds].id == SOUNDKIT.IG_MAINMENU_OPTION_CHECKBOX_ON, "right click: back to Tick")
  T.click(T.button("Sound: Tick"), "RightButton")
  check(db.soundKit == 4 and T.button("Sound: Raid warning") ~= nil and T.sounds[#T.sounds].id == SOUNDKIT.RAID_WARNING, "right click from the first: the last")
  T.click(T.checkbox("Tint the screen's edges to stand still"))
  check(db.edge == true and rawget(_G, "ShotWindowEdge") ~= nil, "edge on: its frame made")
  checkControls("edge on", { ["Edge width"] = "usable" })
  T.drag(T.slider("Edge width"), 150)
  check(db.edgeSize == 150 and T.sliderText("Edge width") == "150 px", "Edge width 150")
  T.click(T.swatch("Clip color")) T.pickColor(0.2, 0.4, 1) T.pickerOkay()
  check(sameRGB(db.clipColor, { 0.2, 0.4, 1 }), "Clip color picked")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.5 T.fire("PLAYER_STARTED_MOVING") T.update()
  local edge, top = ShotWindowEdge, ShotWindowEdge.textures[1]
  local g = rawget(top, "gradient")
  check(edge:IsShown() and close(top.height, 150) and g and sameRGB({ g[3].r, g[3].g, g[3].b }, db.clipColor), "in a fight: the edge 150 px in the picked clip color")
  check(ShotWindowCallout:IsShown() and fs.text == "Moving" and sameRGB(fs.textColor, db.clipColor), "Moving in the picked clip color")
  check(#T.sounds == n + 4 and T.sounds[#T.sounds].id == SOUNDKIT.RAID_WARNING, "the zone's sound in the chosen kit (" .. (#T.sounds - n) .. " since)")
  -- The one preview stays over the Alerts tab and shows these alerts: the call-out (at most 20 pt)
  -- and the screen edge in miniature (12 px), in the picked clip color while moving.
  local stage = T.preview()
  check(stage and stage:IsVisible() and T.pages()[3]:IsVisible() and T.previewBox():IsVisible(), "the preview over the Alerts tab")
  local errs, said, clipEdge, sizes = #T.errors, {}, 0, {}
  for k = 1, 37 do
    T.now = T.now + 0.25 T.update()
    if stage.say:IsShown() then said[stage.say.text] = true sizes[#sizes + 1] = stage.say.fontSize end
    for i = 1, 4 do
      local band = stage.textures[i]
      local bg = rawget(band, "gradient")
      if band.shown and bg and sameRGB({ bg[2].r, bg[2].g, bg[2].b }, db.clipColor)
        and close(i <= 2 and band.height or band.width, 12, 1e-9) then clipEdge = clipEdge + 1 end
    end
  end
  check(#T.errors == errs, "it runs without errors (" .. (#T.errors - errs) .. ")")
  check(said.Stop and said.Moving and said.Late, "its call-out says Stop, Moving and Late")
  local big = 0
  for _, s in ipairs(sizes) do if s ~= 20 then big = big + 1 end end
  check(#sizes > 0 and big == 0, "the call-out at 20 pt in the preview while set to 40 (" .. big .. " frames otherwise)")
  check(clipEdge >= 4, "its screen edge, 12 px, in the picked clip color while moving (" .. clipEdge .. " band frames)")
  check(#T.errors == 0, "no errors")
`);

scenario('options: Defaults puts every display and alert setting back and hides what they made', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.slash("")
  local db = ShotWindowDB
  local changed = { display = "ring", warnMove = false, lateText = false, callout = true, calloutSize = 40, edge = true, edgeSize = 150,
    sound = true, soundKit = 3, moveAccent = false, dispWidth = 300, dispHeight = 20, dispSize = 200, dispThick = 20,
    artFlip = true, dispLocked = false, dispAlways = true, dispOnBar = false, scanMode = "wrap", trackSeconds = 8, pipCount = 15,
    dispWords = false, dispCount = false }
  for k, v in pairs(changed) do db[k] = v end
  db.clipColor[1], db.moveColor[2] = 0, 0
  T.slash("display ring")
  check(ShotWindowDisplay:IsShown() and rawget(_G, "ShotWindowCallout") ~= nil and rawget(_G, "ShotWindowEdge") ~= nil, "a display, a call-out and an edge before the reset")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 102.5 T.update()
  check(ShotWindowCallout:IsShown() and ShotWindowEdge:IsShown(), "both showing inside the zone")
  T.click(T.button("Defaults"))
  local want = { display = "none", warnMove = true, lateText = true, callout = false, calloutSize = 26, edge = false, edgeSize = 90,
    sound = false, soundKit = 1, moveAccent = true, dispWidth = 240, dispHeight = 16, dispSize = 140, dispThick = 12,
    artFlip = false, dispLocked = true, dispAlways = false, dispOnBar = false, scanMode = "pingpong", trackSeconds = 5, pipCount = 11,
    dispWords = true, dispCount = true }
  local bad = {}
  for k, v in pairs(want) do if db[k] ~= v then bad[#bad + 1] = k .. "=" .. tostring(db[k]) end end
  table.sort(bad)
  check(#bad == 0, "every new key back to its default (" .. table.concat(bad, ", ") .. ")")
  check(sameRGB(db.clipColor, { 1, 0.6, 0.1 }) and sameRGB(db.moveColor, { 0.39, 0.6, 0.13 }), "clip and move colors back")
  check(not ShotWindowDisplay:IsShown(), "display none: hidden")
  T.update()
  check(not ShotWindowCallout:IsShown() and not ShotWindowEdge:IsShown(), "call-out and edge gone")
  T.click(T.tab(2))
  check(buttonStarting("Design: ").text == "Design: None (marks on the game's bar only)", "the Design button says None")
  check(#T.errors == 0, "no errors")
`);

// The screen edge's own color (0.3.1): "Same color as the zone" (edgeZoneColor, on by default) keeps
// the edge in the zone color as before; unticked, it shows in "Edge color" (edgeColor, red by
// default). Moving in the zone still turns it the clip color.
const EDGE_HELPERS = String.raw`
  local RED_C, AMBER, BLUE, GREEN = { 0.95, 0.2, 0.15 }, { 1, 0.6, 0.1 }, { 0.2, 0.3, 0.9 }, { 0.1, 0.8, 0.2 }
  local EC, SAME, ON = "Edge color", "Same color as the zone", "Tint the screen's edges to stand still"
  -- A band's color: its gradient's strong end (alpha 0.9), nil without one.
  local function bandRGB(band)
    local g = band and rawget(band, "gradient")
    if not g then return nil end
    local strong = (close(g[2].a, 0.9) and g[2]) or (close(g[3].a, 0.9) and g[3]) or nil
    return strong and { strong.r, strong.g, strong.b }
  end
  -- The four bands' color when all four share one, else nil.
  local function edgeRGB(bands)
    local c
    for i = 1, 4 do
      local b = bandRGB(bands[i])
      if not b or (c and not sameRGB(b, c)) then return nil end
      c = c or b
    end
    return c
  end
  -- The live edge (ShotWindowEdge) shown in want at alpha.
  local function liveIs(label, want, alpha)
    local e = rawget(_G, "ShotWindowEdge")
    local c = e and edgeRGB(e.textures)
    check(e and e:IsShown() and sameRGB(c, want) and close(rawget(e, "alpha"), alpha, 1e-6),
      label .. " (" .. rgbStr(c) .. ", alpha " .. num(e and rawget(e, "alpha")) .. ", want " .. rgbStr(want) .. " at " .. num(alpha) .. ")")
  end
  local function pick(label, c) T.click(T.swatch(label)) T.pickColor(c[1], c[2], c[3]) end
  -- Opens a tab unless it is the open one (its button disabled then).
  local function openTab(i) local t = T.tab(i) if t:IsEnabled() then T.click(t) end end
`;

scenario('edge color, defaults: Same color as the zone on, the edge color red; the live edge in the zone color while lit and late (pulsing), on the next frame after the zone swatch changes it; the clip color while moving', DISPLAY_HELPERS + EDGE_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { edge = true }
  T.login(200)
  local db = ShotWindowDB
  check(db.edgeZoneColor == true and sameRGB(db.edgeColor, RED_C),
    "defaults: edgeZoneColor on, edgeColor red (" .. tostring(db.edgeZoneColor) .. ", " .. rgbStr(db.edgeColor) .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update()
  liveIs("lit: the zone color at 0.6", db.color, 0.6)
  T.slash("")
  openTab(1)
  pick("Zone color", BLUE)
  T.update()
  liveIs("the zone color picked (live): the edge follows on the next frame", BLUE, 0.6)
  T.pickerCancel()
  T.update()
  liveIs("Cancel: back to the old zone color on the next frame", RED_C, 0.6)
  pick("Zone color", BLUE) T.pickerOkay()
  T.update()
  liveIs("Okay: the edge in the picked zone color", BLUE, 0.6)
  check(sameRGB(db.edgeColor, RED_C) and db.edgeColor ~= db.color, "the edge color itself untouched, its own table (" .. rgbStr(db.edgeColor) .. ")")
  T.now = 102.5 T.fire("PLAYER_STARTED_MOVING") T.update()
  liveIs("moving in the zone: the clip color at 0.85", AMBER, 0.85)
  T.now = 102.81 T.update()
  T.now = 103.0 T.update()
  T.now = 103.1 T.fire("PLAYER_STOPPED_MOVING")
  T.now = 103.25 T.update()
  liveIs("standing, the shot late: the zone color, pulsing", BLUE, 0.7 * pulseAt(103.25 - 102.81))
  T.now = 103.45 T.update()
  liveIs("later in the wait: the zone color, the pulse moved on", BLUE, 0.7 * pulseAt(103.45 - 102.81))
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('edge color, own: Edge color and Same color as the zone on the Alerts tab under Edge width, above Sound, gray out with the edge and the box; unticked, the live edge in the edge color (lit 0.6, late pulsing 0.7), the clip color while moving; its swatch repaints on the next frame; the zone color no longer moves it; ticked again, the zone color', DISPLAY_HELPERS + EDGE_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  T.slash("")
  openTab(3)
  local page = T.pages()[3]
  local sw, cb, slider = T.swatch(EC), T.checkbox(SAME), T.slider("Edge width")
  local holder = slider and slider.parent
  local sound
  for _, fs in ipairs(page.fontStrings) do if rawget(fs, "text") == "Sound" then sound = fs end end
  check(sw and cb and holder and sound and sw.parent == page and cb.parent == page and holder.parent == page,
    "Edge color, the box, Edge width and the Sound header on the Alerts page")
  local function at(f)
    local p = f and f.points[1]
    if p and p[1] == "TOPLEFT" and type(p[2]) == "number" and type(p[3]) == "number" then return p[2], -p[3] end
  end
  local hx, hy = at(holder)
  local sx, sy = at(sw)
  local cx, cy = at(cb)
  local nx, ny = at(sound)
  local where = string.format("width %s,%s; color %s,%s; box %s,%s; Sound %s,%s", tostring(hx), tostring(hy), tostring(sx), tostring(sy),
    tostring(cx), tostring(cy), tostring(nx), tostring(ny))
  check(hx and sx and cx and nx and hx == 308 and sx == 308 and cx == 304 and nx == 308, "all four in the right column (" .. where .. ")")
  check(hy and sy and cy and ny and hy < sy and sy + sw.height <= cy and cy + cb.height <= ny,
    "top to bottom: Edge width, Edge color, the box, the Sound header (" .. where .. ")")
  check(cy and sy and ny and cy - sy == 24 and ny - cy == 36, "the box 28 under the swatch's row, the Sound header 8 more than a row under the box (" .. where .. ")")
  local labelW = 0
  for _, fs in ipairs(cb.fontStrings) do if rawget(fs, "text") == SAME then labelW = fs:GetStringWidth() end end
  check(cx and cy and labelW > 0 and cx + cb.width + 2 + labelW <= 600 and cy + cb.height <= 384 and sy + sw.height <= 384,
    "both inside the page (the box's label ends at " .. tostring(cx and cx + cb.width + 2 + labelW) .. ")")

  -- Gray-out: both while the edge is off; the swatch while the box is ticked.
  check(cb:GetChecked() == true and db.edge == false, "the box ticked, the edge off by default")
  checkControls("edge off", { [EC] = "grayed", [SAME] = "grayed" })
  T.click(T.checkbox(ON))
  checkControls("edge on, box ticked", { [EC] = "grayed", [SAME] = "usable" })
  T.click(cb)
  check(db.edgeZoneColor == false and cb:GetChecked() == false and db.edge == true, "unticked: edgeZoneColor off, the edge still on")
  checkControls("edge on, box unticked", { [EC] = "usable", [SAME] = "usable" })
  T.click(T.checkbox(ON))
  checkControls("edge off, box unticked", { [EC] = "grayed", [SAME] = "grayed" })
  T.click(T.checkbox(ON))
  checkControls("edge on again", { [EC] = "usable", [SAME] = "usable" })
  check(sameRGB(T.swatchRGB(EC), RED_C), "the swatch shows the edge color, red (" .. rgbStr(T.swatchRGB(EC)) .. ")")

  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update()
  liveIs("lit: the edge color at 0.6", RED_C, 0.6)
  pick(EC, GREEN)
  check(sameRGB(db.edgeColor, GREEN) and sameRGB(db.color, RED_C) and sameRGB(T.swatchRGB(EC), GREEN), "picked live: edgeColor and its swatch green, the zone color untouched")
  T.update()
  liveIs("picked live: the edge green on the next frame", GREEN, 0.6)
  T.pickerCancel()
  check(sameRGB(db.edgeColor, RED_C) and sameRGB(T.swatchRGB(EC), RED_C), "Cancel: edgeColor and its swatch red again")
  T.update()
  liveIs("Cancel: the edge red again on the next frame", RED_C, 0.6)
  pick(EC, GREEN) T.pickerOkay()
  T.update()
  liveIs("Okay: the edge green", GREEN, 0.6)
  openTab(1)
  pick("Zone color", BLUE) T.pickerOkay()
  T.update()
  liveIs("the zone color changed: the edge stays green", GREEN, 0.6)
  T.now = 102.5 T.fire("PLAYER_STARTED_MOVING") T.update()
  liveIs("moving in the zone: still the clip color at 0.85", AMBER, 0.85)
  T.now = 102.81 T.update()
  T.now = 103.0 T.update()
  liveIs("the bar ran out while moving: the clip color", AMBER, 0.85)
  T.now = 103.1 T.fire("PLAYER_STOPPED_MOVING")
  T.now = 103.25 T.update()
  liveIs("standing, the shot late: the edge color, pulsing", GREEN, 0.7 * pulseAt(103.25 - 102.81))
  T.now = 103.45 T.update()
  liveIs("later in the wait: the edge color, the pulse moved on", GREEN, 0.7 * pulseAt(103.45 - 102.81))
  openTab(3)
  T.click(T.checkbox(SAME))
  check(db.edgeZoneColor == true and sameRGB(db.edgeColor, GREEN), "ticked again: edgeZoneColor on, the edge color kept")
  checkControls("ticked again", { [EC] = "grayed", [SAME] = "usable" })
  T.update()
  liveIs("ticked again: the zone color on the next frame, still pulsing", BLUE, 0.7 * pulseAt(103.45 - 102.81))
  T.now = 103.5 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 105.9 T.update()
  liveIs("the next zone: the zone color at 0.6", BLUE, 0.6)
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('edge color, the options preview: its 12 px edge in the zone color by default, the edge color with the box unticked, the clip color while moving either way; a swatch change or the box shows on the next frame', DISPLAY_HELPERS + EDGE_HELPERS + String.raw`
  ShotWindowDB = { edge = true }
  T.login(200)
  local db = ShotWindowDB
  T.slash("")
  local stage = T.preview()
  check(stage and stage:IsVisible(), "the preview shows")
  local bands = { stage.textures[1], stage.textures[2], stage.textures[3], stage.textures[4] }
  -- This frame's color and alpha, nil while hidden.
  local function frame()
    for i = 1, 4 do if not rawget(bands[i], "shown") then return nil end end
    return edgeRGB(bands), rawget(bands[1], "alpha")
  end
  local function frameIs(label, want, alpha)
    local c, a = frame()
    check(sameRGB(c, want) and close(a, alpha, 1e-6), label .. " (" .. rgbStr(c) .. ", alpha " .. num(a) .. ")")
  end
  -- Frames until the zone is lit in want (not late, not clipping).
  local function toLit(want)
    for k = 1, 200 do
      T.now = T.now + 0.05 T.update()
      local c, a = frame()
      if c and sameRGB(c, want) and close(a, 0.6, 1e-6) then return true end
    end
    return false
  end
  -- Ten seconds of the loop: every shown frame in the clip color at 0.85 or in want, lit at 0.6 or pulsing.
  local function loop(label, want)
    local clip, lit, pulsing, other, alphas = 0, 0, 0, {}, {}
    for k = 1, 100 do
      T.now = T.now + 0.1 T.update()
      local c, a = frame()
      if c then
        local thin = close(bands[1].height, 12, 1e-9) and close(bands[3].width, 12, 1e-9)
        if thin and sameRGB(c, db.clipColor) and close(a, 0.85, 1e-6) then clip = clip + 1
        elseif thin and sameRGB(c, want) and close(a, 0.6, 1e-6) then lit = lit + 1
        elseif thin and sameRGB(c, want) and type(a) == "number" and a >= 0.7 * 0.2 - 1e-6 and a <= 0.7 + 1e-6 then
          if not alphas[num(a)] then pulsing = pulsing + 1 end
          alphas[num(a)] = true
        else other[#other + 1] = rgbStr(c) .. " at " .. num(a) end
      end
    end
    check(clip > 0 and lit > 0 and pulsing >= 2 and #other == 0, label .. ": " .. clip .. " clipping, " .. lit .. " lit, " .. pulsing
      .. " pulse alphas (0.14 to 0.7), 12 px" .. (#other > 0 and ("; also " .. table.concat(other, ", ")) or ""))
  end
  loop("defaults: the zone color", db.color)
  check(toLit(db.color), "lit in the zone color")
  openTab(1)
  pick("Zone color", BLUE)
  T.update()
  frameIs("the zone color picked: blue on the next frame", BLUE, 0.6)
  T.pickerOkay()
  loop("the picked zone color", BLUE)
  openTab(3)
  check(toLit(BLUE), "lit in blue")
  T.click(T.checkbox(SAME))
  T.update()
  frameIs("unticked: the edge color (red) on the next frame", RED_C, 0.6)
  pick(EC, GREEN)
  T.update()
  frameIs("the edge color picked: green on the next frame", GREEN, 0.6)
  T.pickerCancel()
  T.update()
  frameIs("Cancel: red again on the next frame", RED_C, 0.6)
  pick(EC, GREEN) T.pickerOkay()
  loop("unticked: the edge color", GREEN)
  openTab(1)
  check(toLit(GREEN), "lit in green")
  pick("Zone color", { 0.5, 0.1, 0.6 }) T.pickerOkay()
  T.update()
  frameIs("the zone color changed: still green", GREEN, 0.6)
  openTab(3)
  T.click(T.checkbox(SAME))
  T.update()
  frameIs("ticked again: the zone color on the next frame", { 0.5, 0.1, 0.6 }, 0.6)
  loop("ticked again: the zone color", db.color)
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('edge color, saved settings from before 0.3.1 (neither key): Same color as the zone on, the edge in the saved zone color', DISPLAY_HELPERS + EDGE_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { edge = true, color = { 0.2, 0.3, 0.9 } }
  T.login(200)
  local db = ShotWindowDB
  check(db.edgeZoneColor == true and sameRGB(db.edgeColor, RED_C) and sameRGB(db.color, BLUE),
    "loaded: edgeZoneColor on, edgeColor red, the zone color kept (" .. tostring(db.edgeZoneColor) .. ", " .. rgbStr(db.edgeColor) .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update()
  liveIs("lit: the saved zone color, as before 0.3.1", BLUE, 0.6)
  T.slash("")
  openTab(3)
  check(T.checkbox(SAME):GetChecked() == true, "the box ticked")
  checkControls("old settings", { [EC] = "grayed", [SAME] = "usable" })
  check(#T.errors == 0, "no errors")
`);

scenario('edge color, a saved own color is kept; Defaults ticks the box again and puts the edge color back to red, a fresh table each time', DISPLAY_HELPERS + EDGE_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { edge = true, edgeZoneColor = false, edgeColor = { 0.1, 0.8, 0.2 } }
  T.login(200)
  local db = ShotWindowDB
  check(db.edgeZoneColor == false and sameRGB(db.edgeColor, GREEN), "loaded: the own color kept (" .. tostring(db.edgeZoneColor) .. ", " .. rgbStr(db.edgeColor) .. ")")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 102.4 T.update()
  liveIs("lit: the saved edge color", GREEN, 0.6)
  T.slash("")
  openTab(3)
  check(T.checkbox(SAME):GetChecked() == false and sameRGB(T.swatchRGB(EC), GREEN), "the box unticked, the swatch green")
  checkControls("own color", { [EC] = "usable", [SAME] = "usable" })
  T.click(T.button("Defaults"))
  check(db.edgeZoneColor == true and sameRGB(db.edgeColor, RED_C), "Defaults: edgeZoneColor on, edgeColor red (" .. tostring(db.edgeZoneColor) .. ", " .. rgbStr(db.edgeColor) .. ")")
  check(T.checkbox(SAME):GetChecked() == true and sameRGB(T.swatchRGB(EC), RED_C), "Defaults: the box ticked, the swatch red")
  checkControls("Defaults", { [EC] = "grayed", [SAME] = "grayed" })
  db.edgeColor[1], db.edgeColor[2] = 0, 0
  local first = db.edgeColor
  T.click(T.button("Defaults"))
  check(sameRGB(db.edgeColor, RED_C) and db.edgeColor ~= first, "Defaults again: red, a fresh table (the first one changed did not change the default)")
  check(#T.errors == 0, "no errors")
`);

// ---------------------------------------------------------------------------------------------
// The options layout: the preview across the top, four tabs hanging under it (the game's tab
// template, or plain ones), the open tab's page, the Defaults row.

const TAB_HELPERS = String.raw`
  local W, PREVIEW_H, TAB_H, TAB_W, TAB_X, TAB_GAP, TAB_TUCK = 600, 132, 32, 120, 8, 3, 1
  local BOX_X, BOX_W = 8, 600 - 16 -- the preview box: inside the window's inset (4 to 594) too
  local PAGE_TOP, PAGE_H, CONTENT_H = 169, 384, 581
  local LABELS = { "Zone", "Display", "Alerts", "Look" }
  local TIPS = {
    "The stand-still zone on the game's swing bar: its timing, the red zone, the marker line and the fill.",
    "A display of its own besides the game's bar: the design, where it sits and its size.",
    "Moving in the zone, late shots, call-out text, the screen edge and a sound.",
    "The window style: Blizzard, Dark or EllesmereUI, for this window, the swing bars and the displays.",
  }
  -- Each tab's box in the content's units, x right and y down from its top left, worked out from the
  -- anchors: the strip TOPLEFT on the preview box's BOTTOMLEFT, tab 1 TOPLEFT on the strip's, each
  -- next one LEFT on the last one's RIGHT. nil when a tab is anchored any other way.
  local function tabBoxes(c)
    local box, strip = c.previewBox, c.tabStrip
    local bp, sp = box.points[1], strip.points[1]
    if not (#box.points == 1 and bp[1] == "TOPLEFT" and type(bp[2]) == "number" and type(bp[3]) == "number"
      and #strip.points == 1 and sp[1] == "TOPLEFT" and sp[2] == box and sp[3] == "BOTTOMLEFT") then return nil end
    local sx, sy = bp[2] + sp[4], -bp[3] + box.height - sp[5]
    local out = {}
    for i, tab in ipairs(c.tabs) do
      local p = tab.points[1]
      if #tab.points ~= 1 then return nil end
      if i == 1 then
        if not (p[1] == "TOPLEFT" and p[2] == strip and p[3] == "TOPLEFT") then return nil end
        out[i] = { x0 = sx + p[4], y0 = sy - p[5], x1 = sx + p[4] + tab.width, y1 = sy - p[5] + tab.height }
      else
        if not (p[1] == "LEFT" and p[2] == c.tabs[i - 1] and p[3] == "RIGHT") then return nil end
        local prev = out[i - 1]
        local mid = (prev.y0 + prev.y1) / 2 - p[5]
        out[i] = { x0 = prev.x1 + p[4], y0 = mid - tab.height / 2, x1 = prev.x1 + p[4] + tab.width, y1 = mid + tab.height / 2 }
      end
    end
    return out
  end
  -- What is wrong with the frame levels: with the template the selected tab is above the others;
  -- on both paths the preview box's border (its NineSlice) is above every tab.
  local function levelProblems(c, sel, template)
    local bad, top = {}, 0
    local selected = c.tabs[sel]:GetFrameLevel()
    for i, tab in ipairs(c.tabs) do
      local l = tab:GetFrameLevel()
      top = math.max(top, l)
      if template and i ~= sel and l >= selected then bad[#bad + 1] = "tab " .. i .. " at level " .. l .. ", not under the selected tab's " .. selected end
    end
    local nine = c.previewBox.NineSlice
    if nine:GetFrameLevel() <= top then bad[#bad + 1] = "the preview box's border at level " .. nine:GetFrameLevel() .. ", not above the top tab's " .. top end
    return bad
  end
  local function joined(list) return #list > 0 and (": " .. table.concat(list, "; ")) or "" end
`;

const PREVIEW_HELPERS = String.raw`
  local SW = 230 -- the mock bar's status area: 240 less 5 on each side
  local P0
  -- The preview's made-up loop starts at its first frame: startLoop() runs that frame now; at(t)
  -- runs the frame t seconds into the loop (9 s with a 2.8 s weapon: three swings and 0.6 s late).
  local function startLoop() P0 = T.now T.update() end
  local function at(t) T.now = P0 + t T.update() end
  local function colorIs(t, c, a)
    local got = rawget(t, "colorTex")
    return type(got) == "table" and close(got[1], c[1], 1e-6) and close(got[2], c[2], 1e-6) and close(got[3], c[3], 1e-6)
      and (a == nil or close(got[4], a, 1e-6))
  end
  local function colorStr(t)
    local c = rawget(t, "colorTex")
    return c and string.format("%.2f,%.2f,%.2f,%.2f", c[1], c[2], c[3], c[4]) or "none"
  end
  -- The band on the mock bar: its left edge and width, or nil when hidden. Both anchors sit on the
  -- status area at that x, one at its top and one at its bottom, so it spans the full height.
  local function bandOf(g)
    local t = g.stand
    if not T.isShown(t) then return nil end
    local a, b = t.points[1], t.points[2]
    if #t.points ~= 2 or a[1] ~= "TOPLEFT" or a[2] ~= g.sb or a[3] ~= "TOPLEFT" or a[5] ~= 0
      or b[1] ~= "BOTTOMLEFT" or b[2] ~= g.sb or b[3] ~= "BOTTOMLEFT" or b[5] ~= 0 or a[4] ~= b[4] then return "bad anchors" end
    return a[4], t.width
  end
  -- The marker line's x, from its TOP on the status area's top to its BOTTOM on its bottom.
  local function lineOf(g)
    local t = g.line
    if not T.isShown(t) then return nil end
    local a, b = t.points[1], t.points[2]
    if #t.points ~= 2 or a[1] ~= "TOP" or a[2] ~= g.sb or a[3] ~= "TOPLEFT" or a[5] ~= 0
      or b[1] ~= "BOTTOM" or b[2] ~= g.sb or b[3] ~= "BOTTOMLEFT" or b[5] ~= 0 or a[4] ~= b[4] then return "bad anchors" end
    return a[4]
  end
  -- Where a frame's center lands on the frame it is anchored to (x right, y up from its top left).
  -- The client reads an anchor's offsets in the anchored frame's own scaled units, so a frame scaled
  -- by s and placed at (x, y) lands at (x * s, y * s); Host in ShotWindow.lua divides its offsets by
  -- the scale for that reason.
  local function landsAt(f, rel)
    local p = f.points[1]
    if #f.points ~= 1 or p[1] ~= "CENTER" then return nil end
    local s = f:GetScale() or 1
    if p[2] == rel and p[3] == "TOPLEFT" then return p[4] * s, p[5] * s end
    -- CENTER on another frame's CENTER: where that one lands, plus this one's own offsets at its scale.
    if p[3] == "CENTER" and type(p[2]) == "table" and p[2] ~= rel then
      local x, y = landsAt(p[2], rel)
      if x then return x + (p[4] or 0) * s, y + (p[5] or 0) * s end
    end
    return nil
  end
`;

scenario('options tabs (the game\'s tab template): four tabs hang from the preview box, 3 apart and 120 wide (also after OnShow); a click selects through PanelTemplates and plays the tab sound; only its page shows; the selected tab above its neighbours, the box\'s border above every tab; kept on reopening; tooltips', DISPLAY_HELPERS + TAB_HELPERS + String.raw`
  local setTabs = {}
  local setTab = PanelTemplates_SetTab
  PanelTemplates_SetTab = function(frame, id) setTabs[#setTabs + 1] = { frame = frame, id = id } return setTab(frame, id) end
  T.login(200)
  T.slash("")
  local c, box = T.content(), T.previewBox()
  local strip, tabs, pages = c.tabStrip, c.tabs, T.pages()
  check(c.tabStyle == "PanelTabButtonTemplate" and #tabs == 4, "four tabs in the game's tab template (" .. tostring(c.tabStyle) .. ")")
  check(box.template == "InsetFrameTemplate" and box.width == BOX_W and box.height == PREVIEW_H, "the preview in the game's inset box, " .. BOX_W .. "x" .. PREVIEW_H)
  local listed = rawget(strip, "Tabs") or {}
  local inOrder = #listed == 4
  for i = 1, 4 do inOrder = inOrder and listed[i] == tabs[i] end
  check(inOrder and strip.numTabs == 4, "every tab in the strip's Tabs list (the template's parentArray), in order, and numTabs 4")
  check(strip.minTabWidth == TAB_W and strip.maxTabWidth == TAB_W, "the strip tells the template its tabs are 120 wide")
  local sp = strip.points[1]
  check(#strip.points == 1 and sp[1] == "TOPLEFT" and sp[2] == box and sp[3] == "BOTTOMLEFT" and sp[4] == 0 and sp[5] == TAB_TUCK,
    "the strip hangs from the preview box's bottom left, 1 up")
  local function placed(what)
    local boxes = tabBoxes(c)
    check(boxes ~= nil, what .. ": tab 1 at the strip's top left, each next one LEFT on the last one's RIGHT")
    for i, tab in ipairs(tabs) do
      check(tab.width == TAB_W and tab.height == TAB_H and tab.Text.width == TAB_W - 20,
        what .. ": tab " .. i .. " 120 wide (its label 100), 32 tall (" .. tostring(tab.width) .. "x" .. tostring(tab.height) .. ", label " .. tostring(tab.Text.width) .. ")")
      local b = boxes and boxes[i]
      if b then
        local x = BOX_X + TAB_X + (i - 1) * (TAB_W + TAB_GAP)
        check(close(b.x0, x, 1e-9), what .. ": tab " .. i .. " starts at " .. x .. ", 3 after the last (" .. num(b.x0) .. ")")
        check(close(b.y0, PREVIEW_H - TAB_TUCK, 1e-9) and close(b.y1, PREVIEW_H - TAB_TUCK + TAB_H, 1e-9),
          what .. ": tab " .. i .. " top 1 up under the box's bottom edge, level with the others (" .. num(b.y0) .. " to " .. num(b.y1) .. ")")
        check(b.y1 <= PAGE_TOP and b.x1 <= BOX_X + BOX_W, what .. ": tab " .. i .. " above the pages and within the box's width")
      end
    end
  end
  placed("built")
  for i, tab in ipairs(tabs) do
    check(tab:GetParent() == strip and tab.template == "PanelTabButtonTemplate" and tab.text == LABELS[i] and tab.Text.text == LABELS[i] and tab:GetID() == i,
      "tab " .. i .. ": " .. LABELS[i] .. " on its label, ID " .. i .. " (" .. tostring(tab.Text.text) .. ", " .. tostring(tab:GetID()) .. ")")
  end
  -- The template sizes a tab from the strip's minTabWidth and maxTabWidth whenever it is shown, and
  -- on a display size change.
  local n = T.tabResizes or 0
  check(n >= 8, "the template's OnShow resized the shown tabs (" .. n .. " resizes)")
  T.fire("DISPLAY_SIZE_CHANGED")
  check((T.tabResizes or 0) >= n + 4, "and again on DISPLAY_SIZE_CHANGED")
  placed("after OnShow and a display size change")

  local function selected(i, what)
    local bad = {}
    if strip.selectedTab ~= i then bad[#bad + 1] = "the strip's selectedTab is " .. tostring(strip.selectedTab) end
    for k, tab in ipairs(tabs) do
      local on = k == i
      if tab:IsEnabled() == on then bad[#bad + 1] = "tab " .. k .. (on and " enabled" or " disabled") end
      if tab.LeftActive:IsShown() ~= on or tab.MiddleActive:IsShown() ~= on or tab.RightActive:IsShown() ~= on then bad[#bad + 1] = "tab " .. k .. " active art " .. (on and "hidden" or "shown") end
      if tab.Left:IsShown() == on or tab.Middle:IsShown() == on or tab.Right:IsShown() == on then bad[#bad + 1] = "tab " .. k .. " plain art " .. (on and "shown" or "hidden") end
      if pages[k]:IsShown() ~= on then bad[#bad + 1] = "page " .. k .. (on and " hidden" or " shown") end
    end
    for _, b in ipairs(levelProblems(c, i, true)) do bad[#bad + 1] = b end
    check(#bad == 0, what .. joined(bad))
  end
  selected(1, "Zone first: selected through the template")
  check(#setTabs >= 1 and setTabs[#setTabs].frame == strip and setTabs[#setTabs].id == 1, "through PanelTemplates_SetTab(strip, 1)")
  check(T.checkbox("Show the red zone"):IsVisible() and not T.checkbox("Lock in place"):IsVisible(), "only the Zone page's controls")
  for _, i in ipairs({ 2, 3, 4, 1, 3 }) do
    local sounds, calls = #T.sounds, #setTabs
    T.click(tabs[i])
    check(#T.sounds == sounds + 1 and T.sounds[#T.sounds].id == SOUNDKIT.IG_CHARACTER_INFO_TAB and SOUNDKIT.IG_CHARACTER_INFO_TAB == 841,
      LABELS[i] .. ": the tab sound, IG_CHARACTER_INFO_TAB (" .. tostring(T.sounds[#T.sounds] and T.sounds[#T.sounds].id) .. ")")
    check(#setTabs == calls + 1 and setTabs[#setTabs].frame == strip and setTabs[#setTabs].id == i, LABELS[i] .. ": PanelTemplates_SetTab(strip, " .. i .. ")")
    selected(i, LABELS[i] .. ": its tab selected and drawn so, only its page, the levels")
    check(pages[i]:IsVisible() and c.swTab == i, LABELS[i] .. ": its page on view")
  end
  check(T.checkbox("Say Stop, Moving, Late and Go"):IsVisible() and not T.checkbox("Show the red zone"):IsVisible(), "only the Alerts page's controls")
  T.closePanel()
  T.slash("")
  selected(3, "reopened: Alerts still selected")
  placed("reopened")

  check(tabs[3]:GetMotionScriptsWhileDisabled(), "the template's tabs run their motion scripts while disabled")
  check(T.hover(tabs[1]) and GameTooltip.shown and GameTooltip.owner == tabs[1] and T.tooltipHas("Zone") and T.tooltipHas(TIPS[1]), "hovering Zone: its tooltip")
  T.unhover(tabs[1])
  check(not GameTooltip.shown, "gone on leaving it")
  check(T.hover(tabs[3]) and T.tooltipHas("Alerts") and T.tooltipHas(TIPS[3]), "the selected tab, disabled by the template, still shows its tooltip")
  T.unhover(tabs[3])
  for i = 2, 4, 2 do
    T.hover(tabs[i])
    check(T.tooltipHas(LABELS[i]) and T.tooltipHas(TIPS[i]), LABELS[i] .. ": its tooltip")
    T.unhover(tabs[i])
  end
  T.hover(tabs[2])
  T.click(tabs[2])
  check(not GameTooltip.shown, "clicking the hovered tab: the template's SelectTab takes its tooltip down")
  check(T.hover(box) and T.tooltipHas("Preview") and T.tooltipHas("A made-up loop"), "the preview box has a tooltip saying what it shows")
  T.unhover(box)
  check(#T.unknownBut() == 0, "no widget field read that the client lacks" .. joined(T.unknownBut()))
  check(#T.errors == 0, "no errors")
`);

for (const [variant, label, setup] of [
  ['none', 'no PanelTabButtonTemplate or InsetFrameTemplate', 'T.templates.PanelTabButtonTemplate = nil T.templates.InsetFrameTemplate = nil SOUNDKIT.IG_CHARACTER_INFO_TAB = nil\n'],
  ['lacking', 'a tab template without LeftActive', 'T.tabTemplateWithout = "LeftActive"\n'],
]) {
  scenario('options tabs, plain (' + label + '): four plain tabs where the template\'s would be, their selection in colors, the pages, the sound, the box\'s border above them; the preview still runs', DISPLAY_HELPERS + TAB_HELPERS + 'local VARIANT = "' + variant + '"\n' + setup + String.raw`
  T.login(200)
  T.slash("")
  local c, box = T.content(), T.previewBox()
  local strip, tabs, pages = c.tabStrip, c.tabs, T.pages()
  check(c.tabStyle == "plain" and #tabs == 4, "plain tabs (" .. tostring(c.tabStyle) .. ")")
  local made = rawget(strip, "Tabs") or {}
  if VARIANT == "lacking" then
    check(#made == 1 and made[1]:IsShown() == false and made[1] ~= tabs[1], "the one template tab made before the fallback is hidden and left out")
  else
    check(#made == 0, "no template tab made")
  end
  check(rawget(strip, "numTabs") == nil, "no numTabs for PanelTemplates")
  local boxes = tabBoxes(c)
  check(boxes ~= nil, "tab 1 at the strip's top left, each next one LEFT on the last one's RIGHT")
  for i, tab in ipairs(tabs) do
    check(tab.template == nil and tab:IsVisible() and tab.width == TAB_W and tab.height == 24, "tab " .. i .. ": plain, shown, 120x24 (" .. tostring(tab.width) .. "x" .. tostring(tab.height) .. ")")
    check(tab.text == LABELS[i] and tab.Text and tab.Text.text == LABELS[i] and tab:GetFontString() == tab.Text and tab:GetID() == i, "tab " .. i .. ": labelled " .. LABELS[i])
    local tp = tab.Text.points
    check(#tp == 1 and tp[1][1] == "CENTER" and tp[1][2] == nil and (tp[1][4] or 0) == 0 and (tp[1][5] or 0) == 0, "tab " .. i .. ": its label centred both ways")
    local hl
    for _, t in ipairs(tab.textures) do if t.layer == "HIGHLIGHT" then hl = t end end
    check(tab.swBg and tab.swBg.layer == "BACKGROUND" and hl and hl.colorTex, "tab " .. i .. ": a color texture behind it and a highlight")
    local b = boxes and boxes[i]
    if b then
      local x = BOX_X + TAB_X + (i - 1) * (TAB_W + TAB_GAP)
      check(close(b.x0, x, 1e-9) and close(b.y0, PREVIEW_H - TAB_TUCK, 1e-9) and close(b.y1, PREVIEW_H - TAB_TUCK + 24, 1e-9),
        "tab " .. i .. " at " .. x .. ", its top 1 up under the box, level with the others (" .. num(b.x0) .. ", " .. num(b.y0) .. " to " .. num(b.y1) .. ")")
    end
  end
  if VARIANT == "none" then
    local bg = box.textures[1]
    local nine = box.NineSlice
    local lines = 0
    for _, t in ipairs(nine and nine.textures or {}) do
      if t.layer == "BORDER" and t.colorTex and (t.height == 1 or t.width == 1) then lines = lines + 1 end
    end
    check(box.template == nil and bg and bg.layer == "BACKGROUND" and bg.colorTex and near(bg.colorTex[1], 0) and near(bg.colorTex[4], 0.35), "the plain box: a dark color texture behind the preview")
    check(nine and nine:GetParent() == box and lines == 4, "and its four 1 px lines on a frame of their own (" .. lines .. ")")
  end
  local function selected(i, what)
    local bad = {}
    for k, tab in ipairs(tabs) do
      local on = k == i
      local bg = tab.swBg.colorTex
      local want = on and { 0.35, 0.28, 0.12, 1 } or { 0.12, 0.1, 0.07, 0.95 }
      if tab.selected ~= on then bad[#bad + 1] = "tab " .. k .. " selected " .. tostring(tab.selected) end
      if not (close(bg[1], want[1], 1e-9) and close(bg[2], want[2], 1e-9) and close(bg[3], want[3], 1e-9) and close(bg[4], want[4], 1e-9)) then bad[#bad + 1] = "tab " .. k .. " color" end
      if not tab:IsEnabled() then bad[#bad + 1] = "tab " .. k .. " disabled" end
      if pages[k]:IsShown() ~= on then bad[#bad + 1] = "page " .. k .. (on and " hidden" or " shown") end
    end
    if c.swTab ~= i then bad[#bad + 1] = "c.swTab " .. tostring(c.swTab) end
    for _, b in ipairs(levelProblems(c, i, false)) do bad[#bad + 1] = b end
    check(#bad == 0, what .. joined(bad))
  end
  selected(1, "Zone first")
  for _, i in ipairs({ 2, 3, 4, 1, 2 }) do
    local sounds = #T.sounds
    T.click(tabs[i])
    check(#T.sounds == sounds + 1 and T.sounds[#T.sounds].id == 841, LABELS[i] .. ": the tab sound, 841 (" .. tostring(T.sounds[#T.sounds] and T.sounds[#T.sounds].id) .. ")")
    selected(i, LABELS[i] .. ": its tab in the selected color, only its page")
  end
  check(T.checkbox("Lock in place"):IsVisible() and not T.checkbox("Show the red zone"):IsVisible(), "only the Display page's controls")
  T.closePanel()
  T.slash("")
  selected(2, "reopened on Display")
  T.hover(tabs[3])
  check(T.tooltipHas("Alerts") and T.tooltipHas(TIPS[3]), "the tooltips")
  T.unhover(tabs[3])
  T.update()
  check(T.isShown(T.preview().bar.stand) and T.preview():IsVisible(), "the preview runs")
  check(T.button("Defaults"):IsVisible(), "Defaults under the page")
  local allowed = VARIANT == "lacking" and { "Button.LeftActive" } or {}
  check(#T.unknownBut(allowed) == 0, "no widget field read that the client lacks, but the template's LeftActive looked for" .. joined(T.unknownBut(allowed)))
  check(#T.errors == 0, "no errors")
`);
}

scenario('options: /shotwindow debug names the tab style and the preview box', String.raw`
  T.login(200)
  T.slash("")
  T.slash("debug")
  check(T.said("tabs=PanelTabButtonTemplate"), "the debug report names the tab style, tabs=PanelTabButtonTemplate: BuildTabs sets optionsReport.tabs, but Debug() prints only page, open, window, slider, check, swatch and picker")
  check(T.said("preview=InsetFrameTemplate"), "the debug report names the preview box, preview=InsetFrameTemplate: BuildPreview sets optionsReport.preview, which Debug() never prints")
  check(#T.errors == 0, "no errors")
`);

scenario('options preview: the game\'s bar follows the Zone settings through the made-up loop (band, colors, alphas, pulse, hold, line, fill, tint, pip, time, late readout); a Zone change shows on the next frame', DISPLAY_HELPERS + PREVIEW_HELPERS + String.raw`
  T.login(200)
  local db = ShotWindowDB
  T.slash("")
  local stage = T.preview()
  local g = stage and stage.bar
  check(g and stage:IsVisible() and g.frame:IsVisible() and T.pages()[1]:IsVisible(), "the preview's game bar over the Zone tab")
  startLoop()
  -- Blizzard_SwingTimer.xml: a 240x30 frame, its StatusBar 5 in from the sides and 4 from the top and bottom.
  local a, b = g.sb.points[1], g.sb.points[2]
  check(g.frame.width == 240 and g.frame.height == 30 and #g.sb.points == 2 and a[1] == "TOPLEFT" and a[2] == 5 and a[3] == -4
    and b[1] == "BOTTOMRIGHT" and b[2] == -5 and b[3] == 4 and g.sw == SW, "the status area 5 in from the sides, 4 from the top and bottom")
  -- The marks on the real bar's layers: tint 5, band 6, line 7, over the fill at 0; the pip over them.
  local rt = T.tex()
  check(g.fill.layer == "ARTWORK" and g.fill.sublevel == 0 and g.tint.layer == "ARTWORK" and g.tint.sublevel == T.fillTint().sublevel
    and g.stand.layer == rt.stand.layer and g.stand.sublevel == rt.stand.sublevel and g.line.layer == rt.line.layer and g.line.sublevel == rt.line.sublevel
    and g.pip.layer == "OVERLAY", "the marks on the real bar's layers")
  local fp = g.fill.points
  check(#fp == 2 and fp[1][1] == "TOPLEFT" and fp[1][2] == nil and fp[2][1] == "BOTTOMLEFT" and fp[2][2] == nil, "the fill from the status area's top left and bottom left: its full height")
  check(g.tint.points[1] and g.tint.points[1][1] == "ALL" and g.tint.points[1][2] == g.fill, "the tint laid over the fill")
  local pp = g.pip.points[1]
  check(pp and pp[1] == "RIGHT" and pp[2] == g.fill and pp[3] == "RIGHT" and pp[4] == 0 and pp[5] == 0, "the pip on the fill's right end, centred on it")
  check(g.typeFS.text == SWING_TIMER_RANGED and g.typeFS.points[1][1] == "LEFT" and g.typeFS.points[1][2] == 10 and g.typeFS.points[1][3] == 0
    and g.timeFS.points[1][1] == "RIGHT" and g.timeFS.points[1][2] == -10 and g.timeFS.points[1][3] == 0, "Ranged on the left, the time on the right, 10 in, both on the status area's middle line")
  -- The late readout where the real bar has it: its bottom right 2 over the bar's top right.
  local lp, rp = g.late.points[1], T.lateLabel().points[1]
  check(lp and rp and lp[1] == rp[1] and lp[2] == g.sb and rp[2] == T.bar and lp[3] == rp[3] and lp[4] == rp[4] and lp[5] == rp[5] and lp[5] == 2,
    "the late readout anchored as on the real bar (" .. tostring(lp and lp[1]) .. " on " .. tostring(lp and lp[3]) .. ", " .. tostring(lp and lp[5]) .. " up)")

  -- want: band = x or false; color, alpha, pulse; line = x or false (lineWidth); fill = p or false;
  -- tint = color or false; time; late = text or false.
  local function bar(label, want)
    local bad = {}
    local x, width = bandOf(g)
    if want.band == false then
      if x ~= nil then bad[#bad + 1] = "band shown at " .. tostring(x) end
    else
      if not (close(x, want.band, 1e-9) and close(width, math.max(1, SW - want.band), 1e-9)) then
        bad[#bad + 1] = "band at " .. tostring(x) .. " (width " .. tostring(width) .. "), want " .. num(want.band) .. " to " .. SW
      end
      if not colorIs(g.stand, want.color, want.alpha) then bad[#bad + 1] = "band color " .. colorStr(g.stand) .. ", want alpha " .. num(want.alpha) end
      local pa = rawget(g.stand, "alpha") or 1
      if not close(pa, want.pulse or 1, 1e-6) then bad[#bad + 1] = "band's own alpha " .. num(pa) .. ", want " .. num(want.pulse or 1) end
    end
    local lx = lineOf(g)
    if want.line == false then
      if lx ~= nil then bad[#bad + 1] = "line shown at " .. tostring(lx) end
    else
      if not close(lx, want.line, 1e-9) then bad[#bad + 1] = "line at " .. tostring(lx) .. ", want " .. num(want.line) end
      if g.line.width ~= (want.lineWidth or 2) or not colorIs(g.line, db.lineColor, 0.95) then bad[#bad + 1] = "line " .. tostring(g.line.width) .. " px in " .. colorStr(g.line) end
    end
    if want.fill then
      if not (T.isShown(g.fill) and close(g.fill.width, math.max(1, SW * want.fill), 1e-9)) then bad[#bad + 1] = "fill " .. tostring(T.isShown(g.fill)) .. " " .. num(g.fill.width) .. ", want " .. num(SW * want.fill) end
      if not T.isShown(g.pip) then bad[#bad + 1] = "pip hidden" end
    else
      if T.isShown(g.fill) or T.isShown(g.pip) then bad[#bad + 1] = "fill or pip shown while the bar is empty" end
    end
    if want.tint then
      if not (T.isShown(g.tint) and colorIs(g.tint, want.tint, db.fillAlpha)) then bad[#bad + 1] = "tint " .. tostring(T.isShown(g.tint)) .. " " .. colorStr(g.tint) end
    elseif T.isShown(g.tint) then bad[#bad + 1] = "tint shown" end
    if g.timeFS.text ~= want.time then bad[#bad + 1] = "time " .. tostring(g.timeFS.text) .. ", want " .. want.time end
    if want.late then
      if not (g.late:IsShown() and g.late.text == want.late and sameRGB(g.late.textColor, db.clipColor)) then bad[#bad + 1] = "late readout " .. tostring(g.late:IsShown()) .. " " .. tostring(g.late.text) end
    elseif g.late:IsShown() then bad[#bad + 1] = "late readout shown (" .. tostring(g.late.text) .. ")" end
    check(#bad == 0, label .. (#bad > 0 and (": " .. table.concat(bad, "; ")) or ""))
  end

  local RED, CLIP = db.color, db.clipColor
  local zx = SW * 2.3 / 2.8 -- (dur - lead) / dur of the status width: 2.8 s, the last 0.5 s
  at(1.0) bar("1.0 s: before the zone", { band = zx, color = RED, alpha = 0.35, line = zx, fill = 1.0 / 2.8, time = "1.8" })
  at(2.5) bar("2.5 s: in the zone, brightened", { band = zx, color = RED, alpha = 0.65, line = zx, fill = 2.5 / 2.8, time = "0.3" })
  at(5.2) bar("the second swing, moving in the zone: clipping", { band = zx, color = CLIP, alpha = 0.65, line = zx, fill = 2.4 / 2.8, time = "0.4" })
  at(5.7) bar("waiting, 0.1 s: lit, no pulse yet, the bar empty", { band = zx, color = RED, alpha = 0.65, line = zx, fill = false, time = "0.0" })
  at(5.95) bar("waiting, 0.35 s: pulsing", { band = zx, color = RED, alpha = 0.65, pulse = pulseAt(0.35), line = zx, fill = false, time = "0.0" })
  at(6.1) bar("waiting, 0.5 s: pulsing", { band = zx, color = RED, alpha = 0.65, pulse = pulseAt(0.5), line = zx, fill = false, time = "0.0" })
  at(6.7) bar("the third swing: how late the last shot was, on the bar", { band = zx, color = RED, alpha = 0.35, line = zx, fill = 0.5 / 2.8, time = "2.3", late = "+0.60" })
  check(not stage.late:IsShown(), "no display: nothing under a display")
  at(7.8) bar("1.6 s into it: the readout gone", { band = zx, color = RED, alpha = 0.35, line = zx, fill = 1.6 / 2.8, time = "1.2" })

  -- The Zone page's options, each on the next frame.
  T.click(T.checkbox("Tint the fill inside the zone"))
  check(db.fillTint == true, "fill tint on")
  at(2.5) bar("fill tint: the fill tinted while lit", { band = zx, color = RED, alpha = 0.65, line = zx, fill = 2.5 / 2.8, tint = db.fillColor, time = "0.3" })
  at(1.0) bar("fill tint: not before the zone", { band = zx, color = RED, alpha = 0.35, line = zx, fill = 1.0 / 2.8, time = "1.8" })
  at(5.2) bar("fill tint: the clip color while moving", { band = zx, color = CLIP, alpha = 0.65, line = zx, fill = 2.4 / 2.8, tint = CLIP, time = "0.4" })
  at(5.7) bar("fill tint: nothing to tint while waiting", { band = zx, color = RED, alpha = 0.65, line = zx, fill = false, time = "0.0" })
  T.click(T.checkbox("Brighten inside the zone"))
  at(2.5) bar("flash off: the idle alpha inside the zone", { band = zx, color = RED, alpha = 0.35, line = zx, fill = 2.5 / 2.8, tint = db.fillColor, time = "0.3" })
  T.click(T.checkbox("Brighten inside the zone"))
  T.click(T.checkbox("Pulse while waiting for a late shot"))
  at(5.95) bar("pulse off: lit and steady while waiting", { band = zx, color = RED, alpha = 0.65, line = zx, fill = false, time = "0.0" })
  T.click(T.checkbox("Pulse while waiting for a late shot"))
  T.click(T.checkbox("Keep the zone lit until the shot fires"))
  check(db.hold == false, "hold off")
  at(5.7) bar("hold off: the bar just ends", { band = zx, color = RED, alpha = 0.35, line = zx, fill = false, time = "0.0" })
  at(5.95) bar("hold off: nothing pulses", { band = zx, color = RED, alpha = 0.35, line = zx, fill = false, time = "0.0" })
  at(6.7) bar("hold off: nothing measures a late shot", { band = zx, color = RED, alpha = 0.35, line = zx, fill = 0.5 / 2.8, time = "2.3" })
  T.click(T.checkbox("Keep the zone lit until the shot fires"))
  T.click(T.checkbox("Show the marker line"))
  at(1.0) bar("line off", { band = zx, color = RED, alpha = 0.35, line = false, fill = 1.0 / 2.8, time = "1.8" })
  T.click(T.checkbox("Show the marker line"))
  T.drag(T.slider("Thickness"), 4)
  T.click(T.swatch("Line color")) T.pickColor(0.1, 0.9, 0.2) T.pickerOkay()
  at(1.0) bar("line 4 px in the picked color", { band = zx, color = RED, alpha = 0.35, line = zx, lineWidth = 4, fill = 1.0 / 2.8, time = "1.8" })
  check(sameRGB(db.lineColor, { 0.1, 0.9, 0.2 }), "the line color picked")
  T.click(T.checkbox("Show the red zone"))
  at(1.0) bar("band off: the line stays", { band = false, line = zx, lineWidth = 4, fill = 1.0 / 2.8, time = "1.8" })
  T.click(T.checkbox("Show the red zone"))
  T.click(T.swatch("Zone color")) T.pickColor(0.2, 0.3, 0.9) T.pickerOkay()
  at(1.0) bar("the picked zone color", { band = zx, color = { 0.2, 0.3, 0.9 }, alpha = 0.35, line = zx, lineWidth = 4, fill = 1.0 / 2.8, time = "1.8" })
  RED = db.color
  T.drag(T.slider("Zone opacity"), 50)
  at(1.0) bar("zone opacity 50%", { band = zx, color = RED, alpha = 0.5, line = zx, lineWidth = 4, fill = 1.0 / 2.8, time = "1.8" })
  T.drag(T.slider("Fill opacity"), 40)
  at(2.5) bar("fill opacity 40%", { band = zx, color = RED, alpha = 0.65, line = zx, lineWidth = 4, fill = 2.5 / 2.8, tint = db.fillColor, time = "0.3" })
  check(near(db.fillAlpha, 0.4), "fill alpha 0.4")
  T.drag(T.slider("Aim window (the shot's wind-up)"), 800)
  T.update()
  local x8 = SW * 2.0 / 2.8
  local px = bandOf(g)
  check(close(px, x8, 1e-9) and close(lineOf(g), x8, 1e-9), "aim window 0.80 s: the band and line move on the next frame (" .. num(px) .. ", want " .. num(x8) .. ")")
  local rx = T.span(rt.stand)
  check(close(px / SW, rx / 200, 1e-9), "at the same fraction of the bar as on the game's own bar (" .. num(px / SW) .. ", " .. num(rx / 200) .. ")")
  -- A lead as long as the swing: the band from the start, and no line at x = 0.
  T.speed.rng = 1.0
  T.drag(T.slider("Aim window (the shot's wind-up)"), 1000)
  at(0.5)
  local bx, bw = bandOf(g)
  check(bx == 0 and close(bw, SW, 1e-9) and lineOf(g) == nil, "a 1 s lead on a 1 s weapon: the band from 0 across the bar, no line at 0 (" .. tostring(bx) .. ", " .. tostring(lineOf(g)) .. ")")
  T.drag(T.slider("Aim window (the shot's wind-up)"), 0)
  T.update()
  check(bandOf(g) == nil and lineOf(g) == nil, "no lead: no band and no line")
  T.speed.rng = 2.8
  T.drag(T.slider("Aim window (the shot's wind-up)"), 500)
  -- Moving does not clip with the warning off.
  T.click(T.tab(3))
  T.click(T.checkbox("Warn when I move inside the zone"))
  at(5.2) bar("warning off: no clip color", { band = zx, color = RED, alpha = 0.65, line = zx, lineWidth = 4, fill = 2.4 / 2.8, tint = db.fillColor, time = "0.4" })
  T.click(T.checkbox("Warn when I move inside the zone"))
  -- With a display of its own the late readout moves under it.
  T.slash("display classic")
  at(6.7)
  check(not g.late:IsShown() and stage.late:IsShown() and stage.late.text == "+0.60" and sameRGB(stage.late.textColor, db.clipColor),
    "a display: the late readout under it, not on the bar")
  local lp = stage.late.points[1]
  check(lp and lp[1] == "TOPRIGHT" and lp[2] == stage.renderer.frame and lp[3] == "BOTTOMRIGHT" and lp[4] == 0 and lp[5] == -2, "under the display's right end")
  T.click(T.tab(1))
  T.click(T.checkbox("Keep the zone lit until the shot fires"))
  at(6.7)
  check(not g.late:IsShown() and not stage.late:IsShown(), "hold off: no late readout under the display either")
  check(#T.unknownBut() == 0, "no widget field read that the client lacks" .. (#T.unknownBut() > 0 and (": " .. table.concat(T.unknownBut(), ", ")) or ""))
  check(#T.errors == 0, "no errors")
`);

scenario('options preview: the layout: no display puts the game\'s bar in the middle; a display puts the bar in the left quarter and the display in the right one; on the bar both in the middle, the display above it; all on one middle line under the names; the display scaled to fit its cell; the call-out at most 20 pt', DISPLAY_HELPERS + PREVIEW_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  T.slash("")
  local stage = T.preview()
  local g, r = stage.bar, stage.renderer
  local cell = r.frame:GetParent()
  local WIDTH, HEIGHT, NAMES_ROW, CALLOUT_ROW, BOTTOMROOM = 584, 132, 18, 22, 14
  local TOPROW = NAMES_ROW + CALLOUT_ROW -- the drawing starts under the names and the call-out
  local MID = -(TOPROW + (HEIGHT - TOPROW - BOTTOMROOM) / 2) -- the middle of the room for the drawing
  check(stage.width == WIDTH and stage.height == HEIGHT and cell:GetParent() == stage and cell.points[1] and cell.points[1][1] == "ALL", "the stage and the display's cell fill the 584x132 box")
  startLoop()
  local words = stage.say:GetParent()
  local barName = textOn(words, "The game's swing bar")
  local bp, dp = barName and barName.points[1], stage.dispName.points[1]
  check(bp and bp[1] == "TOPLEFT" and bp[2] == 8 and bp[3] == -5, "the bar's name at the top left, 8 in and 5 down")
  check(dp and dp[1] == "TOPRIGHT" and dp[2] == -8 and dp[3] == -5 and stage.dispName.justifyH == "RIGHT", "the display's name at the top right, on the same line, flush right")
  check(cell:GetFrameLevel() > g.frame:GetFrameLevel() and cell:GetFrameLevel() > g.sb:GetFrameLevel() and words:GetFrameLevel() > cell:GetFrameLevel(),
    "the display's cell above the bar, the words above both (" .. g.frame:GetFrameLevel() .. ", " .. cell:GetFrameLevel() .. ", " .. words:GetFrameLevel() .. ")")
  local function barAt(x, label)
    local bx, by = landsAt(g.frame, stage)
    check(close(bx, x, 1e-9) and close(by, MID, 1e-9), label .. ": the bar centred at (" .. x .. ", " .. MID .. ") (got " .. num(bx) .. ", " .. num(by) .. ")")
    check(by and -by - 15 >= TOPROW and -by + 15 <= HEIGHT - BOTTOMROOM, label .. ": the bar between the names and the room under it")
  end
  local function sayAt(x, label)
    local p = stage.say.points[1]
    check(#stage.say.points == 1 and p[1] == "TOP" and p[2] == stage and p[3] == "TOPLEFT" and close(p[4], x, 1e-9) and p[5] == -NAMES_ROW,
      label .. ": the call-out over x = " .. x .. ", in its own row under the names (" .. tostring(p and p[4]) .. ", " .. tostring(p and p[5]) .. ")")
  end
  local function dispAt(x, fitW, label)
    local s = r.frame:GetScale()
    local fit = math.min(1, fitW / r.w, (HEIGHT - TOPROW - BOTTOMROOM) / r.h)
    check(close(s, fit, 0.002), label .. ": scaled to fit its cell, " .. fitW .. " by " .. (HEIGHT - TOPROW - BOTTOMROOM) .. " (" .. num(s) .. ", want " .. num(fit) .. ")")
    check(r.w * s <= fitW + 0.01 and r.h * s <= HEIGHT - TOPROW - BOTTOMROOM + 0.01, label .. ": " .. num(r.w * s) .. "x" .. num(r.h * s) .. " drawn, within the cell")
    local dx, dy = landsAt(r.frame, cell)
    check(close(dx, x, 0.01) and close(dy, MID, 0.01), label .. ": the display centred at (" .. x .. ", " .. MID .. "), on the bar's middle line (lands at "
      .. num(dx) .. ", " .. num(dy) .. " at scale " .. num(s) .. ")")
    local rp = r.frame.points[1]
    check(#r.frame.points == 1 and rp[1] == "CENTER" and rp[3] == "CENTER" and (rp[4] or 0) == 0 and (rp[5] or 0) == 0 and (rawget(rp[2], "scale") or 1) == 1,
      label .. ": the display hangs from an unscaled slot with no offsets, so its scale cannot move it")
  end

  at(1.0)
  barAt(WIDTH / 2, "no display")
  sayAt(WIDTH / 2, "no display")
  check(not r.frame:IsVisible() and stage.dispName.text == "No display of its own", "no display: none drawn, and the name says so")

  for _, d in ipairs({ "classic", "ring", "vpincer" }) do
    T.slash("display " .. d)
    at(1.0)
    check(r.frame:IsVisible() and r.design == d and stage.dispName.text == "Display: " .. NS.DISPLAY_NAMES[d], d .. ": drawn and named")
    barAt(WIDTH / 4, d .. " beside")
    dispAt(WIDTH * 3 / 4, WIDTH / 2 - 24, d .. " beside")
    sayAt(WIDTH * 3 / 4, d .. " beside")
  end
  T.slash("display classic")
  T.click(T.tab(2))
  T.click(T.checkbox("Sit on the game's swing bar"))
  check(db.dispOnBar == true, "on the bar")
  for _, d in ipairs({ "classic", "ring" }) do
    T.slash("display " .. d)
    at(1.0)
    check(stage.dispName.text == "Display: " .. NS.DISPLAY_NAMES[d] .. ", on the bar", d .. " on the bar: named so (" .. tostring(stage.dispName.text) .. ")")
    barAt(WIDTH / 2, d .. " on the bar")
    dispAt(WIDTH / 2, WIDTH - 24, d .. " on the bar")
    sayAt(WIDTH / 2, d .. " on the bar")
    check(cell:GetFrameLevel() > g.frame:GetFrameLevel() and r.frame:IsVisible(), d .. " on the bar: drawn above it")
  end
  T.slash("display none")
  at(1.0)
  barAt(WIDTH / 2, "none again")
  check(not r.frame:IsVisible(), "none again: no display")

  -- The call-out: at most 20 pt here, whatever size it is set to.
  T.click(T.tab(3))
  T.click(T.checkbox("Say Stop, Moving, Late and Go"))
  at(2.5)
  check(stage.say:IsShown() and stage.say.text == "Stop" and stage.say.fontSize == 20, "26 pt set: Stop at 20 pt (" .. tostring(stage.say.fontSize) .. ")")
  T.drag(T.slider("Text size"), 14)
  at(2.6)
  check(stage.say.fontSize == 14, "14 pt set: 14 pt (" .. tostring(stage.say.fontSize) .. ")")
  T.drag(T.slider("Text size"), 60)
  at(5.2)
  check(stage.say.text == "Moving" and stage.say.fontSize == 20, "60 pt set: 20 pt, Moving (" .. tostring(stage.say.fontSize) .. ")")
  check(#T.unknownBut() == 0, "no widget field read that the client lacks" .. (#T.unknownBut() > 0 and (": " .. table.concat(T.unknownBut(), ", ")) or ""))
  check(#T.errors == 0, "no errors")
`);

// The preview's game bar in the window styles, and without atlas info.
const EUI_LOOK_PRE = EUI_PRE + String.raw`
  EUI_S.SetTabSelection = function(tab, on) EUISEL = EUISEL or {} EUISEL[#EUISEL + 1] = { tab, on } end
`;
for (const [look, label, pre, setup] of [
  ['blizzard', 'Blizzard: the swing timer art', null, ''],
  ['dark', 'Dark: flat, the accent fill', null, 'ShotWindowDB = { style = "dark" }\n'],
  ['eui', 'the EllesmereUI stand-in: flat in its colors', EUI_LOOK_PRE, ''],
  ['live', 'Blizzard, then Dark chosen on the Look tab', null, ''],
  ['missing', 'no C_Texture.GetAtlasInfo: flat', null, 'T.atlasMode = "missing"\n'],
  ['nil', 'GetAtlasInfo answers nothing: flat', null, 'T.atlasMode = "nil"\n'],
  ['error', 'GetAtlasInfo raises: flat', null, 'T.atlasMode = "error"\n'],
]) {
  scenario('options preview look (' + label + '): the game\'s bar drawn as the style draws the real one', DISPLAY_HELPERS + PREVIEW_HELPERS + 'local LOOK = "' + look + '"\n' + setup + String.raw`
  GameFontNormal = { GetFont = function() return "Fonts\\STYLE.TTF", 12, "" end } -- read by Dark's GetFont
  T.login(200)
  if LOOK == "eui" then EUI_FN(EUI_S) end
  T.fire("PLAYER_ENTERING_WORLD")
  T.slash("")
  local stage = T.preview()
  local g = stage.bar
  startLoop()
  at(1.0)
  if LOOK == "live" then
    check(g.bg.atlas == "ui-swingtimerbar-background" and T.isShown(g.bg), "Blizzard first: the art")
    T.click(T.tab(4))
    T.click(T.button("Window style: Automatic"), "RightButton")
    check(NS.Styles.Applied() == "dark", "Dark chosen")
    T.update()
  end
  local ART = LOOK == "blizzard"
  local STYLED = LOOK == "dark" or LOOK == "eui" or LOOK == "live"
  local function shownAtlases()
    local list = {}
    for _, f in ipairs({ g.frame, g.sb }) do
      for _, t in ipairs(f.textures) do if T.isShown(t) and rawget(t, "atlas") then list[#list + 1] = t.atlas end end
    end
    return list
  end
  if ART then
    check(g.bg.atlas == "ui-swingtimerbar-background" and T.isShown(g.bg) and g.bg.points[1][1] == "ALL" and g.bg.layer == "BACKGROUND" and g.bg.sublevel == 0,
      "the background atlas over the whole frame")
    check(g.border.atlas == "ui-swingtimerbar-frame" and T.isShown(g.border) and g.border.points[1][1] == "ALL" and g.border.layer == "BACKGROUND" and g.border.sublevel == 1,
      "the frame atlas over it")
    local v = rawget(g.fill, "vertex")
    check(g.fill.atlas == "ui-swingtimerbar-filling-ranged" and v and v[1] == 1 and v[2] == 1 and v[3] == 1 and v[4] == 1, "the ranged fill, untinted")
    check(g.pip.atlas == "ui-swingtimerbar-pip" and T.isShown(g.pip), "the pip")
    local sp = g.shadow.points
    check(g.shadow.atlas == "ui-swingtimerbar-textshadow-left" and T.isShown(g.shadow) and g.shadow.width == 171 and #sp == 2 and sp[1][1] == "TOPLEFT" and sp[2][1] == "BOTTOMLEFT",
      "the label's shadow, 171 wide, the status area's height")
    local edges = 0
    for i = 1, 4 do if T.isShown(g.edges[i]) then edges = edges + 1 end end
    check(not T.isShown(g.track) and edges == 0, "no flat track or edges")
    local l, rr, tt, bb = T.atlasCoords("ui-swingtimerbar-filling-ranged")
    for _, s in ipairs({ { 0.3, 0.3 / 2.8 }, { 1.0, 1.0 / 2.8 }, { 1.9, 1.9 / 2.8 }, { 2.75, 2.75 / 2.8 }, { 3.5, 0.7 / 2.8 } }) do
      at(s[1])
      local p, tc = s[2], rawget(g.fill, "texCoord")
      check(tc and close(tc[1], l, 1e-12) and close(tc[2], l + (rr - l) * p, 1e-12) and close(tc[3], tt, 1e-12) and close(tc[4], bb, 1e-12)
        and close(g.fill.width, SW * p, 1e-9), num(s[1]) .. " s: the fill reveals exactly " .. num(p) .. " of the art, across " .. num(SW * p) .. " px ("
        .. (tc and (num(tc[1]) .. ".." .. num(tc[2]) .. ", " .. num(tc[3]) .. ".." .. num(tc[4])) or "no texcoord") .. ", " .. num(g.fill.width) .. " px)")
    end
    check(g.typeFS.fontCalls == nil, "the game's label font")
  else
    local shown = shownAtlases()
    local others = {}
    for _, a in ipairs(shown) do if a ~= "ui-swingtimerbar-textshadow-left" then others[#others + 1] = a end end
    check(#others == 0, "no bar art shown" .. (#others > 0 and (" (" .. table.concat(others, ", ") .. ")") or ""))
    check(not T.isShown(g.bg) and not T.isShown(g.border) and T.isShown(g.track), "flat: a track in place of the art")
    if STYLED then
      check(T.isShown(g.shadow) and g.shadow.atlas == "ui-swingtimerbar-textshadow-left", "the text shadow kept, as the real flat bar keeps it")
    end
    local tc, ac, ec
    if STYLED then
      local r0, g0, b0 = NS.Styles.S.GetPanelColor()
      local ar, ag, ab = NS.Styles.S.GetAccentColor()
      tc, ac, ec = { r0, g0, b0, 0.85 }, { ar, ag, ab, 1 }, { 0, 0, 0, 1 }
    else
      tc, ac, ec = { 0.05, 0.05, 0.06, 0.7 }, { 0.85, 0.62, 0.2, 1 }, { 0.8, 0.65, 0.3, 0.9 }
    end
    check(colorIs(g.track, tc, tc[4]), "the track " .. colorStr(g.track))
    check(colorIs(g.fill, ac, 1) and T.isShown(g.fill) and close(g.fill.width, SW / 2.8, 1e-9), "the fill in the accent " .. colorStr(g.fill))
    local edges = 0
    for i = 1, 4 do if T.isShown(g.edges[i]) and colorIs(g.edges[i], ec, ec[4]) then edges = edges + 1 end end
    check(edges == 4, "a 1 px edge round the status area (" .. edges .. ")")
    local pips = 0
    for _, t in ipairs({ 0.5, 1.5, 2.5, 5.2, 5.9, 6.7 }) do at(t) if T.isShown(g.pip) then pips = pips + 1 end end
    check(pips == 0, "no pip art at any point (" .. pips .. ")")
    if STYLED then
      -- As FlatBar does to the real labels: the game's font, then the style's Font (Dark's changes nothing).
      local function gameFont(fs) local f = rawget(fs, "font") return f ~= nil and (f == GameFontHighlightSmall or f == "GameFontHighlightSmall") end
      check(gameFont(g.typeFS) and gameFont(g.timeFS) and g.typeFS.fontCalls == nil,
        "the labels in the game's font, as the real bar's (" .. tostring(g.typeFS.fontFile) .. ")")
      if LOOK == "eui" then
        check((EUIDONE[g.typeFS] or ""):find("Font", 1, true) and (EUIDONE[g.timeFS] or ""):find("Font", 1, true),
          "and handed to EllesmereUI's Font, as the real bar's are")
      end
    end
  end
  at(2.5)
  local x = SW * 2.3 / 2.8
  check(T.isShown(g.stand) and close(g.stand.points[1][4], x, 1e-9) and rawget(g.stand, "colorTex")[4] == 0.65, "the zone over it as before")
  check(#T.unknownBut() == 0, "no widget field read that the client lacks" .. (#T.unknownBut() > 0 and (": " .. table.concat(T.unknownBut(), ", ")) or ""))
  check(#T.errors == 0, "no errors")
`, pre || undefined);
}

scenario('options layout: every control on the four pages lies on its page, below the tabs, above the Defaults row and inside the content width; the preview box spans W - 16; the canvas page hides its title and keeps scale 1 on the 665x601 canvas', DISPLAY_HELPERS + TAB_HELPERS + String.raw`
  T.login(200)
  T.slash("")
  local c, page = T.content(), T.page()
  local pages = T.pages()
  check(c.width == W and c.height == CONTENT_H and #pages == 4, "the content 600x581 with four pages")
  local box = c.previewBox
  local bp = box.points[1]
  check(#box.points == 1 and bp[1] == "TOPLEFT" and bp[2] == BOX_X and bp[3] == 0 and box.width == BOX_W and box.height == PREVIEW_H,
    "the preview box at the top, 8 in from either side: " .. BOX_W .. " wide")
  local reset = T.button("Defaults")
  local rp = reset.points[1]
  local resetTop = CONTENT_H - rp[3] - reset.height -- y down
  check(rp[1] == "BOTTOMLEFT" and resetTop > PAGE_TOP + PAGE_H, "the Defaults row under the pages (its top at " .. resetTop .. ")")
  local tabBottom = 0
  for _, b in ipairs(tabBoxes(c) or {}) do tabBottom = math.max(tabBottom, b.y1) end
  check(tabBottom > 0 and tabBottom <= PAGE_TOP, "the tabs end (" .. tabBottom .. ") before the pages start (" .. PAGE_TOP .. ")")
  -- Text the way the stub measures it: 6 px a character, about 14 px a line (plus any spacing).
  local function textBox(fs)
    local text = rawget(fs, "text") or ""
    local w = rawget(fs, "width") or 0
    local lines = 0
    for para in (text .. "\n"):gmatch("(.-)\n") do lines = lines + ((w > 0) and math.max(1, math.ceil(#para * 6 / w)) or 1) end
    return (w > 0) and w or fs:GetStringWidth(), lines * (14 + (rawget(fs, "spacing") or 0))
  end
  local labels = { "Zone", "Display", "Alerts", "Look" }
  for i, p in ipairs(pages) do
    local pp = p.points[1]
    check(pp[1] == "TOPLEFT" and pp[2] == 0 and pp[3] == -PAGE_TOP and p.width == W and p.height == PAGE_H, labels[i] .. ": the page at " .. PAGE_TOP .. ", 600x384")
    local out, n = {}, 0
    local function place(what, x0, y0, x1, y1)
      n = n + 1
      if x0 < 0 or x1 > W or y0 < 0 or y1 > PAGE_H then
        out[#out + 1] = what .. string.format(" (%.0f,%.0f to %.0f,%.0f)", x0, y0, x1, y1)
      end
    end
    for _, f in ipairs(p.children) do
      local a = f.points[1]
      if a and a[1] == "TOPLEFT" and type(a[2]) == "number" and type(a[3]) == "number" then
        local x0, y0 = a[2], -a[3]
        place(f.kind .. " " .. tostring(rawget(f, "text") or ""), x0, y0, x0 + f.width, y0 + f.height)
        -- a checkbox's or swatch's label, LEFT on its RIGHT
        for _, fs in ipairs(f.fontStrings) do
          local q = fs.points[1]
          if q and q[1] == "LEFT" and q[2] == f and q[3] == "RIGHT" then
            local w = fs:GetStringWidth()
            place("label " .. tostring(fs.text), x0 + f.width + q[4], y0, x0 + f.width + q[4] + w, y0 + f.height)
          end
        end
      end
    end
    for _, fs in ipairs(p.fontStrings) do
      local a = fs.points[1]
      if a and a[1] == "TOPLEFT" and type(a[2]) == "number" then
        local w, h = textBox(fs)
        place("text " .. tostring(fs.text):sub(1, 30), a[2], -a[3], a[2] + w, -a[3] + h)
      end
    end
    for _, t in ipairs(p.textures) do
      local a = t.points[1]
      if a and a[1] == "TOPLEFT" and type(a[2]) == "number" then place("rule", a[2], -a[3], a[2] + t.width, -a[3] + t.height) end
    end
    check(n >= 6 and #out == 0, labels[i] .. ": " .. n .. " pieces on the page, all inside it" .. (#out > 0 and (": not " .. table.concat(out, ", ")) or ""))
  end
  -- The canvas page: the preview in the title's place, the content 6 in and 10 down at full size.
  local title = page.fontStrings[1]
  check(title and title.text == "Shot Window" and title.shown == false, "the page's own title hidden while the tabs show")
  local cp = c.points[1]
  check(T.canvas.width == 665 and T.canvas.height == 601 and c:GetScale() == 1 and cp[1] == "TOPLEFT" and cp[2] == page and cp[4] == 6 and cp[5] == -10,
    "scale 1 on the 665x601 canvas, 6 in and 10 down (" .. tostring(c:GetScale()) .. ", " .. tostring(cp[4]) .. ", " .. tostring(cp[5]) .. ")")
  check(10 + CONTENT_H <= 601 and 6 + W <= 665, "the content fits the canvas")
  check(#T.errors == 0, "no errors")
`);

scenario('options layout: a class without Auto Shot or a wand: no tabs or preview, the page keeps its title and shows the look under it', String.raw`
  T.className, T.class = "Rogue", "ROGUE"
  T.login(200)
  T.slash("")
  local page = T.page()
  local c
  for _, f in ipairs(T.frames) do if rawget(f, "parent") == page and rawget(f, "swParts") then c = f end end
  check(c ~= nil and c:IsVisible() and rawget(c, "tabs") == nil and rawget(c, "pages") == nil and rawget(c, "preview") == nil and rawget(c, "previewBox") == nil,
    "no tabs, pages or preview")
  local title = page.fontStrings[1]
  check(title and title.text == "Shot Window" and title.shown == true, "the page's title shown")
  -- A short page of its own (Defaults sits at its bottom), so it is not scaled down.
  check(c and c.height == 210, "a short page, 210 high (" .. tostring(c and c.height) .. ")")
  local cp, want = c and c.points[1], 1
  check(cp and near(c:GetScale(), want) and near(cp[4] * want, 6) and near(cp[5] * want, -42), "the content under the title, 6 in and 42 down at scale " .. want .. " (" .. tostring(c and c:GetScale()) .. ")")
  local look
  for _, fs in ipairs(c and c.fontStrings or {}) do if rawget(fs, "text") == "Look" then look = fs end end
  check(look ~= nil and look:IsVisible(), "the Look section")
  check(#T.errors == 0, "no errors")
`);

for (const [style, label, pre] of [['dark', 'Dark', null], ['eui', 'the EllesmereUI stand-in', EUI_LOOK_PRE]]) {
  scenario('options tabs in a window style (' + label + '): the window copy\'s tabs go to S().Tab, its preview box to S().Panel as an inset, the selection to S().SetTabSelection on every ShowTab; the Options page copy is not restyled', STYLE_HELPERS + TAB_HELPERS + 'local STYLE = "' + style + '"\n' + String.raw`
  if STYLE == "dark" then ShotWindowDB = { style = "dark" } end
  T.openFails = true
  T.login(200)
  if STYLE == "eui" then EUI_FN(EUI_S) end
  T.fire("PLAYER_ENTERING_WORLD")
  local S = NS.Styles.S
  check(S ~= nil and S.Tab and S.Panel and S.SetTabSelection, "a drawn style with Tab, Panel and SetTabSelection")
  -- Every call recorded on its way to the style's own.
  local calls = { Tab = {}, Panel = {}, Sel = {} }
  local tab0, panel0, sel0 = S.Tab, S.Panel, S.SetTabSelection
  S.Tab = function(t, ...) calls.Tab[#calls.Tab + 1] = t return tab0(t, ...) end
  S.Panel = function(f, opts, ...) calls.Panel[#calls.Panel + 1] = { f, opts } return panel0(f, opts, ...) end
  S.SetTabSelection = function(t, on) calls.Sel[#calls.Sel + 1] = { t, on } return sel0(t, on) end
  T.slash("")
  local w = T.window()
  local own, shared = T.content(), T.contents()[1]
  check(w and w:IsShown() and own ~= shared and own:GetParent() == w and own:IsVisible() and #T.contents() == 2, "the window shows its own copy")
  local function count(list, x) local n = 0 for _, v in ipairs(list) do if v == x then n = n + 1 end end return n end
  for i, tab in ipairs(own.tabs) do check(count(calls.Tab, tab) == 1, "the window's tab " .. i .. " to S().Tab once (" .. count(calls.Tab, tab) .. ")") end
  check(#calls.Tab == 4, "only those four (" .. #calls.Tab .. ")")
  local opts, other = {}, 0
  for _, p in ipairs(calls.Panel) do
    if p[1] == own.previewBox then opts[#opts + 1] = p[2] elseif p[1] == shared.previewBox then other = other + 1 end
  end
  check(#opts == 1 and type(opts[1]) == "table" and opts[1].inset == true and other == 0, "the window's preview box to S().Panel once, as an inset; not the page's")
  -- The selection: the last four calls are the window copy's tabs, only the shown one on.
  local function selection(i, what)
    local bad = {}
    if #calls.Sel < 4 then bad[1] = #calls.Sel .. " calls" end
    for k = 1, 4 do
      local call = calls.Sel[#calls.Sel - 4 + k]
      if not call or call[1] ~= own.tabs[k] or call[2] ~= (k == i) then bad[#bad + 1] = "tab " .. k end
    end
    check(#bad == 0, what .. (#bad > 0 and (": " .. table.concat(bad, ", ")) or ""))
  end
  selection(1, "built: Zone selected in the style")
  for _, i in ipairs({ 3, 2, 4, 1 }) do
    local n = #calls.Sel
    T.click(own.tabs[i])
    check(#calls.Sel == n + 4, own.tabs[i].text .. ": SetTabSelection for each of the four tabs (" .. (#calls.Sel - n) .. ")")
    selection(i, own.tabs[i].text .. ": only it selected in the style")
    if STYLE == "dark" then
      -- Dark draws the selection: the accent line under the selected tab only.
      local lines = 0
      for k, tab in ipairs(own.tabs) do
        for _, t in ipairs(tab.textures) do
          if t.layer == "OVERLAY" and t.height == 2 and T.isShown(t) then lines = lines + (k == i and 1 or 100) end
        end
      end
      check(lines == 1, own.tabs[i].text .. ": Dark's accent line under it alone (" .. lines .. ")")
    end
  end
  if STYLE == "dark" then
    local box = own.previewBox
    local faded = rawget(box.Bg, "alpha") == 0
    for _, key in ipairs({ "TopLeftCorner", "TopEdge", "BottomRightCorner" }) do faded = faded and rawget(box.NineSlice[key], "alpha") == 0 end
    check(faded, "Dark's panel faded the box's template art")
    check(rawget(shared.previewBox.Bg, "alpha") == nil and rawget(shared.tabs[1].Left, "alpha") == nil, "the page copy's box and tabs keep the game's art")
  else
    local function did(f, what) return f ~= nil and (EUIDONE[f] or ""):find(what, 1, true) ~= nil end
    check(did(own.tabs[1], "Tab") and did(own.previewBox, "Panel") and not did(shared.tabs[1], "Tab") and not did(shared.previewBox, "Panel"),
      "EllesmereUI's calls on the window copy only")
  end
  -- The Options page shows the shared copy: its tabs switch with no style calls.
  T.openPanelManually()
  check(not w:IsShown() and shared:IsVisible(), "the page takes over with its own copy")
  local nTab, nPanel, nSel = #calls.Tab, #calls.Panel, #calls.Sel
  T.click(shared.tabs[3])
  T.click(shared.tabs[2])
  check(shared.pages[2]:IsVisible() and #calls.Tab == nTab and #calls.Panel == nPanel and #calls.Sel == nSel,
    "the page copy's tabs switch with no style calls (" .. (#calls.Sel - nSel) .. " selections)")
  check(shared.tabStrip.selectedTab == 2 and not shared.tabs[2]:IsEnabled(), "and its selection is the game's own")
  -- Styles.lua looks for parts a widget may have (state textures, an icon, a template's background
  -- or NineSlice, SetTabSelected); the stubs answer nil for those, as the client does where they are
  -- missing. Nothing else may be read.
  local PROBES = { "Button.GetDisabledTexture", "Button.GetHighlightTexture", "Button.GetNormalTexture", "Button.GetPushedTexture",
    "Button.Icon", "Button.SetTabSelected", "CheckButton.GetDisabledCheckedTexture", "CheckButton.GetDisabledTexture",
    "CheckButton.GetHighlightTexture", "CheckButton.GetNormalTexture", "CheckButton.GetPushedTexture", "Frame.Bg", "Frame.NineSlice",
    "Frame.TitleText", "Slider.NineSlice" }
  check(#T.unknownBut(PROBES) == 0, "no widget field read that the client lacks, but the style's probes" .. (#T.unknownBut(PROBES) > 0 and (": " .. table.concat(T.unknownBut(PROBES), ", ")) or ""))
  local errs = skinErrors()
  check(#errs == 0, "no skin errors (" .. table.concat(errs, "; ") .. ")")
  check(#T.errors == 0, "no errors")
`, pre || undefined);
}

scenario('themes: Blizzard puts the swing timer art round a bar design; Dark a flat panel and outline in its colors; texts in the style font', DISPLAY_HELPERS + String.raw`
  GameFontNormal = { GetFont = function() return "Fonts\\STYLE.TTF", 12, "" end } -- read by Dark's GetFont
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "classic" }
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.Styles.Applied() == nil, "Blizzard")
  local r = T.rend()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  local c = r.chrome
  check(rawget(c.bg, "atlas") == "ui-swingtimerbar-background" and rawget(c.art, "atlas") == "ui-swingtimerbar-frame" and T.isShown(c.bg) and T.isShown(c.art), "Blizzard: the swing timer's background and frame atlases")
  local p = c.art.points
  check(#p == 2 and p[1][1] == "TOPLEFT" and p[1][4] == -5 and p[1][5] == 4 and p[2][1] == "BOTTOMRIGHT" and p[2][4] == 5 and p[2][5] == -4, "the art 5 px out at the ends and 4 at top and bottom, as round the game's bar")
  check(sameRGB(rgbOf(T.part(r, "track")), { 0.05, 0.05, 0.06 }) and close(alphaOf(T.part(r, "track")), 0.6), "the track in Blizzard's dark")
  T.slash("display ring") T.now = 101.1 T.update()
  local count = T.part(T.rend(), "count")
  check(count.fontFile == "Fonts\\FRIZQT__.TTF" and count.fontFlags == "OUTLINE", "Blizzard: the ring's countdown in the game's font (" .. tostring(count.fontFile) .. ")")
  local calls = count.fontCalls
  for k = 1, 10 do T.now = 101.1 + k * 0.05 T.update() end
  check(count.fontCalls == calls, "the font is set once, not every frame (" .. (count.fontCalls - calls) .. " more)")
  T.slash("style dark")
  check(NS.Styles.Applied() == "dark", "Dark drawn at once")
  T.now = 101.8 T.update()
  -- Draw.ring, drawn flat: radius min(w, h) / 2 - thickness * 1.7 (the thickness capped to
  -- 0.8 * half / (1 + 0.8 * 1.7)), countdown at 0.45 of it (10 at least).
  local db = ShotWindowDB
  local ringW, ringH = NS.DisplaySize(db, "ring")
  local ringHalf = math.min(ringW, ringH) / 2
  local ringTh = math.max(1, math.min(db.dispThick, 0.8 * ringHalf / (1 + 0.8 * 1.7)))
  local size = math.max(10, math.floor((ringHalf - ringTh * 1.7) * 0.45))
  check(count.fontFile == "Fonts\\STYLE.TTF" and count.fontSize == size, "Dark: the countdown in the style's font (" .. tostring(count.fontFile) .. " " .. tostring(count.fontSize) .. ")")
  T.slash("display arc") T.now = 101.9 T.update()
  local label = T.part(T.rend(), "label")
  check(label.fontFile == "Fonts\\STYLE.TTF", "Dark: the arc's label in the style's font (" .. tostring(label.fontFile) .. ")")
  T.slash("display pincer") T.now = 102.0 T.update()
  r = T.rend()
  c = r.chrome
  local black = 0
  for i = 1, 4 do if T.isShown(c.edges[i]) and sameRGB(rgbOf(c.edges[i]), { 0, 0, 0 }) and close(alphaOf(c.edges[i]), 1) then black = black + 1 end end
  check(T.isShown(c.bg) and rawget(c.bg, "atlas") == nil and sameRGB(rgbOf(c.bg), { 0.07, 0.07, 0.08 }) and close(alphaOf(c.bg), 0.9) and not T.isShown(c.art), "Dark: a flat panel in its color, no atlas")
  check(black == 4, "Dark: a black outline (" .. black .. " edges)")
  local e1 = c.edges[1]
  check(e1.height == 1 and e1.points[1][1] == "TOPLEFT" and e1.points[1][3] == -4 and e1.points[1][4] == 4, "one pixel, just outside the panel")
  check(sameRGB(rgbOf(T.part(r, "track")), { 0.07, 0.07, 0.08 }) and close(alphaOf(T.part(r, "track")), 0.85), "Dark: the track in its panel color")
  check(sameRGB(rgbOf(T.part(r, "left")), { NS.Styles.S.GetAccentColor() }), "Dark: the move color is its accent")
  ShotWindowDB.moveAccent = false
  T.now = 102.05 T.update()
  check(sameRGB(rgbOf(T.part(r, "left")), ShotWindowDB.moveColor), "accent for move off: the move color itself")
  check(#T.errors == 0, "no errors")
`);

scenario('themes: EllesmereUI chosen live: the displays take its track, accent and font at once; so does the call-out', DISPLAY_HELPERS + String.raw`
  EUI_S.GetFont = function() return "Fonts\\EUI.TTF" end
  ShotWindowDB = { style = "blizzard", display = "ring", callout = true }
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  EUI_FN(EUI_S)
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.Styles.Applied() == nil, "Blizzard chosen: nothing drawn")
  local fs = ShotWindowCallout.fontStrings[1]
  check(fs.fontFile == "Fonts\\FRIZQT__.TTF", "the call-out in the game's font under Blizzard")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  local count = T.part(T.rend(), "count")
  check(count.fontFile == "Fonts\\FRIZQT__.TTF", "the countdown in the game's font")
  T.slash("style auto")
  check(NS.Styles.Applied() == "eui", "Automatic: EllesmereUI's look at once")
  T.now = 101.1 T.update()
  check(count.fontFile == "Fonts\\EUI.TTF", "the countdown in its font at once (" .. tostring(count.fontFile) .. ")")
  -- Drawn flat in seamless strips: the fill is Qf, the track Qtt (Line strips: f and t).
  local fk, tk = T.rend().quads and "Qf1" or "f1", T.rend().quads and "Qtt1" or "t1"
  check(sameRGB(rgbOf(T.part(T.rend(), fk)), { 0.1, 0.6, 0.3 }), "the move color is its accent (" .. rgbStr(rgbOf(T.part(T.rend(), fk))) .. ")")
  check(sameRGB(rgbOf(T.part(T.rend(), tk)), { 0.05, 0.05, 0.06 }) and close(alphaOf(T.part(T.rend(), tk)), 0.85), "the ring's track in its panel color")
  T.now = 102.4 T.update()
  check(ShotWindowCallout:IsShown() and fs.text == "Stop", "the call-out speaks inside the zone")
  check(fs.fontFile == "Fonts\\EUI.TTF", "the call-out takes the style's font too (" .. tostring(fs.fontFile) .. ")")
  check(#T.errors == 0, "no errors")
`, EUI_PRE);

scenario('displays: secret weapon speed and latency (the trap covers Displays.lua): nothing drawn until a swing is known, then every design draws', DISPLAY_HELPERS + String.raw`
  T.speed = { mh = secret(2.0), oh = nil, rng = secret(2.8) }
  T.net = { 0, 0, secret(40), secret(120) }
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "track", callout = true, edge = true, sound = true }
  T.login(200)
  T.update()
  local r = T.rend()
  check(T.shownParts(r) == 0 and r.chrome == nil, "no swing known: nothing drawn, no frame round it")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  for _, d in ipairs(NS.DISPLAYS) do
    T.slash("display " .. d)
    T.update()
    if d ~= "none" then check(T.shownParts(T.rend()) > 0, d .. ": drawn from the swing") end
  end
  T.now = 102.81 T.update() T.now = 103.2 T.update()
  T.now = 103.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  T.slash("")
  T.click(T.tab(2))
  for k = 1, 12 do T.now = 103.4 + k * 0.3 T.update() end
  check(#T.errors == 0, "no errors, no refused secret uses")
`);

scenario('displays: the first shot\'s wind-up is not a late shot: the ring and the arc say so the way the call-out does', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", false
  ShotWindowDB = { display = "ring", callout = true }
  T.login(200)
  T.now = 100 T.fire("START_AUTOREPEAT_SPELL")
  T.now = 100.5 T.update()
  check(T.stateHas("waiting") and ShotWindowCallout.fontStrings[1].text == "Stop", "the call-out: Stop, not Late, for the first shot's wait")
  local count = T.part(T.rend(), "count")
  check(count and count.text ~= "Late", "the ring's countdown does not call the first shot late (" .. tostring(count and count.text) .. ")")
  T.slash("display arc") T.now = 100.6 T.update()
  local label = T.part(T.rend(), "label")
  check(label and label.text ~= "Late", "nor does the arc's label (" .. tostring(label and label.text) .. ")")
  T.now = 100.7 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 103.51 T.update() T.now = 103.8 T.update()
  check(label.text == "Late" and ShotWindowCallout.fontStrings[1].text == "Late", "a shot that is late: Late on both")
  check(#T.errors == 0, "no errors")
`);

// ---------------------------------------------------------------------------------------------
// Words on the displays (Display tab): dispWords is the arc's label (Move, Stand still, Moving,
// Late) and the ring's "Late", dispCount the ring's seconds. A pass runs one piece of a fight on the
// real clock with the two settings given; a snapshot keeps every field of the regions a design
// shows (a hidden one counts only as hidden), so two passes can be compared state by state.

const WORDS_HELPERS = String.raw`
  local WORDS, COUNT = "Words: Move, Stand still, Moving, Late", "Show the ring's countdown"
  local FIELDS = { "shown", "alpha", "scale", "colorTex", "vertex", "file", "atlas", "texCoord", "points", "width", "height",
    "startPoint", "endPoint", "thickness", "vertexOffsets", "layer", "sublevel", "fontSize", "fontFile", "gradient", "rotation" }
  local FIELDSET = {}
  for _, k in ipairs(FIELDS) do FIELDSET[k] = true end
  -- A value laid out flat into out after its n-th entry: tables as their array part (and r, g, b, a
  -- for a color) between braces, a widget (an anchor's frame) as itself; returns the new count. The
  -- passes run at times that subtract exactly the same way (see pass), so equal states give equal lists.
  local function walk(v, out, n)
    if type(v) == "table" and getmetatable(v) == nil then
      n = n + 1 out[n] = "{"
      for i = 1, #v do n = walk(v[i], out, n) end
      if v.r ~= nil then n = walk(v.r, out, n) n = walk(v.g, out, n) n = walk(v.b, out, n) n = walk(v.a, out, n) end
      n = n + 1 out[n] = "}"
    elseif v == nil then
      n = n + 1 out[n] = "nil"
    else
      n = n + 1 out[n] = v
    end
    return n
  end
  -- A region's fields, each after its name, and its words (text and text color) apart. A hidden
  -- region shows nothing, so only that it is hidden counts.
  local HIDDEN = { "shown", false }
  local function regionState(region)
    if rawget(region, "shown") ~= true then return { region = region, body = HIDDEN, words = HIDDEN } end
    local body, words, n = {}, {}, 0
    for i = 1, #FIELDS do
      local k = FIELDS[i]
      n = n + 1 body[n] = k
      n = walk(rawget(region, k), body, n)
    end
    walk(rawget(region, "textColor"), words, walk(rawget(region, "text"), words, 0))
    return { region = region, body = body, words = words }
  end
  -- Everything a renderer shows for its design, region by region; also its frame, the frame drawn
  -- round it and, on the live display, the late readout under it.
  local function snapshot(r)
    local list = {}
    for i, region in ipairs(r.parts[r.design] or {}) do list[i] = regionState(region) end
    local function add(region) if region then list[#list + 1] = regionState(region) end end
    add(r.frame)
    local c = r.chrome
    if c then
      add(c.bg) add(c.art)
      for i = 1, 4 do add(c.edges[i]) end
    end
    local holder = rawget(_G, "ShotWindowDisplay")
    if holder and rawget(r.frame, "parent") == holder then add(holder.fontStrings[2]) end
    return list
  end
  -- A region's name in its renderer (for the messages).
  local function nameOf(region)
    for _, r in ipairs(T.renderers or {}) do
      for name, t in pairs(r.tex) do if t == region then return name end end
      for name, t in pairs(r.texts) do if t == region then return name end end
      for name, sg in pairs(r.segs) do if sg.line == region or sg.tex == region then return name end end
      if r.frame == region then return "(the renderer's frame)" end
    end
    return "(the frame round it, or the late readout)"
  end
  local function firstDiff(x, y)
    for i = 1, math.max(#x, #y) do if x[i] ~= y[i] then return i end end
  end
  local function fieldAt(list, i)
    for j = math.min(i, #list), 1, -1 do if FIELDSET[list[j]] then return list[j] end end
    return "?"
  end
  -- How many regions differ between two snapshots, the words of the regions in skip (a set of
  -- regions) left out, and the first few differences: "region field: a / b".
  local function snapDiff(a, b, skip)
    local out = {}
    if #a ~= #b then out[1] = "region count " .. #a .. " / " .. #b end
    for i = 1, math.min(#a, #b) do
      local x, y = a[i], b[i]
      if x.region ~= y.region then
        out[#out + 1] = "region " .. i .. " is another region"
      else
        local d = firstDiff(x.body, y.body)
        if d then
          out[#out + 1] = nameOf(x.region) .. " " .. fieldAt(x.body, d) .. ": " .. tostring(x.body[d]) .. " / " .. tostring(y.body[d])
        elseif not (skip and skip[x.region]) and firstDiff(x.words, y.words) then
          d = firstDiff(x.words, y.words)
          out[#out + 1] = nameOf(x.region) .. " words: " .. tostring(x.words[d]) .. " / " .. tostring(y.words[d])
        end
      end
    end
    local first = {}
    for i = 1, math.min(4, #out) do first[i] = out[i] end
    return #out, table.concat(first, "; ")
  end
  -- A font string that shows nothing: hidden, or empty.
  local function blank(fs) return fs ~= nil and (not fs.shown or fs.text == nil or fs.text == "") end
  local function fsStr(fs)
    if not fs then return "no font string" end
    local c = fs.color
    return '"' .. tostring(fs.text) .. '"' .. (fs.shown and "" or " hidden") .. " in " .. rgbStr(c) .. " at alpha " .. num(c and c[4])
  end
`;

// The live display through one piece of a fight per pass: the arc and the ring with each setting,
// every other design with both on and both off. Blizzard art and Dark (flat), in seamless strips.
for (const [mode, label] of [['art', 'Blizzard art'], ['dark', 'Dark style, flat']]) {
  scenario('display words (' + label + '): both on by default: the arc says Move, Stand still, Moving and Late in its colors, the ring counts down and says Late; words off: the arc\'s label empty in every state, the ring 0.0 (pulsing) for a late shot; countdown off: the ring only says Late; both off: the ring blank; nothing else of either design changes, the arc ignores the countdown, and no other design changes at all', DISPLAY_HELPERS + WORDS_HELPERS + 'local MODE = "' + mode + '"\n' + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  if MODE == "dark" then ShotWindowDB = { style = "dark" } end
  T.login(200)
  if MODE == "dark" then T.fire("PLAYER_ENTERING_WORLD") end
  local db = ShotWindowDB
  check(MODE ~= "dark" or (NS.Styles.Applied() == "dark" and NS.Styles.S ~= nil), "Dark drawn")
  check(db.dispWords == true and db.dispCount == true, "words and countdown on by default (" .. tostring(db.dispWords) .. ", " .. tostring(db.dispCount) .. ")")
  local moveC = MODE == "dark" and { NS.Styles.S.GetAccentColor() } or db.moveColor
  local WAIT_AT = 2.81 -- the update that finds the bar run out: the hold for the late shot starts
  -- The piece of a fight: { state, seconds from the swing, event just before, when that event goes }.
  local STATES = {
    { "move", 1.0 },
    { "stand still", 2.4 },
    { "moving in the zone", 2.5, "PLAYER_STARTED_MOVING" },
    { false, WAIT_AT },
    { "late, still moving", 3.0 },
    { "late", 3.25, "PLAYER_STOPPED_MOVING", 3.1 },
    { "the shot", 3.4, "PLAYER_SWING" },
    { "after the shot", 4.0 },
  }
  local LATE = { ["late, still moving"] = true, ["late"] = true }
  local passes = 0
  -- One pass with the two settings: per state, the snapshot, the word's font string (the arc's
  -- label, the ring's count), the hold's age and how many regions are shown; nothing kept when
  -- warming up (every region made before the passes compared). Every pass starts at a whole second
  -- from 1024 to 2047, where doubles are equally spaced, so base + at - base comes out the same
  -- in every pass and equal states draw equal numbers.
  local function pass(D, words, count, warmUp)
    passes = passes + 1
    local base = 1024 + passes * 16
    if base + 5 >= 2048 then check(false, "too many passes for the exact clock (" .. passes .. ")") end
    db.dispWords, db.dispCount = words, count
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    local r = T.rend()
    local out = {}
    for _, st in ipairs(STATES) do
      local name, at, ev, evAt = st[1], st[2], st[3], st[4]
      if ev and evAt then T.now = base + evAt T.fire(ev) end
      T.now = base + at
      if ev and not evAt then
        if ev == "PLAYER_SWING" then T.fire(ev, 2.8, 2) else T.fire(ev) end
      end
      T.update()
      if name and not warmUp then
        local fs = T.part(r, D == "ring" and "count" or "label")
        out[#out + 1] = { name = name, snap = snapshot(r), shownParts = T.shownParts(r), age = T.now - (base + WAIT_AT),
          fs = fs and { shown = T.isShown(fs), text = rawget(fs, "text"), color = rawget(fs, "textColor") } }
      end
    end
    return out
  end
  local function compare(tag, want, got, skip)
    for i, st in ipairs(got) do
      local n, what = snapDiff(want[i].snap, st.snap, skip)
      check(n == 0, tag .. st.name .. ": nothing else changes (" .. n .. " regions differ" .. (n > 0 and (": " .. what) or "") .. ")")
    end
  end
  local function onOff(b) return b and "on" or "off" end

  -- The arc.
  T.slash("display arc")
  pass("arc", true, true, true)
  local r = T.rend()
  check(r ~= nil and r.design == "arc" and r.mode == (MODE == "dark" and "flat" or "art") and r.quads == true,
    "[arc] drawn " .. (MODE == "dark" and "flat" or "in the bar's art") .. " in seamless strips (" .. tostring(r and r.mode) .. ", quads " .. tostring(r and r.quads) .. ")")
  local on = pass("arc", true, true)
  -- The label with the words on: its text, its color, and whether it pulses (the hold for a late shot).
  local WANT = {
    ["move"] = { "Move", moveC }, ["stand still"] = { "Stand still", db.color }, ["moving in the zone"] = { "Moving", db.clipColor },
    ["late, still moving"] = { "Moving", db.clipColor, true }, ["late"] = { "Late", db.color, true },
    ["the shot"] = { "Move", moveC }, ["after the shot"] = { "Move", moveC },
  }
  for _, st in ipairs(on) do
    local w, fs = WANT[st.name], st.fs
    local a = w[3] and pulseAt(st.age) or 1
    check(fs and fs.shown and fs.text == w[1] and sameRGB(fs.color, w[2]) and close(fs.color[4], a, 1e-6),
      "[arc, words on] " .. st.name .. ': the label says "' .. w[1] .. '" in ' .. rgbStr(w[2]) .. " at alpha " .. num(a) .. " (" .. fsStr(fs) .. ")")
  end
  check(on[5].fs and on[5].fs.color and on[5].fs.color[4] < 0.5, "[arc, words on] late: the label pulses (alpha " .. num(on[5].fs and on[5].fs.color and on[5].fs.color[4]) .. ")")
  local LABEL = { [T.part(r, "label")] = true }
  local off = pass("arc", false, true)
  for i, st in ipairs(off) do
    check(blank(st.fs), "[arc, words off] " .. st.name .. ": the label is empty (" .. fsStr(st.fs) .. ")")
    check(st.shownParts == on[i].shownParts and st.shownParts >= 20, "[arc, words off] " .. st.name
      .. ": the arcs, fills, tint and top mark still drawn (" .. st.shownParts .. " regions shown, " .. on[i].shownParts .. " with the words)")
  end
  compare("[arc, words off] ", on, off, LABEL)
  -- The countdown is the ring's alone: the arc ignores it, words on (the label too) or off.
  compare("[arc, countdown off] ", on, pass("arc", true, false), nil)
  local both = pass("arc", false, false)
  for _, st in ipairs(both) do check(blank(st.fs), "[arc, both off] " .. st.name .. ": the label is empty (" .. fsStr(st.fs) .. ")") end
  compare("[arc, both off] ", on, both, LABEL)

  -- The ring.
  T.slash("display ring")
  pass("ring", true, true, true)
  r = T.rend()
  check(r ~= nil and r.design == "ring" and r.mode == (MODE == "dark" and "flat" or "art"), "[ring] drawn " .. (MODE == "dark" and "flat" or "in the bar's art")
    .. " (" .. tostring(r and r.mode) .. ")")
  local ringOn = pass("ring", true, true)
  local SECS = { ["move"] = "1.8", ["stand still"] = "0.4", ["moving in the zone"] = "0.3", ["the shot"] = "2.8", ["after the shot"] = "2.2" }
  local COLOR = { ["move"] = WHITE, ["stand still"] = db.color, ["moving in the zone"] = db.clipColor, ["late, still moving"] = db.clipColor,
    ["late"] = db.color, ["the shot"] = WHITE, ["after the shot"] = WHITE }
  -- What the ring says in a state: "Late" is a word, the seconds (0.0 while holding) the countdown.
  local function ringWant(name, words, count)
    if LATE[name] and words then return "Late" end
    if not count then return "" end
    return LATE[name] and "0.0" or SECS[name]
  end
  local COUNTFS = { [T.part(r, "count")] = true }
  for _, combo in ipairs({ { true, true }, { false, true }, { true, false }, { false, false } }) do
    local words, count = combo[1], combo[2]
    local tag = "[ring, words " .. onOff(words) .. ", countdown " .. onOff(count) .. "] "
    local run = (words and count) and ringOn or pass("ring", words, count)
    for i, st in ipairs(run) do
      local want, fs = ringWant(st.name, words, count), st.fs
      if want == "" then
        check(blank(fs), tag .. st.name .. ": blank (" .. fsStr(fs) .. ")")
      else
        local a = LATE[st.name] and pulseAt(st.age) or 1
        check(fs and fs.shown and fs.text == want and sameRGB(fs.color, COLOR[st.name]) and close(fs.color[4], a, 1e-6),
          tag .. st.name .. ': says "' .. want .. '" in ' .. rgbStr(COLOR[st.name]) .. " at alpha " .. num(a) .. " (" .. fsStr(fs) .. ")")
      end
      check(st.shownParts == ringOn[i].shownParts and st.shownParts >= 20, tag .. st.name .. ": the ring, its fill, tint and top mark still drawn ("
        .. st.shownParts .. " regions shown, " .. ringOn[i].shownParts .. " with both on)")
    end
    if run ~= ringOn then compare(tag, ringOn, run, COUNTFS) end
  end

  -- Every other design: both settings off change nothing at all.
  for _, D in ipairs(NS.DISPLAYS) do
    if D ~= "none" and D ~= "arc" and D ~= "ring" then
      T.slash("display " .. D)
      pass(D, true, true, true)
      compare("[" .. D .. ", words and countdown off] ", pass(D, true, true), pass(D, false, false), nil)
    end
  end
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);
}

scenario('options: Show words and Show the ring\'s countdown sit in the Display page\'s right column under the line thickness, both checked; words usable for the arc and the ring, the countdown for the ring alone, following the Design button; a click saves it and the live display and the preview follow on the next frame; Defaults turns both back on; the Look note is gone and the accent checkbox, now last, still lies on the page above the Defaults row', DISPLAY_HELPERS + TAB_HELPERS + WORDS_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  T.slash("")
  T.click(T.tab(2))
  local db = ShotWindowDB
  local page = T.pages()[2]
  local words, count = T.checkbox(WORDS), T.checkbox(COUNT)
  check(words ~= nil and count ~= nil and words:IsVisible() and count:IsVisible(), "both checkboxes shown on the Display tab")
  if not (words and count) then return end
  check(words.parent == page and count.parent == page, "both on the Display page")
  check(words:GetChecked() == true and count:GetChecked() == true, "both checked by default")
  -- Where a control sits on its page: x, and y down from the page's top.
  local function leftOf(f) local p = f and f.points[1] return p and p[1] == "TOPLEFT" and type(p[2]) == "number" and p[2] or nil end
  local function topOf(f) local p = f and f.points[1] return p and p[1] == "TOPLEFT" and type(p[3]) == "number" and -p[3] or nil end
  local thick = T.slider("Line thickness of a round design").parent
  local header
  for _, fs in ipairs(page.fontStrings) do if rawget(fs, "text") == "Design options" then header = fs end end
  check(leftOf(words) == 304 and leftOf(count) == 304, "in the right column (x " .. tostring(leftOf(words)) .. " and " .. tostring(leftOf(count)) .. ", want 304)")
  local tY, wY, cY, hY = topOf(thick), topOf(words), topOf(count), topOf(header)
  check(tY and wY and cY and hY and tY + thick.height <= wY and wY - tY <= 60 and cY == wY + 28 and cY + 24 <= hY,
    "under the line thickness slider (at " .. tostring(tY) .. "), words (" .. tostring(wY) .. ") then the countdown ("
    .. tostring(cY) .. "), then the Design options header (" .. tostring(hY) .. ")")

  -- Usable as the Design button steps: words for the arc and the ring, the countdown for the ring.
  local function u(on) return on and "usable" or "grayed" end
  checkControls("none", { [WORDS] = "grayed", [COUNT] = "grayed" })
  local design = buttonStarting("Design: ")
  local stepped = {}
  for i = 1, #NS.DISPLAYS do
    T.click(design)
    local d = db.display
    stepped[#stepped + 1] = d
    checkControls("Design button, " .. d, { [WORDS] = u(d == "arc" or d == "ring"), [COUNT] = u(d == "ring") })
    check(words:GetChecked() == true and count:GetChecked() == true, d .. ": both still checked")
  end
  check(#stepped == #NS.DISPLAYS and db.display == "none", "the Design button went round every design (" .. table.concat(stepped, " ") .. ")")
  T.click(design, "RightButton") -- reticle
  checkControls("right click, " .. db.display, { [WORDS] = "grayed", [COUNT] = "grayed" })
  T.click(design, "RightButton") -- ring
  checkControls("right click, " .. db.display, { [WORDS] = "usable", [COUNT] = "usable" })
  T.click(design, "RightButton") -- arc
  checkControls("right click, " .. db.display, { [WORDS] = "usable", [COUNT] = "grayed" })
  check(db.display == "arc", "the arc chosen (" .. tostring(db.display) .. ")")

  local stage = T.preview()
  local live = T.rend()
  -- The preview's words over its whole made-up loop (9 s with a 2.8 s weapon), every 0.1 s: the
  -- texts seen ("" for nothing shown), and the lowest alpha each was drawn at.
  local function loopTexts(key)
    local seen, low = {}, {}
    for k = 1, 92 do
      T.now = T.now + 0.1 T.update()
      local fs = T.part(stage.renderer, key)
      local t = (fs and T.isShown(fs)) and (rawget(fs, "text") or "") or ""
      seen[t] = true
      local c = fs and rawget(fs, "textColor")
      if t ~= "" and c then low[t] = math.min(low[t] or 1, c[4] or 1) end
    end
    return seen, low
  end
  local function list(seen)
    local l = {}
    for k in pairs(seen) do l[#l + 1] = '"' .. k .. '"' end
    table.sort(l)
    return table.concat(l, " ")
  end
  local function numbers(seen) local n = 0 for k in pairs(seen) do if k:match("^%d+%.%d$") then n = n + 1 end end return n end
  local function liveText(key) local fs = T.part(live, key) return fs and T.isShown(fs) and (rawget(fs, "text") or "") or "" end
  local function previewText(key) local fs = T.part(stage.renderer, key) return fs and T.isShown(fs) and (rawget(fs, "text") or "") or "" end
  local function nextFrame() T.now = T.now + 0.016 T.update() end

  -- The arc, words on: the preview says all four.
  local seen = loopTexts("label")
  check(seen.Move and seen["Stand still"] and seen.Moving and seen.Late and not seen[""], "the preview's arc says Move, Stand still, Moving and Late (" .. list(seen) .. ")")
  local t0 = T.now + 0.1
  T.now = t0 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = t0 + 1 T.update()
  check(liveText("label") == "Move" and previewText("label") ~= "", "before the click: the live arc says Move, the preview a word ("
    .. liveText("label") .. ", " .. previewText("label") .. ")")
  T.click(words)
  check(db.dispWords == false and words:GetChecked() == false, "a click turns the words off (" .. tostring(db.dispWords) .. ")")
  nextFrame()
  check(liveText("label") == "" and previewText("label") == "", "the next frame: the live arc's label and the preview's empty ("
    .. liveText("label") .. ", " .. previewText("label") .. ")")
  seen = loopTexts("label")
  check(list(seen) == '""', "the preview's arc shows no word over a whole loop (" .. list(seen) .. ")")
  t0 = T.now + 0.1
  T.now = t0 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = t0 + 1 T.update()
  check(liveText("label") == "", "the live arc in a new swing: still no word (" .. liveText("label") .. ")")
  T.click(words)
  check(db.dispWords == true and words:GetChecked() == true, "a click turns the words on again")
  nextFrame()
  check(liveText("label") == "Move" and previewText("label") ~= "", "the next frame: Move on the live arc, a word in the preview ("
    .. liveText("label") .. ", " .. previewText("label") .. ")")

  -- The ring.
  T.click(design)
  check(db.display == "ring" and T.rend().design == "ring", "the Design button: the ring")
  checkControls("ring", { [WORDS] = "usable", [COUNT] = "usable" })
  local low
  seen = loopTexts("count")
  check(seen.Late and numbers(seen) >= 10 and not seen[""], "the preview's ring counts down and says Late (" .. numbers(seen) .. " different counts, " .. tostring(seen.Late) .. ")")
  t0 = T.now + 0.1
  T.now = t0 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = t0 + 1 T.update()
  local before = previewText("count")
  check(liveText("count") == "1.8" and before:match("^%d+%.%d$") ~= nil, "before the click: the live ring at 1.8, the preview counting ("
    .. liveText("count") .. ", " .. before .. ")")
  T.click(count)
  check(db.dispCount == false and count:GetChecked() == false, "a click turns the countdown off")
  nextFrame()
  check(liveText("count") == "" and previewText("count") == "", "the next frame: the live ring and the preview blank ("
    .. liveText("count") .. ", " .. previewText("count") .. ")")
  seen = loopTexts("count")
  check(list(seen) == '"" "Late"', "countdown off: the preview's ring only says Late (" .. list(seen) .. ")")
  T.click(words)
  check(db.dispWords == false and db.dispCount == false, "both off")
  nextFrame()
  check(liveText("count") == "", "both off: the live ring blank (" .. liveText("count") .. ")")
  seen = loopTexts("count")
  check(list(seen) == '""', "both off: the preview's ring blank over a whole loop (" .. list(seen) .. ")")
  T.click(count)
  check(db.dispWords == false and db.dispCount == true, "the countdown on again, words off")
  t0 = T.now + 0.1
  T.now = t0 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = t0 + 1 T.update()
  check(liveText("count") == "1.8", "words off: the live ring counts (" .. liveText("count") .. ")")
  seen, low = loopTexts("count")
  check(seen["0.0"] and not seen.Late and not seen[""] and numbers(seen) >= 10, "words off: the preview's ring counts down to 0.0, never Late (" .. list(seen) .. ")")
  check(low["0.0"] and low["0.0"] < 0.5, "and pulses at 0.0 while holding (lowest alpha " .. num(low["0.0"]) .. ")")

  -- Defaults turns both back on.
  T.click(count)
  check(db.dispWords == false and db.dispCount == false, "both off before Defaults")
  T.click(T.button("Defaults"))
  check(db.dispWords == true and db.dispCount == true, "Defaults: both on (" .. tostring(db.dispWords) .. ", " .. tostring(db.dispCount) .. ")")
  check(words:GetChecked() == true and count:GetChecked() == true, "Defaults: both checked")
  checkControls("Defaults (none)", { [WORDS] = "grayed", [COUNT] = "grayed" })

  -- The Look note is gone; the accent checkbox is the last control and still lies on the page.
  local notes = {}
  for _, f in ipairs({ T.content(), table.unpack(T.pages()) }) do
    for _, fs in ipairs(f.fontStrings) do
      local t = rawget(fs, "text")
      if type(t) == "string" and (t:find("^Look: ") or t:find("styles the displays too", 1, true)) then notes[#notes + 1] = t end
    end
  end
  check(#notes == 0, "no Look note on any page (" .. table.concat(notes, " | ") .. ")")
  local accent = T.checkbox("Use the window style's accent for move")
  local aY = topOf(accent)
  local reset = T.button("Defaults")
  local rp = reset.points[1]
  local resetTop = CONTENT_H - rp[3] - reset.height
  check(accent and accent.parent == page and leftOf(accent) == 304 and aY and aY + accent.height <= PAGE_H and PAGE_TOP + aY + accent.height < resetTop,
    "the accent checkbox on the page (" .. tostring(aY) .. " to " .. tostring(aY and aY + accent.height) .. " of " .. PAGE_H
    .. "), above the Defaults row (at " .. resetTop .. ", the checkbox ends at " .. tostring(aY and PAGE_TOP + aY + accent.height) .. ")")
  local lowest, what = 0, "nothing"
  local function low2(name, x, y, h) if x and y and x >= 300 and y + h > lowest then lowest, what = y + h, name end end
  for _, f in ipairs(page.children) do low2(f.kind .. " " .. tostring(rawget(f, "text") or ""), leftOf(f), topOf(f), f.height or 0) end
  for _, fs in ipairs(page.fontStrings) do low2("text " .. tostring(rawget(fs, "text")), leftOf(fs), topOf(fs), 14) end
  check(aY and lowest == aY + accent.height, "the accent checkbox is the right column's last control (the lowest: " .. what .. ", ending at " .. lowest .. ")")
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);

scenario('options: the accent checkbox is usable only under a drawn style; under Dark it grays the Move color while on', DISPLAY_HELPERS + 'ShotWindowDB = { style = "dark" }\n' + String.raw`
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(NS.Styles.S ~= nil, "Dark drawn")
  T.slash("")
  T.click(T.tab(2))
  local db = ShotWindowDB
  checkControls("Dark, accent on", { ["Use the window style's accent for move"] = "usable", ["Move color"] = "grayed" })
  T.click(T.checkbox("Use the window style's accent for move"))
  check(db.moveAccent == false, "a click turns the accent off")
  checkControls("Dark, accent off", { ["Use the window style's accent for move"] = "usable", ["Move color"] = "usable" })
  check(#T.errors == 0, "no errors")
`);

// Saved settings from a version without the words options, and a saved choice.
for (const [saved, label] of [['{ display = "arc", window = 0.5, moveAccent = true, dispThick = 12 }', 'neither key: both on'],
  ['{ display = "arc", dispWords = false, dispCount = false }', 'both saved off: kept off']]) {
  scenario('display words, saved settings (' + label + ')', DISPLAY_HELPERS + WORDS_HELPERS + 'ShotWindowDB = ' + saved + '\n' + String.raw`
  local OLD = ShotWindowDB.dispWords == nil
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  check(db.dispWords == OLD and db.dispCount == OLD, "after login: words " .. tostring(db.dispWords) .. ", countdown " .. tostring(db.dispCount) .. ", want " .. tostring(OLD))
  check(db.display == "arc" and db.dispThick == 12, "the rest of the saved settings kept")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  local label = T.part(T.rend(), "label")
  check(label ~= nil and (OLD and label.text == "Move" or (not OLD and blank({ shown = label.shown, text = label.text }))),
    "the arc " .. (OLD and "says Move" or "shows no word") .. " (" .. tostring(label and label.text) .. ")")
  T.slash("display ring")
  T.now = 101.1 T.update()
  local fs = T.part(T.rend(), "count")
  check(fs ~= nil and (OLD and fs.text == "1.7" or (not OLD and blank({ shown = fs.shown, text = fs.text }))),
    "the ring " .. (OLD and "counts" or "is blank") .. " (" .. tostring(fs and fs.text) .. ")")
  T.slash("")
  T.click(T.tab(2))
  check(T.checkbox(WORDS):GetChecked() == OLD and T.checkbox(COUNT):GetChecked() == OLD, "the checkboxes show it")
  check(#T.unknownBut() == 0, "no widget field read that the client lacks (" .. table.concat(T.unknownBut(), ", ") .. ")")
  check(#T.errors == 0, "no errors")
`);
}

scenario('displays: a saved design this version does not know counts as none; the options still work', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "hexagon" }
  T.login(200)
  T.update()
  check(rawget(_G, "ShotWindowDisplay") == nil, "no display made for an unknown design")
  T.slash("")
  T.click(T.tab(2))
  for k = 1, 10 do T.now = 100 + k * 0.3 T.update() end
  T.click(buttonStarting("Design: "))
  check(NS.DISPLAY_NAMES[ShotWindowDB.display] ~= nil, "the Design button steps to a design it knows (" .. tostring(ShotWindowDB.display) .. ")")
  T.update()
  check(#T.errors == 0, "no errors")
`);

scenario('displays: the scanner sweeping left to right also stops on the shot line while holding', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "scanner", scanMode = "wrap" }
  T.login(200)
  local r = T.rend()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2)
  T.now = 100.01 T.update()
  local x0 = mid(T.rect(T.part(r, "spark")))
  check(close(x0, r.w / 2, 1), "it leaves from the shot line (x " .. num(x0) .. ")")
  T.now = 101.4 T.update()
  local x1 = mid(T.rect(T.part(r, "spark")))
  check(close(x1, 0, 1) or close(x1, r.w, 1), "halfway through the swing: at an end, wrapping round (x " .. num(x1) .. ")")
  T.now = 102.81 T.update() T.now = 103.1 T.update()
  check(close(mid(T.rect(T.part(r, "spark"))), r.w / 2), "holding: on the shot line")
  check(not T.isShown(T.part(r, "zoneR")) and T.isShown(T.part(r, "zoneL")), "the zone only on the side it comes back from")
  check(#T.errors == 0, "no errors")
`);

scenario('displays: no ranged weapon hides the drawing and the frame round it; a bow brings both back', DISPLAY_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "classic" }
  T.login(200)
  T.update()
  local r = T.rend()
  check(T.shownParts(r) > 0 and T.isShown(r.chrome.bg) and T.isShown(r.chrome.art), "a bow: drawn at its speed, with the bar art")
  T.speed.rng = nil
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, true) T.update()
  check(T.shownParts(r) == 0 and not T.isShown(r.chrome.bg) and not T.isShown(r.chrome.art), "no ranged weapon: nothing drawn, no art left behind")
  T.speed.rng = 3.0
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, false) T.update()
  check(T.shownParts(r) > 0 and T.isShown(r.chrome.bg) and T.isShown(r.chrome.art), "a bow again: drawn with its art")
  check(#T.errors == 0, "no errors")
`);

// ---------------------------------------------------------------------------------------------
// Blizzard art on the round designs: under the Blizzard style the arc, the ring and the reticle wear
// the swing timer bar's art (background, fill, frame) bent round the curve, one atlas slice per Line.

// Where the arc and the ring lie, worked out from their size and line thickness alone (shared by
// the Line strip and the seamless strip helpers).
const ROUND_GEOM = String.raw`
  -- The line thickness is capped so a thick line on a small design stays a ring: a band kw * th
  -- wide on radius avail - kr * th is at most 0.8 of that radius wide (1 at the least).
  local function fitThick(th, avail, kw, kr) return math.max(1, math.min(th, 0.8 * avail / (kw + 0.8 * kr))) end
  -- The arc or the ring, mode "art" (the bar's art) or "flat": center cx, cy; the line thickness th
  -- (capped); for art the frame and background widths fw, bw; the radius rad; widest, the widest
  -- band drawn; and mark0, mark1, the radii the shot mark runs between (straight up from the center).
  local function roundGeom(D, mode, W, H, dispThick)
    local K, BK = 30 / 22, 26 / 22
    local g = { cx = W / 2 }
    if D == "arc" then
      g.cy = H * NS.ARC_CY
      if mode == "art" then
        local avail = math.min(W / 2, H * 0.55) - 1
        g.th = fitThick(dispThick, avail, K, K / 2)
        g.fw, g.bw = g.th * K, g.th * BK
        g.rad = avail - g.fw / 2
      else
        local avail = math.min(W / 2, H * 0.55)
        g.th = fitThick(dispThick, avail, 1, 1)
        g.rad = avail - g.th
      end
    else
      g.cy = H / 2
      local half = math.min(W, H) / 2
      if mode == "art" then
        g.th = fitThick(dispThick, half, K, K / 2 + 0.8)
        g.fw, g.bw = g.th * K, g.th * BK
        g.rad = half - g.fw / 2 - g.th * 0.8
      else
        g.th = fitThick(dispThick, half, 1, 1.7)
        g.rad = half - 1.7 * g.th
      end
    end
    g.widest = g.fw or g.th
    local mt = mode == "art" and (g.fw / 2 + 2) or g.th
    g.mark0, g.mark1 = math.max(g.rad - mt, g.rad * 0.3, 1), g.rad + mt * 1.6
    return g
  end
`;

// Lua helpers for the art scenarios (they follow DISPLAY_HELPERS).
const ART_HELPERS = ROUND_GEOM + String.raw`
  local ART_FRAME_K, ART_OVERLAP = 30 / 22, 0.12
  local SLICE = { bg = "ui-swingtimerbar-background", fill = "ui-swingtimerbar-filling-ranged", frame = "ui-swingtimerbar-frame" }
  -- The strips that never change shape in a fight, and the fill strips that do (key, segments).
  local STATIC = { arc = { { "Abg", 44 }, { "Aframe", 44 } }, ring = { { "Abg", 40 }, { "Aframe", 40 } }, reticle = { { "Arim", 40 } } }
  local FILLS = { arc = { { "Afl", 22 }, { "Afr", 22 } }, ring = { { "Afill", 40 } }, reticle = { { "Acirc", 32 } } }

  -- Where a round design's strips lie, worked out from its size alone: for each strip the center,
  -- the radius, the two ends of its path (angles counterclockwise from the right, y up), how many
  -- segments, the thickness, the sublevel. p is the swing's progress (the reticle's circle shrinks).
  local function artGeom(D, W, H, th, p)
    local top, g = math.pi / 2, {}
    local function S(key, cx, cy, rad, a0, a1, n, thick, sub)
      g[key] = { cx = cx, cy = cy, rad = rad, a0 = a0, a1 = a1, n = n, thick = thick, sub = sub }
    end
    if D == "ring" then -- clockwise from the top, all the way round
      local rg = roundGeom(D, "art", W, H, th) -- the line thickness capped to the size
      th = rg.th
      local fw, bw = rg.fw, rg.bw
      local cx, cy, rad = rg.cx, rg.cy, rg.rad
      local fin = top - 2 * math.pi
      S("Abg", cx, cy, rad, top, fin, 40, bw, 0)
      S("Azone", cx, cy, rad, top, fin, 40, bw, 1)
      S("Afill", cx, cy, rad, top, fin, 40, th, 2)
      S("Atint", cx, cy, rad, top, fin, 40, th, 3)
      S("Aframe", cx, cy, rad, top, fin, 40, fw, 4)
    elseif D == "arc" then -- the horseshoe from its left end to its right end; each fill climbs a side to the top
      local rg = roundGeom(D, "art", W, H, th)
      th = rg.th
      local fw, bw = rg.fw, rg.bw
      local cx, cy, rad = rg.cx, rg.cy, rg.rad
      local left, right = top + math.rad(110), top - math.rad(110)
      S("Abg", cx, cy, rad, left, right, 44, bw, 0)
      S("Azone", cx, cy, rad, left, right, 44, bw, 1)
      S("Afl", cx, cy, rad, left, top, 22, th, 2)
      S("Afr", cx, cy, rad, right, top, 22, th, 2)
      S("Atl", cx, cy, rad, left, top, 22, th, 3)
      S("Atr", cx, cy, rad, right, top, 22, th, 3)
      S("Aframe", cx, cy, rad, left, right, 44, fw, 4)
    else -- the reticle: a rim of frame art, inside it the tightening circle in fill art
      local t = math.max(2, th / 2)
      local half = math.min(W, H) / 2
      -- The rim as wide as fits after the circle's own travel (12 of it at least).
      local rim = math.max(0, math.min(t * ART_FRAME_K * 1.4, half - t - 2 - 12))
      local cx, cy = W / 2, H / 2
      local rmax = half - t - 2 - rim
      local rmin = math.max(4, rmax * 0.12)
      local rad = rmin + (rmax - rmin) * (1 - (p or 0))
      -- The circle never thicker than 0.8 of its radius, so it stays a ring as it closes.
      local function thickOf(radius) return math.min(t * 1.4, radius * 0.8) end
      S("Arim", cx, cy, half - rim / 2 - 1, top, top - 2 * math.pi, 40, rim, 0)
      S("Acirc", cx, cy, rad, top, top - 2 * math.pi, 32, thickOf(rad), 2)
      S("Atint", cx, cy, rad, top, top - 2 * math.pi, 32, thickOf(rad), 3)
      g.Acirc.thickOf, g.Atint.thickOf = thickOf, thickOf
      g.rmin, g.rmax, g.rim = rmin, rmax, rim
    end
    return g
  end

  -- The shown segments of a strip, sorted along the path: each end's angle about the center (unwound
  -- next to where segment i belongs) and its fraction of the path, its distance from the center, and
  -- the turn from start to end (negative: clockwise).
  local function readStrip(r, key, g)
    local segs, bad = {}, {}
    for i = 1, g.n do
      local line = T.part(r, key .. i)
      if T.isShown(line) then
        local x1, y1, x2, y2 = T.segEnds(line)
        if type(x1) ~= "number" or rawget(line, "kind") ~= "Line" then
          bad[#bad + 1] = key .. i .. " (" .. tostring(x1) .. ")"
        else
          local aim = g.a0 + (g.a1 - g.a0) * (i - 0.5) / g.n
          local function at(x, y)
            local a = math.atan(y - g.cy, x - g.cx)
            while a - aim > math.pi do a = a - 2 * math.pi end
            while aim - a > math.pi do a = a + 2 * math.pi end
            return a, (a - g.a0) / (g.a1 - g.a0)
          end
          local A1, f1 = at(x1, y1)
          local A2, f2 = at(x2, y2)
          segs[#segs + 1] = { i = i, line = line, A1 = A1, A2 = A2, f1 = f1, f2 = f2,
            lo = math.min(f1, f2), hi = math.max(f1, f2),
            d1 = dist(x1, y1, g.cx, g.cy), d2 = dist(x2, y2, g.cx, g.cy),
            turn = (x1 - g.cx) * (y2 - g.cy) - (y1 - g.cy) * (x2 - g.cx) }
        end
      end
    end
    table.sort(segs, function(a, b) return a.lo < b.lo end)
    return segs, bad
  end
  local function stripSpan(segs)
    local lo, hi
    for _, s in ipairs(segs) do
      lo = lo and math.min(lo, s.lo) or s.lo
      hi = hi and math.max(hi, s.hi) or s.hi
    end
    return lo, hi
  end

  -- Every check on one strip. want: slice ("bg", "fill" or "frame") for art, or color for a flat
  -- strip; alpha (nil: any); flip (top and bottom swapped); anyRadius (one circle, of any radius).
  -- to = nil skips the count of segments shown. Returns the segments and the span they cover.
  local function checkStrip(tag, r, key, g, from, to, want)
    local segs, bad = readStrip(r, key, g)
    local label = tag .. key .. ": "
    check(#bad == 0, label .. "every shown segment a Line between two points (not: " .. table.concat(bad, ", ") .. ")")
    if want.anyRadius and segs[1] then
      local copy = {}
      for k, v in pairs(g) do copy[k] = v end
      copy.rad = segs[1].d1
      if g.thickOf then copy.thick = g.thickOf(copy.rad) end -- a thickness that follows the radius
      g = copy
    end
    if to then
      local expect = 0
      if want.alpha == nil or want.alpha > 0 then
        for i = 1, g.n do if math.min(i / g.n, to) > math.max((i - 1) / g.n, from) then expect = expect + 1 end end
      end
      check(#segs == expect, label .. expect .. " segments shown (" .. #segs .. ")")
    end
    local off, ccw, thick, sub, file, args, tex, vert, col = {}, {}, {}, {}, {}, {}, {}, {}, {}
    local l, rr, t, b
    if want.slice then l, rr, t, b = T.atlasCoords(SLICE[want.slice]) end
    for _, s in ipairs(segs) do
      local line = s.line
      if not (close(s.d1, g.rad, 1e-6) and close(s.d2, g.rad, 1e-6)) then off[#off + 1] = s.i .. " at " .. num(s.d1) .. "/" .. num(s.d2) end
      if want.slice and not (s.turn < 0 and s.A1 > s.A2) then ccw[#ccw + 1] = s.i end -- art only: flat color has no top edge
      if not close(rawget(line, "thickness"), g.thick, 1e-6) then thick[#thick + 1] = s.i .. "=" .. num(rawget(line, "thickness")) end
      if rawget(line, "sublevel") ~= g.sub then sub[#sub + 1] = s.i .. "=" .. tostring(rawget(line, "sublevel")) end
      if want.slice then
        if rawget(line, "file") ~= T.atlasFile then file[#file + 1] = s.i .. "=" .. tostring(rawget(line, "file")) end
        local tc = rawget(line, "texCoord")
        if rawget(line, "texCoordArgs") ~= 4 or type(tc) ~= "table" then
          args[#args + 1] = s.i .. "=" .. tostring(rawget(line, "texCoordArgs"))
        else
          local top, bottom = t, b
          if want.flip then top, bottom = b, t end
          local u1, u2 = (tc[1] - l) / (rr - l), (tc[2] - l) / (rr - l)
          local inside = u1 >= -1e-9 and u1 <= 1 + 1e-9 and u2 >= -1e-9 and u2 <= 1 + 1e-9
          if not (inside and close(tc[3], top, 1e-12) and close(tc[4], bottom, 1e-12) and close(u1, s.f1, 1e-6) and close(u2, s.f2, 1e-6)) then
            tex[#tex + 1] = s.i .. " (u " .. num(u1) .. " to " .. num(u2) .. " lying at " .. num(s.f1) .. " to " .. num(s.f2)
              .. ", v " .. num(tc[3]) .. " to " .. num(tc[4]) .. ")"
          end
        end
        local v = rawget(line, "vertex")
        if not (v and close(v[1], 1, 1e-9) and close(v[2], 1, 1e-9) and close(v[3], 1, 1e-9) and (want.alpha == nil or close(v[4], want.alpha, 1e-6))) then
          vert[#vert + 1] = s.i .. "=" .. rgbStr(v) .. "/" .. num(v and v[4])
        end
      else
        local c = rawget(line, "colorTex")
        if not (c and sameRGB(c, want.color) and (want.alpha == nil or close(c[4], want.alpha, 1e-6))) then
          col[#col + 1] = s.i .. "=" .. rgbStr(c) .. "/" .. num(c and c[4])
        end
      end
    end
    check(#off == 0, label .. "every end on the circle of radius " .. num(g.rad) .. " (not: " .. table.concat(off, ", ") .. ")")
    if want.slice then
      check(#ccw == 0, label .. "every art segment drawn clockwise, from the larger angle to the smaller (not: " .. table.concat(ccw, ", ") .. ")")
    end
    check(#thick == 0, label .. "thickness " .. num(g.thick) .. " (not: " .. table.concat(thick, ", ") .. ")")
    check(#sub == 0, label .. "sublevel " .. g.sub .. " (not: " .. table.concat(sub, ", ") .. ")")
    if want.slice then
      check(#file == 0, label .. "the atlas file " .. T.atlasFile .. " on every segment (not: " .. table.concat(file, ", ") .. ")")
      check(#args == 0, label .. "SetTexCoord(left, right, top, bottom) on every segment (not: " .. table.concat(args, ", ") .. ")")
      check(#tex == 0, label .. "each segment shows the slice of " .. SLICE[want.slice] .. " for where it lies on the path"
        .. (want.flip and ", top and bottom swapped" or "") .. " (not: " .. table.concat(tex, "; ") .. ")")
      check(#vert == 0, label .. "vertex color white" .. (want.alpha and (" at alpha " .. num(want.alpha)) or "") .. " (not: " .. table.concat(vert, ", ") .. ")")
    else
      check(#col == 0, label .. "flat " .. rgbStr(want.color) .. (want.alpha and (" at alpha " .. num(want.alpha)) or "") .. " (not: " .. table.concat(col, ", ") .. ")")
    end
    -- Along the path: no gaps; neighbors overlap only by the art's little overlap (flat: not at all).
    local gaps, over, seams = {}, {}, {}
    local most = want.slice and (2 * ART_OVERLAP / g.n + 1e-9) or 1e-9
    for k = 2, #segs do
      local a, c = segs[k - 1], segs[k]
      if c.lo > a.hi + 1e-9 then gaps[#gaps + 1] = a.i .. "|" .. c.i end
      if a.hi - c.lo > most then over[#over + 1] = a.i .. "|" .. c.i .. " by " .. num(a.hi - c.lo) end
      if want.slice and a.hi - c.lo <= 1e-9 then seams[#seams + 1] = a.i .. "|" .. c.i end
    end
    check(#gaps == 0, label .. "no gaps between neighbors (" .. table.concat(gaps, ", ") .. ")")
    check(#over == 0, label .. "neighbors overlap by " .. num(most) .. " of the path at most (" .. table.concat(over, ", ") .. ")")
    if want.slice then
      check(#seams == 0, label .. "art neighbors overlap a little, so the outer edge shows no seams (end to end: " .. table.concat(seams, ", ") .. ")")
    end
    local lo, hi = stripSpan(segs)
    return segs, lo, hi
  end

  -- SetStartPoint calls on a list of strips of design D (whatever design is showing now), and
  -- whether every segment of them is shown.
  local function starts(r, list, D)
    local n = 0
    for _, ks in ipairs(list) do
      for i = 1, ks[2] do
        local s = r.segs[D .. ":" .. ks[1] .. i]
        n = n + (s and s.line and rawget(s.line, "startCalls") or 0)
      end
    end
    return n
  end
  local function total(list) local n = 0 for _, ks in ipairs(list) do n = n + ks[2] end return n end
  local function shownAll(r, list)
    for _, ks in ipairs(list) do
      for i = 1, ks[2] do if not T.isShown(T.part(r, ks[1] .. i)) then return false end end
    end
    return true
  end
  -- Art strips of a design shown, and Lines wearing a texture.
  local function artShown(r, D)
    local n = 0
    for name, s in pairs(r.segs) do
      if name:sub(1, #D + 2) == D .. ":A" and T.isShown(s.line or s.tex) then n = n + 1 end
    end
    return n
  end
  local function textured(r)
    local n = 0
    for _, l in ipairs(rawget(r.frame, "lines") or {}) do if rawget(l, "file") ~= nil then n = n + 1 end end
    return n
  end
`;

// The scenarios written for the Line strips run without SetVertexOffset, so that path stays covered.
const LINE_STRIPS = 'T.noVertexOffset = true -- the Line strips\n';

scenario('Blizzard art (Line strips): the arc, the ring and the reticle wear the swing timer bar art; every segment clockwise on its circle, its slice continuous along the strip', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  check(NS.Styles.Applied() == nil and db.dispThick == 12 and db.artFlip == false, "the Blizzard style, lines 12 thick, the art the right way up")
  local zf = 0.5 / 2.8
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    local tag = "[" .. D .. "] "
    local errs = #T.errors
    T.slash("display " .. D)
    local r = T.rend()
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    for _, t in ipairs({ 0.9, 1.7, 2.55 }) do
      T.now = base + t T.update()
      local p = (T.now - base) / 2.8
      local lit = t > 2.3
      local when = tag .. "p " .. num(p) .. (lit and " (in the zone)" or "") .. ": "
      check(r.mode == "art", when .. "drawn in the bar's art (" .. tostring(r.mode) .. ")")
      local g = artGeom(D, r.w, r.h, db.dispThick, p)
      local fillA, tintA = lit and 1 or 0.95, lit and 0.55 or 0
      local zoneA = (lit and db.activeAlpha or db.idleAlpha) * 0.85
      if D == "reticle" then
        local _, lo, hi = checkStrip(when, r, "Arim", g.Arim, 0, 1, { slice = "frame", alpha = 1 })
        check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), when .. "the rim all the way round (" .. num(lo) .. " to " .. num(hi) .. ")")
        _, lo, hi = checkStrip(when, r, "Acirc", g.Acirc, 0, 1, { slice = "fill", alpha = fillA })
        check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), when .. "the circle all the way round at its radius for p (" .. num(lo) .. " to " .. num(hi) .. ")")
        checkStrip(when, r, "Atint", g.Atint, 0, 1, { color = db.color, alpha = tintA })
      else
        for _, key in ipairs({ "Abg", "Aframe" }) do
          local _, lo, hi = checkStrip(when, r, key, g[key], 0, 1, { slice = key == "Abg" and "bg" or "frame", alpha = 1 })
          check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), when .. key .. ": full length (" .. num(lo) .. " to " .. num(hi) .. ")")
        end
        for _, key in ipairs(D == "arc" and { "Afl", "Afr" } or { "Afill" }) do
          local _, lo = checkStrip(when, r, key, g[key], 0, p, { slice = "fill", alpha = fillA })
          check(close(lo, 0, 1e-6), when .. key .. ": the fill starts where its path does (" .. num(lo) .. ")")
        end
        local z0, z1 = 1 - zf, 1
        if D == "arc" then z0, z1 = 0.5 - 0.5 * zf, 0.5 + 0.5 * zf end
        local _, lo, hi = checkStrip(when, r, "Azone", g.Azone, z0, z1, { color = db.color, alpha = zoneA })
        check(close(lo, z0, 1e-6) and close(hi, z1, 1e-6), when .. "the zone covers " .. (D == "arc" and "the middle " or "the last ")
          .. num(zf) .. " of the path (" .. num(lo) .. " to " .. num(hi) .. ", want " .. num(z0) .. " to " .. num(z1) .. ")")
        for _, key in ipairs(D == "arc" and { "Atl", "Atr" } or { "Atint" }) do
          local _, tlo, thi = checkStrip(when, r, key, g[key], 0, p, { color = db.color, alpha = tintA })
          if lit then check(close(tlo, 0, 1e-6) and close(thi, p, 1e-6), when .. key .. ": the tint over 0 to p exactly (" .. num(tlo) .. " to " .. num(thi) .. ")") end
        end
      end
    end
    check(T.debugSays("display: " .. NS.DISPLAY_NAMES[D] .. ", locked, shown, lines, Blizzard art, line strips"), tag .. "debug says Blizzard art, line strips")
    check(#T.errors == errs, tag .. "no Lua errors (" .. (#T.errors - errs) .. ")")
  end
  local asked = {}
  for _, name in ipairs(T.atlasQueries) do asked[name] = (asked[name] or 0) + 1 end
  check(#T.atlasQueries == 3 and asked[SLICE.frame] == 1 and asked[SLICE.bg] == 1 and asked[SLICE.fill] == 1,
    "the three atlases looked up once for the session, not every frame (" .. #T.atlasQueries .. " queries)")
  check(#T.errors == 0, "no errors")
`);

scenario('Blizzard art (Line strips): the zone and the tint follow the clock: clip color while moving in the zone, the hold shows the fill full and pulses, nothing tinted after the shot', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  local zf = 0.5 / 2.8
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    local tag = "[" .. D .. "] "
    T.slash("display " .. D)
    local r = T.rend()
    local base = 100 + index * 20
    local tints = D == "arc" and { "Atl", "Atr" } or { "Atint" }
    local fills = D == "arc" and { "Afl", "Afr" } or (D == "ring" and { "Afill" } or { "Acirc" })
    local z0, z1 = 1 - zf, 1
    if D == "arc" then z0, z1 = 0.5 - 0.5 * zf, 0.5 + 0.5 * zf end
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    -- Moving inside the zone: the tint and the zone in the clip color.
    T.now = base + 2.5 T.fire("PLAYER_STARTED_MOVING") T.update()
    local p = (T.now - base) / 2.8
    local g = artGeom(D, r.w, r.h, db.dispThick, p)
    local when = tag .. "moving in the zone: "
    for _, key in ipairs(tints) do
      local _, lo, hi = checkStrip(when, r, key, g[key], 0, D == "reticle" and 1 or p, { color = db.clipColor, alpha = 0.55 })
      check(close(lo, 0, 1e-6) and close(hi, D == "reticle" and 1 or p, 1e-6), when .. key .. ": the tint in the clip color over the fill (" .. num(lo) .. " to " .. num(hi) .. ")")
    end
    if D ~= "reticle" then checkStrip(when, r, "Azone", g.Azone, z0, z1, { color = db.clipColor, alpha = db.activeAlpha * 0.85 }) end
    T.now = base + 2.6 T.fire("PLAYER_STOPPED_MOVING") T.update()
    p = (T.now - base) / 2.8
    g = artGeom(D, r.w, r.h, db.dispThick, p)
    when = tag .. "standing in the zone: "
    for _, key in ipairs(tints) do checkStrip(when, r, key, g[key], 0, D == "reticle" and 1 or p, { color = db.color, alpha = 0.55 }) end
    -- The bar runs out with no shot: hold at the shot, the fill full, pulsing past the grace.
    local waitAt = base + 2.81
    T.now = waitAt T.update()
    check(T.stateHas("waiting for a late shot"), tag .. "holding for the shot")
    for _, t in ipairs({ 3.0, 3.25 }) do
      T.now = base + t T.update()
      local pulse = pulseAt(T.now - waitAt)
      g = artGeom(D, r.w, r.h, db.dispThick, 1)
      when = tag .. "holding (pulse " .. num(pulse) .. "): "
      for _, key in ipairs(fills) do
        local _, lo, hi = checkStrip(when, r, key, g[key], 0, 1, { slice = "fill", alpha = pulse })
        check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), when .. key .. ": the fill full (" .. num(lo) .. " to " .. num(hi) .. ")")
      end
      if D == "reticle" then
        check(close(g.Acirc.rad, g.rmin, 1e-9), when .. "the circle at its smallest")
      end
      for _, key in ipairs(tints) do
        local _, lo, hi = checkStrip(when, r, key, g[key], 0, 1, { color = db.color, alpha = 0.55 * pulse })
        check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), when .. key .. ": the tint over all of it at 0.55 of the pulse")
      end
      if D ~= "reticle" then checkStrip(when, r, "Azone", g.Azone, z0, z1, { color = db.color, alpha = db.activeAlpha * pulse * 0.85 }) end
    end
    -- The late shot: a new swing, out of the zone, nothing tinted.
    T.now = base + 3.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
    local tinted = 0
    for _, key in ipairs(tints) do for i = 1, g[key].n do if T.isShown(T.part(r, key .. i)) then tinted = tinted + 1 end end end
    check(tinted == 0, tag .. "after the shot: no tint (" .. tinted .. " segments)")
    T.now = base + 3.9 T.update()
    p = (T.now - base - 3.4) / 2.8
    g = artGeom(D, r.w, r.h, db.dispThick, p)
    if D ~= "reticle" then
      checkStrip(tag .. "the next swing: ", r, "Azone", g.Azone, z0, z1, { color = db.color, alpha = db.idleAlpha * 0.85 })
    end
  end
  check(#T.errors == 0, "no errors")
`);

scenario('Blizzard art (Line strips): the fill art covers exactly 0 to p along its path, not past it (and ends where the tint does)', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  for index, D in ipairs({ "arc", "ring" }) do
    T.slash("display " .. D)
    local r = T.rend()
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    for _, t in ipairs({ 0.9, 1.7, 2.55 }) do
      T.now = base + t T.update()
      local p = (T.now - base) / 2.8
      local g = artGeom(D, r.w, r.h, db.dispThick, p)
      local tints = D == "arc" and { "Atl", "Atr" } or { "Atint" }
      for k, key in ipairs(D == "arc" and { "Afl", "Afr" } or { "Afill" }) do
        local gk = g[key]
        local lo, hi = stripSpan((readStrip(r, key, gk)))
        local past = (hi or 0) - p
        local deg = math.deg(past * math.abs(gk.a1 - gk.a0))
        check(close(lo, 0, 1e-6) and close(hi, p, 1e-6), "[" .. D .. "] p " .. num(p) .. ": " .. key .. " from 0 to p (" .. num(lo) .. " to " .. num(hi)
          .. ": " .. num(deg) .. " degrees, " .. num(past * math.abs(gk.a1 - gk.a0) * gk.rad) .. " px past p)")
        if t > 2.3 then
          local _, thi = stripSpan((readStrip(r, tints[k], g[tints[k]])))
          check(close(thi, hi, 1e-6), "[" .. D .. "] p " .. num(p) .. ": the tint " .. tints[k] .. " ends where the fill art does (" .. num(thi) .. " and " .. num(hi) .. ")")
        end
      end
    end
  end
  check(#T.errors == 0, "no errors")
`);

for (const D of ['arc', 'ring', 'reticle']) {
  scenario('Blizzard art, Line strips (' + D + '): the background and frame strips are laid out once, not every frame; again after no swing duration, a resize, another design', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + 'local D = "' + D + '"\n' + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = D }
  T.login(200)
  local db = ShotWindowDB
  local r = T.rend()
  local S, F = STATIC[D], FILLS[D]
  local tag = "[" .. D .. "] "
  local function geomOK(label)
    local g = artGeom(D, r.w, r.h, db.dispThick, 0)
    for _, ks in ipairs(S) do
      local _, lo, hi = checkStrip(tag .. label .. ": ", r, ks[1], g[ks[1]], 0, 1, { slice = ks[1] == "Abg" and "bg" or "frame", alpha = 1 })
      check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), tag .. label .. ": " .. ks[1] .. " full length at " .. r.w .. "x" .. r.h)
    end
  end
  T.update()
  check(r.mode == "art", tag .. "drawn in the bar's art (" .. tostring(r.mode) .. ")")
  local n0 = starts(r, S, D)
  check(n0 == total(S) and shownAll(r, S), tag .. "idle at login: each static segment laid out once (" .. n0 .. " of " .. total(S) .. ") and shown")
  for k = 1, 5 do T.now = T.now + 0.1 T.update() end
  check(starts(r, S, D) == n0, tag .. "idle frames: not laid out again (" .. (starts(r, S, D) - n0) .. " more SetStartPoint calls)")

  -- No swing duration: no ranged weapon, then a bow whose speed is secret (in combat).
  T.speed.rng = nil
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, true) T.update()
  check(T.shownParts(r) == 0, tag .. "no ranged weapon: nothing shown (" .. T.shownParts(r) .. ")")
  T.speed.rng = secret(2.8)
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, false) T.update()
  check(T.shownParts(r) == 0, tag .. "a secret weapon speed: still no duration, nothing shown (" .. T.shownParts(r) .. ")")
  local n1 = starts(r, S, D)
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 100.5 T.update()
  check(starts(r, S, D) - n1 == total(S) and shownAll(r, S), tag .. "the swing brings it back: laid out again (" .. (starts(r, S, D) - n1) .. " of " .. total(S) .. ") and shown")
  geomOK("back from no duration")

  -- A whole swing: the fill moves, the static strips stay put.
  n1 = starts(r, S, D)
  local f1 = starts(r, F, D)
  for _, t in ipairs({ 1.0, 1.6, 2.2, 2.4 }) do T.now = 100 + t T.update() end
  T.now = 102.5 T.fire("PLAYER_STARTED_MOVING") T.update()
  T.now = 102.6 T.fire("PLAYER_STOPPED_MOVING") T.update()
  T.now = 102.81 T.update() T.now = 103.0 T.update() T.now = 103.2 T.update()
  T.now = 103.4 T.fire("PLAYER_SWING", 2.8, 2) T.update() T.now = 104 T.update()
  check(starts(r, F, D) > f1, tag .. "the fill laid out as it moves (" .. (starts(r, F, D) - f1) .. " SetStartPoint calls)")
  check(starts(r, S, D) == n1, tag .. "the zone, moving, the hold, the pulse and the late shot: the static strips not laid out again (" .. (starts(r, S, D) - n1) .. ")")
  check(shownAll(r, S), tag .. "and still shown")

  -- A resize from the options.
  T.slash("")
  T.click(T.tab(2))
  T.drag(T.slider("Size of a round design"), 180)
  n1 = starts(r, S, D)
  T.now = 104.1 T.update()
  check(r.w == 180 and starts(r, S, D) - n1 == total(S) and shownAll(r, S), tag .. "resized to 180: laid out again (" .. (starts(r, S, D) - n1) .. ") and shown")
  geomOK("resized")
  n1 = starts(r, S, D)
  T.now = 104.2 T.update()
  check(starts(r, S, D) == n1, tag .. "and left alone on the next frame (" .. (starts(r, S, D) - n1) .. ")")

  -- Another design and back.
  T.slash("display classic") T.now = 104.3 T.update()
  check(r.design == "classic" and T.shownParts(r, D) == 0, tag .. "another design: nothing of " .. D .. " shown (" .. T.shownParts(r, D) .. ")")
  n1 = starts(r, S, D)
  T.slash("display " .. D) T.now = 104.4 T.update()
  check(starts(r, S, D) - n1 == total(S) and shownAll(r, S), tag .. "back: laid out again (" .. (starts(r, S, D) - n1) .. ") and shown")
  geomOK("back from another design")
  T.slash("display classic") T.slash("display " .. D)
  T.now = 104.5 T.update()
  check(shownAll(r, S), tag .. "away and back with no frame drawn between: shown")
  geomOK("away and back between frames")
  check(#T.errors == 0, "no errors")
`);
}

scenario('Blizzard art (Line strips): /shotwindow flipart swaps the top and bottom of every slice, and back', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    local tag = "[" .. D .. "] "
    T.slash("display " .. D)
    local r = T.rend()
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    local function artStrips(flip, label)
      local p = (T.now - base) / 2.8
      local g = artGeom(D, r.w, r.h, db.dispThick, p)
      local list = { { "Arim", "frame", 1 }, { "Acirc", "fill", 1 } }
      if D == "arc" then list = { { "Abg", "bg", 1 }, { "Aframe", "frame", 1 }, { "Afl", "fill", p }, { "Afr", "fill", p } }
      elseif D == "ring" then list = { { "Abg", "bg", 1 }, { "Aframe", "frame", 1 }, { "Afill", "fill", p } } end
      for _, s in ipairs(list) do
        checkStrip(tag .. label .. ": ", r, s[1], g[s[1]], 0, s[3], { slice = s[2], alpha = s[2] == "fill" and 0.95 or 1, flip = flip })
      end
    end
    T.now = base + 0.9 T.update()
    artStrips(false, "the right way up")
    local n = starts(r, STATIC[D], D)
    T.slash("flipart")
    check(db.artFlip == true and T.countSaid("Blizzard art on the round designs flipped") == index, tag .. "/shotwindow flipart: flipped, and says so")
    T.now = base + 1.0 T.update()
    check(starts(r, STATIC[D], D) - n == total(STATIC[D]), tag .. "flipped: the static strips laid out again at once (" .. (starts(r, STATIC[D], D) - n) .. ")")
    artStrips(true, "flipped")
    T.slash("flipart")
    check(db.artFlip == false and T.countSaid("Blizzard art on the round designs the right way up") == index, tag .. "again: the right way up, and says so")
    T.now = base + 1.1 T.update()
    artStrips(false, "flipped back")
  end
  -- The preview: a slash command does not resize it, so the flip itself must lay its strips out again.
  T.slash("display ring")
  T.slash("")
  T.click(T.tab(2))
  local pr = T.preview().renderer
  local function previewStatic(flip, label)
    local g = artGeom("ring", pr.w, pr.h, db.dispThick, 0)
    check(pr.design == "ring" and pr.mode == "art", "[ring] preview " .. label .. ": in the bar's art")
    for _, key in ipairs({ "Abg", "Aframe" }) do
      checkStrip("[ring] preview " .. label .. ": ", pr, key, g[key], 0, 1, { slice = key == "Abg" and "bg" or "frame", alpha = 1, flip = flip })
    end
  end
  T.now = 200 T.update() T.now = 200.1 T.update()
  previewStatic(false, "the right way up")
  T.slash("flipart") T.now = 200.2 T.update()
  previewStatic(true, "flipped")
  T.slash("flipart") T.now = 200.3 T.update()
  previewStatic(false, "flipped back")
  check(#T.errors == 0, "no errors")
`);

// The fallbacks: the round designs drawn flat, as before the art, with nothing of it left over.
const ART_FALLBACK = String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  if FB == "dark" then ShotWindowDB = { style = "dark" } end
  if FB == "missing" or FB == "nil" or FB == "error" then T.atlasMode = FB end
  if FB == "squares" then T.noLines = true end
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  check(FB ~= "dark" or NS.Styles.Applied() == "dark", "Dark drawn")
  local FLAT = { arc = { "tl", "fl" }, ring = { "t", "f" }, reticle = { "c" } }
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    local tag = "[" .. D .. "] "
    local errs = #T.errors
    T.slash("display " .. D)
    local r = T.rend()
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    local function flatNow(when)
      check(r.mode == "flat", tag .. when .. ": drawn flat (" .. tostring(r.mode) .. ")")
      check(textured(r) == 0 and artShown(r, D) == 0, tag .. when .. ": no art anywhere (" .. textured(r) .. " textured lines, " .. artShown(r, D) .. " art segments shown)")
      for _, k in ipairs(FLAT[D]) do check(T.isShown(T.part(r, k .. "1")), tag .. when .. ": the flat " .. k .. " drawn") end
    end
    T.now = base + 1.0 T.update() flatNow("before the zone")
    T.now = base + 2.5 T.update() flatNow("in the zone")
    T.now = base + 2.81 T.update() T.now = base + 3.0 T.update() flatNow("holding")
    T.now = base + 3.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
    check(#T.errors == errs, tag .. "no Lua errors (" .. (#T.errors - errs) .. ")")
  end
  check(#T.atlasQueries <= 3, "the atlases looked up once at most, never every frame (" .. #T.atlasQueries .. " queries)")
  if FB == "missing" then check(#T.atlasQueries == 0, "no GetAtlasInfo: nothing asked") end
  if FB == "squares" then
    check(T.debugSays("display: Tightening reticle, locked, shown, squares, flat (no way to bend the art), line strips"), "debug: squares, no way to bend the art")
  else
    local why = FB == "dark" and "flat (a drawn window style)" or "flat (no atlas info)"
    check(T.debugSays("display: Tightening reticle, locked, shown, lines, " .. why .. ", line strips"), "debug: " .. why .. ", line strips")
  end
  check(#T.errors == 0, "no errors")
`;
for (const [fb, label] of [['dark', 'the Dark style'], ['missing', 'no C_Texture.GetAtlasInfo'], ['nil', 'GetAtlasInfo answers nothing'],
  ['error', 'GetAtlasInfo raises'], ['squares', 'no CreateLine']]) {
  scenario('Blizzard art fallback, Line strips (' + label + '): the round designs drawn flat through a fight, without errors', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + 'local FB = "' + fb + '"\n' + ART_FALLBACK);
}

scenario('Blizzard art (Line strips): Dark chosen live hides the art and draws the round designs flat at once', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "ring" }
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  local r = T.rend()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  check(r.mode == "art" and artShown(r, "ring") > 0, "Blizzard: the ring in the bar's art (" .. artShown(r, "ring") .. " art segments)")
  T.slash("style dark")
  check(NS.Styles.Applied() == "dark", "Dark drawn at once")
  T.now = 101.1 T.update()
  check(r.mode == "flat" and artShown(r, "ring") == 0, "Dark: no art left shown (" .. tostring(r.mode) .. ", " .. artShown(r, "ring") .. ")")
  check(T.isShown(T.part(r, "t1")) and T.isShown(T.part(r, "f1")), "Dark: the flat track and fill drawn")
  for _, D in ipairs({ "arc", "reticle" }) do
    T.slash("display " .. D) T.now = T.now + 0.1 T.update()
    check(r.mode == "flat" and artShown(r, D) == 0, D .. ": flat, no art")
  end
  check(#T.errors == 0, "no errors")
`);

scenario('Blizzard art (Line strips): the preview in the options wears the same art as the display', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  T.slash("")
  T.click(T.tab(2))
  local box = T.preview()
  local pr = box and box.renderer
  check(pr ~= nil and box:IsVisible(), "the preview over the tabs, on the Display tab too")
  -- The ring again last: the reticle is the same size, so the preview is not resized on the way
  -- back and only the design change can bring its strips back.
  for index, D in ipairs({ "arc", "ring", "reticle", "ring" }) do
    local tag = "[" .. D .. "] preview: "
    T.slash("display " .. D)
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    local dr = T.rend()
    local fillSeen = 0
    for k = 1, 12 do
      T.now = base + k * 0.25 T.update()
      check(pr.design == D and pr.mode == "art" and dr.mode == "art", tag .. "in the bar's art at " .. num(k * 0.25) .. " s (" .. tostring(pr.design) .. " " .. tostring(pr.mode) .. ")")
      for _, ks in ipairs(FILLS[D]) do
        local g = artGeom(D, pr.w, pr.h, db.dispThick, 0)[ks[1]]
        local segs = checkStrip(tag .. num(k * 0.25) .. " s: ", pr, ks[1], g, 0, nil, { slice = "fill", anyRadius = D == "reticle" })
        fillSeen = fillSeen + #segs
      end
    end
    check(fillSeen > 0, tag .. "its fill art drawn (" .. fillSeen .. " segments over 12 frames)")
    check(pr.w == dr.w and pr.h == dr.h, tag .. "drawn at the display's size (" .. pr.w .. "x" .. pr.h .. ")")
    local g = artGeom(D, pr.w, pr.h, db.dispThick, 0)
    local differ = {}
    for _, ks in ipairs(STATIC[D]) do
      local _, lo, hi = checkStrip(tag, pr, ks[1], g[ks[1]], 0, 1, { slice = ks[1] == "Abg" and "bg" or "frame", alpha = 1 })
      check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), tag .. ks[1] .. " full length")
      for i = 1, ks[2] do
        local a, b = T.part(pr, ks[1] .. i), T.part(dr, ks[1] .. i)
        local same = a and b and rawget(a, "file") == rawget(b, "file") and close(rawget(a, "thickness"), rawget(b, "thickness"), 1e-9)
        local ta, tb = a and rawget(a, "texCoord"), b and rawget(b, "texCoord")
        for j = 1, 4 do same = same and ta and tb and close(ta[j], tb[j], 1e-12) end
        local sa, sb, ea, eb = a and rawget(a, "startPoint"), b and rawget(b, "startPoint"), a and rawget(a, "endPoint"), b and rawget(b, "endPoint")
        same = same and sa and sb and ea and eb and close(sa[3], sb[3], 1e-9) and close(sa[4], sb[4], 1e-9) and close(ea[3], eb[3], 1e-9) and close(ea[4], eb[4], 1e-9)
        if not same then differ[#differ + 1] = ks[1] .. i end
      end
    end
    check(#differ == 0, tag .. "the background and frame exactly as on the display (not: " .. table.concat(differ, ", ") .. ")")
  end
  check(#T.errors == 0, "no errors")
`);

scenario('Blizzard art: with no CreateLine (and no vertex offsets) under the Blizzard style the debug line does not blame a window style', DISPLAY_HELPERS + LINE_STRIPS + String.raw`
  T.noLines = true
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "ring" }
  T.login(200)
  T.update()
  check(NS.Styles.Applied() == nil, "the Blizzard style")
  local n = #T.prints
  T.slash("debug")
  local line
  for i = n + 1, #T.prints do if T.prints[i]:find("display: ", 1, true) then line = T.prints[i] end end
  check(line ~= nil and line:find("squares", 1, true) ~= nil, "the display line says squares (" .. tostring(line) .. ")")
  check(line ~= nil and line:find("a drawn window style", 1, true) == nil, "and does not give a drawn window style as the reason it is flat (" .. tostring(line) .. ")")
  check(line ~= nil and line:find("flat (no way to bend the art)", 1, true) ~= nil, "it says there is no way to bend the art (" .. tostring(line) .. ")")
  check(#T.errors == 0, "no errors")
`);

// ---------------------------------------------------------------------------------------------
// Seamless strips: with Texture:SetVertexOffset (the default in these stubs) the round designs draw
// every curve as textures whose four corners are moved onto the strip's outer and inner circles
// (1 upper left = outer at the segment's start, 2 lower left = inner at its start, 3 upper right =
// outer at its end, 4 lower right = inner at its end), so neighbors share corners and nothing
// overlaps. A piece clipped by the strip's from/to keeps its full segment's outline: its clipped
// corners lie on that segment's chords, (t - s0) * n of the way along, so every layer drawn over
// the same segment shares one outline. Pixel snapping is off on every strip texture.

// Lua helpers for the seamless strip scenarios (they follow DISPLAY_HELPERS).
const QUAD_HELPERS = ROUND_GEOM + String.raw`
  local Q_FRAME_K, TWO_PI, TOP = 30 / 22, 2 * math.pi, math.pi / 2
  local QSLICE = { bg = "ui-swingtimerbar-background", fill = "ui-swingtimerbar-filling-ranged", frame = "ui-swingtimerbar-frame" }

  -- The look the flat strips are painted in: the window style's track and move color.
  local function quadLook(db)
    if NS.Styles.Applied() then
      local r, g, b = NS.Styles.S.GetPanelColor()
      return { track = { r, g, b, 0.85 }, move = db.moveAccent and { NS.Styles.S.GetAccentColor() } or db.moveColor }
    end
    return { track = { 0.05, 0.05, 0.06, 0.6 }, move = db.moveColor }
  end

  -- Every strip a round design draws, worked out from its size and the clock alone: in drawing
  -- order, each with its key (its textures are key .. i), center, radius, thickness, path (angle a0
  -- to a1, counterclockwise from the right, y up), segments, sublevel, the part from .. to that is
  -- drawn, and its paint: an atlas slice (art) or a color (flat), and the alpha. st: p (the swing's
  -- progress), lit, clipping, pulse, idle. mode: "art" (the bar's art) or "flat". Also returns the
  -- strips by key, and info: for the arc and the ring their roundGeom (capped line thickness th,
  -- radius, the shot mark's radii); for the reticle its rim, rim radius, smallest and largest
  -- radius, the circle's radius and drawn thickness ct, and its ticks: from r0 (the circle's outer
  -- edge) len long, never past edge, shown only when len is at least min(4, full).
  local function quadStrips(D, mode, W, H, db, st, look)
    local th, zf, p = db.dispThick, 0.5 / 2.8, st.p
    local pulse = st.pulse or 1
    local zoneC = st.clipping and db.clipColor or db.color
    local zoneA = ((st.lit and db.flash) and db.activeAlpha or db.idleAlpha) * pulse
    local fillC = st.lit and zoneC or look.move
    local fillA = st.lit and pulse or 0.95
    local tintA = st.lit and 0.55 * pulse or 0
    local list, by, info = {}, {}, {}
    local function S(key, cx, cy, rad, thick, a0, a1, n, sub, from, to, paint)
      local g = { key = key, cx = cx, cy = cy, rad = rad, thick = thick, a0 = a0, a1 = a1, n = n, sub = sub,
        from = from, to = to, slice = paint.slice, color = paint.color, alpha = paint.alpha }
      list[#list + 1] = g
      by[key] = g
    end
    local left, right, fin = TOP + math.rad(110), TOP - math.rad(110), TOP - TWO_PI
    if D ~= "reticle" then
      info = roundGeom(D, mode, W, H, th)
      th = info.th -- capped to the size
    end
    if D == "arc" and mode == "art" then
      local fw, bw = info.fw, info.bw
      local cx, cy, rad = info.cx, info.cy, info.rad
      S("QAbg", cx, cy, rad, bw, left, right, 44, 0, 0, 1, { slice = "bg", alpha = 1 })
      S("QAzone", cx, cy, rad, bw, left, right, 44, 1, 0.5 - 0.5 * zf, 0.5 + 0.5 * zf, { color = zoneC, alpha = zoneA * 0.85 })
      S("QAfl", cx, cy, rad, th, left, TOP, 22, 2, 0, p, { slice = "fill", alpha = fillA })
      S("QAfr", cx, cy, rad, th, right, TOP, 22, 2, 0, p, { slice = "fill", alpha = fillA })
      S("QAtl", cx, cy, rad, th, left, TOP, 22, 3, 0, p, { color = fillC, alpha = tintA })
      S("QAtr", cx, cy, rad, th, right, TOP, 22, 3, 0, p, { color = fillC, alpha = tintA })
      S("QAframe", cx, cy, rad, fw, left, right, 44, 4, 0, 1, { slice = "frame", alpha = 1 })
    elseif D == "ring" and mode == "art" then
      local fw, bw = info.fw, info.bw
      local cx, cy, rad = info.cx, info.cy, info.rad
      S("QAbg", cx, cy, rad, bw, TOP, fin, 40, 0, 0, 1, { slice = "bg", alpha = 1 })
      S("QAzone", cx, cy, rad, bw, TOP, fin, 40, 1, 1 - zf, 1, { color = zoneC, alpha = zoneA * 0.85 })
      S("QAfill", cx, cy, rad, th, TOP, fin, 40, 2, 0, p, { slice = "fill", alpha = fillA })
      S("QAtint", cx, cy, rad, th, TOP, fin, 40, 3, 0, p, { color = fillC, alpha = tintA })
      S("QAframe", cx, cy, rad, fw, TOP, fin, 40, 4, 0, 1, { slice = "frame", alpha = 1 })
    elseif D == "arc" then
      local cx, cy, rad = info.cx, info.cy, info.rad
      S("Qtlt", cx, cy, rad, th, left, TOP, 22, 0, 0, 1 - zf, { color = look.track, alpha = look.track[4] })
      S("Qtlz", cx, cy, rad, th, left, TOP, 22, 0, 1 - zf, 1, { color = zoneC, alpha = zoneA })
      S("Qtrt", cx, cy, rad, th, right, TOP, 22, 0, 0, 1 - zf, { color = look.track, alpha = look.track[4] })
      S("Qtrz", cx, cy, rad, th, right, TOP, 22, 0, 1 - zf, 1, { color = zoneC, alpha = zoneA })
      S("Qfl", cx, cy, rad, th, left, TOP, 22, 2, 0, p, { color = fillC, alpha = fillA })
      S("Qfr", cx, cy, rad, th, right, TOP, 22, 2, 0, p, { color = fillC, alpha = fillA })
    elseif D == "ring" then
      local cx, cy, rad = info.cx, info.cy, info.rad
      S("Qtt", cx, cy, rad, th, TOP, fin, 40, 0, 0, 1 - zf, { color = look.track, alpha = look.track[4] })
      S("Qtz", cx, cy, rad, th, TOP, fin, 40, 0, 1 - zf, 1, { color = zoneC, alpha = zoneA })
      S("Qf", cx, cy, rad, th, TOP, fin, 40, 2, 0, p, { color = fillC, alpha = fillA })
    else -- the reticle
      local t = math.max(2, th / 2)
      local half = math.min(W, H) / 2
      local cx, cy = W / 2, H / 2
      -- The rim (art only) as wide as fits after the circle's own travel; the circle never thicker
      -- than 0.8 of its radius.
      local rim = mode == "art" and math.max(0, math.min(t * Q_FRAME_K * 1.4, half - t - 2 - 12)) or 0
      local rmax = half - t - 2 - rim
      local rmin = math.max(4, rmax * 0.12)
      local rad = rmin + (rmax - rmin) * (1 - p)
      local zrad = rmin + (rmax - rmin) * zf
      local rimR = half - rim / 2 - 1
      -- The circle's drawn thickness: the line's (1.4 of it in art), never more than 0.8 of its radius.
      local ct = mode == "art" and math.min(t * 1.4, rad * 0.8) or math.min(t, rad * 0.8)
      if mode == "art" then
        S("QArim", cx, cy, rimR, rim, TOP, fin, 40, 0, 0, 1, { slice = "frame", alpha = rim >= 2 and 1 or 0 })
        S("QAcirc", cx, cy, rad, ct, TOP, fin, 32, 2, 0, 1, { slice = "fill", alpha = st.idle and 0.6 or fillA })
        S("QAtint", cx, cy, rad, ct, TOP, fin, 32, 3, 0, 1, { color = fillC, alpha = tintA })
      end
      S("Qz", cx, cy, zrad, 1.5, 0, TWO_PI, 32, 4, 0, 1, { color = zoneC, alpha = math.max(zoneA, 0.3) })
      if mode ~= "art" then
        S("Qc", cx, cy, rad, ct, 0, TWO_PI, 32, 2, 0, 1, { color = fillC, alpha = st.idle and 0.5 or fillA })
      end
      -- The ticks start at the circle's drawn outer edge and stop 1 short of the rim's inner edge
      -- (art, the rim shown) or of the frame's edge.
      local r0, full = rad + ct / 2, rmax * 0.18
      local edge = (mode == "art" and rim >= 2) and (rimR - rim / 2 - 1) or (half - 1)
      local len = math.min(full, edge - r0)
      info = { rim = rim, rimR = rimR, rmin = rmin, rmax = rmax, rad = rad, half = half, ct = ct, cx = cx, cy = cy,
        r0 = r0, full = full, edge = edge, len = len, ticks = len >= math.min(4, full) }
    end
    return list, by, info
  end

  local function same(c, d, tol) return type(c) == "table" and type(d) == "table" and math.abs(c[1] - d[1]) <= tol and math.abs(c[2] - d[2]) <= tol end
  local function cstr(c) if type(c) ~= "table" then return tostring(c) end return "(" .. num(c[1]) .. ", " .. num(c[2]) .. ")" end
  -- A point's place along strip g's path, as a fraction from a0 to a1, from its angle about the
  -- center unwound next to aim.
  local function fracAt(g, x, y, aim)
    local a = math.atan(y - g.cy, x - g.cx)
    while a - aim > math.pi do a = a - TWO_PI end
    while aim - a > math.pi do a = a + TWO_PI end
    return (a - g.a0) / (g.a1 - g.a0)
  end

  -- Segment i of strip g whole: its four corners on the circles, in the client's order (1 outer and
  -- 2 inner where it starts, 3 outer and 4 inner where it ends).
  local function fullCorners(g, i)
    local ro, ri = g.rad + g.thick / 2, math.max(0, g.rad - g.thick / 2)
    local A0, A1 = g.a0 + (g.a1 - g.a0) * (i - 1) / g.n, g.a0 + (g.a1 - g.a0) * i / g.n
    return { { g.cx + ro * math.cos(A0), g.cy + ro * math.sin(A0) }, { g.cx + ri * math.cos(A0), g.cy + ri * math.sin(A0) },
      { g.cx + ro * math.cos(A1), g.cy + ro * math.sin(A1) }, { g.cx + ri * math.cos(A1), g.cy + ri * math.sin(A1) } }
  end
  local function lerp2(p, q, u) return { (1 - u) * p[1] + u * q[1], (1 - u) * p[2] + u * q[2] } end
  -- Where point x lies along the chord from p to q (0 at p, 1 at q), and how far off that line.
  local function chordAt(p, q, x)
    local dx, dy = q[1] - p[1], q[2] - p[2]
    local L2 = dx * dx + dy * dy
    if L2 <= 0 then return nil, nil end
    return ((x[1] - p[1]) * dx + (x[2] - p[2]) * dy) / L2, math.abs((x[1] - p[1]) * dy - (x[2] - p[2]) * dx) / math.sqrt(L2)
  end

  -- Every check on one seamless strip g (from quadStrips): which segments show; at an end of a piece
  -- that from/to does not clip, corners 1 and 3 on the outer circle and 2 and 4 on the inner one
  -- (within 1e-6), 1 and 2 where the segment starts along the path and 3 and 4 where it ends; at a
  -- clipped end (t0 > s0 or t1 < s1, s0 = (i - 1) / n, s1 = i / n) the two corners on the full
  -- segment's outer and inner chords, u = (t - s0) * n of the way along (within 1e-6); neighbors
  -- sharing their corners (within 1e-9), no overlap, the strip covering exactly from .. to (each
  -- end's place along the path: its angle when unclipped, s0 + u / n along its chord when clipped),
  -- the draw layer, and the paint: art wears the atlas file with its u following that place and its
  -- top on the outer corners (bottom when flipped), white at the alpha; flat is SetColorTexture in
  -- the color at the alpha. Returns the shown segments in order, each { i, c (its corners), f0, f1
  -- (path fractions), clipped (either end) }.
  local function checkQuads(tag, r, g, flip)
    local label = tag .. g.key .. ": "
    local ro, ri = g.rad + g.thick / 2, math.max(0, g.rad - g.thick / 2)
    local segs, expect, nClipped = {}, 0, 0
    local vis, anchors, outer, inner, along, chord, layer, paint = {}, {}, {}, {}, {}, {}, {}, {}
    local l, rr, t, b
    if g.slice then l, rr, t, b = T.atlasCoords(QSLICE[g.slice]) end
    for i = 1, g.n do
      local tex = T.part(r, g.key .. i)
      local s0, s1 = (i - 1) / g.n, i / g.n
      local t0, t1 = math.max(s0, g.from), math.min(s1, g.to)
      local want = t1 > t0 and g.alpha > 0
      if want then expect = expect + 1 end
      if T.isShown(tex) ~= want then vis[#vis + 1] = i .. (want and " hidden" or " shown") end
      local c = want and T.isShown(tex) and T.quadCorners(tex)
      if c and type(c) ~= "table" then anchors[#anchors + 1] = i .. " (" .. tostring(c) .. ")" end
      if type(c) == "table" then
        local aim = g.a0 + (g.a1 - g.a0) * (i - 0.5) / g.n
        local F = fullCorners(g, i)
        local fEnd = {}
        -- e = 1: the start (corners 1 and 2), e = 2: the end (corners 3 and 4).
        for e = 1, 2 do
          local ko, ki = 2 * e - 1, 2 * e
          local tt = e == 1 and t0 or t1
          local clipped = (e == 1 and t0 > s0) or (e == 2 and t1 < s1)
          if clipped then
            local u = (tt - s0) * g.n
            local wo, wi = lerp2(F[1], F[3], u), lerp2(F[2], F[4], u)
            local uo, offO = chordAt(F[1], F[3], c[ko])
            local ui, offI = chordAt(F[2], F[4], c[ki])
            if not (same(c[ko], wo, 1e-6) and same(c[ki], wi, 1e-6)) then
              chord[#chord + 1] = i .. (e == 1 and " start" or " end") .. " at " .. num(uo) .. "/" .. num(ui) .. " along, " .. num(offO) .. "/" .. num(offI)
                .. " off its chords (want " .. num(u) .. ")"
            end
            fEnd[e] = uo and (s0 + uo / g.n) or nil
          else
            local dO, dI = dist(c[ko][1], c[ko][2], g.cx, g.cy), dist(c[ki][1], c[ki][2], g.cx, g.cy)
            if not close(dO, ro, 1e-6) then outer[#outer + 1] = i .. " corner " .. ko .. " at " .. num(dO) end
            if not close(dI, ri, 1e-6) then inner[#inner + 1] = i .. " corner " .. ki .. " at " .. num(dI) end
            local fo = dO > 1e-6 and fracAt(g, c[ko][1], c[ko][2], aim) or nil
            local fi = dI > 1e-6 and fracAt(g, c[ki][1], c[ki][2], aim) or nil
            if not (fo and close(fo, tt, 1e-6) and (fi == nil or close(fi, tt, 1e-6))) then
              along[#along + 1] = i .. " corners " .. ko .. "/" .. ki .. " at " .. num(fo) .. "/" .. num(fi) .. ", want " .. num(tt)
            end
            fEnd[e] = fo
          end
        end
        local f0, f1 = fEnd[1], fEnd[2]
        local clippedHere = t0 > s0 or t1 < s1
        if clippedHere then nClipped = nClipped + 1 end
        if rawget(tex, "layer") ~= "ARTWORK" or rawget(tex, "sublevel") ~= g.sub then
          layer[#layer + 1] = i .. "=" .. tostring(rawget(tex, "layer")) .. " " .. tostring(rawget(tex, "sublevel"))
        end
        if g.slice then
          local tc, v = rawget(tex, "texCoord"), rawget(tex, "vertex")
          local top, bottom = t, b
          if flip then top, bottom = b, t end
          local ok = rawget(tex, "file") == T.atlasFile and rawget(tex, "texCoordArgs") == 4 and type(tc) == "table"
          local u0, u1 = ok and (tc[1] - l) / (rr - l), ok and (tc[2] - l) / (rr - l)
          ok = ok and close(u0, f0 or -1, 1e-6) and close(u1, f1 or -1, 1e-6) and close(tc[3], top, 1e-12) and close(tc[4], bottom, 1e-12)
            and type(v) == "table" and close(v[1], 1, 1e-9) and close(v[2], 1, 1e-9) and close(v[3], 1, 1e-9) and close(v[4], g.alpha, 1e-6)
          if not ok then
            paint[#paint + 1] = i .. " (file " .. tostring(rawget(tex, "file")) .. ", u " .. num(u0) .. " to " .. num(u1) .. " lying at " .. num(f0) .. " to " .. num(f1)
              .. ", v " .. num(type(tc) == "table" and tc[3]) .. " to " .. num(type(tc) == "table" and tc[4]) .. ", vertex " .. rgbStr(v) .. "/" .. num(type(v) == "table" and v[4]) .. ")"
          end
        else
          local cc = rawget(tex, "colorTex")
          if not (type(cc) == "table" and sameRGB(cc, g.color) and close(cc[4], g.alpha, 1e-6) and rawget(tex, "file") == nil) then
            paint[#paint + 1] = i .. "=" .. rgbStr(cc) .. "/" .. num(type(cc) == "table" and cc[4]) .. " file " .. tostring(rawget(tex, "file"))
          end
        end
        segs[#segs + 1] = { i = i, c = c, f0 = f0 or t0, f1 = f1 or t1, clipped = clippedHere }
      end
    end
    check(#vis == 0, label .. expect .. " segments shown, the rest hidden (not: " .. table.concat(vis, ", ") .. ")")
    check(#anchors == 0, label .. "every segment anchored by its CENTER on its frame's BOTTOMLEFT (not: " .. table.concat(anchors, ", ") .. ")")
    check(#outer == 0, label .. "unclipped ends: corners 1 and 3 on the outer circle, radius " .. num(ro) .. " (not: " .. table.concat(outer, ", ") .. ")")
    check(#inner == 0, label .. "unclipped ends: corners 2 and 4 on the inner circle, radius " .. num(ri) .. " (not: " .. table.concat(inner, ", ") .. ")")
    check(#along == 0, label .. "unclipped ends: corners 1 and 2 where the segment starts along the path, 3 and 4 where it ends (not: " .. table.concat(along, "; ") .. ")")
    check(#chord == 0, label .. nClipped .. " clipped pieces: each clipped end on its full segment's outer and inner chords, (t - s0) * n of the way along (not: "
      .. table.concat(chord, "; ") .. ")")
    check(#layer == 0, label .. "ARTWORK sublevel " .. g.sub .. " (not: " .. table.concat(layer, ", ") .. ")")
    if g.slice then
      check(#paint == 0, label .. "the slice of " .. QSLICE[g.slice] .. " for where each segment lies, its " .. (flip and "bottom" or "top")
        .. " on the outer corners, white at alpha " .. num(g.alpha) .. " (not: " .. table.concat(paint, "; ") .. ")")
    else
      check(#paint == 0, label .. "flat " .. rgbStr(g.color) .. " at alpha " .. num(g.alpha) .. " (not: " .. table.concat(paint, ", ") .. ")")
    end
    -- Neighbors share their corners and nothing overlaps; the strip covers exactly from .. to.
    local shared, over = {}, {}
    for k = 1, #segs do
      local s = segs[k]
      if not (s.f1 > s.f0) then over[#over + 1] = s.i .. " runs backwards" end
      if k > 1 then
        local a = segs[k - 1]
        if s.i ~= a.i + 1 or not (same(a.c[3], s.c[1], 1e-9) and same(a.c[4], s.c[2], 1e-9)) then
          shared[#shared + 1] = a.i .. "|" .. s.i .. " " .. cstr(a.c[3]) .. " " .. cstr(s.c[1])
        end
        if s.f0 < a.f1 - 1e-9 then over[#over + 1] = a.i .. "|" .. s.i .. " by " .. num(a.f1 - s.f0) end
      end
    end
    check(#shared == 0, label .. "each segment starts exactly where the one before it ends (not: " .. table.concat(shared, ", ") .. ")")
    check(#over == 0, label .. "no overlap along the path (" .. table.concat(over, ", ") .. ")")
    if #segs > 0 then
      check(close(segs[1].f0, g.from, 1e-6) and close(segs[#segs].f1, g.to, 1e-6), label .. "covers exactly " .. num(g.from) .. " to "
        .. num(g.to) .. " of its path (" .. num(segs[1].f0) .. " to " .. num(segs[#segs].f1) .. ")")
    end
    return segs
  end

  -- Pixel snapping off on every seamless strip texture of renderer r (of design D; nil: every
  -- design): SetSnapToPixelGrid(false) and SetTexelSnappingBias(0), each exactly once, made before
  -- its corners were first moved. Returns how many strip textures r has (of D).
  local function snapOnce(label, r, D)
    local bad, n = {}, 0
    for name, t in pairs(r.tex) do
      local design, k = name:match("^([^:]+):(Q.*)$")
      if k and (D == nil or design == D) then
        n = n + 1
        if not (rawget(t, "snapCalls") == 1 and rawget(t, "snapToPixelGrid") == false and rawget(t, "snapAt") == 0
          and rawget(t, "texelBiasCalls") == 1 and rawget(t, "texelBias") == 0 and rawget(t, "texelAt") == 0) then
          bad[#bad + 1] = name .. " (snap " .. tostring(rawget(t, "snapToPixelGrid")) .. " x" .. tostring(rawget(t, "snapCalls")) .. " after "
            .. tostring(rawget(t, "snapAt")) .. " offsets, bias " .. tostring(rawget(t, "texelBias")) .. " x" .. tostring(rawget(t, "texelBiasCalls"))
            .. " after " .. tostring(rawget(t, "texelAt")) .. ")"
        end
      end
    end
    table.sort(bad)
    local shown = {}
    for k = 1, math.min(#bad, 6) do shown[k] = bad[k] end
    check(n > 0 and #bad == 0, label .. "pixel snapping off on all " .. n .. " strip textures: SetSnapToPixelGrid(false) and SetTexelSnappingBias(0) once each,"
      .. " before their corners first moved (" .. #bad .. " not: " .. table.concat(shown, ", ") .. ")")
    return n
  end
  -- Strip textures over every renderer made, and SetSnapToPixelGrid / SetTexelSnappingBias calls in
  -- all: each texture turned once, so the counts match.
  local function snapTotals()
    local n = 0
    for _, rr in ipairs(T.renderers or {}) do
      for name in pairs(rr.tex) do if name:find("^[^:]+:Q") then n = n + 1 end end
    end
    return n, T.snapCalls or 0, T.texelBiasCalls or 0
  end

  -- Every strip of a design checked; the shown segments by key. Pixel snapping checked too (unless
  -- the client has no such methods: T.noPixelSnap).
  local function checkAll(tag, r, list, flip)
    local segs = {}
    for _, g in ipairs(list) do segs[g.key] = checkQuads(tag, r, g, flip) end
    if not T.noPixelSnap then snapOnce(tag, r, r.design) end
    return segs
  end
  -- How many pieces clipped by from/to were checked among the shown segments.
  local function clippedCount(segs)
    local n = 0
    for _, list in pairs(segs) do for _, s in ipairs(list) do if s.clipped then n = n + 1 end end end
    return n
  end
  -- Layers over the same segments share one outline: every shown piece of strip top lies on the
  -- piece of strip base over the same segment (whole, or clipped the same way): its corners 1 and 3
  -- on base's outer edge (base's corners 1 to 3), 2 and 4 on its inner edge (2 to 4).
  local function onOutline(label, top, base)
    local byI, bad = {}, {}
    for _, s in ipairs(base or {}) do byI[s.i] = s end
    local function onEdge(p, a, b)
      local u, off = chordAt(a, b, p)
      return u ~= nil and u >= -1e-9 and u <= 1 + 1e-9 and off <= 1e-6
    end
    for _, s in ipairs(top or {}) do
      local q = byI[s.i]
      if not (q and onEdge(s.c[1], q.c[1], q.c[3]) and onEdge(s.c[3], q.c[1], q.c[3]) and onEdge(s.c[2], q.c[2], q.c[4]) and onEdge(s.c[4], q.c[2], q.c[4])) then
        bad[#bad + 1] = tostring(s.i)
      end
    end
    check(top ~= nil and #top > 0 and #bad == 0, label .. " (" .. #(top or {}) .. " pieces; not: " .. table.concat(bad, ", ") .. ")")
  end
  -- The reticle's four ticks (info from quadStrips): Lines at ARTWORK 5 on the axes (right, up, left,
  -- down), each from the circle's drawn outer edge r0 out len, never past edge; hidden rather than
  -- shorter than min(4, rmax * 0.18). circ: the circle's strip key, whose first corner (on the
  -- right or at the top, both axes) gives the outer edge as drawn.
  local function checkTicks(when, r, info, circ)
    local bad, past = {}, {}
    local c = T.quadCorners(T.part(r, circ .. "1"))
    local drawnEdge = type(c) == "table" and dist(c[1][1], c[1][2], info.cx, info.cy) or nil
    check(drawnEdge ~= nil and close(drawnEdge, info.r0, 1e-6), when .. "the circle's drawn outer edge at rad + ct / 2 = " .. num(info.r0) .. " (" .. num(drawnEdge) .. ")")
    for i, a in ipairs({ 0, TOP, math.pi, 3 * TOP }) do
      local tick = T.part(r, "tick" .. i)
      local shown = T.isShown(tick)
      if not (tick and rawget(tick, "kind") == "Line" and rawget(tick, "layer") == "ARTWORK" and rawget(tick, "sublevel") == 5) then
        bad[#bad + 1] = i .. " not a Line at ARTWORK 5"
      elseif shown ~= info.ticks then
        bad[#bad + 1] = i .. (shown and " shown" or " hidden")
      elseif shown then
        local x1, y1, x2, y2 = T.segEnds(tick)
        local d1, d2 = dist(x1, y1, info.cx, info.cy), dist(x2, y2, info.cx, info.cy)
        local ok = type(x1) == "number" and close(x1, info.cx + info.r0 * math.cos(a), 1e-6) and close(y1, info.cy + info.r0 * math.sin(a), 1e-6)
          and close(x2, info.cx + (info.r0 + info.len) * math.cos(a), 1e-6) and close(y2, info.cy + (info.r0 + info.len) * math.sin(a), 1e-6)
        if not ok then bad[#bad + 1] = i .. " from " .. num(d1) .. " to " .. num(d2) end
        if not (d1 and drawnEdge and close(d1, drawnEdge, 1e-6)) then past[#past + 1] = i .. " starts at " .. num(d1) .. ", not on the circle's edge" end
        if not (d2 and d2 <= info.edge + 1e-9) then past[#past + 1] = i .. " reaches " .. num(d2) .. ", past " .. num(info.edge) end
        if not (d1 and d2 and d2 - d1 >= math.min(4, info.full) - 1e-9) then past[#past + 1] = i .. " only " .. num(d2 and d1 and d2 - d1) .. " long" end
      end
    end
    check(#bad == 0, when .. (info.ticks and ("the ticks on their axes from " .. num(info.r0) .. " out " .. num(info.len))
      or ("the ticks hidden: only " .. num(info.len) .. " fits, under " .. num(math.min(4, info.full)))) .. " (not: " .. table.concat(bad, ", ") .. ")")
    check(#past == 0, when .. "shown ticks start at the circle's drawn edge, stop by " .. num(info.edge) .. " (" .. (info.rim >= 2 and "1 inside the rim" or "1 inside the frame")
      .. ") and are at least " .. num(math.min(4, info.full)) .. " long (not: " .. table.concat(past, ", ") .. ")")
  end
  -- A strip all the way round closes on itself: its last segment ends where its first starts.
  local function closes(label, segs)
    local a, z = segs and segs[1], segs and segs[#segs]
    check(a ~= nil and same(z.c[3], a.c[1], 1e-9) and same(z.c[4], a.c[2], 1e-9),
      label .. ": all the way round, the last segment ends exactly where the first starts (" .. cstr(z and z.c[3]) .. " and " .. cstr(a and a.c[1]) .. ")")
  end
  -- Two strips that meet: a's last segment ends exactly where b's first starts (or where b's last
  -- ends: endToEnd).
  local function meets(label, a, b, endToEnd)
    local x = a and a[#a]
    local y = b and (endToEnd and b[#b] or b[1])
    local y1, y2 = y and (endToEnd and y.c[3] or y.c[1]), y and (endToEnd and y.c[4] or y.c[2])
    check(x ~= nil and y ~= nil and same(x.c[3], y1, 1e-9) and same(x.c[4], y2, 1e-9), label .. " (" .. cstr(x and x.c[3]) .. " and " .. cstr(y1) .. ")")
  end
  -- Segments of design D made as Lines (or squares), other than the shot mark and the ticks.
  local function lineSegs(r, D)
    local out = {}
    for name in pairs(r.segs) do
      local k = name:sub(#D + 2)
      if name:sub(1, #D + 1) == D .. ":" and k ~= "shot" and not k:find("^tick%d$") then out[#out + 1] = k end
    end
    table.sort(out)
    return out
  end

  -- SetVertexOffset calls per seamless strip texture of design D, by key.
  local function vcalls(r, D)
    local out = {}
    for name, t in pairs(r.tex) do
      if name:sub(1, #D + 2) == D .. ":Q" then out[name:sub(#D + 2)] = rawget(t, "vertexOffsetCalls") or 0 end
    end
    return out
  end
  -- The textures of design D laid out while fn runs: key -> SetVertexOffset calls.
  local function during(r, D, fn)
    local before = vcalls(r, D)
    fn()
    local diff = {}
    for k, v in pairs(vcalls(r, D)) do if v ~= (before[k] or 0) then diff[k] = v - (before[k] or 0) end end
    return diff
  end
  -- Each segment a list of strips shows, with where it lies: key .. i -> its numbers.
  local function segModel(list)
    local m = {}
    for _, g in ipairs(list) do
      for i = 1, g.n do
        local t0, t1 = math.max((i - 1) / g.n, g.from), math.min(i / g.n, g.to)
        if t1 > t0 and g.alpha > 0 then
          m[g.key .. i] = { g.cx, g.cy, g.rad + g.thick / 2, math.max(0, g.rad - g.thick / 2), g.a0, g.a1, t0, t1 }
        end
      end
    end
    return m
  end
  -- The segments shown in model b that were not shown in a or lie somewhere else (a nil: all of b).
  local function moved(a, b)
    local out = {}
    for k, v in pairs(b) do
      local o = a and a[k]
      local unmoved = o ~= nil
      if o then for j = 1, #v do if math.abs(v[j] - o[j]) > 1e-12 then unmoved = false end end end
      if not unmoved then out[k] = true end
    end
    return out
  end
  -- What was laid out (diff, from during) against what should have been (want, from moved): each
  -- of those once (its four corners), nothing else.
  local function checkLaid(label, diff, want)
    local missing, extra, wrong, n, w = {}, {}, {}, 0, 0
    for k in pairs(want) do w = w + 1 if not diff[k] then missing[#missing + 1] = k end end
    for k, c in pairs(diff) do
      n = n + c
      if not want[k] then extra[#extra + 1] = k elseif c ~= 4 then wrong[#wrong + 1] = k .. "=" .. c end
    end
    table.sort(missing) table.sort(extra) table.sort(wrong)
    check(#missing == 0 and #extra == 0 and #wrong == 0 and n == 4 * w, label .. ": " .. w .. " segments laid out, four corners each (" .. n
      .. " SetVertexOffset calls; not laid out: " .. table.concat(missing, " ") .. "; laid out though unmoved: " .. table.concat(extra, " ")
      .. "; calls: " .. table.concat(wrong, " ") .. ")")
  end
`;

scenario('stubs: Texture:SetVertexOffset takes vertex 1 to 4 and numbers only; T.quadCorners adds each offset to its corner of the box; T.noVertexOffset takes the method away', String.raw`
  local f = CreateFrame("Frame", nil, UIParent)
  local t = f:CreateTexture()
  for _, bad in ipairs({ 0, 5, 1.5, "1" }) do
    check(not pcall(t.SetVertexOffset, t, bad, 0, 0), "vertex " .. tostring(bad) .. " refused")
  end
  check(not pcall(t.SetVertexOffset, t, 1, "x", 0) and not pcall(t.SetVertexOffset, t, 1, 0, nil) and not pcall(t.SetVertexOffset, t, 1, 0 / 0, 0),
    "offsets must be numbers")
  t:SetSize(2, 2) t:SetPoint("CENTER", f, "BOTTOMLEFT", 10, 20)
  t:SetVertexOffset(1, -3, 4) t:SetVertexOffset(4, 5, -6)
  local c = T.quadCorners(t)
  check(c[1][1] == 6 and c[1][2] == 25 and c[2][1] == 9 and c[2][2] == 19 and c[3][1] == 11 and c[3][2] == 21 and c[4][1] == 16 and c[4][2] == 13,
    "the corners: upper left moved, lower left and upper right where the box puts them, lower right moved")
  check(rawget(t, "vertexOffsetCalls") == 2 and T.vertexOffsetCalls == 2, "calls counted per texture and in all")
  t:Hide()
  check(T.quadCorners(t) == nil, "hidden: no corners")
  T.noVertexOffset = true
  check(f:CreateTexture().SetVertexOffset == nil, "T.noVertexOffset: no SetVertexOffset")
`);

scenario('Seamless strips (Blizzard art): the arc, the ring and the reticle through a fight: corners on their circles, neighbors share corners, each strip covers exactly its part, the art\'s u follows the path, no overlap', DISPLAY_HELPERS + QUAD_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  check(NS.Styles.Applied() == nil and db.dispThick == 12 and db.artFlip == false, "the Blizzard style, lines 12 thick, the art the right way up")
  local zf = 0.5 / 2.8
  local clippedSeen = 0
  local function artAll(r, D, when, st)
    check(r.mode == "art", when .. "drawn in the bar's art (" .. tostring(r.mode) .. ")")
    local list, by, info = quadStrips(D, "art", r.w, r.h, db, st, quadLook(db))
    local segs = checkAll(when, r, list, db.artFlip)
    clippedSeen = clippedSeen + clippedCount(segs)
    local extra = lineSegs(r, D)
    check(#extra == 0, when .. "no Line strips made (" .. table.concat(extra, ", ") .. ")")
    if D == "reticle" then
      checkTicks(when, r, info, "QAcirc")
    else
      -- The zone's clipped pieces lie on the background's outline, the tint's on the fill's.
      onOutline(when .. "the zone lies on the background's outline", segs.QAzone, segs.QAbg)
      if st.lit then
        for _, k in ipairs(D == "arc" and { { "QAtl", "QAfl" }, { "QAtr", "QAfr" } } or { { "QAtint", "QAfill" } }) do
          onOutline(when .. k[1] .. " lies on " .. k[2] .. "'s outline", segs[k[1]], segs[k[2]])
        end
      end
    end
    return segs, by, info
  end
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    local tag = "[" .. D .. "] "
    local errs = #T.errors
    T.slash("display " .. D)
    local r = T.rend()
    check(r.quads == true, tag .. "the renderer found SetVertexOffset")
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    for _, t in ipairs({ 0.9, 1.7, 2.55 }) do
      T.now = base + t T.update()
      local p = t / 2.8
      local segs, by = artAll(r, D, tag .. "p " .. num(p) .. (t > 2.3 and " (in the zone)" or "") .. ": ", { p = p, lit = t > 2.3 })
      if D ~= "reticle" then
        local z = segs.QAzone
        local z0, z1 = 1 - zf, 1
        if D == "arc" then z0, z1 = 0.5 - 0.5 * zf, 0.5 + 0.5 * zf end
        check(z and #z > 0 and close(z[1].f0, z0, 1e-6) and close(z[#z].f1, z1, 1e-6), tag .. "p " .. num(p) .. ": the zone covers " .. (D == "arc" and "the middle " or "the last ")
          .. num(zf) .. " of the path (" .. num(z and z[1] and z[1].f0) .. " to " .. num(z and z[#z] and z[#z].f1) .. ")")
        for _, k in ipairs(D == "arc" and { "QAfl", "QAfr" } or { "QAfill" }) do
          local s = segs[k]
          check(s and #s > 0 and close(s[1].f0, 0, 1e-6) and close(s[#s].f1, p, 1e-6), tag .. "p " .. num(p) .. ": " .. k .. " ends exactly at p (" .. num(s and s[#s] and s[#s].f1) .. ")")
        end
      end
    end
    T.now = base + 2.6 T.fire("PLAYER_STARTED_MOVING") T.update()
    artAll(r, D, tag .. "moving in the zone: ", { p = 2.6 / 2.8, lit = true, clipping = true })
    T.now = base + 2.7 T.fire("PLAYER_STOPPED_MOVING") T.update()
    artAll(r, D, tag .. "standing in the zone: ", { p = 2.7 / 2.8, lit = true })
    local waitAt = base + 2.81
    T.now = waitAt T.update()
    check(T.stateHas("waiting for a late shot"), tag .. "holding for the shot")
    for _, t in ipairs({ 3.0, 3.25 }) do
      T.now = base + t T.update()
      local pulse = pulseAt(T.now - waitAt)
      local when = tag .. "holding (pulse " .. num(pulse) .. "): "
      local segs = artAll(r, D, when, { p = 1, lit = true, pulse = pulse })
      if D == "arc" then
        meets(when .. "the two fills meet exactly at the top", segs.QAfl, segs.QAfr, true)
        local e = segs.QAfl and segs.QAfl[#segs.QAfl]
        check(e and close(e.c[3][1], r.w / 2, 1e-9) and e.c[3][2] > r.h * NS.ARC_CY, when .. "and the top is straight above the center")
      elseif D == "ring" then
        for _, k in ipairs({ "QAbg", "QAfill", "QAtint", "QAframe" }) do closes(when .. k, segs[k]) end
      else
        for _, k in ipairs({ "QArim", "QAcirc", "QAtint", "Qz" }) do closes(when .. k, segs[k]) end
      end
    end
    T.now = base + 3.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
    artAll(r, D, tag .. "the late shot fires: ", { p = 0, lit = false })
    T.now = base + 3.9 T.update()
    artAll(r, D, tag .. "the next swing: ", { p = 0.5 / 2.8, lit = false })
    -- The marks over the strips: the shot mark above the frame, the reticle's ticks above its circle.
    local maxSub = -99
    for name, t in pairs(r.tex) do
      if name:sub(1, #D + 2) == D .. ":Q" then maxSub = math.max(maxSub, rawget(t, "sublevel") or 0) end
    end
    if D == "reticle" then
      local bad = {}
      for i = 1, 4 do
        local tick = T.part(r, "tick" .. i)
        if not (tick and rawget(tick, "kind") == "Line" and rawget(tick, "layer") == "ARTWORK" and rawget(tick, "sublevel") == 5) then
          bad[#bad + 1] = i .. "=" .. tostring(tick and rawget(tick, "kind")) .. " " .. tostring(tick and rawget(tick, "sublevel"))
        end
      end
      check(#bad == 0 and maxSub < 5, tag .. "the ticks are Lines at ARTWORK 5, above every strip (strips up to " .. maxSub .. "; not: " .. table.concat(bad, ", ") .. ")")
      -- The zone ring over the circle (2) and its tint (3), under the ticks.
      local zs, cs, ts = {}, {}, {}
      for i = 1, 32 do
        zs[rawget(T.part(r, "Qz" .. i) or {}, "sublevel") or "none"] = true
        cs[rawget(T.part(r, "QAcirc" .. i) or {}, "sublevel") or "none"] = true
        ts[rawget(T.part(r, "QAtint" .. i) or {}, "sublevel") or "none"] = true
      end
      local function only(set, v) local n = 0 for _ in pairs(set) do n = n + 1 end return n == 1 and set[v] == true end
      check(only(zs, 4) and only(cs, 2) and only(ts, 3), tag .. "the zone ring at ARTWORK 4, over the circle at 2 and its tint at 3, under the ticks at 5")
    else
      local shot, frame1 = T.part(r, "shot"), T.part(r, "QAframe1")
      check(shot and rawget(shot, "kind") == "Line" and rawget(shot, "layer") == "ARTWORK" and rawget(shot, "sublevel") == 6 and T.isShown(shot)
        and frame1 and rawget(frame1, "sublevel") == 4 and maxSub == 4,
        tag .. "the shot mark a Line at ARTWORK 6, above the frame strip at 4 (" .. tostring(shot and rawget(shot, "sublevel")) .. " over " .. tostring(frame1 and rawget(frame1, "sublevel")) .. ", strips up to " .. maxSub .. ")")
    end
    check(T.debugSays("display: " .. NS.DISPLAY_NAMES[D] .. ", locked, shown, lines, Blizzard art, seamless strips"), tag .. "debug: Blizzard art, seamless strips")
    check(#T.errors == errs, tag .. "no Lua errors (" .. (#T.errors - errs) .. ")")
  end
  check(clippedSeen > 20, "pieces clipped by from/to were among those checked (" .. clippedSeen .. ")")

  -- /shotwindow flipart: every art strip's top and bottom swap, and back.
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    T.slash("display " .. D)
    local r = T.rend()
    local base = 200 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    T.now = base + 0.9 T.update()
    T.slash("flipart")
    check(db.artFlip == true, "[" .. D .. "] flipped")
    T.now = base + 1.0 T.update()
    artAll(r, D, "[" .. D .. "] flipped: ", { p = 1.0 / 2.8 })
    T.slash("flipart")
    T.now = base + 1.1 T.update()
    artAll(r, D, "[" .. D .. "] flipped back: ", { p = 1.1 / 2.8 })
  end
  -- The preview: a slash command does not resize it, so nothing is laid out again; the flip swaps
  -- the texcoords of strips that stay where they are.
  T.slash("display ring")
  T.slash("")
  T.click(T.tab(2))
  local pr = T.preview().renderer
  T.now = 300 T.update() T.now = 300.1 T.update()
  local function previewStatic(label)
    check(pr.design == "ring" and pr.mode == "art" and pr.quads == true, "[ring] preview " .. label .. ": in the bar's art, seamless strips")
    local _, by = quadStrips("ring", "art", pr.w, pr.h, db, { p = 0 }, quadLook(db))
    for _, k in ipairs({ "QAbg", "QAframe" }) do closes("[ring] preview " .. label .. ": " .. k, checkQuads("[ring] preview " .. label .. ": ", pr, by[k], db.artFlip)) end
  end
  local function staticCalls()
    local n = 0
    for k, c in pairs(vcalls(pr, "ring")) do if k:find("^QAbg") or k:find("^QAframe") then n = n + c end end
    return n
  end
  previewStatic("the right way up")
  local n0 = staticCalls()
  T.slash("flipart") T.now = 300.2 T.update()
  previewStatic("flipped")
  check(staticCalls() == n0, "[ring] preview flipped: the background and frame not laid out again, only their texcoords swapped (" .. (staticCalls() - n0) .. " SetVertexOffset calls)")
  T.slash("flipart") T.now = 300.3 T.update()
  previewStatic("flipped back")
  snapOnce("[ring] preview: ", pr, "ring")
  local nTex, nSnap, nBias = snapTotals()
  check(nTex > 0 and nSnap == nTex and nBias == nTex, "the display and the preview: each strip texture's snapping turned off once, never again ("
    .. nTex .. " textures, " .. nSnap .. " SetSnapToPixelGrid and " .. nBias .. " SetTexelSnappingBias calls)")
  check(#T.errors == 0, "no errors")
`);

for (const [flat, label] of [['dark', 'the Dark style'], ['missing', 'no atlas info']]) {
  scenario('Seamless strips, flat (' + label + '): the arc, the ring and the reticle through a fight: corners on their circles, neighbors share corners, track and zone meet without overlap, the colors follow the clock', DISPLAY_HELPERS + QUAD_HELPERS + 'local FLAT = "' + flat + '"\n' + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  if FLAT == "dark" then ShotWindowDB = { style = "dark" } else T.atlasMode = "missing" end
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  local db = ShotWindowDB
  check(FLAT ~= "dark" or NS.Styles.Applied() == "dark", "Dark drawn")
  local why = FLAT == "dark" and "flat (a drawn window style)" or "flat (no atlas info)"
  local function flatAll(r, D, when, st)
    check(r.mode == "flat", when .. "drawn flat (" .. tostring(r.mode) .. ")")
    local list, by, info = quadStrips(D, "flat", r.w, r.h, db, st, quadLook(db))
    local segs = checkAll(when, r, list, false)
    local extra = lineSegs(r, D)
    check(#extra == 0, when .. "no Line strips made (" .. table.concat(extra, ", ") .. ")")
    local art = 0
    for name, t in pairs(r.tex) do if name:sub(1, #D + 3) == D .. ":QA" and T.isShown(t) then art = art + 1 end end
    check(art == 0, when .. "no art strips shown (" .. art .. ")")
    if D == "arc" then
      meets(when .. "the left track ends exactly where its zone starts", segs.Qtlt, segs.Qtlz)
      meets(when .. "the right track ends exactly where its zone starts", segs.Qtrt, segs.Qtrz)
      meets(when .. "the two zones meet exactly at the top", segs.Qtlz, segs.Qtrz, true)
    elseif D == "ring" then
      meets(when .. "the track ends exactly where the zone starts", segs.Qtt, segs.Qtz)
      meets(when .. "the zone ends exactly where the track starts, all the way round", segs.Qtz, segs.Qtt)
    else
      closes(when .. "Qz", segs.Qz)
      closes(when .. "Qc", segs.Qc)
      checkTicks(when, r, info, "Qc")
      local z1, c1 = T.part(r, "Qz1"), T.part(r, "Qc1")
      check(z1 and c1 and rawget(z1, "sublevel") == 4 and rawget(c1, "sublevel") == 2, when .. "the zone ring at ARTWORK 4, over the circle at 2 ("
        .. tostring(z1 and rawget(z1, "sublevel")) .. " over " .. tostring(c1 and rawget(c1, "sublevel")) .. ")")
    end
    return segs
  end
  for index, D in ipairs({ "arc", "ring", "reticle" }) do
    local tag = "[" .. D .. "] "
    local errs = #T.errors
    T.slash("display " .. D)
    local r = T.rend()
    check(r.quads == true, tag .. "the renderer found SetVertexOffset")
    local base = 100 + index * 20
    T.now = base T.fire("PLAYER_SWING", 2.8, 2)
    for _, t in ipairs({ 0.9, 1.7, 2.55 }) do
      T.now = base + t T.update()
      local p = t / 2.8
      local segs = flatAll(r, D, tag .. "p " .. num(p) .. (t > 2.3 and " (in the zone)" or "") .. ": ", { p = p, lit = t > 2.3 })
      for _, k in ipairs(D == "arc" and { "Qfl", "Qfr" } or (D == "ring" and { "Qf" } or {})) do
        local s = segs[k]
        check(s and #s > 0 and close(s[1].f0, 0, 1e-6) and close(s[#s].f1, p, 1e-6), tag .. "p " .. num(p) .. ": " .. k .. " ends exactly at p (" .. num(s and s[#s] and s[#s].f1) .. ")")
      end
    end
    T.now = base + 2.6 T.fire("PLAYER_STARTED_MOVING") T.update()
    flatAll(r, D, tag .. "moving in the zone: ", { p = 2.6 / 2.8, lit = true, clipping = true })
    T.now = base + 2.7 T.fire("PLAYER_STOPPED_MOVING") T.update()
    flatAll(r, D, tag .. "standing in the zone: ", { p = 2.7 / 2.8, lit = true })
    local waitAt = base + 2.81
    T.now = waitAt T.update()
    for _, t in ipairs({ 3.0, 3.25 }) do
      T.now = base + t T.update()
      local pulse = pulseAt(T.now - waitAt)
      local when = tag .. "holding (pulse " .. num(pulse) .. "): "
      local segs = flatAll(r, D, when, { p = 1, lit = true, pulse = pulse })
      if D == "arc" then meets(when .. "the two fills meet exactly at the top", segs.Qfl, segs.Qfr, true) end
      if D == "ring" then closes(when .. "Qf", segs.Qf) end
    end
    T.now = base + 3.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
    flatAll(r, D, tag .. "the late shot fires: ", { p = 0, lit = false })
    T.now = base + 3.9 T.update()
    flatAll(r, D, tag .. "the next swing: ", { p = 0.5 / 2.8, lit = false })
    local maxSub = -99
    for name, t in pairs(r.tex) do
      if name:sub(1, #D + 2) == D .. ":Q" then maxSub = math.max(maxSub, rawget(t, "sublevel") or 0) end
    end
    if D ~= "reticle" then
      local shot = T.part(r, "shot")
      check(shot and rawget(shot, "kind") == "Line" and rawget(shot, "sublevel") == 6 and maxSub < 6,
        tag .. "the shot mark a Line at ARTWORK 6, above every strip (" .. tostring(shot and rawget(shot, "sublevel")) .. ", strips up to " .. maxSub .. ")")
    end
    check(T.debugSays("display: " .. NS.DISPLAY_NAMES[D] .. ", locked, shown, lines, " .. why .. ", seamless strips"), tag .. "debug: " .. why .. ", seamless strips")
    check(#T.errors == errs, tag .. "no Lua errors (" .. (#T.errors - errs) .. ")")
  end
  check(#T.errors == 0, "no errors")
`);
}

for (const D of ['arc', 'ring', 'reticle']) {
  scenario('Seamless strips (' + D + '): a segment is laid out again only when its place changes; everything again, and shown, after HideParts, a resize, another design, another style, no swing', DISPLAY_HELPERS + QUAD_HELPERS + 'local D = "' + D + '"\n' + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = D }
  T.login(200)
  local db = ShotWindowDB
  local r = T.rend()
  local tag = "[" .. D .. "] "
  local function model(mode, st) return segModel((quadStrips(D, mode, r.w, r.h, db, st, quadLook(db)))) end
  local function drawnAs(label, mode, st)
    check(r.mode == mode, tag .. label .. ": drawn " .. mode .. " (" .. tostring(r.mode) .. ")")
    checkAll(tag .. label .. ": ", r, (quadStrips(D, mode, r.w, r.h, db, st, quadLook(db))), db.artFlip)
  end
  T.update()
  check(r.quads == true and r.mode == "art", tag .. "seamless strips in the bar's art (" .. tostring(r.quads) .. ", " .. tostring(r.mode) .. ")")
  local n0 = T.vertexOffsetCalls or 0
  check(n0 > 0, tag .. "laid out at login (" .. n0 .. " SetVertexOffset calls)")
  local nTex = snapOnce(tag .. "at login: ", r, D)
  local s0, b0 = T.snapCalls or 0, T.texelBiasCalls or 0
  check(s0 == nTex and b0 == nTex, tag .. "at login: one SetSnapToPixelGrid and one SetTexelSnappingBias per strip texture (" .. s0 .. " and " .. b0 .. " for " .. nTex .. ")")
  for k = 1, 5 do T.now = T.now + 0.1 T.update() end
  check((T.vertexOffsetCalls or 0) == n0, tag .. "idle frames, nothing moved: no SetVertexOffset (" .. ((T.vertexOffsetCalls or 0) - n0) .. ")")
  check((T.snapCalls or 0) == s0 and (T.texelBiasCalls or 0) == b0, tag .. "idle frames: pixel snapping not set again (" .. ((T.snapCalls or 0) - s0) .. " and "
    .. ((T.texelBiasCalls or 0) - b0) .. " more calls)")

  -- A moving fill: only the segments whose part changed (and the reticle's circle, which shrinks).
  local B = 110 -- the swing starts here; the late shot comes at B + 3.4
  local function at(t) T.now = B + t T.update() end
  T.now = B T.fire("PLAYER_SWING", 2.8, 2)
  at(1)
  local a = model("art", { p = 1 / 2.8 })
  local diff = during(r, D, function() at(1.02) end)
  local b = model("art", { p = 1.02 / 2.8 })
  checkLaid(tag .. "the fill moves a little", diff, moved(a, b))
  diff = during(r, D, function() at(1.5) end)
  local c = model("art", { p = 1.5 / 2.8 })
  checkLaid(tag .. "the fill moves on", diff, moved(b, c))
  drawnAs("the fill moving", "art", { p = 1.5 / 2.8 })

  -- Holding for the shot: the pulse changes alphas only; nothing is laid out again.
  at(2.81)
  at(3.0)
  diff = during(r, D, function() at(3.1) end)
  checkLaid(tag .. "holding, the pulse changes only alphas", diff, {})
  drawnAs("holding", "art", { p = 1, lit = true, pulse = pulseAt(3.1 - 2.81) })

  -- The late shot, then everything hidden and laid out again.
  T.now = B + 3.4 T.fire("PLAYER_SWING", 2.8, 2) T.update()
  r:HideParts()
  check(T.shownParts(r) == 0, tag .. "HideParts: nothing shown (" .. T.shownParts(r) .. ")")
  diff = during(r, D, function() at(3.6) end)
  checkLaid(tag .. "after HideParts", diff, moved(nil, model("art", { p = 0.2 / 2.8 })))
  drawnAs("after HideParts", "art", { p = 0.2 / 2.8 })

  r:SetSize(r.w, r.h)
  diff = during(r, D, function() at(3.7) end)
  checkLaid(tag .. "after SetSize to the same size", diff, moved(nil, model("art", { p = 0.3 / 2.8 })))
  drawnAs("after SetSize to the same size", "art", { p = 0.3 / 2.8 })

  db.dispSize = 180
  T.slash("display " .. D)
  diff = during(r, D, function() at(3.8) end)
  check(r.w == 180, tag .. "resized to 180 (" .. tostring(r.w) .. ")")
  checkLaid(tag .. "resized", diff, moved(nil, model("art", { p = 0.4 / 2.8 })))
  drawnAs("resized", "art", { p = 0.4 / 2.8 })

  T.slash("display classic") at(3.9)
  check(r.design == "classic" and T.shownParts(r, D) == 0, tag .. "another design: nothing of " .. D .. " shown (" .. T.shownParts(r, D) .. ")")
  T.slash("display " .. D)
  diff = during(r, D, function() at(4.0) end)
  checkLaid(tag .. "back from another design", diff, moved(nil, model("art", { p = 0.6 / 2.8 })))
  drawnAs("back from another design", "art", { p = 0.6 / 2.8 })
  T.slash("display classic") T.slash("display " .. D)
  diff = during(r, D, function() at(4.1) end)
  checkLaid(tag .. "away and back with no frame drawn between", diff, moved(nil, model("art", { p = 0.7 / 2.8 })))
  drawnAs("away and back with no frame drawn between", "art", { p = 0.7 / 2.8 })

  -- No swing duration: Auto Shot off and the swing over (drawn idle, shown out of combat too),
  -- then the bow taken off, then put back, then a swing.
  T.autoRep[75] = false
  T.fire("STOP_AUTOREPEAT_SPELL")
  db.dispAlways = true
  at(6.3)
  check(T.stateHas("idle"), tag .. "the swing over, Auto Shot off: idle")
  drawnAs("idle", "art", { p = 0, idle = true })
  T.speed.rng = nil
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, true) at(6.4)
  check(T.shownParts(r) == 0, tag .. "no ranged weapon: nothing shown (" .. T.shownParts(r) .. ")")
  T.speed.rng = 2.8
  T.fire("PLAYER_EQUIPMENT_CHANGED", 18, false)
  diff = during(r, D, function() at(6.5) end)
  checkLaid(tag .. "a bow again", diff, moved(nil, model("art", { p = 0, idle = true })))
  drawnAs("a bow again", "art", { p = 0, idle = true })
  a = model("art", { p = 0, idle = true })
  T.now = B + 7 T.fire("PLAYER_SWING", 2.8, 2)
  diff = during(r, D, function() at(7.1) end)
  checkLaid(tag .. "a bow again, then a swing", diff, moved(a, model("art", { p = 0.1 / 2.8 })))
  drawnAs("a bow again, then a swing", "art", { p = 0.1 / 2.8 })

  -- Another style: drawn flat (only a /reload takes it back to the art).
  T.slash("style dark")
  diff = during(r, D, function() at(7.2) end)
  checkLaid(tag .. "the Dark style", diff, moved(nil, model("flat", { p = 0.2 / 2.8 })))
  drawnAs("the Dark style", "flat", { p = 0.2 / 2.8 })
  local art = 0
  for name, t in pairs(r.tex) do if name:sub(1, #D + 3) == D .. ":QA" and T.isShown(t) then art = art + 1 end end
  check(art == 0, tag .. "the Dark style: no art strip shown (" .. art .. ")")
  a = model("flat", { p = 0.2 / 2.8 })
  diff = during(r, D, function() at(7.25) end)
  checkLaid(tag .. "the Dark style, the fill moves", diff, moved(a, model("flat", { p = 0.25 / 2.8 })))
  -- After all of that (HideParts, resizes, designs, styles, no swing): still once per texture.
  snapOnce(tag .. "at the end: ", r, nil)
  local tTex, tSnap, tBias = snapTotals()
  check(tSnap == tTex and tBias == tTex, tag .. "at the end: pixel snapping set once per strip texture, never again (" .. tSnap .. " and " .. tBias
    .. " calls for " .. tTex .. " textures)")
  check(#T.errors == 0, "no errors")
`);
}

// A client without SetSnapToPixelGrid / SetTexelSnappingBias: the strips are drawn all the same.
scenario('Seamless strips without pixel snapping methods: the ring is still drawn in seamless strips, without errors', DISPLAY_HELPERS + QUAD_HELPERS + String.raw`
  T.noPixelSnap = true
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "ring" }
  T.login(200)
  local db = ShotWindowDB
  local r = T.rend()
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  check(r.quads == true and r.mode == "art", "seamless strips in the bar's art (" .. tostring(r.quads) .. ", " .. tostring(r.mode) .. ")")
  local segs = checkAll("[ring] ", r, (quadStrips("ring", "art", r.w, r.h, db, { p = 1 / 2.8 }, quadLook(db))), db.artFlip)
  check(#(segs.QAfill or {}) > 0 and T.snapCalls == nil and T.texelBiasCalls == nil, "drawn, and no snapping calls made (" .. tostring(T.snapCalls) .. ")")
  check(#T.errors == 0, "no errors (" .. tostring(T.errors[1]) .. ")")
`);

scenario('Seamless strips (reticle) at the slider extremes: the rim hidden when it does not fit, the circle tightens and stays a ring, the ticks start at its drawn edge, stop short of the rim and hide when too short',DISPLAY_HELPERS + QUAD_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = { display = "reticle" }
  T.login(200)
  local db = ShotWindowDB
  local r = T.rend()
  local base = 100
  local ticksSeen, hiddenSeen = {}, {}
  for _, mode in ipairs({ "art", "flat" }) do
    if mode == "flat" then T.slash("style dark") end
    for _, ext in ipairs({ { 60, 2 }, { 60, 30 }, { 400, 2 }, { 400, 30 }, { 140, 12 } }) do
      db.dispSize, db.dispThick = ext[1], ext[2]
      T.slash("display reticle")
      local tag = "[" .. mode .. ", size " .. ext[1] .. ", line " .. ext[2] .. "] "
      base = base + 10
      T.now = base T.fire("PLAYER_SWING", 2.8, 2)
      local prev, rimSeen
      local circ = mode == "art" and "QAcirc" or "Qc"
      for _, t in ipairs({ 0.14, 0.84, 1.68, 2.52, 2.81, 3.0 }) do
        T.now = base + t T.update()
        local hold = t > 2.8
        local p = hold and 1 or t / 2.8
        local st = { p = p, lit = t > 2.3 }
        if t == 3.0 then st.pulse = pulseAt(3.0 - 2.81) end
        local when = tag .. (hold and "holding" or ("p " .. num(p))) .. ": "
        check(r.mode == mode, when .. "drawn " .. mode .. " (" .. tostring(r.mode) .. ")")
        local list, by, info = quadStrips("reticle", mode, r.w, r.h, db, st, quadLook(db))
        local segs = checkAll(when, r, list, db.artFlip)
        -- The circle's radius from its corners: halfway between its outer and inner circle.
        local c = T.quadCorners(T.part(r, circ .. "1"))
        local ro = type(c) == "table" and dist(c[1][1], c[1][2], r.w / 2, r.h / 2)
        local ri = type(c) == "table" and dist(c[2][1], c[2][2], r.w / 2, r.h / 2)
        local rad = ro and (ro + ri) / 2
        if t ~= 3.0 then -- the second tick of the hold stays where the first left it
          check(rad and (prev == nil or rad < prev - 1e-9), when .. "the circle tightens (radius " .. num(rad) .. " after " .. num(prev) .. ")")
        end
        check(rad and ri >= 0.6 * rad - 1e-9, when .. "and stays a ring (inner radius " .. num(ri) .. " of " .. num(rad) .. ")")
        if hold then check(close(rad, info.rmin, 1e-6), when .. "closed to its smallest (" .. num(rad) .. ", want " .. num(info.rmin) .. ")") end
        prev = rad
        local rimShown = 0
        for i = 1, 40 do if T.isShown(T.part(r, "QArim" .. i)) then rimShown = rimShown + 1 end end
        if mode == "art" then
          check(rimShown == (info.rim >= 2 and 40 or 0), when .. "the rim " .. (info.rim >= 2 and "shown" or "hidden, it does not fit") .. " (" .. num(info.rim) .. " wide, " .. rimShown .. " segments shown)")
          if ext[1] == 60 and ext[2] == 30 then check(rimShown == 0, when .. "size 60, line 30: no rim") end
          if info.rim >= 2 then
            local edge = info.rimR - info.rim / 2
            check(ro and ro <= edge + 1e-9, when .. "the circle stays inside the rim (" .. num(ro) .. ", rim from " .. num(edge) .. ")")
          end
        else
          check(rimShown == 0, when .. "no rim when drawn flat (" .. rimShown .. ")")
        end
        rimSeen = rimSeen or rimShown > 0
        -- The ticks: Lines at ARTWORK 5 from the circle's drawn edge, never across the rim (art,
        -- the rim shown) or past half - 1, hidden rather than too short to read.
        checkTicks(when, r, info, circ)
        local far = 0
        for i = 1, 4 do
          local tick = T.part(r, "tick" .. i)
          if T.isShown(tick) then
            local x1, y1, x2, y2 = T.segEnds(tick)
            far = math.max(far, dist(x1, y1, r.w / 2, r.h / 2) or 1e9, dist(x2, y2, r.w / 2, r.h / 2) or 1e9)
            ticksSeen[mode] = (ticksSeen[mode] or 0) + 1
          else
            hiddenSeen[mode] = (hiddenSeen[mode] or 0) + 1
          end
        end
        local limit = rimShown > 0 and (info.rimR - info.rim / 2 - 1) or (info.half - 1)
        check(far <= limit + 1e-9, when .. "no tick past " .. num(limit) .. (rimShown > 0 and " (1 inside the rim)" or " (1 inside the frame)") .. " (" .. num(far) .. ")")
      end
    end
    check((ticksSeen[mode] or 0) > 0 and (hiddenSeen[mode] or 0) > 0, "[" .. mode .. "] the ticks both shown and hidden across the extremes ("
      .. tostring(ticksSeen[mode]) .. " shown, " .. tostring(hiddenSeen[mode]) .. " hidden)")
  end
  check(#T.errors == 0, "no errors")
`);

// The debug line names the strips and the reason a round design is flat. Each case is a client of
// its own (Line regions, vertex offsets, atlas info) or a style, set before the renderer is made.
for (const [label, setup, says, quads, mode] of [
  ['Line regions and vertex offsets', '', 'lines, Blizzard art, seamless strips', true, 'art'],
  ['no vertex offsets', 'T.noVertexOffset = true', 'lines, Blizzard art, line strips', false, 'art'],
  ['no CreateLine, vertex offsets', 'T.noLines = true', 'squares, Blizzard art, seamless strips', true, 'art'],
  ['neither Lines nor vertex offsets', 'T.noLines = true T.noVertexOffset = true', 'squares, flat (no way to bend the art), line strips', false, 'flat'],
  ['the Dark style', 'ShotWindowDB = { style = "dark" }', 'lines, flat (a drawn window style), seamless strips', true, 'flat'],
  ['the Dark style, neither Lines nor vertex offsets', 'ShotWindowDB = { style = "dark" } T.noLines = true T.noVertexOffset = true', 'squares, flat (a drawn window style), line strips', false, 'flat'],
  ['no atlas info', 'T.atlasMode = "missing"', 'lines, flat (no atlas info), seamless strips', true, 'flat'],
  ['no atlas info, neither Lines nor vertex offsets', 'T.atlasMode = "missing" T.noLines = true T.noVertexOffset = true', 'squares, flat (no way to bend the art), line strips', false, 'flat'],
  ['the atlas file as info.filename', 'T.atlasMode = "filename"', 'lines, Blizzard art, seamless strips', true, 'art'],
]) {
  scenario('Seamless strips: the debug line (' + label + '): ' + says, DISPLAY_HELPERS + setup + '\nlocal SAYS, QUADS, MODE = "' + says + '", ' + quads + ', "' + mode + '"\n' + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  ShotWindowDB = ShotWindowDB or {}
  ShotWindowDB.display = "ring"
  T.login(200)
  T.fire("PLAYER_ENTERING_WORLD")
  T.now = 100 T.fire("PLAYER_SWING", 2.8, 2) T.now = 101 T.update()
  local r = T.rend()
  check(r.quads == QUADS, "vertex offsets " .. (QUADS and "found" or "not there") .. " (" .. tostring(r.quads) .. ")")
  check(r.mode == MODE, "drawn " .. MODE .. " (" .. tostring(r.mode) .. ")")
  local n = #T.prints
  T.slash("debug")
  local line
  for i = n + 1, #T.prints do if T.prints[i]:find("display: ", 1, true) then line = T.prints[i] end end
  local want = "display: Ring, locked, shown, " .. SAYS .. ", alerts: "
  check(line ~= nil and line:find(want, 1, true) ~= nil, "the debug line says " .. SAYS .. " (" .. tostring(line) .. ")")
  -- Drawn the way it says: textures with moved corners, or segments.
  local quadsShown = 0
  for name, t in pairs(r.tex) do if name:sub(1, 6) == "ring:Q" and T.isShown(t) then quadsShown = quadsShown + 1 end end
  check((quadsShown > 0) == QUADS, "seamless strip textures shown: " .. quadsShown)
  if QUADS and MODE == "art" then
    local bg = T.part(r, "QAbg1")
    check(bg and rawget(bg, "file") == T.atlasFile, "the art from the atlas file (" .. tostring(bg and rawget(bg, "file")) .. ")")
  end
  check(#T.errors == 0, "no errors")
`);
}

// The round designs at the slider extremes (size 60 to 400, line 2 to 30): a design is only
// usable if its curve stays on its own side of the center, so the fill starts where its path does
// and the shot mark stays above the center.
scenario('Seamless strips at the slider extremes: the arc, the ring and the reticle stay bands round their center, start their fill where the path starts and keep the shot mark above the center, art and flat', DISPLAY_HELPERS + QUAD_HELPERS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  local base = 100
  -- Where each design's first fill segment starts (the angle about its center) and its key.
  local START = {
    arc = { art = { "QAfl", TOP + math.rad(110) }, flat = { "Qfl", TOP + math.rad(110) } },
    ring = { art = { "QAfill", TOP }, flat = { "Qf", TOP } },
    reticle = { art = { "QAcirc", TOP }, flat = { "Qc", 0 } },
  }
  for _, mode in ipairs({ "art", "flat" }) do
    if mode == "flat" then T.slash("style dark") end
    for _, D in ipairs({ "arc", "ring", "reticle" }) do
      for _, ext in ipairs({ { 60, 2 }, { 60, 30 }, { 400, 2 }, { 400, 30 } }) do
        db.dispSize, db.dispThick = ext[1], ext[2]
        T.slash("display " .. D)
        local r = T.rend()
        local tag = "[" .. D .. ", " .. mode .. ", size " .. ext[1] .. ", line " .. ext[2] .. "] "
        base = base + 10
        T.now = base T.fire("PLAYER_SWING", 2.8, 2)
        -- Mid-swing, the whole model: every piece where it belongs, the clipped ones on their chords.
        T.now = base + 1.0 T.update()
        local list, _, info = quadStrips(D, mode, r.w, r.h, db, { p = 1.0 / 2.8 }, quadLook(db))
        checkAll(tag .. "p " .. num(1.0 / 2.8) .. ": ", r, list, db.artFlip)
        if D == "reticle" then checkTicks(tag .. "p " .. num(1.0 / 2.8) .. ": ", r, info, START[D][mode][1]) end
        T.now = base + 2.81 T.update() T.now = base + 2.9 T.update() -- holding: the fill drawn full
        local cx, cy = r.w / 2, (D == "arc" and r.h * NS.ARC_CY or r.h / 2)
        local key, want = START[D][mode][1], START[D][mode][2]
        local c = T.quadCorners(T.part(r, key .. "1"))
        local a = type(c) == "table" and math.atan(c[1][2] - cy, c[1][1] - cx)
        local off = a and math.abs(math.atan(math.sin(a - want), math.cos(a - want)))
        check(off and off < 1e-6, tag .. key .. " starts where its path does (" .. num(a and math.deg(a)) .. " degrees, want " .. num(math.deg(want))
          .. "; its outer corner " .. num(type(c) == "table" and dist(c[1][1], c[1][2], cx, cy)) .. " from the center)")
        -- Not turned inside out: the inner corner on the same side of the center as the outer one.
        local ai = type(c) == "table" and math.atan(c[2][2] - cy, c[2][1] - cx)
        local offI = ai and math.abs(math.atan(math.sin(ai - want), math.cos(ai - want)))
        check(offI and offI < 1e-6, tag .. key .. ": its inner corner on the same ray as the outer one, not mirrored through the center (" .. num(ai and math.deg(ai)) .. " degrees)")
        -- Every strip a band round the center: its inner edge off the center, its outer edge further
        -- out, and no wider than 0.8 of its radius (so it stays a ring).
        local collapsed, wide = {}, {}
        for name, t in pairs(r.tex) do
          local k = name:sub(#D + 2)
          if name:sub(1, #D + 2) == D .. ":Q" and T.isShown(t) and k:find("1$") and not k:find("%d%d$") then
            local q = T.quadCorners(t)
            local ro, ri = dist(q[1][1], q[1][2], cx, cy), dist(q[2][1], q[2][2], cx, cy)
            if not (ri > 1e-6 and ro > ri) then collapsed[#collapsed + 1] = k:sub(1, -2) .. " (" .. num(ri) .. " to " .. num(ro) .. ")" end
            if not (ro - ri <= 0.8 * (ro + ri) / 2 + 1e-9) then wide[#wide + 1] = k:sub(1, -2) .. " (" .. num(ro - ri) .. " wide at " .. num((ro + ri) / 2) .. ")" end
          end
        end
        table.sort(collapsed) table.sort(wide)
        check(#collapsed == 0, tag .. "every strip a band round the center, not a disk (not: " .. table.concat(collapsed, ", ") .. ")")
        check(#wide == 0, tag .. "every strip no wider than 0.8 of its radius (not: " .. table.concat(wide, ", ") .. ")")
        if D ~= "reticle" then
          -- The line thickness capped to the size: the fill drawn at it, and line 30 on size 60 well under 30.
          local g = roundGeom(D, mode, r.w, r.h, db.dispThick)
          local drawn = type(c) == "table" and (dist(c[1][1], c[1][2], cx, cy) - dist(c[2][1], c[2][2], cx, cy)) or nil
          check(close(drawn, g.th, 1e-6) and g.th <= ext[2] + 1e-12, tag .. key .. " drawn " .. num(g.th) .. " thick, the line capped to the size (" .. num(drawn) .. ")")
          if ext[1] == 60 and ext[2] == 30 then
            check(g.th < 20 and g.rad - g.widest / 2 > 1, tag .. "line 30 on size 60: capped to " .. num(g.th) .. ", the widest band (" .. num(g.widest)
              .. ") leaves an inner radius of " .. num(g.rad - g.widest / 2))
          end
          local x1, y1, x2, y2 = T.segEnds(T.part(r, "shot"))
          check(type(y1) == "number" and y1 > cy and y2 > cy, tag .. "the shot mark above the center (y " .. num(y1) .. " to " .. num(y2) .. ", center " .. num(cy) .. ")")
          local d1, d2 = dist(x1, y1, cx, cy), dist(x2, y2, cx, cy)
          check(close(x1, cx, 1e-9) and close(x2, cx, 1e-9) and close(d1, g.mark0, 1e-6) and close(d2, g.mark1, 1e-6) and d1 >= 1 - 1e-9,
            tag .. "the shot mark straight up from a positive radius, " .. num(g.mark0) .. " to " .. num(g.mark1) .. " (" .. num(d1) .. " to " .. num(d2) .. ")")
        end
      end
    end
  end
  check(#T.errors == 0, "no errors")
`);

// The same extremes on the Line strips (no vertex offsets): the thickness cap holds there too.
scenario('Line strips at the slider extremes: the arc and the ring cap their line to the size, stay rings and keep the shot mark straight up from a positive radius, art and flat', DISPLAY_HELPERS + ART_HELPERS + LINE_STRIPS + String.raw`
  T.autoRepMode, T.autoRep[75] = "plain", true
  T.login(200)
  local db = ShotWindowDB
  local base = 100
  local FLATKEYS = { arc = { { "tl", 22, 1 }, { "tr", 22, 1 }, { "fl", 22 }, { "fr", 22 } }, ring = { { "t", 40, 1 }, { "f", 40 } } }
  for _, mode in ipairs({ "art", "flat" }) do
    if mode == "flat" then T.slash("style dark") end
    for _, D in ipairs({ "arc", "ring" }) do
      for _, ext in ipairs({ { 60, 2 }, { 60, 30 }, { 400, 2 }, { 400, 30 }, { 140, 12 } }) do
        db.dispSize, db.dispThick = ext[1], ext[2]
        T.slash("display " .. D)
        local r = T.rend()
        local tag = "[" .. D .. ", " .. mode .. ", size " .. ext[1] .. ", line " .. ext[2] .. "] "
        base = base + 10
        T.now = base T.fire("PLAYER_SWING", 2.8, 2)
        T.now = base + 1.0 T.update()
        local p = 1.0 / 2.8
        check(r.quads == false and r.mode == mode, tag .. "Line strips, drawn " .. mode .. " (" .. tostring(r.quads) .. ", " .. tostring(r.mode) .. ")")
        local g = roundGeom(D, mode, r.w, r.h, db.dispThick)
        if mode == "art" then
          local ag = artGeom(D, r.w, r.h, db.dispThick, p)
          for _, key in ipairs({ "Abg", "Aframe" }) do
            local _, lo, hi = checkStrip(tag, r, key, ag[key], 0, 1, { slice = key == "Abg" and "bg" or "frame", alpha = 1 })
            check(close(lo, 0, 1e-6) and close(hi, 1, 1e-6), tag .. key .. ": full length (" .. num(lo) .. " to " .. num(hi) .. ")")
          end
          for _, key in ipairs(D == "arc" and { "Afl", "Afr" } or { "Afill" }) do
            local _, lo, hi = checkStrip(tag, r, key, ag[key], 0, p, { slice = "fill", alpha = 0.95 })
            check(close(lo, 0, 1e-6) and close(hi, p, 1e-6), tag .. key .. ": 0 to p (" .. num(lo) .. " to " .. num(hi) .. ")")
          end
        else
          -- Flat: every Line's ends on the circle, at the capped thickness; the track all the way, the fill to p.
          local bad = {}
          for _, ks in ipairs(FLATKEYS[D]) do
            local shown = 0
            for i = 1, ks[2] do
              local line = T.part(r, ks[1] .. i)
              if T.isShown(line) then
                shown = shown + 1
                local x1, y1, x2, y2 = T.segEnds(line)
                local d1, d2 = dist(x1, y1, g.cx, g.cy), dist(x2, y2, g.cx, g.cy)
                if not (close(d1, g.rad, 1e-6) and close(d2, g.rad, 1e-6) and close(rawget(line, "thickness"), g.th, 1e-6)) then
                  bad[#bad + 1] = ks[1] .. i .. " at " .. num(d1) .. "/" .. num(d2) .. ", " .. num(rawget(line, "thickness")) .. " thick"
                end
              end
            end
            local want = ks[3] and ks[2] or math.ceil(p * ks[2] - 1e-9)
            if shown ~= want then bad[#bad + 1] = ks[1] .. ": " .. shown .. " shown, want " .. want end
          end
          check(#bad == 0, tag .. "every flat Line on radius " .. num(g.rad) .. ", " .. num(g.th) .. " thick (not: " .. table.concat(bad, ", ") .. ")")
        end
        -- Every Line of the curve no thicker than 0.8 of its radius: an inner edge off the center.
        local wide, nLines = {}, 0
        for name, s in pairs(r.segs) do
          local k = name:sub(#D + 2)
          local line = s.line
          if name:sub(1, #D + 1) == D .. ":" and k ~= "shot" and T.isShown(line) then
            nLines = nLines + 1
            local x1, y1 = T.segEnds(line)
            local d, th = dist(x1, y1, g.cx, g.cy), rawget(line, "thickness") or 0
            if not (th <= 0.8 * d + 1e-9 and d - th / 2 > 0) then wide[#wide + 1] = k .. " (" .. num(th) .. " thick at " .. num(d) .. ")" end
          end
        end
        table.sort(wide)
        check(nLines > 0 and #wide == 0, tag .. nLines .. " Lines, each no thicker than 0.8 of its radius (not: " .. table.concat(wide, ", ") .. ")")
        if ext[1] == 60 and ext[2] == 30 then
          check(g.th < 20 and g.rad - g.widest / 2 > 1, tag .. "line 30 on size 60: capped to " .. num(g.th) .. ", inner radius " .. num(g.rad - g.widest / 2))
        end
        local x1, y1, x2, y2 = T.segEnds(T.part(r, "shot"))
        local d1, d2 = dist(x1, y1, g.cx, g.cy), dist(x2, y2, g.cx, g.cy)
        check(close(x1, g.cx, 1e-9) and close(x2, g.cx, 1e-9) and y1 > g.cy and close(d1, g.mark0, 1e-6) and close(d2, g.mark1, 1e-6) and d1 >= 1 - 1e-9,
          tag .. "the shot mark straight up from a positive radius, " .. num(g.mark0) .. " to " .. num(g.mark1) .. " (" .. num(d1) .. " to " .. num(d2) .. ")")
      end
    end
  end
  check(#T.errors == 0, "no errors")
`);

console.log(`\n${passed} passed, ${failed} failed, ${checks} checks`);
process.exit(failed ? 1 : 0);
