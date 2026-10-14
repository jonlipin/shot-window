-- Shot Window: marks when to stand still on the game's own ranged swing timer, for hunters' Auto
-- Shot and for wand users' Shoot (mages, priests, warlocks).
--
-- The game's bar (Blizzard_SwingTimer, frame SwingTimerRangedFrame) fills from 0 to 1 over the
-- ranged swing, restarted by PLAYER_SWING when the shot fires. The last part of the swing is the
-- shot's wind-up: moving then delays the shot. We listen to the same event, keep our own clock and
-- draw a red zone over that end of the bar's StatusBar, starting earlier by the round trip to the
-- server so a stop at the line reaches the server in time. When the shot is late the game's bar
-- empties anyway; we keep the zone lit until the shot is reported.
-- Nothing of Blizzard's is read back or changed; we only add textures to its StatusBar. The one
-- exception is a drawn window style (ShotWindow_Skins.lua), which empties the bar frame's own
-- background and border art so its flat look can show.
--
-- On Forever, Auto Shot fires during cast-time shots, so casts need no marker.

local ADDON, ns = ...

ns.VERSION = "0.3.0"

local RANGED = Enum and Enum.PlayerSwingType and Enum.PlayerSwingType.Ranged or 2
local RED = { 0.95, 0.20, 0.15 }

local DEFAULTS = {
	-- Timing
	window = 0.5,    -- seconds at the end of the swing when Auto Shot aims
	latency = true,  -- start the red zone earlier by world latency
	extraLead = 0,   -- milliseconds, on top of the latency
	hold = true,     -- keep the zone lit after the bar ends, until Auto Shot actually fires
	-- Red zone
	band = true,
	color = { RED[1], RED[2], RED[3] },
	idleAlpha = 0.35,
	flash = true,    -- brighten the red zone while the swing is inside it
	activeAlpha = 0.65,
	pulse = true,    -- pulse the zone while waiting for a late shot
	-- Marker line
	line = true,
	lineWidth = 2,
	lineColor = { RED[1], RED[2], RED[3] },
	-- Bar fill
	fillTint = false, -- turn the bar's fill red while the swing is inside the zone
	fillColor = { RED[1], RED[2], RED[3] },
	fillAlpha = 0.75,
	-- Alerts: the same on the game's bar and on every display
	warnMove = true,  -- the zone turns the clip color while you move inside it
	clipColor = { 1, 0.6, 0.1 },
	lateText = true,  -- "+0.42" after a shot that came late
	callout = false,  -- big "Stop" / "Moving" / "Late" / "Go" text
	calloutSize = 26,
	edge = false,     -- tint the screen's edges while you must stand still
	edgeSize = 90,
	sound = false,    -- a sound as the stand-still zone starts
	soundKit = 1,
	-- Display of our own (Displays.lua)
	display = "none",
	moveColor = { 0.39, 0.6, 0.13 },
	moveAccent = true, -- under the Dark and EllesmereUI styles, the move color is the style's accent
	dispWidth = 240,
	dispHeight = 16,
	dispSize = 140,
	dispThick = 12,
	artFlip = false, -- Blizzard art on the round designs drawn upside down (an in-game check; /shotwindow flipart)
	dispLocked = true,
	dispAlways = false,
	dispOnBar = false,
	scanMode = "pingpong", -- the scanner's spark: "pingpong" (out and back) or "wrap" (left to right)
	trackSeconds = 5,      -- seconds the rhythm track shows
	pipCount = 11,
	-- Look of the options window (Styles.lua)
	style = "auto",  -- "auto" (EllesmereUI when it is running), "blizzard" or "dark"
	darkAlpha = 0.92, -- background opacity of the Dark style
}

local db
ns.report = {} -- lines for /shotwindow debug; Styles.lua adds "skin" here
-- Before PLAYER_LOGIN (EllesmereUI hands its look over in its own PLAYER_LOGIN handler, which runs
-- first) the saved table is already loaded, only not yet topped up: the chosen style is in it.
function ns.DB() return db or (type(ShotWindowDB) == "table" and ShotWindowDB) or nil end
local bar            -- SwingTimerRangedFrame.StatusBar
local tex = {}       -- our textures on the bar
local swingDuration  -- seconds, from the last PLAYER_SWING
local swingStart     -- GetTime() at the last PLAYER_SWING, nil when idle
local standFrom      -- seconds into the swing where the red zone starts
local inside         -- whether the swing is inside the red zone, to change looks only on crossing
local autoRepeat     -- whether Auto Shot is on (START/STOP_AUTOREPEAT_SPELL)
local waitingSince   -- GetTime() when we began waiting for a shot the bar no longer shows, or nil
local waitUntil      -- GetTime() after which we stop waiting; pushed back while the shot keeps retrying
local RefreshOptions -- set by the options code below
local moving = false -- PLAYER_STARTED_MOVING / PLAYER_STOPPED_MOVING
local lastShotAt     -- GetTime() of the last ranged PLAYER_SWING
local shotCount = 0  -- shots seen, for designs that alternate sides
local lastLateBy     -- how late the last shot was, in seconds, or nil
local waitKind       -- "late" when the bar ran out before the shot, "first" for the first shot's wind-up

-- The auto-repeating ranged attack each class has: Auto Shot for hunters, Shoot for wand users.
local SHOT_SPELL = { HUNTER = 75, MAGE = 5019, PRIEST = 5019, WARLOCK = 5019 }
local shotSpell -- set at login
local WAIT_GRACE = 0.15 -- a shot is reported up to ~0.1 s after the bar ends; pulse only after this
local WAIT_CAP = 5      -- stop waiting this long after the last sign of a pending shot

local function Secret(v)
	return issecretvalue and issecretvalue(v)
end

local function Print(msg)
	DEFAULT_CHAT_FRAME:AddMessage("|cff7fd0ffShot Window|r " .. msg)
end

local function Copy(v)
	if type(v) ~= "table" then return v end
	local t = {}
	for k, x in pairs(v) do t[k] = Copy(x) end
	return t
end

local function CopyDefaults(dst, src)
	for k, v in pairs(src) do
		if dst[k] == nil then dst[k] = Copy(v) end
	end
	return dst
end

-- UnitAttackSpeed is secret while unit stats are restricted; check before touching the value.
local function WeaponSpeed()
	local ok, _, _, ranged = pcall(UnitAttackSpeed, "player")
	if not ok or Secret(ranged) or type(ranged) ~= "number" then return nil end
	if ranged > 0 then return ranged end
end

-- World latency is a round trip: the bar starts half of it late, and a stop takes the other half
-- to reach the server.
local function Latency()
	if not db.latency or not GetNetStats then return 0 end
	local _, _, home, world = GetNetStats()
	local ms = world or home
	if Secret(ms) or type(ms) ~= "number" or ms <= 0 then return 0 end
	return ms / 1000
end

local function Lead()
	return math.max(0, db.window + Latency() + (db.extraLead or 0) / 1000)
end

---------------------------------------------------------------------------
-- Drawing on the game's bar
---------------------------------------------------------------------------

local function CreateTextures()
	-- ARTWORK sits above Blizzard's fill (ARTWORK 0) and below its OVERLAY pip and labels.
	tex.stand = bar:CreateTexture(nil, "ARTWORK", nil, 6)
	tex.stand:Hide()
	tex.line = bar:CreateTexture(nil, "ARTWORK", nil, 7)
	tex.line:Hide()
	-- A red copy of the fill, laid exactly over Blizzard's fill texture so it follows the fill edge
	-- the way Blizzard's own pip does. Blizzard's fill itself is never touched.
	tex.fill = bar:CreateTexture(nil, "ARTWORK", nil, 5)
	tex.fill:Hide()
	local fill = bar.GetStatusBarTexture and bar:GetStatusBarTexture()
	if fill then tex.fill:SetAllPoints(fill) end
	-- "+0.42" above the bar's end after a late shot (only while no display of our own shows it).
	tex.late = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	tex.late:SetPoint("BOTTOMRIGHT", bar, "TOPRIGHT", 0, 2)
	tex.late:Hide()
end

local LATE_SHOWN = 1.5 -- seconds a late shot's delay stays up

local function LateTextOnBar(now)
	if not tex.late then return end
	local show = db.lateText and (db.display or "none") == "none" and lastLateBy and lastShotAt
		and now - lastShotAt < LATE_SHOWN
	if show then
		local c = db.clipColor
		tex.late:SetText(("+%.2f"):format(lastLateBy))
		tex.late:SetTextColor(c[1], c[2], c[3])
		tex.late:Show()
	else
		tex.late:Hide()
	end
end

-- The zone lights up only while Auto Shot is on. Unknown (no event seen and no way to ask)
-- counts as on, so the zone still brightens if the client never tells us.
local function Lit()
	return inside and autoRepeat ~= false
end

-- Moving during the wind-up delays the shot: the zone says so in the clip color.
local function Clipping()
	return Lit() and moving and db.warnMove and true or false
end

-- Colors follow the settings and whether the swing is inside the zone.
local function ApplyLook()
	if not tex.stand then return end
	local lit = Lit()
	local c = Clipping() and db.clipColor or db.color
	local a = (lit and db.flash) and db.activeAlpha or db.idleAlpha
	tex.stand:SetColorTexture(c[1], c[2], c[3], a)
	local l = db.lineColor
	tex.line:SetColorTexture(l[1], l[2], l[3], 0.95)
	local f = Clipping() and db.clipColor or db.fillColor
	tex.fill:SetColorTexture(f[1], f[2], f[3], db.fillAlpha)
	tex.fill:SetShown(lit and db.fillTint and true or false)
end

local function SetInside(on)
	if inside == on then return end
	inside = on
	ApplyLook()
end

local function HideZone()
	tex.stand:Hide()
	tex.line:Hide()
end

local function Layout()
	if not bar or not tex.stand then return end
	local dur = swingDuration or WeaponSpeed()
	local width = bar:GetWidth()
	if not dur or Secret(width) or type(width) ~= "number" or width <= 0 then
		HideZone()
		return
	end

	local from = math.max(0, dur - Lead())
	if from >= dur then -- no zone at all
		HideZone()
		return
	end
	local x = from / dur * width

	local s = tex.stand
	if db.band then
		s:ClearAllPoints()
		s:SetPoint("TOPLEFT", bar, "TOPLEFT", x, 0)
		s:SetPoint("BOTTOMLEFT", bar, "BOTTOMLEFT", x, 0)
		s:SetWidth(math.max(1, width - x))
		s:Show()
	else
		s:Hide()
	end

	local l = tex.line
	if db.line and x > 0 then
		-- Never thinner than one physical pixel when Edit Mode scales the bar down.
		local w = db.lineWidth
		if PixelUtil and PixelUtil.GetNearestPixelSize then
			w = PixelUtil.GetNearestPixelSize(w, bar:GetEffectiveScale(), 1)
		end
		l:ClearAllPoints()
		l:SetPoint("TOP", bar, "TOPLEFT", x, 0)
		l:SetPoint("BOTTOM", bar, "BOTTOMLEFT", x, 0)
		l:SetWidth(w)
		l:Show()
	else
		l:Hide()
	end
end

local driver = CreateFrame("Frame")

---------------------------------------------------------------------------
-- Our clock. The game's bar clears itself the moment its time runs out, even
-- when the shot is late (the hunter kept moving, or the server is retrying), so
-- after the bar ends we keep the zone lit until the shot is actually reported.
---------------------------------------------------------------------------

local OnUpdate

local function BeginWait(kind)
	waitKind = kind or "late"
	waitingSince = GetTime()
	waitUntil = waitingSince + WAIT_CAP
	Layout() -- the first shot's wait may come before anything drew the zone
	inside = nil -- force the lit look
	SetInside(true)
	driver:SetScript("OnUpdate", OnUpdate)
end

-- The clock stops ticking when nothing runs, unless a late readout still has to be taken down.
local function KeepTicking() return tex.late and tex.late:IsShown() end

local function StopWaiting()
	if not waitingSince then return end
	waitingSince, waitKind = nil, nil
	if tex.stand then tex.stand:SetAlpha(1) end
	SetInside(false)
	if not swingStart and not KeepTicking() then driver:SetScript("OnUpdate", nil) end
end

OnUpdate = function()
	local now = GetTime()
	LateTextOnBar(now)
	if swingStart then
		local elapsed = now - swingStart
		if elapsed < swingDuration then
			SetInside(elapsed >= standFrom)
			return
		end
		swingStart = nil
		if db.hold and autoRepeat == true and tex.stand then
			BeginWait("late")
			return
		end
		SetInside(false)
		if not KeepTicking() then driver:SetScript("OnUpdate", nil) end
		return
	end
	if waitingSince then
		local t = now - waitingSince
		if now >= waitUntil then
			StopWaiting()
		elseif db.pulse and t >= WAIT_GRACE then
			tex.stand:SetAlpha(0.6 + 0.4 * math.cos((t - WAIT_GRACE) * math.pi * 2.5))
		end
		return
	end
	if not KeepTicking() then driver:SetScript("OnUpdate", nil) end
end

local function StartSwing(duration)
	StopWaiting()
	swingDuration = duration
	swingStart = GetTime()
	standFrom = duration - Lead()
	Layout()
	SetInside(false)
	driver:SetScript("OnUpdate", OnUpdate)
end

local function AskSpell(fn)
	if not fn then return nil end
	local ok, v = pcall(fn, shotSpell)
	if not ok or Secret(v) or type(v) ~= "boolean" then return nil end
	return v
end

-- Auto Shot (or wand Shoot) on or off; nil means we cannot tell. C_Spell.IsAutoRepeatSpell is what
-- Blizzard's own Forever Shoot button reads as the live state (HostileTargetingActionBar.lua), so
-- its answer counts both ways. IsCurrentSpell only means cast or queued, so only its yes counts.
local function ReadAutoRepeat()
	local cs = C_Spell
	if not cs then return nil end
	local on = AskSpell(cs.IsAutoRepeatSpell)
	if on ~= nil then return on end
	if AskSpell(cs.IsCurrentSpell) == true then return true end
	return nil
end

-- false only when the game says the target is out of range of the shot; nil when it cannot tell.
local function ShotInRange()
	local inRange = C_Spell and C_Spell.IsSpellInRange
	if not inRange then return nil end
	local ok, v = pcall(inRange, shotSpell, "target")
	if not ok or Secret(v) or type(v) ~= "boolean" then return nil end
	return v
end

-- Signs that a shot is still due though no swing is running: the player stopped moving, or the
-- server retried the shot. Start a wait, or push back the end of the one that is running.
local function ShotPending()
	if autoRepeat ~= true or swingStart or not db.hold or not tex.stand then return end
	if ShotInRange() == false then return end -- standing still will not bring this shot
	if waitingSince then
		waitUntil = GetTime() + WAIT_CAP
	else
		BeginWait("late")
	end
end

local function SetAutoRepeat(on)
	autoRepeat = on
	if on then
		-- No swing running: the first shot's wind-up comes next, so stand still now.
		if not swingStart and not waitingSince and db.hold and tex.stand then
			BeginWait("first")
			return
		end
	else
		StopWaiting()
	end
	ApplyLook()
end

-- After any settings change: zone start, looks and layout.
local function ApplySettings()
	if swingStart then standFrom = swingDuration - Lead() end
	if waitingSince and not db.hold then StopWaiting() end
	if tex.stand and not (waitingSince and db.pulse) then tex.stand:SetAlpha(1) end
	ApplyLook()
	Layout()
	if ns.ApplyDisplay then ns.ApplyDisplay() end
	if RefreshOptions then RefreshOptions() end
end

local function OnSwing(duration, swingType)
	if Secret(duration) or Secret(swingType) then return end
	if swingType ~= RANGED or type(duration) ~= "number" or duration <= 0 then return end
	local now = GetTime()
	-- Late when the bar had already run out and we were holding for this shot.
	lastLateBy = (waitingSince and waitKind == "late") and (now - waitingSince) or nil
	if lastLateBy and lastLateBy < 0.1 then lastLateBy = nil end -- the usual report jitter
	lastShotAt = now
	shotCount = shotCount + 1
	StartSwing(duration)
	LateTextOnBar(now)
end

-- What the clock says, for the displays and the alerts (Displays.lua). s is reused.
ns.WeaponSpeed = WeaponSpeed
function ns.Lead() return db and Lead() or 0.5 end
function ns.HasShot() return shotSpell ~= nil end
function ns.ClockState(s)
	if not db then return nil end
	local now = GetTime()
	s.dur = swingDuration or WeaponSpeed()
	s.lead = Lead()
	s.autoRepeat = autoRepeat
	s.parity = shotCount % 2
	if swingStart then
		s.t = math.min(now - swingStart, swingDuration)
		s.waiting, s.waitAge, s.waitKind = false, nil, nil
	elseif waitingSince then
		s.t = nil
		s.waiting, s.waitAge, s.waitKind = true, now - waitingSince, waitKind
	else
		s.t, s.waiting, s.waitAge, s.waitKind = nil, false, nil, nil
	end
	s.lit = Lit() and true or false
	s.moving = moving
	s.clipping = Clipping()
	s.sinceShot = lastShotAt and (now - lastShotAt) or nil
	s.lateBy = (lastLateBy and s.sinceShot and s.sinceShot < LATE_SHOWN) and lastLateBy or nil
	return s
end

local function Attach()
	if bar then return true end
	local frame = _G.SwingTimerRangedFrame
	local statusBar = frame and frame.StatusBar
	if not statusBar then return false end
	bar = statusBar
	CreateTextures()
	bar:HookScript("OnSizeChanged", Layout)
	inside = false
	ApplyLook()
	Layout()
	if ns.SkinSwingBars then ns.SkinSwingBars() end -- the flat look, when a window style is drawn
	return true
end

---------------------------------------------------------------------------
-- Options: one content frame, shown on the Options > AddOns > Shot Window
-- canvas page, or in a standalone window when the game will not show it.
-- Canvas page only: proxy settings tainted Blizzard's UI on WoW Forever.
---------------------------------------------------------------------------

local optionRefreshers = {}
local content, window, settingsPage, settingsCategory
local windowContent -- the window's own copy of the controls, made while a style is drawn
local nativeOpenFailed, toldToClose = false, false
local optionsReport = {} -- printed by /shotwindow debug
local TAB_H = 30 -- the row of tabs above the pages
local W, CONTENT_H = 600, 532 + TAB_H
local PAGE_H = CONTENT_H - TAB_H
local currentTab = 1
local COL, LEFT, RIGHT = 290, 8, 304
local sliderCount = 0

local function TryCreate(kind, name, parent, templates)
	for _, template in ipairs(templates) do
		local ok, made = pcall(CreateFrame, kind, name, parent, template)
		if ok and made then return made, template end
	end
	return CreateFrame(kind, name, parent), "bare"
end

-- A button with no template: color textures and our own label (Interface\Buttons art does not
-- render on this client).
local function DressBare(b, w, h, label)
	b:SetSize(w, h)
	local bg = b:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	bg:SetColorTexture(0.25, 0.25, 0.3, 0.9)
	local hl = b:CreateTexture(nil, "HIGHLIGHT")
	hl:SetAllPoints()
	hl:SetColorTexture(1, 1, 1, 0.15)
	local fs = b:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	fs:SetPoint("CENTER")
	b:SetFontString(fs)
	b:SetText(label)
end

-- Grays out a control whose setting does nothing right now (its checkbox is off).
local function SetUsable(frame, on)
	frame:SetAlpha(on and 1 or 0.45)
	frame:EnableMouse(on)
end

RefreshOptions = function()
	if not ((content and content:IsVisible()) or (windowContent and windowContent:IsVisible())) then return end
	for _, refresh in ipairs(optionRefreshers) do refresh() end
end

-- Each copy of the controls lists its pieces, for the window styles (ShotWindow_Skins.lua).
local function Keep(parent, kind, part)
	local list = parent.swParts[kind]
	list[#list + 1] = part
end

local function Header(parent, text, x, y)
	local h = parent:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
	h:SetPoint("TOPLEFT", x + 4, y)
	h:SetText(text)
	local rule = parent:CreateTexture(nil, "ARTWORK")
	rule:SetColorTexture(1, 0.82, 0, 0.25)
	rule:SetPoint("TOPLEFT", x + 4, y - 20)
	rule:SetSize(COL - 20, 1)
	Keep(parent, "headers", { text = h, rule = rule })
	return y - 28
end

-- enabled(), when given, grays the control out while it returns false.
local function OptionCheck(parent, label, key, x, y, enabled)
	local cb, used = TryCreate("CheckButton", nil, parent, { "UICheckButtonTemplate", "ChatConfigCheckButtonTemplate" })
	optionsReport.check = used
	if used == "bare" then -- color textures only: Interface\Buttons art does not render here
		local box = cb:CreateTexture(nil, "BACKGROUND")
		box:SetAllPoints()
		box:SetColorTexture(0, 0, 0, 0.6)
		local mark = cb:CreateTexture(nil, "ARTWORK")
		mark:SetPoint("TOPLEFT", 5, -5)
		mark:SetPoint("BOTTOMRIGHT", -5, 5)
		mark:SetColorTexture(1, 0.82, 0, 1)
		cb:SetCheckedTexture(mark)
	end
	cb:SetSize(24, 24)
	cb:SetPoint("TOPLEFT", x, y)
	local fs = cb:CreateFontString(nil, "OVERLAY", "GameFontHighlight") -- the templates disagree about where theirs lives
	fs:SetPoint("LEFT", cb, "RIGHT", 2, 0)
	fs:SetText(label)
	cb:SetHitRectInsets(0, -(fs:GetStringWidth() + 2), 0, 0) -- the label clicks too
	Keep(parent, "checks", { button = cb, label = fs })
	cb:SetScript("OnClick", function(self)
		db[key] = self:GetChecked() and true or false
		ApplySettings()
	end)
	optionRefreshers[#optionRefreshers + 1] = function()
		cb:SetChecked(db[key] and true or false)
		if enabled then SetUsable(cb, enabled()) end
	end
	return y - 28
end

-- Sliders run in whole numbers (milliseconds, percent) to avoid float noise. get() gives the
-- slider value from db, set(v) stores it, fmt(v) is the label.
local function OptionSlider(parent, label, x, y, minV, maxV, step, get, set, fmt, enabled)
	sliderCount = sliderCount + 1
	local name = "ShotWindowOptionsSlider" .. sliderCount
	local holder = CreateFrame("Frame", nil, parent)
	holder:SetPoint("TOPLEFT", x + 4, y)
	holder:SetSize(COL - 20, 40)
	local caption = holder:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("TOPLEFT", 0, 0)
	caption:SetText(label)
	local value = holder:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	value:SetPoint("TOPRIGHT", 0, -1)
	local slider, used = TryCreate("Slider", name, holder, { "MinimalSliderTemplate", "UISliderTemplate", "OptionsSliderTemplate" })
	optionsReport.slider = used
	for _, suffix in ipairs({ "Low", "High", "Text" }) do -- OptionsSliderTemplate's own labels
		local extra = _G[name .. suffix]
		if extra then extra:SetText("") extra:Hide() end
	end
	if used == "bare" then
		local track = slider:CreateTexture(nil, "BACKGROUND")
		track:SetPoint("LEFT")
		track:SetPoint("RIGHT")
		track:SetHeight(6)
		track:SetColorTexture(0, 0, 0, 0.6)
		local thumb = slider:CreateTexture(nil, "OVERLAY")
		thumb:SetSize(10, 16)
		thumb:SetColorTexture(1, 0.82, 0, 1)
		slider:SetThumbTexture(thumb)
	end
	if slider.SetOrientation then slider:SetOrientation("HORIZONTAL") end
	slider:SetPoint("TOPLEFT", 2, -18)
	slider:SetSize(COL - 26, 18)
	slider:SetMinMaxValues(minV, maxV) -- before the script: clamping fires OnValueChanged
	if slider.SetValueStep then slider:SetValueStep(step) end
	if slider.SetObeyStepOnDrag then pcall(slider.SetObeyStepOnDrag, slider, true) end
	Keep(parent, "sliders", { slider = slider, caption = caption, value = value })
	slider:SetScript("OnValueChanged", function(self, v)
		v = minV + math.floor((v - minV) / step + 0.5) * step -- steps counted from the low end (odd pip counts)
		value:SetText(fmt(v))
		if self.syncing then return end -- our own SetValue, not the player
		set(v)
		ApplySettings()
	end)
	optionRefreshers[#optionRefreshers + 1] = function()
		local v = get()
		slider.syncing = true
		slider:SetValue(v)
		slider.syncing = false
		value:SetText(fmt(v)) -- from db, so a value outside the slider range still reads true
		if enabled then
			local on = enabled()
			holder:SetAlpha(on and 1 or 0.45)
			slider:EnableMouse(on)
		end
	end
	return y - 46, holder, slider
end

local function Percent(key)
	return function() return math.floor((db[key] or 0) * 100 + 0.5) end,
		function(v) db[key] = v / 100 end,
		function(v) return v .. "%" end
end

-- Forever loads the retail-style color picker: SetupColorPickerAndShow with swatchFunc, and
-- GetColorRGB. A click outside it cancels, which restores the color it opened with.
local function OpenColorPicker(color, apply)
	local picker = ColorPickerFrame
	if not (picker and picker.SetupColorPickerAndShow and picker.GetColorRGB) then return false end
	local r0, g0, b0 = color[1], color[2], color[3]
	local opening = true
	local function FromPicker()
		if opening then return end -- fired by its own SetColorRGB while it sets up
		local r, g, b = picker:GetColorRGB()
		if type(r) == "number" and type(g) == "number" and type(b) == "number" then apply(r, g, b) end
	end
	if picker:IsShown() then picker:Hide() end
	local ok = pcall(picker.SetupColorPickerAndShow, picker, {
		r = r0, g = g0, b = b0,
		hasOpacity = false,
		swatchFunc = FromPicker, -- Okay calls it unguarded, so never nil
		cancelFunc = function() apply(r0, g0, b0) end,
	})
	opening = false
	return ok
end

local function OptionColor(parent, label, key, x, y, enabled)
	local ok, swatch = pcall(CreateFrame, "Button", nil, parent, "ColorSwatchTemplate")
	if not ok or not swatch then -- the same look from color textures
		swatch = CreateFrame("Button", nil, parent)
		swatch:SetSize(16, 16)
		local function Square(sub, size, r, g, b)
			local t = swatch:CreateTexture(nil, "BACKGROUND", nil, sub)
			t:SetPoint("CENTER")
			t:SetSize(size, size)
			t:SetColorTexture(r, g, b)
			return t
		end
		swatch.SwatchBg = Square(-3, 14, 1, 1, 1)
		swatch.InnerBorder = Square(-2, 12, 0, 0, 0)
		swatch.Color = Square(-1, 10, 1, 1, 1)
	end
	optionsReport.swatch = ok and "ColorSwatchTemplate" or "bare"
	swatch:SetPoint("TOPLEFT", x + 4, y - 4) -- centered under the checkboxes, label in line with theirs
	swatch:RegisterForClicks("LeftButtonUp")
	local fs = swatch:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
	fs:SetPoint("LEFT", swatch, "RIGHT", 6, 0)
	fs:SetText(label)
	swatch:SetHitRectInsets(0, -(fs:GetStringWidth() + 6), -4, -4) -- the label clicks too
	Keep(parent, "texts", fs)
	local function Paint()
		local c = db[key]
		swatch.Color:SetVertexColor(c[1], c[2], c[3])
		if enabled then SetUsable(swatch, enabled()) end
	end
	swatch:SetScript("OnClick", function()
		local c = db[key]
		local opened = OpenColorPicker(c, function(r, g, b)
			c[1], c[2], c[3] = r, g, b
			Paint()
			ApplySettings()
		end)
		optionsReport.picker = opened and "opened" or "unavailable"
		if not opened then Print("this client would not open the color picker.") end
	end)
	optionRefreshers[#optionRefreshers + 1] = Paint
	return y - 28
end

local function ResetDefaults()
	for k, v in pairs(DEFAULTS) do db[k] = Copy(v) end
	local Styles = ns.Styles
	if Styles then
		Styles.SetDarkAlpha(db.darkAlpha)
		Styles.Changed() -- offers a reload if the style drawn now is no longer the chosen one
	end
	ApplySettings()
	Print("settings reset to the defaults")
end

local function Is(key) return function() return db[key] and true or false end end

local function Tooltip(frame, title, lines)
	frame:SetScript("OnEnter", function(self)
		if not GameTooltip then return end
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(title, 1, 1, 1)
		for _, line in ipairs(lines()) do GameTooltip:AddLine(line[1], line[2], line[3], line[4], true) end
		GameTooltip:Show()
	end)
	frame:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
end

-- The window style (Styles.lua): a button that steps through the styles, a line saying what is
-- in use, and the Dark style's opacity, grayed out for the other styles.
local function OptionStyle(parent, x, y)
	local button, used = TryCreate("Button", nil, parent, { "UIPanelButtonTemplate" })
	if used == "bare" then DressBare(button, 200, 22, "") else button:SetSize(200, 22) end
	button:SetPoint("TOPLEFT", x + 4, y)
	button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	button:SetScript("OnClick", function(_, which)
		if ns.Styles then ns.Styles.Cycle(which == "RightButton" and -1 or 1) end
		RefreshOptions()
	end)
	Tooltip(button, "Window style", function()
		local lines = {}
		for _, text in ipairs(ns.Styles and ns.Styles.HELP or {}) do lines[#lines + 1] = { text } end
		lines[#lines + 1] = { "Left-click for the next style, right-click for the previous one.", 0.6, 0.6, 0.6 }
		return lines
	end)
	Keep(parent, "buttons", button)
	local note = parent:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	note:SetPoint("TOPLEFT", x + 4, y - 26)
	note:SetWidth(COL - 20)
	note:SetJustifyH("LEFT")
	Keep(parent, "texts", note)
	optionRefreshers[#optionRefreshers + 1] = function()
		local Styles = ns.Styles
		button:SetText("Window style: " .. (Styles and Styles.Name(db.style) or "Blizzard"))
		note:SetText(Styles and Styles.Note() or "")
	end
	local after, holder, slider = OptionSlider(parent, "Dark background opacity", x, y - 54, 0, 100, 5,
		function() return math.floor((db.darkAlpha or 0) * 100 + 0.5) end,
		function(v)
			db.darkAlpha = v / 100
			if ns.Styles then ns.Styles.SetDarkAlpha(db.darkAlpha) end
		end,
		function(v) return v .. "%" end,
		function() return db.style == "dark" end)
	holder:EnableMouse(true) -- the tooltip still shows while the slider is grayed out
	Tooltip(holder, "Dark background opacity", function()
		local lines = { { "How much of the world shows through the Dark style's windows." } }
		if db.style ~= "dark" then lines[2] = { "Applies to the Dark style only.", 1, 0.82, 0 } end
		return lines
	end)
	slider:HookScript("OnEnter", function() holder:GetScript("OnEnter")(holder) end)
	slider:HookScript("OnLeave", function() holder:GetScript("OnLeave")(holder) end)
	return after
end

local BuildFooter -- the row along the bottom, below

-- A button that steps through choices: left click forward, right click back.
local function OptionCycle(parent, x, y, width, label, step, enabled, tip)
	local button, used = TryCreate("Button", nil, parent, { "UIPanelButtonTemplate" })
	if used == "bare" then DressBare(button, width, 22, "") else button:SetSize(width, 22) end
	button:SetPoint("TOPLEFT", x + 4, y)
	button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	button:SetScript("OnClick", function(_, which)
		step(which == "RightButton" and -1 or 1)
		ApplySettings()
	end)
	if tip then
		Tooltip(button, tip[1], function()
			local lines = {}
			for i = 2, #tip do lines[#lines + 1] = { tip[i] } end
			lines[#lines + 1] = { "Left-click for the next, right-click for the previous.", 0.6, 0.6, 0.6 }
			return lines
		end)
	end
	Keep(parent, "buttons", button)
	optionRefreshers[#optionRefreshers + 1] = function()
		button:SetText(label())
		if enabled then SetUsable(button, enabled()) end
	end
	return y - 28, button
end

local function OptionButton(parent, x, y, width, text, onClick, enabled)
	local button, used = TryCreate("Button", nil, parent, { "UIPanelButtonTemplate" })
	if used == "bare" then DressBare(button, width, 22, text) else button:SetSize(width, 22) button:SetText(text) end
	button:SetPoint("TOPLEFT", x + 4, y)
	button:SetScript("OnClick", onClick)
	Keep(parent, "buttons", button)
	if enabled then optionRefreshers[#optionRefreshers + 1] = function() SetUsable(button, enabled()) end end
	return y - 28, button
end

-- A line of grey text that a function keeps up to date.
local function OptionNote(parent, x, y, width, text)
	local note = parent:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	note:SetPoint("TOPLEFT", x + 4, y)
	note:SetWidth(width)
	note:SetJustifyH("LEFT")
	Keep(parent, "texts", note)
	optionRefreshers[#optionRefreshers + 1] = function() note:SetText(text()) end
	return note
end

local function Step(list, current, step)
	local index = 1
	for i, v in ipairs(list) do if v == current then index = i end end
	return list[(index - 1 + step) % #list + 1]
end

local function Preview(parent, x, y)
	if not ns.NewPreview then return y end
	local box = ns.NewPreview(parent, COL - 20, 150)
	box:SetPoint("TOPLEFT", x + 4, y)
	local caption = parent:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	caption:SetPoint("TOPLEFT", x + 4, y - 154)
	caption:SetWidth(COL - 20)
	caption:SetJustifyH("LEFT")
	caption:SetText("A made-up loop: an ordinary shot, one you move into (clipping, so it comes late and the display holds), then one more.")
	Keep(parent, "texts", caption)
	return y - 186
end

local function Design() return db.display or "none" end
local function HasDisplay() return Design() ~= "none" end
local function IsRound() return ns.ROUND_DISPLAYS and ns.ROUND_DISPLAYS[Design()] or false end

local function BuildDisplayPage(p)
	local y = Header(p, "Display", LEFT, -4)
	y = OptionCycle(p, LEFT, y, 260, function()
		return "Design: " .. ((ns.DISPLAY_NAMES or {})[Design()] or Design())
	end, function(step)
		db.display = Step(ns.DISPLAYS or { "none" }, Design(), step)
	end, nil, { "Design", "A display of its own, besides the marks on the game's bar.",
		"Every design shows the same things: when to move and when to stand still, the hold for a late shot, clipping, and the shot itself." })
	OptionNote(p, LEFT, y, COL - 20, function() return (ns.DISPLAY_NOTES or {})[Design()] or "" end)
	y = y - 36
	y = OptionCheck(p, "Lock in place", "dispLocked", LEFT, y, function() return HasDisplay() and not db.dispOnBar end)
	y = OptionButton(p, LEFT, y, 140, "Reset position", function()
		db.dispPos = nil
		ApplySettings()
	end, function() return HasDisplay() and not db.dispOnBar end)
	y = OptionCheck(p, "Sit on the game's swing bar", "dispOnBar", LEFT, y, HasDisplay)
	y = OptionCheck(p, "Show out of combat too", "dispAlways", LEFT, y, HasDisplay)
	y = Header(p, "Size", LEFT, y - 8)
	local function Straight() return HasDisplay() and not IsRound() end
	local function Round() return HasDisplay() and IsRound() end
	y = OptionSlider(p, "Length", LEFT, y, 80, 600, 10,
		function() return db.dispWidth end, function(v) db.dispWidth = v end,
		function(v) return v .. " px" end, Straight)
	y = OptionSlider(p, "Thickness of a bar", LEFT, y, 4, 60, 1,
		function() return db.dispHeight end, function(v) db.dispHeight = v end,
		function(v) return v .. " px" end, Straight)
	y = OptionSlider(p, "Size of a round design", LEFT, y, 60, 400, 5,
		function() return db.dispSize end, function(v) db.dispSize = v end,
		function(v) return v .. " px" end, Round)
	OptionSlider(p, "Line thickness of a round design", LEFT, y, 2, 30, 1,
		function() return db.dispThick end, function(v) db.dispThick = v end,
		function(v) return v .. " px" end, Round)

	y = Header(p, "Preview", RIGHT, -4)
	y = Preview(p, RIGHT, y)
	y = Header(p, "Design options", RIGHT, y)
	y = OptionCycle(p, RIGHT, y, 260, function()
		return "Scanner: " .. (db.scanMode == "wrap" and "left to right" or "out and back")
	end, function()
		db.scanMode = (db.scanMode == "wrap") and "pingpong" or "wrap"
	end, function() return Design() == "scanner" end, { "Scanner sweep",
		"Out and back: the spark crosses the shot line at each shot and turns at the ends.",
		"Left to right: the spark always crosses from left to right and wraps round." })
	y = OptionSlider(p, "Rhythm track: seconds shown", RIGHT, y - 4, 2, 12, 1,
		function() return db.trackSeconds end, function(v) db.trackSeconds = v end,
		function(v) return v .. " s" end, function() return Design() == "track" end)
	y = OptionSlider(p, "Pips: how many", RIGHT, y, 5, 21, 2,
		function() return db.pipCount end, function(v) db.pipCount = v end,
		function(v) return tostring(v) end, function() return Design() == "pips" end)
	y = OptionColor(p, "Move color", "moveColor", RIGHT, y, function() return not (db.moveAccent and ns.Styles and ns.Styles.S) end)
	y = OptionCheck(p, "Use the window style's accent for move", "moveAccent", RIGHT, y)
	OptionNote(p, RIGHT, y, COL - 20, function()
		local Styles = ns.Styles
		local name = Styles and Styles.Name(Styles.Applied() or "blizzard") or "Blizzard"
		return "Look: " .. name .. ". The window style (Zone tab, Look) styles the displays too."
	end)
end

local function BuildAlertsPage(p)
	local y = Header(p, "Clipping and late shots", LEFT, -4)
	y = OptionCheck(p, "Warn when I move inside the zone", "warnMove", LEFT, y)
	y = OptionColor(p, "Clip color", "clipColor", LEFT, y, function() return db.warnMove or db.lateText end)
	y = OptionCheck(p, "Show how late a late shot was", "lateText", LEFT, y)
	OptionNote(p, LEFT, y, COL - 20, function()
		return "Moving during the wind-up delays the shot. The warning shows on the game's bar and on every display; the delay shows above the bar or under the display."
	end)
	y = y - 44
	y = Header(p, "Call-out text", LEFT, y)
	y = OptionCheck(p, "Say Stop, Moving, Late and Go", "callout", LEFT, y)
	y = OptionSlider(p, "Text size", LEFT, y - 4, 14, 60, 2,
		function() return db.calloutSize end, function(v) db.calloutSize = v end,
		function(v) return v .. " pt" end, Is("callout"))
	y = Header(p, "Sound", LEFT, y)
	y = OptionCheck(p, "Play a sound as the zone starts", "sound", LEFT, y)
	OptionCycle(p, LEFT, y, 200, function()
		local list = ns.SOUNDS or {}
		local entry = list[db.soundKit] or list[1]
		return "Sound: " .. (entry and entry.name or "?")
	end, function(step)
		local n = #(ns.SOUNDS or {})
		if n > 0 then db.soundKit = ((db.soundKit or 1) - 1 + step) % n + 1 end
		if ns.PlayKit then ns.PlayKit(db.soundKit) end
	end, Is("sound"), { "Sound", "Plays once per swing as the stand-still zone starts.", "Clicking plays the new choice." })

	y = Header(p, "Preview", RIGHT, -4)
	y = Preview(p, RIGHT, y)
	y = Header(p, "Screen edge", RIGHT, y)
	y = OptionCheck(p, "Tint the screen's edges to stand still", "edge", RIGHT, y)
	OptionSlider(p, "Edge width", RIGHT, y - 4, 20, 300, 10,
		function() return db.edgeSize end, function(v) db.edgeSize = v end,
		function(v) return v .. " px" end, Is("edge"))
end

local function ShowTab(c, index)
	currentTab = index
	for i, page in ipairs(c.pages) do page:SetShown(i == index) end
	for i, tab in ipairs(c.tabs) do
		tab.swMark:SetShown(i == index)
		if tab.LockHighlight then
			if i == index then tab:LockHighlight() else tab:UnlockHighlight() end
		end
	end
	RefreshOptions()
end

local function BuildZonePage(c)

	local y = Header(c, "Timing", LEFT, -4)
	y = OptionSlider(c, "Aim window (the shot's wind-up)", LEFT, y, 0, 1000, 10,
		function() return math.floor(db.window * 1000 + 0.5) end,
		function(v) db.window = v / 1000 end,
		function(v) return ("%.2f s"):format(v / 1000) end)
	y = OptionCheck(c, "Start earlier by my latency", "latency", LEFT, y)
	y = OptionSlider(c, "Extra lead", LEFT, y - 4, 0, 300, 5,
		function() return db.extraLead end,
		function(v) db.extraLead = v end,
		function(v) return v .. " ms" end)
	y = OptionCheck(c, "Keep the zone lit until the shot fires", "hold", LEFT, y)
	local status = c:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	status:SetPoint("TOPLEFT", LEFT + 4, y - 2)
	status:SetWidth(COL - 20)
	status:SetJustifyH("LEFT")
	Keep(c, "texts", status)
	local function StatusText()
		return ("Red zone now: the last %.2f s (aim %.2f s + latency %d ms + extra %d ms)"):format(
			Lead(), db.window, math.floor(Latency() * 1000 + 0.5), math.floor((db.extraLead or 0) + 0.5))
	end
	optionRefreshers[#optionRefreshers + 1] = function() status:SetText(StatusText()) end
	local tick = 0
	c:SetScript("OnUpdate", function(_, dt) -- latency moves; only runs while the page is shown
		tick = tick + dt
		if tick >= 0.5 then
			tick = 0
			status:SetText(StatusText())
		end
	end)
	y = y - 40

	y = Header(c, "Marker line", LEFT, y)
	y = OptionCheck(c, "Show the marker line", "line", LEFT, y)
	y = OptionSlider(c, "Thickness", LEFT, y - 4, 1, 6, 1,
		function() return db.lineWidth end,
		function(v) db.lineWidth = v end,
		function(v) return v .. " px" end, Is("line"))
	y = OptionColor(c, "Line color", "lineColor", LEFT, y, Is("line"))

	y = Header(c, "Look", LEFT, y - 8)
	OptionStyle(c, LEFT, y)

	y = Header(c, "Red zone", RIGHT, -4)
	y = OptionCheck(c, "Show the red zone", "band", RIGHT, y)
	y = OptionColor(c, "Zone color", "color", RIGHT, y, Is("band"))
	local get, set, fmt = Percent("idleAlpha")
	y = OptionSlider(c, "Zone opacity", RIGHT, y - 4, 0, 100, 5, get, set, fmt, Is("band"))
	y = OptionCheck(c, "Brighten inside the zone", "flash", RIGHT, y, Is("band"))
	get, set, fmt = Percent("activeAlpha")
	y = OptionSlider(c, "Brightened opacity", RIGHT, y - 4, 0, 100, 5, get, set, fmt,
		function() return db.band and db.flash end)
	y = OptionCheck(c, "Pulse while waiting for a late shot", "pulse", RIGHT, y,
		function() return db.band and db.hold end)

	y = Header(c, "Bar fill", RIGHT, y - 8)
	y = OptionCheck(c, "Tint the fill inside the zone", "fillTint", RIGHT, y)
	y = OptionColor(c, "Fill color", "fillColor", RIGHT, y, Is("fillTint"))
	get, set, fmt = Percent("fillAlpha")
	OptionSlider(c, "Fill opacity", RIGHT, y - 4, 0, 100, 5, get, set, fmt, Is("fillTint"))
end

local function BuildContent()
	local c = CreateFrame("Frame")
	c:SetSize(W, CONTENT_H)
	c:Hide() -- a shown frame with no parent counts as visible
	c.swParts = { headers = {}, checks = {}, sliders = {}, buttons = {}, texts = {} }

	-- A class with no Auto Shot or wand Shoot gets the look and nothing else, and is told why.
	if not shotSpell then
		local why = c:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
		why:SetPoint("TOPLEFT", LEFT + 4, -4)
		why:SetWidth(W - 24)
		why:SetJustifyH("LEFT")
		why:SetText("This character has no Auto Shot or wand Shoot, so there is no stand-still zone. What applies here is the look: under the Dark or EllesmereUI window style, the game's swing timer bars are drawn flat.")
		Keep(c, "texts", why)
		OptionStyle(c, LEFT, Header(c, "Look", LEFT, -48))
		return BuildFooter(c, false)
	end

	-- Three pages under a row of tabs: the zone on the game's bar, the display, the alerts.
	c.pages, c.tabs = {}, {}
	for i, label in ipairs({ "Zone", "Display", "Alerts" }) do
		local tab, used = TryCreate("Button", nil, c, { "UIPanelButtonTemplate" })
		if used == "bare" then DressBare(tab, 110, 22, label) else tab:SetSize(110, 22) tab:SetText(label) end
		tab:SetPoint("TOPRIGHT", -(8 + (3 - i) * 116), -2) -- on the right, clear of the page title
		tab:SetScript("OnClick", function() ShowTab(c, i) end)
		local mark = c:CreateTexture(nil, "ARTWORK")
		mark:SetColorTexture(1, 0.82, 0, 0.9)
		mark:SetPoint("TOPLEFT", tab, "BOTTOMLEFT", 2, -1)
		mark:SetPoint("TOPRIGHT", tab, "BOTTOMRIGHT", -2, -1)
		mark:SetHeight(2)
		tab.swMark = mark
		Keep(c, "buttons", tab)
		c.tabs[i] = tab
		local page = CreateFrame("Frame", nil, c)
		page:SetPoint("TOPLEFT", 0, -TAB_H)
		page:SetSize(W, PAGE_H)
		page.swParts = c.swParts
		page:Hide()
		c.pages[i] = page
	end
	BuildZonePage(c.pages[1])
	BuildDisplayPage(c.pages[2])
	BuildAlertsPage(c.pages[3])
	ShowTab(c, currentTab)
	return BuildFooter(c, true)
end

-- The Defaults button along the bottom, and the color picker hint where there are colors.
function BuildFooter(c, colors)
	local reset, resetUsed = TryCreate("Button", nil, c, { "UIPanelButtonTemplate" })
	if resetUsed == "bare" then
		DressBare(reset, 110, 22, "Defaults")
	else
		reset:SetSize(110, 22)
		reset:SetText("Defaults")
	end
	reset:SetPoint("BOTTOMLEFT", LEFT + 4, 4)
	reset:SetScript("OnClick", ResetDefaults)
	Keep(c, "buttons", reset)
	if not colors then return c end
	local hint = c:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	hint:SetPoint("LEFT", reset, "RIGHT", 10, 0)
	hint:SetText("Color picker: press Okay to keep a color; clicking elsewhere cancels it.")
	Keep(c, "texts", hint)
	return c
end

local function EnsureContent()
	if content then return content end
	local ok, made = pcall(BuildContent)
	if not ok then
		Print("the options could not be built: " .. tostring(made))
		return nil
	end
	content = made
	return content
end

local function Host(controls, parent, x, y, scale)
	scale = scale or 1
	controls:SetParent(parent)
	controls:ClearAllPoints()
	controls:SetScale(scale)
	controls:SetPoint("TOPLEFT", parent, "TOPLEFT", x / scale, y / scale)
	controls:Show()
	RefreshOptions()
end

-- While a window style is drawn, the window shows a copy of the controls of its own to restyle,
-- so the controls on the game's Options page keep the game's look. nil while Blizzard's is used.
local function WindowContent()
	if not (ns.Styles and ns.Styles.S) then return nil end
	if not windowContent then
		local ok, made = pcall(BuildContent)
		if not ok then return nil end
		windowContent = made
		if ns.SkinContent then ns.SkinContent(made) end
	end
	return windowContent
end

local function BuildWindow()
	local f, template = TryCreate("Frame", "ShotWindowOptions", UIParent, { "ButtonFrameTemplate", "BasicFrameTemplateWithInset" })
	local top = template == "ButtonFrameTemplate" and -60 or -28
	f:SetSize(W, CONTENT_H - top + 10)
	f:SetPoint("CENTER")
	f:SetFrameStrata("HIGH") -- below the DIALOG color picker
	f:SetToplevel(true)
	f:SetMovable(true)
	f:EnableMouse(true)
	f:SetClampedToScreen(true)
	f:RegisterForDrag("LeftButton")
	f:SetScript("OnDragStart", f.StartMoving)
	f:SetScript("OnDragStop", f.StopMovingOrSizing)
	f:Hide()
	tinsert(UISpecialFrames, "ShotWindowOptions")
	if template == "bare" then
		local bg = f:CreateTexture(nil, "BACKGROUND")
		bg:SetAllPoints()
		bg:SetColorTexture(0.05, 0.05, 0.07, 0.95)
	end
	if f.SetTitle then
		f:SetTitle("Shot Window")
	elseif f.TitleContainer and f.TitleContainer.TitleText then
		f.TitleContainer.TitleText:SetText("Shot Window")
	elseif f.TitleText then
		f.TitleText:SetText("Shot Window")
	else -- no template title: our own
		local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		title:SetPoint("TOP", 0, -8)
		title:SetText("Shot Window")
	end
	if template == "ButtonFrameTemplate" then
		if ButtonFrameTemplate_HidePortrait then pcall(ButtonFrameTemplate_HidePortrait, f) end
		-- No buttons along the bottom: let the inset reach down past the Defaults row.
		if ButtonFrameTemplate_HideButtonBar then pcall(ButtonFrameTemplate_HideButtonBar, f) end
	end
	local close = f.CloseButton or _G.ShotWindowOptionsCloseButton
	if not close then
		local used
		close, used = TryCreate("Button", nil, f, { "UIPanelCloseButton" })
		if used == "bare" then
			DressBare(close, 20, 20, "x")
			close:SetPoint("TOPRIGHT", -4, -4)
		else
			close:SetPoint("TOPRIGHT", 2, 2)
		end
		f.swClose = close
	end
	-- The template's X runs HideUIPanel, which the game refuses in combat for an addon's window:
	-- hide it directly so the X works in combat too (OnHide still runs).
	if type(close) == "table" and close.SetScript then
		close:SetScript("OnClick", function() f:Hide() end)
	end
	f:SetScript("OnShow", function(self)
		local own = WindowContent()
		if own and content and content:GetParent() == self then content:Hide() end
		Host(own or content, self, 0, top)
	end)
	optionsReport.window = template
	if ns.SkinWindow then ns.SkinWindow(f) end
	return f
end

-- Open means panel shown AND page parented AND visible: a parentless page counts as visible.
local function PageOpen()
	return settingsPage ~= nil and SettingsPanel ~= nil and SettingsPanel:IsShown()
		and settingsPage:GetParent() ~= nil and settingsPage:IsVisible()
end

local function ToggleOptions()
	-- In combat the game refuses to open or close its options panel for an addon, so use our own
	-- window for now and keep trying the panel next time.
	local inCombat = InCombatLockdown and InCombatLockdown()
	if PageOpen() then
		-- Closing Blizzard's panel from addon code is protected here: a try, not a promise.
		if HideUIPanel and not inCombat then pcall(HideUIPanel, SettingsPanel) end
		if PageOpen() and not toldToClose then
			toldToClose = true
			Print("the options are open at Esc > Options > AddOns > Shot Window. Close them there.")
		end
		return
	end
	if window and window:IsShown() then
		window:Hide()
		return
	end
	if settingsCategory and Settings and Settings.OpenToCategory and not nativeOpenFailed and not inCombat then
		local id = settingsCategory.GetID and settingsCategory:GetID() or settingsCategory.ID
		if id then pcall(Settings.OpenToCategory, id) end -- the number, never the category object
		if PageOpen() then -- trust what is on screen, not the call's return value
			optionsReport.open = "options page"
			return
		end
		nativeOpenFailed = true
		optionsReport.open = "page did not open; using the window"
	end
	if not EnsureContent() then return end
	if not window then
		local ok, made = pcall(BuildWindow)
		if not ok then
			Print("the options window could not be built: " .. tostring(made))
			return
		end
		window = made
	end
	window:Show()
	if window.Raise then window:Raise() end
end

local function RegisterOptionsPage()
	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then return end
	local page = CreateFrame("Frame")
	page:Hide() -- Blizzard shows it when the page is picked
	local title = page:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
	title:SetPoint("TOPLEFT", 16, -16)
	title:SetText("Shot Window")
	page:SetScript("OnShow", function(self)
		if not EnsureContent() then return end
		if window and window:IsShown() then window:Hide() end
		-- With tabs, the tab row shares the line with the page title (tabs on the right), so the
		-- controls start higher and the page keeps its full size.
		local tabbed = content.pages ~= nil
		local top = tabbed and -10 or -42
		local w, h = self:GetWidth() or 0, self:GetHeight() or 0
		local scale = 1
		if w > 0 and h > 0 then scale = math.min(1, (w - 12) / W, (h + top - 8) / CONTENT_H) end
		Host(content, self, 6, top, scale)
	end)
	page:SetScript("OnSizeChanged", function(self)
		if self:IsVisible() and content and content:GetParent() == self then self:GetScript("OnShow")(self) end
	end)
	local category = Settings.RegisterCanvasLayoutCategory(page, "Shot Window")
	if category then
		Settings.RegisterAddOnCategory(category)
		settingsPage, settingsCategory = page, category
		optionsReport.page = "registered"
	end
end

---------------------------------------------------------------------------
-- Slash command and events
---------------------------------------------------------------------------

local function Debug()
	Print("version " .. ns.VERSION)
	if not shotSpell then Print("no stand-still zone on this character (no Auto Shot or wand Shoot): only the look applies") end
	Print("bar found: " .. tostring(bar ~= nil) .. ", showSwingTimer: " .. tostring(GetCVar and GetCVar("showSwingTimer")))
	Print(("swing: %s s (weapon %s s)"):format(tostring(swingDuration), tostring(WeaponSpeed())))
	Print(("red zone: last %.2f s = window %.2f s + latency %d ms + extra %d ms"):format(
		Lead(), db.window, math.floor(Latency() * 1000 + 0.5), math.floor((db.extraLead or 0) + 0.5)))
	Print(("shot spell %s, auto-repeat %s, %s"):format(tostring(shotSpell), tostring(autoRepeat),
		waitingSince and "waiting for a late shot" or (swingStart and "swing running" or "idle")))
	local parts = {}
	for _, k in ipairs({ "page", "open", "window", "slider", "check", "swatch", "picker" }) do
		if optionsReport[k] then parts[#parts + 1] = k .. "=" .. optionsReport[k] end
	end
	Print("options: " .. (#parts > 0 and table.concat(parts, ", ") or "not opened yet"))
	Print("display: " .. (ns.DisplayReport and ns.DisplayReport() or "?"))
	Print("skin: " .. tostring(ns.report.skin))
	Print("swing bars: " .. tostring(ns.report["swing bars"] or "never styled"))
	for _, name in ipairs({ "SwingTimerMainHandFrame", "SwingTimerRangedFrame" }) do
		local f = _G[name]
		local bg = type(f) == "table" and f.Background
		if type(bg) == "table" then
			local ok, atlas, texture = pcall(function() return bg:GetAtlas(), bg:GetTexture() end)
			if ok then
				Print(("%s: shown %s, background atlas %s, texture %s"):format(name, tostring(f:IsShown()),
					tostring(atlas), tostring(texture)))
			end
		end
	end
	for k, v in pairs(ns.report) do
		if k:find("^skin error") then Print(k .. ": " .. tostring(v)) end
	end
end

local function Usage()
	if not shotSpell then
		Print("/shotwindow  - open the options (also /shotwindow options)")
		Print("/shotwindow style [auto|blizzard|dark]  - the window and swing bar look (now " .. ns.Styles.Name(db.style) .. ")")
		Print("/shotwindow debug")
		Print("the stand-still zone is for hunters and wand users; this character gets the look only")
		return
	end
	Print("/shotwindow  - open the options (also /shotwindow options)")
	Print("/shotwindow window <seconds>  - aim time at the end of the swing (now " .. db.window .. ")")
	Print("/shotwindow latency  - toggle starting the red zone earlier by your latency (now " .. (db.latency and "on" or "off") .. ")")
	Print("/shotwindow flash  - toggle brightening the red zone while you are in it (now " .. (db.flash and "on" or "off") .. ")")
	Print("/shotwindow style [auto|blizzard|dark]  - the options window's look (now " .. ns.Styles.Name(db.style) .. ")")
	Print("/shotwindow display [" .. table.concat(ns.DISPLAYS or {}, "|") .. "]  - a display of its own (now " .. tostring(db.display) .. ")")
	Print("/shotwindow lock | unlock  - fix or move that display")
	Print("/shotwindow debug")
end

local function Slash(msg)
	local cmd, rest = (msg or ""):match("^%s*(%S*)%s*(.-)%s*$")
	cmd = cmd:lower()
	if not shotSpell and (cmd == "window" or cmd == "latency" or cmd == "flash" or cmd == "display" or cmd == "lock" or cmd == "unlock") then
		Usage() -- zone settings, and this character has no zone
		return
	end
	if cmd == "" or cmd == "options" or cmd == "config" then
		ToggleOptions()
		return
	elseif cmd == "window" then
		local n = tonumber(rest)
		if n and n >= 0 and n <= 1 then
			db.window = n
			Print("aim window set to " .. n .. " s")
		else
			Print("give a number of seconds between 0 and 1")
			return
		end
	elseif cmd == "latency" then
		db.latency = not db.latency
		Print("latency " .. (db.latency and "on" or "off"))
	elseif cmd == "flash" then
		db.flash = not db.flash
		Print("flash " .. (db.flash and "on" or "off"))
	elseif cmd == "debug" then
		Debug()
		return
	elseif cmd == "display" then
		local want = rest:lower()
		if want == "" then
			db.display = Step(ns.DISPLAYS or { "none" }, db.display or "none", 1)
		elseif ns.DISPLAY_NAMES and ns.DISPLAY_NAMES[want] then
			db.display = want
		else
			Print("displays: " .. table.concat(ns.DISPLAYS or {}, ", "))
			return
		end
		Print("display: " .. (ns.DISPLAY_NAMES[db.display] or db.display))
	elseif cmd == "flipart" then
		db.artFlip = not db.artFlip
		Print("Blizzard art on the round designs " .. (db.artFlip and "flipped" or "the right way up") .. ". Use this if the frame's bright edge sits on the inside.")
	elseif cmd == "lock" or cmd == "unlock" then
		db.dispLocked = (cmd == "lock")
		Print(db.dispLocked and "display locked" or "display unlocked: drag it, then /shotwindow lock")
	elseif cmd == "style" then
		local Styles, style = ns.Styles, rest:lower()
		if style == "auto" or style == "automatic" then Styles.Set("auto")
		elseif style == "blizzard" or style == "dark" then Styles.Set(style)
		elseif style == "" then Styles.Cycle(1)
		else
			Print("styles: auto, blizzard, dark")
			return
		end
		Print("window style " .. Styles.Name(db.style) .. ". " .. Styles.Note())
		RefreshOptions()
		return
	else
		Usage()
		return
	end
	ApplySettings()
end

driver:RegisterEvent("PLAYER_LOGIN")
driver:SetScript("OnEvent", function(self, event, ...)
	if event == "PLAYER_LOGIN" then
		local _, class = UnitClass("player")
		shotSpell = SHOT_SPELL[class]
		ShotWindowDB = CopyDefaults(ShotWindowDB or {}, DEFAULTS)
		db = ShotWindowDB
		SLASH_SHOTWINDOW1 = "/shotwindow"
		SLASH_SHOTWINDOW2 = "/shotwin"
		SlashCmdList.SHOTWINDOW = Slash
		local ok, err = pcall(RegisterOptionsPage)
		if not ok then optionsReport.page = "failed: " .. tostring(err) end
		if not shotSpell then
			-- No Auto Shot or wand Shoot: no stand-still zone, nothing drawn on the bar, no swing
			-- events. What is left is the look (ShotWindow_Skins.lua), which every class's swing bars
			-- get under a drawn window style; it only needs the swing timer frames to exist.
			-- EllesmereUI hands its look over at PLAYER_LOGIN too, and its handler runs before this
			-- one, while the settings aren't loaded yet; the bars are styled here, now that they are.
			-- (Attach does the same for hunters and wand users.)
			if not _G.SwingTimerRangedFrame then
				self:RegisterEvent("ADDON_LOADED")
			elseif ns.SkinSwingBars then
				ns.SkinSwingBars()
			end
			return
		end
		if not Attach() then
			-- Blizzard_SwingTimer loads at startup; wait for it rather than ever loading it ourselves.
			self:RegisterEvent("ADDON_LOADED")
		end
		autoRepeat = ReadAutoRepeat()
		if IsPlayerMoving then
			local okMove, m = pcall(IsPlayerMoving)
			if okMove and not Secret(m) and type(m) == "boolean" then moving = m end
		end
		self:RegisterEvent("PLAYER_SWING")
		self:RegisterEvent("PLAYER_STARTED_MOVING")
		self:RegisterEvent("START_AUTOREPEAT_SPELL")
		self:RegisterEvent("STOP_AUTOREPEAT_SPELL")
		self:RegisterEvent("PLAYER_ENTERING_WORLD")
		self:RegisterEvent("PLAYER_STOPPED_MOVING")
		self:RegisterUnitEvent("UNIT_SPELLCAST_FAILED_QUIET", "player")
		self:RegisterEvent("WEAPON_SLOT_CHANGED")
		self:RegisterUnitEvent("UNIT_ATTACK_SPEED", "player")
		self:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
		self:RegisterEvent("UI_SCALE_CHANGED")
		self:RegisterEvent("DISPLAY_SIZE_CHANGED")
		if ns.ApplyDisplay then ns.ApplyDisplay() end
	elseif event == "ADDON_LOADED" then
		if not shotSpell then
			if _G.SwingTimerRangedFrame then
				self:UnregisterEvent("ADDON_LOADED")
				if ns.SkinSwingBars then ns.SkinSwingBars() end
			end
		elseif Attach() then
			self:UnregisterEvent("ADDON_LOADED")
			if ns.ApplyDisplay then ns.ApplyDisplay() end -- a display on the game's bar can find it now
		end
	elseif event == "PLAYER_SWING" then
		OnSwing(...)
	elseif event == "START_AUTOREPEAT_SPELL" then
		SetAutoRepeat(true)
	elseif event == "STOP_AUTOREPEAT_SPELL" then
		SetAutoRepeat(false)
	elseif event == "PLAYER_ENTERING_WORLD" then
		-- A loading screen can swallow STOP_AUTOREPEAT_SPELL: ask again.
		autoRepeat = ReadAutoRepeat()
		if autoRepeat ~= true then StopWaiting() end
		ApplyLook()
	elseif event == "PLAYER_STARTED_MOVING" then
		moving = true
		ApplyLook()
	elseif event == "PLAYER_STOPPED_MOVING" then
		moving = false
		ApplyLook()
		ShotPending()
	elseif event == "UNIT_SPELLCAST_FAILED_QUIET" then
		local _, _, spellID = ...
		if not Secret(spellID) and spellID == shotSpell then ShotPending() end
	elseif event == "WEAPON_SLOT_CHANGED" and swingStart then
		-- Blizzard restarts its running bar from 0 over the equipped ranged speed here, with no
		-- PLAYER_SWING; follow it. If the speed cannot be read, keep the old duration.
		StartSwing(WeaponSpeed() or swingDuration)
	elseif event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then
		Layout()
	elseif not swingStart and not waitingSince then
		-- Weapon or speed changed while idle: preview with the new weapon speed. A secret speed (in
		-- combat) keeps the last swing, so the next first-shot wait still has a zone to light.
		local ok, _, _, ranged = pcall(UnitAttackSpeed, "player")
		if ok and not Secret(ranged) then
			swingDuration = nil -- readable: the new speed, or hidden when there is no ranged weapon
			Layout()
		elseif tex.stand then
			HideZone() -- unknown speed: no idle preview, but the last swing is kept
		end
	end
end)
