// Run: node --test tests/
const test = require("node:test")
const assert = require("node:assert/strict")
const Model = require("../Model.js")

function card(name) {
  return {
    name: name,
    active_profile: "output:analog-stereo",
    profiles: {
      off: { description: "Off", sinks: 0, available: true },
      "output:analog-stereo": { description: "Analog Stereo Output", sinks: 1, available: true },
      "output:hdmi-stereo": { description: "Digital Stereo (HDMI) Output", sinks: 1, available: true }
    }
  }
}

const twoCards = JSON.stringify([card("alsa_card.a"), card("alsa_card.b")])

test("rows target the output's card even when another card has identical profiles", () => {
  const a = Model.parseCardProfiles(twoCards, "alsa_card.a")
  const b = Model.parseCardProfiles(twoCards, "alsa_card.b")
  assert.deepEqual(a.map(r => r.name), b.map(r => r.name))
  assert.ok(b.every(r => r.card === "alsa_card.b"))
  // The panel's change check compares serialized rows: identical profiles on
  // another card must still count as a change, or clicks go to the old card.
  assert.notEqual(JSON.stringify(a), JSON.stringify(b))
})

test("no known card offers no rows instead of mixing every card", () => {
  assert.deepEqual(Model.parseCardProfiles(twoCards, ""), [])
  assert.deepEqual(Model.parseCardProfiles(twoCards, "alsa_card.missing"), [])
})

test("a sink's ports carry its card, which the PipeWire node lacks", () => {
  const sinks = JSON.stringify([{
    name: "alsa_output.a",
    active_port: "hp",
    properties: { "device.name": "alsa_card.a" },
    ports: [{ name: "hp", description: "Headphones", availability: "available" }]
  }])
  assert.equal(Model.parseNodePorts(sinks, "alsa_output.a").card, "alsa_card.a")
  assert.equal(Model.parseNodePorts(sinks, "alsa_output.gone").card, "")
})

test("switching from analog duplex targets HDMI duplex, keeping the mic", () => {
  const cards = JSON.stringify([{
    name: "alsa_card.a",
    active_profile: "output:analog-stereo+input:analog-stereo",
    profiles: {
      "output:analog-stereo": { description: "Analog Stereo Output", sinks: 1, available: true },
      "output:analog-stereo+input:analog-stereo": { description: "Analog Stereo Duplex", sinks: 1, available: true },
      "output:hdmi-stereo": { description: "Digital Stereo (HDMI) Output", sinks: 1, available: true },
      "output:hdmi-stereo+input:analog-stereo": { description: "HDMI + Analog Input", sinks: 1, available: true }
    }
  }])
  const names = Model.parseCardProfiles(cards, "alsa_card.a").map(r => r.name)
  assert.deepEqual(names, ["output:analog-stereo+input:analog-stereo", "output:hdmi-stereo+input:analog-stereo"])
})
