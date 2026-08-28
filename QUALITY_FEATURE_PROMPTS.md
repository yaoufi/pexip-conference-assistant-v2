# Quality Metrics Feature — Implementation Prompts

Pass these to Claude Code **in order**. Each builds on the previous one. No manual coding required.

---

## Prompt 1 — Extend types

In `src/types.ts`, add two new interfaces. The first, `MediaStream`, represents a single media stream for a participant and must include these fields from the Pexip Admin API: `type` (string — "video", "audio", "slides"), `rx_codec`, `tx_codec`, `rx_resolution`, `tx_resolution` (all strings), `rx_bitrate`, `tx_bitrate`, `rx_packet_loss`, `tx_packet_loss`, `rx_jitter`, `tx_jitter`, `rx_fps`, `tx_fps` (all numbers). The second interface, `ParticipantMediaData`, groups streams per participant: it contains `display_name` (string) and `streams` (array of `MediaStream`). Also add a `CallQuality` type that is a union of the string literals `'good'`, `'fair'`, `'poor'`, and `'unknown'`.

---

## Prompt 2 — Track participant IDs in the polling loop

In `App.tsx`, add a `useRef` called `confParticipantsRef` that stores a record mapping conference name (string) to an array of objects each containing `id` and `display_name` (both strings). This ref must be populated inside the existing `fetchVmrs` function — after the participant API response is processed, build a map of conference name → participant list from the participant objects returned by `/api/admin/status/v1/participant/?limit=500`. Each participant object from that endpoint has an `id` field and a `display_name` (or `name`) field. Store the result in `confParticipantsRef.current`. This ref is used later for on-demand quality fetching — it must NOT trigger a re-render.

---

## Prompt 3 — Add the fetchQuality function

In `App.tsx`, add an async function called `fetchQuality` that takes a `confName` string and returns a `Promise<ParticipantMediaData[]>`. It should:

1. Read the management node, admin username, and admin password from `localStorage` (using the same keys already used for authentication).
2. Look up the participant list for that conference from `confParticipantsRef.current[confName]`. If there are no participants, return an empty array.
3. For each participant, make a fetch request through the bridge proxy to this Pexip Admin API endpoint: `https://{mgmtNode}/api/admin/status/v1/participant/{participantId}/media_stream/` — using the same `Authorization: Basic ...` header and the same `x-pexip-url` bridge pattern already used elsewhere in the app. Use `Promise.all` to fetch all participants concurrently.
4. Each successful response returns a JSON object with an `objects` array — those are the `MediaStream` entries. Return the result as `ParticipantMediaData[]`, filtering out any failed requests.
5. Wrap individual participant fetches in try/catch and return `null` on failure — filter nulls out before returning.

This function must only be called on demand (never in the polling loop).

---

## Prompt 4 — Wire fetchQuality into VmrList

In `App.tsx`, pass the `fetchQuality` function as a prop called `onFetchQuality` to the `VmrList` component. In `VmrList`'s props interface (in `VmrList.tsx`), add `onFetchQuality?: (confName: string) => Promise<ParticipantMediaData[]>`. Import `ParticipantMediaData` from `../../types`.

---

## Prompt 5 — Add quality state and handlers to VmrList

In `VmrList.tsx`, add the following state:

- `qualityVmrId` — the ID of the VMR currently showing the quality pane (string or null)
- `qualityData` — a record mapping VMR ID to `ParticipantMediaData[]`
- `qualityLoading` — boolean

Add two handlers:

- `handleToggleQuality(vmr)` — if the quality pane is already open for this VMR, close it. Otherwise, set `qualityVmrId` to the VMR's ID and, if `onFetchQuality` is provided, call it with the VMR's `name` and store the result in `qualityData`. Show a loading state while fetching.
- `handleRefreshQuality(vmr)` — call `onFetchQuality` again for the same VMR and update `qualityData`. Show loading state.

---

## Prompt 6 — Build the QualityPanel component

Inside `VmrList.tsx`, create a local component called `QualityPanel` that receives `data: ParticipantMediaData[]` and `loading: boolean`.

- If `loading` is true, show a loading message.
- If `data` is empty, show a "No data" message with a prompt to click Refresh.
- Otherwise, render an HTML table with these 11 columns: **Participant**, **Stream**, **Quality**, **RX Res**, **TX Res**, **RX Loss**, **TX Loss**, **RX Jitter**, **TX Jitter**, **Bitrate**, **Codec**.
- Filter out audio streams and any stream where `rx_resolution` is empty — only show video and presentation streams.
- For streams where the participant has multiple video streams, merge the "Participant" cell using `rowSpan`.
- The **Stream** column shows "Video" or "Presentation" based on the stream `type` field.
- The **Quality** column shows a coloured dot (green/yellow/red) and a label ("Good", "Fair", "Poor") computed from these thresholds: packet loss above 3% OR jitter above 60 ms = Poor; above 1% OR above 30 ms = Fair; otherwise Good. Use the worst of RX and TX for the overall quality rating.
- Format packet loss as a percentage. Format jitter to 3 decimal places with "ms" suffix — show "—" only when the value is null or undefined, not when it is zero. Show "0%" and "0.000ms" for genuinely zero values.
- **Codec**: map the raw API value `"off_stage"` (and variants like `"offstage"`, `"off stage"`) to the display label `"WebRTC"`. Pass other values through unchanged.
- Highlight packet loss cells in red when above 3%, yellow when above 1%. Same for jitter cells at 60 ms / 30 ms thresholds.
- Bitrate shows the `rx_bitrate` value with " kbps" suffix.
- The table must be placed inside a horizontally scrollable container so all 11 columns are accessible on narrow screens.

---

## Prompt 7 — Add the Quality button and pane to each VMR card

In `VmrList.tsx`, inside the card render loop:

- Add a "Quality" button to the right-side action buttons of each VMR card. Only render it if `onFetchQuality` is defined. The button should have an "active" visual state when the quality pane is open for that VMR.
- Below the main card row, conditionally render a quality pane div when `qualityVmrId === vmr.id`. Inside it, render a toolbar row containing the label "Media Streams" and a "Refresh" button, followed by the `QualityPanel` component passing the current data and loading state.

---

## Prompt 8 — Add styles for the quality panel

In `VmrList.scss` (or the equivalent stylesheet), add styles for:

- `.VmrCard__quality-pane` — dark background, padding, `overflow-x: auto` so the table scrolls horizontally
- `.QualityPane__toolbar` — flex row, space-between, with bottom margin
- `.QualityPane__title` — small uppercase label
- `.QualityTable` — full-width borderless table, small font. Header cells: uppercase, muted colour, small font, bottom border, no text wrap. Data cells: muted white colour, no text wrap, thin bottom border row separator
- `.QualityTable .stat--poor` — red text
- `.QualityTable .stat--fair` — amber/yellow text
- `.QualityDot` — small inline circle (7px), `border-radius: 50%`, with four variants: `--good` green with glow, `--fair` amber with glow, `--poor` red with glow, `--unknown` muted grey
- `.QualityPanel__empty` — centred muted text for loading/empty states
