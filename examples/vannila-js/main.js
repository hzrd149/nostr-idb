import { openDB } from "nostr-idb";
import { WebSocket } from "nostr-idb/ws";
import { Relay } from "nostr-tools";

const $ = (q) => document.querySelector(q);

window.WebSocket = WebSocket;

const relay = new Relay("ws://nostr-idb-worker");
window.relay = relay;

console.time("Connecting to relay");
await relay.connect();
console.timeEnd("Connecting to relay");

$("#count-button").addEventListener("click", async () => {
  const kind = parseInt($("#count-kind-input").value);
  if (!Number.isFinite(kind)) return;
  $("#count-result").textContent = "Loading...";
  const count = await relay.count({ kinds: [kind] });
  $("#count-result").textContent = count;
});

// load events from jsonl file
$("#upload").onchange = (e) => {
  if (!e.target.files?.length) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.readAsText(file, "utf8");
  reader.addEventListener("load", () => {
    const content = reader.result;
    const lines = content.split("\n");

    let imported = 0;
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        relay.publish(event);
        imported++;
      } catch (e) {}
    }

    $("#upload-status").textContent = `Loaded ${imported} events`;
  });
};
