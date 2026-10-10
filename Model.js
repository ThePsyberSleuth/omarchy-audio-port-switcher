function isPlaybackStream(node) {
  if (!node || !node.isStream) return false
  if (node.isSink === true) return true

  var mediaClass = String(node.type || "")
  return mediaClass.indexOf("Stream/Output/Audio") !== -1
    || mediaClass.indexOf("AudioOutStream") !== -1
    || mediaClass.indexOf("Output") !== -1
}

function isAudioSource(node) {
  if (!node) return false
  if (node.audio) return true

  var mediaClass = String(node.type || "")
  return mediaClass.indexOf("Audio/Source") !== -1
    || mediaClass.indexOf("AudioSource") !== -1
    || mediaClass.indexOf("Source") !== -1
}

// A PipeWire node destroyed after it was cached (a card profile switch tears
// down every sink on the card) is still a truthy JS wrapper, but handing it to
// a Repeater with required properties segfaults Qt in createMissingProperties.
// Only nodes still present in the live PipeWire list are safe to display.
function listSnapshot(list, liveNodes) {
  if (!list || !list.filter) return []
  var live = liveNodes || []
  return list.filter(function(node) { return !!node && live.indexOf(node) !== -1 })
}

function outputVolumeName(volume, muted) {
  if (muted) return "Muted"
  var p = Math.round(volume * 100)
  if (p === 0) return "Silenced"
  if (p >= 100) return "Concert hall"
  if (p >= 85) return "Party mode"
  if (p >= 70) return "Cranked up"
  if (p >= 50) return "Steady groove"
  if (p >= 30) return "Easy listening"
  if (p >= 15) return "Murmur"
  return "Whisper"
}

function parseSinkAvailability(raw) {
  var next = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line) continue
    var parts = line.split("\t")
    if (parts.length >= 2) next[parts[0]] = parts[1] !== "0"
  }
  return next
}

// A card profile is a mutual-exclusion group on an ALSA card: choosing one
// disables the others' sinks/sources. On codecs that gate outputs behind a
// profile (e.g. Cirrus CS8409, many SOF/SoundWire laptops), the DisplayPort
// or HDMI sink does not exist as a PipeWire node at all until its profile is
// active, so it is unreachable from a plain sink list. This reads `pactl -f
// json list cards` and flattens every card's profiles into selectable rows.
//
// Matching on profile *name* rather than a fixed card name keeps this working
// across machines: the caller passes the fjell card name from the sinks it can
// see, and only that card's profiles are offered.
function parseCardProfiles(raw, cardName) {
  var cards
  try {
    cards = JSON.parse(String(raw || "[]"))
  } catch (e) {
    return []
  }
  if (!cards || !cards.length) return []

  var rows = []
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i]
    if (!card) continue
    if (cardName && String(card.name || "") !== String(cardName)) continue
    var profiles = card.profiles || {}
    var active = String(card.active_profile || "")
    var names = Object.keys(profiles)
    // Stable, human order: "off" last, output profiles before raw/pro-audio.
    names.sort(function(a, b) {
      function rank(n) {
        if (n === "off") return 3
        if (n.indexOf("pro-audio") === 0) return 2
        if (n.indexOf("output:") === 0) return 0
        return 1
      }
      var ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      return a.localeCompare(b)
    })
    var activeBase = String(active).split("+")[0]
    for (var j = 0; j < names.length; j++) {
      var name = names[j]
      var info = profiles[name] || {}
      var sinks = Number(info.sinks || 0)
      var activeHere = name === active
      // A profile that provides no sink is not a destination, unless it is the
      // active one (which still holds the output). "off" removes audio entirely
      // and is deliberately not offered here.
      if (name === "off") continue
      if (sinks <= 0 && !activeHere) continue
      // Physically absent ports (the second/third HDMI on a laptop) report
      // sinks but availability no; offering them would switch the card to a
      // profile that produces silence. The active profile is always kept.
      if (info.available === false && !activeHere) continue
      var desc = String(info.description || "")
      // Surround variants duplicate the stereo destination for this panel's
      // purpose; keep them only when one is the active profile.
      if (!activeHere && /\b(surround|5\.1|7\.1|2\.1|4\.0)\b/i.test(desc)) continue
      // A duplex "+input:" profile is the same output plus the mic. Keep the
      // one that is active; drop the redundant sibling, and drop a plain
      // output whose base output is already covered by the active profile.
      if (!activeHere && name.indexOf("+input:") !== -1) continue
      if (!activeHere && name.split("+")[0] === activeBase) continue
      rows.push({
        card: String(card.name || ""),
        name: name,
        label: desc || name,
        sinks: sinks,
        sources: Number(info.sources || 0),
        available: info.available !== false,
        active: activeHere
      })
    }
  }
  return rows
}

// Compact label for a profile row: strip the "Digital Stereo (HDMI) Output"
// boilerplate down to what distinguishes one output from another.
function profileRowLabel(row) {
  if (!row) return "Profile"
  var name = String(row.name || "")
  var label = String(row.label || name)
  label = label.replace(/\s*\(HDMI \d+\)/i, "")
  return label
}

function friendlyDeviceLabel(text) {
  var label = String(text || "").trim()
  label = label.replace(/^sof-soundwire\s+/i, "")
  label = label.replace(/^built-?in audio\s+/i, "")
  label = label.replace(/\s+Output$/i, "")
  label = label.replace(/\s+Input$/i, "")
  label = label.replace(/\bMicrophones\b/g, "Microphone")
  return label
}

function nodeProps(node) {
  return node && node.ready && node.properties ? node.properties : {}
}

function nodeLabel(node) {
  if (!node) return "Unknown"
  var p = nodeProps(node)
  var nickname = friendlyDeviceLabel(node.nickname || node.nick || p["node.nick"] || p["device.profile.description"] || "")
  if (nickname) return nickname
  return friendlyDeviceLabel(node.description || p["node.description"] || node.name || "Unknown")
}

function isHeadphones(node) {
  if (!node) return false
  var p = nodeProps(node)
  var blob = String([
    node.name, node.description, node.nickname,
    p["device.icon-name"] || "",
    p["device.product.name"] || "",
    p["node.description"] || "",
    p["node.nick"] || ""
  ].join(" ")).toLowerCase()
  return blob.indexOf("headphone") !== -1
    || blob.indexOf("headset") !== -1
    || blob.indexOf("earbud") !== -1
    || blob.indexOf("earphone") !== -1
    || blob.indexOf("airpod") !== -1
}

function sinkGlyph(node) {
  if (!node) return "󰓃"
  if (isHeadphones(node)) return "󰋋"
  var p = nodeProps(node)
  var blob = String([
    node.name, node.description, node.nickname,
    p["device.icon-name"] || "",
    p["device.product.name"] || ""
  ].join(" ")).toLowerCase()
  if (blob.indexOf("bluetooth") !== -1) return "󰂯"
  if (blob.indexOf("hdmi") !== -1 || blob.indexOf("display") !== -1) return "󰍹"
  return "󰓃"
}

function sourceGlyph(node) {
  if (!node) return "󰍬"
  var p = nodeProps(node)
  var blob = String([
    node.name, node.description, node.nickname,
    p["device.icon-name"] || ""
  ].join(" ")).toLowerCase()
  if (blob.indexOf("headset") !== -1) return "󰋋"
  if (blob.indexOf("bluetooth") !== -1) return "󰂯"
  if (blob.indexOf("webcam") !== -1 || blob.indexOf("camera") !== -1) return "󰄀"
  return "󰍬"
}

function friendlyStreamLabel(label) {
  label = String(label || "").trim()
  if (!label) return ""

  var known = {
    "spotify": "Spotify"
  }
  var normalized = label.toLowerCase()
  return known[normalized] || label
}

function streamLabelKey(label) {
  return String(label || "").trim().toLowerCase()
}

function streamLabelIsGeneric(label) {
  return streamLabelKey(label) === "audio-src"
}

function rawStreamLabel(node) {
  if (!node) return ""
  var p = nodeProps(node)
  return p["application.name"]
    || node.description
    || p["media.name"]
    || p["node.name"]
    || node.name
}

function mprisPlayerLabel(player) {
  if (!player) return ""
  return friendlyStreamLabel(player.identity || player.desktopEntry || "")
}

function mprisPlayerIsProxy(player) {
  var dbusName = String(player && player.dbusName || "").toLowerCase()
  var desktopEntry = String(player && player.desktopEntry || "").toLowerCase()
  return dbusName.indexOf("playerctld") !== -1 || desktopEntry === "playerctld"
}

function streamRepresentsMprisPlayer(streamLabel, playerLabel) {
  var streamKey = streamLabelKey(friendlyStreamLabel(streamLabel))
  var playerKey = streamLabelKey(playerLabel)
  if (!streamKey || !playerKey) return false
  return streamKey === playerKey
    || streamKey.indexOf(playerKey) !== -1
    || playerKey.indexOf(streamKey) !== -1
}

function mprisLabelsFor(players, predicate) {
  var values = Array.isArray(players) ? players : []
  var playingCandidates = []
  var candidates = []
  var playingProxyCandidates = []
  var proxyCandidates = []

  for (var i = 0; i < values.length; i++) {
    var player = values[i]
    if (!player) continue
    if (!player.isPlaying && !player.canPlay) continue

    var playerLabel = mprisPlayerLabel(player)
    if (!playerLabel || !predicate(playerLabel)) continue

    if (mprisPlayerIsProxy(player)) {
      if (player.isPlaying) playingProxyCandidates.push(playerLabel)
      proxyCandidates.push(playerLabel)
    } else {
      if (player.isPlaying) playingCandidates.push(playerLabel)
      candidates.push(playerLabel)
    }
  }

  if (playingCandidates.length === 1) return playingCandidates[0]
  if (playingCandidates.length === 0 && playingProxyCandidates.length === 1) return playingProxyCandidates[0]
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0 && proxyCandidates.length === 1) return proxyCandidates[0]
  return ""
}

function matchingMprisStreamLabel(label, players) {
  if (streamLabelIsGeneric(label)) return ""
  return mprisLabelsFor(players, function(playerLabel) {
    return streamRepresentsMprisPlayer(label, playerLabel)
  })
}

function unmatchedMprisStreamLabel(label, players, streams) {
  if (!streamLabelIsGeneric(label)) return ""

  return mprisLabelsFor(players, function(playerLabel) {
    var values = Array.isArray(streams) ? streams : []
    for (var i = 0; i < values.length; i++) {
      var stream = values[i]
      var streamLabel = rawStreamLabel(stream)
      if (!streamLabelIsGeneric(streamLabel) && streamRepresentsMprisPlayer(streamLabel, playerLabel))
        return false
    }
    return true
  })
}

function streamLabel(node, players, streams) {
  if (!node) return "Stream"
  var label = rawStreamLabel(node)
  return friendlyStreamLabel(matchingMprisStreamLabel(label, players)
    || unmatchedMprisStreamLabel(label, players, streams)
    || label) || "Stream"
}

function streamRepresentsPlayer(node, player, players, streams) {
  if (!node || !player) return false
  var playerLabel = mprisPlayerLabel(player)
  if (!playerLabel) return false

  var label = rawStreamLabel(node)
  if (!streamLabelIsGeneric(label)) return streamRepresentsMprisPlayer(label, playerLabel)
  return streamRepresentsMprisPlayer(streamLabel(node, players, streams), playerLabel)
}
