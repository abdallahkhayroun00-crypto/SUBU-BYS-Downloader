(() => {
  const OVERLAY_ID = "subu-v2-progress";
  let extensionEnabled = false;
  let session = null;
  let stopRequested = false;
  let paused = false;
  let decisionResolver = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    });
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sanitizeSegment(name, fallback = "document") {
    return String(name || fallback)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 180) || fallback;
  }

  function hashString(value) {
    let h1 = 0x811c9dc5;
    const text = String(value || "");
    for (let i = 0; i < text.length; i++) {
      h1 ^= text.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    return (h1 >>> 0).toString(16).padStart(8, "0");
  }

  function findDownloadControl(row) {
    const cells = row.querySelectorAll("td");
    if (!cells.length) return null;
    const lastCell = cells[cells.length - 1];
    const direct = lastCell.querySelector('a[href], button, [onclick], [role="button"], input[type="button"], input[type="submit"]');
    if (direct) return direct;
    const icon = lastCell.querySelector("svg, i, span");
    return icon ? (icon.closest('a, button, [onclick], [role="button"]') || icon) : null;
  }

  function extractControlUrl(control) {
    if (!control) return null;
    const candidates = [];
    const anchor = control.closest?.("a[href]") || control.querySelector?.("a[href]");
    if (anchor?.getAttribute("href")) candidates.push(anchor.getAttribute("href"));
    if (control.getAttribute?.("href")) candidates.push(control.getAttribute("href"));

    for (const key of ["url", "href", "downloadUrl", "download-url", "file", "src", "link"]) {
      const datasetValue = control.dataset?.[key];
      if (datasetValue) candidates.push(datasetValue);
      const attrValue = control.getAttribute?.(`data-${key}`);
      if (attrValue) candidates.push(attrValue);
    }

    const onclick = control.getAttribute?.("onclick") || "";
    const quoted = [...onclick.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    candidates.push(...quoted);

    for (let raw of candidates) {
      raw = cleanText(raw);
      if (!raw || raw === "#" || /^javascript:/i.test(raw)) continue;
      try {
        const url = new URL(raw, location.href);
        if (/^https?:$/i.test(url.protocol)) return url.href;
      } catch (_) {}
    }
    return null;
  }

  function findCourseMeta() {
    let code = "";
    let name = "";
    for (const table of document.querySelectorAll("table")) {
      const headers = [...table.querySelectorAll("th")].map((el) => cleanText(el.textContent));
      const nameIndex = headers.findIndex((text) => /^Ders Adı$/i.test(text));
      const codeIndex = headers.findIndex((text) => /^Ders Kodu$/i.test(text));
      if (nameIndex < 0 && codeIndex < 0) continue;
      const row = table.querySelector("tbody tr") || [...table.querySelectorAll("tr")].find((tr) => tr.querySelectorAll("td").length);
      if (!row) continue;
      const cells = row.querySelectorAll("td");
      if (nameIndex >= 0) name ||= cleanText(cells[nameIndex]?.textContent);
      if (codeIndex >= 0) code ||= cleanText(cells[codeIndex]?.textContent);
    }

    if (!name) {
      const labels = [...document.querySelectorAll("div, span, label, p, strong")]
        .filter((el) => cleanText(el.textContent) === "Ders Adı");
      for (const label of labels) {
        const candidate = cleanText(label.parentElement?.nextElementSibling?.textContent);
        if (candidate && candidate !== "Ders Adı") { name = candidate; break; }
      }
    }
    return { code, name: name || "SUBÜ Course" };
  }

  function collectRows() {
    const course = findCourseMeta();
    const candidates = [...document.querySelectorAll("table tbody tr, table tr")];
    const result = [];

    for (const row of candidates) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) continue;
      const control = findDownloadControl(row);
      if (!control) continue;
      const week = cleanText(cells[0]?.innerText || cells[0]?.textContent);
      const title = cleanText(cells[1]?.innerText || cells[1]?.textContent);
      if (!title) continue;
      const keySeed = `${course.code}|${course.name}|${week}|${title}`.toLowerCase();
      result.push({
        row,
        week,
        title,
        control,
        sourceUrl: extractControlUrl(control),
        key: `subu_${hashString(keySeed)}`
      });
    }

    return result.filter((item, index, arr) => arr.findIndex((x) => x.row === item.row) === index);
  }

  function weekNumber(week) {
    const match = String(week || "").match(/\d+/);
    return match ? String(parseInt(match[0], 10)).padStart(2, "0") : "";
  }

  function buildBaseName(item, courseName, pattern) {
    const title = sanitizeSegment(item.title);
    const num = weekNumber(item.week);
    switch (pattern) {
      case "number-title": return num ? `${num} - ${title}` : title;
      case "course-week-title": return num ? `${sanitizeSegment(courseName)} - Hafta ${num} - ${title}` : `${sanitizeSegment(courseName)} - ${title}`;
      case "title": return title;
      case "week-title":
      default: return num ? `Hafta ${num} - ${title}` : title;
    }
  }

  function getOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="subu-v2-head">
        <div class="subu-v2-brand"><span class="subu-v2-mark">S</span><div><strong>SUBÜ Downloader</strong><small class="subu-v2-phase">Preparing…</small></div></div>
        <button class="subu-v2-close" type="button" title="Hide">×</button>
      </div>
      <div class="subu-v2-progress-track"><div class="subu-v2-progress-fill"></div></div>
      <div class="subu-v2-progress-meta"><b class="subu-v2-count">0 / 0</b><span class="subu-v2-percent">0%</span></div>
      <div class="subu-v2-current">Waiting…</div>
      <div class="subu-v2-stats"><span>✓ <b data-stat="done">0</b></span><span>↷ <b data-stat="skipped">0</b></span><span>! <b data-stat="failed">0</b></span></div>
      <div class="subu-v2-actions">
        <button type="button" data-action="pause">Pause</button>
        <button type="button" data-action="stop" class="danger">Stop</button>
      </div>
      <div class="subu-v2-error" hidden></div>
    `;
    overlay.querySelector(".subu-v2-close").addEventListener("click", () => overlay.classList.add("subu-v2-minimized"));
    overlay.querySelector('[data-action="pause"]').addEventListener("click", () => {
      paused = !paused;
      overlay.querySelector('[data-action="pause"]').textContent = paused ? "Resume" : "Pause";
      updateOverlay(paused ? "Paused after current file" : "Continuing…");
    });
    overlay.querySelector('[data-action="stop"]').addEventListener("click", () => {
      stopRequested = true;
      if (decisionResolver) { decisionResolver("stop"); decisionResolver = null; }
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateOverlay(message = "", state = "normal") {
    if (!session || !extensionEnabled) return;
    const overlay = getOverlay();
    overlay.classList.remove("subu-v2-minimized");
    overlay.dataset.state = state;
    const total = session.items.length;
    const doneForProgress = Math.min(total, session.completed + session.skipped);
    const pct = total ? Math.round((doneForProgress / total) * 100) : 0;
    overlay.querySelector(".subu-v2-progress-fill").style.width = `${pct}%`;
    overlay.querySelector(".subu-v2-count").textContent = `${Math.min(session.currentIndex + 1, total)} / ${total}`;
    overlay.querySelector(".subu-v2-percent").textContent = `${pct}%`;
    overlay.querySelector(".subu-v2-current").textContent = message || session.currentTitle || "Working…";
    overlay.querySelector('[data-stat="done"]').textContent = String(session.completed);
    overlay.querySelector('[data-stat="skipped"]').textContent = String(session.skipped);
    overlay.querySelector('[data-stat="failed"]').textContent = String(session.failed);
    overlay.querySelector(".subu-v2-phase").textContent = session.destination === "drive" ? "Google Drive" : session.destination === "both" ? "Computer + Drive" : "Computer";
  }

  function showErrorDecision(item, error) {
    const overlay = getOverlay();
    const box = overlay.querySelector(".subu-v2-error");
    box.hidden = false;
    box.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "subu-v2-error-text";
    msg.textContent = `${item.week || "?"} · ${item.title}\n${error?.message || error}`;
    const actions = document.createElement("div");
    actions.className = "subu-v2-error-actions";
    for (const [label, value, cls] of [["Retry", "retry", "good"], ["Skip & continue", "skip", "warn"], ["Stop", "stop", "danger"]]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.className = cls;
      btn.addEventListener("click", () => {
        box.hidden = true;
        if (decisionResolver) { decisionResolver(value); decisionResolver = null; }
      });
      actions.appendChild(btn);
    }
    box.append(msg, actions);
    try { item.row.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
  }

  function hideErrorDecision() {
    const box = document.getElementById(OVERLAY_ID)?.querySelector(".subu-v2-error");
    if (box) box.hidden = true;
  }

  function markRow(item, state) {
    item.row.classList.remove("subu-v2-active", "subu-v2-success", "subu-v2-failed", "subu-v2-skipped");
    if (state) item.row.classList.add(`subu-v2-${state}`);
  }

  async function waitWhilePaused() {
    while (paused && !stopRequested && extensionEnabled) await sleep(250);
  }

  async function waitForTransfer(token, timeoutMs = 30000) {
    const start = Date.now();
    let last = {};
    while (Date.now() - start < timeoutMs) {
      if (stopRequested || !extensionEnabled) return { resolved: false, stopped: true };
      const status = await sendMessage({ type: "GET_TRANSFER_STATUS", token });
      last = status;
      if (status.resolved) return status;
      if (status.error) return status;
      await sleep(300);
    }
    return { ...last, resolved: false, error: last.error || "Timed out while waiting for the browser download." };
  }

  async function captureOrDownloadByClick(item, baseName, captureOnly, localFolderPath = "") {
    const armed = await sendMessage({
      type: "ARM_TRANSFER",
      baseName,
      captureOnly,
      folderPath: localFolderPath
    });
    if (!armed.ok || !armed.token) throw new Error(armed.error || "Could not prepare the file transfer.");

    try {
      item.control.click();
    } catch (err) {
      await sendMessage({ type: "CANCEL_TRANSFER", token: armed.token });
      throw err;
    }

    const status = await waitForTransfer(armed.token);
    await sendMessage({ type: "CLEAR_TRANSFER", token: armed.token });
    if (status.stopped) throw new Error("Stopped by user.");
    if (!status.resolved) throw new Error(status.error || "No file download was detected.");
    return status;
  }

  async function uploadDriveUrl(sourceUrl, baseName, folderId, duplicatePolicy) {
    const result = await sendMessage({
      type: "DRIVE_UPLOAD_URL",
      sourceUrl,
      baseName,
      folderId,
      duplicatePolicy
    });
    if (!result.ok) {
      const err = new Error(result.error || "Google Drive upload failed.");
      err.httpStatus = result.httpStatus || null;
      throw err;
    }
    return result;
  }

  async function processItemOnce(item) {
    const settings = session.options;
    const baseName = buildBaseName(item, session.course.name, settings.filenamePattern);
    const localFolderPath = settings.localCourseFolder ? `SUBU/${sanitizeSegment(session.course.name)}` : "";
    const destination = session.destination;

    if (destination === "computer") {
      const local = await captureOrDownloadByClick(item, baseName, false, localFolderPath);
      return { filename: local.filename, sourceUrl: local.sourceUrl, computer: true, drive: false };
    }

    if (destination === "drive") {
      let sourceUrl = item.sourceUrl;
      let capture = null;
      if (sourceUrl) {
        try {
          const uploaded = await uploadDriveUrl(sourceUrl, baseName, session.driveTargetFolderId, settings.duplicatePolicy);
          return { filename: uploaded.filename, sourceUrl: uploaded.sourceUrl || sourceUrl, computer: false, drive: true, duplicate: uploaded.skippedDuplicate };
        } catch (err) {
          if (err.httpStatus === 429 || err.httpStatus >= 500) throw err;
        }
      }
      capture = await captureOrDownloadByClick(item, baseName, true, "");
      sourceUrl = capture.sourceUrl;
      if (!sourceUrl) throw new Error("The document was detected, but its real URL could not be captured for Drive upload.");
      const uploaded = await uploadDriveUrl(sourceUrl, baseName, session.driveTargetFolderId, settings.duplicatePolicy);
      return { filename: uploaded.filename, sourceUrl: uploaded.sourceUrl || sourceUrl, computer: false, drive: true, duplicate: uploaded.skippedDuplicate };
    }

    if (destination === "both") {
      let sourceUrl = item.sourceUrl;
      let uploaded = null;
      if (sourceUrl) {
        try {
          uploaded = await uploadDriveUrl(sourceUrl, baseName, session.driveTargetFolderId, settings.duplicatePolicy);
        } catch (err) {
          if (err.httpStatus === 429 || err.httpStatus >= 500) throw err;
          sourceUrl = null;
        }
      }
      if (!sourceUrl) {
        const capture = await captureOrDownloadByClick(item, baseName, true, "");
        sourceUrl = capture.sourceUrl;
        if (!sourceUrl) throw new Error("Could not capture the source file URL for Google Drive.");
        uploaded = await uploadDriveUrl(sourceUrl, baseName, session.driveTargetFolderId, settings.duplicatePolicy);
      }
      const local = await captureOrDownloadByClick(item, baseName, false, localFolderPath);
      return { filename: local.filename || uploaded?.filename, sourceUrl, computer: true, drive: true, duplicate: uploaded?.skippedDuplicate };
    }

    throw new Error("Unknown save destination.");
  }

  async function processItemWithRetries(item) {
    const maxRetries = Math.max(0, Number(session.options.retries || 0));
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (stopRequested || !extensionEnabled) throw new Error("Stopped by user.");
      try {
        if (attempt > 0) updateOverlay(`Retry ${attempt}/${maxRetries} · ${item.title}`, "warning");
        return await processItemOnce(item);
      } catch (err) {
        lastError = err;
        if (stopRequested || !extensionEnabled || err.message === "Stopped by user.") throw err;
        if (attempt < maxRetries) {
          const serverBackoff = err.httpStatus === 429 || (err.httpStatus && err.httpStatus >= 500);
          const wait = serverBackoff ? 30000 : 1200;
          updateOverlay(serverBackoff ? `SUBÜ server error. Waiting ${Math.round(wait / 1000)}s before retry…` : `Retrying ${item.title}…`, "warning");
          await sleep(wait);
        }
      }
    }
    throw lastError || new Error("Transfer failed.");
  }

  async function markHistory(item, result) {
    const stored = await chrome.storage.local.get({ history: {} });
    const history = stored.history || {};
    history[item.key] = {
      timestamp: Date.now(),
      course: session.course.name,
      code: session.course.code,
      week: item.week,
      title: item.title,
      filename: result?.filename || null,
      destination: session.destination,
      driveDuplicateSkipped: !!result?.duplicate
    };
    const entries = Object.entries(history).sort((a, b) => (b[1]?.timestamp || 0) - (a[1]?.timestamp || 0));
    const trimmed = Object.fromEntries(entries.slice(0, 3000));
    await chrome.storage.local.set({ history: trimmed });
  }

  async function saveResumeState(nextIndex) {
    if (!session) return;
    await chrome.storage.local.set({
      resumeSession: {
        courseName: session.course.name,
        courseCode: session.course.code,
        keys: session.items.map((i) => i.key),
        nextIndex,
        destination: session.destination,
        driveFolderId: session.baseDriveFolderId || null,
        options: session.options,
        savedAt: Date.now()
      }
    });
  }

  async function clearResumeState() {
    await chrome.storage.local.set({ resumeSession: null });
  }

  async function prepareDriveTargetFolder() {
    if (!session || !["drive", "both"].includes(session.destination)) return;
    const baseId = session.baseDriveFolderId;
    if (!baseId) throw new Error("Choose a Google Drive folder before starting.");
    if (session.options.driveCourseFolder) {
      const result = await sendMessage({
        type: "DRIVE_ENSURE_FOLDER",
        parentId: baseId,
        name: session.course.name
      });
      if (!result.ok || !result.folder?.id) throw new Error(result.error || "Could not create/find the course folder in Google Drive.");
      session.driveTargetFolderId = result.folder.id;
    } else {
      session.driveTargetFolderId = baseId;
    }
  }

  function waitForDecision(item, err) {
    session.failed += 1;
    markRow(item, "failed");
    updateOverlay(`Needs attention · ${item.title}`, "error");
    showErrorDecision(item, err);
    sendMessage({ type: "SET_PROGRESS_BADGE", text: "!", error: true });
    return new Promise((resolve) => { decisionResolver = resolve; });
  }

  async function runSession(startIndex = 0) {
    if (!session) return;
    stopRequested = false;
    paused = false;
    session.running = true;
    getOverlay();

    try {
      await prepareDriveTargetFolder();
      for (let i = startIndex; i < session.items.length; ) {
        if (stopRequested || !extensionEnabled) break;
        await waitWhilePaused();
        if (stopRequested || !extensionEnabled) break;

        const item = session.items[i];
        session.currentIndex = i;
        session.currentTitle = item.title;
        markRow(item, "active");
        updateOverlay(`${item.week || ""} · ${item.title}`);
        await sendMessage({ type: "SET_PROGRESS_BADGE", text: `${i + 1}/${session.items.length}` });
        await saveResumeState(i);

        try {
          const result = await processItemWithRetries(item);
          session.completed += 1;
          markRow(item, "success");
          hideErrorDecision();
          await markHistory(item, result);
          i += 1;
          session.currentIndex = i;
          await saveResumeState(i);
          updateOverlay(result?.duplicate ? `Already in Drive · ${item.title}` : `Saved · ${item.title}`, "success");
          if (i < session.items.length) await sleep(Math.max(0, Number(session.options.delayMs || 0)));
        } catch (err) {
          if (stopRequested || !extensionEnabled || err.message === "Stopped by user.") break;
          if (session.options.autoSkip) {
            session.skipped += 1;
            session.failed += 1;
            markRow(item, "skipped");
            i += 1;
            await saveResumeState(i);
            continue;
          }

          const decision = await waitForDecision(item, err);
          hideErrorDecision();
          if (decision === "retry") {
            session.failed = Math.max(0, session.failed - 1);
            markRow(item, "active");
            continue;
          }
          if (decision === "skip") {
            session.skipped += 1;
            markRow(item, "skipped");
            i += 1;
            await saveResumeState(i);
            continue;
          }
          stopRequested = true;
          break;
        }
      }

      if (stopRequested || !extensionEnabled) {
        updateOverlay(`Stopped · ${session.completed} saved · ${session.skipped} skipped`, "warning");
        await saveResumeState(session.currentIndex || 0);
      } else {
        const total = session.items.length;
        updateOverlay(`Finished · ${session.completed}/${total} saved${session.skipped ? ` · ${session.skipped} skipped` : ""}`, "success");
        await clearResumeState();
        await sendMessage({
          type: "NOTIFY_DONE",
          title: "SUBÜ downloads finished",
          message: `${session.completed}/${total} saved${session.skipped ? ` · ${session.skipped} skipped` : ""}.`
        });
        setTimeout(() => document.getElementById(OVERLAY_ID)?.remove(), 8000);
      }
    } catch (err) {
      updateOverlay(err?.message || String(err), "error");
      await saveResumeState(session?.currentIndex || 0);
    } finally {
      if (session) session.running = false;
      await sendMessage({ type: "RESET_BADGE" });
    }
  }

  async function startSession(message) {
    if (!extensionEnabled) return { ok: false, error: "Extension is turned OFF." };
    if (session?.running) return { ok: false, error: "A transfer session is already running." };

    const all = collectRows();
    if (!all.length) return { ok: false, error: "No documents found. Open the Dokümanlar tab first." };
    const keySet = Array.isArray(message.keys) && message.keys.length ? new Set(message.keys) : null;
    let items = keySet ? all.filter((item) => keySet.has(item.key)) : all;
    if (!items.length) return { ok: false, error: "None of the selected documents are available on this page." };

    const course = findCourseMeta();
    session = {
      running: false,
      items,
      course,
      destination: message.destination || "computer",
      baseDriveFolderId: message.driveFolderId || null,
      driveTargetFolderId: null,
      options: message.options || {},
      completed: 0,
      skipped: 0,
      failed: 0,
      currentIndex: 0,
      currentTitle: ""
    };
    document.querySelectorAll("tr.subu-v2-active, tr.subu-v2-success, tr.subu-v2-failed, tr.subu-v2-skipped").forEach((row) => {
      row.classList.remove("subu-v2-active", "subu-v2-success", "subu-v2-failed", "subu-v2-skipped");
    });
    runSession(0);
    return { ok: true, count: items.length };
  }

  async function resumeStoredSession() {
    if (!extensionEnabled) return { ok: false, error: "Extension is turned OFF." };
    const stored = await chrome.storage.local.get({ resumeSession: null });
    const resume = stored.resumeSession;
    if (!resume?.keys?.length) return { ok: false, error: "No previous session to resume." };
    const course = findCourseMeta();
    if (resume.courseName && resume.courseName !== course.name) return { ok: false, error: `Open ${resume.courseName} before resuming.` };
    const all = collectRows();
    const remainingKeys = resume.keys.slice(Math.max(0, resume.nextIndex || 0));
    const set = new Set(remainingKeys);
    const items = all.filter((item) => set.has(item.key));
    if (!items.length) return { ok: false, error: "The remaining documents could not be found on this page." };
    session = {
      running: false,
      items,
      course,
      destination: resume.destination || "computer",
      baseDriveFolderId: resume.driveFolderId || null,
      driveTargetFolderId: null,
      options: resume.options || {},
      completed: 0,
      skipped: 0,
      failed: 0,
      currentIndex: 0,
      currentTitle: ""
    };
    runSession(0);
    return { ok: true, count: items.length };
  }

  function stopAndClean() {
    stopRequested = true;
    paused = false;
    if (decisionResolver) { decisionResolver("stop"); decisionResolver = null; }
    document.getElementById(OVERLAY_ID)?.remove();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message?.type === "GET_PAGE_INFO") {
        const items = collectRows();
        const course = findCourseMeta();
        sendResponse({
          ok: true,
          isSubu: location.hostname === "ogrenci.bys.subu.edu.tr",
          enabled: extensionEnabled,
          courseName: course.name,
          courseCode: course.code,
          documentCount: items.length,
          items: items.map((item, index) => ({ key: item.key, week: item.week, title: item.title, index, hasDirectUrl: !!item.sourceUrl })),
          running: !!session?.running,
          session: session ? {
            destination: session.destination,
            total: session.items.length,
            completed: session.completed,
            skipped: session.skipped,
            failed: session.failed,
            currentIndex: session.currentIndex,
            currentTitle: session.currentTitle,
            paused
          } : null
        });
        return;
      }

      if (message?.type === "SET_ENABLED") {
        extensionEnabled = message.enabled !== false;
        if (!extensionEnabled) stopAndClean();
        sendResponse({ ok: true, enabled: extensionEnabled });
        return;
      }

      if (message?.type === "START_SESSION") {
        sendResponse(await startSession(message));
        return;
      }

      if (message?.type === "RESUME_SESSION") {
        sendResponse(await resumeStoredSession());
        return;
      }

      if (message?.type === "SESSION_ACTION") {
        if (message.action === "pause") paused = true;
        if (message.action === "resume") paused = false;
        if (message.action === "stop") {
          stopRequested = true;
          if (decisionResolver) { decisionResolver("stop"); decisionResolver = null; }
        }
        if (["retry", "skip"].includes(message.action) && decisionResolver) {
          decisionResolver(message.action);
          decisionResolver = null;
        }
        sendResponse({ ok: true, paused, stopped: stopRequested });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message." });
    })().catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) {
      extensionEnabled = changes.enabled.newValue !== false;
      if (!extensionEnabled) stopAndClean();
    }
  });

  // Zero-lag behavior: no MutationObserver, no polling, no recurring DOM scans.
  // The table is scanned only when the popup asks for info or a transfer starts.
  chrome.storage.local.get({ enabled: true }, (data) => {
    extensionEnabled = data.enabled !== false;
  });
})();
