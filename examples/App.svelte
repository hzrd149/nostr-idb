<script context="module">
  import {
    IndexCache,
    getEventsForFilter,
    openDB,
    pruneLastUsed,
  } from "../dist/index.js";
  const db = await openDB();
  const indexCache = new IndexCache();

  window.db = db;
  window.prune = (size = 5000) => pruneLastUsed(db, size);
</script>

<script lang="js">
  import { addEvents, countEvents } from "../dist/index.js";
  import EventLine from "./common/EventLine.svelte";
  import ImportEvents from "./common/ImportEvents.svelte";

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

  let counting = false;
  let count = null;
  async function countEventsInDb() {
    counting = true;
    count = await countEvents(db);
    counting = false;
  }

  let loading = false;
  let events = [];
  async function loadEvents() {
    loading = true;
    try {
      const filter = JSON.parse(filterStr);
      console.time("Load Events");
      events = await getEventsForFilter(db, filter, indexCache);
      console.timeEnd("Load Events");
    } catch (e) {
      alert(e.message);
    }
    loading = false;
  }
</script>

<main>
  <div>
    <h3>Load events from file</h3>
    <ImportEvents
      handleEvents={(events) => {
        addEvents(db, events);
        events.forEach((e) => indexCache.addEventToIndexes(e));
      }}
    />
  </div>

  <div>
    <h3>Count events</h3>
    <button on:click={() => countEventsInDb()}
      >{counting ? "Counting..." : "Count"}</button
    >
    {#if count !== null}
      <span>{count}</span>
    {/if}
  </div>

  <div>
    <h3>Query Events</h3>
    <textarea cols="80" rows="16" placeholder="filter" bind:value={filterStr}
    ></textarea>
    <br />
    <button on:click={loadEvents}
      >{loading ? "Loading..." : "Load Events"}</button
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
