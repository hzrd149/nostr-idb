import React, {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Key,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export type VirtualListHandle = {
  scrollToIndex: (index: number) => void;
};

/**
 * Windowed list: only the rows inside (or near) the visible scroll area are
 * mounted. By default the list owns its scroll container (give `className` a
 * height or max-height). Pass `scrollParent` to scroll inside an existing
 * ancestor instead, e.g. a page column or a sidebar panel.
 */
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize,
  fixedSize = false,
  gap = 0,
  overscan = 8,
  className,
  style,
  itemClassName,
  scrollParent,
  handle,
  ...rest
}: {
  items: readonly T[];
  getKey: (item: T, index: number) => Key;
  renderItem: (item: T, index: number) => ReactNode;
  /** row height in px (exact when `fixedSize`, otherwise an estimate) */
  estimateSize: number;
  /** skip per-row DOM measurement when every row is exactly `estimateSize` */
  fixedSize?: boolean;
  gap?: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
  /** class applied to each absolutely-positioned row wrapper */
  itemClassName?: string;
  scrollParent?: RefObject<HTMLElement | null>;
  handle?: Ref<VirtualListHandle>;
} & Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "className" | "style" | "children"
>) {
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // when scrolling an ancestor, rows are offset by everything above the list
  useLayoutEffect(() => {
    if (!scrollParent) return;
    const parent = scrollParent.current;
    const list = listRef.current;
    if (!parent || !list) return;
    const update = () => {
      const margin =
        list.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop;
      setScrollMargin((m) => (Math.abs(m - margin) < 0.5 ? m : margin));
    };
    update();
    // content above the list growing or shrinking resizes some ancestor
    // between the list and the scroll parent, so watch that whole chain
    const ro = new ResizeObserver(update);
    for (let el: Element | null = list; el; el = el.parentElement) {
      ro.observe(el);
      if (el === parent) break;
    }
    return () => ro.disconnect();
  }, [scrollParent]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollParent?.current ?? ownScrollRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey(items[index], index),
    overscan,
    gap,
    scrollMargin,
  });

  useImperativeHandle(
    handle,
    () => ({
      scrollToIndex: (index) =>
        virtualizer.scrollToIndex(index, { align: "auto" }),
    }),
    [virtualizer],
  );

  const list = (
    <div
      ref={listRef}
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={fixedSize ? undefined : virtualizer.measureElement}
          className={itemClassName}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: fixedSize ? row.size : undefined,
            transform: `translateY(${row.start - scrollMargin}px)`,
          }}
        >
          {renderItem(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );

  if (scrollParent)
    return (
      <div className={className} style={style} {...rest}>
        {list}
      </div>
    );

  return (
    <div
      ref={ownScrollRef}
      className={className}
      style={{ overflowY: "auto", ...style }}
      {...rest}
    >
      {list}
    </div>
  );
}
