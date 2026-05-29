const els = {
  themeColor: document.querySelector("meta[name='theme-color']"),
  play: document.querySelector("#play-button"),
  lower: document.querySelector("#lower-button"),
  higher: document.querySelector("#higher-button"),
  trialCount: document.querySelector("#trial-count"),
  currentGap: document.querySelector("#current-gap"),
  scoreCount: document.querySelector("#score-count"),
  mistakeCount: document.querySelector("#mistake-count"),
  stageCopy: document.querySelector("#stage-copy"),
  threshold: document.querySelector("#threshold"),
  resultBand: document.querySelector("#result-band"),
  percentile: document.querySelector("#percentile"),
  closestCorrect: document.querySelector("#closest-correct"),
  finalGap: document.querySelector("#final-gap"),
  accuracyDetail: document.querySelector("#accuracy-detail"),
  meterFill: document.querySelector("#meter-fill"),
  history: document.querySelector("#history-list"),
  syncStatus: document.querySelector("#sync-status"),
  globalRuns: document.querySelector("#global-runs"),
  globalBest: document.querySelector("#global-best"),
  globalBestName: document.querySelector("#global-best-name"),
  globalTypical: document.querySelector("#global-typical"),
  nameForm: document.querySelector("#name-form"),
  playerName: document.querySelector("#player-name"),
  submitScore: document.querySelector("#submit-score"),
  toneType: document.querySelector("#tone-type"),
  theme: document.querySelector("#theme-toggle"),
  dots: [document.querySelector("#dot-one"), document.querySelector("#dot-two")],
};

const REFERENCE_FREQUENCY = 440;
const MAX_MISTAKES = 5;
const supabaseConfig = window.PITCHLINE_SUPABASE || {};

const state = {
  audio: null,
  trial: null,
  trialNumber: 0,
  correct: 0,
  mistakes: 0,
  gapCents: 100,
  reversals: [],
  lastDirection: null,
  answeredGaps: [],
  history: JSON.parse(localStorage.getItem("pitchline-history") || "[]"),
  playing: false,
  finished: false,
  autoPlayTimer: null,
  playerId: getPlayerId(),
  pendingRecord: null,
  audioUnlocked: false,
};

function centsToRatio(cents) {
  return Math.pow(2, cents / 1200);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatCents(value) {
  if (!Number.isFinite(value)) return "--";
  if (value < 0.001) return `${value.toExponential(2)} cents`;
  if (value < 1) return `${value.toFixed(3)} cents`;
  if (value < 10) return `${value.toFixed(2)} cents`;
  return `${value.toFixed(1)} cents`;
}

function getPlayerId() {
  const existing = localStorage.getItem("pitchline-player-id");
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("pitchline-player-id", id);
  return id;
}

function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

function supabaseEndpoint(path, query = "") {
  return `${supabaseConfig.url.replace(/\/$/, "")}/rest/v1/${path}${query}`;
}

function setSyncStatus(text, mode = "") {
  els.syncStatus.textContent = text;
  els.syncStatus.className = mode;
}

function sanitizeName(name) {
  return name.trim().replace(/\s+/g, " ").slice(0, 24);
}

function setNameFormVisible(visible) {
  els.nameForm.hidden = !visible;
  els.submitScore.disabled = !visible;
}

function getTonePeakGain() {
  switch (els.toneType.value) {
    case "sine":
      return 0.34;
    case "triangle":
      return 0.28;
    case "square":
      return 0.16;
    default:
      return 0.24;
  }
}

function getAudio() {
  if (!state.audio || state.audio.state === "closed") {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audio = new AudioContextClass();
  }
  return state.audio;
}

async function resumeAudio() {
  const ctx = getAudio();
  if (ctx.state !== "running") {
    await ctx.resume();
  }
  return ctx;
}

async function unlockAudio() {
  if (state.audioUnlocked) return;

  try {
    const ctx = await resumeAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;

    gain.gain.setValueAtTime(0.0001, start);
    osc.frequency.setValueAtTime(REFERENCE_FREQUENCY, start);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.01);
    state.audioUnlocked = true;
  } catch (error) {
    console.warn("Audio unlock failed", error);
  }
}

function scheduleTone(ctx, frequency, startTime, dotIndex) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const peakGain = getTonePeakGain();
  osc.type = els.toneType.value;
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.035);
  gain.gain.setValueAtTime(peakGain, startTime + 0.34);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.43);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + 0.46);

  const delay = Math.max(0, (startTime - ctx.currentTime) * 1000);
  window.setTimeout(() => els.dots[dotIndex].classList.add("active"), delay);
  window.setTimeout(() => els.dots[dotIndex].classList.remove("active"), delay + 430);
}

function makeTrial() {
  const isHigher = Math.random() > 0.5;
  const secondFrequency = isHigher
    ? REFERENCE_FREQUENCY * centsToRatio(state.gapCents)
    : REFERENCE_FREQUENCY / centsToRatio(state.gapCents);

  state.trial = {
    baseFrequency: REFERENCE_FREQUENCY,
    secondFrequency,
    answer: isHigher ? "higher" : "lower",
    gapCents: state.gapCents,
  };
}

function updateDisplay() {
  els.trialCount.textContent = `${state.trialNumber}`;
  els.currentGap.textContent = state.finished ? "--" : formatCents(state.trial?.gapCents ?? state.gapCents);
  els.scoreCount.textContent = `${state.correct}`;
  els.mistakeCount.textContent = `${state.mistakes} / ${MAX_MISTAKES}`;
  renderHistory();
}

function setAnswerEnabled(enabled) {
  els.lower.disabled = !enabled;
  els.higher.disabled = !enabled;
}

async function playTrial() {
  if (state.playing) return;
  if (state.finished) resetRun();
  if (!state.trial) makeTrial();
  clearAutoPlay();

  let ctx;
  try {
    ctx = await resumeAudio();
  } catch (error) {
    console.warn("Audio resume failed", error);
    els.stageCopy.textContent = "Tap play again to enable sound.";
    els.play.disabled = false;
    setAnswerEnabled(false);
    return;
  }

  if (ctx.state !== "running") {
    els.stageCopy.textContent = "Tap play again to enable sound.";
    els.play.disabled = false;
    setAnswerEnabled(false);
    return;
  }

  state.audioUnlocked = true;
  state.playing = true;
  els.play.disabled = true;
  setAnswerEnabled(false);
  els.stageCopy.textContent = "Listen closely.";

  const now = ctx.currentTime + 0.08;
  scheduleTone(ctx, state.trial.baseFrequency, now, 0);
  scheduleTone(ctx, state.trial.secondFrequency, now + 0.78, 1);

  window.setTimeout(() => {
    state.playing = false;
    els.play.disabled = false;
    setAnswerEnabled(true);
    els.stageCopy.textContent = "Was the second tone higher or lower?";
  }, 1420);
}

function clearAutoPlay() {
  if (!state.autoPlayTimer) return;
  window.clearTimeout(state.autoPlayTimer);
  state.autoPlayTimer = null;
}

function queueNextTrial() {
  clearAutoPlay();
  state.autoPlayTimer = window.setTimeout(() => {
    state.autoPlayTimer = null;
    if (!state.finished && !state.playing) {
      playTrial();
    }
  }, 650);
}

function resetRun() {
  clearAutoPlay();
  state.trial = null;
  state.trialNumber = 0;
  state.correct = 0;
  state.mistakes = 0;
  state.gapCents = 100;
  state.reversals = [];
  state.lastDirection = null;
  state.answeredGaps = [];
  state.finished = false;
  state.pendingRecord = null;
  els.threshold.textContent = "Not enough data";
  els.resultBand.textContent = "No run yet";
  els.percentile.textContent = "Finish a run to see how fine your ear is.";
  els.closestCorrect.textContent = "--";
  els.finalGap.textContent = "--";
  els.accuracyDetail.textContent = "--";
  els.playerName.value = localStorage.getItem("higher-lower-display-name") || "";
  setNameFormVisible(false);
  els.meterFill.style.width = "0";
  els.stageCopy.textContent = "Press play, listen to the 440 Hz reference, then choose whether the second tone is higher or lower.";
  updateDisplay();
}

function adaptDifficulty(wasCorrect) {
  const direction = wasCorrect ? "down" : "up";
  if (state.lastDirection && state.lastDirection !== direction) {
    state.reversals.push(state.trial.gapCents);
  }
  state.lastDirection = direction;

  const factor = wasCorrect ? 0.78 : 1.34;
  state.gapCents = wasCorrect ? state.gapCents * factor : Math.min(state.gapCents * factor, 300);
}

function answer(choice) {
  if (!state.trial || state.playing || state.finished) return;
  clearAutoPlay();

  const wasCorrect = choice === state.trial.answer;
  state.trialNumber += 1;
  state.correct += wasCorrect ? 1 : 0;
  state.mistakes += wasCorrect ? 0 : 1;
  state.answeredGaps.push({ gap: state.trial.gapCents, correct: wasCorrect });

  els[choice].classList.add(wasCorrect ? "correct" : "incorrect");
  window.setTimeout(() => els[choice].classList.remove("correct", "incorrect"), 420);

  els.stageCopy.textContent = wasCorrect ? "Correct." : `Not quite. The second tone was ${state.trial.answer}.`;
  adaptDifficulty(wasCorrect);
  state.trial = null;
  setAnswerEnabled(false);

  if (state.mistakes >= MAX_MISTAKES) {
    finishRun();
  } else {
    queueNextTrial();
  }

  updateDisplay();
}

function estimateThreshold() {
  const reversalSet = state.reversals.slice(-8);
  const source = reversalSet.length >= 4 ? reversalSet : state.answeredGaps.slice(-10).map((entry) => entry.gap);
  const average = source.reduce((sum, gap) => sum + gap, 0) / source.length;
  return average || state.gapCents;
}

function percentileFromThreshold(threshold) {
  const min = 5;
  const max = 190;
  const normalized = 1 - (Math.log(threshold) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.round(clamp(normalized, 0.02, 0.98) * 100);
}

function describeThreshold(threshold) {
  if (threshold <= 5) return "Elite ear";
  if (threshold <= 15) return "Excellent ear";
  if (threshold <= 35) return "Strong ear";
  if (threshold <= 90) return "Typical ear";
  return "Broad ear";
}

function ordinal(value) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function finishRun() {
  clearAutoPlay();
  const threshold = estimateThreshold();
  const percentile = percentileFromThreshold(threshold);
  const accuracy = Math.round((state.correct / state.trialNumber) * 100);
  const correctGaps = state.answeredGaps.filter((entry) => entry.correct).map((entry) => entry.gap);
  const closestCorrect = correctGaps.length ? Math.min(...correctGaps) : null;
  const finalAnsweredGap = state.answeredGaps.at(-1)?.gap ?? threshold;
  const record = {
    threshold: Number(threshold.toPrecision(6)),
    band: describeThreshold(threshold),
    percentile,
    accuracy,
    attempts: state.trialNumber,
    mistakes: state.mistakes,
    closestCorrect: closestCorrect === null ? null : Number(closestCorrect.toPrecision(6)),
    finalGap: Number(finalAnsweredGap.toPrecision(6)),
    date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };

  state.history.unshift(record);
  state.history = state.history.slice(0, 6);
  localStorage.setItem("pitchline-history", JSON.stringify(state.history));

  els.threshold.textContent = formatCents(threshold);
  els.resultBand.textContent = describeThreshold(threshold);
  els.percentile.textContent = `You could reliably tell pitches apart at about ${formatCents(threshold)}. You lasted ${state.trialNumber} attempts with ${accuracy}% correct, around the ${ordinal(percentile)} percentile on this provisional reference curve.`;
  els.closestCorrect.textContent = closestCorrect === null ? "No correct answers" : formatCents(closestCorrect);
  els.finalGap.textContent = formatCents(finalAnsweredGap);
  els.accuracyDetail.textContent = `${state.correct} / ${state.trialNumber}`;
  els.meterFill.style.width = `${percentile}%`;
  els.stageCopy.textContent = "Five mistakes reached. Press play to start a new run.";
  state.finished = true;
  state.pendingRecord = record;
  setNameFormVisible(true);
  renderHistory();
}

function getDeviceType() {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 720 ? "mobile" : "desktop";
}

async function submitResult(record, displayName) {
  if (!isSupabaseConfigured()) return;
  setSyncStatus("Saving", "");
  els.submitScore.disabled = true;

  const payload = {
    player_id: state.playerId,
    threshold_cents: record.threshold,
    closest_correct_cents: record.closestCorrect,
    final_gap_cents: record.finalGap,
    attempts: record.attempts,
    correct: state.correct,
    mistakes: record.mistakes,
    accuracy: record.accuracy,
    percentile: record.percentile,
    band: record.band,
    display_name: displayName,
    tone_type: els.toneType.value,
    device_type: getDeviceType(),
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  };

  try {
    const response = await fetch(supabaseEndpoint("pitch_results"), {
      method: "POST",
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${supabaseConfig.anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Supabase insert failed: ${response.status}`);
    setSyncStatus("Saved", "online");
    setNameFormVisible(false);
    state.pendingRecord = null;
    loadGlobalStats();
  } catch (error) {
    console.warn(error);
    setSyncStatus("Save failed", "error");
    els.submitScore.disabled = false;
  }
}

async function loadGlobalStats() {
  if (!isSupabaseConfigured()) {
    setSyncStatus("Local only");
    return;
  }

  try {
    let response = await fetch(
      supabaseEndpoint("pitch_results", "?select=threshold_cents,display_name&order=threshold_cents.asc&limit=5000"),
      {
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${supabaseConfig.anonKey}`,
        },
      },
    );

    if (response.status === 400) {
      response = await fetch(supabaseEndpoint("pitch_results", "?select=threshold_cents&order=threshold_cents.asc&limit=5000"), {
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${supabaseConfig.anonKey}`,
        },
      });
    }

    if (!response.ok) throw new Error(`Supabase select failed: ${response.status}`);
    const rows = await response.json();
    const thresholds = rows.map((row) => row.threshold_cents).filter(Number.isFinite);

    if (!thresholds.length) {
      els.globalRuns.textContent = "0";
      els.globalBest.textContent = "--";
      els.globalBestName.textContent = "--";
      els.globalTypical.textContent = "--";
      setSyncStatus("Connected", "online");
      return;
    }

    const middle = Math.floor(thresholds.length / 2);
    const typical =
      thresholds.length % 2 === 0 ? (thresholds[middle - 1] + thresholds[middle]) / 2 : thresholds[middle];

    els.globalRuns.textContent = `${thresholds.length}`;
    els.globalBest.textContent = formatCents(thresholds[0]);
    els.globalBestName.textContent = rows[0]?.display_name || "Anonymous";
    els.globalTypical.textContent = formatCents(typical);
    setSyncStatus("Connected", "online");
  } catch (error) {
    console.warn(error);
    setSyncStatus("Offline", "error");
  }
}

function handleNameSubmit(event) {
  event.preventDefault();
  if (!state.pendingRecord) return;

  const displayName = sanitizeName(els.playerName.value);
  if (!displayName) {
    els.playerName.focus();
    return;
  }

  localStorage.setItem("higher-lower-display-name", displayName);
  els.playerName.blur();
  submitResult(state.pendingRecord, displayName);
}

function renderHistory() {
  if (!state.history.length) {
    els.history.innerHTML = "<li>No completed runs yet.</li>";
    return;
  }

  els.history.innerHTML = state.history
    .map((item) => {
      const attempts = item.attempts ? `, ${item.attempts} attempts` : "";
      const closest = item.closestCorrect ? `, closest ${formatCents(item.closestCorrect)}` : "";
      return `<li>${item.date}: ${formatCents(item.threshold)}, ${item.accuracy}% correct${attempts}${closest}, ${ordinal(item.percentile)} percentile</li>`;
    })
    .join("");
}

function handleShortcut(event) {
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "SELECT" || activeTag === "INPUT" || activeTag === "TEXTAREA") return;

  const key = event.key.toLowerCase();
  if (key === " " || key === "spacebar") {
    event.preventDefault();
    if (!event.repeat) playTrial();
    return;
  }

  if (event.repeat) return;

  if (key === "arrowup" || key === "u") {
    event.preventDefault();
    answer("higher");
  }

  if (key === "arrowdown" || key === "d") {
    event.preventDefault();
    answer("lower");
  }
}

function applyThemePreference() {
  const savedTheme = localStorage.getItem("pitchline-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark = savedTheme ? savedTheme === "dark" : prefersDark;
  document.body.classList.toggle("dark", useDark);
  els.themeColor.setAttribute("content", useDark ? "#171918" : "#f6f2ea");
}

els.play.addEventListener("click", playTrial);
els.lower.addEventListener("click", () => answer("lower"));
els.higher.addEventListener("click", () => answer("higher"));
els.nameForm.addEventListener("submit", handleNameSubmit);
document.addEventListener("keydown", handleShortcut);
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("touchend", unlockAudio, { once: true });
els.theme.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("pitchline-theme", document.body.classList.contains("dark") ? "dark" : "light");
});
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
if (colorSchemeQuery.addEventListener) {
  colorSchemeQuery.addEventListener("change", applyThemePreference);
} else {
  colorSchemeQuery.addListener(applyThemePreference);
}

applyThemePreference();

els.playerName.value = localStorage.getItem("higher-lower-display-name") || "";
updateDisplay();
loadGlobalStats();
