# Higher/Lower

A soft, fast ear-training game: listen to a fixed 440 Hz reference tone, then decide whether the second tone is higher or lower.

The test adapts after every answer, keeps going until five mistakes, and reports how close you got in cents. It can run locally as a static web app, and it is ready to connect to Supabase for shared player results.

## Run Locally

Open `index.html` in a browser, or serve the folder with a local static server:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Shared Results

See `SUPABASE_SETUP.md` to connect a free Supabase project for global stats and submitted runs.
