# Idea Collector

Local foot-pedal thought capture for Codex app projects.

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create `.secrets/openai-api-key.txt` and put your OpenAI API key in that file.

3. Optional: copy `config.local.example.json` to `config.local.json` and edit the port or transcription model.

4. Start the HTTPS server:

   ```powershell
   npm.cmd run dev
   ```

5. Scan the QR code from your Android phone. Firefox will require you to accept/trust the local self-signed certificate before microphone capture is available.

## Use

- Calibrate the three foot-pedal keys on the phone from Settings.
- Left and right pedals move between projects and `+ New Project`.
- Hold center to record a thought. Release center to upload and queue transcription.
- Use the Review view on the PC to rename projects, retry failed transcriptions, copy text, and export files.

Exports are written to `exports/codex-thoughts.md` and `exports/codex-thoughts.jsonl`.
