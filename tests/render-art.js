// Offline look at the round designs (Displays.lua: ArtArc, ArtRing, the reticle; and their flat
// look under the Dark window style). Runs the real Displays.lua renderer in fengari against a small
// recording stub set, then rasterizes every visible region the way the client would draw it and
// writes PNG contact sheets you can open and look at.
//
//   node tests/render-art.js                 seamless strips (textures moved with SetVertexOffset)
//   ART_LINES=1 node tests/render-art.js     the older Line fallback (no SetVertexOffset)
//
// What runs: Displays.lua as the TOC loads it (ADDON, ns), ns.NewRenderer and R:Draw with the
// DEFAULTS table read out of ShotWindow.lua, once per look:
//   blizzard  ns.Styles left nil: the swing timer art from file 8344036 (C_Texture.GetAtlasInfo
//             answers for its three atlases)
//   dark      ns.Styles a minimal Dark stub (Applied() = "dark", S.GetPanelColor, S.GetAccentColor,
//             S.GetFont): the flat look
//
// What is drawn:
//   rectangles   textures placed by points and size, flat (SetColorTexture) or sampled
//   quads        textures whose four corners were moved with SetVertexOffset (1 upper left,
//                2 lower left, 3 upper right, 4 lower right; offsets added to the placed rectangle's
//                corners, y up). Two triangles (UL, LL, UR) and (UR, LL, LR), each mapped affinely
//                from its texcoords (UL = (left, top), LL = (left, bottom), UR = (right, top),
//                LR = (right, bottom)), times the vertex color; flat for SetColorTexture. Corners are
//                snapped to 1/256 of a sample and shared edges follow a fill rule, so two quads that
//                share an edge cover every sample on it exactly once, as on a GPU.
//   lines        a quad of the line's thickness from start to end, no end caps, flat or sampled
//   text         a rough 5x7 bitmap stand-in for font strings (place and color only)
// Textures sample the decoded BLP bilinearly (atlas neighbors bleed in, as in the game) and
// SetDesaturated / SetDesaturation are modeled. Layers draw BACKGROUND, BORDER, ARTWORK, OVERLAY,
// then sublevel, then creation order (the client does not promise an order for regions on the same
// layer and sublevel). Each image is supersampled and box filtered.
//
// Lines only: how the client lays a texture ACROSS a Line cannot be known offline. u runs from the
// start point to the end point; convention A puts the texcoord top on the LEFT of the direction of
// travel, convention B on the RIGHT. The Line fallback writes both for the Blizzard art. Quads have
// no such question: every corner says its own texcoord.
//
// Output (in tests/, which is not packaged):
//   seamless strips (default):
//     art-blizzard-quads.png, art-dark-quads.png            every design in every state, 2x
//     art-blizzard-quads-zoom.png, art-dark-quads-zoom.png  8x crops: joints on a light ground (a
//       bright patch of world behind the display, where see-through art or color drawn twice shows
//       as a dark band and a gap as a bright one), fill tips, the reticle, the ring's top clasp
//   Line fallback (ART_LINES=1):
//     art-blizzard-convA.png, art-blizzard-convB.png, art-blizzard-zoom-convA.png,
//     art-blizzard-zoom-convB.png, art-dark-lines.png, art-dark-lines-zoom.png
//   pixel snapping what-if (ART_PIXEL_SNAP=<n>, see below):
//     art-blizzard-quads-snap<n>.png, art-blizzard-quads-snap<n>-zoom.png, and the same for dark
// The contact sheets draw the frame's own bounds as a faint box, to judge proportions.
// The console lists, per look, design and state, the regions drawn and whether a renderer that went
// through the earlier states draws the same as a fresh one (the per-texture memo), each strip's
// count, thickness, ends and texel columns, and a coverage check: within each layer and sublevel,
// the area covered twice by strip pieces (double blending) and the area left uncovered inside a
// strip's band (gaps), in square frame units.
//
// A what-if: the client snaps textures to the screen's pixel grid unless told not to
// (SetSnapToPixelGrid(false) and SetTexelSnappingBias(0), as Blizzard's NineSliceUtil.DisableSharpening
// and AlternatePowerBarBase do). If it rounds the 2x2 base rectangle's edges each on its own before
// the corner offsets are added, the upper-left based and upper-right based corners of neighbors no
// longer meet. ART_PIXEL_SNAP=<screen pixels per UI unit> (for example 1.40625: 1080 lines at UI
// scale 1) draws that hypothesis, with the frame's corner at a fraction of a pixel; it cannot say
// whether the client does it. Output names then end in -snap<value>.
//
// Environment: ART_LINES=1 (force the Line fallback), ART_LOOKS=blizzard,dark (which looks),
// ART_PIXEL_SNAP=<pixels per unit> (the what-if above),
// ART_TOOLS=<folder with blp-lib.js> (default C:/Users/jonli/wow-forever-addon-creations),
// ART_BLP=<the atlas file> (default swingtimerbar-8344036.blp there), ART_OUT=<folder for PNGs>,
// FENGARI=<fengari folder>, DISPLAYS_LUA=<another copy of Displays.lua>.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOLS = process.env.ART_TOOLS || 'C:/Users/jonli/wow-forever-addon-creations';
const BLP_FILE = process.env.ART_BLP || path.join(TOOLS, 'swingtimerbar-8344036.blp');
const OUT = process.env.ART_OUT || __dirname;
const FORCE_LINES = /^(1|true|yes|on)$/i.test(process.env.ART_LINES || '');
const PIXEL_SNAP = Number(process.env.ART_PIXEL_SNAP) > 0 ? Number(process.env.ART_PIXEL_SNAP) : 0;
const PIXEL_ORIGIN = [0.37, 0.61]; // where the frame's bottom left falls inside a screen pixel
const LOOKS_WANTED = (process.env.ART_LOOKS || 'blizzard,dark').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const { decodeBLP, png } = require(path.join(TOOLS, 'blp-lib.js'));

function findFengari() {
  const tries = [];
  if (process.env.FENGARI) tries.push(process.env.FENGARI);
  try { tries.push(path.dirname(require.resolve('fengari/package.json'))); } catch (e) { /* not on the path */ }
  tries.push('C:/Users/jonli/AppData/Local/Temp/claude/C--Users-jonli-ffxi-ah-analysis/989059d8-08ec-488d-9dd6-df53722920db/scratchpad/node_modules/fengari');
  for (const d of tries) if (fs.existsSync(path.join(d, 'src', 'lvm.js'))) return d;
  throw new Error('fengari not found; set FENGARI to its folder');
}
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(findFengari());

// ---------------------------------------------------------------------------------------------
// The atlas file and its members (2x art), as GetAtlasInfo reports them

const TEX = decodeBLP(fs.readFileSync(BLP_FILE));
const FILE_ID = 8344036;
const MEMBERS = { // left, top, right, bottom in texels
  'ui-swingtimerbar-frame': [1, 1, 427, 31],
  'ui-swingtimerbar-background': [1, 33, 423, 59],
  'ui-swingtimerbar-filling-ranged': [1, 109, 419, 131],
};

// ---------------------------------------------------------------------------------------------
// Lua side: stubs, the addon file, the drive

const SW_SRC = fs.readFileSync(path.join(ROOT, 'ShotWindow.lua'), 'utf8');
const DISPLAYS_SRC = fs.readFileSync(process.env.DISPLAYS_LUA || path.join(ROOT, 'Displays.lua'), 'utf8');
function defaultsSource() {
  const red = SW_SRC.match(/^local RED = .*$/m);
  const at = SW_SRC.indexOf('local DEFAULTS = {');
  const end = SW_SRC.indexOf('\n}', at);
  if (!red || at < 0 || end < 0) throw new Error('DEFAULTS not found in ShotWindow.lua');
  return red[0] + '\n' + SW_SRC.slice(at, end + 2) + '\nreturn DEFAULTS\n';
}

const STUBS = String.raw`
REC, NOTES = {}, {}
local seq = 0
local function note(what) NOTES[what] = (NOTES[what] or 0) + 1 end

-- Methods a region must NOT have (so a "does it exist" probe sees nil): the Line fallback.
local ABSENT = {}
if FORCE_LINES then ABSENT.SetVertexOffset, ABSENT.ClearVertexOffsets, ABSENT.GetVertexOffset = true, true, true end

local function classMeta(kind, methods)
  return { __index = function(self, k)
    if ABSENT[k] then return nil end
    local m = methods[k]
    if m ~= nil then return m end
    if type(k) == "string" and k:match("^%u") then -- a method the stub does not have: note it, do nothing
      return function() note(kind .. ":" .. k) end
    end
    return nil
  end }
end

local Region = {}
function Region:ClearAllPoints() self.points = {} self.allPoints = nil end
function Region:SetPoint(point, a, b, c, d)
  local rel, relPoint, x, y
  if type(a) == "number" then rel, relPoint, x, y = nil, point, a, b
  elseif type(b) == "number" then rel, relPoint, x, y = a, point, b, c
  else rel, relPoint, x, y = a, b or point, c, d end
  rel = rel or self.parent
  for i = #self.points, 1, -1 do if self.points[i].point == point then table.remove(self.points, i) end end
  self.points[#self.points + 1] = { point = point, relPoint = relPoint, x = x or 0, y = y or 0, toParent = (rel == self.parent) }
end
function Region:SetAllPoints() self.points = {} self.allPoints = true end
function Region:SetSize(w, h) self.width, self.height = w, h end
function Region:SetWidth(w) self.width = w end
function Region:SetHeight(h) self.height = h end
function Region:Show() self.shown = true end
function Region:Hide() self.shown = false end
function Region:SetShown(v) self.shown = v and true or false end
function Region:IsShown() return self.shown end
function Region:SetAlpha(a) self.alpha = a end
function Region:GetAlpha() return self.alpha end

local function copyInto(dst, src) for k, v in pairs(src) do dst[k] = v end return dst end

local Tex = copyInto({}, Region)
function Tex:SetColorTexture(r, g, b, a) self.mode = "color" self.color = { r, g, b, a or 1 } end
function Tex:SetTexture(file) self.mode = file and "file" or nil self.file = file end
function Tex:SetAtlas(name) self.mode = "atlas" self.atlas = name return true end
function Tex:SetTexCoord(...)
  local n = select("#", ...)
  if n == 4 then
    local l, r, t, b = ...
    self.coord = { l, t, l, b, r, t, r, b } -- UL, LL, UR, LR
  elseif n == 8 then
    self.coord = { ... }
  else
    error("SetTexCoord: 4 or 8 numbers expected", 2)
  end
end
function Tex:SetVertexColor(r, g, b, a) self.vc = { r, g, b, a or 1 } end
function Tex:SetDrawLayer(layer, sub) self.layer, self.sub = layer, sub or 0 end
function Tex:SetBlendMode(m) self.blend = m end
function Tex:SetDesaturated(d) self.desat = d and 1 or 0 end
function Tex:SetDesaturation(x) self.desat = x end
function Tex:GetObjectType() return self.kind end
-- Corner offsets (1 upper left, 2 lower left, 3 upper right, 4 lower right), y up.
function Tex:SetVertexOffset(i, x, y)
  if type(i) ~= "number" or i < 1 or i > 4 or i % 1 ~= 0 then error("SetVertexOffset: vertex index 1 to 4 expected", 2) end
  if type(x) ~= "number" or type(y) ~= "number" then error("SetVertexOffset: numbers expected", 2) end
  if x ~= x or y ~= y then error("SetVertexOffset: NaN", 2) end
  self.vo = self.vo or { { 0, 0 }, { 0, 0 }, { 0, 0 }, { 0, 0 } }
  self.vo[i] = { x, y }
end
function Tex:ClearVertexOffsets() self.vo = nil end
function Tex:GetVertexOffset(i) local v = self.vo and self.vo[i] return v and v[1] or 0, v and v[2] or 0 end

local Line = copyInto({}, Tex)
function Line:SetStartPoint(point, rel, x, y) self.startP = { point = point, toParent = (rel == nil or rel == self.parent), x = x or 0, y = y or 0 } end
function Line:SetEndPoint(point, rel, x, y) self.endP = { point = point, toParent = (rel == nil or rel == self.parent), x = x or 0, y = y or 0 } end
function Line:SetThickness(t)
  if type(t) ~= "number" then error("Line:SetThickness(): number expected", 2) end
  self.thickness = t
end
function Line:GetThickness() return self.thickness or 1 end

local FS = copyInto({}, Region)
function FS:SetFont(file, size, flags) self.fontFile, self.size, self.flags = file, size, flags return true end
function FS:GetFont() return self.fontFile, self.size, self.flags end
function FS:SetText(t) self.text = t end
function FS:GetText() return self.text end
function FS:SetTextColor(r, g, b, a) self.textColor = { r, g, b, a or 1 } end

local METAS = { Texture = classMeta("Texture", Tex), Line = classMeta("Line", Line), FontString = classMeta("FontString", FS) }

local function region(kind, parent, layer, sub)
  seq = seq + 1
  local o = { kind = kind, parent = parent, layer = layer or "ARTWORK", sub = sub or 0, seq = seq, shown = true,
    points = {}, alpha = 1, vc = { 1, 1, 1, 1 } }
  REC[#REC + 1] = o
  return setmetatable(o, METAS[kind])
end

local Frame = copyInto({}, Region)
function Frame:CreateTexture(name, layer, inherits, sub) return region("Texture", self, layer, sub) end
function Frame:CreateLine(name, layer, inherits, sub) return region("Line", self, layer, sub) end
function Frame:CreateFontString(name, layer, inherits)
  local fs = region("FontString", self, layer or "ARTWORK", 0)
  fs.size = 16 -- GameFontHighlightLarge
  return fs
end
function Frame:SetScript(what, fn) self.scripts = self.scripts or {} self.scripts[what] = fn end
function Frame:SetScale(s) self.scale = s end
function Frame:GetScale() return self.scale or 1 end
local FRAME_META = classMeta("Frame", Frame)

function CreateFrame(kind, name, parent)
  local f = setmetatable({ kind = kind or "Frame", parent = parent, shown = true, points = {}, alpha = 1 }, FRAME_META)
  if name then _G[name] = f end
  return f
end
UIParent = CreateFrame("Frame")
UIParent:SetSize(1920, 1080)

GameFontHighlightLarge = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 16, "" end }
GameFontNormalHuge = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 20, "" end }

C_Texture = {
  GetAtlasInfo = function(name)
    local m = ATLAS_MEMBERS[name]
    if not m then return nil end
    return { file = ATLAS_FILE, width = (m[3] - m[1]) / 2, height = (m[4] - m[2]) / 2,
      leftTexCoord = m[1] / ATLAS_W, rightTexCoord = m[3] / ATLAS_W,
      topTexCoord = m[2] / ATLAS_H, bottomTexCoord = m[4] / ATLAS_H,
      tilesHorizontally = false, tilesVertically = false }
  end,
}

-- The Dark window style, as much of it as Displays.lua's Look() reads (Styles.lua's Dark table).
DARK_STYLES = {
  Applied = function() return "dark" end,
  S = {
    GetPanelColor = function() return 0.07, 0.07, 0.08, 0.92 end,
    GetAccentColor = function() return 0.58, 0.26, 0.9 end,
    GetFont = function() return "Fonts\\FRIZQT__.TTF", "" end,
  },
}

-- A tiny JSON writer for the snapshots.
local function jstr(s)
  return '"' .. (tostring(s):gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end)) .. '"'
end
local function enc(v, out)
  local t = type(v)
  if t == "table" then
    if #v > 0 or next(v) == nil then
      out[#out + 1] = "["
      for i, x in ipairs(v) do if i > 1 then out[#out + 1] = "," end enc(x, out) end
      out[#out + 1] = "]"
    else
      out[#out + 1] = "{"
      local first = true
      for k, x in pairs(v) do
        if not first then out[#out + 1] = "," end
        first = false
        out[#out + 1] = jstr(k) .. ":"
        enc(x, out)
      end
      out[#out + 1] = "}"
    end
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then out[#out + 1] = "null" note("non-finite number in a snapshot")
    else out[#out + 1] = string.format("%.17g", v) end
  elseif t == "string" then out[#out + 1] = jstr(v)
  elseif t == "boolean" then out[#out + 1] = tostring(v)
  else out[#out + 1] = "null" end
end
function JSON(v) local out = {} enc(v, out) return table.concat(out) end

-- Every shown region on a renderer's frame, with the key the renderer knows it by.
function SNAP(r)
  local keyOf = {}
  for name, t in pairs(r.tex) do keyOf[t] = name end
  for name, s in pairs(r.segs) do keyOf[s.line or s.tex] = name end
  for name, f in pairs(r.texts) do keyOf[f] = name end
  if r.chrome then
    keyOf[r.chrome.bg] = "chrome:bg" keyOf[r.chrome.art] = "chrome:art"
    for i, e in ipairs(r.chrome.edges) do keyOf[e] = "chrome:edge" .. i end
  end
  local list = {}
  -- Deep copies: a stub may change a table in place later (SetVertexOffset, SetPoint), and the
  -- snapshots are encoded only after every state has been drawn.
  local function deep(v) if type(v) ~= "table" then return v end local t = {} for k, x in pairs(v) do t[k] = deep(x) end return t end
  for _, o in ipairs(REC) do
    if o.parent == r.frame and o.shown then
      list[#list + 1] = deep({
        kind = o.kind, key = keyOf[o] or ("?" .. o.seq), layer = o.layer, sub = o.sub, seq = o.seq, alpha = o.alpha,
        mode = o.mode, color = o.color, file = o.file, atlas = o.atlas, coord = o.coord, vc = o.vc, blend = o.blend, desat = o.desat,
        points = o.points, width = o.width, height = o.height, allPoints = o.allPoints, vo = o.vo,
        start = o.startP, finish = o.endP, thickness = o.thickness,
        text = o.text, size = o.size, textColor = o.textColor,
      })
    end
  end
  return { w = r.w, h = r.h, mode = r.mode or "?", quads = r.quads and true or false, regions = list }
end
`;

const DRIVE = String.raw`
local DEF = assert(load(DEFAULTS_SRC, "=DEFAULTS"))()
local function copy(v) if type(v) ~= "table" then return v end local t = {} for k, x in pairs(v) do t[k] = copy(x) end return t end
local STATES = {
  { name = "idle", s = { dur = 3, lead = 0.5 } },
  { name = "mid p=0.5", s = { dur = 3, lead = 0.5, t = 1.5, sinceShot = 1.5, autoRepeat = true } },
  { name = "zone p=0.9 lit", s = { dur = 3, lead = 0.5, t = 2.7, lit = true, sinceShot = 2.7, autoRepeat = true } },
  { name = "clipping", s = { dur = 3, lead = 0.5, t = 2.7, lit = true, clipping = true, moving = true, sinceShot = 2.7, autoRepeat = true } },
  { name = "waiting pulse=0.6", s = { dur = 3, lead = 0.5, waiting = true, waitAge = 0.35, waitKind = "late", lit = true, autoRepeat = true } },
}
local out = { looks = {}, defaults = { dispSize = DEF.dispSize, dispThick = DEF.dispThick, artFlip = DEF.artFlip } }
for lookName in LOOKS_WANTED:gmatch("[^,]+") do
  NS.Styles = (lookName == "dark") and DARK_STYLES or nil
  local L = { name = lookName, designs = {} }
  for _, design in ipairs({ "arc", "ring", "reticle" }) do
    local db = copy(DEF)
    db.display = design
    local r = NS.NewRenderer(UIParent)
    r:SetDesign(design)
    local w, h = NS.DisplaySize(db, design)
    r:SetSize(w, h)
    local d = { design = design, w = w, h = h, quads = r.quads and true or false, states = {} }
    for i, st in ipairs(STATES) do
      r:Draw(copy(st.s), db) -- one renderer through every state, as in game
      local snap = SNAP(r)
      local r2 = NS.NewRenderer(UIParent) -- and a fresh one, to catch anything the memo leaves behind
      r2:SetDesign(design)
      r2:SetSize(w, h)
      r2:Draw(copy(st.s), db)
      d.states[i] = { name = st.name, snap = snap, fresh = SNAP(r2) }
    end
    L.designs[#L.designs + 1] = d
  end
  out.looks[#out.looks + 1] = L
end
NS.Styles = nil
local notes = {}
for k, n in pairs(NOTES) do notes[#notes + 1] = k .. " x" .. n end
table.sort(notes)
out.notes = notes
RESULT = JSON(out)
`;

function runLua() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const setStr = (name, s) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_setglobal(L, to_luastring(name)); };
  const setNum = (name, n) => { lua.lua_pushnumber(L, n); lua.lua_setglobal(L, to_luastring(name)); };
  const setBool = (name, b) => { lua.lua_pushboolean(L, b ? 1 : 0); lua.lua_setglobal(L, to_luastring(name)); };
  const run = (code, chunk) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(chunk)) !== lua.LUA_OK ||
        lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
      throw new Error(chunk + ': ' + to_jsstring(lua.lua_tostring(L, -1)));
    }
  };
  setStr('DEFAULTS_SRC', defaultsSource());
  setStr('DISPLAYS_SRC', DISPLAYS_SRC);
  setStr('LOOKS_WANTED', LOOKS_WANTED.join(','));
  setBool('FORCE_LINES', FORCE_LINES);
  setNum('ATLAS_FILE', FILE_ID);
  setNum('ATLAS_W', TEX.w);
  setNum('ATLAS_H', TEX.h);
  let members = 'ATLAS_MEMBERS = {';
  for (const [name, m] of Object.entries(MEMBERS)) members += '["' + name + '"] = {' + m.join(',') + '},';
  run(members + '}', '=atlas');
  run(STUBS, '=stubs');
  run('NS = {}\nlocal f = assert(load(DISPLAYS_SRC, "@Displays.lua"))\nf("ShotWindow", NS)', '=load');
  run(DRIVE, '=drive');
  lua.lua_getglobal(L, to_luastring('RESULT'));
  return JSON.parse(to_jsstring(lua.lua_tostring(L, -1)));
}

// ---------------------------------------------------------------------------------------------
// Geometry

const LAYER = { BACKGROUND: 0, BORDER: 1, ARTWORK: 2, OVERLAY: 3, HIGHLIGHT: 4 };
const BG = [0.085, 0.09, 0.105];
const LIGHT = [0.62, 0.6, 0.54]; // a bright patch of the world behind the display: shows alpha seams

function sampleTex(u, v, out) { // bilinear, straight alpha, clamped to the file's edges
  let x = u * TEX.w - 0.5, y = v * TEX.h - 0.5;
  if (x < 0) x = 0; else if (x > TEX.w - 1) x = TEX.w - 1;
  if (y < 0) y = 0; else if (y > TEX.h - 1) y = TEX.h - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, TEX.w - 1), y1 = Math.min(y0 + 1, TEX.h - 1);
  const fx = x - x0, fy = y - y0;
  const px = TEX.px, W = TEX.w;
  const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  for (let c = 0; c < 4; c++) out[c] = (px[i00 + c] * w00 + px[i10 + c] * w10 + px[i01 + c] * w01 + px[i11 + c] * w11) / 255;
  return out;
}

function anchorXY(relPoint, W, H) { // y up from the bottom left
  const p = String(relPoint).toUpperCase();
  const x = p.includes('LEFT') ? 0 : p.includes('RIGHT') ? W : W / 2;
  const y = p.startsWith('TOP') ? H : p.startsWith('BOTTOM') ? 0 : H / 2;
  return [x, y];
}

// A texture's or font string's place: { l, r, b, t } with y up, or null if it cannot be worked out.
function rectOf(e, W, H) {
  if (e.allPoints) return { l: 0, r: W, b: 0, t: H };
  let l, r, cx, t, b, cy;
  for (const p of e.points || []) {
    if (!p.toParent) return null;
    const [ax, ay] = anchorXY(p.relPoint, W, H);
    const X = ax + p.x, Y = ay + p.y, P = String(p.point).toUpperCase();
    if (P.includes('LEFT')) l = X; else if (P.includes('RIGHT')) r = X; else cx = X;
    if (P.startsWith('TOP')) t = Y; else if (P.startsWith('BOTTOM')) b = Y; else cy = Y;
  }
  const w = e.width || 0, h = e.height || 0;
  if (l === undefined && r === undefined) { if (cx === undefined) return null; l = cx - w / 2; r = cx + w / 2; }
  else if (l === undefined) l = r - w; else if (r === undefined) r = l + w;
  if (b === undefined && t === undefined) { if (cy === undefined) return null; b = cy - h / 2; t = cy + h / 2; }
  else if (b === undefined) b = t - h; else if (t === undefined) t = b + h;
  return { l, r, b, t };
}

// ART_PIXEL_SNAP: the base rectangle's edges rounded to whole screen pixels, each on its own, before
// the corner offsets are added (the frame's bottom left sits at PIXEL_ORIGIN on the pixel grid).
function snapRect(R) {
  if (!PIXEL_SNAP) return R;
  const s = PIXEL_SNAP, sn = (v, o) => (Math.round(v * s + o) - o) / s;
  return { l: sn(R.l, PIXEL_ORIGIN[0]), r: sn(R.r, PIXEL_ORIGIN[0]), b: sn(R.b, PIXEL_ORIGIN[1]), t: sn(R.t, PIXEL_ORIGIN[1]) };
}

// A texture moved with SetVertexOffset: its corners UL, LL, UR, LR in frame units, y up.
function quadCorners(e, W, H) {
  if (!e.vo) return null;
  let R = rectOf(e, W, H);
  if (!R) return null;
  R = snapRect(R);
  const o = (i) => e.vo[i] || [0, 0];
  return [[R.l + o(0)[0], R.t + o(0)[1]], [R.l + o(1)[0], R.b + o(1)[1]],
    [R.r + o(2)[0], R.t + o(2)[1]], [R.r + o(3)[0], R.b + o(3)[1]]];
}
function quadBase(e, W, H) { const R = rectOf(e, W, H); return R ? [(R.l + R.r) / 2, (R.b + R.t) / 2] : null; }

const lineEnds = (snap, e) => {
  const [sx, sy] = anchorXY(e.start.point, snap.w, snap.h), [ex, ey] = anchorXY(e.finish.point, snap.w, snap.h);
  return [sx + e.start.x, sy + e.start.y, ex + e.finish.x, ey + e.finish.y];
};
// A Line as the quad it covers: start left, start right, end left, end right (left of travel), y up.
function lineQuad(snap, e) {
  if (!e.start || !e.finish || !e.start.toParent || !e.finish.toParent) return null;
  const [Sx, Sy, Ex, Ey] = lineEnds(snap, e);
  const T = e.thickness || 1, len = Math.hypot(Ex - Sx, Ey - Sy);
  if (len < 1e-9) return null;
  const nx = -(Ey - Sy) / len, ny = (Ex - Sx) / len;
  return [[Sx + nx * T / 2, Sy + ny * T / 2], [Sx - nx * T / 2, Sy - ny * T / 2],
    [Ex + nx * T / 2, Ey + ny * T / 2], [Ex - nx * T / 2, Ey - ny * T / 2]];
}

function atlasCoord(name) {
  const m = MEMBERS[name];
  if (!m) return null;
  const l = m[0] / TEX.w, t = m[1] / TEX.h, r = m[2] / TEX.w, b = m[3] / TEX.h;
  return [l, t, l, b, r, t, r, b];
}

// Texcoord at s (0 start/left .. 1 end/right) and w (0 top side .. 1 bottom side) from UL, LL, UR, LR.
function lerpCoord(c, s, w) {
  const u = (c[0] * (1 - w) + c[2] * w) * (1 - s) + (c[4] * (1 - w) + c[6] * w) * s;
  const v = (c[1] * (1 - w) + c[3] * w) * (1 - s) + (c[5] * (1 - w) + c[7] * w) * s;
  return [u, v];
}

// Is p on the inner side of edge a-b of a triangle whose third corner is t? The edge is always
// evaluated in one canonical direction, and a sample exactly on it belongs to the triangle on the
// positive side only: two triangles sharing the edge cover it exactly once (a GPU's fill rule).
function edgeIn(ax, ay, bx, by, tx, ty, px, py) {
  if (ax > bx || (ax === bx && ay > by)) { let s = ax; ax = bx; bx = s; s = ay; ay = by; by = s; }
  const dx = bx - ax, dy = by - ay;
  const e = dx * (py - ay) - dy * (px - ax);
  const et = dx * (ty - ay) - dy * (tx - ax);
  return et > 0 ? e >= 0 : e < 0;
}
const triArea = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function inTri(a, b, c, px, py) {
  return edgeIn(a[0], a[1], b[0], b[1], c[0], c[1], px, py) &&
    edgeIn(b[0], b[1], c[0], c[1], a[0], a[1], px, py) &&
    edgeIn(c[0], c[1], a[0], a[1], b[0], b[1], px, py);
}
// The two triangles of a quad: (UL, LL, UR) and (UR, LL, LR).
const QUAD_TRIS = [[0, 1, 2], [2, 1, 3]];
function quadHas(Q, px, py) {
  for (const [i, j, k] of QUAD_TRIS) {
    if (Math.abs(triArea(Q[i], Q[j], Q[k])) < 1e-12) continue;
    if (inTri(Q[i], Q[j], Q[k], px, py)) return true;
  }
  return false;
}

// One triangle into the sample grid (sample centers at +0.5), with affine texcoords if given.
function rasterTri(img, a, b, c, ta, tb, tc, plot) {
  const area = triArea(a, b, c);
  if (Math.abs(area) < 1e-12) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(img.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(img.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let py = y0; py <= y1; py++) {
    const sy = py + 0.5;
    for (let px = x0; px <= x1; px++) {
      const sx = px + 0.5;
      if (!inTri(a, b, c, sx, sy)) continue;
      if (ta) {
        const l1 = ((sx - a[0]) * (c[1] - a[1]) - (sy - a[1]) * (c[0] - a[0])) / area;
        const l2 = ((b[0] - a[0]) * (sy - a[1]) - (b[1] - a[1]) * (sx - a[0])) / area;
        const l0 = 1 - l1 - l2;
        plot(px, py, ta[0] * l0 + tb[0] * l1 + tc[0] * l2, ta[1] * l0 + tb[1] * l1 + tc[1] * l2);
      } else {
        plot(px, py);
      }
    }
  }
}

// 5x7 bitmap letters for labels and the stand-in for font strings.
const GLYPHS = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100', '=': '00000 00000 11111 00000 11111 00000 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000', ':': '00000 01100 01100 00000 01100 01100 00000',
  '(': '00010 00100 01000 01000 01000 00100 00010', ')': '01000 00100 00010 00010 00010 00100 01000',
  '+': '00000 00100 00100 11111 00100 00100 00000', '/': '00001 00010 00010 00100 01000 01000 10000',
  ',': '00000 00000 00000 00000 01100 00100 01000', '%': '11001 11010 00010 00100 01000 01011 10011',
  "'": '00100 00100 01000 00000 00000 00000 00000', ' ': '00000 00000 00000 00000 00000 00000 00000',
};
function glyphRows(ch) { return (GLYPHS[ch] || GLYPHS[' ']).split(' '); }

// A float RGB image.
class Img {
  constructor(w, h, bg) {
    this.w = w; this.h = h; this.px = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.px[i * 3] = bg[0]; this.px[i * 3 + 1] = bg[1]; this.px[i * 3 + 2] = bg[2]; }
  }
  blend(x, y, r, g, b, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (a > 1) a = 1;
    const i = (y * this.w + x) * 3, px = this.px;
    px[i] = r * a + px[i] * (1 - a); px[i + 1] = g * a + px[i + 1] * (1 - a); px[i + 2] = b * a + px[i + 2] * (1 - a);
  }
  add(x, y, r, g, b, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3, px = this.px;
    px[i] = Math.min(1, px[i] + r * a); px[i + 1] = Math.min(1, px[i + 1] + g * a); px[i + 2] = Math.min(1, px[i + 2] + b * a);
  }
  rect(x0, y0, w, h, c) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.blend(x, y, c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);
  }
  text(x, y, str, dot, c) { // top left at x, y
    str = String(str).toUpperCase();
    for (let k = 0; k < str.length; k++) {
      const rows = glyphRows(str[k]);
      for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++) {
        if (rows[ry][rx] !== '1') continue;
        this.rect(x + (k * 6 + rx) * dot, y + ry * dot, dot, dot, c);
      }
    }
    return str.length * 6 * dot;
  }
  blit(src, x0, y0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const X = x0 + x, Y = y0 + y;
      if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
      const i = (Y * this.w + X) * 3, j = (y * src.w + x) * 3;
      this.px[i] = src.px[j]; this.px[i + 1] = src.px[j + 1]; this.px[i + 2] = src.px[j + 2];
    }
  }
  outline(x0, y0, w, h, c) {
    for (let x = x0; x < x0 + w; x++) { this.blend(x, y0, ...c); this.blend(x, y0 + h - 1, ...c); }
    for (let y = y0; y < y0 + h; y++) { this.blend(x0, y, ...c); this.blend(x0 + w - 1, y, ...c); }
  }
  toPNG() {
    const buf = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      for (let c = 0; c < 3; c++) buf[i * 4 + c] = Math.max(0, Math.min(255, Math.round(this.px[i * 3 + c] * 255)));
      buf[i * 4 + 3] = 255;
    }
    return png(this.w, this.h, buf);
  }
}

// ---------------------------------------------------------------------------------------------
// Drawing

// Draws a snapshot. view: { x0, y0, x1, y1 } in frame units, x right and y DOWN from the frame's top
// left. scale: output pixels per unit. ss: supersampling per axis. conv: 'A' or 'B' (Lines only).
// box: a faint outline of the frame's own bounds, drawn under everything (to judge proportions).
function renderSnap(snap, view, scale, ss, conv, ground, box) {
  ground = ground || BG;
  const W = snap.w, H = snap.h;
  const ow = Math.round((view.x1 - view.x0) * scale), oh = Math.round((view.y1 - view.y0) * scale);
  const k = scale * ss;
  const img = new Img(ow * ss, oh * ss, ground);
  const toPx = (fx, fyUp) => [(fx - view.x0) * k, (H - fyUp - view.y0) * k];
  if (box) {
    const [bx0, by0] = toPx(0, H), [bx1, by1] = toPx(W, 0);
    const X0 = Math.round(bx0), Y0 = Math.round(by0), X1 = Math.round(bx1), Y1 = Math.round(by1);
    const c = [ground[0] + 0.07, ground[1] + 0.07, ground[2] + 0.09, 1];
    for (let d = 0; d < ss; d++) {
      for (let x = X0; x <= X1; x++) { img.blend(x, Y0 - d, ...c); img.blend(x, Y1 + d, ...c); }
      for (let y = Y0; y <= Y1; y++) { img.blend(X0 - d, y, ...c); img.blend(X1 + d, y, ...c); }
    }
  }
  const snapPx = ([x, y]) => [Math.round(x * 256) / 256, Math.round(y * 256) / 256]; // GPU subpixel grid
  const center = (px, py) => [view.x0 + (px + 0.5) / k, H - (view.y0 + (py + 0.5) / k)]; // frame x, y up
  const regs = snap.regions.slice().sort((a, b) =>
    (LAYER[a.layer] - LAYER[b.layer]) || ((a.sub || 0) - (b.sub || 0)) || (a.seq - b.seq));
  const t4 = [0, 0, 0, 0];
  for (const e of regs) {
    const vc = e.vc || [1, 1, 1, 1];
    const ra = (e.alpha === undefined ? 1 : e.alpha);
    const put = e.blend === 'ADD' ? img.add.bind(img) : img.blend.bind(img);
    if (e.kind === 'FontString') { drawText(img, e, W, H, toPx, k); continue; }
    let coord = null;
    if (e.mode === 'file') { if (e.file !== FILE_ID) continue; coord = e.coord || [0, 0, 0, 1, 1, 0, 1, 1]; }
    else if (e.mode === 'atlas') { coord = atlasCoord(e.atlas); if (!coord) continue; }
    else if (e.mode !== 'color') continue;
    const shadeUV = (px, py, u, v) => {
      if (coord) {
        sampleTex(u, v, t4);
        if (e.desat) { // SetDesaturated / SetDesaturation: toward the texel's luminance
          const lum = 0.299 * t4[0] + 0.587 * t4[1] + 0.114 * t4[2];
          for (let c = 0; c < 3; c++) t4[c] += (lum - t4[c]) * e.desat;
        }
        put(px, py, t4[0] * vc[0], t4[1] * vc[1], t4[2] * vc[2], t4[3] * vc[3] * ra);
      } else {
        const c = e.color;
        put(px, py, c[0] * vc[0], c[1] * vc[1], c[2] * vc[2], (c[3] === undefined ? 1 : c[3]) * vc[3] * ra);
      }
    };
    const shade = (s, w, px, py) => {
      if (coord) { const [u, v] = lerpCoord(coord, s, w); shadeUV(px, py, u, v); } else shadeUV(px, py);
    };
    if (e.kind === 'Line') {
      if (!e.start || !e.finish || !e.start.toParent || !e.finish.toParent) continue;
      const [Sx, Sy, Ex, Ey] = lineEnds(snap, e);
      const T = e.thickness || 1;
      const dx = Ex - Sx, dy = Ey - Sy, len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux; // n: left of the direction of travel (y up)
      const corners = [[Sx + nx * T / 2, Sy + ny * T / 2], [Sx - nx * T / 2, Sy - ny * T / 2],
        [Ex + nx * T / 2, Ey + ny * T / 2], [Ex - nx * T / 2, Ey - ny * T / 2]].map(([x, y]) => toPx(x, y));
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const px0 = Math.max(0, Math.floor(Math.min(...xs))), px1 = Math.min(img.w - 1, Math.ceil(Math.max(...xs)));
      const py0 = Math.max(0, Math.floor(Math.min(...ys))), py1 = Math.min(img.h - 1, Math.ceil(Math.max(...ys)));
      for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) {
        const [fx, fy] = center(px, py);
        const rx = fx - Sx, ry = fy - Sy;
        const along = (rx * ux + ry * uy) / len;
        if (along < 0 || along >= 1) continue;
        const across = rx * nx + ry * ny; // + is the left-hand side
        if (across < -T / 2 || across >= T / 2) continue;
        const w = conv === 'A' ? (T / 2 - across) / T : (across + T / 2) / T; // 0 = texcoord top
        shade(along, w, px, py);
      }
    } else if (e.vo) {
      const Q = quadCorners(e, W, H);
      if (!Q) continue;
      const P = Q.map(([x, y]) => snapPx(toPx(x, y)));
      const C = coord ? [[coord[0], coord[1]], [coord[2], coord[3]], [coord[4], coord[5]], [coord[6], coord[7]]] : [null, null, null, null];
      for (const [i, j, m] of QUAD_TRIS) rasterTri(img, P[i], P[j], P[m], C[i], C[j], C[m], shadeUV);
    } else {
      const R = rectOf(e, W, H);
      if (!R) continue;
      const [ax, ay] = toPx(R.l, R.t), [bx, by] = toPx(R.r, R.b);
      for (let py = Math.max(0, Math.floor(ay)); py <= Math.min(img.h - 1, Math.ceil(by)); py++) {
        for (let px = Math.max(0, Math.floor(ax)); px <= Math.min(img.w - 1, Math.ceil(bx)); px++) {
          const [fx, fy] = center(px, py);
          if (fx < R.l || fx >= R.r || fy < R.b || fy >= R.t) continue;
          shade((fx - R.l) / (R.r - R.l), (R.t - fy) / (R.t - R.b), px, py);
        }
      }
    }
  }
  // Box filter down to the output scale.
  const out = new Img(ow, oh, ground);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const q = ((y * ss + j) * img.w + (x * ss + i)) * 3;
      r += img.px[q]; g += img.px[q + 1]; b += img.px[q + 2];
    }
    const n = ss * ss, o = (y * ow + x) * 3;
    out.px[o] = r / n; out.px[o + 1] = g / n; out.px[o + 2] = b / n;
  }
  return out;
}

// Font strings: a 5x7 stand-in, cap height about 0.7 of the font size, with a dark outline.
function drawText(img, e, W, H, toPx, k) {
  if (!e.text) return;
  const size = e.size || 16, dot = size / 10;
  const str = String(e.text).toUpperCase();
  const tw = (str.length * 6 - 1) * dot, th = 7 * dot;
  const R = rectOf({ points: e.points, width: tw, height: th }, W, H);
  if (!R) return;
  const c = e.textColor || [1, 1, 1, 1];
  const [x0, y0] = toPx(R.l, R.t);
  const d = dot * k;
  for (const [ox, oy, col] of [[1, 1, [0, 0, 0]], [-1, -1, [0, 0, 0]], [0, 0, c]]) {
    for (let n = 0; n < str.length; n++) {
      const rows = glyphRows(str[n]);
      for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < 5; rx++) {
        if (rows[ry][rx] !== '1') continue;
        const gx = Math.round(x0 + (n * 6 + rx) * d + ox * k * 0.5), gy = Math.round(y0 + ry * d + oy * k * 0.5);
        for (let y = gy; y < gy + Math.ceil(d); y++) for (let x = gx; x < gx + Math.ceil(d); x++) {
          img.blend(x, y, col[0], col[1], col[2], (c[3] === undefined ? 1 : c[3]) * (e.alpha === undefined ? 1 : e.alpha));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Numbers worth reading next to the pictures

const r2 = (n) => Math.round(n * 100) / 100;
const deg = (a) => r2(a * 180 / Math.PI);
const normAng = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

// Strip pieces: shown Lines and moved textures whose key ends in a number.
function piecesOf(snap) {
  const out = [];
  for (const e of snap.regions) {
    const m = /^(.*?)(\d+)$/.exec(e.key);
    if (!m) continue;
    let Q = null, kind;
    if (e.kind === 'Line') { Q = lineQuad(snap, e); kind = 'line'; }
    else if (e.vo) { Q = quadCorners(e, snap.w, snap.h); kind = 'quad'; }
    if (!Q) continue;
    out.push({ e, kind, prefix: m[1], index: Number(m[2]), Q, layer: e.layer, sub: e.sub || 0 });
  }
  return out;
}

// A strip's circle: the base point for quads; for lines, the circle through three of its points.
function circleOf(snap, list) {
  const first = list[0];
  if (first.kind === 'quad') {
    const c = quadBase(first.e, snap.w, snap.h);
    const full = list.reduce((m, p) => Math.max(m, Math.hypot(p.Q[0][0] - c[0], p.Q[0][1] - c[1])), 0);
    const inner = Math.hypot(first.Q[1][0] - c[0], first.Q[1][1] - c[1]);
    return { cx: c[0], cy: c[1], ro: full, ri: inner };
  }
  if (list.length < 3) return null;
  const pts = [lineEnds(snap, list[0].e), lineEnds(snap, list[Math.floor(list.length / 2)].e), lineEnds(snap, list[list.length - 1].e)];
  const [ax, ay] = [pts[0][0], pts[0][1]], [bx, by] = [pts[1][0], pts[1][1]], [cx, cy] = [pts[2][2], pts[2][3]];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const rad = Math.hypot(ax - ux, ay - uy), T = list[0].e.thickness || 1;
  return { cx: ux, cy: uy, ro: rad + T / 2, ri: Math.max(0, rad - T / 2), line: true };
}

// The angle a piece runs through (start and end of its center line).
function pieceSpan(snap, p, c) {
  let s, e;
  if (p.kind === 'quad') {
    s = [(p.Q[0][0] + p.Q[1][0]) / 2, (p.Q[0][1] + p.Q[1][1]) / 2];
    e = [(p.Q[2][0] + p.Q[3][0]) / 2, (p.Q[2][1] + p.Q[3][1]) / 2];
  } else {
    const L = lineEnds(snap, p.e); s = [L[0], L[1]]; e = [L[2], L[3]];
  }
  const a0 = Math.atan2(s[1] - c.cy, s[0] - c.cx), a1 = Math.atan2(e[1] - c.cy, e[0] - c.cx);
  return [a0, normAng(a1 - a0)];
}

function stripReport(snap, prefix, list) {
  list = list.slice().sort((a, b) => a.index - b.index);
  const c = circleOf(snap, list);
  const first = list[0], last = list[list.length - 1];
  const e = first.e;
  const kind = e.mode === 'file' ? 'art' : 'flat';
  const texel = (p, end) => p.e.coord ? r2(p.e.coord[end ? 4 : 0] * TEX.w) : null;
  const rep = { strip: prefix, kind: first.kind + ' ' + kind, count: list.length, layer: e.layer + '/' + (e.sub || 0) };
  if (c) {
    rep.center = [r2(c.cx), r2(c.cy)];
    rep.rOuter = r2(c.ro); rep.rInner = r2(c.ri); rep.thickness = r2(c.ro - c.ri);
    const [s0] = pieceSpan(snap, first, c), [l0, ld] = pieceSpan(snap, last, c);
    rep.fromDeg = deg(s0); rep.toDeg = deg(normAng(l0 + ld));
  }
  if (first.kind === 'line') rep.lineThickness = r2(e.thickness);
  rep.texelsX = kind === 'art' ? [texel(first, false), texel(last, true)] : undefined;
  rep.alpha = kind === 'art' ? r2(e.vc[3]) : r2(e.color[3]);
  return rep;
}

// Within each layer and sublevel: the area strip pieces cover twice (double blending), and the area
// inside a strip's band that nothing covers (gaps). D samples per frame unit.
function coverage(snap, D) {
  D = D || 8;
  const pieces = piecesOf(snap).filter(p => !/:tick$/.test(p.prefix));
  const groups = new Map();
  for (const p of pieces) {
    const k = p.layer + '/' + p.sub;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const M = 24, gx0 = -M, gy0 = -M;
  const GW = Math.ceil((snap.w + 2 * M) * D), GH = Math.ceil((snap.h + 2 * M) * D);
  const results = [];
  for (const [gk, list] of groups) {
    if (list.length < 2) continue;
    const cnt = new Uint8Array(GW * GH), who = new Int16Array(GW * GH).fill(-1);
    const pairs = new Map();
    list.forEach((p, id) => {
      const xs = p.Q.map(q => q[0]), ys = p.Q.map(q => q[1]);
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - gx0) * D)), i1 = Math.min(GW - 1, Math.ceil((Math.max(...xs) - gx0) * D));
      const j0 = Math.max(0, Math.floor((Math.min(...ys) - gy0) * D)), j1 = Math.min(GH - 1, Math.ceil((Math.max(...ys) - gy0) * D));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = gx0 + (i + 0.5) / D, y = gy0 + (j + 0.5) / D;
        if (!quadHas(p.Q, x, y)) continue;
        const q = j * GW + i;
        if (cnt[q] >= 1) {
          const a = list[who[q]], key = a.prefix.split(':')[1] + a.index + '+' + p.prefix.split(':')[1] + p.index;
          const pr = pairs.get(key) || { n: 0, sx: 0, sy: 0 };
          pr.n++; pr.sx += x; pr.sy += y;
          pairs.set(key, pr);
        } else who[q] = id;
        if (cnt[q] < 255) cnt[q]++;
      }
    });
    let twice = 0, maxCount = 0;
    for (let q = 0; q < cnt.length; q++) { if (cnt[q] >= 2) twice++; if (cnt[q] > maxCount) maxCount = cnt[q]; }
    // Gaps: per circle in this group (strips that share a circle and band are checked together).
    const circles = new Map();
    const byPrefix = new Map();
    for (const p of list) { if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, []); byPrefix.get(p.prefix).push(p); }
    for (const [prefix, pl] of byPrefix) {
      pl.sort((a, b) => a.index - b.index);
      const c = circleOf(snap, pl);
      if (!c) continue;
      const ck = [c.cx, c.cy, c.ro, c.ri].map(v => v.toFixed(2)).join(',');
      if (!circles.has(ck)) circles.set(ck, { c, prefixes: [], spans: [], step: 0 });
      const C = circles.get(ck);
      C.prefixes.push(prefix.split(':')[1]);
      for (const p of pl) {
        const sp = pieceSpan(snap, p, c);
        C.spans.push(sp);
        C.step = Math.max(C.step, Math.abs(sp[1]));
      }
    }
    const gapRep = [];
    const slack = PIXEL_SNAP ? 1 / PIXEL_SNAP : 0; // snapped bases move whole pieces by up to a pixel
    for (const C of circles.values()) {
      const { c } = C;
      let rIn, rOut;
      if (c.line) { // the union of a Line strip's rectangles, roughly
        const rad = (c.ro + c.ri) / 2, T = c.ro - c.ri;
        rIn = rad - (T / 2) * Math.cos(C.step / 2) + 1.5 / D;
        rOut = Math.min(rad * Math.cos(C.step / 2) + T / 2, rad + (T / 2) * Math.cos(C.step / 2)) - 1.5 / D;
      } else { // inside every chord of the outer circle, outside the inner circle
        rIn = c.ri + 1.5 / D + slack;
        rOut = c.ro * Math.cos(C.step / 2) - 1.5 / D - slack;
      }
      if (rOut <= rIn) continue;
      let gaps = 0, gx = 0, gy = 0;
      const i0 = Math.max(0, Math.floor((c.cx - rOut - gx0) * D)), i1 = Math.min(GW - 1, Math.ceil((c.cx + rOut - gx0) * D));
      const j0 = Math.max(0, Math.floor((c.cy - rOut - gy0) * D)), j1 = Math.min(GH - 1, Math.ceil((c.cy + rOut - gy0) * D));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = gx0 + (i + 0.5) / D, y = gy0 + (j + 0.5) / D;
        const rr = Math.hypot(x - c.cx, y - c.cy);
        if (rr < rIn || rr > rOut) continue;
        const phi = Math.atan2(y - c.cy, x - c.cx);
        let inside = false;
        for (const [a0, da] of C.spans) {
          const dp = normAng(phi - a0), m = 1e-3;
          if (da >= 0 ? (dp > m && dp < da - m) : (dp < -m && dp > da + m)) { inside = true; break; }
        }
        if (!inside) continue;
        if (cnt[j * GW + i] === 0) { gaps++; gx += x; gy += y; }
      }
      gapRep.push({ strips: C.prefixes.join('+'), gapArea: r2(gaps / (D * D)), at: gaps ? [r2(gx / gaps), r2(gy / gaps)] : undefined });
    }
    const topPairs = [...pairs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 4)
      .map(([k, v]) => k + ' ' + r2(v.n / (D * D)) + 'u2 at (' + r2(v.sx / v.n) + ',' + r2(v.sy / v.n) + ')');
    results.push({ group: gk, pieces: list.length, twiceArea: r2(twice / (D * D)), maxCount, worstPairs: topPairs, gaps: gapRep });
  }
  return results;
}

function compareSnaps(a, b) {
  const diffs = [];
  const mb = new Map(b.regions.map(e => [e.key, e]));
  const ma = new Map(a.regions.map(e => [e.key, e]));
  for (const [key, e] of ma) {
    const f = mb.get(key);
    if (!f) { diffs.push(key + ' shown only after earlier states'); continue; }
    const pick = (x) => JSON.stringify([x.mode, x.color, x.coord, x.vc, x.desat, x.start, x.finish, x.thickness, x.points, x.width, x.height, x.vo, x.text],
      (k, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
    if (pick(e) !== pick(f)) diffs.push(key + ' differs from a fresh renderer');
  }
  for (const key of mb.keys()) if (!ma.has(key)) diffs.push(key + ' missing after earlier states');
  return diffs;
}

// ---------------------------------------------------------------------------------------------
// The sheets

const SCALE = 2, SS = 3, MARGIN = 14;

function modeLines(look, conv) {
  if (!FORCE_LINES) {
    const lines = ['SEAMLESS STRIPS: TEXTURES WITH SETVERTEXOFFSET, TWO AFFINE TRIANGLES (UL LL UR) + (UR LL LR)',
      'REMAINING LINES (SHOT MARK, TICKS) ARE FLAT. FAINT BOX: THE FRAME\'S OWN BOUNDS'];
    if (PIXEL_SNAP) lines.push('WHAT-IF (ART_PIXEL_SNAP=' + PIXEL_SNAP + '): BASE RECT EDGES ROUNDED TO SCREEN PIXELS EACH ON ITS OWN');
    return lines;
  }
  if (look !== 'blizzard') return ['LINE FALLBACK (ART_LINES=1): EVERY STRIP IS FLAT LINES'];
  return conv === 'A'
    ? ['LINE FALLBACK (ART_LINES=1), CONVENTION A: TEXCOORD TOP ON THE LEFT OF THE LINE DIRECTION']
    : ['LINE FALLBACK (ART_LINES=1), CONVENTION B: TEXCOORD TOP ON THE RIGHT OF THE LINE DIRECTION',
      'ALSO WHAT /SHOTWINDOW FLIPART LOOKS LIKE IF THE CLIENT USES CONVENTION A'];
}

function header(img, title, lines) {
  let y = 12;
  img.text(16, y, title, 3, [0.95, 0.85, 0.5]); y += 30;
  for (const s of lines) { img.text(16, y, s, 2, [0.85, 0.85, 0.85]); y += 20; }
  return y;
}

// The three members upright, as on the game's bar, for reference.
function referenceStrip(img, x, y) {
  img.text(x, y, 'REFERENCE (UPRIGHT, 1 TEXEL = 1 PX):', 2, [0.7, 0.7, 0.7]);
  y += 20;
  let cx = x;
  for (const [name, label] of [['ui-swingtimerbar-frame', 'FRAME'], ['ui-swingtimerbar-background', 'BACKGROUND'],
    ['ui-swingtimerbar-filling-ranged', 'FILL (RANGED)']]) {
    const m = MEMBERS[name];
    img.text(cx, y, label + ' ' + (m[2] - m[0]) + 'X' + (m[3] - m[1]), 2, [0.7, 0.7, 0.7]);
    for (let ty = m[1]; ty < m[3]; ty++) for (let tx = m[0]; tx < m[2]; tx++) {
      const i = (ty * TEX.w + tx) * 4;
      img.blend(cx + tx - m[0], y + 18 + ty - m[1], TEX.px[i] / 255, TEX.px[i + 1] / 255, TEX.px[i + 2] / 255, TEX.px[i + 3] / 255);
    }
    cx += (m[2] - m[0]) + 24;
  }
  // As stacked on the game's bar: background, fill to 60 percent, frame, centered.
  const fr = MEMBERS['ui-swingtimerbar-frame'], bg = MEMBERS['ui-swingtimerbar-background'], fl = MEMBERS['ui-swingtimerbar-filling-ranged'];
  img.text(cx, y, 'STACKED, FILL 60%', 2, [0.7, 0.7, 0.7]);
  const midY = y + 18 + (fr[3] - fr[1]) / 2;
  for (const [m, frac] of [[bg, 1], [fl, 0.6], [fr, 1]]) {
    const w = m[2] - m[0], h = m[3] - m[1], ox = cx + ((fr[2] - fr[0]) - w) / 2, oy = Math.round(midY - h / 2);
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < Math.round(w * frac); tx++) {
      const i = ((m[1] + ty) * TEX.w + m[0] + tx) * 4;
      img.blend(Math.round(ox + tx), oy + ty, TEX.px[i] / 255, TEX.px[i + 1] / 255, TEX.px[i + 2] / 255, TEX.px[i + 3] / 255);
    }
  }
  return y + 18 + 32 + 16;
}

function contactSheet(look, conv) {
  const designs = look.designs, nStates = designs[0].states.length;
  const cellW = Math.max(...designs.map(d => d.w)) + 2 * MARGIN, cellH = Math.max(...designs.map(d => d.h)) + 2 * MARGIN;
  const CW = cellW * SCALE, CH = cellH * SCALE, GAP = 12, LABEL = 22;
  const width = Math.max(16 * 2 + nStates * CW + (nStates - 1) * GAP, 1900);
  const top = look.name === 'blizzard' ? 210 : 110;
  const height = top + designs.length * (CH + LABEL + GAP) + 10;
  const img = new Img(width, height, [0.05, 0.05, 0.06]);
  const title = look.name === 'blizzard' ? 'SHOT WINDOW: BLIZZARD ART ON THE ROUND DESIGNS (DISPLAYS.LUA, ' + SCALE + 'X)'
    : 'SHOT WINDOW: DARK STYLE (FLAT) ON THE ROUND DESIGNS (DISPLAYS.LUA, ' + SCALE + 'X)';
  let y = header(img, title, modeLines(look.name, conv));
  if (look.name === 'blizzard') y = referenceStrip(img, 16, y + 4);
  else y += 8;
  for (const d of designs) {
    for (let i = 0; i < d.states.length; i++) {
      const st = d.states[i], snap = st.snap;
      const x = 16 + i * (CW + GAP);
      img.text(x, y + 4, d.design + ': ' + st.name, 2, [0.9, 0.9, 0.9]);
      const view = { x0: -(cellW - d.w) / 2, y0: -(cellH - d.h) / 2, x1: d.w + (cellW - d.w) / 2, y1: d.h + (cellH - d.h) / 2 };
      const cell = renderSnap(snap, view, SCALE, SS, conv, null, true);
      img.blit(cell, x, y + LABEL);
      img.outline(x, y + LABEL, CW, CH, [0.3, 0.3, 0.33, 1]);
    }
    y += CH + LABEL + GAP;
  }
  return img;
}

const IDLE = 'idle', MID = 'mid p=0.5', LIT = 'zone p=0.9 lit', WAIT = 'waiting pulse=0.6';

// Crops: [label, design, state, where, end, ground, span]. where: 'center' or a list of keys tried in
// turn (the seamless key first, then the Line one); 'first:<prefix>' is that strip's first shown
// piece. end: 'start' or 'end' of the piece's center line.
const CROPS = {
  blizzard: [
    ['LIGHT: ARC FRAME JOINT 8/9 IDLE', 'arc', IDLE, ['QAframe8', 'Aframe8'], 'end', LIGHT],
    ['LIGHT: ARC FILL JOINT 5/6 MID', 'arc', MID, ['QAfl5', 'Afl5'], 'end', LIGHT],
    ['LIGHT: ARC TINT JOINT 10/11 LIT', 'arc', LIT, ['QAfl10', 'Afl10'], 'end', LIGHT],
    ['LIGHT: ARC ZONE START MID', 'arc', MID, ['first:QAzone', 'first:Azone'], 'start', LIGHT],
    ['LIGHT: ARC LEFT END IDLE', 'arc', IDLE, ['QAframe1', 'Aframe1'], 'start', LIGHT],
    ['ARC FILL TIP MID', 'arc', MID, ['QAfl11', 'Afl11'], 'end'],
    ['ARC FILL TIP + TINT LIT', 'arc', LIT, ['QAfl20', 'Afl20'], 'end'],
    ['LIGHT: ARC FILL TIP + TINT LIT', 'arc', LIT, ['QAfl20', 'Afl20'], 'end', LIGHT],
    ['ARC TOP LIT (SHOT TICK)', 'arc', LIT, ['QAframe22', 'Aframe22'], 'end'],
    ['LIGHT: ARC TOP WAITING (FILLS MEET)', 'arc', WAIT, ['QAfl22', 'Afl22'], 'end', LIGHT],
    ['LIGHT: RING FRAME JOINT 3H IDLE', 'ring', IDLE, ['QAframe10', 'Aframe10'], 'end', LIGHT],
    ['LIGHT: RING ZONE START MID', 'ring', MID, ['first:QAzone', 'first:Azone'], 'start', LIGHT],
    ['RING FILL TIP MID', 'ring', MID, ['QAfill20', 'Afill20'], 'end'],
    ['RING FILL TIP + TINT LIT', 'ring', LIT, ['QAfill36', 'Afill36'], 'end'],
    ['LIGHT: RING FILL TIP + TINT LIT', 'ring', LIT, ['QAfill36', 'Afill36'], 'end', LIGHT],
    ['RING TOP CLASP IDLE', 'ring', IDLE, ['QAframe1', 'Aframe1'], 'start'],
    ['RING TOP CLASP LIT', 'ring', LIT, ['QAframe1', 'Aframe1'], 'start'],
    ['LIGHT: RING TOP CLASP LIT', 'ring', LIT, ['QAframe1', 'Aframe1'], 'start', LIGHT],
    ['RING TOP CLASP WAITING', 'ring', WAIT, ['QAframe1', 'Aframe1'], 'start'],
    ['LIGHT: RETICLE RIM CLASP IDLE', 'reticle', IDLE, ['QArim1', 'Arim1'], 'start', LIGHT],
    ['RETICLE LIT P=0.9', 'reticle', LIT, 'center', null, null, 40],
    ['LIGHT: RETICLE LIT P=0.9', 'reticle', LIT, 'center', null, LIGHT, 40],
    ['RETICLE WAITING', 'reticle', WAIT, 'center', null, null, 40],
    ['LIGHT: RETICLE WAITING', 'reticle', WAIT, 'center', null, LIGHT, 40],
    ['LIGHT: RETICLE TICK + RIM IDLE', 'reticle', IDLE, ['tick1'], 'end', LIGHT, 24],
    ['LIGHT: RETICLE RIM JOINT IDLE', 'reticle', IDLE, ['QArim10', 'Arim10'], 'end', LIGHT],
    ['RETICLE TICK START LIT', 'reticle', LIT, ['tick1'], 'start', null, 16],
    ['RETICLE MID P=0.5', 'reticle', MID, 'center', null, null, 110],
    ['LIGHT: ARC RIGHT END IDLE', 'arc', IDLE, ['QAframe44', 'Aframe44'], 'end', LIGHT],
    ['LIGHT: RING ZONE START UNDER FILL LIT', 'ring', LIT, ['first:QAzone', 'first:Azone'], 'start', LIGHT],
  ],
  dark: [
    ['LIGHT: ARC TRACK JOINT 5/6 IDLE', 'arc', IDLE, ['Qtlt5', 'tl5'], 'end', LIGHT],
    ['LIGHT: ARC TRACK/ZONE JOINT MID', 'arc', MID, ['first:Qtlz', 'tl19'], 'start', LIGHT],
    ['LIGHT: ARC FILL JOINT 5/6 MID', 'arc', MID, ['Qfl5', 'fl5'], 'end', LIGHT],
    ['ARC FILL TIP MID', 'arc', MID, ['Qfl11', 'fl11'], 'end'],
    ['LIGHT: ARC FILL TIP LIT', 'arc', LIT, ['Qfl20', 'fl20'], 'end', LIGHT],
    ['ARC TOP LIT (SHOT TICK)', 'arc', LIT, ['Qtlz22', 'tl22'], 'end'],
    ['LIGHT: ARC TOP WAITING (FILLS MEET)', 'arc', WAIT, ['Qfl22', 'fl22'], 'end', LIGHT],
    ['LIGHT: RING TRACK JOINT 3H IDLE', 'ring', IDLE, ['Qtt10', 't10'], 'end', LIGHT],
    ['LIGHT: RING TRACK/ZONE JOINT MID', 'ring', MID, ['first:Qtz', 't34'], 'start', LIGHT],
    ['LIGHT: RING ZONE START UNDER FILL LIT', 'ring', LIT, ['first:Qtz', 't34'], 'start', LIGHT, 12],
    ['RING FILL TIP LIT', 'ring', LIT, ['Qf36', 'f36'], 'end'],
    ['RING TOP CLASP LIT', 'ring', LIT, ['Qtt1', 't1'], 'start'],
    ['LIGHT: RING TOP CLASP WAITING', 'ring', WAIT, ['Qf1', 'f1'], 'start', LIGHT],
    ['RING TOP MID P=0.5', 'ring', MID, ['Qtt1', 't1'], 'start', null, 48],
    ['LIGHT: RETICLE ZONE CIRCLE JOINT', 'reticle', LIT, ['Qz4', 'z4'], 'end', LIGHT],
    ['RETICLE LIT P=0.9', 'reticle', LIT, 'center', null, null, 40],
    ['LIGHT: RETICLE LIT P=0.9', 'reticle', LIT, 'center', null, LIGHT, 40],
    ['RETICLE WAITING', 'reticle', WAIT, 'center', null, null, 40],
    ['LIGHT: RETICLE WAITING', 'reticle', WAIT, 'center', null, LIGHT, 40],
    ['RETICLE TICK 3H LIT', 'reticle', LIT, ['tick1'], 'end'],
    ['RETICLE MID P=0.5', 'reticle', MID, 'center', null, null, 110],
    ['RETICLE IDLE TOP TICK', 'reticle', IDLE, ['tick2'], 'end', null, 32],
  ],
};

// Splits a label into lines of at most n characters.
function wrap(s, n) {
  const out = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}

function cropPoint(snap, design, where, end) {
  if (where === 'center') return [snap.w / 2, snap.h / 2];
  for (const k of where) {
    let e = null;
    if (k.startsWith('first:')) {
      const pre = design + ':' + k.slice(6);
      let best = Infinity;
      for (const x of snap.regions) {
        if (!x.key.startsWith(pre)) continue;
        const rest = x.key.slice(pre.length);
        if (!/^\d+$/.test(rest)) continue;
        if (Number(rest) < best) { best = Number(rest); e = x; }
      }
    } else {
      e = snap.regions.find(x => x.key === design + ':' + k);
    }
    if (!e) continue;
    if (e.kind === 'Line') { const p = lineEnds(snap, e); return end === 'end' ? [p[2], p[3]] : [p[0], p[1]]; }
    const Q = quadCorners(e, snap.w, snap.h);
    if (Q) return end === 'end' ? [(Q[2][0] + Q[3][0]) / 2, (Q[2][1] + Q[3][1]) / 2] : [(Q[0][0] + Q[1][0]) / 2, (Q[0][1] + Q[1][1]) / 2];
  }
  return null;
}

function zoomSheet(look, conv) {
  const CELL = 256, GAP = 12, LABEL = 40, PER_ROW = 5;
  const crops = CROPS[look.name] || [];
  const byName = (design, state) => look.designs.find(d => d.design === design).states.find(s => s.name === state).snap;
  const rows = Math.ceil(crops.length / PER_ROW);
  const lines = modeLines(look.name, conv);
  const img = new Img(16 * 2 + PER_ROW * CELL + (PER_ROW - 1) * GAP, 60 + lines.length * 20 + rows * (CELL + LABEL + GAP), [0.05, 0.05, 0.06]);
  const y = header(img, 'SHOT WINDOW: ' + look.name.toUpperCase() + ', CROPS (8X UNLESS NOTED)', lines);
  crops.forEach(([label, design, state, where, end, ground, span], i) => {
    span = span || 32;
    const Z = CELL / span;
    const snap = byName(design, state);
    const p = cropPoint(snap, design, where, end);
    const x = 16 + (i % PER_ROW) * (CELL + GAP), yy = y + Math.floor(i / PER_ROW) * (CELL + LABEL + GAP);
    wrap(label + (Z !== 8 ? ' (' + r2(Z) + 'X)' : ''), 21).slice(0, 2)
      .forEach((s, j) => img.text(x, yy + 2 + j * 18, s, 2, [0.9, 0.9, 0.9]));
    if (!p) { img.text(x, yy + LABEL + 10, 'NOT DRAWN', 2, [1, 0.4, 0.3]); return; }
    const cx = p[0], cyDown = snap.h - p[1];
    const view = { x0: cx - span / 2, y0: cyDown - span / 2, x1: cx + span / 2, y1: cyDown + span / 2 };
    img.blit(renderSnap(snap, view, Z, Z >= 6 ? 2 : 3, conv, ground), x, yy + LABEL);
    img.outline(x, yy + LABEL, CELL, CELL, [0.3, 0.3, 0.33, 1]);
  });
  return img;
}

// ---------------------------------------------------------------------------------------------

const data = runLua();
console.log('Shot Window: round designs rendered offline (Displays.lua run in fengari)');
console.log('Atlas file ' + FILE_ID + ': ' + TEX.w + 'x' + TEX.h + ' from ' + BLP_FILE);
console.log('Strips: ' + (FORCE_LINES ? 'Line fallback forced (ART_LINES=1: the texture stub has no SetVertexOffset)'
  : 'seamless (textures moved with SetVertexOffset, two affine triangles each)'));
console.log('Defaults: dispSize ' + data.defaults.dispSize + ', dispThick ' + data.defaults.dispThick + ', artFlip ' + data.defaults.artFlip);
if (data.notes.length) console.log('Stub notes (methods called that the stub does not model): ' + data.notes.join(', '));
for (const look of data.looks) {
  console.log('\n==== look: ' + look.name + ' ====');
  console.log('Grid: rows ' + look.designs.map(d => d.design).join(', ') + '; columns ' + look.designs[0].states.map(s => s.name).join(', '));
  for (const d of look.designs) {
    console.log('\n' + d.design + ' (' + d.w + 'x' + d.h + ', mode ' + d.states[0].snap.mode + ', r.quads ' + d.quads + ')');
    for (const st of d.states) {
      const diffs = compareSnaps(st.snap, st.fresh);
      const counts = {};
      for (const e of st.snap.regions) {
        const k = e.kind === 'Texture' && e.vo ? 'Quad' : e.kind;
        counts[k] = (counts[k] || 0) + 1;
      }
      console.log('  ' + st.name + ': ' + Object.entries(counts).map(([k, n]) => n + ' ' + k).join(', ') +
        (diffs.length ? '; MEMO DIFF vs fresh renderer: ' + diffs.slice(0, 6).join('; ') + (diffs.length > 6 ? ' ...' : '') : '; same as a fresh renderer'));
      const cov = coverage(st.snap);
      let clean = 0, bands = 0;
      for (const g of cov) {
        bands += g.gaps.length;
        const gaps = g.gaps.filter(x => x.gapArea > 0).map(x => x.strips + ' ' + x.gapArea + 'u2 near (' + x.at.join(',') + ')');
        if (g.twiceArea > 0 || gaps.length) {
          console.log('    coverage ' + g.group + ' (' + g.pieces + ' pieces): twice ' + g.twiceArea + 'u2' +
            (g.worstPairs.length ? ' [' + g.worstPairs.join('; ') + ']' : '') + (gaps.length ? '; GAPS ' + gaps.join('; ') : '; no gaps'));
        } else clean++;
      }
      if (clean === cov.length) console.log('    coverage: ' + cov.length + ' layer groups, ' + bands + ' bands checked: nothing covered twice, no gaps');
    }
    const show = d.states.find(s => s.name === LIT).snap;
    const byPrefix = new Map();
    for (const p of piecesOf(show)) { if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, []); byPrefix.get(p.prefix).push(p); }
    for (const [prefix, list] of byPrefix) {
      if (list.length < 2) continue;
      console.log('    ' + JSON.stringify(stripReport(show, prefix.split(':')[1], list)));
    }
  }
}

const written = [];
const save = (img, name) => {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, img.toPNG());
  written.push(file + ' (' + img.w + 'x' + img.h + ')');
};
for (const look of data.looks) {
  if (!FORCE_LINES) {
    const snapTag = PIXEL_SNAP ? '-snap' + PIXEL_SNAP : '';
    save(contactSheet(look, 'A'), 'art-' + look.name + '-quads' + snapTag + '.png');
    save(zoomSheet(look, 'A'), 'art-' + look.name + '-quads' + snapTag + '-zoom.png');
  } else if (look.name === 'blizzard') {
    for (const conv of ['A', 'B']) {
      save(contactSheet(look, conv), 'art-blizzard-conv' + conv + '.png');
      save(zoomSheet(look, conv), 'art-blizzard-zoom-conv' + conv + '.png');
    }
  } else {
    save(contactSheet(look, 'A'), 'art-' + look.name + '-lines.png');
    save(zoomSheet(look, 'A'), 'art-' + look.name + '-lines-zoom.png');
  }
}
console.log('\nWrote:\n  ' + written.join('\n  '));
