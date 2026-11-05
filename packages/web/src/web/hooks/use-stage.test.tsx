/**
 * Run with: bun test src/web/hooks/use-stage.test.tsx
 *
 * Guards a bug that shipped.
 *
 * Panels lift their slide list to the stage in an effect, so a cue arriving
 * in the same commit as its own content is handed a slide list one render
 * behind. `preview` was taught to wait for the slides; `goLive` was not, and
 * silently dropped the request. The visible symptom was Auto-Follow set to
 * "Live screen" leaving the passage sitting in Preview, which reads as the
 * setting being ignored.
 */
import { afterAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
});
// React and the live bus read these off the global, so they must be in place
// before either module is imported - hence the dynamic imports below.
const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, document: g.document, navigator: g.navigator };
g.window = dom.window;
g.document = dom.window.document;
if (!g.navigator) g.navigator = dom.window.navigator;
g.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  g.window = saved.window;
  g.document = saved.document;
  if (saved.navigator) g.navigator = saved.navigator;
});

const React = await import("react");
const { act, createElement, useState } = React;
const { createRoot } = await import("react-dom/client");
const { useStage } = await import("./use-stage");
const { DEFAULT_THEME } = await import("../lib/live-bus");

type Stage = ReturnType<typeof useStage>;
type Slide = Parameters<typeof useStage>[0]["slides"][number];

/**
 * A fresh stage per test.
 *
 * The hook keeps live/preview pointers and re-locates the live slide by id
 * across list changes, so tests sharing one mount read each other's state.
 * Each mount also gets its own slide ids for the same reason.
 */
let mounts = 0;
function mount() {
  const tag = `m${mounts++}`;
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);

  let api: Stage = null as unknown as Stage;
  let setSlides: (s: Slide[]) => void = () => {};

  function Host({ slides }: { slides: Slide[] }) {
    api = useStage({ slides, theme: DEFAULT_THEME });
    return null;
  }
  function App() {
    const [slides, set] = useState<Slide[]>([]);
    setSlides = set;
    return createElement(Host, { slides });
  }

  const slide = (n: number, book = "jhn"): Slide =>
    ({
      kind: "bible",
      sourceLines: [`${book} verse ${n}`],
      translationLines: [],
      slideId: `${tag}-${book}-s${n}`,
    }) as Slide;

  return {
    slide,
    get api() { return api; },
    /** Set the list and let the effects settle, as a real commit would. */
    arrive: (count: number | null, book = "jhn") =>
      act(async () =>
        setSlides(count === null ? [] : Array.from({ length: count }, (_, i) => slide(i, book))),
      ),
    arriveWith: (list: Slide[]) => act(async () => setSlides(list)),
    start: () => act(async () => { root.render(createElement(App)); }),
    stop: () => act(async () => { root.unmount(); host.remove(); }),
  };
}

test("going live with the slides already there still works", async () => {
  const s = mount();
  await s.start();
  await s.arrive(3);
  await act(async () => s.api.goLive(1));
  expect(s.api.liveIndex).toBe(1);
  expect(s.api.status).toBe("live");
  await s.stop();
});

test("a live cue whose slides have not arrived is held, not dropped", async () => {
  const s = mount();
  await s.start();
  // Nothing loaded yet, exactly as a tab switch leaves it.
  await act(async () => s.api.goLive(5));
  expect(s.api.liveIndex).toBe(-1);

  // The chapter arrives, the way a panel lifts it one render later.
  await s.arrive(8);
  expect(s.api.liveIndex).toBe(5);
  // Genuinely live, not merely previewed - that was the bug.
  expect(s.api.status).toBe("live");
  expect(s.api.previewIndex).toBe(5);
  await s.stop();
});

test("a held PREVIEW cue still only previews", async () => {
  const s = mount();
  await s.start();
  await act(async () => s.api.preview(3));
  await s.arrive(6);
  expect(s.api.previewIndex).toBe(3);
  // Previewing must never put anything on the screen.
  expect(s.api.status).not.toBe("live");
  expect(s.api.liveIndex).toBe(-1);
  await s.stop();
});

test("a held cue the arriving slides cannot satisfy is forgotten", async () => {
  const s = mount();
  await s.start();
  await act(async () => s.api.goLive(40));
  // A short chapter arrives: 40 is not in it and never will be.
  await s.arrive(2);
  expect(s.api.liveIndex).toBe(-1);
  // And it must not fire against whatever the operator opens next.
  await s.arrive(50);
  expect(s.api.liveIndex).toBe(-1);
  await s.stop();
});

test("the last cue wins when two arrive before the slides do", async () => {
  const s = mount();
  await s.start();
  await act(async () => s.api.preview(2));
  await act(async () => s.api.goLive(4));
  await s.arrive(6);
  expect(s.api.liveIndex).toBe(4);
  expect(s.api.status).toBe("live");
  await s.stop();
});

test("a cue that names its slide waits for that slide, not that position", async () => {
  const s = mount();
  await s.start();
  // Romans is loaded; the operator's cue is for a verse of John, whose
  // slides are one render behind. Index 11 exists in Romans - and is the
  // wrong verse entirely.
  await s.arrive(20, "rom");
  const wanted = s.slide(11, "jhn");
  await act(async () => s.api.goLive(11, wanted.slideId));
  // Nothing went live off the back of the chapter being left.
  expect(s.api.status).not.toBe("live");

  await s.arrive(25, "jhn");
  expect(s.api.liveIndex).toBe(11);
  expect(s.api.status).toBe("live");
  await s.stop();
});

test("a named cue follows its slide even if it moved position", async () => {
  const s = mount();
  await s.start();
  await s.arrive(null);
  const wanted = s.slide(3, "jhn");
  await act(async () => s.api.goLive(3, wanted.slideId));
  // The list arrives with the wanted slide somewhere else entirely - a
  // search result list rather than a whole chapter.
  await s.arriveWith([s.slide(9, "jhn"), wanted, s.slide(1, "jhn")]);
  expect(s.api.liveIndex).toBe(1);
  await s.stop();
});

test("a named cue whose slide never turns up is forgotten, not misfired", async () => {
  const s = mount();
  await s.start();
  await act(async () => s.api.goLive(2, "never-going-to-exist"));
  await s.arrive(10, "rom");
  expect(s.api.status).not.toBe("live");
  // And it must not latch onto the next list either.
  await s.arrive(10, "jhn");
  expect(s.api.status).not.toBe("live");
  await s.stop();
});
