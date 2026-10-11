"use strict";

const FILES = [ "download-ui.js", "iterator-icons.css", "iterator-icons.js", "map-export.js", "map-records.js", "mobile-ui.css", "region-core.js", "region-editor.css", "region-editor.js", "region-renderer.js", "ui-preferences.css", "ui-preferences.js", "viewport-safety.css", "app-support.js", "app-support.css", "index.html", "pearl-sprites/studio-icons.js", "pearl-sprites/pearl-detail.png", "pearl-sprites/pearl-map.png", "pearl-sprites/pearl-spritesheet.png", "pearl-sprites/pearl-spritesheet.json", "rainworld-icons/air.png", "rainworld-icons/batfly.png", "rainworld-icons/den.png", "rainworld-icons/echo-symbol.png", "rainworld-icons/gate.png", "rainworld-icons/gate-locked.png", "rainworld-icons/iterator.png", "rainworld-icons/lizard.png", "rainworld-icons/green-lizard.png", "rainworld-icons/salamander.png", "rainworld-icons/vulture.png", "rainworld-icons/scavenger.png", "rainworld-icons/shelter-map.png", "rainworld-icons/toll.png", "rainworld-icons/shop.png", "rainworld-icons/shortcut-room.png", "rainworld-icons/shortcut-internal.png", "rainworld-icons/npc-transport.png", "rainworld-icons/player-scale.png", "rainworld-icons/karma-1.png", "rainworld-icons/karma-2.png", "rainworld-icons/karma-3.png", "rainworld-icons/karma-4.png", "rainworld-icons/karma-5.png", "rainworld-icons/karma-6.png", "rainworld-icons/karma-7.png", "rainworld-icons/karma-8.png", "rainworld-icons/karma-9.png", "rainworld-icons/karma-10.png", "rainworld-icons/gate-requirement-1.png", "rainworld-icons/gate-requirement-2.png", "rainworld-icons/gate-requirement-3.png", "rainworld-icons/gate-requirement-4.png", "rainworld-icons/gate-requirement-5.png", "map-fonts/Rajdhani-Medium.ttf", "manifest.webmanifest" ], BUILD = "2696ec96cb7020264d49";

const BASE = new URL("./", self.location.href), PREFIX = "rainoc-shell:" + BASE.href + ":", CACHE = PREFIX + BUILD;

const paths = new Set(FILES.map(file => new URL(file, BASE).pathname));

async function installShell() {
    const cache = await caches.open(CACHE);
    try {
        for (const file of FILES) {
            const url = new URL(file, BASE), source = file === "index.html" ? BASE : url, response = await fetch(new Request(source, {
                cache: "reload",
                credentials: "same-origin"
            }));
            if (!response.ok || response.redirected) throw Error("Offline asset unavailable");
            const type = response.headers.get("Content-Type") || "";
            if (file.endsWith(".js") && /text\/html/i.test(type)) throw Error("Invalid offline script");
            if (file === "index.html" && !(await response.clone().text()).includes('id="listScreen"')) throw Error("Invalid offline page");
            await cache.put(url.href, response);
        }
        await self.skipWaiting();
    } catch (error) {
        await caches.delete(CACHE);
        throw error;
    }
}

function readSettings() {
    return new Promise(resolve => {
        const opening = indexedDB.open("oc-studio-standalone-data-v1", 1);
        opening.onupgradeneeded = () => {
            opening.transaction.abort();
            resolve(null);
        };
        opening.onerror = () => resolve(null);
        opening.onsuccess = () => {
            const db = opening.result;
            try {
                const tx = db.transaction("settings", "readonly"), r = tx.objectStore("settings").get("app");
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => resolve(null);
                tx.oncomplete = tx.onabort = () => db.close();
            } catch {
                db.close();
                resolve(null);
            }
        };
    });
}

async function appResource(path) {
    const settings = await readSettings(), headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    }, hasIcon = !!(settings?.icon192 && settings?.icon512), version = encodeURIComponent(settings?.iconVersion || "");
    if (path === "manifest.webmanifest") {
        const title = settings?.title || "Rainworld OC Collection PWA";
        return new Response(JSON.stringify({
            id: "./",
            name: title,
            short_name: Array.from(title).slice(0, 12).join(""),
            start_url: "./",
            scope: "./",
            display: "standalone",
            background_color: "#000000",
            theme_color: "#101010",
            lang: "zh-CN",
            icons: hasIcon ? [ 192, 512 ].map(size => ({
                src: "./app-icon-" + size + ".png?v=" + version,
                sizes: size + "x" + size,
                type: "image/png",
                purpose: "any"
            })) : []
        }), {
            headers: {
                ...headers,
                "Content-Type": "application/manifest+json"
            }
        });
    }
    const blob = settings?.[path.includes("192") ? "icon192" : "icon512"];
    return blob ? new Response(blob, {
        headers: {
            ...headers,
            "Content-Type": "image/png"
        }
    }) : new Response("", {
        status: 404,
        headers: headers
    });
}

async function cached(request) {
    const url = new URL(request.url), cache = await caches.open(CACHE), key = new URL(url.pathname, BASE.origin).href;
    const response = await cache.match(request.mode === "navigate" ? new URL("index.html", BASE).href : key);
    return response || fetch(request);
}

self.addEventListener("install", event => event.waitUntil(installShell()));

self.addEventListener("activate", event => event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
})()));

self.addEventListener("fetch", event => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
    const relative = url.pathname.slice(BASE.pathname.length);
    if (relative === "manifest.webmanifest" || /^app-icon-(192|512)\.png$/.test(relative)) {
        event.respondWith(appResource(relative));
        return;
    }
    if (paths.has(url.pathname) || request.mode === "navigate" && (relative === "" || relative === "index.html")) event.respondWith(cached(request));
});
