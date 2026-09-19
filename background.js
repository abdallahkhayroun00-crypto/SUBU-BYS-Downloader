const DEFAULTS = {
  enabled: true,
  settings: {
    filenamePattern: "week-title",
    localCourseFolder: true,
    driveCourseFolder: true,
    delayMs: 2000,
    retries: 2,
    autoSkip: false,
    duplicatePolicy: "skip",
    askDestination: true,
    defaultDestination: "computer",
    showPageControls: false
  },
  driveFolderId: "root",
  driveFolderName: "My Drive",
  driveFolderPath: "My Drive",
  history: {},
  resumeSession: null
};

let pendingTransfer = null;
let extensionEnabled = true;

function sanitizeSegment(name, fallback = "document") {
  return String(name || fallback)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/^\s+|\s+$/g, "")
    .slice(0, 180) || fallback;
}

function sanitizePath(path) {
  return String(path || "")
    .split(/[\\/]+/)
    .map((part) => sanitizeSegment(part, "folder"))
    .filter(Boolean)
    .join("/");
}

function getExtensionFromDownload(downloadItem) {
  const fromFilename = (downloadItem.filename || "").match(/\.([A-Za-z0-9]{1,10})$/);
  if (fromFilename) return "." + fromFilename[1].toLowerCase();

  for (const raw of [downloadItem.finalUrl, downloadItem.url]) {
    try {
      const u = new URL(raw || "");
      const m = u.pathname.match(/\.([A-Za-z0-9]{1,10})$/);
      if (m) return "." + m[1].toLowerCase();
    } catch (_) {}
  }

  return extensionFromMime(downloadItem.mime || "");
}

function extensionFromMime(rawMime) {
  const mime = String(rawMime || "").toLowerCase().split(";")[0].trim();
  const map = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "application/zip": ".zip",
    "application/x-rar-compressed": ".rar",
    "text/plain": ".txt"
  };
  return map[mime] || "";
}

function extensionFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl || "");
    const m = u.pathname.match(/\.([A-Za-z0-9]{1,10})$/);
    return m ? "." + m[1].toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

function parseContentDispositionFilename(header) {
  const raw = String(header || "");
  const utf = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) {
    try { return decodeURIComponent(utf[1].replace(/["']/g, "")); } catch (_) {}
  }
  const basic = raw.match(/filename\s*=\s*"?([^";]+)"?/i);
  return basic ? basic[1].trim() : "";
}

function extensionFromResponse(response, sourceUrl) {
  const cdName = parseContentDispositionFilename(response.headers.get("content-disposition"));
  const m = cdName.match(/\.([A-Za-z0-9]{1,10})$/);
  if (m) return "." + m[1].toLowerCase();
  return extensionFromMime(response.headers.get("content-type")) || extensionFromUrl(response.url || sourceUrl);
}

function isRecentPending(maxAge = 60000) {
  return !!pendingTransfer && Date.now() - pendingTransfer.createdAt < maxAge;
}

// Only touch downloads attributable to the armed BYS tab and trusted BYS origin.
// A source URL is an additional exact-match guard when the DOM exposes one.
function matchesPendingDownload(downloadItem, transfer = pendingTransfer) {
  if (!transfer || !downloadItem || transfer.downloadId != null) return false;
  if (transfer.processingPdf && transfer.forcedDownloadId != null && downloadItem.id === transfer.forcedDownloadId) return true;
  if (downloadItem.byExtensionId === chrome.runtime.id) return false;
  if (transfer.tabId == null || downloadItem.tabId !== transfer.tabId) return false;
  const candidate = downloadItem.finalUrl || downloadItem.url || "";
  if (!/^https:\/\/ogrenci\.bys\.subu\.edu\.tr(?:\/|$)/i.test(candidate)) return false;
  if (transfer.expectedUrl) {
    try {
      const expected = new URL(transfer.expectedUrl);
      const actual = new URL(candidate);
      if (expected.origin !== actual.origin || expected.pathname !== actual.pathname || expected.search !== actual.search) return false;
    } catch (_) { return false; }
  }
  return true;
}

function decodeMaybe(value) {
  let out = String(value || "");
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch (_) { break; }
  }
  return out;
}

function extractOriginalHttpUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = String(rawUrl);
  if (/^https?:\/\//i.test(url)) return url;

  try {
    const parsed = new URL(url);
    for (const key of ["file", "url", "src", "source"]) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      const decoded = decodeMaybe(value);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch (_) {}

  const directMatch = url.match(/\/(https?:\/\/.*)$/i);
  if (directMatch) {
    const decoded = decodeMaybe(directMatch[1]);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  }

  const encodedIndex = url.search(/https?%3A%2F%2F/i);
  if (encodedIndex >= 0) {
    const decoded = decodeMaybe(url.slice(encodedIndex));
    const match = decoded.match(/https?:\/\/[^#]+/i);
    if (match) return match[0];
  }
  return null;
}

function markTransferResolved({ filename, method, downloadId = null, sourceUrl = null }) {
  if (!pendingTransfer) return;
  pendingTransfer.resolved = true;
  pendingTransfer.filename = filename || null;
  pendingTransfer.method = method || "download";
  pendingTransfer.downloadId = downloadId;
  pendingTransfer.sourceUrl = sourceUrl || pendingTransfer.sourceUrl || null;
  pendingTransfer.error = null;
}

function setTransferError(message, details = null) {
  if (!pendingTransfer) return;
  pendingTransfer.error = String(message || "Unknown error");
  pendingTransfer.errorDetails = details || null;
}

async function setBadgeText(text, color) {
  await chrome.action.setBadgeText({ text: text || "" });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}

async function updateActionBadge(enabled = extensionEnabled) {
  extensionEnabled = enabled !== false;
  await setBadgeText(extensionEnabled ? "ON" : "OFF", extensionEnabled ? "#168653" : "#7B8798");
  await chrome.action.setTitle({ title: extensionEnabled ? "SUBÜ BYS Downloader · ON" : "SUBÜ BYS Downloader · OFF" });
}

async function initializeSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const mergedSettings = { ...DEFAULTS.settings, ...(stored.settings || {}) };
  await chrome.storage.local.set({
    enabled: stored.enabled !== false,
    settings: mergedSettings,
    driveFolderId: stored.driveFolderId || "root",
    driveFolderName: stored.driveFolderName || "My Drive",
    driveFolderPath: stored.driveFolderPath || "My Drive",
    history: stored.history || {},
    resumeSession: stored.resumeSession || null
  });
  extensionEnabled = stored.enabled !== false;
  await updateActionBadge(extensionEnabled);
}

chrome.runtime.onInstalled.addListener(() => initializeSettings());
chrome.runtime.onStartup.addListener(() => initializeSettings());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled) {
    extensionEnabled = changes.enabled.newValue !== false;
    if (!extensionEnabled) pendingTransfer = null;
    updateActionBadge(extensionEnabled);
  }
});
initializeSettings();

function oauthConfigured() {
  const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || "";
  return !!clientId && !clientId.startsWith("REPLACE_WITH_");
}

async function getDriveToken(interactive = false) {
  if (!oauthConfigured()) {
    throw new Error("Google Drive OAuth is not configured yet. Open Drive setup first.");
  }
  const result = await chrome.identity.getAuthToken({ interactive });
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new Error("Google did not return an access token.");
  return token;
}

async function driveApiFetch(url, options = {}, interactive = false, retry = true) {
  let token = await getDriveToken(interactive);
  const doFetch = (tok) => fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${tok}`
    }
  });

  let response = await doFetch(token);
  if (response.status === 401 && retry) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getDriveToken(interactive);
    response = await doFetch(token);
  }
  return response;
}

async function driveStatus(interactive = false) {
  if (!oauthConfigured()) return { configured: false, connected: false, extensionId: chrome.runtime.id };
  try {
    const response = await driveApiFetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)", {}, interactive);
    if (!response.ok) throw new Error(`Google Drive returned HTTP ${response.status}`);
    const data = await response.json();
    return {
      configured: true,
      connected: true,
      extensionId: chrome.runtime.id,
      user: data.user || null
    };
  } catch (err) {
    return { configured: true, connected: false, extensionId: chrome.runtime.id, error: err?.message || String(err) };
  }
}

async function driveDisconnect() {
  try {
    await chrome.identity.clearAllCachedAuthTokens();
  } catch (_) {}
  return { ok: true };
}

function qEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listDriveFolders(parentId = "root", interactive = false) {
  const q = `'${qEscape(parentId)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("orderBy", "name_natural");
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("spaces", "drive");
  const response = await driveApiFetch(url.toString(), {}, interactive);
  if (!response.ok) throw new Error(`Could not list Drive folders (HTTP ${response.status}).`);
  const data = await response.json();
  return data.files || [];
}

async function createDriveFolder(name, parentId = "root") {
  const response = await driveApiFetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: sanitizeSegment(name, "SUBU Course"),
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId || "root"]
    })
  });
  if (!response.ok) throw new Error(`Could not create Drive folder (HTTP ${response.status}).`);
  return response.json();
}

async function ensureDriveFolder(name, parentId = "root") {
  const safeName = sanitizeSegment(name, "SUBU Course");
  const q = `'${qEscape(parentId)}' in parents and name='${qEscape(safeName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "10");
  const response = await driveApiFetch(url.toString());
  if (!response.ok) throw new Error(`Could not search Drive folders (HTTP ${response.status}).`);
  const data = await response.json();
  if (data.files?.length) return { ...data.files[0], existing: true };
  const created = await createDriveFolder(safeName, parentId);
  return { ...created, existing: false };
}

async function findDriveDuplicate(name, parentId) {
  const q = `'${qEscape(parentId)}' in parents and name='${qEscape(name)}' and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
  url.searchParams.set("pageSize", "10");
  const response = await driveApiFetch(url.toString());
  if (!response.ok) throw new Error(`Could not check Drive duplicates (HTTP ${response.status}).`);
  const data = await response.json();
  return data.files?.[0] || null;
}

async function fetchSourceBlob(sourceUrl) {
  const response = await fetch(sourceUrl, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    cache: "no-store"
  });
  if (!response.ok) {
    const error = new Error(`SUBÜ file request failed (HTTP ${response.status}).`);
    error.httpStatus = response.status;
    throw error;
  }
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html")) {
    const text = await response.clone().text();
    if (/error|hata|login|giriş|500|403|404/i.test(text.slice(0, 4000))) {
      throw new Error("SUBÜ returned an HTML error/login page instead of the document.");
    }
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("SUBÜ returned an empty file.");
  return { blob, response, extension: extensionFromResponse(response, sourceUrl) };
}

async function uploadMultipart(blob, metadata, existingId = null) {
  const boundary = "subu_bys_" + crypto.randomUUID().replace(/-/g, "");
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ]);
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,webViewLink`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
  const response = await driveApiFetch(url, {
    method: existingId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  if (!response.ok) throw new Error(`Google Drive upload failed (HTTP ${response.status}).`);
  return response.json();
}

async function uploadResumable(blob, metadata, existingId = null) {
  const initUrl = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id,name,webViewLink`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink";
  const init = await driveApiFetch(initUrl, {
    method: existingId ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": blob.type || "application/octet-stream",
      "X-Upload-Content-Length": String(blob.size)
    },
    body: JSON.stringify(metadata)
  });
  if (!init.ok) throw new Error(`Could not start Drive upload (HTTP ${init.status}).`);
  const location = init.headers.get("location");
  if (!location) throw new Error("Google Drive did not provide a resumable upload URL.");

  const token = await getDriveToken(false);
  let response = await fetch(location, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": blob.type || "application/octet-stream",
      "Content-Length": String(blob.size)
    },
    body: blob
  });
  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    const fresh = await getDriveToken(false);
    response = await fetch(location, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${fresh}`,
        "Content-Type": blob.type || "application/octet-stream",
        "Content-Length": String(blob.size)
      },
      body: blob
    });
  }
  if (!response.ok) throw new Error(`Google Drive upload failed (HTTP ${response.status}).`);
  return response.json();
}

async function uploadBlobToDrive(blob, filename, parentId, duplicatePolicy = "skip") {
  const safeName = sanitizeSegment(filename, "document");
  const duplicate = await findDriveDuplicate(safeName, parentId);
  if (duplicate && duplicatePolicy === "skip") {
    return { ok: true, skippedDuplicate: true, file: duplicate, filename: safeName };
  }

  const metadata = { name: safeName, parents: [parentId || "root"] };
  let existingId = null;
  if (duplicate && duplicatePolicy === "replace") {
    existingId = duplicate.id;
    delete metadata.parents;
  }

  const result = blob.size <= 5 * 1024 * 1024
    ? await uploadMultipart(blob, metadata, existingId)
    : await uploadResumable(blob, metadata, existingId);
  return { ok: true, skippedDuplicate: false, file: result, filename: safeName };
}

async function uploadUrlToDrive({ sourceUrl, baseName, folderId, duplicatePolicy = "skip" }) {
  if (!sourceUrl) throw new Error("No document URL was available for Google Drive upload.");
  if (!folderId) throw new Error("Choose a Google Drive folder first.");
  const fetched = await fetchSourceBlob(sourceUrl);
  const extension = fetched.extension || extensionFromMime(fetched.blob.type) || "";
  const filename = sanitizeSegment(baseName, "document") + extension;
  const uploaded = await uploadBlobToDrive(fetched.blob, filename, folderId, duplicatePolicy);
  return {
    ...uploaded,
    sourceUrl: fetched.response.url || sourceUrl,
    size: fetched.blob.size,
    mimeType: fetched.blob.type || null
  };
}

async function handlePdfViewer(tabId, viewerUrl) {
  if (!extensionEnabled || !isRecentPending() || pendingTransfer.resolved || pendingTransfer.processingPdf) return;
  if (!viewerUrl || viewerUrl === "about:blank" || viewerUrl.startsWith("chrome://newtab")) return;

  const directUrl = extractOriginalHttpUrl(viewerUrl);
  if (!directUrl) {
    pendingTransfer.viewerUrl = viewerUrl;
    return;
  }

  pendingTransfer.processingPdf = true;
  pendingTransfer.pdfTabId = tabId;
  pendingTransfer.viewerUrl = viewerUrl;
  pendingTransfer.sourceUrl = directUrl;
  pendingTransfer.error = null;

  if (pendingTransfer.captureOnly) {
    markTransferResolved({
      filename: sanitizeSegment(pendingTransfer.baseName) + ".pdf",
      method: "capture-pdf",
      sourceUrl: directUrl
    });
    try { await chrome.tabs.remove(tabId); } catch (_) {}
    return;
  }

  try {
    const downloadId = await chrome.downloads.download({
      url: directUrl,
      saveAs: false,
      conflictAction: "uniquify"
    });
    pendingTransfer.forcedDownloadId = downloadId;
    try { await chrome.tabs.remove(tabId); } catch (_) {}
  } catch (err) {
    setTransferError(`PDF viewer opened, but Chrome could not start the PDF download: ${err?.message || err}`);
    pendingTransfer.processingPdf = false;
  }
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (!extensionEnabled || !isRecentPending() || pendingTransfer.resolved || !matchesPendingDownload(downloadItem)) {
    suggest();
    return;
  }

  const transfer = pendingTransfer;
  const ext = getExtensionFromDownload(downloadItem) || (transfer.processingPdf ? ".pdf" : "");
  const filename = sanitizeSegment(transfer.baseName, "document") + ext;
  const sourceUrl = downloadItem.finalUrl || downloadItem.url || transfer.sourceUrl || null;
  transfer.downloadId = downloadItem.id;
  transfer.filename = filename;
  transfer.sourceUrl = sourceUrl;
  transfer.method = transfer.captureOnly ? "capture" : (transfer.processingPdf ? "pdf-viewer" : "computer");

  if (transfer.captureOnly) {
    // Capture-only means inspect the URL, not download or delete any file.
    // Cancel only the exact matched BYS download; do not erase download history.
    suggest();
    chrome.downloads.cancel(downloadItem.id).then(() => {
      if (pendingTransfer?.token === transfer.token) transfer.resolved = true;
    }).catch((err) => {
      if (pendingTransfer?.token === transfer.token) setTransferError("Could not cancel captured BYS download: " + (err?.message || err));
    });
    return;
  }

  const folder = sanitizePath(transfer.folderPath || "");
  suggest({ filename: folder ? `${folder}/${filename}` : filename, conflictAction: "uniquify" });
  // Filename selection only starts a download; completion arrives via onChanged.
});

chrome.downloads.onChanged.addListener((delta) => {
  const transfer = pendingTransfer;
  if (!transfer || transfer.downloadId == null || delta.id !== transfer.downloadId) return;
  if (delta.error?.current || delta.state?.current === "interrupted") {
    setTransferError(`Chrome download error: ${delta.error?.current || "interrupted"}`);
    transfer.resolved = false;
    return;
  }
  if (delta.state?.current === "complete" && !transfer.captureOnly) {
    transfer.resolved = true;
    transfer.error = null;
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!extensionEnabled || !isRecentPending() || pendingTransfer.resolved) return;
  if (pendingTransfer.tabId == null || tab.openerTabId !== pendingTransfer.tabId) return;
  pendingTransfer.pdfTabId = tab.id;
  if (tab.url && tab.url !== "about:blank") handlePdfViewer(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!extensionEnabled || !isRecentPending() || pendingTransfer.resolved) return;
  if (pendingTransfer.pdfTabId !== tabId) return;
  const url = changeInfo.url || tab.url;
  if (url && url !== "about:blank") handlePdfViewer(tabId, url);
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "ARM_TRANSFER": {
      if (!extensionEnabled) return { ok: false, error: "Extension is turned OFF." };
      if (pendingTransfer && isRecentPending() && !pendingTransfer.resolved && !pendingTransfer.error) return { ok: false, error: "Another transfer is already active. Retry after it finishes." };
      const token = crypto.randomUUID();
      pendingTransfer = {
        token,
        baseName: sanitizeSegment(message.baseName, "document"),
        folderPath: message.folderPath || "",
        expectedUrl: message.expectedUrl || null,
        captureOnly: !!message.captureOnly,
        tabId: sender.tab?.id ?? null,
        createdAt: Date.now(),
        resolved: false,
        processingPdf: false,
        pdfTabId: null,
        error: null,
        sourceUrl: null
      };
      return { ok: true, token };
    }

    case "GET_TRANSFER_STATUS": {
      const ok = pendingTransfer && pendingTransfer.token === message.token;
      return {
        found: !!ok,
        resolved: !!(ok && pendingTransfer.resolved),
        filename: ok ? pendingTransfer.filename || null : null,
        method: ok ? pendingTransfer.method || null : null,
        downloadId: ok ? pendingTransfer.downloadId ?? pendingTransfer.forcedDownloadId ?? null : null,
        sourceUrl: ok ? pendingTransfer.sourceUrl || null : null,
        error: ok ? pendingTransfer.error || null : null,
        errorDetails: ok ? pendingTransfer.errorDetails || null : null,
        viewerDetected: !!(ok && pendingTransfer.viewerUrl)
      };
    }

    case "CLEAR_TRANSFER":
    case "CANCEL_TRANSFER": {
      if (pendingTransfer && (!message.token || pendingTransfer.token === message.token)) pendingTransfer = null;
      return { ok: true };
    }

    case "SET_PROGRESS_BADGE": {
      if (!extensionEnabled) return { ok: true };
      const text = String(message.text || "").slice(0, 4);
      await setBadgeText(text, message.error ? "#C33B42" : "#0A66C2");
      return { ok: true };
    }

    case "RESET_BADGE": {
      await updateActionBadge(extensionEnabled);
      return { ok: true };
    }

    case "DRIVE_STATUS":
      return driveStatus(!!message.interactive);

    case "DRIVE_CONNECT":
      return driveStatus(true);

    case "DRIVE_DISCONNECT":
      return driveDisconnect();

    case "DRIVE_LIST_FOLDERS": {
      const folders = await listDriveFolders(message.parentId || "root", !!message.interactive);
      return { ok: true, folders };
    }

    case "DRIVE_CREATE_FOLDER": {
      const folder = await createDriveFolder(message.name, message.parentId || "root");
      return { ok: true, folder };
    }

    case "DRIVE_ENSURE_FOLDER": {
      const folder = await ensureDriveFolder(message.name, message.parentId || "root");
      return { ok: true, folder };
    }

    case "DRIVE_UPLOAD_URL": {
      const result = await uploadUrlToDrive(message);
      return { ok: true, ...result };
    }

    case "NOTIFY_DONE": {
      try {
        await chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: message.title || "SUBÜ BYS Downloader",
          message: message.message || "Finished."
        });
      } catch (_) {}
      return { ok: true };
    }

    case "OPEN_DRIVE_SETUP": {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  Promise.resolve(handleMessage(message, sender))
    .then((result) => sendResponse(result ?? {}))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err), httpStatus: err?.httpStatus || null }));
  return true;
});
