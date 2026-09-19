const manifest = chrome.runtime.getManifest();
const clientId = manifest?.oauth2?.client_id || "";
const configured = !!clientId && !clientId.startsWith("REPLACE_WITH_");
const id = chrome.runtime.id;
document.getElementById("extensionId").textContent = id;
document.getElementById("shortId").textContent = id;
const status = document.getElementById("oauthStatus");
status.textContent = configured ? "Configured ✓" : "Not configured yet";
status.className = configured ? "good" : "bad";
document.getElementById("copyId").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(id);
  event.currentTarget.textContent = "Copied ✓";
  setTimeout(() => event.currentTarget.textContent = "Copy", 1000);
});
