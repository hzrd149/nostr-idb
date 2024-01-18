<script type="js">
  export let event;

  let expanded = false;
</script>

<div class="event">
  <a on:click={() => (expanded = !expanded)}>[{expanded ? "-" : "+"}] </a>
  <span>({event.kind}) </span>
  <span>{event.created_at}: </span>
  <span>from {event.pubkey.slice(0, 6)} </span>
  <span>{event.content.replace(/\n/g, "")}</span>
  {#if event.tags.length > 0 && expanded}
    <ul>
      {#each event.tags as tag}
        <li>[{tag[0]}] {tag.slice(1).join(", ")}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .event {
    font-family: monospace;
  }
  .event ul {
    margin: 0;
    list-style: none;
    padding: 0 1rem;
  }
  .event a {
    cursor: pointer;
  }
</style>
