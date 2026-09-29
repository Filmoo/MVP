// The pages' little bit of behaviour: the latest version and the download on the home page,
// the list of versions, and a hint toward the other language. Every word is in the HTML of the
// page (English or French); this file only picks which prepared state shows and fills in
// versions, dates and sizes. Without JavaScript the pages link to GitHub instead (noscript.css).
// Only the home and versions pages load the release and markdown modules (preloaded there).
const page = document.body.dataset.page;
const needsReleases = page === "home" || page === "versions";
const [{ renderMarkdown }, { installerOf, latestStable, loadReleases, REPO, versionOf }] = needsReleases
  ? await Promise.all([import("./markdown.js"), import("./releases.js")])
  : [{}, {}];

const french = document.documentElement.lang === "fr";
const locale = french ? "fr-FR" : "en-GB";
const dates = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });
const megabytes = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const formatDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dates.format(date);
};
// Windows counts in binary megabytes, like this; French says "Mo".
const formatSize = (bytes) => `${megabytes.format(bytes / 1048576)} ${french ? "Mo" : "MB"}`;

const field = (root, name) => root.querySelector(`[data-field="${name}"]`);
const link = (root, name) => root.querySelector(`[data-link="${name}"]`);

function setText(root, name, value) {
  const element = field(root, name);
  if (element) element.textContent = value;
}

function setDate(root, name, iso) {
  const element = field(root, name);
  if (!element) return;
  element.textContent = formatDate(iso);
  element.dateTime = iso;
}

/** Shows one prepared state of a block (they share one grid cell: nothing moves). */
function show(block, state) {
  for (const child of block.children) {
    if (child.dataset.state) child.classList.toggle("on", child.dataset.state === state);
  }
  block.dataset.shown = state;
}

function notesInto(container, release, headingLevel) {
  const empty = field(container, "empty");
  const notes = field(container, "notes");
  const body = release.body.trim();
  notes.replaceChildren(body ? renderMarkdown(body, { repo: REPO, headingLevel }) : "");
  if (empty) empty.hidden = Boolean(body);
}

async function home() {
  const download = document.querySelector('[data-states="download"]');
  const notes = document.querySelector('[data-states="notes"]');
  try {
    const releases = await loadReleases();
    const latest = latestStable(releases);
    const setup = installerOf(latest);
    if (setup) {
      const ready = download.querySelector('[data-state="ready"]');
      setText(ready, "tag", latest.tag);
      link(ready, "download").href = setup.url;
      setText(ready, "file", setup.name);
      setText(ready, "size", formatSize(setup.size));
      setDate(ready, "date", latest.date);
      link(ready, "release").href = latest.url;
      const digest = /^sha256:([0-9a-f]{64})$/i.exec(setup.digest);
      setText(ready, "digest", digest ? `SHA-256 ${digest[1].toLowerCase()}` : "");
      show(download, "ready");
    } else {
      const preview = field(download, "preview");
      if (preview) preview.hidden = !releases.some((release) => release.prerelease && installerOf(release));
      show(download, "none");
    }
    if (latest) {
      const ready = notes.querySelector('[data-state="ready"]');
      setText(ready, "version", versionOf(latest));
      setDate(ready, "date", latest.date);
      notesInto(ready, latest, 4);
      show(notes, "ready");
    } else {
      show(notes, "none");
    }
  } catch (error) {
    show(download, "error");
    show(notes, "error");
    console.warn("MVP: no releases from GitHub:", error);
  }
}

function releaseEntry(template, release, isLatest) {
  const item = template.content.firstElementChild.cloneNode(true);
  const stamp = field(item, "tag");
  stamp.textContent = release.tag;
  stamp.classList.toggle("stamp-pre", release.prerelease);
  setDate(item, "date", release.date);
  field(item, "latest").hidden = !isLatest;
  field(item, "pre").hidden = !release.prerelease;
  setText(item, "title", release.name.trim() || release.tag);
  notesInto(item, release, 3);
  const setup = installerOf(release);
  const download = link(item, "download");
  if (setup) {
    download.href = setup.url;
    setText(item, "size", formatSize(setup.size));
  } else {
    download.remove();
  }
  link(item, "release").href = release.url;
  return item;
}

async function versions() {
  const block = document.querySelector('[data-states="versions"]');
  try {
    const releases = await loadReleases();
    if (!releases.length) {
      show(block, "none");
      return;
    }
    const latest = latestStable(releases);
    const template = document.getElementById("release-entry");
    block.querySelector("[data-list]").replaceChildren(...releases.map((release) => releaseEntry(template, release, release === latest)));
    show(block, "ready");
  } catch (error) {
    show(block, "error");
    console.warn("MVP: no releases from GitHub:", error);
  }
}

/** Your browser prefers the other language: circle its link lightly, in pencil. */
function hintLanguage() {
  const other = document.querySelector(".lang a:not([aria-current])");
  const wanted = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  if (other?.hreflang && wanted.startsWith(other.hreflang) && !wanted.startsWith(document.documentElement.lang)) {
    other.classList.add("hinted");
  }
}

hintLanguage();
if (page === "home") home();
if (page === "versions") versions();
