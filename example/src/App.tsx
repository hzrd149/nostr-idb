import {
  ChangeEventHandler,
  FormEventHandler,
  memo,
  useCallback,
  useState,
} from "react";
import "./App.css";
import { Event, Filter, Relay } from "nostr-tools";

import db, { localRelay } from "./instance";
import { addEvent, countEventsByPubkeys, countEvents } from "../../src/index";

const TopPubkeys = memo(() => {
  const [loading, setLoading] = useState(false);
  const [topPubkeys, setTopPubkeys] = useState<[string, number][]>([]);
  const update = useCallback(() => {
    setLoading(true);
    console.time("Counting events by pubkey");
    countEventsByPubkeys(db)
      .then((counts) => {
        const top = Array.from(Object.entries(counts))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);
        setTopPubkeys(top);
      })
      .finally(() => {
        setLoading(false);
        console.timeEnd("Counting events by pubkey");
      });
  }, [setTopPubkeys]);

  if (Object.keys(topPubkeys).length === 0) {
    return (
      <button onClick={update}>
        {loading ? "Loading..." : "Get top pubkeys"}
      </button>
    );
  }

  return (
    <>
      <h4>Top Pubkeys</h4>
      <ol>
        {topPubkeys.map(([pubkey, count]) => (
          <li key={pubkey}>
            {pubkey}: {count}
          </li>
        ))}
      </ol>
    </>
  );
});

const CountEvents = memo(() => {
  const [count, setCount] = useState<number>();

  const [loading, setLoading] = useState(false);
  const update = useCallback(() => {
    setLoading(true);
    countEvents(db)
      .then(setCount)
      .finally(() => setLoading(false));
  }, [setLoading]);

  return (
    <button onClick={update}>
      {loading ? "Loading..." : `${count ?? "Count"} events`}
    </button>
  );
});

const IngestEventsFromRelay = memo(() => {
  const [url, setUrl] = useState("wss://nos.lol");
  const [filter, setFilter] = useState(
    JSON.stringify(
      {
        kinds: [0, 1, 6, 7],
        limit: 500,
        authors: [
          "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
          "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2",
          "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
        ],
      },
      null,
      2,
    ),
  );
  const [loaded, setLoaded] = useState(0);

  const load = useCallback(async () => {
    const relay = new Relay(url);
    try {
      const parsedFilter = JSON.parse(filter) as Filter;
      setLoaded(0);
      await relay.connect();
      relay.subscribe([parsedFilter], {
        onevent: (e) => {
          localRelay.publish(e);
          setLoaded((v) => v + 1);
        },
        oneose: () => relay.close(),
      });
    } catch (e) {
      relay.close();
    }
  }, [setLoaded, url, filter]);

  return (
    <div>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ width: "10rem", padding: ".5rem" }}
        placeholder="wss://relay.example.com"
      />
      <br />
      <textarea
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        cols={100}
        rows={15}
      />
      <br />
      <button onClick={load}>{loaded > 0 ? `${loaded} Loaded` : "Load"}</button>
    </div>
  );
});

const BATCH_COUNT = 1000;
const IngestEventsFile = memo(() => {
  const [running, setRunning] = useState<number | null>();
  const [pending, setPending] = useState<number>();

  const start = useCallback(
    (lines: string[]) => {
      const work = Array.from(lines);
      setPending(work.length);

      async function submitBatch() {
        for (let i = 0; i < BATCH_COUNT; i++) {
          const line = work.pop();
          if (!line) break;
          try {
            const event = JSON.parse(line) as Event;
            localRelay.publish(event);
          } catch (e) {}
        }

        if (work.length > 0) {
          setRunning(window.requestIdleCallback(submitBatch));
          setPending(work.length);
        } else {
          setRunning(null);
          setPending(undefined);
        }
      }

      submitBatch();
    },
    [setRunning, setPending],
  );

  const onChange: ChangeEventHandler<HTMLInputElement> = async (e) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.readAsText(file, "utf8");
    reader.addEventListener("load", () => {
      const content = reader.result as string;
      const lines = content.split("\n");
      start(lines);
    });
  };

  const stop = useCallback(() => {
    if (running) window.cancelIdleCallback(running);
    setRunning(null);
    setPending(undefined);
  }, [running, setRunning, setPending]);

  if (!running) return <input type="file" onChange={onChange} />;

  return (
    <div>
      <p>Pending {pending}</p>
      <button onClick={stop}>Stop</button>
    </div>
  );
});

const IngestEvent = memo(() => {
  const [json, setJSON] = useState("");
  const add = () => {
    try {
      const event = JSON.parse(json) as Event;
      addEvent(db, event);
      setJSON("");
    } catch (e) {}
  };

  return (
    <div>
      <textarea
        value={json}
        onChange={(e) => setJSON(e.target.value)}
        cols={100}
        rows={15}
        placeholder="event json"
      />
      <br />
      <button onClick={add}>Add</button>
    </div>
  );
});

const EXAMPLE_QUERY = `
{
  "authors": [
    "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
    "3235036bd0957dfb27ccda02d452d7c763be40c91a1ac082ba6983b25238388c",
    "3104f98515b3aa147d55d9c2951e0f953b829d8724381d8f0d824125d7727634"
  ],
  "kinds": [
    0,
    1
  ]
}
`.trim();

const QueryForm = memo(
  ({
    onSubmit,
    subscribed,
  }: {
    subscribed?: boolean;
    onSubmit: (query: string) => Promise<any>;
  }) => {
    const [query, setQuery] = useState(EXAMPLE_QUERY);

    const handleSubmit = useCallback<FormEventHandler>(
      async (e) => {
        e.preventDefault();
        await onSubmit(query);
      },
      [query],
    );

    return (
      <>
        <h4>Query Events</h4>
        <form onSubmit={handleSubmit}>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            cols={100}
            rows={15}
          />
          <br />

          <button type="submit">{subscribed ? "Update" : "Subscribe"}</button>
        </form>
      </>
    );
  },
);

export function truncatedId(str: string, keep = 6) {
  if (str.length < keep * 2 + 3) return str;
  return str.substring(0, keep) + "..." + str.substring(str.length - keep);
}

const QueryEvents = memo(() => {
  const [sub, setSub] = useState<{ close: () => void }>();
  const [results, setResults] = useState<Event[]>([]);

  const runQuery = useCallback(async (query: string) => {
    try {
      console.time("Query");
      setResults([]);
      const filter = JSON.parse(query) as Filter;
      setSub((current) => {
        if (current) current.close();
        return localRelay.subscribe([filter], {
          onevent: (e) => setResults((arr) => arr.concat(e)),
          oneose() {
            console.timeEnd("Query");
          },
        });
      });
    } catch (e) {
      if (e instanceof Error) alert(e.message);
    }
  }, []);

  return (
    <>
      <h4>Query Events</h4>
      <QueryForm onSubmit={runQuery} subscribed={!!sub} />
      <div
        style={{
          whiteSpace: "pre",
          overflow: "auto",
          width: "90vw",
          maxHeight: "90vh",
          textAlign: "left",
        }}
      >
        {results.map((e) => (
          <div key={e.id} style={{ fontFamily: "monospace" }}>
            {e.created_at}: kind {e.kind} from {e.pubkey} |{" "}
            {e.content.replace(/\n/g, "")}
          </div>
        ))}
      </div>
    </>
  );
});

function App() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        alignItems: "center",
      }}
    >
      <IngestEventsFile />
      <IngestEventsFromRelay />
      <IngestEvent />
      <CountEvents />
      <TopPubkeys />
      <QueryEvents />
    </div>
  );
}

export default App;
