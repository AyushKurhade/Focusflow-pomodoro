(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const STORAGE_KEY = "focusflow-upgrade-v2";
  const MODE_KEYS = ["focus", "short", "long"];
  const DEFAULT_DURATIONS = { focus: 25, short: 5, long: 15 };

  const localDateKey = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const dateFromKey = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  };
  const shiftDate = (date, days) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };
  const defaultData = () => ({
    version: 2,
    theme: "light",
    sound: true,
    autoBreak: false,
    autoFocus: false,
    goalMinutes: 120,
    durations: { ...DEFAULT_DURATIONS },
    tasks: [],
    days: {},
  });

  let data = loadData();
  let mode = "focus";
  let running = false;
  let deadline = null;
  let remainingSeconds = getDuration("focus");
  let ticker = null;
  let toastTimeout = null;
  let audioContext = null;

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") return defaultData();
      const defaults = defaultData();
      return {
        ...defaults,
        ...saved,
        durations: { ...defaults.durations, ...(saved.durations || {}) },
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        days: saved.days && typeof saved.days === "object" ? saved.days : {},
      };
    } catch {
      return defaultData();
    }
  }
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      showToast(
        "Storage is full or unavailable. Your latest changes may not persist.",
      );
    }
  }
  function ensureToday() {
    const key = localDateKey();
    if (!data.days[key])
      data.days[key] = {
        focusSeconds: 0,
        sessions: 0,
        goalReached: false,
        taskSessions: {},
      };
    const day = data.days[key];
    day.focusSeconds = Math.max(0, Number(day.focusSeconds) || 0);
    day.sessions = Math.max(0, Number(day.sessions) || 0);
    day.taskSessions ||= {};
    return day;
  }
  function getDuration(key) {
    const minutes = Number(data.durations?.[key] || DEFAULT_DURATIONS[key]);
    return Math.max(1, Math.min(180, minutes)) * 60;
  }
  function totalFocusSeconds(key) {
    return Math.max(0, Number(data.days[key]?.focusSeconds) || 0);
  }
  function totalSessions(key) {
    return Math.max(0, Number(data.days[key]?.sessions) || 0);
  }
  function allDateKeys() {
    return Object.keys(data.days).sort();
  }
  function formatClock(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  function formatMinutes(seconds, short = false) {
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}h ${rest}m`;
    if (hours) return `${hours}h`;
    return short ? `${minutes}m` : `${minutes} min`;
  }
  function formatDate(
    key,
    options = { weekday: "short", month: "short", day: "numeric" },
  ) {
    return new Intl.DateTimeFormat("en-IN", options).format(dateFromKey(key));
  }
  function showToast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => node.classList.remove("show"), 2800);
  }
  function applyTheme() {
    document.documentElement.dataset.theme =
      data.theme === "dark" ? "dark" : "light";
    $("#theme-toggle").textContent = data.theme === "dark" ? "☀" : "☾";
    $("#theme-toggle").setAttribute(
      "aria-label",
      data.theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
    );
    document.querySelector('meta[name="theme-color"]').content =
      data.theme === "dark" ? "#111318" : "#ffffff";
  }
  function renderDate() {
    $("#today-label").textContent =
      `Today · ${formatDate(localDateKey(), { weekday: "short", month: "short", day: "numeric" })}`;
  }
  function renderStats() {
    const today = ensureToday();
    const percent =
      data.goalMinutes > 0
        ? Math.floor((today.focusSeconds / (data.goalMinutes * 60)) * 100)
        : 0;
    $("#focus-total").textContent = formatMinutes(today.focusSeconds, true);
    $("#sessions-total").textContent = today.sessions;
    $("#progress-total").textContent = `${percent}%`;
    $("#goal-progress").style.width = `${Math.min(100, percent)}%`;
    $("#goal-caption").textContent =
      percent >= 100
        ? "Daily goal reached — excellent work."
        : `${Math.max(0, data.goalMinutes - Math.floor(today.focusSeconds / 60))} min to your daily goal`;
    $("#goal-select").value = String(data.goalMinutes);
  }
  function renderTimer() {
    const total = getDuration(mode);
    const progress = Math.max(
      0,
      Math.min(1, (total - remainingSeconds) / total),
    );
    $("#timer").textContent = formatClock(remainingSeconds);
    $("#timer-emoji").textContent =
      mode === "focus" ? "🍅" : mode === "short" ? "☕" : "🌿";
    $("#timer-status").textContent = running
      ? mode === "focus"
        ? "Stay focused..."
        : "Enjoy your break..."
      : remainingSeconds === total
        ? mode === "focus"
          ? "Ready to focus?"
          : "Take a breather."
        : "Paused — resume when ready.";
    $("#timer-badge").innerHTML =
      `<span class="live-dot"></span> ${running ? "Running" : "Ready"}`;
    $("#timer-circle").style.setProperty(
      "--timer-progress",
      `${progress * 360}deg`,
    );
    $("#start-btn").textContent = running
      ? "Ⅱ Pause"
      : remainingSeconds === total
        ? `▶ Start ${mode === "focus" ? "focus" : "break"}`
        : "▶ Resume";
    $$(".mode-btn").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const count = ensureToday().sessions;
    const inCycle = count % 4;
    $$("#session-dots span").forEach((dot, index) => {
      dot.classList.toggle("done", index < inCycle);
      dot.classList.toggle("active", index === inCycle);
    });
    $("#session-label").textContent = `Session ${inCycle + 1} of 4`;
    document.title = running
      ? `${formatClock(remainingSeconds)} · FocusFlow`
      : "FocusFlow — Make time for what matters";
  }
  function renderTasks() {
    const list = $("#task-list");
    const done = data.tasks.filter((task) => task.completed).length;
    $("#task-count").textContent =
      `${data.tasks.length} ${data.tasks.length === 1 ? "task" : "tasks"}`;
    $("#task-summary").textContent = data.tasks.length
      ? `${done} of ${data.tasks.length} completed`
      : "Small steps lead to big results.";
    const selected = $("#session-task").value;
    $("#session-task").replaceChildren(new Option("No task selected", ""));
    data.tasks.forEach((task) => {
      const label = `${task.completed ? "✓ " : ""}${task.name}`;
      $("#session-task").add(new Option(label, task.id));
    });
    if (data.tasks.some((task) => task.id === selected))
      $("#session-task").value = selected;

    list.replaceChildren();
    if (!data.tasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        "<span>📝</span><p>No tasks yet</p><small>Add your first study task above.</small>";
      list.append(empty);
      return;
    }
    data.tasks.forEach((task) => {
      const item = document.createElement("div");
      item.className = `task-item${task.completed ? " completed" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-checkbox";
      checkbox.checked = Boolean(task.completed);
      checkbox.setAttribute("aria-label", `Complete ${task.name}`);
      checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        saveData();
        renderTasks();
      });
      const nameWrap = document.createElement("div");
      nameWrap.className = "task-name";
      const name = document.createElement("span");
      name.textContent = task.name;
      nameWrap.append(name);
      const sessions = Object.values(data.days).reduce(
        (sum, day) => sum + Number(day.taskSessions?.[task.id] || 0),
        0,
      );
      const meta = document.createElement("small");
      meta.className = "task-meta";
      meta.textContent = `${sessions} focus ${sessions === 1 ? "session" : "sessions"}`;
      nameWrap.append(meta);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${task.name}`);
      remove.addEventListener("click", () => {
        data.tasks = data.tasks.filter((entry) => entry.id !== task.id);
        saveData();
        renderTasks();
      });
      item.append(checkbox, nameWrap, remove);
      list.append(item);
    });
  }
  function stopTicker() {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  }
  function chooseMode(nextMode, { autoStart = false } = {}) {
    if (!MODE_KEYS.includes(nextMode)) return;
    stopTicker();
    running = false;
    deadline = null;
    mode = nextMode;
    remainingSeconds = getDuration(mode);
    renderTimer();
    if (autoStart) startTimer();
  }
  function startTimer() {
    if (running) {
      tick();
      if (!running) return;
      remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      stopTicker();
      running = false;
      deadline = null;
      renderTimer();
      return;
    }
    if (remainingSeconds <= 0) remainingSeconds = getDuration(mode);
    running = true;
    deadline = Date.now() + remainingSeconds * 1000;
    stopTicker();
    ticker = setInterval(tick, 250);
    renderTimer();
  }
  function tick() {
    if (!running || deadline === null) return;
    remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remainingSeconds <= 0) {
      completeSession();
      return;
    }
    renderTimer();
  }
  function resetTimer() {
    stopTicker();
    running = false;
    deadline = null;
    remainingSeconds = getDuration(mode);
    renderTimer();
  }
  function skipTimer() {
    stopTicker();
    running = false;
    deadline = null;
    if (mode === "focus") chooseMode("short");
    else chooseMode("focus");
    showToast("Session skipped. No study time was added.");
  }
  function playSound() {
    if (!data.sound) return;
    try {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextType) return;
      audioContext ||= new AudioContextType();
      if (audioContext.state === "suspended")
        audioContext.resume().catch(() => {});
      [660, 880].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + index * 0.16;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.32);
      });
    } catch {
      /* Audio is optional; the timer must still work. */
    }
  }
  function completeSession() {
    const finishedMode = mode;
    stopTicker();
    running = false;
    deadline = null;
    remainingSeconds = 0;
    if (finishedMode === "focus") {
      const today = ensureToday();
      const selectedTask = $("#session-task").value;
      today.focusSeconds += getDuration("focus");
      today.sessions += 1;
      if (selectedTask && data.tasks.some((task) => task.id === selectedTask)) {
        today.taskSessions[selectedTask] =
          Number(today.taskSessions[selectedTask] || 0) + 1;
      }
      today.goalReached = today.focusSeconds >= data.goalMinutes * 60;
      saveData();
      renderStats();
      renderTasks();
      showToast("Focus session complete! Your study time was saved.");
    } else {
      showToast("Break complete. Ready for another session?");
    }
    playSound();
    renderAnalytics();
    const nextMode =
      finishedMode === "focus"
        ? ensureToday().sessions % 4 === 0
          ? "long"
          : "short"
        : "focus";
    const autoStart =
      finishedMode === "focus" ? data.autoBreak : data.autoFocus;
    chooseMode(nextMode, { autoStart });
  }
  function renderWeeklyChart() {
    const today = dateFromKey(localDateKey());
    const keys = Array.from({ length: 7 }, (_, index) =>
      localDateKey(shiftDate(today, index - 6)),
    );
    const values = keys.map(totalFocusSeconds);
    const maxMinutes = Math.max(
      25,
      ...values.map((seconds) => Math.ceil(seconds / 60)),
    );
    const totalSeconds = values.reduce((sum, seconds) => sum + seconds, 0);
    $("#weekly-total").textContent = `${formatMinutes(totalSeconds)} total`;
    $("#week-focus").textContent = formatMinutes(totalSeconds);
    $("#week-sessions").textContent = keys.reduce(
      (sum, key) => sum + totalSessions(key),
      0,
    );
    $("#daily-average").textContent =
      `Daily average: ${formatMinutes(totalSeconds / 7)}`;
    const bestIndex = values.reduce(
      (best, value, index) => (value > values[best] ? index : best),
      0,
    );
    $("#best-day").textContent =
      values[bestIndex] > 0
        ? formatDate(keys[bestIndex], { weekday: "long" })
        : "Not yet";
    $("#goal-days").textContent =
      `${keys.filter((key) => totalFocusSeconds(key) >= data.goalMinutes * 60).length} of 7 days`;
    const chart = $("#weekly-chart");
    chart.replaceChildren();
    keys.forEach((key, index) => {
      const seconds = values[index];
      const day = document.createElement("div");
      day.className = "chart-day";
      const small = document.createElement("small");
      small.textContent = seconds ? formatMinutes(seconds, true) : "—";
      const area = document.createElement("div");
      area.className = "bar-area";
      const bar = document.createElement("div");
      bar.className = `chart-bar${index === 6 ? " today" : ""}`;
      bar.style.height = `${Math.max(3, Math.min(100, (seconds / 60 / maxMinutes) * 100))}%`;
      bar.title = `${formatDate(key)}: ${formatMinutes(seconds)}`;
      area.append(bar);
      const label = document.createElement("strong");
      label.textContent = formatDate(key, { weekday: "short" });
      day.append(small, area, label);
      chart.append(day);
    });
  }
  function calculateStreaks() {
    const today = dateFromKey(localDateKey());
    let current = 0;
    let cursor = today;
    if (totalFocusSeconds(localDateKey(cursor)) === 0)
      cursor = shiftDate(cursor, -1);
    while (totalFocusSeconds(localDateKey(cursor)) > 0) {
      current++;
      cursor = shiftDate(cursor, -1);
    }
    let best = 0,
      streak = 0;
    const keys = allDateKeys();
    if (keys.length) {
      let first = dateFromKey(keys[0]);
      const last = today;
      for (let date = first; date <= last; date = shiftDate(date, 1)) {
        if (totalFocusSeconds(localDateKey(date)) > 0) {
          streak++;
          best = Math.max(best, streak);
        } else streak = 0;
      }
    }
    $("#current-streak").textContent = current;
    $("#best-streak").textContent = best;
  }
  function renderHeatmap() {
    const heatmap = $("#heatmap");
    heatmap.replaceChildren();
    const today = dateFromKey(localDateKey());
    const start = shiftDate(today, -83);
    start.setDate(start.getDate() - start.getDay());
    for (let index = 0; index < 84; index++) {
      const date = shiftDate(start, index);
      const key = localDateKey(date);
      const seconds = totalFocusSeconds(key);
      const minutes = Math.floor(seconds / 60);
      const level =
        minutes === 0
          ? 0
          : minutes < 30
            ? 1
            : minutes < 60
              ? 2
              : minutes < 120
                ? 3
                : 4;
      const cell = document.createElement("span");
      cell.className = `heat-cell level-${level}`;
      cell.title = `${formatDate(key, { weekday: "long", year: "numeric", month: "short", day: "numeric" })}: ${formatMinutes(seconds)}`;
      cell.setAttribute("aria-label", cell.title);
      if (key === localDateKey())
        cell.style.outline = "2px solid var(--accent)";
      heatmap.append(cell);
    }
  }
  function renderHistory() {
    const count = Number($("#history-filter").value || 30);
    const today = dateFromKey(localDateKey());
    const list = $("#history-list");
    list.replaceChildren();
    let hasAny = false;
    const keys = Array.from({ length: count }, (_, index) =>
      localDateKey(shiftDate(today, index - (count - 1))).toString(),
    ).reverse();
    const max = Math.max(
      60,
      ...keys.map((key) => Math.floor(totalFocusSeconds(key) / 60)),
    );
    keys.forEach((key) => {
      const seconds = totalFocusSeconds(key);
      const sessions = totalSessions(key);
      if (!seconds && !sessions) return;
      hasAny = true;
      const row = document.createElement("div");
      row.className = "history-row";
      const date = document.createElement("div");
      date.className = "history-date";
      const strong = document.createElement("strong");
      strong.textContent =
        key === localDateKey()
          ? "Today"
          : formatDate(key, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
      const small = document.createElement("small");
      small.textContent = key;
      date.append(strong, small);
      const meter = document.createElement("div");
      meter.className = "history-meter";
      const fill = document.createElement("span");
      fill.style.width = `${Math.min(100, (seconds / 60 / max) * 100)}%`;
      meter.append(fill);
      const value = document.createElement("div");
      value.className = "history-value";
      const valStrong = document.createElement("strong");
      valStrong.textContent = formatMinutes(seconds);
      const valSmall = document.createElement("small");
      valSmall.textContent = `${sessions} ${sessions === 1 ? "session" : "sessions"}`;
      value.append(valStrong, valSmall);
      row.append(date, meter, value);
      list.append(row);
    });
    if (!hasAny) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        "<span>📈</span><p>Your history starts here</p><small>Complete a focus session to see your study activity.</small>";
      list.append(empty);
    }
  }
  function renderAnalytics() {
    renderWeeklyChart();
    calculateStreaks();
    renderHeatmap();
    renderHistory();
  }
  function updateDuration(modeKey, select) {
    const value = Number(select.value);
    if (!Number.isFinite(value) || value < 1 || value > 180) return;
    data.durations[modeKey] = value;
    saveData();
    if (mode === modeKey && !running) {
      remainingSeconds = getDuration(mode);
      renderTimer();
    }
  }

  $("#start-btn").addEventListener("click", startTimer);
  $("#reset-btn").addEventListener("click", resetTimer);
  $("#skip-btn").addEventListener("click", skipTimer);
  $$(".mode-btn").forEach((button) =>
    button.addEventListener("click", () => chooseMode(button.dataset.mode)),
  );
  $("#task-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#task-input");
    const name = input.value.trim();
    if (!name) return;
    data.tasks.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      completed: false,
    });
    input.value = "";
    saveData();
    renderTasks();
    input.focus();
    showToast("Task added.");
  });
  $("#clear-completed").addEventListener("click", () => {
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((task) => !task.completed);
    saveData();
    renderTasks();
    showToast(
      before === data.tasks.length
        ? "No completed tasks to clear."
        : "Completed tasks cleared.",
    );
  });
  $("#goal-select").addEventListener("change", (event) => {
    data.goalMinutes = Number(event.target.value) || 120;
    ensureToday().goalReached =
      ensureToday().focusSeconds >= data.goalMinutes * 60;
    saveData();
    renderStats();
    renderAnalytics();
  });
  $("#theme-toggle").addEventListener("click", () => {
    data.theme = data.theme === "dark" ? "light" : "dark";
    saveData();
    applyTheme();
    showToast(`${data.theme === "dark" ? "Dark" : "Light"} mode enabled.`);
  });
  $("#sound-toggle").addEventListener("click", () => {
    data.sound = !data.sound;
    $("#sound-setting").checked = data.sound;
    saveData();
    showToast(`Completion sounds ${data.sound ? "on" : "off"}.`);
  });
  $("#sound-setting").addEventListener("change", (event) => {
    data.sound = event.target.checked;
    saveData();
    $("#sound-toggle").textContent = data.sound ? "🔔" : "🔕";
  });
  $("#auto-break-setting").addEventListener("change", (event) => {
    data.autoBreak = event.target.checked;
    saveData();
  });
  $("#auto-focus-setting").addEventListener("change", (event) => {
    data.autoFocus = event.target.checked;
    saveData();
  });
  $("#focus-duration").addEventListener("change", (event) =>
    updateDuration("focus", event.target),
  );
  $("#short-duration").addEventListener("change", (event) =>
    updateDuration("short", event.target),
  );
  $("#long-duration").addEventListener("change", (event) =>
    updateDuration("long", event.target),
  );
  $("#history-filter").addEventListener("change", renderHistory);

  function init() {
    ensureToday();
    $("#focus-duration").value = String(data.durations.focus);
    $("#short-duration").value = String(data.durations.short);
    $("#long-duration").value = String(data.durations.long);
    $("#sound-setting").checked = data.sound;
    $("#sound-toggle").textContent = data.sound ? "🔔" : "🔕";
    $("#auto-break-setting").checked = data.autoBreak;
    $("#auto-focus-setting").checked = data.autoFocus;
    applyTheme();
    renderDate();
    renderStats();
    renderTasks();
    renderTimer();
    renderAnalytics();
    saveData();
  }
  // Recover gracefully from a date rollover, including if the tab stayed open overnight.
  let lastDate = localDateKey();
  setInterval(() => {
    if (localDateKey() !== lastDate) {
      lastDate = localDateKey();
      ensureToday();
      renderDate();
      renderStats();
      renderTasks();
      renderAnalytics();
      saveData();
    }
  }, 15000);
  // Recalculate from the deadline on visibility changes; no timer drift while backgrounded.
  document.addEventListener("visibilitychange", () => {
    if (running) tick();
  });
  window.addEventListener("beforeunload", saveData);
  init();
})();
