/**
 * One socket for the whole wall, and the state every tile reads from it.
 *
 * ── ONE SOCKET, NOT ONE PER TILE ────────────────────────────────────────────────────────────────
 *
 * A wall is N Terminals and the streamer multiplexes them over a single connection: frames are
 * tagged with the Terminal id (`[1 byte idLen][id][payload]`). A socket per tile would mint N
 * tickets, hold N connections against a control plane that may be a 2 GB droplet, and give every
 * tile its own reconnect storm.
 *
 * ── NOTHING IS WRITTEN BUT `subscribe` AND `converge` ───────────────────────────────────────────
 *
 * ADR 0020 finding 3: a read-only tmux client is not read-only — both `run-shell` and `send-keys`
 * executed as root through one. So read-only is a property of THIS SURFACE, and the surface is this
 * socket: there is no code path here that can put operator bytes on it. No keystroke handler, and
 * no `ping` either — a heartbeat would be a second thing on the wire to reason about, and the
 * browser's own liveness is what `onclose` reports.
 *
 * ── THE TICKET IS WHAT TRAVELS, NEVER THE TOKEN ─────────────────────────────────────────────────
 *
 * `POST /api/panels/ticket` is same-origin and credential-free; orchestrator-api holds the streamer
 * token and forwards. The minted ticket is single-use and short-lived, which is what makes it safe
 * in a URL that ends up in access logs and `Referer` headers.
 */
import {
  decodeTagged,
  fetchTerminals,
  fetchTicket,
  panelBase,
  panelSocketUrl,
  type ServerMessage,
  type Terminal,
  type TerminalHealth,
} from '@kontra/console-core/panels/panelsClient';
import { reconnectDelay } from '@kontra/console-core/panels/reconnect';

/** What the page is doing, as a word it can show. */
export type Phase = 'idle' | 'listing' | 'connecting' | 'streaming' | 'error';

export interface TileState {
  mode: 'snapshot' | 'live' | 'error';
  health: TerminalHealth;
  /** Bytes the streamer dropped between frames, when it has said so. */
  elided: number;
}

const BLANK: TerminalHealth = {
  reachable: 'unknown',
  session: 'unknown',
  poller: 'unknown',
  loads: 'unknown',
};

/**
 * The wall's connection and inventory.
 *
 * A CLASS WITH RUNE FIELDS rather than a store: `$state` in a `.svelte.ts` module gives every tile
 * fine-grained reactivity — a frame for one Terminal re-renders that tile's status and nothing
 * else — with no subscription plumbing and no selector memoisation.
 */
export class Wall {
  terminals = $state<Terminal[]>([]);
  phase = $state<Phase>('idle');
  /** The streamer's own sentence when something refused. Shown verbatim: it names the fix. */
  error = $state('');
  tiles = $state<Record<string, TileState>>({});

  #socket: WebSocket | undefined;
  #attempt = 0;
  #stopped = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Geometry each tile last measured, replayed on reconnect so a new socket resubscribes. */
  #geometry = new Map<string, { cols: number; rows: number }>();
  /** Which ids this socket has already asked for. Cleared with the socket. */
  #subscribed = new Set<string>();
  /** Where a tile's bytes go. One per mounted tile. */
  #sinks = new Map<string, (bytes: Uint8Array) => void>();

  /** Start: list the Terminals, then connect. Returns a teardown. */
  start(): () => void {
    this.#stopped = false;
    void this.#list();
    return () => this.stop();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#socket?.close();
    this.#socket = undefined;
  }

  async #list(): Promise<void> {
    this.phase = 'listing';
    try {
      this.terminals = await fetchTerminals();
      this.error = '';
    } catch (err) {
      // A 503 here is the streamer fail-closed with no token — a different machine to go and look
      // at than an unreachable one, and the reply says which. Passed through unchanged.
      this.phase = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    if (this.#stopped) return;
    await this.#connect();
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    this.phase = 'connecting';
    let ticket: string;
    try {
      ticket = (await fetchTicket()).ticket;
    } catch (err) {
      this.phase = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    if (this.#stopped) return;

    const socket = new WebSocket(panelSocketUrl(panelBase(), ticket));
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.onopen = () => {
      this.#attempt = 0;
      this.phase = 'streaming';
      // RESUBSCRIBE EVERYTHING. A new socket knows nothing about what the page is showing, and a
      // tile whose geometry was measured before the drop must not wait for a resize to say it again.
      this.#subscribed.clear();
      this.#flush();
    };

    socket.onmessage = (e) => {
      if (typeof e.data !== 'string') return this.#binary(e.data as ArrayBuffer);
      let message: ServerMessage;
      try {
        message = JSON.parse(e.data) as ServerMessage;
      } catch {
        return; // a frame that did not parse is not a reason to tear down a working socket
      }
      this.#control(message);
    };

    socket.onclose = () => {
      if (this.#stopped || this.#socket !== socket) return;
      this.phase = 'connecting';
      // EVERY RECONNECT MINTS ITS OWN TICKET, because a ticket is single-use: reusing one would be
      // refused, and the page would read that as the streamer being down.
      const wait = reconnectDelay(this.#attempt++);
      this.#timer = setTimeout(() => void this.#connect(), wait);
    };
  }

  #control(message: ServerMessage): void {
    if (message.t === 'state') {
      const before = this.tiles[message.id];
      this.tiles = {
        ...this.tiles,
        [message.id]: { mode: message.mode, health: message.health, elided: before?.elided ?? 0 },
      };
      return;
    }
    if (message.t === 'elided') {
      const before = this.tiles[message.id] ?? { mode: 'snapshot' as const, health: BLANK, elided: 0 };
      this.tiles = { ...this.tiles, [message.id]: { ...before, elided: before.elided + message.bytes } };
      return;
    }
    if (message.t === 'error') {
      // AN ERROR FOR ONE TERMINAL IS NOT A DEAD WALL. Only a message with no id is about the socket.
      if (message.id === undefined) this.error = message.message;
      else {
        const before = this.tiles[message.id] ?? { mode: 'error' as const, health: BLANK, elided: 0 };
        this.tiles = { ...this.tiles, [message.id]: { ...before, mode: 'error' } };
        this.error = message.message;
      }
    }
  }

  #binary(buf: ArrayBuffer): void {
    let frame;
    try {
      frame = decodeTagged(buf);
    } catch {
      return;
    }
    this.#sinks.get(frame.id)?.(frame.payload);
  }

  #send(message: { t: 'subscribe'; id: string; cols: number; rows: number } | { t: 'converge'; id: string }): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  /** A tile says where its bytes go and how big it is. Returns its teardown. */
  attach(id: string, sink: (bytes: Uint8Array) => void): () => void {
    this.#sinks.set(id, sink);
    return () => {
      this.#sinks.delete(id);
      this.#geometry.delete(id);
      this.#subscribed.delete(id);
    };
  }

  /**
   * A tile reports the geometry `addon-fit` measured.
   *
   * SENT ONLY WHEN IT CHANGES. A resize fires continuously and the streamer `stty`s what it is told;
   * resubscribing on every pixel would be a request per frame of a drag.
   */
  measured(id: string, cols: number, rows: number): void {
    const before = this.#geometry.get(id);
    if (before?.cols === cols && before.rows === rows) return;
    this.#geometry.set(id, { cols, rows });
    if (this.#subscribed.has(id)) {
      // A RESIZE, not a first subscribe: the streamer re-`stty`s the pane, and the order of these
      // does not matter because each is about one Terminal that is already attached.
      this.#send({ t: 'subscribe', id, cols, rows });
      return;
    }
    this.#flush();
  }

  /**
   * Subscribe every measured tile that has not been asked for yet — IN INVENTORY ORDER.
   *
   * Tiles mount concurrently and their first measurement lands in whatever order the browser
   * happens to lay them out, so a wall of four subscribed in a different sequence on every load.
   * That is not a cosmetic difference: it decides which Machine the streamer attaches first, which
   * is the one an operator sees paint first — and on a fleet under load it is the difference
   * between the tile you are looking at filling in now or in three seconds.
   */
  #flush(): void {
    for (const t of this.terminals) {
      if (this.#subscribed.has(t.id)) continue;
      const size = this.#geometry.get(t.id);
      if (!size) continue;
      this.#subscribed.add(t.id);
      this.#send({ t: 'subscribe', id: t.id, ...size });
    }
  }

  /** Create the tmux session this Terminal names. The only other thing this socket ever writes. */
  converge(id: string): void {
    this.#send({ t: 'converge', id });
  }
}
