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
import {
  loadAttempts, whisperModel, DEFAULT_WHISPER_MODEL, WHISPER_MODELS,
  effectiveModel, modelSwapReason, isEnglishOnly, WHISPER_LANGS, WHISPER_CANNOT_HEAR,
} from "./local-stt";

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

test("a non-English language cannot run on an English-only model", () => {
  // Yoruba on whisper-base.en would transcribe nonsense English.
  expect(effectiveModel("Xenova/whisper-base.en", "yo", false)).toBe("Xenova/whisper-base");
  expect(effectiveModel("Xenova/whisper-tiny.en", "ha", false)).toBe("Xenova/whisper-tiny");
  expect(modelSwapReason("Xenova/whisper-base.en", "yo", false)).toBe("language");
});

test("accented English moves to the all-languages model of the same size", () => {
  expect(effectiveModel("Xenova/whisper-small.en", "en", true)).toBe("Xenova/whisper-small");
  expect(modelSwapReason("Xenova/whisper-small.en", "en", true)).toBe("accent");
});

test("plain English on an English-only model is left alone", () => {
  expect(effectiveModel("Xenova/whisper-base.en", "en", false)).toBe("Xenova/whisper-base.en");
  expect(effectiveModel("Xenova/whisper-base.en", null, false)).toBe("Xenova/whisper-base.en");
  expect(modelSwapReason("Xenova/whisper-base.en", "en", false)).toBeNull();
});

test("a model that is already multilingual is never swapped", () => {
  for (const id of ["Xenova/whisper-base", "onnx-community/whisper-large-v3-turbo"]) {
    expect(effectiveModel(id, "yo", true)).toBe(id);
    expect(modelSwapReason(id, "yo", true)).toBeNull();
  }
});

test("a custom model id is used exactly as typed", () => {
  const custom = "some-org/whisper-small-nigerian-english-onnx";
  expect(effectiveModel(custom, "yo", true)).toBe(custom);
  expect(modelSwapReason(custom, "en", true)).toBeNull();
});

test("English-only models are the ones ending .en", () => {
  expect(isEnglishOnly("Xenova/whisper-base.en")).toBe(true);
  expect(isEnglishOnly("Xenova/whisper-base")).toBe(false);
});

test("every offered language is one Whisper really knows", () => {
  // Guards against adding a language to the picker that the model cannot
  // hear - Igbo and Nigerian Pidgin are the ones people ask for first.
  const codes = WHISPER_LANGS.map((l) => l.code);
  for (const bad of ["ig", "pcm", "tw", "ak", "zu", "xh", "wo"]) {
    expect(codes).not.toContain(bad);
  }
  expect(codes).toContain("yo");
  expect(codes).toContain("ha");
  expect(WHISPER_CANNOT_HEAR).toContain("Igbo");
});
