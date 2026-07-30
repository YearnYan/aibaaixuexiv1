export const PDF_RUNTIME_COMPAT_VERSION = "20260614-runtime-compat";

export function installPdfRuntimeCompat() {
  ensureUint8ArrayToHex();
  ensureMapGetOrInsertComputed();
  ensurePromiseWithResolvers();
  ensureMathSumPrecise();
}

function ensureUint8ArrayToHex() {
  const uint8ArrayPrototype = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
  if (typeof uint8ArrayPrototype.toHex === "function") return;

  Object.defineProperty(uint8ArrayPrototype, "toHex", {
    value(this: Uint8Array) {
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

function ensureMapGetOrInsertComputed() {
  type MapPrototypeWithHelpers = Map<unknown, unknown> & {
    getOrInsert?: (key: unknown, value: unknown) => unknown;
    getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
  };

  const mapPrototype = Map.prototype as MapPrototypeWithHelpers;

  if (typeof mapPrototype.getOrInsert !== "function") {
    Object.defineProperty(mapPrototype, "getOrInsert", {
      value(this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (!this.has(key)) {
          this.set(key, value);
        }
        return this.get(key);
      },
      configurable: true,
      writable: true,
    });
  }

  if (typeof mapPrototype.getOrInsertComputed !== "function") {
    Object.defineProperty(mapPrototype, "getOrInsertComputed", {
      value(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown) {
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
}

function ensurePromiseWithResolvers() {
  type PromiseConstructorWithResolvers = PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };

  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers === "function") return;

  Object.defineProperty(promiseConstructor, "withResolvers", {
    value<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    },
    configurable: true,
    writable: true,
  });
}

function ensureMathSumPrecise() {
  const mathWithSumPrecise = Math as Math & { sumPrecise?: (items: Iterable<number>) => number };
  if (typeof mathWithSumPrecise.sumPrecise === "function") return;

  Object.defineProperty(mathWithSumPrecise, "sumPrecise", {
    value(items: Iterable<number>) {
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
