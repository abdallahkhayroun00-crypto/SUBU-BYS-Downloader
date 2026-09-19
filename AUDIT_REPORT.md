# Group 01 — Baseline audit (v2.0.1)

Scope: static review of the 20 files on `main`, particularly `manifest.json`, `content.js`, `background.js`, `popup.js`, `popup.html`, and CSS. **No live authenticated SUBÜ or Google Drive end-to-end test was performed.** Findings are not assertions of observed production incidents.

## Architecture and data-flow baseline
- Manifest V3: `popup.html` → `popup.js` for UI, `content.js` for DOM parsing and session loop, `background.js` as service worker for Chrome downloads, OAuth and Drive API. `styles.css` injects the page overlay; `drive-setup.html` is an options page.
- Flow: popup calls `GET_PAGE_INFO` → content scans table → popup sends `START_SESSION` with keys/destination/options → content sequentially starts and polls transfers through background messages → background intercepts Chrome download or fetches the source URL and uploads to Drive → content records history/resume in `chrome.storage.local`.
- Durable data is an unversioned object with `enabled`, `settings`, `history`, `resumeSession`, `driveFolderId/Name/Path`. `pendingTransfer` is only an in-memory singleton in the MV3 service worker; session is an in-memory singleton in the page content script.
- Preserve current UX and manifest version; do not change production behavior as part of Group 01.

## Confirmed code-level findings (ordered by impact)
| ID | Severity | Evidence and concrete behavior | Required regression case |
|---|---|---|---|
| F01 | Critical | `background.js:482-515` treats the first eligible browser download while a transfer is armed as the target, without binding `downloadItem` to the expected source/tab or request; a concurrent unrelated page download can be renamed, recorded or cancelled in capture-only mode. | Arm a transfer, initiate an unrelated download, then the intended download: unrelated file must remain untouched. |
| F02 | High | `background.js:514` marks a transfer resolved inside `onDeterminingFilename`, before `chrome.downloads.onChanged` signals completed; `content.js:275-279,460-468` may increment completed and commit history before bytes are fully saved. `CLEAR_TRANSFER` then drops tracking. | Simulate filename determination followed by interrupted download: never mark saved. |
| F03 | High | `background.js:22,538-556` keeps exactly one global pending transfer with no busy check. `content.js:523-525` rejects concurrent sessions only inside the same tab; different SUBÜ tabs can overwrite each other's token. | Start transfers in two tabs; second must be queued/rejected without corrupting first. |
| F04 | High | `content.js:327-345,351-368`: Both destination uploads to Drive *before* local download; if local fails, retry uploads to Drive again (and may duplicate/replace) despite first success. History records only after both. | Succeed Drive upload then fail local; retry must not repeat completed destination. |
| F05 | High | `content.js:472-493,391-408,503-506`: auto-skip and manual skip advance the resume index; an all-skipped or partially failed session clears resume at the end. History stores successful/skipped-duplicate items only, so failed/skipped files are not offered in Resume. | Skip failed item, finish, reopen: must accurately show failed/skipped vs completed and offer retry. |
| F06 | High | `background.js:318-339,427-433,616-619` fetches caller-supplied `sourceUrl` with credentials and no explicit trusted-host / redirect target validation. An extension message could use allowed fetch capabilities for a URL outside the intended SUBÜ document endpoint; verify effective host permissions and disallow arbitrary destinations. | Reject source URL/redirect outside approved trusted origins. |
| F07 | Medium | `content.js:123-130` identifies a file using hash(course code/name, week, title), not a stable document ID/content version. Distinct resources sharing same title/week get identical history keys; updated documents with same title remain “saved.” | Two same-title documents in one week and one revised resource must be distinguishable. |
| F08 | Medium | `content.js:523-532`: when `message.keys` is an empty array, code uses `null` and selects *all* documents; UI normally blocks empty selections but any malformed or stale START_SESSION can broaden scope. | Empty explicit key list must never download all. |
| F09 | Medium | `background.js:407-424` duplicate detection is filename-based, not checksum/content-based. Skip may treat different content as existing; replace updates one matching ID. `content.js:314-345` counts skipped duplicate as drive success. | Same-name/different-content file must not be silently considered equivalent. |
| F10 | Medium | `background.js:22,100-101,538-577`: the MV3 worker stores transfer token/state only in RAM; worker suspension/restart can lose it mid-session. `content.js:245-256` then times out after 30 seconds. | Simulate worker restart mid-transfer, ensure safe recovery/no incorrect completion. |
| F11 | Medium | `popup.html:19-22,93-109,170-193` uses hidden checkbox and clickable div rows without equivalent keyboard/ARIA semantics, and dialogs lack focus management. CSS `popup.css:8` fixes popup width at 430px; `popup.html:16` displays “2.0” while manifest is 2.0.1. | Keyboard-only navigation, focus trap/return, narrow popup, displayed version matches manifest. |
| F12 | Medium | `manifest.json:20-24` uses broad `https://www.googleapis.com/auth/drive` instead of least-privilege authorization; permissions include tabs/identity.email. `drive-setup.html:16` equates client-ID presence with ready-to-connect, which cannot prove OAuth policy/user/tester eligibility. | Review Drive scopes/account consent and verify behavior on a fresh separate Google account. |
| F13 | Medium | `content.js:84-134` collects table rows by positional cells and generic last-cell control; any BYS markup change or extra data table can make a wrong document mapping. | Fixtures: shifted columns, pagination, empty table, unrelated table, duplicate title. |
| F14 | Low | `README.txt` and `README_AR.txt` refer to a `SUBU-BYS-Downloader-v2.0` folder, while GitHub repository root contains `manifest.json` and version 2.0.1. | Install from repository ZIP and select exact folder containing manifest. |

## Additional checks before claiming a bug
- Validate whether SUBÜ downloads use the PDF viewer/new tabs, form POST, signed or expiring URLs; source capture and browser download interception behave differently for each case.
- Measure large-file memory in `fetchSourceBlob` + multipart/resumable; the current flow materializes the full source as a Blob and is not a streaming download.
- Confirm Drive folder listing/pagination, quota handling, 401/429 backoff, and resumable upload completion using test accounts.
- Confirm dark mode legibility and scroll behavior on real Chrome sizes; no browser UI screenshot or accessibility automation was run.
- User documentation calls OFF “zero lag”; static source supports no recurring DOM scanner, but performance needs measurement.

## Baseline test matrix
1. Source checks: JSON manifest parse, referenced HTML/CSS/JS/icon files exist, JS syntax (`node --check`), HTML IDs referenced by popup.
2. Unit fixtures: filename sanitation, week-number parsing, stable unique document identities, same-name/different-content duplicate, URL/redirect allowlist.
3. Integration mocks: filename interception unrelated download, download completion/interruption, two concurrent tabs, worker restart, pause/stop/retry, Drive success + local failure, skip/resume and empty selection.
4. Manual acceptance on authorized SUBÜ account: five representative file types; new-only; local/Drive/both; Drive reconnect; session expiration; PDF viewer; large file; browser restart; no unrelated download changed.
5. UI acceptance: keyboard and focus, error/empty/loading, zoom 100/125/200%, 430px popup, contrast, dark mode.

## Exit criteria
The repository contains this report and runnable baseline smoke checks on the audit branch. F01–F06 must have failing regression tests before corresponding fixes are implemented in Group 02/03. Live behavior and security claims require manual or instrumented verification; do not mark them passed based on static inspection.
