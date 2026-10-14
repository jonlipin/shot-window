-- Shot Window displays and alerts: other ways to show the same clock.
--
-- ShotWindow.lua keeps the clock (PLAYER_SWING, latency, the hold for a late shot, moving during
-- the wind-up) and marks the game's own bar. This file draws that clock as one of several designs
-- on a frame of our own, and adds alerts that work with any of them: a tint on the screen's edges,
-- big call-out text, a sound as the stand-still zone starts, and how late a late shot was.
--
-- Every design reads the same prepared state, so none of them can fall behind the others: each
-- shows move and stand still, brightens inside the zone, holds at the shot and pulses while a shot
-- is late, turns the clip color while you move inside the zone, and flashes when the shot fires.
-- A renderer is a frame with textures and lines that Draw(state) lays out every frame; the same
-- renderer runs the free display and the preview in the options.
--
-- Curves are Line regions (frame:CreateLine), which can lie at any angle; textures are always
-- upright rectangles. Without CreateLine, small squares along the curve stand in.
-- Nothing here touches Blizzard's frames; "on the game's bar" only anchors our frame to theirs.

local ADDON, ns = ...

local DESIGNS = { "none", "classic", "pincer", "vpincer", "gap", "brackets", "pips", "scanner", "track", "arc", "ring", "reticle" }
local NAMES = {
	none = "None (marks on the game's bar only)",
	classic = "Classic bar",
	pincer = "Pincer bar",
	vpincer = "Vertical pincer",
	gap = "Closing gap",
	brackets = "Closing brackets",
	pips = "Pips",
	scanner = "Scanner",
	track = "Rhythm track",
	arc = "Horseshoe arc",
	ring = "Ring",
	reticle = "Tightening reticle",
}
local NOTES = {
	none = "No display of its own: only the marks on the game's swing bar (Zone tab). The alerts still work.",
	classic = "One fill, left to right; the red end is the stand-still zone.",
	pincer = "Two fills race in from the ends; the shot fires where they meet.",
	vpincer = "The pincer stood on end: top and bottom meet in the middle. Sits well beside your character.",
	gap = "The bar shrinks toward the middle and closes at the shot.",
	brackets = "Two brackets slide in and lock together at the shot.",
	pips = "Pips light from both ends toward the middle pip, which is the shot.",
	scanner = "The shot line stays in the middle; a spark sweeps across and stops on it if the shot is late.",
	track = "The coming shots scroll toward a fixed \"now\" line, like a rhythm game.",
	arc = "Fills climb both sides of a horseshoe and meet at the shot on top.",
	ring = "One sweep around the ring to the top, with a countdown inside.",
	reticle = "A circle tightens on its center and closes at the shot.",
}
local ROUND = { arc = true, ring = true, reticle = true }

ns.DISPLAYS, ns.DISPLAY_NAMES, ns.DISPLAY_NOTES, ns.ROUND_DISPLAYS = DESIGNS, NAMES, NOTES, ROUND

-- Sounds for the start of the stand-still zone: SOUNDKIT names with their usual ids as a fallback.
local SOUNDS = {
	{ name = "Tick", kit = "IG_MAINMENU_OPTION_CHECKBOX_ON", id = 856 },
	{ name = "Ping", kit = "MAP_PING", id = 3175 },
	{ name = "Ready check", kit = "READY_CHECK", id = 8960 },
	{ name = "Raid warning", kit = "RAID_WARNING", id = 8959 },
}
ns.SOUNDS = SOUNDS

local TRACK_BLIZZARD = { 0.05, 0.05, 0.06, 0.6 }
local TRACK = TRACK_BLIZZARD -- set from the window style before every draw
local SHOT = { 1, 0.85, 0.35 }
local WHITE = { 1, 1, 1 }
local WAIT_GRACE = 0.15

local function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi end return v end

---------------------------------------------------------------------------
-- A renderer: textures and lines on one frame, kept per design
---------------------------------------------------------------------------

local R = {}
R.__index = R

function ns.NewRenderer(parent)
	local r = setmetatable({}, R)
	r.frame = CreateFrame("Frame", nil, parent)
	r.frame:SetSize(1, 1)
	r.parts = {} -- design -> its regions, hidden when another design is drawn
	r.tex, r.segs, r.texts = {}, {}, {}
	r.w, r.h = 1, 1
	r.gen = 0 -- bumped whenever drawn pieces may have been hidden or moved: they are laid out again
	-- Curved strips are drawn as textures whose corners are moved onto the circles (SetVertexOffset);
	-- without it, as Lines.
	local probe = r.frame:CreateTexture()
	r.quads = probe.SetVertexOffset ~= nil
	probe:Hide()
	return r
end

-- Hides a design's regions and makes everything be laid out again when it comes back.
function R:HideParts(design)
	for _, region in ipairs(self.parts[design or self.design] or {}) do region:Hide() end
	self.stripSig = nil
	self.gen = self.gen + 1
end

function R:SetDesign(design)
	if self.design == design then return end
	if self.design then self:HideParts(self.design) end
	self.design = design
end

function R:SetSize(w, h)
	self.w, self.h = w, h
	self.frame:SetSize(w, h)
	self.stripSig = nil
	self.gen = self.gen + 1
end

local function keep(r, region)
	local list = r.parts[r.design]
	if not list then list = {} r.parts[r.design] = list end
	list[#list + 1] = region
	return region
end

function R:Tex(key, layer, sub)
	local name = self.design .. ":" .. key
	local t = self.tex[name]
	if not t then
		t = keep(self, self.frame:CreateTexture(nil, layer or "ARTWORK", nil, sub or 0))
		self.tex[name] = t
	end
	return t
end

function R:Text(key, font)
	local name = self.design .. ":" .. key
	local fs = self.texts[name]
	if not fs then
		fs = keep(self, self.frame:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightLarge"))
		self.texts[name] = fs
	end
	return fs
end

-- A rectangle from x0 to x1 (left to right) and y0 to y1 (top down), in the frame's units.
local function Rect(t, frame, x0, x1, y0, y1, c, a)
	if x1 - x0 < 0.5 or y1 - y0 < 0.5 or (a or 1) <= 0 then t:Hide() return end
	t:ClearAllPoints()
	t:SetPoint("TOPLEFT", frame, "TOPLEFT", x0, -y0)
	t:SetSize(x1 - x0, y1 - y0)
	t:SetColorTexture(c[1], c[2], c[3], a or c[4] or 1)
	t:Show()
end

-- A segment between two points (x right, y up, from the frame's bottom left).
function R:Seg(key, sub)
	local name = self.design .. ":" .. key
	local s = self.segs[name]
	if s then return s end
	if self.frame.CreateLine then
		s = { line = keep(self, self.frame:CreateLine(nil, "ARTWORK", nil, sub or 0)) }
	else
		s = { tex = keep(self, self.frame:CreateTexture(nil, "ARTWORK", nil, sub or 0)) }
	end
	self.segs[name] = s
	return s
end

local function SegSet(s, frame, x1, y1, x2, y2, thick, c, a)
	if s.line then
		local line = s.line
		line:SetStartPoint("BOTTOMLEFT", frame, x1, y1)
		line:SetEndPoint("BOTTOMLEFT", frame, x2, y2)
		line:SetThickness(thick)
		line:SetColorTexture(c[1], c[2], c[3], a or c[4] or 1)
		line:Show()
	else -- an upright square over the middle of the segment
		local t = s.tex
		local len = math.max(math.abs(x2 - x1), math.abs(y2 - y1), thick)
		t:ClearAllPoints()
		t:SetPoint("CENTER", frame, "BOTTOMLEFT", (x1 + x2) / 2, (y1 + y2) / 2)
		t:SetSize(len, len)
		t:SetColorTexture(c[1], c[2], c[3], a or c[4] or 1)
		t:Show()
	end
end

local function SegHide(s)
	if s.line then s.line:Hide() else s.tex:Hide() end
end

---------------------------------------------------------------------------
-- The look: the window style in use (Styles.lua) decides the track, the frame around a bar, the
-- font, and (if wanted) the move color. Blizzard: the swing timer's own bar art; Dark and
-- EllesmereUI: a flat panel in the style's colors with a one pixel outline. Automatic is whatever
-- Styles.lua resolved it to.
---------------------------------------------------------------------------

local HBAR = { classic = true, pincer = true, gap = true, scanner = true, track = true }

local function Look()
	local Styles = ns.Styles
	local applied = Styles and Styles.Applied and Styles.Applied()
	local S = Styles and Styles.S
	local look = { name = applied or "blizzard" }
	if applied and S then
		local ok, r, g, b = pcall(S.GetPanelColor)
		look.track = ok and r and { r, g, b, 0.85 } or { 0.07, 0.07, 0.08, 0.85 }
		local ok2, ar, ag, ab = pcall(S.GetAccentColor)
		look.accent = ok2 and ar and { ar, ag, ab } or nil
		local ok3, font = pcall(S.GetFont)
		look.font = ok3 and font or nil
		look.flat = true
	else
		look.track = TRACK_BLIZZARD
		look.flat = false
	end
	return look
end
ns.DisplayLook = Look

-- A one pixel outline of four textures around a frame.
local function Edges(frame, layer)
	local e = {}
	for i = 1, 4 do e[i] = frame:CreateTexture(nil, layer or "BORDER") end
	return e
end

local function PlaceEdges(e, target, pad, c)
	local px = 1
	e[1]:ClearAllPoints() e[1]:SetPoint("TOPLEFT", target, -pad, pad) e[1]:SetPoint("TOPRIGHT", target, pad, pad) e[1]:SetHeight(px)
	e[2]:ClearAllPoints() e[2]:SetPoint("BOTTOMLEFT", target, -pad, -pad) e[2]:SetPoint("BOTTOMRIGHT", target, pad, -pad) e[2]:SetHeight(px)
	e[3]:ClearAllPoints() e[3]:SetPoint("TOPLEFT", target, -pad, pad) e[3]:SetPoint("BOTTOMLEFT", target, -pad, -pad) e[3]:SetWidth(px)
	e[4]:ClearAllPoints() e[4]:SetPoint("TOPRIGHT", target, pad, pad) e[4]:SetPoint("BOTTOMRIGHT", target, pad, -pad) e[4]:SetWidth(px)
	for i = 1, 4 do e[i]:SetColorTexture(c[1], c[2], c[3], c[4] or 1) e[i]:Show() end
end

-- The frame around the drawing: Blizzard's swing bar art round a horizontal bar, or a flat panel
-- and outline for the drawn styles. Only redone when the design, size or style changes.
function R:Chrome(look)
	local key = (self.design or "") .. ":" .. self.w .. "x" .. self.h .. ":" .. look.name
	if key == self.chromeKey then return end
	self.chromeKey = key
	if not self.chrome then
		self.chrome = {
			bg = self.frame:CreateTexture(nil, "BACKGROUND", nil, -7),
			art = self.frame:CreateTexture(nil, "BORDER", nil, 0),
			edges = Edges(self.frame, "BORDER"),
		}
	end
	local c = self.chrome
	c.bg:Hide() c.art:Hide()
	for i = 1, 4 do c.edges[i]:Hide() end
	local d = self.design
	if HBAR[d] or d == "vpincer" then
		local padX, padY = 5, 4 -- as Blizzard's bar sits inside its frame
		if d == "vpincer" then padX, padY = 4, 5 end
		c.bg:ClearAllPoints()
		c.bg:SetPoint("TOPLEFT", self.frame, "TOPLEFT", -padX, padY)
		c.bg:SetPoint("BOTTOMRIGHT", self.frame, "BOTTOMRIGHT", padX, -padY)
		c.art:ClearAllPoints()
		c.art:SetPoint("TOPLEFT", self.frame, "TOPLEFT", -padX, padY)
		c.art:SetPoint("BOTTOMRIGHT", self.frame, "BOTTOMRIGHT", padX, -padY)
		local drewArt = false
		if not look.flat and HBAR[d] and c.bg.SetAtlas then
			local okBg = pcall(c.bg.SetAtlas, c.bg, "ui-swingtimerbar-background")
			local okArt = pcall(c.art.SetAtlas, c.art, "ui-swingtimerbar-frame")
			drewArt = okBg and okArt
			if drewArt then c.bg:Show() c.art:Show() end
		end
		if not drewArt then
			local t = look.track
			c.bg:SetColorTexture(t[1], t[2], t[3], look.flat and 0.9 or 0.7)
			c.bg:Show()
			PlaceEdges(c.edges, self.frame, math.max(padX, padY) - 1,
				look.flat and { 0, 0, 0, 1 } or { 0.8, 0.65, 0.3, 0.9 })
		end
	end
end

-- Text in the style's font, at a size of the design's choosing.
local function StyleFont(fs, look, size)
	local key = tostring(look.font) .. ":" .. size
	if fs.swFontKey == key then return end
	fs.swFontKey = key
	local file = look.font
	if not file then
		local f = GameFontHighlightLarge and GameFontHighlightLarge.GetFont and GameFontHighlightLarge:GetFont()
		file = f
	end
	if file then pcall(fs.SetFont, fs, file, size, "OUTLINE") end
end

---------------------------------------------------------------------------
-- What the clock says, turned into what every design needs
---------------------------------------------------------------------------

-- s (ns.ClockState): dur, lead, t (seconds into the swing, nil when idle), waiting, waitAge,
-- waitKind, lit, clipping, sinceShot, lateBy, parity, autoRepeat.
local function Prepare(s, db, look)
	local v = { look = look }
	v.dur = s.dur
	v.idle = not s.t and not s.waiting
	v.p = (s.t and s.dur and s.dur > 0) and clamp(s.t / s.dur, 0, 1) or 0
	if s.waiting then v.p = 1 end -- holding at the shot until it fires
	v.zf = (s.dur and s.dur > 0) and clamp(s.lead / s.dur, 0, 1) or 0
	v.lit, v.waiting, v.clipping = s.lit, s.waiting, s.clipping
	v.late = s.waiting and (s.waitAge or 0) >= WAIT_GRACE
	v.lateShot = v.late and s.waitKind == "late" -- the first shot's wind-up is a wait, not a late shot
	v.pulse = 1
	if v.late and db.pulse then v.pulse = 0.6 + 0.4 * math.cos(((s.waitAge or 0) - WAIT_GRACE) * math.pi * 2.5) end
	v.move = (db.moveAccent and v.look and v.look.accent) or db.moveColor or { 0.39, 0.6, 0.13 }
	v.zone = s.clipping and db.clipColor or db.color
	v.zoneA = ((s.lit and db.flash) and db.activeAlpha or db.idleAlpha) * v.pulse
	v.fill = s.lit and v.zone or v.move
	v.fillA = s.lit and v.pulse or 0.95
	v.flash = s.sinceShot and s.sinceShot < 0.2
	v.remaining = (s.t and s.dur) and math.max(0, s.dur - s.t) or nil
	if s.waiting then v.remaining = 0 end
	v.parity = s.parity or 0
	return v
end

---------------------------------------------------------------------------
-- The designs
---------------------------------------------------------------------------

local Draw = {}

local function ShotMark(r, key, f, x, H, v)
	local wide = v.flash and 2 or 1
	Rect(r:Tex(key, "OVERLAY"), f, x - wide, x + wide, -3, H + 3, v.flash and SHOT or WHITE, v.flash and 1 or 0.8)
end

function Draw.classic(r, v)
	local f, W, H = r.frame, r.w, r.h
	Rect(r:Tex("track", "BACKGROUND"), f, 0, W, 0, H, TRACK)
	Rect(r:Tex("zone", "ARTWORK", 1), f, W * (1 - v.zf), W, 0, H, v.zone, v.zoneA)
	Rect(r:Tex("fill", "ARTWORK", 2), f, 0, W * v.p, 0, H, v.fill, v.fillA)
	Rect(r:Tex("line", "ARTWORK", 3), f, W * (1 - v.zf) - 1, W * (1 - v.zf) + 1, 0, H, v.zone, 0.95)
	Rect(r:Tex("spark", "OVERLAY"), f, W * v.p - 1, W * v.p + 1, -2, H + 2, v.flash and SHOT or WHITE, v.idle and 0 or 0.9)
end

function Draw.pincer(r, v)
	local f, W, H = r.frame, r.w, r.h
	local C = W / 2
	Rect(r:Tex("track", "BACKGROUND"), f, 0, W, 0, H, TRACK)
	Rect(r:Tex("zone", "ARTWORK", 1), f, C - C * v.zf, C + C * v.zf, 0, H, v.zone, v.zoneA)
	Rect(r:Tex("left", "ARTWORK", 2), f, 0, C * v.p, 0, H, v.fill, v.fillA)
	Rect(r:Tex("right", "ARTWORK", 2), f, W - C * v.p, W, 0, H, v.fill, v.fillA)
	ShotMark(r, "shot", f, C, H, v)
end

-- The pincer on end: fills from the top and the bottom meet in the middle.
function Draw.vpincer(r, v)
	local f, W, H = r.frame, r.w, r.h
	local C = H / 2
	Rect(r:Tex("track", "BACKGROUND"), f, 0, W, 0, H, TRACK)
	Rect(r:Tex("zone", "ARTWORK", 1), f, 0, W, C - C * v.zf, C + C * v.zf, v.zone, v.zoneA)
	Rect(r:Tex("top", "ARTWORK", 2), f, 0, W, 0, C * v.p, v.fill, v.fillA)
	Rect(r:Tex("bottom", "ARTWORK", 2), f, 0, W, H - C * v.p, H, v.fill, v.fillA)
	local tall = v.flash and 2 or 1
	Rect(r:Tex("shot", "OVERLAY"), f, -3, W + 3, C - tall, C + tall, v.flash and SHOT or WHITE, v.flash and 1 or 0.8)
end

function Draw.gap(r, v)
	local f, W, H = r.frame, r.w, r.h
	local C = W / 2
	local rem = W * (1 - v.p)
	Rect(r:Tex("track", "BACKGROUND"), f, 0, W, 0, H, TRACK)
	Rect(r:Tex("fill", "ARTWORK", 2), f, C - rem / 2, C + rem / 2, 0, H, v.fill, v.fillA)
	local zw = W * v.zf / 2
	Rect(r:Tex("zl", "ARTWORK", 3), f, C - zw - 1, C - zw + 1, -3, H + 3, v.zone, math.max(v.zoneA, 0.6))
	Rect(r:Tex("zr", "ARTWORK", 3), f, C + zw - 1, C + zw + 1, -3, H + 3, v.zone, math.max(v.zoneA, 0.6))
	-- Closed and still waiting for the shot: a pulsing mark where the bar closed.
	local closed = v.p >= 1 and not v.idle
	Rect(r:Tex("dot", "OVERLAY"), f, C - 3, C + 3, 0, H, v.flash and SHOT or v.zone,
		v.flash and 1 or (closed and v.pulse or 0))
end

-- Two brackets, [ on the left and ] on the right, slide in and close round the shot: [ ] then [].
-- tip is where a bracket's arms end, nearest the middle; at the shot the tips are 1 apart.
function Draw.brackets(r, v)
	local f, W, H = r.frame, r.w, r.h
	local C, bar, arm = W / 2, 3, math.max(4, H * 0.3)
	local start, close = bar + arm, C - 1
	local tip = start + (close - start) * v.p
	-- Where the tips stand as the stand-still zone starts.
	local zx = start + (close - start) * (1 - v.zf)
	Rect(r:Tex("zl", "BACKGROUND"), f, zx - 1, zx + 1, H * 0.25, H * 0.75, v.zone, math.max(v.zoneA, 0.5))
	Rect(r:Tex("zr", "BACKGROUND"), f, W - zx - 1, W - zx + 1, H * 0.25, H * 0.75, v.zone, math.max(v.zoneA, 0.5))
	local c, a = v.fill, v.idle and 0.6 or v.fillA
	local back = tip - arm -- the left bracket's upright stands behind its arms
	Rect(r:Tex("lv", "ARTWORK"), f, back - bar, back, 0, H, c, a)
	Rect(r:Tex("lt", "ARTWORK"), f, back - bar, tip, 0, bar, c, a)
	Rect(r:Tex("lb", "ARTWORK"), f, back - bar, tip, H - bar, H, c, a)
	Rect(r:Tex("rv", "ARTWORK"), f, W - back, W - back + bar, 0, H, c, a)
	Rect(r:Tex("rt", "ARTWORK"), f, W - tip, W - back + bar, 0, bar, c, a)
	Rect(r:Tex("rb", "ARTWORK"), f, W - tip, W - back + bar, H - bar, H, c, a)
	local d = v.flash and 4 or 2
	Rect(r:Tex("dot", "OVERLAY"), f, C - d, C + d, H / 2 - d, H / 2 + d, v.flash and SHOT or WHITE, 0.9)
end

-- A row of pips; the middle one is the shot. Pips light from both ends toward it.
function Draw.pips(r, v, db)
	local f, W, H = r.frame, r.w, r.h
	local n = math.max(5, math.floor(db.pipCount or 11))
	if n % 2 == 0 then n = n + 1 end
	local mid = (n + 1) / 2
	local step = W / n
	local size = math.min(H, step * 0.75)
	local side = mid - 1
	local lit = math.floor(v.p * side + 0.0001)
	local zonePips = math.max(1, math.ceil(v.zf * side - 0.0001))
	for i = 1, n do
		local x = (i - 0.5) * step
		local fromEnd = math.min(i, n - i + 1) -- 1 at either end, mid at the middle
		local t = r:Tex("p" .. i, "ARTWORK")
		local c, a
		if i == mid then
			c = v.flash and SHOT or (v.lit and v.zone or WHITE)
			a = v.flash and 1 or (v.lit and v.fillA or 0.5)
		elseif fromEnd <= lit then
			c, a = v.fill, v.fillA
		elseif mid - fromEnd <= zonePips then
			c, a = v.zone, math.max(v.zoneA * 0.8, 0.25)
		else
			c, a = TRACK, 0.8
		end
		Rect(t, f, x - size / 2, x + size / 2, (H - size) / 2, (H + size) / 2, c, a)
	end
	for i = n + 1, (r.pipMax or 0) do r:Tex("p" .. i):Hide() end
	r.pipMax = math.max(r.pipMax or 0, n)
end

-- The scanner's spark: where it is (0..W) and the side it comes back from.
local function ScanPlace(v, W, mode)
	local u = v.idle and 0 or v.p
	if mode == "wrap" then -- leaves the middle to the right, wraps round, comes back from the left
		local x = (u + 0.5) % 1
		if v.p >= 1 then x = 0.5 end
		return x * W, -1
	end
	local side = (v.parity % 2 == 0) and 1 or -1 -- out to one side and back, the other side next time
	return W / 2 + side * (W / 2) * (1 - math.abs(2 * u - 1)), side
end

function Draw.scanner(r, v, db)
	local f, W, H = r.frame, r.w, r.h
	local C = W / 2
	local mode = db.scanMode == "wrap" and "wrap" or "pingpong"
	Rect(r:Tex("track", "BACKGROUND"), f, 0, W, 0, H, TRACK)
	local zw = (mode == "wrap") and W * v.zf or math.min(C, W * v.zf)
	local x, side = ScanPlace(v, W, mode)
	-- The half of the zone the spark comes back through is the one that means "stand still now".
	local litA, quietA = v.zoneA, db.idleAlpha * v.pulse
	if mode == "wrap" then
		Rect(r:Tex("zoneL", "ARTWORK", 1), f, C - zw, C, 0, H, v.zone, litA)
		r:Tex("zoneR", "ARTWORK", 1):Hide()
	else
		Rect(r:Tex("zoneL", "ARTWORK", 1), f, C - zw, C, 0, H, v.zone, side < 0 and litA or quietA)
		Rect(r:Tex("zoneR", "ARTWORK", 1), f, C, C + zw, 0, H, v.zone, side > 0 and litA or quietA)
	end
	ShotMark(r, "shot", f, C, H, v)
	local a = v.idle and 0.5 or (v.lit and v.pulse or 1)
	Rect(r:Tex("glow", "OVERLAY", 0), f, x - 6, x + 6, -1, H + 1, v.fill, 0.35 * a)
	Rect(r:Tex("spark", "OVERLAY", 1), f, x - 1.5, x + 1.5, -3, H + 3, v.fill, a)
end

function Draw.track(r, v, db)
	local f, W, H = r.frame, r.w, r.h
	local C = W / 2
	local span = math.max(1, db.trackSeconds or 5)
	local pxs = W / span
	Rect(r:Tex("track", "BACKGROUND"), f, 0, W, 0, H, TRACK)
	local dur = v.dur or 0
	local count = 0
	if dur > 0 then
		local nextShot = v.remaining or dur -- seconds until the next shot; 0 while it is late
		local lead = dur * v.zf
		local first = -math.ceil((span / 2) / dur) - 1
		local last = math.ceil((span / 2) / dur) + 1
		for k = first, last do
			count = count + 1
			local shotX = C + (nextShot + k * dur) * pxs
			local a0, a1 = clamp(shotX - dur * pxs, 0, W), clamp(shotX - lead * pxs, 0, W)
			Rect(r:Tex("m" .. count, "ARTWORK", 1), f, a0, a1, 3, H - 3, v.move, 0.45)
			local b0, b1 = clamp(shotX - lead * pxs, 0, W), clamp(shotX, 0, W)
			Rect(r:Tex("z" .. count, "ARTWORK", 2), f, b0, b1, 0, H, v.zone, (k == 0) and v.zoneA or db.idleAlpha)
			if shotX >= 0 and shotX <= W then
				local flashNow = k == -1 and v.flash -- the shot that just fired sits on the now line
				Rect(r:Tex("s" .. count, "ARTWORK", 3), f, shotX - 1, shotX + 1, -2, H + 2, SHOT, flashNow and 1 or 0.8)
			else
				r:Tex("s" .. count):Hide()
			end
		end
	end
	for k = count + 1, (r.trackMax or 0) do
		r:Tex("m" .. k):Hide() r:Tex("z" .. k):Hide() r:Tex("s" .. k):Hide()
	end
	r.trackMax = math.max(r.trackMax or 0, count)
	Rect(r:Tex("now", "OVERLAY"), f, C - 1, C + 1, -5, H + 5, WHITE, 1)
end

-- The horseshoe's center, as a fraction of its box height: the shot mark on top and the arms' ends
-- at the bottom then both sit inside the box.
local ARC_CY = 0.3
ns.ARC_CY = ARC_CY

-- A band kw*th wide on radius avail - kr*th stays at most 0.8 of its radius wide (as the reticle's
-- circle does), so a thick line on a small design never closes into a disk or turns inside out.
local function FitThick(th, avail, kw, kr)
	return math.max(1, math.min(th, 0.8 * avail / (kw + 0.8 * kr)))
end

-- Points on a circle: angle in radians, 0 = right, counterclockwise, y up from the bottom left.
local function At(cx, cy, rad, a) return cx + rad * math.cos(a), cy + rad * math.sin(a) end

-- A seamless strip along a circle: each segment is a texture whose four corners are moved onto the
-- inner and outer circles with SetVertexOffset, the way Blizzard joins its curved lines
-- (PowerDependencyLine, ArtifactPerks). Neighbors share their corners exactly, so there are no gaps
-- and no overlap: see-through art, tints and fades stay even. The path runs from angle a0 to a1 in
-- n segments; the part from fraction from to fraction to is drawn. paint.c is a flat color (or the
-- art's tint), paint.a the alpha, paint.slice the atlas slice for art (its top edge always on the
-- outside: corners 1 and 3 are the outer ones), paint.flip swaps the art's top and bottom.
-- A segment whose place has not changed is not laid out again.
local function QuadStrip(r, key, cx, cy, rad, thick, a0, a1, n, from, to, paint, sub)
	local ro, ri = rad + thick / 2, math.max(0, rad - thick / 2)
	local geo = table.concat({ cx, cy, ro, ri, a0, a1, n, r.gen }, ":")
	local slice, a = paint.slice, paint.a or 1
	for i = 1, n do
		local t = r:Tex(key .. i, "ARTWORK", sub)
		if not t.swNoSnap then
			-- Pixel snapping would round the 2x2 base to the screen grid and part the shared corners;
			-- Blizzard turns it off the same way where its geometry must line up (DisableSharpening).
			if t.SetSnapToPixelGrid then t:SetSnapToPixelGrid(false) end
			if t.SetTexelSnappingBias then t:SetTexelSnappingBias(0) end
			t.swNoSnap = true
		end
		local s0, s1 = (i - 1) / n, i / n
		local t0, t1 = math.max(s0, from), math.min(s1, to)
		if t1 <= t0 or a <= 0 then
			if t.swShown ~= false then t:Hide() t.swShown = false end
		else
			if t.swGeo ~= geo or t.swT0 ~= t0 or t.swT1 ~= t1 then
				-- The full segment's corners; a partial piece lies along its chords, so every layer
				-- drawn over the same segment shares one outline.
				local A0, A1 = a0 + (a1 - a0) * s0, a0 + (a1 - a0) * s1
				local Ox0, Oy0 = At(cx, cy, ro, A0)
				local Ix0, Iy0 = At(cx, cy, ri, A0)
				local Ox1, Oy1 = At(cx, cy, ro, A1)
				local Ix1, Iy1 = At(cx, cy, ri, A1)
				local u0 = t0 > s0 and (t0 - s0) * n or 0 -- exactly 0 or 1 at an unclamped end
				local u1 = t1 < s1 and (t1 - s0) * n or 1
				local ox0, oy0 = (1 - u0) * Ox0 + u0 * Ox1, (1 - u0) * Oy0 + u0 * Oy1
				local ix0, iy0 = (1 - u0) * Ix0 + u0 * Ix1, (1 - u0) * Iy0 + u0 * Iy1
				local ox1, oy1 = (1 - u1) * Ox0 + u1 * Ox1, (1 - u1) * Oy0 + u1 * Oy1
				local ix1, iy1 = (1 - u1) * Ix0 + u1 * Ix1, (1 - u1) * Iy0 + u1 * Iy1
				-- A 2x2 base at the center; each corner is moved by (where it goes) - (where it is).
				t:ClearAllPoints()
				t:SetSize(2, 2)
				t:SetPoint("CENTER", r.frame, "BOTTOMLEFT", cx, cy)
				t:SetVertexOffset(1, ox0 - (cx - 1), oy0 - (cy + 1)) -- upper left: outside, at the start
				t:SetVertexOffset(2, ix0 - (cx - 1), iy0 - (cy - 1)) -- lower left: inside, at the start
				t:SetVertexOffset(3, ox1 - (cx + 1), oy1 - (cy + 1)) -- upper right: outside, at the end
				t:SetVertexOffset(4, ix1 - (cx + 1), iy1 - (cy - 1)) -- lower right: inside, at the end
				t.swGeo, t.swT0, t.swT1, t.swTex, t.swShown = geo, t0, t1, nil, nil
			end
			if slice then
				local texKey = tostring(slice.file) .. (paint.flip and ":f" or "")
				if t.swTex ~= texKey then
					if t.swFile ~= slice.file then t:SetTexture(slice.file) t.swFile = slice.file end
					local top, bottom = slice.t, slice.b
					if paint.flip then top, bottom = bottom, top end
					t:SetTexCoord(slice.l + (slice.r - slice.l) * t0, slice.l + (slice.r - slice.l) * t1, top, bottom)
					t.swTex = texKey
				end
				local c = paint.c or WHITE
				t:SetVertexColor(c[1], c[2], c[3], a)
			else
				local c = paint.c
				t:SetColorTexture(c[1], c[2], c[3], a)
			end
			if t.swShown ~= true then t:Show() t.swShown = true end
		end
	end
end

-- A polyline along an arc from angle a0 to a1 in n segments, drawn fraction f of the way.
local function ArcFill(r, key, cx, cy, rad, a0, a1, n, f, thick, c, a, sub)
	if r.quads then return QuadStrip(r, "Q" .. key, cx, cy, rad, thick, a0, a1, n, 0, f, { c = c, a = a }, sub) end
	local done = f * n
	for i = 1, n do
		local s = r:Seg(key .. i, sub)
		if i - 1 >= done or a <= 0 then
			SegHide(s)
		else
			local t0, t1 = (i - 1) / n, math.min(i, done) / n
			local x1, y1 = At(cx, cy, rad, a0 + (a1 - a0) * t0)
			local x2, y2 = At(cx, cy, rad, a0 + (a1 - a0) * t1)
			SegSet(s, r.frame, x1, y1, x2, y2, thick, c, a)
		end
	end
end

-- The same arc as track: its last zf in the zone color, the rest dark.
local function ArcTrack(r, key, cx, cy, rad, a0, a1, n, zf, thick, zoneC, zoneA)
	if r.quads then
		QuadStrip(r, "Q" .. key .. "t", cx, cy, rad, thick, a0, a1, n, 0, 1 - zf, { c = TRACK, a = TRACK[4] or 1 }, 0)
		QuadStrip(r, "Q" .. key .. "z", cx, cy, rad, thick, a0, a1, n, 1 - zf, 1, { c = zoneC, a = zoneA }, 0)
		return
	end
	local zStart = 1 - zf
	for i = 1, n do
		local t0, t1 = (i - 1) / n, i / n
		local x1, y1 = At(cx, cy, rad, a0 + (a1 - a0) * t0)
		local x2, y2 = At(cx, cy, rad, a0 + (a1 - a0) * t1)
		local inZone = (t0 + t1) / 2 >= zStart
		SegSet(r:Seg(key .. i, 0), r.frame, x1, y1, x2, y2, thick, inZone and zoneC or TRACK, inZone and zoneA or nil)
	end
end

local function TopMark(r, cx, cy, rad, th, v)
	local top = math.pi / 2
	local x1, y1 = At(cx, cy, math.max(rad - th, rad * 0.3, 1), top)
	local x2, y2 = At(cx, cy, rad + th * 1.6, top)
	SegSet(r:Seg("shot", 6), r.frame, x1, y1, x2, y2, v.flash and 4 or 2, v.flash and SHOT or WHITE, 1)
end

---------------------------------------------------------------------------
-- Blizzard's own art on the round designs. Under the Blizzard window style the arc, the ring and
-- the reticle's rim wear the swing timer bar's art (its background, fill and frame), bent round the
-- curve: every short Line segment shows its own slice of the atlas (C_Texture.GetAtlasInfo gives
-- the file and the atlas's place in it). Nothing is shipped; the art comes from the game. The states
-- (stand still, clipping, late) are flat color laid over the fill, because a vertex color can only
-- darken the art.
---------------------------------------------------------------------------

local ART = {
	frame = "ui-swingtimerbar-frame",
	bg = "ui-swingtimerbar-background",
	fill = "ui-swingtimerbar-filling-ranged",
}
-- The atlas members' heights (2x art: frame 30, background 26, fill 22). The game's default ranged
-- bar is 30 tall with its fill inset 4 top and bottom, so the fill is 22 of the frame's 30: FRAME_K.
-- The background keeps its own height; the game stretches it to the frame's box, but those extra
-- rows lie under the frame's opaque edge anyway.
local FRAME_K, BG_K = 30 / 22, 26 / 22
local artSlices -- nil: not looked up yet; false: not available

local function ArtSlices()
	if artSlices ~= nil then return artSlices or nil end
	artSlices = false
	local get = C_Texture and C_Texture.GetAtlasInfo
	if not get then return nil end
	local out = {}
	for key, name in pairs(ART) do
		local ok, info = pcall(get, name)
		if not ok or type(info) ~= "table" then return nil end
		local file = info.file or info.filename -- as Blizzard's NineSlice does
		if file == nil or file == 0 or file == "" then return nil end
		local l, r, t, b = info.leftTexCoord, info.rightTexCoord, info.topTexCoord, info.bottomTexCoord
		if type(l) ~= "number" or type(r) ~= "number" or type(t) ~= "number" or type(b) ~= "number" then return nil end
		out[key] = { file = file, l = l, r = r, t = t, b = b }
	end
	artSlices = out
	return out
end
ns.ArtSlices = ArtSlices

-- One segment of art: points (x right, y up), the slice from u0 to u1 of the atlas member.
local function ArtSet(s, frame, x1, y1, x2, y2, thick, slice, u0, u1, a, flip)
	local line = s.line
	if s.artFile ~= slice.file then
		line:SetTexture(slice.file)
		s.artFile = slice.file
	end
	local top, bottom = slice.t, slice.b
	if flip then top, bottom = bottom, top end
	line:SetTexCoord(slice.l + (slice.r - slice.l) * u0, slice.l + (slice.r - slice.l) * u1, top, bottom)
	line:SetVertexColor(1, 1, 1, a)
	line:SetStartPoint("BOTTOMLEFT", frame, x1, y1)
	line:SetEndPoint("BOTTOMLEFT", frame, x2, y2)
	line:SetThickness(thick)
	line:Show()
end

-- A strip of art along an arc: the path runs from angle a0 to a1 in n segments, and the part from
-- fraction from to fraction to is drawn. Every segment is drawn clockwise (from the larger angle to
-- the smaller), so the art's top edge always lies on the same side of the curve. Segments overlap
-- a little so the outer edge shows no seams. A strip whose shape has not changed is left alone.
local function ArtStrip(r, key, cx, cy, rad, a0, a1, n, from, to, thick, slice, a, sub, flip)
	if r.quads then
		return QuadStrip(r, "Q" .. key, cx, cy, rad, thick, a0, a1, n, from, to, { slice = slice, a = a, flip = flip }, sub)
	end
	local sig = table.concat({ cx, cy, rad, a0, a1, n, from, to, thick, slice.file, a, flip and 1 or 0 }, ":")
	r.stripSig = r.stripSig or {}
	if r.stripSig[key] == sig then return end
	r.stripSig[key] = sig
	local overlap = 0.12
	for i = 1, n do
		local s = r:Seg(key .. i, sub)
		local t0, t1 = math.max((i - 1) / n, from), math.min(i / n, to)
		if t1 <= t0 or a <= 0 then
			SegHide(s)
		else
			local e = overlap / n
			local u0, u1 = math.max(from, t0 - e), math.min(to, t1 + e) -- overlap at joins, never past the ends
			local A0, A1 = a0 + (a1 - a0) * u0, a0 + (a1 - a0) * u1
			if A0 < A1 then A0, A1, u0, u1 = A1, A0, u1, u0 end -- clockwise: start at the larger angle
			local x1, y1 = At(cx, cy, rad, A0)
			local x2, y2 = At(cx, cy, rad, A1)
			ArtSet(s, r.frame, x1, y1, x2, y2, thick, slice, u0, u1, a, flip)
		end
	end
end

-- Flat color along the same kind of path (the zone, and the tint over the fill).
local function FlatStrip(r, key, cx, cy, rad, a0, a1, n, from, to, thick, c, a, sub)
	if r.quads then
		return QuadStrip(r, "Q" .. key, cx, cy, rad, thick, a0, a1, n, from, to, { c = c, a = a }, sub)
	end
	for i = 1, n do
		local s = r:Seg(key .. i, sub)
		local t0, t1 = math.max((i - 1) / n, from), math.min(i / n, to)
		if t1 <= t0 or a <= 0 then
			SegHide(s)
		else
			local x1, y1 = At(cx, cy, rad, a0 + (a1 - a0) * t0)
			local x2, y2 = At(cx, cy, rad, a0 + (a1 - a0) * t1)
			SegSet(s, r.frame, x1, y1, x2, y2, thick, c, a)
		end
	end
end

-- The tint that says what the fill means right now: the zone color while lit (stand still), the
-- clip color while moving in it; nothing while moving is free (the art's own fill shows).
local function TintAlpha(v)
	if not v.lit then return 0 end
	return 0.55 * v.pulse
end

local function ArtArc(r, v, db, sl, flip)
	local avail = math.min(r.w / 2, r.h * 0.55) - 1
	local th = FitThick(db.dispThick or 12, avail, FRAME_K, FRAME_K / 2)
	local fw, bw = th * FRAME_K, th * BG_K
	local cx, cy = r.w / 2, r.h * ARC_CY
	local rad = avail - fw / 2
	local top, spread, n = math.pi / 2, math.rad(110), 22
	local left, right = top + spread, top - spread -- the whole arc, left end to right end, clockwise
	ArtStrip(r, "Abg", cx, cy, rad, left, right, 2 * n, 0, 1, bw, sl.bg, 1, 0, flip)
	FlatStrip(r, "Azone", cx, cy, rad, left, right, 2 * n, 0.5 - 0.5 * v.zf, 0.5 + 0.5 * v.zf, bw, v.zone, v.zoneA * 0.85, 1)
	ArtStrip(r, "Afl", cx, cy, rad, left, top, n, 0, v.p, th, sl.fill, v.fillA, 2, flip)
	ArtStrip(r, "Afr", cx, cy, rad, right, top, n, 0, v.p, th, sl.fill, v.fillA, 2, flip)
	local ta = TintAlpha(v)
	FlatStrip(r, "Atl", cx, cy, rad, left, top, n, 0, v.p, th, v.fill, ta, 3)
	FlatStrip(r, "Atr", cx, cy, rad, right, top, n, 0, v.p, th, v.fill, ta, 3)
	ArtStrip(r, "Aframe", cx, cy, rad, left, right, 2 * n, 0, 1, fw, sl.frame, 1, 4, flip)
	return cx, cy, rad, fw
end

local function ArtRing(r, v, db, sl, flip)
	local half = math.min(r.w, r.h) / 2
	local th = FitThick(db.dispThick or 12, half, FRAME_K, FRAME_K / 2 + 0.8)
	local fw, bw = th * FRAME_K, th * BG_K
	local cx, cy = r.w / 2, r.h / 2
	local rad = half - fw / 2 - th * 0.8
	local top, n = math.pi / 2, 40
	local finish = top - 2 * math.pi -- clockwise from the top, all the way round
	ArtStrip(r, "Abg", cx, cy, rad, top, finish, n, 0, 1, bw, sl.bg, 1, 0, flip)
	FlatStrip(r, "Azone", cx, cy, rad, top, finish, n, 1 - v.zf, 1, bw, v.zone, v.zoneA * 0.85, 1)
	ArtStrip(r, "Afill", cx, cy, rad, top, finish, n, 0, v.p, th, sl.fill, v.fillA, 2, flip)
	FlatStrip(r, "Atint", cx, cy, rad, top, finish, n, 0, v.p, th, v.fill, TintAlpha(v), 3)
	ArtStrip(r, "Aframe", cx, cy, rad, top, finish, n, 0, 1, fw, sl.frame, 1, 4, flip)
	return cx, cy, rad, fw
end

function Draw.arc(r, v, db)
	local th = db.dispThick or 12
	local cx, cy, rad
	if r.mode == "art" then
		local fw
		cx, cy, rad, fw = ArtArc(r, v, db, ArtSlices(), db.artFlip)
		TopMark(r, cx, cy, rad, fw / 2 + 2, v)
	else
		local avail = math.min(r.w / 2, r.h * 0.55)
		th = FitThick(th, avail, 1, 1)
		cx, cy = r.w / 2, r.h * ARC_CY
		rad = avail - th
		local top, spread, n = math.pi / 2, math.rad(110), 22
		ArcTrack(r, "tl", cx, cy, rad, top + spread, top, n, v.zf, th, v.zone, v.zoneA)
		ArcTrack(r, "tr", cx, cy, rad, top - spread, top, n, v.zf, th, v.zone, v.zoneA)
		ArcFill(r, "fl", cx, cy, rad, top + spread, top, n, v.p, th, v.fill, v.fillA, 2)
		ArcFill(r, "fr", cx, cy, rad, top - spread, top, n, v.p, th, v.fill, v.fillA, 2)
		TopMark(r, cx, cy, rad, th, v)
	end
	local label = r:Text("label")
	StyleFont(label, r.look, math.max(10, math.floor(rad * 0.28)))
	label:ClearAllPoints()
	label:SetPoint("CENTER", r.frame, "BOTTOMLEFT", cx, cy + rad * 0.15)
	if v.idle then
		label:SetText("")
	else
		local c = v.lit and v.zone or v.move
		label:SetText(v.clipping and "Moving" or (v.lateShot and "Late" or (v.lit and "Stand still" or "Move")))
		label:SetTextColor(c[1], c[2], c[3], v.late and v.pulse or 1)
	end
	label:Show()
end

function Draw.ring(r, v, db)
	local th = db.dispThick or 12
	local cx, cy, rad
	if r.mode == "art" then
		local fw
		cx, cy, rad, fw = ArtRing(r, v, db, ArtSlices(), db.artFlip)
		TopMark(r, cx, cy, rad, fw / 2 + 2, v)
	else
		local half = math.min(r.w, r.h) / 2
		th = FitThick(th, half, 1, 1.7)
		cx, cy = r.w / 2, r.h / 2
		rad = half - th * 1.7
		local top, n = math.pi / 2, 40
		-- Clockwise from the top, all the way round.
		ArcTrack(r, "t", cx, cy, rad, top, top - 2 * math.pi, n, v.zf, th, v.zone, v.zoneA)
		ArcFill(r, "f", cx, cy, rad, top, top - 2 * math.pi, n, v.p, th, v.fill, v.fillA, 2)
		TopMark(r, cx, cy, rad, th, v)
	end
	local count = r:Text("count")
	StyleFont(count, r.look, math.max(10, math.floor(rad * 0.45)))
	count:ClearAllPoints()
	count:SetPoint("CENTER", r.frame, "BOTTOMLEFT", cx, cy)
	if v.idle or not v.remaining then
		count:SetText("")
	else
		count:SetText(v.lateShot and "Late" or ("%.1f"):format(v.remaining))
		local c = v.lit and v.zone or WHITE
		count:SetTextColor(c[1], c[2], c[3], v.late and v.pulse or 1)
	end
	count:Show()
end

function Draw.reticle(r, v, db)
	local art = r.mode == "art" and ArtSlices()
	local th = math.max(2, (db.dispThick or 12) / 2)
	local half = math.min(r.w, r.h) / 2
	-- Blizzard style: a rim of the bar's frame art, as wide as fits after the circle's own travel.
	local rim = art and math.max(0, math.min(th * FRAME_K * 1.4, half - th - 2 - 12)) or 0
	local cx, cy = r.w / 2, r.h / 2
	local rmax = half - th - 2 - rim
	local rmin = math.max(4, rmax * 0.12)
	local rimR = half - rim / 2 - 1
	local rad = rmin + (rmax - rmin) * (1 - v.p)
	local zrad = rmin + (rmax - rmin) * v.zf -- once the circle is inside this one: stand still
	local n = 32
	local top = math.pi / 2
	-- The circle's drawn thickness, never more than its radius allows, so it stays a ring as it closes.
	local ct = art and math.min(th * 1.4, rad * 0.8) or math.min(th, rad * 0.8)
	if art then
		ArtStrip(r, "Arim", cx, cy, rimR, top, top - 2 * math.pi, 40, 0, 1, rim, art.frame, rim >= 2 and 1 or 0, 0, db.artFlip)
		-- The tightening circle in the bar's fill art, tinted while it means stand still.
		ArtStrip(r, "Acirc", cx, cy, rad, top, top - 2 * math.pi, n, 0, 1, ct, art.fill,
			v.idle and 0.6 or v.fillA, 2, db.artFlip)
		FlatStrip(r, "Atint", cx, cy, rad, top, top - 2 * math.pi, n, 0, 1, ct, v.fill, TintAlpha(v), 3)
	end
	-- The zone ring sits over the circle (under the ticks), so the moment the circle crosses it shows.
	FlatStrip(r, "z", cx, cy, zrad, 0, 2 * math.pi, n, 0, 1, 1.5, v.zone, math.max(v.zoneA, 0.3), 4)
	if not art then
		FlatStrip(r, "c", cx, cy, rad, 0, 2 * math.pi, n, 0, 1, ct, v.fill, v.idle and 0.5 or v.fillA, 2)
	end
	-- Ticks start at the circle's drawn edge and stop short of the rim, or inside the frame.
	local r0, full = rad + ct / 2, rmax * 0.18
	local edge = (art and rim >= 2) and (rimR - rim / 2 - 1) or (half - 1)
	local len = math.min(full, edge - r0)
	for i, a in ipairs({ 0, math.pi / 2, math.pi, math.pi * 1.5 }) do
		local s = r:Seg("tick" .. i, 5)
		if len < math.min(4, full) then
			SegHide(s) -- too short to read as a tick
		else
			local x1, y1 = At(cx, cy, r0, a)
			local x2, y2 = At(cx, cy, r0 + len, a)
			SegSet(s, r.frame, x1, y1, x2, y2, 2, WHITE, 0.7)
		end
	end
	local dot = r:Tex("dot", "OVERLAY")
	local ds = v.flash and 8 or 4
	dot:ClearAllPoints()
	dot:SetPoint("CENTER", r.frame, "BOTTOMLEFT", cx, cy)
	dot:SetSize(ds, ds)
	dot:SetColorTexture(SHOT[1], SHOT[2], SHOT[3], v.flash and 1 or 0.85)
	dot:Show()
end

function R:Draw(s, db)
	if not self.design or not Draw[self.design] then return end
	if not s or not s.dur then -- no swing known yet (no ranged weapon, or its speed is secret)
		self:HideParts() -- and lay everything out again when it comes back
		if self.chrome then
			self.chrome.bg:Hide() self.chrome.art:Hide()
			for i = 1, 4 do self.chrome.edges[i]:Hide() end
			self.chromeKey = nil
		end
		return
	end
	local look = Look()
	TRACK = look.track
	self:Chrome(look)
	self.look = look
	local canBend = self.quads or self.frame.CreateLine
	local mode = (ROUND[self.design] and not look.flat and canBend and ArtSlices()) and "art" or "flat"
	if mode ~= self.mode or self.modeDesign ~= self.design then
		self:HideParts()
		self.mode, self.modeDesign = mode, self.design
	end
	Draw[self.design](self, Prepare(s, db, look), db)
end

-- The size a design is drawn at.
function ns.DisplaySize(db, design)
	local w, h = db.dispWidth or 240, db.dispHeight or 16
	if ROUND[design] then
		local s = db.dispSize or 140
		if design == "arc" then return s, s * 0.8 end
		return s, s
	elseif design == "vpincer" then
		return h, w
	elseif design == "brackets" then
		return w, math.max(h * 2, 28)
	elseif design == "pips" then
		return w, math.max(h, 10)
	end
	return w, h
end

---------------------------------------------------------------------------
-- Alerts that go with any display: call-out text, the late readout, the screen edge, a sound
---------------------------------------------------------------------------

-- The call-out's words and color for a state, or nil for nothing.
local function CalloutText(s, db)
	if s.clipping then return "Moving", db.clipColor, 1 end
	if s.waiting and s.waitKind == "late" and (s.waitAge or 0) >= WAIT_GRACE then
		local pulse = db.pulse and (0.6 + 0.4 * math.cos(((s.waitAge or 0) - WAIT_GRACE) * math.pi * 2.5)) or 1
		return "Late", db.color, pulse
	end
	if s.lit then return "Stop", db.color, 1 end
	if s.sinceShot and s.sinceShot < 0.4 then
		return "Go", (db.moveAccent and Look().accent) or db.moveColor or { 0.39, 0.6, 0.13 }, 1
	end
	return nil
end
ns.CalloutText = CalloutText

local function SetBigFont(fs, size)
	local look = Look()
	local file = look.font or (GameFontNormalHuge and GameFontNormalHuge:GetFont())
	local key = tostring(file) .. ":" .. size
	if fs.swFontKey == key then return end -- also called every frame, to follow a style change
	fs.swFontKey = key
	if file then pcall(fs.SetFont, fs, file, size, "OUTLINE") end
end

-- Four gradient bands around the screen, or flat ones if gradients are not available.
local function EdgeBands(parent, size)
	local bands = {}
	for i, side in ipairs({ "TOP", "BOTTOM", "LEFT", "RIGHT" }) do
		local t = parent:CreateTexture(nil, "BACKGROUND")
		if side == "TOP" or side == "BOTTOM" then
			t:SetPoint(side .. "LEFT")
			t:SetPoint(side .. "RIGHT")
			t:SetHeight(size)
		else
			t:SetPoint("TOP" .. side)
			t:SetPoint("BOTTOM" .. side)
			t:SetWidth(size)
		end
		bands[i] = { tex = t, side = side }
	end
	return bands
end

local function PaintEdge(bands, c, size)
	for _, band in ipairs(bands) do
		local t, side = band.tex, band.side
		if side == "TOP" or side == "BOTTOM" then t:SetHeight(size) else t:SetWidth(size) end
		t:SetColorTexture(1, 1, 1, 1)
		local strong = CreateColor and CreateColor(c[1], c[2], c[3], 0.9)
		local clear = CreateColor and CreateColor(c[1], c[2], c[3], 0)
		local ok = false
		if strong and t.SetGradient then
			-- VERTICAL runs bottom (min) to top (max); HORIZONTAL runs left (min) to right (max).
			if side == "TOP" then ok = pcall(t.SetGradient, t, "VERTICAL", clear, strong)
			elseif side == "BOTTOM" then ok = pcall(t.SetGradient, t, "VERTICAL", strong, clear)
			elseif side == "LEFT" then ok = pcall(t.SetGradient, t, "HORIZONTAL", strong, clear)
			else ok = pcall(t.SetGradient, t, "HORIZONTAL", clear, strong) end
		end
		if not ok then t:SetColorTexture(c[1], c[2], c[3], 0.45) end
	end
end

-- How strongly the edge shows, and in which color: nil when it should not show.
local function EdgeState(s, db)
	if s.clipping then return db.clipColor, 0.85 end
	if s.waiting and s.waitKind == "late" and (s.waitAge or 0) >= WAIT_GRACE then
		local pulse = db.pulse and (0.6 + 0.4 * math.cos(((s.waitAge or 0) - WAIT_GRACE) * math.pi * 2.5)) or 1
		return db.color, 0.7 * pulse
	end
	if s.lit then return db.color, 0.6 end
	return nil
end
ns.EdgeState = EdgeState

local function PlayKit(index)
	local entry = SOUNDS[index] or SOUNDS[1]
	local id = (SOUNDKIT and SOUNDKIT[entry.kit]) or entry.id
	if PlaySound then pcall(PlaySound, id, "Master") end
end
ns.PlayKit = PlayKit

---------------------------------------------------------------------------
-- The free display and the alerts, driven by one ticker
---------------------------------------------------------------------------

local holder, rend, outline, hint, lateFS
local callout, calloutFS, edge, edgeBands, edgeKey
local ticker = CreateFrame("Frame")
ticker:Hide()
local state = {}
local prevLit

local function SavePosition()
	local db = ns.DB()
	if not db or not holder then return end
	local x, y = holder:GetCenter()
	local ux, uy = UIParent:GetCenter()
	if not (x and ux) then return end
	local scale = holder:GetEffectiveScale() / UIParent:GetEffectiveScale()
	db.dispPos = { x * scale - ux, y * scale - uy }
end

local function Place()
	local db = ns.DB()
	holder:ClearAllPoints()
	local bar = _G.SwingTimerRangedFrame
	if db.dispOnBar and bar then
		holder:SetPoint("CENTER", bar, "CENTER", 0, 0) -- ours follows theirs; theirs is never moved
	elseif type(db.dispPos) == "table" and db.dispPos[1] then
		holder:SetPoint("CENTER", UIParent, "CENTER", db.dispPos[1], db.dispPos[2])
	else
		holder:SetPoint("CENTER", UIParent, "CENTER", 0, -180)
	end
end

local function Visible(db, s)
	if not db.dispLocked or db.dispAlways then return true end
	if InCombatLockdown and InCombatLockdown() then return true end
	return s.autoRepeat == true or s.t ~= nil or s.waiting
end

local function CreateHolder()
	holder = CreateFrame("Frame", "ShotWindowDisplay", UIParent)
	holder:SetFrameStrata("MEDIUM")
	holder:SetClampedToScreen(true)
	holder:SetMovable(true)
	holder:RegisterForDrag("LeftButton")
	holder:SetScript("OnDragStart", function(self)
		local db = ns.DB()
		if db and not db.dispLocked and not db.dispOnBar then self:StartMoving() end
	end)
	holder:SetScript("OnDragStop", function(self)
		self:StopMovingOrSizing()
		SavePosition()
		Place()
	end)
	rend = ns.NewRenderer(holder)
	rend.frame:SetPoint("CENTER")
	outline = holder:CreateTexture(nil, "BACKGROUND", nil, -8)
	outline:SetPoint("TOPLEFT", -4, 4)
	outline:SetPoint("BOTTOMRIGHT", 4, -4)
	outline:SetColorTexture(0.5, 0.82, 1, 0.18)
	hint = holder:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	hint:SetPoint("BOTTOM", holder, "TOP", 0, 6)
	hint:SetText("Shot Window: drag to move, then /shotwindow lock")
	lateFS = holder:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	lateFS:SetPoint("TOPRIGHT", holder, "BOTTOMRIGHT", 0, -2)
end

local function CalloutAnchor()
	callout:ClearAllPoints()
	local bar = _G.SwingTimerRangedFrame
	if holder and holder:IsShown() then
		callout:SetPoint("BOTTOM", holder, "TOP", 0, 8)
	elseif bar then
		callout:SetPoint("BOTTOM", bar, "TOP", 0, 14)
	else
		callout:SetPoint("CENTER", UIParent, "CENTER", 0, 140)
	end
end

local function Tick()
	local db = ns.DB()
	if not db then return end
	local s = ns.ClockState and ns.ClockState(state)
	if not s then return end
	if holder and holder:IsShown() then
		local show = Visible(db, s)
		rend.frame:SetAlpha(show and 1 or 0)
		lateFS:SetAlpha(show and 1 or 0)
		if show then rend:Draw(s, db) end
		if db.lateText and s.lateBy then
			local c = db.clipColor
			lateFS:SetText(("+%.2f"):format(s.lateBy))
			lateFS:SetTextColor(c[1], c[2], c[3])
			lateFS:Show()
		else
			lateFS:Hide()
		end
	end
	if callout and db.callout then
		local text, c, a = CalloutText(s, db)
		if text then
			SetBigFont(calloutFS, db.calloutSize or 26)
			calloutFS:SetText(text)
			calloutFS:SetTextColor(c[1], c[2], c[3], a)
			callout:Show()
		else
			callout:Hide()
		end
	end
	if edge and db.edge then
		local c, a = EdgeState(s, db)
		if c then
			local key = c[1] .. ":" .. c[2] .. ":" .. c[3] .. ":" .. (db.edgeSize or 90)
			if key ~= edgeKey then
				PaintEdge(edgeBands, c, db.edgeSize or 90)
				edgeKey = key
			end
			edge:SetAlpha(a)
			edge:Show()
		else
			edge:Hide()
		end
	end
	if db.sound then
		-- Once as the stand-still zone starts in a running swing (not for the first shot's wind-up).
		if s.lit and not prevLit and s.t then PlayKit(db.soundKit) end
	end
	prevLit = s.lit
end
ticker:SetScript("OnUpdate", Tick)

-- Called after every settings change and at login.
function ns.ApplyDisplay()
	local db = ns.DB()
	if not db then return end
	local shooter = ns.HasShot and ns.HasShot()
	local design = db.display or "none"
	if not NAMES[design] then design = "none" end
	if shooter and design ~= "none" then
		if not holder then CreateHolder() end
		rend:SetDesign(design)
		local w, h = ns.DisplaySize(db, design)
		rend:SetSize(w, h)
		holder:SetSize(w, h)
		Place()
		local unlocked = not db.dispLocked and not db.dispOnBar
		holder:EnableMouse(unlocked)
		outline:SetShown(unlocked)
		hint:SetShown(unlocked)
		holder:Show()
	elseif holder then
		holder:Hide()
	end
	if shooter and db.callout then
		if not callout then
			callout = CreateFrame("Frame", "ShotWindowCallout", UIParent)
			callout:SetSize(300, 60)
			callout:SetFrameStrata("HIGH")
			calloutFS = callout:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
			calloutFS:SetPoint("BOTTOM")
		end
		SetBigFont(calloutFS, db.calloutSize or 26)
		CalloutAnchor()
	elseif callout then
		callout:Hide()
	end
	if shooter and db.edge then
		if not edge then
			edge = CreateFrame("Frame", "ShotWindowEdge", UIParent)
			edge:SetAllPoints(UIParent)
			edge:SetFrameStrata("BACKGROUND")
			edge:EnableMouse(false)
			edgeBands = EdgeBands(edge, db.edgeSize or 90)
		end
		edgeKey = nil
		edge:Hide()
	elseif edge then
		edge:Hide()
	end
	ticker:SetShown(shooter and (design ~= "none" or db.callout or db.edge or db.sound) and true or false)
end

function ns.DisplayReport()
	local db = ns.DB()
	if not db then return "no settings" end
	local design = db.display or "none"
	local where = db.dispOnBar and "on the game's bar" or (db.dispLocked and "locked" or "unlocked")
	local parts = { NAMES[design] or design }
	if design ~= "none" then
		parts[#parts + 1] = where
		parts[#parts + 1] = holder and (holder:IsShown() and "shown" or "hidden") or "not made"
		parts[#parts + 1] = (rend and rend.frame.CreateLine) and "lines" or "squares"
		if ROUND[design] then
			local why
			if rend and rend.mode == "art" then why = "Blizzard art"
			elseif Look().flat then why = "flat (a drawn window style)"
			elseif rend and not (rend.quads or rend.frame.CreateLine) then why = "flat (no way to bend the art)"
			elseif not ArtSlices() then why = "flat (no atlas info)"
			else why = "flat (not drawn yet)" end
			parts[#parts + 1] = why
			parts[#parts + 1] = (rend and rend.quads) and "seamless strips" or "line strips"
		end
	end
	local alerts = {}
	for _, k in ipairs({ "warnMove", "lateText", "callout", "edge", "sound" }) do
		if db[k] then alerts[#alerts + 1] = k end
	end
	parts[#parts + 1] = "alerts: " .. (#alerts > 0 and table.concat(alerts, " ") or "none")
	return table.concat(parts, ", ")
end

---------------------------------------------------------------------------
-- The preview in the options: the chosen design on a made-up swing loop
---------------------------------------------------------------------------

-- Three shots: an ordinary one; one where the player moves into the wind-up (clipping) so the shot
-- comes late and the display holds; then one more, showing how late the last was. Then again.
local LATE = 0.6
local MOVE_FOR = 0.35
function ns.Simulate(s, now, start, dur, lead)
	local cycle = 3 * dur + LATE
	local loops = math.floor((now - start) / cycle)
	local T = (now - start) - loops * cycle
	s.dur, s.lead, s.autoRepeat = dur, lead, true
	s.moving, s.clipping, s.lateBy = false, false, nil
	local swing, t
	if T < dur then swing, t = 0, T
	elseif T < 2 * dur then swing, t = 1, T - dur
	elseif T < 2 * dur + LATE then swing = nil
	else swing, t = 2, T - 2 * dur - LATE end
	if swing then
		s.t, s.waiting, s.waitAge, s.waitKind = t, false, nil, nil
		s.parity = (loops * 3 + swing) % 2
		s.sinceShot = t
		s.lit = t >= dur - lead
		if swing == 1 and t >= dur - lead and t < dur - lead + MOVE_FOR then
			s.moving, s.clipping = true, true
		end
		if swing == 2 and t < 1.5 then s.lateBy = LATE end
	else
		s.t, s.waiting, s.waitAge, s.waitKind = nil, true, T - 2 * dur, "late"
		s.parity = (loops * 3 + 1) % 2
		s.sinceShot = nil
		s.lit = true
	end
	return s
end

function ns.NewPreview(parent, width, height)
	local box = CreateFrame("Frame", nil, parent)
	box:SetSize(width, height)
	local bg = box:CreateTexture(nil, "BACKGROUND", nil, -8)
	bg:SetAllPoints()
	bg:SetColorTexture(0, 0, 0, 0.35)
	local bands = EdgeBands(box, 14) -- the screen edge, in miniature
	local edgeKeyP
	local stage = CreateFrame("Frame", nil, box)
	stage:SetAllPoints()
	local r = ns.NewRenderer(stage)
	r.frame:SetPoint("CENTER", 0, -6)
	local say = stage:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
	say:SetPoint("TOP", 0, -6)
	local late = stage:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	late:SetPoint("BOTTOMRIGHT", -6, 6)
	local s, start = {}, nil
	box.renderer = r
	box:SetScript("OnUpdate", function()
		local db = ns.DB()
		if not db then return end
		local chosen = db.display or "none"
		local design = chosen == "none" and "classic" or chosen
		r:SetDesign(design)
		local w, h = ns.DisplaySize(db, design)
		if chosen == "none" then w, h = 200, 14 end -- the game bar's shape
		if w ~= r.w or h ~= r.h then r:SetSize(w, h) end
		local fit = math.min(1, (width - 20) / w, (height - 50) / h)
		if math.abs(r.frame:GetScale() - fit) > 0.001 then r.frame:SetScale(fit) end
		local now = GetTime()
		start = start or now
		local dur = (ns.WeaponSpeed and ns.WeaponSpeed()) or 2.8
		local lead = math.min(ns.Lead and ns.Lead() or 0.5, dur)
		ns.Simulate(s, now, start, dur, lead)
		if not db.warnMove then s.clipping = false end
		r:Draw(s, db)
		local text, c, a = CalloutText(s, db)
		if db.callout and text then
			say:SetText(text)
			say:SetTextColor(c[1], c[2], c[3], a)
			say:Show()
		else
			say:Hide()
		end
		if db.lateText and s.lateBy then
			late:SetText(("+%.2f"):format(s.lateBy))
			local cc = db.clipColor
			late:SetTextColor(cc[1], cc[2], cc[3])
			late:Show()
		else
			late:Hide()
		end
		local ec, ea = EdgeState(s, db)
		if db.edge and ec then
			local key = ec[1] .. ":" .. ec[2] .. ":" .. ec[3]
			if key ~= edgeKeyP then PaintEdge(bands, ec, 14) edgeKeyP = key end
			for _, band in ipairs(bands) do band.tex:SetAlpha(ea) band.tex:Show() end
		else
			for _, band in ipairs(bands) do band.tex:Hide() end
		end
	end)
	return box
end
