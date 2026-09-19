const DEFAULT_SETTINGS = {
  filenamePattern: "week-title",
  localCourseFolder: true,
  driveCourseFolder: true,
  delayMs: 2000,
  retries: 2,
  autoSkip: false,
  duplicatePolicy: "skip",
  askDestination: true,
  defaultDestination: "computer"
};

const state = {
  activeTabId: null,
  enabled: true,
  page: null,
  settings: { ...DEFAULT_SETTINGS },
  history: {},
  resume: null,
  drive: { configured: false, connected: false },
  driveFolderId: "root",
  driveFolderName: "My Drive",
  driveFolderPath: "My Drive",
  selectedKeys: new Set(),
  fileFilter: "all",
  fileSearch: "",
  pendingKeys: [],
  pendingMode: "all",
  destination: "computer",
  folderStack: [{ id: "root", name: "My Drive" }]
};

const $ = (id) => document.getElementById(id);
const refs = {
  enabledToggle: $("enabledToggle"),
  pageBadge: $("pageBadge"),
  courseName: $("courseName"),
  documentCount: $("documentCount"),
  newCount: $("newCount"),
  savedCount: $("savedCount"),
  directCount: $("directCount"),
  resumeCard: $("resumeCard"),
  resumeText: $("resumeText"),
  resumeBtn: $("resumeBtn"),
  driveSubtitle: $("driveSubtitle"),
  driveDot: $("driveDot"),
  driveAccount: $("driveAccount"),
  driveFolderBox: $("driveFolderBox"),
  driveFolderPath: $("driveFolderPath"),
  connectDriveBtn: $("connectDriveBtn"),
  disconnectDriveBtn: $("disconnectDriveBtn"),
  driveSetupBtn: $("driveSetupBtn"),
  changeFolderBtn: $("changeFolderBtn"),
  downloadAllBtn: $("downloadAllBtn"),
  newOnlyBtn: $("newOnlyBtn"),
  newOnlyText: $("newOnlyText"),
  chooseBtn: $("chooseBtn"),
  exportBtn: $("exportBtn"),
  homeHint: $("homeHint"),
  fileSearch: $("fileSearch"),
  fileList: $("fileList"),
  selectedCount: $("selectedCount"),
  selectAllBtn: $("selectAllBtn"),
  clearSelectionBtn: $("clearSelectionBtn"),
  downloadSelectedBtn: $("downloadSelectedBtn"),
  destinationSheet: $("destinationSheet"),
  destinationSummary: $("destinationSummary"),
  driveRequirement: $("driveRequirement"),
  rememberDestination: $("rememberDestination"),
  startTransferBtn: $("startTransferBtn"),
  folderSheet: $("folderSheet"),
  folderBreadcrumb: $("folderBreadcrumb"),
  folderList: $("folderList"),
  folderUpBtn: $("folderUpBtn"),
  newFolderBtn: $("newFolderBtn"),
  selectCurrentFolderBtn: $("selectCurrentFolderBtn"),
  filenamePattern: $("filenamePattern"),
  localCourseFolder: $("localCourseFolder"),
  driveCourseFolder: $("driveCourseFolder"),
  delayMs: $("delayMs"),
  retries: $("retries"),
  autoSkip: $("autoSkip"),
  duplicatePolicy: $("duplicatePolicy"),
  askDestination: $("askDestination"),
  defaultDestination: $("defaultDestination"),
  clearHistoryBtn: $("clearHistoryBtn"),
  settingsSaved: $("settingsSaved")
};

function bgMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(response || {});
    });
  });
}

function sendToTab(message) {
  return new Promise((resolve) => {
    if (state.activeTabId == null) return resolve({ ok: false, error: "No active tab." });
    chrome.tabs.sendMessage(state.activeTabId, message, (response) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(response || {});
    });
  });
}

function setHint(text, kind = "") {
  refs.homeHint.textContent = text;
  refs.homeHint.className = `hint ${kind}`.trim();
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${name}`));
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.dataset.view === name));
  if (name === "files") renderFiles();
}

function currentItems() {
  return state.page?.items || [];
}

function isSaved(item) {
  return !!state.history?.[item.key];
}

function getNewItems() {
  return currentItems().filter((item) => !isSaved(item));
}

function renderHome() {
  refs.enabledToggle.checked = state.enabled;
  const page = state.page;
  const items = currentItems();
  const saved = items.filter(isSaved).length;
  const fresh = items.length - saved;
  const direct = items.filter((item) => item.hasDirectUrl).length;

  refs.courseName.textContent = page?.courseName || "Open a SUBÜ BYS course";
  refs.documentCount.textContent = String(page?.documentCount ?? 0);
  refs.newCount.textContent = String(fresh);
  refs.savedCount.textContent = String(saved);
  refs.directCount.textContent = String(direct);
  refs.newOnlyText.textContent = fresh ? `${fresh} file${fresh === 1 ? "" : "s"} not saved before` : "Everything on this page is known";

  const ready = state.enabled && page?.isSubu && page?.documentCount > 0 && !page?.running;
  refs.downloadAllBtn.disabled = !ready;
  refs.chooseBtn.disabled = !ready;
  refs.exportBtn.disabled = !page?.documentCount;
  refs.newOnlyBtn.disabled = !ready || fresh === 0;

  if (!page?.isSubu) {
    refs.pageBadge.textContent = "Not on SUBÜ BYS";
    refs.pageBadge.className = "badge warn";
    setHint("Open SUBÜ BYS → a course → Dokümanlar.");
  } else if (!page?.ok) {
    refs.pageBadge.textContent = "Reload needed";
    refs.pageBadge.className = "badge error";
    setHint("Reload the SUBÜ tab once after installing/updating the extension.", "error");
  } else if (!state.enabled) {
    refs.pageBadge.textContent = "Extension OFF";
    refs.pageBadge.className = "badge neutral";
    setHint("OFF is fully inert: no watcher, no page scanning, no downloads.");
  } else if (page?.running) {
    refs.pageBadge.textContent = "Transfer running";
    refs.pageBadge.className = "badge ready";
    setHint(`${page.session?.completed || 0}/${page.session?.total || page.documentCount} saved. Progress is shown on the BYS page.`, "ok");
  } else if (page?.documentCount > 0) {
    refs.pageBadge.textContent = "Dokümanlar ready";
    refs.pageBadge.className = "badge ready";
    setHint("Ready. Choose Computer, Google Drive, or both when you start.", "ok");
  } else {
    refs.pageBadge.textContent = "BYS connected";
    refs.pageBadge.className = "badge warn";
    setHint("Open the Dokümanlar tab so the documents can be detected.");
  }

  const resumeMatches = state.resume?.keys?.length && page?.courseName && state.resume.courseName === page.courseName;
  refs.resumeCard.hidden = !resumeMatches || page?.running;
  if (resumeMatches) {
    const remaining = Math.max(0, state.resume.keys.length - (state.resume.nextIndex || 0));
    refs.resumeText.textContent = `${remaining} remaining · saved ${new Date(state.resume.savedAt || Date.now()).toLocaleString()}`;
  }

  renderDrive();
}

function renderDrive() {
  const d = state.drive || {};
  refs.driveDot.className = "connection-dot";
  refs.connectDriveBtn.hidden = false;
  refs.disconnectDriveBtn.hidden = true;
  refs.driveSetupBtn.hidden = true;
  refs.driveAccount.hidden = true;
  refs.driveFolderBox.hidden = true;

  if (!d.configured) {
    refs.driveSubtitle.textContent = "One-time OAuth setup required";
    refs.driveDot.classList.add("error");
    refs.connectDriveBtn.hidden = true;
    refs.driveSetupBtn.hidden = false;
    return;
  }

  if (!d.connected) {
    refs.driveSubtitle.textContent = d.error ? "Not connected" : "Connect once, then Chrome remembers it";
    refs.driveDot.classList.add("error");
    refs.connectDriveBtn.textContent = "Connect Drive";
    return;
  }

  refs.driveDot.classList.add("connected");
  refs.driveSubtitle.textContent = "Connected · ready for direct upload";
  refs.connectDriveBtn.hidden = true;
  refs.disconnectDriveBtn.hidden = false;
  refs.driveFolderBox.hidden = false;
  refs.driveFolderPath.textContent = state.driveFolderPath || state.driveFolderName || "My Drive";
  if (d.user?.emailAddress || d.user?.displayName) {
    refs.driveAccount.hidden = false;
    refs.driveAccount.textContent = [d.user.displayName, d.user.emailAddress].filter(Boolean).join(" · ");
  }
}

function renderFiles() {
  const items = currentItems();
  const q = state.fileSearch.toLowerCase();
  refs.fileList.replaceChildren();
  const visible = items.filter((item) => {
    if (state.fileFilter === "new" && isSaved(item)) return false;
    if (state.fileFilter === "saved" && !isSaved(item)) return false;
    if (q && !`${item.week} ${item.title}`.toLowerCase().includes(q)) return false;
    return true;
  });

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "folder-empty";
    empty.textContent = items.length ? "No files match this filter." : "Open a Dokümanlar page first.";
    refs.fileList.appendChild(empty);
  }

  for (const item of visible) {
    const row = document.createElement("div");
    row.className = `file-row ${state.selectedKeys.has(item.key) ? "selected" : ""}`.trim();
    row.dataset.key = item.key;
    row.innerHTML = `
      <span class="file-check">✓</span>
      <div class="file-main"><div class="file-week"></div><div class="file-title"></div></div>
      <span class="file-state ${isSaved(item) ? "saved" : "new"}">${isSaved(item) ? "SAVED" : "NEW"}</span>
    `;
    row.querySelector(".file-week").textContent = item.week || "—";
    row.querySelector(".file-title").textContent = item.title;
    row.addEventListener("click", () => {
      if (state.selectedKeys.has(item.key)) state.selectedKeys.delete(item.key);
      else state.selectedKeys.add(item.key);
      renderFiles();
    });
    refs.fileList.appendChild(row);
  }

  refs.selectedCount.textContent = String(state.selectedKeys.size);
  refs.downloadSelectedBtn.disabled = !state.enabled || state.selectedKeys.size === 0 || !state.page?.documentCount;
  refs.downloadSelectedBtn.textContent = state.selectedKeys.size ? `Download selected (${state.selectedKeys.size})` : "Download selected";
}

function renderSettings() {
  const s = state.settings;
  refs.filenamePattern.value = s.filenamePattern;
  refs.localCourseFolder.checked = !!s.localCourseFolder;
  refs.driveCourseFolder.checked = !!s.driveCourseFolder;
  refs.delayMs.value = String(s.delayMs);
  refs.retries.value = String(s.retries);
  refs.autoSkip.checked = !!s.autoSkip;
  refs.duplicatePolicy.value = s.duplicatePolicy;
  refs.askDestination.checked = s.askDestination !== false;
  refs.defaultDestination.value = s.defaultDestination || "computer";
}

async function loadState() {
  const stored = await chrome.storage.local.get({
    enabled: true,
    settings: DEFAULT_SETTINGS,
    history: {},
    resumeSession: null,
    driveFolderId: "root",
    driveFolderName: "My Drive",
    driveFolderPath: "My Drive"
  });
  state.enabled = stored.enabled !== false;
  state.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  state.history = stored.history || {};
  state.resume = stored.resumeSession || null;
  state.driveFolderId = stored.driveFolderId || "root";
  state.driveFolderName = stored.driveFolderName || "My Drive";
  state.driveFolderPath = stored.driveFolderPath || "My Drive";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTabId = tab?.id ?? null;
  if (!tab?.url?.startsWith("https://ogrenci.bys.subu.edu.tr/")) {
    state.page = { ok: true, isSubu: false, documentCount: 0, items: [] };
  } else {
    const info = await sendToTab({ type: "GET_PAGE_INFO" });
    state.page = info?.ok ? info : { ok: false, isSubu: true, documentCount: 0, items: [] };
  }

  state.drive = await bgMessage({ type: "DRIVE_STATUS", interactive: false });
  renderHome();
  renderFiles();
  renderSettings();
}

async function saveSettings(patch = {}) {
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set({ settings: state.settings });
  refs.settingsSaved.textContent = "Saved ✓";
  setTimeout(() => refs.settingsSaved.textContent = "Settings save automatically.", 1000);
}

function setDestination(dest) {
  state.destination = dest;
  document.querySelectorAll(".destination-option").forEach((btn) => btn.classList.toggle("active", btn.dataset.destination === dest));
  renderDriveRequirement();
}

function renderDriveRequirement() {
  const needsDrive = ["drive", "both"].includes(state.destination);
  refs.driveRequirement.hidden = !needsDrive;
  refs.startTransferBtn.disabled = false;
  if (!needsDrive) return;

  if (!state.drive.configured) {
    refs.driveRequirement.innerHTML = `Google Drive needs a one-time OAuth setup. <button type="button" data-setup>Setup</button>`;
    refs.driveRequirement.querySelector("[data-setup]").addEventListener("click", () => bgMessage({ type: "OPEN_DRIVE_SETUP" }));
    refs.startTransferBtn.disabled = true;
    return;
  }
  if (!state.drive.connected) {
    refs.driveRequirement.innerHTML = `Connect Google Drive once before uploading. <button type="button" data-connect>Connect</button>`;
    refs.driveRequirement.querySelector("[data-connect]").addEventListener("click", connectDrive);
    refs.startTransferBtn.disabled = true;
    return;
  }
  refs.driveRequirement.innerHTML = `Upload folder: <b>${escapeHtml(state.driveFolderPath || "My Drive")}</b> <button type="button" data-folder>Change</button>`;
  refs.driveRequirement.querySelector("[data-folder]").addEventListener("click", openFolderPicker);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function prepareTransfer(keys, mode) {
  if (!keys?.length) return setHint("No files selected.", "error");
  state.pendingKeys = keys;
  state.pendingMode = mode;
  if (state.settings.askDestination === false) {
    state.destination = state.settings.defaultDestination || "computer";
    const needsDrive = ["drive", "both"].includes(state.destination);
    if (!needsDrive || (state.drive.configured && state.drive.connected)) {
      return startTransfer();
    }
  }

  refs.destinationSummary.textContent = `${keys.length} file${keys.length === 1 ? "" : "s"} · ${state.page?.courseName || "SUBÜ"}`;
  refs.rememberDestination.checked = false;
  setDestination(state.settings.defaultDestination || "computer");
  refs.destinationSheet.hidden = false;
}

async function startTransfer() {
  const needsDrive = ["drive", "both"].includes(state.destination);
  if (needsDrive && (!state.drive.configured || !state.drive.connected)) {
    renderDriveRequirement();
    return;
  }

  if (refs.rememberDestination.checked) {
    await saveSettings({ askDestination: false, defaultDestination: state.destination });
  }

  refs.startTransferBtn.disabled = true;
  refs.startTransferBtn.textContent = "Starting…";
  const result = await sendToTab({
    type: "START_SESSION",
    keys: state.pendingKeys,
    mode: state.pendingMode,
    destination: state.destination,
    driveFolderId: needsDrive ? state.driveFolderId : null,
    options: state.settings
  });
  refs.startTransferBtn.textContent = "Start";
  refs.startTransferBtn.disabled = false;

  if (!result.ok) {
    refs.destinationSheet.hidden = true;
    setHint(result.error || "Could not start the transfer.", "error");
    return;
  }

  refs.destinationSheet.hidden = true;
  setHint(`Started ${result.count} file${result.count === 1 ? "" : "s"}. Progress is shown on the BYS page.`, "ok");
  setTimeout(() => window.close(), 600);
}

async function connectDrive() {
  refs.driveSubtitle.textContent = "Waiting for Google…";
  const result = await bgMessage({ type: "DRIVE_CONNECT" });
  state.drive = result;
  renderDrive();
  renderDriveRequirement();
  if (result.connected) {
    setHint("Google Drive connected. You only need to authorize it once.", "ok");
    openFolderPicker();
  } else if (!result.configured) {
    bgMessage({ type: "OPEN_DRIVE_SETUP" });
  } else if (result.error) {
    setHint(result.error, "error");
  }
}

async function disconnectDrive() {
  await bgMessage({ type: "DRIVE_DISCONNECT" });
  state.drive = await bgMessage({ type: "DRIVE_STATUS", interactive: false });
  renderDrive();
}

async function openFolderPicker() {
  if (!state.drive.connected) {
    await connectDrive();
    if (!state.drive.connected) return;
  }
  state.folderStack = [{ id: "root", name: "My Drive" }];
  refs.folderSheet.hidden = false;
  await loadFolderLevel();
}

async function loadFolderLevel() {
  const current = state.folderStack[state.folderStack.length - 1];
  refs.folderBreadcrumb.textContent = state.folderStack.map((f) => f.name).join(" / ");
  refs.folderUpBtn.disabled = state.folderStack.length === 1;
  refs.folderList.innerHTML = '<div class="folder-loading">Loading folders…</div>';
  const result = await bgMessage({ type: "DRIVE_LIST_FOLDERS", parentId: current.id });
  refs.folderList.replaceChildren();
  if (!result.ok) {
    const error = document.createElement("div");
    error.className = "folder-empty";
    error.textContent = result.error || "Could not load folders.";
    refs.folderList.appendChild(error);
    return;
  }
  if (!result.folders?.length) {
    const empty = document.createElement("div");
    empty.className = "folder-empty";
    empty.textContent = "No subfolders here.";
    refs.folderList.appendChild(empty);
    return;
  }
  for (const folder of result.folders) {
    const item = document.createElement("div");
    item.className = "folder-item";
    item.innerHTML = '<span class="folder-icon">▰</span><strong></strong>';
    item.querySelector("strong").textContent = folder.name;
    item.addEventListener("click", async () => {
      state.folderStack.push({ id: folder.id, name: folder.name });
      await loadFolderLevel();
    });
    refs.folderList.appendChild(item);
  }
}

async function selectCurrentFolder() {
  const current = state.folderStack[state.folderStack.length - 1];
  state.driveFolderId = current.id;
  state.driveFolderName = current.name;
  state.driveFolderPath = state.folderStack.map((f) => f.name).join(" / ");
  await chrome.storage.local.set({
    driveFolderId: state.driveFolderId,
    driveFolderName: state.driveFolderName,
    driveFolderPath: state.driveFolderPath
  });
  refs.folderSheet.hidden = true;
  renderDrive();
  renderDriveRequirement();
}

async function createNewFolder() {
  const name = prompt("New folder name:");
  if (!name?.trim()) return;
  const current = state.folderStack[state.folderStack.length - 1];
  const result = await bgMessage({ type: "DRIVE_CREATE_FOLDER", parentId: current.id, name: name.trim() });
  if (!result.ok) return alert(result.error || "Could not create folder.");
  await loadFolderLevel();
}

async function exportCsv() {
  const items = currentItems();
  if (!items.length) return;
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Week", "Document title", "Status", "Last saved"], ...items.map((item) => {
    const h = state.history[item.key];
    return [item.week, item.title, h ? "Saved" : "New", h?.timestamp ? new Date(h.timestamp).toISOString() : ""];
  })];
  const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const dataUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  const filename = `${(state.page?.courseName || "SUBU").replace(/[\\/:*?"<>|]/g, "_")} - document list.csv`;
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: "uniquify" });
}

async function resumeSession() {
  const result = await sendToTab({ type: "RESUME_SESSION" });
  if (!result.ok) return setHint(result.error || "Could not resume.", "error");
  setHint(`Resuming ${result.count} remaining file${result.count === 1 ? "" : "s"}.`, "ok");
  setTimeout(() => window.close(), 500);
}

// Navigation
document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

// Power
refs.enabledToggle.addEventListener("change", async () => {
  state.enabled = refs.enabledToggle.checked;
  await chrome.storage.local.set({ enabled: state.enabled });
  await sendToTab({ type: "SET_ENABLED", enabled: state.enabled });
  renderHome();
  renderFiles();
});

// Main actions
refs.downloadAllBtn.addEventListener("click", () => prepareTransfer(currentItems().map((i) => i.key), "all"));
refs.newOnlyBtn.addEventListener("click", () => prepareTransfer(getNewItems().map((i) => i.key), "new"));
refs.chooseBtn.addEventListener("click", () => switchView("files"));
refs.exportBtn.addEventListener("click", exportCsv);
refs.resumeBtn.addEventListener("click", resumeSession);

// Drive
refs.connectDriveBtn.addEventListener("click", connectDrive);
refs.disconnectDriveBtn.addEventListener("click", disconnectDrive);
refs.driveSetupBtn.addEventListener("click", () => bgMessage({ type: "OPEN_DRIVE_SETUP" }));
refs.changeFolderBtn.addEventListener("click", openFolderPicker);

// Files
refs.fileSearch.addEventListener("input", () => { state.fileSearch = refs.fileSearch.value; renderFiles(); });
document.querySelectorAll("[data-filter]").forEach((btn) => btn.addEventListener("click", () => {
  state.fileFilter = btn.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("active", b === btn));
  renderFiles();
}));
refs.selectAllBtn.addEventListener("click", () => {
  const q = state.fileSearch.toLowerCase();
  currentItems().filter((item) => {
    if (state.fileFilter === "new" && isSaved(item)) return false;
    if (state.fileFilter === "saved" && !isSaved(item)) return false;
    return !q || `${item.week} ${item.title}`.toLowerCase().includes(q);
  }).forEach((item) => state.selectedKeys.add(item.key));
  renderFiles();
});
refs.clearSelectionBtn.addEventListener("click", () => { state.selectedKeys.clear(); renderFiles(); });
refs.downloadSelectedBtn.addEventListener("click", () => prepareTransfer([...state.selectedKeys], "selected"));

// Destination sheet
document.querySelectorAll(".destination-option").forEach((btn) => btn.addEventListener("click", () => setDestination(btn.dataset.destination)));
document.querySelector("[data-close-sheet]").addEventListener("click", () => refs.destinationSheet.hidden = true);
refs.startTransferBtn.addEventListener("click", startTransfer);

// Folder sheet
document.querySelector("[data-close-folder]").addEventListener("click", () => refs.folderSheet.hidden = true);
refs.folderUpBtn.addEventListener("click", async () => {
  if (state.folderStack.length > 1) state.folderStack.pop();
  await loadFolderLevel();
});
refs.newFolderBtn.addEventListener("click", createNewFolder);
refs.selectCurrentFolderBtn.addEventListener("click", selectCurrentFolder);

// Settings
autoSave(refs.filenamePattern, "change", () => ({ filenamePattern: refs.filenamePattern.value }));
autoSave(refs.localCourseFolder, "change", () => ({ localCourseFolder: refs.localCourseFolder.checked }));
autoSave(refs.driveCourseFolder, "change", () => ({ driveCourseFolder: refs.driveCourseFolder.checked }));
autoSave(refs.delayMs, "change", () => ({ delayMs: Number(refs.delayMs.value) }));
autoSave(refs.retries, "change", () => ({ retries: Number(refs.retries.value) }));
autoSave(refs.autoSkip, "change", () => ({ autoSkip: refs.autoSkip.checked }));
autoSave(refs.duplicatePolicy, "change", () => ({ duplicatePolicy: refs.duplicatePolicy.value }));
autoSave(refs.askDestination, "change", () => ({ askDestination: refs.askDestination.checked }));
autoSave(refs.defaultDestination, "change", () => ({ defaultDestination: refs.defaultDestination.value }));

function autoSave(element, eventName, patchFn) {
  element.addEventListener(eventName, async () => {
    await saveSettings(patchFn());
    renderSettings();
  });
}

refs.clearHistoryBtn.addEventListener("click", async () => {
  if (!confirm("Clear the extension's saved-file history? This does not delete any files.")) return;
  state.history = {};
  await chrome.storage.local.set({ history: {} });
  renderHome();
  renderFiles();
});

loadState().catch((err) => {
  state.page = { ok: false, isSubu: false, documentCount: 0, items: [] };
  setHint(err?.message || String(err), "error");
  renderHome();
});
