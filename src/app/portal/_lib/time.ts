'use client';

import { useEffect, useState } from 'react';
import type { Connection } from './types';

// Every formatter takes "now" as an argument instead of reading the clock
// itself, so a component re-renders with fresh labels whenever useNow ticks
// (and rendering stays pure).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fullDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysAgo(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / (24 * HOUR));
}

function dateLabel(then: Date, now: Date): string {
  return then.getFullYear() === now.getFullYear() ? monthDay.format(then) : monthDayYear.format(then);
}

/** Compact time for lists: "Now", "5m", "2h", "Yesterday", "Nov 3", "Nov 3, 2025". */
export function shortTime(iso: string, now: number): string {
  const then = new Date(iso);
  const nowDate = new Date(now);
  const diff = now - then.getTime();
  const days = daysAgo(then, nowDate);
  if (days <= 0) {
    if (diff < MINUTE) return 'Now';
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
    return `${Math.floor(diff / HOUR)}h`;
  }
  if (days === 1) return 'Yesterday';
  return dateLabel(then, nowDate);
}

/** Time on a chat bubble. The day itself is shown by the separator above it. */
export function messageTime(iso: string): string {
  return timeOfDay.format(new Date(iso));
}

/** Day separator between chat messages: "Today", "Yesterday", "Nov 3". */
export function dayLabel(iso: string, now: number): string {
  const then = new Date(iso);
  const nowDate = new Date(now);
  const days = daysAgo(then, nowDate);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dateLabel(then, nowDate);
}

export function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** For a title tooltip, e.g. "Wednesday, November 26, 2026 at 3:42 PM". */
export function fullTime(iso: string): string {
  return fullDateTime.format(new Date(iso));
}

/** Re-renders the caller every `intervalMs` so relative labels like "5m" don't freeze. */
export function useNow(intervalMs = MINUTE): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Conversation lists: newest message first, conversations with no messages last. */
export function byLatestMessage(a: Connection, b: Connection): number {
  const aAt = a.lastMessage?.createdAtIso ?? '';
  const bAt = b.lastMessage?.createdAtIso ?? '';
  return bAt.localeCompare(aAt);
}
