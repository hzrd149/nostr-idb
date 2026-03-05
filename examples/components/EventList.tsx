import React from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { EventRow } from "./EventRow.tsx";

type Props = {
  events: NostrEvent[];
  label?: string;
};

export function EventList({ events, label }: Props) {
  return (
    <>
      <div className="event-list-header">
        <span>{label ?? "Events"}</span>
        <span>
          {events.length} result{events.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="event-list">
        {events.length === 0 ? (
          <div className="empty-state">
            <span className="icon">📭</span>
            <span>No events to display</span>
          </div>
        ) : (
          events.map((e) => <EventRow key={e.id} event={e} />)
        )}
      </div>
    </>
  );
}
