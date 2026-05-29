# Higher/Lower

A soft ear-training game. Listen to a fixed 440 Hz reference tone, then decide whether the second tone is higher or lower.

Play it here:
[https://dadkim0209.github.io/higher-lower/](https://dadkim0209.github.io/higher-lower/)

The test adapts after every answer, runs until five mistakes, and reports how close you got in cents.

## Local

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Data

The app works locally by default. To collect shared results, connect Supabase with `SUPABASE_SETUP.md`.
