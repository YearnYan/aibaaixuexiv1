import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs");
const targetDir = join(root, "public");
const target = join(targetDir, "pdf.worker.js");
const pdfRuntimeCompatPolyfills = `(() => {
  if (!Uint8Array.prototype.toHex) {
    Object.defineProperty(Uint8Array.prototype, "toHex", {
      value: function toHex() {
        let hex = "";
        for (let index = 0; index < this.length; index += 1) {
          hex += this[index].toString(16).padStart(2, "0");
        }
        return hex;
      },
      configurable: true,
      writable: true,
    });
  }

  if (!Map.prototype.getOrInsert) {
    Object.defineProperty(Map.prototype, "getOrInsert", {
      value: function getOrInsert(key, value) {
        if (!this.has(key)) {
          this.set(key, value);
        }
        return this.get(key);
      },
      configurable: true,
      writable: true,
    });
  }

  if (!Map.prototype.getOrInsertComputed) {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed(key, callback) {
        if (typeof callback !== "function") {
          throw new TypeError("Map.prototype.getOrInsertComputed callback must be a function");
        }
        if (!this.has(key)) {
          this.set(key, callback(key));
        }
        return this.get(key);
      },
      configurable: true,
      writable: true,
    });
  }

  if (!Promise.withResolvers) {
    Object.defineProperty(Promise, "withResolvers", {
      value: function withResolvers() {
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
          resolve = resolvePromise;
          reject = rejectPromise;
        });
        return { promise, resolve, reject };
      },
      configurable: true,
      writable: true,
    });
  }

  if (!Math.sumPrecise) {
    Object.defineProperty(Math, "sumPrecise", {
      value: function sumPrecise(items) {
        let sum = 0;
        for (const item of items) {
          sum += item;
        }
        return sum;
      },
      configurable: true,
      writable: true,
    });
  }
})();

`;

mkdirSync(targetDir, { recursive: true });
const workerSource = readFileSync(source, "utf8");
writeFileSync(target, `${pdfRuntimeCompatPolyfills}${workerSource}`, "utf8");

console.log(`已复制 PDF worker：${target}`);
