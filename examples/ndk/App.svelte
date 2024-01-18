<script context="module">
  import { WebSocket } from "../../dist/ws/index.js";
  window.WebSocket = WebSocket;
  import NDK from "@nostr-dev-kit/ndk";

  localStorage.debug = "ndk:*";

  const ndk = new NDK({
    enableOutboxModel: false,
    autoConnectUserRelays: false,
    autoFetchUserMutelist: false,
  });
  window.ndk = ndk;
</script>

<script lang="js">
  import {
    LOCAL_RELAY_URI,
    SHARED_WORKER_RELAY_URI,
    WORKER_RELAY_URI,
  } from "../../dist/ws/index.js";
  import EventLine from "../common/EventLine.svelte";
  import ImportEvents from "../common/ImportEvents.svelte";
  import { NDKRelaySet } from "@nostr-dev-kit/ndk";

  let verify = false;
  let relayURL = LOCAL_RELAY_URI;
  let relay = null;

  $: {
    ndk.pool.relays.forEach((r) => r.disconnect());
    ndk.pool.removeRelay(relayURL);
    relay = ndk.pool.getRelay(relayURL, true);
    window.relay = relay;
  }

  let filterStr = JSON.stringify(
    {
      kinds: [0, 1, 6, 7],
      since: 1671607942,
      authors: [
        "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
        "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2",
        "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
      ],
    },
    null,
    2,
  );

  let loading = false;
  let events = [];
  async function subscribe() {
    loading = true;
    events = [];
    try {
      const filter = JSON.parse(filterStr);
      events = Array.from(
        await ndk.fetchEvents(
          filter,
          {
            skipVerification: true,
            groupable: false,
          },
          NDKRelaySet.fromRelayUrls([relayURL], ndk),
        ),
      );
    } catch (e) {
      alert(e.message);
    }
    loading = false;
  }
</script>

<main>
  <select bind:value={relayURL}>
    <option value={LOCAL_RELAY_URI}>{LOCAL_RELAY_URI}</option>
    <option value={WORKER_RELAY_URI}>{WORKER_RELAY_URI}</option>
    <option value={SHARED_WORKER_RELAY_URI}>{SHARED_WORKER_RELAY_URI}</option>
  </select>
  <label>
    <input type="checkbox" bind:checked={verify} />
    Verify events
  </label>

  <div>
    <h3>Load events from file</h3>
    <ImportEvents
      handleEvents={(events) => events.forEach((event) => relay.publish(event))}
    />
  </div>

  <div>
    <h3>Query Events</h3>
    <textarea cols="80" rows="16" placeholder="filter" bind:value={filterStr}
    ></textarea>
    <br />
    <button on:click={subscribe} disabled={relay.connected}
      >{loading ? "Loading..." : "Fetch Events"}</button
    >
    {#if events.length > 0}
      <span>{events.length}</span>
    {/if}
  </div>
  <div class="events">
    {#each events as event}
      <EventLine {event} />
    {/each}
  </div>
</main>

<style>
  h3 {
    margin-bottom: 0;
  }

  .events {
    white-space: pre;
    overflow-x: auto;
    overflow-y: visible;
    width: 100vw;
    text-align: left;
    padding-bottom: 2rem;
  }
</style>
