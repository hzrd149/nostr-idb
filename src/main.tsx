import React from "react";
import ReactDOM from "react-dom/client";
import dayjs from "dayjs";
import App from "./App.tsx";
import "./index.css";
import { getEventsForFilters } from "./nostr-idb/query-filter.ts";
import db from "./db";

import localizedFormat from "dayjs/plugin/localizedFormat";
dayjs.extend(localizedFormat);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

async function queryEvents() {
  const events = getEventsForFilters(db, [
    {
      since: dayjs().subtract(12, "hours").unix(),
    },
  ]);

  console.log(events);
  return events;
}

// @ts-ignore
window.queryEvents = queryEvents;
