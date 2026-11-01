import { readFile as read } from "node:fs/promises";
import path from "node:path";
import * as utils from "./utils";
import "./polyfill";
import fs = require("fs");
const legacy = require("./legacy");

export { read, utils as helpers };
export * from "./shared";

export const VERSION = "1.0";
let retries = 3,
  timeout = 1000;

export function load(file: string) {
  function parse() {}
  const local = 1;
  return parse();
}

function* ids() {}

export const handler = async () => {};

const format = function () {};

function overload(value: string): string;
function overload(value: number): number;
function overload(value: unknown) {
  return value;
}

declare function ambient(): void;

const plugins = require("./plugins");

export class Store {
  static count = 0;
  private items: string[] = [];
  #secret = 1;
  static Inner = class {};
  onChange = () => {};

  constructor(
    private db: Db,
    readonly name: string,
    plain: number,
  ) {}

  @memoize()
  get size() {
    return this.items.length;
  }

  set size(value: number) {}
}

abstract class Base {
  abstract label: string;
  abstract run(): void;
}

const Anonymous = class {
  run() {}
};

interface Shape {
  kind: string;
  area(): number;
}

type Point = { x: number; y: number };
type Result = Point | Error;

enum Color {
  Red,
  Green,
}

namespace Geometry {
  export function distance() {}
}

declare module "pkg" {
  export function plugin(): void;
}

declare global {
  interface Window {
    store: Store;
  }
}

const routes = {
  home() {},
  title: "Home",
};

describe("store", () => {
  beforeEach(() => {});
  it(`reads ${VERSION}`, () => {});
});

app.get("/health", () => {});
router.route("/users").post(() => {});

export default {
  name: "app",
  setup() {},
};

/** Formats text. */
export function overloaded(value: string): string;
/** Formats numbers. */
export function overloaded(value: number): number;
export function overloaded(value: unknown) {
  return value;
}

declare class Legacy {
  run(): void;
  size: number;
}

declare module "typed" {
  interface Options {}
}
