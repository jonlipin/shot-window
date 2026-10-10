-- Shot Window's pieces in the window styles. Styles.lua does the choosing and the drawing
-- (Blizzard, Dark, or EllesmereUI's look); this file says what Shot Window restyles.
--
-- Restyled: the game's swing timer bars (ranged, main and off hand, on every class), the
-- options window, and the copy of the controls that window shows while a style is drawn.
-- Left alone: the same controls on the game's Options page (the game's own panel, which
-- EllesmereUI leaves alone too).
--
-- The bars are Blizzard's (Blizzard_SwingTimer), plain frames with no secure template, so only
-- what they draw is changed, never where they are or whether they show. Their background and
-- border art is emptied in place rather than faded: Blizzard sets those two textures' alpha itself
-- whenever the target goes in or out of range, which would bring faded art straight back, but it
-- never sets their art again after loading. The track, the edge and a flat fill are textures of
-- ours on the bar's StatusBar, so Blizzard's out of range dimming (the StatusBar's alpha) dims them
-- too, and the red zone and line stay on top of the fill.

local ADDON, ns = ...
local Styles = ns.Styles
local Try = Styles.Try

local function S() return Styles.S end

local function Fonts(...)
	for i = 1, select("#", ...) do
		local fs = select(i, ...)
		if type(fs) == "table" and fs.GetFont then S().Font(fs) end
	end
end

-- EllesmereUI lays its border over the window as a frame of its own; put the close button back
-- on top of it.
local function RaiseAbove(button, win)
	if type(button) ~= "table" or not button.SetFrameLevel then return end
	local top = win:GetFrameLevel()
	for _, child in ipairs({ win:GetChildren() }) do
		if child ~= button then top = math.max(top, child:GetFrameLevel()) end
	end
	button:SetFrameLevel(top + 1)
end

-- Colors of our own that follow the accent: the header rules and the slider thumbs.
local accented = {}
local function Accent()
	local r, g, b = S().GetAccentColor()
	for _, paint in ipairs(accented) do paint(r, g, b) end
end

-- A slider's track art gives way to a thin dark groove and a flat thumb in the accent color.
local function SkinSlider(part)
	local slider = part.slider
	S().FadeRegions(slider)
	local groove = slider:CreateTexture(nil, "BACKGROUND", nil, -6)
	groove:SetPoint("LEFT")
	groove:SetPoint("RIGHT")
	groove:SetHeight(4)
	groove:SetColorTexture(0, 0, 0, 0.6)
	local thumb = slider.GetThumbTexture and slider:GetThumbTexture()
	if type(thumb) == "table" then
		thumb:SetAlpha(1)
		thumb:SetSize(8, 14)
		accented[#accented + 1] = function(r, g, b) thumb:SetColorTexture(r, g, b, 1) end
	end
	Fonts(part.caption, part.value)
end

-- ---- the swing timer bars -----------------------------------------------------------------------

local SWING_BARS = { "SwingTimerMainHandFrame", "SwingTimerOffHandFrame", "SwingTimerRangedFrame" }
local flatBars = setmetatable({}, { __mode = "k" }) -- kept here, not as a field on Blizzard's frames

local function FlatBar(frame, bar)
	flatBars[bar] = true
	-- Emptied in place: a color texture with nothing in it. Never hidden, moved or resized.
	for _, key in ipairs({ "Background", "Border" }) do
		local art = frame[key]
		if type(art) == "table" and art.SetColorTexture then art:SetColorTexture(0, 0, 0, 0) end
	end
	-- The glow that rides the end of the fill; Blizzard shows and hides it but never sets its alpha.
	if type(bar.Pip) == "table" and bar.Pip.SetAlpha then bar.Pip:SetAlpha(0) end

	local r, g, b = S().GetPanelColor()
	local track = bar:CreateTexture(nil, "BACKGROUND", nil, -8)
	track:SetAllPoints(bar)
	track:SetColorTexture(r or 0.07, g or 0.07, b or 0.08, 0.85)
	Styles.Outline(bar, bar, "BACKGROUND", 0, 0, 0, 1, 1)

	-- Over Blizzard's fill and following its edge, the way the red tint does: ARTWORK 1, above
	-- Blizzard's fill (ARTWORK 0) and below the tint (5), the red zone (6) and its line (7).
	local fill = bar:CreateTexture(nil, "ARTWORK", nil, 1)
	local blizzardFill = bar.GetStatusBarTexture and bar:GetStatusBarTexture()
	if blizzardFill then fill:SetAllPoints(blizzardFill) else fill:SetAllPoints(bar) end
	accented[#accented + 1] = function(ar, ag, ab) fill:SetColorTexture(ar, ag, ab, 1) end
	local ar, ag, ab = S().GetAccentColor()
	fill:SetColorTexture(ar, ag, ab, 1)

	Fonts(bar.TypeLabel, bar.TimeLabel)
end

-- Every class: the stand-still zone is for hunters and wand users, but the bars' look is for anyone
-- who chose a drawn style. Waits for the settings, which arrive at login.
function ns.SkinSwingBars()
	if not S() or not (ns.DB and ns.DB()) then return end
	for _, name in ipairs(SWING_BARS) do
		local frame = _G[name]
		local bar = type(frame) == "table" and frame.StatusBar
		if type(bar) == "table" and not flatBars[bar] then
			Try("swing bar " .. name, FlatBar, frame, bar)
		end
	end
end

-- ---- the options window ------------------------------------------------------------------------

function ns.SkinWindow(win)
	if not S() or not win or win.swSkinned then return end
	win.swSkinned = true
	Try("options window", function()
		S().Shell(win)
		if type(win.Inset) == "table" then S().Inset(win.Inset) end
		local close = win.CloseButton or _G.ShotWindowOptionsCloseButton or win.swClose
		if type(close) == "table" then
			S().CloseButton(close)
			RaiseAbove(close, win)
		end
		local container = win.TitleContainer
		Fonts(type(container) == "table" and container.TitleText or win.TitleText)
	end)
end

-- The window's own copy of the controls (never the one on the Options page).
function ns.SkinContent(c)
	if not S() or not c then return end
	local parts = c.swParts
	Try("options headers", function()
		for _, header in ipairs(parts.headers) do
			Fonts(header.text)
			accented[#accented + 1] = function(r, g, b) header.rule:SetColorTexture(r, g, b, 0.5) end
		end
	end)
	Try("options checkboxes", function()
		for _, check in ipairs(parts.checks) do
			S().Checkbox(check.button)
			Fonts(check.label)
		end
	end)
	Try("options sliders", function()
		for _, part in ipairs(parts.sliders) do SkinSlider(part) end
	end)
	Try("options buttons", function()
		for _, button in ipairs(parts.buttons) do
			S().Button(button)
			S().WhiteButtonLabel(button)
			if button.GetFontString then Fonts(button:GetFontString()) end
		end
	end)
	Try("options text", function()
		for _, fs in ipairs(parts.texts) do Fonts(fs) end
	end)
	Try("accent", Accent)
end

-- Everything that exists when a style is applied: the window, if it was opened before. If it is
-- open right now, it is shown again so it swaps to its own restyled copy of the controls.
local function SkinAll(skin)
	if skin.OnLooksChanged then skin.OnLooksChanged(function() Try("accent", Accent) end) end
	ns.SkinSwingBars()
	local win = _G.ShotWindowOptions
	if not win then return end
	ns.SkinWindow(win)
	local onShow = win:GetScript("OnShow")
	if win:IsShown() and onShow then onShow(win) end
end

Styles.Setup({
	addon = ADDON,
	title = "Shot Window",
	db = function() return ns.DB and ns.DB() end,
	report = ns.report,
	accent = { 0.5, 0.82, 1 }, -- the light blue of Shot Window's chat lines
	skin = SkinAll,
})
