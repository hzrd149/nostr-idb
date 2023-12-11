import {
  ChangeEventHandler,
  FormEventHandler,
  memo,
  useCallback,
  useState,
} from "react";
import "./App.css";
import { Event, Filter } from "nostr-tools";
import dayjs from "dayjs";

import db from "./db";
import { queryWithCursors } from "./nostr-idb/query-filter";
import { addEvent, createWriteTransaction } from "./nostr-idb/ingest";
import { countEvents, countEventsByPubkey } from "./nostr-idb/query-misc";

const TopPubkeys = memo(() => {
  const [loading, setLoading] = useState(false);
  const [topPubkeys, setTopPubkeys] = useState<[string, number][]>([]);
  const update = useCallback(() => {
    setLoading(true);
    console.time("Counting events by pubkey");
    countEventsByPubkey(db)
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

const BATCH_COUNT = 1000;
const IngestEventsFile = memo(() => {
  const [running, setRunning] = useState<number | null>();
  const [pending, setPending] = useState<number>();

  const start = useCallback(
    (lines: string[]) => {
      const work = Array.from(lines);
      setPending(work.length);

      async function submitBatch() {
        const trans = createWriteTransaction(db);
        for (let i = 0; i < BATCH_COUNT; i++) {
          const line = work.pop();
          if (!line) break;
          try {
            const event = JSON.parse(line) as Event;
            addEvent(db, event, trans);
          } catch (e) {}
        }

        await trans.commit();

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
  ({ onSubmit }: { onSubmit: (query: string) => Promise<any> }) => {
    const [query, setQuery] = useState(
      localStorage.getItem("query") || EXAMPLE_QUERY,
    );

    const [loading, setLoading] = useState(false);
    const handleSubmit = useCallback<FormEventHandler>(
      async (e) => {
        e.preventDefault();
        setLoading(true);
        await onSubmit(query);
        setLoading(false);
      },
      [query],
    );

    return (
      <>
        <h4>Query Events</h4>
        <form onSubmit={handleSubmit}>
          <textarea
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              localStorage.setItem("query", e.target.value);
            }}
            cols={100}
            rows={15}
          />
          <br />

          <button type="submit">{loading ? "Loading..." : "Run Query"}</button>
        </form>
      </>
    );
  },
);

export function truncatedId(str: string, keep = 6) {
  if (str.length < keep * 2 + 3) return str;
  return str.substring(0, keep) + "..." + str.substring(str.length - keep);
}

const EventTable = memo(({ events }: { events: Event[] }) => {
  return (
    <table>
      <thead>
        <tr>
          <th>Id ({events.length})</th>
          <th>Pubkey</th>
          <th>Kind</th>
          <th>Created</th>
          <th>Content</th>
        </tr>
      </thead>
      <tbody style={{ whiteSpace: "pre", verticalAlign: "initial" }}>
        {events.map((event) => (
          <tr key={event.id}>
            <td>{truncatedId(event.id)}</td>
            <td>{truncatedId(event.pubkey)}</td>
            <td>{event.kind}</td>
            <td>
              {dayjs.unix(event.created_at).format("LL")} ({event.created_at})
            </td>
            <td style={{ textAlign: "left" }}>{event.content.slice(0, 32)}</td>
            <td style={{ textAlign: "left" }}>
              <ul>
                {event.tags.map((tag, i) => (
                  <li key={tag.join(":") + "-" + i}>
                    {JSON.stringify([tag[0], tag[1]])}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

const QueryEvents = memo(() => {
  const [results, setResults] = useState<Event[]>();
  const [time, setTime] = useState(0);

  const runQuery = useCallback(async (query: string) => {
    try {
      setResults([]);
      const start = new Date().valueOf();
      const filter = JSON.parse(query) as Filter;
      setResults(await queryWithCursors(db, filter));
      const end = new Date().valueOf();
      setTime(end - start);
    } catch (e) {
      if (e instanceof Error) {
        alert(e.message);
        console.log(e);
      }
    }
  }, []);

  return (
    <>
      <h4>Query Events</h4>
      <QueryForm onSubmit={runQuery} />
      {results && (
        <>
          <p>Took {time / 1000}s</p>
          <EventTable events={results} />
        </>
      )}
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
      <CountEvents />
      <TopPubkeys />
      <QueryEvents />
    </div>
  );
}

export default App;
