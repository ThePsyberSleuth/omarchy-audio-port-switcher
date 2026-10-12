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

// Project a node list to the primitive rows a Repeater model can hold. A row
// holding the PwNode itself is a QObject that Qt dereferences without a null
// check while it builds the delegate, and PipeWire deletes nodes outright, so a
// graph teardown segfaults the shell. Primitives cannot dangle, which is what
// closes that race -- not the check below, since the node usually dies after the
// snapshot is taken. That is also why filtering the list here never worked.
//
// The name rides along because PipeWire reuses object ids: without it a row
// could resolve to whatever inherited its id. PwNode.name is CONSTANT, so it
// identifies the node it was taken from for as long as that node lives.
function nodeRow(node) {
  if (!node) return null
  var id = node.id
  if (id === undefined || id === null) return null
  return { id: id, name: String(node.name || "") }
}

function rowSnapshot(list) {
  var values = list && list.length ? list : []
  var rows = []
  for (var i = 0; i < values.length; i++) {
    var row = nodeRow(values[i])
    if (row) rows.push(row)
  }
  return rows
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

// Quickshell types only exact media classes, so a virtual source (an
// Audio/Source/Virtual, such as EasyEffects' or a platform's microphone
// mapping) is a node with no PwNode.audio. PulseAudio lists it as a source, so
// the source availability listing names it; a non-stream node it names is one.
function isUntypedSource(node, sourceAvailability) {
  if (!node || node.audio || node.isStream || node.isSink) return false
  var name = String(node.name || "")
  return name !== "" && !!sourceAvailability && Object.prototype.hasOwnProperty.call(sourceAvailability, name)
}

// A card profile is a mutual-exclusion group on an ALSA card: choosing one
// disables the others' sinks/sources. On codecs that gate outputs behind a
// profile (e.g. Cirrus CS8409, many SOF/SoundWire laptops), the DisplayPort
// or HDMI sink does not exist as a PipeWire node at all until its profile is
// active, so it is unreachable from a plain sink list. This reads `pactl -f
// json list cards` and flattens the card's profiles into selectable rows.
//
// Matching on the card name the current output belongs to keeps this working
// across machines: only that card's profiles are offered.
function parseCardProfiles(raw, cardName) {
  var cards
  try {
    cards = JSON.parse(String(raw || "[]"))
  } catch (e) {
    return []
  }
  if (!cards || !cards.length) return []

  function rank(n) {
    if (n.indexOf("pro-audio") === 0) return 2
    if (n.indexOf("output:") === 0) return 0
    return 1
  }

  var rows = []
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i]
    if (!card) continue
    if (cardName && String(card.name || "") !== String(cardName)) continue
    var profiles = card.profiles || {}
    var active = String(card.active_profile || "")
    var activeBase = active.split("+")[0]
    // Stable, human order: output profiles first, raw/pro-audio last.
    var names = Object.keys(profiles).sort(function(a, b) {
      var ra = rank(a), rb = rank(b)
      return ra !== rb ? ra - rb : a.localeCompare(b)
    })
    for (var j = 0; j < names.length; j++) {
      var name = names[j]
      var info = profiles[name] || {}
      var sinks = Number(info.sinks || 0)
      var activeHere = name === active
      // "off" removes audio entirely and is deliberately not offered here.
      if (name === "off") continue
      if (!activeHere) {
        // A profile that provides no sink is not a destination.
        if (sinks <= 0) continue
        // Physically absent ports (the second/third HDMI on a laptop) report
        // sinks but availability no; switching to one produces silence.
        if (info.available === false) continue
        var desc = String(info.description || "")
        // Surround variants duplicate the stereo destination for this panel.
        if (/\b(surround|5\.1|7\.1|2\.1|4\.0)\b/i.test(desc)) continue
        // A duplex "+input:" profile is the same output plus the mic, and a
        // plain output whose base is already active is the same destination.
        if (name.indexOf("+input:") !== -1) continue
        if (name.split("+")[0] === activeBase) continue
      }
      rows.push({
        card: String(card.name || ""),
        name: name,
        label: String(info.description || name),
        available: info.available !== false,
        active: activeHere
      })
    }
  }
  return rows
}

// Compact label for a profile row: drop the "(HDMI n)" boilerplate.
function profileRowLabel(row) {
  if (!row) return "Profile"
  return String(row.label || row.name || "").replace(/\s*\(HDMI \d+\)/i, "")
}

// The ports of one sink or source from `pactl -f json list sinks|sources`.
// Ports PulseAudio reports "not available" (speakers while headphones occupy
// the jack, an unplugged line out) are left out unless active: selecting one
// only produces silence. Rows are plain values, never PipeWire objects.
function parseNodePorts(raw, nodeName) {
  var empty = { node: "", active: "", ports: [], signature: "" }
  var wanted = String(nodeName || "")
  if (wanted === "") return empty
  var nodes
  try {
    nodes = JSON.parse(String(raw || "[]"))
  } catch (e) {
    return empty
  }
  if (!nodes || !nodes.length) return empty

  for (var i = 0; i < nodes.length; i++) {
    var data = nodes[i]
    if (!data || String(data.name || "") !== wanted) continue
    var active = String(data.active_port || "")
    var list = data.ports || []
    var ports = []
    var signature = wanted + "#" + active
    for (var j = 0; j < list.length; j++) {
      var port = list[j]
      if (!port || !port.name) continue
      var name = String(port.name)
      if (port.availability === "not available" && name !== active) continue
      ports.push({ name: name, description: String(port.description || name) })
      signature += "|" + name
    }
    return { node: wanted, active: active, ports: ports, signature: signature }
  }
  return empty
}

function profileSignature(rows) {
  var sig = ""
  for (var i = 0; i < rows.length; i++)
    sig += rows[i].name + "|" + (rows[i].active ? 1 : 0) + "|" + (rows[i].available ? 1 : 0) + ";"
  return sig
}

if (typeof module !== "undefined") {
  module.exports = {
    isPlaybackStream: isPlaybackStream,
    isAudioSource: isAudioSource,
    nodeRow: nodeRow,
    rowSnapshot: rowSnapshot,
    outputVolumeName: outputVolumeName,
    parseSinkAvailability: parseSinkAvailability,
    friendlyDeviceLabel: friendlyDeviceLabel,
    nodeProps: nodeProps,
    nodeLabel: nodeLabel,
    isHeadphones: isHeadphones,
    sinkGlyph: sinkGlyph,
    sourceGlyph: sourceGlyph,
    friendlyStreamLabel: friendlyStreamLabel,
    streamLabelKey: streamLabelKey,
    streamLabelIsGeneric: streamLabelIsGeneric,
    rawStreamLabel: rawStreamLabel,
    mprisPlayerLabel: mprisPlayerLabel,
    mprisPlayerIsProxy: mprisPlayerIsProxy,
    streamRepresentsMprisPlayer: streamRepresentsMprisPlayer,
    mprisLabelsFor: mprisLabelsFor,
    matchingMprisStreamLabel: matchingMprisStreamLabel,
    unmatchedMprisStreamLabel: unmatchedMprisStreamLabel,
    streamLabel: streamLabel,
    streamRepresentsPlayer: streamRepresentsPlayer,
    isUntypedSource: isUntypedSource,
    parseCardProfiles: parseCardProfiles,
    profileRowLabel: profileRowLabel,
    parseNodePorts: parseNodePorts,
    profileSignature: profileSignature
  }
}
