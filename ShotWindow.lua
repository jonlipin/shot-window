-- Shot Window: marks when a hunter must stand still on the game's own ranged swing timer.
--
-- The game's bar (Blizzard_SwingTimer, frame SwingTimerRangedFrame) fills from 0 to 1 over the
-- ranged swing, restarted by PLAYER_SWING when Auto Shot fires. The last part of the swing is the
-- Auto Shot aim: moving then delays the shot. We listen to the same event, keep our own clock and
-- draw a red zone over that end of the bar's StatusBar, starting earlier by the round trip to the
-- server so a stop at the line reaches the server in time.
-- Nothing of Blizzard's is read back or changed; we only add textures to its StatusBar.
--
-- On Forever, Auto Shot fires during cast-time shots, so casts need no marker.

local ADDON, ns = ...

ns.VERSION = "0.1.0"

local RANGED = Enum and Enum.PlayerSwingType and Enum.PlayerSwingType.Ranged or 2

local DEFAULTS = {
	window = 0.5,   -- seconds at the end of the swing when Auto Shot aims
	latency = true, -- start the red zone earlier by world latency
	flash = true,   -- brighten the red zone while the swing is inside it
	color = { 0.95, 0.20, 0.15 },
}

local db
local bar            -- SwingTimerRangedFrame.StatusBar
local tex = {}       -- our textures on the bar
local swingDuration  -- seconds, from the last PLAYER_SWING
local swingStart     -- GetTime() at the last PLAYER_SWING, nil when idle
local standFrom      -- seconds into the swing where the red zone starts, for the flash
local inStand        -- last flash state, to avoid re-setting the colour every frame

local function Secret(v)
	return issecretvalue and issecretvalue(v)
end

local function Print(msg)
	DEFAULT_CHAT_FRAME:AddMessage("|cff7fd0ffShot Window|r " .. msg)
end

local function CopyDefaults(dst, src)
	for k, v in pairs(src) do
		if dst[k] == nil then
			if type(v) == "table" then
				dst[k] = CopyDefaults({}, v)
			else
				dst[k] = v
			end
		end
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
	return db.window + Latency()
end

local function SetStandColor(on)
	local c = db.color
	tex.stand:SetColorTexture(c[1], c[2], c[3], on and 0.65 or 0.35)
end

local function CreateTextures()
	local c = db.color
	tex.stand = bar:CreateTexture(nil, "ARTWORK", nil, 6) -- above the fill (ARTWORK 0), below the labels
	SetStandColor(false)
	tex.stand:Hide()
	tex.line = bar:CreateTexture(nil, "ARTWORK", nil, 7)
	tex.line:SetColorTexture(c[1], c[2], c[3], 0.95)
	tex.line:Hide()
end

local function HideAll()
	for _, t in pairs(tex) do t:Hide() end
end

local function Layout()
	if not bar or not tex.stand then return end
	local dur = swingDuration or WeaponSpeed()
	local width = bar:GetWidth()
	if not dur or Secret(width) or type(width) ~= "number" or width <= 0 then
		HideAll()
		return
	end

	local from = math.max(0, dur - Lead())
	if from >= dur then -- window 0
		HideAll()
		return
	end
	local x = from / dur * width

	local s = tex.stand
	s:ClearAllPoints()
	s:SetPoint("TOPLEFT", bar, "TOPLEFT", x, 0)
	s:SetPoint("BOTTOMLEFT", bar, "BOTTOMLEFT", x, 0)
	s:SetWidth(math.max(1, width - x))
	s:Show()

	local l = tex.line
	if x > 0 then
		-- 2 units, but never thinner than one physical pixel when Edit Mode scales the bar down.
		local w = 2
		if PixelUtil and PixelUtil.GetNearestPixelSize then
			w = PixelUtil.GetNearestPixelSize(2, bar:GetEffectiveScale(), 1)
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

local function SetStandBright(on)
	if not tex.stand or inStand == on then return end
	inStand = on
	SetStandColor(on)
end

local driver = CreateFrame("Frame")

local function OnUpdate()
	if not swingStart then return end
	local elapsed = GetTime() - swingStart
	if elapsed >= swingDuration then
		swingStart = nil
		driver:SetScript("OnUpdate", nil)
		SetStandBright(false)
		return
	end
	if db.flash then
		SetStandBright(elapsed >= standFrom)
	end
end

local function StartSwing(duration)
	swingDuration = duration
	swingStart = GetTime()
	standFrom = duration - Lead()
	Layout()
	SetStandBright(false)
	driver:SetScript("OnUpdate", OnUpdate)
end

local function OnSwing(duration, swingType)
	if Secret(duration) or Secret(swingType) then return end
	if swingType ~= RANGED or type(duration) ~= "number" or duration <= 0 then return end
	StartSwing(duration)
end

local function Attach()
	if bar then return true end
	local frame = _G.SwingTimerRangedFrame
	local statusBar = frame and frame.StatusBar
	if not statusBar then return false end
	bar = statusBar
	CreateTextures()
	bar:HookScript("OnSizeChanged", Layout)
	Layout()
	return true
end

local function Debug()
	Print("version " .. ns.VERSION)
	Print("bar found: " .. tostring(bar ~= nil) .. ", showSwingTimer: " .. tostring(GetCVar and GetCVar("showSwingTimer")))
	Print(("swing: %s s (weapon %s s)"):format(tostring(swingDuration), tostring(WeaponSpeed())))
	Print(("red zone: last %.2f s = window %.2f + latency %.3f"):format(Lead(), db.window, Latency()))
end

local function Usage()
	Print("/shotwindow window <seconds>  - Auto Shot aim time at the end of the swing (now " .. db.window .. ")")
	Print("/shotwindow latency  - toggle starting the red zone earlier by your latency (now " .. (db.latency and "on" or "off") .. ")")
	Print("/shotwindow flash  - toggle brightening the red zone while you are in it (now " .. (db.flash and "on" or "off") .. ")")
	Print("/shotwindow debug")
end

local function Slash(msg)
	local cmd, rest = (msg or ""):match("^%s*(%S*)%s*(.-)%s*$")
	cmd = cmd:lower()
	if cmd == "window" then
		local n = tonumber(rest)
		if n and n >= 0 and n <= 2 then
			db.window = n
			Print("Auto Shot aim window set to " .. n .. " s")
		else
			Print("give a number of seconds between 0 and 2")
			return
		end
	elseif cmd == "latency" then
		db.latency = not db.latency
		Print("latency " .. (db.latency and "on" or "off"))
	elseif cmd == "flash" then
		db.flash = not db.flash
		SetStandBright(false)
		Print("flash " .. (db.flash and "on" or "off"))
	elseif cmd == "debug" then
		Debug()
		return
	else
		Usage()
		return
	end
	if swingStart then standFrom = swingDuration - Lead() end
	Layout()
end

driver:RegisterEvent("PLAYER_LOGIN")
driver:SetScript("OnEvent", function(self, event, ...)
	if event == "PLAYER_LOGIN" then
		local _, class = UnitClass("player")
		if class ~= "HUNTER" then return end
		ShotWindowDB = CopyDefaults(ShotWindowDB or {}, DEFAULTS)
		db = ShotWindowDB
		SLASH_SHOTWINDOW1 = "/shotwindow"
		SLASH_SHOTWINDOW2 = "/shotwin"
		SlashCmdList.SHOTWINDOW = Slash
		if not Attach() then
			-- Blizzard_SwingTimer loads at startup; wait for it rather than ever loading it ourselves.
			self:RegisterEvent("ADDON_LOADED")
		end
		self:RegisterEvent("PLAYER_SWING")
		self:RegisterEvent("WEAPON_SLOT_CHANGED")
		self:RegisterUnitEvent("UNIT_ATTACK_SPEED", "player")
		self:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
		self:RegisterEvent("UI_SCALE_CHANGED")
		self:RegisterEvent("DISPLAY_SIZE_CHANGED")
	elseif event == "ADDON_LOADED" then
		if Attach() then self:UnregisterEvent("ADDON_LOADED") end
	elseif event == "PLAYER_SWING" then
		OnSwing(...)
	elseif event == "WEAPON_SLOT_CHANGED" and swingStart then
		-- Blizzard restarts its running bar from 0 over the equipped ranged speed here, with no
		-- PLAYER_SWING; follow it. If the speed cannot be read, keep the old duration.
		StartSwing(WeaponSpeed() or swingDuration)
	elseif event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then
		Layout()
	elseif not swingStart then
		-- Weapon or speed changed while idle: preview with the new weapon speed.
		swingDuration = nil
		Layout()
	end
end)
