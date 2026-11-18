/*
 * Workboard adapter for Lead Desk.
 *
 * Lead Desk was written for a hosted page that provides `window.claude.use("db" | "user" | "downloads")`.
 * This file provides the same small API on top of Workboard's own server, so the Lead Desk code runs
 * unchanged: data lives in Workboard's database, behind the same sign-in, and syncs between people
 * by polling the shared change counter (/api/revision).
 */
(function () {
  "use strict";

  // Same appearance setting as the rest of Workboard.
  try {
    var t = localStorage.getItem("wb.theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* storage unavailable */ }

  var POLL_MS = 4000;

  function dbError(status, message) {
    // Lead Desk shows a permission message for "invalid_argument" and a retry message otherwise.
    var e = new Error(message || "Request failed");
    e.code = status === 400 || status === 403 ? "invalid_argument" : "unavailable";
    e.status = status;
    return e;
  }

  function request(method, path, body) {
    var headers = { "X-Requested-With": "workboard" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch("/api" + path, {
      method: method, credentials: "same-origin", headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) {
        location.href = "/?next=" + encodeURIComponent("/leads/");
        throw dbError(401, "Please sign in.");
      }
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw dbError(r.status, data && data.error);
        return data;
      });
    });
  }

  function newId() {
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]; }).join("");
  }

  // ---- collection cache + listeners ----
  var cache = {};      // collection -> [{id, data}]
  var listeners = [];  // {collection, id|null, next, error}
  var lastRev = null;

  function docSnap(row) {
    return { id: row ? row.id : "", exists: !!row, data: function () { return row ? JSON.parse(JSON.stringify(row.data)) : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function deliver(collection) {
    var rows = cache[collection] || [];
    listeners.forEach(function (l) {
      if (l.collection !== collection) return;
      // Like the original storage, only notify when what this listener sees actually changed.
      var view = l.id === null ? rows : rows.filter(function (r) { return r.id === l.id; });
      var key = JSON.stringify(view);
      if (l.lastKey === key) return;
      l.lastKey = key;
      try {
        if (l.id === null) {
          var docs = rows.map(docSnap);
          l.next({ docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } });
        } else {
          var row = rows.filter(function (r) { return r.id === l.id; })[0];
          var s = docSnap(row); s.id = l.id;
          l.next(s);
        }
      } catch (e) { console.error(e); }
    });
  }
  function refresh(collection) {
    return request("GET", "/docs/" + collection).then(function (rows) {
      cache[collection] = rows || [];
      deliver(collection);
    }).catch(function (e) {
      listeners.forEach(function (l) { if (l.collection === collection && l.error) { try { l.error(e); } catch (x) {} } });
    });
  }
  function watched() {
    var seen = {};
    listeners.forEach(function (l) { seen[l.collection] = true; });
    return Object.keys(seen);
  }
  function poll() {
    if (document.visibilityState === "visible" && listeners.length) {
      request("GET", "/revision").then(function (r) {
        // The first check also refreshes: a change made between the initial load and now
        // would otherwise be missed until the next one.
        if (r.rev !== lastRev) watched().forEach(refresh);
        lastRev = r.rev;
      }).catch(function () { /* try again next tick */ });
    }
    setTimeout(poll, POLL_MS);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") watched().forEach(refresh); });
  setTimeout(poll, POLL_MS);

  function docRef(collection, id) {
    return {
      id: id,
      path: collection + "/" + id,
      set: function (data) {
        return request("PUT", "/docs/" + collection + "/" + encodeURIComponent(id), data).then(function () { return refresh(collection); });
      },
      delete: function () {
        return request("DELETE", "/docs/" + collection + "/" + encodeURIComponent(id)).catch(function (e) {
          if (e.status !== 404) throw e; // already gone is fine
        }).then(function () { return refresh(collection); });
      },
      get: function () {
        return request("GET", "/docs/" + collection).then(function (rows) {
          return docSnap((rows || []).filter(function (r) { return r.id === id; })[0]);
        });
      },
      onSnapshot: function (next, error) {
        var l = { collection: collection, id: id, next: next, error: error };
        listeners.push(l);
        if (cache[collection]) setTimeout(function () { deliver(collection); }, 0); else refresh(collection);
        return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
      },
    };
  }
  function collectionRef(collection) {
    return {
      path: collection,
      doc: function (id) { return docRef(collection, id || newId()); },
      onSnapshot: function (next, error) {
        var l = { collection: collection, id: null, next: next, error: error };
        listeners.push(l);
        if (cache[collection]) setTimeout(function () { deliver(collection); }, 0); else refresh(collection);
        return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
      },
    };
  }

  var db = {
    collection: collectionRef,
    doc: function (path) {
      var parts = String(path).split("/");
      return docRef(parts[0], parts[1]);
    },
  };

  var user = {
    can: function () { return Promise.resolve(true); }, // the server checks the session on every write
    isOwner: function () { return false; },
    canEdit: function () { return true; },
  };

  var downloads = {
    save: function (file) {
      var blob = new Blob([file.data], { type: /\.html?$/i.test(file.filename) ? "text/html" : "application/octet-stream" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.filename || "download";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve();
    },
  };

  window.claude = {
    use: function (name) {
      if (name === "db") return Promise.resolve(db);
      if (name === "user") return Promise.resolve(user);
      if (name === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    },
  };
})();
