# Hosting the Auto-Follow speech models yourself

Vifug's **On this machine** recognition engine downloads a Whisper model the
first time Auto-Follow starts and keeps it in the browser cache from then on.
By default it fetches from `huggingface.co`.

Host them yourself when:

- the church network blocks `huggingface.co`,
- several machines need the model and you would rather download it once,
- or you want the files on a server you control.

Once hosted, put the base URL into **Settings → AI auto-follow → Model host**.
Leave that box empty to use Hugging Face.

---

## 1. Pick a model

| Setting in Vifug | Repository to download | Size |
| --- | --- | --- |
| Tiny (English) | `Xenova/whisper-tiny.en` | ~40 MB |
| Tiny (all languages) | `Xenova/whisper-tiny` | ~40 MB |
| Base (English) | `Xenova/whisper-base.en` | ~80 MB |
| Base (all languages) | `Xenova/whisper-base` | ~80 MB |
| Small (English) | `Xenova/whisper-small.en` | ~250 MB |
| Small (all languages) | `Xenova/whisper-small` | ~250 MB |
| Large v3 Turbo | `onnx-community/whisper-large-v3-turbo` | ~800 MB |

## 2. Download it

With `git` and Git LFS:

```bash
git lfs install
git clone https://huggingface.co/Xenova/whisper-base.en
```

Or without git, using Hugging Face's own CLI:

```bash
pip install -U "huggingface_hub[cli]"
hf download Xenova/whisper-base.en --local-dir ./whisper-base.en
```

Either way you end up with a folder containing `config.json`,
`tokenizer.json`, `preprocessor_config.json` and an `onnx/` directory.

### Trim it before uploading

A repository holds every quantisation. Vifug asks for **q8** on WASM and
**fp32** on WebGPU, so these are the only model files it will ever request:

```
onnx/encoder_model_quantized.onnx
onnx/decoder_model_merged_quantized.onnx
onnx/encoder_model.onnx
onnx/decoder_model_merged.onnx
```

Deleting the rest of `onnx/` typically cuts the upload by more than half.
Keep every JSON file at the top level — the tokenizer and preprocessor
configs are small and all of them are needed.

## 3. Lay the files out

The host must serve each repository at its **full name**, exactly as Hugging
Face does:

```
https://your-host.example/Xenova/whisper-base.en/config.json
https://your-host.example/Xenova/whisper-base.en/tokenizer.json
https://your-host.example/Xenova/whisper-base.en/preprocessor_config.json
https://your-host.example/Xenova/whisper-base.en/onnx/encoder_model_quantized.onnx
https://your-host.example/Xenova/whisper-base.en/onnx/decoder_model_merged_quantized.onnx
```

You would then enter `https://your-host.example` as the model host.

## 4. Serve it

Any static host works. Two requirements:

- **CORS.** The browser fetches these from Vifug's own origin, so the host
  must send `Access-Control-Allow-Origin: *` (or your Vifug origin).
- **Correct byte serving.** `.onnx` files must come back whole and
  uncompressed. Serving them as `application/octet-stream` is fine.

A minimal nginx block:

```nginx
location /models/ {
    alias /srv/whisper-models/;
    add_header Access-Control-Allow-Origin "*" always;
    types { application/octet-stream onnx; application/json json; }
}
```

Host set to `https://your-host.example/models`.

For a church hall with no internet at all, the same folder served off the
machine itself works — `python3 -m http.server 8080` in the parent directory,
host set to `http://localhost:8080`.

## 5. Check it

Before a service, open **Settings → AI auto-follow**, choose **On this
machine**, pick the model, then turn Auto-Follow on with a slide live. The
progress bar should appear and fill. If it reports that it could not reach
the model host, open one of the URLs above in a browser tab — a 404 means the
layout is wrong, and a CORS error in the console means the header is missing.

Once it has downloaded, it is in the browser cache and the service itself
needs no network at all.

---

# Using a model trained for your accent or language

The models in the dropdown are general-purpose. A model fine-tuned on the
speech you actually have — Nigerian-accented English, Yoruba, Hausa — will
beat a general one of the same size at it, often by a wide margin.

Choose **Another model from Hugging Face…** in the model dropdown and paste
the repository id. Vifug uses it exactly as typed.

## It has to be ONNX

Vifug runs models in the browser through ONNX Runtime. A model published as
ordinary PyTorch weights (`pytorch_model.bin`, `model.safetensors` and
nothing else) **will not load**. What it needs is an `onnx/` folder beside
the usual JSON config files:

```
config.json
tokenizer.json
tokenizer_config.json
preprocessor_config.json
generation_config.json
onnx/encoder_model.onnx
onnx/decoder_model_merged.onnx
onnx/encoder_model_quantized.onnx          ← used on CPU
onnx/decoder_model_merged_quantized.onnx   ← used on CPU
```

Most repositories under the `onnx-community` and `Xenova` accounts are
already in this shape. Anything else, you convert.

## Converting one yourself

With Hugging Face's Optimum exporter:

```bash
pip install -U "optimum[exporters]" onnxruntime
optimum-cli export onnx \
  --model <org>/<their-whisper-fine-tune> \
  --task automatic-speech-recognition-with-past \
  ./my-whisper-onnx
```

The `-with-past` task matters: without it the decoder is exported without
its key/value cache and transcription crawls.

That gives you the full-precision files. Vifug asks for the quantised ones
on CPU, which is every machine without a recent graphics card, so quantise
them too — `onnxruntime.quantization` or the conversion script in the
`transformers.js` repository will do it — and name them
`*_quantized.onnx` alongside the originals.

Then either push the folder to a Hugging Face repository of your own and
paste that id, or serve it from your own host as described above and set
**Model host** to point at it.

## Languages Whisper cannot hear

Whisper was trained on 99 languages. Among those spoken in Nigerian and
other African churches it knows **Yoruba, Hausa, Swahili, Amharic, Somali,
Shona, Lingala, Malagasy and Afrikaans**.

It does **not** know **Igbo, Nigerian Pidgin or Twi**, and no setting
changes that — the model never saw them. Vifug ships Bibles in those
languages, so they can still be put on screen by hand or cued from a
service plan; only the listening part is unavailable. A community
fine-tune for one of them, exported to ONNX as above, is the way in if one
exists.
