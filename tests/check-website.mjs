import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pagesBase = new URL("https://example.invalid/my-github-pages-lab/");
const requiredFiles = ["index.html", "style.css", "app.js"];
const categories = ["agent", "evaluation", "retrieval", "vision"];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

// This small scanner covers static start tags and their attributes, not the browser DOM.
function readIndexTags() {
  const html = read("index.html");
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<([a-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'"<>])*)>/gi;
  const tags = [];

  for (let token; (token = tokens.exec(html)) !== null;) {
    if (!token[1]) continue;
    const name = token[1].toLowerCase();
    const attributes = new Map();
    const attributePattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
    for (const match of token[2].matchAll(attributePattern)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    tags.push({ name, attributes });

    // Tag-like text inside an inline script or stylesheet is not HTML.
    if (name === "script" || name === "style") {
      const closingTag = new RegExp("</" + name + "\\s*>", "gi");
      closingTag.lastIndex = tokens.lastIndex;
      if (closingTag.exec(html)) tokens.lastIndex = closingTag.lastIndex;
    }
  }
  return tags;
}

function requireOne(tags, tagName, attribute) {
  const matches = tags.filter(({ attributes }) => attributes.has(attribute));
  assert.equal(matches.length, 1, "Expected exactly one [" + attribute + "]");
  assert.equal(matches[0].name, tagName, "[" + attribute + "] must be on <" + tagName + ">");
  return matches[0].attributes;
}

function localResource(reference, context) {
  const value = reference.trim();
  if (value === "" || value.startsWith("#")) return null;
  assert.ok(!value.includes("\\"), context + " uses a backslash: " + value);
  // External URLs and embedded data have no file to verify in this repository.
  if (value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  assert.ok(!value.startsWith("/"), context + " must use a relative URL: " + value);

  const resolved = new URL(value, pagesBase);
  assert.ok(
    resolved.origin === pagesBase.origin && resolved.pathname.startsWith(pagesBase.pathname),
    context + " resolves outside the GitHub Pages project subpath: " + value
  );
  const encodedPath = resolved.pathname.slice(pagesBase.pathname.length);
  assert.doesNotMatch(encodedPath, /%2f|%5c/i, context + " has an encoded path separator: " + value);
  const relativePath = decodeURIComponent(encodedPath);
  if (!relativePath || relativePath.endsWith("/")) return relativePath + "index.html";
  return relativePath;
}

function verifyFile(relativePath, context) {
  let directory = root;
  for (const segment of relativePath.split("/")) {
    // Pages is case-sensitive even when this test is run on Windows.
    assert.ok(
      readdirSync(directory).includes(segment),
      context + " does not exist with the same spelling and case: " + relativePath
    );
    directory = join(directory, segment);
  }
  assert.ok(statSync(directory).isFile(), context + " is not a file: " + relativePath);
}

function srcsetUrls(srcset) {
  const urls = [];
  let cursor = 0;
  while (cursor < srcset.length) {
    while (/[\s,]/.test(srcset[cursor] ?? "")) cursor++;
    const start = cursor;
    while (cursor < srcset.length && !/\s/.test(srcset[cursor])) cursor++;
    const url = srcset.slice(start, cursor);
    if (!url) break;

    // Commas inside a data URL are not separators. A trailing comma ends this candidate.
    urls.push(url.replace(/,+$/, ""));
    if (!url.endsWith(",")) {
      const separator = srcset.indexOf(",", cursor);
      if (separator === -1) break;
      cursor = separator + 1;
    }
  }
  return urls;
}

test("Required website files exist and are not empty", () => {
  for (const file of requiredFiles) {
    verifyFile(file, "Required file");
    assert.ok(read(file).trim(), file + " is empty");
  }
});

test("app.js passes the Node.js syntax check without executing browser code", () => {
  const run = spawnSync(process.execPath, ["--check", join(root, "app.js")], {
    encoding: "utf8"
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr.trim() || "node --check failed");
});

test("HTML local references exist and stay inside the GitHub Pages project subpath", () => {
  const tags = readIndexTags();
  assert.ok(!tags.some(({ name }) => name === "base"), "Do not override relative URLs with <base>");

  for (const { name, attributes } of tags) {
    const references = ["src", "href", "xlink:href", "poster"]
      .filter((key) => attributes.has(key))
      .map((key) => [key, attributes.get(key)]);

    if (name === "object" && attributes.has("data")) {
      references.push(["data", attributes.get("data")]);
    }
    for (const key of ["srcset", "imagesrcset"]) {
      for (const reference of srcsetUrls(attributes.get(key) ?? "")) {
        references.push([key, reference]);
      }
    }
    for (const [key, reference] of references) {
      const context = "<" + name + " " + key + ">";
      const path = localResource(reference, context);
      if (path !== null) verifyFile(path, context);
    }
  }

  const stylesheets = tags.filter(({ name, attributes }) => (
    name === "link" && (attributes.get("rel") ?? "").split(/\s+/).includes("stylesheet")
  ));
  assert.ok(
    stylesheets.some(({ attributes }) => localResource(attributes.get("href") ?? "", "<link href>") === "style.css"),
    "index.html must load the local style.css"
  );
  assert.ok(
    tags.some(({ name, attributes }) => (
      name === "script" && localResource(attributes.get("src") ?? "", "<script src>") === "app.js"
    )),
    "index.html must load the local app.js"
  );
});

test("The four project categories each have exactly one matching filter", () => {
  const tags = readIndexTags();
  requireOne(tags, "div", "data-filters");
  requireOne(tags, "div", "data-project-grid");
  requireOne(tags, "p", "data-project-count");

  const cards = tags.filter(({ attributes }) => attributes.has("data-category"));
  assert.ok(cards.every(({ name }) => name === "article"), "Project cards must be <article> elements");
  assert.deepEqual(cards.map(({ attributes }) => attributes.get("data-category")).sort(), categories);

  const filters = tags.filter(({ attributes }) => attributes.has("data-filter"));
  assert.ok(filters.every(({ name }) => name === "button"), "Filters must be buttons");
  const filterValues = filters.map(({ attributes }) => attributes.get("data-filter"));
  assert.deepEqual(filterValues.sort(), [...categories, "all"].sort());

  for (const { attributes } of filters) {
    assert.equal(attributes.get("aria-pressed"), String(attributes.get("data-filter") === "all"));
  }

  const app = read("app.js");
  for (const marker of ["data-filters", "data-filter", "data-project-grid", "data-category", "data-project-count"]) {
    assert.ok(app.includes("[" + marker + "]"), "app.js is missing a selector for [" + marker + "]");
  }
});

test("Theme control, script hooks and light theme styles are present", () => {
  const tags = readIndexTags();
  const html = tags.find(({ name }) => name === "html");
  assert.equal(html?.attributes.get("data-theme"), "dark", "The page must default to dark mode");
  const toggle = requireOne(tags, "button", "data-theme-toggle");
  assert.equal(toggle.get("type"), "button", "The theme control must be an explicit button");
  requireOne(tags, "span", "data-theme-action");
  requireOne(tags, "use", "data-theme-icon");

  const app = read("app.js");
  for (const marker of ["data-theme-toggle", "data-theme-action", "data-theme-icon"]) {
    assert.ok(app.includes("[" + marker + "]"), "app.js is missing a selector for [" + marker + "]");
  }
  assert.match(app, /\.dataset\.theme\s*=(?!=)/, "app.js must set the active theme");
  const themeButton = app.match(
    /(?:const|let)\s+([$A-Z_a-z][$\w]*)\s*=\s*document\.querySelector\(\s*["']\[data-theme-toggle\]["']\s*\)/
  )?.[1];
  assert.ok(themeButton, "app.js must select the theme button");
  const clickListeners = Array.from(
    app.matchAll(/([$\w]+)\s*\.\s*addEventListener\(\s*["']click["']/g),
    (match) => match[1]
  );
  assert.ok(clickListeners.includes(themeButton), "app.js must listen for clicks on the theme button");
  assert.match(read("style.css"), /\[data-theme\s*=\s*["']light["']\]/, "The light theme needs styles");
});
