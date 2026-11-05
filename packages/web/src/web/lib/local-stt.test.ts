/**
 * Run with: bun test src/web/lib/local-stt.test.ts
 *
 * Guards a bug that shipped. v1.24.0 chose the WebGPU backend whenever
 * `navigator.gpu` existed. It exists in Electron 30 (Chromium 124) while
 * `GPUAdapter.info` does not - that arrived in Chromium 131 - and ONNX
 * Runtime reads `adapter.info.subgroupMinSize` while starting its WebGPU
 * backend. So every desktop copy downloaded the entire model and then died
 * with "Cannot read properties of undefined (reading 'subgroupMinSize')".
 */
import { expect, test } from "bun:test";
import { loadAttempts, whisperModel, DEFAULT_WHISPER_MODEL, WHISPER_MODELS } from "./local-stt";

test("no WebGPU at all runs on WASM", () => {
  expect(loadAttempts(null)).toEqual([{ device: "wasm", dtype: "q8" }]);
  expect(loadAttempts(undefined)).toEqual([{ device: "wasm", dtype: "q8" }]);
});

test("an adapter without info is a Chromium too old, so WASM only", () => {
  // Exactly what Electron 30 hands back: a real adapter, no `info`.
  expect(loadAttempts({})).toEqual([{ device: "wasm", dtype: "q8" }]);
  // And `info` present but without the field the backend reads.
  expect(loadAttempts({ info: {} })).toEqual([{ device: "wasm", dtype: "q8" }]);
});

test("an adapter carrying subgroup info may try WebGPU, with WASM behind it", () => {
  expect(loadAttempts({ info: { subgroupMinSize: 4 } })).toEqual([
    { device: "webgpu", dtype: "fp32" },
    { device: "wasm", dtype: "q8" },
  ]);
});

test("WASM is always the last resort, whatever the adapter says", () => {
  for (const adapter of [null, {}, { info: {} }, { info: { subgroupMinSize: 32 } }]) {
    const attempts = loadAttempts(adapter);
    expect(attempts[attempts.length - 1]).toEqual({ device: "wasm", dtype: "q8" });
  }
});

test("an unknown or missing model falls back to the default rather than crashing", () => {
  expect(whisperModel(null).id).toBe(DEFAULT_WHISPER_MODEL);
  expect(whisperModel("something/else").id).toBe(DEFAULT_WHISPER_MODEL);
  expect(whisperModel(WHISPER_MODELS[0].id).id).toBe(WHISPER_MODELS[0].id);
});
