<script lang="js">
  export let handleEvents = () => {};
  const batch = 1000;
  let status = "";

  async function ingestFile(file) {
    const reader = new FileReader();
    reader.readAsText(file, "utf8");
    reader.addEventListener("load", async () => {
      const content = reader.result;
      const lines = content.split("\n");

      let imported = 0;
      let events = [];
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          events.push(event);
          imported++;

          if (events.length >= batch) {
            await handleEvents(events);
            events = [];
          }
        } catch (e) {}
      }

      if (events.length > 0) await handleEvents(events);

      status = `Imported ${imported} events`;
    });
  }
</script>

<div>
  <input
    type="file"
    accept=".jsonl"
    on:change={(e) => e.target.files[0] && ingestFile(e.target.files[0])}
  />
  <br />
  <span>{status}</span>
</div>
